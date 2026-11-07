import { defineCollection, type StoredRecord } from "@pegma/storage-core";
import {
  canonicalJson,
  RepositoryCapacityError,
  RepositoryIntegrityError,
  requireGeneration,
  requireIdentifier,
} from "./storage-helpers.js";

export interface RetrievalScope {
  readonly collectionId: string;
  readonly policyVersion: number;
  readonly use: "portal" | "bot";
}

/** Derived identity only. A hint never grants authority to content. */
export interface RetrievalHint extends RetrievalScope {
  readonly articleId: string;
  readonly articleRevision: number;
  readonly contentHash: string;
  readonly generation: number;
  readonly sourceGeneration: number;
  readonly bindingHash: string;
}

export interface RetrievalPostingPage {
  readonly entries: readonly RetrievalHint[];
}

export interface RetrievalProjectionTarget {
  readonly scope: RetrievalScope;
  readonly hint: RetrievalHint;
  readonly terms: readonly string[];
}

export interface RetrievalStoredTarget {
  readonly scope: RetrievalScope;
  readonly hint: RetrievalHint;
  readonly termHashes: readonly string[];
}

export type RetrievalBlockedReason =
  "capacity" | "source-unavailable" | "conflict";

export interface RetrievalProjectionState {
  readonly articleId: string;
  /** Monotonic projection-plan fence, independent of article generation. */
  readonly generation: number;
  /** Authoritative article generation used to derive this plan. */
  readonly sourceGeneration: number;
  readonly status: "pending" | "ready" | "blocked";
  readonly reason?: RetrievalBlockedReason;
  readonly targets: readonly RetrievalStoredTarget[];
  readonly pendingScopes: readonly RetrievalScope[];
  readonly knownScopes: readonly RetrievalScope[];
}

export type RetrievalRecordKind =
  | "directory"
  | "catalog"
  | "article"
  | "scope"
  | "manifest"
  | "posting"
  | "page";

export interface RetrievalRecord {
  readonly schemaVersion: 1;
  readonly partition: string;
  readonly id: string;
  readonly kind: RetrievalRecordKind;
  readonly data: unknown;
}

const kinds: readonly string[] = [
  "directory",
  "catalog",
  "article",
  "scope",
  "manifest",
  "posting",
  "page",
];
const maximumNativeBytes = 900_000;
const chunkCharacters = 30_000;
const maximumChunks = 15;

export function requireRetrievalScope(scope: RetrievalScope): void {
  requireIdentifier(scope.collectionId, "collectionId");
  requireGeneration(scope.policyVersion, 1);
  if (scope.use !== "portal" && scope.use !== "bot")
    throw new TypeError("Expected a retrieval use");
  if (
    Object.keys(scope).some(
      (key) => !["collectionId", "policyVersion", "use"].includes(key),
    )
  )
    throw new TypeError("Unexpected retrieval scope field");
}

export function requireRetrievalHint(hint: RetrievalHint): void {
  requireRetrievalScope({
    collectionId: hint.collectionId,
    policyVersion: hint.policyVersion,
    use: hint.use,
  });
  requireIdentifier(hint.articleId, "articleId");
  requireGeneration(hint.articleRevision, 1);
  requireGeneration(hint.generation, 1);
  requireGeneration(hint.sourceGeneration);
  if (
    !/^[a-f0-9]{64}$/u.test(hint.contentHash) ||
    !/^[a-f0-9]{64}$/u.test(hint.bindingHash)
  )
    throw new TypeError("Expected a retrieval digest");
  const allowed = [
    "collectionId",
    "policyVersion",
    "use",
    "articleId",
    "articleRevision",
    "contentHash",
    "generation",
    "sourceGeneration",
    "bindingHash",
  ];
  if (
    Object.keys(hint).length !== allowed.length ||
    Object.keys(hint).some((key) => !allowed.includes(key))
  )
    throw new TypeError("Unexpected retrieval hint field");
}

function validateRecord(record: RetrievalRecord): void {
  if (
    record.schemaVersion !== 1 ||
    !kinds.includes(record.kind) ||
    typeof record.partition !== "string" ||
    !/^(directory|catalog:[a-f0-9]{64}|article:[a-f0-9]{64}|scope:[a-f0-9]{64})$/u.test(
      record.partition,
    ) ||
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    record.id.length > 200 ||
    /[^A-Za-z0-9:._-]/u.test(record.id) ||
    record.data === null ||
    typeof record.data !== "object" ||
    Array.isArray(record.data)
  )
    throw new RepositoryIntegrityError();
}

export function encodeRetrievalRecord(record: RetrievalRecord): StoredRecord {
  validateRecord(record);
  const payload = canonicalJson(record.data);
  if (payload.length * 2 > maximumNativeBytes - 4_096)
    throw new RepositoryCapacityError("index_record_bytes");
  const parts: string[] = [];
  for (let offset = 0; offset < payload.length;) {
    let end = Math.min(payload.length, offset + chunkCharacters);
    const last = payload.charCodeAt(end - 1);
    if (end < payload.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(payload.slice(offset, end));
    offset = end;
  }
  if (parts.length === 0 || parts.length > maximumChunks)
    throw new RepositoryCapacityError("index_record_chunks");
  const encoded: Record<string, string | number> = {
    schemaVersion: 1,
    recordPartition: record.partition,
    recordId: record.id,
    kind: record.kind,
    partCount: parts.length,
  };
  for (const [index, part] of parts.entries()) encoded["part" + index] = part;
  return encoded;
}

export function decodeRetrievalRecord(record: StoredRecord): RetrievalRecord {
  try {
    if (record.schemaVersion !== 1 || typeof record.partCount !== "number")
      throw new RepositoryIntegrityError();
    requireGeneration(record.partCount, 1);
    if (record.partCount > maximumChunks) throw new RepositoryIntegrityError();
    const expected = new Set([
      "schemaVersion",
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
    if (payload.length * 2 > maximumNativeBytes - 4_096)
      throw new RepositoryIntegrityError();
    const decoded: RetrievalRecord = {
      schemaVersion: 1,
      partition: record.recordPartition as string,
      id: record.recordId as string,
      kind: record.kind as RetrievalRecordKind,
      data: JSON.parse(payload) as unknown,
    };
    validateRecord(decoded);
    canonicalJson(decoded.data);
    return decoded;
  } catch {
    throw new RepositoryIntegrityError();
  }
}

export const retrievalRecords = defineCollection<RetrievalRecord>({
  name: "knowledge-base.retrieval.v1",
  key: (record) => ({ partition: record.partition, id: record.id }),
  codec: { encode: encodeRetrievalRecord, decode: decodeRetrievalRecord },
});
