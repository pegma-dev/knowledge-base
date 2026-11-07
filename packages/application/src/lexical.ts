import type { PublishedArticleDto } from "./types.js";
import { RepositoryCapacityError } from "./storage-helpers.js";

const maximumQueryCharacters = 256;
const maximumQueryTerms = 8;
const maximumIndexTerms = 256;
const maximumTermCharacters = 256;
const questionWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "the",
  "to",
  "with",
  "you",
  "your",
]);

type SearchableMetadata = Pick<
  PublishedArticleDto,
  "title" | "summary" | "tags"
>;

/** Deterministic lexical terms only; aliases must be explicit approved tags. */
function terms(value: string): string[] {
  if (typeof value !== "string")
    throw new TypeError("Search metadata must be text");
  const normalized = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
  const result = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (result.some((term) => term.length > maximumTermCharacters)) {
    throw new TypeError("Search term exceeds the supported length");
  }
  return result.filter((term) => !questionWords.has(term));
}

/** Reject oversized input; never silently truncate a customer's query. */
export function normalizeQuery(query: string): readonly string[] {
  if (
    typeof query !== "string" ||
    query.length === 0 ||
    query.length > maximumQueryCharacters ||
    /[\u0000-\u001f\u007f]/u.test(query)
  )
    throw new TypeError("Query must contain at most 256 characters of text");
  const normalized = [...new Set(terms(query))];
  if (normalized.length > maximumQueryTerms) {
    throw new TypeError("Query contains more than eight distinct search terms");
  }
  return Object.freeze(normalized);
}

/**
 * Projection input is approved title/summary/tags, never body text or evidence.
 * Overlarge metadata is a visible indexing failure, not a partial projection.
 */
export function indexArticleTerms(
  article: SearchableMetadata,
  limit = maximumIndexTerms,
): readonly string[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumIndexTerms) {
    throw new TypeError("Index term limit must be between one and 256");
  }
  if (!Array.isArray(article.tags) || article.tags.length > 16) {
    throw new TypeError("Approved tags exceed their schema bound");
  }
  const result = [
    ...new Set([
      ...terms(article.title),
      ...terms(article.summary),
      ...article.tags.flatMap(terms),
    ]),
  ].sort();
  if (result.length > limit) {
    throw new RepositoryCapacityError("index_terms");
  }
  return Object.freeze(result);
}

/** Score only locally confirmed approved metadata, never posting-row text. */
export function scoreConfirmedArticle(
  article: SearchableMetadata,
  queryTerms: readonly string[],
): number {
  if (queryTerms.length > maximumQueryTerms) {
    throw new TypeError("Scoring query exceeds its term bound");
  }
  const title = new Set(terms(article.title));
  const summary = new Set(terms(article.summary));
  const tags = new Set(article.tags.flatMap(terms));
  let score = 0;
  for (const term of queryTerms) {
    if (title.has(term)) score += 12;
    if (tags.has(term)) score += 8;
    if (summary.has(term)) score += 3;
  }
  return score;
}
