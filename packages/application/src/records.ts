import { defineCollection, type StoredRecord } from "@pegma/storage-core";
import type {
  Article,
  Collection,
  ValidationPolicy,
} from "@pegma/knowledge-base-contracts";
import type {
  EvidenceRevocation,
  GovernanceConfiguration,
  ReviewSnapshot,
  SourceSnapshot,
} from "./types.js";
import {
  canonicalJson,
  RepositoryCapacityError,
  RepositoryIntegrityError,
  requireGeneration,
  requireIdentifier,
} from "./storage-helpers.js";

export type ResourceKind = "article" | "collection" | "validation";

export interface StoredArticle {
  readonly generation: number;
  readonly article: Article;
  readonly provenance: SourceSnapshot;
  readonly review?: ReviewSnapshot;
  readonly publishedProvenance?: SourceSnapshot;
  readonly publicationReview?: ReviewSnapshot;
  readonly publicationHeld: boolean;
  readonly revokedEvidence: readonly EvidenceRevocation[];
}

export interface StoredCollection {
  readonly generation: number;
  readonly collection: Collection;
  readonly configuration?: GovernanceConfiguration;
}

export interface StoredValidationPolicy {
  readonly generation: number;
  readonly policy: ValidationPolicy;
}

export type KnowledgeRecordKind =
  | "head"
  | "revision"
  | "evidence"
  | "review"
  | "publication"
  | "provenance"
  | "revocation"
  | "collection-policy"
  | "configuration"
  | "policy"
  | "audit"
  | "command"
  | "job";

export interface KnowledgeRecord {
  readonly schemaVersion: 1;
  readonly resourceKind: ResourceKind;
  readonly resourceId: string;
  readonly partition: string;
  readonly id: string;
  readonly kind: KnowledgeRecordKind;
  readonly data: unknown;
}

export const maximumRecordNativeBytes = 900_000;
export const maximumTransactionEncodedBytes = 3 * 1024 * 1024;
export const maximumTransactionActions = 100;
const chunkCharacters = 30_000;
const maximumChunks = 15;
const kinds: readonly string[] = [
  "head",
  "revision",
  "evidence",
  "review",
  "publication",
  "provenance",
  "revocation",
  "collection-policy",
  "configuration",
  "policy",
  "audit",
  "command",
  "job",
];

function validateRecord(record: KnowledgeRecord): void {
  if (
    record.schemaVersion !== 1 ||
    !["article", "collection", "validation"].includes(record.resourceKind) ||
    !kinds.includes(record.kind)
  )
    throw new RepositoryIntegrityError();
  requireIdentifier(record.resourceId);
  if (
    record.data === null ||
    typeof record.data !== "object" ||
    Array.isArray(record.data)
  )
    throw new RepositoryIntegrityError();
  if (
    typeof record.partition !== "string" ||
    typeof record.id !== "string" ||
    !new RegExp("^" + record.resourceKind + ":[a-f0-9]{64}$", "u").test(
      record.partition,
    ) ||
    record.id.length === 0 ||
    record.id.length > 300 ||
    /[^A-Za-z0-9|:._-]/u.test(record.id)
  )
    throw new RepositoryIntegrityError();
}

export function encodeKnowledgeRecord(record: KnowledgeRecord): StoredRecord {
  validateRecord(record);
  const payload = canonicalJson(record.data);
  if (payload.length * 2 > maximumRecordNativeBytes - 4_096)
    throw new RepositoryCapacityError("record_bytes");
  const parts: string[] = [];
  for (let offset = 0; offset < payload.length;) {
    let end = Math.min(payload.length, offset + chunkCharacters);
    const last = payload.charCodeAt(end - 1);
    if (end < payload.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(payload.slice(offset, end));
    offset = end;
  }
  if (parts.length === 0 || parts.length > maximumChunks)
    throw new RepositoryCapacityError("record_chunks");
  const encoded: Record<string, string | number> = {
    schemaVersion: 1,
    resourceKind: record.resourceKind,
    resourceId: record.resourceId,
    recordPartition: record.partition,
    recordId: record.id,
    kind: record.kind,
    partCount: parts.length,
  };
  for (const [index, part] of parts.entries()) encoded["part" + index] = part;
  return encoded;
}

export function decodeKnowledgeRecord(record: StoredRecord): KnowledgeRecord {
  try {
    if (record.schemaVersion !== 1 || typeof record.partCount !== "number")
      throw new RepositoryIntegrityError();
    requireGeneration(record.partCount, 1);
    if (record.partCount > maximumChunks) throw new RepositoryIntegrityError();
    const expected = new Set([
      "schemaVersion",
      "resourceKind",
      "resourceId",
      "recordPartition",
      "recordId",
      "kind",
      "partCount",
      ...Array.from({ length: record.partCount }, (_, index) => "part" + index),
    ]);
    if (
      Object.keys(record).length !== expected.size ||
      Object.keys(record).some((key) => !expected.has(key))
    )
      throw new RepositoryIntegrityError();
    const parts: string[] = [];
    for (let index = 0; index < record.partCount; index += 1) {
      const part = record["part" + index];
      if (typeof part !== "string" || part.length > chunkCharacters)
        throw new RepositoryIntegrityError();
      parts.push(part);
    }
    const payload = parts.join("");
    if (payload.length * 2 > maximumRecordNativeBytes - 4_096)
      throw new RepositoryIntegrityError();
    const decoded: KnowledgeRecord = {
      schemaVersion: 1,
      resourceKind: record.resourceKind as ResourceKind,
      resourceId: record.resourceId as string,
      partition: record.recordPartition as string,
      id: record.recordId as string,
      kind: record.kind as KnowledgeRecordKind,
      data: JSON.parse(payload) as unknown,
    };
    validateRecord(decoded);
    canonicalJson(decoded.data);
    return decoded;
  } catch {
    throw new RepositoryIntegrityError();
  }
}

export const knowledgeRecords = defineCollection<KnowledgeRecord>({
  name: "knowledge-base.records.v1",
  key: (record) => ({ partition: record.partition, id: record.id }),
  codec: { encode: encodeKnowledgeRecord, decode: decodeKnowledgeRecord },
});
