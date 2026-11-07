import type { AccessContext } from "@pegma/authorization-core";
import {
  createKnowledgeBaseApplication,
  type DraftArticleDto,
  type EvidenceVerificationRequest,
  type GovernanceConfiguration,
  type KnowledgeBaseApplicationOptions,
  type PrivateSourceReference,
  type SourceReadRequest,
  type SourceEligibilityRequest,
} from "@pegma/knowledge-base-application";
import {
  articleKinds,
  knowledgePermissions,
  type ArticleKind,
  type ArticleRevision,
  type PrincipalId,
  type ValidationPolicy,
} from "@pegma/knowledge-base-contracts";
import type {
  ArticleDraft,
  EvidenceSubmission,
} from "@pegma/knowledge-base-core";
import type { Store } from "@pegma/storage-core";
import { isDeepStrictEqual } from "node:util";
import { vi } from "vitest";

/** Synthetic resolved contexts, not a credential or identity implementation. */
export function access(
  principalId: PrincipalId,
  permissions: readonly string[],
): AccessContext {
  return {
    principalId,
    policyVersion: "synthetic-1",
    roles: [],
    entitlements: [],
    permissions,
  };
}

export const admin = access("staff/workshop", [
  ...Object.values(knowledgePermissions),
  "workshop.customer",
]);
export const author = access("runner/staging", [
  knowledgePermissions.collectionRead,
  knowledgePermissions.draftWrite,
  knowledgePermissions.evidenceSubmit,
  knowledgePermissions.reviewSubmit,
  "knowledge.article.draft.read",
]);
export const customer = access("customer/workshop", [
  knowledgePermissions.collectionRead,
  knowledgePermissions.articleRead,
  "workshop.customer",
]);
export const outsider = access("customer/other", [
  knowledgePermissions.collectionRead,
  knowledgePermissions.articleRead,
]);

export const at = (offset = 0) =>
  new Date(Date.parse("2026-11-06T20:00:00.000Z") + offset).toISOString();
export const validationPolicy: ValidationPolicy = {
  id: "policy/workshop",
  version: 1,
  requirements: [
    ...articleKinds.map((kind) => ({
      id: `${kind}-content`,
      kind,
      testKind: "content",
      maxAgeMilliseconds: 60_000,
      trustedRunnerIds: [author.principalId],
    })),
    {
      id: "walkthrough-workflow",
      kind: "walkthrough",
      testKind: "workflow",
      maxAgeMilliseconds: 60_000,
      trustedRunnerIds: [author.principalId],
    },
  ],
};

export function draft(
  kind: ArticleKind = "explanation",
  body = "Choose [Export](/workspace/export). ",
): ArticleDraft {
  return {
    kind,
    title: "Export your workspace",
    summary: "Download a synthetic workspace export.",
    content: { format: "markdown", text: body },
    tags: ["export"],
    applicability: {
      productId: "fictional-workshop",
      productVersion: "1.0",
      buildId: "staging-42",
      locale: "en-US",
    },
  };
}

export function evidence(
  revision: ArticleRevision,
  checkId = `${revision.kind}-content`,
): EvidenceSubmission {
  const requirement = validationPolicy.requirements.find(
    (check) => check.id === checkId,
  );
  if (requirement === undefined)
    throw new Error(`Unknown synthetic check ${checkId}`);
  return {
    id: `evidence/${checkId}`,
    articleId: revision.articleId,
    articleRevision: revision.number,
    contentHash: revision.contentHash,
    validationPolicy: revision.validationPolicy,
    checkId,
    testKind: requirement.testKind,
    applicability: revision.applicability,
    stagingBuildId: "staging-42",
    steps: ['Run the quoted "export" workflow. PRIVATE_STAFF_EVIDENCE'],
    result: "passed",
    executedAt: new Date(Date.parse(revision.createdAt) + 1_000).toISOString(),
    runnerId: author.principalId,
    artifacts: [{ id: "private/artifact/export", hash: "a".repeat(64) }],
  };
}

