import {
  createKnowledgeBaseApplication,
  knowledgeRecords,
  type AnswerSourcesResult,
  type PrivateSourceReference,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import {
  createCloudflareD1Store,
  type CloudflareD1Database,
  type CloudflareD1PreparedStatement,
} from "@pegma/storage-cloudflare-d1";
import { createMemoryStore, type Store } from "@pegma/storage-core";
import { Miniflare } from "miniflare";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  access,
  admin,
  author,
  at,
  evidence,
  validationPolicy,
} from "../test/application-fixtures.js";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import { D1_COMPATIBILITY_DATE } from "../test/d1.js";
import {
  botCustomer,
  countSyntheticTokens,
  retrievalApplicability,
  retrievalFixture,
  retrievalGuides,
} from "../test/retrieval-fixtures.js";
import type { ReadTrace } from "../test/trace-store.js";
import { prepareNativeHistory } from "./native-history-preparation.js";

type Fixture = ReturnType<typeof retrievalFixture>;
const articleId = "article/export";
const collectionId = "collection/workshop";
const source: PrivateSourceReference = {
  id: "source/fictional",
  system: "synthetic-support",
  resourceId: "PRIVATE_SOURCE_CANARY",
  version: "1",
};

function confirm(f: Fixture, answer: AnswerSourcesResult) {
  return f.app.confirmAnswerSources(botCustomer, {
    references: answer.sources.map((entry) => entry.reference),
    applicability: retrievalApplicability,
  });
}

function noSources(result: AnswerSourcesResult) {
  expect(result).toEqual({
    outcome: "no_result",
    sources: [],
    serializedSources: "",
    sourceTokens: 0,
  });
}

async function sourcedGuide(f: Fixture) {
  await f.setupCollection();
  let current = await f.createDraft(
    articleId,
    collectionId,
    retrievalGuides[0]!.draft,
  );
  current = await f.setSources(current, [source]);
  current = (await f.submitEvidence(current)).current;
  await f.publish(current);
  await f.repair(articleId);
  const answer = await f.app.retrieveAnswerSources(botCustomer, f.botInput());
  expect(answer.sources).toHaveLength(1);
  f.privateSources.canPublish.mockClear();
  f.privateSources.isCurrent.mockClear();
  return answer;
}

async function rewriteHead(
  backing: Store,
  kind: "article" | "collection" | "validation",
) {
  const row = (await allKnowledgeRows(backing)).find(
    (item) => item.kind === "head" && item.resourceKind === kind,
  );
  if (row === undefined) throw new Error("Expected an actual governed head");
  const records = backing.collection(knowledgeRecords);
  const key = { partition: row.partition, id: row.id };
  const saved = await records.getVersioned(key);
  if (saved === null) throw new Error("Expected an actual opaque version");
  expect(await records.putIfUnchanged(saved.value, saved.version)).toBe(true);
  const rewritten = await records.getVersioned(key);
  expect(rewritten?.value).toEqual(saved.value);
  expect(rewritten?.version).not.toBe(saved.version);
}

function evidenceRead(trace: ReadTrace) {
  return (
    trace.collection === knowledgeRecords.name &&
    trace.method === "get" &&
    (trace.key.id.startsWith("evidence:") ||
      trace.key.id.startsWith("revoked:"))
  );
}

function readIdentity(trace: ReadTrace) {
  return JSON.stringify([trace.key.partition, trace.key.id]);
}

/** A release latch only; the Store and every stored row remain real. */
function latch() {
  let release = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { waiting, release };
}

type HistoryMark = (stage: string, completed?: number, total?: number) => void;

