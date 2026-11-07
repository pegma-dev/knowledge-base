import { TableClient } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import {
  knowledgeRecords,
  type KnowledgeRecord,
} from "@pegma/knowledge-base-application";
import { createAzureTablesStore } from "@pegma/storage-azure-tables";
import { createMemoryStore, type Store } from "@pegma/storage-core";
import { TABLE_PORT } from "./azurite.js";
import { createD1Store } from "./d1.js";

function azureStore(): Store {
  const connection = `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:${TABLE_PORT}/devstoreaccount1;`;
  return createAzureTablesStore({
    client: TableClient.fromConnectionString(
      connection,
      `knowledge${randomUUID().replaceAll("-", "")}`,
      { allowInsecureConnection: true },
    ),
  });
}
export const storeFactories = [
  ["memory", createMemoryStore],
  ["Azurite", azureStore],
  ["Miniflare D1", createD1Store],
] as const;

/** Bounded observation of the actual backing collection, not a parallel store. */
export async function allKnowledgeRows(
  store: Store,
): Promise<KnowledgeRecord[]> {
  const records = store.collection(knowledgeRecords);
  const rows: KnowledgeRecord[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 8; pageNumber += 1) {
    const page = await records.scan({
      limit: 1_000,
      ...(cursor === undefined ? {} : { cursor }),
    });
    rows.push(...page.records.map((record) => record.value));
    if (page.nextCursor === null)
      return rows.sort((left, right) =>
        `${left.partition}/${left.id}`.localeCompare(
          `${right.partition}/${right.id}`,
        ),
      );
    cursor = page.nextCursor;
  }
  throw new Error("Synthetic fixture exceeded its bounded snapshot scan");
}
