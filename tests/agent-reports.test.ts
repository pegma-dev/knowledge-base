import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  KnowledgeBaseApplication,
  KnowledgeEvidenceReports,
  KnowledgeReportAcknowledgement,
} from "@pegma/knowledge-base-application";
import {
  createKnowledgeAgentDispatcher,
  createKnowledgeAgentHttp,
  createKnowledgeAgentMcp,
  knowledgeAgentScopes,
  knowledgeAgentToolNames,
  type KnowledgeAgentIdentity,
  type KnowledgeAgentLimits,
  type KnowledgeAgentOperation,
  type KnowledgeAgentPendingReport,
  type KnowledgeAgentReportRequirementsResult,
  type KnowledgeAgentReportSubmissionInput,
  type KnowledgeAgentResponse,
} from "@pegma/knowledge-base-mcp";
import { createMemoryStore } from "@pegma/storage-core";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  agentApiUrl,
  agentMetadataUrl,
  agentOrigin,
  agentResource,
} from "../test/agent-fixtures.js";
import { evidenceReportsFixture } from "../test/evidence-reports-fixtures.js";

type Channel = "HTTP" | "MCP";
type Reports = Pick<KnowledgeEvidenceReports, "report" | "ledger" | "status"> &
  Partial<Pick<KnowledgeEvidenceReports, "query">>;