async function completeHistory(f: Fixture, mark: HistoryMark = () => {}) {
  mark("history.collection.before");
  await f.setupCollection();
  mark("history.collection.after");
  const extraChecks = Array.from({ length: 27 }, (_, index) => ({
    ...validationPolicy.requirements[0]!,
    id: `explanation-extra-${index}`,
  }));
  // Four other-kind/workflow requirements remain. The 32-check policy thus
  // admits 28 distinct explanation proofs, not an impossible 32-proof review.
  const policy = {
    ...validationPolicy,
    version: 2,
    requirements: [...validationPolicy.requirements, ...extraChecks],
  };
  expect(policy.requirements).toHaveLength(32);
  mark("history.policy.before");
  const previousPolicy = await f.authoringApp.getValidationPolicy(admin, {
    policyId: policy.id,
  });
  await f.authoringApp.putValidationPolicy(admin, {
    ...f.command("complete-policy", previousPolicy.generation),
    policy,
  });
  const configured = await f.authoringApp.getGovernanceConfiguration(admin, {
    collectionId,
  });
  await f.authoringApp.putGovernanceConfiguration(admin, {
    ...f.command("complete-configuration", configured.generation),
    collectionId,
    configuration: {
      ...configured.configuration,
      validationPolicy: { id: policy.id, version: policy.version },
    },
  });
  mark("history.policy.after");
  mark("history.draft.before");
  let current = await f.createDraft(
    articleId,
    collectionId,
    retrievalGuides[0]!.draft,
  );
  mark("history.draft.after");
  mark("history.approved.before");
  let approvedCount = 0;
  for (const check of policy.requirements.filter(
    (item) => item.kind === "explanation",
  )) {
    current = (
      await f.submitEvidence(current, undefined, {
        ...evidence(current.revision),
        id: `proof/${check.id}`,
        checkId: check.id,
      })
    ).current;
    approvedCount += 1;
    if (approvedCount % 8 === 0 || approvedCount === 28)
      mark("history.approved.progress", approvedCount, 28);
  }
  const approved = await f.authoringApp.getEvidence(admin, { articleId });
  expect(approved.evidence).toHaveLength(28);
  mark("history.approved.after", approvedCount, 28);
  mark("history.publish.before");
  const published = await f.publish(current);
  expect(published.input.review.binding.evidence).toHaveLength(28);
  mark("history.publish.after");
  mark("history.repair.before");
  await f.repair(articleId);
  mark("history.repair.after");
  mark("history.draft2.before");
  await f.authoringApp.updateDraft(author, {
    ...f.command("unapproved-private-draft", published.current.generation),
    articleId,
    collectionId,
    draft: {
      ...retrievalGuides[0]!.draft,
      content: { format: "plain_text", text: "UNAPPROVED_DRAFT_CANARY" },
    },
  });
  current = await f.authoringApp.getDraft(author, { articleId });
  mark("history.draft2.after");
  mark("history.current.before");
  // Same-check evidence is legal draft data, but deliberately not a qualifying
  // publication. None may replace or shorten the retained approved proof set.
  for (let index = 0; index < 32; index += 1) {
    current = (
      await f.submitEvidence(current, undefined, {
        ...evidence(current.revision),
        id: `current-proof/${index}`,
      })
    ).current;
    if ((index + 1) % 8 === 0) mark("history.current.progress", index + 1, 32);
  }
  mark("history.current.after", 32, 32);
  mark("history.revocations.before");
  for (let index = 0; index < 64; index += 1) {
    const facts = await f.authoringApp.getEvidence(admin, { articleId });
    const proof = facts.evidence.find((item) => item.id === "current-proof/0");
    if (proof === undefined) throw new Error("Expected real current proof");
    await f.authoringApp.revokeEvidence(admin, {
      ...f.command("retain-revocation", facts.generation),
      articleId,
      articleRevision: proof.articleRevision,
      evidenceId: proof.id,
      evidenceVersion: proof.version,
      evidenceHash: proof.hash,
      reason: "Synthetic retained-history replacement",
    });
    current = await f.authoringApp.getDraft(author, { articleId });
    current = (
      await f.submitEvidence(current, undefined, {
        ...evidence(current.revision),
        id: "current-proof/0",
      })
    ).current;
    if ((index + 1) % 8 === 0)
      mark("history.revocations.progress", index + 1, 64);
  }
  mark("history.revocations.after", 64, 64);
  mark("history.summary.before");
  const retained = await f.authoringApp.getEvidence(admin, { articleId });
  expect(retained.evidence).toHaveLength(32);
  expect(retained.revokedEvidence).toHaveLength(64);
  expect(current.revision.number).toBe(2);
  mark("history.summary.after");
  return { approved, retained };
}

