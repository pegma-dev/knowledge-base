import {
  type KnowledgeAuthoringContextObservation,
  type KnowledgeReportAcknowledgement,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import type { AccessContext } from "@pegma/authorization-core";
import type { Store } from "@pegma/storage-core";
import { describe, expect, it, vi } from "vitest";
import { access } from "../test/application-fixtures.js";
import { storeFactories } from "../test/application-stores.js";
import {
  confirmationPermission,
  evidenceReportsFixture,
} from "../test/evidence-reports-fixtures.js";

async function queryFixture(backing: Store, optimized = true) {
  const f = await evidenceReportsFixture(backing);
  const hooks: { beforeConfirm?: () => Promise<void> } = {};
  const authoringContext = {
    getAuthoringContext: vi.fn(f.app.getAuthoringContext),
    confirmAuthoringContext: vi.fn(
      async (
        caller: AccessContext,
        observation: KnowledgeAuthoringContextObservation,
      ) => {
        await hooks.beforeConfirm?.();
        return f.app.confirmAuthoringContext(caller, observation);
      },
    ),
  };
  const reports = f.freshReports(optimized ? { authoringContext } : {});
  async function packet() {
    const current = await f.current();
    const input = {
      ...(await f.reportInput()),
      expectedArticleGeneration: current.generation,
    };
    return { input, ack: await reports.report(f.agent, input) };
  }
  async function decision(
    ack: KnowledgeReportAcknowledgement,
    status: "confirmed" | "pending" = "confirmed",
  ) {
    const view = await reports.read(f.reviewer, f.key(ack));
    return {
      ...f.key(ack),
      commandId: f.command("query-" + status, 0).commandId,
      expectedReportGeneration: view.expectedReportGeneration,
      reviewBindingHash: view.reviewBindingHash,
    };
  }
  return {
    ...f,
    reports,
    authoringContext,
    queryHooks: hooks,
    packet,
    decision,
  };
}

for (const [backend, createStore] of storeFactories) {
  describe(`body-free governed report query over ${backend}`, () => {
    it("discovers the current target and polls pending/confirmed status without private data or writes", async () => {
      const f = await queryFixture(await createStore());
      const packet = await f.packet();
      const before = f.observed.transactions.length;
      const query = {
        articleId: f.articleId,
        status: {
          ledgerEpoch: packet.ack.ledgerEpoch,
          reportId: packet.ack.reportId,
        },
      };
      const pending = await f.reports.query(f.agent, query);
      expect(pending.target).toEqual({
        articleId: f.articleId,
        generation: (await f.current()).generation,
        collectionId: f.collectionId,
        kind: "walkthrough",
      });
      expect(pending.status).toEqual({ ...packet.ack, status: "pending" });
      expect(f.observed.transactions).toHaveLength(before);
      for (const privateValue of [
        packet.input.report.details,
        "PRIVATE_STAFF_EVIDENCE",
        f.reviewer.principalId,
        "trustedAttesterIds",
        "reportHash",
        "reviewBindingHash",
      ]) {
        expect(JSON.stringify(pending)).not.toContain(privateValue);
      }
      expect(f.readContext).not.toHaveBeenCalled();
      await f.reports.decide(
        f.reviewer,
        await f.decision(packet.ack),
        "confirmed",
      );
      const confirmed = await f.reports.query(f.agent, query);
      expect(confirmed.status).toEqual({
        ...packet.ack,
        reportGeneration: 2,
        status: "confirmed",
      });
      expect(
        (await f.app.getEvidence(f.reviewer, { articleId: f.articleId }))
          .evidence,
      ).toEqual([]);
      const discovery = await f.reports.query(f.agent, {
        articleId: f.articleId,
      });
      expect(discovery.status).toBeUndefined();
      expect(discovery.ledger.status).toBe("active");
    });

    it("requires draftRead AND evidenceSubmit and never promotes a restricted caller to its owner", async () => {
      const f = await queryFixture(await createStore());
      for (const permissions of [
        [knowledgePermissions.draftRead],
        [knowledgePermissions.evidenceSubmit],
        [knowledgePermissions.draftRead, knowledgePermissions.draftWrite],
      ]) {
        const before = f.observed.reads.length;
        await expect(
          f.reports.query(access(f.agent.principalId, permissions), {
            articleId: f.articleId,
          }),
        ).rejects.toMatchObject({ code: "forbidden" });
        expect(f.observed.reads).toHaveLength(before);
      }
      const result = await f.reports.query(f.agent, { articleId: f.articleId });
      expect(result.status).toBeUndefined();
      expect(
        f.authoringContext.getAuthoringContext.mock.calls.at(-1)?.[0]
          .permissions,
      ).toEqual(f.agent.permissions);
      expect(f.agent.permissions).toHaveLength(3);
    });

    it("hides another submitter's status while allowing the same public ledger discovery", async () => {
      const f = await queryFixture(await createStore());
      const packet = await f.packet();
      const before = await f.rows();
      await expect(
        f.reports.query(f.otherAgent, {
          articleId: f.articleId,
          status: {
            ledgerEpoch: packet.ack.ledgerEpoch,
            reportId: packet.ack.reportId,
          },
        }),
      ).rejects.toMatchObject({ code: "report_not_found" });
      expect(
        (await f.reports.query(f.otherAgent, { articleId: f.articleId })).ledger
          .ledgerEpoch,
      ).toBe(packet.ack.ledgerEpoch);
      expect(await f.rows()).toEqual(before);
    });

    it.each([false, true])(
      "keeps old context fallback and historical exact report replay (optimized=%s)",
      async (optimized) => {
        const f = await queryFixture(await createStore(), optimized);
        const packet = await f.packet();
        const original = await f.decision(packet.ack);
        const confirmed = await f.reports.decide(
          f.reviewer,
          original,
          "confirmed",
        );
        await f.updateDraft();
        const before = await f.rows();
        const contextCalls =
          f.authoringContext.getAuthoringContext.mock.calls.length;
        await expect(f.reports.report(f.agent, packet.input)).resolves.toEqual(
          packet.ack,
        );
        await expect(
          f.reports.decide(f.reviewer, original, "confirmed"),
        ).resolves.toEqual(confirmed);
        expect(await f.rows()).toEqual(before);
        expect(f.authoringContext.getAuthoringContext).toHaveBeenCalledTimes(
          contextCalls,
        );
        const fresh = await f.reports.query(f.agent, {
          articleId: f.articleId,
        });
        expect(fresh.target.generation).toBe((await f.current()).generation);
        if (!optimized)
          expect(f.readContext.mock.calls.length).toBeGreaterThanOrEqual(2);
      },
    );

    it("returns resetting ledger metadata but refuses old-epoch status and never rearms a report", async () => {
      const f = await queryFixture(await createStore());
      const packet = await f.packet();
      await f.reports.reset(f.reviewer, {
        articleId: f.articleId,
        commandId: "query-reset",
        expectedLedgerEpoch: packet.ack.ledgerEpoch,
      });
      const before = await f.rows();
      const result = await f.reports.query(f.agent, { articleId: f.articleId });
      expect(result.ledger).toMatchObject({
        ledgerEpoch: packet.ack.ledgerEpoch + 1,
        status: "resetting",
      });
      await expect(
        f.reports.query(f.agent, {
          articleId: f.articleId,
          status: {
            ledgerEpoch: packet.ack.ledgerEpoch,
            reportId: packet.ack.reportId,
          },
        }),
      ).rejects.toMatchObject({ code: "ledger_epoch_changed" });
      expect(await f.rows()).toEqual(before);
    });

    it.each(["confirmed", "pending"] as const)(
      "refuses a %s decision/reassessment between the first and final report observations",
      async (transition) => {
        const f = await queryFixture(await createStore());
        const packet = await f.packet();
        if (transition === "pending")
          await f.reports.decide(
            f.reviewer,
            await f.decision(packet.ack),
            "confirmed",
          );
        const command = await f.decision(packet.ack, transition);
        const row = (await f.physicalRows()).find((item) =>
          item.value.id.startsWith("report:"),
        );
        if (row === undefined)
          throw new Error("Expected the factory's actual report key.");
        let reads = 0;
        f.observed.beforeRead(async ({ collection, key }) => {
          if (
            collection !== f.namespace ||
            key.partition !== row.key.partition ||
            key.id !== row.key.id
          )
            return;
          reads += 1;
          if (reads !== 2) return;
          f.observed.beforeRead(undefined);
          await f.reports.decide(f.reviewer, command, transition);
        });
        await expect(
          f.reports.query(f.agent, {
            articleId: f.articleId,
            status: {
              ledgerEpoch: packet.ack.ledgerEpoch,
              reportId: packet.ack.reportId,
            },
          }),
        ).rejects.toMatchObject({ code: "report_changed" });
        expect(reads).toBe(2);
      },
    );

    it("refuses a reset observed at the second ledger read", async () => {
      const f = await queryFixture(await createStore());
      const packet = await f.packet();
      const row = (await f.physicalRows()).find(
        (item) => item.value.id === "head",
      );
      if (row === undefined)
        throw new Error("Expected the factory's actual head key.");
      let heads = 0;
      f.observed.beforeRead(async ({ collection, key }) => {
        if (
          collection !== f.namespace ||
          key.partition !== row.key.partition ||
          key.id !== row.key.id
        )
          return;
        heads += 1;
        if (heads !== 2) return;
        f.observed.beforeRead(undefined);
        await f.reports.reset(f.reviewer, {
          articleId: f.articleId,
          commandId: "reset-query-race",
          expectedLedgerEpoch: packet.ack.ledgerEpoch,
        });
      });
      await expect(
        f.reports.query(f.agent, {
          articleId: f.articleId,
          status: {
            ledgerEpoch: packet.ack.ledgerEpoch,
            reportId: packet.ack.reportId,
          },
        }),
      ).rejects.toMatchObject({ code: "ledger_epoch_changed" });
      expect(heads).toBe(2);
    });

    it("conflicts on changed governed facts during the query without a new context fallback", async () => {
      const f = await queryFixture(await createStore());
      f.queryHooks.beforeConfirm = async () => {
        await f.updateDraft();
      };
      const before = f.authoringContext.getAuthoringContext.mock.calls.length;
      await expect(
        f.reports.query(f.agent, { articleId: f.articleId }),
      ).rejects.toMatchObject({ code: "report_changed" });
      expect(f.authoringContext.getAuthoringContext).toHaveBeenCalledTimes(
        before + 1,
      );
      expect(f.readContext).not.toHaveBeenCalled();
    });

    it("withholds query output when current principal resolution loses the required grant", async () => {
      const f = await queryFixture(await createStore());
      let resolutions = 0;
      f.hooks.beforeResolve = async (id) => {
        if (id !== f.agent.principalId) return;
        resolutions += 1;
        if (resolutions === 2)
          f.principals.set(
            id,
            access(
              id,
              f.owner.permissions.filter(
                (permission) =>
                  permission !== knowledgePermissions.evidenceSubmit,
              ),
            ),
          );
      };
      const before = await f.rows();
      await expect(
        f.reports.query(f.agent, { articleId: f.articleId }),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(await f.rows()).toEqual(before);
    });

    it.each([
      confirmationPermission,
      knowledgePermissions.draftRead,
      knowledgePermissions.evidenceRead,
    ])(
      "refuses a decision when %s is revoked during metadata-only confirmation",
      async (permission) => {
        const f = await queryFixture(await createStore());
        const packet = await f.packet();
        const command = await f.decision(packet.ack);
        const before = await f.rows();
        f.queryHooks.beforeConfirm = async () => {
          f.principals.set(
            f.reviewer.principalId,
            access(
              f.reviewer.principalId,
              f.reviewer.permissions.filter((value) => value !== permission),
            ),
          );
        };
        await expect(
          f.reports.decide(f.reviewer, command, "confirmed"),
        ).rejects.toMatchObject({ code: "forbidden" });
        expect(await f.rows()).toEqual(before);
      },
    );

    it("withholds a committed decision ACK on revocation and recovers its exact historical result without new reads or rows", async () => {
      const f = await queryFixture(await createStore());
      const packet = await f.packet();
      const command = await f.decision(packet.ack);
      f.observed.intercept(async (trace, commit) => {
        const result = await commit();
        if (trace.collection === f.namespace && result.committed) {
          f.observed.intercept(undefined);
          f.principals.delete(f.reviewer.principalId);
        }
        return result;
      });
      await expect(
        f.reports.decide(f.reviewer, command, "confirmed"),
      ).rejects.toMatchObject({ code: "forbidden" });
      const stored = await f.rows();
      expect(
        stored.some(
          (row) =>
            row.id.startsWith("report:") &&
            JSON.parse(row.payload).status === "confirmed",
        ),
      ).toBe(true);
      f.principals.set(f.reviewer.principalId, structuredClone(f.reviewer));
      const before = f.authoringContext.getAuthoringContext.mock.calls.length;
      await expect(
        f.reports.decide(f.reviewer, command, "confirmed"),
      ).resolves.toEqual({ ...packet.ack, reportGeneration: 2 });
      expect(await f.rows()).toEqual(stored);
      expect(f.authoringContext.getAuthoringContext).toHaveBeenCalledTimes(
        before,
      );
    });
  });
}
