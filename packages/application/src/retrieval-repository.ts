import type {
  Store,
  TransactionAction,
  VersionedRecord,
} from "@pegma/storage-core";
import {
  encodeRetrievalRecord,
  retrievalRecords,
  requireRetrievalHint,
  requireRetrievalScope,
  type RetrievalBlockedReason,
  type RetrievalHint,
  type RetrievalPostingPage,
  type RetrievalProjectionState,
  type RetrievalProjectionTarget,
  type RetrievalRecord,
  type RetrievalRecordKind,
  type RetrievalScope,
  type RetrievalStoredTarget,
} from "./retrieval-records.js";
import type { KnowledgeRetrievalLimits } from "./retrieval-types.js";
import { resolveRetrievalLimits } from "./retrieval-limits.js";
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

export interface BeginArticleProjectionInput {
  readonly articleId: string;
  readonly generation: number;
  readonly sourceGeneration: number;
  readonly targets: readonly RetrievalProjectionTarget[];
}

export interface RetrievalCatalog {
  readonly articleIds: readonly string[];
  readonly scopes: readonly RetrievalScope[];
}

/** Invocation-local write-attempt allowance; never persisted or reused. */
export interface RetrievalStepBudget {
  remaining: number;
}

export class RetrievalStepBudgetError extends Error {
  override readonly name = "RetrievalStepBudgetError";
}

function available(budget: RetrievalStepBudget | undefined): void {
  if (budget !== undefined && budget.remaining === 0)
    throw new RetrievalStepBudgetError();
}

export interface RetrievalRepository {
  registerCollection(
    collectionId: string,
    budget?: RetrievalStepBudget,
  ): Promise<void>;
  readDirectory(): Promise<readonly string[]>;
  readCatalog(collectionId: string): Promise<RetrievalCatalog>;
  /** Every returned page/entry must be charged before query filtering/deduplication. */
  readPostingPages(
    scope: RetrievalScope,
    terms: readonly string[],
  ): Promise<
    readonly {
      readonly term: string;
      readonly pages: readonly RetrievalPostingPage[];
    }[]
  >;
  readArticleProjection(
    articleId: string,
  ): Promise<RetrievalProjectionState | null>;
  beginArticleProjection(
    input: BeginArticleProjectionInput,
    budget?: RetrievalStepBudget,
  ): Promise<RetrievalProjectionState>;
  advanceArticleProjection(
    articleId: string,
    expectedGeneration: number,
    budget?: RetrievalStepBudget,
  ): Promise<{
    readonly state: RetrievalProjectionState;
    readonly complete: boolean;
    readonly changed: boolean;
  }>;
  markArticleProjectionBlocked(
    articleId: string,
    generation: number,
    reason: RetrievalBlockedReason,
    sourceGeneration?: number,
    budget?: RetrievalStepBudget,
  ): Promise<RetrievalProjectionState>;
}

interface CatalogEntry {
  readonly articleId: string;
  readonly generation: number;
  readonly scopes: readonly RetrievalScope[];
}
interface CatalogData {
  readonly entries: readonly CatalogEntry[];
  /** Retained epoch identities/floors have an explicit finite lifetime cap. */
  readonly epochs: readonly RetrievalScope[];
}
interface ScopeHead {
  readonly generation: number;
  readonly articleIds: readonly string[];
  readonly rows: number;
  readonly bytes: number;
}
interface StoredPostingEntry {
  readonly hint: RetrievalHint;
  readonly projectionGeneration: number;
}
interface ManifestEntry extends StoredPostingEntry {
  readonly termHash: string;
}
interface Manifest {
  readonly articleId: string;
  readonly generation: number;
  readonly sourceGeneration: number;
  readonly target: RetrievalStoredTarget | null;
  readonly entries: readonly ManifestEntry[];
}
interface PostingHead {
  readonly termHash: string;
  readonly pages: number;
}
interface PostingPage {
  readonly termHash: string;
  readonly page: number;
  readonly entries: readonly StoredPostingEntry[];
}

interface LoadedPosting {
  readonly head: VersionedRecord<RetrievalRecord> | null;
  readonly pages: VersionedRecord<RetrievalRecord>[];
  readonly entries: StoredPostingEntry[];
}

