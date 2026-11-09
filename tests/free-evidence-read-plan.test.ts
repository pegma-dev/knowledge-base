import {
  createKnowledgeBaseApplication,
  knowledgeRecords,
  RepositoryConflictError,
  RepositoryIntegrityError,
  type EvidenceVerificationRequest,
  type KnowledgeBaseApplication,
} from "@pegma/knowledge-base-application";
import { describe, expect, it } from "vitest";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import {
  evidenceReportsFixture,
  reportBarrier,
} from "../test/evidence-reports-fixtures.js";
import type { Store } from "@pegma/storage-core";

async function fixture(backing: Store) {
  const f = await evidenceReportsFixture(backing);
  let app: KnowledgeBaseApplication;
  const hooks: { afterVerifier?: () => Promise<void> } = {};
  const requests: EvidenceVerificationRequest[] = [];
  const reports = f.freshReports({
    authoringContext: {
      getAuthoringContext: (...args) => app.getAuthoringContext(...args),
      confirmAuthoringContext: (...args) =>
        app.confirmAuthoringContext(...args),
    },
  });
  app = createKnowledgeBaseApplication({
    store: f.observed.store,
    clock: f.clock,
    evidenceVerifier: {
      async verify(request) {
        requests.push(request);
        const result = await reports.verifier.verify(request);
        if (result !== null) await hooks.afterVerifier?.();
        return result;
      },
    },
  });
  async function packet() {
    const input = await f.reportInput();
    const ack = await reports.report(f.agent, input);
    const view = await reports.read(f.reviewer, f.key(ack));
    await reports.decide(
      f.reviewer,
      {
        ...f.key(ack),
        commandId: f.command("confirm-free-plan", 0).commandId,
        expectedReportGeneration: view.expectedReportGeneration,
        reviewBindingHash: view.reviewBindingHash,
      },
      "confirmed",
    );
    const current = await app.getDraft(f.agent, { articleId: f.articleId });
    return {
      report: input,
      input: {
        ...f.command("accept-free-plan", current.generation),
        articleId: f.articleId,
        evidence: input.evidence,
        receipt: ack.receipt,
      },
    };
  }
  return { ...f, app, reports, hooks, requests, packet };
}