for (const [name, createStore] of storeFactories) {
  describe(`conservative publication read plan (${name})`, () => {
    it("authorizes C before any A probe and never borrows another collection's authority", async () => {
      const backing = await createStore();
      const f = retrievalFixture(backing);
      await f.setupCollection();
      await f.publishGuide();
      await f.setupCollection("collection/second");
      await f.publishGuide(
        { ...retrievalGuides[0]!, id: "article/second" },
        "collection/second",
      );
      const answer = await f.app.retrieveAnswerSources(botCustomer, {
        ...f.botInput(),
        collectionIds: [collectionId, "collection/second"],
      });
      expect(answer.sources).toHaveLength(2);
      expect(await confirm(f, answer)).toEqual(answer);
      const articlePartitions = new Set(
        (await allKnowledgeRows(backing))
          .filter((row) => row.resourceKind === "article")
          .map((row) => row.partition),
      );
      f.clearObservations();
      const denied = access("customer/unapproved", [
        knowledgePermissions.articleRead,
        knowledgePermissions.botRead,
      ]);
      noSources(
        await f.app.confirmAnswerSources(denied, {
          references: answer.sources.map((entry) => entry.reference),
          applicability: retrievalApplicability,
        }),
      );
      expect(
        f.traced.reads.some((read) =>
          articlePartitions.has(read.key.partition),
        ),
      ).toBe(false);
      const first = answer.sources.find(
        (entry) => entry.reference.articleId === articleId,
      );
      if (first === undefined) throw new Error("Expected a returned source");
      noSources(
        await f.app.confirmAnswerSources(botCustomer, {
          references: [
            { ...first.reference, collectionId: "collection/second" },
          ],
          applicability: retrievalApplicability,
        }),
      );
      expect(f.traced.enumerations).toEqual([]);
      expect(f.traced.transactions).toEqual([]);
    });

    it("keeps both raw A/C/V fences even when numeric generations and payloads do not change", async () => {
      const backing = await createStore();
      const f = retrievalFixture(backing);
      const answer = await sourcedGuide(f);
      for (const kind of ["article", "collection", "validation"] as const) {
        for (const round of [1, 2]) {
          let calls = 0;
          f.privateSources.canPublish.mockClear();
          f.privateSources.isCurrent.mockImplementation(async () => {
            calls += 1;
            if (calls === round) await rewriteHead(backing, kind);
            return true;
          });
          f.clearObservations();
          noSources(await confirm(f, answer));
          expect(calls).toBe(round);
          expect(f.privateSources.canPublish).toHaveBeenCalledTimes(round);
          expect(f.traced.transactions).toEqual([]);
        }
      }
    });

    it("retains both live source callback pairs and excludes every private source or evidence field", async () => {
      const f = retrievalFixture(await createStore());
      const answer = await sourcedGuide(f);
      expect(await confirm(f, answer)).toEqual(answer);
      expect(f.privateSources.canPublish).toHaveBeenCalledTimes(2);
      expect(f.privateSources.isCurrent).toHaveBeenCalledTimes(2);
      for (const callback of ["canPublish", "isCurrent"] as const) {
        for (const round of [1, 2]) {
          let calls = 0;
          f.privateSources[callback].mockImplementation(async () => {
            calls += 1;
            return calls !== round;
          });
          noSources(await confirm(f, answer));
          expect(calls).toBe(round);
          f.privateSources[callback].mockImplementation(async () => true);
        }
      }
      for (const privateValue of [
        source.resourceId,
        source.system,
        "PRIVATE_STAFF_EVIDENCE",
        "staff/verifier",
        "runner/staging",
        "attestation",
        "provenance",
      ])
        expect(answer.serializedSources).not.toContain(privateValue);
    });

    it.each(["audience", "validation", "evidence", "retirement"] as const)(
      "withholds an already serialized answer after current %s changes in the second source fence",
      async (change) => {
        const f = retrievalFixture(await createStore());
        const answer = await sourcedGuide(f);
        let calls = 0;
        f.privateSources.isCurrent.mockImplementation(async () => {
          calls += 1;
          if (calls !== 2) return true;
          if (change === "audience") {
            const preview = await f.authoringApp.previewCollectionPolicy(
              admin,
              {
                collectionId,
                uses: { portal: { enabled: false }, bot: { enabled: false } },
              },
            );
            await f.authoringApp.updateCollectionPolicy(admin, {
              ...f.command("withdraw-audience", preview.generation),
              collectionId,
              preview: preview.preview,
            });
          } else if (change === "validation") {
            const current = await f.authoringApp.getValidationPolicy(admin, {
              policyId: validationPolicy.id,
            });
            await f.authoringApp.putValidationPolicy(admin, {
              ...f.command("withdraw-validation", current.generation),
              policy: {
                ...current.policy,
                version: current.policy.version + 1,
              },
            });
          } else if (change === "evidence") {
            const facts = await f.authoringApp.getEvidence(admin, {
              articleId,
            });
            const proof = facts.evidence[0];
            if (proof === undefined) throw new Error("Expected accepted proof");
            await f.authoringApp.revokeEvidence(admin, {
              ...f.command("withdraw-proof", facts.generation),
              articleId,
              articleRevision: proof.articleRevision,
              evidenceId: proof.id,
              evidenceVersion: proof.version,
              evidenceHash: proof.hash,
              reason: "Synthetic current proof withdrawal",
            });
          } else {
            const current = await f.authoringApp.getDraft(admin, { articleId });
            await f.authoringApp.retireArticle(admin, {
              ...f.command("retire-after-serialization", current.generation),
              articleId,
            });
          }
          return true;
        });
        noSources(await confirm(f, answer));
        expect(calls).toBe(2);
      },
    );

    it.each(["missing", "corrupt"] as const)(
      "refuses a %s approved proof without appending any rows",
      async (fault) => {
        const backing = await createStore();
        const f = retrievalFixture(backing);
        await f.setupCollection();
        await f.publishGuide();
        const answer = await f.app.retrieveAnswerSources(
          botCustomer,
          f.botInput(),
        );
        expect(answer.sources).toHaveLength(1);
        const row = (await allKnowledgeRows(backing)).find(
          (item) => item.kind === "evidence" && item.resourceId === articleId,
        );
        if (row === undefined)
          throw new Error("Expected actual approved evidence");
        const records = backing.collection(knowledgeRecords);
        const key = { partition: row.partition, id: row.id };
        const saved = await records.getVersioned(key);
        if (saved === null) throw new Error("Expected actual proof version");
        if (fault === "missing") {
          expect(await records.deleteIfUnchanged(key, saved.version)).toBe(
            true,
          );
        } else {
          const data = saved.value.data;
          if (data === null || typeof data !== "object" || Array.isArray(data))
            throw new Error("Expected an actual structured proof");
          expect(
            await records.putIfUnchanged(
              { ...saved.value, data: { ...data, hash: "0".repeat(64) } },
              saved.version,
            ),
          ).toBe(true);
        }
        const before = await allKnowledgeRows(backing);
        f.clearObservations();
        noSources(await confirm(f, answer));
        expect(f.traced.transactions).toEqual([]);
        expect(await allKnowledgeRows(backing)).toEqual(before);
      },
    );

    // Memory/Azurite retain vitest.config.ts's global 180-second watchdog.
    // The Native Node/workerd fixture retains its 300-second exception;
    // measured query/parameter and SDK limits stay fixed.
    it(
      "keeps complete approved proofs independent of legal E32/R64 draft history and starts the whole E/R wave",
      async ({ task }) => {
        const started = performance.now();
        let observed: Fixture | undefined;
        const timings: {
          stage: string;
          elapsedMilliseconds: number;
          readObservations: number;
          enumerationObservations: number;
          transactionObservations: number;
          completed?: number;
          total?: number;
        }[] = [];
        const mark: HistoryMark = (stage, completed, total) => {
          // Fixed stage names and numeric work only: no keys, IDs, content or SQL.
          if (timings.length >= 64) return;
          const sample = {
            stage,
            elapsedMilliseconds: Math.round(performance.now() - started),
            readObservations: observed?.traced.reads.length ?? 0,
            enumerationObservations: observed?.traced.enumerations.length ?? 0,
            transactionObservations: observed?.traced.transactions.length ?? 0,
            ...(completed === undefined ? {} : { completed }),
            ...(total === undefined ? {} : { total }),
          };
          timings.push(sample);
          Object.assign(task.meta, {
            knowledgeHistoryTimings: structuredClone(timings),
          });
          console.info(
            "knowledge-history-timing",
            JSON.stringify({ backend: name, ...sample }),
          );
        };
        // Emits the last known stage even when the test watchdog triggers first.
        onTestFinished(() => mark("test.finished"));
        mark("case.before");
        try {
          mark("store.before");
          // This large-history case uses the public opt-in already exercised by
          // physicalD1; all other generic Native cases retain direct reads.
          const native =
            name === "Miniflare D1" ? await physicalD1() : undefined;
          const backing =
            native === undefined ? await createStore() : native.setup;
          mark("store.after");
          // The large Native case checks publication READ conformance. Build
          // its full legal history through the actual public Memory app, then
          // transfer all declared values through the real Native Store. Other
          // Native cases still execute their own real authoring workflows.
          const construction = retrievalFixture(
            native === undefined ? backing : createMemoryStore(),
          );
          observed = construction;
          Object.assign(task.meta, {
            knowledgeHistoryPreparation:
              native === undefined
                ? "same-backend-public-application"
                : "memory-public-application-to-native-read-fixture",
          });
          const facts = await completeHistory(construction, mark);
          const f =
            native === undefined ? construction : retrievalFixture(backing);
          if (native !== undefined) {
            mark("native.copy.before");
            const copied = await prepareNativeHistory(
              construction.store,
              backing,
            );
            Object.assign(task.meta, { knowledgeHistoryCopiedRows: copied });
            mark("native.copy.after");
            // Match the retrieval clock and follow all donor authoring actions.
            // No donor receipts, raw versions or confirmation WeakMaps are reused.
            f.setTime(600_000);
            observed = f;
            mark("native.readback.before");
            expect(
              await f.authoringApp.getDraft(author, { articleId }),
            ).toEqual(
              await construction.authoringApp.getDraft(author, { articleId }),
            );
            expect(
              await f.authoringApp.getEvidence(admin, { articleId }),
            ).toEqual(facts.retained);
            mark("native.readback.after");
          }
          mark("retrieve.before");
          const answer = await f.app.retrieveAnswerSources(
            botCustomer,
            f.botInput(),
          );
          mark("retrieve.after");
          expect(answer.sources).toHaveLength(1);
          expect(answer.sources[0]?.reference.articleRevision).toBe(1);
          expect(answer.sources[0]?.content).toEqual(
            retrievalGuides[0]!.draft.content,
          );
          expect(answer.serializedSources).not.toContain(
            "UNAPPROVED_DRAFT_CANARY",
          );
          if (native !== undefined) {
            mark("native.qualification.before");
            expect(await confirm(f, answer)).toEqual(answer);
            mark("native.qualification.after");
          }
          f.clearObservations();
          mark("confirm.baseline.before");
          const profile: PhysicalProfile = {
            calls: 0,
            statements: 0,
            batches: 0,
            maximumParameters: 0,
            blocked: 0,
          };
          try {
            const result =
              native === undefined
                ? await confirm(f, answer)
                : await native.measure(profile, () => confirm(f, answer));
            expect(result).toEqual(answer);
          } finally {
            if (native !== undefined) {
              Object.assign(task.meta, {
                knowledgeHistoryConfirmationProfile: structuredClone(profile),
              });
              console.info(
                "knowledge-history-confirmation-profile",
                JSON.stringify(profile),
              );
              expect(profile.blocked).toBe(0);
              expect(profile.maximumParameters).toBeLessThanOrEqual(100);
              expect(profile.calls).toBeGreaterThan(0);
              expect(profile.calls).toBeLessThanOrEqual(7);
            }
          }
          mark("confirm.baseline.after");
          const expected = f.traced.reads
            .filter(evidenceRead)
            .map(readIdentity);
          expect(expected).toHaveLength(facts.approved.evidence.length * 2);
          expect(expected).toHaveLength(56);
          expect(new Set(expected).size).toBe(expected.length);
          mark("barrier.create");
          const release = latch();
          const reached = latch();
          const seen: ReadTrace[] = [];
          f.clearObservations();
          f.traced.beforeRead(async (trace) => {
            if (!evidenceRead(trace)) return;
            seen.push(trace);
            if (seen.length === 1)
              mark("barrier.firstEvidence", seen.length, expected.length);
            reached.release();
            await release.waiting;
          });
          const pending = confirm(f, answer);
          mark("barrier.await");
          try {
            await Promise.race([
              reached.waiting,
              pending.then(() => {
                throw new Error(
                  "Confirmation completed without the required proof wave",
                );
              }),
            ]);
            mark("barrier.entered", seen.length, expected.length);
            expect(seen.map(readIdentity).sort()).toEqual([...expected].sort());
            mark("barrier.release", seen.length, expected.length);
            release.release();
            expect(await pending).toEqual(answer);
            mark("barrier.confirm.after");
          } finally {
            mark("barrier.finally", seen.length, expected.length);
            release.release();
            f.traced.beforeRead(undefined);
            await pending;
          }
          expect(f.traced.transactions).toEqual([]);
          const accepted = facts.approved.evidence.at(-1);
          if (accepted === undefined)
            throw new Error("Expected last approved proof");
          mark("withdraw.before");
          const current = await f.authoringApp.getDraft(author, { articleId });
          await f.authoringApp.revokeEvidence(admin, {
            ...f.command(
              native === undefined
                ? "revoke-last-approved"
                : "native-read-revoke-last-approved",
              current.generation,
            ),
            articleId,
            articleRevision: accepted.articleRevision,
            evidenceId: accepted.id,
            evidenceVersion: accepted.version,
            evidenceHash: accepted.hash,
            reason: "Synthetic exact retained-publication withdrawal",
          });
          mark("withdraw.after");
          mark("confirm.final.before");
          noSources(await confirm(f, answer));
          mark("confirm.final.after");
        } finally {
          mark("case.finally");
        }
      },
      name === "Miniflare D1" ? 300_000 : 180_000,
    );
  });
}