const maximumEpochs = 32;
const maximumKnownScopes = 32;
const maximumAttempts = 3;
const maximumActions = 100;
const maximumTransactionBytes = 3 * 1024 * 1024;
/** Two complete posting rewrites fit even when both terms occupy sixteen pages. */
const termsPerBatch = 2;
const hashPattern = /^[a-f0-9]{64}$/u;

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new RepositoryIntegrityError();
  const names = Object.keys(value);
  if (
    names.length !== keys.length ||
    names.some((name) => !keys.includes(name))
  )
    throw new RepositoryIntegrityError();
  return value as Record<string, unknown>;
}
function boundedArray<T>(
  value: unknown,
  maximum: number,
  validate: (item: T) => void,
): readonly T[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new RepositoryIntegrityError();
  for (const item of value) validate(item as T);
  return value as readonly T[];
}
function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length)
    throw new RepositoryIntegrityError();
}
function digest(value: string): void {
  if (typeof value !== "string" || !hashPattern.test(value))
    throw new RepositoryIntegrityError();
}
function scopeIdentity(scope: RetrievalScope): string {
  return canonicalJson(scope);
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function sameScope(a: RetrievalScope, b: RetrievalScope): boolean {
  return scopeIdentity(a) === scopeIdentity(b);
}
function scopesUnion(
  scopes: readonly RetrievalScope[],
): readonly RetrievalScope[] {
  const values = new Map(scopes.map((scope) => [scopeIdentity(scope), scope]));
  return [...values.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([, scope]) => scope);
}
function requireScopes(
  value: unknown,
  maximum = maximumKnownScopes,
): readonly RetrievalScope[] {
  const scopes = boundedArray<RetrievalScope>(
    value,
    maximum,
    requireRetrievalScope,
  );
  unique(scopes.map(scopeIdentity));
  return scopes;
}
function requireTarget(target: RetrievalStoredTarget): void {
  exactObject(target, ["scope", "hint", "termHashes"]);
  requireRetrievalScope(target.scope);
  requireRetrievalHint(target.hint);
  if (
    !sameScope(target.scope, {
      collectionId: target.hint.collectionId,
      policyVersion: target.hint.policyVersion,
      use: target.hint.use,
    })
  )
    throw new RepositoryIntegrityError();
  const terms = boundedArray<string>(target.termHashes, 256, digest);
  unique(terms);
}
function requireState(state: RetrievalProjectionState): void {
  const keys = [
    "articleId",
    "generation",
    "sourceGeneration",
    "status",
    "targets",
    "pendingScopes",
    "knownScopes",
    ...(state.reason === undefined ? [] : ["reason"]),
  ];
  exactObject(state, keys);
  requireIdentifier(state.articleId);
  requireGeneration(state.generation, 1);
  requireGeneration(state.sourceGeneration, 1);
  if (!["pending", "ready", "blocked"].includes(state.status))
    throw new RepositoryIntegrityError();
  if (
    state.reason !== undefined &&
    !["capacity", "source-unavailable", "conflict"].includes(state.reason)
  )
    throw new RepositoryIntegrityError();
  const targets = boundedArray<RetrievalStoredTarget>(
    state.targets,
    2,
    requireTarget,
  );
  unique(targets.map((target) => scopeIdentity(target.scope)));
  for (const target of targets)
    if (
      target.hint.articleId !== state.articleId ||
      target.hint.generation !== state.sourceGeneration
    )
      throw new RepositoryIntegrityError();
  const pending = requireScopes(state.pendingScopes);
  const known = requireScopes(state.knownScopes);
  if (
    pending.some((scope) => !known.some((item) => sameScope(scope, item))) ||
    targets.some(
      (target) => !known.some((scope) => sameScope(scope, target.scope)),
    )
  )
    throw new RepositoryIntegrityError();
  if (state.status === "ready" && pending.length !== 0)
    throw new RepositoryIntegrityError();
}
function requireCatalog(data: CatalogData, collectionId: string): void {
  exactObject(data, ["entries", "epochs"]);
  const entries = boundedArray<CatalogEntry>(data.entries, 256, (entry) => {
    exactObject(entry, ["articleId", "generation", "scopes"]);
    requireIdentifier(entry.articleId);
    requireGeneration(entry.generation, 1);
    for (const scope of requireScopes(entry.scopes, 2))
      if (scope.collectionId !== collectionId)
        throw new RepositoryIntegrityError();
  });
  unique(entries.map((entry) => entry.articleId));
  for (const scope of requireScopes(data.epochs, maximumEpochs))
    if (scope.collectionId !== collectionId)
      throw new RepositoryIntegrityError();
  if (
    entries.some((entry) =>
      entry.scopes.some(
        (scope) => !data.epochs.some((epoch) => sameScope(scope, epoch)),
      ),
    )
  )
    throw new RepositoryIntegrityError();
}
function requireScopeHead(head: ScopeHead): void {
  exactObject(head, ["generation", "articleIds", "rows", "bytes"]);
  requireGeneration(head.generation, 1);
  requireGeneration(head.rows, 1);
  requireGeneration(head.bytes, 1);
  const ids = boundedArray<string>(head.articleIds, 256, requireIdentifier);
  unique(ids);
}
function requireManifest(
  manifest: Manifest,
  articleId: string,
  scope: RetrievalScope,
): void {
  exactObject(manifest, [
    "articleId",
    "generation",
    "sourceGeneration",
    "target",
    "entries",
  ]);
  if (manifest.articleId !== articleId) throw new RepositoryIntegrityError();
  requireGeneration(manifest.generation, 1);
  requireGeneration(manifest.sourceGeneration, 1);
  if (manifest.target !== null) {
    requireTarget(manifest.target);
    if (
      !sameScope(manifest.target.scope, scope) ||
      manifest.target.hint.articleId !== articleId ||
      manifest.target.hint.generation !== manifest.sourceGeneration
    )
      throw new RepositoryIntegrityError();
  }
  const entries = boundedArray<ManifestEntry>(
    manifest.entries,
    256,
    (entry) => {
      exactObject(entry, ["termHash", "hint", "projectionGeneration"]);
      digest(entry.termHash);
      requireRetrievalHint(entry.hint);
      requireGeneration(entry.projectionGeneration, 1);
      if (
        entry.projectionGeneration > manifest.generation ||
        entry.hint.articleId !== articleId ||
        !sameScope(scope, {
          collectionId: entry.hint.collectionId,
          policyVersion: entry.hint.policyVersion,
          use: entry.hint.use,
        })
      )
        throw new RepositoryIntegrityError();
    },
  );
  unique(entries.map((entry) => entry.termHash));
}

export const retrievalTermHash = async (term: string): Promise<string> => {
  if (
    typeof term !== "string" ||
    term.length === 0 ||
    term.length > 256 ||
    !/^[\p{L}\p{N}]+$/u.test(term)
  )
    throw new TypeError("Expected a bounded normalized lexical term");
  return fingerprint(term);
};

/** A repairable derived index; authoritative content always lives in KnowledgeRepository. */
export function createRetrievalRepository(
  store: Store,
  overrides: Partial<KnowledgeRetrievalLimits> = {},
): RetrievalRepository {
  const limits = resolveRetrievalLimits(overrides);
  const records = store.collection(retrievalRecords);
  const row = (
    partition: string,
    id: string,
    kind: RetrievalRecordKind,
    data: unknown,
  ): RetrievalRecord => ({ schemaVersion: 1, partition, id, kind, data });
  const articlePartition = async (id: string): Promise<string> =>
    "article:" + (await fingerprint(id));
  const catalogPartition = async (id: string): Promise<string> =>
    "catalog:" + (await fingerprint(id));
  const scopePartition = async (scope: RetrievalScope): Promise<string> =>
    "scope:" + (await fingerprint(scope));

  async function get(
    partition: string,
    id: string,
    kind: RetrievalRecordKind,
  ): Promise<VersionedRecord<RetrievalRecord> | null> {
    const result = await records.getVersioned({ partition, id });
    if (
      result !== null &&
      (result.value.partition !== partition ||
        result.value.id !== id ||
        result.value.kind !== kind)
    )
      throw new RepositoryIntegrityError();
    return result;
  }
  async function transact(
    partition: string,
    actions: readonly TransactionAction<RetrievalRecord>[],
    budget?: RetrievalStepBudget,
  ): Promise<boolean> {
    if (actions.length > maximumActions)
      throw new RepositoryCapacityError("index_transaction_actions");
    let bytes = 0;
    for (const action of actions)
      bytes +=
        action.action === "delete"
          ? new TextEncoder().encode(canonicalJson(action.key)).length + 256
          : encodedBytes(encodeRetrievalRecord(action.value)) + 256;
    if (bytes > maximumTransactionBytes)
      throw new RepositoryCapacityError("index_transaction_bytes");
    available(budget);
    if (budget !== undefined) budget.remaining -= 1;
    return (await records.transact(partition, actions)).committed;
  }
  const write = (
    value: RetrievalRecord,
    before: VersionedRecord<RetrievalRecord> | null,
  ): TransactionAction<RetrievalRecord> =>
    before === null
      ? { action: "insert", value }
      : { action: "putIfUnchanged", value, version: before.version };

  async function readState(
    articleId: string,
    preparedPartition?: string,
  ): Promise<{
    state: RetrievalProjectionState;
    row: VersionedRecord<RetrievalRecord>;
  } | null> {
    requireIdentifier(articleId);
    const before = await get(
      preparedPartition ?? (await articlePartition(articleId)),
      "head",
      "article",
    );
    if (before === null) return null;
    try {
      const state = before.value.data as RetrievalProjectionState;
      requireState(state);
      if (state.articleId !== articleId) throw new RepositoryIntegrityError();
      return { state, row: before };
    } catch {
      throw new RepositoryIntegrityError();
    }
  }
  async function directory(): Promise<readonly string[]> {
    const result = await get("directory", "head", "directory");
    if (result === null) return [];
    try {
      const data = exactObject(result.value.data, ["collectionIds"]);
      const ids = boundedArray<string>(
        data.collectionIds,
        64,
        requireIdentifier,
      );
      unique(ids);
      if (ids.length > limits.maxDirectoryCollections)
        throw new RepositoryCapacityError("index_directory");
      return ids;
    } catch (error) {
      if (error instanceof RepositoryCapacityError) throw error;
      throw new RepositoryIntegrityError();
    }
  }
  async function registerDirectory(
    collectionId: string,
    budget?: RetrievalStepBudget,
  ): Promise<void> {
    requireIdentifier(collectionId, "collectionId");
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      available(budget);
      const before = await get("directory", "head", "directory");
      let ids: readonly string[] = [];
      if (before !== null) {
        const data = exactObject(before.value.data, ["collectionIds"]);
        ids = boundedArray<string>(data.collectionIds, 64, requireIdentifier);
        unique(ids);
      }
      if (ids.length > limits.maxDirectoryCollections)
        throw new RepositoryCapacityError("index_directory");
      if (ids.includes(collectionId)) return;
      if (ids.length >= limits.maxDirectoryCollections)
        throw new RepositoryCapacityError("index_directory");
      if (
        await transact(
          "directory",
          [
            write(
              row("directory", "head", "directory", {
                collectionIds: [...ids, collectionId].sort(),
              }),
              before,
            ),
          ],
          budget,
        )
      )
        return;
    }
    throw new RepositoryConflictError();
  }
  async function loadCatalog(collectionId: string): Promise<{
    data: CatalogData;
    row: VersionedRecord<RetrievalRecord> | null;
    partition: string;
  }> {
    requireIdentifier(collectionId);
    const partition = await catalogPartition(collectionId);
    const before = await get(partition, "head", "catalog");
    const data = (before?.value.data ?? {
      entries: [],
      epochs: [],
    }) as CatalogData;
    try {
      requireCatalog(data, collectionId);
    } catch {
      throw new RepositoryIntegrityError();
    }
    return { data, row: before, partition };
  }
  async function registerCatalog(
    state: RetrievalProjectionState,
    collectionId: string,
    budget?: RetrievalStepBudget,
  ): Promise<void> {
    await registerDirectory(collectionId, budget);
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      available(budget);
      const loaded = await loadCatalog(collectionId);
      const existing = loaded.data.entries.find(
        (entry) => entry.articleId === state.articleId,
      );
      if (existing !== undefined && existing.generation > state.generation)
        return;
      const scopes = state.targets
        .filter((target) => target.scope.collectionId === collectionId)
        .map((target) => target.scope);
      if (existing !== undefined && existing.generation === state.generation) {
        if (canonicalJson(existing.scopes) !== canonicalJson(scopes))
          throw new RepositoryConflictError();
        return;
      }
      if (
        existing === undefined &&
        loaded.data.entries.length >= limits.maxCatalogArticles
      )
        throw new RepositoryCapacityError("index_catalog");
      const epochs = scopesUnion([
        ...loaded.data.epochs,
        ...state.knownScopes.filter(
          (scope) => scope.collectionId === collectionId,
        ),
      ]);
      if (epochs.length > maximumEpochs)
        throw new RepositoryCapacityError("index_epochs");
      const entries = [
        ...loaded.data.entries.filter(
          (entry) => entry.articleId !== state.articleId,
        ),
        { articleId: state.articleId, generation: state.generation, scopes },
      ].sort((a, b) => compare(a.articleId, b.articleId));
      const value = row(loaded.partition, "head", "catalog", {
        entries,
        epochs,
      } satisfies CatalogData);
      if (await transact(loaded.partition, [write(value, loaded.row)], budget))
        return;
    }
    throw new RepositoryConflictError();
  }

  async function loadPostings(
    partition: string,
    scope: RetrievalScope,
    termHashes: readonly string[],
  ): Promise<ReadonlyMap<string, LoadedPosting>> {
    // Every key is ready before either Store wave. Head-declared page bounds
    // remain authoritative; no page is dropped to fit a provider budget.
    const heads = await Promise.all(
      termHashes.map((termHash) =>
        get(partition, "posting:" + termHash, "posting"),
      ),
    );
    const requests: { termHash: string; page: number }[] = [];
    for (const [index, termHash] of termHashes.entries()) {
      const head = heads[index];
      if (head === undefined) throw new RepositoryIntegrityError();
      if (head === null) continue;
      const data = head.value.data as PostingHead;
      try {
        exactObject(data, ["termHash", "pages"]);
        if (data.termHash !== termHash) throw new RepositoryIntegrityError();
        requireGeneration(data.pages, 1);
        if (data.pages > limits.maxPostingPagesPerTerm)
          throw new RepositoryCapacityError("index_posting_pages");
      } catch (error) {
        if (error instanceof RepositoryCapacityError) throw error;
        throw new RepositoryIntegrityError();
      }
      for (let page = 0; page < data.pages; page += 1)
        requests.push({ termHash, page });
    }
    const loadedPages = await Promise.all(
      requests.map(({ termHash, page }) =>
        get(partition, "page:" + termHash + ":" + page, "page"),
      ),
    );
    const result = new Map<string, LoadedPosting>();
    for (const [index, termHash] of termHashes.entries())
      result.set(termHash, {
        head: heads[index] ?? null,
        pages: [],
        entries: [],
      });
    for (const [index, request] of requests.entries()) {
      const { termHash, page } = request;
      const loaded = loadedPages[index];
      if (loaded === undefined) throw new RepositoryIntegrityError();
      if (loaded === null) throw new RepositoryConflictError();
      try {
        const value = loaded.value.data as PostingPage;
        exactObject(value, ["termHash", "page", "entries"]);
        if (value.termHash !== termHash || value.page !== page)
          throw new RepositoryIntegrityError();
        const members = boundedArray<StoredPostingEntry>(
          value.entries,
          16,
          (entry) => {
            exactObject(entry, ["hint", "projectionGeneration"]);
            requireRetrievalHint(entry.hint);
            requireGeneration(entry.projectionGeneration, 1);
            if (
              !sameScope(scope, {
                collectionId: entry.hint.collectionId,
                policyVersion: entry.hint.policyVersion,
                use: entry.hint.use,
              })
            )
              throw new RepositoryIntegrityError();
          },
        );
        if (members.length > limits.postingPageEntries)
          throw new RepositoryCapacityError("index_posting_entries");
        result.get(termHash)!.entries.push(...members);
      } catch (error) {
        if (error instanceof RepositoryCapacityError) throw error;
        throw new RepositoryIntegrityError();
      }
      result.get(termHash)!.pages.push(loaded);
    }
    return result;
  }

  async function applyScopeBatch(
    state: RetrievalProjectionState,
    scope: RetrievalScope,
    budget?: RetrievalStepBudget,
  ): Promise<boolean> {
    const [partition, articleScope, articleHash] = await Promise.all([
      scopePartition(scope),
      articlePartition(state.articleId),
      fingerprint(state.articleId),
    ]);
    const manifestId = "manifest:" + articleHash;
    const desired =
      state.targets.find((target) => sameScope(target.scope, scope)) ?? null;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      available(budget);
      const [global, headRow, manifestRow] = await Promise.all([
        readState(state.articleId, articleScope),
        get(partition, "head", "scope"),
        get(partition, manifestId, "manifest"),
      ]);
      if (global === null || global.state.generation !== state.generation)
        throw new RepositoryConflictError();
      let head: ScopeHead | null = null;
      if (headRow !== null) {
        try {
          head = headRow.value.data as ScopeHead;
          requireScopeHead(head);
        } catch {
          throw new RepositoryIntegrityError();
        }
        if (
          head.rows > limits.maxIndexPartitionRows ||
          head.bytes > limits.maxIndexPartitionBytes
        )
          throw new RepositoryCapacityError("index_partition");
      }
      let previous: Manifest | null = null;
      if (manifestRow !== null) {
        try {
          previous = manifestRow.value.data as Manifest;
          requireManifest(previous, state.articleId, scope);
        } catch {
          throw new RepositoryIntegrityError();
        }
        if (previous.generation > state.generation) return true;
        if (previous.sourceGeneration > state.sourceGeneration)
          throw new RepositoryConflictError();
        if (
          previous.generation === state.generation &&
          canonicalJson(previous.target) !== canonicalJson(desired)
        )
          throw new RepositoryConflictError();
      }
      if (head === null && manifestRow !== null)
        throw new RepositoryConflictError();
      const articleIds = head?.articleIds ?? [];
      if (
        !articleIds.includes(state.articleId) &&
        articleIds.length >= limits.maxCatalogArticles
      )
        throw new RepositoryCapacityError("index_scope_articles");
      const actual = new Map(
        (previous?.entries ?? []).map((entry) => [entry.termHash, entry]),
      );
      const desiredTerms = new Set(desired?.termHashes ?? []);
      const differs = (termHash: string): boolean => {
        const entry = actual.get(termHash);
        return desiredTerms.has(termHash)
          ? entry === undefined ||
              entry.projectionGeneration !== state.generation ||
              canonicalJson(entry.hint) !== canonicalJson(desired!.hint)
          : entry !== undefined;
      };
      // Remove obsolete terms before adding new ones so the actual manifest never exceeds 256.
      const work = [...actual.keys()]
        .filter((term) => !desiredTerms.has(term))
        .sort()
        .concat(
          [...new Set([...actual.keys(), ...desiredTerms])]
            .filter((term) => desiredTerms.has(term) && differs(term))
            .sort(),
        )
        .slice(0, termsPerBatch);
      if (
        previous !== null &&
        previous.generation === state.generation &&
        work.length === 0
      )
        return true;
      const actions: TransactionAction<RetrievalRecord>[] = [];
      const changes: {
        before: RetrievalRecord | null;
        after: RetrievalRecord | null;
      }[] = [];
      let planningConflict = false;
      const postings = await loadPostings(partition, scope, work);
      for (const termHash of work) {
        const loaded = postings.get(termHash)!;
        const old = actual.get(termHash);
        const found = loaded.entries.filter(
          (entry) => entry.hint.articleId === state.articleId,
        );
        // Page reads are not a snapshot of a concurrent compaction. Retry the
        // scope CAS plan rather than treating a mixed view as stored corruption.
        if (found.length > 1) {
          planningConflict = true;
          break;
        }
        const current = found[0];
        if (
          current !== undefined &&
          current.projectionGeneration > state.generation
        ) {
          planningConflict = true;
          break;
        }
        if (
          old !== undefined &&
          (current === undefined ||
            current.projectionGeneration !== old.projectionGeneration ||
            canonicalJson(current.hint) !== canonicalJson(old.hint))
        ) {
          planningConflict = true;
          break;
        }
        if (old === undefined && current !== undefined) {
          planningConflict = true;
          break;
        }
        const replacement: StoredPostingEntry | null = desiredTerms.has(
          termHash,
        )
          ? { hint: desired!.hint, projectionGeneration: state.generation }
          : null;
        const members = loaded.entries.filter(
          (entry) => entry.hint.articleId !== state.articleId,
        );
        if (replacement !== null) members.push(replacement);
        members.sort((a, b) => compare(a.hint.articleId, b.hint.articleId));
        const count = Math.ceil(members.length / limits.postingPageEntries);
        if (count > limits.maxPostingPagesPerTerm)
          throw new RepositoryCapacityError("index_posting_pages");
        const nextHead =
          count === 0
            ? null
            : row(partition, "posting:" + termHash, "posting", {
                termHash,
                pages: count,
              } satisfies PostingHead);
        if (nextHead === null) {
          if (loaded.head !== null)
            actions.push({
              action: "delete",
              key: { partition, id: loaded.head.value.id },
            });
        } else actions.push(write(nextHead, loaded.head));
        if (loaded.head !== null || nextHead !== null)
          changes.push({ before: loaded.head?.value ?? null, after: nextHead });
        for (
          let page = 0;
          page < Math.max(count, loaded.pages.length);
          page += 1
        ) {
          const prior = loaded.pages[page] ?? null;
          const next =
            page < count
              ? row(partition, "page:" + termHash + ":" + page, "page", {
                  termHash,
                  page,
                  entries: members.slice(
                    page * limits.postingPageEntries,
                    (page + 1) * limits.postingPageEntries,
                  ),
                } satisfies PostingPage)
              : null;
          if (next === null) {
            if (prior !== null)
              actions.push({
                action: "delete",
                key: { partition, id: prior.value.id },
              });
          } else actions.push(write(next, prior));
          changes.push({ before: prior?.value ?? null, after: next });
        }
        if (replacement === null) actual.delete(termHash);
        else actual.set(termHash, { ...replacement, termHash });
      }
      if (planningConflict) continue;
      const manifest: Manifest = {
        articleId: state.articleId,
        generation: state.generation,
        sourceGeneration: state.sourceGeneration,
        target: desired,
        entries: [...actual.values()].sort((a, b) =>
          compare(a.termHash, b.termHash),
        ),
      };
      if (manifest.entries.length > 256)
        throw new RepositoryCapacityError("index_article_terms");
      const nextManifest = row(partition, manifestId, "manifest", manifest);
      actions.push(write(nextManifest, manifestRow));
      changes.push({ before: manifestRow?.value ?? null, after: nextManifest });
      const nextRows =
        (head?.rows ?? 0) +
        (headRow === null ? 1 : 0) +
        changes.reduce(
          (sum, change) =>
            sum +
            (change.after === null ? 0 : 1) -
            (change.before === null ? 0 : 1),
          0,
        );
      const baseBytes =
        (head?.bytes ?? 0) -
        (headRow === null
          ? 0
          : encodedBytes(encodeRetrievalRecord(headRow.value))) +
        changes.reduce(
          (sum, change) =>
            sum +
            (change.after === null
              ? 0
              : encodedBytes(encodeRetrievalRecord(change.after))) -
            (change.before === null
              ? 0
              : encodedBytes(encodeRetrievalRecord(change.before))),
          0,
        );
      let nextHead: ScopeHead = {
        generation: (head?.generation ?? 0) + 1,
        articleIds: [...new Set([...articleIds, state.articleId])].sort(),
        rows: nextRows,
        bytes: 0,
      };
      requireGeneration(nextHead.generation, 1);
      let nextHeadRow = row(partition, "head", "scope", nextHead);
      for (let pass = 0; pass < 12; pass += 1) {
        const bytes =
          baseBytes + encodedBytes(encodeRetrievalRecord(nextHeadRow));
        if (bytes === nextHead.bytes) break;
        nextHead = { ...nextHead, bytes };
        nextHeadRow = row(partition, "head", "scope", nextHead);
      }
      if (nextRows > limits.maxIndexPartitionRows)
        throw new RepositoryCapacityError("index_partition_rows");
      if (nextHead.bytes > limits.maxIndexPartitionBytes)
        throw new RepositoryCapacityError("index_partition_bytes");
      actions.unshift(write(nextHeadRow, headRow));
      // Every posting/manifest mutation changes this head. Its CAS also fences deletes.
      if (!(await transact(partition, actions, budget))) continue;
      return [...new Set([...actual.keys(), ...desiredTerms])].every(
        (term) => !differs(term),
      );
    }
    throw new RepositoryConflictError();
  }

  return {
    registerCollection: registerDirectory,
    readDirectory: directory,
    async readCatalog(collectionId) {
      const loaded = await loadCatalog(collectionId);
      if (loaded.data.entries.length > limits.maxCatalogArticles)
        throw new RepositoryCapacityError("index_catalog");
      const active = loaded.data.entries.filter(
        (entry) => entry.scopes.length !== 0,
      );
      return {
        articleIds: active.map((entry) => entry.articleId),
        scopes: scopesUnion(active.flatMap((entry) => entry.scopes)),
      };
    },
    async readPostingPages(scope, terms) {
      requireRetrievalScope(scope);
      if (!Array.isArray(terms) || terms.length > limits.maxQueryTerms)
        throw new TypeError("Expected bounded normalized lexical terms");
      const selected = [...terms];
      // Reject duplicate normalized terms rather than silently deduplicating.
      unique(selected);
      // No Store read starts until the complete scope and term-key set is ready.
      // loadPostings validates all heads before issuing its complete page wave.
      const [partition, hashes] = await Promise.all([
        scopePartition(scope),
        Promise.all(selected.map(retrievalTermHash)),
      ]);
      const loaded = await loadPostings(partition, scope, hashes);
      return selected.map((term, index) => {
        const posting = loaded.get(hashes[index]!);
        if (posting === undefined) throw new RepositoryIntegrityError();
        return {
          term,
          pages: posting.pages.map((page) => ({
            entries: (page.value.data as PostingPage).entries.map((entry) =>
              snapshotData(entry.hint),
            ),
          })),
        };
      });
    },
    async readArticleProjection(articleId) {
      return (await readState(articleId))?.state ?? null;
    },
    async beginArticleProjection(input, budget) {
      const request = snapshotData(input);
      if (
        Object.keys(request).some(
          (key) =>
            ![
              "articleId",
              "generation",
              "sourceGeneration",
              "targets",
            ].includes(key),
        )
      )
        throw new TypeError("Unexpected projection field");
      requireIdentifier(request.articleId);
      requireGeneration(request.generation, 1);
      requireGeneration(request.sourceGeneration, 1);
      if (!Array.isArray(request.targets) || request.targets.length > 2)
        throw new TypeError("Expected bounded projection targets");
      const targets: RetrievalStoredTarget[] = [];
      for (const target of request.targets) {
        exactObject(target, ["scope", "hint", "terms"]);
        requireRetrievalScope(target.scope);
        requireRetrievalHint(target.hint);
        if (
          !Array.isArray(target.terms) ||
          target.terms.length > limits.maxTermsPerArticle
        )
          throw new RepositoryCapacityError("index_article_terms");
        const termHashes = [
          ...new Set(await Promise.all(target.terms.map(retrievalTermHash))),
        ].sort();
        const stored = { scope: target.scope, hint: target.hint, termHashes };
        requireTarget(stored);
        if (
          target.hint.articleId !== request.articleId ||
          target.hint.generation !== request.sourceGeneration
        )
          throw new TypeError("Projection hint does not match source");
        targets.push(stored);
      }
      targets.sort((a, b) =>
        compare(scopeIdentity(a.scope), scopeIdentity(b.scope)),
      );
      unique(targets.map((target) => scopeIdentity(target.scope)));
      for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        available(budget);
        const before = await readState(request.articleId);
        const current = before?.state;
        if (
          current !== undefined &&
          request.sourceGeneration < current.sourceGeneration
        )
          throw new RepositoryConflictError();
        const same =
          current !== undefined &&
          current.sourceGeneration === request.sourceGeneration &&
          canonicalJson(current.targets) === canonicalJson(targets);
        if (same && current.status !== "blocked") return current;
        if (!same && request.generation !== (current?.generation ?? 0) + 1)
          throw new RepositoryConflictError();
        const knownScopes = scopesUnion([
          ...(current?.knownScopes ?? []),
          ...targets.map((target) => target.scope),
        ]);
        if (knownScopes.length > maximumKnownScopes)
          throw new RepositoryCapacityError("index_pending_scopes");
        const state: RetrievalProjectionState = same
          ? { ...current, status: "pending" }
          : {
              articleId: request.articleId,
              generation: request.generation,
              sourceGeneration: request.sourceGeneration,
              status: "pending",
              targets,
              knownScopes,
              pendingScopes: knownScopes,
            };
        const { reason: _reason, ...clean } = state;
        const partition = await articlePartition(request.articleId);
        if (
          await transact(
            partition,
            [
              write(
                row(partition, "head", "article", clean),
                before?.row ?? null,
              ),
            ],
            budget,
          )
        )
          return clean;
      }
      throw new RepositoryConflictError();
    },
    async advanceArticleProjection(articleId, expectedGeneration, budget) {
      available(budget);
      requireGeneration(expectedGeneration, 1);
      const before = await readState(articleId);
      if (before === null || before.state.generation !== expectedGeneration)
        throw new RepositoryConflictError();
      const state = before.state;
      if (state.status === "ready")
        return { state, complete: true, changed: false };
      if (state.status === "blocked")
        return { state, complete: false, changed: false };
      const scope = state.pendingScopes[0];
      if (scope !== undefined) {
        await registerCatalog(state, scope.collectionId, budget);
        available(budget);
        if (!(await applyScopeBatch(state, scope, budget)))
          return { state, complete: false, changed: true };
      }
      for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        available(budget);
        const latest = await readState(articleId);
        if (latest === null || latest.state.generation !== expectedGeneration)
          throw new RepositoryConflictError();
        if (latest.state.status === "blocked")
          return { state: latest.state, complete: false, changed: false };
        const pendingScopes =
          scope === undefined
            ? latest.state.pendingScopes
            : latest.state.pendingScopes.filter(
                (item) => !sameScope(item, scope),
              );
        const complete = pendingScopes.length === 0;
        const next: RetrievalProjectionState = {
          ...latest.state,
          pendingScopes,
          knownScopes: complete
            ? latest.state.targets.map((target) => target.scope)
            : latest.state.knownScopes,
          status: complete ? "ready" : "pending",
        };
        const partition = latest.row.value.partition;
        if (
          await transact(
            partition,
            [write(row(partition, "head", "article", next), latest.row)],
            budget,
          )
        )
          return { state: next, complete, changed: true };
      }
      throw new RepositoryConflictError();
    },
    async markArticleProjectionBlocked(
      articleId,
      generation,
      reason,
      sourceGeneration,
      budget,
    ) {
      requireGeneration(generation, 1);
      if (sourceGeneration !== undefined)
        requireGeneration(sourceGeneration, 1);
      if (!["capacity", "source-unavailable", "conflict"].includes(reason))
        throw new TypeError("Expected a projection block reason");
      for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        available(budget);
        const before = await readState(articleId);
        if (
          before === null &&
          (generation !== 1 || sourceGeneration === undefined)
        )
          throw new RepositoryConflictError();
        if (before !== null && before.state.generation !== generation)
          throw new RepositoryConflictError();
        const state: RetrievalProjectionState =
          before === null
            ? {
                articleId,
                generation,
                sourceGeneration: sourceGeneration!,
                status: "blocked",
                reason,
                targets: [],
                pendingScopes: [],
                knownScopes: [],
              }
            : { ...before.state, status: "blocked", reason };
        const partition =
          before?.row.value.partition ?? (await articlePartition(articleId));
        if (
          await transact(
            partition,
            [
              write(
                row(partition, "head", "article", state),
                before?.row ?? null,
              ),
            ],
            budget,
          )
        )
          return state;
      }
      throw new RepositoryConflictError();
    },
  };
}