async function fixture(
  options: {
    legacy?: boolean;
    aggregate?: boolean;
    limits?: Partial<KnowledgeAgentLimits>;
    wrapApplication?: (
      application: KnowledgeBaseApplication,
    ) => KnowledgeBaseApplication;
    wrapReports?: (
      reports: Reports,
      f: Awaited<ReturnType<typeof evidenceReportsFixture>>,
    ) => Reports;
  } = {},
) {
  const f = await evidenceReportsFixture(createMemoryStore());
  // Scripted trusted contexts are fictional host inputs, not an OAuth/login or
  // live staging proof. All KB, report persistence and evidence checks are real.
  const authority: { current: KnowledgeAgentIdentity } = {
    current: {
      access: f.agent,
      scopes: Object.values(knowledgeAgentScopes),
      clientId: "synthetic-report-agent",
      resource: agentResource,
    },
  };
  // Keep the original trio explicit so its compatibility/fence cases continue
  // exercising the legacy path even after the actual factory gains query().
  const suppliedReports: Reports = {
    report: f.reports.report,
    ledger: f.reports.ledger,
    status: f.reports.status,
    ...(options.aggregate ? { query: f.reports.query } : {}),
  };
  const dispatcher = createKnowledgeAgentDispatcher({
    application: options.wrapApplication?.(f.app) ?? f.app,
    resource: agentResource,
    ...(options.legacy
      ? {}
      : {
          reports: options.wrapReports?.(suppliedReports, f) ?? suppliedReports,
        }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  const common = {
    dispatcher,
    resource: agentResource,
    protectedResourceMetadataUrl: agentMetadataUrl,
    allowedOrigins: [agentOrigin],
    authenticate: async () => structuredClone(authority.current),
    limit: async () => true,
  };
  const http = createKnowledgeAgentHttp({ ...common, apiUrl: agentApiUrl });
  const mcp = createKnowledgeAgentMcp({ ...common, mcpUrl: agentResource });
  let client: Client | undefined;
  async function sdk() {
    if (client !== undefined) return client;
    const next = new Client({ name: "synthetic-report-client", version: "1" });
    onTestFinished(() => next.close());
    await next.connect(
      new StreamableHTTPClientTransport(new URL(agentResource), {
        requestInit: {
          headers: { Authorization: "Bearer synthetic-credential" },
        },
        fetch: async (input, init) => {
          const response = await mcp.handle(new Request(input, init));
          if (response === null)
            throw new Error("Official MCP request was not routed");
          return response;
        },
      }),
    );
    client = next;
    return next;
  }
  async function call(
    channel: Channel,
    operation: KnowledgeAgentOperation,
    input: unknown,
  ): Promise<KnowledgeAgentResponse> {
    if (channel === "HTTP") {
      const response = await http.handle(
        new Request(agentApiUrl, {
          method: "POST",
          headers: {
            Authorization: "Bearer synthetic-credential",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ apiVersion: "1", operation, input }),
        }),
      );
      if (response === null)
        throw new Error("Actual HTTP request was not routed");
      const result = (await response.json()) as KnowledgeAgentResponse;
      expect(response.status).toBe(
        "error" in result ? result.error.status : 200,
      );
      return result;
    }
    const result = await (
      await sdk()
    ).callTool({
      name: knowledgeAgentToolNames[operation],
      arguments: input as Record<string, unknown>,
    });
    if (!Array.isArray(result.content) || result.content.length !== 1)
      throw new Error("Expected one exact SDK text result");
    const content = result.content[0];
    if (content?.type !== "text" || typeof content.text !== "string")
      throw new Error("Expected complete JSON text");
    const response = JSON.parse(content.text) as KnowledgeAgentResponse;
    expect(result.isError === true).toBe("error" in response);
    return response;
  }
  function requirementsInput(report?: KnowledgeAgentPendingReport) {
    return {
      collectionId: f.collectionId,
      kind: "walkthrough",
      articleId: f.articleId,
      ...(report === undefined
        ? {}
        : {
            reportLookup: {
              ledgerEpoch: report.ledgerEpoch,
              reportId: report.reportId,
            },
          }),
    };
  }
  async function packet(channel: Channel, check = "walkthrough-content") {
    const requirements = success<KnowledgeAgentReportRequirementsResult>(
      await call(channel, "getValidationRequirements", requirementsInput()),
    );
    const current = await f.current();
    const input: KnowledgeAgentReportSubmissionInput = {
      ...f.command("native-report", current.generation),
      articleId: f.articleId,
      evidence: await f.submission(check),
      ledgerEpoch: requirements.reportLedger.ledgerEpoch,
      report: {
        summary: "Synthetic staging execution",
        details:
          "Actual reviewed fixture output. PRIVATE_REPORT_BODY_CANARY\nSecond report line.",
      },
    };
    return {
      input,
      ack: success<KnowledgeAgentPendingReport>(
        await call(channel, "submitEvidence", input),
      ),
    };
  }
  return {
    ...f,
    authority,
    dispatcher,
    http,
    mcp,
    sdk,
    call,
    packet,
    requirementsInput,
  };
}

function success<T>(response: KnowledgeAgentResponse): T {
  if ("error" in response) throw new Error(JSON.stringify(response));
  return response.result as T;
}

function privateError(response: KnowledgeAgentResponse, code: string) {
  expect(response).toMatchObject({ apiVersion: "1", error: { code } });
  const value = JSON.stringify(response);
  for (const secret of [
    "PRIVATE_",
    "trustedAttesterIds",
    "trustedRunnerIds",
    "staff/verifier",
    "private/artifact",
  ])
    expect(value).not.toContain(secret);
}

function bodyFree(value: unknown) {
  const encoded = JSON.stringify(value);
  for (const privateValue of [
    "PRIVATE_REPORT_BODY_CANARY",
    "PRIVATE_STAFF_EVIDENCE",
    "private/artifact",
    "staff/verifier",
    "trustedAttesterIds",
    "trustedRunnerIds",
    "reportHash",
    "submissionHash",
    "confirmation",
  ])
    expect(encoded).not.toContain(privateValue);
}

describe.each(["HTTP", "MCP"] as const)(
  "optional native human-report workflow over %s",
  (channel) => {
    const other: Channel = channel === "HTTP" ? "MCP" : "HTTP";

    it.each([false, true])(
      "queues privately, requires human confirmation, polls its own receipt, accepts every real check and leaves publication to staff (aggregate=%s)",
      async (aggregate) => {
        const f = await fixture({ aggregate });
        const before = await f.current();
        const first = await f.packet(channel);
        expect(first.ack).toMatchObject({
          kind: "pending-human-review",
          ledgerEpoch: 1,
          reportGeneration: 1,
        });
        bodyFree(first.ack);
        expect((await f.current()).generation).toBe(before.generation);
        expect(
          (await f.app.getEvidence(f.reviewer, { articleId: f.articleId }))
            .evidence,
        ).toHaveLength(0);
        const pending = success<KnowledgeAgentReportRequirementsResult>(
          await f.call(
            other,
            "getValidationRequirements",
            f.requirementsInput(first.ack),
          ),
        );
        expect(pending.reportStatus).toMatchObject({
          status: "pending",
          receipt: first.ack.receipt,
        });
        bodyFree(pending);
        const trusted = {
          ...f.command("submit-native-evidence", before.generation),
          articleId: f.articleId,
          evidence: first.input.evidence,
          receipt: first.ack.receipt,
        };
        privateError(
          await f.call(channel, "submitEvidence", trusted),
          "prerequisite",
        );
        const confirmation = await f.decide(first.ack);
        expect(confirmation.ack.receipt).toBe(first.ack.receipt);
        const checked = success<KnowledgeAgentReportRequirementsResult>(
          await f.call(
            channel,
            "getValidationRequirements",
            f.requirementsInput(first.ack),
          ),
        );
        expect(checked.reportStatus).toMatchObject({
          status: "confirmed",
          receipt: first.ack.receipt,
        });
        bodyFree(checked);
        expect(
          success<{ replayed: boolean }>(
            await f.call(channel, "submitEvidence", trusted),
          ).replayed,
        ).toBe(false);
        expect(
          success<{ replayed: boolean }>(
            await f.call(other, "submitEvidence", trusted),
          ).replayed,
        ).toBe(true);
        const second = await f.packet(other, "walkthrough-workflow");
        await f.decide(second.ack);
        const current = await f.current();
        success(
          await f.call(channel, "submitEvidence", {
            ...f.command("submit-native-workflow", current.generation),
            articleId: f.articleId,
            evidence: second.input.evidence,
            receipt: second.ack.receipt,
          }),
        );
        const accepted = await f.app.getEvidence(f.reviewer, {
          articleId: f.articleId,
        });
        expect(accepted.evidence).toHaveLength(2);
        expect(
          accepted.evidence.every(
            (value) => value.attestation.verifiedBy === f.reviewer.principalId,
          ),
        ).toBe(true);
        expect((await f.current()).hasPublication).toBe(false);
        await expect(
          f.app.submitForReview(f.agent, {
            ...f.command(
              "forbidden-agent-review",
              (await f.current()).generation,
            ),
            articleId: f.articleId,
          }),
        ).rejects.toMatchObject({ name: "KnowledgeBaseAuthorizationError" });
        await f.publish();
        const published = await f.app.getPublishedArticle(f.customer, {
          articleId: f.articleId,
        });
        expect(published.revision).toBe(1);
        bodyFree(published);
      },
    );

    it("keeps exact default legacy schemas, tool count and receipt submission behavior", async () => {
      const f = await fixture({ legacy: true });
      expect(f.dispatcher.reportWorkflow).toBeUndefined();
      privateError(
        await f.call(
          channel,
          "getValidationRequirements",
          f.requirementsInput(),
        ),
        "invalid_request",
      );
      const current = await f.current();
      const raw = await f.reportInput();
      privateError(
        await f.call(channel, "submitEvidence", {
          ...f.command("disabled-report", current.generation),
          ...raw,
        }),
        "invalid_request",
      );
      const legacyRequirements = success<Record<string, unknown>>(
        await f.call(channel, "getValidationRequirements", {
          collectionId: f.collectionId,
          kind: "walkthrough",
        }),
      );
      expect(legacyRequirements).not.toHaveProperty("reportLedger");
      expect(legacyRequirements).not.toHaveProperty("reportStatus");
      const reported = await f.report();
      await f.decide(reported.ack);
      const result = success<Record<string, unknown>>(
        await f.call(channel, "submitEvidence", {
          ...f.command("legacy-accepted", current.generation),
          articleId: f.articleId,
          evidence: reported.input.evidence,
          receipt: reported.ack.receipt,
        }),
      );
      expect(result).toHaveProperty("value");
      expect(result).not.toHaveProperty("kind");
      const listed = await (await f.sdk()).listTools();
      expect(listed.tools).toHaveLength(5);
      expect(JSON.stringify(listed.tools)).not.toContain("ledgerEpoch");
    });

    it("keeps legacy requirements exact even when the report port is configured", async () => {
      let calls = 0;
      const f = await fixture({
        wrapReports: (reports) => ({
          ...reports,
          async ledger(...args) {
            calls++;
            return reports.ledger(...args);
          },
          async status(...args) {
            calls++;
            return reports.status(...args);
          },
        }),
      });
      const input = {
        collectionId: f.collectionId,
        kind: "walkthrough" as const,
      };
      const actual = success(
        await f.call(channel, "getValidationRequirements", input),
      );
      expect(actual).toEqual(
        await f.app.getValidationRequirements(f.agent, input),
      );
      expect(actual).not.toHaveProperty("reportLedger");
      expect(actual).not.toHaveProperty("reportStatus");
      expect(calls).toBe(0);
    });

    it.each([
      ["ledger status", "ledger", "status", "malformed"],
      ["ledger epoch", "ledger", "ledgerEpoch", 0],
      ["report status", "status", "status", "malformed"],
      ["report generation", "status", "reportGeneration", 0],
      ["report receipt", "status", "receipt", 17],
    ] as const)(
      "refuses malformed trusted %s instead of stripping into legacy success",
      async (_name, port, field, invalid) => {
        const f = await fixture({
          wrapReports: (reports) => ({
            ...reports,
            async ledger(...args) {
              const value = { ...(await reports.ledger(...args)) };
              if (port === "ledger") Reflect.set(value, field, invalid);
              return value;
            },
            async status(...args) {
              const value = { ...(await reports.status(...args)) };
              if (port === "status") Reflect.set(value, field, invalid);
              return value;
            },
          }),
        });
        const actual = await f.report();
        const response = await f.call(
          channel,
          "getValidationRequirements",
          f.requirementsInput({ ...actual.ack, kind: "pending-human-review" }),
        );
        privateError(response, "unavailable");
        expect(response).not.toHaveProperty("result");
      },
    );

    it.each([
      ["ASCII exact", "r".repeat(510), 512, true],
      ["ASCII one over", "r".repeat(511), 513, false],
      ["512 raw ASCII", "r".repeat(512), 514, false],
      ["escaped quotes exact", '"'.repeat(255), 512, true],
      ["escaped quotes one over", '"'.repeat(255) + "r", 513, false],
      ["escaped backslashes exact", "\\".repeat(255), 512, true],
      ["escaped backslashes one over", "\\".repeat(255) + "r", 513, false],
    ] as const)(
      "enforces the existing JSON-encoded receipt bound for %s at the minimum budget",
      async (_name, receipt, bytes, accepted) => {
        expect(
          new TextEncoder().encode(JSON.stringify(receipt)).byteLength,
        ).toBe(bytes);
        const f = await fixture({
          limits: { maxResponseBytes: 2048 },
          wrapReports: (reports) => ({
            ...reports,
            async report(...args) {
              return { ...(await reports.report(...args)), receipt };
            },
            async status(...args) {
              return { ...(await reports.status(...args)), receipt };
            },
          }),
        });
        const existing = await f.report();
        const current = await f.current();
        const input = {
          ...f.command("receipt-bound", current.generation),
          ...(await f.reportInput()),
        };
        const queued = await f.call(channel, "submitEvidence", input);
        const polled = await f.call(
          channel,
          "getValidationRequirements",
          f.requirementsInput({
            ...existing.ack,
            kind: "pending-human-review",
          }),
        );
        if (accepted) {
          expect(success<KnowledgeAgentPendingReport>(queued).receipt).toBe(
            receipt,
          );
          expect(
            success<KnowledgeAgentReportRequirementsResult>(polled).reportStatus
              ?.receipt,
          ).toBe(receipt);
          expect(
            new TextEncoder().encode(JSON.stringify(polled)).byteLength,
          ).toBeLessThanOrEqual(2048);
        } else {
          privateError(queued, "unavailable");
          privateError(polled, "unavailable");
        }
      },
    );

    it("recovers an exact report ACK after evidence-only generation changes and rejects generation rebinding", async () => {
      const f = await fixture();
      const queued = await f.packet(channel);
      await f.decide(queued.ack);
      await f.submit(queued.ack, queued.input.evidence);
      const current = await f.current();
      expect(current.generation).toBe(queued.input.expectedGeneration + 1);
      expect(current.revision.number).toBe(
        queued.input.evidence.articleRevision,
      );
      const before = await f.physicalRows();
      expect(
        success<KnowledgeAgentPendingReport>(
          await f.call(other, "submitEvidence", queued.input),
        ),
      ).toEqual(queued.ack);
      privateError(
        await f.call(channel, "submitEvidence", {
          ...queued.input,
          expectedGeneration: current.generation,
        }),
        "conflict",
      );
      privateError(
        await f.call(channel, "submitEvidence", {
          ...queued.input,
          ...f.command("new-stale-generation", queued.input.expectedGeneration),
        }),
        "conflict",
      );
      expect(await f.physicalRows()).toEqual(before);
      expect(await f.current()).toEqual(current);
    });

    it.each(["confirmed", "pending"] as const)(
      "withholds a status invalidated by a real %s decision between awaited fences",
      async (decision) => {
        let apply: (() => Promise<void>) | undefined;
        let observedStatus = false;
        const f = await fixture({
          wrapReports: (reports) => ({
            ...reports,
            async status(...args) {
              const value = await reports.status(...args);
              if (apply !== undefined) observedStatus = true;
              return value;
            },
            async ledger(...args) {
              const value = await reports.ledger(...args);
              if (observedStatus && apply !== undefined) {
                const decide = apply;
                apply = undefined;
                observedStatus = false;
                await decide();
              }
              return value;
            },
          }),
        });
        const queued = await f.packet(channel);
        if (decision === "pending") await f.decide(queued.ack);
        const initial = await f.reports.status(f.agent, f.key(queued.ack));
        const target = await f.current();
        apply = async () => {
          await f.decide(queued.ack, decision);
        };
        privateError(
          await f.call(
            channel,
            "getValidationRequirements",
            f.requirementsInput(queued.ack),
          ),
          "conflict",
        );
        const latest = await f.reports.status(f.agent, f.key(queued.ack));
        expect(latest.reportGeneration).toBe(initial.reportGeneration + 1);
        expect(latest.status).toBe(decision);
        if (decision === "pending")
          expect(latest.receipt).not.toBe(initial.receipt);
        expect(await f.current()).toEqual(target);
        const fresh = success<KnowledgeAgentReportRequirementsResult>(
          await f.call(
            other,
            "getValidationRequirements",
            f.requirementsInput(queued.ack),
          ),
        );
        expect(fresh.reportStatus).toEqual(latest);
        bodyFree(fresh);
      },
    );

    it("requires both existing effective permissions for the optional extension and never grants staff capabilities", async () => {
      const f = await fixture();
      const current = await f.current();
      const raw = await f.reportInput();
      const input = {
        ...f.command("missing-report-scope", current.generation),
        ...raw,
      };
      const initial = f.authority.current;
      for (const scopes of [
        [knowledgeAgentScopes.draftWrite],
        [knowledgeAgentScopes.evidenceSubmit],
        [knowledgeAgentScopes.draftRead],
      ]) {
        f.authority.current = { ...initial, scopes };
        privateError(
          await f.call(
            channel,
            "getValidationRequirements",
            f.requirementsInput(),
          ),
          "forbidden",
        );
        privateError(
          await f.call(channel, "submitEvidence", input),
          "forbidden",
        );
      }
      f.authority.current = initial;
      await expect(
        f.reports.read(f.agent, {
          articleId: f.articleId,
          ledgerEpoch: 1,
          reportId: "unknown",
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      for (const operation of [
        "publishArticle",
        "getProvenance",
        "getEvidence",
        "submitForReview",
        "confirmReport",
      ]) {
        const response = await f.dispatcher.dispatch(initial, {
          apiVersion: "1",
          operation,
          input: {},
        });
        privateError(response, "invalid_request");
      }
      expect(await f.rows()).toHaveLength(0);
    });

    it("strictly rejects unknown fields, mixed receipt/report variants and excess report bounds before a write", async () => {
      const f = await fixture();
      const current = await f.current();
      const raw = await f.reportInput();
      const input = {
        ...f.command("strict-report", current.generation),
        ...raw,
      };
      for (const invalid of [
        { ...input, receipt: "untrusted" },
        { ...input, principalId: f.agent.principalId },
        { ...input, report: { ...input.report, attestation: "fake" } },
        {
          ...input,
          evidence: {
            ...input.evidence,
            attestation: { verifiedBy: f.reviewer.principalId },
          },
        },
        { ...input, report: { summary: "S".repeat(1001), details: "bounded" } },
        {
          ...input,
          report: { summary: "bounded", details: "D".repeat(16_001) },
        },
      ])
        privateError(
          await f.call(channel, "submitEvidence", invalid),
          "invalid_request",
        );
      privateError(
        await f.call(channel, "getValidationRequirements", {
          ...f.requirementsInput(),
          reportLookup: {
            ledgerEpoch: 1,
            reportId: "fake",
            reviewerId: "fake",
          },
        }),
        "invalid_request",
      );
      privateError(
        await f.call(channel, "getValidationRequirements", {
          collectionId: f.collectionId,
          kind: "walkthrough",
          reportLookup: { ledgerEpoch: 1, reportId: "fake" },
        }),
        "invalid_request",
      );
      expect(await f.rows()).toHaveLength(0);
    });

    it("binds article collection/kind, current generation and report epoch without exposing other authors' status", async () => {
      const f = await fixture();
      const current = await f.current();
      const raw = await f.reportInput();
      privateError(
        await f.call(channel, "getValidationRequirements", {
          ...f.requirementsInput(),
          collectionId: "foreign-collection",
        }),
        "conflict",
      );
      privateError(
        await f.call(channel, "getValidationRequirements", {
          ...f.requirementsInput(),
          kind: "explanation",
        }),
        "conflict",
      );
      privateError(
        await f.call(channel, "submitEvidence", {
          ...f.command("stale-report", current.generation + 1),
          ...raw,
        }),
        "conflict",
      );
      privateError(
        await f.call(channel, "submitEvidence", {
          ...f.command("wrong-epoch-report", current.generation),
          ...raw,
          ledgerEpoch: raw.ledgerEpoch + 1,
        }),
        "conflict",
      );
      const own = await f.packet(channel);
      privateError(
        await f.call(channel, "getValidationRequirements", {
          ...f.requirementsInput(),
          reportLookup: {
            ledgerEpoch: own.ack.ledgerEpoch + 1,
            reportId: own.ack.reportId,
          },
        }),
        "conflict",
      );
      f.authority.current = { ...f.authority.current, access: f.otherAgent };
      privateError(
        await f.call(
          channel,
          "getValidationRequirements",
          f.requirementsInput(own.ack),
        ),
        "not_found",
      );
      f.authority.current = { ...f.authority.current, access: f.agent };
      await f.decide(own.ack);
      const invalidReceipt = {
        ...f.command("tampered-native-receipt", current.generation),
        articleId: f.articleId,
        evidence: own.input.evidence,
        receipt: own.ack.receipt + "tampered",
      };
      privateError(
        await f.call(channel, "submitEvidence", invalidReceipt),
        "prerequisite",
      );
      privateError(
        await f.call(channel, "submitEvidence", {
          ...invalidReceipt,
          receipt: own.ack.receipt,
          evidence: { ...own.input.evidence, stagingBuildId: "wrong-build" },
        }),
        "prerequisite",
      );
      expect(
        (await f.app.getEvidence(f.reviewer, { articleId: f.articleId }))
          .evidence,
      ).toHaveLength(0);
    });
  },
);

describe("optional native report bounds and observational fences", () => {
  it("advertises the optional variants on exactly the same five official MCP tools", async () => {
    const f = await fixture();
    expect(f.dispatcher.reportWorkflow).toBe(true);
    const listed = await (await f.sdk()).listTools();
    expect(listed.tools).toHaveLength(5);
    const requirements = listed.tools.find(
      (tool) => tool.name === knowledgeAgentToolNames.getValidationRequirements,
    );
    const submission = listed.tools.find(
      (tool) => tool.name === knowledgeAgentToolNames.submitEvidence,
    );
    expect(requirements?.inputSchema.type).toBe("object");
    expect(submission?.inputSchema.type).toBe("object");
    expect(JSON.stringify(requirements?.inputSchema)).toContain("reportLookup");
    expect(JSON.stringify(submission?.inputSchema)).toContain("ledgerEpoch");
    expect(JSON.stringify(submission?.inputSchema)).toContain("receipt");
    expect(Object.values(knowledgeAgentScopes)).toHaveLength(3);
  });

  it("retains the complete pending acknowledgement at the existing minimum response budget", async () => {
    const f = await fixture({ limits: { maxResponseBytes: 2048 } });
    const queued = await f.packet("MCP");
    expect(queued.ack.kind).toBe("pending-human-review");
    expect(
      new TextEncoder().encode(JSON.stringify(queued.ack)).byteLength,
    ).toBeLessThan(2048);
    expect((await f.current()).generation).toBe(1);
  });

  it.each(["HTTP", "MCP"] as const)(
    "recovers a withheld queued-report ACK after an actual draft edit over %s without claiming rollback",
    async (channel) => {
      let edit = true;
      let historical: KnowledgeReportAcknowledgement | undefined;
      const f = await fixture({
        wrapReports: (reports, app) => ({
          ...reports,
          async report(access, input) {
            expect(access.roles).toEqual([]);
            expect(access.entitlements).toEqual([]);
            expect(access.permissions).toEqual(
              Object.values(knowledgeAgentScopes),
            );
            const ack = await reports.report(access, input);
            if (edit) {
              edit = false;
              historical = ack;
              await app.updateDraft();
            }
            return ack;
          },
        }),
      });
      f.authority.current = {
        ...f.authority.current,
        access: {
          ...f.owner,
          roles: ["synthetic-admin"],
          entitlements: ["synthetic-entitlement"],
        },
      };
      const current = await f.current();
      const raw = await f.reportInput();
      const input = {
        ...f.command("changed-after-report", current.generation),
        ...raw,
      };
      privateError(await f.call(channel, "submitEvidence", input), "conflict");
      if (historical === undefined)
        throw new Error("Expected the real report write before the ACK fence");
      expect((await f.rows()).length).toBeGreaterThan(0);
      const latest = await f.current();
      expect(latest.revision.number).toBe(2);
      const before = await f.physicalRows();
      expect(
        success<KnowledgeAgentPendingReport>(
          await f.call(
            channel === "HTTP" ? "MCP" : "HTTP",
            "submitEvidence",
            input,
          ),
        ),
      ).toEqual({ kind: "pending-human-review", ...historical });
      expect(await f.physicalRows()).toEqual(before);
      expect(await f.current()).toEqual(latest);
      expect(
        (await f.app.getEvidence(f.reviewer, { articleId: f.articleId }))
          .evidence,
      ).toHaveLength(0);
    },
  );

  it("withholds old report status after an actual draft edit during the status await", async () => {
    let edit = false;
    const f = await fixture({
      wrapReports: (reports, app) => ({
        ...reports,
        async status(access, input) {
          const status = await reports.status(access, input);
          if (edit) {
            edit = false;
            await app.updateDraft();
          }
          return status;
        },
      }),
    });
    const queued = await f.packet("HTTP");
    edit = true;
    privateError(
      await f.call(
        "MCP",
        "getValidationRequirements",
        f.requirementsInput(queued.ack),
      ),
      "conflict",
    );
  });
});

describe.each(["HTTP", "MCP"] as const)(
  "aggregate report query over %s",
  (channel) => {
    it("uses one real aggregate query for discovery/polling and no redundant dispatcher subreads", async () => {
      const calls = {
        query: 0,
        ledger: 0,
        status: 0,
        draft: 0,
        requirements: 0,
      };
      const f = await fixture({
        aggregate: true,
        wrapApplication: (app) => ({
          ...app,
          async getDraft(...args) {
            calls.draft++;
            return app.getDraft(...args);
          },
          async getValidationRequirements(...args) {
            calls.requirements++;
            return app.getValidationRequirements(...args);
          },
        }),
        wrapReports: (reports) => {
          const query = reports.query;
          if (query === undefined)
            throw new Error("Expected actual aggregate query");
          return {
            ...reports,
            async query(access, input) {
              calls.query++;
              expect(access.roles).toEqual([]);
              expect(access.entitlements).toEqual([]);
              expect(access.permissions).toEqual(
                Object.values(knowledgeAgentScopes),
              );
              expect(Object.keys(input).sort()).toEqual(
                input.status === undefined
                  ? ["articleId"]
                  : ["articleId", "status"],
              );
              return query(access, input);
            },
            async ledger(...args) {
              calls.ledger++;
              return reports.ledger(...args);
            },
            async status(...args) {
              calls.status++;
              return reports.status(...args);
            },
          };
        },
      });
      f.authority.current = {
        ...f.authority.current,
        access: {
          ...f.owner,
          roles: ["synthetic-admin"],
          entitlements: ["PRIVATE_ENTITLEMENT"],
        },
      };
      const before = await f.physicalRows();
      const discovery = success<KnowledgeAgentReportRequirementsResult>(
        await f.call(
          channel,
          "getValidationRequirements",
          f.requirementsInput(),
        ),
      );
      expect(discovery).toHaveProperty("reportLedger", {
        ledgerEpoch: 1,
        status: "active",
      });
      expect(discovery).not.toHaveProperty("reportStatus");
      expect(calls).toEqual({
        query: 1,
        ledger: 0,
        status: 0,
        draft: 0,
        requirements: 0,
      });
      expect(await f.physicalRows()).toEqual(before);
      const recorded = await f.report();
      await f.decide(recorded.ack);
      const saved = await f.physicalRows();
      const polled = success<KnowledgeAgentReportRequirementsResult>(
        await f.call(
          channel,
          "getValidationRequirements",
          f.requirementsInput({
            ...recorded.ack,
            kind: "pending-human-review",
          }),
        ),
      );
      expect(polled.reportStatus).toEqual(
        await f.reports.status(f.agent, f.key(recorded.ack)),
      );
      expect(calls).toEqual({
        query: 2,
        ledger: 0,
        status: 0,
        draft: 0,
        requirements: 0,
      });
      expect(await f.physicalRows()).toEqual(saved);
      bodyFree(polled);
      expect(polled).not.toHaveProperty("target");
    });

    it("retains the same advertised schemas and legacy requirements without invoking query", async () => {
      let calls = 0;
      const f = await fixture({
        aggregate: true,
        wrapReports: (reports) => ({
          ...reports,
          async query() {
            calls++;
            throw new Error("PRIVATE_UNUSED_QUERY");
          },
        }),
      });
      const input = {
        collectionId: f.collectionId,
        kind: "walkthrough" as const,
      };
      expect(
        success(await f.call(channel, "getValidationRequirements", input)),
      ).toEqual(await f.app.getValidationRequirements(f.agent, input));
      expect(calls).toBe(0);
      const legacy = await fixture();
      expect((await (await f.sdk()).listTools()).tools).toEqual(
        (await (await legacy.sdk()).listTools()).tools,
      );
      expect(Object.values(knowledgeAgentScopes)).toHaveLength(3);
    });

    it("projects away internal target, ledger capacity and private fields from trusted aggregate output", async () => {
      const f = await fixture({
        aggregate: true,
        wrapReports: (reports) => {
          const query = reports.query;
          if (query === undefined)
            throw new Error("Expected actual aggregate query");
          return {
            ...reports,
            async query(...args) {
              const actual = structuredClone(await query(...args));
              Reflect.set(
                actual,
                "PRIVATE_REPORT_BODY_CANARY",
                "private/artifact",
              );
              Reflect.set(
                actual.target,
                "privateSource",
                "PRIVATE_SOURCE_BODY",
              );
              Reflect.set(actual.requirements, "trustedAttesterIds", [
                "staff/verifier",
              ]);
              Reflect.set(
                actual.ledger,
                "privateDetails",
                "PRIVATE_LEDGER_BODY",
              );
              if (actual.status !== undefined)
                Reflect.set(
                  actual.status,
                  "confirmation",
                  "PRIVATE_CONFIRMATION",
                );
              return actual;
            },
          };
        },
      });
      const recorded = await f.report();
      const result = success<KnowledgeAgentReportRequirementsResult>(
        await f.call(
          channel,
          "getValidationRequirements",
          f.requirementsInput({
            ...recorded.ack,
            kind: "pending-human-review",
          }),
        ),
      );
      expect(Object.keys(result.reportLedger).sort()).toEqual([
        "ledgerEpoch",
        "status",
      ]);
      expect(Object.keys(result.reportStatus ?? {}).sort()).toEqual([
        "ledgerEpoch",
        "receipt",
        "reportGeneration",
        "reportId",
        "status",
      ]);
      expect(result).not.toHaveProperty("target");
      bodyFree(result);
    });

    it.each([
      ["target article", "target", "articleId", "article/foreign"],
      ["target generation", "target", "generation", -1],
      ["target kind", "target", "kind", "private-kind"],
      [
        "requirements collection",
        "requirements",
        "collectionId",
        "collection/foreign",
      ],
      ["ledger status", "ledger", "status", "invalid"],
      ["status receipt", "status", "receipt", 19],
      ["status identity", "status", "reportId", "foreign-report"],
    ] as const)(
      "refuses malformed or mismatched trusted %s without fallback",
      async (_name, part, field, invalid) => {
        let fallback = 0;
        const f = await fixture({
          aggregate: true,
          wrapReports: (reports) => {
            const query = reports.query;
            if (query === undefined)
              throw new Error("Expected actual aggregate query");
            return {
              ...reports,
              async query(...args) {
                const actual = structuredClone(await query(...args));
                const selected = actual[part];
                if (selected === undefined)
                  throw new Error("Expected owner status");
                Reflect.set(selected, field, invalid);
                return actual;
              },
              async ledger(...args) {
                fallback++;
                return reports.ledger(...args);
              },
              async status(...args) {
                fallback++;
                return reports.status(...args);
              },
            };
          },
        });
        const recorded = await f.report();
        const before = await f.physicalRows();
        privateError(
          await f.call(
            channel,
            "getValidationRequirements",
            f.requirementsInput({
              ...recorded.ack,
              kind: "pending-human-review",
            }),
          ),
          "unavailable",
        );
        expect(fallback).toBe(0);
        expect(await f.physicalRows()).toEqual(before);
      },
    );

    it("keeps target, epoch, owner and effective scope refusals on the real aggregate", async () => {
      const f = await fixture({ aggregate: true });
      const recorded = await f.report();
      const input = f.requirementsInput({
        ...recorded.ack,
        kind: "pending-human-review",
      });
      const before = await f.physicalRows();
      privateError(
        await f.call(channel, "getValidationRequirements", {
          ...input,
          collectionId: "collection/foreign",
        }),
        "conflict",
      );
      privateError(
        await f.call(channel, "getValidationRequirements", {
          ...input,
          kind: "explanation",
        }),
        "conflict",
      );
      privateError(
        await f.call(channel, "getValidationRequirements", {
          ...input,
          reportLookup: {
            ledgerEpoch: recorded.ack.ledgerEpoch + 1,
            reportId: recorded.ack.reportId,
          },
        }),
        "conflict",
      );
      f.authority.current = { ...f.authority.current, access: f.otherAgent };
      privateError(
        await f.call(channel, "getValidationRequirements", input),
        "not_found",
      );
      for (const scope of Object.values(knowledgeAgentScopes)) {
        f.authority.current = {
          ...f.authority.current,
          access: f.agent,
          scopes: [scope],
        };
        privateError(
          await f.call(channel, "getValidationRequirements", input),
          "forbidden",
        );
      }
      expect(await f.physicalRows()).toEqual(before);
    });

    it.each(["missing", "unsolicited"] as const)(
      "refuses %s aggregate status instead of leaking or downgrading it",
      async (mode) => {
        let recorded: KnowledgeReportAcknowledgement | undefined;
        const f = await fixture({
          aggregate: true,
          wrapReports: (reports) => {
            const query = reports.query;
            if (query === undefined)
              throw new Error("Expected actual aggregate query");
            return {
              ...reports,
              async query(access, input) {
                const actual = structuredClone(await query(access, input));
                if (mode === "missing")
                  Reflect.deleteProperty(actual, "status");
                else {
                  if (recorded === undefined)
                    throw new Error("Expected actual owner report");
                  Reflect.set(
                    actual,
                    "status",
                    await reports.status(access, {
                      articleId: input.articleId,
                      ledgerEpoch: recorded.ledgerEpoch,
                      reportId: recorded.reportId,
                    }),
                  );
                }
                return actual;
              },
            };
          },
        });
        recorded = (await f.report()).ack;
        const before = await f.physicalRows();
        privateError(
          await f.call(
            channel,
            "getValidationRequirements",
            mode === "missing"
              ? f.requirementsInput({
                  ...recorded,
                  kind: "pending-human-review",
                })
              : f.requirementsInput(),
          ),
          "unavailable",
        );
        expect(await f.physicalRows()).toEqual(before);
      },
    );

    it("fails closed on unavailable aggregate work without falling back or exposing its exception", async () => {
      let fallback = 0;
      const f = await fixture({
        aggregate: true,
        wrapReports: (reports) => ({
          ...reports,
          async query() {
            throw new Error("PRIVATE_REPORT_BODY_CANARY private/artifact");
          },
          async ledger(...args) {
            fallback++;
            return reports.ledger(...args);
          },
          async status(...args) {
            fallback++;
            return reports.status(...args);
          },
        }),
      });
      const before = await f.physicalRows();
      privateError(
        await f.call(
          channel,
          "getValidationRequirements",
          f.requirementsInput(),
        ),
        "unavailable",
      );
      expect(fallback).toBe(0);
      expect(await f.physicalRows()).toEqual(before);
    });

    it("propagates an actual aggregate target-change conflict without exposing stale report status", async () => {
      const f = await fixture({ aggregate: true });
      const recorded = await f.report();
      const before = await f.physicalRows();
      let edit = true;
      f.hooks.afterContext = async () => {
        if (!edit) return;
        edit = false;
        await f.updateDraft();
      };
      privateError(
        await f.call(
          channel,
          "getValidationRequirements",
          f.requirementsInput({
            ...recorded.ack,
            kind: "pending-human-review",
          }),
        ),
        "conflict",
      );
      expect((await f.current()).revision.number).toBe(2);
      expect(await f.physicalRows()).toEqual(before);
    });

    it("never makes query a prerequisite for historical report ACK recovery after a real draft edit", async () => {
      let queries = 0;
      const f = await fixture({
        aggregate: true,
        wrapReports: (reports) => ({
          ...reports,
          async query() {
            queries++;
            throw new Error("PRIVATE_QUERY_UNAVAILABLE");
          },
        }),
      });
      const current = await f.current();
      const input = {
        ...f.command("aggregate-history", current.generation),
        ...(await f.reportInput()),
      };
      const ack = success<KnowledgeAgentPendingReport>(
        await f.call(channel, "submitEvidence", input),
      );
      await f.updateDraft();
      const before = await f.physicalRows();
      const next: Channel = channel === "HTTP" ? "MCP" : "HTTP";
      expect(success(await f.call(next, "submitEvidence", input))).toEqual(ack);
      privateError(
        await f.call(channel, "submitEvidence", {
          ...input,
          expectedGeneration: (await f.current()).generation,
        }),
        "conflict",
      );
      expect(queries).toBe(0);
      expect(await f.physicalRows()).toEqual(before);
    });
  },
);

describe("aggregate report configuration", () => {
  it.each([null, false, "query"])(
    "rejects a supplied non-callable query %s",
    async (invalid) => {
      const f = await fixture();
      const reports = {
        report: f.reports.report,
        ledger: f.reports.ledger,
        status: f.reports.status,
        query: f.reports.query,
      };
      Reflect.set(reports, "query", invalid);
      expect(() =>
        createKnowledgeAgentDispatcher({
          application: f.app,
          resource: agentResource,
          reports,
        }),
      ).toThrow(TypeError);
    },
  );

  it("captures the trusted query method and receiver before caller mutation", async () => {
    let supplied: Reports | undefined;
    let calls = 0;
    const f = await fixture({
      aggregate: true,
      wrapReports: (reports) => {
        const query = reports.query;
        if (query === undefined)
          throw new Error("Expected actual aggregate query");
        const ports: Reports = {
          ...reports,
          async query(...args) {
            expect(this).toBe(ports);
            calls++;
            return query(...args);
          },
        };
        supplied = ports;
        return ports;
      },
    });
    if (supplied === undefined)
      throw new Error("Expected supplied report methods");
    Reflect.set(supplied, "query", async () => {
      throw new Error("PRIVATE_REPLACEMENT_QUERY");
    });
    expect(
      success<KnowledgeAgentReportRequirementsResult>(
        await f.call(
          "HTTP",
          "getValidationRequirements",
          f.requirementsInput(),
        ),
      ).reportLedger.status,
    ).toBe("active");
    expect(calls).toBe(1);
  });
});
