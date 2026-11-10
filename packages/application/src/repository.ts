import {
  auditRecordId,
  defineAudit,
  type AuditDetails,
  type AuditEvent,
} from "@pegma/audit";
import type {
  IsoTimestamp,
  PrincipalId,
  VerificationEvidence,
  ArticleRevision,
  ArticleApproval,
  Article,
  PublishedArticle,
  Collection,
  ValidationPolicy,
} from "@pegma/knowledge-base-contracts";
import type {
  Store,
  TransactionAction,
  VersionedRecord,
} from "@pegma/storage-core";
import {
  knowledgeRecords,
  encodeKnowledgeRecord,
  maximumTransactionActions,
  maximumTransactionEncodedBytes,
  type KnowledgeRecord,
  type ResourceKind,
  type StoredArticle,
  type StoredCollection,
  type StoredValidationPolicy,
} from "./records.js";
import {
  canonicalJson,
  encodedBytes,
  fingerprint,
  RepositoryCapacityError,
  RepositoryConflictError,
  RepositoryIntegrityError,
  requireGeneration,
  requireIdentifier,
  snapshotData,
} from "./storage-helpers.js";
import type {
  EvidenceRevocation,
  GovernanceConfiguration,
  ReviewSnapshot,
  SourceSnapshot,
} from "./types.js";

export interface KnowledgeRepositoryLimits {
  readonly maxPhysicalRows: number;
  readonly maxRetainedBytes: number;
  readonly controlReserveRows: number;
  readonly controlReserveBytes: number;
  readonly maxArticleRevisions: number;
  readonly maxEvidenceVersions: number;
  readonly maxConflictAttempts: number;
}

export interface VersionedState<T> {
  readonly value: T;
  readonly version: string;
}
export interface RepositoryCommand {
  readonly commandId: string;
  readonly correlationId: string;
  readonly actorId: PrincipalId;
  readonly operation: string;
  readonly fingerprint: string;
  readonly occurredAt: IsoTimestamp;
}
export interface KnowledgeJobInput {
  readonly task:
    "article_changed" | "collection_changed" | "validation_changed";
  readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
}
export interface MutationInput<T> {
  readonly id: string;
  readonly command: RepositoryCommand;
  readonly expectedGeneration?: number;
  readonly control?: boolean;
  readonly recheck: (current: T | null) => Promise<void>;
  readonly decide: (
    current: T | null,
    nextGeneration: number,
  ) => Promise<{
    readonly next: Omit<T, "generation">;
    readonly jobs?: readonly KnowledgeJobInput[];
    readonly auditDetails?: AuditDetails;
  }>;
}
export interface RepositoryResult<T> {
  readonly value: T;
  readonly replayed: boolean;
}
/** Publication-only hydration; unrelated current draft/proofs remain private. */
export interface ArticlePublicationState {
  readonly articleId: string;
  readonly generation: number;
  readonly state: Article["state"];
  readonly publicationHeld: boolean;
  readonly published?: PublishedArticle;
  readonly publishedProvenance?: SourceSnapshot;
  readonly publicationReview?: ReviewSnapshot;
}
/** One operation's exact authorized C, current A/V heads and published rows. */
export interface GovernedPublicationRead {
  readonly article: VersionedState<ArticlePublicationState>;
  readonly validation: VersionedState<StoredValidationPolicy>;
}
/** Current authoring material only; excludes publication and provenance rows. */
export interface ArticleAuthoringState {
  readonly articleId: string;
  readonly generation: number;
  readonly state: Article["state"];
  readonly current: ArticleRevision;
  readonly hasPendingReview: boolean;
  readonly hasPublication: boolean;
  readonly publicationHeld: boolean;
  readonly evidence?: readonly VerificationEvidence[];
  readonly revokedEvidence?: readonly EvidenceRevocation[];
}
export interface ResourceVersion {
  readonly kind: ResourceKind;
  readonly id: string;
  readonly version: string;
}
export interface KnowledgeRepository {
  readonly limits: KnowledgeRepositoryLimits;
  readArticleVersioned(
    id: string,
  ): Promise<VersionedState<StoredArticle> | null>;
  readArticlePublicationVersioned(
    id: string,
  ): Promise<VersionedState<ArticlePublicationState> | null>;
  readGovernedPublicationVersioned(
    id: string,
    collection: VersionedState<StoredCollection>,
    expectedGeneration: number,
  ): Promise<GovernedPublicationRead | null>;
  /** Complete approved proof rows and revocation markers in one prepared wave. */
  readPublicationEvidence(
    id: string,
    publication: PublishedArticle,
  ): Promise<readonly VerificationEvidence[] | null>;
  readArticleAuthoringVersioned(
    id: string,
    includeEvidence: boolean,
  ): Promise<VersionedState<ArticleAuthoringState> | null>;
  confirmResourceVersions(resources: readonly ResourceVersion[]): Promise<void>;
  confirmGovernanceVersions(
    resources: readonly ResourceVersion[],
  ): Promise<void>;
  /** One keyed head read; never hydrates draft, evidence, or private source rows. */
  readResourceGeneration(
    kind: ResourceKind,
    id: string,
  ): Promise<number | null>;
  readCollectionVersioned(
    id: string,
  ): Promise<VersionedState<StoredCollection> | null>;
  readValidationPolicyVersioned(
    id: string,
  ): Promise<VersionedState<StoredValidationPolicy> | null>;
  getArticleRevision(
    id: string,
    revision: number,
  ): Promise<ArticleRevision | null>;
  getEvidenceVersion(
    id: string,
    articleRevision: number,
    evidenceId: string,
    version: number,
  ): Promise<VerificationEvidence | null>;
  isEvidenceRevoked(id: string, hash: string): Promise<boolean>;
  executeArticle(
    input: MutationInput<StoredArticle>,
  ): Promise<RepositoryResult<StoredArticle>>;
  executeCollection(
    input: MutationInput<StoredCollection>,
  ): Promise<RepositoryResult<StoredCollection>>;
  executeValidationPolicy(
    input: MutationInput<StoredValidationPolicy>,
  ): Promise<RepositoryResult<StoredValidationPolicy>>;
}

export const defaultKnowledgeRepositoryLimits: KnowledgeRepositoryLimits =
  Object.freeze({
    maxPhysicalRows: 1_024,
    maxRetainedBytes: 16 * 1024 * 1024,
    controlReserveRows: 32,
    controlReserveBytes: 512 * 1024,
    maxArticleRevisions: 64,
    maxEvidenceVersions: 256,
    maxConflictAttempts: 3,
  });

