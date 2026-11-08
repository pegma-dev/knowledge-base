import { hasPermission, type AccessContext } from "@pegma/authorization-core";
import {
  createKnowledgeBaseApplication,
  createKnowledgeEvidenceReports,
  type DecideKnowledgeReportInput,
  type EvidenceVerificationRequest,
  type GovernanceConfiguration,
  type KnowledgeBaseApplication,
  type KnowledgeEvidenceContext,
  type KnowledgeEvidenceReports,
  type KnowledgeEvidenceReportsOptions,
  type KnowledgeReportAcknowledgement,
  type KnowledgeReportKey,
  type KnowledgeReportStatus,
  type SubmitKnowledgeReportInput,
} from "@pegma/knowledge-base-application";
import {
  knowledgePermissions,
  type PrincipalId,
} from "@pegma/knowledge-base-contracts";
import type { EvidenceSubmission } from "@pegma/knowledge-base-core";
import {
  createMemoryStore,
  defineCollection,
  type CollectionDefinition,
  type EntityKey,
  type ScanRecord,
  type Store,
  type StoredRecord,
} from "@pegma/storage-core";
import { vi } from "vitest";
import {
  access,
  admin,
  applicationFixture,
  at,
  author,
  customer,
  draft,
  evidence,
} from "./application-fixtures.js";
import { barrier, traceStore } from "./trace-store.js";

export const reportNamespace = "workshop.knowledge-reports.v1";
export const confirmationPermission = "workshop.knowledge.report.confirm";
const humanPermissions = [
  ...Object.values(knowledgePermissions),
  confirmationPermission,
  "workshop.customer",
];

/** Synthetic effective contexts; no identity, role, or credential implementation. */
export const reportAgent = access(author.principalId, [
  knowledgePermissions.draftRead,
  knowledgePermissions.draftWrite,
  knowledgePermissions.evidenceSubmit,
]);
export const reportOwner = access(author.principalId, humanPermissions);
export const reportReviewer = access("staff/verifier", humanPermissions);
export const otherReportAgent = access("runner/other", reportAgent.permissions);

export interface ReportLedgerRow {
  readonly articleId: string;
  readonly id: string;
  readonly payload: string;
}

/** Read flat backend data without interpreting the component-owned codec. */
function rawReportRowsDefinition(
  name = reportNamespace,
  physicalKey?: EntityKey,
) {
  return defineCollection<StoredRecord>({
    name,
    key: () => {
      if (physicalKey === undefined)
        throw new Error("Test fault writes require an observed physical key");
      return physicalKey;
    },
    codec: {
      encode: (value) => ({ ...value }),
      decode: (value) => ({ ...value }),
    },
  });
}

function logicalReportRow(value: unknown): ReportLedgerRow {
  if (
    typeof value !== "object" ||
    value === null ||
    !("articleId" in value) ||
    !("id" in value) ||
    !("payload" in value) ||
    typeof value.articleId !== "string" ||
    typeof value.id !== "string" ||
    typeof value.payload !== "string"
  )
    throw new TypeError("Factory codec returned an invalid ledger envelope");
  return { articleId: value.articleId, id: value.id, payload: value.payload };
}

