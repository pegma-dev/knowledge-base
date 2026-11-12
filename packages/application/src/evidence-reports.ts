import {
  hasPermission,
  serializeAccessContext,
  type AccessContext,
} from "@pegma/authorization-core";
import { auditEvent } from "@pegma/audit";
import {
  knowledgeDigest as coreKnowledgeDigest,
  type EvidenceSubmission,
} from "@pegma/knowledge-base-core";
import {
  knowledgePermissions,
  type Applicability,
  type ArticleRevision,
} from "@pegma/knowledge-base-contracts";
import { defineCollection, type EntityKey } from "@pegma/storage-core";
import type {
  EvidenceVerifier,
  EvidenceVerificationRequest,
  KnowledgeAuthoringContextObservation,
} from "./types.js";
import type {
  KnowledgeTestReport,
  KnowledgeReportAcknowledgement,
  KnowledgeReportSummary,
  KnowledgeReportConfirmation as Confirmation,
  KnowledgeReportLedgerState,
  KnowledgeEvidenceContext,
  KnowledgeEvidenceReportStorageLayout,
  KnowledgeEvidenceReportsOptions,
  KnowledgeEvidenceReports,
  KnowledgeReportView,
  KnowledgeReportObservation,
  KnowledgeReportObservationConfirmation,
  KnowledgeReportObservations,
} from "./evidence-reports-types.js";
import {
  KnowledgeEvidenceReportsError,
  KnowledgeEvidenceReportsUnavailableError,
  type KnowledgeEvidenceReportsStage,
} from "./evidence-reports-errors.js";
import {
  KnowledgeBaseAuthorizationError,
  KnowledgeBaseNotFoundError,
} from "./errors.js";
import { RepositoryConflictError, snapshotData } from "./storage-helpers.js";

const MAX_REPORTS = 16;
const MAX_ROWS = 160;
const MAX_RECORD_BYTES = 60_000;
const DRAIN_ROWS = 48;
const CHUNK_CHARACTERS = 12_000;
// Even when each nonfinal chunk loses one code unit to preserve a pair,
// six parts cover every payload within the existing 60,000 UTF-8 byte cap.
const MAX_CHUNKS = 6;

function stored<T>(stage: KnowledgeEvidenceReportsStage, read: () => T): T {
  try {
    return read();
  } catch {
    throw new KnowledgeEvidenceReportsUnavailableError(stage);
  }
}
async function ledgerIo<T>(
  stage: KnowledgeEvidenceReportsStage,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new KnowledgeEvidenceReportsUnavailableError(stage);
  }
}

interface LedgerRow {
  readonly articleId: string;
  readonly id: string;
  readonly payload: string;
}
function evidenceRecords(
  collectionName: string,
  storageLayout: KnowledgeEvidenceReportStorageLayout,
  storageKey: (articleId: string, id: string) => EntityKey,
) {
  return defineCollection<LedgerRow>({
    name: collectionName,
    key: (row) => storageKey(row.articleId, row.id),
    codec: {
      encode: (row) => {
        if (storageLayout === "legacy-raw-v1")
          return {
            articleId: row.articleId,
            id: row.id,
            payload: row.payload,
          };
        const payload = boundedString(row.payload, 1, MAX_RECORD_BYTES, {
          allowMultiline: true,
        });
        if (new TextEncoder().encode(payload).byteLength > MAX_RECORD_BYTES)
          throw new KnowledgeEvidenceReportsError("report_too_large");
        const parts: string[] = [];
        for (let offset = 0; offset < payload.length;) {
          let end = Math.min(payload.length, offset + CHUNK_CHARACTERS);
          const last = payload.charCodeAt(end - 1);
          if (end < payload.length && last >= 0xd800 && last <= 0xdbff)
            end -= 1;
          const part = payload.slice(offset, end);
          if (/[\uD800-\uDFFF]/u.test(part))
            throw new KnowledgeEvidenceReportsError("invalid_request");
          parts.push(part);
          offset = end;
        }
        if (parts.length === 0 || parts.length > MAX_CHUNKS)
          throw new KnowledgeEvidenceReportsError("report_too_large");
        const encoded: Record<string, string | number> = {
          schemaVersion: 1,
          articleId: scalar(row.articleId),
          id: scalar(row.id),
          partCount: parts.length,
        };
        for (const [index, part] of parts.entries())
          encoded["part" + index] = part;
        return encoded;
      },
      decode: (row) =>
        stored("record_decode", () => {
          let value: unknown = row.payload;
          if (storageLayout === "portable-v1") {
            if (
              row.schemaVersion !== 1 ||
              typeof row.partCount !== "number" ||
              !Number.isSafeInteger(row.partCount) ||
              row.partCount < 1 ||
              row.partCount > MAX_CHUNKS
            )
              throw new TypeError("Invalid report chunk schema.");
            const expected = new Set([
              "schemaVersion",
              "articleId",
              "id",
              "partCount",
              ...Array.from(
                { length: row.partCount },
                (_, index) => "part" + index,
              ),
            ]);
            if (
              Object.keys(row).length !== expected.size ||
              Object.keys(row).some((key) => !expected.has(key))
            )
              throw new TypeError("Invalid report chunk fields.");
            const parts: string[] = [];
            for (let index = 0; index < row.partCount; index += 1) {
              const part = row["part" + index];
              // Canonical JSON escapes lone code units. An unpaired unit here
              // is malformed data or a surrogate pair split across properties.
              if (
                typeof part !== "string" ||
                part.length === 0 ||
                part.length > CHUNK_CHARACTERS ||
                /[\uD800-\uDFFF]/u.test(part)
              )
                throw new TypeError("Invalid report chunk.");
              parts.push(part);
            }
            value = parts.join("");
          }
          const payload = boundedString(value, 1, MAX_RECORD_BYTES, {
            allowMultiline: true,
          });
          if (new TextEncoder().encode(payload).byteLength > MAX_RECORD_BYTES)
            throw new TypeError("Stored report record exceeds its byte bound.");
          return {
            articleId: scalar(row.articleId),
            id: scalar(row.id),
            payload,
          };
        }),
    },
  });
}

interface ReportRecord extends Omit<KnowledgeReportSummary, "summary"> {
  readonly receiptGeneration: number;
  readonly evidence: EvidenceSubmission;
  readonly report: KnowledgeTestReport;
  readonly submissionHash: string;
  readonly reportHash: string;
  readonly articleHash: string;
  readonly governanceHash: string;
  readonly confirmation: Confirmation | null;
}
interface ResetRecord {
  readonly fingerprint: string;
  readonly actorId: string;
  readonly fromEpoch: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly retiredRows: number;
  readonly retiredReports: number;
  readonly contentHash: string;
}
interface LedgerHead {
  readonly ledgerEpoch: number;
  readonly status: "active" | "resetting";
  readonly reports: number;
  readonly rows: number;
  readonly drainRemaining: number;
  readonly historyHash: string;
  readonly lastReset: ResetRecord | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new KnowledgeEvidenceReportsError("invalid_request");
  return value;
}
function optionalKeysObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): Record<string, unknown> {
  if (!isPlainObject(value))
    throw new KnowledgeEvidenceReportsError("invalid_request");
  const allowed = new Set([...required, ...optional]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    throw new KnowledgeEvidenceReportsError("invalid_request");
  return value;
}
function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
  options: { readonly allowMultiline?: boolean } = {},
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum
  )
    throw new KnowledgeEvidenceReportsError("invalid_request");
  const controls = options.allowMultiline
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u
    : /[\u0000-\u001F\u007F-\u009F]/u;
  if (controls.test(value))
    throw new KnowledgeEvidenceReportsError("invalid_request");
  return value;
}
/** Capture bounded JSON data, without invoking caller accessors or coercion. */
function requestData<T>(value: T): T {
  try {
    return snapshotData(value);
  } catch {
    throw new KnowledgeEvidenceReportsError("invalid_request");
  }
}
function callerContext(value: AccessContext): AccessContext {
  try {
    serializeAccessContext(value);
    return requestData(value);
  } catch {
    throw new KnowledgeEvidenceReportsError("invalid_request");
  }
}

