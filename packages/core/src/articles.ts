import type {
  Applicability,
  ApprovalBinding,
  Article,
  ArticleContent,
  ArticleKind,
  ArticleRevision,
  Collection,
  IsoTimestamp,
  PrincipalId,
  ValidationPolicy,
  VerificationEvidence,
} from "@pegma/knowledge-base-contracts";
import { verifyCollection } from "./collections.js";
import {
  boundedArray,
  canonical,
  count,
  digest,
  hash,
  immutable,
  invalid,
  keys,
  KnowledgeBaseError,
  knowledgeLimits,
  text,
  timestamp,
  unique,
  validateApplicability,
  validatePolicy,
  validateRevisionFields,
  verifyRevision,
} from "./validation.js";

export interface ArticleDraft {
  readonly kind: ArticleKind;
  readonly title: string;
  readonly summary: string;
  readonly content: ArticleContent;
  readonly tags: readonly string[];
  readonly applicability: Applicability;
}

export interface DraftContext {
  readonly collection: Collection;
  readonly validationPolicy: ValidationPolicy;
  readonly actorId: PrincipalId;
  readonly at: IsoTimestamp;
}

/**
 * Authoritative facts from the host/application, never raw HTTP evidence fields.
 * Core checks bindings; it cannot authenticate a runner, verifier, or permission.
 */
export interface ReviewContext {
  readonly collection: Collection;
  readonly validationPolicy: ValidationPolicy;
  readonly expectedStagingBuildId: string;
  readonly trustedAttesterIds: readonly PrincipalId[];
  readonly at: IsoTimestamp;
}

export type EvidenceSubmission = Omit<
  VerificationEvidence,
  "version" | "hash" | "attestation"
>;

function expectedRevision(article: Article, expected: number): void {
  keys(
    article,
    ["id", "state", "current", "evidence", "review", "published"],
    "article",
  );
  if (!["draft", "in-review", "published", "retired"].includes(article.state)) {
    invalid("state", "Unknown article state");
  }
  count(expected, "expectedRevision");
  if (
    article.current.articleId !== article.id ||
    article.current.number !== expected
  ) {
    throw new KnowledgeBaseError(
      "conflict",
      "expectedRevision",
      "Article revision has changed",
    );
  }
}

function withoutReview(article: Article): Omit<Article, "review"> {
  const { review: _review, ...rest } = article;
  return rest;
}

function usable(article: Article): void {
  if (article.state === "retired") {
    throw new KnowledgeBaseError(
      "transition",
      "state",
      "Retired articles need a new draft",
    );
  }
}

async function createRevision(
  id: string,
  number: number,
  draft: ArticleDraft,
  context: DraftContext,
): Promise<ArticleRevision> {
  await verifyCollection(context.collection);
  validatePolicy(context.validationPolicy);
  const fields: Omit<ArticleRevision, "contentHash"> = {
    articleId: id,
    number,
    collectionId: context.collection.id,
    kind: draft.kind,
    title: draft.title,
    summary: draft.summary,
    content: draft.content,
    tags: draft.tags,
    applicability: draft.applicability,
    validationPolicy: {
      id: context.validationPolicy.id,
      version: context.validationPolicy.version,
    },
    createdBy: context.actorId,
    createdAt: context.at,
  };
  validateRevisionFields(fields);
  if (
    timestamp(fields.createdAt, "createdAt") <
    timestamp(context.collection.createdAt, "collection.createdAt")
  ) {
    invalid("createdAt", "Article cannot predate its collection");
  }
  return { ...fields, contentHash: await digest(fields) };
}

export async function createArticle(input: {
  readonly id: string;
  readonly draft: ArticleDraft;
  readonly context: DraftContext;
}): Promise<Article> {
  const request = structuredClone(input);
  const current = await createRevision(
    request.id,
    1,
    request.draft,
    request.context,
  );
  return immutable({ id: request.id, state: "draft", current, evidence: [] });
}

/** A collection move is a new draft, never an immediate audience override. */
export async function reviseArticle(
  article: Article,
  input: {
    readonly expectedRevision: number;
    readonly draft: ArticleDraft;
    readonly context: DraftContext;
  },
): Promise<Article> {
  const source = structuredClone(article);
  const request = structuredClone(input);
  expectedRevision(source, request.expectedRevision);
  await verifyRevision(source.current);
  if (
    timestamp(request.context.at, "at") <
    timestamp(source.current.createdAt, "createdAt")
  ) {
    invalid("at", "Revision time moved backwards");
  }
  const current = await createRevision(
    source.id,
    source.current.number + 1,
    request.draft,
    request.context,
  );
  return immutable({
    ...withoutReview(source),
    state: "draft",
    current,
    evidence: [],
  });
}

