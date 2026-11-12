import { hasPermission, type AccessContext } from "@pegma/authorization-core";
import {
  knowledgePermissions,
  type Applicability,
  type CollectionUse,
} from "@pegma/knowledge-base-contracts";
import type { Store } from "@pegma/storage-core";
import {
  KnowledgeBaseAuthorizationError,
  KnowledgeBaseNotFoundError,
  KnowledgeBasePrerequisiteError,
  requirePermission,
} from "./errors.js";
import { normalizeQuery, scoreConfirmedArticle } from "./lexical.js";
import {
  createPublicationChecker,
  type CheckedPublication,
} from "./publication.js";
import type {
  PublishedSearchObservation,
  PublishedSearchObservations,
  PublishedSearchScopeState,
} from "./published-search-observations-types.js";
import { knowledgeRecords, type StoredCollection } from "./records.js";
import {
  createKnowledgeRepository,
  type VersionedState,
} from "./repository.js";
import {
  createRetrievalReadBudget,
  RetrievalBudgetError,
  type RetrievalReadBudget,
} from "./retrieval-budget.js";
import type {
  KnowledgeRetrievalLimits,
  SearchPublishedArticlesInput,
} from "./retrieval-types.js";
import {
  canonicalJson,
  fingerprint,
  RepositoryCapacityError,
  RepositoryConflictError,
  RepositoryIntegrityError,
  requireIdentifier,
  snapshotData,
} from "./storage-helpers.js";
import type {
  KnowledgeBaseServiceOptions,
  PublishedArticleDto,
} from "./types.js";

// The authoritative layout has no per-collection membership index. This
// background-only fallback charges every physical KB record, not just matches.
const maximumPhysicalRows = 256;

class PartialObservationError extends Error {}

interface CapturedSearch {
  readonly input: SearchPublishedArticlesInput;
  readonly actorId: string;
  readonly membership: string;
  readonly articles: string;
}

function inputSnapshot<T>(input: T, fields: readonly string[]): T {
  const value = snapshotData(input);
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new TypeError(
      "Published comparison input contains unsupported fields",
    );
  return value;
}

function searchInput(request: SearchPublishedArticlesInput, maximum: number) {
  const input = inputSnapshot(request, [
    "collectionId",
    "query",
    "applicability",
    "limit",
  ]);
  requireIdentifier(input.collectionId, "collectionId");
  const terms = normalizeQuery(input.query);
  if (terms.length === 0)
    throw new TypeError("Published comparison requires a lexical search term");
  const applicability: Applicability = inputSnapshot(input.applicability, [
    "productId",
    "productVersion",
    "buildId",
    "locale",
  ]);
  requireIdentifier(applicability.productId, "applicability.productId");
  requireIdentifier(
    applicability.productVersion,
    "applicability.productVersion",
  );
  if (Object.hasOwn(applicability, "buildId"))
    requireIdentifier(applicability.buildId!, "applicability.buildId");
  if (Object.hasOwn(applicability, "locale"))
    requireIdentifier(applicability.locale!, "applicability.locale");
  const limit = input.limit ?? maximum;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum)
    throw new TypeError(
      "Published comparison result limit exceeds its ceiling",
    );
  return { input, terms, limit };
}

function authorize(access: AccessContext, use?: CollectionUse): void {
  requireIdentifier(access.principalId, "principalId");
  requirePermission(access, knowledgePermissions.articleRead);
  if (
    use !== undefined &&
    (!use.enabled ||
      (use.audience.kind === "permission" &&
        !hasPermission(access, use.audience.permission)))
  )
    throw new KnowledgeBaseNotFoundError("collection");
}

function unavailable(): KnowledgeBasePrerequisiteError {
  return new KnowledgeBasePrerequisiteError("published_search_observation");
}

