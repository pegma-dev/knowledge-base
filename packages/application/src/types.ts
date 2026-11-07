import type { AccessContext } from "@pegma/authorization-core";
import type {
  Applicability,
  ApprovalBinding,
  Article,
  ArticleContent,
  ArticleKind,
  ArticleRevision,
  Clock,
  Collection,
  CollectionUse,
  IsoTimestamp,
  PrincipalId,
  ValidationPolicy,
  ValidationPolicyReference,
  VerificationEvidence,
} from "@pegma/knowledge-base-contracts";
import type {
  ArticleDraft,
  CollectionPolicyPreview,
  EvidenceSubmission,
} from "@pegma/knowledge-base-core";
import type { Store } from "@pegma/storage-core";

import type { KnowledgeRepositoryLimits } from "./repository.js";

/** Opaque source identity only: no URL, source body, customer text, or credential. */
export interface PrivateSourceReference {
  readonly id: string;
  readonly system: string;
  readonly resourceId: string;
  readonly version: string;
}

/** Hash and generation are computed by the application, never supplied as proof. */
export interface SourceSnapshot {
  readonly generation: number;
  readonly references: readonly PrivateSourceReference[];
  readonly hash: string;
}

/** Trusted configuration stored with, and versioned by, the collection head. */
export interface GovernanceConfiguration {
  readonly validationPolicy: ValidationPolicyReference;
  readonly expectedStagingBuildId: string;
  readonly trustedAttesterIds: readonly PrincipalId[];
}

/** The complete application review fence, in addition to the pure core binding. */
export interface ReviewSnapshot {
  readonly articleGeneration: number;
  readonly binding: ApprovalBinding;
  readonly sourceSnapshotHash: string;
  readonly sourceGeneration: number;
  readonly governanceGeneration: number;
}

/** Immutable revocation identifies a historical version, including its revision. */
export interface EvidenceRevocation {
  readonly articleRevision: number;
  readonly id: string;
  readonly version: number;
  readonly hash: string;
  readonly reason: string;
  readonly revokedBy: PrincipalId;
  readonly revokedAt: IsoTimestamp;
}

export interface EvidenceVerificationRequest {
  readonly access: AccessContext;
  readonly article: ArticleRevision;
  readonly submission: EvidenceSubmission;
  /** Host-defined receipt. It is never treated as an attester identity by KB. */
  readonly receipt: string;
  readonly configuration: GovernanceConfiguration;
}

export interface EvidenceVerifier {
  /** Authenticate the receipt and its complete submission/actor/target binding. */
  verify(
    request: EvidenceVerificationRequest,
  ): Promise<VerificationEvidence["attestation"] | null>;
}

export interface SourceReadRequest {
  readonly access: AccessContext;
  readonly articleId: string;
  readonly reference: PrivateSourceReference;
}

export interface SourceEligibilityRequest {
  readonly article: ArticleRevision;
  readonly snapshot: SourceSnapshot;
}

/**
 * The host owns source-resource authorization and resolution/revocation facts.
 * These checks do not grant any KB permission or expose source bodies.
 */
export interface PrivateSourcesVerifier {
  canRead(request: SourceReadRequest): Promise<boolean>;
  canPublish(request: SourceEligibilityRequest): Promise<boolean>;
  isCurrent(request: SourceEligibilityRequest): Promise<boolean>;
}

export interface KnowledgeBaseApplicationOptions {
  readonly store: Store;
  readonly clock: Clock;
  readonly limits?: Partial<KnowledgeRepositoryLimits>;
  /** Missing verifier fails closed for every evidence submission. */
  readonly evidenceVerifier?: EvidenceVerifier;
  /** Missing verifier fails closed wherever a nonempty source snapshot is needed. */
  readonly privateSources?: PrivateSourcesVerifier;
}

export type KnowledgeBaseServiceOptions = Omit<
  KnowledgeBaseApplicationOptions,
  "store"
>;

export interface CommandInput {
  readonly commandId: string;
  readonly correlationId: string;
  /** Aggregate state generation, independent of immutable content revision. */
  readonly expectedGeneration: number;
}

/**
 * A historical bounded acknowledgement. Replaying it does not promise that the
 * acknowledged content or authority is still current; use a current read.
 */
