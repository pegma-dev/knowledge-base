import type {
  CollectionDefinition,
  EntityKey,
  Store,
  TransactionAction,
  TransactionOutcome,
} from "@pegma/storage-core";

export interface TransactionTrace {
  readonly collection: string;
  readonly partition: string;
  readonly actions: readonly TransactionAction<unknown>[];
}

export interface GetTrace {
  readonly collection: string;
  readonly key: EntityKey;
}

/** Delegates all data to the real Store; only read timing and transactions vary. */
export function traceStore(backing: Store) {
  const transactions: TransactionTrace[] = [];
  let intercept:
    | ((
        trace: TransactionTrace,
        commit: () => Promise<TransactionOutcome>,
      ) => Promise<TransactionOutcome>)
    | undefined;
  let beforeGet: ((trace: GetTrace) => Promise<void>) | undefined;
  const store: Store = {
    collection<T>(definition: CollectionDefinition<T>) {
      const target = backing.collection(definition);
      return new Proxy(target, {
        get(object, property) {
          if (property === "get")
            return async (key: EntityKey) => {
              await beforeGet?.({
                collection: definition.name,
                key: structuredClone(key),
              });
              return object.get(key);
            };
          if (property === "transact")
            return async (
              partition: string,
              actions: readonly TransactionAction<T>[],
            ) => {
              const trace = {
                collection: definition.name,
                partition,
                actions: structuredClone(actions),
              };
              transactions.push(trace);
              const commit = () => object.transact(partition, actions);
              return intercept === undefined
                ? commit()
                : intercept(trace, commit);
            };
          const value: unknown = Reflect.get(object, property, object);
          return typeof value === "function" ? value.bind(object) : value;
        },
      });
    },
  };
  return {
    store,
    transactions,
    intercept: (handler: typeof intercept) => {
      intercept = handler;
    },
    beforeGet: (handler: typeof beforeGet) => {
      beforeGet = handler;
    },
  };
}

/** Manual, bounded test barrier for completing real transactions out of order. */
export function barrier() {
  let release: (() => void) | undefined;
  let announce: (() => void) | undefined;
  const reached = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    reached,
    wait: () => {
      announce!();
      return waiting;
    },
    release: () => {
      release!();
    },
  };
}