/** Scripted external trust fixtures; all KB persistence uses the supplied Store. */
export function applicationFixture(
  store: Store,
  options: {
    readonly missingEvidenceVerifier?: boolean;
    readonly missingPrivateSources?: boolean;
    readonly limits?: KnowledgeBaseApplicationOptions["limits"];
  } = {},
) {
  let offset = 0;
  let commandOrdinal = 0;
  const clock = { now: () => at(offset) };
  const trust = {
    verifierThrows: false,
    canReadSource: true,
    canPublishSource: true,
    sourceCurrent: true,
  };
  const receipts = new Map<
    string,
    {
      principalId: string;
      article: ArticleRevision;
      submission: EvidenceSubmission;
      configuration: GovernanceConfiguration;
    }
  >();
  const verify = vi.fn(async (request: EvidenceVerificationRequest) => {
    if (trust.verifierThrows)
      throw new Error("Synthetic receipt service unavailable");
    const bound = receipts.get(request.receipt);
    if (
      bound === undefined ||
      bound.principalId !== request.access.principalId ||
      !isDeepStrictEqual(bound.article, request.article) ||
      !isDeepStrictEqual(bound.submission, request.submission) ||
      !isDeepStrictEqual(bound.configuration, request.configuration)
    )
      return null;
    return {
      id: request.receipt,
      verifiedBy: "staff/verifier",
      verifiedAt: clock.now(),
    };
  });
  const privateSources = {
    canRead: vi.fn(async (_request: SourceReadRequest) => trust.canReadSource),
    canPublish: vi.fn(
      async (_request: SourceEligibilityRequest) => trust.canPublishSource,
    ),
    isCurrent: vi.fn(
      async (_request: SourceEligibilityRequest) => trust.sourceCurrent,
    ),
  };
  const app = createKnowledgeBaseApplication({
    store,
    clock,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.missingEvidenceVerifier
      ? {}
      : { evidenceVerifier: { verify } }),
    ...(options.missingPrivateSources ? {} : { privateSources }),
  });
  function command(prefix: string, expectedGeneration: number) {
    return {
      commandId: `${prefix}/${++commandOrdinal}`,
      correlationId: "synthetic-correlation",
      expectedGeneration,
    };
  }
  async function setupCollection(
    collectionId = "collection/workshop",
    portal = true,
  ) {
    await app.createCollection(admin, {
      ...command("collection", 0),
      collectionId,
      name: "Workshop guides",
    });
    try {
      await app.getValidationPolicy(admin, { policyId: validationPolicy.id });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.name !== "KnowledgeBaseNotFoundError"
      )
        throw error;
      await app.putValidationPolicy(admin, {
        ...command("policy", 0),
        policy: validationPolicy,
      });
    }
    let current = await app.getCollection(admin, { collectionId });
    await app.putGovernanceConfiguration(admin, {
      ...command("governance", current.generation),
      collectionId,
      configuration: {
        validationPolicy: {
          id: validationPolicy.id,
          version: validationPolicy.version,
        },
        expectedStagingBuildId: "staging-42",
        trustedAttesterIds: ["staff/verifier"],
      },
    });
    const preview = await app.previewCollectionPolicy(admin, {
      collectionId,
      uses: {
        portal: portal
          ? {
              enabled: true,
              audience: { kind: "permission", permission: "workshop.customer" },
            }
          : { enabled: false },
        bot: {
          enabled: true,
          audience: { kind: "permission", permission: "workshop.customer" },
        },
      },
    });
    await app.updateCollectionPolicy(admin, {
      ...command("audience", preview.generation),
      collectionId,
      preview: preview.preview,
    });
    current = await app.getCollection(admin, { collectionId });
    return current;
  }
  async function createDraft(
    articleId = "article/export",
    collectionId = "collection/workshop",
    body?: ArticleDraft,
  ) {
    await app.createDraft(author, {
      ...command("draft", 0),
      articleId,
      collectionId,
      draft: body ?? draft(),
    });
    return app.getDraft(author, { articleId });
  }
  async function issueReceipt(
    current: DraftArticleDto,
    submission = evidence(current.revision),
    principal = author,
  ) {
    const receipt = `receipt/${++commandOrdinal}`;
    const configuration = await app.getGovernanceConfiguration(admin, {
      collectionId: current.revision.collectionId,
    });
    receipts.set(receipt, {
      principalId: principal.principalId,
      article: structuredClone(current.revision),
      submission: structuredClone(submission),
      configuration: structuredClone(configuration.configuration),
    });
    return { receipt, submission };
  }
  async function submitEvidence(
    current: DraftArticleDto,
    checkId?: string,
    submission?: EvidenceSubmission,
  ) {
    const submitted = submission ?? evidence(current.revision, checkId);
    // This helper simulates a completed legitimate staging run. Negative
    // timestamp/receipt cases call the public service directly instead.
    offset = Math.max(
      offset,
      3_000,
      Date.parse(submitted.executedAt) - Date.parse(at()) + 1_000,
    );
    const issued = await issueReceipt(current, submitted);
    const input = {
      ...command("evidence", current.generation),
      articleId: current.articleId,
      evidence: issued.submission,
      receipt: issued.receipt,
    };
    const result = await app.submitEvidence(author, input);
    return {
      result,
      input,
      current: await app.getDraft(author, { articleId: current.articleId }),
    };
  }
  async function review(current: DraftArticleDto) {
    offset = Math.max(offset, 4_000);
    await app.submitForReview(author, {
      ...command("review", current.generation),
      articleId: current.articleId,
    });
    return app.getReview(admin, { articleId: current.articleId });
  }
  async function publish(current: DraftArticleDto) {
    const reviewed = await review(current);
    offset = Math.max(offset, 5_000);
    const input = {
      ...command("publish", reviewed.generation),
      articleId: current.articleId,
      review: reviewed.review,
    };
    const result = await app.publishArticle(admin, input);
    return {
      result,
      input,
      current: await app.getDraft(author, { articleId: current.articleId }),
    };
  }
  async function publishedArticle(
    articleId = "article/export",
    collectionId = "collection/workshop",
    body?: ArticleDraft,
  ) {
    let current = await createDraft(articleId, collectionId, body);
    current = (await submitEvidence(current)).current;
    if (current.revision.kind === "walkthrough")
      current = (await submitEvidence(current, "walkthrough-workflow")).current;
    return publish(current);
  }
  async function setSources(
    current: DraftArticleDto,
    references: readonly PrivateSourceReference[],
  ) {
    await app.setProvenance(admin, {
      ...command("sources", current.generation),
      articleId: current.articleId,
      references,
    });
    return app.getDraft(author, { articleId: current.articleId });
  }
  return {
    app,
    store,
    command,
    setupCollection,
    createDraft,
    issueReceipt,
    submitEvidence,
    review,
    publish,
    publishedArticle,
    setSources,
    trust,
    verify,
    privateSources,
    setTime: (value: number) => {
      offset = value;
    },
  };
}
