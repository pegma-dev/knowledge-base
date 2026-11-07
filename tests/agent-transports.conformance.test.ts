import { knowledgeAgentToolNames } from "@pegma/knowledge-base-mcp";
import { describe, expect, it } from "vitest";
import {
  admin,
  author,
  draft,
  evidence,
} from "../test/application-fixtures.js";
import {
  agentChannels,
  agentFixture,
  agentResult,
  expectPrivateAgentError,
} from "../test/agent-fixtures.js";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import { traceStore } from "../test/trace-store.js";

for (const [backend, createStore] of storeFactories) {
  describe(`KB agent HTTP/MCP public conformance (${backend})`, () => {
    for (const channel of agentChannels) {
      it(`${channel} authors, checks and submits verified evidence with cross-transport replay`, async () => {
        const f = agentFixture(await createStore());
        await f.setupCollection();
        const other = channel === "HTTP" ? "MCP" : "HTTP";
        const create = {
          ...f.command("agent-create", 0),
          correlationId: "synthetic-agent-request-123",
          articleId: "article/agent-export",
          collectionId: "collection/workshop",
          draft: draft(),
        };
        const created = agentResult(
          await f.call(channel, "createDraft", create),
          "createDraft",
        );
        expect(created).toMatchObject({
          replayed: false,
          value: {
            id: create.articleId,
            generation: 1,
            articleRevision: 1,
            state: "draft",
          },
        });
        let current = agentResult(
          await f.call(channel, "getDraft", { articleId: create.articleId }),
          "getDraft",
        );
        expect(current.revision.createdBy).toBe(author.principalId);
        expect(current.revision.content).toEqual(create.draft.content);
        expect(
          agentResult(
            await f.call(other, "getDraft", { articleId: create.articleId }),
            "getDraft",
          ),
        ).toEqual(current);
        f.setTime(2_000);
        const update = {
          ...f.command("agent-edit", current.generation),
          articleId: current.articleId,
          collectionId: current.revision.collectionId,
          draft: { ...draft(), title: "Export a fictional workspace safely" },
        };
        const updated = agentResult(
          await f.call(channel, "updateDraft", update),
          "updateDraft",
        );
        expect(updated.value).toMatchObject({
          generation: 2,
          articleRevision: 2,
        });
        expect(updated.value.contentHash).not.toBe(created.value.contentHash);
        expectPrivateAgentError(
          await f.call(other, "updateDraft", {
            ...update,
            ...f.command("stale-edit", 1),
          }),
          "conflict",
        );
        const requirementsInput = {
          collectionId: create.collectionId,
          kind: "explanation",
        };
        const requirements = agentResult(
          await f.call(channel, "getValidationRequirements", requirementsInput),
          "getValidationRequirements",
        );
        expect(requirements).toMatchObject({
          expectedStagingBuildId: "staging-42",
          checks: [
            {
              id: "explanation-content",
              testKind: "content",
              maxAgeMilliseconds: 60_000,
            },
          ],
        });
        expect(
          agentResult(
            await f.call(other, "getValidationRequirements", requirementsInput),
            "getValidationRequirements",
          ),
        ).toEqual(requirements);
        expect(JSON.stringify(requirements)).not.toMatch(
          /trustedRunnerIds|trustedAttesterIds|staff\/verifier|runner\/staging/u,
        );

        current = agentResult(
          await f.call(channel, "getDraft", { articleId: create.articleId }),
          "getDraft",
        );
        f.setTime(4_000);
        const issued = await f.issueReceipt(current);
        const submit = {
          ...f.command("agent-evidence", current.generation),
          articleId: current.articleId,
          evidence: issued.submission,
          receipt: issued.receipt,
        };
        const submitted = agentResult(
          await f.call(channel, "submitEvidence", submit),
          "submitEvidence",
        );
        expect(submitted.value).toMatchObject({
          generation: 3,
          articleRevision: 2,
        });
        const committed = await allKnowledgeRows(f.store);
        expect(
          agentResult(
            await f.call(other, "submitEvidence", submit),
            "submitEvidence",
          ),
        ).toEqual({ ...submitted, replayed: true });
        // Correlation is request tracing metadata. It neither changes the
        // original semantic command nor permits a second state transition.
        const replayedCreate = agentResult(
          await f.call(other, "createDraft", {
            ...create,
            correlationId: "synthetic-retry-request-456",
          }),
          "createDraft",
        );
        expect(replayedCreate).toEqual({ ...created, replayed: true });
        expect(Object.keys(replayedCreate.value).sort()).toEqual([
          "articleRevision",
          "contentHash",
          "generation",
          "id",
          "state",
        ]);
        expectPrivateAgentError(
          await f.call(other, "createDraft", {
            ...create,
            draft: { ...create.draft, title: "PRIVATE_CHANGED_COMMAND" },
          }),
          "conflict",
        );
        expect(await allKnowledgeRows(f.store)).toEqual(committed);
        const articleRows = committed.filter(
          (row) => row.resourceId === create.articleId,
        );
        expect(
          articleRows.filter((row) => row.kind === "revision"),
        ).toHaveLength(2);
        expect(
          articleRows.filter((row) => row.kind === "evidence"),
        ).toHaveLength(1);
        expect(
          articleRows.filter((row) => row.kind === "command"),
        ).toHaveLength(3);
        expect(
          articleRows
            .filter((row) => row.kind === "audit")
            .map((row) => row.data),
        ).toContainEqual(
          expect.objectContaining({
            details: expect.objectContaining({
              correlationId: create.correlationId,
            }),
          }),
        );

        current = await f.app.getDraft(author, { articleId: create.articleId });
        current = await f.setSources(current, [
          {
            id: "source/private",
            system: "synthetic-support",
            resourceId: "PRIVATE_SOURCE_TICKET_7",
            version: "2",
          },
        ]);
        await f.review(current);
        const visible = agentResult(
          await f.call(other, "getDraft", { articleId: create.articleId }),
          "getDraft",
        );
        expect(visible.hasPendingReview).toBe(true);
        expect(visible.revision.createdBy).toBe(author.principalId);
        for (const privateValue of [
          "PRIVATE_SOURCE_TICKET_7",
          "PRIVATE_STAFF_EVIDENCE",
          "staff/verifier",
          issued.receipt,
          "attestation",
          "reviewerId",
          "sourceSnapshot",
        ])
          expect(JSON.stringify(visible)).not.toContain(privateValue);
        expect(await (await f.sdk()).listTools()).toMatchObject({
          tools: expect.arrayContaining(
            Object.values(knowledgeAgentToolNames).map((name) =>
              expect.objectContaining({ name }),
            ),
          ),
        });
        expect((await (await f.sdk()).listTools()).tools).toHaveLength(5);
        for (const response of f.responses) {
          expect(response.headers.get("Mcp-Session-Id")).toBeNull();
          expect(response.headers.get("Cache-Control")).toBe("no-store");
        }
      });
    }

    it("replays a committed evidence command after the backing store loses its acknowledgement", async () => {
      const backing = await createStore();
      const traced = traceStore(backing);
      const f = agentFixture(traced.store);
      await f.setupCollection();
      const current = await f.createDraft();
      f.setTime(3_000);
      const issued = await f.issueReceipt(current);
      const input = {
        ...f.command("uncertain-evidence", current.generation),
        articleId: current.articleId,
        evidence: issued.submission,
        receipt: issued.receipt,
      };
      let lost = false;
      traced.intercept(async (transaction, commit) => {
        const outcome = await commit();
        if (
          !lost &&
          transaction.partition.startsWith("article:") &&
          outcome.committed
        ) {
          lost = true;
          throw new Error("PRIVATE_CONNECTION_LOST_AFTER_COMMIT");
        }
        return outcome;
      });
      expectPrivateAgentError(
        await f.call("HTTP", "submitEvidence", input),
        "unavailable",
      );
      expect(lost).toBe(true);
      traced.intercept(undefined);
      const committed = await allKnowledgeRows(backing);
      const replay = agentResult(
        await f.call("MCP", "submitEvidence", input),
        "submitEvidence",
      );
      expect(replay).toMatchObject({
        replayed: true,
        value: { generation: 2, articleRevision: 1 },
      });
      expect(f.verify).toHaveBeenCalledOnce();
      expect(await allKnowledgeRows(backing)).toEqual(committed);
      expect(
        (await f.app.getEvidence(admin, { articleId: current.articleId }))
          .evidence,
      ).toHaveLength(1);
      // A replay receipt is an acknowledgement, never restored read authority.
      f.authority.current = { ...f.authority.current, scopes: [] };
      expectPrivateAgentError(
        await f.call("HTTP", "submitEvidence", input),
        "forbidden",
      );
      expect(await allKnowledgeRows(backing)).toEqual(committed);
    });

    it("requires independently verified actor, revision, content, runner, build and freshness bindings", async () => {
      const f = agentFixture(await createStore());
      await f.setupCollection();
      const current = await f.createDraft();
      f.setTime(3_000);
      const submitted = evidence(current.revision);
      const defects = [
        {
          name: "revision",
          code: "conflict",
          submission: { ...submitted, articleRevision: 2 },
        },
        {
          name: "hash",
          code: "prerequisite",
          submission: { ...submitted, contentHash: "b".repeat(64) },
        },
        {
          name: "build",
          code: "prerequisite",
          submission: { ...submitted, stagingBuildId: "PRIVATE_WRONG_BUILD" },
        },
        {
          name: "runner",
          code: "prerequisite",
          submission: { ...submitted, runnerId: "runner/PRIVATE_UNTRUSTED" },
        },
        {
          name: "predates draft",
          code: "prerequisite",
          submission: { ...submitted, executedAt: "2026-11-06T19:58:00.000Z" },
        },
        { name: "stale", code: "prerequisite", submission: submitted },
        { name: "unverified", code: "prerequisite", submission: submitted },
        { name: "other actor", code: "prerequisite", submission: submitted },
      ];
      const before = await allKnowledgeRows(f.store);
      for (const defect of defects) {
        f.setTime(defect.name === "stale" ? 120_000 : 3_000);
        const issued = await f.issueReceipt(
          current,
          defect.submission,
          defect.name === "other actor" ? admin : author,
        );
        const input = {
          ...f.command(
            `rejected-evidence-${defect.name.replaceAll(" ", "-")}`,
            current.generation,
          ),
          articleId: current.articleId,
          evidence: issued.submission,
          receipt:
            defect.name === "unverified"
              ? "PRIVATE_FORGED_RECEIPT"
              : issued.receipt,
        };
        for (const channel of agentChannels)
          expectPrivateAgentError(
            await f.call(channel, "submitEvidence", input),
            defect.code,
          );
      }
      expect(await allKnowledgeRows(f.store)).toEqual(before);
      expect(
        (await f.app.getEvidence(admin, { articleId: current.articleId }))
          .evidence,
      ).toEqual([]);
      f.setTime(3_000);
      const legitimate = await f.issueReceipt(current);
      expect(
        agentResult(
          await f.call("MCP", "submitEvidence", {
            ...f.command("bound-evidence", current.generation),
            articleId: current.articleId,
            evidence: legitimate.submission,
            receipt: legitimate.receipt,
          }),
          "submitEvidence",
        ).value.generation,
      ).toBe(2);
    });
  });
}
