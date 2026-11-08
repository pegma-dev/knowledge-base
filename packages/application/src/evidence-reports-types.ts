import type { AccessContext } from "@pegma/authorization-core";
import type {
  Clock,
  IsoTimestamp,
  Logger,
  PrincipalId,
} from "@pegma/knowledge-base-contracts";
import type { EvidenceSubmission } from "@pegma/knowledge-base-core";
import type { Store } from "@pegma/storage-core";
import type {
  DraftArticleDto,
  EvidenceDto,
  EvidenceVerifier,
  ValidationRequirementsDto,
} from "./types.js";

export interface KnowledgeTestReport {
  readonly summary: string;
  readonly details: string;
}

export type KnowledgeReportStatus = "pending" | "confirmed" | "rejected";

export interface KnowledgeReportAcknowledgement {
  readonly ledgerEpoch: number;
  readonly reportId: string;
  readonly receipt: string;
  readonly reportGeneration: number;
}

export interface KnowledgeReportSummary {
  readonly ledgerEpoch: number;
  readonly reportId: string;
  readonly articleId: string;
  readonly reportGeneration: number;
  readonly status: KnowledgeReportStatus;
  readonly submittedBy: PrincipalId;
  readonly submittedAt: IsoTimestamp;
  readonly summary: string;
}

export interface KnowledgeReportConfirmation {
  readonly reviewerId: PrincipalId;
  readonly confirmedAt: IsoTimestamp;
}

export interface KnowledgeReportLedgerState {
  readonly articleId: string;
  readonly ledgerEpoch: number;
  readonly status: "active" | "resetting";
  readonly reportsRemaining: number;
  /** Available admission rows while active; rows left to drain while resetting. */
  readonly rowsRemaining: number;
}

/** Trusted current KB DTOs, obtained through authorized public application reads. */
export interface KnowledgeEvidenceContext {
  readonly draft: DraftArticleDto;
  readonly requirements: ValidationRequirementsDto;
  /** Complete current getEvidence DTO at the draft's exact generation is
   * required for human qualification and verification. Pending agent report
   * admission may omit private evidence; omission is never empty history. */
  readonly evidence?: EvidenceDto;
}

export interface KnowledgeReportView extends KnowledgeReportSummary {
  readonly evidence: EvidenceSubmission;
  readonly report: KnowledgeTestReport;
  readonly reportHash: string;
  readonly submissionHash: string;
  readonly governanceHash: string;
  readonly draft: DraftArticleDto;
  readonly requirements: ValidationRequirementsDto;
  readonly reviewBindingHash: string;
  readonly expectedReportGeneration: number;
  readonly confirmation: KnowledgeReportConfirmation | null;
}

export interface KnowledgeReportArticleInput {
  readonly articleId: string;
}

export interface KnowledgeReportKey extends KnowledgeReportArticleInput {
  readonly ledgerEpoch: number;
  readonly reportId: string;
}

export interface SubmitKnowledgeReportInput extends KnowledgeReportArticleInput {
  readonly commandId: string;
  readonly ledgerEpoch: number;
  /** Admission fence for a new command, bound into its exact replay identity
   * only when present. Retry the original value; omission preserves legacy
   * fingerprints and does not introduce a default generation. */
  readonly expectedArticleGeneration?: number;
  readonly evidence: EvidenceSubmission;
  readonly report: KnowledgeTestReport;
}

export interface DecideKnowledgeReportInput extends KnowledgeReportKey {
  readonly commandId: string;
  readonly expectedReportGeneration: number;
  readonly reviewBindingHash: string;
}

export interface ResetKnowledgeReportsInput extends KnowledgeReportArticleInput {
  readonly commandId: string;
  readonly expectedLedgerEpoch: number;
}

export interface DrainKnowledgeReportsInput extends KnowledgeReportArticleInput {
  readonly ledgerEpoch: number;
}

export type KnowledgeEvidenceReportStorageLayout =
  "portable-v1" | "legacy-raw-v1";

export interface KnowledgeEvidenceReportsOptions {
  readonly store: Store;
  readonly clock: Clock;
  /** Explicit, exclusive report namespace; may preserve an existing host ledger. */
  readonly collectionName: string;
  /**
   * Defaults to portable-v1, with backend-safe encoded physical keys and
   * bounded string chunks for the serialized payload.
   * Select legacy-raw-v1 explicitly only for an existing compatible raw-key
   * ledger (such as the original D1 host). It preserves that ledger's raw keys
   * and original single-payload record, not Azure portability. No data/layout
   * detection or migration is performed.
   * Never switch layouts on a populated namespace without an explicit migration.
   */
  readonly storageLayout?: KnowledgeEvidenceReportStorageLayout;
  /** Human-only host permission, additional to KB draft/evidence reading. */
  readonly confirmationPermission: string;
  readonly resolvePrincipal: (id: PrincipalId) => Promise<AccessContext | null>;
  readonly readContext: (
    access: AccessContext,
    articleId: string,
  ) => Promise<KnowledgeEvidenceContext>;
  readonly logger?: Logger;
}

export interface KnowledgeEvidenceReports {
  readonly verifier: EvidenceVerifier;
  report(
    access: AccessContext,
    input: SubmitKnowledgeReportInput,
  ): Promise<KnowledgeReportAcknowledgement>;
  status(
    access: AccessContext,
    input: KnowledgeReportKey,
  ): Promise<
    KnowledgeReportAcknowledgement & { readonly status: KnowledgeReportStatus }
  >;
  read(
    access: AccessContext,
    input: KnowledgeReportKey,
  ): Promise<KnowledgeReportView>;
  list(
    access: AccessContext,
    input: KnowledgeReportArticleInput,
  ): Promise<{
    readonly ledger: KnowledgeReportLedgerState;
    readonly reports: readonly KnowledgeReportSummary[];
  }>;
  ledger(
    access: AccessContext,
    input: KnowledgeReportArticleInput,
  ): Promise<KnowledgeReportLedgerState>;
  decide(
    access: AccessContext,
    input: DecideKnowledgeReportInput,
    decision: KnowledgeReportStatus,
  ): Promise<KnowledgeReportAcknowledgement>;
  /** Retires report receipts; does not revoke already accepted KB evidence. */
  reset(
    access: AccessContext,
    input: ResetKnowledgeReportsInput,
  ): Promise<KnowledgeReportLedgerState>;
  drain(
    access: AccessContext,
    input: DrainKnowledgeReportsInput,
  ): Promise<KnowledgeReportLedgerState>;
}
