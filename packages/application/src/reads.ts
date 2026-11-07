import { hasPermission } from "@pegma/authorization-core";
import {
  articleKinds,
  knowledgePermissions,
  type IsoTimestamp,
} from "@pegma/knowledge-base-contracts";

import {
  KnowledgeBaseNotFoundError,
  KnowledgeBasePrerequisiteError,
  requirePermission,
} from "./errors.js";
import { loadGovernanceContext } from "./governance.js";
import { createPublicationChecker } from "./publication.js";
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
  const publications = createPublicationChecker(repository, options);
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
      const input = readInput(request, "articleId");
      const checked = await publications.check({
        access,
        articleId: input.articleId,
        purpose: "portal",
      });
      return checked.article;
    },
  };
}
