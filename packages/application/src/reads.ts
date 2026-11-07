import { hasPermission } from "@pegma/authorization-core";
import {
  articleKinds,
  knowledgePermissions,
  type Article,
  type IsoTimestamp,
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
  requirePermission,
} from "./errors.js";
import { loadGovernanceContext } from "./governance.js";
import type { StoredArticle } from "./records.js";
import type { KnowledgeRepository } from "./repository.js";
import {
  canonicalJson,
  RepositoryConflictError,
  RepositoryIntegrityError,
  requireIdentifier,
  snapshotData,
} from "./storage-helpers.js";
import type {
  KnowledgeBaseApplication,
  KnowledgeBaseServiceOptions,
  PrivateSourceReference,
  SourceSnapshot,
} from "./types.js";

function readInput<T>(
  value: T,
  field: string,
  extra: readonly string[] = [],
): T {
  const input = snapshotData(value);
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== field && !extra.includes(key))
  ) {
    throw new TypeError("Read contains unsupported fields");
  }
  requireIdentifier((input as Record<string, string>)[field]!, field);
  return input;
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

async function requiredArticle(
  repository: KnowledgeRepository,
  articleId: string,
): Promise<StoredArticle> {
  const current = await repository.readArticleVersioned(articleId);
  if (current === null) throw new KnowledgeBaseNotFoundError("article");
  return current.value;
}

function snapshotReferences(
  snapshot: SourceSnapshot,
): readonly PrivateSourceReference[] {
  if (!Array.isArray(snapshot.references) || snapshot.references.length > 32) {
    throw new RepositoryIntegrityError();
  }
  return snapshot.references;
}

/** Resolve only the bounded exact versions named by a retained publication. */
async function publishedEvidence(
  repository: KnowledgeRepository,
  current: StoredArticle,
): Promise<readonly VerificationEvidence[]> {
  const published = current.article.published;
  if (published === undefined) return [];
  const binding = published.approval.binding;
  if (
    !Array.isArray(binding.evidence) ||
    binding.evidence.length > knowledgeLimits.evidence
  ) {
    throw new RepositoryIntegrityError();
  }
  return Promise.all(
    binding.evidence.map(async (reference) => {
      const [evidence, revoked] = await Promise.all([
        repository.getEvidenceVersion(
          current.article.id,
          published.revision.number,
          reference.id,
          reference.version,
        ),
        repository.isEvidenceRevoked(current.article.id, reference.hash),
      ]);
      if (evidence === null || revoked || evidence.hash !== reference.hash) {
        throw new KnowledgeBaseNotFoundError("article");
      }
      return evidence;
    }),
  );
}

/** Explicit keyed staff reads and a separately authorized portal-only read. */
export function createReadServices(
  repository: KnowledgeRepository,
  options: KnowledgeBaseServiceOptions,
): Pick<
  KnowledgeBaseApplication,
  | "getCollection"
  | "getValidationPolicy"
  | "getGovernanceConfiguration"
  | "getValidationRequirements"
  | "getDraft"
  | "getEvidence"
  | "getProvenance"
  | "getReview"
  | "getPublishedArticle"