type State = StoredArticle | StoredCollection | StoredValidationPolicy;
interface EvidencePointer {
  readonly id: string;
  readonly articleRevision: number;
  readonly version: number;
  readonly hash: string;
}
interface ArticlePointer {
  readonly resourceKind: "article";
  readonly generation: number;
  readonly state: Article["state"];
  readonly current: number;
  readonly evidence: readonly EvidencePointer[];
  readonly provenance: number;
  readonly review?: string;
  readonly published?: { readonly revision: number; readonly approval: string };
  readonly publishedProvenance?: number;
  readonly publicationReview?: string;
  readonly publicationHeld: boolean;
  readonly revocations: readonly string[];
}
interface CollectionPointer {
  readonly resourceKind: "collection";
  readonly generation: number;
  readonly revision: number;
  readonly configuration?: string;
}
interface ValidationPointer {
  readonly resourceKind: "validation";
  readonly generation: number;
  readonly version: number;
}
type Pointer = ArticlePointer | CollectionPointer | ValidationPointer;
interface Quota {
  readonly rows: number;
  readonly bytes: number;
  readonly revisions: number;
  readonly evidence: number;
}
interface Head {
  readonly pointer: Pointer;
  readonly quota: Quota;
}
interface Receipt {
  readonly command: RepositoryCommand;
  readonly result: Pointer;
}

function limitsFor(
  overrides: Partial<KnowledgeRepositoryLimits>,
): KnowledgeRepositoryLimits {
  const names = Object.keys(defaultKnowledgeRepositoryLimits);
  if (Object.keys(overrides).some((name) => !names.includes(name)))
    throw new TypeError("Unknown knowledge repository limit");
  const limits = { ...defaultKnowledgeRepositoryLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    const minimum = name.startsWith("controlReserve") ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum)
      throw new TypeError(
        "Knowledge repository limits must be bounded integers",
      );
  }
  if (
    limits.maxPhysicalRows > 10_000 ||
    limits.maxRetainedBytes > 64 * 1024 * 1024 ||
    limits.maxArticleRevisions > 1_000 ||
    limits.maxEvidenceVersions > 1_000 ||
    limits.maxConflictAttempts > 8 ||
    limits.controlReserveRows >= limits.maxPhysicalRows ||
    limits.controlReserveBytes >= limits.maxRetainedBytes
  )
    throw new TypeError("Knowledge repository limits exceed their ceilings");
  return Object.freeze(limits);
}

