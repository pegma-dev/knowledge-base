export type KnowledgeEvidenceReportsErrorCode =
  | "invalid_configuration"
  | "invalid_request"
  | "report_too_large"
  | "forbidden"
  | "report_not_found"
  | "report_target_unavailable"
  | "command_conflict"
  | "report_capacity"
  | "report_changed"
  | "report_not_verifiable"
  | "ledger_epoch_changed"
  | "ledger_resetting"
  | "ledger_changed"
  | "ledger_epoch_exhausted";

/** Component refusal; hosts choose their HTTP/status/UI mapping. */
export class KnowledgeEvidenceReportsError extends Error {
  override readonly name = "KnowledgeEvidenceReportsError";
  constructor(readonly code: KnowledgeEvidenceReportsErrorCode) {
    super("Knowledge evidence report operation refused: " + code);
  }
}

export type KnowledgeEvidenceReportsStage =
  | "record_decode"
  | "report_decode"
  | "head_decode"
  | "principal_resolve"
  | "head_read"
  | "head_identity"
  | "head_partition_orphaned"
  | "partition_read"
  | "partition_integrity"
  | "report_read"
  | "report_identity"
  | "context_read"
  | "receipt_read"
  | "receipt_decode"
  | "report_write"
  | "report_count"
  | "reset_count"
  | "reset_head"
  | "reset_begin"
  | "reset_drain"
  | "drain_count"
  | "clock_read"
  | "collection_open"
  | "hashing";

/** Safe dependency/integrity category, without stored bodies or raw exceptions. */
export class KnowledgeEvidenceReportsUnavailableError extends Error {
  override readonly name = "KnowledgeEvidenceReportsUnavailableError";
  readonly code = "report_ledger_unavailable";
  constructor(readonly stage: KnowledgeEvidenceReportsStage) {
    super("Knowledge evidence report ledger is unavailable.");
  }
}
