import {
  knowledgeRecords,
  type ArticleIndexStatusDto,
  type RetrievalRecord,
} from "@pegma/knowledge-base-application";
import { describe, expect, it } from "vitest";
import { admin, customer, evidence } from "../test/application-fixtures.js";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import {
  allRetrievalRows,
  indexAdministrator,
  retrievalFixture,
  retrievalGuides,
} from "../test/retrieval-fixtures.js";
import { barrier, type TransactionTrace } from "../test/trace-store.js";

const articleId = "article/export";
const indexCollection = "knowledge-base.retrieval.v1";
type Fixture = ReturnType<typeof retrievalFixture>;

function values(trace: TransactionTrace): RetrievalRecord[] {
  if (trace.collection !== indexCollection) return [];
  return trace.actions.flatMap((action) =>
    "value" in action ? [action.value as RetrievalRecord] : [],
  );
}

function phase(trace: TransactionTrace): string | undefined {
  const rows = values(trace);
  if (
    rows.some(
      (row) =>
        row.kind === "article" &&
        (row.data as { status?: string }).status === "ready",
    )
  )
    return "finish";
  return rows.find((row) =>
    ["article", "directory", "catalog", "scope"].includes(row.kind),
  )?.kind;
}

async function publish(f: Fixture) {
  await f.setupCollection();
  return f.publishedArticle(
    articleId,
    "collection/workshop",
    retrievalGuides[0]!.draft,
  );
}

async function step(f: Fixture) {
  f.clearObservations();
  const result = await f.app.repairArticleIndex(indexAdministrator, {
    articleId,
    maxBatches: 1,
  });
  expect(
    f.traced.transactions.filter(
      (trace) => trace.collection === indexCollection,
    ).length,
  ).toBeLessThanOrEqual(1);
  expect(f.traced.enumerations).toEqual([]);
  expect(result.articleId).toBe(articleId);
  if (result.status !== "ready") expect(result.indexed).toBe(false);
  return result;
}

async function converge(
  f: Fixture,
  onStep?: (status: ArticleIndexStatusDto) => void,
) {
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const result = await step(f);
    onStep?.(result);
    if (result.status !== "pending") return result;
  }
  throw new Error(
    "Bounded synthetic article repair made no convergence within 48 steps",
  );
}