export function reportBarrier() {
  const gate = barrier();
  return {
    wait: gate.wait,
    release: gate.release,
    async reached(pending: Promise<unknown>) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          gate.reached,
          pending.then(() => {
            throw new Error("Operation ended before test barrier");
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Test barrier timed out")),
              10_000,
            );
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  };
}

export async function evidenceReportsFixture(
  backing: Store,
  options: {
    readonly collectionName?: string;
    readonly articleId?: string;
    readonly storageLayout?: KnowledgeEvidenceReportsOptions["storageLayout"];
    readonly commandPrefix?: string;
  } = {},
) {
  const namespace = options.collectionName ?? reportNamespace;
  const articleId = options.articleId ?? "article/export";
  const collectionId = "collection/workshop";
  const observed = traceStore(backing);
  let reportDefinition: CollectionDefinition<unknown> | undefined;
  const reportStore: Store = {
    collection<T>(definition: CollectionDefinition<T>) {
      // Retain the original factory's codec even when a later test probes a
      // different layout in this same namespace. All storage still delegates.
      if (definition.name === namespace && reportDefinition === undefined)
        reportDefinition = definition;
      return observed.store.collection(definition);
    },
  };
  const base = applicationFixture(observed.store, {
    missingEvidenceVerifier: true,
  });
  let offset = 0;
  const clock = { now: () => at(offset) };
  const principals = new Map<PrincipalId, AccessContext>([
    [reportOwner.principalId, structuredClone(reportOwner)],
    [reportReviewer.principalId, structuredClone(reportReviewer)],
    [otherReportAgent.principalId, structuredClone(otherReportAgent)],
  ]);
  const hooks: {
    afterContext?: (access: AccessContext, id: string) => Promise<void>;
    beforeResolve?: (id: PrincipalId) => Promise<void>;
  } = {};
  const logger = { log: vi.fn() };
  const resolvePrincipal = vi.fn(async (id: PrincipalId) => {
    await hooks.beforeResolve?.(id);
    const current = principals.get(id);
    return current === undefined ? null : structuredClone(current);
  });
  const readContext = vi.fn(
    async (
      caller: AccessContext,
      id: string,
    ): Promise<KnowledgeEvidenceContext> => {
      const current = await app.getDraft(caller, { articleId: id });
      const [requirements, accepted] = await Promise.all([
        app.getValidationRequirements(caller, {
          collectionId: current.revision.collectionId,
          kind: current.revision.kind,
        }),
        hasPermission(caller, knowledgePermissions.evidenceRead)
          ? app.getEvidence(caller, { articleId: id })
          : Promise.resolve(undefined),
      ]);
      const latest = await app.getDraft(caller, { articleId: id });
      if (latest.generation !== current.generation)
        throw new Error("Synthetic context changed during its public reads");
      await hooks.afterContext?.(caller, id);
      return {
        draft: latest,
        requirements,
        ...(accepted === undefined ? {} : { evidence: accepted }),
      };
    },
  );
  const baseOptions: KnowledgeEvidenceReportsOptions = {
    store: reportStore,
    clock,
    collectionName: namespace,
    confirmationPermission,
    ...(options.storageLayout === undefined
      ? {}
      : { storageLayout: options.storageLayout }),
    resolvePrincipal,
    readContext,
    logger,
  };
  const reports: KnowledgeEvidenceReports =
    createKnowledgeEvidenceReports(baseOptions);
  const app: KnowledgeBaseApplication = createKnowledgeBaseApplication({
    store: observed.store,
    clock,
    evidenceVerifier: reports.verifier,
  });
  const setTime = (milliseconds: number) => {
    offset = milliseconds;
    base.setTime(milliseconds);
  };
  const command: typeof base.command = (prefix, expectedGeneration) =>
    base.command((options.commandPrefix ?? "") + prefix, expectedGeneration);
  await base.setupCollection(collectionId);
  await base.createDraft(articleId, collectionId, draft("walkthrough"));
  setTime(3_000);

  const current = () => app.getDraft(reportAgent, { articleId });
  async function submission(checkId = "walkthrough-content") {
    return evidence((await current()).revision, checkId);
  }
  function key(ack: KnowledgeReportAcknowledgement): KnowledgeReportKey {
    return { articleId, ledgerEpoch: ack.ledgerEpoch, reportId: ack.reportId };
  }
  async function reportInput(
    proof?: EvidenceSubmission,
  ): Promise<SubmitKnowledgeReportInput> {
    return {
      commandId: command("report", 0).commandId,
      articleId,
      ledgerEpoch: (await reports.ledger(reportAgent, { articleId }))
        .ledgerEpoch,
      evidence: proof ?? (await submission()),
      report: {
        summary: "Synthetic workspace export check",
        details: "Reviewed staging output. PRIVATE_REPORT_BODY_CANARY",
      },
    };
  }
  async function report(proof?: EvidenceSubmission, caller = reportAgent) {
    const input = await reportInput(proof);
    return { input, ack: await reports.report(caller, input) };
  }
  async function decisionInput(
    ack: KnowledgeReportAcknowledgement,
    caller = reportReviewer,
    status: KnowledgeReportStatus = "confirmed",
  ) {
    const view = await reports.read(caller, key(ack));
    const input: DecideKnowledgeReportInput = {
      ...key(ack),
      commandId: command("report-" + status, 0).commandId,
      expectedReportGeneration: view.expectedReportGeneration,
      reviewBindingHash: view.reviewBindingHash,
    };
    return { view, input };
  }
  async function decide(
    ack: KnowledgeReportAcknowledgement,
    status: KnowledgeReportStatus = "confirmed",
    caller = reportReviewer,
  ) {
    const { view, input } = await decisionInput(ack, caller, status);
    return { view, input, ack: await reports.decide(caller, input, status) };
  }
  async function submit(
    ack: KnowledgeReportAcknowledgement,
    proof: EvidenceSubmission,
    caller = reportAgent,
  ) {
    const value = await app.getDraft(caller, { articleId });
    const input = {
      ...command("accept-report", value.generation),
      articleId,
      evidence: proof,
      receipt: ack.receipt,
    };
    return { input, result: await app.submitEvidence(caller, input) };
  }
  async function verificationRequest(
    ack: KnowledgeReportAcknowledgement,
    proof: EvidenceSubmission,
  ): Promise<EvidenceVerificationRequest> {
    const [value, configuration] = await Promise.all([
      current(),
      app.getGovernanceConfiguration(admin, { collectionId }),
    ]);
    return {
      access: reportAgent,
      article: value.revision,
      configuration: configuration.configuration,
      submission: proof,
      receipt: ack.receipt,
    };
  }
  async function completeChecks() {
    const value = await current();
    const requirements = await app.getValidationRequirements(reportAgent, {
      collectionId,
      kind: value.revision.kind,
    });
    const accepted = [];
    for (const check of requirements.checks) {
      const packet = await report(await submission(check.id));
      const confirmed = await decide(packet.ack);
      const submitted = await submit(confirmed.ack, packet.input.evidence);
      accepted.push({ ...packet, confirmed, submitted });
    }
    return accepted;
  }
  async function publish() {
    const value = await current();
    await app.submitForReview(reportReviewer, {
      ...command("review-reports", value.generation),
      articleId,
    });
    const reviewed = await app.getReview(reportReviewer, { articleId });
    const input = {
      ...command("publish-reports", reviewed.generation),
      articleId,
      review: reviewed.review,
    };
    return { input, result: await app.publishArticle(reportReviewer, input) };
  }
  async function updateDraft() {
    const value = await current();
    await app.updateDraft(reportAgent, {
      ...command("edit-report-target", value.generation),
      articleId,
      collectionId,
      draft: draft(
        "walkthrough",
        "Choose Export, then save the updated download.",
      ),
    });
    return current();
  }
  async function configure(patch: Partial<GovernanceConfiguration>) {
    const value = await app.getGovernanceConfiguration(admin, { collectionId });
    return app.putGovernanceConfiguration(admin, {
      ...command("change-report-governance", value.generation),
      collectionId,
      configuration: { ...value.configuration, ...patch },
    });
  }
  function factoryDefinition(): CollectionDefinition<unknown> {
    if (reportDefinition === undefined)
      throw new Error("Report factory did not declare its collection");
    return reportDefinition;
  }
  async function rawRows(): Promise<ScanRecord<StoredRecord>[]> {
    const collection = backing.collection(rawReportRowsDefinition(namespace));
    const found: ScanRecord<StoredRecord>[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const scanned = await collection.scan({
        limit: 160,
        ...(cursor === undefined ? {} : { cursor }),
      });
      found.push(...scanned.records);
      if (scanned.nextCursor === null)
        return found
          .filter((item) => item.value.articleId === articleId)
          .sort(
            (left, right) =>
              left.key.partition.localeCompare(right.key.partition) ||
              left.key.id.localeCompare(right.key.id),
          );
      cursor = scanned.nextCursor;
    }
    throw new Error(
      "Synthetic report inspection exceeded its physical scan bound",
    );
  }
  async function physicalRows(): Promise<ScanRecord<ReportLedgerRow>[]> {
    const definition = factoryDefinition();
    return (await rawRows()).map((item) => ({
      ...item,
      value: logicalReportRow(definition.codec.decode(item.value)),
    }));
  }
  async function installCapturedRows(rows: readonly ReportLedgerRow[]) {
    if (
      rows.length === 0 ||
      rows.length > 160 ||
      (await rawRows()).length !== 0
    )
      throw new Error("Captured rows require an empty bounded target");
    const definition = factoryDefinition();
    const partition = definition.key(rows[0]!).partition;
    if (
      rows.some(
        (row) =>
          row.articleId !== articleId ||
          definition.key(row).partition !== partition,
      )
    )
      throw new Error("Prepared history must retain its one article partition");
    const target = reportStore.collection(definition);
    for (let offset = 0; offset < rows.length; offset += 100) {
      const result = await target.transact(
        partition,
        rows.slice(offset, offset + 100).map((value) => ({
          action: "insert" as const,
          value,
        })),
      );
      if (!result.committed)
        throw new Error("Prepared history insertion did not commit");
    }
  }
  async function installPreparedHistory(rows: readonly ReportLedgerRow[]) {
    if (rows.length !== 160)
      throw new Error("Prepared history requires exactly 160 rows");
    await installCapturedRows(rows);
  }
  return {
    app,
    reports,
    backing,
    observed,
    baseOptions,
    clock,
    logger,
    hooks,
    resolvePrincipal,
    readContext,
    principals,
    articleId,
    collectionId,
    namespace,
    agent: reportAgent,
    owner: reportOwner,
    reviewer: reportReviewer,
    otherAgent: otherReportAgent,
    customer,
    command,
    key,
    current,
    submission,
    reportInput,
    report,
    decisionInput,
    decide,
    submit,
    verificationRequest,
    completeChecks,
    publish,
    updateDraft,
    configure,
    setTime,
    advance: (milliseconds: number) => setTime(offset + milliseconds),
    rawRows,
    physicalRows,
    installCapturedRows,
    installPreparedHistory,
    insertOpaqueRow: (value: ReportLedgerRow) => {
      if (value.articleId !== articleId || value.id === "head")
        throw new Error("Opaque fixture rows cannot create or cross a head");
      return reportStore.collection(factoryDefinition()).insertIfAbsent(value);
    },
    rows: async () =>
      (await physicalRows())
        .map((item) => item.value)
        .sort((left, right) => left.id.localeCompare(right.id)),
    replaceRow: (saved: ScanRecord<ReportLedgerRow>, value: ReportLedgerRow) =>
      backing
        .collection({ ...factoryDefinition(), key: () => saved.key })
        .putIfUnchanged(value, saved.version),
    replaceRaw: (saved: ScanRecord<StoredRecord>, value: StoredRecord) =>
      backing
        .collection(rawReportRowsDefinition(namespace, saved.key))
        .putIfUnchanged(value, saved.version),
    freshReports: (overrides: Partial<KnowledgeEvidenceReportsOptions> = {}) =>
      createKnowledgeEvidenceReports({ ...baseOptions, ...overrides }),
  };
}

/**
 * Prepare the expensive history through real public operations on MemoryStore,
 * then install its exact logical rows using the target factory's actual codec.
 * This prepares a capacity fixture; it is not a migration or target history-write
 * proof. All capacity refusals, reset, drains and new admission run on the target.
 */
export async function evidenceReportsHistoryFixture(backing: Store) {
  const donor = await evidenceReportsFixture(createMemoryStore(), {
    commandPrefix: "prepared-history-",
  });
  const proof = await donor.submission();
  const packets = [];
  for (let count = 0; count < 15; count++)
    packets.push(await donor.report(proof));
  let ack = packets[0]!.ack;
  for (let count = 0; count < 57; count++)
    ack = (await donor.decide(ack, count % 2 === 0 ? "confirmed" : "pending"))
      .ack;
  const rows = await donor.rows();
  const target = await evidenceReportsFixture(backing);
  await target.installPreparedHistory(rows);
  return { ...target, preparedHistory: { ack, proof, rows } };
}
