import { retrievalRecords } from "@pegma/knowledge-base-application";
import { describe, expect, it } from "vitest";
import { admin } from "../test/application-fixtures.js";
import { storeFactories } from "../test/application-stores.js";
import {
  botCustomer,
  retrievalFixture,
  retrievalGuides,
} from "../test/retrieval-fixtures.js";
import type { ReadTrace } from "../test/trace-store.js";

function barrier() {
  let release = () => {};
  const reached = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, release };
}

function posting(trace: ReadTrace) {
  return (
    trace.collection === retrievalRecords.name &&
    trace.key.id.startsWith("posting:")
  );
}
function page(trace: ReadTrace) {
  return (
    trace.collection === retrievalRecords.name &&
    trace.key.id.startsWith("page:")
  );
}

for (const [name, createStore] of storeFactories) {
  describe(`prepared multi-term posting reads (${name})`, () => {
    it("prepares every term head before reading any declared page, then starts every page together", async () => {
      // A lower legal page size creates two genuinely maintained pages per term
      // with two public-API-published guides; no fabricated posting rows.
      const f = retrievalFixture(await createStore(), {
        limits: { postingPageEntries: 1 },
      });
      await f.setupCollection();
      await f.publishGuide();
      await f.publishGuide({
        ...retrievalGuides[0]!,
        id: "article/export-second",
      });
      f.clearObservations();
      const firstHead = barrier();
      const releaseHeads = barrier();
      const firstPage = barrier();
      const releasePages = barrier();
      const heads: ReadTrace[] = [];
      const pages: ReadTrace[] = [];
      f.traced.beforeRead(async (trace) => {
        if (posting(trace)) {
          heads.push(trace);
          firstHead.release();
          await releaseHeads.reached;
        } else if (page(trace)) {
          pages.push(trace);
          firstPage.release();
          await releasePages.reached;
        }
      });
      const pending = f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput("workspace export csv"),
      );
      try {
        await firstHead.reached;
        expect(heads).toHaveLength(3);
        expect(pages).toEqual([]);
        releaseHeads.release();
        await firstPage.reached;
        expect(pages).toHaveLength(6);
        releasePages.release();
        const answer = await pending;
        expect(
          answer.sources.map((source) => source.reference.articleId),
        ).toEqual(["article/export", "article/export-second"]);
        expect(new Set(heads.map((read) => read.key.id)).size).toBe(3);
        expect(new Set(pages.map((read) => read.key.id)).size).toBe(6);
        expect(f.traced.enumerations).toEqual([]);
        expect(f.traced.transactions).toEqual([]);
      } finally {
        releaseHeads.release();
        releasePages.release();
        f.traced.beforeRead(undefined);
        await pending;
      }
    });

    it("preserves multi-term ranking, deduplication and complete source results for reversed term order", async () => {
      const f = retrievalFixture(await createStore());
      await f.corpus();
      const forward = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput("csv export invite"),
      );
      const reversed = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput("invite export csv"),
      );
      expect(
        forward.sources.map((source) => source.reference.articleId),
      ).toEqual(["article/export", "article/invite"]);
      expect(reversed).toEqual(forward);
      expect(JSON.parse(forward.serializedSources)).toEqual(forward.sources);
    });

    it.each([{ maxIndexKeyReads: 5 }, { maxPostingEntries: 2 }])(
      "preserves request accounting without partial results at %j",
      async (limits) => {
        const backing = await createStore();
        const f = retrievalFixture(backing);
        await f.setupCollection();
        await f.publishGuide();
        const limited = retrievalFixture(backing, { limits });
        limited.clearObservations();
        const answer = await limited.app.retrieveAnswerSources(
          botCustomer,
          limited.botInput("workspace export csv"),
        );
        expect(answer.outcome).toBe("no_result");
        expect(answer.sources).toEqual([]);
        const indexReads = limited.traced.reads.filter(
          (read) => read.collection === retrievalRecords.name,
        );
        if ("maxIndexKeyReads" in limits)
          expect(indexReads.length).toBeLessThanOrEqual(
            limits.maxIndexKeyReads,
          );
        expect(limited.traced.enumerations).toEqual([]);
        expect(limited.traced.transactions).toEqual([]);
      },
    );

    it("refuses a missing actually declared page instead of returning other matching terms", async () => {
      const backing = await createStore();
      const f = retrievalFixture(backing);
      await f.setupCollection();
      await f.publishGuide();
      f.clearObservations();
      expect(
        (
          await f.app.retrieveAnswerSources(
            botCustomer,
            f.botInput("workspace"),
          )
        ).sources,
      ).toHaveLength(1);
      const observed = f.traced.reads.find(page);
      if (observed === undefined)
        throw new Error("Expected an actual maintained page read");
      const rows = backing.collection(retrievalRecords);
      const original = await rows.getVersioned(observed.key);
      if (original === null) throw new Error("Expected the actual page");
      expect(await rows.deleteIfUnchanged(observed.key, original.version)).toBe(
        true,
      );
      f.clearObservations();
      const answer = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput("workspace export csv"),
      );
      expect(answer.sources).toEqual([]);
      expect(answer.outcome).toBe("no_result");
      expect(f.traced.transactions).toEqual([]);
    });

    it("validates all prepared heads and refuses an excessive declared page count before reading pages", async () => {
      const backing = await createStore();
      const f = retrievalFixture(backing);
      await f.setupCollection();
      await f.publishGuide();
      f.clearObservations();
      await f.app.retrieveAnswerSources(botCustomer, f.botInput("workspace"));
      const observed = f.traced.reads.find(posting);
      if (observed === undefined)
        throw new Error("Expected an actual maintained head read");
      const rows = backing.collection(retrievalRecords);
      const original = await rows.getVersioned(observed.key);
      if (
        original === null ||
        original.value.kind !== "posting" ||
        typeof original.value.data !== "object" ||
        original.value.data === null ||
        Array.isArray(original.value.data)
      )
        throw new Error("Expected the actual posting-head data");
      const changed = await rows.putIfUnchanged(
        {
          ...original.value,
          data: { ...original.value.data, pages: Number.MAX_SAFE_INTEGER },
        },
        original.version,
      );
      expect(changed).toBe(true);
      f.clearObservations();
      const answer = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput("workspace export csv"),
      );
      expect(answer.sources).toEqual([]);
      expect(f.traced.reads.filter(posting)).toHaveLength(3);
      expect(f.traced.reads.filter(page)).toEqual([]);
      expect(f.traced.transactions).toEqual([]);
    });

    it("retains authoritative evidence revocation after a real posting-page await", async () => {
      const f = retrievalFixture(await createStore());
      await f.setupCollection();
      const published = await f.publishGuide();
      const reached = barrier();
      const resume = barrier();
      let held = false;
      f.traced.beforeRead(async (trace) => {
        if (page(trace) && !held) {
          held = true;
          reached.release();
          await resume.reached;
        }
      });
      const pending = f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput("workspace export csv"),
      );
      try {
        await reached.reached;
        const proof = (
          await f.app.getEvidence(admin, {
            articleId: published.current.articleId,
          })
        ).evidence[0];
        if (proof === undefined)
          throw new Error("Expected genuinely accepted evidence");
        await f.app.revokeEvidence(admin, {
          ...f.command(
            "withdraw-during-posting-wave",
            published.current.generation,
          ),
          articleId: published.current.articleId,
          articleRevision: proof.articleRevision,
          evidenceId: proof.id,
          evidenceVersion: proof.version,
          evidenceHash: proof.hash,
          reason: "Synthetic withdrawal",
        });
        const writes = f.traced.transactions.length;
        resume.release();
        expect((await pending).sources).toEqual([]);
        expect(f.traced.transactions).toHaveLength(writes);
      } finally {
        resume.release();
        f.traced.beforeRead(undefined);
        await pending;
      }
    });

    it("counts missing term heads without reading pages or inventing a source", async () => {
      const f = retrievalFixture(await createStore());
      await f.setupCollection();
      await f.publishGuide();
      f.clearObservations();
      const answer = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput("quasar nebula"),
      );
      expect(answer.sources).toEqual([]);
      expect(f.traced.reads.filter(posting)).toHaveLength(2);
      expect(f.traced.reads.filter(page)).toEqual([]);
      expect(f.traced.enumerations).toEqual([]);
      expect(f.traced.transactions).toEqual([]);
    });
  });
}