interface PhysicalProfile {
  calls: number;
  statements: number;
  batches: number;
  maximumParameters: number;
  blocked: number;
}

/** Count real D1 binding executions, not Store calls or statements in a batch. */
async function physicalD1() {
  let runtime: Miniflare | undefined;
  let disposal: Promise<void> | undefined;
  const dispose = () => {
    const current = runtime;
    if (current === undefined) return Promise.resolve();
    disposal ??= current.dispose();
    return disposal;
  };
  onTestFinished(dispose, 30_000);
  try {
    runtime = new Miniflare({
      modules: true,
      script:
        "export default { fetch() { return new Response(null, { status: 204 }); } };",
      compatibilityDate: D1_COMPATIBILITY_DATE,
      host: "127.0.0.1",
      port: 0,
      cf: false,
      d1Persist: false,
      d1Databases: { DB: randomUUID() },
    });
    const actual: CloudflareD1Database = await runtime.getD1Database("DB");
    const active = new AsyncLocalStorage<PhysicalProfile>();
    const originals = new WeakMap<
      CloudflareD1PreparedStatement,
      CloudflareD1PreparedStatement
    >();
    function execution(statements: number, batch = false) {
      const profile = active.getStore();
      if (profile === undefined) return;
      if (profile.calls >= 50) {
        profile.blocked += 1;
        throw new Error("Synthetic D1 physical-call ceiling exceeded");
      }
      profile.calls += 1;
      profile.statements += statements;
      if (batch) profile.batches += 1;
    }
    function observed(
      statement: CloudflareD1PreparedStatement,
    ): CloudflareD1PreparedStatement {
      const wrapped = new Proxy(statement, {
        get(target, property) {
          if (property === "bind")
            return (...values: unknown[]) => {
              const profile = active.getStore();
              if (profile !== undefined) {
                profile.maximumParameters = Math.max(
                  profile.maximumParameters,
                  values.length,
                );
                if (values.length > 100) {
                  profile.blocked += 1;
                  throw new Error("Synthetic D1 parameter ceiling exceeded");
                }
              }
              return observed(target.bind(...values));
            };
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== "function") return value;
          if (["first", "all", "run", "raw"].includes(String(property)))
            return (...args: unknown[]) => {
              execution(1);
              return Reflect.apply(value, target, args);
            };
          return value.bind(target);
        },
      });
      originals.set(wrapped, statement);
      return wrapped;
    }
    const database = new Proxy(actual, {
      get(target, property) {
        if (property === "prepare")
          return (query: string) => observed(target.prepare(query));
        if (property === "batch")
          return (statements: CloudflareD1PreparedStatement[]) => {
            const native = statements.map((statement) => {
              const original = originals.get(statement);
              if (original === undefined)
                throw new Error("Expected a genuine observed D1 statement");
              return original;
            });
            execution(native.length, true);
            return target.batch(native);
          };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return {
      setup: createCloudflareD1Store({ database, readBatchSize: 512 }),
      fresh: () =>
        createCloudflareD1Store({
          database,
          createSchemaIfMissing: false,
          readBatchSize: 512,
        }),
      measure: <T>(profile: PhysicalProfile, work: () => Promise<T>) =>
        active.run(profile, work),
    };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Real D1 initialization and disposal failed",
      );
    }
    throw error;
  }
}

