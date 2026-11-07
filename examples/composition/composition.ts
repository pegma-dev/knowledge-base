/**
 * Fictional, source-only composition: no transport, authenticated identity,
 * live staging runner, model provider, or production durability claim.
 */
import type { AccessContext } from "@pegma/authorization-core";
import {
  createKnowledgeBaseApplication,
  type EvidenceVerificationRequest,
  type GovernanceConfiguration,
} from "@pegma/knowledge-base-application";
import {
  articleKinds,
  knowledgePermissions,
  type ValidationPolicy,
} from "@pegma/knowledge-base-contracts";
import type {
  ArticleDraft,
  EvidenceSubmission,
} from "@pegma/knowledge-base-core";
import { createMemoryStore, type Store } from "@pegma/storage-core";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

/** Trusted fixture inputs, never an example of accepting access from a client. */
function syntheticAccess(
  principalId: string,
  permissions: readonly string[],
): AccessContext {
  return Object.freeze({
    principalId,
    policyVersion: "synthetic-example-1",
    roles: Object.freeze([]),
    entitlements: Object.freeze([]),
    permissions: Object.freeze([...permissions]),
  });
}

export function createExampleComposition(store: Store = createMemoryStore()) {
  const articleId = "article/fictional-export";
  const collectionId = "collection/fictional-workshop";
  const audiencePermission = "fictional.workshop.customer";
  const contexts = Object.freeze({
    administrator: syntheticAccess("synthetic/staff/administrator", [
      knowledgePermissions.collectionRead,
      knowledgePermissions.collectionManage,
      knowledgePermissions.validationManage,
    ]),
    author: syntheticAccess("synthetic/runner/author", [
      knowledgePermissions.collectionRead,
      knowledgePermissions.draftRead,
      knowledgePermissions.draftWrite,
      knowledgePermissions.evidenceSubmit,
      knowledgePermissions.reviewSubmit,
    ]),
    reviewer: syntheticAccess("synthetic/staff/reviewer", [
      knowledgePermissions.collectionRead,
      knowledgePermissions.draftRead,
      knowledgePermissions.review,
      knowledgePermissions.publish,
      knowledgePermissions.retire,
      knowledgePermissions.indexManage,
    ]),
    customer: syntheticAccess("synthetic/customer/workshop", [
      knowledgePermissions.articleRead,
      knowledgePermissions.botRead,
      audiencePermission,
    ]),
  });
  const guide: ArticleDraft = {
    kind: "walkthrough",
    title: "Download a workspace export",
    summary: "Save a fictional workshop workspace as a CSV spreadsheet.",
    content: {
      format: "markdown",
      text: "1. Open Workspace.\n2. Choose Export.\n3. Download the CSV spreadsheet.",
    },
    tags: ["download", "export", "csv", "spreadsheet"],
    applicability: {
      productId: "fictional-workshop",
      productVersion: "1.0",
      buildId: "synthetic-staging-42",
      locale: "en-US",
    },
  };
  const policy: ValidationPolicy = {
    id: "validation/fictional-workshop",
    version: 1,
    requirements: [
      ...articleKinds.map((kind) => ({
        id: `${kind}-content`,
        kind,
        testKind: "content",
        maxAgeMilliseconds: 60_000,
        trustedRunnerIds: [contexts.author.principalId],
      })),
      {
        id: "walkthrough-workflow",
        kind: "walkthrough",
        testKind: "workflow",
        maxAgeMilliseconds: 60_000,
        trustedRunnerIds: [contexts.author.principalId],
      },
    ],
  };
  const configuration: GovernanceConfiguration = {
    validationPolicy: { id: policy.id, version: policy.version },
    expectedStagingBuildId: "synthetic-staging-42",
    trustedAttesterIds: ["synthetic/staff/verifier"],
  };
  let time = Date.parse("2026-11-07T12:00:00.000Z");
  let commandOrdinal = 0;
  let receiptOrdinal = 0;
  const clock = { now: () => new Date(time).toISOString() };
  // Only the scripted runner below writes these private, immutable strings.
  // They are synthetic external receipts, not an alternative KB persistence.
  const receipts = new Map<string, string>();
  function binding(request: Omit<EvidenceVerificationRequest, "receipt">) {
    return {
      principalId: request.access.principalId,
      article: request.article,
      submission: request.submission,
      configuration: request.configuration,
    };
  }
  const app = createKnowledgeBaseApplication({
    store,
    clock,
    evidenceVerifier: {
      async verify(request) {
        const recorded = receipts.get(request.receipt);
        if (
          recorded === undefined ||
          !isDeepStrictEqual(JSON.parse(recorded), binding(request))
        )
          return null;
        return {
          id: request.receipt,
          verifiedBy: "synthetic/staff/verifier",
          verifiedAt: clock.now(),
        };
      },
    },
    retrieval: {
      // One UTF-8 byte is one fixture token; this is not a model tokenizer.
      tokenCounter: {
        count: (text) => new TextEncoder().encode(text).byteLength,
      },
    },
  });

  function command(action: string, expectedGeneration: number) {
    time += 1_000;
    return {
      commandId: `synthetic/${action}/${++commandOrdinal}`,
      correlationId: "synthetic-composition",
      expectedGeneration,
    };
  }

  async function prepareDraft() {
    const created = await app.createCollection(contexts.administrator, {
      ...command("collection", 0),
      collectionId,
      name: "Fictional workshop guides",
    });
    await app.putValidationPolicy(contexts.administrator, {
      ...command("validation", 0),
      policy,
    });
    await app.putGovernanceConfiguration(contexts.administrator, {
      ...command("governance", created.value.generation),
      collectionId,
      configuration,
    });
    const preview = await app.previewCollectionPolicy(contexts.administrator, {
      collectionId,
      uses: {
        portal: { enabled: false },
        bot: {
          enabled: true,
          audience: { kind: "permission", permission: audiencePermission },
        },
      },
    });
    await app.updateCollectionPolicy(contexts.administrator, {
      ...command("audience", preview.generation),
      collectionId,
      preview: preview.preview,
    });
    await app.createDraft(contexts.author, {
      ...command("draft", 0),
      articleId,
      collectionId,
      draft: guide,
    });
    return app.getDraft(contexts.author, { articleId });
  }

  async function runSyntheticChecks() {
    const current = await app.getDraft(contexts.author, { articleId });
    // This scripted runner recognizes only the known fictional procedure.
    // It accepts no submitted result, runner, artifact, or attestation claims.
    assert.deepEqual(current.revision.content, guide.content);
    time += 1_000;
    return policy.requirements
      .filter((check) => check.kind === guide.kind)
      .map((check) => {
        const evidence: EvidenceSubmission = {
          id: `evidence/${check.id}`,
          articleId,
          articleRevision: current.revision.number,
          contentHash: current.revision.contentHash,
          validationPolicy: current.revision.validationPolicy,
          checkId: check.id,
          testKind: check.testKind,
          applicability: current.revision.applicability,
          stagingBuildId: configuration.expectedStagingBuildId,
          steps: [
            "SYNTHETIC_PRIVATE_EVIDENCE: fictional export check completed.",
          ],
          result: "passed",
          executedAt: clock.now(),
          runnerId: contexts.author.principalId,
          artifacts: [
            { id: `synthetic/private/${check.id}`, hash: "a".repeat(64) },
          ],
        };
        const receipt = `synthetic-receipt/${++receiptOrdinal}`;
        receipts.set(
          receipt,
          JSON.stringify(
            binding({
              access: contexts.author,
              article: current.revision,
              submission: evidence,
              configuration,
            }),
          ),
        );
        return { receipt, evidence: structuredClone(evidence) };
      });
  }

  return {
    app,
    contexts,
    articleId,
    collectionId,
    applicability: structuredClone(guide.applicability),
    command,
    prepareDraft,
    runSyntheticChecks,
  };
}

