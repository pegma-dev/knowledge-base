import type { AccessContext } from "@pegma/authorization-core";
import type { SearchPublishedArticlesInput } from "./retrieval-types.js";
import type { PublishedArticleDto } from "./types.js";

declare const publishedSearchObservationBrand: unique symbol;

/** Same-instance, actor-bound, single-use background observation; never persist it. */
export interface PublishedSearchObservation {
  readonly [publishedSearchObservationBrand]: true;
}

/** Current authorized collection identity; no policy, audience, or staff metadata. */
export interface PublishedSearchScopeState {
  readonly collectionId: string;
  readonly generation: number;
  readonly scopeHash: string;
}

export type PublishedSearchObservationResult =
  | {
      readonly outcome: "complete";
      readonly articles: readonly PublishedArticleDto[];
      readonly scopeState: PublishedSearchScopeState;
      readonly observation: PublishedSearchObservation;
    }
  | {
      readonly outcome: "partial" | "unavailable";
      readonly articles: readonly [];
    };

/**
 * Bounded background comparison work, never portal/request-path retrieval.
 * Complete covers the exact collection, applicability and approved-metadata
 * lexical query only. It establishes no global duplicate absence or lock.
 */
export interface PublishedSearchObservations {
  /** Keyed scope/authority recheck only; no corpus enumeration or collectionRead. */
  readScope(
    access: AccessContext,
    input: { readonly collectionId: string },
  ): Promise<PublishedSearchScopeState>;
  observe(
    access: AccessContext,
    input: SearchPublishedArticlesInput,
  ): Promise<PublishedSearchObservationResult>;
  /** Rechecks scope membership, versions, source eligibility and current authority. */
  confirm(
    access: AccessContext,
    observation: PublishedSearchObservation,
  ): Promise<void>;
}