function validateReviewContext(context: ReviewContext): number {
  validatePolicy(context.validationPolicy);
  text(context.expectedStagingBuildId, "expectedStagingBuildId");
  boundedArray(
    context.trustedAttesterIds,
    "trustedAttesterIds",
    knowledgeLimits.trustedIdentities,
  );
  if (context.trustedAttesterIds.length === 0)
    invalid("trustedAttesterIds", "Trusted attesters must be explicit");
  for (const principal of context.trustedAttesterIds)
    text(principal, "trustedAttesterId");
  unique(context.trustedAttesterIds, "trustedAttesterIds");
  return timestamp(context.at, "at");
}

function evidenceFailure(field: string, message: string): never {
  throw new KnowledgeBaseError("evidence", field, message);
}

async function verifyEvidence(
  evidence: VerificationEvidence,
  revision: ArticleRevision,
  context: ReviewContext,
): Promise<void> {
  keys(
    evidence,
    [
      "id",
      "version",
      "articleId",
      "articleRevision",
      "contentHash",
      "validationPolicy",
      "checkId",
      "testKind",
      "applicability",
      "stagingBuildId",
      "steps",
      "result",
      "executedAt",
      "runnerId",
      "artifacts",
      "attestation",
      "hash",
    ],
    "evidence",
  );
  const now = validateReviewContext(context);
  text(evidence.id, "evidence.id");
  count(evidence.version, "evidence.version");
  hash(evidence.hash, "evidence.hash");
  const { hash: evidenceHash, ...fields } = evidence;
  if ((await digest(fields)) !== evidenceHash)
    evidenceFailure("evidence.hash", "Evidence changed after hashing");
  if (
    evidence.articleId !== revision.articleId ||
    evidence.articleRevision !== revision.number ||
    evidence.contentHash !== revision.contentHash ||
    canonical(evidence.validationPolicy) !==
      canonical(revision.validationPolicy) ||
    canonical(evidence.applicability) !== canonical(revision.applicability) ||
    evidence.stagingBuildId !== context.expectedStagingBuildId ||
    (revision.applicability.buildId !== undefined &&
      evidence.stagingBuildId !== revision.applicability.buildId)
  )
    evidenceFailure(
      "evidence.binding",
      "Evidence does not bind the exact draft, policy, product, and staging build",
    );
  validateApplicability(evidence.applicability);
  text(evidence.checkId, "evidence.checkId");
  text(evidence.testKind, "evidence.testKind", 64);
  text(evidence.stagingBuildId, "evidence.stagingBuildId");
  const requirement = context.validationPolicy.requirements.find(
    (item) =>
      item.id === evidence.checkId &&
      item.kind === revision.kind &&
      item.testKind === evidence.testKind,
  );
  if (requirement === undefined)
    evidenceFailure(
      "evidence.checkId",
      "Evidence does not match a required check",
    );
  text(evidence.runnerId, "evidence.runnerId");
  if (!requirement.trustedRunnerIds.includes(evidence.runnerId)) {
    evidenceFailure(
      "evidence.runnerId",
      "Runner is not trusted for this check",
    );
  }
  if (evidence.attestation === undefined || evidence.attestation === null) {
    evidenceFailure(
      "evidence.attestation",
      "A trusted verification receipt is required",
    );
  }
  keys(
    evidence.attestation,
    ["id", "verifiedBy", "verifiedAt"],
    "evidence.attestation",
  );
  text(evidence.attestation.id, "evidence.attestation.id");
  text(evidence.attestation.verifiedBy, "evidence.attestation.verifiedBy");
  if (!context.trustedAttesterIds.includes(evidence.attestation.verifiedBy)) {
    evidenceFailure(
      "evidence.attestation",
      "Evidence requires a trusted verification receipt",
    );
  }
  const executed = timestamp(evidence.executedAt, "evidence.executedAt");
  const verified = timestamp(
    evidence.attestation.verifiedAt,
    "evidence.attestation.verifiedAt",
  );
  if (
    executed < timestamp(revision.createdAt, "revision.createdAt") ||
    verified < executed ||
    verified > now ||
    executed > now ||
    now - executed > requirement.maxAgeMilliseconds
  )
    evidenceFailure(
      "evidence.executedAt",
      "Evidence is stale, future-dated, or predates the draft",
    );
  if (!["passed", "failed", "inconclusive"].includes(evidence.result)) {
    invalid("evidence.result", "Unknown evidence result");
  }
  boundedArray(evidence.steps, "evidence.steps", knowledgeLimits.steps);
  if (evidence.steps.length === 0)
    invalid("evidence.steps", "Evidence must describe its checks");
  for (const step of evidence.steps)
    text(step, "evidence.step", knowledgeLimits.stepCharacters);
  boundedArray(
    evidence.artifacts,
    "evidence.artifacts",
    knowledgeLimits.artifacts,
  );
  for (const artifact of evidence.artifacts) {
    keys(artifact, ["id", "hash"], "artifact");
    text(artifact.id, "artifact.id");
    hash(artifact.hash, "artifact.hash");
  }
  unique(
    evidence.artifacts.map((artifact) => artifact.id),
    "evidence.artifacts",
  );
}

