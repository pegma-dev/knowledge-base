import type {
  Collection,
  CollectionPolicy,
  CollectionUse,
  IsoTimestamp,
  PrincipalId,
  PublicCollectionApproval,
} from "@pegma/knowledge-base-contracts";
import {
  count,
  digest,
  immutable,
  invalid,
  keys,
  KnowledgeBaseError,
  text,
  timestamp,
} from "./validation.js";

export interface CollectionPolicyPreview {
  readonly collectionId: string;
  readonly expectedRevision: number;
  readonly policy: CollectionPolicy;
  readonly policyHash: string;
}

function validateUse(use: CollectionUse, field: string): void {
  keys(use, ["enabled", "audience"], field);
  if (use.enabled === false) {
    if (Object.keys(use).some((key) => key !== "enabled")) {
      invalid(field, "Disabled use cannot carry a hidden audience");
    }
    return;
  }
  if (use.enabled !== true || use.audience === undefined) {
    invalid(field, "Enabled use must name its audience");
  }
  if (use.audience.kind === "permission") {
    keys(use.audience, ["kind", "permission"], field + ".audience");
    text(use.audience.permission, field + ".permission");
  } else if (use.audience.kind !== "anonymous") {
    invalid(field, "Unknown collection audience");
  } else {
    keys(use.audience, ["kind"], field + ".audience");
  }
}

export function validateCollectionPolicy(policy: CollectionPolicy): void {
  keys(policy, ["version", "portal", "bot"], "collectionPolicy");
  count(policy.version, "collectionPolicy.version");
  validateUse(policy.portal, "collectionPolicy.portal");
  validateUse(policy.bot, "collectionPolicy.bot");
}

function isPublic(policy: CollectionPolicy): boolean {
  return [policy.portal, policy.bot].some(
    (use) => use.enabled && use.audience.kind === "anonymous",
  );
}

export async function verifyCollection(collection: Collection): Promise<void> {
  keys(
    collection,
    [
      "id",
      "revision",
      "name",
      "policy",
      "publicApproval",
      "createdBy",
      "createdAt",
      "updatedBy",
      "updatedAt",
    ],
    "collection",
  );
  text(collection.id, "collection.id");
  text(collection.name, "collection.name");
  count(collection.revision, "collection.revision");
  text(collection.createdBy, "collection.createdBy");
  text(collection.updatedBy, "collection.updatedBy");
  const createdAt = timestamp(collection.createdAt, "collection.createdAt");
  const updatedAt = timestamp(collection.updatedAt, "collection.updatedAt");
  if (updatedAt < createdAt)
    invalid("collection.updatedAt", "Collection time moved backwards");
  validateCollectionPolicy(collection.policy);
  if (!isPublic(collection.policy)) {
    if (collection.publicApproval !== undefined) {
      invalid(
        "publicApproval",
        "Private collection policies cannot retain public approval",
      );
    }
    return;
  }
  const approval = collection.publicApproval;
  if (
    approval === undefined ||
    approval.collectionId !== collection.id ||
    approval.policyVersion !== collection.policy.version ||
    approval.policyHash !== (await digest(collection.policy))
  ) {
    throw new KnowledgeBaseError(
      "conflict",
      "publicApproval",
      "Anonymous collection use requires exact policy approval",
    );
  }
  keys(
    approval,
    ["collectionId", "policyVersion", "policyHash", "reviewerId", "reviewedAt"],
    "publicApproval",
  );
  text(approval.reviewerId, "publicApproval.reviewerId");
  const reviewedAt = timestamp(
    approval.reviewedAt,
    "publicApproval.reviewedAt",
  );
  if (reviewedAt < createdAt || reviewedAt > updatedAt) {
    invalid(
      "publicApproval.reviewedAt",
      "Public approval time is outside the policy change",
    );
  }
}

/** Creation is always private; enabling any audience is an explicit update. */
export function createCollection(input: {
  readonly id: string;
  readonly name: string;
  readonly actorId: PrincipalId;
  readonly at: IsoTimestamp;
}): Collection {
  text(input.id, "collection.id");
  text(input.name, "collection.name");
  text(input.actorId, "actorId");
  timestamp(input.at, "at");
  return immutable({
    id: input.id,
    revision: 1,
    name: input.name,
    policy: { version: 1, portal: { enabled: false }, bot: { enabled: false } },
    createdBy: input.actorId,
    createdAt: input.at,
    updatedBy: input.actorId,
    updatedAt: input.at,
  });
}

/** A preview binds the proposed audience change to the exact current revision. */
export async function previewCollectionPolicy(
  collection: Collection,
  uses: { readonly portal: CollectionUse; readonly bot: CollectionUse },
): Promise<CollectionPolicyPreview> {
  const source = structuredClone(collection);
  const proposed = structuredClone(uses);
  await verifyCollection(source);
  const policy = {
    version: source.policy.version + 1,
    portal: proposed.portal,
    bot: proposed.bot,
  };
  validateCollectionPolicy(policy);
  return immutable({
    collectionId: source.id,
    expectedRevision: source.revision,
    policy,
    policyHash: await digest(policy),
  });
}

/** The application must authorize both the actor and any public-policy reviewer. */
export async function applyCollectionPolicy(
  collection: Collection,
  input: {
    readonly preview: CollectionPolicyPreview;
    readonly actorId: PrincipalId;
    readonly at: IsoTimestamp;
    readonly publicApproval?: PublicCollectionApproval;
  },
): Promise<Collection> {
  const source = structuredClone(collection);
  const change = structuredClone(input);
  await verifyCollection(source);
  text(change.actorId, "actorId");
  const at = timestamp(change.at, "at");
  if (at < timestamp(source.updatedAt, "collection.updatedAt")) {
    invalid("at", "Policy change time moved backwards");
  }
  if (
    change.preview.collectionId !== source.id ||
    change.preview.expectedRevision !== source.revision ||
    change.preview.policy.version !== source.policy.version + 1 ||
    change.preview.policyHash !== (await digest(change.preview.policy))
  ) {
    throw new KnowledgeBaseError(
      "conflict",
      "preview",
      "Collection policy preview is stale or changed",
    );
  }
  validateCollectionPolicy(change.preview.policy);
  count(source.revision + 1, "collection.revision");
  const next: Collection = {
    ...source,
    revision: source.revision + 1,
    policy: change.preview.policy,
    updatedBy: change.actorId,
    updatedAt: change.at,
    ...(isPublic(change.preview.policy) && change.publicApproval !== undefined
      ? { publicApproval: change.publicApproval }
      : {}),
  };
  const { publicApproval: _oldApproval, ...withoutApproval } = next;
  const result = isPublic(next.policy) ? next : withoutApproval;
  // Avoid accidentally inheriting an approval from an older public policy.
  if (isPublic(next.policy) && change.publicApproval === undefined) {
    throw new KnowledgeBaseError(
      "conflict",
      "publicApproval",
      "An explicit public-policy approval is required",
    );
  }
  await verifyCollection(result);
  return immutable(result);
}
