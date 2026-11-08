import type { AccessContext } from "@pegma/authorization-core";
import type {
  DecideKnowledgeReportInput,
  KnowledgeEvidenceContext,
  KnowledgeReportAcknowledgement,
  SubmitKnowledgeReportInput,
} from "@pegma/knowledge-base-application";
import type { ReportLedgerRow } from "./evidence-reports-fixtures.js";

/**
 * Actual synthetic public-factory capture from pre-guard source 58aefc2.
 * Commands, acknowledgements and logical row payloads are retained unchanged.
 * Core refused this evidence; this is not published-producer, accepted-KB-proof,
 * target history-writing, or migration evidence. No current factory re-creates
 * the retained hashes or confirms malformed submissions for this fixture.
 */
export const retainedWhitespaceReport = {
  sourceCommit: "58aefc21770b6af976bce5cb15f32f8c10fc4dfc",
  captureSha256:
    "6a362198cfc836beb1400570cfa930b45d989df6077440186f25d1f59ba288df",
  capturedAt: "2026-11-08T22:13:22.659Z",
  sources: [
    {
      path: "packages/application/src/evidence-reports.ts",
      bytes: 55744,
      sha256:
        "fbddfaa9ae9c5b94727add385885794e2a04743a96fdb925a3121e9eee9e0477",
    },
    {
      path: "packages/application/src/evidence-reports-types.ts",
      bytes: 6150,
      sha256:
        "2c24b51bcb7b2505282b81ac52ab9235f951569a6a74f0daa3c9b50abdc1284a",
    },
    {
      path: "packages/application/src/evidence-reports-errors.ts",
      bytes: 1640,
      sha256:
        "1bcaab74f3dfaa510d811615487ce71e93efdaba2451b377c4463adf8760a726",
    },
    {
      path: "packages/core/src/articles.ts",
      bytes: 19340,
      sha256:
        "03ce81d34d64be26bd91cd9745ca2de86a6212f0a459afc066e4aa6d7e673217",
    },
    {
      path: "packages/core/src/validation.ts",
      bytes: 11021,
      sha256:
        "6f3f76adba3a58c0421e81c6baa4118c5692e8916d994f84781066412400ee30",
    },
    {
      path: "test/evidence-reports-fixtures.ts",
      bytes: 16959,
      sha256:
        "b95eb9e0ad1e0720e6e68d0de44ddbd5adc0d4675d696991454fa8ce6abe09bb",
    },
  ],
  articleId: "article/export",
  collectionId: "collection/workshop",
  namespace: "workshop.knowledge-reports.v1",
  clock: "2026-11-06T20:00:03.000Z",
  agent: {
    principalId: "runner/staging",
    policyVersion: "synthetic-1",
    roles: [],
    entitlements: [],
    permissions: [
      "knowledge.article.draft.read",
      "knowledge.article.draft.write",
      "knowledge.article.evidence.submit",
    ],
  },
  reviewer: {
    principalId: "staff/verifier",
    policyVersion: "synthetic-1",
    roles: [],
    entitlements: [],
    permissions: [
      "knowledge.collection.read",
      "knowledge.collection.manage",
      "knowledge.collection.approve-public",
      "knowledge.article.read",
      "knowledge.article.bot.read",
      "knowledge.index.manage",
      "knowledge.article.draft.read",
      "knowledge.article.draft.write",
      "knowledge.article.evidence.read",
      "knowledge.article.evidence.submit",
      "knowledge.article.evidence.revoke",
      "knowledge.article.provenance.read",
      "knowledge.article.provenance.write",
      "knowledge.article.review.submit",
      "knowledge.article.review",
      "knowledge.article.publish",
      "knowledge.article.retire",
      "knowledge.validation.manage",
      "workshop.knowledge.report.confirm",
      "workshop.customer",
    ],
  },
  context: {
    draft: {
      articleId: "article/export",
      generation: 1,
      hasPendingReview: false,
      hasPublication: false,
      publicationHeld: false,
      revision: {
        applicability: {
          buildId: "staging-42",
          locale: "en-US",
          productId: "fictional-workshop",
          productVersion: "1.0",
        },
        articleId: "article/export",
        collectionId: "collection/workshop",
        content: {
          format: "markdown",
          text: "Choose [Export](/workspace/export). ",
        },
        contentHash:
          "11fff3f38bf9f66d3bf40785d412250dcb6eff495b7ae61e3f1bbaf23366bdc6",
        createdAt: "2026-11-06T20:00:00.000Z",
        createdBy: "runner/staging",
        kind: "walkthrough",
        number: 1,
        summary: "Download a synthetic workspace export.",
        tags: ["export"],
        title: "Export your workspace",
        validationPolicy: {
          id: "policy/workshop",
          version: 1,
        },
      },
      state: "draft",
    },
    requirements: {
      checks: [
        {
          id: "walkthrough-content",
          maxAgeMilliseconds: 60000,
          testKind: "content",
        },
        {
          id: "walkthrough-workflow",
          maxAgeMilliseconds: 60000,
          testKind: "workflow",
        },
      ],
      collectionId: "collection/workshop",
      expectedStagingBuildId: "staging-42",
      governanceGeneration: 3,
      validationPolicy: {
        id: "policy/workshop",
        version: 1,
      },
    },
    evidence: {
      articleId: "article/export",
      evidence: [],
      generation: 1,
      revokedEvidence: [],
    },
  },
  report: {
    input: {
      commandId: "report/6",
      articleId: "article/export",
      ledgerEpoch: 1,
      evidence: {
        id: "evidence/walkthrough-content",
        articleId: "article/export",
        articleRevision: 1,
        contentHash:
          "11fff3f38bf9f66d3bf40785d412250dcb6eff495b7ae61e3f1bbaf23366bdc6",
        validationPolicy: {
          id: "policy/workshop",
          version: 1,
        },
        checkId: "walkthrough-content",
        testKind: "content",
        applicability: {
          buildId: "staging-42",
          locale: "en-US",
          productId: "fictional-workshop",
          productVersion: "1.0",
        },
        stagingBuildId: "staging-42",
        steps: ["  Retained synthetic workspace export step  "],
        result: "passed",
        executedAt: "2026-11-06T20:00:01.000Z",
        runnerId: "runner/staging",
        artifacts: [
          {
            id: "private/artifact/export",
            hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        ],
      },
      report: {
        summary: "Synthetic workspace export check",
        details: "Reviewed staging output. PRIVATE_REPORT_BODY_CANARY",
      },
    },
    ack: {
      ledgerEpoch: 1,
      reportId: "67dba5ab-2d6d-4e10-9a54-2103c4012a15",
      receipt: "e1.1.67dba5ab-2d6d-4e10-9a54-2103c4012a15",
      reportGeneration: 1,
    },
  },
  confirmation: {
    input: {
      articleId: "article/export",
      ledgerEpoch: 1,
      reportId: "67dba5ab-2d6d-4e10-9a54-2103c4012a15",
      commandId: "report-confirmed/7",
      expectedReportGeneration: 1,
      reviewBindingHash:
        "5b013bc7e40cfb274afc152294a47741cfbc6b57070863d9f7e391e224a51dbb",
    },
    ack: {
      ledgerEpoch: 1,
      reportId: "67dba5ab-2d6d-4e10-9a54-2103c4012a15",
      receipt: "e1.1.67dba5ab-2d6d-4e10-9a54-2103c4012a15",
      reportGeneration: 2,
    },
  },
  pendingRows: [
    {
      articleId: "article/export",
      id: "audit:command:1:f894407af154f1e207068b414cbdd943707b667b521c81ab7141ca18711e6395",
      payload:
        '{"action":"knowledge.report.pending","actor":{"kind":"principal","principalId":"runner/staging"},"details":{"generation":1,"ledgerEpoch":1,"receiptGeneration":1,"reportHash":"8e555b4e254a8a4dc4d75dcee4927cf81762d2d805ef6a393642c432f54f461c","reportId":"67dba5ab-2d6d-4e10-9a54-2103c4012a15"},"id":"command:1:f894407af154f1e207068b414cbdd943707b667b521c81ab7141ca18711e6395","occurredAt":"2026-11-06T20:00:03.000Z","subject":"article/export"}',
    },
    {
      articleId: "article/export",
      id: "command:1:f894407af154f1e207068b414cbdd943707b667b521c81ab7141ca18711e6395",
      payload:
        '{"fingerprint":"c5f1cf4251a0ef8b751bf90be3b5c36bfd13d864cbdc530f9503e8af2d5d2e4a","result":{"ledgerEpoch":1,"receipt":"e1.1.67dba5ab-2d6d-4e10-9a54-2103c4012a15","reportGeneration":1,"reportId":"67dba5ab-2d6d-4e10-9a54-2103c4012a15"}}',
    },
    {
      articleId: "article/export",
      id: "head",
      payload:
        '{"drainRemaining":0,"historyHash":"0000000000000000000000000000000000000000000000000000000000000000","lastReset":null,"ledgerEpoch":1,"reports":1,"rows":4,"status":"active"}',
    },
    {
      articleId: "article/export",
      id: "report:1:67dba5ab-2d6d-4e10-9a54-2103c4012a15",
      payload:
        '{"articleHash":"9eb8fe1bf46de2abda3a94693cc3535c65fbc49efc5996951f972459fb8265a7","articleId":"article/export","confirmation":null,"evidence":{"applicability":{"buildId":"staging-42","locale":"en-US","productId":"fictional-workshop","productVersion":"1.0"},"articleId":"article/export","articleRevision":1,"artifacts":[{"hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","id":"private/artifact/export"}],"checkId":"walkthrough-content","contentHash":"11fff3f38bf9f66d3bf40785d412250dcb6eff495b7ae61e3f1bbaf23366bdc6","executedAt":"2026-11-06T20:00:01.000Z","id":"evidence/walkthrough-content","result":"passed","runnerId":"runner/staging","stagingBuildId":"staging-42","steps":["  Retained synthetic workspace export step  "],"testKind":"content","validationPolicy":{"id":"policy/workshop","version":1}},"governanceHash":"b28c799e61de634ac7a37533da9cb5a90f069e5710e84cb5d6b11eb947c35c0b","ledgerEpoch":1,"receiptGeneration":1,"report":{"details":"Reviewed staging output. PRIVATE_REPORT_BODY_CANARY","summary":"Synthetic workspace export check"},"reportGeneration":1,"reportHash":"8e555b4e254a8a4dc4d75dcee4927cf81762d2d805ef6a393642c432f54f461c","reportId":"67dba5ab-2d6d-4e10-9a54-2103c4012a15","status":"pending","submissionHash":"81d6f111e8d91cdefaedeeb546dde036308140f0d2459e3c0f1074d97bf0a5d1","submittedAt":"2026-11-06T20:00:03.000Z","submittedBy":"runner/staging"}',
    },
  ],
  confirmedRows: [
    {
      articleId: "article/export",
      id: "audit:command:1:dd215bda968707d391c82623f71a2771ede659cd1626f19c43c0f3e0ea40e32e",
      payload:
        '{"action":"knowledge.report.confirmed","actor":{"kind":"principal","principalId":"staff/verifier"},"details":{"generation":2,"ledgerEpoch":1,"receiptGeneration":1,"reportHash":"8e555b4e254a8a4dc4d75dcee4927cf81762d2d805ef6a393642c432f54f461c","reportId":"67dba5ab-2d6d-4e10-9a54-2103c4012a15"},"id":"command:1:dd215bda968707d391c82623f71a2771ede659cd1626f19c43c0f3e0ea40e32e","occurredAt":"2026-11-06T20:00:03.000Z","subject":"article/export"}',
    },
    {
      articleId: "article/export",
      id: "audit:command:1:f894407af154f1e207068b414cbdd943707b667b521c81ab7141ca18711e6395",
      payload:
        '{"action":"knowledge.report.pending","actor":{"kind":"principal","principalId":"runner/staging"},"details":{"generation":1,"ledgerEpoch":1,"receiptGeneration":1,"reportHash":"8e555b4e254a8a4dc4d75dcee4927cf81762d2d805ef6a393642c432f54f461c","reportId":"67dba5ab-2d6d-4e10-9a54-2103c4012a15"},"id":"command:1:f894407af154f1e207068b414cbdd943707b667b521c81ab7141ca18711e6395","occurredAt":"2026-11-06T20:00:03.000Z","subject":"article/export"}',
    },
    {
      articleId: "article/export",
      id: "command:1:dd215bda968707d391c82623f71a2771ede659cd1626f19c43c0f3e0ea40e32e",
      payload:
        '{"fingerprint":"3e1b825ad54a52900147c69db8abe5e9bc73a8b5f166a41838aa21c5a028c038","result":{"ledgerEpoch":1,"receipt":"e1.1.67dba5ab-2d6d-4e10-9a54-2103c4012a15","reportGeneration":2,"reportId":"67dba5ab-2d6d-4e10-9a54-2103c4012a15"}}',
    },
    {
      articleId: "article/export",
      id: "command:1:f894407af154f1e207068b414cbdd943707b667b521c81ab7141ca18711e6395",
      payload:
        '{"fingerprint":"c5f1cf4251a0ef8b751bf90be3b5c36bfd13d864cbdc530f9503e8af2d5d2e4a","result":{"ledgerEpoch":1,"receipt":"e1.1.67dba5ab-2d6d-4e10-9a54-2103c4012a15","reportGeneration":1,"reportId":"67dba5ab-2d6d-4e10-9a54-2103c4012a15"}}',
    },
    {
      articleId: "article/export",
      id: "head",
      payload:
        '{"drainRemaining":0,"historyHash":"0000000000000000000000000000000000000000000000000000000000000000","lastReset":null,"ledgerEpoch":1,"reports":1,"rows":6,"status":"active"}',
    },
    {
      articleId: "article/export",
      id: "report:1:67dba5ab-2d6d-4e10-9a54-2103c4012a15",
      payload:
        '{"articleHash":"9eb8fe1bf46de2abda3a94693cc3535c65fbc49efc5996951f972459fb8265a7","articleId":"article/export","confirmation":{"confirmedAt":"2026-11-06T20:00:03.000Z","reviewerId":"staff/verifier"},"evidence":{"applicability":{"buildId":"staging-42","locale":"en-US","productId":"fictional-workshop","productVersion":"1.0"},"articleId":"article/export","articleRevision":1,"artifacts":[{"hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","id":"private/artifact/export"}],"checkId":"walkthrough-content","contentHash":"11fff3f38bf9f66d3bf40785d412250dcb6eff495b7ae61e3f1bbaf23366bdc6","executedAt":"2026-11-06T20:00:01.000Z","id":"evidence/walkthrough-content","result":"passed","runnerId":"runner/staging","stagingBuildId":"staging-42","steps":["  Retained synthetic workspace export step  "],"testKind":"content","validationPolicy":{"id":"policy/workshop","version":1}},"governanceHash":"b28c799e61de634ac7a37533da9cb5a90f069e5710e84cb5d6b11eb947c35c0b","ledgerEpoch":1,"receiptGeneration":1,"report":{"details":"Reviewed staging output. PRIVATE_REPORT_BODY_CANARY","summary":"Synthetic workspace export check"},"reportGeneration":2,"reportHash":"8e555b4e254a8a4dc4d75dcee4927cf81762d2d805ef6a393642c432f54f461c","reportId":"67dba5ab-2d6d-4e10-9a54-2103c4012a15","status":"confirmed","submissionHash":"81d6f111e8d91cdefaedeeb546dde036308140f0d2459e3c0f1074d97bf0a5d1","submittedAt":"2026-11-06T20:00:03.000Z","submittedBy":"runner/staging"}',
    },
  ],
  preGuardAttestation: {
    id: "e1.1.67dba5ab-2d6d-4e10-9a54-2103c4012a15",
    verifiedBy: "staff/verifier",
    verifiedAt: "2026-11-06T20:00:03.000Z",
  },
} satisfies {
  readonly sourceCommit: string;
  readonly captureSha256: string;
  readonly capturedAt: string;
  readonly sources: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
  readonly articleId: string;
  readonly collectionId: string;
  readonly namespace: string;
  readonly clock: string;
  readonly agent: AccessContext;
  readonly reviewer: AccessContext;
  readonly context: KnowledgeEvidenceContext;
  readonly report: {
    readonly input: SubmitKnowledgeReportInput;
    readonly ack: KnowledgeReportAcknowledgement;
  };
  readonly confirmation: {
    readonly input: DecideKnowledgeReportInput;
    readonly ack: KnowledgeReportAcknowledgement;
  };
  readonly pendingRows: readonly ReportLedgerRow[];
  readonly confirmedRows: readonly ReportLedgerRow[];
  readonly preGuardAttestation: {
    readonly id: string;
    readonly verifiedBy: string;
    readonly verifiedAt: string;
  };
};
