import type { AccessContext } from "@pegma/authorization-core";
import {
  knowledgePermissions,
  type ArticleRevision,
  type KnowledgePermission,
  type VerificationEvidence,
} from "@pegma/knowledge-base-contracts";
import {
  createArticle,
  KnowledgeBaseError,
  publishArticle as publishCoreArticle,
  recordEvidence,
  rejectReview as rejectCoreReview,
  retireArticle as retireCoreArticle,
  reviseArticle,
  submitForReview as submitCoreReview,
} from "@pegma/knowledge-base-core";

import {
  KnowledgeBaseNotFoundError,
  KnowledgeBasePrerequisiteError,
  requirePermission,
} from "./errors.js";
import { loadGovernanceContext } from "./governance.js";
import { maximumRecordNativeBytes, type StoredArticle } from "./records.js";
import type {
  KnowledgeRepository,
  RepositoryCommand,
  RepositoryResult,
} from "./repository.js";
import {
  canonicalJson,
  fingerprint,
  RepositoryCapacityError,
  RepositoryConflictError,
  RepositoryIntegrityError,
  requireGeneration,
  requireIdentifier,
  snapshotData,
} from "./storage-helpers.js";
import type {
  ArticleAcknowledgement,
  ArticleCommandInput,
  CommandResult,
  KnowledgeBaseApplication,
  KnowledgeBaseServiceOptions,
  PrivateSourceReference,
  ReviewSnapshot,
  SourceSnapshot,
} from "./types.js";

type ArticleMethods = Pick<
  KnowledgeBaseApplication,
  | "createDraft"
  | "updateDraft"
  | "submitEvidence"
  | "submitForReview"
  | "publishArticle"
  | "rejectReview"
  | "retireArticle"
  | "setProvenance"
  | "revokeEvidence"
>;

type ArticleChange = {
  readonly next: Omit<StoredArticle, "generation">;
  readonly auditDetails?: Readonly<
    Record<string, string | number | boolean | null>
  >;
};

const commandFields = [
  "commandId",
  "correlationId",
  "expectedGeneration",
  "articleId",
] as const;
const maximumSourceReferences = 32;

function boundedText(
  value: unknown,
  field: string,
  maximum = 1_000,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new TypeError(field + " must be bounded nonempty text");
}

function allowedFields(
  value: object,
  allowed: readonly string[],
  field: string,
): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new TypeError(field + " contains unsupported fields");
}

function commandSnapshot<T extends ArticleCommandInput>(
  access: AccessContext,
  input: T,
  permission: KnowledgePermission,
  extra: readonly string[],
): { readonly access: AccessContext; readonly input: T } {
  const caller = snapshotData(access);
  requirePermission(caller, permission);
  const encoded = canonicalJson(input);
  if (new TextEncoder().encode(encoded).byteLength > maximumRecordNativeBytes) {
    throw new RepositoryCapacityError("command_bytes");
  }
  const command = JSON.parse(encoded) as T;
  allowedFields(command, [...commandFields, ...extra], "command");
  requireIdentifier(caller.principalId, "principalId");
  requireIdentifier(command.articleId, "articleId");
  requireIdentifier(command.commandId, "commandId");
  requireIdentifier(command.correlationId, "correlationId");
  requireGeneration(command.expectedGeneration);
  return { access: caller, input: command };
}

function requireArticle(current: StoredArticle | null): StoredArticle {
  if (current === null) throw new KnowledgeBaseNotFoundError("article");
  return current;
}

function nextState(current: StoredArticle): Omit<StoredArticle, "generation"> {
  const { generation: _generation, ...next } = current;
  return next;
}

function withoutPendingReview(
  current: StoredArticle,
): Omit<StoredArticle, "generation" | "review"> {
  const { review: _review, ...next } = nextState(current);
  return {
    ...next,
    article:
      current.article.state === "in-review"
        ? rejectCoreReview(current.article, current.article.current.number)
        : current.article,
  };
}

