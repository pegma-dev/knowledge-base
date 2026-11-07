import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import { describe, expect, it } from "vitest";
import {
  access,
  admin,
  author,
  customer,
  draft,
} from "../test/application-fixtures.js";
import { storeFactories } from "../test/application-stores.js";
import {
  botCustomer,
  retrievalApplicability,
  retrievalFixture,
  retrievalGuides,
  unsupportedRetrievalQuestion,
} from "../test/retrieval-fixtures.js";

for (const [name, createStore] of storeFactories) {
  describe(`approved lexical retrieval (${name})`, () => {
    it("finds representative title/tag paraphrases and returns a safe known no-result", async () => {
      const f = retrievalFixture(createStore());
      await f.corpus();
      for (const guide of retrievalGuides) {
        for (const query of guide.questions) {
          const result = await f.app.searchPublishedArticles(
            customer,
            f.portalInput(query),
          );
          expect(result.outcome).toBe("results");
          expect(result.articles[0]?.articleId).toBe(guide.id);
        }
      }
      expect(
        await f.app.searchPublishedArticles(
          customer,
          f.portalInput(unsupportedRetrievalQuestion),
        ),
      ).toEqual({ outcome: "no_result", articles: [] });
    }, 30_000);

    it("uses bot-only knowledge without portal browsing or a browse citation", async () => {
      const f = retrievalFixture(createStore());
      await f.setupCollection("collection/bot-only", false);
      await f.publishGuide(retrievalGuides[0], "collection/bot-only");
      expect(
        await f.app.searchPublishedArticles(customer, {
          ...f.portalInput(),
          collectionId: "collection/bot-only",
        }),
      ).toEqual({ outcome: "no_result", articles: [] });
      expect(
        (await f.app.listPortalCollections(customer, {})).collections,
      ).not.toContainEqual(
        expect.objectContaining({ collectionId: "collection/bot-only" }),
      );
      const answer = await f.app.retrieveAnswerSources(botCustomer, {
        ...f.botInput(),
        collectionIds: ["collection/bot-only"],
      });
      expect(answer.sources).toHaveLength(1);
      expect(answer.sources[0]?.citation.label).toBe(
        retrievalGuides[0]!.draft.title,
      );
      expect(answer.sources[0]?.citation).not.toHaveProperty("portalArticle");
    }, 30_000);

    it("excludes draft-only content and preserves the old publication after a draft move", async () => {
      const f = retrievalFixture(createStore());
      await f.setupCollection();
      await f.createDraft("article/draft-only", "collection/workshop", {
        ...draft(),
        title: "UNAPPROVED_DRAFT_CANARY",
        tags: ["unpublishedcanary"],
      });
      await f.repair("article/draft-only");
      expect(
        (
          await f.app.searchPublishedArticles(
            customer,
            f.portalInput("unpublishedcanary"),
          )
        ).articles,
      ).toEqual([]);
      const published = await f.publishGuide();
      await f.setupCollection("collection/bot-only", false);
      await f.app.updateDraft(author, {
        ...f.command("move-unapproved", published.current.generation),
        articleId: "article/export",
        collectionId: "collection/bot-only",
        draft: {
          ...draft(),
          title: "UNAPPROVED_NEW_TITLE",
          content: { format: "plain_text", text: "UNAPPROVED_NEW_BODY" },
          tags: ["unpublishedcanary"],
        },
      });
      const result = await f.app.searchPublishedArticles(
        customer,
        f.portalInput(),
      );
      expect(result.articles[0]).toMatchObject({
        articleId: "article/export",
        collectionId: "collection/workshop",
        revision: 1,
        title: retrievalGuides[0]!.draft.title,
      });
      expect(JSON.stringify(result)).not.toContain("UNAPPROVED");
    }, 30_000);

    it("requires the exact product, version, build and locale tuple", async () => {
      const f = retrievalFixture(createStore());
      await f.setupCollection();
      await f.publishGuide();
      for (const field of [
        "productId",
        "productVersion",
        "buildId",
        "locale",
      ] as const) {
        const applicability = { ...retrievalApplicability, [field]: "other" };
        expect(
          (
            await f.app.searchPublishedArticles(customer, {
              ...f.portalInput(),
              applicability,
            })
          ).articles,
        ).toEqual([]);
        expect(
          (
            await f.app.retrieveAnswerSources(botCustomer, {
              ...f.botInput(),
              applicability,
            })
          ).sources,
        ).toEqual([]);
      }
    }, 30_000);

    it("does not widen a missing customer audience with broad service permissions", async () => {
      const f = retrievalFixture(createStore());
      await f.setupCollection();
      await f.publishGuide();
      const wrongAudience = access(
        "service/broad",
        Object.values(knowledgePermissions),
      );
      expect(
        (await f.app.listPortalCollections(wrongAudience, {})).collections,
      ).toEqual([]);
      expect(
        (await f.app.searchPublishedArticles(wrongAudience, f.portalInput()))
          .articles,
      ).toEqual([]);
      expect(
        (await f.app.retrieveAnswerSources(wrongAudience, f.botInput()))
          .sources,
      ).toEqual([]);
    }, 30_000);

    it.each(["policy", "source", "evidence"] as const)(
      "lets current %s withdrawal defeat stale hints and previously returned source references",
      async (withdrawal) => {
        const f = retrievalFixture(createStore());
        await f.setupCollection();
        let current = await f.createDraft(
          "article/export",
          "collection/workshop",
          retrievalGuides[0]!.draft,
        );
        if (withdrawal === "source")
          current = await f.setSources(current, [
            {
              id: "source/private",
              system: "synthetic-support",
              resourceId: "PRIVATE_SOURCE_CANARY",
              version: "1",
            },
          ]);
        current = (await f.submitEvidence(current)).current;
        current = (await f.publish(current)).current;
        await f.repair(current.articleId);
        const answer = await f.app.retrieveAnswerSources(
          botCustomer,
          f.botInput(),
        );
        expect(answer.sources).toHaveLength(1);
        if (withdrawal === "source") f.trust.canPublishSource = false;
        else if (withdrawal === "policy") {
          const preview = await f.app.previewCollectionPolicy(admin, {
            collectionId: "collection/workshop",
            uses: { portal: { enabled: false }, bot: { enabled: false } },
          });
          await f.app.updateCollectionPolicy(admin, {
            ...f.command("withdraw-policy", preview.generation),
            collectionId: "collection/workshop",
            preview: preview.preview,
          });
        } else {
          const proof = (
            await f.app.getEvidence(admin, { articleId: current.articleId })
          ).evidence[0]!;
          await f.app.revokeEvidence(admin, {
            ...f.command("withdraw-proof", current.generation),
            articleId: current.articleId,
            articleRevision: proof.articleRevision,
            evidenceId: proof.id,
            evidenceVersion: proof.version,
            evidenceHash: proof.hash,
            reason: "Synthetic proof withdrawal",
          });
        }
        expect(
          (await f.app.searchPublishedArticles(customer, f.portalInput()))
            .articles,
        ).toEqual([]);
        expect(
          (await f.app.retrieveAnswerSources(botCustomer, f.botInput()))
            .sources,
        ).toEqual([]);
        expect(
          (
            await f.app.confirmAnswerSources(botCustomer, {
              references: answer.sources.map((entry) => entry.reference),
              applicability: retrievalApplicability,
            })
          ).sources,
        ).toEqual([]);
      },
      30_000,
    );

    it("returns safe exact citations and reconfirms them instead of trusting an earlier answer payload", async () => {
      const f = retrievalFixture(createStore());
      await f.setupCollection();
      const published = await f.publishGuide();
      const answer = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput(),
      );
      expect(answer.sources).toHaveLength(1);
      expect(answer.sources[0]?.citation.portalArticle).toEqual({
        articleId: "article/export",
        revision: 1,
      });
      const references = answer.sources.map((entry) => entry.reference);
      expect(
        (
          await f.app.confirmAnswerSources(botCustomer, {
            references,
            applicability: retrievalApplicability,
          })
        ).sources,
      ).toEqual(answer.sources);
      expect(JSON.parse(answer.serializedSources)).toEqual(answer.sources);
      for (const secret of [
        "PRIVATE_STAFF_EVIDENCE",
        "runner/staging",
        "staff/verifier",
        "reviewerId",
        "attestation",
        "provenance",
        "createdBy",
      ])
        expect(answer.serializedSources).not.toContain(secret);
      await f.app.updateDraft(author, {
        ...f.command("new-draft-turn-fence", published.current.generation),
        articleId: "article/export",
        collectionId: "collection/workshop",
        draft: { ...retrievalGuides[0]!.draft, title: "New unapproved title" },
      });
      expect(
        (
          await f.app.confirmAnswerSources(botCustomer, {
            references,
            applicability: retrievalApplicability,
          })
        ).sources,
      ).toEqual([]);
    }, 30_000);

    it("keeps independently composed stores isolated even for matching article and collection IDs", async () => {
      const first = retrievalFixture(createStore());
      const second = retrievalFixture(createStore());
      await first.setupCollection();
      await second.setupCollection();
      await first.publishGuide();
      expect(
        (
          await second.app.searchPublishedArticles(
            customer,
            second.portalInput(),
          )
        ).articles,
      ).toEqual([]);
      expect(
        (await second.app.retrieveAnswerSources(botCustomer, second.botInput()))
          .sources,
      ).toEqual([]);
    }, 30_000);

    it("uses deterministic article ordering for equal approved title/tag scores", async () => {
      const f = retrievalFixture(createStore());
      await f.setupCollection();
      for (const id of ["article/z-export", "article/a-export"])
        await f.publishGuide({ ...retrievalGuides[0]!, id });
      const first = await f.app.searchPublishedArticles(
        customer,
        f.portalInput(),
      );
      const second = await f.app.searchPublishedArticles(
        customer,
        f.portalInput(),
      );
      expect(first.articles.map((entry) => entry.articleId)).toEqual([
        "article/a-export",
        "article/z-export",
      ]);
      expect(second).toEqual(first);
    }, 30_000);
  });
}