async function verifyContextBinding(
  revision: ArticleRevision,
  context: ReviewContext,
): Promise<void> {
  const at = validateReviewContext(context);
  await verifyRevision(revision);
  await verifyCollection(context.collection);
  if (at < timestamp(context.collection.updatedAt, "collection.updatedAt")) {
    invalid(
      "at",
      "Operation time cannot predate the current collection policy",
    );
  }
  if (
    revision.collectionId !== context.collection.id ||
    revision.validationPolicy.id !== context.validationPolicy.id ||
    revision.validationPolicy.version !== context.validationPolicy.version
  ) {
    throw new KnowledgeBaseError(
      "conflict",
      "policy",
      "Review requires the current collection and validation policy",
    );
  }
}

/** Replacing evidence invalidates a pending review; history is stored by KB-02. */
export async function recordEvidence(
  article: Article,
  input: {
    readonly evidence: EvidenceSubmission;
    readonly attestation: VerificationEvidence["attestation"];
    readonly context: ReviewContext;
  },
): Promise<Article> {
  const source = structuredClone(article);
  const request = structuredClone(input);
  keys(
    request.evidence,
    [
      "id",
      "articleId",
      "articleRevision",
      "contentHash",
      "validationPolicy",
      "checkId",
      "testKind",
      "applicability",
      "stagingBuildId",
      "steps",
      "result",
      "executedAt",
      "runnerId",
      "artifacts",
    ],
    "evidence",
  );
  usable(source);
  expectedRevision(source, request.evidence.articleRevision);
  await verifyContextBinding(source.current, request.context);
  boundedArray(source.evidence, "evidence", knowledgeLimits.evidence);
  const previous = source.evidence.find(
    (item) => item.id === request.evidence.id,
  );
  const fields = {
    ...request.evidence,
    version: previous === undefined ? 1 : previous.version + 1,
    attestation: request.attestation,
  };
  count(fields.version, "evidence.version");
  const evidence: VerificationEvidence = {
    ...fields,
    hash: await digest(fields),
  };
  await verifyEvidence(evidence, source.current, request.context);
  const records = [
    ...source.evidence.filter((item) => item.id !== evidence.id),
    evidence,
  ];
  boundedArray(records, "evidence", knowledgeLimits.evidence);
  return immutable({
    ...withoutReview(source),
    state: "draft",
    evidence: records,
  });
}

async function approvalBinding(
  article: Article,
  context: ReviewContext,
): Promise<ApprovalBinding> {
  await verifyContextBinding(article.current, context);
  boundedArray(article.evidence, "evidence", knowledgeLimits.evidence);
  unique(
    article.evidence.map((item) => item.id),
    "evidence",
  );
  for (const evidence of article.evidence)
    await verifyEvidence(evidence, article.current, context);
  const requirements = context.validationPolicy.requirements.filter(
    (item) => item.kind === article.current.kind,
  );
  for (const requirement of requirements) {
    const checks = article.evidence.filter(
      (item) => item.checkId === requirement.id,
    );
    if (checks.length !== 1 || checks[0]!.result !== "passed") {
      evidenceFailure(
        "evidence.checkId",
        "Every required check needs exactly one verified passing result",
      );
    }
  }
  return {
    articleId: article.id,
    articleRevision: article.current.number,
    contentHash: article.current.contentHash,
    collectionId: context.collection.id,
    collectionPolicyVersion: context.collection.policy.version,
    collectionPolicyHash: await digest(context.collection.policy),
    applicability: article.current.applicability,
    validationPolicy: article.current.validationPolicy,
    validationPolicyHash: await digest(context.validationPolicy),
    evidence: article.evidence
      .map((item) => ({ id: item.id, version: item.version, hash: item.hash }))
      .sort((left, right) =>
        left.id === right.id ? 0 : left.id < right.id ? -1 : 1,
      ),
  };
}

