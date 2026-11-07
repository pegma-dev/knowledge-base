import type { AccessContext } from "@pegma/authorization-core";
import type {
  Applicability,
  ArticleContent,
} from "@pegma/knowledge-base-contracts";

import type { RetrievalHint, RetrievalScope } from "./retrieval-records.js";
import type { PublishedArticleDto } from "./types.js";

/** Initial hard ceilings. Per-instance overrides may only reduce these values. */
export const defaultKnowledgeRetrievalLimits = Object.freeze({
  maxDirectoryCollections: 64,
  maxCatalogArticles: 256,
  maxTermsPerArticle: 256,
  postingPageEntries: 16,
  maxPostingPagesPerTerm: 16,
  maxIndexPartitionRows: 8_192,
  maxIndexPartitionBytes: 16 * 1024 * 1024,
  maxQueryCharacters: 256,
  maxQueryTerms: 8,
  maxBotCollections: 4,
  maxIndexKeyReads: 128,
  maxPostingEntries: 2_048,
  maxHeadProbes: 64,
  maxConfirmations: 8,
  maxResults: 5,
  maxContentBytes: 64 * 1024,
  maxSourceTokens: 8_192,
  maxRequestPhysicalGets: 768,
  maxMaintenanceBatches: 32,
  maxRepairScanRows: 100,
});

export type KnowledgeRetrievalLimits = {
  readonly [Key in keyof typeof defaultKnowledgeRetrievalLimits]: number;
};

/** Source-free untrusted search hint; it never establishes publication/access. */
export type KnowledgeCandidateHint = RetrievalHint;
export type KnowledgeRetrievalScope = RetrievalScope;

/** Counts include misses, malformed rows, duplicates, and filtered-out entries. */
export interface CandidateWork {
  readonly keyedReads: number;
  readonly physicalRows: number;
  readonly postingEntries: number;
  readonly pagesRead: number;
}

export interface CandidateSearchRequest {
  readonly scope: KnowledgeRetrievalScope;
  readonly terms: readonly string[];
  readonly cursor?: string;
  /** Remaining work, not an invitation to expand or reset a query's budget. */
  readonly budget: CandidateWork;
}

export interface CandidateSearchPage {
  /** First-seen order across pages supplies deterministic preselection rank. */
  readonly hints: readonly KnowledgeCandidateHint[];
  readonly nextCursor: string | null;
  /** pagesRead is at least one, including empty pages; entries precede filtering. */
  readonly work: CandidateWork;
}

/**
 * Optional host search source, responsible for stable relevance ordering across
 * pages. Body or synonym matches need not overlap title/summary/tag terms.
 * Ranking and matching never authorize content: every returned candidate still
 * requires the current authoritative publication and audience checks.
 * The default implementation uses keyed Store lexical pages.
 */
export interface KnowledgeCandidateAdapter {
  search(request: CandidateSearchRequest): Promise<CandidateSearchPage>;
}

/** Trusted local counter for the complete source serialization returned to a bot. */
export interface SourceTokenCounter {
  count(serializedSources: string): number;
}

export interface KnowledgeRetrievalOptions {
  readonly limits?: Partial<KnowledgeRetrievalLimits>;
  readonly candidateAdapter?: KnowledgeCandidateAdapter;
  /** Required for bot payloads; absence must never result in an uncounted payload. */
  readonly tokenCounter?: SourceTokenCounter;
}

export interface ListPortalCollectionsInput {
  readonly limit?: number;
}

export interface PortalCollectionDto {
  readonly collectionId: string;
  readonly label: string;
}

export interface PortalCollectionsResult {
  readonly outcome: "results" | "no_result";
  readonly collections: readonly PortalCollectionDto[];
}

export interface SearchPublishedArticlesInput {
  readonly collectionId: string;
  readonly query: string;
  /** Exact tuple; absent build/locale does not imply a fallback or wildcard. */
  readonly applicability: Applicability;
  readonly limit?: number;
}

/** All text comes from a freshly confirmed publication, never the index. */
export type PortalSearchArticleDto = Omit<PublishedArticleDto, "content"> & {
  readonly snippet: string;
};