export async function runCompleteExampleFlow(
  composition: ReturnType<typeof createExampleComposition>,
) {
  const c = composition;
  let current = await c.prepareDraft();
  for (const check of await c.runSyntheticChecks()) {
    const submitted = await c.app.submitEvidence(c.contexts.author, {
      ...c.command("evidence", current.generation),
      articleId: c.articleId,
      evidence: check.evidence,
      receipt: check.receipt,
    });
    current = await c.app.getDraft(c.contexts.author, {
      articleId: c.articleId,
    });
    assert.equal(current.generation, submitted.value.generation);
  }
  await c.app.submitForReview(c.contexts.author, {
    ...c.command("review", current.generation),
    articleId: c.articleId,
  });
  const reviewed = await c.app.getReview(c.contexts.reviewer, {
    articleId: c.articleId,
  });
  await c.app.publishArticle(c.contexts.reviewer, {
    ...c.command("publish", reviewed.generation),
    articleId: c.articleId,
    review: reviewed.review,
  });
  let indexed = false;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const status = await c.app.repairArticleIndex(c.contexts.reviewer, {
      articleId: c.articleId,
    });
    assert.notEqual(
      status.status,
      "blocked",
      `Index blocked: ${status.reason}`,
    );
    if (status.status === "ready") {
      assert.equal(status.indexed, true);
      indexed = true;
      break;
    }
  }
  assert.equal(indexed, true, "Index did not converge within 16 bounded calls");
  const retrieved = await c.app.retrieveAnswerSources(c.contexts.customer, {
    collectionIds: [c.collectionId],
    query: "How can I download a CSV export?",
    applicability: c.applicability,
  });
  // Reconfirm the exact references immediately before consuming these sources.
  // The result is a current observation, not an authorization lease.
  const confirmed = await c.app.confirmAnswerSources(c.contexts.customer, {
    references: retrieved.sources.map((source) => source.reference),
    applicability: c.applicability,
  });
  assert.equal(confirmed.outcome, "results");
  assert.equal(confirmed.sources.length, 1);
  assert.deepEqual(confirmed.sources, retrieved.sources);
  const source = confirmed.sources[0]!;
  assert.equal(source.reference.articleId, c.articleId);
  assert.equal(source.citation.portalArticle, undefined);
  return {
    articleId: c.articleId,
    revision: source.reference.articleRevision,
    citationLabel: source.citation.label,
    answerSources: confirmed,
  };
}
