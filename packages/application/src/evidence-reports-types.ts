import type { AccessContext } from "@pegma/authorization-core";
import type {
  Clock,
  ArticleKind,
  IsoTimestamp,
  Logger,
  PrincipalId,
  VerificationEvidence,
} from "@pegma/knowledge-base-contracts";
import type { EvidenceSubmission } from "@pegma/knowledge-base-core";
import type { Store } from "@pegma/storage-core";
import type {
  DraftArticleDto,
  KnowledgeBaseApplication,
  EvidenceDto,
  EvidenceVerifier,
  EvidenceVerificationRequest,
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
  readonly receipt: string;
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

export interface KnowledgeReportQueryInput extends KnowledgeReportArticleInput {
  readonly status?: {
    readonly ledgerEpoch: number;
    readonly reportId: string;
  };
}

/** Body-free governed authoring target and owner-only report status. */
export interface KnowledgeReportQueryResult {
  readonly target: {
    readonly articleId: string;
    readonly generation: number;
    readonly collectionId: string;
    readonly kind: ArticleKind;
  };
  readonly requirements: ValidationRequirementsDto;
  readonly ledger: KnowledgeReportLedgerState;
  readonly status?: KnowledgeReportAcknowledgement & {
    readonly status: KnowledgeReportStatus;
  };
}

export interface KnowledgeReportKey extends KnowledgeReportArticleInput {
  readonly ledgerEpoch: number;
  readonly reportId: string;
}

declare const reportObservationBrand: unique symbol;
/** Single-use, instance-bound read observation. Keep it inside one operation. */
export interface KnowledgeReportObservation {
  readonly [reportObservationBrand]: true;
}

export interface KnowledgeReportObservationRead {
  /** Provisional private data; await confirm before using it as a current binding. */
  readonly view: KnowledgeReportView;
  readonly context: KnowledgeEvidenceContext;
  readonly observation: KnowledgeReportObservation;
}

export interface KnowledgeReportObservationConfirmation {
  readonly receipt: string;
  /** Present only when the optional original-owner verification request succeeds. */
  readonly attestation: VerificationEvidence["attestation"] | null;
}

/** Optional paired reads, available only with the real authoringContext pair. */
export interface KnowledgeReportObservations {
  observe(
    access: AccessContext,
    input: KnowledgeReportKey,
  ): Promise<KnowledgeReportObservationRead>;
  /** Confirms exact KB resources/report/head and current actor/reviewer authority.
   * The handle is consumed before awaited work, including a failed confirmation.
   * An optional verification request retains the legacy verifier's owner binding. */
  confirm(
    access: AccessContext,
    observation: KnowledgeReportObservation,
    verification?: EvidenceVerificationRequest,
  ): Promise<KnowledgeReportObservationConfirmation>;
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
  /** Optional operation-local observation/recheck; legacy readContext remains valid. */
  readonly authoringContext?: Pick<
    KnowledgeBaseApplication,
    "getAuthoringContext" | "confirmAuthoringContext"
  >;
  readonly logger?: Logger;
}

export interface KnowledgeEvidenceReports {
  readonly verifier: EvidenceVerifier;
  readonly observations?: KnowledgeReportObservations;
  query(
    access: AccessContext,
    input: KnowledgeReportQueryInput,
  ): Promise<KnowledgeReportQueryResult>;
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