function scalar(value: unknown, maximum = 200): string {
  return boundedString(value, 1, maximum);
}
function positive(value: unknown, minimum = 1): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    throw new KnowledgeEvidenceReportsError("invalid_request");
  return value;
}
function timestamp(value: unknown): string {
  const text = scalar(value, 32);
  if (
    !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString() !== text
  )
    throw new KnowledgeEvidenceReportsError("invalid_request");
  return text;
}
function hash(value: unknown): string {
  const text = scalar(value, 64);
  if (!/^[a-f0-9]{64}$/u.test(text))
    throw new KnowledgeEvidenceReportsError("invalid_request");
  return text;
}
function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new KnowledgeEvidenceReportsError("invalid_request");
  return value;
}
function applicability(value: unknown): Applicability {
  const object = optionalKeysObject(
    value,
    ["productId", "productVersion"],
    ["buildId", "locale"],
  );
  return {
    productId: scalar(object.productId),
    productVersion: scalar(object.productVersion),
    ...(object.buildId === undefined
      ? {}
      : { buildId: scalar(object.buildId) }),
    ...(object.locale === undefined ? {} : { locale: scalar(object.locale) }),
  };
}
function parseKnowledgeEvidence(value: unknown): EvidenceSubmission {
  const input = exactObject(value, [
    "id",
    "articleId",
    "articleRevision",
    "contentHash",
    "validationPolicy",
    "checkId",
    "testKind",
    "applicability",
    "stagingBuildId",
    "steps",
    "result",
    "executedAt",
    "runnerId",
    "artifacts",
  ]);
  const policy = exactObject(input.validationPolicy, ["id", "version"]);
  if (
    input.result !== "passed" &&
    input.result !== "failed" &&
    input.result !== "inconclusive"
  )
    throw new KnowledgeEvidenceReportsError("invalid_request");
  const steps = array(input.steps, 16).map((step) => scalar(step, 1000));
  if (steps.length === 0)
    throw new KnowledgeEvidenceReportsError("invalid_request");
  return {
    id: scalar(input.id),
    articleId: scalar(input.articleId),
    articleRevision: positive(input.articleRevision),
    contentHash: hash(input.contentHash),
    validationPolicy: {
      id: scalar(policy.id),
      version: positive(policy.version),
    },
    checkId: scalar(input.checkId),
    testKind: scalar(input.testKind, 64),
    applicability: applicability(input.applicability),
    stagingBuildId: scalar(input.stagingBuildId),
    steps,
    result: input.result,
    executedAt: timestamp(input.executedAt),
    runnerId: scalar(input.runnerId),
    artifacts: array(input.artifacts, 8).map((item) => {
      const artifact = exactObject(item, ["id", "hash"]);
      return { id: scalar(artifact.id), hash: hash(artifact.hash) };
    }),
  };
}
function validSubmissionSyntax(evidence: EvidenceSubmission): boolean {
  // Keep the report parser's intentionally stricter C1-control rejection.
  // Check Core's additional syntax without trimming or rewriting stored data.
  const text = [
    evidence.id,
    evidence.articleId,
    evidence.validationPolicy.id,
    evidence.checkId,
    evidence.testKind,
    evidence.stagingBuildId,
    evidence.runnerId,
    evidence.applicability.productId,
    evidence.applicability.productVersion,
    ...(evidence.applicability.buildId === undefined
      ? []
      : [evidence.applicability.buildId]),
    ...evidence.steps,
    ...evidence.artifacts.map((artifact) => artifact.id),
  ];
  const locale = evidence.applicability.locale;
  return (
    text.every((value) => value.trim() === value) &&
    (locale === undefined ||
      (locale.length <= 64 &&
        /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/u.test(locale))) &&
    new Set(evidence.artifacts.map((artifact) => artifact.id)).size ===
      evidence.artifacts.length
  );
}
function parseReport(value: unknown): KnowledgeTestReport {
  const report = exactObject(value, ["summary", "details"]);
  return {
    summary: scalar(report.summary, 1000),
    details: boundedString(report.details, 1, 16_000, { allowMultiline: true }),
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (isPlainObject(value))
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  throw new TypeError("Unsupported knowledge evidence value.");
}
async function knowledgeDigest(value: unknown): Promise<string> {
  try {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical(value)),
    );
    return [...new Uint8Array(bytes)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    throw new KnowledgeEvidenceReportsUnavailableError("hashing");
  }
}
function row(articleId: string, id: string, value: unknown): LedgerRow {
  const payload = canonical(value);
  if (new TextEncoder().encode(payload).byteLength > MAX_RECORD_BYTES)
    throw new KnowledgeEvidenceReportsError("report_too_large");
  return { articleId, id, payload };
}
function decodeReport(payload: string): ReportRecord {
  return stored("report_decode", () => {
    const item = exactObject(JSON.parse(payload), [
      "ledgerEpoch",
      "receiptGeneration",
      "reportId",
      "articleId",
      "reportGeneration",
      "status",
      "submittedBy",
      "submittedAt",
      "evidence",
      "report",
      "submissionHash",
      "reportHash",
      "articleHash",
      "governanceHash",
      "confirmation",
    ]);
    if (
      item.status !== "pending" &&
      item.status !== "confirmed" &&
      item.status !== "rejected"
    )
      throw new TypeError("Invalid report status.");
    let confirmation: Confirmation | null = null;
    if (item.confirmation !== null) {
      const proof = exactObject(item.confirmation, [
        "reviewerId",
        "confirmedAt",
      ]);
      confirmation = {
        reviewerId: scalar(proof.reviewerId),
        confirmedAt: timestamp(proof.confirmedAt),
      };
    }
    if ((item.status === "confirmed") !== (confirmation !== null))
      throw new TypeError("Invalid confirmation.");
    return {
      ledgerEpoch: positive(item.ledgerEpoch),
      receiptGeneration: positive(item.receiptGeneration),
      reportId: scalar(item.reportId),
      articleId: scalar(item.articleId),
      reportGeneration: positive(item.reportGeneration),
      status: item.status,
      submittedBy: scalar(item.submittedBy),
      submittedAt: timestamp(item.submittedAt),
      evidence: parseKnowledgeEvidence(item.evidence),
      report: parseReport(item.report),
      submissionHash: hash(item.submissionHash),
      reportHash: hash(item.reportHash),
      articleHash: hash(item.articleHash),
      governanceHash: hash(item.governanceHash),
      confirmation,
    };
  });
}
function decodeHead(payload: string): LedgerHead {
  return stored("head_decode", () => {
    const item = exactObject(JSON.parse(payload), [
      "ledgerEpoch",
      "status",
      "reports",
      "rows",
      "drainRemaining",
      "historyHash",
      "lastReset",
    ]);
    if (item.status !== "active" && item.status !== "resetting")
      throw new TypeError("Invalid ledger status.");
    const ledgerEpoch = positive(item.ledgerEpoch);
    const reports = positive(item.reports, 0);
    const rows = positive(item.rows);
    const drainRemaining = positive(item.drainRemaining, 0);
    if (
      reports > MAX_REPORTS ||
      rows > MAX_ROWS ||
      drainRemaining >= MAX_ROWS ||
      (item.status === "active" && drainRemaining !== 0) ||
      (item.status === "resetting" && (reports !== 0 || rows !== 1))
    )
      throw new TypeError("Invalid ledger counts.");
    let lastReset: ResetRecord | null = null;
    if (item.lastReset !== null) {
      const reset = exactObject(item.lastReset, [
        "fingerprint",
        "actorId",
        "fromEpoch",
        "startedAt",
        "completedAt",
        "retiredRows",
        "retiredReports",
        "contentHash",
      ]);
      lastReset = {
        fingerprint: hash(reset.fingerprint),
        actorId: scalar(reset.actorId),
        fromEpoch: positive(reset.fromEpoch),
        startedAt: timestamp(reset.startedAt),
        completedAt:
          reset.completedAt === null ? null : timestamp(reset.completedAt),
        retiredRows: positive(reset.retiredRows, 0),
        retiredReports: positive(reset.retiredReports, 0),
        contentHash: hash(reset.contentHash),
      };
      if (
        lastReset.fromEpoch + 1 !== ledgerEpoch ||
        lastReset.retiredRows >= MAX_ROWS ||
        lastReset.retiredReports > MAX_REPORTS ||
        (item.status === "active") !== (lastReset.completedAt !== null)
      )
        throw new TypeError("Invalid reset seal.");
    } else if (ledgerEpoch !== 1 || item.status !== "active")
      throw new TypeError("Missing reset seal.");
    return {
      ledgerEpoch,
      status: item.status,
      reports,
      rows,
      drainRemaining,
      historyHash: hash(item.historyHash),
      lastReset,
    };
  });
}
const INITIAL_HEAD: LedgerHead = {
  ledgerEpoch: 1,
  status: "active",
  reports: 0,
  rows: 1,
  drainRemaining: 0,
  historyHash: "0".repeat(64),
  lastReset: null,
};
function summary(report: ReportRecord): KnowledgeReportSummary {
  return {
    ledgerEpoch: report.ledgerEpoch,
    reportId: report.reportId,
    articleId: report.articleId,
    reportGeneration: report.reportGeneration,
    status: report.status,
    submittedBy: report.submittedBy,
    submittedAt: report.submittedAt,
    summary: report.report.summary,
  };
}
function acknowledgement(report: ReportRecord): KnowledgeReportAcknowledgement {
  return {
    ledgerEpoch: report.ledgerEpoch,
    reportId: report.reportId,
    receipt:
      "e" +
      report.ledgerEpoch +
      "." +
      report.receiptGeneration +
      "." +
      report.reportId,
    reportGeneration: report.reportGeneration,
  };
}
function reportBinding(report: ReportRecord): unknown {
  return {
    ledgerEpoch: report.ledgerEpoch,
    receiptGeneration: report.receiptGeneration,
    reportId: report.reportId,
    articleId: report.articleId,
    evidence: report.evidence,
    report: report.report,
    submittedBy: report.submittedBy,
    articleHash: report.articleHash,
    governanceHash: report.governanceHash,
  };
}
function state(
  articleId: string,
  head: LedgerHead,
): KnowledgeReportLedgerState {
  return {
    articleId,
    ledgerEpoch: head.ledgerEpoch,
    status: head.status,
    reportsRemaining: head.status === "active" ? MAX_REPORTS - head.reports : 0,
    rowsRemaining:
      head.status === "active" ? MAX_ROWS - head.rows : head.drainRemaining,
  };
}
function reportKey(epoch: number, id: string): string {
  return "report:" + epoch + ":" + id;
}
function commandKey(epoch: number, idHash: string): string {
  return "command:" + epoch + ":" + idHash;
}