for (const [backend, createStore] of storeFactories) {
  describe(`complete free evidence read plan over ${backend}`, () => {
    it("accepts a real human-confirmed receipt and replays its historical ACK without another verifier call", async () => {
      const f = await fixture(await createStore());
      const packet = await f.packet();
      const result = await f.app.submitEvidence(f.agent, packet.input);
      expect(result.replayed).toBe(false);
      const accepted = await f.app.getEvidence(f.reviewer, {
        articleId: f.articleId,
      });
      expect(accepted.evidence).toHaveLength(1);
      expect(accepted.evidence[0]?.attestation.id).toBe(packet.input.receipt);
      expect(f.requests).toHaveLength(1);
      const configuration = await f.app.getGovernanceConfiguration(f.owner, {
        collectionId: f.collectionId,
      });
      expect(f.requests[0]?.configuration).toEqual(configuration.configuration);
      await f.updateDraft();
      const before = await allKnowledgeRows(f.backing);
      expect(await f.app.submitEvidence(f.agent, packet.input)).toEqual({
        ...result,
        replayed: true,
      });
      expect(f.requests).toHaveLength(1);
      expect(await allKnowledgeRows(f.backing)).toEqual(before);
    });

    it.each([
      "collection",
      "validation",
      "collection-version",
      "validation-version",
    ] as const)(
      "refuses a changed %s after the actual verifier returns, without an article transaction",
      async (change) => {
        const f = await fixture(await createStore());
        const packet = await f.packet();
        f.hooks.afterVerifier = async () => {
          if (change === "collection") {
            await f.configure({
              expectedStagingBuildId: "changed-after-verification",
            });
          } else if (change === "validation") {
            const current = await f.app.getValidationPolicy(f.owner, {
              policyId: packet.input.evidence.validationPolicy.id,
            });
            await f.app.putValidationPolicy(f.owner, {
              ...f.command("change-after-verifier", current.generation),
              policy: {
                ...current.policy,
                version: current.policy.version + 1,
              },
            });
          } else {
            const kind =
              change === "collection-version" ? "collection" : "validation";
            const id =
              kind === "collection"
                ? f.collectionId
                : packet.input.evidence.validationPolicy.id;
            const row = (await allKnowledgeRows(f.backing)).find(
              (item) =>
                item.kind === "head" &&
                item.resourceKind === kind &&
                item.resourceId === id,
            );
            if (row === undefined)
              throw new Error("Expected the real governed head.");
            const records = f.backing.collection(knowledgeRecords);
            const key = { partition: row.partition, id: row.id };
            const saved = await records.getVersioned(key);
            if (saved === null)
              throw new Error("Expected a real head version.");
            expect(
              await records.putIfUnchanged(saved.value, saved.version),
            ).toBe(true);
          }
        };
        const generation = (await f.current()).generation;
        const transactions = f.observed.transactions.length;
        await expect(
          f.app.submitEvidence(f.agent, packet.input),
        ).rejects.toBeInstanceOf(RepositoryConflictError);
        expect(f.requests).toHaveLength(1);
        expect((await f.current()).generation).toBe(generation);
        expect(
          (await f.app.getEvidence(f.reviewer, { articleId: f.articleId }))
            .evidence,
        ).toEqual([]);
        // Real governance commands may commit, but the article may not.
        expect(
          f.observed.transactions
            .slice(transactions)
            .filter((trace) =>
              trace.actions.some(
                (action) =>
                  "value" in action &&
                  typeof action.value === "object" &&
                  action.value !== null &&
                  "resourceId" in action.value &&
                  action.value.resourceId === f.articleId,
              ),
            ),
        ).toEqual([]);
      },
    );

    it("uses a fresh age-check clock after verifier and head awaits", async () => {
      const f = await fixture(await createStore());
      const packet = await f.packet();
      const requirements = await f.app.getValidationRequirements(f.agent, {
        collectionId: f.collectionId,
        kind: "walkthrough",
      });
      const check = requirements.checks.find(
        (item) => item.id === packet.input.evidence.checkId,
      );
      if (check === undefined)
        throw new Error("Expected the actual configured check.");
      f.hooks.afterVerifier = async () => {
        f.advance(check.maxAgeMilliseconds + 1);
      };
      const before = await allKnowledgeRows(f.backing);
      await expect(
        f.app.submitEvidence(f.agent, packet.input),
      ).rejects.toThrow();
      expect(f.requests).toHaveLength(1);
      expect(await allKnowledgeRows(f.backing)).toEqual(before);
    });

    it("issues every required current/published/provenance/evidence/revocation read while the first immutable row is paused", async () => {
      const f = await fixture(await createStore());
      await f.completeChecks();
      await f.publish();
      const accepted = await f.app.getEvidence(f.reviewer, {
        articleId: f.articleId,
      });
      const proof = accepted.evidence[0];
      if (proof === undefined)
        throw new Error("Expected actual accepted proof.");
      await f.app.revokeEvidence(f.reviewer, {
        ...f.command("retain-complete-history", accepted.generation),
        articleId: f.articleId,
        articleRevision: proof.articleRevision,
        evidenceId: proof.id,
        evidenceVersion: proof.version,
        evidenceHash: proof.hash,
        reason: "Synthetic complete-history race",
      });
      const rows = (await allKnowledgeRows(f.backing)).filter(
        (row) => row.resourceId === f.articleId,
      );
      const revision = rows.find((row) => row.kind === "revision");
      if (revision === undefined)
        throw new Error("Expected the actual current revision.");
      const gate = reportBarrier();
      const start = f.observed.reads.length;
      f.observed.beforeRead(async ({ collection, key }) => {
        if (
          collection === knowledgeRecords.name &&
          key.partition === revision.partition &&
          key.id === revision.id
        )
          await gate.wait();
      });
      const pending = f.app.getDraft(f.agent, { articleId: f.articleId });
      try {
        await gate.reached(pending);
        const reads = f.observed.reads.slice(start);
        for (const kind of [
          "revision",
          "evidence",
          "provenance",
          "publication",
          "review",
          "revocation",
        ]) {
          const required = rows.filter((row) => row.kind === kind);
          expect(required.length).toBeGreaterThan(0);
          for (const row of required)
            expect(reads).toContainEqual({
              collection: knowledgeRecords.name,
              method: "get",
              key: { partition: row.partition, id: row.id },
            });
        }
      } finally {
        gate.release();
        await pending;
      }
      expect(await pending).toMatchObject({
        hasPublication: true,
        publicationHeld: true,
      });
      f.observed.beforeRead(undefined);
      const current = await f.app.getEvidence(f.reviewer, {
        articleId: f.articleId,
      });
      expect(current.evidence).toHaveLength(2);
      expect(current.revokedEvidence).toHaveLength(1);
    });

    it.each(["revision", "provenance", "review", "publication"] as const)(
      "retains the refusal when a referenced published %s row is missing",
      async (kind) => {
        const f = await fixture(await createStore());
        await f.completeChecks();
        await f.publish();
        await f.updateDraft();
        const rows = await allKnowledgeRows(f.backing);
        const row = rows.find(
          (item) =>
            item.resourceId === f.articleId &&
            item.kind === kind &&
            (kind !== "revision" || item.id === "revision:1"),
        );
        if (row === undefined)
          throw new Error("Expected the real referenced published row.");
        const records = f.backing.collection(knowledgeRecords);
        const key = { partition: row.partition, id: row.id };
        const saved = await records.getVersioned(key);
        if (saved === null)
          throw new Error("Expected an actual immutable version.");
        expect(await records.deleteIfUnchanged(key, saved.version)).toBe(true);
        const before = f.observed.transactions.length;
        await expect(
          f.app.getDraft(f.agent, { articleId: f.articleId }),
        ).rejects.toBeInstanceOf(RepositoryIntegrityError);
        expect(f.observed.transactions).toHaveLength(before);
      },
    );

    it.each([true, false])(
      "rechecks admission after another real writer commits (same command=%s)",
      async (sameCommand) => {
        const f = await fixture(await createStore());
        const first = await f.packet();
        const second = sameCommand ? first : await f.packet();
        const gate = reportBarrier();
        f.observed.beforeRead(async ({ collection, key }) => {
          if (
            collection !== knowledgeRecords.name ||
            !key.id.startsWith("evidence:")
          )
            return;
          f.observed.beforeRead(undefined);
          await gate.wait();
        });
        const pending = f.app.submitEvidence(f.agent, first.input);
        // Attach a rejection observer before deliberately racing the real writers.
        const settled = pending.then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        let committedRows;
        try {
          await gate.reached(pending);
          const winner = await f.app.submitEvidence(f.agent, second.input);
          expect(winner.replayed).toBe(false);
          committedRows = await allKnowledgeRows(f.backing);
        } finally {
          gate.release();
          await settled;
        }
        const result = await settled;
        if (sameCommand) {
          expect(result).toHaveProperty("value.replayed", true);
        } else {
          expect(result).toHaveProperty("error");
          if ("error" in result)
            expect(result.error).toBeInstanceOf(RepositoryConflictError);
        }
        expect(await allKnowledgeRows(f.backing)).toEqual(committedRows);
        expect(
          (await f.app.getEvidence(f.reviewer, { articleId: f.articleId }))
            .evidence,
        ).toHaveLength(1);
      },
    );
  });
}
