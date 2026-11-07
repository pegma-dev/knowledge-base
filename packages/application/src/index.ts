import { createArticleServices } from "./articles.js";
import { createGovernanceServices } from "./governance.js";
import { createReadServices } from "./reads.js";
import { createKnowledgeRepository } from "./repository.js";
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
    ...(options.evidenceVerifier === undefined
      ? {}
      : { evidenceVerifier: options.evidenceVerifier }),
    ...(options.privateSources === undefined
      ? {}
      : { privateSources: options.privateSources }),
  };
  return Object.freeze({
    ...createArticleServices(repository, services),
    ...createGovernanceServices(repository, services),
    ...createReadServices(repository, services),
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
export { knowledgePermissions } from "@pegma/knowledge-base-contracts";