/** Fixed-width code units preserve opaque strings injectively, including astral pairs. */
function encodedKey(prefix: string, value: string): string {
  let result = prefix;
  for (let index = 0; index < value.length; index += 1)
    result += value.charCodeAt(index).toString(16).padStart(4, "0");
  return result;
}

/**
 * Human review is explicit. It is not a promise that KB will accept the receipt.
 * A missing head triggers an unbounded underlying Store partition list for
 * integrity/refusal, not a bounded scan or an automatic migration. Quiesce old
 * writers and inspect the namespace before activation; this observation is not
 * an atomic fence against an old writer inserting after the empty-partition read.
 */
export function createKnowledgeEvidenceReports(
  options: KnowledgeEvidenceReportsOptions,
): KnowledgeEvidenceReports {
  if (options === null || typeof options !== "object")
    throw new KnowledgeEvidenceReportsError("invalid_configuration");
  const { collectionName, confirmationPermission } = options;
  const storageLayout =
    options.storageLayout === undefined ? "portable-v1" : options.storageLayout;
  if (
    typeof collectionName !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(collectionName) ||
    collectionName === "knowledge-base.records.v1" ||
    collectionName === "knowledge-base.retrieval.v1" ||
    (storageLayout !== "portable-v1" && storageLayout !== "legacy-raw-v1") ||
    typeof confirmationPermission !== "string" ||
    confirmationPermission.length > 255 ||
    !/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)*$/u.test(
      confirmationPermission,
    ) ||
    [
      knowledgePermissions.draftRead,
      knowledgePermissions.draftWrite,
      knowledgePermissions.evidenceSubmit,
    ].some((permission) => permission === confirmationPermission) ||
    typeof options.resolvePrincipal !== "function" ||
    typeof options.readContext !== "function" ||
    (options.authoringContext !== undefined &&
      (options.authoringContext === null ||
        typeof options.authoringContext.getAuthoringContext !== "function" ||
        typeof options.authoringContext.confirmAuthoringContext !==
          "function")) ||
    typeof options.store?.collection !== "function" ||
    typeof options.clock?.now !== "function"
  )
    throw new KnowledgeEvidenceReportsError("invalid_configuration");
  const authoringContext =
    options.authoringContext === undefined
      ? undefined
      : {
          getAuthoringContext:
            options.authoringContext.getAuthoringContext.bind(
              options.authoringContext,
            ),
          confirmAuthoringContext:
            options.authoringContext.confirmAuthoringContext.bind(
              options.authoringContext,
            ),
        };
  function storageKey(articleId: string, id: string): EntityKey {
    if (storageLayout === "legacy-raw-v1") return { partition: articleId, id };
    const partition = encodedKey("a-", articleId);
    const physicalId = encodedKey("r-", id);
    // Both encoded keys and collectionName are ASCII. Azure prefixes the
    // physical partition with collectionName + ":"; include it in the bound.
    if (
      collectionName.length + 1 + partition.length > 1_024 ||
      physicalId.length > 1_024
    )
      throw new KnowledgeEvidenceReportsError("invalid_request");
    return { partition, id: physicalId };
  }
  function storagePartition(articleId: string): string {
    return storageKey(articleId, "head").partition;
  }
  const records = stored("collection_open", () =>
    options.store.collection(
      evidenceRecords(collectionName, storageLayout, storageKey),
    ),
  );
  function now(): string {
    return stored("clock_read", () => timestamp(options.clock.now()));
  }
  async function resolvePrincipal(id: string): Promise<AccessContext | null> {
    const resolved = await ledgerIo("principal_resolve", () =>
      options.resolvePrincipal(id),
    );
    return resolved === null
      ? null
      : stored("principal_resolve", () => callerContext(resolved));
  }
  async function currentAuthority(access: AccessContext, permission: string) {
    const caller = callerContext(access);
    const authority = await resolvePrincipal(caller.principalId);
    if (
      authority === null ||
      authority.principalId !== caller.principalId ||
      !hasPermission(caller, permission) ||
      !hasPermission(authority, permission) ||
      caller.permissions.some((grant) => !hasPermission(authority, grant))
    )
      throw new KnowledgeEvidenceReportsError("forbidden");
    // A current owner/Admin context establishes continued authority; it never
    // replaces the original credential's restricted effective permissions.
    return { caller, authority };
  }
  async function current(access: AccessContext, permission: string) {
    return (await currentAuthority(access, permission)).caller;
  }
  function staffPermissions(access: AccessContext): void {
    for (const permission of [
      confirmationPermission,
      knowledgePermissions.draftRead,
      knowledgePermissions.evidenceRead,
    ])
      if (!hasPermission(access, permission))
        throw new KnowledgeEvidenceReportsError("forbidden");
    // The prescribed public readContext uses getValidationRequirements, whose
    // existing author-facing permission is evidenceSubmit OR draftWrite.
    if (
      !hasPermission(access, knowledgePermissions.evidenceSubmit) &&
      !hasPermission(access, knowledgePermissions.draftWrite)
    )
      throw new KnowledgeEvidenceReportsError("forbidden");
  }
  async function staff(access: AccessContext): Promise<AccessContext> {
    access = await current(access, confirmationPermission);
    staffPermissions(access);
    return access;
  }
  async function staffAuthority(access: AccessContext) {
    const resolved = await currentAuthority(access, confirmationPermission);
    staffPermissions(resolved.caller);
    return resolved;
  }
  async function reviewerAuthority(id: string): Promise<AccessContext> {
    const reviewer = await resolvePrincipal(id);
    if (reviewer === null || reviewer.principalId !== id)
      throw new KnowledgeEvidenceReportsError("forbidden");
    staffPermissions(reviewer);
    return reviewer;
  }
  async function headVersion(articleId: string) {
    const saved = await ledgerIo("head_read", () =>
      records.getVersioned(storageKey(articleId, "head")),
    );
    // Missing metadata is fresh only when its actual partition is empty. Never
    // silently initialize an epoch over pre-epoch records or orphaned history.
    // Storage Core 0.4 has no bounded partition probe: partitionRows uses the
    // existing unbounded list port, with integrity checks after that read.
    if (saved === null && (await partitionRows(articleId)).length !== 0)
      throw new KnowledgeEvidenceReportsUnavailableError(
        "head_partition_orphaned",
      );
    if (
      saved !== null &&
      (saved.value.articleId !== articleId || saved.value.id !== "head")
    )
      throw new KnowledgeEvidenceReportsUnavailableError("head_identity");
    return {
      value: saved === null ? INITIAL_HEAD : decodeHead(saved.value.payload),
      version: saved?.version,
    };
  }
  async function active(articleId: string, epoch: number): Promise<LedgerHead> {
    const head = (await headVersion(articleId)).value;
    if (head.ledgerEpoch !== epoch)
      throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
    if (head.status !== "active")
      throw new KnowledgeEvidenceReportsError("ledger_resetting");
    return head;
  }
  async function partitionRows(articleId: string): Promise<LedgerRow[]> {
    const rows = await ledgerIo("partition_read", () =>
      records.list(storagePartition(articleId)),
    );
    if (
      rows.length > MAX_ROWS ||
      rows.some((item) => item.articleId !== articleId) ||
      new Set(rows.map((item) => item.id)).size !== rows.length
    )
      throw new KnowledgeEvidenceReportsUnavailableError("partition_integrity");
    return rows;
  }
  async function load(
    articleId: string,
    epoch: number,
    reportId: string,
  ): Promise<ReportRecord> {
    const saved = await ledgerIo("report_read", () =>
      records.get(storageKey(articleId, reportKey(epoch, reportId))),
    );
    if (saved === null)
      throw new KnowledgeEvidenceReportsError("report_not_found");
    const report = decodeReport(saved.payload);
    if (
      saved.id !== reportKey(epoch, reportId) ||
      report.articleId !== articleId ||
      report.reportId !== reportId ||
      report.ledgerEpoch !== epoch
    )
      throw new KnowledgeEvidenceReportsUnavailableError("report_identity");
    return report;
  }
  async function observedReport(
    articleId: string,
    epoch: number,
    reportId: string,
  ) {
    const saved = await ledgerIo("report_read", () =>
      records.getVersioned(storageKey(articleId, reportKey(epoch, reportId))),
    );
    if (saved === null)
      throw new KnowledgeEvidenceReportsError("report_not_found");
    const report = decodeReport(saved.value.payload);
    if (
      saved.value.articleId !== articleId ||
      saved.value.id !== reportKey(epoch, reportId) ||
      report.articleId !== articleId ||
      report.reportId !== reportId ||
      report.ledgerEpoch !== epoch
    )
      throw new KnowledgeEvidenceReportsUnavailableError("report_identity");
    return { value: report, version: saved.version };
  }
  async function observeContext(
    access: AccessContext,
    articleId: string,
    includeEvidence: boolean,
  ): Promise<{
    readonly value: KnowledgeEvidenceContext;
    readonly observation?: KnowledgeAuthoringContextObservation;
  }> {
    try {
      const observed =
        authoringContext === undefined
          ? undefined
          : await authoringContext.getAuthoringContext(callerContext(access), {
              articleId,
              includeEvidence,
            });
      if (
        authoringContext !== undefined &&
        (observed === undefined ||
          observed.observation === null ||
          typeof observed.observation !== "object")
      )
        throw new KnowledgeEvidenceReportsUnavailableError("context_read");
      // Only detach JSON context. The instance-bound observation must never be
      // cloned, persisted, hashed into report identity, or exposed in a DTO.
      const value = snapshotData(
        observed === undefined
          ? await options.readContext(callerContext(access), articleId)
          : observed.context,
      );
      if (
        value.draft.articleId !== articleId ||
        value.draft.revision.articleId !== articleId ||
        value.requirements.collectionId !== value.draft.revision.collectionId ||
        (value.evidence !== undefined &&
          (!isPlainObject(value.evidence) ||
            value.evidence.articleId !== articleId ||
            value.evidence.generation !== value.draft.generation ||
            !Array.isArray(value.evidence.evidence) ||
            !Array.isArray(value.evidence.revokedEvidence)))
      )
        throw new KnowledgeEvidenceReportsUnavailableError("context_read");
      if (value.evidence !== undefined) {
        const evidence = value.evidence;
        stored("context_read", () => {
          for (const item of evidence.revokedEvidence) {
            const revoked = exactObject(item, [
              "articleRevision",
              "id",
              "version",
              "hash",
              "reason",
              "revokedBy",
              "revokedAt",
            ]);
            positive(revoked.articleRevision);
            scalar(revoked.id);
            positive(revoked.version);
            hash(revoked.hash);
            scalar(revoked.reason, 1000);
            scalar(revoked.revokedBy);
            timestamp(revoked.revokedAt);
          }
        });
      }
      if (
        authoringContext !== undefined &&
        includeEvidence &&
        value.evidence === undefined
      )
        throw new KnowledgeEvidenceReportsUnavailableError("context_read");
      return {
        value,
        ...(observed === undefined
          ? {}
          : { observation: observed.observation }),
      };
    } catch (error) {
      if (error instanceof KnowledgeEvidenceReportsError) throw error;
      if (error instanceof KnowledgeBaseAuthorizationError)
        throw new KnowledgeEvidenceReportsError("forbidden");
      if (error instanceof KnowledgeBaseNotFoundError)
        throw new KnowledgeEvidenceReportsError("report_target_unavailable");
      throw new KnowledgeEvidenceReportsUnavailableError("context_read");
    }
  }
  async function context(
    access: AccessContext,
    articleId: string,
    includeEvidence = hasPermission(access, knowledgePermissions.evidenceRead),
  ): Promise<KnowledgeEvidenceContext> {
    return (await observeContext(access, articleId, includeEvidence)).value;
  }
  async function confirmContext(
    access: AccessContext,
    observation: KnowledgeAuthoringContextObservation,
  ): Promise<void> {
    try {
      if (authoringContext === undefined)
        throw new KnowledgeEvidenceReportsUnavailableError("context_read");
      await authoringContext.confirmAuthoringContext(
        callerContext(access),
        observation,
      );
    } catch (error) {
      if (error instanceof KnowledgeEvidenceReportsUnavailableError)
        throw error;
      if (error instanceof RepositoryConflictError)
        throw new KnowledgeEvidenceReportsError("report_changed");
      if (error instanceof KnowledgeBaseAuthorizationError)
        throw new KnowledgeEvidenceReportsError("forbidden");
      throw new KnowledgeEvidenceReportsUnavailableError("context_read");
    }
  }
  async function contextHashes(value: KnowledgeEvidenceContext) {
    return {
      articleHash: await knowledgeDigest(value.draft.revision),
      governanceHash: await knowledgeDigest(value.requirements),
    };
  }
  async function valid(
    report: ReportRecord,
    article: ArticleRevision,
    value: KnowledgeEvidenceContext,
    at: string,
  ): Promise<boolean> {
    if (
      !validSubmissionSyntax(report.evidence) ||
      report.reportHash !== (await knowledgeDigest(reportBinding(report))) ||
      report.articleHash !== (await knowledgeDigest(article)) ||
      report.governanceHash !== (await knowledgeDigest(value.requirements)) ||
      report.submissionHash !== (await knowledgeDigest(report.evidence)) ||
      value.evidence === undefined
    )
      return false;
    if (report.confirmation !== null) {
      // Core revokes one exact accepted fact, including its version and human
      // attestation. Reconstruct it even when current evidence was replaced;
      // a separately reviewed replacement is not an identifier-wide ban.
      const attestation = {
        id: acknowledgement(report).receipt,
        verifiedBy: report.confirmation.reviewerId,
        verifiedAt: report.confirmation.confirmedAt,
      };
      for (const revoked of value.evidence.revokedEvidence) {
        if (
          revoked.id === report.evidence.id &&
          revoked.articleRevision === report.evidence.articleRevision &&
          revoked.hash ===
            (await ledgerIo("hashing", () =>
              coreKnowledgeDigest({
                ...report.evidence,
                version: revoked.version,
                attestation,
              }),
            ))
        )
          return false;
      }
    }
    const submission = report.evidence;
    const requirement = value.requirements.checks.find(
      (item) =>
        item.id === submission.checkId && item.testKind === submission.testKind,
    );
    const executed = Date.parse(submission.executedAt);
    const now = Date.parse(at);
    return (
      submission.articleId === article.articleId &&
      submission.articleRevision === article.number &&
      submission.contentHash === article.contentHash &&
      (await knowledgeDigest(submission.applicability)) ===
        (await knowledgeDigest(article.applicability)) &&
      (await knowledgeDigest(submission.validationPolicy)) ===
        (await knowledgeDigest(value.requirements.validationPolicy)) &&
      (await knowledgeDigest(article.validationPolicy)) ===
        (await knowledgeDigest(value.requirements.validationPolicy)) &&
      submission.stagingBuildId === value.requirements.expectedStagingBuildId &&
      (article.applicability.buildId === undefined ||
        submission.stagingBuildId === article.applicability.buildId) &&
      requirement !== undefined &&
      executed >= Date.parse(article.createdAt) &&
      executed <= now &&
      now - executed <= requirement.maxAgeMilliseconds &&
      (report.confirmation === null ||
        (Date.parse(report.confirmation.confirmedAt) >= executed &&
          Date.parse(report.confirmation.confirmedAt) <= now))
    );
  }
  async function verificationIdentityMatches(
    report: ReportRecord,
    request: EvidenceVerificationRequest,
  ): Promise<boolean> {
    return (
      acknowledgement(report).receipt === request.receipt &&
      report.status === "confirmed" &&
      report.confirmation !== null &&
      request.access.principalId === report.submittedBy &&
      (await knowledgeDigest(request.submission)) === report.submissionHash &&
      request.configuration.trustedAttesterIds.includes(
        report.confirmation.reviewerId,
      )
    );
  }
  async function verificationContextMatches(
    report: ReportRecord,
    request: EvidenceVerificationRequest,
    value: KnowledgeEvidenceContext,
  ): Promise<boolean> {
    return (
      (await valid(report, request.article, value, now())) &&
      request.configuration.expectedStagingBuildId ===
        value.requirements.expectedStagingBuildId &&
      (await knowledgeDigest(request.configuration.validationPolicy)) ===
        (await knowledgeDigest(value.requirements.validationPolicy))
    );
  }
  function fulfilled<T>(result: PromiseSettledResult<T>): T {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  }
  interface ReportObservationState {
    readonly access: AccessContext;
    readonly reviewer: AccessContext;
    readonly head: Awaited<ReturnType<typeof headVersion>>;
    readonly report: Awaited<ReturnType<typeof observedReport>>;
    readonly context: KnowledgeEvidenceContext;
    readonly contextObservation: KnowledgeAuthoringContextObservation;
  }
  const reportObservations = new WeakMap<object, ReportObservationState>();
  const observations = Object.freeze<KnowledgeReportObservations>({
    async observe(access, value) {
      const input = exactObject(requestData(value), [
        "articleId",
        "ledgerEpoch",
        "reportId",
      ]);
      const articleId = scalar(input.articleId);
      const epoch = positive(input.ledgerEpoch);
      const reportId = scalar(input.reportId);
      const initial = await staffAuthority(access);
      access = initial.caller;
      // Start only independent read observations together. Every result settles
      // before a refusal; error precedence is head, report, context.
      const reportRead = observedReport(articleId, epoch, reportId);
      const results = await Promise.allSettled([
        headVersion(articleId),
        reportRead,
        observeContext(access, articleId, true),
      ]);
      const head = fulfilled(results[0]);
      if (head.value.ledgerEpoch !== epoch)
        throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
      if (head.value.status !== "active")
        throw new KnowledgeEvidenceReportsError("ledger_resetting");
      const observed = fulfilled(results[1]);
      const context = fulfilled(results[2]);
      const report = observed.value;
      if (
        report.status !== "confirmed" ||
        report.confirmation === null ||
        context.observation === undefined ||
        !(await valid(
          report,
          context.value.draft.revision,
          context.value,
          now(),
        ))
      )
        throw new KnowledgeEvidenceReportsError("report_not_verifiable");
      const reviewBindingHash = await knowledgeDigest({
        report,
        context: context.value,
      });
      const view: KnowledgeReportView = {
        ...summary(report),
        receipt: acknowledgement(report).receipt,
        evidence: report.evidence,
        report: report.report,
        draft: context.value.draft,
        reportHash: report.reportHash,
        submissionHash: report.submissionHash,
        governanceHash: report.governanceHash,
        requirements: context.value.requirements,
        reviewBindingHash,
        expectedReportGeneration: report.reportGeneration,
        confirmation: report.confirmation,
      };
      // Private data is disclosed only after another current staff observation.
      // Report/context currency is provisional until this handle is confirmed.
      // Resolve the initial reviewer here, alongside the closing actor, after
      // the private reads/hashes. The later confirm still resolves both afresh.
      const actorRead = staffAuthority(access);
      const reviewerRead =
        report.confirmation.reviewerId === access.principalId
          ? actorRead.then((value) => value.authority)
          : reviewerAuthority(report.confirmation.reviewerId);
      const authorities = await Promise.allSettled([actorRead, reviewerRead]);
      fulfilled(authorities[0]);
      const reviewer = fulfilled(authorities[1]);
      staffPermissions(reviewer);
      const observation = Object.freeze({}) as KnowledgeReportObservation;
      reportObservations.set(observation, {
        access,
        reviewer,
        head,
        report: observed,
        context: context.value,
        contextObservation: context.observation,
      });
      return { ...snapshotData({ view, context: context.value }), observation };
    },
    async confirm(access, observation, verification) {
      access = callerContext(access);
      const captured =
        observation !== null && typeof observation === "object"
          ? reportObservations.get(observation)
          : undefined;
      if (captured === undefined)
        throw new KnowledgeEvidenceReportsError("invalid_request");
      if (
        serializeAccessContext(access) !==
        serializeAccessContext(captured.access)
      )
        throw new KnowledgeEvidenceReportsError("forbidden");
      // No await precedes consumption. Cloned/foreign handles and a different
      // actor cannot consume the original handle; every actual attempt does.
      reportObservations.delete(observation);
      verification =
        verification === undefined ? undefined : requestData(verification);
      const report = captured.report.value;
      let attestation: KnowledgeReportObservationConfirmation["attestation"] =
        null;
      if (
        !(await valid(
          report,
          captured.context.draft.revision,
          captured.context,
          now(),
        ))
      )
        throw new KnowledgeEvidenceReportsError("report_not_verifiable");
      if (verification !== undefined) {
        let matches = false;
        try {
          const owner = callerContext(verification.access);
          matches =
            owner.principalId === access.principalId &&
            hasPermission(owner, knowledgePermissions.evidenceSubmit) &&
            owner.permissions.every((grant) => hasPermission(access, grant)) &&
            (await verificationIdentityMatches(report, verification)) &&
            (await verificationContextMatches(
              report,
              verification,
              captured.context,
            ));
        } catch (error) {
          if (error instanceof KnowledgeEvidenceReportsUnavailableError)
            throw error;
        }
        if (!matches || report.confirmation === null)
          throw new KnowledgeEvidenceReportsError("report_not_verifiable");
        attestation = {
          id: acknowledgement(report).receipt,
          verifiedBy: report.confirmation.reviewerId,
          verifiedAt: report.confirmation.confirmedAt,
        };
      }
      // This exact KB resource check must complete before the closing report
      // read. Fresh actor/reviewer observations then share one read-only wave.
      await confirmContext(access, captured.contextObservation);
      const actorRead = staffAuthority(access);
      const reviewerRead =
        captured.reviewer.principalId === access.principalId
          ? actorRead.then((value) => value.authority)
          : reviewerAuthority(captured.reviewer.principalId);
      const results = await Promise.allSettled([
        actorRead,
        reviewerRead,
        observedReport(report.articleId, report.ledgerEpoch, report.reportId),
      ]);
      fulfilled(results[0]);
      const reviewer = fulfilled(results[1]);
      staffPermissions(reviewer);
      if (
        serializeAccessContext(reviewer) !==
        serializeAccessContext(captured.reviewer)
      )
        throw new KnowledgeEvidenceReportsError("forbidden");
      if (fulfilled(results[2]).version !== captured.report.version)
        throw new KnowledgeEvidenceReportsError("report_changed");
      // The head is the final data await. No cross-collection lock is promised.
      const head = await headVersion(report.articleId);
      if (head.value.ledgerEpoch !== report.ledgerEpoch)
        throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
      if (head.value.status !== "active")
        throw new KnowledgeEvidenceReportsError("ledger_resetting");
      if (head.version !== captured.head.version)
        throw new KnowledgeEvidenceReportsError("ledger_changed");
      return { receipt: acknowledgement(report).receipt, attestation };
    },
  });
  async function replay(
    articleId: string,
    epoch: number,
    commandId: string,
    fingerprint: string,
  ): Promise<KnowledgeReportAcknowledgement | null> {
    const saved = await ledgerIo("receipt_read", () =>
      records.get(storageKey(articleId, commandKey(epoch, commandId))),
    );
    if (saved === null) return null;
    const decoded = stored("receipt_decode", () => {
      const receipt = exactObject(JSON.parse(saved.payload), [
        "fingerprint",
        "result",
      ]);
      if (
        typeof receipt.fingerprint !== "string" ||
        !/^[a-f0-9]{64}$/u.test(receipt.fingerprint)
      )
        throw new TypeError("Invalid receipt.");
      const result = exactObject(receipt.result, [
        "ledgerEpoch",
        "reportId",
        "receipt",
        "reportGeneration",
      ]);
      const decoded = {
        ledgerEpoch: positive(result.ledgerEpoch),
        reportId: scalar(result.reportId),
        receipt: scalar(result.receipt),
        reportGeneration: positive(result.reportGeneration),
      };
      if (decoded.ledgerEpoch !== epoch)
        throw new TypeError("Receipt epoch changed.");
      return { fingerprint: receipt.fingerprint, result: decoded };
    });
    if (decoded.fingerprint !== fingerprint)
      throw new KnowledgeEvidenceReportsError("command_conflict");
    return decoded.result;
  }
  async function write(
    access: AccessContext,
    commandId: string,
    fingerprint: string,
    report: ReportRecord,
    previousVersion?: string,
  ): Promise<KnowledgeReportAcknowledgement> {
    const head = await headVersion(report.articleId);
    if (head.value.ledgerEpoch !== report.ledgerEpoch)
      throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
    if (head.value.status !== "active")
      throw new KnowledgeEvidenceReportsError("ledger_resetting");
    const reports =
      head.value.reports + (previousVersion === undefined ? 1 : 0);
    const rows = head.value.rows + (previousVersion === undefined ? 3 : 2);
    if (reports > MAX_REPORTS || rows > MAX_ROWS)
      throw new KnowledgeEvidenceReportsError("report_capacity");
    const result = acknowledgement(report);
    const key = commandKey(report.ledgerEpoch, commandId);
    const event = auditEvent({
      id: key,
      occurredAt: now(),
      actor: { kind: "principal", principalId: access.principalId },
      action: "knowledge.report." + report.status,
      subject: report.articleId,
      details: {
        reportId: report.reportId,
        reportHash: report.reportHash,
        generation: report.reportGeneration,
        ledgerEpoch: report.ledgerEpoch,
        receiptGeneration: report.receiptGeneration,
      },
    });
    if (previousVersion === undefined)
      await current(access, knowledgePermissions.evidenceSubmit);
    else await staff(access);
    const headRow = row(report.articleId, "head", {
      ...head.value,
      reports,
      rows,
    });
    const reportRow = row(
      report.articleId,
      reportKey(report.ledgerEpoch, report.reportId),
      report,
    );
    const outcome = await ledgerIo("report_write", () =>
      records.transact(storagePartition(report.articleId), [
        head.version === undefined
          ? { action: "insert", value: headRow }
          : { action: "putIfUnchanged", value: headRow, version: head.version },
        previousVersion === undefined
          ? { action: "insert", value: reportRow }
          : {
              action: "putIfUnchanged",
              value: reportRow,
              version: previousVersion,
            },
        {
          action: "insert",
          value: row(report.articleId, key, { fingerprint, result }),
        },
        {
          action: "insert",
          value: row(report.articleId, "audit:" + key, event),
        },
      ]),
    );
    if (!outcome.committed) {
      await active(report.articleId, report.ledgerEpoch);
      const accepted = await replay(
        report.articleId,
        report.ledgerEpoch,
        commandId,
        fingerprint,
      );
      if (accepted !== null) {
        await active(report.articleId, report.ledgerEpoch);
        if (previousVersion === undefined)
          await current(access, knowledgePermissions.evidenceSubmit);
        else await staff(access);
        return accepted;
      }
      throw new KnowledgeEvidenceReportsError("report_changed");
    }
    await active(report.articleId, report.ledgerEpoch);
    // Withhold an ACK if authority changed during storage; a committed report
    // or decision remains committed and is not rolled back by this refusal.
    if (previousVersion === undefined)
      await current(access, knowledgePermissions.evidenceSubmit);
    else await staff(access);
    return result;
  }
  const verifier: EvidenceVerifier = {
    async verify(request) {
      try {
        request = requestData(request);
        const receipt =
          /^e([1-9][0-9]*)\.([1-9][0-9]*)\.([A-Za-z0-9-]{1,100})$/u.exec(
            scalar(request.receipt),
          );
        if (receipt === null) return null;
        const epoch = positive(Number(receipt[1]));
        const cycle = positive(Number(receipt[2]));
        const reportId = scalar(receipt[3]);
        const [, report] = await Promise.all([
          active(request.article.articleId, epoch),
          load(request.article.articleId, epoch, reportId),
        ]);
        if (
          report.confirmation === null ||
          !(await verificationIdentityMatches(report, request))
        )
          return null;
        const confirmation = report.confirmation;
        const resolvedReviewer = await ledgerIo("principal_resolve", () =>
          options.resolvePrincipal(confirmation.reviewerId),
        );
        const reviewer =
          resolvedReviewer === null
            ? null
            : stored("principal_resolve", () =>
                callerContext(resolvedReviewer),
              );
        if (
          reviewer === null ||
          reviewer.principalId !== confirmation.reviewerId ||
          !hasPermission(reviewer, confirmationPermission)
        )
          return null;
        const value = await context(reviewer, report.articleId);
        if (!(await verificationContextMatches(report, request, value)))
          return null;
        await current(request.access, knowledgePermissions.evidenceSubmit);
        await staff(reviewer);
        const latest = await load(report.articleId, epoch, reportId);
        if (
          latest.reportGeneration !== report.reportGeneration ||
          latest.receiptGeneration !== cycle ||
          latest.status !== "confirmed"
        )
          return null;
        // A reset fences subsequent verification. The SDK's already verified
        // article commit is outside this separate report-ledger transaction.
        await active(report.articleId, epoch);
        return {
          id: request.receipt,
          verifiedBy: report.confirmation.reviewerId,
          verifiedAt: report.confirmation.confirmedAt,
        };
      } catch (error) {
        if (!(error instanceof KnowledgeEvidenceReportsError)) {
          try {
            options.logger?.log(
              "error",
              "knowledge.evidence_reports.verifier_unavailable",
              {
                stage:
                  error instanceof KnowledgeEvidenceReportsUnavailableError
                    ? error.stage
                    : "verification",
              },
            );
          } catch {
            /* Logging must not turn refusal into a verifier exception. */
          }
        }
        return null;
      }
    },
  };
  return Object.freeze({
    verifier,
    ...(authoringContext === undefined ? {} : { observations }),
    async query(access, input) {
      input = requestData(input);
      access = await current(access, knowledgePermissions.evidenceSubmit);
      if (!hasPermission(access, knowledgePermissions.draftRead))
        throw new KnowledgeEvidenceReportsError("forbidden");
      const request = optionalKeysObject(input, ["articleId"], ["status"]);
      const articleId = scalar(request.articleId);
      const statusInput = Object.hasOwn(request, "status")
        ? exactObject(request.status, ["ledgerEpoch", "reportId"])
        : undefined;
      const lookup =
        statusInput === undefined
          ? undefined
          : {
              ledgerEpoch: positive(statusInput.ledgerEpoch),
              reportId: scalar(statusInput.reportId),
            };
      const observed = await observeContext(access, articleId, false);
      const first = observed.value;
      const head = await headVersion(articleId);
      if (lookup !== undefined) {
        if (head.value.ledgerEpoch !== lookup.ledgerEpoch)
          throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
        if (head.value.status !== "active")
          throw new KnowledgeEvidenceReportsError("ledger_resetting");
      }
      const report =
        lookup === undefined
          ? undefined
          : await observedReport(
              articleId,
              lookup.ledgerEpoch,
              lookup.reportId,
            );
      if (
        report !== undefined &&
        report.value.submittedBy !== access.principalId
      )
        throw new KnowledgeEvidenceReportsError("report_not_found");
      if (observed.observation !== undefined) {
        await confirmContext(access, observed.observation);
      } else {
        const latest = await context(access, articleId, false);
        if (
          latest.draft.generation !== first.draft.generation ||
          latest.draft.revision.collectionId !==
            first.draft.revision.collectionId ||
          latest.draft.revision.kind !== first.draft.revision.kind ||
          (await knowledgeDigest(latest.requirements)) !==
            (await knowledgeDigest(first.requirements))
        )
          throw new KnowledgeEvidenceReportsError("report_changed");
      }
      // Context confirmation can await a ledger reset without changing the old
      // report row. Observe both ledger and owner status after that work in one
      // keyed-read wave; these separate authorities still provide no lock.
      const [latestHead, latestReport] = await Promise.all([
        headVersion(articleId),
        lookup === undefined
          ? undefined
          : observedReport(articleId, lookup.ledgerEpoch, lookup.reportId),
      ]);
      if (
        latestHead.value.ledgerEpoch !== head.value.ledgerEpoch ||
        latestHead.value.status !== head.value.status
      )
        throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
      if (latestHead.version !== head.version)
        throw new KnowledgeEvidenceReportsError("ledger_changed");
      if (
        report !== undefined &&
        (latestReport === undefined ||
          latestReport.version !== report.version ||
          latestReport.value.submittedBy !== access.principalId ||
          latestReport.value.reportGeneration !==
            report.value.reportGeneration ||
          latestReport.value.receiptGeneration !==
            report.value.receiptGeneration ||
          latestReport.value.status !== report.value.status ||
          latestReport.value.reportHash !== report.value.reportHash)
      )
        throw new KnowledgeEvidenceReportsError("report_changed");
      // Re-resolve only after the awaited resource observations, preserving the
      // original credential's restricted permissions through final disclosure.
      await current(access, knowledgePermissions.evidenceSubmit);
      // Close the epoch after every resource and current-authority await.
      // These separate observations provide no cross-row lock.
      const closingHead = await headVersion(articleId);
      if (
        closingHead.value.ledgerEpoch !== latestHead.value.ledgerEpoch ||
        closingHead.value.status !== latestHead.value.status
      )
        throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
      if (closingHead.version !== latestHead.version)
        throw new KnowledgeEvidenceReportsError("ledger_changed");
      return {
        target: {
          articleId,
          generation: first.draft.generation,
          collectionId: first.draft.revision.collectionId,
          kind: first.draft.revision.kind,
        },
        requirements: first.requirements,
        ledger: state(articleId, closingHead.value),
        ...(latestReport === undefined
          ? {}
          : {
              status: {
                ...acknowledgement(latestReport.value),
                status: latestReport.value.status,
              },
            }),
      };
    },
    async ledger(access, input) {
      input = requestData(input);
      access = await current(access, knowledgePermissions.evidenceSubmit);
      const value = exactObject(input, ["articleId"]);
      const articleId = scalar(value.articleId);
      const head = await headVersion(articleId);
      await current(access, knowledgePermissions.evidenceSubmit);
      return state(articleId, head.value);
    },
    async report(access, value) {
      value = requestData(value);
      access = await current(access, knowledgePermissions.evidenceSubmit);
      const input = optionalKeysObject(
        value,
        ["commandId", "articleId", "ledgerEpoch", "evidence", "report"],
        ["expectedArticleGeneration"],
      );
      const commandId = await knowledgeDigest(scalar(input.commandId));
      const articleId = scalar(input.articleId);
      const ledgerEpoch = positive(input.ledgerEpoch);
      const expectedArticleGeneration = Object.hasOwn(
        input,
        "expectedArticleGeneration",
      )
        ? positive(input.expectedArticleGeneration, 0)
        : undefined;
      const evidence = parseKnowledgeEvidence(input.evidence);
      const report = parseReport(input.report);
      if (evidence.articleId !== articleId)
        throw new KnowledgeEvidenceReportsError("invalid_request");
      await active(articleId, ledgerEpoch);
      const fingerprint = await knowledgeDigest({
        actor: access.principalId,
        operation: "report",
        commandId,
        articleId,
        ledgerEpoch,
        ...(expectedArticleGeneration === undefined
          ? {}
          : { expectedArticleGeneration }),
        evidence,
        report,
      });
      const accepted = await replay(
        articleId,
        ledgerEpoch,
        commandId,
        fingerprint,
      );
      if (accepted !== null) {
        await active(articleId, ledgerEpoch);
        await current(access, knowledgePermissions.evidenceSubmit);
        return accepted;
      }
      if (!validSubmissionSyntax(evidence))
        throw new KnowledgeEvidenceReportsError("invalid_request");
      const valueContext = await context(access, articleId, false);
      if (
        expectedArticleGeneration !== undefined &&
        valueContext.draft.generation !== expectedArticleGeneration
      )
        throw new KnowledgeEvidenceReportsError("report_changed");
      const hashes = await contextHashes(valueContext);
      const initial: ReportRecord = {
        ledgerEpoch,
        receiptGeneration: 1,
        reportId: crypto.randomUUID(),
        articleId,
        reportGeneration: 1,
        status: "pending",
        submittedBy: access.principalId,
        submittedAt: now(),
        evidence,
        report,
        submissionHash: await knowledgeDigest(evidence),
        reportHash: "0".repeat(64),
        ...hashes,
        confirmation: null,
      };
      return write(access, commandId, fingerprint, {
        ...initial,
        reportHash: await knowledgeDigest(reportBinding(initial)),
      });
    },
    async status(access, value) {
      value = requestData(value);
      access = await current(access, knowledgePermissions.evidenceSubmit);
      const input = exactObject(value, [
        "articleId",
        "ledgerEpoch",
        "reportId",
      ]);
      const articleId = scalar(input.articleId);
      const epoch = positive(input.ledgerEpoch);
      const head = await headVersion(articleId);
      if (head.value.ledgerEpoch !== epoch)
        throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
      if (head.value.status !== "active")
        throw new KnowledgeEvidenceReportsError("ledger_resetting");
      const report = await load(articleId, epoch, scalar(input.reportId));
      if (report.submittedBy !== access.principalId)
        throw new KnowledgeEvidenceReportsError("report_not_found");
      await current(access, knowledgePermissions.evidenceSubmit);
      // Compare the report before closing the epoch as the final await.
      // A concurrent human decision must not return an old generation/cycle.
      const latest = await load(articleId, epoch, report.reportId);
      if (
        latest.reportGeneration !== report.reportGeneration ||
        latest.receiptGeneration !== report.receiptGeneration ||
        latest.status !== report.status ||
        latest.reportHash !== report.reportHash
      )
        throw new KnowledgeEvidenceReportsError("report_changed");
      const closingHead = await headVersion(articleId);
      if (closingHead.value.ledgerEpoch !== epoch)
        throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
      if (closingHead.value.status !== "active")
        throw new KnowledgeEvidenceReportsError("ledger_resetting");
      if (closingHead.version !== head.version)
        throw new KnowledgeEvidenceReportsError("report_changed");
      return { ...acknowledgement(latest), status: latest.status };
    },
    async list(access, value) {
      value = requestData(value);
      access = await staff(access);
      const input = exactObject(value, ["articleId"]);
      const articleId = scalar(input.articleId);
      const head = await headVersion(articleId);
      const rows = await partitionRows(articleId);
      const reports =
        head.value.status === "active"
          ? rows
              .filter((item) =>
                item.id.startsWith("report:" + head.value.ledgerEpoch + ":"),
              )
              .map((item) => {
                const report = decodeReport(item.payload);
                if (
                  report.articleId !== articleId ||
                  report.ledgerEpoch !== head.value.ledgerEpoch ||
                  item.id !== reportKey(head.value.ledgerEpoch, report.reportId)
                )
                  throw new KnowledgeEvidenceReportsUnavailableError(
                    "report_identity",
                  );
                return summary(report);
              })
          : [];
      await staff(access);
      const latest = await headVersion(articleId);
      if (
        latest.value.ledgerEpoch !== head.value.ledgerEpoch ||
        latest.value.status !== head.value.status
      )
        throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
      if (latest.version !== head.version)
        throw new KnowledgeEvidenceReportsError("ledger_changed");
      if (
        head.value.status === "active" &&
        reports.length !== head.value.reports
      )
        throw new KnowledgeEvidenceReportsUnavailableError("report_count");
      return { ledger: state(articleId, latest.value), reports };
    },
    async read(access, value) {
      value = requestData(value);
      access = await staff(access);
      const input = exactObject(value, [
        "articleId",
        "ledgerEpoch",
        "reportId",
      ]);
      const articleId = scalar(input.articleId);
      const epoch = positive(input.ledgerEpoch);
      await active(articleId, epoch);
      const observed = await observedReport(
        articleId,
        epoch,
        scalar(input.reportId),
      );
      const report = observed.value;
      const valueContext = await context(access, articleId, true);
      const reviewBindingHash = await knowledgeDigest({
        report,
        context: valueContext,
      });
      await staff(access);
      const head = await headVersion(articleId);
      if (head.value.ledgerEpoch !== epoch)
        throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
      if (head.value.status !== "active")
        throw new KnowledgeEvidenceReportsError("ledger_resetting");
      // Observe the report before the final epoch/head read. These separate
      // observations provide no lock; return without another await.
      const latest = await observedReport(articleId, epoch, report.reportId);
      if (latest.version !== observed.version)
        throw new KnowledgeEvidenceReportsError("report_changed");
      const latestHead = await headVersion(articleId);
      if (
        latestHead.value.ledgerEpoch !== head.value.ledgerEpoch ||
        latestHead.value.status !== head.value.status
      )
        throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
      if (latestHead.version !== head.version)
        throw new KnowledgeEvidenceReportsError("ledger_changed");
      return {
        ...summary(report),
        receipt: acknowledgement(report).receipt,
        evidence: report.evidence,
        report: report.report,
        draft: valueContext.draft,
        reportHash: report.reportHash,
        submissionHash: report.submissionHash,
        governanceHash: report.governanceHash,
        requirements: valueContext.requirements,
        reviewBindingHash,
        expectedReportGeneration: report.reportGeneration,
        confirmation: report.confirmation,
      };
    },
    async decide(access, value, decision) {
      value = requestData(value);
      if (
        decision !== "confirmed" &&
        decision !== "rejected" &&
        decision !== "pending"
      )
        throw new KnowledgeEvidenceReportsError("invalid_request");
      access = await staff(access);
      const input = exactObject(value, [
        "commandId",
        "articleId",
        "ledgerEpoch",
        "reportId",
        "expectedReportGeneration",
        "reviewBindingHash",
      ]);
      const commandId = await knowledgeDigest(scalar(input.commandId));
      const articleId = scalar(input.articleId);
      const epoch = positive(input.ledgerEpoch);
      const reportId = scalar(input.reportId);
      const expected = positive(input.expectedReportGeneration);
      const binding = hash(input.reviewBindingHash);
      await active(articleId, epoch);
      const fingerprint = await knowledgeDigest({
        actor: access.principalId,
        operation: decision,
        commandId,
        articleId,
        ledgerEpoch: epoch,
        reportId,
        expected,
        binding,
      });
      const accepted = await replay(articleId, epoch, commandId, fingerprint);
      if (accepted !== null) {
        await active(articleId, epoch);
        await staff(access);
        return accepted;
      }
      const saved = await ledgerIo("report_read", () =>
        records.getVersioned(storageKey(articleId, reportKey(epoch, reportId))),
      );
      if (saved === null)
        throw new KnowledgeEvidenceReportsError("report_not_found");
      const report = decodeReport(saved.value.payload);
      if (
        report.ledgerEpoch !== epoch ||
        report.reportId !== reportId ||
        report.articleId !== articleId
      )
        throw new KnowledgeEvidenceReportsUnavailableError("report_identity");
      if (
        report.reportGeneration !== expected ||
        (decision === "pending"
          ? report.status === "pending"
          : report.status !== "pending")
      )
        throw new KnowledgeEvidenceReportsError("report_changed");
      const observed = await observeContext(access, articleId, true);
      const valueContext = observed.value;
      if (
        (await knowledgeDigest({ report, context: valueContext })) !== binding
      )
        throw new KnowledgeEvidenceReportsError("report_changed");
      const at = now();
      let next: ReportRecord = {
        ...report,
        reportGeneration: positive(report.reportGeneration + 1),
        status: decision,
        confirmation:
          decision === "confirmed"
            ? { reviewerId: access.principalId, confirmedAt: at }
            : null,
      };
      if (decision === "pending") {
        next = {
          ...next,
          receiptGeneration: positive(report.receiptGeneration + 1),
          ...(await contextHashes(valueContext)),
        };
        next = {
          ...next,
          reportHash: await knowledgeDigest(reportBinding(next)),
        };
      }
      if (
        decision !== "rejected" &&
        !(await valid(next, valueContext.draft.revision, valueContext, at))
      )
        throw new KnowledgeEvidenceReportsError("report_not_verifiable");
      if (observed.observation !== undefined) {
        // This probe releases no DTO or side effect. write() resolves the
        // original caller's complete live staff authority after the probe and
        // its head read, immediately before CAS, then again after commit.
        await confirmContext(access, observed.observation);
      } else {
        const latestContext = await context(await staff(access), articleId);
        if (
          (await knowledgeDigest(valueContext)) !==
          (await knowledgeDigest(latestContext))
        )
          throw new KnowledgeEvidenceReportsError("report_changed");
      }
      return write(access, commandId, fingerprint, next, saved.version);
    },
    async reset(access, value) {
      value = requestData(value);
      access = await staff(access);
      const input = exactObject(value, [
        "commandId",
        "articleId",
        "expectedLedgerEpoch",
      ]);
      const articleId = scalar(input.articleId);
      const expected = positive(input.expectedLedgerEpoch);
      const fingerprint = await knowledgeDigest({
        actorId: access.principalId,
        articleId,
        expectedLedgerEpoch: expected,
        commandId: scalar(input.commandId),
      });
      const head = await headVersion(articleId);
      if (
        head.value.lastReset?.fingerprint === fingerprint &&
        head.value.lastReset.actorId === access.principalId &&
        head.value.lastReset.fromEpoch === expected
      ) {
        await staff(access);
        return state(articleId, head.value);
      }
      if (head.value.ledgerEpoch !== expected)
        throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
      if (head.value.status !== "active")
        throw new KnowledgeEvidenceReportsError("ledger_resetting");
      if (expected === Number.MAX_SAFE_INTEGER)
        throw new KnowledgeEvidenceReportsError("ledger_epoch_exhausted");
      const oldRows = (await partitionRows(articleId))
        .filter((item) => item.id !== "head")
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if ((await headVersion(articleId)).version !== head.version)
        throw new KnowledgeEvidenceReportsError("ledger_changed");
      if (oldRows.length !== head.value.rows - 1)
        throw new KnowledgeEvidenceReportsUnavailableError("reset_count");
      const reset: ResetRecord = {
        fingerprint,
        actorId: access.principalId,
        fromEpoch: expected,
        startedAt: now(),
        completedAt: null,
        retiredRows: oldRows.length,
        retiredReports: head.value.reports,
        contentHash: await knowledgeDigest(oldRows),
      };
      const next: LedgerHead = {
        ledgerEpoch: expected + 1,
        status: "resetting",
        reports: 0,
        rows: 1,
        drainRemaining: oldRows.length,
        historyHash: await knowledgeDigest({
          previous: head.value.historyHash,
          reset,
        }),
        lastReset: reset,
      };
      await staff(access);
      const outcome = await ledgerIo("reset_begin", () =>
        records.transact(storagePartition(articleId), [
          head.version === undefined
            ? { action: "insert", value: row(articleId, "head", next) }
            : {
                action: "putIfUnchanged",
                value: row(articleId, "head", next),
                version: head.version,
              },
        ]),
      );
      if (!outcome.committed)
        throw new KnowledgeEvidenceReportsError("ledger_changed");
      // The reset may already be durable. Refusal here withholds only its ACK.
      await staff(access);
      return state(articleId, next);
    },
    async drain(access, value) {
      value = requestData(value);
      access = await staff(access);
      const input = exactObject(value, ["articleId", "ledgerEpoch"]);
      const articleId = scalar(input.articleId);
      const epoch = positive(input.ledgerEpoch);
      const head = await headVersion(articleId);
      if (head.value.ledgerEpoch !== epoch)
        throw new KnowledgeEvidenceReportsError("ledger_epoch_changed");
      if (head.value.status === "active") {
        await staff(access);
        return state(articleId, head.value);
      }
      if (head.version === undefined || head.value.lastReset === null)
        throw new KnowledgeEvidenceReportsUnavailableError("reset_head");
      const version = head.version;
      const oldRows = (await partitionRows(articleId))
        .filter((item) => item.id !== "head")
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if ((await headVersion(articleId)).version !== version)
        throw new KnowledgeEvidenceReportsError("ledger_changed");
      if (oldRows.length !== head.value.drainRemaining)
        throw new KnowledgeEvidenceReportsUnavailableError("drain_count");
      const selected = oldRows.slice(0, DRAIN_ROWS);
      const remaining = oldRows.length - selected.length;
      const next: LedgerHead = {
        ...head.value,
        status: remaining === 0 ? "active" : "resetting",
        drainRemaining: remaining,
        lastReset: {
          ...head.value.lastReset,
          completedAt: remaining === 0 ? now() : null,
        },
      };
      await staff(access);
      const outcome = await ledgerIo("reset_drain", () =>
        records.transact(storagePartition(articleId), [
          {
            action: "putIfUnchanged",
            value: row(articleId, "head", next),
            version,
          },
          ...selected.map((item) => ({
            action: "delete" as const,
            key: storageKey(articleId, item.id),
          })),
        ]),
      );
      if (!outcome.committed)
        throw new KnowledgeEvidenceReportsError("ledger_changed");
      // Deleted rows are not restored if staff authority changed during IO.
      await staff(access);
      return state(articleId, next);
    },
  } satisfies KnowledgeEvidenceReports);
}
