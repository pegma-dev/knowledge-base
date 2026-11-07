import type { AccessContext } from "@pegma/authorization-core";
import {
  knowledgePermissions,
  type CollectionPolicy,
  type IsoTimestamp,
} from "@pegma/knowledge-base-contracts";
import {
  applyCollectionPolicy,
  createCollection,
  KnowledgeBaseError,
  knowledgeLimits,
  previewCollectionPolicy,
  validateValidationPolicy,
  type ReviewContext,
} from "@pegma/knowledge-base-core";

import {
  KnowledgeBaseNotFoundError,
  KnowledgeBasePrerequisiteError,
  requirePermission,
} from "./errors.js";
import type { KnowledgeRepository, RepositoryCommand } from "./repository.js";
import {
  canonicalJson,
  commandFingerprint,
  RepositoryConflictError,
  requireGeneration,
  requireIdentifier,
  snapshotData,
} from "./storage-helpers.js";
import type {
  CommandInput,
  GovernanceConfiguration,
  KnowledgeBaseApplication,
  KnowledgeBaseServiceOptions,
} from "./types.js";

export { requirePermission } from "./errors.js";

function dataInput<T>(value: T, fields: readonly string[]): T {
  const snapshot = snapshotData(value);
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    Object.keys(snapshot).some((field) => !fields.includes(field))
  ) {
    throw new TypeError("Command contains unsupported fields");
  }
  return snapshot;
}

function mutationInput<T extends CommandInput>(
  value: T,
  fields: readonly string[],
): T {
  const input = dataInput(value, [
    "commandId",
    "correlationId",
    "expectedGeneration",
    ...fields,
  ]);
  requireIdentifier(input.commandId, "commandId");
  requireIdentifier(input.correlationId, "correlationId");
  requireGeneration(input.expectedGeneration);
  return input;
}