> {
  return {
    async getCollection(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.collectionRead);
      const input = readInput(request, "collectionId");
      const current = await repository.readCollectionVersioned(
        input.collectionId,
      );
      if (current === null) throw new KnowledgeBaseNotFoundError("collection");
      requirePermission(access, knowledgePermissions.collectionRead);
      return snapshotData({
        generation: current.value.generation,
        collection: current.value.collection,
      });
    },

    async getValidationPolicy(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.validationManage);
      const input = readInput(request, "policyId");
      const current = await repository.readValidationPolicyVersioned(
        input.policyId,
      );
      if (current === null)
        throw new KnowledgeBaseNotFoundError("validation_policy");
      requirePermission(access, knowledgePermissions.validationManage);
      return snapshotData({
        generation: current.value.generation,
        policy: current.value.policy,
      });
    },

    async getGovernanceConfiguration(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.validationManage);
      const input = readInput(request, "collectionId");
      const current = await repository.readCollectionVersioned(
        input.collectionId,
      );
      if (current === null || current.value.configuration === undefined) {
        throw new KnowledgeBaseNotFoundError("governance_configuration");
      }
      requirePermission(access, knowledgePermissions.validationManage);
      return snapshotData({
        collectionId: input.collectionId,
        generation: current.value.generation,
        configuration: current.value.configuration,
      });
    },

    async getValidationRequirements(access, request) {
      access = snapshotData(access);
      const authorize = () => {
        if (!hasPermission(access, knowledgePermissions.evidenceSubmit)) {
          requirePermission(access, knowledgePermissions.draftWrite);
        }
      };
      authorize();
      const input = readInput(request, "collectionId", ["kind"]);
      if (!articleKinds.includes(input.kind)) {
        throw new TypeError("Unknown article kind");
      }
      const governance = await loadGovernanceContext(
        repository,
        input.collectionId,
        clockTime(options),
      );
      const [collection, validation] = await Promise.all([
        repository.readCollectionVersioned(input.collectionId),
        repository.readValidationPolicyVersioned(
          governance.context.validationPolicy.id,
        ),
      ]);
      if (
        collection === null ||
        collection.value.generation !== governance.governanceGeneration ||
        validation === null ||
        validation.value.generation !== governance.validationGeneration
      ) {
        throw new RepositoryConflictError();
      }
      authorize();
      return snapshotData({
        collectionId: input.collectionId,
        governanceGeneration: governance.governanceGeneration,
        validationPolicy: {
          id: governance.context.validationPolicy.id,
          version: governance.context.validationPolicy.version,
        },
        expectedStagingBuildId: governance.context.expectedStagingBuildId,
        checks: governance.context.validationPolicy.requirements
          .filter((check) => check.kind === input.kind)
          .map((check) => ({
            id: check.id,
            testKind: check.testKind,
            maxAgeMilliseconds: check.maxAgeMilliseconds,
          })),
      });
    },

    async getDraft(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.draftRead);
      const input = readInput(request, "articleId");
      const current = await requiredArticle(repository, input.articleId);
      requirePermission(access, knowledgePermissions.draftRead);
      return snapshotData({
        articleId: current.article.id,
        generation: current.generation,
        state: current.article.state,
        revision: current.article.current,
        hasPendingReview: current.review !== undefined,
        hasPublication: current.article.published !== undefined,
        publicationHeld: current.publicationHeld,
      });
    },

    async getEvidence(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.evidenceRead);
      const input = readInput(request, "articleId");
      const current = await requiredArticle(repository, input.articleId);
      requirePermission(access, knowledgePermissions.evidenceRead);
      return snapshotData({
        articleId: current.article.id,
        generation: current.generation,
        evidence: current.article.evidence,
        revokedEvidence: current.revokedEvidence,
      });
    },

    async getProvenance(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.provenanceRead);
      const input = readInput(request, "articleId");
      const current = await requiredArticle(repository, input.articleId);
      const snapshots = [
        current.provenance,
        ...(current.publishedProvenance === undefined
          ? []
          : [current.publishedProvenance]),
      ];
      const references = new Map<string, PrivateSourceReference>();
      for (const source of snapshots) {
        for (const reference of snapshotReferences(source))
          references.set(canonicalJson(reference), reference);
      }
      if (references.size > 0) {
        const verifier = options.privateSources;
        if (verifier === undefined || typeof verifier.canRead !== "function") {
          throw new KnowledgeBasePrerequisiteError("source_access_verifier");
        }
        let allowed: readonly boolean[];
        try {
          allowed = await Promise.all(
            [...references.values()].map((reference) =>
              verifier.canRead({
                access: snapshotData(access),
                articleId: input.articleId,
                reference: snapshotData(reference),
              }),
            ),
          );
        } catch {
          throw new KnowledgeBasePrerequisiteError("source_access_verifier");
        }
        if (allowed.some((value) => value !== true))
          throw new KnowledgeBaseNotFoundError("provenance");
      }
      requirePermission(access, knowledgePermissions.provenanceRead);
      const latest = await requiredArticle(repository, input.articleId);
      if (latest.generation !== current.generation)
        throw new RepositoryConflictError();
      requirePermission(access, knowledgePermissions.provenanceRead);
      return snapshotData({
        articleId: current.article.id,
        generation: current.generation,
        snapshot: current.provenance,
        ...(current.publishedProvenance === undefined
          ? {}
          : { publishedSnapshot: current.publishedProvenance }),
      });
    },

    async getReview(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.review);
      const input = readInput(request, "articleId");
      const current = await requiredArticle(repository, input.articleId);
      if (current.review === undefined)
        throw new KnowledgeBaseNotFoundError("review");
      requirePermission(access, knowledgePermissions.review);
      return snapshotData({
        articleId: current.article.id,
        generation: current.generation,
        review: current.review,
      });
    },

    async getPublishedArticle(access, request) {
      access = snapshotData(access);
      const input = readInput(request, "articleId");
      const unavailable = () => new KnowledgeBaseNotFoundError("article");
      if (!hasPermission(access, knowledgePermissions.articleRead))
        throw unavailable();
      const current = await requiredArticle(repository, input.articleId);
      const publication = current.article.published;
      const review = current.publicationReview;
      if (
        current.article.state === "retired" ||
        current.publicationHeld ||
        publication === undefined ||
        review === undefined
      )
        throw unavailable();
      try {
        const at = clockTime(options);
        const governance = await loadGovernanceContext(
          repository,
          publication.revision.collectionId,
          at,
        );
        const portal = governance.context.collection.policy.portal;
        if (
          !portal.enabled ||
          (portal.audience.kind === "permission" &&
            !hasPermission(access, portal.audience.permission))
        )
          throw unavailable();
        if (
          review.governanceGeneration !== governance.governanceGeneration ||
          canonicalJson(review.binding) !==
            canonicalJson(publication.approval.binding)
        )
          throw unavailable();
        const source = current.publishedProvenance;
        if (
          source === undefined ||
          source.hash !== review.sourceSnapshotHash ||
          source.generation !== review.sourceGeneration
        )
          throw unavailable();
        const references = snapshotReferences(source);
        if (references.length > 0) {
          const verifier = options.privateSources;
          if (
            verifier === undefined ||
            typeof verifier.canPublish !== "function" ||
            typeof verifier.isCurrent !== "function"
          )
            throw unavailable();
          let sourceEligibility: readonly boolean[];
          try {
            sourceEligibility = await Promise.all([
              verifier.canPublish({
                article: snapshotData(publication.revision),
                snapshot: snapshotData(source),
              }),
              verifier.isCurrent({
                article: snapshotData(publication.revision),
                snapshot: snapshotData(source),
              }),
            ]);
          } catch {
            throw unavailable();
          }
          if (sourceEligibility.some((allowed) => allowed !== true))
            throw unavailable();
        }
        const [revision, evidence] = await Promise.all([
          repository.getArticleRevision(
            current.article.id,
            publication.revision.number,
          ),
          publishedEvidence(repository, current),
        ]);
        if (
          revision === null ||
          canonicalJson(revision) !== canonicalJson(publication.revision)
        )
          throw unavailable();
        if (
          !(await isPublicationBoundToCurrentPolicies(
            current.article,
            governance.context.collection,
            governance.context.validationPolicy,
          ))
        )
          throw unavailable();
        const proof: Article = {
          id: current.article.id,
          state: "in-review",
          current: revision,
          evidence,
          review: publication.approval.binding,
        };
        const approvedAt = publication.approval.reviewedAt;
        if (
          typeof approvedAt !== "string" ||
          !Number.isFinite(Date.parse(approvedAt)) ||
          new Date(approvedAt).toISOString() !== approvedAt ||
          Date.parse(approvedAt) > Date.parse(at) ||
          Date.parse(approvedAt) < Date.parse(revision.createdAt)
        )
          throw unavailable();
        // Evidence maxAge applies at approval; live revocation and authority still gate every read.
        await publishArticle(proof, {
          expectedRevision: revision.number,
          binding: publication.approval.binding,
          reviewerId: publication.approval.reviewerId,
          context: { ...governance.context, at: approvedAt },
        });
        const [latestArticle, latestCollection, latestValidation] =
          await Promise.all([
            repository.readArticleVersioned(input.articleId),
            repository.readCollectionVersioned(
              publication.revision.collectionId,
            ),
            repository.readValidationPolicyVersioned(
              governance.context.validationPolicy.id,
            ),
          ]);
        if (
          !hasPermission(access, knowledgePermissions.articleRead) ||
          latestArticle === null ||
          latestArticle.value.generation !== current.generation ||
          latestCollection === null ||
          latestCollection.value.generation !==
            governance.governanceGeneration ||
          latestValidation === null ||
          latestValidation.value.generation !== governance.validationGeneration
        )
          throw unavailable();
        if (
          portal.audience.kind === "permission" &&
          !hasPermission(access, portal.audience.permission)
        )
          throw unavailable();
        return snapshotData({
          articleId: current.article.id,
          collectionId: revision.collectionId,
          revision: revision.number,
          kind: revision.kind,
          title: revision.title,
          summary: revision.summary,
          content: revision.content,
          tags: revision.tags,
          applicability: revision.applicability,
          contentHash: revision.contentHash,
        });
      } catch (error) {
        if (
          error instanceof KnowledgeBaseError ||
          error instanceof KnowledgeBaseNotFoundError ||
          error instanceof KnowledgeBasePrerequisiteError ||
          error instanceof RepositoryConflictError ||
          error instanceof RepositoryIntegrityError
        )
          throw unavailable();
        throw error;
      }
    },
  };
}