it("confirms one real approved source with at most seven physical D1 calls and no query or parameter waiver", async ({
  task,
}) => {
  const d1 = await physicalD1();
  const seeded = retrievalFixture(d1.setup);
  await seeded.setupCollection();
  await seeded.publishGuide();
  const answer = await seeded.app.retrieveAnswerSources(
    botCustomer,
    seeded.botInput(),
  );
  expect(answer.sources).toHaveLength(1);
  const profile: PhysicalProfile = {
    calls: 0,
    statements: 0,
    batches: 0,
    maximumParameters: 0,
    blocked: 0,
  };
  try {
    const result = await d1.measure(profile, async () => {
      // A fresh adapter and application enter the measured scope. Only schema
      // creation and genuine public SDK setup above are unmeasured.
      const app = createKnowledgeBaseApplication({
        store: d1.fresh(),
        clock: { now: () => at(600_000) },
        retrieval: { tokenCounter: { count: countSyntheticTokens } },
      });
      return app.confirmAnswerSources(botCustomer, {
        references: answer.sources.map((entry) => entry.reference),
        applicability: retrievalApplicability,
      });
    });
    expect(result).toEqual(answer);
  } finally {
    Object.assign(task.meta, {
      knowledgeConfirmationProfile: structuredClone(profile),
    });
    expect(profile.blocked).toBe(0);
    expect(profile.maximumParameters).toBeLessThanOrEqual(100);
    expect(profile.calls).toBeGreaterThan(0);
    expect(profile.calls).toBeLessThanOrEqual(7);
  }
});
