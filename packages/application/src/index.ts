import { createArticleServices } from "./articles.js";
import { createGovernanceServices } from "./governance.js";
import { createReadServices } from "./reads.js";
import { createKnowledgeRepository } from "./repository.js";
import { createPublicationChecker } from "./publication.js";
import { createPublishedSearchObservations } from "./published-search-observations.js";
import { resolveRetrievalLimits } from "./retrieval-limits.js";
import { createRetrievalMaintenanceServices } from "./retrieval-maintenance.js";
import { createRetrievalRepository } from "./retrieval-repository.js";
import { createRetrievalServices } from "./retrieval.js";
import type {
  KnowledgeBaseApplication,
  KnowledgeBaseApplicationOptions,
  KnowledgeBaseServiceOptions,
} from "./types.js";

/** Compose one isolated instance over the host's Store and trusted ports. */
export function createKnowledgeBaseApplication(
  options: KnowledgeBaseApplicationOptions,
): KnowledgeBaseApplication {
  const repository = createKnowledgeRepository(options.store, options.limits);
  const services: KnowledgeBaseServiceOptions = {
    clock: options.clock,
    limits: repository.limits,
    ...(options.evidenceVerifier === undefined
      ? {}
      : { evidenceVerifier: options.evidenceVerifier }),
    ...(options.privateSources === undefined
      ? {}
      : { privateSources: options.privateSources }),
  };
  const retrievalLimits = resolveRetrievalLimits(options.retrieval?.limits);
  const retrievalRepository = createRetrievalRepository(
    options.store,
    retrievalLimits,
  );
  const publications = createPublicationChecker(repository, services);
  return Object.freeze({
    publishedSearchObservations: createPublishedSearchObservations(
      options.store,
      services,
      retrievalLimits,
    ),
    ...createArticleServices(repository, services),
    ...createGovernanceServices(repository, services),
    ...createReadServices(repository, services),
    ...createRetrievalServices({
      store: options.store,
      services,
      ...(options.retrieval === undefined
        ? {}
        : { options: options.retrieval }),
    }),
    ...createRetrievalMaintenanceServices(
      repository,
      retrievalRepository,
      publications,
      { store: options.store, retrievalLimits },
    ),
  });
}

export {
  KnowledgeBaseAuthorizationError,
  KnowledgeBaseNotFoundError,
  KnowledgeBasePrerequisiteError,
} from "./errors.js";
export { knowledgeRecords, type KnowledgeRecord } from "./records.js";
export type { KnowledgeRepositoryLimits } from "./repository.js";
export {
  RepositoryCapacityError,
  RepositoryConflictError,
  RepositoryIntegrityError,
} from "./storage-helpers.js";
export type * from "./types.js";
export type * from "./retrieval-types.js";
export type * from "./published-search-observations-types.js";
export { defaultKnowledgeRetrievalLimits } from "./retrieval-types.js";
export { retrievalRecords, type RetrievalRecord } from "./retrieval-records.js";
export { knowledgePermissions } from "@pegma/knowledge-base-contracts";
export { createKnowledgeEvidenceReports } from "./evidence-reports.js";
export {
  KnowledgeEvidenceReportsError,
  KnowledgeEvidenceReportsUnavailableError,
  type KnowledgeEvidenceReportsErrorCode,
  type KnowledgeEvidenceReportsStage,
} from "./evidence-reports-errors.js";
export type * from "./evidence-reports-types.js";
