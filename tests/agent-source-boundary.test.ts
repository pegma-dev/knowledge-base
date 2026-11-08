import type { PrivateSourceReference } from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import {
  knowledgeAgentScopes,
  type KnowledgeAgentInputMap,
  type KnowledgeAgentOperation,
} from "@pegma/knowledge-base-mcp";
import { createMemoryStore } from "@pegma/storage-core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { admin, author, draft } from "../test/application-fixtures.js";
import {
  agentChannels,
  agentFixture,
  agentIdentity,
  agentResult,
  expectPrivateAgentError,
} from "../test/agent-fixtures.js";
import { allKnowledgeRows } from "../test/application-stores.js";
import { traceStore } from "../test/trace-store.js";

const source: PrivateSourceReference = {
  id: "source/private",
  system: "synthetic-support",
  resourceId: "PRIVATE_SOURCE_TICKET_7",
  version: "resolution-2",
};

describe("initial agent provenance boundary", () => {
  it("keeps host-only source delivery out of agent authoring input types", () => {
    expectTypeOf<keyof KnowledgeAgentInputMap["createDraft"]>()
      .extract<"sourceReferences">()
      .toBeNever();
    expectTypeOf<keyof KnowledgeAgentInputMap["updateDraft"]>()
      .extract<"sourceReferences">()
      .toBeNever();
  });

  for (const channel of ["dispatcher", ...agentChannels] as const) {
    it(`${channel} rejects source delivery before mutation while ordinary draft authoring preserves provenance`, async () => {
      const traced = traceStore(createMemoryStore());
      const f = agentFixture(traced.store);
      await f.setupCollection();
      // A broader host context and an unregistered requested scope still cannot
      // widen the five initial operations into provenance authoring.
      f.authority.current = {
        ...agentIdentity(),
        access: admin,
        scopes: [
          ...Object.values(knowledgeAgentScopes),
          knowledgePermissions.provenanceWrite,
        ],
      };
      const call = (operation: KnowledgeAgentOperation, input: unknown) =>
        channel === "dispatcher"
          ? f.dispatcher.dispatch(f.authority.current, {
              apiVersion: "1",
              operation,
              input,
            })
          : f.call(channel, operation, input);
      const create = {
        ...f.command("agent-create", 0),
        articleId: "article/agent-export",
        collectionId: "collection/workshop",
        draft: draft(),
      };
      const beforeCreate = await allKnowledgeRows(f.store);
      const createTransactions = traced.transactions.length;
      for (const sourceReferences of [[source], []]) {
        expectPrivateAgentError(
          await call("createDraft", { ...create, sourceReferences }),
          "invalid_request",
        );
        expect(traced.transactions).toHaveLength(createTransactions);
        expect(await allKnowledgeRows(f.store)).toEqual(beforeCreate);
      }
      expect(
        agentResult(await call("createDraft", create), "createDraft"),
      ).toMatchObject({
        replayed: false,
        value: { generation: 1, articleRevision: 1 },
      });
      let current = await f.app.getDraft(author, {
        articleId: create.articleId,
      });
      current = await f.setSources(current, [source]);
      const provenance = await f.app.getProvenance(admin, {
        articleId: current.articleId,
      });
      const update = {
        ...f.command("agent-update", current.generation),
        articleId: current.articleId,
        collectionId: current.revision.collectionId,
        draft: { ...draft(), title: "Export a fictional workspace safely" },
      };
      const beforeUpdate = await allKnowledgeRows(f.store);
      const updateTransactions = traced.transactions.length;
      for (const sourceReferences of [[{ ...source, version: "3" }], []]) {
        expectPrivateAgentError(
          await call("updateDraft", { ...update, sourceReferences }),
          "invalid_request",
        );
        expect(traced.transactions).toHaveLength(updateTransactions);
        expect(await allKnowledgeRows(f.store)).toEqual(beforeUpdate);
      }
      expect(
        agentResult(await call("updateDraft", update), "updateDraft"),
      ).toMatchObject({
        replayed: false,
        value: {
          generation: current.generation + 1,
          articleRevision: 2,
        },
      });
      const visible = agentResult(
        await call("getDraft", { articleId: current.articleId }),
        "getDraft",
      );
      expect(visible.revision.title).toBe(update.draft.title);
      expect(JSON.stringify(visible)).not.toContain(source.resourceId);
      expect(
        (
          await f.app.getProvenance(admin, {
            articleId: current.articleId,
          })
        ).snapshot,
      ).toEqual(provenance.snapshot);
    });
  }
});