function trustedTime(options: KnowledgeBaseServiceOptions): IsoTimestamp {
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

async function repositoryCommand(
  access: AccessContext,
  input: CommandInput,
  operation: string,
  options: KnowledgeBaseServiceOptions,
): Promise<RepositoryCommand> {
  requireIdentifier(access.principalId, "principalId");
  const { commandId, correlationId, ...payload } = input;
  return {
    commandId,
    correlationId,
    actorId: access.principalId,
    operation,
    fingerprint: await commandFingerprint({
      actorId: access.principalId,
      operation,
      payload,
    }),
    occurredAt: trustedTime(options),
  };
}

function anonymousUse(policy: CollectionPolicy): boolean {
  return [policy.portal, policy.bot].some(
    (use) => use.enabled && use.audience.kind === "anonymous",
  );
}

function validateConfiguration(value: GovernanceConfiguration): void {
  const fields = [
    "validationPolicy",
    "expectedStagingBuildId",
    "trustedAttesterIds",
  ];
  if (
    value === null ||
    typeof value !== "object" ||
    Object.keys(value).some((field) => !fields.includes(field))
  ) {
    throw new TypeError("Governance configuration contains unsupported fields");
  }
  const policy = value.validationPolicy;
  if (
    policy === null ||
    typeof policy !== "object" ||
    Array.isArray(policy) ||
    Object.keys(policy).some((field) => field !== "id" && field !== "version")
  ) {
    throw new TypeError("A validation policy reference is required");
  }
  requireIdentifier(policy.id, "validationPolicy.id");
  requireGeneration(policy.version, 1);
  requireIdentifier(value.expectedStagingBuildId, "expectedStagingBuildId");
  if (
    !Array.isArray(value.trustedAttesterIds) ||
    value.trustedAttesterIds.length === 0 ||
    value.trustedAttesterIds.length > knowledgeLimits.trustedIdentities ||
    new Set(value.trustedAttesterIds).size !== value.trustedAttesterIds.length
  ) {
    throw new TypeError(
      "Trusted attesters must be a bounded unique nonempty list",
    );
  }
  for (const id of value.trustedAttesterIds)
    requireIdentifier(id, "attesterId");
}

export interface CurrentGovernanceContext {
  readonly context: ReviewContext;
  readonly governanceGeneration: number;
  readonly validationGeneration: number;
}

/** Load authoritative application facts; author input cannot supply this context. */
export async function loadGovernanceContext(
  repository: KnowledgeRepository,
  collectionId: string,
  at: IsoTimestamp,
): Promise<CurrentGovernanceContext> {
  requireIdentifier(collectionId, "collectionId");
  const collection = await repository.readCollectionVersioned(collectionId);
  if (collection === null) throw new KnowledgeBaseNotFoundError("collection");
  const configuration = collection.value.configuration;
  if (configuration === undefined) {
    throw new KnowledgeBasePrerequisiteError("collection_configuration");
  }
  validateConfiguration(configuration);
  const validation = await repository.readValidationPolicyVersioned(
    configuration.validationPolicy.id,
  );
  if (
    validation === null ||
    validation.value.policy.id !== configuration.validationPolicy.id ||
    validation.value.policy.version !== configuration.validationPolicy.version
  ) {
    throw new KnowledgeBasePrerequisiteError("current_validation_policy");
  }
  validateValidationPolicy(validation.value.policy);
  const current = await repository.readCollectionVersioned(collectionId);
  if (
    current === null ||
    current.value.generation !== collection.value.generation
  ) {
    throw new RepositoryConflictError();
  }
  return snapshotData({
    context: {
      collection: collection.value.collection,
      validationPolicy: validation.value.policy,
      expectedStagingBuildId: configuration.expectedStagingBuildId,
      trustedAttesterIds: configuration.trustedAttesterIds,
      at,
    },
    governanceGeneration: collection.value.generation,
    validationGeneration: validation.value.generation,
  });
}

export function createGovernanceServices(
  repository: KnowledgeRepository,
  options: KnowledgeBaseServiceOptions,
): Pick<
  KnowledgeBaseApplication,
  | "createCollection"
  | "previewCollectionPolicy"
  | "updateCollectionPolicy"
  | "putValidationPolicy"
  | "putGovernanceConfiguration"
> {
  return {
    async createCollection(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.collectionManage);
      const input = mutationInput(request, ["collectionId", "name"]);
      requireIdentifier(input.collectionId, "collectionId");
      const command = await repositoryCommand(
        access,
        input,
        "knowledge.collection.created",
        options,
      );
      const result = await repository.executeCollection({
        id: input.collectionId,
        command,
        expectedGeneration: input.expectedGeneration,
        recheck: async () => {
          requirePermission(access, knowledgePermissions.collectionManage);
        },
        decide: async (current) => {
          if (current !== null || input.expectedGeneration !== 0) {
            throw new RepositoryConflictError();
          }
          return {
            next: {
              collection: createCollection({
                id: input.collectionId,
                name: input.name,
                actorId: access.principalId,
                at: command.occurredAt,
              }),
            },
          };
        },
      });
      return {
        value: {
          id: result.value.collection.id,
          generation: result.value.generation,
          policyVersion: result.value.collection.policy.version,
        },
        replayed: result.replayed,
      };
    },

    async previewCollectionPolicy(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.collectionManage);
      const input = dataInput(request, ["collectionId", "uses"]);
      requireIdentifier(input.collectionId, "collectionId");
      const current = await repository.readCollectionVersioned(
        input.collectionId,
      );
      if (current === null) throw new KnowledgeBaseNotFoundError("collection");
      const uses = dataInput(input.uses, ["portal", "bot"]);
      const preview = await previewCollectionPolicy(
        current.value.collection,
        uses,
      );
      requirePermission(access, knowledgePermissions.collectionManage);
      const latest = await repository.readCollectionVersioned(
        input.collectionId,
      );
      if (
        latest === null ||
        latest.value.generation !== current.value.generation
      ) {
        throw new RepositoryConflictError();
      }
      return snapshotData({ generation: current.value.generation, preview });
    },

    async updateCollectionPolicy(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.collectionManage);
      const input = mutationInput(request, [
        "collectionId",
        "preview",
        "approvePublic",
      ]);
      requireIdentifier(input.collectionId, "collectionId");
      if (
        input.approvePublic !== undefined &&
        typeof input.approvePublic !== "boolean"
      ) {
        throw new TypeError("approvePublic must be an explicit boolean");
      }
      const requiresPublicApproval = anonymousUse(input.preview.policy);
      const recheck = async () => {
        requirePermission(access, knowledgePermissions.collectionManage);
        if (requiresPublicApproval) {
          requirePermission(
            access,
            knowledgePermissions.publicCollectionApprove,
          );
          if (input.approvePublic !== true) {
            throw new KnowledgeBaseError(
              "conflict",
              "publicApproval",
              "Explicit public approval is required",
            );
          }
        }
      };
      await recheck();
      const command = await repositoryCommand(
        access,
        input,
        "knowledge.collection.policy_changed",
        options,
      );
      const result = await repository.executeCollection({
        id: input.collectionId,
        command,
        expectedGeneration: input.expectedGeneration,
        control:
          !input.preview.policy.portal.enabled &&
          !input.preview.policy.bot.enabled,
        recheck,
        decide: async (current) => {
          if (current === null)
            throw new KnowledgeBaseNotFoundError("collection");
          const preview = await previewCollectionPolicy(current.collection, {
            portal: input.preview.policy.portal,
            bot: input.preview.policy.bot,
          });
          if (canonicalJson(preview) !== canonicalJson(input.preview))
            throw new RepositoryConflictError();
          const collection = await applyCollectionPolicy(current.collection, {
            preview,
            actorId: access.principalId,
            at: command.occurredAt,
            ...(requiresPublicApproval
              ? {
                  publicApproval: {
                    collectionId: current.collection.id,
                    policyVersion: preview.policy.version,
                    policyHash: preview.policyHash,
                    reviewerId: access.principalId,
                    reviewedAt: command.occurredAt,
                  },
                }
              : {}),
          });
          return {
            next: {
              collection,
              ...(current.configuration === undefined
                ? {}
                : { configuration: current.configuration }),
            },
            auditDetails: { policyVersion: collection.policy.version },
          };
        },
      });
      return {
        value: {
          id: result.value.collection.id,
          generation: result.value.generation,
          policyVersion: result.value.collection.policy.version,
        },
        replayed: result.replayed,
      };
    },

    async putValidationPolicy(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.validationManage);
      const input = mutationInput(request, ["policy"]);
      validateValidationPolicy(input.policy);
      const command = await repositoryCommand(
        access,
        input,
        "knowledge.validation.policy_changed",
        options,
      );
      const result = await repository.executeValidationPolicy({
        id: input.policy.id,
        command,
        expectedGeneration: input.expectedGeneration,
        recheck: async () => {
          requirePermission(access, knowledgePermissions.validationManage);
        },
        decide: async (current) => {
          const expectedVersion =
            current === null ? 1 : current.policy.version + 1;
          if (input.policy.version !== expectedVersion)
            throw new RepositoryConflictError();
          return {
            next: { policy: input.policy },
            auditDetails: { policyVersion: input.policy.version },
          };
        },
      });
      return {
        value: {
          id: result.value.policy.id,
          generation: result.value.generation,
          version: result.value.policy.version,
        },
        replayed: result.replayed,
      };
    },

    async putGovernanceConfiguration(access, request) {
      access = snapshotData(access);
      requirePermission(access, knowledgePermissions.validationManage);
      const input = mutationInput(request, ["collectionId", "configuration"]);
      requireIdentifier(input.collectionId, "collectionId");
      validateConfiguration(input.configuration);
      const command = await repositoryCommand(
        access,
        input,
        "knowledge.collection.configuration_changed",
        options,
      );
      const result = await repository.executeCollection({
        id: input.collectionId,
        command,
        expectedGeneration: input.expectedGeneration,
        recheck: async () => {
          requirePermission(access, knowledgePermissions.validationManage);
        },
        decide: async (current) => {
          if (current === null)
            throw new KnowledgeBaseNotFoundError("collection");
          const validation = await repository.readValidationPolicyVersioned(
            input.configuration.validationPolicy.id,
          );
          if (
            validation === null ||
            canonicalJson(input.configuration.validationPolicy) !==
              canonicalJson({
                id: validation.value.policy.id,
                version: validation.value.policy.version,
              })
          ) {
            throw new KnowledgeBasePrerequisiteError(
              "current_validation_policy",
            );
          }
          validateValidationPolicy(validation.value.policy);
          return {
            next: {
              collection: current.collection,
              configuration: input.configuration,
            },
            auditDetails: { policyVersion: validation.value.policy.version },
          };
        },
      });
      return {
        value: {
          id: result.value.collection.id,
          generation: result.value.generation,
          policyVersion: result.value.collection.policy.version,
        },
        replayed: result.replayed,
      };
    },
  };
}
