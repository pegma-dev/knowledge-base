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

export interface ReadTrace extends GetTrace {
  readonly method: "get" | "getVersioned";
}

export interface EnumerationTrace {
  readonly collection: string;
  readonly method: "list" | "listVersioned" | "scan";
  readonly input: unknown;
}

/** Delegates all data to the real Store; only read timing and transactions vary. */
export function traceStore(backing: Store) {
  const transactions: TransactionTrace[] = [];
  const reads: ReadTrace[] = [];
  const enumerations: EnumerationTrace[] = [];
  let intercept:
    | ((
        trace: TransactionTrace,
        commit: () => Promise<TransactionOutcome>,
      ) => Promise<TransactionOutcome>)
    | undefined;
  let beforeGet: ((trace: GetTrace) => Promise<void>) | undefined;
  let beforeRead: ((trace: ReadTrace) => Promise<void>) | undefined;
  const store: Store = {
    collection<T>(definition: CollectionDefinition<T>) {
      const target = backing.collection(definition);
      return new Proxy(target, {
        get(object, property) {
          if (property === "get" || property === "getVersioned")
            return async (key: EntityKey) => {
              const trace: ReadTrace = {
                collection: definition.name,
                method: property,
                key: structuredClone(key),
              };
              reads.push(trace);
              await beforeRead?.(trace);
              if (property === "get") await beforeGet?.(trace);
              return property === "get"
                ? object.get(key)
                : object.getVersioned(key);
            };
          if (
            property === "list" ||
            property === "listVersioned" ||
            property === "scan"
          )
            return async (input: unknown) => {
              enumerations.push({
                collection: definition.name,
                method: property,
                input: structuredClone(input),
              });
              const method = Reflect.get(object, property, object) as (
                value: unknown,
              ) => Promise<unknown>;
              return method.call(object, input);
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
    reads,
    enumerations,
    intercept: (handler: typeof intercept) => {
      intercept = handler;
    },
    beforeGet: (handler: typeof beforeGet) => {
      beforeGet = handler;
    },
    beforeRead: (handler: typeof beforeRead) => {
      beforeRead = handler;
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
