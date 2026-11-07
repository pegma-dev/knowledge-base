import type { KnowledgeCandidateHint } from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import type { TransactionOutcome } from "@pegma/storage-core";
import { describe, expect, it, vi } from "vitest";
import { access, admin } from "../test/application-fixtures.js";
import { storeFactories } from "../test/application-stores.js";
import {
  allRetrievalRows,
  botCustomer,
  indexAdministrator,
  realBotHints,
  retrievalApplicability,
  retrievalFixture,
  retrievalGuides,
} from "../test/retrieval-fixtures.js";

function adapterPage(hints: readonly KnowledgeCandidateHint[]) {
  return {
    hints,
    nextCursor: null,
    work: {
      keyedReads: 1,
      physicalRows: 1,
      postingEntries: hints.length,
      pagesRead: 1,
    },
  };
}

for (const [name, createStore] of storeFactories) {
  describe(`retrieval PR review regressions (${name})`, () => {
    it.each([1, 2])(
      "preserves adapter relevance order with %i authoritative confirmations and tied local scores",
      async (confirmations) => {
        const backing = createStore();
        const seed = retrievalFixture(backing);
        await seed.setupCollection();
        for (const id of ["article/a-export", "article/z-export"])
          await seed.publishGuide({ ...retrievalGuides[0]!, id });
        const hints = await realBotHints(backing);
        const rankedIds = ["article/z-export", "article/a-export"];
        const ranked = rankedIds.map((id) =>
          hints.find((hint) => hint.articleId === id)!,
        );
        expect(ranked.every((hint) => hint !== undefined)).toBe(true);
        const search = vi.fn(async () => adapterPage(ranked));
        const f = retrievalFixture(backing, {
          candidateAdapter: { search },
          limits: { maxConfirmations: confirmations },
        });
        const result = await f.app.retrieveAnswerSources(
          botCustomer,
          f.botInput(),
        );
        expect(search).toHaveBeenCalledTimes(1);
        expect(
          result.sources.map((source) => source.reference.articleId),
        ).toEqual(rankedIds.slice(0, confirmations));
      },
      30_000,
    );

    it("uses an adapter's approved body match without requiring title, summary or tag overlap", async () => {
      const backing = createStore();
      const seed = retrievalFixture(backing);
      await seed.setupCollection();
      const guide = {
        ...retrievalGuides[0]!,
        draft: {
          ...retrievalGuides[0]!.draft,
          content: {
            format: "plain_text" as const,
            text: "Choose the orchid switch before downloading the export.",
          },
        },
      };
      await seed.publishGuide(guide);
      for (const text of [
        guide.draft.title,
        guide.draft.summary,
        ...guide.draft.tags,
      ])
        expect(text.toLowerCase()).not.toContain("orchid");
      expect(
        (
          await seed.app.retrieveAnswerSources(
            botCustomer,
            seed.botInput("orchid"),
          )
        ).sources,
      ).toEqual([]);
      const hint = (await realBotHints(backing))[0]!;
      const f = retrievalFixture(backing, {
        candidateAdapter: { search: async () => adapterPage([hint]) },
      });
      const result = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput("orchid"),
      );
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]?.content).toEqual(guide.draft.content);
    }, 30_000);

    it("does not let a healthy same-plan losing CAS worker block the winner's progress", async () => {
      const backing = createStore();
      const loser = retrievalFixture(backing, {
        limits: { maxMaintenanceBatches: 1 },
      });
      await loser.setupCollection();
      await loser.publishedArticle("article/export", "collection/workshop", {
        ...retrievalGuides[0]!.draft,
        title:
          "Export amber bronze copper denim emerald flax granite hazel ivory jade khaki lilac mauve navy ochre peach quartz",
      });
      const winner = retrievalFixture(backing, {
        limits: { maxMaintenanceBatches: 1 },
      });
      const outcomes: TransactionOutcome[] = [];
      loser.traced.intercept(async (trace, commit) => {
        if (
          trace.collection === "knowledge-base.retrieval.v1" &&
          trace.partition.startsWith("scope:")
        ) {
          const progress = await winner.app.repairArticleIndex(
            indexAdministrator,
            { articleId: "article/export" },
          );
          expect(progress.status).toBe("pending");
          const outcome = await commit();
          outcomes.push(outcome);
          return outcome;
        }
        return commit();
      });
      const result = await loser.app.repairArticleIndex(indexAdministrator, {
        articleId: "article/export",
      });
      loser.traced.intercept(undefined);
      expect(outcomes).toHaveLength(3);
      expect(outcomes.every((outcome) => !outcome.committed)).toBe(true);
      expect(result).toMatchObject({ status: "pending", indexed: false });
      const progress = (await allRetrievalRows(backing)).find(
        (row) => row.kind === "article",
      );
      expect(progress?.data).toMatchObject({ status: "pending" });
      expect(
        await retrievalFixture(backing).repair("article/export"),
      ).toMatchObject({ status: "ready", indexed: true });
    }, 30_000);

    it.each([
      ["retained targets", { maxIndexPartitionRows: 2 }],
      ["minimal marker", { maxTermsPerArticle: 1 }],
    ] as const)(
      "reassesses a blocked %s after policy withdrawal without changing the article head",
      async (_label, limits) => {
        const backing = createStore();
        const f = retrievalFixture(backing, { limits });
        await f.setupCollection();
        const published = await f.publishedArticle(
          "article/export",
          "collection/workshop",
          retrievalGuides[0]!.draft,
        );
        expect(await f.repair("article/export")).toMatchObject({
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
        const preview = await f.authoringApp.previewCollectionPolicy(admin, {
          collectionId: "collection/workshop",
          uses: { portal: { enabled: false }, bot: { enabled: false } },
        });
        await f.authoringApp.updateCollectionPolicy(admin, {
          ...f.command("withdraw-blocked-policy", preview.generation),
          collectionId: "collection/workshop",
          preview: preview.preview,
        });
        expect(
          (await f.app.getDraft(admin, { articleId: "article/export" }))
            .generation,
        ).toBe(published.current.generation);
        expect(
          await f.app.getArticleIndexStatus(indexAdministrator, {
            articleId: "article/export",
          }),
        ).toMatchObject({ status: "pending", indexed: false });
        expect(await f.repair("article/export")).toMatchObject({
          status: "ready",
          indexed: false,
        });
      },
      30_000,
    );

    it("supports explicitly approved anonymous portal and bot policy then rejects revoked stale hints", async () => {
      const f = retrievalFixture(createStore());
      await f.setupCollection();
      const preview = await f.authoringApp.previewCollectionPolicy(admin, {
        collectionId: "collection/workshop",
        uses: {
          portal: { enabled: true, audience: { kind: "anonymous" } },
          bot: { enabled: true, audience: { kind: "anonymous" } },
        },
      });
      await f.authoringApp.updateCollectionPolicy(admin, {
        ...f.command("approved-public-policy", preview.generation),
        collectionId: "collection/workshop",
        preview: preview.preview,
        approvePublic: true,
      });
      await f.publishGuide();
      const outsider = access("visitor/public", [
        knowledgePermissions.articleRead,
        knowledgePermissions.botRead,
      ]);
      expect(
        (await f.app.listPortalCollections(outsider, {})).collections,
      ).toContainEqual(
        expect.objectContaining({ collectionId: "collection/workshop" }),
      );
      expect(
        (await f.app.searchPublishedArticles(outsider, f.portalInput()))
          .articles,
      ).toHaveLength(1);
      const answer = await f.app.retrieveAnswerSources(outsider, f.botInput());
      expect(answer.sources).toHaveLength(1);
      expect(answer.sources[0]?.citation.portalArticle).toEqual({
        articleId: "article/export",
        revision: 1,
      });
      const withdrawn = await f.authoringApp.previewCollectionPolicy(admin, {
        collectionId: "collection/workshop",
        uses: { portal: { enabled: false }, bot: { enabled: false } },
      });
      await f.authoringApp.updateCollectionPolicy(admin, {
        ...f.command("withdraw-public-policy", withdrawn.generation),
        collectionId: "collection/workshop",
        preview: withdrawn.preview,
      });
      expect(
        (await f.app.listPortalCollections(outsider, {})).collections,
      ).toEqual([]);
      expect(
        (await f.app.searchPublishedArticles(outsider, f.portalInput()))
          .articles,
      ).toEqual([]);
      expect(
        (await f.app.retrieveAnswerSources(outsider, f.botInput())).sources,
      ).toEqual([]);
      expect(
        (
          await f.app.confirmAnswerSources(outsider, {
            references: answer.sources.map((source) => source.reference),
            applicability: retrievalApplicability,
          })
        ).sources,
      ).toEqual([]);
    }, 30_000);
  });
}
