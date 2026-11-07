import { hasPermission, type AccessContext } from "@pegma/authorization-core";

/** Missing effective permission; hosts authenticate callers before this layer. */
export class KnowledgeBaseAuthorizationError extends Error {
  constructor(readonly permission: string) {
    super("Knowledge permission is required: " + permission);
    this.name = "KnowledgeBaseAuthorizationError";
  }
}

/** Use the same unavailable result for absent and inaccessible portal content. */
export class KnowledgeBaseNotFoundError extends Error {
  constructor(readonly resource: string) {
    super("Knowledge resource is unavailable: " + resource);
    this.name = "KnowledgeBaseNotFoundError";
  }
}

/** A trusted verifier or authoritative configuration is not ready. */
export class KnowledgeBasePrerequisiteError extends Error {
  constructor(readonly prerequisite: string) {
    super("Knowledge prerequisite is not ready: " + prerequisite);
    this.name = "KnowledgeBasePrerequisiteError";
  }
}

export function requirePermission(
  access: AccessContext,
  permission: string,
): void {
  if (!hasPermission(access, permission)) {
    throw new KnowledgeBaseAuthorizationError(permission);
  }
}
