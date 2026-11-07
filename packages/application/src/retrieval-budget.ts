import type {
  CollectionDefinition,
  EntityKey,
  Store,
} from "@pegma/storage-core";

/** Internal diagnostic/control flow; public retrieval stays content-free. */
export class RetrievalBudgetError extends Error {
  constructor(readonly reason: "work" | "operation" = "work") {
    super(
      reason === "operation"
        ? "Knowledge retrieval cannot enumerate or mutate its request Store"
        : "Knowledge retrieval exhausted its bounded work allowance",
    );
    this.name = "RetrievalBudgetError";
  }
}

export interface RequestReadLimits {
  readonly maxPhysicalReads: number;
  readonly maxIndexReads: number;
  readonly maxPostingEntries: number;
  readonly maxCandidateHeads: number;
  readonly maxConfirmations: number;
  readonly indexCollectionName: string;
}

export interface ExternalRetrievalWork {
  readonly keyedReads: number;
  readonly physicalRows: number;
  readonly postingEntries: number;
  readonly pagesRead?: number;
}

export interface RetrievalReadBudget {
  readonly store: Store;
  remainingCandidateWork(): Required<ExternalRetrievalWork>;
  indexEntries(count: number): void;
  candidateHead(): void;
  confirmation(): void;
  accountExternal(work: ExternalRetrievalWork): void;
}

/**
 * A fresh wrapper belongs to exactly one request. Each scoped Store keyed read
 * reserves its allowance before awaiting the backing Store, including misses.
 * External candidate calls are sequential: check allowance before dispatch,
 * then charge their reported work with accountExternal after return. The
 * wrapper never owns or caches persistence.
 */
export function createRetrievalReadBudget(
  backing: Store,
  limits: RequestReadLimits,
): RetrievalReadBudget {
  const captured = Object.freeze({ ...limits });
  for (const bound of [
    captured.maxPhysicalReads,
    captured.maxIndexReads,
    captured.maxPostingEntries,
    captured.maxCandidateHeads,
    captured.maxConfirmations,
  ]) {
    if (!Number.isSafeInteger(bound) || bound < 1)
      throw new TypeError("Retrieval read bounds must be positive integers");
  }
  let physicalReads = 0;
  let indexReads = 0;
  let entries = 0;
  let candidateHeads = 0;
  let confirmations = 0;
  const count = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RetrievalBudgetError();
    return value;
  };
  const reserve = (collection: string) => {
    if (
      physicalReads >= captured.maxPhysicalReads ||
      (collection === captured.indexCollectionName &&
        indexReads >= captured.maxIndexReads)
    )
      throw new RetrievalBudgetError();
    physicalReads += 1;
    if (collection === captured.indexCollectionName) indexReads += 1;
  };
  const store: Store = Object.freeze({
    collection<T>(definition: CollectionDefinition<T>) {
      const target = backing.collection(definition);
      return new Proxy(target, {
        get(object, property) {
          if (property === "get")
            return async (key: EntityKey) => {
              reserve(definition.name);
              return object.get(key);
            };
          if (property === "getVersioned")
            return async (key: EntityKey) => {
              reserve(definition.name);
              return object.getVersioned(key);
            };
          // Retrieval must neither scan a corpus nor mutate its authority/hints.
          throw new RetrievalBudgetError("operation");
        },
      });
    },
  });
  return Object.freeze({
    store,
    remainingCandidateWork() {
      const reads = Math.max(
        0,
        Math.min(
          captured.maxPhysicalReads - physicalReads,
          captured.maxIndexReads - indexReads,
        ),
      );
      return Object.freeze({
        keyedReads: reads,
        physicalRows: reads,
        pagesRead: reads,
        postingEntries: Math.max(0, captured.maxPostingEntries - entries),
      });
    },
    indexEntries(value: number) {
      entries += count(value);
      if (entries > captured.maxPostingEntries)
        throw new RetrievalBudgetError();
    },
    candidateHead() {
      candidateHeads += 1;
      if (candidateHeads > captured.maxCandidateHeads)
        throw new RetrievalBudgetError();
    },
    confirmation() {
      confirmations += 1;
      if (confirmations > captured.maxConfirmations)
        throw new RetrievalBudgetError();
    },
    accountExternal(work: ExternalRetrievalWork) {
      // Adapter accounting is host-supplied. Validate it and count work before
      // consuming any hint; declared work cannot grant more authority or budget.
      const reads = Math.max(
        count(work.keyedReads),
        count(work.physicalRows),
        count(work.pagesRead ?? 0),
      );
      physicalReads += reads;
      indexReads += reads;
      entries += count(work.postingEntries);
      if (
        physicalReads > captured.maxPhysicalReads ||
        indexReads > captured.maxIndexReads ||
        entries > captured.maxPostingEntries
      )
        throw new RetrievalBudgetError();
    },
  });
}
