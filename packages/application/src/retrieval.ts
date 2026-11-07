import { hasPermission, type AccessContext } from "@pegma/authorization-core";
import {
  knowledgePermissions,
  type Applicability,
  type CollectionUse,
} from "@pegma/knowledge-base-contracts";
import type { Store } from "@pegma/storage-core";

import { KnowledgeBaseNotFoundError } from "./errors.js";
import { normalizeQuery, scoreConfirmedArticle } from "./lexical.js";
import {
  createPublicationChecker,
  type CheckedPublication,
} from "./publication.js";
import { createKnowledgeRepository } from "./repository.js";
import {
  createRetrievalReadBudget,
  RetrievalBudgetError,
} from "./retrieval-budget.js";
import { resolveRetrievalLimits } from "./retrieval-limits.js";
import {
  requireRetrievalHint,
  retrievalRecords,
  type RetrievalHint,
  type RetrievalScope,
} from "./retrieval-records.js";
import { createRetrievalRepository } from "./retrieval-repository.js";
import type {
  AnswerSourceDto,
  AnswerSourceReference,
  AnswerSourcesResult,
  KnowledgeRetrievalApplication,
  KnowledgeRetrievalOptions,
  PortalCollectionsResult,
  PortalSearchArticleDto,
  PortalSearchResult,
} from "./retrieval-types.js";
import {
  canonicalJson,
  fingerprint,
  requireGeneration,
  requireIdentifier,
  snapshotData,
} from "./storage-helpers.js";
import type { KnowledgeBaseServiceOptions } from "./types.js";

type RetrievalMethods = Pick<
  KnowledgeRetrievalApplication,
  | "listPortalCollections"
  | "searchPublishedArticles"
  | "retrieveAnswerSources"
  | "confirmAnswerSources"
>;
type Purpose = "portal" | "bot";

interface AuthorizedScope {
  readonly scope: RetrievalScope;
  readonly governanceGeneration: number;
  readonly label: string;
}

interface Candidate {
  readonly articleId: string;
  readonly firstSeen: number;
  readonly terms: Set<string>;
  readonly hints: Map<string, RetrievalHint>;
}

