import { hasPermission, type AccessContext } from "@pegma/authorization-core";
import {
  knowledgePermissions,
  type Applicability,
  type Article,
  type ArticleRevision,
  type CollectionUse,
  type IsoTimestamp,
  type ValidationPolicyReference,
  type VerificationEvidence,
} from "@pegma/knowledge-base-contracts";
import {
  isPublicationBoundToCurrentPolicies,
  KnowledgeBaseError,
  knowledgeLimits,
  publishArticle,
} from "@pegma/knowledge-base-core";

import {
  KnowledgeBaseNotFoundError,
  KnowledgeBasePrerequisiteError,
} from "./errors.js";
import { loadGovernanceContext } from "./governance.js";
import type {
  ArticlePublicationState,
  KnowledgeRepository,
} from "./repository.js";
import {
  canonicalJson,
  RepositoryCapacityError,
  RepositoryConflictError,
  RepositoryIntegrityError,
  requireIdentifier,
  snapshotData,
} from "./storage-helpers.js";
import type {
  KnowledgeBaseServiceOptions,
  PublishedArticleDto,
  SourceSnapshot,
} from "./types.js";

export type PublicationPurpose = "portal" | "bot" | "index";

export interface PublicationCheckRequest {
  readonly articleId: string;
  readonly purpose: PublicationPurpose;
  readonly access: AccessContext;
  /** Exact applicability, including absence of build/locale; no inferred fallback. */
  readonly applicability?: Applicability;
}

/** Internal authority only. Never spread source fences into customer/model DTOs. */
export interface PublicationAuthorityBinding {
  readonly articleId: string;
  readonly revision: number;
  readonly contentHash: string;
  readonly articleGeneration: number;
  readonly collectionId: string;
  readonly governanceGeneration: number;
  readonly validationPolicy: ValidationPolicyReference;
  readonly validationGeneration: number;
  readonly collectionPolicyVersion: number;
  readonly collectionPolicyHash: string;
  readonly validationPolicyHash: string;
  readonly sourceGeneration: number;
  readonly sourceSnapshotHash: string;
}

export interface CheckedPublication {
  readonly article: PublishedArticleDto;
  readonly binding: PublicationAuthorityBinding;
  /** Whether this effective caller can browse the independently governed portal. */
  readonly portalBrowseable: boolean;
  /** Maintenance metadata under the same governance fence, never an access grant. */
  readonly enabledUses: readonly ("portal" | "bot")[];
}

interface ConfirmationState {
  readonly access: AccessContext;
  readonly purpose: PublicationPurpose;
  readonly binding: PublicationAuthorityBinding;
  readonly revision: ArticleRevision;
  readonly source: SourceSnapshot;
  readonly use?: CollectionUse;
}

function unavailable(): KnowledgeBaseNotFoundError {
  return new KnowledgeBaseNotFoundError("article");
}

function clockTime(options: KnowledgeBaseServiceOptions): IsoTimestamp {
  const at = options.clock.now();
  if (
    typeof at !== "string" ||
    !Number.isFinite(Date.parse(at)) ||
    new Date(at).toISOString() !== at
  ) {
    throw new TypeError("Clock must return a canonical ISO timestamp");
  }
  return at;
}

function allows(use: CollectionUse, access: AccessContext): boolean {
  return (
    use.enabled &&
    (use.audience.kind === "anonymous" ||
      hasPermission(access, use.audience.permission))
  );
}

function authorize(access: AccessContext, purpose: PublicationPurpose): void {
  if (purpose === "index") {
    if (!hasPermission(access, knowledgePermissions.indexManage))
      throw unavailable();
    return;
  }
  if (
    !hasPermission(access, knowledgePermissions.articleRead) ||
    (purpose === "bot" && !hasPermission(access, knowledgePermissions.botRead))
  )
    throw unavailable();
}

