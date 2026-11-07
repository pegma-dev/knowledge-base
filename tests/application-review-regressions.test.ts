import {
  createKnowledgeBaseApplication,
  type UpdateCollectionPolicyInput,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import { describe, expect, it } from "vitest";
import {
  access,
  admin,
  applicationFixture,
  at,
  author,
  customer,
  draft,
  validationPolicy,
} from "../test/application-fixtures.js";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import { barrier, traceStore } from "../test/trace-store.js";

for (const [name, createStore] of storeFactories) {
  describe(`KB application review regressions (${name})`, () => {
    it("denies collection, validation, governance and review metadata reads without their staff permissions", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      const current = (await f.submitEvidence(await f.createDraft())).current;
      await f.review(current);
      const reader = access(customer.principalId, [
        knowledgePermissions.articleRead,
      ]);
      const reads = [
        [
          () =>
            f.app.getCollection(reader, {
              collectionId: "collection/workshop",
            }),
          knowledgePermissions.collectionRead,
        ],
        [
          () =>
            f.app.getValidationPolicy(reader, {
              policyId: validationPolicy.id,
            }),
          knowledgePermissions.validationManage,
        ],
        [
          () =>
            f.app.getGovernanceConfiguration(reader, {
              collectionId: "collection/workshop",
            }),
          knowledgePermissions.validationManage,
        ],
        [
          () => f.app.getReview(reader, { articleId: current.articleId }),
          knowledgePermissions.review,
        ],
      ] as const;
      const before = await allKnowledgeRows(f.store);
      for (const [read, permission] of reads)
        await expect(read()).rejects.toMatchObject({
          name: "KnowledgeBaseAuthorizationError",
          permission,
        });
      expect(await allKnowledgeRows(f.store)).toEqual(before);
    });

    it.each(["article", "governance"] as const)(
      "maps a stored %s partition exceeding the reader capacity to generic article unavailability",
      async (path) => {
        const store = createStore();
        const f = applicationFixture(store);
        await f.setupCollection();
        if (path === "governance") {
          for (let ordinal = 0; ordinal < 3; ordinal += 1) {
            const configuration = await f.app.getGovernanceConfiguration(
              admin,
              {
                collectionId: "collection/workshop",
              },
            );
            await f.app.putGovernanceConfiguration(admin, {
              ...f.command("grow-governance-history", configuration.generation),
              collectionId: configuration.collectionId,
              configuration: configuration.configuration,
            });
          }
        }
        await f.publishedArticle();
        const before = await allKnowledgeRows(store);
        const articleRows = before.filter(
          (row) => row.resourceKind === "article",
        ).length;
        const collectionRows = before.filter(
          (row) => row.resourceKind === "collection",
        ).length;
        if (path === "governance")
          expect(collectionRows).toBeGreaterThan(articleRows);
        const reader = createKnowledgeBaseApplication({
          store,
          clock: { now: () => at(10_000) },
          limits: {
            maxPhysicalRows: articleRows - (path === "article" ? 1 : 0),
            controlReserveRows: 0,
          },
        });
        await expect(
          reader.getPublishedArticle(customer, { articleId: "article/export" }),
        ).rejects.toMatchObject({
          name: "KnowledgeBaseNotFoundError",
          resource: "article",
        });
        expect(await allKnowledgeRows(store)).toEqual(before);
      },
    );

    it.each([
      "missing policy",
      "missing uses",
      "missing bot",
      "null portal",
      "missing enabled audience",
      "null enabled audience",
    ] as const)(
      "deliberately rejects a malformed policy preview: %s",
      async (defect) => {
        const f = applicationFixture(createStore());
        await f.setupCollection();
        const proposed = await f.app.previewCollectionPolicy(admin, {
          collectionId: "collection/workshop",
          uses: {
            portal: {
              enabled: true,
              audience: { kind: "permission", permission: "workshop.customer" },
            },
            bot: { enabled: false },
          },
        });
        const { policy, ...outer } = proposed.preview;
        const malformed = {
          "missing policy": outer,
          "missing uses": { ...outer, policy: { version: policy.version } },
          "missing bot": {
            ...outer,
            policy: { version: policy.version, portal: policy.portal },
          },
          "null portal": { ...outer, policy: { ...policy, portal: null } },
          "missing enabled audience": {
            ...outer,
            policy: { ...policy, portal: { enabled: true } },
          },
          "null enabled audience": {
            ...outer,
            policy: { ...policy, portal: { enabled: true, audience: null } },
          },
        };
        const before = await allKnowledgeRows(f.store);
        // Exercise the host's runtime JSON boundary beyond static TypeScript checks.
        const input = {
          ...f.command("malformed-preview", proposed.generation),
          collectionId: "collection/workshop",
          preview: malformed[defect],
        } as UpdateCollectionPolicyInput;
        await expect(
          f.app.updateCollectionPolicy(admin, input),
        ).rejects.toMatchObject({
          name: "TypeError",
          message: expect.not.stringMatching(/Cannot (?:read|convert)/u),
        });
        expect(await allKnowledgeRows(f.store)).toEqual(before);
      },
    );

    it("rejects validation policy generation changed while governance was loading", async () => {
      const backing = createStore();
      const administrator = applicationFixture(backing);
      await administrator.setupCollection();
      const traced = traceStore(backing);
      const delayed = applicationFixture(traced.store);
      const gate = barrier();
      let paused = false;
      traced.beforeGet(async ({ key }) => {
        if (
          !paused &&
          key.partition.startsWith("validation:") &&
          key.id === "policy:1"
        ) {
          paused = true;
          await gate.wait();
        }
      });
      const pending = delayed.app
        .createDraft(author, {
          ...delayed.command("governance-race", 0),
          articleId: "article/governance-race",
          collectionId: "collection/workshop",
          draft: draft(),
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      let committedRows;
      try {
        await Promise.race([
          gate.reached,
          pending.then(() => {
            throw new Error("Draft did not reach its validation read barrier");
          }),
        ]);
        const current = await administrator.app.getValidationPolicy(admin, {
          policyId: validationPolicy.id,
        });
        await administrator.app.putValidationPolicy(admin, {
          ...administrator.command("concurrent-policy", current.generation),
          policy: { ...validationPolicy, version: 2 },
        });
        committedRows = await allKnowledgeRows(backing);
      } finally {
        gate.release();
      }
      const settled = await pending;
      traced.beforeGet(undefined);
      expect(settled).toMatchObject({
        error: { name: "RepositoryConflictError" },
      });
      expect(await allKnowledgeRows(backing)).toEqual(committedRows);
      expect(traced.transactions).toHaveLength(0);
    }, 30_000);
  });
}
