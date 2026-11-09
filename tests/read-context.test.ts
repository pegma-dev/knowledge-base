import {
  createKnowledgeBaseApplication,
  knowledgeRecords,
  KnowledgeBaseAuthorizationError,
  RepositoryConflictError,
  RepositoryIntegrityError,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import { describe, expect, it } from "vitest";
import { access } from "../test/application-fixtures.js";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import {
  evidenceReportsFixture,
  reportBarrier,
} from "../test/evidence-reports-fixtures.js";

for (const [backend, createStore] of storeFactories) {
  describe(`governed authoring observations over ${backend}`, () => {
    it("projects author-only material without private history, and detaches it from persistence", async () => {
      const f = await evidenceReportsFixture(await createStore());
      await f.completeChecks();
      await f.publish();
      const before = f.observed.reads.length;
      const enumerations = f.observed.enumerations.length;
      const result = await f.app.getAuthoringContext(f.agent, {
        articleId: f.articleId,
      });
      expect(result.context.evidence).toBeUndefined();
      expect(result.context.draft.hasPublication).toBe(true);
      expect(
        result.context.requirements.checks.map((check) => check.id).sort(),
      ).toEqual(["walkthrough-content", "walkthrough-workflow"]);
      const reads = f.observed.reads.slice(before);
      expect(reads).not.toHaveLength(0);
      expect(
        reads.some(({ key }) =>
          /^(evidence:|revoked:|provenance:|review:|publication:)/u.test(
            key.id,
          ),
        ),
      ).toBe(false);
      expect(JSON.stringify(result.context)).not.toContain(
        "PRIVATE_STAFF_EVIDENCE",
      );
      expect(JSON.stringify(result.context)).not.toContain(
        "trustedAttesterIds",
      );
      const title = result.context.draft.revision.title;
      Reflect.set(
        result.context.draft.revision,
        "title",
        "Mutated returned projection",
      );
      expect((await f.current()).revision.title).toBe(title);
      await expect(
        f.app.confirmAuthoringContext(f.agent, result.observation),
      ).resolves.toBeUndefined();
      expect(f.observed.enumerations).toHaveLength(enumerations);
    });

    it("requires the exact named projection clauses without upgrading an agent to its owner", async () => {
      const f = await evidenceReportsFixture(await createStore());
      for (const permissions of [
        [knowledgePermissions.draftRead],
        [knowledgePermissions.draftWrite],
        [knowledgePermissions.evidenceSubmit],
      ]) {
        const before = f.observed.reads.length;
        await expect(
          f.app.getAuthoringContext(access(f.agent.principalId, permissions), {
            articleId: f.articleId,
          }),
        ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
        expect(f.observed.reads).toHaveLength(before);
      }
      for (const alternative of [
        knowledgePermissions.draftWrite,
        knowledgePermissions.evidenceSubmit,
      ]) {
        const caller = access(f.agent.principalId, [
          knowledgePermissions.draftRead,
          alternative,
        ]);
        const result = await f.app.getAuthoringContext(caller, {
          articleId: f.articleId,
        });
        await expect(
          f.app.confirmAuthoringContext(caller, result.observation),
        ).resolves.toBeUndefined();
      }
      await expect(
        f.app.getAuthoringContext(f.agent, {
          articleId: f.articleId,
          includeEvidence: true,
        }),
      ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      expect(f.agent.permissions).toHaveLength(3);
    });

    it("rejects unknown fields and explicit undefined instead of silently selecting a projection", async () => {
      const f = await evidenceReportsFixture(await createStore());
      for (const input of [
        { articleId: f.articleId, includeEvidence: undefined },
        { articleId: f.articleId, includeEvidence: "false" },
        { articleId: f.articleId, trustedAttesterIds: [] },
      ]) {
        const before = f.observed.reads.length;
        await expect(
          Reflect.apply(f.app.getAuthoringContext, f.app, [f.agent, input]),
        ).rejects.toBeInstanceOf(TypeError);
        expect(f.observed.reads).toHaveLength(before);
      }
    });

    it("returns the complete accepted evidence and retained revocations only with evidenceRead", async () => {
      const f = await evidenceReportsFixture(await createStore());
      await f.completeChecks();
      const accepted = await f.app.getEvidence(f.reviewer, {
        articleId: f.articleId,
      });
      const first = accepted.evidence[0];
      if (first === undefined)
        throw new Error("Expected actual accepted evidence.");
      await f.app.revokeEvidence(f.reviewer, {
        ...f.command("revoke-for-projection", accepted.generation),
        articleId: f.articleId,
        articleRevision: first.articleRevision,
        evidenceId: first.id,
        evidenceVersion: first.version,
        evidenceHash: first.hash,
        reason: "Synthetic independent revocation",
      });
      const expected = await f.app.getEvidence(f.reviewer, {
        articleId: f.articleId,
      });
      const projected = await f.app.getAuthoringContext(f.reviewer, {
        articleId: f.articleId,
        includeEvidence: true,
      });
      expect(projected.context.evidence).toEqual(expected);
      expect(projected.context.evidence?.evidence).toHaveLength(2);
      expect(projected.context.evidence?.revokedEvidence).toHaveLength(1);
      const restricted = access(
        f.reviewer.principalId,
        f.reviewer.permissions.filter(
          (permission) => permission !== knowledgePermissions.evidenceRead,
        ),
      );
      const before = f.observed.reads.length;
      await expect(
        f.app.confirmAuthoringContext(restricted, projected.observation),
      ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      expect(f.observed.reads).toHaveLength(before);
    });

    it("rejects forged, serialized, foreign-instance and wrong-actor handles before storage", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const result = await f.app.getAuthoringContext(f.agent, {
        articleId: f.articleId,
      });
      const foreign = createKnowledgeBaseApplication({
        store: f.observed.store,
        clock: f.clock,
      });
      const before = f.observed.reads.length;
      await expect(
        Reflect.apply(f.app.confirmAuthoringContext, f.app, [f.agent, {}]),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        f.app.confirmAuthoringContext(
          f.agent,
          structuredClone(result.observation),
        ),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        foreign.confirmAuthoringContext(f.agent, result.observation),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        f.app.confirmAuthoringContext(f.otherAgent, result.observation),
      ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      expect(f.observed.reads).toHaveLength(before);
    });

    it("consumes an observation before its first awaited read, including overlapping confirmation", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const { observation } = await f.app.getAuthoringContext(f.agent, {
        articleId: f.articleId,
      });
      const gate = reportBarrier();
      f.observed.beforeRead(async () => {
        f.observed.beforeRead(undefined);
        await gate.wait();
      });
      const pending = f.app.confirmAuthoringContext(f.agent, observation);
      await gate.reached(pending);
      try {
        const before = f.observed.reads.length;
        await expect(
          f.app.confirmAuthoringContext(f.agent, observation),
        ).rejects.toBeInstanceOf(TypeError);
        expect(f.observed.reads).toHaveLength(before);
      } finally {
        gate.release();
      }
      await pending;
      await expect(
        f.app.confirmAuthoringContext(f.agent, observation),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it.each(["article", "collection", "validation"] as const)(
      "refuses a changed %s head and never retries an ambiguous observation",
      async (kind) => {
        const f = await evidenceReportsFixture(await createStore());
        const result = await f.app.getAuthoringContext(f.agent, {
          articleId: f.articleId,
        });
        if (kind === "article") await f.updateDraft();
        else if (kind === "collection")
          await f.configure({ expectedStagingBuildId: "changed-build" });
        else {
          const policyId = result.context.requirements.validationPolicy.id;
          const current = await f.app.getValidationPolicy(f.owner, {
            policyId,
          });
          await f.app.putValidationPolicy(f.owner, {
            ...f.command("replace-validation-head", current.generation),
            policy: { ...current.policy, version: current.policy.version + 1 },
          });
        }
        await expect(
          f.app.confirmAuthoringContext(f.agent, result.observation),
        ).rejects.toBeInstanceOf(RepositoryConflictError);
        await expect(
          f.app.confirmAuthoringContext(f.agent, result.observation),
        ).rejects.toBeInstanceOf(TypeError);
      },
    );

    it("detects an opaque head-version change even when numeric generation and payload are unchanged", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const result = await f.app.getAuthoringContext(f.agent, {
        articleId: f.articleId,
      });
      const row = (await allKnowledgeRows(f.backing)).find(
        (value) => value.resourceId === f.articleId && value.kind === "head",
      );
      if (row === undefined) throw new Error("Expected the real article head.");
      const records = f.backing.collection(knowledgeRecords);
      const saved = await records.getVersioned({
        partition: row.partition,
        id: row.id,
      });
      if (saved === null) throw new Error("Expected a versioned real head.");
      expect(await records.putIfUnchanged(saved.value, saved.version)).toBe(
        true,
      );
      await expect(
        f.app.confirmAuthoringContext(f.agent, result.observation),
      ).rejects.toBeInstanceOf(RepositoryConflictError);
    });

    it("rejects an edit during the initial governed read instead of returning mixed current facts", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const row = (await allKnowledgeRows(f.backing)).find(
        (value) => value.resourceId === f.articleId && value.kind === "head",
      );
      if (row === undefined) throw new Error("Expected the real article head.");
      let observations = 0;
      f.observed.beforeRead(async ({ key }) => {
        if (key.partition !== row.partition || key.id !== "head") return;
        observations += 1;
        if (observations !== 2) return;
        f.observed.beforeRead(undefined);
        await f.updateDraft();
      });
      await expect(
        f.app.getAuthoringContext(f.agent, { articleId: f.articleId }),
      ).rejects.toBeInstanceOf(RepositoryConflictError);
      expect(observations).toBe(2);
    });

    it("rejects a missing referenced immutable revision without changing any records", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const row = (await allKnowledgeRows(f.backing)).find(
        (value) =>
          value.resourceId === f.articleId && value.kind === "revision",
      );
      if (row === undefined)
        throw new Error("Expected the real immutable revision.");
      const records = f.backing.collection(knowledgeRecords);
      const saved = await records.getVersioned({
        partition: row.partition,
        id: row.id,
      });
      if (saved === null) throw new Error("Expected actual immutable storage.");
      expect(
        await records.deleteIfUnchanged(
          { partition: row.partition, id: row.id },
          saved.version,
        ),
      ).toBe(true);
      const before = f.observed.transactions.length;
      await expect(
        f.app.getAuthoringContext(f.agent, { articleId: f.articleId }),
      ).rejects.toBeInstanceOf(RepositoryIntegrityError);
      expect(f.observed.transactions).toHaveLength(before);
    });

    it.each(["evidence", "revocation"] as const)(
      "refuses missing referenced %s facts instead of returning an incomplete EvidenceDto",
      async (kind) => {
        const f = await evidenceReportsFixture(await createStore());
        await f.completeChecks();
        if (kind === "revocation") {
          const accepted = await f.app.getEvidence(f.reviewer, {
            articleId: f.articleId,
          });
          const first = accepted.evidence[0];
          if (first === undefined)
            throw new Error("Expected actual accepted evidence.");
          await f.app.revokeEvidence(f.reviewer, {
            ...f.command("revoke-missing-fact", accepted.generation),
            articleId: f.articleId,
            articleRevision: first.articleRevision,
            evidenceId: first.id,
            evidenceVersion: first.version,
            evidenceHash: first.hash,
            reason: "Synthetic missing-marker test",
          });
        }
        const row = (await allKnowledgeRows(f.backing)).find(
          (value) => value.resourceId === f.articleId && value.kind === kind,
        );
        if (row === undefined)
          throw new Error("Expected the real referenced immutable fact.");
        const records = f.backing.collection(knowledgeRecords);
        const key = { partition: row.partition, id: row.id };
        const saved = await records.getVersioned(key);
        if (saved === null)
          throw new Error("Expected the referenced fact in real storage.");
        expect(await records.deleteIfUnchanged(key, saved.version)).toBe(true);
        const before = f.observed.transactions.length;
        await expect(
          f.app.getAuthoringContext(f.reviewer, {
            articleId: f.articleId,
            includeEvidence: true,
          }),
        ).rejects.toBeInstanceOf(RepositoryIntegrityError);
        expect(f.observed.transactions).toHaveLength(before);
      },
    );
  });
}
