import {
  KnowledgeBaseAuthorizationError,
  KnowledgeBaseNotFoundError,
  KnowledgeBasePrerequisiteError,
} from "@pegma/knowledge-base-application";
import { describe, expect, it } from "vitest";
import {
  createExampleComposition,
  runCompleteExampleFlow,
} from "../examples/composition/composition.js";
import { storeFactories } from "../test/application-stores.js";

for (const [name, createStore] of storeFactories) {
  describe(`fictional public composition (${name})`, () => {
    it("confirms approved bot-only sources without private evidence or portal access", async () => {
      const c = createExampleComposition(await createStore());
      const result = await runCompleteExampleFlow(c);
      expect(result.articleId).toBe(c.articleId);
      expect(result.revision).toBe(1);
      const expectedSources = [
        {
          reference: {
            articleId: "article/fictional-export",
            collectionId: "collection/fictional-workshop",
            collectionPolicyVersion: 2,
            articleRevision: 1,
            contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
            applicationGeneration: 5,
            governanceGeneration: 3,
            validationGeneration: 1,
          },
          citation: { label: "Download a workspace export" },
          title: "Download a workspace export",
          summary: "Save a fictional workshop workspace as a CSV spreadsheet.",
          content: {
            format: "markdown",
            text: "1. Open Workspace.\n2. Choose Export.\n3. Download the CSV spreadsheet.",
          },
          applicability: {
            productId: "fictional-workshop",
            productVersion: "1.0",
            buildId: "synthetic-staging-42",
            locale: "en-US",
          },
        },
      ];
      // Exact public shapes reject added fields, including private metadata
      // nested in an otherwise legitimate source, reference, or content object.
      expect(result.answerSources).toStrictEqual({
        outcome: "results",
        sources: expectedSources,
        serializedSources: expect.any(String),
        sourceTokens: expect.any(Number),
      });
      // Retrieval serializes the complete source array as canonical JSON. Test
      // its decoded shape independently, so encoded evidence/artifacts fail too.
      expect(JSON.parse(result.answerSources.serializedSources)).toStrictEqual(
        expectedSources,
      );
      for (const privateValue of [
        "SYNTHETIC_PRIVATE_EVIDENCE",
        "synthetic/private/",
        "synthetic-receipt/",
        c.contexts.author.principalId,
        "synthetic/staff/verifier",
      ]) {
        expect(result.answerSources.serializedSources).not.toContain(
          privateValue,
        );
        expect(JSON.stringify(result.answerSources.sources)).not.toContain(
          privateValue,
        );
      }
      expect(result.answerSources.sourceTokens).toBe(
        new TextEncoder().encode(result.answerSources.serializedSources)
          .byteLength,
      );
      await expect(
        c.app.getPublishedArticle(c.contexts.customer, {
          articleId: c.articleId,
        }),
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      expect(
        await c.app.searchPublishedArticles(c.contexts.customer, {
          collectionId: c.collectionId,
          query: "export",
          applicability: c.applicability,
        }),
      ).toEqual({ outcome: "no_result", articles: [] });
    });

    it("rejects a tampered passed check and keeps publication with the reviewer", async () => {
      const c = createExampleComposition(await createStore());
      let current = await c.prepareDraft();
      const checks = await c.runSyntheticChecks();
      const first = checks[0]!;
      await expect(
        c.app.submitEvidence(c.contexts.author, {
          ...c.command("tampered-evidence", current.generation),
          articleId: c.articleId,
          receipt: first.receipt,
          evidence: {
            ...first.evidence,
            steps: ["Caller claims the check passed without the recorded run."],
          },
        }),
      ).rejects.toBeInstanceOf(KnowledgeBasePrerequisiteError);
      expect(
        (await c.app.getDraft(c.contexts.author, { articleId: c.articleId }))
          .generation,
      ).toBe(current.generation);
      for (const check of checks) {
        await c.app.submitEvidence(c.contexts.author, {
          ...c.command("evidence", current.generation),
          articleId: c.articleId,
          evidence: check.evidence,
          receipt: check.receipt,
        });
        current = await c.app.getDraft(c.contexts.author, {
          articleId: c.articleId,
        });
      }
      await c.app.submitForReview(c.contexts.author, {
        ...c.command("review", current.generation),
        articleId: c.articleId,
      });
      const reviewed = await c.app.getReview(c.contexts.reviewer, {
        articleId: c.articleId,
      });
      await expect(
        c.app.publishArticle(c.contexts.author, {
          ...c.command("author-publish", reviewed.generation),
          articleId: c.articleId,
          review: reviewed.review,
        }),
      ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      const published = await c.app.publishArticle(c.contexts.reviewer, {
        ...c.command("staff-publish", reviewed.generation),
        articleId: c.articleId,
        review: reviewed.review,
      });
      expect(published.value.state).toBe("published");
    });

    it("refuses an earlier citation immediately after retirement before index cleanup", async () => {
      const c = createExampleComposition(await createStore());
      const result = await runCompleteExampleFlow(c);
      const current = await c.app.getDraft(c.contexts.reviewer, {
        articleId: c.articleId,
      });
      await c.app.retireArticle(c.contexts.reviewer, {
        ...c.command("retire", current.generation),
        articleId: c.articleId,
      });
      expect(
        await c.app.confirmAnswerSources(c.contexts.customer, {
          references: result.answerSources.sources.map(
            (source) => source.reference,
          ),
          applicability: c.applicability,
        }),
      ).toEqual({
        outcome: "no_result",
        sources: [],
        serializedSources: "",
        sourceTokens: 0,
      });
      expect(
        (
          await c.app.retrieveAnswerSources(c.contexts.customer, {
            collectionIds: [c.collectionId],
            query: "export",
            applicability: c.applicability,
          })
        ).sources,
      ).toEqual([]);
    });
  });
}
