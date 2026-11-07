import type { IsoTimestamp, PrincipalId } from "@pegma/spine";

export type { Clock, IsoTimestamp, Logger, PrincipalId } from "@pegma/spine";

export type CollectionId = string;
export type ArticleId = string;
export type EvidenceId = string;
export type ValidationPolicyId = string;

/** These are permission names, never role names or an authorization engine. */
export const knowledgePermissions = {
  collectionRead: "knowledge.collection.read",
  collectionManage: "knowledge.collection.manage",
  publicCollectionApprove: "knowledge.collection.approve-public",
  articleRead: "knowledge.article.read",
  draftRead: "knowledge.article.draft.read",
  draftWrite: "knowledge.article.draft.write",
  evidenceRead: "knowledge.article.evidence.read",
  evidenceSubmit: "knowledge.article.evidence.submit",
  evidenceRevoke: "knowledge.article.evidence.revoke",
  provenanceRead: "knowledge.article.provenance.read",
  provenanceWrite: "knowledge.article.provenance.write",
  reviewSubmit: "knowledge.article.review.submit",
  review: "knowledge.article.review",
  publish: "knowledge.article.publish",
  retire: "knowledge.article.retire",
  validationManage: "knowledge.validation.manage",
} as const;

export type KnowledgePermission =
  (typeof knowledgePermissions)[keyof typeof knowledgePermissions];

export const articleKinds = [
  "explanation",
  "walkthrough",
  "troubleshooting",
  "developer-reference",
] as const;
export type ArticleKind = (typeof articleKinds)[number];

/** The host resolves named permissions and authenticates every protected use. */
export type KnowledgeAudience =
  | { readonly kind: "permission"; readonly permission: string }
  | { readonly kind: "anonymous" };

export type CollectionUse =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly audience: KnowledgeAudience };

export interface CollectionPolicy {
  readonly version: number;
  readonly portal: CollectionUse;
  readonly bot: CollectionUse;
}

export interface PublicCollectionApproval {
  readonly collectionId: CollectionId;
  readonly policyVersion: number;
  readonly policyHash: string;
  readonly reviewerId: PrincipalId;
  readonly reviewedAt: IsoTimestamp;
}

export interface Collection {
  readonly id: CollectionId;
  readonly revision: number;
  readonly name: string;
  readonly policy: CollectionPolicy;
  readonly publicApproval?: PublicCollectionApproval;
  readonly createdBy: PrincipalId;
  readonly createdAt: IsoTimestamp;
  readonly updatedBy: PrincipalId;
  readonly updatedAt: IsoTimestamp;
}

export interface Applicability {
  readonly productId: string;
  readonly productVersion: string;
  readonly buildId?: string;
  readonly locale?: string;
}

export interface ArticleContent {
  readonly format: "markdown" | "plain_text";
  readonly text: string;
}

export interface ValidationPolicyReference {
  readonly id: ValidationPolicyId;
  readonly version: number;
}

/** Content is immutable. Editing creates a new numbered revision. */
export interface ArticleRevision {
  readonly articleId: ArticleId;
  readonly number: number;
  readonly collectionId: CollectionId;
  readonly kind: ArticleKind;
  readonly title: string;
  readonly summary: string;
  readonly content: ArticleContent;
  readonly tags: readonly string[];
  readonly applicability: Applicability;
  readonly validationPolicy: ValidationPolicyReference;
  /** Lowercase hexadecimal SHA-256, computed by core, not supplied as proof. */
  readonly contentHash: string;
  readonly createdBy: PrincipalId;
  readonly createdAt: IsoTimestamp;
}

export interface ValidationRequirement {
  readonly id: string;
  readonly kind: ArticleKind;
  readonly testKind: string;
  readonly maxAgeMilliseconds: number;
  /** Identity authentication and attestation verification belong to KB-02/host. */
  readonly trustedRunnerIds: readonly PrincipalId[];
}

export interface ValidationPolicy {
  readonly id: ValidationPolicyId;
  readonly version: number;
  readonly requirements: readonly ValidationRequirement[];
}

/** Opaque protected artifact identity; core never fetches URLs or executes it. */
export interface EvidenceArtifactReference {
  readonly id: string;
  readonly hash: string;
}

/** Private verification material, excluded from later customer/bot DTOs. */
export interface VerificationEvidence {
  readonly id: EvidenceId;
  readonly version: number;
  readonly articleId: ArticleId;
  readonly articleRevision: number;
  readonly contentHash: string;
  readonly validationPolicy: ValidationPolicyReference;
  readonly checkId: string;
  readonly testKind: string;
  readonly applicability: Applicability;
  readonly stagingBuildId: string;
  readonly steps: readonly string[];
  readonly result: "passed" | "failed" | "inconclusive";
  readonly executedAt: IsoTimestamp;
  readonly runnerId: PrincipalId;
  readonly artifacts: readonly EvidenceArtifactReference[];
  /** A trusted boundary must authenticate the runner and verify this receipt. */
  readonly attestation: {
    readonly id: string;
    readonly verifiedBy: PrincipalId;
    readonly verifiedAt: IsoTimestamp;
  };
  /** Lowercase hexadecimal SHA-256 over the evidence fields excluding hash. */
  readonly hash: string;
}

export interface EvidenceBinding {
  readonly id: EvidenceId;
  readonly version: number;
  readonly hash: string;
}

/** Exact review snapshot. Changes to any binding require a fresh review. */
export interface ApprovalBinding {
  readonly articleId: ArticleId;
  readonly articleRevision: number;
  readonly contentHash: string;
  readonly collectionId: CollectionId;
  readonly collectionPolicyVersion: number;
  readonly collectionPolicyHash: string;
  readonly applicability: Applicability;
  readonly validationPolicy: ValidationPolicyReference;
  readonly validationPolicyHash: string;
  readonly evidence: readonly EvidenceBinding[];
}

export interface ArticleApproval {
  readonly binding: ApprovalBinding;
  readonly reviewerId: PrincipalId;
  readonly reviewedAt: IsoTimestamp;
}

export interface PublishedArticle {
  readonly revision: ArticleRevision;
  readonly approval: ArticleApproval;
}

/**
 * Bounded transition input/output: one current revision and one publication.
 * Durable immutable revision history is owned by later application services.
 */
export interface Article {
  readonly id: ArticleId;
  readonly state: "draft" | "in-review" | "published" | "retired";
  readonly current: ArticleRevision;
  readonly evidence: readonly VerificationEvidence[];
  readonly review?: ApprovalBinding;
  readonly published?: PublishedArticle;
}