async function reached(
  gate: ReturnType<typeof barrier>,
  pending: Promise<unknown>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      gate.reached,
      pending.then(() => {
        throw new Error("Repair completed before its intended barrier");
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Repair barrier exceeded 10 seconds")),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

for (const [backend, createStore] of storeFactories) {
  describe(`resumable one-attempt retrieval over ${backend}`, () => {
    it("validates explicit keyed/page attempt bounds before any physical I/O", async () => {
      const f = retrievalFixture(await createStore(), {
        limits: { maxMaintenanceBatches: 2 },
      });
      for (const maxBatches of [
        0,
        -1,
        1.5,
        3,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ]) {
        await expect(
          f.app.repairArticleIndex(indexAdministrator, {
            articleId,
            maxBatches,
          }),
        ).rejects.toBeInstanceOf(TypeError);
        await expect(
          f.app.repairRetrievalPage(indexAdministrator, {
            limit: 1,
            maxBatches,
          }),
        ).rejects.toBeInstanceOf(TypeError);
      }
      expect(f.traced.reads).toEqual([]);
      expect(f.traced.enumerations).toEqual([]);
      expect(f.traced.transactions).toEqual([]);
    });

    it("advances durable prerequisites and both scopes one attempt at a time, then performs an idempotent current no-op", async () => {
      const backing = await createStore();
      const f = retrievalFixture(backing);
      await publish(f);
      const authoritative = await allKnowledgeRows(backing);
      const phases: string[] = [];
      const generations = new Set<number>();
      const result = await converge(f, (status) => {
        if (status.projectionGeneration !== null)
          generations.add(status.projectionGeneration);
        phases.push(
          ...f.traced.transactions
            .map(phase)
            .filter((value): value is string => value !== undefined),
        );
      });
      expect(result).toMatchObject({ status: "ready", indexed: true });
      expect(phases).toContain("directory");
      expect(phases).toContain("catalog");
      expect(
        phases.filter((value) => value === "scope").length,
      ).toBeGreaterThan(2);
      expect(phases).toContain("finish");
      expect([...generations]).toEqual([1]);
      expect(
        (await f.app.searchPublishedArticles(customer, f.portalInput()))
          .articles[0]?.articleId,
      ).toBe(articleId);
      const before = await allRetrievalRows(backing);
      expect(await step(f)).toEqual(result);
      expect(f.traced.transactions).toEqual([]);
      expect(await allRetrievalRows(backing)).toEqual(before);
      expect(await allKnowledgeRows(backing)).toEqual(authoritative);
    });

    it.each(["article", "directory", "catalog", "scope"])(
      "charges a genuine concurrent %s CAS failure once and resumes without resetting progress",
      async (targetPhase) => {
        const backing = await createStore();
        const f = retrievalFixture(backing);
        const winner = retrievalFixture(backing);
        await publish(f);
        let collided = false;
        f.traced.intercept(async (trace, commit) => {
          if (!collided && phase(trace) === targetPhase) {
            collided = true;
            expect(
              (
                await winner.app.repairArticleIndex(indexAdministrator, {
                  articleId,
                  maxBatches: 1,
                })
              ).status,
            ).toBe("pending");
            const outcome = await commit();
            expect(outcome).toMatchObject({ committed: false });
            return outcome;
          }
          return commit();
        });
        try {
          for (let attempt = 0; attempt < 32 && !collided; attempt += 1)
            expect((await step(f)).status).toBe("pending");
          expect(collided).toBe(true);
          expect(f.traced.transactions).toHaveLength(1);
        } finally {
          f.traced.intercept(undefined);
        }
        expect(await converge(f)).toMatchObject({
          status: "ready",
          indexed: true,
          projectionGeneration: 1,
        });
      },
    );

    it.each(["article", "scope", "finish"])(
      "recovers a lost %s transaction acknowledgement without reapplying completed terms or authoritative mutations",
      async (targetPhase) => {
        const backing = await createStore();
        const f = retrievalFixture(backing);
        await publish(f);
        const authoritative = await allKnowledgeRows(backing);
        let lost = false;
        f.traced.intercept(async (trace, commit) => {
          const outcome = await commit();
          if (!lost && outcome.committed && phase(trace) === targetPhase) {
            lost = true;
            throw new Error("Synthetic accepted-write acknowledgement loss");
          }
          return outcome;
        });
        try {
          for (let attempt = 0; attempt < 40 && !lost; attempt += 1) {
            f.clearObservations();
            try {
              const result = await f.app.repairArticleIndex(
                indexAdministrator,
                { articleId, maxBatches: 1 },
              );
              expect(result.status).toBe("pending");
            } catch (error) {
              expect(lost).toBe(true);
              expect(error).toMatchObject({
                message: "Synthetic accepted-write acknowledgement loss",
              });
            }
            expect(
              f.traced.transactions.filter(
                (trace) => trace.collection === indexCollection,
              ),
            ).toHaveLength(1);
          }
          expect(lost).toBe(true);
        } finally {
          f.traced.intercept(undefined);
        }
        const result = await converge(f);
        expect(result).toMatchObject({
          status: "ready",
          indexed: true,
          projectionGeneration: 1,
        });
        const rows = await allRetrievalRows(backing);
        for (const row of rows.filter((value) => value.kind === "page")) {
          const entries = (
            row.data as { entries: { hint: { articleId: string } }[] }
          ).entries;
          expect(
            entries.filter((entry) => entry.hint.articleId === articleId),
          ).toHaveLength(1);
        }
        expect(await step(f)).toEqual(result);
        expect(await allRetrievalRows(backing)).toEqual(rows);
        expect(await allKnowledgeRows(backing)).toEqual(authoritative);
      },
    );

    it("retains legacy omitted-input convergence and returns a confirmed withdrawal after retirement", async () => {
      const f = retrievalFixture(await createStore());
      const published = await publish(f);
      f.clearObservations();
      expect(
        await f.app.repairArticleIndex(indexAdministrator, { articleId }),
      ).toMatchObject({ status: "ready", indexed: true });
      expect(f.traced.transactions.length).toBeGreaterThan(1);
      await f.authoringApp.retireArticle(admin, {
        ...f.command("retire-step", published.current.generation),
        articleId,
      });
      expect(
        (await f.app.searchPublishedArticles(customer, f.portalInput()))
          .articles,
      ).toEqual([]);
      expect(await converge(f)).toMatchObject({
        status: "ready",
        indexed: false,
      });
    });

    it("keeps a genuine capacity hold distinct from successful withdrawal", async () => {
      const f = retrievalFixture(await createStore(), {
        limits: { maxTermsPerArticle: 1 },
      });
      await publish(f);
      expect(await converge(f)).toMatchObject({
        status: "blocked",
        indexed: false,
        reason: "capacity",
      });
      expect(
        (await f.app.searchPublishedArticles(customer, f.portalInput()))
          .articles,
      ).toEqual([]);
    });

    it("replays an actual opaque physical page with one article attempt and eventually completes without moving the authoritative source", async () => {
      const backing = await createStore();
      const f = retrievalFixture(backing);
      await publish(f);
      const authoritative = await allKnowledgeRows(backing);
      let cursor: string | undefined;
      let found = false;
      for (let page = 0; page < 128; page += 1) {
        f.clearObservations();
        const result = await f.app.repairRetrievalPage(indexAdministrator, {
          limit: 1,
          maxBatches: 1,
          ...(cursor === undefined ? {} : { cursor }),
        });
        expect(result.physicalRows).toBeLessThanOrEqual(1);
        expect(f.traced.transactions.length).toBeLessThanOrEqual(1);
        if (f.traced.transactions.some((trace) => phase(trace) === "article")) {
          found = true;
          break;
        }
        if (result.nextCursor === null)
          throw new Error("No actual article hint in bounded source scan");
        cursor = result.nextCursor;
      }
      expect(found).toBe(true);
      let ready = false;
      for (let replay = 0; replay < 40; replay += 1) {
        f.clearObservations();
        const result = await f.app.repairRetrievalPage(indexAdministrator, {
          limit: 1,
          maxBatches: 1,
          ...(cursor === undefined ? {} : { cursor }),
        });
        expect(result.physicalRows).toBe(1);
        expect(f.traced.transactions.length).toBeLessThanOrEqual(1);
        if (result.repaired === 1) {
          ready = true;
          break;
        }
      }
      expect(ready).toBe(true);
      expect(
        await f.app.getArticleIndexStatus(indexAdministrator, { articleId }),
      ).toMatchObject({ status: "ready", indexed: true });
      expect(await allKnowledgeRows(backing)).toEqual(authoritative);
    });

    it("also bounds a real collection-directory conflict on an explicit one-row recovery page", async () => {
      const backing = await createStore();
      const f = retrievalFixture(backing);
      const winner = retrievalFixture(backing);
      await f.setupCollection();
      const records = backing.collection(knowledgeRecords);
      let cursor: string | undefined;
      let found = false;
      for (let page = 0; page < 128; page += 1) {
        const result = await records.scan({
          limit: 1,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (
          result.records.some(
            ({ value }) =>
              value.resourceKind === "collection" &&
              (value.kind === "head" || value.kind === "job"),
          )
        ) {
          found = true;
          break;
        }
        if (result.nextCursor === null) break;
        cursor = result.nextCursor;
      }
      expect(found).toBe(true);
      let collided = false;
      f.traced.intercept(async (trace, commit) => {
        if (!collided && phase(trace) === "directory") {
          collided = true;
          await winner.app.repairRetrievalPage(indexAdministrator, {
            limit: 1,
            maxBatches: 1,
            ...(cursor === undefined ? {} : { cursor }),
          });
          const outcome = await commit();
          expect(outcome.committed).toBe(false);
          return outcome;
        }
        return commit();
      });
      try {
        f.clearObservations();
        expect(
          await f.app.repairRetrievalPage(indexAdministrator, {
            limit: 1,
            maxBatches: 1,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        ).toMatchObject({ pending: 1, repaired: 0 });
        expect(collided).toBe(true);
        expect(f.traced.transactions).toHaveLength(1);
      } finally {
        f.traced.intercept(undefined);
      }
      expect(
        await f.app.repairRetrievalPage(indexAdministrator, {
          limit: 1,
          maxBatches: 1,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      ).toMatchObject({ repaired: 1 });
    });

    // 32 real public submissions over released D1/default single reads make
    // setup substantial. This case-only timeout is not a latency assertion.
    it("reads all 28 retained approved proofs and revocation markers while preserving 32 legitimate current proofs", async () => {
      const backing = await createStore();
      const f = retrievalFixture(backing);
      await f.setupCollection();
      const configuration = await f.authoringApp.getGovernanceConfiguration(
        admin,
        {
          collectionId: "collection/workshop",
        },
      );
      const policy = await f.authoringApp.getValidationPolicy(admin, {
        policyId: configuration.configuration.validationPolicy.id,
      });
      const template = policy.policy.requirements.find(
        (check) => check.kind === "explanation",
      )!;
      // The 32-check policy must also retain content checks for the other three
      // kinds and the walkthrough workflow check. Exactly 28 explanation checks
      // can therefore qualify this publication; 32 approved checks are illegal.
      const required = Array.from({ length: 28 }, (_unused, ordinal) => ({
        ...template,
        id: `full/content/${ordinal}`,
      }));
      const requirements = [
        ...policy.policy.requirements.filter(
          (check) => check.kind !== "explanation",
        ),
        ...required,
      ];
      expect(requirements).toHaveLength(32);
      const policyVersion = policy.policy.version + 1;
      await f.authoringApp.putValidationPolicy(admin, {
        ...f.command("full-proof-policy", policy.generation),
        policy: { ...policy.policy, version: policyVersion, requirements },
      });
      await f.authoringApp.putGovernanceConfiguration(admin, {
        ...f.command("full-proof-configuration", configuration.generation),
        collectionId: "collection/workshop",
        configuration: {
          ...configuration.configuration,
          validationPolicy: { id: policy.policy.id, version: policyVersion },
        },
      });
      let current = await f.createDraft();
      for (const [proof, check] of required.entries())
        current = (
          await f.submitEvidence(current, undefined, {
            ...evidence(current.revision),
            id: `proof/full/${proof}`,
            checkId: check.id,
            testKind: check.testKind,
          })
        ).current;
      current = (await f.publish(current)).current;
      // Four later, genuinely verified draft proofs retain the same content and
      // policy. They cannot silently join or rewrite the retained approval.
      for (let proof = 0; proof < 4; proof += 1)
        current = (
          await f.submitEvidence(current, undefined, {
            ...evidence(current.revision),
            id: `proof/later/${proof}`,
            checkId: required[proof]!.id,
            testKind: required[proof]!.testKind,
          })
        ).current;
      expect(current).toMatchObject({ state: "draft", hasPublication: true });
      expect(
        (await f.authoringApp.getEvidence(admin, { articleId })).evidence,
      ).toHaveLength(32);
      f.clearObservations();
      expect(
        await f.app.getPublishedArticle(customer, { articleId }),
      ).toMatchObject({ articleId, contentHash: current.revision.contentHash });
      const rows = f.traced.reads.filter(
        (trace) => trace.collection === "knowledge-base.records.v1",
      );
      const proofs = rows.filter((trace) =>
        trace.key.id.startsWith("evidence:"),
      );
      const revocations = rows.filter((trace) =>
        trace.key.id.startsWith("revoked:"),
      );
      expect(proofs).toHaveLength(28);
      expect(revocations).toHaveLength(28);
      const lastProof = Math.max(
        ...rows.map((trace, index) =>
          trace.key.id.startsWith("evidence:") ||
          trace.key.id.startsWith("revoked:")
            ? index
            : -1,
        ),
      );
      expect(
        rows.slice(lastProof + 1).filter((trace) => trace.key.id === "head"),
      ).toHaveLength(3);
      expect(f.traced.transactions).toEqual([]);
      const retained = (await allKnowledgeRows(backing)).filter(
        (row) => row.kind === "evidence",
      );
      expect(retained).toHaveLength(32);
      const selected = proofs.at(-1)!;
      const last = retained.find(
        (row) =>
          row.partition === selected.key.partition &&
          row.id === selected.key.id,
      )!;
      await backing
        .collection(knowledgeRecords)
        .delete({ partition: last.partition, id: last.id });
      await expect(
        f.app.getPublishedArticle(customer, { articleId }),
      ).rejects.toMatchObject({ name: "KnowledgeBaseNotFoundError" });
    }, 480_000);

    it.each(["retire", "policy"])(
      "refuses %s after the last immutable publication proof await",
      async (change) => {
        const f = retrievalFixture(await createStore());
        const published = await publish(f);
        const gate = barrier();
        let armed = true;
        f.traced.beforeRead(async (trace) => {
          if (
            armed &&
            trace.collection === "knowledge-base.records.v1" &&
            trace.key.id.startsWith("evidence:")
          ) {
            armed = false;
            await gate.wait();
          }
        });
        f.clearObservations();
        const pending = f.app.repairArticleIndex(indexAdministrator, {
          articleId,
          maxBatches: 1,
        });
        try {
          await reached(gate, pending);
          if (change === "retire")
            await f.authoringApp.retireArticle(admin, {
              ...f.command("retire-proof-await", published.current.generation),
              articleId,
            });
          else {
            const preview = await f.authoringApp.previewCollectionPolicy(
              admin,
              {
                collectionId: "collection/workshop",
                uses: { portal: { enabled: false }, bot: { enabled: false } },
              },
            );
            await f.authoringApp.updateCollectionPolicy(admin, {
              ...f.command("withdraw-proof-await", preview.generation),
              collectionId: "collection/workshop",
              preview: preview.preview,
            });
          }
        } finally {
          gate.release();
          f.traced.beforeRead(undefined);
        }
        expect(await pending).toMatchObject({
          status: "pending",
          indexed: false,
        });
        expect(
          f.traced.transactions
            .flatMap(values)
            .filter((row) => row.kind === "scope" || row.kind === "page"),
        ).toEqual([]);
        expect(
          (await f.app.searchPublishedArticles(customer, f.portalInput()))
            .articles,
        ).toEqual([]);
      },
    );
  });
}
