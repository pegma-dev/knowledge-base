import type { AccessContext } from "@pegma/authorization-core";

import {
  createKnowledgeAgentErrorResponse,
  KnowledgeAgentBoundaryError,
  mapKnowledgeAgentError,
} from "./errors.js";
import {
  knowledgeAgentEnvelopeSchema,
  knowledgeAgentResultSchemas,
  resolveKnowledgeAgentLimits,
  snapshotKnowledgeAgentJson,
} from "./schemas.js";
import {
  knowledgeAgentScopes,
  type KnowledgeAgentDispatcher,
  type KnowledgeAgentDispatcherOptions,
  type KnowledgeAgentEnvelope,
  type KnowledgeAgentIdentity,
  type KnowledgeAgentOperation,
  type KnowledgeAgentSuccess,
} from "./types.js";

const initialPermissions = Object.freeze(Object.values(knowledgeAgentScopes));
// Trusted host authority is independently bounded. Client payload array limits
// must not reject an administrator's broad context before it can be attenuated.
const maximumAuthorityItems = 256;
const maximumAuthorityCharacters = 1_024;

function own(value: unknown, key: string): unknown {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new KnowledgeAgentBoundaryError("forbidden");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor))
    throw new KnowledgeAgentBoundaryError("forbidden");
  return descriptor.value;
}

function trustedText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)
  ) {
    throw new KnowledgeAgentBoundaryError("forbidden");
  }
  return value;
}

function knownPermissions(value: unknown): ReadonlySet<string> {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw new KnowledgeAgentBoundaryError("forbidden");
  }
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (
    length === undefined ||
    !("value" in length) ||
    typeof length.value !== "number" ||
    length.value > maximumAuthorityItems ||
    Reflect.ownKeys(value).length !== length.value + 1
  ) {
    throw new KnowledgeAgentBoundaryError("forbidden");
  }
  const result = new Set<string>();
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw new KnowledgeAgentBoundaryError("forbidden");
    }
    const permission: unknown = descriptor.value;
    if (
      typeof permission !== "string" ||
      permission.length > maximumAuthorityCharacters
    ) {
      throw new KnowledgeAgentBoundaryError("forbidden");
    }
    if (initialPermissions.some((known) => known === permission))
      result.add(permission);
  }
  return result;
}

/** Snapshot the exact least-authority context without reading host role data. */
function effectiveAccess(
  identity: KnowledgeAgentIdentity,
  resource: string,
): AccessContext {
  if (trustedText(own(identity, "resource"), 2_048) !== resource)
    throw new KnowledgeAgentBoundaryError("forbidden");
  trustedText(own(identity, "clientId"), 200);
  const scopes = knownPermissions(own(identity, "scopes"));
  const access = own(identity, "access");
  const principalId = trustedText(own(access, "principalId"), 200);
  const policyVersion = trustedText(own(access, "policyVersion"), 200);
  const currentPermissions = knownPermissions(own(access, "permissions"));
  return Object.freeze({
    principalId,
    policyVersion,
    roles: Object.freeze([]),
    entitlements: Object.freeze([]),
    permissions: Object.freeze(
      initialPermissions.filter(
        (permission) =>
          scopes.has(permission) && currentPermissions.has(permission),
      ),
    ),
  });
}

function requireOperation(
  access: AccessContext,
  operation: KnowledgeAgentOperation,
): void {
  const has = (permission: string) => access.permissions.includes(permission);
  const allowed =
    operation === "getValidationRequirements"
      ? has(knowledgeAgentScopes.draftWrite) ||
        has(knowledgeAgentScopes.evidenceSubmit)
      : has(
          operation === "getDraft"
            ? knowledgeAgentScopes.draftRead
            : operation === "submitEvidence"
              ? knowledgeAgentScopes.evidenceSubmit
              : knowledgeAgentScopes.draftWrite,
        );
  if (!allowed) throw new KnowledgeAgentBoundaryError("forbidden");
}

/**
 * One versioned least-authority boundary shared by HTTP and MCP. Authentication,
 * credential issuance, current access resolution, and rate limits are host work.
 */
export function createKnowledgeAgentDispatcher(
  options: KnowledgeAgentDispatcherOptions,
): KnowledgeAgentDispatcher {
  const limits = resolveKnowledgeAgentLimits(options.limits);
  const resource = trustedText(options.resource, 2_048);
  const application = options.application;
  return Object.freeze({
    limits,
    async dispatch(identity: KnowledgeAgentIdentity, request: unknown) {
      let operation: KnowledgeAgentOperation | null = null;
      try {
        // All caller-owned objects are detached before the first application
        // await. The application still performs current resource/replay checks.
        const access = effectiveAccess(identity, resource);
        const snapshot = snapshotKnowledgeAgentJson(request, limits);
        const parsed = knowledgeAgentEnvelopeSchema.safeParse(snapshot);
        if (!parsed.success)
          throw new KnowledgeAgentBoundaryError("invalid_request");
        const envelope = snapshotKnowledgeAgentJson(
          parsed.data,
          limits,
        ) as KnowledgeAgentEnvelope;
        operation = envelope.operation;
        requireOperation(access, operation);
        let result: unknown;
        switch (envelope.operation) {
          case "getDraft":
            result = await application.getDraft(access, envelope.input);
            break;
          case "createDraft":
            result = await application.createDraft(access, envelope.input);
            break;
          case "updateDraft":
            result = await application.updateDraft(access, envelope.input);
            break;
          case "getValidationRequirements":
            result = await application.getValidationRequirements(
              access,
              envelope.input,
            );
            break;
          case "submitEvidence":
            result = await application.submitEvidence(access, envelope.input);
            break;
        }
        let detached: unknown;
        try {
          detached = snapshotKnowledgeAgentJson(
            result,
            limits,
            limits.maxResponseBytes,
          );
        } catch (error) {
          if (
            error instanceof KnowledgeAgentBoundaryError &&
            error.code === "capacity"
          ) {
            throw error;
          }
          throw new KnowledgeAgentBoundaryError("unavailable");
        }
        const safe = knowledgeAgentResultSchemas[operation].safeParse(detached);
        if (!safe.success) throw new KnowledgeAgentBoundaryError("unavailable");
        return snapshotKnowledgeAgentJson(
          { apiVersion: "1", operation, result: safe.data },
          limits,
          limits.maxResponseBytes,
        ) as KnowledgeAgentSuccess;
      } catch (error) {
        return createKnowledgeAgentErrorResponse(
          mapKnowledgeAgentError(error).code,
          operation,
        );
      }
    },
  });
}
