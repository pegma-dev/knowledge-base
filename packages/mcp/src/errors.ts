import {
  KnowledgeBaseAuthorizationError,
  KnowledgeBaseNotFoundError,
  KnowledgeBasePrerequisiteError,
  RepositoryCapacityError,
  RepositoryConflictError,
} from "@pegma/knowledge-base-application";
import { KnowledgeBaseError } from "@pegma/knowledge-base-core";

import type {
  KnowledgeAgentError,
  KnowledgeAgentErrorCode,
  KnowledgeAgentFailure,
  KnowledgeAgentOperation,
} from "./types.js";

const errors: Readonly<Record<KnowledgeAgentErrorCode, KnowledgeAgentError>> =
  Object.freeze({
    invalid_request: Object.freeze({
      code: "invalid_request",
      status: 400,
      message: "Invalid knowledge request.",
    }),
    forbidden: Object.freeze({
      code: "forbidden",
      status: 403,
      message: "Knowledge access is forbidden.",
    }),
    not_found: Object.freeze({
      code: "not_found",
      status: 404,
      message: "Knowledge resource is unavailable.",
    }),
    conflict: Object.freeze({
      code: "conflict",
      status: 409,
      message: "Knowledge command conflicts with current state.",
    }),
    capacity: Object.freeze({
      code: "capacity",
      status: 413,
      message: "Knowledge request or result exceeds capacity.",
    }),
    prerequisite: Object.freeze({
      code: "prerequisite",
      status: 412,
      message: "Knowledge prerequisite is not ready.",
    }),
    unavailable: Object.freeze({
      code: "unavailable",
      status: 503,
      message: "Knowledge service is unavailable.",
    }),
  });

/** Internal classification only; never exposes an exception or its message. */
export class KnowledgeAgentBoundaryError extends Error {
  constructor(readonly code: KnowledgeAgentErrorCode) {
    super("Knowledge agent boundary rejected data");
    this.name = "KnowledgeAgentBoundaryError";
  }
}

/** Unknown application/storage/verifier failures become content-free 503s. */
export function mapKnowledgeAgentError(error: unknown): KnowledgeAgentError {
  if (error instanceof KnowledgeAgentBoundaryError) return errors[error.code];
  if (error instanceof KnowledgeBaseAuthorizationError) return errors.forbidden;
  if (error instanceof KnowledgeBaseNotFoundError) return errors.not_found;
  if (error instanceof RepositoryConflictError) return errors.conflict;
  if (error instanceof RepositoryCapacityError) return errors.capacity;
  if (error instanceof KnowledgeBasePrerequisiteError)
    return errors.prerequisite;
  if (error instanceof KnowledgeBaseError) {
    if (error.code === "invalid") return errors.invalid_request;
    if (error.code === "conflict") return errors.conflict;
    return errors.prerequisite;
  }
  return errors.unavailable;
}

export function createKnowledgeAgentErrorResponse(
  code: KnowledgeAgentErrorCode,
  operation: KnowledgeAgentOperation | null = null,
): KnowledgeAgentFailure {
  return Object.freeze({ apiVersion: "1", operation, error: errors[code] });
}
