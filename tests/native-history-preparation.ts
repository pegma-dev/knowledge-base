import {
  knowledgeRecords,
  retrievalRecords,
} from "@pegma/knowledge-base-application";
import type {
  CollectionDefinition,
  Store,
  TransactionAction,
} from "@pegma/storage-core";
import { expect } from "vitest";
import { allKnowledgeRows } from "../test/application-stores.js";
import { allRetrievalRows } from "../test/retrieval-fixtures.js";

/**
 * Prepare a read-conformance fixture from complete public-application history.
 * Only declared values cross Stores; source version tokens and application
 * observations are never transferred. This is not a migration implementation
 * or evidence that the destination executed the donor's authoring workflow.
 */
export async function prepareNativeHistory(source: Store, target: Store) {
  const knowledge = await allKnowledgeRows(source);
  const retrieval = await allRetrievalRows(source);
  const counts = { transactions: 0, maximumActions: 0 };

  async function insertDeclared<T>(
    definition: CollectionDefinition<T>,
    values: readonly T[],
  ) {
    const destination = target.collection(definition);
    const empty = await destination.scan({ limit: 1 });
    expect(empty.records).toEqual([]);
    expect(empty.nextCursor).toBeNull();
    const partitions = new Map<string, T[]>();
    for (const value of values) {
      const key = definition.key(value);
      const rows = partitions.get(key.partition);
      if (rows === undefined) partitions.set(key.partition, [value]);
      else rows.push(value);
    }
    // Public transact requires one partition and at most 100 actions. The
    // actual destination adapter applies its own codec and SQL parameters.
    for (const [partition, rows] of partitions) {
      for (let offset = 0; offset < rows.length; offset += 100) {
        const actions: TransactionAction<T>[] = rows
          .slice(offset, offset + 100)
          .map((value): TransactionAction<T> => ({ action: "insert", value }));
        counts.maximumActions = Math.max(counts.maximumActions, actions.length);
        expect(actions.length).toBeLessThanOrEqual(100);
        const outcome = await destination.transact(partition, actions);
        expect(outcome.committed).toBe(true);
        counts.transactions += 1;
      }
    }
  }

  await insertDeclared(knowledgeRecords, knowledge);
  await insertDeclared(retrievalRecords, retrieval);
  // Include every immutable receipt/Audit/job and exact quota/projection row,
  // rather than reconstructing only the records needed by the positive read.
  expect(await allKnowledgeRows(target)).toEqual(knowledge);
  expect(await allRetrievalRows(target)).toEqual(retrieval);
  return {
    knowledgeRows: knowledge.length,
    retrievalRows: retrieval.length,
    ...counts,
  };
}