export interface CommandResult<T> {
  readonly value: T;
  readonly replayed: boolean;
}

export interface ResourceAcknowledgement {
  readonly id: string;
  readonly generation: number;
}

export interface CollectionAcknowledgement extends ResourceAcknowledgement {
  readonly policyVersion: number;
}

export interface ValidationPolicyAcknowledgement extends ResourceAcknowledgement {
  readonly version: number;
}

export interface ArticleAcknowledgement extends ResourceAcknowledgement {
  readonly articleRevision: number;
  readonly state: Article["state"];
  readonly contentHash: string;
}

/** Staff metadata, including policy/reviewer identities; not a portal DTO. */
export interface CollectionDto {
  readonly generation: number;
  readonly collection: Collection;
}

export interface ValidationPolicyDto {
  readonly generation: number;
  readonly policy: ValidationPolicy;
}

export interface GovernanceConfigurationDto {
  readonly collectionId: string;
  readonly generation: number;
  readonly configuration: GovernanceConfiguration;
}

/** Author-facing active checks, with no trusted runner or attester identities. */
export interface ValidationRequirementsDto {
  readonly collectionId: string;
  readonly governanceGeneration: number;
  readonly validationPolicy: ValidationPolicyReference;
  readonly expectedStagingBuildId: string;
  readonly checks: readonly {
    readonly id: string;
    readonly testKind: string;
    readonly maxAgeMilliseconds: number;
  }[];
}

/** Draft material only. Evidence, provenance, and reviewer records are separate. */
export interface DraftArticleDto {
  readonly articleId: string;
  readonly generation: number;
  readonly state: Article["state"];
  readonly revision: ArticleRevision;
  readonly hasPendingReview: boolean;
  readonly hasPublication: boolean;
  readonly publicationHeld: boolean;
}

export interface EvidenceDto {
  readonly articleId: string;
  readonly generation: number;
  readonly evidence: readonly VerificationEvidence[];
  readonly revokedEvidence: readonly EvidenceRevocation[];
}

export interface ProvenanceDto {
  readonly articleId: string;
  readonly generation: number;
  readonly snapshot: SourceSnapshot;
  readonly publishedSnapshot?: SourceSnapshot;
}

export interface ReviewDto {
  readonly articleId: string;
  readonly generation: number;
  readonly review: ReviewSnapshot;
}

/** Explicit portal-safe content. No actor, evidence, source, or review fields. */
export interface PublishedArticleDto {
  readonly articleId: string;
  readonly collectionId: string;
  readonly revision: number;
  readonly kind: ArticleKind;
  readonly title: string;
  readonly summary: string;
  readonly content: ArticleContent;
  readonly tags: readonly string[];
  readonly applicability: Applicability;
  readonly contentHash: string;
}

export interface CollectionPolicyPreviewDto {
  readonly generation: number;
  readonly preview: CollectionPolicyPreview;
}

export interface CreateCollectionInput extends CommandInput {
  readonly collectionId: string;
  readonly name: string;
}

export interface PreviewCollectionPolicyInput {
  readonly collectionId: string;
  readonly uses: {
    readonly portal: CollectionUse;
    readonly bot: CollectionUse;
  };
}

export interface UpdateCollectionPolicyInput extends CommandInput {
  readonly collectionId: string;
  readonly preview: CollectionPolicyPreview;
  /** Explicit approval still requires the current public-approval permission. */
  readonly approvePublic?: boolean;
}

export interface PutValidationPolicyInput extends CommandInput {
  readonly policy: ValidationPolicy;
}

export interface PutGovernanceConfigurationInput extends CommandInput {
  readonly collectionId: string;
  readonly configuration: GovernanceConfiguration;
}

export interface CreateDraftInput extends CommandInput {
  readonly articleId: string;
  readonly collectionId: string;
  readonly draft: ArticleDraft;
}

export interface UpdateDraftInput extends CommandInput {
  readonly articleId: string;
  readonly collectionId: string;
  readonly draft: ArticleDraft;
}

export interface SubmitEvidenceInput extends CommandInput {
  readonly articleId: string;
  readonly evidence: EvidenceSubmission;
  readonly receipt: string;
}

export interface ArticleCommandInput extends CommandInput {
  readonly articleId: string;
}