function isUnavailable(error: unknown): boolean {
  return (
    error instanceof KnowledgeBaseError ||
    error instanceof KnowledgeBaseNotFoundError ||
    error instanceof KnowledgeBasePrerequisiteError ||
    error instanceof RepositoryCapacityError ||
    error instanceof RepositoryConflictError ||
    error instanceof RepositoryIntegrityError
  );
}

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

async function publishedEvidence(
  repository: KnowledgeRepository,
  current: ArticlePublicationState,
): Promise<readonly VerificationEvidence[]> {
  const published = current.published;
  if (published === undefined) throw unavailable();
  const references = published.approval.binding.evidence;
  if (
    !Array.isArray(references) ||
    references.length > knowledgeLimits.evidence
  )
    throw new RepositoryIntegrityError();
  return Promise.all(
    references.map(async (reference) => {
      const [evidence, revoked] = await Promise.all([
        repository.getEvidenceVersion(
          current.articleId,
          published.revision.number,
          reference.id,
          reference.version,
        ),
        repository.isEvidenceRevoked(current.articleId, reference.hash),
      ]);
      if (evidence === null || revoked || evidence.hash !== reference.hash)
        throw unavailable();
      return evidence;
    }),
  );
}

/** One authority path for portal reads, customer bot retrieval, and private indexing. */
export function createPublicationChecker(
  repository: KnowledgeRepository,
  options: KnowledgeBaseServiceOptions,
): {
  readonly check: (
    request: PublicationCheckRequest,
  ) => Promise<CheckedPublication>;
  readonly recheck: (checked: CheckedPublication) => Promise<void>;
} {
  const confirmations = new WeakMap<CheckedPublication, ConfirmationState>();

  async function confirm(state: ConfirmationState): Promise<void> {
    authorize(state.access, state.purpose);
    if (state.use !== undefined && !allows(state.use, state.access))
      throw unavailable();
    if (
      !Array.isArray(state.source.references) ||
      state.source.references.length > 32
    )
      throw new RepositoryIntegrityError();
    if (state.source.references.length > 0) {
      const verifier = options.privateSources;
      if (
        typeof verifier?.canPublish !== "function" ||
        typeof verifier.isCurrent !== "function"
      )
        throw unavailable();
      let eligible: readonly boolean[];
      try {
        eligible = await Promise.all([
          verifier.canPublish({
            article: snapshotData(state.revision),
            snapshot: snapshotData(state.source),
          }),
          verifier.isCurrent({
            article: snapshotData(state.revision),
            snapshot: snapshotData(state.source),
          }),
        ]);
      } catch {
        throw unavailable();
      }
      if (eligible.some((value) => value !== true)) throw unavailable();
    }
    const [article, collection, validation] = await Promise.all([
      repository.readResourceGeneration("article", state.binding.articleId),
      repository.readResourceGeneration(
        "collection",
        state.binding.collectionId,
      ),
      repository.readResourceGeneration(
        "validation",
        state.binding.validationPolicy.id,
      ),
    ]);
    if (
      article !== state.binding.articleGeneration ||
      collection !== state.binding.governanceGeneration ||
      validation !== state.binding.validationGeneration
    )
      throw unavailable();
    authorize(state.access, state.purpose);
  }

  return {
    async check(request) {
      const access = immutable(snapshotData(request.access));
      const articleId = request.articleId;
      requireIdentifier(articleId, "articleId");
      if (!["portal", "bot", "index"].includes(request.purpose))
        throw new TypeError("Unknown publication purpose");
      const purpose = request.purpose;
      const applicability =
        request.applicability === undefined
          ? undefined
          : snapshotData(request.applicability);
      authorize(access, purpose);
      try {
        const loaded =
          await repository.readArticlePublicationVersioned(articleId);
        const current = loaded?.value;
        const publication = current?.published;
        const review = current?.publicationReview;
        const source = current?.publishedProvenance;
        if (
          current === undefined ||
          current.state === "retired" ||
          current.publicationHeld ||
          publication === undefined ||
          review === undefined ||
          source === undefined
        )
          throw unavailable();
        const revision = publication.revision;
        if (
          applicability !== undefined &&
          canonicalJson(applicability) !== canonicalJson(revision.applicability)
        )
          throw unavailable();
        const at = clockTime(options);
        const governance = await loadGovernanceContext(
          repository,
          revision.collectionId,
          at,
        );
        const policy = governance.context.collection.policy;
        const enabledUses: ("portal" | "bot")[] = [];
        if (policy.portal.enabled) enabledUses.push("portal");
        if (policy.bot.enabled) enabledUses.push("bot");
        const use = purpose === "index" ? undefined : policy[purpose];
        if (use === undefined ? enabledUses.length === 0 : !allows(use, access))
          throw unavailable();
        if (
          review.governanceGeneration !== governance.governanceGeneration ||
          canonicalJson(review.binding) !==
            canonicalJson(publication.approval.binding) ||
          source.hash !== review.sourceSnapshotHash ||
          source.generation !== review.sourceGeneration
        )
          throw unavailable();
        const evidence = await publishedEvidence(repository, current);
        const proof: Article = {
          id: articleId,
          state: "in-review",
          current: revision,
          evidence,
          review: publication.approval.binding,
        };
        const publishedArticle: Article = {
          ...proof,
          state: "published",
          published: publication,
        };
        if (
          !(await isPublicationBoundToCurrentPolicies(
            publishedArticle,
            governance.context.collection,
            governance.context.validationPolicy,
          ))
        )
          throw unavailable();
        const approvedAt = publication.approval.reviewedAt;
        if (
          typeof approvedAt !== "string" ||
          !Number.isFinite(Date.parse(approvedAt)) ||
          new Date(approvedAt).toISOString() !== approvedAt ||
          Date.parse(approvedAt) > Date.parse(at) ||
          Date.parse(approvedAt) < Date.parse(revision.createdAt)
        )
          throw unavailable();
        await publishArticle(proof, {
          expectedRevision: revision.number,
          binding: publication.approval.binding,
          reviewerId: publication.approval.reviewerId,
          context: { ...governance.context, at: approvedAt },
        });
        const binding: PublicationAuthorityBinding = {
          articleId,
          revision: revision.number,
          contentHash: revision.contentHash,
          articleGeneration: current.generation,
          collectionId: revision.collectionId,
          governanceGeneration: governance.governanceGeneration,
          validationPolicy: revision.validationPolicy,
          validationGeneration: governance.validationGeneration,
          collectionPolicyVersion:
            publication.approval.binding.collectionPolicyVersion,
          collectionPolicyHash:
            publication.approval.binding.collectionPolicyHash,
          validationPolicyHash:
            publication.approval.binding.validationPolicyHash,
          sourceGeneration: source.generation,
          sourceSnapshotHash: source.hash,
        };
        const state = immutable(
          snapshotData({
            access,
            purpose,
            binding,
            revision,
            source,
            ...(use === undefined ? {} : { use }),
          }),
        );
        await confirm(state);
        const checked = immutable(
          snapshotData({
            article: {
              articleId,
              collectionId: revision.collectionId,
              revision: revision.number,
              kind: revision.kind,
              title: revision.title,
              summary: revision.summary,
              content: revision.content,
              tags: revision.tags,
              applicability: revision.applicability,
              contentHash: revision.contentHash,
            },
            binding,
            portalBrowseable:
              hasPermission(access, knowledgePermissions.articleRead) &&
              allows(policy.portal, access),
            enabledUses,
          }),
        );
        confirmations.set(checked, state);
        return checked;
      } catch (error) {
        if (purpose === "index" && error instanceof RepositoryCapacityError)
          throw error;
        if (isUnavailable(error)) throw unavailable();
        throw error;
      }
    },
    async recheck(checked) {
      const state = confirmations.get(checked);
      if (state === undefined) throw unavailable();
      try {
        await confirm(state);
      } catch (error) {
        if (
          state.purpose === "index" &&
          error instanceof RepositoryCapacityError
        )
          throw error;
        if (isUnavailable(error)) throw unavailable();
        throw error;
      }
    },
  };
}
