import type { DraftArticleDto } from "@pegma/knowledge-base-application";
import { describe, expect, it } from "vitest";
import {
  admin,
  applicationFixture,
  author,
  draft,
  evidence,
} from "../test/application-fixtures.js";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import { barrier, traceStore } from "../test/trace-store.js";

const conflict = { name: "RepositoryConflictError" };
const capacity = { name: "RepositoryCapacityError" };

for (const [name, createStore] of storeFactories) {
  describe(`KB application atomicity and admission (${name})`, () => {
    it("commits authoritative revision, audit, replay receipt and causal job together", async () => {
      const f = applicationFixture(await createStore());
      await f.setupCollection();
      const current = await f.createDraft();
      const rows = (await allKnowledgeRows(f.store)).filter(
        (row) =>
          row.resourceKind === "article" &&
          row.resourceId === current.articleId,
      );
      expect(rows.map((row) => row.kind).sort()).toEqual([
        "audit",
        "command",
        "head",
        "job",
        "provenance",
        "revision",
      ]);
    });

    it("retries a refused transaction whose failedAction is absent without duplicating accepted work", async () => {
      const backing = await createStore();
      const traced = traceStore(backing);
      const f = applicationFixture(traced.store);
      await f.setupCollection();
      const current = await f.createDraft();
      let failures = 1;
      traced.intercept(async (_trace, commit) =>
        failures-- > 0 ? { committed: false, reason: "changed" } : commit(),
      );
      await f.app.updateDraft(author, {
        ...f.command("retry-edit", current.generation),
        articleId: current.articleId,
        collectionId: current.revision.collectionId,
        draft: { ...draft(), title: "Accepted once" },
      });
      traced.intercept(undefined);
      const rows = (await allKnowledgeRows(backing)).filter(
        (row) => row.resourceKind === "article",
      );
      expect(rows.filter((row) => row.kind === "revision")).toHaveLength(2);
      expect(rows.filter((row) => row.kind === "audit")).toHaveLength(2);
      expect(rows.filter((row) => row.kind === "command")).toHaveLength(2);
      expect(rows.filter((row) => row.kind === "job")).toHaveLength(2);
      expect(
        (await f.app.getDraft(author, { articleId: current.articleId }))
          .revision.title,
      ).toBe("Accepted once");
    });

    it("replays an identical concurrent command after a timestamp-dependent immutable planning collision", async () => {
      const backing = await createStore();
      const winner = applicationFixture(backing);
      await winner.setupCollection();
      const traced = traceStore(backing);
      const delayed = applicationFixture(traced.store);
      delayed.setTime(1_000);
      const gate = barrier();
      let paused = false;
      traced.beforeGet(async ({ key }) => {
        if (
          !paused &&
          key.partition.startsWith("article:") &&
          key.id === "revision:1"
        ) {
          paused = true;
          await gate.wait();
        }
      });
      const input = {
        ...winner.command("concurrent-identical-create", 0),
        articleId: "article/concurrent-replay",
        collectionId: "collection/workshop",
        draft: draft(),
      };
      const pending = delayed.app.createDraft(author, input).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      let accepted;
      try {
        await Promise.race([
          gate.reached,
          pending.then(() => {
            throw new Error("Create did not reach its immutable read barrier");
          }),
        ]);
        accepted = await winner.app.createDraft(author, input);
      } finally {
        gate.release();
      }
      const settled = await pending;
      traced.beforeGet(undefined);
      expect(accepted.replayed).toBe(false);
      expect(settled).toEqual({
        value: { value: accepted.value, replayed: true },
      });
      const rows = (await allKnowledgeRows(backing)).filter(
        (row) => row.resourceKind === "article",
      );
      expect(rows.map((row) => row.kind).sort()).toEqual([
        "audit",
        "command",
        "head",
        "job",
        "provenance",
        "revision",
      ]);
      expect(
        (
          await winner.app.getDraft(author, {
            articleId: input.articleId,
          })
        ).revision.createdAt,
      ).toBe("2026-11-06T20:00:00.000Z");
    });

    it.each(["create", "edit"] as const)(
      "replays an identical %s when the winning receipt appears after the cached head was read",
      async (operation) => {
        const backing = await createStore();
        const winner = applicationFixture(backing);
        await winner.setupCollection();
        const articleId = "article/receipt-read-race";
        const expectedGeneration =
          operation === "create"
            ? 0
            : (await winner.createDraft(articleId)).generation;
        winner.setTime(2_000);
        const traced = traceStore(backing);
        const delayed = applicationFixture(traced.store, {
          limits: { maxConflictAttempts: 1 },
        });
        delayed.setTime(3_000);
        const gate = barrier();
        let paused = false;
        traced.beforeGet(async ({ key }) => {
          if (
            !paused &&
            key.partition.startsWith("article:") &&
            key.id.startsWith("command:")
          ) {
            paused = true;
            await gate.wait();
          }
        });
        const input = {
          ...winner.command("receipt-read-race", expectedGeneration),
          articleId,
          collectionId: "collection/workshop",
          draft: { ...draft(), title: "Receipt-winning guide" },
        };
        const invoke = (fixture: typeof winner) =>
          operation === "create"
            ? fixture.app.createDraft(author, input)
            : fixture.app.updateDraft(author, input);
        const pending = invoke(delayed).then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        let accepted;
        let committedRows;
        try {
          await Promise.race([
            gate.reached,
            pending.then(() => {
              throw new Error("Command did not reach its receipt read barrier");
            }),
          ]);
          accepted = await invoke(winner);
          committedRows = await allKnowledgeRows(backing);
        } finally {
          gate.release();
        }
        const settled = await pending;
        traced.beforeGet(undefined);
        expect(accepted.replayed).toBe(false);
        expect(settled).toEqual({
          value: { value: accepted.value, replayed: true },
        });
        expect(await allKnowledgeRows(backing)).toEqual(committedRows);
        const articleRows = committedRows.filter(
          (row) => row.resourceKind === "article",
        );
        const acceptedCommands = operation === "create" ? 1 : 2;
        for (const kind of ["revision", "audit", "command", "job"])
          expect(articleRows.filter((row) => row.kind === kind)).toHaveLength(
            acceptedCommands,
          );
        expect(traced.transactions).toHaveLength(0);
      },
    );

    it("refuses repeated failed preconditions atomically, including absent failedAction", async () => {
      const backing = await createStore();
      const traced = traceStore(backing);
      const f = applicationFixture(traced.store);
      await f.setupCollection();
      const current = await f.createDraft();
      const before = await allKnowledgeRows(backing);
      let attempts = 0;
      traced.intercept(async () => {
        attempts += 1;
        return { committed: false, reason: "changed" };
      });
      await expect(
        f.app.updateDraft(author, {
          ...f.command("refused-edit", current.generation),
          articleId: current.articleId,
          collectionId: current.revision.collectionId,
          draft: { ...draft(), title: "Never committed" },
        }),
      ).rejects.toMatchObject(conflict);
      traced.intercept(undefined);
      expect(attempts).toBe(3);
      expect(await allKnowledgeRows(backing)).toEqual(before);
      expect(
        await f.app.getDraft(author, { articleId: current.articleId }),
      ).toEqual(current);
    });

    it("allows one concurrent edit, counts every history row, and preserves retirement reserve", async () => {
      const store = await createStore();
      await applicationFixture(store).setupCollection();
      const f = applicationFixture(store, {
        limits: { maxPhysicalRows: 14, controlReserveRows: 4 },
      });
      const original = await f.createDraft();
      const results = await Promise.allSettled(
        ["First competing edit", "Second competing edit"].map((title) =>
          f.app.updateDraft(author, {
            ...f.command("competing-edit", original.generation),
            articleId: original.articleId,
            collectionId: original.revision.collectionId,
            draft: { ...draft(), title },
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const current = await f.app.getDraft(author, {
        articleId: original.articleId,
      });
      expect(current.generation).toBe(original.generation + 1);
      expect(current.revision.number).toBe(2);
      expect(["First competing edit", "Second competing edit"]).toContain(
        current.revision.title,
      );
      const before = await allKnowledgeRows(store);
      expect(
        before.filter((row) => row.resourceKind === "article"),
      ).toHaveLength(10);
      await expect(
        f.app.updateDraft(author, {
          ...f.command("no-authoring-space", current.generation),
          articleId: current.articleId,
          collectionId: current.revision.collectionId,
          draft: draft(),
        }),
      ).rejects.toMatchObject(capacity);
      expect(await allKnowledgeRows(store)).toEqual(before);
      await f.app.retireArticle(admin, {
        ...f.command("reserved-retirement", current.generation),
        articleId: current.articleId,
      });
      expect(
        (await f.app.getDraft(admin, { articleId: current.articleId })).state,
      ).toBe("retired");
      expect(
        (await allKnowledgeRows(store)).filter(
          (row) => row.resourceKind === "article",
        ),
      ).toHaveLength(13);
    });

    it("does not lose independent evidence submissions across an application-generation conflict", async () => {
      const f = applicationFixture(await createStore());
      await f.setupCollection();
      const current = await f.createDraft(
        "article/walkthrough",
        "collection/workshop",
        draft("walkthrough"),
      );
      f.setTime(3_000);
      const kinds = ["walkthrough-content", "walkthrough-workflow"] as const;
      const inputs = await Promise.all(
        kinds.map(async (kind) => {
          const issued = await f.issueReceipt(
            current,
            evidence(current.revision, kind),
          );
          return {
            ...f.command(kind, current.generation),
            articleId: current.articleId,
            evidence: issued.submission,
            receipt: issued.receipt,
          };
        }),
      );
      const results = await Promise.allSettled(
        inputs.map((input) => f.app.submitEvidence(author, input)),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const failedIndex = results.findIndex(
        (result) => result.status === "rejected",
      );
      const after = await f.app.getDraft(author, {
        articleId: current.articleId,
      });
      expect(after.revision.number).toBe(1);
      expect(after.generation).toBe(current.generation + 1);
      await f.app.submitEvidence(author, {
        ...inputs[failedIndex]!,
        ...f.command("retry-distinct-proof", after.generation),
      });
      const stored = await f.app.getEvidence(admin, {
        articleId: current.articleId,
      });
      expect(stored.evidence.map((proof) => proof.checkId).sort()).toEqual([
        ...kinds,
      ]);
      await f.review(
        await f.app.getDraft(author, { articleId: current.articleId }),
      );
    });

    it("preserves exact retained-history limits without deleting old rows to admit an edit", async () => {
      const store = await createStore();
      await applicationFixture(store).setupCollection();
      const f = applicationFixture(store, {
        limits: { maxArticleRevisions: 2 },
      });
      let current = await f.createDraft();
      await f.app.updateDraft(author, {
        ...f.command("second-revision", current.generation),
        articleId: current.articleId,
        collectionId: current.revision.collectionId,
        draft: { ...draft(), title: "Second revision" },
      });
      current = await f.app.getDraft(author, { articleId: current.articleId });
      const before = await allKnowledgeRows(store);
      await expect(
        f.app.updateDraft(author, {
          ...f.command("third-revision", current.generation),
          articleId: current.articleId,
          collectionId: current.revision.collectionId,
          draft: { ...draft(), title: "Third revision" },
        }),
      ).rejects.toMatchObject(capacity);
      expect(await allKnowledgeRows(store)).toEqual(before);
      expect(
        (await allKnowledgeRows(store)).filter(
          (row) => row.kind === "revision",
        ),
      ).toHaveLength(2);
    });

    it("keeps enough control capacity to revoke a live published proof", async () => {
      const store = await createStore();
      await applicationFixture(store).setupCollection();
      const f = applicationFixture(store, {
        limits: { maxPhysicalRows: 22, controlReserveRows: 4 },
      });
      const published = await f.publishedArticle();
      const proof = (
        await f.app.getEvidence(admin, {
          articleId: published.current.articleId,
        })
      ).evidence[0]!;
      expect(
        (await allKnowledgeRows(store)).filter(
          (row) => row.resourceKind === "article",
        ),
      ).toHaveLength(18);
      await expect(
        f.app.updateDraft(author, {
          ...f.command("would-consume-reserve", published.current.generation),
          articleId: published.current.articleId,
          collectionId: "collection/workshop",
          draft: draft(),
        }),
      ).rejects.toMatchObject(capacity);
      await f.app.revokeEvidence(admin, {
        ...f.command("reserved-proof-revocation", published.current.generation),
        articleId: published.current.articleId,
        articleRevision: proof.articleRevision,
        evidenceId: proof.id,
        evidenceVersion: proof.version,
        evidenceHash: proof.hash,
        reason: "Synthetic proof revoked",
      });
      expect(
        (await allKnowledgeRows(store)).filter(
          (row) => row.resourceKind === "article",
        ),
      ).toHaveLength(22);
      expect(
        (
          await f.app.getDraft(admin, {
            articleId: published.current.articleId,
          })
        ).publicationHeld,
      ).toBe(true);
    });

    it("fails current-policy serving after a collection update races a publication commit", async () => {
      const backing = await createStore();
      const traced = traceStore(backing);
      const f = applicationFixture(traced.store);
      await f.setupCollection();
      let current: DraftArticleDto = await f.createDraft();
      current = (await f.submitEvidence(current)).current;
      const review = await f.review(current);
      f.setTime(5_000);
      const gate = barrier();
      let paused = false;
      traced.intercept(async (trace, commit) => {
        if (!paused && trace.partition.startsWith("article:")) {
          paused = true;
          await gate.wait();
        }
        return commit();
      });
      const pending = f.app
        .publishArticle(admin, {
          ...f.command("racing-publication", review.generation),
          articleId: current.articleId,
          review: review.review,
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      try {
        await Promise.race([
          gate.reached,
          pending.then(() => {
            throw new Error(
              "Publication did not reach its transaction barrier",
            );
          }),
        ]);
        const preview = await f.app.previewCollectionPolicy(admin, {
          collectionId: "collection/workshop",
          uses: { portal: { enabled: false }, bot: { enabled: false } },
        });
        await f.app.updateCollectionPolicy(admin, {
          ...f.command("concurrent-revocation", preview.generation),
          collectionId: "collection/workshop",
          preview: preview.preview,
        });
      } finally {
        gate.release();
      }
      await pending;
      traced.intercept(undefined);
      await expect(
        f.app.getPublishedArticle(admin, { articleId: current.articleId }),
      ).rejects.toMatchObject({ name: "KnowledgeBaseNotFoundError" });
    });
  });
}