export async function submitForReview(
  article: Article,
  input: { readonly expectedRevision: number; readonly context: ReviewContext },
): Promise<Article> {
  const source = structuredClone(article);
  const request = structuredClone(input);
  usable(source);
  expectedRevision(source, request.expectedRevision);
  if (source.state !== "draft") {
    throw new KnowledgeBaseError(
      "transition",
      "state",
      "Only a draft can enter review",
    );
  }
  const review = await approvalBinding(source, request.context);
  return immutable({ ...source, state: "in-review", review });
}

/** Permission checks and authenticated reviewer identity belong to KB-02. */
export async function publishArticle(
  article: Article,
  input: {
    readonly expectedRevision: number;
    readonly binding: ApprovalBinding;
    readonly reviewerId: PrincipalId;
    readonly context: ReviewContext;
  },
): Promise<Article> {
  const source = structuredClone(article);
  const request = structuredClone(input);
  expectedRevision(source, request.expectedRevision);
  text(request.reviewerId, "reviewerId");
  if (source.state !== "in-review" || source.review === undefined) {
    throw new KnowledgeBaseError(
      "transition",
      "state",
      "Publication requires a submitted review",
    );
  }
  const binding = await approvalBinding(source, request.context);
  if (
    canonical(binding) !== canonical(source.review) ||
    canonical(binding) !== canonical(request.binding)
  ) {
    throw new KnowledgeBaseError(
      "conflict",
      "approval",
      "Approval no longer matches the exact review snapshot",
    );
  }
  return immutable({
    ...withoutReview(source),
    state: "published",
    published: {
      revision: source.current,
      approval: {
        binding,
        reviewerId: request.reviewerId,
        reviewedAt: request.context.at,
      },
    },
  });
}

export function rejectReview(article: Article, expected: number): Article {
  expectedRevision(article, expected);
  if (article.state !== "in-review") {
    throw new KnowledgeBaseError(
      "transition",
      "state",
      "Only a submitted review can be rejected",
    );
  }
  return immutable({
    ...withoutReview(structuredClone(article)),
    state: "draft",
  });
}

export function retireArticle(article: Article, expected: number): Article {
  expectedRevision(article, expected);
  const { published: _published, ...rest } = withoutReview(
    structuredClone(article),
  );
  return immutable({ ...rest, state: "retired" });
}

/**
 * Policy-binding predicate only. It does not authorize a read, prove retained
 * evidence availability/revocation, or replace later retrieval's current checks.
 */
export async function isPublicationBoundToCurrentPolicies(
  article: Article,
  collection: Collection,
  policy: ValidationPolicy,
): Promise<boolean> {
  const source = structuredClone(article);
  const currentCollection = structuredClone(collection);
  const currentPolicy = structuredClone(policy);
  if (source.state === "retired" || source.published === undefined)
    return false;
  await verifyCollection(currentCollection);
  validatePolicy(currentPolicy);
  const published = source.published;
  await verifyRevision(published.revision);
  const binding = published.approval.binding;
  return (
    published.revision.articleId === source.id &&
    binding.articleId === source.id &&
    binding.articleRevision === published.revision.number &&
    binding.contentHash === published.revision.contentHash &&
    binding.collectionId === published.revision.collectionId &&
    currentCollection.id === published.revision.collectionId &&
    binding.collectionPolicyVersion === currentCollection.policy.version &&
    binding.collectionPolicyHash === (await digest(currentCollection.policy)) &&
    canonical(binding.applicability) ===
      canonical(published.revision.applicability) &&
    canonical(binding.validationPolicy) ===
      canonical(published.revision.validationPolicy) &&
    binding.validationPolicy.id === currentPolicy.id &&
    binding.validationPolicy.version === currentPolicy.version &&
    binding.validationPolicyHash === (await digest(currentPolicy))
  );
}
