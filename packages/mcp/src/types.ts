import type { AccessContext } from "@pegma/authorization-core";
import type {
  ArticleAcknowledgement,
  ArticleReadInput,
  CommandResult,
  CreateDraftInput,
  DraftArticleDto,
  KnowledgeBaseApplication,
  SubmitEvidenceInput,
  UpdateDraftInput,
  ValidationRequirementsDto,
  ValidationRequirementsReadInput,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import { knowledgeLimits } from "@pegma/knowledge-base-core";

/** Scopes are existing application permission names, never a second role model. */
export const knowledgeAgentScopes = Object.freeze({
  draftRead: knowledgePermissions.draftRead,
  draftWrite: knowledgePermissions.draftWrite,
  evidenceSubmit: knowledgePermissions.evidenceSubmit,
});

export const knowledgeAgentOperations = Object.freeze([
  "getDraft",
  "createDraft",
  "updateDraft",
  "getValidationRequirements",
  "submitEvidence",
] as const);

export type KnowledgeAgentOperation = (typeof knowledgeAgentOperations)[number];

export const knowledgeAgentToolNames = Object.freeze({
  getDraft: "knowledge_v1_get_draft",
  createDraft: "knowledge_v1_create_draft",
  updateDraft: "knowledge_v1_update_draft",
  getValidationRequirements: "knowledge_v1_get_validation_requirements",
  submitEvidence: "knowledge_v1_submit_evidence",
} as const satisfies Record<KnowledgeAgentOperation, string>);

/** Authenticated by the host, supplied separately from every untrusted body. */
export interface KnowledgeAgentIdentity {
  readonly access: AccessContext;
  readonly scopes: readonly string[];
  readonly clientId: string;
  readonly resource: string;
}

export interface KnowledgeAgentInputMap {
  readonly getDraft: ArticleReadInput;
  /** Privileged host provenance delivery is outside initial agent consent. */
  readonly createDraft: Omit<CreateDraftInput, "sourceReferences">;
  readonly updateDraft: Omit<UpdateDraftInput, "sourceReferences">;
  readonly getValidationRequirements: ValidationRequirementsReadInput;
  readonly submitEvidence: SubmitEvidenceInput;
}

export interface KnowledgeAgentResultMap {
  readonly getDraft: DraftArticleDto;
  readonly createDraft: CommandResult<ArticleAcknowledgement>;
  readonly updateDraft: CommandResult<ArticleAcknowledgement>;
  readonly getValidationRequirements: ValidationRequirementsDto;
  readonly submitEvidence: CommandResult<ArticleAcknowledgement>;
}

export type KnowledgeAgentEnvelope = {
  [Operation in KnowledgeAgentOperation]: {
    readonly apiVersion: "1";
    readonly operation: Operation;
    readonly input: KnowledgeAgentInputMap[Operation];
  };
}[KnowledgeAgentOperation];

export type KnowledgeAgentSuccess = {
  [Operation in KnowledgeAgentOperation]: {
    readonly apiVersion: "1";
    readonly operation: Operation;
    readonly result: KnowledgeAgentResultMap[Operation];
  };
}[KnowledgeAgentOperation];

export type KnowledgeAgentErrorCode =
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "capacity"
  | "prerequisite"
  | "unavailable";

export interface KnowledgeAgentError {
  readonly code: KnowledgeAgentErrorCode;
  readonly status: number;
  readonly message: string;
}

export interface KnowledgeAgentFailure {
  readonly apiVersion: "1";
  /** Invalid envelopes never reflect an unrecognized caller-supplied name. */
  readonly operation: KnowledgeAgentOperation | null;
  readonly error: KnowledgeAgentError;
}

export type KnowledgeAgentResponse =
  KnowledgeAgentSuccess | KnowledgeAgentFailure;

export interface KnowledgeAgentLimits {
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
}

// A complete 32 KiB guide or sixteen 1,000-character evidence steps, including
// UTF-8 expansion, receipt, metadata, and JSON framing. Never truncate a guide.
const completeMessageBytes = knowledgeLimits.contentBytes * 4;

// Reserve a complete mutation acknowledgement before any operation can run.
// Four UTF-8 bytes per identifier character is conservative for the core's
// character bound; JSON escapes are smaller. Generation/revision, SHA-256, and
// 512 bytes of fixed keys/version/operation/state framing fit the remainder.
// Round that ceiling up to a whole KiB (currently 2,048 bytes), so lowering the
// response budget cannot strand either a new commit or a historical replay.
const maximumMutationAcknowledgementBytes =
  knowledgeLimits.identifierCharacters * 4 +
  String(Number.MAX_SAFE_INTEGER).length * 2 +
  64 +
  512;
export const minimumKnowledgeAgentResponseBytes =
  Math.ceil(maximumMutationAcknowledgementBytes / 1_024) * 1_024;

export const defaultKnowledgeAgentLimits: KnowledgeAgentLimits = Object.freeze({
  maxRequestBytes: completeMessageBytes,
  maxResponseBytes: completeMessageBytes,
  maxDepth: 12,
  maxNodes: 1_024,
  maxArrayLength: knowledgeLimits.requirements,
  maxObjectKeys: 32,
});

export interface KnowledgeAgentDispatcherOptions {
  readonly application: KnowledgeBaseApplication;
  /** Exact protected-resource identifier configured by this host. */
  readonly resource: string;
  /**
   * Positive safe integers may only reduce the fixed component ceilings.
   * maxResponseBytes must reserve at least 2,048 bytes for acknowledgements.
   */
  readonly limits?: Partial<KnowledgeAgentLimits>;
}

export interface KnowledgeAgentDispatcher {
  readonly limits: KnowledgeAgentLimits;
  dispatch(
    identity: KnowledgeAgentIdentity,
    envelope: unknown,
  ): Promise<KnowledgeAgentResponse>;
}
