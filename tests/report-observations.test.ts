import {
  createKnowledgeEvidenceReports,
  type KnowledgeReportObservation,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import type {
  CollectionDefinition,
  EntityKey,
  Store,
} from "@pegma/storage-core";
import { describe, expect, it } from "vitest";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import {
  confirmationPermission,
  evidenceReportsFixture,
  reportBarrier,
} from "../test/evidence-reports-fixtures.js";

type Fixture = Awaited<ReturnType<typeof evidenceReportsFixture>>;

function afterReadStore(
  backing: Store,
  afterRead: (collection: string, key: EntityKey) => Promise<void>,
): Store {
  return {
    collection<T>(definition: CollectionDefinition<T>) {
      const target = backing.collection(definition);
      return new Proxy(target, {
        get(object, property) {
          if (property === "getVersioned")
            return async (key: EntityKey) => {
              const result = await object.getVersioned(key);
              await afterRead(definition.name, key);
              return result;
            };
          const value: unknown = Reflect.get(object, property, object);
          return typeof value === "function" ? value.bind(object) : value;
        },
      });
    },
  };
}

async function prepared(createStore: () => Store | Promise<Store>) {
  const f = await evidenceReportsFixture(await createStore());
  const packet = await f.report();
  const confirmed = await f.decide(packet.ack);
  const hooks: {
    afterContext?: () => Promise<void>;
    afterConfirm?: () => Promise<void>;
    afterRead?: (collection: string, key: EntityKey) => Promise<void>;
  } = {};
  let contextReads = 0;
  const options = {
    ...f.baseOptions,
    store: afterReadStore(f.baseOptions.store, async (collection, key) => {
      await hooks.afterRead?.(collection, key);
    }),
    authoringContext: {
      async getAuthoringContext(
        ...args: Parameters<Fixture["app"]["getAuthoringContext"]>
      ) {
        contextReads++;
        const value = await f.app.getAuthoringContext(...args);
        await hooks.afterContext?.();
        return value;
      },
      async confirmAuthoringContext(
        ...args: Parameters<Fixture["app"]["confirmAuthoringContext"]>
      ) {
        await f.app.confirmAuthoringContext(...args);
        await hooks.afterConfirm?.();
      },
    },
  };
  const reports = createKnowledgeEvidenceReports(options);
  const observations = reports.observations;
  expect(observations).toBeDefined();
  if (observations === undefined) throw new Error("Observation port missing");
  return {
    ...f,
    packet,
    confirmed,
    reports,
    observations,
    hooks,
    contextReads: () => contextReads,
    fresh: () => createKnowledgeEvidenceReports(options),
  };
}

for (const [backend, createStore] of storeFactories) {
  describe(`operation-local report observations over ${backend}`, () => {
    it("keeps the capability absent without the actual governed context pair", async () => {
      const f = await evidenceReportsFixture(await createStore());
      expect(f.reports.observations).toBeUndefined();
      const packet = await f.report();
      expect(await f.reports.read(f.reviewer, f.key(packet.ack))).toMatchObject(
        {
          status: "pending",
          receipt: packet.ack.receipt,
        },
      );
    });

    it("returns the real report and complete private context without writing, then confirms once", async () => {
      const f = await prepared(createStore);
      const before = await allKnowledgeRows(f.backing);
      const rows = await f.rawRows();
      const legacy = await f.reports.read(f.owner, f.key(f.confirmed.ack));
      const observed = await f.observations.observe(
        f.owner,
        f.key(f.confirmed.ack),
      );
      expect(observed.view).toEqual(legacy);
      expect(observed.context).toEqual(
        (
          await f.app.getAuthoringContext(f.owner, {
            articleId: f.articleId,
            includeEvidence: true,
          })
        ).context,
      );
      expect(JSON.stringify(observed.observation)).toBe("{}");
      expect(
        await f.observations.confirm(f.owner, observed.observation),
      ).toEqual({
        receipt: f.confirmed.ack.receipt,
        attestation: null,
      });
      await expect(
        f.observations.confirm(f.owner, observed.observation),
      ).rejects.toMatchObject({ code: "invalid_request" });
      expect(await f.rawRows()).toEqual(rows);
      expect(await allKnowledgeRows(f.backing)).toEqual(before);
    });

    it("reuses the actual owner verifier predicates and its already-observed context", async () => {
      const f = await prepared(createStore);
      const request = await f.verificationRequest(
        f.confirmed.ack,
        f.packet.input.evidence,
      );
      const expected = await f.reports.verifier.verify(request);
      expect(expected).not.toBeNull();
      const observed = await f.observations.observe(
        f.owner,
        f.key(f.confirmed.ack),
      );
      const count = f.contextReads();
      expect(
        await f.observations.confirm(f.owner, observed.observation, request),
      ).toEqual({ receipt: f.confirmed.ack.receipt, attestation: expected });
      expect(f.contextReads()).toBe(count);
      expect(
        await f.reports.status(f.agent, f.key(f.confirmed.ack)),
      ).toMatchObject({
        receipt: f.confirmed.ack.receipt,
        status: "confirmed",
      });
    });

    it("allows a different current staff reader without impersonating the report submitter", async () => {
      const f = await prepared(createStore);
      const observed = await f.observations.observe(
        f.reviewer,
        f.key(f.confirmed.ack),
      );
      expect(
        await f.observations.confirm(f.reviewer, observed.observation),
      ).toEqual({
        receipt: f.confirmed.ack.receipt,
        attestation: null,
      });
      const request = await f.verificationRequest(
        f.confirmed.ack,
        f.packet.input.evidence,
      );
      const second = await f.observations.observe(
        f.reviewer,
        f.key(f.confirmed.ack),
      );
      await expect(
        f.observations.confirm(f.reviewer, second.observation, request),
      ).rejects.toMatchObject({ code: "report_not_verifiable" });
      await expect(
        f.reports.status(f.reviewer, f.key(f.confirmed.ack)),
      ).rejects.toMatchObject({
        code: "report_not_found",
      });
    });

    it.each(["clone", "foreign instance", "wrong actor"] as const)(
      "refuses a %s handle without consuming the original actor's observation",
      async (kind) => {
        const f = await prepared(createStore);
        const observed = await f.observations.observe(
          f.owner,
          f.key(f.confirmed.ack),
        );
        const before = f.observed.reads.length;
        const promise =
          kind === "clone"
            ? f.observations.confirm(
                f.owner,
                structuredClone(observed.observation),
              )
            : kind === "foreign instance"
              ? f.fresh().observations!.confirm(f.owner, observed.observation)
              : f.observations.confirm(f.reviewer, observed.observation);
        await expect(promise).rejects.toMatchObject({
          code: kind === "wrong actor" ? "forbidden" : "invalid_request",
        });
        expect(f.observed.reads).toHaveLength(before);
        await expect(
          f.observations.confirm(f.owner, observed.observation),
        ).resolves.toMatchObject({
          receipt: f.confirmed.ack.receipt,
        });
      },
    );

    it("consumes before awaited confirmation so concurrent calls cannot reuse it", async () => {
      const f = await prepared(createStore);
      const observed = await f.observations.observe(
        f.owner,
        f.key(f.confirmed.ack),
      );
      const results = await Promise.allSettled([
        f.observations.confirm(f.owner, observed.observation),
        f.observations.confirm(f.owner, observed.observation),
      ]);
      expect(results.map((value) => value.status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      expect(
        results.find((value) => value.status === "rejected"),
      ).toMatchObject({
        reason: { code: "invalid_request" },
      });
    });

    it("checks current staff again after private context reads before disclosure", async () => {
      const f = await prepared(createStore);
      f.hooks.afterContext = async () => {
        f.principals.delete(f.owner.principalId);
      };
      await expect(
        f.observations.observe(f.owner, f.key(f.confirmed.ack)),
      ).rejects.toMatchObject({
        code: "forbidden",
      });
    });

    it("refreshes a distinct reviewer after the private context observation", async () => {
      const f = await prepared(createStore);
      f.hooks.afterContext = async () => {
        f.principals.delete(f.reviewer.principalId);
      };
      await expect(
        f.observations.observe(f.owner, f.key(f.confirmed.ack)),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it.each(["actor", "reviewer"] as const)(
      "checks fresh %s authority after the actual resource confirmation",
      async (who) => {
        const f = await prepared(createStore);
        const observed = await f.observations.observe(
          f.owner,
          f.key(f.confirmed.ack),
        );
        f.hooks.afterConfirm = async () => {
          const subject = who === "actor" ? f.owner : f.reviewer;
          f.principals.set(subject.principalId, {
            ...subject,
            permissions: subject.permissions.filter(
              (value) => value !== confirmationPermission,
            ),
          });
        };
        await expect(
          f.observations.confirm(f.owner, observed.observation),
        ).rejects.toMatchObject({
          code: "forbidden",
        });
        await expect(
          f.observations.confirm(f.owner, observed.observation),
        ).rejects.toMatchObject({
          code: "invalid_request",
        });
      },
    );

    it.each(["draft", "governance", "source", "accepted evidence"] as const)(
      "refuses changed %s heads with no synthesized confirmation",
      async (change) => {
        const f = await prepared(createStore);
        const observed = await f.observations.observe(
          f.owner,
          f.key(f.confirmed.ack),
        );
        if (change === "draft") await f.updateDraft();
        else if (change === "governance")
          await f.configure({ expectedStagingBuildId: "changed-build" });
        else if (change === "source")
          await f.app.setProvenance(f.owner, {
            ...f.command(
              "change-observed-source",
              (await f.current()).generation,
            ),
            articleId: f.articleId,
            references: [],
          });
        else await f.submit(f.confirmed.ack, f.packet.input.evidence);
        await expect(
          f.observations.confirm(f.owner, observed.observation),
        ).rejects.toMatchObject({
          code: "report_changed",
        });
      },
    );

    it("retains complete revocation history and refuses a revoked accepted proof", async () => {
      const f = await prepared(createStore);
      await f.submit(f.confirmed.ack, f.packet.input.evidence);
      const accepted = (
        await f.app.getEvidence(f.owner, { articleId: f.articleId })
      ).evidence[0]!;
      const observed = await f.observations.observe(
        f.owner,
        f.key(f.confirmed.ack),
      );
      await f.app.revokeEvidence(f.owner, {
        ...f.command(
          "revoke-observed-evidence",
          (await f.current()).generation,
        ),
        articleId: f.articleId,
        articleRevision: accepted.articleRevision,
        evidenceId: accepted.id,
        evidenceVersion: accepted.version,
        evidenceHash: accepted.hash,
        reason: "Synthetic current execution revoked",
      });
      await expect(
        f.observations.confirm(f.owner, observed.observation),
      ).rejects.toMatchObject({ code: "report_changed" });
      await expect(
        f.observations.observe(f.owner, f.key(f.confirmed.ack)),
      ).rejects.toMatchObject({ code: "report_not_verifiable" });
    });

    it("refuses report reassessment after observing the confirmed cycle", async () => {
      const f = await prepared(createStore);
      const observed = await f.observations.observe(
        f.owner,
        f.key(f.confirmed.ack),
      );
      await f.decide(f.confirmed.ack, "pending");
      await expect(
        f.observations.confirm(f.owner, observed.observation),
      ).rejects.toMatchObject({ code: "report_changed" });
    });

    it("anchors the ledger after the closing report read, including concurrent reset", async () => {
      const f = await prepared(createStore);
      const observed = await f.observations.observe(
        f.owner,
        f.key(f.confirmed.ack),
      );
      const reportKey = (await f.physicalRows()).find((value) =>
        value.value.id.startsWith("report:"),
      )!.key;
      const gate = reportBarrier();
      f.hooks.afterRead = async (collection, key) => {
        if (collection === f.namespace && key.id === reportKey.id) {
          delete f.hooks.afterRead;
          await gate.wait();
        }
      };
      const pending = f.observations
        .confirm(f.owner, observed.observation)
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      try {
        await gate.reached(pending);
        await f.reports.reset(f.reviewer, {
          articleId: f.articleId,
          commandId: "reset-before-final-observed-head",
          expectedLedgerEpoch: f.confirmed.ack.ledgerEpoch,
        });
      } finally {
        gate.release();
      }
      expect(await pending).toMatchObject({
        error: { code: "ledger_epoch_changed" },
      });
    });

    it("keeps a mutated returned view from rewriting the captured verifier binding", async () => {
      const f = await prepared(createStore);
      const observed = await f.observations.observe(
        f.owner,
        f.key(f.confirmed.ack),
      );
      const request = await f.verificationRequest(
        f.confirmed.ack,
        f.packet.input.evidence,
      );
      Object.assign(observed.view, { receipt: "fabricated" });
      Object.assign(observed.context.requirements, {
        expectedStagingBuildId: "fabricated",
      });
      expect(
        await f.observations.confirm(f.owner, observed.observation, request),
      ).toMatchObject({
        receipt: f.confirmed.ack.receipt,
        attestation: { id: f.confirmed.ack.receipt },
      });
    });

    it("fails closed for an expired proof and retains the legacy verifier's owner ceiling", async () => {
      const f = await prepared(createStore);
      const observed = await f.observations.observe(
        f.owner,
        f.key(f.confirmed.ack),
      );
      await expect(
        f.observations.observe(f.agent, f.key(f.confirmed.ack)),
      ).rejects.toMatchObject({ code: "forbidden" });
      f.advance(1_000_000_000);
      await expect(
        f.observations.confirm(f.owner, observed.observation),
      ).rejects.toMatchObject({ code: "report_not_verifiable" });
      const request = await f.verificationRequest(
        f.confirmed.ack,
        f.packet.input.evidence,
      );
      expect(await f.reports.verifier.verify(request)).toBeNull();
      const noEvidence = {
        ...f.owner,
        permissions: f.owner.permissions.filter(
          (value) => value !== knowledgePermissions.evidenceRead,
        ),
      };
      await expect(
        f.observations.observe(noEvidence, f.key(f.confirmed.ack)),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        f.observations.confirm(f.owner, {} as KnowledgeReportObservation),
      ).rejects.toMatchObject({ code: "invalid_request" });
    });
  });
}