function acknowledgement(
  result: RepositoryResult<StoredArticle>,
): CommandResult<ArticleAcknowledgement> {
  return {
    value: {
      id: result.value.article.id,
      generation: result.value.generation,
      articleRevision: result.value.article.current.number,
      state: result.value.article.state,
      contentHash: result.value.article.current.contentHash,
    },
    replayed: result.replayed,
  };
}

function validateReferences(
  references: readonly PrivateSourceReference[],
): void {
  if (
    !Array.isArray(references) ||
    references.length > maximumSourceReferences
  ) {
    throw new RepositoryCapacityError("source_references");
  }
  const ids = new Set<string>();
  for (const reference of references) {
    allowedFields(
      reference,
      ["id", "system", "resourceId", "version"],
      "source reference",
    );
    for (const [field, value] of Object.entries(reference)) {
      boundedText(value, "source." + field, 200);
      if (value.includes("://"))
        throw new TypeError("Source references must use opaque identifiers");
    }
    for (const field of ["id", "system", "resourceId", "version"] as const) {
      requireIdentifier(reference[field], "source." + field);
    }
    if (ids.has(reference.id))
      throw new TypeError("Source reference ids must be unique");
    ids.add(reference.id);
  }
}

async function sourceSnapshot(
  generation: number,
  references: readonly PrivateSourceReference[],
): Promise<SourceSnapshot> {
  requireGeneration(generation, 1);
  validateReferences(references);
  const fields = { generation, references: snapshotData(references) };
  return { ...fields, hash: await fingerprint(fields) };
}

async function verifySourceSnapshot(snapshot: SourceSnapshot): Promise<void> {
  requireGeneration(snapshot.generation, 1);
  validateReferences(snapshot.references);
  if (
    snapshot.hash !==
    (await fingerprint({
      generation: snapshot.generation,
      references: snapshot.references,
    }))
  )
    throw new RepositoryIntegrityError();
}

function rejectRevokedCurrentEvidence(current: StoredArticle): void {
  if (
    current.revokedEvidence.some(
      (revocation) =>
        revocation.articleRevision === current.article.current.number &&
        current.article.evidence.some(
          (evidence) =>
            evidence.id === revocation.id &&
            evidence.version === revocation.version &&
            evidence.hash === revocation.hash,
        ),
    )
  ) {
    throw new KnowledgeBaseError(
      "evidence",
      "evidence",
      "Current evidence has been revoked",
    );
  }
}

/**
 * Instance-wide staff authoring permissions are explicit. Portal/bot audience
 * authorization is applied by the separate safe-read services.
 */