export interface PublishArticleInput extends ArticleCommandInput {
  readonly review: ReviewSnapshot;
}

export interface RejectReviewInput extends ArticleCommandInput {
  readonly reason: string;
}

export interface SetProvenanceInput extends ArticleCommandInput {
  readonly references: readonly PrivateSourceReference[];
}

export interface RevokeEvidenceInput extends ArticleCommandInput {
  readonly articleRevision: number;
  readonly evidenceId: string;
  readonly evidenceVersion: number;
  readonly evidenceHash: string;
  readonly reason: string;
}

export interface CollectionReadInput {
  readonly collectionId: string;
}

export interface ValidationPolicyReadInput {
  readonly policyId: string;
}

export interface ValidationRequirementsReadInput {
  readonly collectionId: string;
  readonly kind: ArticleKind;
}

export interface ArticleReadInput {
  readonly articleId: string;
}

export interface KnowledgeBaseApplication {
  createCollection(
    access: AccessContext,
    input: CreateCollectionInput,
  ): Promise<CommandResult<CollectionAcknowledgement>>;
  previewCollectionPolicy(
    access: AccessContext,
    input: PreviewCollectionPolicyInput,
  ): Promise<CollectionPolicyPreviewDto>;
  updateCollectionPolicy(
    access: AccessContext,
    input: UpdateCollectionPolicyInput,
  ): Promise<CommandResult<CollectionAcknowledgement>>;
  putValidationPolicy(
    access: AccessContext,
    input: PutValidationPolicyInput,
  ): Promise<CommandResult<ValidationPolicyAcknowledgement>>;
  putGovernanceConfiguration(
    access: AccessContext,
    input: PutGovernanceConfigurationInput,
  ): Promise<CommandResult<CollectionAcknowledgement>>;
  createDraft(
    access: AccessContext,
    input: CreateDraftInput,
  ): Promise<CommandResult<ArticleAcknowledgement>>;
  updateDraft(
    access: AccessContext,
    input: UpdateDraftInput,
  ): Promise<CommandResult<ArticleAcknowledgement>>;
  submitEvidence(
    access: AccessContext,
    input: SubmitEvidenceInput,
  ): Promise<CommandResult<ArticleAcknowledgement>>;
  submitForReview(
    access: AccessContext,
    input: ArticleCommandInput,
  ): Promise<CommandResult<ArticleAcknowledgement>>;
  publishArticle(
    access: AccessContext,
    input: PublishArticleInput,
  ): Promise<CommandResult<ArticleAcknowledgement>>;
  rejectReview(
    access: AccessContext,
    input: RejectReviewInput,
  ): Promise<CommandResult<ArticleAcknowledgement>>;
  retireArticle(
    access: AccessContext,
    input: ArticleCommandInput,
  ): Promise<CommandResult<ArticleAcknowledgement>>;
  setProvenance(
    access: AccessContext,
    input: SetProvenanceInput,
  ): Promise<CommandResult<ArticleAcknowledgement>>;
  revokeEvidence(
    access: AccessContext,
    input: RevokeEvidenceInput,
  ): Promise<CommandResult<ArticleAcknowledgement>>;
  getCollection(
    access: AccessContext,
    input: CollectionReadInput,
  ): Promise<CollectionDto>;
  getValidationPolicy(
    access: AccessContext,
    input: ValidationPolicyReadInput,
  ): Promise<ValidationPolicyDto>;
  getGovernanceConfiguration(
    access: AccessContext,
    input: CollectionReadInput,
  ): Promise<GovernanceConfigurationDto>;
  getValidationRequirements(
    access: AccessContext,
    input: ValidationRequirementsReadInput,
  ): Promise<ValidationRequirementsDto>;
  getDraft(
    access: AccessContext,
    input: ArticleReadInput,
  ): Promise<DraftArticleDto>;
  getEvidence(
    access: AccessContext,
    input: ArticleReadInput,
  ): Promise<EvidenceDto>;
  getProvenance(
    access: AccessContext,
    input: ArticleReadInput,
  ): Promise<ProvenanceDto>;
  getReview(access: AccessContext, input: ArticleReadInput): Promise<ReviewDto>;
  getPublishedArticle(
    access: AccessContext,
    input: ArticleReadInput,
  ): Promise<PublishedArticleDto>;
}
