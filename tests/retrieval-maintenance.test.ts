import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import { createKnowledgeBaseApplication } from "@pegma/knowledge-base-application";
import { describe, expect, it } from "vitest";
import { admin, at, author, customer } from "../test/application-fixtures.js";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import {
  allRetrievalRows,
  countSyntheticTokens,
  indexAdministrator,
  retrievalFixture,
  retrievalGuides,
} from "../test/retrieval-fixtures.js";
import { barrier } from "../test/trace-store.js";

for (const [name, createStore] of storeFactories) {
  describe(`bounded retrieval maintenance (${name})`, () => {
    it("requires staff index authority for repair, status and physical scan operations", async () => {
      const f = retrievalFixture(createStore());
      for (const operation of [
        () =>
          f.app.repairArticleIndex(customer, { articleId: "article/export" }),
        () =>
          f.app.getArticleIndexStatus(customer, {
            articleId: "article/export",
          }),
        () => f.app.repairRetrievalPage(customer, { limit: 3 }),
      ])
        await expect(operation()).rejects.toMatchObject({
          permission: knowledgePermissions.indexManage,
        });
      expect(f.traced.reads).toEqual([]);
      expect(f.traced.enumerations).toEqual([]);
      expect(f.traced.transactions).toEqual([]);
    });

    it("repairs missed work through bounded physical scan pages and opaque continuation", async () => {
      const backing = createStore();
      const f = retrievalFixture(backing);
      await f.setupCollection();
      await f.publishedArticle(
        "article/export",
        "collection/workshop",
        retrievalGuides[0]!.draft,
      );
      expect(
        await f.app.getArticleIndexStatus(indexAdministrator, {
          articleId: "article/export",
        }),
      ).toMatchObject({ status: "pending", indexed: false });
      expect(
        (await f.app.searchPublishedArticles(customer, f.portalInput()))
          .articles,
      ).toEqual([]);
      const authoritativeRows = await allKnowledgeRows(backing);
      let physicalRows = 0;
      let completedCycles = 0;
      let indexed = false;
      f.clearObservations();
      for (let cycle = 0; cycle < 8 && !indexed; cycle += 1) {
        let cursor: string | undefined;
        let completed = false;
        const cursors = new Set<string>();
        for (let page = 0; page < 128; page += 1) {
          const result = await f.app.repairRetrievalPage(indexAdministrator, {
            limit: 3,
            ...(cursor === undefined ? {} : { cursor }),
          });
          expect(result.physicalRows).toBeLessThanOrEqual(3);
          expect(result.candidates).toBeLessThanOrEqual(result.physicalRows);
          physicalRows += result.physicalRows;
          if (result.nextCursor === null) {
            completed = true;
            completedCycles += 1;
            break;
          }
          expect(cursors.has(result.nextCursor)).toBe(false);
          cursors.add(result.nextCursor);
          cursor = result.nextCursor;
        }
        expect(completed).toBe(true);
        indexed = (
          await f.app.getArticleIndexStatus(indexAdministrator, {
            articleId: "article/export",
          })
        ).indexed;
      }
      expect(indexed).toBe(true);
      expect(physicalRows).toBe(authoritativeRows.length * completedCycles);
      expect(
        f.traced.enumerations.filter((call) => call.method !== "scan"),
      ).toEqual([]);
      expect(
        f.traced.enumerations.every(
          (call) => call.collection === "knowledge-base.records.v1",
        ),
      ).toBe(true);
      expect(
        await f.app.getArticleIndexStatus(indexAdministrator, {
          articleId: "article/export",
        }),
      ).toMatchObject({ status: "ready", indexed: true });
      expect(
        (await f.app.searchPublishedArticles(customer, f.portalInput()))
          .articles[0]?.articleId,
      ).toBe("article/export");
    }, 30_000);

    it("makes repeated repair idempotent without adding projection history", async () => {
      const backing = createStore();
      const f = retrievalFixture(backing);
      await f.setupCollection();
      await f.publishGuide();
      const before = await allRetrievalRows(backing);
      const first = await f.app.getArticleIndexStatus(indexAdministrator, {
        articleId: "article/export",
      });
      for (let delivery = 0; delivery < 3; delivery += 1)
        expect(await f.repair("article/export")).toEqual(first);
      expect(await allRetrievalRows(backing)).toEqual(before);
    }, 30_000);

    it("withdraws retirement immediately and converges stale projection cleanup", async () => {
      const f = retrievalFixture(createStore());
      await f.setupCollection();
      const published = await f.publishGuide();
      await f.authoringApp.retireArticle(indexAdministrator, {
        ...f.command("retire-indexed", published.current.generation),
        articleId: "article/export",
      });
      expect(
        (await f.app.searchPublishedArticles(customer, f.portalInput()))
          .articles,
      ).toEqual([]);
      expect(await f.repair("article/export")).toMatchObject({
        status: "ready",
        indexed: false,
      });
      expect(await f.repair("article/export")).toMatchObject({
        status: "ready",
        indexed: false,
      });
      expect(
        (await f.app.searchPublishedArticles(customer, f.portalInput()))
          .articles,
      ).toEqual([]);
    }, 30_000);

    it("moves a newly approved revision while cleaning its old collection scope", async () => {
      const f = retrievalFixture(createStore());
      await f.setupCollection();
      await f.setupCollection("collection/new-workshop");
      const old = await f.publishGuide();
      await f.authoringApp.updateDraft(author, {
        ...f.command("move-for-review", old.current.generation),
        articleId: "article/export",
        collectionId: "collection/new-workshop",
        draft: retrievalGuides[0]!.draft,
      });
      let current = await f.app.getDraft(author, {
        articleId: "article/export",
      });
      current = (await f.submitEvidence(current)).current;
      await f.publish(current);
      await f.repair("article/export");
      expect(
        (await f.app.searchPublishedArticles(customer, f.portalInput()))
          .articles,
      ).toEqual([]);
      const destination = await f.app.searchPublishedArticles(customer, {
        ...f.portalInput(),
        collectionId: "collection/new-workshop",
      });
      expect(destination.articles[0]).toMatchObject({
        articleId: "article/export",
        collectionId: "collection/new-workshop",
        revision: 2,
      });
    }, 30_000);

    it("keeps capacity failure visible while authoritative content remains intact", async () => {
      const backing = createStore();
      const f = retrievalFixture(backing, {
        limits: { maxIndexPartitionRows: 2 },
      });
      await f.setupCollection();
      await f.publishedArticle(
        "article/export",
        "collection/workshop",
        retrievalGuides[0]!.draft,
      );
      const before = await allKnowledgeRows(backing);
      const status = await f.repair("article/export");
      expect(status).toMatchObject({
        articleId: "article/export",
        status: "blocked",
        indexed: false,
        reason: "capacity",
      });
      expect(
        await f.app.getArticleIndexStatus(indexAdministrator, {
          articleId: "article/export",
        }),
      ).toMatchObject({
        status: "blocked",
        indexed: false,
        reason: "capacity",
      });
      expect(await allKnowledgeRows(backing)).toEqual(before);
      expect(
        (
          await f.app.getPublishedArticle(customer, {
            articleId: "article/export",
          })
        ).title,
      ).toBe(retrievalGuides[0]!.draft.title);
    }, 30_000);

    it("replaces a withdrawn policy epoch only after approving a revision under the new audience", async () => {
      const f = retrievalFixture(createStore());
      await f.setupCollection();
      const old = await f.publishGuide();
      const before = await f.app.getCollection(admin, {
        collectionId: "collection/workshop",
      });
      for (const enabled of [false, true]) {
        const preview = await f.authoringApp.previewCollectionPolicy(admin, {
          collectionId: "collection/workshop",
          uses: enabled
            ? {
                portal: {
                  enabled: true,
                  audience: {
                    kind: "permission",
                    permission: "workshop.customer",
                  },
                },
                bot: {
                  enabled: true,
                  audience: {
                    kind: "permission",
                    permission: "workshop.customer",
                  },
                },
              }
            : { portal: { enabled: false }, bot: { enabled: false } },
        });
        await f.authoringApp.updateCollectionPolicy(admin, {
          ...f.command("new-policy-epoch", preview.generation),
          collectionId: "collection/workshop",
          preview: preview.preview,
        });
        expect(
          (await f.app.searchPublishedArticles(customer, f.portalInput()))
            .articles,
        ).toEqual([]);
        expect(await f.repair("article/export")).toMatchObject({
          status: "ready",
          indexed: false,
        });
      }
      await f.authoringApp.updateDraft(author, {
        ...f.command("reapprove-policy", old.current.generation),
        articleId: "article/export",
        collectionId: "collection/workshop",
        draft: retrievalGuides[0]!.draft,
      });
      let current = await f.app.getDraft(author, {
        articleId: "article/export",
      });
      current = (await f.submitEvidence(current)).current;
      await f.publish(current);
      expect(await f.repair("article/export")).toMatchObject({
        status: "ready",
        indexed: true,
      });
      const visible = await f.app.searchPublishedArticles(
        customer,
        f.portalInput(),
      );
      expect(visible.articles).toHaveLength(1);
      expect(visible.articles[0]?.revision).toBe(2);
      expect(
        (
          await f.app.getCollection(admin, {
            collectionId: "collection/workshop",
          })
        ).collection.policy.version,
      ).toBeGreaterThan(before.collection.policy.version);
    }, 30_000);

    it("removes one article's shared-term postings without removing another approved guide", async () => {
      const f = retrievalFixture(createStore());
      await f.setupCollection();
      const first = await f.publishGuide({
        ...retrievalGuides[0]!,
        id: "article/export-a",
      });
      await f.publishGuide({ ...retrievalGuides[0]!, id: "article/export-b" });
      await f.authoringApp.retireArticle(indexAdministrator, {
        ...f.command("remove-shared-term", first.current.generation),
        articleId: "article/export-a",
      });
      expect(await f.repair("article/export-a")).toMatchObject({
        status: "ready",
        indexed: false,
      });
      expect(
        (
          await f.app.searchPublishedArticles(customer, f.portalInput())
        ).articles.map((entry) => entry.articleId),
      ).toEqual(["article/export-b"]);
    }, 30_000);

    it("persists resumable pending work when one maintenance batch is allowed", async () => {
      const backing = createStore();
      const f = retrievalFixture(backing, {
        limits: { maxMaintenanceBatches: 1 },
      });
      await f.setupCollection();
      await f.publishedArticle(
        "article/export",
        "collection/workshop",
        retrievalGuides[0]!.draft,
      );
      f.clearObservations();
      const pending = await f.app.repairArticleIndex(indexAdministrator, {
        articleId: "article/export",
      });
      expect(pending.status).toBe("pending");
      const indexTransactions = f.traced.transactions.filter(
        (call) => call.collection === "knowledge-base.retrieval.v1",
      );
      const advances = indexTransactions.filter((call) =>
        call.partition.startsWith("scope:"),
      );
      expect(advances).toHaveLength(1);
      const postingHeads = advances
        .flatMap((call) =>
          call.actions.map((action) =>
            action.action === "delete"
              ? action.key.id
              : (action.value as { readonly id: string }).id,
          ),
        )
        .filter((id) => id.startsWith("posting:"));
      expect(postingHeads.length).toBeGreaterThan(0);
      expect(postingHeads.length).toBeLessThanOrEqual(2);
      // One fresh plan, directory registration and catalog registration accompany
      // the bounded scope advance; they do not each consume another term batch.
      for (const family of ["article:", "catalog:", "scope:", "directory"])
        expect(
          indexTransactions.filter((call) => call.partition.startsWith(family))
            .length,
        ).toBeLessThanOrEqual(1);
      expect(indexTransactions).toHaveLength(f.traced.transactions.length);
      expect(indexTransactions.length).toBeLessThanOrEqual(4);
      expect(
        indexTransactions.every((call) => call.actions.length <= 100),
      ).toBe(true);
      expect(f.traced.enumerations).toEqual([]);
      const recovered = retrievalFixture(backing);
      expect(await recovered.repair("article/export")).toMatchObject({
        status: "ready",
        indexed: true,
      });
      expect(
        (
          await recovered.app.searchPublishedArticles(
            customer,
            recovered.portalInput(),
          )
        ).articles[0]?.articleId,
      ).toBe("article/export");
    }, 30_000);

    it.each(["article", "collection"] as const)(
      "reports blocked capacity when an existing authoritative %s partition exceeds a recomposed instance limit",
      async (resource) => {
        const backing = createStore();
        const f = retrievalFixture(backing);
        await f.setupCollection();
        if (resource === "collection") {
          for (let count = 0; count < 4; count += 1) {
            const configuration = await f.app.getGovernanceConfiguration(
              admin,
              {
                collectionId: "collection/workshop",
              },
            );
            await f.authoringApp.putGovernanceConfiguration(admin, {
              ...f.command(
                "grow-authoritative-history",
                configuration.generation,
              ),
              collectionId: configuration.collectionId,
              configuration: configuration.configuration,
            });
          }
        }
        let current = await f.createDraft(
          "article/export",
          "collection/workshop",
          retrievalGuides[0]!.draft,
        );
        current = await f.setSources(current, [
          {
            id: "source/private",
            system: "synthetic-support",
            resourceId: "PRIVATE_CAPACITY_SOURCE",
            version: "1",
          },
        ]);
        current = (await f.submitEvidence(current)).current;
        await f.publish(current);
        expect(await f.repair(current.articleId)).toMatchObject({
          status: "ready",
          indexed: true,
        });
        const before = await allKnowledgeRows(backing);
        const articleRows = before.filter(
          (row) => row.resourceKind === "article",
        ).length;
        if (resource === "collection")
          expect(
            before.filter((row) => row.resourceKind === "collection").length,
          ).toBeGreaterThan(articleRows);
        const limited = createKnowledgeBaseApplication({
          store: backing,
          clock: { now: () => at(600_000) },
          privateSources: f.privateSources,
          limits: {
            maxPhysicalRows: articleRows - (resource === "article" ? 1 : 0),
            controlReserveRows: 0,
          },
          retrieval: { tokenCounter: { count: countSyntheticTokens } },
        });
        expect(
          await limited.repairArticleIndex(indexAdministrator, {
            articleId: current.articleId,
          }),
        ).toMatchObject({
          status: "blocked",
          indexed: false,
          reason: "capacity",
        });
        expect(
          await limited.getArticleIndexStatus(indexAdministrator, {
            articleId: current.articleId,
          }),
        ).toMatchObject({
          status: "blocked",
          indexed: false,
          reason: "capacity",
        });
        expect(await allKnowledgeRows(backing)).toEqual(before);
      },
      30_000,
    );

    it("cannot let a delayed old repair restore retired knowledge", async () => {
      const backing = createStore();
      const f = retrievalFixture(backing);
      await f.setupCollection();
      const published = await f.publishedArticle(
        "article/export",
        "collection/workshop",
        retrievalGuides[0]!.draft,
      );
      const gate = barrier();
      let paused = false;
      f.traced.intercept(async (trace, commit) => {
        if (
          !paused &&
          trace.collection === "knowledge-base.retrieval.v1" &&
          trace.partition.startsWith("scope:")
        ) {
          paused = true;
          await gate.wait();
        }
        return commit();
      });
      const pending = f.app
        .repairArticleIndex(indexAdministrator, { articleId: "article/export" })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      try {
        await Promise.race([
          gate.reached,
          pending.then(() => {
            throw new Error(
              "Repair did not reach its scope transaction barrier",
            );
          }),
        ]);
        await f.authoringApp.retireArticle(indexAdministrator, {
          ...f.command("retire-during-repair", published.current.generation),
          articleId: "article/export",
        });
        const newer = retrievalFixture(backing);
        expect(await newer.repair("article/export")).toMatchObject({
          status: "ready",
          indexed: false,
        });
      } finally {
        gate.release();
      }
      await pending;
      f.traced.intercept(undefined);
      expect(await f.repair("article/export")).toMatchObject({
        status: "ready",
        indexed: false,
      });
      expect(
        (await f.app.searchPublishedArticles(customer, f.portalInput()))
          .articles,
      ).toEqual([]);
    }, 30_000);

    it("rejects physical repair page limits beyond the configured or hard scan bound", async () => {
      const f = retrievalFixture(createStore(), {
        limits: { maxRepairScanRows: 3 },
      });
      for (const limit of [0, 4, 1_001, 1.5])
        await expect(
          f.app.repairRetrievalPage(indexAdministrator, { limit }),
        ).rejects.toBeInstanceOf(TypeError);
      expect(f.traced.enumerations).toEqual([]);
    });
  });
}