export function createArticleServices(
  repository: KnowledgeRepository,
  options: KnowledgeBaseServiceOptions,
): ArticleMethods {
  async function sourcesEligible(
    article: ArticleRevision,
    snapshot: SourceSnapshot,
  ): Promise<void> {
    await verifySourceSnapshot(snapshot);
    if (snapshot.references.length === 0) return;
    const verifier = options.privateSources;
    if (
      typeof verifier?.canPublish !== "function" ||
      typeof verifier.isCurrent !== "function"
    )
      throw new KnowledgeBasePrerequisiteError("private-source-verifier");
    try {
      const request = {
        article: snapshotData(article),
        snapshot: snapshotData(snapshot),
      };
      if (
        (await verifier.isCurrent(snapshotData(request))) !== true ||
        (await verifier.canPublish(snapshotData(request))) !== true
      ) {
        throw new KnowledgeBasePrerequisiteError("source-eligibility");
      }
    } catch {
      throw new KnowledgeBasePrerequisiteError("source-eligibility");
    }
  }

  async function requireSourceAccess(
    access: AccessContext,
    articleId: string,
    references: readonly PrivateSourceReference[],
  ): Promise<void> {
    validateReferences(references);
    if (references.length === 0) return;
    const verifier = options.privateSources;
    if (typeof verifier?.canRead !== "function") {
      throw new KnowledgeBasePrerequisiteError("private-source-verifier");
    }
    for (const reference of references) {
      try {
        if (
          (await verifier.canRead({
            access: snapshotData(access),
            articleId,
            reference: snapshotData(reference),
          })) !== true
        )
          throw new KnowledgeBasePrerequisiteError("source-access");
      } catch {
        throw new KnowledgeBasePrerequisiteError("source-access");
      }
    }
  }

  async function execute<T extends ArticleCommandInput>(
    access: AccessContext,
    input: T,
    permission: KnowledgePermission,
    operation: string,
    extraFields: readonly string[],
    decide: (
      current: StoredArticle | null,
      generation: number,
      command: T,
      caller: AccessContext,
    ) => Promise<ArticleChange>,
    control = false,
    create = false,
  ): Promise<CommandResult<ArticleAcknowledgement>> {
    const request = commandSnapshot(access, input, permission, extraFields);
    if (
      create
        ? request.input.expectedGeneration !== 0
        : request.input.expectedGeneration < 1
    ) {
      throw new RepositoryConflictError();
    }
    const command: RepositoryCommand = {
      commandId: request.input.commandId,
      correlationId: request.input.correlationId,
      actorId: request.access.principalId,
      operation,
      fingerprint: await fingerprint({
        actorId: request.access.principalId,
        operation,
        payload: Object.fromEntries(
          Object.entries(request.input).filter(
            ([field]) => field !== "commandId" && field !== "correlationId",
          ),
        ),
      }),
      occurredAt: options.clock.now(),
    };
    const result = await repository.executeArticle({
      id: request.input.articleId,
      expectedGeneration: request.input.expectedGeneration,
      command,
      control,
      recheck: async (current) => {
        requirePermission(request.access, permission);
        if (!create) requireArticle(current);
        // Authoring is instance-wide, but an ordinary operation/replay still
        // confirms its current collection exists. Safety withdrawals do not
        // depend on unrelated collection/provider configuration being healthy.
        if (current !== null && !control) {
          const collection = await repository.readCollectionVersioned(
            current.article.current.collectionId,
          );
          if (collection === null)
            throw new KnowledgeBaseNotFoundError("collection");
        }
      },
      decide: async (current, generation) =>
        decide(current, generation, request.input, request.access),
    });
    return acknowledgement(result);
  }

  return {
    createDraft(access, input) {
      return execute(
        access,
        input,
        knowledgePermissions.draftWrite,
        "article.create",
        ["collectionId", "draft"],
        async (current, _generation, command, caller) => {
          if (current !== null) throw new RepositoryConflictError();
          requireIdentifier(command.collectionId, "collectionId");
          const governance = await loadGovernanceContext(
            repository,
            command.collectionId,
            options.clock.now(),
          );
          const article = await createArticle({
            id: command.articleId,
            draft: command.draft,
            context: { ...governance.context, actorId: caller.principalId },
          });
          return {
            next: {
              article,
              provenance: await sourceSnapshot(1, []),
              publicationHeld: false,
              revokedEvidence: [],
            },
          };
        },
        false,
        true,
      );
    },

    updateDraft(access, input) {
      return execute(
        access,
        input,
        knowledgePermissions.draftWrite,
        "article.update",
        ["collectionId", "draft"],
        async (current, _generation, command, caller) => {
          const stored = requireArticle(current);
          requireIdentifier(command.collectionId, "collectionId");
          const governance = await loadGovernanceContext(
            repository,
            command.collectionId,
            options.clock.now(),
          );
          const article = await reviseArticle(stored.article, {
            expectedRevision: stored.article.current.number,
            draft: command.draft,
            context: { ...governance.context, actorId: caller.principalId },
          });
          return { next: { ...withoutPendingReview(stored), article } };
        },
      );
    },

    submitEvidence(access, input) {
      return execute(
        access,
        input,
        knowledgePermissions.evidenceSubmit,
        "article.evidence.submit",
        ["evidence", "receipt"],
        async (current, _generation, command, caller) => {
          const stored = requireArticle(current);
          boundedText(command.receipt, "receipt", 8_192);
          allowedFields(
            command.evidence,
            [
              "id",
              "articleId",
              "articleRevision",
              "contentHash",
              "validationPolicy",
              "checkId",
              "testKind",
              "applicability",
              "stagingBuildId",
              "steps",
              "result",
              "executedAt",
              "runnerId",
              "artifacts",
            ],
            "evidence submission",
          );
          const verifier = options.evidenceVerifier;
          if (typeof verifier?.verify !== "function") {
            throw new KnowledgeBasePrerequisiteError("evidence-verifier");
          }
          const before = await loadGovernanceContext(
            repository,
            stored.article.current.collectionId,
            options.clock.now(),
          );
          const collection = await repository.readCollectionVersioned(
            stored.article.current.collectionId,
          );
          if (collection?.value.configuration === undefined) {
            throw new KnowledgeBasePrerequisiteError(
              "governance-configuration",
            );
          }
          let attestation: VerificationEvidence["attestation"] | null;
          try {
            const verified = await verifier.verify({
              access: snapshotData(caller),
              article: snapshotData(stored.article.current),
              submission: snapshotData(command.evidence),
              receipt: command.receipt,
              configuration: snapshotData(collection.value.configuration),
            });
            attestation =
              verified === null || verified === undefined
                ? null
                : snapshotData(verified);
          } catch {
            throw new KnowledgeBasePrerequisiteError("evidence-verifier");
          }
          if (attestation === null || attestation === undefined) {
            throw new KnowledgeBasePrerequisiteError("evidence-verifier");
          }
          const after = await loadGovernanceContext(
            repository,
            stored.article.current.collectionId,
            options.clock.now(),
          );
          if (
            before.governanceGeneration !== after.governanceGeneration ||
            before.validationGeneration !== after.validationGeneration ||
            collection.value.generation !== before.governanceGeneration
          )
            throw new RepositoryConflictError();
          const article = await recordEvidence(stored.article, {
            evidence: command.evidence,
            attestation,
            context: after.context,
          });
          return { next: { ...withoutPendingReview(stored), article } };
        },
      );
    },

    submitForReview(access, input) {
      return execute(
        access,
        input,
        knowledgePermissions.reviewSubmit,
        "article.review.submit",
        [],
        async (current, generation) => {
          const stored = requireArticle(current);
          rejectRevokedCurrentEvidence(stored);
          const before = await loadGovernanceContext(
            repository,
            stored.article.current.collectionId,
            options.clock.now(),
          );
          await sourcesEligible(stored.article.current, stored.provenance);
          const after = await loadGovernanceContext(
            repository,
            stored.article.current.collectionId,
            options.clock.now(),
          );
          if (
            before.governanceGeneration !== after.governanceGeneration ||
            before.validationGeneration !== after.validationGeneration
          )
            throw new RepositoryConflictError();
          const article = await submitCoreReview(stored.article, {
            expectedRevision: stored.article.current.number,
            context: after.context,
          });
          if (article.review === undefined)
            throw new RepositoryIntegrityError();
          const review: ReviewSnapshot = {
            articleGeneration: generation,
            binding: article.review,
            sourceSnapshotHash: stored.provenance.hash,
            sourceGeneration: stored.provenance.generation,
            governanceGeneration: after.governanceGeneration,
          };
          return { next: { ...nextState(stored), article, review } };
        },
      );
    },

    publishArticle(access, input) {
      return execute(
        access,
        input,
        knowledgePermissions.publish,
        "article.publish",
        ["review"],
        async (current, _generation, command, caller) => {
          const stored = requireArticle(current);
          rejectRevokedCurrentEvidence(stored);
          if (
            stored.review === undefined ||
            stored.review.articleGeneration !== stored.generation ||
            canonicalJson(stored.review) !== canonicalJson(command.review) ||
            stored.review.sourceGeneration !== stored.provenance.generation ||
            stored.review.sourceSnapshotHash !== stored.provenance.hash
          )
            throw new RepositoryConflictError();
          const before = await loadGovernanceContext(
            repository,
            stored.article.current.collectionId,
            options.clock.now(),
          );
          if (
            before.governanceGeneration !== stored.review.governanceGeneration
          ) {
            throw new RepositoryConflictError();
          }
          await sourcesEligible(stored.article.current, stored.provenance);
          const after = await loadGovernanceContext(
            repository,
            stored.article.current.collectionId,
            options.clock.now(),
          );
          if (
            before.governanceGeneration !== after.governanceGeneration ||
            before.validationGeneration !== after.validationGeneration
          )
            throw new RepositoryConflictError();
          const article = await publishCoreArticle(stored.article, {
            expectedRevision: stored.article.current.number,
            binding: stored.review.binding,
            reviewerId: caller.principalId,
            context: after.context,
          });
          return {
            next: {
              ...withoutPendingReview(stored),
              article,
              publicationHeld: false,
              publishedProvenance: stored.provenance,
              publicationReview: stored.review,
            },
          };
        },
      );
    },

    rejectReview(access, input) {
      return execute(
        access,
        input,
        knowledgePermissions.review,
        "article.review.reject",
        ["reason"],
        async (current, _generation, command) => {
          const stored = requireArticle(current);
          boundedText(command.reason, "reason");
          const article = rejectCoreReview(
            stored.article,
            stored.article.current.number,
          );
          return {
            next: { ...withoutPendingReview(stored), article },
            auditDetails: { reason: command.reason },
          };
        },
      );
    },

    retireArticle(access, input) {
      return execute(
        access,
        input,
        knowledgePermissions.retire,
        "article.retire",
        [],
        async (current) => {
          const stored = requireArticle(current);
          const {
            publishedProvenance: _publishedProvenance,
            publicationReview: _publicationReview,
            ...rest
          } = withoutPendingReview(stored);
          return {
            next: {
              ...rest,
              article: retireCoreArticle(
                stored.article,
                stored.article.current.number,
              ),
              publicationHeld: true,
            },
          };
        },
        true,
      );
    },

    setProvenance(access, input) {
      return execute(
        access,
        input,
        knowledgePermissions.provenanceWrite,
        "article.provenance.set",
        ["references"],
        async (current, _generation, command, caller) => {
          const stored = requireArticle(current);
          await requireSourceAccess(
            caller,
            command.articleId,
            command.references,
          );
          const provenance = await sourceSnapshot(
            stored.provenance.generation + 1,
            command.references,
          );
          return { next: { ...withoutPendingReview(stored), provenance } };
        },
      );
    },

    revokeEvidence(access, input) {
      return execute(
        access,
        input,
        knowledgePermissions.evidenceRevoke,
        "article.evidence.revoke",
        [
          "articleRevision",
          "evidenceId",
          "evidenceVersion",
          "evidenceHash",
          "reason",
        ],
        async (current, _generation, command, caller) => {
          const stored = requireArticle(current);
          requireGeneration(command.articleRevision, 1);
          requireGeneration(command.evidenceVersion, 1);
          requireIdentifier(command.evidenceId, "evidenceId");
          boundedText(command.reason, "reason");
          if (!/^[a-f0-9]{64}$/u.test(command.evidenceHash))
            throw new TypeError("Evidence hash must be SHA-256");
          const evidence = await repository.getEvidenceVersion(
            command.articleId,
            command.articleRevision,
            command.evidenceId,
            command.evidenceVersion,
          );
          if (evidence === null || evidence.hash !== command.evidenceHash) {
            throw new KnowledgeBaseNotFoundError("evidence");
          }
          if (
            stored.revokedEvidence.some(
              (marker) => marker.hash === evidence.hash,
            )
          ) {
            throw new RepositoryConflictError();
          }
          const revocation = {
            articleRevision: evidence.articleRevision,
            id: evidence.id,
            version: evidence.version,
            hash: evidence.hash,
            reason: command.reason,
            revokedBy: caller.principalId,
            revokedAt: options.clock.now(),
          };
          const published = stored.article.published;
          const referencesPublished =
            published !== undefined &&
            published.revision.number === evidence.articleRevision &&
            published.approval.binding.evidence.some(
              (binding) =>
                binding.id === evidence.id &&
                binding.version === evidence.version &&
                binding.hash === evidence.hash,
            );
          return {
            next: {
              ...withoutPendingReview(stored),
              publicationHeld: stored.publicationHeld || referencesPublished,
              revokedEvidence: [...stored.revokedEvidence, revocation],
            },
            auditDetails: {
              evidenceId: evidence.id,
              evidenceVersion: evidence.version,
              reason: command.reason,
            },
          };
        },
        true,
      );
    },
  };
}