function ordinal(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function inputSnapshot<T>(input: T, fields: readonly string[]): T {
  const value = snapshotData(input);
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new TypeError("Retrieval input contains unsupported fields");
  return value;
}

function applicabilitySnapshot(value: Applicability): Applicability {
  const applicability = inputSnapshot(value, [
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
  return applicability;
}

function requestedLimit(limit: number | undefined, maximum: number): number {
  if (limit === undefined) return maximum;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new TypeError("Requested retrieval limit exceeds its ceiling");
  }
  return limit;
}

function allows(use: CollectionUse, access: AccessContext): boolean {
  return (
    use.enabled &&
    (use.audience.kind === "anonymous" ||
      hasPermission(access, use.audience.permission))
  );
}

function mayRead(access: AccessContext, purpose: Purpose): boolean {
  return (
    hasPermission(access, knowledgePermissions.articleRead) &&
    (purpose === "portal" ||
      hasPermission(access, knowledgePermissions.botRead))
  );
}

function noPortalResult(): PortalSearchResult {
  return { outcome: "no_result", articles: [] };
}

function noCollections(): PortalCollectionsResult {
  return { outcome: "no_result", collections: [] };
}

function noSources(): AnswerSourcesResult {
  return {
    outcome: "no_result",
    sources: [],
    serializedSources: "",
    sourceTokens: 0,
  };
}

function referenceOf(checked: CheckedPublication): AnswerSourceReference {
  const binding = checked.binding;
  return {
    articleId: binding.articleId,
    collectionId: binding.collectionId,
    collectionPolicyVersion: binding.collectionPolicyVersion,
    articleRevision: binding.revision,
    contentHash: binding.contentHash,
    applicationGeneration: binding.articleGeneration,
    governanceGeneration: binding.governanceGeneration,
    validationGeneration: binding.validationGeneration,
  };
}

function validateReference(reference: AnswerSourceReference): void {
  inputSnapshot(reference, [
    "articleId",
    "collectionId",
    "collectionPolicyVersion",
    "articleRevision",
    "contentHash",
    "applicationGeneration",
    "governanceGeneration",
    "validationGeneration",
  ]);
  requireIdentifier(reference.articleId, "articleId");
  requireIdentifier(reference.collectionId, "collectionId");
  if (!/^[a-f0-9]{64}$/u.test(reference.contentHash))
    throw new TypeError("Invalid source content hash");
  for (const value of [
    reference.collectionPolicyVersion,
    reference.articleRevision,
    reference.applicationGeneration,
    reference.governanceGeneration,
    reference.validationGeneration,
  ])
    requireGeneration(value, 1);
}

function sourceOf(checked: CheckedPublication): AnswerSourceDto {
  const article = checked.article;
  return snapshotData({
    reference: referenceOf(checked),
    citation: {
      label: article.title,
      ...(checked.portalBrowseable
        ? {
            portalArticle: {
              articleId: article.articleId,
              revision: article.revision,
            },
          }
        : {}),
    },
    title: article.title,
    summary: article.summary,
    content: article.content,
    applicability: article.applicability,
  });
}

function portalArticleOf(checked: CheckedPublication): PortalSearchArticleDto {
  const article = checked.article;
  return snapshotData({
    articleId: article.articleId,
    collectionId: article.collectionId,
    revision: article.revision,
    kind: article.kind,
    title: article.title,
    summary: article.summary,
    snippet: article.summary,
    tags: article.tags,
    applicability: article.applicability,
    contentHash: article.contentHash,
  });
}

/** Every call constructs a fresh request-scoped read budget and checker. */
export function createRetrievalServices(input: {
  readonly store: Store;
  readonly services: KnowledgeBaseServiceOptions;
  readonly options?: KnowledgeRetrievalOptions;
}): RetrievalMethods {
  const limits = resolveRetrievalLimits(input.options?.limits);
  const candidateAdapter = input.options?.candidateAdapter;
  const tokenCounter = input.options?.tokenCounter;

  function requestScope() {
    const budget = createRetrievalReadBudget(input.store, {
      maxPhysicalReads: limits.maxRequestPhysicalGets,
      maxIndexReads: limits.maxIndexKeyReads,
      maxPostingEntries: limits.maxPostingEntries,
      maxCandidateHeads: limits.maxHeadProbes,
      maxConfirmations: limits.maxConfirmations,
      indexCollectionName: retrievalRecords.name,
    });
    const repository = createKnowledgeRepository(
      budget.store,
      input.services.limits,
    );
    const index = createRetrievalRepository(budget.store, limits);
    const checker = createPublicationChecker(repository, input.services);

    async function authorizeCollection(
      access: AccessContext,
      collectionId: string,
      purpose: Purpose,
    ): Promise<AuthorizedScope | null> {
      if (!mayRead(access, purpose)) return null;
      const loaded = await repository.readCollectionVersioned(collectionId);
      if (loaded === null) return null;
      const collection = loaded.value.collection;
      if (!allows(collection.policy[purpose], access)) return null;
      if (
        [collection.policy.portal, collection.policy.bot].some(
          (use) => use.enabled && use.audience.kind === "anonymous",
        )
      ) {
        const approval = collection.publicApproval;
        if (
          approval === undefined ||
          approval.collectionId !== collection.id ||
          approval.policyVersion !== collection.policy.version ||
          approval.policyHash !== (await fingerprint(collection.policy))
        )
          return null;
      }
      return {
        scope: {
          collectionId,
          policyVersion: collection.policy.version,
          use: purpose,
        },
        governanceGeneration: loaded.value.generation,
        label: collection.name,
      };
    }

    async function queryHints(
      scopes: readonly AuthorizedScope[],
      terms: readonly string[],
    ): Promise<readonly Candidate[]> {
      const candidates = new Map<string, Candidate>();
      const add = (
        hint: RetrievalHint,
        scope: RetrievalScope,
        term: string,
      ) => {
        requireRetrievalHint(hint);
        if (
          hint.collectionId !== scope.collectionId ||
          hint.policyVersion !== scope.policyVersion ||
          hint.use !== scope.use
        )
          return;
        const candidate = candidates.get(hint.articleId) ?? {
          articleId: hint.articleId,
          firstSeen: candidates.size,
          terms: new Set<string>(),
          hints: new Map<string, RetrievalHint>(),
        };
        candidate.terms.add(term);
        candidate.hints.set(canonicalJson(hint), hint);
        candidates.set(candidate.articleId, candidate);
      };

      for (const authorized of scopes) {
        const scope = authorized.scope;
        if (candidateAdapter === undefined) {
          for (const term of terms) {
            const pages = await index.readPostingPages(scope, term);
            for (const page of pages) {
              budget.indexEntries(page.entries.length);
              for (const hint of page.entries) add(hint, scope, term);
            }
          }
          continue;
        }
        if (typeof candidateAdapter.search !== "function")
          throw new RetrievalBudgetError();
        let cursor: string | undefined;
        const seen = new Set<string>();
        for (;;) {
          const allowance = budget.remainingCandidateWork();
          // Every external page consumes at least one page/read allowance.
          // Do not dispatch work that cannot fit, even with an empty response.
          if (
            allowance.pagesRead < 1 ||
            allowance.keyedReads < 1 ||
            allowance.physicalRows < 1
          )
            throw new RetrievalBudgetError();
          const page = snapshotData(
            await candidateAdapter.search({
              scope: snapshotData(scope),
              terms: snapshotData(terms),
              ...(cursor === undefined ? {} : { cursor }),
              budget: allowance,
            }),
          );
          inputSnapshot(page, ["hints", "nextCursor", "work"]);
          if (!Array.isArray(page.hints)) throw new RetrievalBudgetError();
          const work = inputSnapshot(page.work, [
            "keyedReads",
            "physicalRows",
            "postingEntries",
            "pagesRead",
          ]);
          for (const key of [
            "keyedReads",
            "physicalRows",
            "postingEntries",
            "pagesRead",
          ] as const) {
            if (
              !Number.isSafeInteger(work[key]) ||
              work[key] < 0 ||
              work[key] > allowance[key]
            )
              throw new RetrievalBudgetError();
          }
          if (
            work.pagesRead < 1 ||
            work.postingEntries < page.hints.length ||
            (page.hints.length > 0 && work.physicalRows < 1)
          )
            throw new RetrievalBudgetError();
          budget.accountExternal(work);
          for (const hint of page.hints) add(hint, scope, "adapter");
          if (page.nextCursor === null) break;
          requireIdentifier(page.nextCursor, "candidate cursor");
          if (seen.has(page.nextCursor)) throw new RetrievalBudgetError();
          seen.add(page.nextCursor);
          cursor = page.nextCursor;
        }
      }
      if (candidates.size > limits.maxHeadProbes)
        throw new RetrievalBudgetError();
      const current: Candidate[] = [];
      for (const candidate of candidates.values()) {
        budget.candidateHead();
        const generation = await repository.readResourceGeneration(
          "article",
          candidate.articleId,
        );
        // Draft work can advance this head without changing its publication.
        // Only the current checker establishes authority; hints identify it.
        if (generation !== null) current.push(candidate);
      }
      return current.sort((left, right) =>
        candidateAdapter === undefined
          ? right.terms.size - left.terms.size ||
            ordinal(left.articleId, right.articleId)
          : left.firstSeen - right.firstSeen,
      );
    }

    async function search(
      access: AccessContext,
      collectionIds: readonly string[],
      terms: readonly string[],
      applicability: Applicability,
      purpose: Purpose,
      resultLimit: number,
    ): Promise<readonly CheckedPublication[]> {
      if (!mayRead(access, purpose) || terms.length === 0) return [];
      const scopes: AuthorizedScope[] = [];
      // Check every requested collection before any derived index lookup.
      for (const collectionId of collectionIds) {
        const authorized = await authorizeCollection(
          access,
          collectionId,
          purpose,
        );
        if (authorized === null) return [];
        scopes.push(authorized);
      }
      const candidates = await queryHints(scopes, terms);
      const confirmed: {
        checked: CheckedPublication;
        score: number;
        firstSeen: number;
      }[] = [];
      // Adapter order is a relevance hint for bounded preselection only.
      // Every candidate still needs current publication confirmation.
      for (const candidate of candidates.slice(0, limits.maxConfirmations)) {
        budget.confirmation();
        let checked: CheckedPublication;
        try {
          checked = await checker.check({
            articleId: candidate.articleId,
            purpose,
            access,
            applicability,
          });
        } catch (error) {
          if (error instanceof KnowledgeBaseNotFoundError) continue;
          throw error;
        }
        if (
          ![...candidate.hints.values()].some(
            (hint) =>
              hint.articleId === checked.article.articleId &&
              hint.collectionId === checked.article.collectionId &&
              hint.policyVersion === checked.binding.collectionPolicyVersion &&
              hint.articleRevision === checked.article.revision &&
              hint.contentHash === checked.article.contentHash,
          )
        )
          continue;
        const score = scoreConfirmedArticle(checked.article, terms);
        // An adapter may match approved body text or synonyms rather than the
        // title/summary/tags used by the default lexical index.
        if (score > 0 || candidateAdapter !== undefined)
          confirmed.push({ checked, score, firstSeen: candidate.firstSeen });
      }
      confirmed.sort(
        (left, right) =>
          right.score - left.score ||
          (candidateAdapter === undefined
            ? ordinal(
                left.checked.article.articleId,
                right.checked.article.articleId,
              )
            : left.firstSeen - right.firstSeen),
      );
      return confirmed.slice(0, resultLimit).map(({ checked }) => checked);
    }

    async function sourceResult(
      checked: readonly CheckedPublication[],
      fitWholeArticles = false,
    ): Promise<AnswerSourcesResult> {
      if (checked.length === 0 || typeof tokenCounter?.count !== "function")
        return noSources();
      for (let count = checked.length; count > 0; count -= 1) {
        const selected = checked.slice(0, count);
        const sources = selected.map(sourceOf);
        const serializedSources = canonicalJson(sources);
        if (
          new TextEncoder().encode(serializedSources).byteLength <=
          limits.maxContentBytes
        ) {
          let sourceTokens: number;
          try {
            sourceTokens = tokenCounter.count(serializedSources);
          } catch {
            return noSources();
          }
          if (!Number.isSafeInteger(sourceTokens) || sourceTokens <= 0)
            return noSources();
          if (sourceTokens <= limits.maxSourceTokens) {
            for (const source of selected) await checker.recheck(source);
            return {
              outcome: "results",
              sources,
              serializedSources,
              sourceTokens,
            };
          }
        }
        // Select only complete top-ranked articles; an exact citation list
        // instead remains all-or-nothing during reconfirmation.
        if (!fitWholeArticles) return noSources();
      }
      return noSources();
    }

    return {
      budget,
      repository,
      index,
      checker,
      authorizeCollection,
      search,
      sourceResult,
    };
  }

  function queryTerms(query: string): readonly string[] {
    if (typeof query !== "string" || query.length > limits.maxQueryCharacters) {
      throw new TypeError("Query exceeds its configured character bound");
    }
    const terms = normalizeQuery(query);
    if (terms.length > limits.maxQueryTerms)
      throw new TypeError("Query exceeds its configured term bound");
    return terms;
  }

  return {
    async listPortalCollections(access, request) {
      const caller = snapshotData(access);
      const query = inputSnapshot(request, ["limit"]);
      const limit = requestedLimit(query.limit, limits.maxDirectoryCollections);
      if (!mayRead(caller, "portal")) return noCollections();
      try {
        const scope = requestScope();
        const ids = await scope.index.readDirectory();
        if (ids.length > limits.maxDirectoryCollections) return noCollections();
        const authorized: AuthorizedScope[] = [];
        for (const id of ids) {
          requireIdentifier(id, "collectionId");
          const collection = await scope.authorizeCollection(
            caller,
            id,
            "portal",
          );
          if (collection !== null) authorized.push(collection);
        }
        const selected = authorized
          .sort((left, right) =>
            ordinal(left.scope.collectionId, right.scope.collectionId),
          )
          .slice(0, limit);
        for (const collection of selected) {
          if (
            (await scope.repository.readResourceGeneration(
              "collection",
              collection.scope.collectionId,
            )) !== collection.governanceGeneration
          ) {
            return noCollections();
          }
        }
        return selected.length === 0
          ? noCollections()
          : {
              outcome: "results",
              collections: selected.map((collection) => ({
                collectionId: collection.scope.collectionId,
                label: collection.label,
              })),
            };
      } catch {
        return noCollections();
      }
    },

    async searchPublishedArticles(access, request) {
      const caller = snapshotData(access);
      const query = inputSnapshot(request, [
        "collectionId",
        "query",
        "applicability",
        "limit",
      ]);
      requireIdentifier(query.collectionId, "collectionId");
      const terms = queryTerms(query.query);
      const applicability = applicabilitySnapshot(query.applicability);
      const limit = requestedLimit(query.limit, limits.maxResults);
      try {
        const scope = requestScope();
        const checked = await scope.search(
          caller,
          [query.collectionId],
          terms,
          applicability,
          "portal",
          limit,
        );
        const articles = checked.map(portalArticleOf);
        if (
          articles.length === 0 ||
          new TextEncoder().encode(canonicalJson(articles)).byteLength >
            limits.maxContentBytes
        )
          return noPortalResult();
        for (const article of checked) await scope.checker.recheck(article);
        return { outcome: "results", articles };
      } catch {
        return noPortalResult();
      }
    },

    async retrieveAnswerSources(effectiveCustomerAccess, request) {
      const caller = snapshotData(effectiveCustomerAccess);
      const query = inputSnapshot(request, [
        "collectionIds",
        "query",
        "applicability",
        "limit",
      ]);
      if (
        !Array.isArray(query.collectionIds) ||
        query.collectionIds.length === 0 ||
        query.collectionIds.length > limits.maxBotCollections
      ) {
        throw new TypeError("Bot retrieval exceeds its collection bound");
      }
      for (const id of query.collectionIds)
        requireIdentifier(id, "collectionId");
      if (new Set(query.collectionIds).size !== query.collectionIds.length)
        throw new TypeError("Collection ids must be unique");
      const terms = queryTerms(query.query);
      const applicability = applicabilitySnapshot(query.applicability);
      const limit = requestedLimit(query.limit, limits.maxResults);
      if (typeof tokenCounter?.count !== "function") return noSources();
      try {
        const scope = requestScope();
        return await scope.sourceResult(
          await scope.search(
            caller,
            query.collectionIds,
            terms,
            applicability,
            "bot",
            limit,
          ),
          true,
        );
      } catch {
        return noSources();
      }
    },

    async confirmAnswerSources(effectiveCustomerAccess, request) {
      const caller = snapshotData(effectiveCustomerAccess);
      const query = inputSnapshot(request, ["references", "applicability"]);
      const applicability = applicabilitySnapshot(query.applicability);
      if (
        !Array.isArray(query.references) ||
        query.references.length === 0 ||
        query.references.length > limits.maxResults
      ) {
        throw new TypeError("Citation references exceed their result bound");
      }
      for (const reference of query.references) validateReference(reference);
      if (
        new Set(query.references.map((reference) => reference.articleId))
          .size !== query.references.length ||
        new Set(query.references.map((reference) => reference.collectionId))
          .size > limits.maxBotCollections
      )
        throw new TypeError(
          "Citation references must have unique articles and bounded collections",
        );
      if (typeof tokenCounter?.count !== "function" || !mayRead(caller, "bot"))
        return noSources();
      try {
        const scope = requestScope();
        for (const collectionId of new Set(
          query.references.map((reference) => reference.collectionId),
        )) {
          if (
            (await scope.authorizeCollection(caller, collectionId, "bot")) ===
            null
          )
            return noSources();
        }
        const checked: CheckedPublication[] = [];
        for (const reference of query.references) {
          scope.budget.candidateHead();
          if (
            (await scope.repository.readResourceGeneration(
              "article",
              reference.articleId,
            )) !== reference.applicationGeneration
          )
            return noSources();
          scope.budget.confirmation();
          const confirmed = await scope.checker.check({
            articleId: reference.articleId,
            purpose: "bot",
            access: caller,
            applicability,
          });
          if (
            canonicalJson(referenceOf(confirmed)) !== canonicalJson(reference)
          )
            return noSources();
          checked.push(confirmed);
        }
        return await scope.sourceResult(checked);
      } catch {
        return noSources();
      }
    },
  };
}