export function createKnowledgeRepository(
  store: Store,
  overrides: Partial<KnowledgeRepositoryLimits> = {},
): KnowledgeRepository {
  const limits = limitsFor(snapshotData(overrides));
  const records = store.collection(knowledgeRecords);
  const partition = async (kind: ResourceKind, id: string): Promise<string> => {
    requireIdentifier(id);
    return kind + ":" + (await fingerprint([kind, id]));
  };
  const evidenceId = async (
    revision: number,
    id: string,
    version: number,
  ): Promise<string> => {
    requireGeneration(revision, 1);
    requireGeneration(version, 1);
    requireIdentifier(id);
    return (
      "evidence:" + revision + ":" + (await fingerprint(id)) + ":" + version
    );
  };
  function checkIdentity(
    row: KnowledgeRecord,
    kind: ResourceKind,
    id: string,
    scope: string,
    key: string,
  ): void {
    if (
      row.resourceKind !== kind ||
      row.resourceId !== id ||
      row.partition !== scope ||
      row.id !== key
    )
      throw new RepositoryIntegrityError();
  }
  function validatePointer(pointer: Pointer): void {
    try {
      requireGeneration(pointer.generation, 1);
      if (pointer.resourceKind === "article") {
        requireGeneration(pointer.current, 1);
        requireGeneration(pointer.provenance);
        if (
          !["draft", "in-review", "published", "retired"].includes(
            pointer.state,
          ) ||
          typeof pointer.publicationHeld !== "boolean" ||
          !Array.isArray(pointer.evidence) ||
          pointer.evidence.length > 32 ||
          !Array.isArray(pointer.revocations) ||
          pointer.revocations.length > limits.maxEvidenceVersions
        )
          throw new RepositoryIntegrityError();
        for (const evidence of pointer.evidence) {
          requireIdentifier(evidence.id);
          requireGeneration(evidence.articleRevision, 1);
          requireGeneration(evidence.version, 1);
          if (
            evidence.articleRevision !== pointer.current ||
            !/^[a-f0-9]{64}$/u.test(evidence.hash)
          )
            throw new RepositoryIntegrityError();
        }
        if (
          new Set(pointer.revocations).size !== pointer.revocations.length ||
          pointer.revocations.some(
            (hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash),
          )
        )
          throw new RepositoryIntegrityError();
        for (const key of [
          pointer.review,
          pointer.publicationReview,
          pointer.published?.approval,
        ]) {
          if (
            key !== undefined &&
            (typeof key !== "string" ||
              key.length > 300 ||
              /[^A-Za-z0-9|:._-]/u.test(key))
          )
            throw new RepositoryIntegrityError();
        }
        if (pointer.published !== undefined) {
          requireGeneration(pointer.published.revision, 1);
          if (
            pointer.publishedProvenance === undefined ||
            pointer.publicationReview === undefined
          )
            throw new RepositoryIntegrityError();
        } else if (
          pointer.publishedProvenance !== undefined ||
          pointer.publicationReview !== undefined ||
          pointer.state === "published"
        )
          throw new RepositoryIntegrityError();
        if (pointer.publishedProvenance !== undefined)
          requireGeneration(pointer.publishedProvenance);
      } else if (pointer.resourceKind === "collection") {
        requireGeneration(pointer.revision, 1);
        if (
          pointer.configuration !== undefined &&
          (typeof pointer.configuration !== "string" ||
            !/^configuration:[0-9]+$/u.test(pointer.configuration))
        )
          throw new RepositoryIntegrityError();
      } else if (pointer.resourceKind === "validation")
        requireGeneration(pointer.version, 1);
      else throw new RepositoryIntegrityError();
    } catch {
      throw new RepositoryIntegrityError();
    }
  }
  async function getRow(
    kind: ResourceKind,
    id: string,
    key: string,
  ): Promise<KnowledgeRecord | null> {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > 300 ||
      /[^A-Za-z0-9|:._-]/u.test(key)
    )
      throw new RepositoryIntegrityError();
    const scope = await partition(kind, id);
    const row = await records.get({ partition: scope, id: key });
    if (row !== null) checkIdentity(row, kind, id, scope, key);
    return row;
  }
  async function required<T>(
    kind: ResourceKind,
    id: string,
    key: string,
    expectedKind: KnowledgeRecord["kind"],
  ): Promise<T> {
    const row = await getRow(kind, id, key);
    if (row === null || row.kind !== expectedKind)
      throw new RepositoryIntegrityError();
    return row.data as T;
  }
  async function preparedRows(
    kind: ResourceKind,
    id: string,
    keys: readonly string[],
    preparedScope?: string,
  ): Promise<ReadonlyMap<string, KnowledgeRecord | null>> {
    const unique = [...new Set(keys)];
    for (const key of unique) {
      if (
        typeof key !== "string" ||
        key.length === 0 ||
        key.length > 300 ||
        /[^A-Za-z0-9|:._-]/u.test(key)
      )
        throw new RepositoryIntegrityError();
    }
    const scope = preparedScope ?? (await partition(kind, id));
    const rows = await Promise.all(
      unique.map((key) => records.get({ partition: scope, id: key })),
    );
    return new Map(
      unique.map((key, index) => {
        const row = rows[index];
        if (row === undefined) throw new RepositoryIntegrityError();
        if (row !== null) checkIdentity(row, kind, id, scope, key);
        return [key, row] as const;
      }),
    );
  }
  function planned<T>(
    rows: ReadonlyMap<string, KnowledgeRecord | null>,
    key: string,
    expectedKind: KnowledgeRecord["kind"],
  ): T {
    const row = rows.get(key);
    if (row === undefined || row === null || row.kind !== expectedKind)
      throw new RepositoryIntegrityError();
    // Separate logical references retain detached values even when they share
    // one immutable physical row in this operation's plan.
    return snapshotData(row.data) as T;
  }
  function checkedHead(
    kind: ResourceKind,
    id: string,
    scope: string,
    row: VersionedRecord<KnowledgeRecord> | null,
  ): VersionedRecord<KnowledgeRecord> | null {
    if (row === null) return null;
    checkIdentity(row.value, kind, id, scope, "head");
    try {
      if (row.value.kind !== "head") throw new RepositoryIntegrityError();
      const data = row.value.data as Head;
      if (data?.pointer?.resourceKind !== kind || data.quota === undefined)
        throw new RepositoryIntegrityError();
      requireGeneration(data.pointer.generation, 1);
      validatePointer(data.pointer);
      if (
        canonicalJson(Object.keys(data.quota).sort()) !==
        canonicalJson(["bytes", "evidence", "revisions", "rows"])
      )
        throw new RepositoryIntegrityError();
      for (const count of Object.values(data.quota)) {
        if (!Number.isSafeInteger(count) || count < 0)
          throw new RepositoryIntegrityError();
      }
      if (
        data.quota.rows < 1 ||
        data.quota.rows > limits.maxPhysicalRows ||
        data.quota.bytes > limits.maxRetainedBytes
      )
        throw new RepositoryCapacityError("stored_partition");
      const allowed =
        kind === "article"
          ? [
              "resourceKind",
              "generation",
              "state",
              "current",
              "evidence",
              "provenance",
              "review",
              "published",
              "publishedProvenance",
              "publicationReview",
              "publicationHeld",
              "revocations",
            ]
          : kind === "collection"
            ? ["resourceKind", "generation", "revision", "configuration"]
            : ["resourceKind", "generation", "version"];
      if (
        Object.keys(data).some((key) => !["pointer", "quota"].includes(key)) ||
        Object.keys(data.pointer).some((key) => !allowed.includes(key))
      )
        throw new RepositoryIntegrityError();
      return row;
    } catch (error) {
      if (
        error instanceof RepositoryCapacityError ||
        error instanceof RepositoryIntegrityError
      )
        throw error;
      throw new RepositoryIntegrityError();
    }
  }
  async function getHead(
    kind: ResourceKind,
    id: string,
  ): Promise<VersionedRecord<KnowledgeRecord> | null> {
    const scope = await partition(kind, id);
    return checkedHead(
      kind,
      id,
      scope,
      await records.getVersioned({ partition: scope, id: "head" }),
    );
  }
  async function confirmVersions(
    resources: readonly ResourceVersion[],
  ): Promise<void> {
    // Finish every async key calculation before issuing a synchronous read
    // wave, allowing a provider's optional keyed-read batching to coalesce it.
    const scopes = await Promise.all(
      resources.map(({ kind, id }) => partition(kind, id)),
    );
    const heads = await Promise.all(
      resources.map(({ kind, id }, index) =>
        records
          .getVersioned({ partition: scopes[index]!, id: "head" })
          .then((row) => checkedHead(kind, id, scopes[index]!, row)),
      ),
    );
    if (
      heads.some(
        (head, index) =>
          head === null || head.version !== resources[index]!.version,
      )
    )
      throw new RepositoryConflictError();
  }
  async function confirmResourceVersions(
    resources: readonly ResourceVersion[],
  ): Promise<void> {
    if (resources.length !== 3) throw new RepositoryIntegrityError();
    await confirmVersions(resources);
  }
  async function confirmGovernanceVersions(
    resources: readonly ResourceVersion[],
  ): Promise<void> {
    if (
      resources.length !== 2 ||
      resources[0]?.kind !== "collection" ||
      resources[1]?.kind !== "validation"
    )
      throw new RepositoryIntegrityError();
    await confirmVersions(resources);
  }
  async function readAuthoring(
    id: string,
    includeEvidence: boolean,
  ): Promise<VersionedState<ArticleAuthoringState> | null> {
    const head = await getHead("article", id);
    if (head === null) return null;
    const pointer = (head.value.data as Head).pointer;
    if (pointer.resourceKind !== "article")
      throw new RepositoryIntegrityError();
    const scope = await partition("article", id);
    const references = includeEvidence ? pointer.evidence : [];
    const revocations = includeEvidence ? pointer.revocations : [];
    const evidenceKeys = await Promise.all(
      references.map((reference) =>
        evidenceId(reference.articleRevision, reference.id, reference.version),
      ),
    );
    const keys = [
      "revision:" + pointer.current,
      ...evidenceKeys,
      ...revocations.map((hash) => "revoked:" + hash),
    ];
    // All partitions and evidence hashes are ready. Do not call getRow here:
    // its per-row async hashing would split the provider's keyed-read wave.
    const rows = await Promise.all(
      keys.map((key) => records.get({ partition: scope, id: key })),
    );
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row === null || row === undefined)
        throw new RepositoryIntegrityError();
      checkIdentity(row, "article", id, scope, keys[index]!);
    }
    const currentRow = rows[0]!;
    const current = currentRow.data as ArticleRevision;
    if (
      currentRow.kind !== "revision" ||
      current.articleId !== id ||
      current.number !== pointer.current
    )
      throw new RepositoryIntegrityError();
    const evidence = references.map((reference, index) => {
      const row = rows[index + 1]!;
      const value = row.data as VerificationEvidence;
      if (
        row.kind !== "evidence" ||
        value.articleId !== id ||
        value.articleRevision !== pointer.current ||
        value.articleRevision !== reference.articleRevision ||
        value.id !== reference.id ||
        value.version !== reference.version ||
        value.hash !== reference.hash
      )
        throw new RepositoryIntegrityError();
      return value;
    });
    const revokedEvidence = revocations.map((hash, index) => {
      const row = rows[1 + references.length + index]!;
      const value = row.data as EvidenceRevocation;
      if (row.kind !== "revocation" || value.hash !== hash)
        throw new RepositoryIntegrityError();
      return value;
    });
    return {
      version: head.version,
      value: {
        articleId: id,
        generation: pointer.generation,
        state: pointer.state,
        current,
        hasPendingReview: pointer.review !== undefined,
        hasPublication: pointer.published !== undefined,
        publicationHeld: pointer.publicationHeld,
        ...(includeEvidence ? { evidence, revokedEvidence } : {}),
      },
    };
  }
  async function getRevision(
    id: string,
    number: number,
  ): Promise<ArticleRevision | null> {
    requireGeneration(number, 1);
    const row = await getRow("article", id, "revision:" + number);
    if (row === null) return null;
    const value = row.data as ArticleRevision;
    if (
      row.kind !== "revision" ||
      value?.articleId !== id ||
      value.number !== number
    )
      throw new RepositoryIntegrityError();
    return value;
  }
  async function getEvidence(
    id: string,
    revision: number,
    identifier: string,
    version: number,
  ): Promise<VerificationEvidence | null> {
    const row = await getRow(
      "article",
      id,
      await evidenceId(revision, identifier, version),
    );
    if (row === null) return null;
    const value = row.data as VerificationEvidence;
    if (
      row.kind !== "evidence" ||
      value?.articleId !== id ||
      value.articleRevision !== revision ||
      value.id !== identifier ||
      value.version !== version
    )
      throw new RepositoryIntegrityError();
    return value;
  }
  async function hydrate(
    kind: ResourceKind,
    id: string,
    pointer: Pointer,
  ): Promise<State> {
    if (pointer.resourceKind !== kind) throw new RepositoryIntegrityError();
    validatePointer(pointer);
    if (pointer.resourceKind === "collection") {
      const policyKey = "collection-policy:" + pointer.revision;
      const rows = await preparedRows(kind, id, [
        policyKey,
        ...(pointer.configuration === undefined ? [] : [pointer.configuration]),
      ]);
      const collection = planned<Collection>(
        rows,
        policyKey,
        "collection-policy",
      );
      if (collection.id !== id || collection.revision !== pointer.revision)
        throw new RepositoryIntegrityError();
      const configuration =
        pointer.configuration === undefined
          ? undefined
          : planned<GovernanceConfiguration>(
              rows,
              pointer.configuration,
              "configuration",
            );
      return {
        generation: pointer.generation,
        collection,
        ...(configuration === undefined ? {} : { configuration }),
      };
    }
    if (pointer.resourceKind === "validation") {
      const policy = await required<ValidationPolicy>(
        kind,
        id,
        "policy:" + pointer.version,
        "policy",
      );
      if (policy.id !== id || policy.version !== pointer.version)
        throw new RepositoryIntegrityError();
      return { generation: pointer.generation, policy };
    }
    requireGeneration(pointer.current, 1);
    if (
      !Array.isArray(pointer.evidence) ||
      pointer.evidence.length > 32 ||
      !Array.isArray(pointer.revocations) ||
      pointer.revocations.length > limits.maxEvidenceVersions ||
      typeof pointer.publicationHeld !== "boolean"
    )
      throw new RepositoryIntegrityError();
    const evidenceKeys = await Promise.all(
      pointer.evidence.map((reference) =>
        evidenceId(reference.articleRevision, reference.id, reference.version),
      ),
    );
    const currentKey = "revision:" + pointer.current;
    const provenanceKey = "provenance:" + pointer.provenance;
    const publishedRevisionKey =
      pointer.published === undefined
        ? undefined
        : "revision:" + pointer.published.revision;
    const publishedProvenanceKey =
      pointer.publishedProvenance === undefined
        ? undefined
        : "provenance:" + pointer.publishedProvenance;
    const rows = await preparedRows(kind, id, [
      currentKey,
      ...evidenceKeys,
      provenanceKey,
      ...(pointer.review === undefined ? [] : [pointer.review]),
      ...(pointer.published === undefined
        ? []
        : [publishedRevisionKey!, pointer.published.approval]),
      ...(publishedProvenanceKey === undefined ? [] : [publishedProvenanceKey]),
      ...(pointer.publicationReview === undefined
        ? []
        : [pointer.publicationReview]),
      ...pointer.revocations.map((hash) => "revoked:" + hash),
    ]);
    const current = planned<ArticleRevision>(rows, currentKey, "revision");
    if (current.articleId !== id || current.number !== pointer.current)
      throw new RepositoryIntegrityError();
    const evidence = pointer.evidence.map((reference, index) => {
      const value = planned<VerificationEvidence>(
        rows,
        evidenceKeys[index]!,
        "evidence",
      );
      if (
        reference.articleRevision !== pointer.current ||
        value.articleId !== id ||
        value.articleRevision !== reference.articleRevision ||
        value.id !== reference.id ||
        value.version !== reference.version ||
        value.hash !== reference.hash
      )
        throw new RepositoryIntegrityError();
      return value;
    });
    const provenance = planned<SourceSnapshot>(
      rows,
      provenanceKey,
      "provenance",
    );
    const review =
      pointer.review === undefined
        ? undefined
        : planned<ReviewSnapshot>(rows, pointer.review, "review");
    let published: Article["published"];
    if (pointer.published !== undefined) {
      const revision = planned<ArticleRevision>(
        rows,
        publishedRevisionKey!,
        "revision",
      );
      const approval = planned<ArticleApproval>(
        rows,
        pointer.published.approval,
        "publication",
      );
      if (
        revision.articleId !== id ||
        revision.number !== pointer.published.revision ||
        approval.binding.articleId !== id ||
        approval.binding.articleRevision !== revision.number ||
        approval.binding.contentHash !== revision.contentHash
      )
        throw new RepositoryIntegrityError();
      published = { revision, approval };
    }
    const publishedProvenance =
      pointer.publishedProvenance === undefined
        ? undefined
        : planned<SourceSnapshot>(rows, publishedProvenanceKey!, "provenance");
    const publicationReview =
      pointer.publicationReview === undefined
        ? undefined
        : planned<ReviewSnapshot>(rows, pointer.publicationReview, "review");
    const revokedEvidence = pointer.revocations.map((hash) =>
      planned<EvidenceRevocation>(rows, "revoked:" + hash, "revocation"),
    );
    const article: Article = {
      id,
      state: pointer.state,
      current,
      evidence,
      ...(review === undefined ? {} : { review: review.binding }),
      ...(published === undefined ? {} : { published }),
    };
    return {
      generation: pointer.generation,
      article,
      provenance,
      publicationHeld: pointer.publicationHeld,
      revokedEvidence,
      ...(review === undefined ? {} : { review }),
      ...(publishedProvenance === undefined ? {} : { publishedProvenance }),
      ...(publicationReview === undefined ? {} : { publicationReview }),
    };
  }
  async function read<T extends State>(
    kind: ResourceKind,
    id: string,
  ): Promise<VersionedState<T> | null> {
    const row = await getHead(kind, id);
    if (row === null) return null;
    const head = row.value.data as Head;
    return {
      value: (await hydrate(kind, id, head.pointer)) as T,
      version: row.version,
    };
  }
  function publicationKeys(pointer: ArticlePointer): readonly string[] {
    if (pointer.published === undefined) return [];
    return [
      "revision:" + pointer.published.revision,
      pointer.published.approval,
      "provenance:" + pointer.publishedProvenance,
      pointer.publicationReview!,
    ];
  }
  function publicationFromRows(
    id: string,
    pointer: ArticlePointer,
    rows: ReadonlyMap<string, KnowledgeRecord | null>,
  ): ArticlePublicationState {
    const value: ArticlePublicationState = {
      articleId: id,
      generation: pointer.generation,
      state: pointer.state,
      publicationHeld: pointer.publicationHeld,
    };
    if (pointer.published === undefined) return value;
    const revisionKey = "revision:" + pointer.published.revision;
    const provenanceKey = "provenance:" + pointer.publishedProvenance;
    const revision = planned<ArticleRevision>(rows, revisionKey, "revision");
    const approval = planned<ArticleApproval>(
      rows,
      pointer.published.approval,
      "publication",
    );
    const publishedProvenance = planned<SourceSnapshot>(
      rows,
      provenanceKey,
      "provenance",
    );
    const publicationReview = planned<ReviewSnapshot>(
      rows,
      pointer.publicationReview!,
      "review",
    );
    if (
      revision.articleId !== id ||
      revision.number !== pointer.published.revision ||
      approval.binding.articleId !== id ||
      approval.binding.articleRevision !== revision.number ||
      approval.binding.contentHash !== revision.contentHash
    ) {
      throw new RepositoryIntegrityError();
    }
    return {
      ...value,
      published: { revision, approval },
      publishedProvenance,
      publicationReview,
    };
  }
  async function readPublication(
    id: string,
  ): Promise<VersionedState<ArticlePublicationState> | null> {
    const row = await getHead("article", id);
    if (row === null) return null;
    const pointer = (row.value.data as Head).pointer as ArticlePointer;
    const rows =
      pointer.published === undefined
        ? new Map<string, KnowledgeRecord | null>()
        : await preparedRows("article", id, publicationKeys(pointer));
    return {
      value: publicationFromRows(id, pointer, rows),
      version: row.version,
    };
  }
  async function readGovernedPublication(
    id: string,
    collection: VersionedState<StoredCollection>,
    expectedGeneration: number,
  ): Promise<GovernedPublicationRead | null> {
    requireGeneration(expectedGeneration, 1);
    const configured = collection.value.configuration?.validationPolicy;
    if (configured === undefined) throw new RepositoryIntegrityError();
    requireIdentifier(configured.id);
    requireGeneration(configured.version, 1);
    // The caller has already authorized this exact C. Finish both hashes
    // before dispatching any A/V head read; no A probe precedes C authority.
    const [articleScope, validationScope] = await Promise.all([
      partition("article", id),
      partition("validation", configured.id),
    ]);
    const [articleHead, validationHead] = await Promise.all([
      records
        .getVersioned({ partition: articleScope, id: "head" })
        .then((row) => checkedHead("article", id, articleScope, row)),
      records
        .getVersioned({ partition: validationScope, id: "head" })
        .then((row) =>
          checkedHead("validation", configured.id, validationScope, row),
        ),
    ]);
    if (articleHead === null || validationHead === null) return null;
    const articlePointer = (articleHead.value.data as Head).pointer;
    const validationPointer = (validationHead.value.data as Head).pointer;
    if (
      articlePointer.resourceKind !== "article" ||
      validationPointer.resourceKind !== "validation"
    )
      throw new RepositoryIntegrityError();
    if (
      articlePointer.generation !== expectedGeneration ||
      articlePointer.state === "retired" ||
      articlePointer.publicationHeld ||
      articlePointer.published === undefined
    )
      return null;
    const policyKey = "policy:" + validationPointer.version;
    // Scopes and every immutable key are ready. Both groups synchronously
    // enqueue their public Store reads before the first group is awaited.
    const [articleRows, validationRows] = await Promise.all([
      preparedRows(
        "article",
        id,
        publicationKeys(articlePointer),
        articleScope,
      ),
      preparedRows("validation", configured.id, [policyKey], validationScope),
    ]);
    const article = publicationFromRows(id, articlePointer, articleRows);
    const policy = planned<ValidationPolicy>(
      validationRows,
      policyKey,
      "policy",
    );
    if (
      article.published?.revision.collectionId !==
        collection.value.collection.id ||
      policy.id !== configured.id ||
      policy.version !== validationPointer.version
    )
      throw new RepositoryIntegrityError();
    return {
      article: { value: article, version: articleHead.version },
      validation: {
        value: { generation: validationPointer.generation, policy },
        version: validationHead.version,
      },
    };
  }
  async function readPublicationEvidence(
    id: string,
    publication: PublishedArticle,
  ): Promise<readonly VerificationEvidence[] | null> {
    const references = publication.approval.binding.evidence;
    if (!Array.isArray(references) || references.length > 32)
      throw new RepositoryIntegrityError();
    const keys = await Promise.all(
      references.map((reference) =>
        evidenceId(
          publication.revision.number,
          reference.id,
          reference.version,
        ),
      ),
    );
    const revokedKeys = references.map((reference) => {
      if (!/^[a-f0-9]{64}$/u.test(reference.hash))
        throw new RepositoryIntegrityError();
      return "revoked:" + reference.hash;
    });
    const rows = await preparedRows("article", id, [...keys, ...revokedKeys]);
    const result: VerificationEvidence[] = [];
    for (const [index, reference] of references.entries()) {
      const proof = rows.get(keys[index]!);
      const revoked = rows.get(revokedKeys[index]!);
      if (proof === undefined || revoked === undefined)
        throw new RepositoryIntegrityError();
      if (
        revoked !== null &&
        (revoked.kind !== "revocation" ||
          (revoked.data as EvidenceRevocation).hash !== reference.hash)
      )
        throw new RepositoryIntegrityError();
      if (proof === null || revoked !== null) return null;
      const value = proof.data as VerificationEvidence;
      if (
        proof.kind !== "evidence" ||
        value.articleId !== id ||
        value.articleRevision !== publication.revision.number ||
        value.id !== reference.id ||
        value.version !== reference.version ||
        value.hash !== reference.hash
      )
        throw new RepositoryIntegrityError();
      result.push(snapshotData(value));
    }
    return result;
  }
  async function execute<T extends State>(
    kind: ResourceKind,
    input: MutationInput<T>,
  ): Promise<RepositoryResult<T>> {
    const request = snapshotData({
      id: input.id,
      command: input.command,
      ...(input.expectedGeneration === undefined
        ? {}
        : { expectedGeneration: input.expectedGeneration }),
      control: input.control === true,
    });
    const recheck = input.recheck;
    const decide = input.decide;
    requireIdentifier(request.id);
    for (const field of [
      request.command.commandId,
      request.command.correlationId,
      request.command.actorId,
      request.command.operation,
    ])
      requireIdentifier(field);
    if (!/^[a-f0-9]{64}$/u.test(request.command.fingerprint))
      throw new TypeError("Expected a command fingerprint");
    const commandTime = Date.parse(request.command.occurredAt);
    if (
      typeof request.command.occurredAt !== "string" ||
      !Number.isFinite(commandTime) ||
      new Date(commandTime).toISOString() !== request.command.occurredAt
    )
      throw new TypeError("Expected canonical command time");
    if (request.expectedGeneration !== undefined)
      requireGeneration(request.expectedGeneration);
    const scope = await partition(kind, request.id);
    const commandHash = await fingerprint(request.command.commandId);
    const receiptKey = "command:" + commandHash;
    for (let attempt = 0; attempt < limits.maxConflictAttempts; attempt += 1) {
      const beforeRow = await getHead(kind, request.id);
      const beforeHead = beforeRow?.value.data as Head | undefined;
      const current =
        beforeHead === undefined
          ? null
          : ((await hydrate(kind, request.id, beforeHead.pointer)) as T);
      await recheck(current === null ? null : snapshotData(current));
      const receiptRow = await getRow(kind, request.id, receiptKey);
      if (receiptRow !== null) {
        const receipt = receiptRow.data as Receipt;
        if (
          receiptRow.kind !== "command" ||
          receipt.command.actorId !== request.command.actorId ||
          receipt.command.operation !== request.command.operation ||
          receipt.command.fingerprint !== request.command.fingerprint ||
          receipt.command.commandId !== request.command.commandId
        )
          throw new RepositoryConflictError();
        // Receipt and head reads are not a snapshot. The matching command may
        // have committed after this attempt loaded its earlier head.
        const latest = await read<T>(kind, request.id);
        await recheck(latest?.value ?? null);
        if (
          latest === null ||
          receipt.result.generation > latest.value.generation
        )
          throw new RepositoryConflictError();
        const historical = (await hydrate(
          kind,
          request.id,
          receipt.result,
        )) as T;
        return { value: historical, replayed: true };
      }
      if (
        request.expectedGeneration !== undefined &&
        request.expectedGeneration !== (current?.generation ?? 0)
      )
        throw new RepositoryConflictError();
      const generation = (current?.generation ?? 0) + 1;
      requireGeneration(generation, 1);
      const decision = snapshotData(
        await decide(
          current === null ? null : snapshotData(current),
          generation,
        ),
      );
      const next = snapshotData({ ...decision.next, generation }) as T;
      const additions: KnowledgeRecord[] = [];
      const proposals = new Map<string, KnowledgeRecord[]>();
      let immutablePlanningCollision = false;
      const buildRow = (
        id: string,
        rowKind: KnowledgeRecord["kind"],
        data: unknown,
      ): KnowledgeRecord => ({
        schemaVersion: 1,
        resourceKind: kind,
        resourceId: request.id,
        partition: scope,
        id,
        kind: rowKind,
        data: snapshotData(data),
      });
      const add = async (
        key: string,
        rowKind: KnowledgeRecord["kind"],
        data: unknown,
      ): Promise<void> => {
        const record = buildRow(key, rowKind, data);
        const pending = proposals.get(key);
        if (pending !== undefined) {
          pending.push(record);
          return;
        }
        proposals.set(key, [record]);
      };
      let pointer: Pointer;
      if (kind === "article") {
        const value = next as StoredArticle;
        const previous = current as StoredArticle | null;
        const previousPointer = beforeHead?.pointer as
          ArticlePointer | undefined;
        if (
          value.article.id !== request.id ||
          value.article.current.articleId !== request.id ||
          value.article.current.number > limits.maxArticleRevisions ||
          value.article.evidence.length > 32 ||
          value.revokedEvidence.length > limits.maxEvidenceVersions ||
          value.provenance.references.length > 32
        )
          throw new RepositoryCapacityError("article_history");
        if (
          typeof value.publicationHeld !== "boolean" ||
          canonicalJson(value.article.review ?? null) !==
            canonicalJson(value.review?.binding ?? null) ||
          (value.article.published !== undefined &&
            (value.publicationReview === undefined ||
              value.publishedProvenance === undefined)) ||
          (value.article.published === undefined &&
            (value.publicationReview !== undefined ||
              value.publishedProvenance !== undefined))
        )
          throw new RepositoryIntegrityError();
        await add(
          "revision:" + value.article.current.number,
          "revision",
          value.article.current,
        );
        for (const evidence of value.article.evidence) {
          if (
            evidence.articleId !== request.id ||
            evidence.articleRevision !== value.article.current.number
          )
            throw new RepositoryIntegrityError();
          await add(
            await evidenceId(
              evidence.articleRevision,
              evidence.id,
              evidence.version,
            ),
            "evidence",
            evidence,
          );
        }
        await add(
          "provenance:" + value.provenance.generation,
          "provenance",
          value.provenance,
        );
        if (value.publishedProvenance !== undefined)
          await add(
            "provenance:" + value.publishedProvenance.generation,
            "provenance",
            value.publishedProvenance,
          );
        const reviewKey = async (
          review: ReviewSnapshot | undefined,
          slot: string,
        ): Promise<string | undefined> => {
          if (review === undefined) return undefined;
          if (
            previousPointer?.review !== undefined &&
            previous?.review !== undefined &&
            canonicalJson(previous.review) === canonicalJson(review)
          )
            return previousPointer.review;
          if (
            previousPointer?.publicationReview !== undefined &&
            previous?.publicationReview !== undefined &&
            canonicalJson(previous.publicationReview) === canonicalJson(review)
          )
            return previousPointer.publicationReview;
          const key = "review:" + generation + ":" + slot;
          await add(key, "review", review);
          return key;
        };
        const review = await reviewKey(value.review, "pending");
        const publicationReview = await reviewKey(
          value.publicationReview,
          "publication",
        );
        let published: ArticlePointer["published"];
        if (value.article.published !== undefined) {
          await add(
            "revision:" + value.article.published.revision.number,
            "revision",
            value.article.published.revision,
          );
          const unchanged =
            previous?.article.published !== undefined &&
            canonicalJson(previous.article.published) ===
              canonicalJson(value.article.published);
          const approval =
            unchanged && previousPointer?.published !== undefined
              ? previousPointer.published.approval
              : "publication:" + generation;
          await add(approval, "publication", value.article.published.approval);
          published = {
            revision: value.article.published.revision.number,
            approval,
          };
        }
        for (const revoked of value.revokedEvidence) {
          if (!/^[a-f0-9]{64}$/u.test(revoked.hash))
            throw new RepositoryIntegrityError();
          await add("revoked:" + revoked.hash, "revocation", revoked);
        }
        for (const revoked of previous?.revokedEvidence ?? []) {
          if (
            !value.revokedEvidence.some(
              (candidate) =>
                canonicalJson(candidate) === canonicalJson(revoked),
            )
          )
            throw new RepositoryIntegrityError();
        }
        pointer = {
          resourceKind: "article",
          generation,
          state: value.article.state,
          current: value.article.current.number,
          evidence: value.article.evidence.map(
            ({ id, articleRevision, version, hash }) => ({
              id,
              articleRevision,
              version,
              hash,
            }),
          ),
          provenance: value.provenance.generation,
          publicationHeld: value.publicationHeld,
          revocations: value.revokedEvidence.map(({ hash }) => hash),
          ...(review === undefined ? {} : { review }),
          ...(published === undefined ? {} : { published }),
          ...(value.publishedProvenance === undefined
            ? {}
            : { publishedProvenance: value.publishedProvenance.generation }),
          ...(publicationReview === undefined ? {} : { publicationReview }),
        };
      } else if (kind === "collection") {
        const value = next as StoredCollection;
        const previous = current as StoredCollection | null;
        const previousPointer = beforeHead?.pointer as
          CollectionPointer | undefined;
        if (value.collection.id !== request.id)
          throw new RepositoryIntegrityError();
        await add(
          "collection-policy:" + value.collection.revision,
          "collection-policy",
          value.collection,
        );
        let configuration: string | undefined;
        if (value.configuration !== undefined) {
          configuration =
            previous?.configuration !== undefined &&
            canonicalJson(previous.configuration) ===
              canonicalJson(value.configuration)
              ? previousPointer?.configuration
              : undefined;
          configuration ??= "configuration:" + generation;
          await add(configuration, "configuration", value.configuration);
        }
        pointer = {
          resourceKind: "collection",
          generation,
          revision: value.collection.revision,
          ...(configuration === undefined ? {} : { configuration }),
        };
      } else {
        const value = next as StoredValidationPolicy;
        if (value.policy.id !== request.id)
          throw new RepositoryIntegrityError();
        await add("policy:" + value.policy.version, "policy", value.policy);
        pointer = {
          resourceKind: "validation",
          generation,
          version: value.policy.version,
        };
      }
      // Finish every immutable proposal/hash before issuing keyed I/O. This
      // map is attempt-local, including absent rows; no admission is cached
      // across a conflict or authorized receipt-first retry.
      const previousRows = await preparedRows(kind, request.id, [
        ...proposals.keys(),
      ]);
      for (const [key, candidates] of proposals) {
        const previous = previousRows.get(key);
        if (previous === undefined) throw new RepositoryIntegrityError();
        if (previous !== null) {
          if (
            candidates.some(
              (record) => canonicalJson(previous) !== canonicalJson(record),
            )
          )
            immutablePlanningCollision = true;
          continue;
        }
        const record = candidates[0]!;
        if (
          candidates.some(
            (candidate) => canonicalJson(candidate) !== canonicalJson(record),
          )
        )
          throw new RepositoryIntegrityError();
        encodeKnowledgeRecord(record);
        additions.push(record);
      }
      // A matching command may have committed after the earlier receipt read.
      // Retry that original authorized path rather than overwrite history.
      if (immutablePlanningCollision) continue;
      const audit = defineAudit<KnowledgeRecord>({
        collection: knowledgeRecords,
        toRecord: (event) => buildRow(auditRecordId(event.id), "audit", event),
        toEvent: (record) =>
          record.kind === "audit" ? (record.data as AuditEvent) : null,
      });
      const event: AuditEvent = {
        id: commandHash,
        occurredAt: request.command.occurredAt,
        actor: { kind: "principal", principalId: request.command.actorId },
        action: request.command.operation,
        subject: request.id,
        sequence: generation,
        details: {
          ...decision.auditDetails,
          correlationId: request.command.correlationId,
        },
      };
      const auditAction = audit.action(event);
      if (auditAction.action !== "insert") throw new RepositoryIntegrityError();
      additions.push(auditAction.value);
      additions.push(
        buildRow(receiptKey, "command", {
          command: request.command,
          result: pointer,
        } satisfies Receipt),
      );
      const jobs: readonly KnowledgeJobInput[] = decision.jobs ?? [
        {
          task:
            kind === "article"
              ? "article_changed"
              : kind === "collection"
                ? "collection_changed"
                : "validation_changed",
        },
      ];
      if (jobs.length > 8) throw new RepositoryCapacityError("command_jobs");
      for (const [index, job] of jobs.entries()) {
        if (
          ![
            "article_changed",
            "collection_changed",
            "validation_changed",
          ].includes(job.task)
        )
          throw new TypeError("Unknown knowledge task");
        if (
          Object.keys(job.payload ?? {}).length > 32 ||
          Object.values(job.payload ?? {}).some(
            (value) => typeof value === "string" && value.length > 2_048,
          )
        )
          throw new RepositoryCapacityError("job_payload");
        additions.push(
          buildRow("job:" + commandHash + ":" + index, "job", {
            task: job.task,
            payload: job.payload ?? {},
            generation,
            status: "pending",
            createdAt: request.command.occurredAt,
          }),
        );
      }
      const priorQuota = beforeHead?.quota ?? {
        rows: 0,
        bytes: 0,
        revisions: 0,
        evidence: 0,
      };
      const quota = {
        rows: priorQuota.rows + additions.length + (beforeRow === null ? 1 : 0),
        bytes: 0,
        revisions:
          priorQuota.revisions +
          additions.filter((row) => row.kind === "revision").length,
        evidence:
          priorQuota.evidence +
          additions.filter((row) => row.kind === "evidence").length,
      };
      if (
        quota.revisions > limits.maxArticleRevisions ||
        quota.evidence > limits.maxEvidenceVersions
      )
        throw new RepositoryCapacityError("retained_history");
      const encodedAdditions = additions.map(encodeKnowledgeRecord);
      const baseBytes =
        priorQuota.bytes -
        (beforeRow === null
          ? 0
          : encodedBytes(encodeKnowledgeRecord(beforeRow.value))) +
        encodedAdditions.reduce((sum, row) => sum + encodedBytes(row), 0);
      let headRow = buildRow("head", "head", { pointer, quota } satisfies Head);
      for (let pass = 0; pass < 12; pass += 1) {
        const updated =
          baseBytes + encodedBytes(encodeKnowledgeRecord(headRow));
        if (updated === quota.bytes) break;
        quota.bytes = updated;
        headRow = buildRow("head", "head", { pointer, quota } satisfies Head);
      }
      const rowBudget =
        limits.maxPhysicalRows -
        (request.control ? 0 : limits.controlReserveRows);
      const byteBudget =
        limits.maxRetainedBytes -
        (request.control ? 0 : limits.controlReserveBytes);
      if (quota.rows > rowBudget)
        throw new RepositoryCapacityError("physical_rows");
      if (quota.bytes > byteBudget)
        throw new RepositoryCapacityError("retained_bytes");
      const actions: TransactionAction<KnowledgeRecord>[] = [
        beforeRow === null
          ? { action: "insert", value: headRow }
          : {
              action: "putIfUnchanged",
              value: headRow,
              version: beforeRow.version,
            },
        ...additions.map((value) => ({ action: "insert" as const, value })),
      ];
      if (
        actions.length > maximumTransactionActions ||
        encodedBytes(encodeKnowledgeRecord(headRow)) +
          encodedAdditions.reduce((sum, row) => sum + encodedBytes(row), 0) >
          maximumTransactionEncodedBytes
      )
        throw new RepositoryCapacityError("transaction");
      const outcome = await records.transact(scope, actions);
      if (!outcome.committed) continue;
      const latest = await read<T>(kind, request.id);
      await recheck(latest?.value ?? null);
      return { value: next, replayed: false };
    }
    // The winning attempt may have committed this command on the final retry.
    const receiptRow = await getRow(kind, request.id, receiptKey);
    if (receiptRow !== null && receiptRow.kind === "command") {
      const receipt = receiptRow.data as Receipt;
      if (
        receipt.command.actorId === request.command.actorId &&
        receipt.command.operation === request.command.operation &&
        receipt.command.fingerprint === request.command.fingerprint &&
        receipt.command.commandId === request.command.commandId
      ) {
        const latest = await read<T>(kind, request.id);
        await recheck(latest?.value ?? null);
        if (
          latest === null ||
          receipt.result.generation > latest.value.generation
        )
          throw new RepositoryConflictError();
        return {
          value: (await hydrate(kind, request.id, receipt.result)) as T,
          replayed: true,
        };
      }
    }
    throw new RepositoryConflictError();
  }
  return {
    limits,
    readArticleVersioned: (id) => read<StoredArticle>("article", id),
    readArticlePublicationVersioned: readPublication,
    readGovernedPublicationVersioned: readGovernedPublication,
    readPublicationEvidence,
    readArticleAuthoringVersioned: readAuthoring,
    confirmResourceVersions,
    confirmGovernanceVersions,
    readResourceGeneration: async (kind, id) => {
      const row = await getHead(kind, id);
      return row === null ? null : (row.value.data as Head).pointer.generation;
    },
    readCollectionVersioned: (id) => read<StoredCollection>("collection", id),
    readValidationPolicyVersioned: (id) =>
      read<StoredValidationPolicy>("validation", id),
    getArticleRevision: getRevision,
    getEvidenceVersion: getEvidence,
    isEvidenceRevoked: async (id, hash) => {
      if (!/^[a-f0-9]{64}$/u.test(hash))
        throw new TypeError("Expected evidence hash");
      const row = await getRow("article", id, "revoked:" + hash);
      if (row !== null && row.kind !== "revocation")
        throw new RepositoryIntegrityError();
      if (row !== null && (row.data as EvidenceRevocation)?.hash !== hash)
        throw new RepositoryIntegrityError();
      return row !== null;
    },
    executeArticle: (input) => execute<StoredArticle>("article", input),
    executeCollection: (input) =>
      execute<StoredCollection>("collection", input),
    executeValidationPolicy: (input) =>
      execute<StoredValidationPolicy>("validation", input),
  };
}
