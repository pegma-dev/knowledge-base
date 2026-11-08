import {
  createKnowledgeEvidenceReports,
  KnowledgeEvidenceReportsError,
  type EvidenceVerificationRequest,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import type { EvidenceSubmission } from "@pegma/knowledge-base-core";
import { describe, expect, it } from "vitest";
import { access, at, draft, evidence } from "../test/application-fixtures.js";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import {
  confirmationPermission,
  evidenceReportsFixture,
  evidenceReportsHistoryFixture,
  reportBarrier,
} from "../test/evidence-reports-fixtures.js";

const unavailable = { code: "report_ledger_unavailable" };
const kbEvidenceRefusal = {
  name: expect.stringMatching(
    /^(KnowledgeBaseError|KnowledgeBasePrerequisiteError)$/u,
  ),
};
const capture = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

async function maximumAsciiReport(
  f: Awaited<ReturnType<typeof evidenceReportsFixture>>,
) {
  const original = await f.reportInput({
    ...(await f.submission()),
    steps: Array.from({ length: 16 }, () => "S".repeat(1_000)),
  });
  const input = {
    ...original,
    report: { summary: "R".repeat(1_000), details: "D".repeat(16_000) },
  };
  return { input, ack: await f.reports.report(f.agent, input) };
}

for (const [backend, createStore] of storeFactories) {
  describe(`shared evidence reports over ${backend}`, () => {
    it("accepts only independently confirmed reports, completes every required check, then publishes through the actual KB", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const first = await f.report();
      await expect(
        f.submit(first.ack, first.input.evidence),
      ).rejects.toMatchObject(kbEvidenceRefusal);
      const confirmed = await f.decide(first.ack);
      const accepted = await f.submit(confirmed.ack, first.input.evidence);
      const current = await f.current();
      await expect(
        f.app.submitForReview(f.reviewer, {
          ...f.command("missing-workflow-check", current.generation),
          articleId: f.articleId,
        }),
      ).rejects.toMatchObject({ code: "evidence" });
      const required = await f.app.getValidationRequirements(f.agent, {
        collectionId: f.collectionId,
        kind: current.revision.kind,
      });
      expect(required.checks.map((check) => check.id).sort()).toEqual([
        "walkthrough-content",
        "walkthrough-workflow",
      ]);
      const second = await f.report(await f.submission("walkthrough-workflow"));
      const checked = await f.decide(second.ack);
      await f.submit(checked.ack, second.input.evidence);
      await f.publish();
      const visible = await f.app.getPublishedArticle(f.customer, {
        articleId: f.articleId,
      });
      expect(visible.revision).toBe(1);
      const stored = await f.app.getEvidence(f.reviewer, {
        articleId: f.articleId,
      });
      expect(stored.evidence).toHaveLength(2);
      expect(
        stored.evidence.map((item) => item.attestation.verifiedBy),
      ).toEqual([f.reviewer.principalId, f.reviewer.principalId]);
      expect(stored.evidence[0]?.attestation.id).toBe(confirmed.ack.receipt);
      expect(stored.evidence[0]?.attestation.id).not.toBe(first.ack.reportId);
      expect(accepted.result.replayed).toBe(false);
      for (const secret of [
        "PRIVATE_REPORT_BODY_CANARY",
        "PRIVATE_STAFF_EVIDENCE",
        "private/artifact/export",
        f.reviewer.principalId,
        first.ack.reportId,
        confirmed.ack.receipt,
      ])
        expect(JSON.stringify(visible)).not.toContain(secret);
    });

    it("preserves restricted caller grants despite current owner/Admin authority, while the same human principal may explicitly confirm", async () => {
      const f = await evidenceReportsFixture(await createStore());
      await f.configure({
        trustedAttesterIds: [f.reviewer.principalId, f.owner.principalId],
      });
      const packet = await f.report();
      expect(f.readContext.mock.calls[0]?.[0].permissions).toEqual(
        f.agent.permissions,
      );
      expect(f.agent.principalId).toBe(f.owner.principalId);
      expect(f.agent.permissions).toHaveLength(3);
      const view = await f.reports.read(f.owner, f.key(packet.ack));
      const decision = {
        ...f.key(packet.ack),
        commandId: "same-principal-human-review",
        expectedReportGeneration: view.expectedReportGeneration,
        reviewBindingHash: view.reviewBindingHash,
      };
      const before = await f.rows();
      for (const operation of [
        () => f.reports.read(f.agent, f.key(packet.ack)),
        () => f.reports.list(f.agent, { articleId: f.articleId }),
        () => f.reports.decide(f.agent, decision, "confirmed"),
        () =>
          f.reports.reset(f.agent, {
            articleId: f.articleId,
            commandId: "agent-reset",
            expectedLedgerEpoch: 1,
          }),
      ])
        await expect(operation()).rejects.toMatchObject({ code: "forbidden" });
      expect(await f.rows()).toEqual(before);
      const confirmed = await f.reports.decide(f.owner, decision, "confirmed");
      await f.submit(confirmed, packet.input.evidence);
      expect(
        (await f.app.getEvidence(f.owner, { articleId: f.articleId }))
          .evidence[0]?.attestation.verifiedBy,
      ).toBe(f.owner.principalId);
    });

    it("exposes only an opaque body-free status to the submitting owner and denies other owners", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packet = await f.report();
      const status = await f.reports.status(f.agent, f.key(packet.ack));
      expect(status).toEqual({ ...packet.ack, status: "pending" });
      expect(Object.keys(status).sort()).toEqual([
        "ledgerEpoch",
        "receipt",
        "reportGeneration",
        "reportId",
        "status",
      ]);
      expect(JSON.stringify(status)).not.toContain(
        "PRIVATE_REPORT_BODY_CANARY",
      );
      await expect(
        f.reports.status(f.otherAgent, f.key(packet.ack)),
      ).rejects.toMatchObject({ code: "report_not_found" });
      const reviewed = await f.reports.list(f.reviewer, {
        articleId: f.articleId,
      });
      expect(reviewed.reports[0]?.summary).toBe(packet.input.report.summary);
      expect(JSON.stringify(reviewed.reports)).not.toContain(
        "PRIVATE_REPORT_BODY_CANARY",
      );
      expect(
        (await f.reports.read(f.reviewer, f.key(packet.ack))).report.details,
      ).toBe(packet.input.report.details);
    });

    it("replays exact commands without appending rows and rejects changed report or decision bindings", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packet = await f.report();
      const before = await f.rows();
      expect(await f.reports.report(f.agent, packet.input)).toEqual(packet.ack);
      expect(await f.rows()).toEqual(before);
      await expect(
        f.reports.report(f.agent, {
          ...packet.input,
          report: {
            ...packet.input.report,
            details: "Different submitted artifact",
          },
        }),
      ).rejects.toMatchObject({ code: "command_conflict" });
      const decision = await f.decide(packet.ack);
      const afterDecision = await f.rows();
      expect(
        await f.reports.decide(f.reviewer, decision.input, "confirmed"),
      ).toEqual(decision.ack);
      await expect(
        f.reports.decide(f.reviewer, decision.input, "rejected"),
      ).rejects.toMatchObject({ code: "command_conflict" });
      expect(await f.rows()).toEqual(afterDecision);
      expect(
        (await f.reports.list(f.reviewer, { articleId: f.articleId })).reports,
      ).toHaveLength(1);
    });

    it("recovers the exact accepted report after a real transaction commits and loses its acknowledgement", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const input = await f.reportInput();
      let lost = false;
      f.observed.intercept(async (trace, commit) => {
        const result = await commit();
        if (!lost && trace.collection === f.namespace) {
          lost = true;
          throw new Error("PRIVATE_STORAGE_ACK_CANARY");
        }
        return result;
      });
      await expect(f.reports.report(f.agent, input)).rejects.toMatchObject({
        ...unavailable,
        stage: "report_write",
        message: "Knowledge evidence report ledger is unavailable.",
      });
      f.observed.intercept(undefined);
      const committed = await f.rows();
      expect(committed).toHaveLength(4);
      const recovered = await f.reports.report(f.agent, input);
      expect(await f.reports.status(f.agent, f.key(recovered))).toEqual({
        ...recovered,
        status: "pending",
      });
      expect(await f.rows()).toEqual(committed);
    });

    it("fences an actual competing report transaction without half-written report, Audit or receipt rows", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const gate = reportBarrier();
      let paused = false;
      f.observed.intercept(async (trace, commit) => {
        if (!paused && trace.collection === f.namespace) {
          paused = true;
          await gate.wait();
        }
        return commit();
      });
      const input = await f.reportInput();
      const pending = capture(f.reports.report(f.agent, input));
      try {
        await gate.reached(pending);
        await f.report();
      } finally {
        gate.release();
      }
      expect(await pending).toMatchObject({
        error: { code: "report_changed" },
      });
      f.observed.intercept(undefined);
      expect(await f.rows()).toHaveLength(4);
      await f.reports.report(f.agent, input);
      expect(await f.rows()).toHaveLength(7);
      expect(
        (await f.reports.list(f.reviewer, { articleId: f.articleId })).reports,
      ).toHaveLength(2);
    });

    it("binds every submitted evidence field and artifact to the independently confirmed report", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packet = await f.report();
      const confirmed = await f.decide(packet.ack);
      const proof = packet.input.evidence;
      const tampered: EvidenceSubmission[] = [
        { ...proof, id: "evidence/other-id" },
        { ...proof, articleRevision: 2 },
        { ...proof, contentHash: "b".repeat(64) },
        {
          ...proof,
          validationPolicy: { ...proof.validationPolicy, version: 2 },
        },
        { ...proof, checkId: "walkthrough-workflow" },
        { ...proof, testKind: "workflow" },
        {
          ...proof,
          applicability: { ...proof.applicability, productId: "other-product" },
        },
        { ...proof, stagingBuildId: "staging-other" },
        { ...proof, steps: ["Unreviewed procedure"] },
        { ...proof, result: "failed" },
        { ...proof, executedAt: at(2_000) },
        { ...proof, runnerId: "unreviewed/runner" },
        {
          ...proof,
          artifacts: [{ id: "other/artifact", hash: "c".repeat(64) }],
        },
      ];
      const request = await f.verificationRequest(confirmed.ack, proof);
      const before = await allKnowledgeRows(f.backing);
      for (const submission of tampered) {
        expect(
          await f.reports.verifier.verify({ ...request, submission }),
        ).toBeNull();
        await expect(f.submit(confirmed.ack, submission)).rejects.toMatchObject(
          kbEvidenceRefusal,
        );
        expect(await allKnowledgeRows(f.backing)).toEqual(before);
      }
      expect(
        await f.reports.verifier.verify({ ...request, access: f.otherAgent }),
      ).toBeNull();
      await expect(
        f.submit(confirmed.ack, proof, f.otherAgent),
      ).rejects.toMatchObject(kbEvidenceRefusal);
      await f.submit(confirmed.ack, proof);
    });

    it("rejects a confirmed report from an untrusted runner under actual KB evidence policy", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const proof = await f.submission();
      const input = { ...proof, runnerId: "untrusted/runner" };
      const packet = await f.report(input);
      const confirmed = await f.decide(packet.ack);
      await expect(f.submit(confirmed.ack, input)).rejects.toMatchObject(
        kbEvidenceRefusal,
      );
      expect(
        (await f.app.getEvidence(f.reviewer, { articleId: f.articleId }))
          .evidence,
      ).toEqual([]);
    });

    it("records a reviewed failed result but requires a genuinely passing replacement before publication", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const failedProof: EvidenceSubmission = {
        ...(await f.submission()),
        result: "failed",
      };
      const failed = await f.report(failedProof);
      const confirmedFailure = await f.decide(failed.ack);
      expect(
        (await f.submit(confirmedFailure.ack, failedProof)).result.replayed,
      ).toBe(false);
      expect(
        (await f.app.getEvidence(f.reviewer, { articleId: f.articleId }))
          .evidence,
      ).toMatchObject([{ id: failedProof.id, result: "failed", version: 1 }]);
      const workflow = await f.report(
        await f.submission("walkthrough-workflow"),
      );
      await f.submit(
        (await f.decide(workflow.ack)).ack,
        workflow.input.evidence,
      );
      await expect(f.publish()).rejects.toMatchObject({ code: "evidence" });
      const passing = await f.report(await f.submission());
      await f.submit((await f.decide(passing.ack)).ack, passing.input.evidence);
      const qualified = (
        await f.app.getEvidence(f.reviewer, { articleId: f.articleId })
      ).evidence;
      expect(
        qualified.find((item) => item.id === failedProof.id),
      ).toMatchObject({ result: "passed", version: 2 });
      await f.publish();
      expect(
        (
          await f.app.getPublishedArticle(f.customer, {
            articleId: f.articleId,
          })
        ).revision,
      ).toBe(1);
    });

    it.each(["build", "check", "revision", "future", "expired"] as const)(
      "refuses human confirmation against a %s mismatch or stale execution",
      async (defect) => {
        const f = await evidenceReportsFixture(await createStore());
        const original = await f.submission();
        const proof: EvidenceSubmission = {
          ...original,
          ...(defect === "build" ? { stagingBuildId: "wrong-build" } : {}),
          ...(defect === "check" ? { checkId: "absent-check" } : {}),
          ...(defect === "revision" ? { articleRevision: 2 } : {}),
          ...(defect === "future" ? { executedAt: at(4_000) } : {}),
        };
        const packet = await f.report(proof);
        if (defect === "expired") f.advance(61_000);
        const before = await f.rows();
        await expect(f.decide(packet.ack)).rejects.toMatchObject({
          code: "report_not_verifiable",
        });
        expect(await f.rows()).toEqual(before);
      },
    );

    it("invalidates an old review binding after an actual draft edit or governance change", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packet = await f.report();
      const view = await f.reports.read(f.reviewer, f.key(packet.ack));
      const input = {
        ...f.key(packet.ack),
        commandId: "stale-human-decision",
        expectedReportGeneration: view.reportGeneration,
        reviewBindingHash: view.reviewBindingHash,
      };
      await f.configure({
        trustedAttesterIds: [f.owner.principalId, f.reviewer.principalId],
      });
      await expect(
        f.reports.decide(f.reviewer, input, "confirmed"),
      ).rejects.toMatchObject({ code: "report_changed" });
      await expect(f.decide(packet.ack)).rejects.toMatchObject({
        code: "report_not_verifiable",
      });
      await f.updateDraft();
      await expect(f.decide(packet.ack)).rejects.toMatchObject({
        code: "report_not_verifiable",
      });
      expect((await f.reports.status(f.agent, f.key(packet.ack))).status).toBe(
        "pending",
      );
    });

    it("reassessment rotates the receipt cycle and requires a fresh exact human confirmation", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packet = await f.report();
      const old = await f.decide(packet.ack);
      await f.configure({
        trustedAttesterIds: [f.owner.principalId, f.reviewer.principalId],
      });
      const stale = await f.verificationRequest(old.ack, packet.input.evidence);
      expect(await f.reports.verifier.verify(stale)).toBeNull();
      const reassessed = await f.decide(old.ack, "pending");
      expect(reassessed.ack.reportId).toBe(old.ack.reportId);
      expect(reassessed.ack.receipt).not.toBe(old.ack.receipt);
      expect(await f.reports.verifier.verify(stale)).toBeNull();
      const beforeReplay = await f.rows();
      expect(
        await f.reports.decide(f.reviewer, old.input, "confirmed"),
      ).toEqual(old.ack);
      expect(await f.rows()).toEqual(beforeReplay);
      expect((await f.reports.status(f.agent, f.key(old.ack))).status).toBe(
        "pending",
      );
      await expect(
        f.submit(reassessed.ack, packet.input.evidence),
      ).rejects.toMatchObject(kbEvidenceRefusal);
      const confirmed = await f.decide(reassessed.ack);
      await f.submit(confirmed.ack, packet.input.evidence);
      expect(await f.reports.verifier.verify(stale)).toBeNull();
    });

    it.each(["principal", "governance"] as const)(
      "rechecks %s attester revocation after awaited public KB reads",
      async (revocation) => {
        const f = await evidenceReportsFixture(await createStore());
        const packet = await f.report();
        const confirmed = await f.decide(packet.ack);
        const gate = reportBarrier();
        let paused = false;
        f.hooks.afterContext = async (caller) => {
          if (!paused && caller.principalId === f.reviewer.principalId) {
            paused = true;
            await gate.wait();
          }
        };
        const pending = capture(f.submit(confirmed.ack, packet.input.evidence));
        try {
          await gate.reached(pending);
          if (revocation === "principal")
            f.principals.delete(f.reviewer.principalId);
          else await f.configure({ trustedAttesterIds: [f.owner.principalId] });
        } finally {
          gate.release();
        }
        expect(await pending).toMatchObject({
          error:
            revocation === "governance"
              ? { name: "RepositoryConflictError" }
              : {
                  name: "KnowledgeBasePrerequisiteError",
                  prerequisite: "evidence-verifier",
                },
        });
        await expect(
          f.submit(confirmed.ack, packet.input.evidence),
        ).rejects.toMatchObject({
          name: "KnowledgeBasePrerequisiteError",
          prerequisite: "evidence-verifier",
        });
        expect(
          (await f.app.getEvidence(f.owner, { articleId: f.articleId }))
            .evidence,
        ).toEqual([]);
        expect(
          (await f.reports.status(f.agent, f.key(packet.ack))).status,
        ).toBe("confirmed");
      },
    );

    it("denies a private view when human confirmation authority is revoked while its body loads", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packet = await f.report();
      const gate = reportBarrier();
      f.hooks.afterContext = () => gate.wait();
      const pending = capture(f.reports.read(f.reviewer, f.key(packet.ack)));
      try {
        await gate.reached(pending);
        f.principals.set(
          f.reviewer.principalId,
          access(
            f.reviewer.principalId,
            f.reviewer.permissions.filter(
              (permission) => permission !== confirmationPermission,
            ),
          ),
        );
      } finally {
        gate.release();
      }
      expect(await pending).toMatchObject({ error: { code: "forbidden" } });
      expect(await f.rows()).toHaveLength(4);
    });

    it("denies report acceptance and exact replay after the submitting principal loses current scope", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packet = await f.report();
      const before = await f.rows();
      f.principals.set(
        f.owner.principalId,
        access(
          f.owner.principalId,
          f.owner.permissions.filter(
            (permission) => permission !== knowledgePermissions.evidenceSubmit,
          ),
        ),
      );
      await expect(
        f.reports.report(f.agent, packet.input),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        f.reports.status(f.agent, f.key(packet.ack)),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(await f.rows()).toEqual(before);
    });

    it("requires the exact original reviewer identity rather than a substituted current principal", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packet = await f.report();
      const confirmed = await f.decide(packet.ack);
      f.principals.set(
        f.reviewer.principalId,
        access("staff/replacement", f.reviewer.permissions),
      );
      expect(
        await f.reports.verifier.verify(
          await f.verificationRequest(confirmed.ack, packet.input.evidence),
        ),
      ).toBeNull();
      await expect(
        f.submit(confirmed.ack, packet.input.evidence),
      ).rejects.toMatchObject(kbEvidenceRefusal);
    });

    it("snapshots the complete report and restricted caller before an awaited context port", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const original = await f.reportInput();
      const input = {
        ...original,
        report: { ...original.report },
        evidence: {
          ...original.evidence,
          steps: [...original.evidence.steps],
        },
      };
      const grants = [...f.agent.permissions];
      const caller = access(f.agent.principalId, grants);
      const gate = reportBarrier();
      f.hooks.afterContext = () => gate.wait();
      const pending = capture(f.reports.report(caller, input));
      try {
        await gate.reached(pending);
        input.report.details = "LATE_UNREVIEWED_REPORT_BODY";
        input.evidence.steps.push("LATE_UNREVIEWED_STEP");
        grants.push(confirmationPermission);
      } finally {
        gate.release();
      }
      const result = await pending;
      if (!("value" in result))
        throw new Error("Expected snapshotted report acceptance");
      delete f.hooks.afterContext;
      const view = await f.reports.read(f.reviewer, f.key(result.value));
      expect(view.report).toEqual(original.report);
      expect(view.evidence).toEqual(original.evidence);
      expect(f.readContext.mock.calls[0]?.[0].permissions).toEqual(
        f.agent.permissions,
      );
    });

    it("retains accepted SDK ACKs and immutable published evidence while a newer draft starts without current proof", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const accepted = await f.completeChecks();
      await f.publish();
      const published = await f.app.getPublishedArticle(f.customer, {
        articleId: f.articleId,
      });
      const acceptedEvidence = (
        await f.app.getEvidence(f.owner, { articleId: f.articleId })
      ).evidence;
      const immutableEvidence = (await allKnowledgeRows(f.backing)).filter(
        (row) => row.resourceId === f.articleId && row.kind === "evidence",
      );
      expect(immutableEvidence).toHaveLength(2);
      const old = accepted[0]!;
      const oldRequest = await f.verificationRequest(
        old.confirmed.ack,
        old.input.evidence,
      );
      const resetInput = {
        articleId: f.articleId,
        commandId: "retire-host-ledger",
        expectedLedgerEpoch: 1,
      };
      let state = await f.reports.reset(f.reviewer, resetInput);
      expect(state).toMatchObject({ ledgerEpoch: 2, status: "resetting" });
      expect(await f.reports.reset(f.reviewer, resetInput)).toEqual(state);
      expect(await f.reports.verifier.verify(oldRequest)).toBeNull();
      await expect(f.reports.report(f.agent, old.input)).rejects.toMatchObject({
        code: "ledger_epoch_changed",
      });
      await expect(
        f.reports.decide(f.reviewer, old.confirmed.input, "confirmed"),
      ).rejects.toMatchObject({ code: "ledger_epoch_changed" });
      await expect(
        f.reports.drain(f.reviewer, { articleId: f.articleId, ledgerEpoch: 1 }),
      ).rejects.toMatchObject({ code: "ledger_epoch_changed" });
      await expect(
        f.submit(old.confirmed.ack, old.input.evidence),
      ).rejects.toMatchObject(kbEvidenceRefusal);
      for (let page = 0; state.status === "resetting" && page < 4; page++)
        state = await f.reports.drain(f.reviewer, {
          articleId: f.articleId,
          ledgerEpoch: 2,
        });
      expect(state).toMatchObject({
        status: "active",
        reportsRemaining: 16,
        rowsRemaining: 159,
      });
      expect(await f.rows()).toHaveLength(1);
      expect(
        (await f.app.getEvidence(f.owner, { articleId: f.articleId })).evidence,
      ).toEqual(acceptedEvidence);
      f.advance(70_000);
      expect(
        (await f.app.getEvidence(f.owner, { articleId: f.articleId })).evidence,
      ).toEqual(acceptedEvidence);
      expect(
        await f.app.getPublishedArticle(f.customer, { articleId: f.articleId }),
      ).toEqual(published);
      await f.updateDraft();
      expect((await f.current()).revision.number).toBe(2);
      const replay = await f.app.submitEvidence(f.agent, old.submitted.input);
      expect(replay.replayed).toBe(true);
      expect(replay.value).toEqual(old.submitted.result.value);
      expect(
        (await f.app.getEvidence(f.owner, { articleId: f.articleId })).evidence,
      ).toEqual([]);
      expect(
        (await allKnowledgeRows(f.backing)).filter(
          (row) => row.resourceId === f.articleId && row.kind === "evidence",
        ),
      ).toEqual(immutableEvidence);
      expect(
        await f.app.getPublishedArticle(f.customer, { articleId: f.articleId }),
      ).toEqual(published);
      expect(await f.reports.verifier.verify(oldRequest)).toBeNull();
    });

    it("admits at most sixteen reports, then resets and drains only the real old ledger rows", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packets = [];
      const proof = await f.submission();
      for (let count = 0; count < 16; count++)
        packets.push(await f.report(proof));
      const full = await f.reports.ledger(f.agent, { articleId: f.articleId });
      expect(full.reportsRemaining).toBe(0);
      expect(await f.rows()).toHaveLength(49);
      const before = await f.rows();
      await expect(f.report()).rejects.toMatchObject({
        code: "report_capacity",
      });
      expect(await f.rows()).toEqual(before);
      const reset = await f.reports.reset(f.reviewer, {
        articleId: f.articleId,
        commandId: "reset-full-reports",
        expectedLedgerEpoch: 1,
      });
      expect(reset.rowsRemaining).toBe(48);
      await expect(
        f.reports.status(f.agent, f.key(packets[0]!.ack)),
      ).rejects.toMatchObject({ code: "ledger_epoch_changed" });
      const drained = await f.reports.drain(f.reviewer, {
        articleId: f.articleId,
        ledgerEpoch: 2,
      });
      expect(drained).toMatchObject({
        status: "active",
        reportsRemaining: 16,
        rowsRemaining: 159,
      });
      const drain = f.observed.transactions
        .filter((tx) => tx.collection === f.namespace)
        .at(-1)!;
      expect(
        drain.actions.filter((action) => action.action === "delete"),
      ).toHaveLength(48);
      expect(await f.rows()).toHaveLength(1);
      expect((await f.report()).ack.ledgerEpoch).toBe(2);
    });

    it("preserves reset capacity at the 160-row history ceiling and drains in no more than four 48-row batches", async () => {
      const f = await evidenceReportsHistoryFixture(await createStore());
      const { ack, proof, rows } = f.preparedHistory;
      const installed = f.observed.transactions.filter(
        (transaction) => transaction.collection === f.namespace,
      );
      expect(
        installed.map((transaction) => transaction.actions.length),
      ).toEqual([100, 60]);
      expect(
        new Set(installed.map((transaction) => transaction.partition)).size,
      ).toBe(1);
      expect(
        installed.every((transaction) =>
          transaction.actions.every((action) => action.action === "insert"),
        ),
      ).toBe(true);
      expect(await f.rows()).toEqual(rows);
      expect(rows).toHaveLength(160);
      const confirmed = await f.reports.read(f.reviewer, f.key(ack));
      expect(confirmed).toMatchObject({
        status: "confirmed",
        submittedBy: f.agent.principalId,
        evidence: proof,
        confirmation: { reviewerId: f.reviewer.principalId },
      });
      expect(
        await f.reports.verifier.verify(
          await f.verificationRequest(ack, proof),
        ),
      ).toMatchObject({ id: ack.receipt, verifiedBy: f.reviewer.principalId });
      expect(
        (await f.reports.ledger(f.agent, { articleId: f.articleId }))
          .rowsRemaining,
      ).toBe(0);
      const before = await f.rows();
      await expect(f.decide(ack, "pending")).rejects.toMatchObject({
        code: "report_capacity",
      });
      await expect(f.report(proof)).rejects.toMatchObject({
        code: "report_capacity",
      });
      expect(await f.rows()).toEqual(before);
      let state = await f.reports.reset(f.reviewer, {
        articleId: f.articleId,
        commandId: "reset-full-history",
        expectedLedgerEpoch: 1,
      });
      let batches = 0;
      while (state.status === "resetting" && batches < 4) {
        const beforeRows = (await f.rows()).length;
        state = await f.reports.drain(f.reviewer, {
          articleId: f.articleId,
          ledgerEpoch: 2,
        });
        expect(beforeRows - (await f.rows()).length).toBeLessThanOrEqual(48);
        batches++;
      }
      expect(batches).toBe(4);
      expect(state.status).toBe("active");
      expect(await f.rows()).toHaveLength(1);
      expect((await f.report()).ack.ledgerEpoch).toBe(2);
    });

    it("supports the existing explicit host namespace and fresh factory replacement without reinterpreting receipts", async () => {
      const f = await evidenceReportsFixture(await createStore(), {
        collectionName: "pegma-dev.knowledge-evidence.v1",
      });
      const packet = await f.report();
      const confirmed = await f.decide(packet.ack);
      const replacement = f.freshReports();
      expect(await replacement.status(f.agent, f.key(confirmed.ack))).toEqual({
        ...confirmed.ack,
        status: "confirmed",
      });
      expect(
        await replacement.verifier.verify(
          await f.verificationRequest(confirmed.ack, packet.input.evidence),
        ),
      ).toMatchObject({
        id: confirmed.ack.receipt,
        verifiedBy: f.reviewer.principalId,
      });
      await f.submit(confirmed.ack, packet.input.evidence);
    });

    it("round-trips slash, reserved-key and Unicode article identities through the default portable layout", async () => {
      const articleId = "article/export#?\\folder-雪-🧪";
      const f = await evidenceReportsFixture(await createStore(), {
        articleId,
      });
      const packet = await f.report();
      const confirmed = await f.decide(packet.ack);
      await f.submit(confirmed.ack, packet.input.evidence);
      expect(
        (await f.reports.read(f.reviewer, f.key(confirmed.ack))).articleId,
      ).toBe(articleId);
      const physical = await f.physicalRows();
      expect(physical).toHaveLength(6);
      expect(physical.every((item) => item.value.articleId === articleId)).toBe(
        true,
      );
      for (const item of physical) {
        expect(item.key.partition).not.toBe(articleId);
        expect(item.key.partition).not.toMatch(/[\/\\#?\u0000-\u001f\u007f]/u);
        expect(item.key.id).not.toMatch(/[\/\\#?\u0000-\u001f\u007f]/u);
      }
    });

    it("round-trips a maximum ASCII report beyond one native string property and qualifies its actual KB evidence", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packet = await maximumAsciiReport(f);
      const view = await f.reports.read(f.reviewer, f.key(packet.ack));
      expect(view.report).toEqual(packet.input.report);
      expect(view.evidence).toEqual(packet.input.evidence);
      const confirmed = await f.decide(packet.ack);
      const retained = (await f.physicalRows()).find((row) =>
        row.value.id.startsWith("report:"),
      )!;
      const bytes = new TextEncoder().encode(retained.value.payload).byteLength;
      expect(bytes).toBe(retained.value.payload.length);
      expect(retained.value.payload.length).toBeGreaterThan(32_768);
      expect(bytes).toBeLessThanOrEqual(60_000);
      const raw = await f.rawRows();
      expect(raw).toHaveLength((await f.physicalRows()).length);
      for (const row of raw) {
        expect(row.value).not.toHaveProperty("payload");
        for (const value of Object.values(row.value)) {
          expect(
            value === null ||
              ["string", "number", "boolean"].includes(typeof value),
          ).toBe(true);
          if (typeof value === "string")
            expect(value.length).toBeLessThanOrEqual(32_768);
        }
      }
      await f.submit(confirmed.ack, packet.input.evidence);
      const accepted = await f.app.getEvidence(f.reviewer, {
        articleId: f.articleId,
      });
      expect(accepted.evidence[0]?.steps).toEqual(packet.input.evidence.steps);
      expect(accepted.evidence[0]?.attestation.id).toBe(confirmed.ack.receipt);
      const workflow = await f.report(
        await f.submission("walkthrough-workflow"),
      );
      await f.submit(
        (await f.decide(workflow.ack)).ack,
        workflow.input.evidence,
      );
      await f.publish();
      expect(
        (
          await f.app.getPublishedArticle(f.customer, {
            articleId: f.articleId,
          })
        ).revision,
      ).toBe(1);
    });

    it.each(["missing", "extra", "count", "UTF8 bound"] as const)(
      "refuses %s corruption in actual portable chunks without accepting a previously valid receipt or writing rows",
      async (defect) => {
        const f = await evidenceReportsFixture(await createStore());
        const packet = await maximumAsciiReport(f);
        const confirmed = await f.decide(packet.ack);
        const request = await f.verificationRequest(
          confirmed.ack,
          packet.input.evidence,
        );
        expect(await f.reports.verifier.verify(request)).toMatchObject({
          id: confirmed.ack.receipt,
          verifiedBy: f.reviewer.principalId,
        });
        const saved = (await f.rawRows()).find(
          (row) =>
            typeof row.value.id === "string" &&
            row.value.id.startsWith("report:"),
        )!;
        if (typeof saved.value.partCount !== "number")
          throw new Error("Expected the actual portable chunk format");
        expect(saved.value.partCount).toBeGreaterThanOrEqual(3);
        const corrupted = { ...saved.value };
        if (defect === "missing") delete corrupted.part1;
        else if (defect === "extra") corrupted.part99 = "UNEXPECTED_PART";
        else if (defect === "count") corrupted.partCount = 7;
        else {
          // Every individual property remains portable; the joined UTF-8
          // payload exceeds the independent logical-record byte ceiling.
          for (let index = 0; index < 3; index++)
            corrupted["part" + index] = "雪".repeat(12_000);
        }
        expect(await f.replaceRaw(saved, corrupted)).toBe(true);
        const before = await f.rawRows();
        const writes = f.observed.transactions.length;
        await expect(
          f.reports.read(f.reviewer, f.key(confirmed.ack)),
        ).rejects.toMatchObject({
          ...unavailable,
          stage: "report_read",
          message: "Knowledge evidence report ledger is unavailable.",
        });
        expect(await f.reports.verifier.verify(request)).toBeNull();
        await expect(
          f.submit(confirmed.ack, packet.input.evidence),
        ).rejects.toMatchObject(kbEvidenceRefusal);
        expect(await f.rawRows()).toEqual(before);
        expect(f.observed.transactions).toHaveLength(writes);
        expect(JSON.stringify(f.logger.log.mock.calls)).not.toContain(
          packet.input.report.details,
        );
      },
    );

    it("preserves an explicitly selected compatible raw ledger and does not automatically detect it as portable", async () => {
      const f = await evidenceReportsFixture(await createStore(), {
        articleId: "historical-article",
        collectionName: "pegma-dev.knowledge-evidence.v1",
        storageLayout: "legacy-raw-v1",
      });
      const packet = await f.report();
      const confirmed = await f.decide(packet.ack);
      const before = await f.rows();
      const physical = await f.physicalRows();
      expect(
        physical.every(
          (item) =>
            item.key.partition === f.articleId && item.key.id === item.value.id,
        ),
      ).toBe(true);
      const retained = f.freshReports({ storageLayout: "legacy-raw-v1" });
      expect(await retained.status(f.agent, f.key(confirmed.ack))).toEqual({
        ...confirmed.ack,
        status: "confirmed",
      });
      expect(await retained.report(f.agent, packet.input)).toEqual(packet.ack);
      const request = await f.verificationRequest(
        confirmed.ack,
        packet.input.evidence,
      );
      expect(await retained.verifier.verify(request)).toMatchObject({
        id: confirmed.ack.receipt,
        verifiedBy: f.reviewer.principalId,
      });
      const portableProbe = f.freshReports({ storageLayout: "portable-v1" });
      expect(
        await portableProbe.ledger(f.agent, { articleId: f.articleId }),
      ).toMatchObject({ reportsRemaining: 16, ledgerEpoch: 1 });
      await expect(
        portableProbe.status(f.agent, f.key(packet.ack)),
      ).rejects.toMatchObject({ code: "report_not_found" });
      expect(await portableProbe.verifier.verify(request)).toBeNull();
      expect(await f.rows()).toEqual(before);
      await f.submit(confirmed.ack, packet.input.evidence);
    });

    it("keeps explicit raw-layout slash identities on compatible stores and refuses them on Azure without escaping or falling back", async () => {
      const f = await evidenceReportsFixture(await createStore(), {
        storageLayout: "legacy-raw-v1",
      });
      expect(f.articleId).toBe("article/export");
      if (backend === "Azurite") {
        await expect(f.report()).rejects.toMatchObject({
          ...unavailable,
          stage: "head_read",
        });
        expect(await f.rows()).toEqual([]);
      } else {
        const packet = await f.report();
        const confirmed = await f.decide(packet.ack);
        await f.submit(confirmed.ack, packet.input.evidence);
        expect(
          (await f.physicalRows()).every(
            (item) => item.key.partition === f.articleId,
          ),
        ).toBe(true);
        expect(
          await f
            .freshReports({ storageLayout: "legacy-raw-v1" })
            .status(f.agent, f.key(confirmed.ack)),
        ).toEqual({ ...confirmed.ack, status: "confirmed" });
      }
    });

    it.each(["legacy-raw-v1", "portable-v1"] as const)(
      "refuses a nonempty headless %s partition without changing opaque unversioned history",
      async (storageLayout) => {
        const f = await evidenceReportsFixture(await createStore(), {
          articleId: "historical-article",
          storageLayout,
        });
        const input = await f.reportInput();
        const reportId = "00000000-0000-4000-8000-000000000001";
        const commandId = "a".repeat(64);
        // These are opaque pre-epoch logical envelopes, not output from an old
        // producer invocation and not a migration or valid report attestation.
        const rows = [
          "report:" + reportId,
          "command:" + commandId,
          "audit:command:" + commandId,
        ].map((id) => ({
          articleId: f.articleId,
          id,
          payload: JSON.stringify({
            articleId: f.articleId,
            reportId,
            opaque: "PRE_EPOCH_PRIVATE_HISTORY",
          }),
        }));
        for (const row of rows)
          expect((await f.insertOpaqueRow(row)).inserted).toBe(true);
        const before = await f.rawRows();
        expect(before).toHaveLength(3);
        expect(before.some((row) => row.value.id === "head")).toBe(false);
        if (storageLayout === "legacy-raw-v1") {
          for (const row of before) {
            expect(Object.keys(row.value).sort()).toEqual([
              "articleId",
              "id",
              "payload",
            ]);
            expect(row.key).toEqual({
              partition: f.articleId,
              id: row.value.id,
            });
          }
        }
        const writes = f.observed.transactions.length;
        for (const operation of [
          () => f.reports.ledger(f.agent, { articleId: f.articleId }),
          () => f.reports.report(f.agent, input),
          () =>
            f.reports.reset(f.reviewer, {
              articleId: f.articleId,
              commandId: "refuse-headless-reset",
              expectedLedgerEpoch: 1,
            }),
          () =>
            f.reports.drain(f.reviewer, {
              articleId: f.articleId,
              ledgerEpoch: 1,
            }),
        ]) {
          await expect(operation()).rejects.toMatchObject({
            ...unavailable,
            stage: "head_partition_orphaned",
            message: "Knowledge evidence report ledger is unavailable.",
          });
          expect(await f.rawRows()).toEqual(before);
          expect(f.observed.transactions).toHaveLength(writes);
        }
      },
    );

    it("admits a genuinely empty article partition while another article already has report history", async () => {
      const f = await evidenceReportsFixture(await createStore());
      await f.report();
      const existing = await f.rawRows();
      const articleId = "article/second-export";
      await f.app.createDraft(f.agent, {
        ...f.command("second-report-article", 0),
        articleId,
        collectionId: f.collectionId,
        draft: draft("walkthrough"),
      });
      f.advance(2_000);
      const current = await f.app.getDraft(f.agent, { articleId });
      const ledger = await f.reports.ledger(f.agent, { articleId });
      expect(ledger).toMatchObject({
        articleId,
        ledgerEpoch: 1,
        reportsRemaining: 16,
        rowsRemaining: 159,
      });
      const accepted = await f.reports.report(f.agent, {
        commandId: "first-report-for-second-article",
        articleId,
        ledgerEpoch: ledger.ledgerEpoch,
        evidence: evidence(current.revision),
        report: {
          summary: "Second synthetic export report",
          details: "Independent empty article partition admission",
        },
      });
      expect(
        await f.reports.status(f.agent, {
          articleId,
          ledgerEpoch: accepted.ledgerEpoch,
          reportId: accepted.reportId,
        }),
      ).toEqual({ ...accepted, status: "pending" });
      expect(await f.rawRows()).toEqual(existing);
    });

    it("isolates identical article inputs in independently declared report namespaces", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const first = await f.report();
      const other = f.freshReports({
        collectionName: "observatory.knowledge-reports.v1",
      });
      const second = await other.report(f.agent, first.input);
      expect(second.reportId).not.toBe(first.ack.reportId);
      await expect(
        other.status(f.agent, f.key(first.ack)),
      ).rejects.toMatchObject({ code: "report_not_found" });
      await expect(
        f.reports.status(f.agent, f.key(second)),
      ).rejects.toMatchObject({ code: "report_not_found" });
      expect(await f.rows()).toHaveLength(4);
    });

    it("validates required configuration, reserved KB namespaces and human-only permission names", async () => {
      const f = await evidenceReportsFixture(await createStore());
      for (const collectionName of [
        "",
        "../reports",
        "reports/name",
        "a".repeat(129),
        "knowledge-base.records.v1",
        "knowledge-base.retrieval.v1",
      ])
        expect(() => f.freshReports({ collectionName })).toThrowError(
          KnowledgeEvidenceReportsError,
        );
      for (const permission of [
        "",
        "human permission",
        "Human.confirm",
        "a".repeat(256),
        knowledgePermissions.draftRead,
        knowledgePermissions.draftWrite,
        knowledgePermissions.evidenceSubmit,
      ])
        expect(() =>
          f.freshReports({ confirmationPermission: permission }),
        ).toThrowError(KnowledgeEvidenceReportsError);
      for (const storageLayout of [null, "automatic", "legacy"])
        expect(() =>
          Reflect.apply(createKnowledgeEvidenceReports, undefined, [
            {
              ...f.baseOptions,
              storageLayout,
            },
          ]),
        ).toThrowError(KnowledgeEvidenceReportsError);
      for (const field of ["clock", "store", "resolvePrincipal", "readContext"])
        expect(() =>
          Reflect.apply(createKnowledgeEvidenceReports, undefined, [
            {
              ...f.baseOptions,
              [field]: undefined,
            },
          ]),
        ).toThrowError(KnowledgeEvidenceReportsError);
      expect(await f.rows()).toEqual([]);
    });

    it("rejects unknown runtime command fields and oversized reports without appending ledger rows", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const input = await f.reportInput();
      await expect(
        Reflect.apply(f.reports.report, f.reports, [
          f.agent,
          {
            ...input,
            passed: true,
          },
        ]),
      ).rejects.toMatchObject({ code: "invalid_request" });
      await expect(
        f.reports.report(f.agent, {
          ...input,
          report: { ...input.report, details: "x".repeat(16_001) },
        }),
      ).rejects.toMatchObject({ code: "invalid_request" });
      await expect(
        f.reports.report(f.agent, {
          ...input,
          evidence: {
            ...input.evidence,
            steps: Array.from({ length: 16 }, () => '"'.repeat(1_000)),
          },
          report: { ...input.report, details: '"'.repeat(16_000) },
        }),
      ).rejects.toMatchObject({ code: "report_too_large" });
      expect(await f.rows()).toEqual([]);
    });

    it.each(["principal", "context"] as const)(
      "sanitizes a failed %s port without trusting its exception or losing confirmation history",
      async (port) => {
        const f = await evidenceReportsFixture(await createStore());
        const packet = await f.report();
        const confirmed = await f.decide(packet.ack);
        const request = await f.verificationRequest(
          confirmed.ack,
          packet.input.evidence,
        );
        const before = await f.rows();
        const canary = "PRIVATE_EXTERNAL_PORT_EXCEPTION";
        if (port === "principal")
          f.hooks.beforeResolve = async () => {
            throw new Error(canary);
          };
        else
          f.hooks.afterContext = async () => {
            throw new Error(canary);
          };
        await expect(
          f.reports.read(f.reviewer, f.key(packet.ack)),
        ).rejects.toMatchObject({
          ...unavailable,
          stage: port === "principal" ? "principal_resolve" : "context_read",
          message: "Knowledge evidence report ledger is unavailable.",
        });
        expect(await f.reports.verifier.verify(request)).toBeNull();
        expect(await f.rows()).toEqual(before);
        expect(JSON.stringify(f.logger.log.mock.calls)).not.toContain(canary);
      },
    );

    it.each(["articleId", "ledgerEpoch", "reportId"] as const)(
      "refuses a payload-only %s mismatch during list without returning hints or writing rows",
      async (field) => {
        const f = await evidenceReportsFixture(await createStore());
        const packet = await f.report();
        const rows = await f.physicalRows();
        const saved = rows.find((item) => item.value.id.startsWith("report:"))!;
        const head = rows.find((item) => item.value.id === "head")!;
        const payload = JSON.parse(saved.value.payload);
        payload[field] =
          field === "ledgerEpoch"
            ? packet.ack.ledgerEpoch + 1
            : field === "articleId"
              ? "article/other"
              : "different-report-id";
        expect(
          await f.replaceRow(saved, {
            ...saved.value,
            payload: JSON.stringify(payload),
          }),
        ).toBe(true);
        const before = await f.physicalRows();
        expect(before.find((item) => item.value.id === "head")).toEqual(head);
        expect(before).toHaveLength(rows.length);
        expect(
          before.find((item) => item.value.id === saved.value.id)?.key,
        ).toEqual(saved.key);
        const writes = f.observed.transactions.length;
        await expect(
          f.reports.list(f.reviewer, { articleId: f.articleId }),
        ).rejects.toMatchObject({
          ...unavailable,
          stage: "report_identity",
          message: "Knowledge evidence report ledger is unavailable.",
        });
        expect(await f.physicalRows()).toEqual(before);
        expect(f.observed.transactions).toHaveLength(writes);
      },
    );

    it("detects a changed stored report body rather than treating a previously issued receipt as authority", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packet = await f.report();
      const confirmed = await f.decide(packet.ack);
      const stored = (await f.physicalRows()).find((row) =>
        row.value.id.startsWith("report:"),
      )!;
      const value = JSON.parse(stored.value.payload);
      value.report.details = "CORRUPTED_UNREVIEWED_ARTIFACT";
      expect(
        await f.replaceRow(stored, {
          ...stored.value,
          payload: JSON.stringify(value),
        }),
      ).toBe(true);
      expect(
        await f.reports.verifier.verify(
          await f.verificationRequest(confirmed.ack, packet.input.evidence),
        ),
      ).toBeNull();
      await expect(
        f.submit(confirmed.ack, packet.input.evidence),
      ).rejects.toMatchObject(kbEvidenceRefusal);
    });

    it("maps corrupt real stored heads and dependency failures to safe domain stages", async () => {
      const f = await evidenceReportsFixture(await createStore());
      const packet = await f.report();
      const confirmed = await f.decide(packet.ack);
      const request: EvidenceVerificationRequest = await f.verificationRequest(
        confirmed.ack,
        packet.input.evidence,
      );
      const canary = "PRIVATE_DEPENDENCY_OR_ROW_BODY";
      f.observed.beforeRead(async (trace) => {
        if (trace.collection === f.namespace) throw new Error(canary);
      });
      await expect(
        f.reports.ledger(f.agent, { articleId: f.articleId }),
      ).rejects.toMatchObject({
        ...unavailable,
        stage: "head_read",
        message: "Knowledge evidence report ledger is unavailable.",
      });
      f.logger.log.mockImplementation(() => {
        throw new Error("PRIVATE_LOGGER_FAILURE");
      });
      expect(await f.reports.verifier.verify(request)).toBeNull();
      f.observed.beforeRead(undefined);
      const head = (await f.physicalRows()).find(
        (row) => row.value.id === "head",
      )!;
      expect(
        await f.replaceRow(head, {
          ...head.value,
          payload: JSON.stringify({ body: canary }),
        }),
      ).toBe(true);
      await expect(
        f.reports.ledger(f.agent, { articleId: f.articleId }),
      ).rejects.toMatchObject({
        ...unavailable,
        stage: "head_decode",
        message: "Knowledge evidence report ledger is unavailable.",
      });
      expect(await f.reports.verifier.verify(request)).toBeNull();
      expect(JSON.stringify(f.logger.log.mock.calls)).not.toContain(canary);
    });
  });
}