export interface PortalSearchResult {
  readonly outcome: "results" | "no_result";
  readonly articles: readonly PortalSearchArticleDto[];
}

/** A current-observation fence, never an authorization capability or lease. */
export interface AnswerSourceReference {
  readonly articleId: string;
  readonly collectionId: string;
  readonly collectionPolicyVersion: number;
  readonly articleRevision: number;
  readonly contentHash: string;
  readonly applicationGeneration: number;
  readonly governanceGeneration: number;
  readonly validationGeneration: number;
}

export interface KnowledgeCitationDto {
  readonly label: string;
  /** Present only when this same customer separately passes portal authority. */
  readonly portalArticle?: {
    readonly articleId: string;
    readonly revision: number;
  };
}

/** Approved source payload for the trusted bot integration, not a portal DTO. */
export interface AnswerSourceDto {
  readonly reference: AnswerSourceReference;
  readonly citation: KnowledgeCitationDto;
  readonly title: string;
  readonly summary: string;
  readonly content: ArticleContent;
  readonly applicability: Applicability;
}

export interface RetrieveAnswerSourcesInput {
  readonly collectionIds: readonly string[];
  readonly query: string;
  readonly applicability: Applicability;
  readonly limit?: number;
}

export interface ConfirmAnswerSourcesInput {
  readonly references: readonly AnswerSourceReference[];
  readonly applicability: Applicability;
}

export interface AnswerSourcesResult {
  readonly outcome: "results" | "no_result";
  readonly sources: readonly AnswerSourceDto[];
  /** Complete counted source payload, or an empty string for no_result. */
  readonly serializedSources: string;
  /** Zero for no_result; otherwise the trusted counter's complete-payload total. */
  readonly sourceTokens: number;
}

export interface ArticleIndexInput {
  readonly articleId: string;
}

export type ArticleIndexState = "pending" | "ready" | "blocked";

export type ArticleIndexBlockReason =
  "capacity" | "source-unavailable" | "conflict";

/** Staff-only coarse progress; no terms, postings, hashes, or private sources. */
export interface ArticleIndexStatusDto {
  readonly articleId: string;
  readonly status: ArticleIndexState;
  /** A ready withdrawal is converged but has no usable indexed publication. */
  readonly indexed: boolean;
  readonly articleGeneration: number | null;
  readonly projectionGeneration: number | null;
  readonly reason?: ArticleIndexBlockReason;
}

export interface RepairRetrievalPageInput {
  readonly cursor?: string;
  /** Physical scan rows, counted before filtering or candidate deduplication. */
  readonly limit?: number;
}

/** Staff maintenance diagnostics; these counts never enter search/customer DTOs. */
export interface RepairRetrievalPageResult {
  readonly physicalRows: number;
  readonly candidates: number;
  readonly repaired: number;
  readonly pending: number;
  readonly blocked: number;
  readonly nextCursor: string | null;
}

export interface KnowledgeRetrievalApplication {
  listPortalCollections(
    access: AccessContext,
    input: ListPortalCollectionsInput,
  ): Promise<PortalCollectionsResult>;
  searchPublishedArticles(
    access: AccessContext,
    input: SearchPublishedArticlesInput,
  ): Promise<PortalSearchResult>;
  retrieveAnswerSources(
    effectiveCustomerAccess: AccessContext,
    input: RetrieveAnswerSourcesInput,
  ): Promise<AnswerSourcesResult>;
  confirmAnswerSources(
    effectiveCustomerAccess: AccessContext,
    input: ConfirmAnswerSourcesInput,
  ): Promise<AnswerSourcesResult>;
  repairArticleIndex(
    staffAccess: AccessContext,
    input: ArticleIndexInput,
  ): Promise<ArticleIndexStatusDto>;
  repairRetrievalPage(
    staffAccess: AccessContext,
    input: RepairRetrievalPageInput,
  ): Promise<RepairRetrievalPageResult>;
  getArticleIndexStatus(
    staffAccess: AccessContext,
    input: ArticleIndexInput,
  ): Promise<ArticleIndexStatusDto>;
}