/** Reuse current publication authority; never trust a search-provider empty list. */
export function createPublishedSearchObservations(
  store: Store,
  services: KnowledgeBaseServiceOptions,
  limits: KnowledgeRetrievalLimits,
): PublishedSearchObservations {
  const records = store.collection(knowledgeRecords);
  const observations = new WeakMap<
    PublishedSearchObservation,
    CapturedSearch
  >();

  function readBudget() {
    return createRetrievalReadBudget(store, {
      maxPhysicalReads: limits.maxRequestPhysicalGets,
      maxIndexReads: limits.maxRequestPhysicalGets,
      maxPostingEntries: limits.maxPostingEntries,
      maxCandidateHeads: limits.maxHeadProbes,
      maxConfirmations: limits.maxConfirmations,
      indexCollectionName: knowledgeRecords.name,
    });
  }

  async function scopeState(
    access: AccessContext,
    collection: VersionedState<StoredCollection>,
  ): Promise<PublishedSearchScopeState> {
    const current = collection.value.collection;
    const policy = current.policy;
    authorize(access, policy.portal);
    const policyHash = await fingerprint(policy);
    if (
      [policy.portal, policy.bot].some(
        (use) => use.enabled && use.audience.kind === "anonymous",
      )
    ) {
      const approval = current.publicApproval;
      if (
        approval === undefined ||
        approval.collectionId !== current.id ||
        approval.policyVersion !== policy.version ||
        approval.policyHash !== policyHash
      )
        throw new KnowledgeBaseNotFoundError("collection");
    }
    return {
      collectionId: current.id,
      generation: collection.value.generation,
      scopeHash: await fingerprint({
        collectionId: current.id,
        generation: collection.value.generation,
        version: collection.version,
        policyHash,
      }),
    };
  }

  async function catalogue(budget: RetrievalReadBudget) {
    const limit = Math.min(
      maximumPhysicalRows,
      budget.remainingCandidateWork().physicalRows,
    );
    if (limit < 1) throw new PartialObservationError();
    const page = await records.scan({ limit });
    if (!Array.isArray(page.records) || page.records.length > limit)
      throw new RepositoryIntegrityError();
    // Charge all physical records, including private/history/nonmatching rows,
    // before filtering or deduplication. An empty page still costs a read.
    budget.accountExternal({
      keyedReads: 0,
      physicalRows: Math.max(1, page.records.length),
      pagesRead: 1,
      postingEntries: 0,
    });
    if (page.nextCursor !== null) {
      if (typeof page.nextCursor !== "string" || page.nextCursor.length === 0)
        throw new RepositoryIntegrityError();
      // Following pages cannot supply a single terminal membership observation.
      throw new PartialObservationError();
    }
    const membership: string[] = [];
    const keys = new Set<string>();
    const articleIds: string[] = [];
    for (const row of page.records) {
      if (
        row.key.partition !== row.value.partition ||
        row.key.id !== row.value.id ||
        typeof row.version !== "string" ||
        row.version.length === 0
      )
        throw new RepositoryIntegrityError();
      const key = canonicalJson(row.key);
      if (keys.has(key)) throw new RepositoryIntegrityError();
      keys.add(key);
      membership.push(canonicalJson([row.key, row.version]));
      if (row.value.resourceKind !== "article" || row.value.kind !== "head")
        continue;
      if (row.value.id !== "head") throw new RepositoryIntegrityError();
      requireIdentifier(row.value.resourceId, "articleId");
      articleIds.push(row.value.resourceId);
    }
    if (new Set(articleIds).size !== articleIds.length)
      throw new RepositoryIntegrityError();
    return {
      membership: canonicalJson(membership.sort()),
      articleIds: articleIds.sort(),
    };
  }

  async function read(
    access: AccessContext,
    request: SearchPublishedArticlesInput,
  ) {
    const { input, terms, limit } = searchInput(request, limits.maxResults);
    authorize(access);
    const budget = readBudget();
    const repository = createKnowledgeRepository(budget.store, services.limits);
    const publications = createPublicationChecker(repository, services);
    const collection = await repository.readCollectionVersioned(
      input.collectionId,
    );
    if (collection === null) throw new KnowledgeBaseNotFoundError("collection");
    const policy = collection.value.collection.policy;
    const observedScope = await scopeState(access, collection);
    const initial = await catalogue(budget);
    const matches: {
      readonly checked: CheckedPublication;
      readonly score: number;
    }[] = [];
    for (const articleId of initial.articleIds) {
      budget.candidateHead();
      const current =
        await repository.readArticlePublicationVersioned(articleId);
      if (current === null) throw new RepositoryConflictError();
      const state = current.value;
      const revision = state.published?.revision;
      if (
        state.state === "retired" ||
        state.publicationHeld ||
        revision === undefined ||
        revision.collectionId !== input.collectionId ||
        canonicalJson(revision.applicability) !==
          canonicalJson(input.applicability)
      )
        continue;
      // Metadata is only a local match predicate. No unconfirmed text escapes.
      const score = scoreConfirmedArticle(revision, terms);
      if (score === 0) continue;
      budget.confirmation();
      const checked = await publications.check({
        access,
        articleId,
        purpose: "portal",
        applicability: input.applicability,
      });
      if (checked.article.collectionId !== input.collectionId)
        throw new RepositoryConflictError();
      matches.push({ checked, score });
      if (matches.length > limit) throw new PartialObservationError();
    }
    matches.sort(
      (left, right) =>
        right.score - left.score ||
        (left.checked.article.articleId < right.checked.article.articleId
          ? -1
          : 1),
    );
    const articles = snapshotData(
      matches.map(({ checked }) => checked.article),
    );
    const serialized = canonicalJson(articles);
    if (
      new TextEncoder().encode(serialized).byteLength > limits.maxContentBytes
    )
      throw new PartialObservationError();
    for (const { checked } of matches) await publications.recheck(checked);
    const latestCollection = await repository.readCollectionVersioned(
      input.collectionId,
    );
    if (latestCollection?.version !== collection.version)
      throw new RepositoryConflictError();
    // Last awaited read: closes new/missed membership and every persisted head
    // change across the preceding checks, including nonmatching publications.
    const final = await catalogue(budget);
    if (initial.membership !== final.membership)
      throw new RepositoryConflictError();
    authorize(access, policy.portal);
    return {
      input,
      articles,
      serialized,
      membership: final.membership,
      scopeState: observedScope,
    };
  }

  return Object.freeze<PublishedSearchObservations>({
    async readScope(access, request) {
      access = snapshotData(access);
      const input = inputSnapshot(request, ["collectionId"]);
      requireIdentifier(input.collectionId, "collectionId");
      authorize(access);
      try {
        const repository = createKnowledgeRepository(
          readBudget().store,
          services.limits,
        );
        const collection = await repository.readCollectionVersioned(
          input.collectionId,
        );
        if (collection === null)
          throw new KnowledgeBaseNotFoundError("collection");
        const state = await scopeState(access, collection);
        // Hashing and public-approval validation await trusted facts. Recheck
        // the actual opaque C version afterwards, including empty scopes.
        const latest = await repository.readCollectionVersioned(
          input.collectionId,
        );
        if (latest?.version !== collection.version)
          throw new RepositoryConflictError();
        authorize(access, collection.value.collection.policy.portal);
        return state;
      } catch (error) {
        if (
          error instanceof KnowledgeBaseAuthorizationError ||
          error instanceof KnowledgeBaseNotFoundError
        )
          throw error;
        throw new KnowledgeBasePrerequisiteError("published_search_scope");
      }
    },

    async observe(access, request) {
      access = snapshotData(access);
      // Invalid requests throw; dependency, authority and capacity outcomes do
      // not disclose any confirmed subset, candidate count or private material.
      const { input } = searchInput(request, limits.maxResults);
      try {
        const result = await read(access, input);
        const observation = Object.freeze({}) as PublishedSearchObservation;
        observations.set(observation, {
          input: result.input,
          actorId: access.principalId,
          membership: result.membership,
          articles: result.serialized,
        });
        return {
          outcome: "complete",
          articles: result.articles,
          scopeState: result.scopeState,
          observation,
        };
      } catch (error) {
        return {
          outcome:
            error instanceof PartialObservationError ||
            error instanceof RetrievalBudgetError ||
            error instanceof RepositoryCapacityError
              ? "partial"
              : "unavailable",
          articles: [],
        };
      }
    },
    async confirm(access, observation) {
      access = snapshotData(access);
      const captured =
        observation !== null && typeof observation === "object"
          ? observations.get(observation)
          : undefined;
      if (captured === undefined)
        throw new TypeError(
          "Published search observation is invalid or consumed",
        );
      authorize(access);
      if (access.principalId !== captured.actorId)
        throw new KnowledgeBaseAuthorizationError(
          knowledgePermissions.articleRead,
        );
      // Consume before the first await, including failed or concurrent rechecks.
      observations.delete(observation);
      try {
        const current = await read(access, captured.input);
        if (
          captured.membership !== current.membership ||
          captured.articles !== current.serialized
        )
          throw unavailable();
      } catch {
        throw unavailable();
      }
    },
  });
}
