import {
  createKnowledgeBaseApplication,
  defaultKnowledgeRetrievalLimits,
  type CandidateSearchPage,
  type KnowledgeCandidateAdapter,
} from "@pegma/knowledge-base-application";
import { describe, expect, it, vi } from "vitest";
import { at } from "../test/application-fixtures.js";
import { storeFactories } from "../test/application-stores.js";
import {
  botCustomer,
  countSyntheticTokens,
  realBotHint,
  retrievalApplicability,
  retrievalFixture,
  retrievalGuides,
} from "../test/retrieval-fixtures.js";

for (const [name, createStore] of storeFactories) {
  describe(`retrieval physical and source bounds (${name})`, () => {
    it("rejects oversized query, term, scope and result requests before reading storage", async () => {
      const f = retrievalFixture(createStore());
      const invalid = [
        { ...f.botInput(), query: "a".repeat(257) },
        {
          ...f.botInput(),
          query: "one two three four five six seven eight nine",
        },
        { ...f.botInput(), collectionIds: ["c/1", "c/2", "c/3", "c/4", "c/5"] },
        { ...f.botInput(), limit: 6 },
      ];
      for (const input of invalid)
        await expect(
          f.app.retrieveAnswerSources(botCustomer, input),
        ).rejects.toBeInstanceOf(TypeError);
      expect(f.traced.reads).toEqual([]);
      expect(f.traced.enumerations).toEqual([]);
    });

    it("uses keyed reads only and respects total physical gets even when missing rows consume the budget", async () => {
      const f = retrievalFixture(createStore(), {
        limits: { maxRequestPhysicalGets: 5 },
      });
      await f.corpus();
      f.clearObservations();
      const result = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput("workspace"),
      );
      expect(result.sources).toEqual([]);
      expect(f.traced.reads.length).toBeGreaterThan(0);
      expect(f.traced.reads.length).toBeLessThanOrEqual(5);
      expect(f.traced.enumerations).toEqual([]);
      expect(f.traced.transactions).toEqual([]);
    }, 30_000);

    it("keeps ordinary retrieval within all declared physical ceilings without scans or mutations", async () => {
      const f = retrievalFixture(createStore());
      await f.corpus();
      f.clearObservations();
      const answer = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput("workspace"),
      );
      expect(answer.sources.length).toBeGreaterThan(0);
      expect(f.traced.reads.length).toBeLessThanOrEqual(
        defaultKnowledgeRetrievalLimits.maxRequestPhysicalGets,
      );
      expect(
        f.traced.reads.filter(
          (read) => read.collection === "knowledge-base.retrieval.v1",
        ).length,
      ).toBeLessThanOrEqual(defaultKnowledgeRetrievalLimits.maxIndexKeyReads);
      expect(f.traced.enumerations).toEqual([]);
      expect(f.traced.transactions).toEqual([]);
    }, 30_000);

    it.each([{ maxContentBytes: 1 }, { maxSourceTokens: 1 }])(
      "returns no partial procedure when the whole-source allowance is %j",
      async (limits) => {
        const f = retrievalFixture(createStore(), { limits });
        await f.setupCollection();
        await f.publishGuide();
        const answer = await f.app.retrieveAnswerSources(
          botCustomer,
          f.botInput(),
        );
        expect(answer.sources).toEqual([]);
        expect(answer.outcome).toBe("no_result");
      },
      30_000,
    );

    it("counts complete serialized sources including citations and reference metadata", async () => {
      const count = vi.fn(countSyntheticTokens);
      const f = retrievalFixture(createStore(), { tokenCounter: { count } });
      await f.setupCollection();
      await f.publishGuide();
      const answer = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput(),
      );
      expect(answer.sources).toHaveLength(1);
      expect(count).toHaveBeenCalledWith(answer.serializedSources);
      expect(answer.sourceTokens).toBe(
        countSyntheticTokens(answer.serializedSources),
      );
      expect(answer.sourceTokens).toBeGreaterThan(
        countSyntheticTokens(answer.sources[0]!.content.text),
      );
      expect(answer.sourceTokens).toBeLessThanOrEqual(
        defaultKnowledgeRetrievalLimits.maxSourceTokens,
      );
    }, 30_000);

    it.each(["maxContentBytes", "maxSourceTokens"] as const)(
      "fits whole ranked sources within %s while exact confirmation remains all-or-nothing",
      async (budget) => {
        const backing = createStore();
        const normal = retrievalFixture(backing);
        await normal.setupCollection();
        for (const id of ["article/export-a", "article/export-b"])
          await normal.publishGuide({ ...retrievalGuides[0]!, id });
        const all = await normal.app.retrieveAnswerSources(
          botCustomer,
          normal.botInput(),
        );
        expect(all.sources).toHaveLength(2);
        const largestSingle = Math.max(
          ...all.sources.map((source) =>
            countSyntheticTokens(JSON.stringify([source])),
          ),
        );
        const combined = countSyntheticTokens(all.serializedSources);
        const boundary = Math.floor((largestSingle + combined) / 2);
        expect(boundary).toBeGreaterThan(largestSingle);
        expect(boundary).toBeLessThan(combined);
        const limited = retrievalFixture(backing, {
          limits: { [budget]: boundary },
        });
        const fitted = await limited.app.retrieveAnswerSources(
          botCustomer,
          limited.botInput(),
        );
        expect(fitted.sources).toEqual([all.sources[0]]);
        expect(JSON.parse(fitted.serializedSources)).toEqual(fitted.sources);
        expect(fitted.sourceTokens).toBe(
          countSyntheticTokens(fitted.serializedSources),
        );
        expect(
          countSyntheticTokens(fitted.serializedSources),
        ).toBeLessThanOrEqual(boundary);
        expect(
          (
            await limited.app.confirmAnswerSources(botCustomer, {
              references: all.sources.map((source) => source.reference),
              applicability: retrievalApplicability,
            })
          ).sources,
        ).toEqual([]);
        expect(
          (
            await limited.app.confirmAnswerSources(botCustomer, {
              references: fitted.sources.map((source) => source.reference),
              applicability: retrievalApplicability,
            })
          ).sources,
        ).toEqual(fitted.sources);
      },
      30_000,
    );

    it("fails closed when the local token counter is missing or returns an invalid count", async () => {
      const backing = createStore();
      const f = retrievalFixture(backing);
      await f.setupCollection();
      await f.publishGuide();
      for (const tokenCounter of [
        undefined,
        { count: () => Number.NaN },
        { count: () => 0 },
        { count: () => -1 },
        { count: () => 1.5 },
      ]) {
        const app = createKnowledgeBaseApplication({
          store: backing,
          clock: { now: () => at(600_000) },
          retrieval: tokenCounter === undefined ? {} : { tokenCounter },
        });
        expect(
          (await app.retrieveAnswerSources(botCustomer, f.botInput())).sources,
        ).toEqual([]);
      }
    }, 30_000);

    it("bounds confirmation count and returned results independently of available candidates", async () => {
      const f = retrievalFixture(createStore(), {
        limits: { maxHeadProbes: 1, maxConfirmations: 1, maxResults: 1 },
      });
      await f.corpus();
      const answer = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput("workspace"),
      );
      expect(answer.sources.length).toBeLessThanOrEqual(1);
    }, 30_000);

    it.each([
      "duplicate entries",
      "malformed entries",
      "unreported physical rows",
      "unreported pages",
    ] as const)(
      "counts %s before filtering an optional candidate adapter response",
      async (fault) => {
        const backing = createStore();
        const seed = retrievalFixture(backing);
        await seed.setupCollection();
        await seed.publishGuide();
        const hint = await realBotHint(backing);
        const page: CandidateSearchPage = {
          hints:
            fault === "malformed entries"
              ? [hint, { ...hint, contentHash: "malformed" }]
              : fault === "duplicate entries"
                ? [hint, hint]
                : [hint],
          nextCursor: null,
          work: {
            keyedReads: 1,
            physicalRows:
              fault === "unreported physical rows"
                ? 0
                : fault === "unreported pages"
                  ? 1
                  : 2,
            postingEntries:
              fault === "duplicate entries" || fault === "malformed entries"
                ? 2
                : 1,
            pagesRead: fault === "unreported pages" ? 0 : 1,
          },
        };
        const search = vi.fn(async () => page);
        const f = retrievalFixture(backing, {
          candidateAdapter: { search },
          limits: { maxPostingEntries: 1 },
        });
        f.clearObservations();
        const answer = await f.app.retrieveAnswerSources(
          botCustomer,
          f.botInput(),
        );
        expect(answer.sources).toEqual([]);
        expect(search).toHaveBeenCalledTimes(1);
        expect(f.traced.enumerations).toEqual([]);
      },
      30_000,
    );

    it("stops empty continuation pages and accounts for physical pages with no candidates", async () => {
      const search = vi.fn<KnowledgeCandidateAdapter["search"]>(async () => ({
        hints: [],
        nextCursor: "empty-page",
        work: {
          keyedReads: 1,
          physicalRows: 0,
          postingEntries: 0,
          pagesRead: 1,
        },
      }));
      const f = retrievalFixture(createStore(), {
        candidateAdapter: { search },
        limits: { maxPostingPagesPerTerm: 2 },
      });
      await f.setupCollection();
      await f.publishGuide();
      const answer = await f.app.retrieveAnswerSources(
        botCustomer,
        f.botInput(),
      );
      expect(answer.sources).toEqual([]);
      expect(search.mock.calls.length).toBeGreaterThan(0);
      expect(search.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it.each(["continuation", "next collection"] as const)(
      "stops before dispatching an adapter %s when the shared keyed-read allowance is exhausted",
      async (schedule) => {
        let page = 0;
        const search = vi.fn<KnowledgeCandidateAdapter["search"]>(async () => ({
          hints: [],
          nextCursor:
            schedule === "continuation" ? `fresh-page-${++page}` : null,
          work: {
            keyedReads: 1,
            physicalRows: 0,
            postingEntries: 0,
            pagesRead: 1,
          },
        }));
        const f = retrievalFixture(createStore(), {
          candidateAdapter: { search },
          limits: { maxIndexKeyReads: 1 },
        });
        await f.setupCollection();
        await f.publishGuide();
        if (schedule === "next collection") {
          await f.setupCollection("collection/second");
          await f.publishGuide(
            { ...retrievalGuides[0]!, id: "article/second" },
            "collection/second",
          );
        }
        const answer = await f.app.retrieveAnswerSources(botCustomer, {
          ...f.botInput(),
          collectionIds:
            schedule === "next collection"
              ? ["collection/workshop", "collection/second"]
              : ["collection/workshop"],
        });
        expect(answer.sources).toEqual([]);
        expect(search).toHaveBeenCalledTimes(1);
        expect(search.mock.calls[0]?.[0].budget.keyedReads).toBe(1);
      },
      30_000,
    );

    it("rejects limit configurations above hard ceilings or outside integral positive bounds", () => {
      for (const limits of [
        { maxQueryCharacters: 257 },
        { maxRequestPhysicalGets: 769 },
        { maxPostingEntries: 0 },
        { maxHeadProbes: 1.5 },
        { maxResults: -1 },
      ])
        expect(() => retrievalFixture(createStore(), { limits })).toThrow(
          TypeError,
        );
    });
  });
}
