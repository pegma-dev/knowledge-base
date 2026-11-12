import {
  createKnowledgeBaseApplication,
  knowledgeRecords,
  KnowledgeBaseAuthorizationError,
  KnowledgeBaseNotFoundError,
  KnowledgeBasePrerequisiteError,
  RepositoryIntegrityError,
  type KnowledgeRetrievalOptions,
  type PublishedSearchObservationResult,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import { resolveAccess } from "@pegma/authorization-core";
import { StorageError } from "@pegma/storage-core";
import type {
  CollectionDefinition,
  EntityKey,
  ScanOptions,
  Store,
} from "@pegma/storage-core";
import { describe, expect, it } from "vitest";
import {
  access,
  admin,
  applicationFixture,
  at,
  author,
  customer,
  draft,
  outsider,
} from "../test/application-fixtures.js";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import { barrier } from "../test/trace-store.js";
import {
  botCustomer,
  retrievalFixture,
  retrievalGuides,
} from "../test/retrieval-fixtures.js";

// Exact resolved defaults from PG support-background-service-access.ts.
// No customer audience, collectionRead, role assignment, or ambient entitlement.
const authoringReader = resolveAccess(
  { principalId: "pegma/support-learning-draft" },
  {
    version: "pg-background-learning-draft-v1",
    defaults: [
      "support.queue.read",
      "support.learning.read",
      "support.learning.process",
      knowledgePermissions.articleRead,
      knowledgePermissions.draftRead,
      knowledgePermissions.draftWrite,
      knowledgePermissions.provenanceRead,
      knowledgePermissions.provenanceWrite,
    ],
  },
);

interface KeyedRead {
  readonly method: "get" | "getVersioned";
  readonly key: EntityKey;
}

function fixture(backing: Store, retrieval: KnowledgeRetrievalOptions = {}) {
  const f = applicationFixture(backing);
  let scans = 0;
  let scanPasses = 0;
  const scanPages: {
    pass: number;
    requested: number;
    physicalRows: number;
    hasCursor: boolean;
  }[] = [];
  let beforeScan:
    | ((ordinal: number, pass: number, input: ScanOptions) => Promise<void>)
    | undefined;
  const keyedReads: KeyedRead[] = [];
  let beforeRead: ((read: KeyedRead) => Promise<void>) | undefined;
  const observed: Store = {
    collection<T>(definition: CollectionDefinition<T>) {
      const target = backing.collection(definition);
      return new Proxy(target, {
        get(object, property) {
          if (property === "get" || property === "getVersioned")
            return async (key: EntityKey) => {
              const read: KeyedRead = {
                method: property,
                key: structuredClone(key),
              };
              keyedReads.push(read);
              if (beforeRead !== undefined) await beforeRead(read);
              return property === "get"
                ? object.get(key)
                : object.getVersioned(key);
            };
          if (property === "scan")
            return async (input: ScanOptions) => {
              scans += 1;
              if (input.cursor === undefined) scanPasses += 1;
              await beforeScan?.(scans, scanPasses, input);
              const page = await object.scan(input);
              scanPages.push({
                pass: scanPasses,
                requested: input.limit,
                physicalRows: page.records.length,
                hasCursor: page.nextCursor !== null,
              });
              return page;
            };
          const value: unknown = Reflect.get(object, property, object);
          return typeof value === "function" ? value.bind(object) : value;
        },
      });
    },
  };
  const app = createKnowledgeBaseApplication({
    store: observed,
    clock: { now: () => at(600_000) },
    evidenceVerifier: { verify: f.verify },
    privateSources: f.privateSources,
    retrieval,
  });
  return {
    ...f,
    app,
    authoringApp: f.app,
    backing,
    observers: app.publishedSearchObservations!,
    scans: () => scans,
    scanPasses: () => scanPasses,
    scanPages,
    keyedReads,
    beforeRead(handler: typeof beforeRead) {
      beforeRead = handler;
    },
    beforeScan(handler: typeof beforeScan) {
      beforeScan = handler;
    },
    input(query = "export") {
      return {
        collectionId: "collection/workshop",
        query,
        applicability: draft().applicability,
      };
    },
  };
}

function complete(result: PublishedSearchObservationResult) {
  expect(result.outcome).toBe("complete");
  if (result.outcome !== "complete") throw new Error("Expected complete scope");
  return result;
}

async function change(
  f: ReturnType<typeof fixture>,
  kind: "publish" | "withdraw" | "draft" | "policy",
) {
  if (kind === "publish") {
    await f.publishedArticle("article/late");
    return;
  }
  if (kind === "policy") {
    const preview = await f.authoringApp.previewCollectionPolicy(admin, {
      collectionId: "collection/workshop",
      uses: { portal: { enabled: false }, bot: { enabled: false } },
    });
    await f.authoringApp.updateCollectionPolicy(admin, {
      ...f.command("withdraw-portal", preview.generation),
      collectionId: "collection/workshop",
      preview: preview.preview,
    });
    return;
  }
  const current = await f.authoringApp.getDraft(author, {
    articleId: "article/export",
  });
  if (kind === "withdraw")
    await f.authoringApp.retireArticle(admin, {
      ...f.command("retire", current.generation),
      articleId: current.articleId,
    });
  else
    await f.authoringApp.updateDraft(author, {
      ...f.command("edit", current.generation),
      articleId: current.articleId,
      collectionId: "collection/workshop",
      draft: { ...draft(), title: "UNAPPROVED_DRAFT_CANARY" },
    });
}

async function seedHistory(
  f: ReturnType<typeof fixture>,
  count: number,
  prefix: string,
  payload = "",
) {
  const sample = (await allKnowledgeRows(f.backing)).find(
    (row) => row.resourceKind === "collection" && row.kind === "head",
  );
  if (sample === undefined)
    throw new Error("Expected the real collection head");
  const records = f.backing.collection(knowledgeRecords);
  for (let offset = 0; offset < count; offset += 4)
    await Promise.all(
      Array.from({ length: Math.min(4, count - offset) }, (_, index) =>
        records.put({
          ...sample,
          id: `job:${prefix}:${offset + index}`,
          kind: "job",
          data: { task: "collection_changed", fixturePayload: payload },
        }),
      ),
    );
}

for (const [backend, createStore] of storeFactories) {
  describe(`background published search observations (${backend})`, () => {
    it("completes and confirms a genuinely empty authorized scope without the index", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const result = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      expect(result.articles).toEqual([]);
      expect(f.scanPasses()).toBe(2);
      await expect(
        f.observers.confirm(authoringReader, result.observation),
      ).resolves.toBeUndefined();
      expect(f.scanPasses()).toBe(4);
    });

    it("finds a newly published unindexed guide even when legacy provider search fails", async () => {
      const f = fixture(await createStore(), {
        candidateAdapter: {
          search: async () => {
            throw new Error("Synthetic search provider unavailable");
          },
        },
      });
      await f.setupCollection();
      await f.publishedArticle();
      expect(await f.app.searchPublishedArticles(customer, f.input())).toEqual({
        outcome: "no_result",
        articles: [],
      });
      expect(f.scans()).toBe(0);
      const result = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      expect(result.articles.map(({ articleId }) => articleId)).toEqual([
        "article/export",
      ]);
      expect(result.articles[0]?.content).toEqual(draft().content);
      await f.observers.confirm(authoringReader, result.observation);
    });

    it("covers only the exact authorized collection, applicability, and metadata query", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      await f.setupCollection("collection/other");
      await f.publishedArticle();
      await f.publishedArticle("article/elsewhere", "collection/other");
      await f.publishedArticle("article/other-version", undefined, {
        ...draft(),
        applicability: { ...draft().applicability, productVersion: "1.1" },
      });
      await f.publishedArticle("article/other-query", undefined, {
        ...draft(),
        title: "Restore a password",
        summary: "Recover sign-in access.",
        tags: ["password"],
      });
      await f.createDraft("article/unpublished");
      const result = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      expect(result.articles.map(({ articleId }) => articleId)).toEqual([
        "article/export",
      ]);
      const absent = complete(
        await f.observers.observe(authoringReader, f.input("quasar")),
      );
      expect(absent.articles).toEqual([]);
    });

    it("projects approved content only, excludes private provenance and draft edits, and detaches data", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      let current = await f.createDraft();
      current = await f.setSources(current, [
        {
          id: "private/guide",
          system: "synthetic",
          resourceId: "PRIVATE_SOURCE_CANARY",
          version: "1",
        },
      ]);
      current = (await f.submitEvidence(current)).current;
      await f.publish(current);
      await change(f, "draft");
      const result = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      expect(result.articles[0]?.title).toBe(draft().title);
      const serialized = JSON.stringify(result);
      for (const canary of [
        "PRIVATE_STAFF_EVIDENCE",
        "PRIVATE_SOURCE_CANARY",
        "UNAPPROVED_DRAFT_CANARY",
        "sourceSnapshotHash",
        "publishedProvenance",
        "reviewerId",
      ])
        expect(serialized).not.toContain(canary);
      expect(f.privateSources.canPublish).toHaveBeenCalled();
      expect(f.privateSources.isCurrent).toHaveBeenCalled();
      Reflect.set(result.articles[0]!, "title", "Mutated projection");
      await f.observers.confirm(authoringReader, result.observation);
      expect(
        (
          await f.app.getPublishedArticle(customer, {
            articleId: "article/export",
          })
        ).title,
      ).toBe(draft().title);
    });

    it("holds instead of slicing a larger matching set to the requested limit", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      await f.publishedArticle();
      await f.publishedArticle("article/second");
      expect(
        await f.observers.observe(authoringReader, { ...f.input(), limit: 1 }),
      ).toEqual({ outcome: "partial", articles: [] });
    });

    it("holds whole approved content when the content bound cannot fit it", async () => {
      const f = fixture(await createStore(), {
        limits: { maxContentBytes: 1 },
      });
      await f.setupCollection();
      await f.publishedArticle();
      expect(await f.observers.observe(authoringReader, f.input())).toEqual({
        outcome: "partial",
        articles: [],
      });
    });

    it("counts every physical history/nonmatching row before filtering and holds at the total row cap", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const sample = (await allKnowledgeRows(f.backing)).find(
        (row) => row.resourceKind === "collection" && row.kind === "head",
      );
      if (sample === undefined)
        throw new Error("Expected a real collection head");
      const records = f.backing.collection(knowledgeRecords);
      for (let offset = 0; offset < 260; offset += 16)
        await Promise.all(
          Array.from({ length: Math.min(16, 260 - offset) }, (_, index) =>
            records.put({
              ...sample,
              id: `job:physical:${offset + index}`,
              kind: "job",
              data: { task: "collection_changed" },
            }),
          ),
        );
      expect(await f.observers.observe(authoringReader, f.input())).toEqual({
        outcome: "partial",
        articles: [],
      });
      expect(f.scanPasses()).toBe(1);
      expect(
        f.scanPages.reduce((total, page) => total + page.physicalRows, 0),
      ).toBeLessThanOrEqual(256);
      expect(f.scanPages.every((page) => page.requested <= 8)).toBe(true);
    });

    it("reports scan dependency failure as unavailable, never as complete empty", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      f.beforeScan(async () => {
        throw new StorageError("Synthetic backing scan unavailable");
      });
      expect(await f.observers.observe(authoringReader, f.input())).toEqual({
        outcome: "unavailable",
        articles: [],
      });
    });

    it("rejects portal-only readers and missing authoring permission before enumerating", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      for (const denied of [
        customer,
        outsider,
        access(customer.principalId, ["workshop.customer"]),
      ])
        expect(await f.observers.observe(denied, f.input())).toEqual({
          outcome: "unavailable",
          articles: [],
        });
      expect(f.scans()).toBe(0);
    });

    it.each(["publish", "withdraw", "draft", "policy"] as const)(
      "refuses a late %s before the final membership/version fence",
      async (kind) => {
        const f = fixture(await createStore());
        await f.setupCollection();
        await f.publishedArticle();
        f.beforeScan(async (_ordinal, pass, input) => {
          if (pass === 2 && input.cursor === undefined) await change(f, kind);
        });
        expect(await f.observers.observe(authoringReader, f.input())).toEqual({
          outcome: "unavailable",
          articles: [],
        });
      },
    );

    it.each(["publish", "withdraw", "draft", "policy"] as const)(
      "rejects and consumes a captured scope after a %s",
      async (kind) => {
        const f = fixture(await createStore());
        await f.setupCollection();
        await f.publishedArticle();
        const result = complete(
          await f.observers.observe(authoringReader, f.input()),
        );
        await change(f, kind);
        await expect(
          f.observers.confirm(authoringReader, result.observation),
        ).rejects.toBeInstanceOf(KnowledgeBasePrerequisiteError);
        await expect(
          f.observers.confirm(authoringReader, result.observation),
        ).rejects.toBeInstanceOf(TypeError);
      },
    );

    it("rejects a new publication during confirmation's final async fence", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const result = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      f.beforeScan(async (_ordinal, pass, input) => {
        if (pass === 4 && input.cursor === undefined)
          await change(f, "publish");
      });
      await expect(
        f.observers.confirm(authoringReader, result.observation),
      ).rejects.toBeInstanceOf(KnowledgeBasePrerequisiteError);
    });

    it("rejects an opaque head-version change even when its generation and payload are unchanged", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      await f.publishedArticle();
      const result = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      const head = (await allKnowledgeRows(f.backing)).find(
        (row) => row.resourceId === "article/export" && row.kind === "head",
      );
      if (head === undefined) throw new Error("Expected the real article head");
      const records = f.backing.collection(knowledgeRecords);
      const saved = await records.getVersioned({
        partition: head.partition,
        id: head.id,
      });
      if (saved === null)
        throw new Error("Expected its opaque backend version");
      expect(await records.putIfUnchanged(saved.value, saved.version)).toBe(
        true,
      );
      await expect(
        f.observers.confirm(authoringReader, result.observation),
      ).rejects.toBeInstanceOf(KnowledgeBasePrerequisiteError);
    });

    it("rechecks current private-source eligibility instead of reusing an earlier publication check", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      let current = await f.createDraft();
      current = await f.setSources(current, [
        {
          id: "source/one",
          system: "synthetic",
          resourceId: "row/one",
          version: "1",
        },
      ]);
      current = (await f.submitEvidence(current)).current;
      await f.publish(current);
      const result = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      f.trust.sourceCurrent = false;
      await expect(
        f.observers.confirm(authoringReader, result.observation),
      ).rejects.toBeInstanceOf(KnowledgeBasePrerequisiteError);
      expect(await f.observers.observe(authoringReader, f.input())).toEqual({
        outcome: "unavailable",
        articles: [],
      });
    });

    it("binds the opaque single-use token to the instance and actor, and rechecks current permission", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const result = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      const foreign = createKnowledgeBaseApplication({
        store: f.backing,
        clock: { now: () => at(600_000) },
      }).publishedSearchObservations!;
      for (const [observer, token] of [
        [f.observers, structuredClone(result.observation)],
        [foreign, result.observation],
      ] as const)
        await expect(
          observer.confirm(authoringReader, token),
        ).rejects.toBeInstanceOf(TypeError);
      await expect(
        f.observers.confirm(
          access("customer/different", authoringReader.permissions),
          result.observation,
        ),
      ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      await expect(
        f.observers.confirm(
          access(authoringReader.principalId, []),
          result.observation,
        ),
      ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      await f.observers.confirm(authoringReader, result.observation);
      await expect(
        f.observers.confirm(authoringReader, result.observation),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it("consumes the token before the first awaited re-observation", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const result = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      const pause = barrier();
      f.beforeScan(async (_ordinal, pass, input) => {
        if (pass === 3 && input.cursor === undefined) await pause.wait();
      });
      const pending = f.observers.confirm(authoringReader, result.observation);
      await pause.reached;
      await expect(
        f.observers.confirm(authoringReader, result.observation),
      ).rejects.toBeInstanceOf(TypeError);
      pause.release();
      await expect(pending).resolves.toBeUndefined();
    });

    it("never allows budget exhaustion or invalid scope input to become complete empty", async () => {
      const f = fixture(await createStore(), {
        limits: { maxRequestPhysicalGets: 2 },
      });
      await f.setupCollection();
      expect(await f.observers.observe(authoringReader, f.input())).toEqual({
        outcome: "partial",
        articles: [],
      });
      await expect(
        f.observers.observe(authoringReader, { ...f.input(), limit: 6 }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        f.observers.observe(authoringReader, { ...f.input(), query: "the" }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        f.observers.observe(authoringReader, {
          ...f.input(),
          applicability: { ...draft().applicability, productVersion: "" },
        }),
      ).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe(`comparison query and catalogue limits (${backend})`, () => {
    it("rejects configured query ceilings and explicit null limit before any I/O", async () => {
      const store = await createStore();
      const characters = fixture(store, { limits: { maxQueryCharacters: 3 } });
      const terms = fixture(store, { limits: { maxQueryTerms: 1 } });
      const normal = fixture(store);
      await expect(
        characters.observers.observe(
          authoringReader,
          characters.input("export"),
        ),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        terms.observers.observe(
          authoringReader,
          terms.input("export workspace"),
        ),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        normal.observers.observe(
          authoringReader,
          JSON.parse(
            JSON.stringify({
              ...normal.input(),
              limit: null,
            }),
          ),
        ),
      ).rejects.toBeInstanceOf(TypeError);
      for (const f of [characters, terms, normal]) {
        expect(f.keyedReads).toEqual([]);
        expect(f.scanPages).toEqual([]);
        expect(f.scans()).toBe(0);
      }
    });

    it("bounds each large private/history payload page while completing the observed cycles", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      await seedHistory(
        f,
        16,
        "large-private",
        "PRIVATE_LARGE_HISTORY_CANARY" + "x".repeat(399_000),
      );
      const observed = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      expect(observed.articles).toEqual([]);
      expect(JSON.stringify(observed)).not.toContain(
        "PRIVATE_LARGE_HISTORY_CANARY",
      );
      expect(f.scanPasses()).toBe(2);
      expect(f.scanPages.length).toBeGreaterThan(2);
      expect(
        f.scanPages.every(
          (page) => page.requested <= 8 && page.physicalRows <= 8,
        ),
      ).toBe(true);
      for (const pass of [1, 2])
        expect(
          f.scanPages.filter((page) => page.pass === pass).at(-1)?.hasCursor,
        ).toBe(false);
    });

    it("honors the exact 256-row terminal contract and never probes a possible 257th row", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const initialRows = (await allKnowledgeRows(f.backing)).length;
      await seedHistory(f, 256 - initialRows, "boundary");
      expect((await allKnowledgeRows(f.backing)).length).toBe(256);
      const result = await f.observers.observe(authoringReader, f.input());
      const firstPass = f.scanPages.filter((page) => page.pass === 1);
      expect(firstPass.reduce((sum, page) => sum + page.physicalRows, 0)).toBe(
        256,
      );
      if (result.outcome === "complete") {
        expect(result.articles).toEqual([]);
        expect(firstPass.at(-1)?.hasCursor).toBe(false);
        expect(
          f.scanPages.filter((page) => page.pass === 2).at(-1)?.hasCursor,
        ).toBe(false);
      } else {
        // A backend's speculative full-page cursor cannot establish that an
        // additional physical record is absent within the hard row allowance.
        expect(result).toEqual({ outcome: "partial", articles: [] });
        expect(firstPass.at(-1)?.hasCursor).toBe(true);
      }
      await seedHistory(f, 1, "overflow");
      const before = f.scanPages.length;
      expect(await f.observers.observe(authoringReader, f.input())).toEqual({
        outcome: "partial",
        articles: [],
      });
      const overflow = f.scanPages.slice(before);
      expect(overflow.reduce((sum, page) => sum + page.physicalRows, 0)).toBe(
        256,
      );
      expect(overflow.every((page) => page.requested <= 8)).toBe(true);
      expect(overflow.at(-1)?.hasCursor).toBe(true);
    });

    it("shares the original physical-work budget across every scan page and early overflow", async () => {
      const f = fixture(await createStore(), {
        limits: { maxRequestPhysicalGets: 12 },
      });
      await f.setupCollection();
      await seedHistory(f, 32, "work-budget");
      expect(await f.observers.observe(authoringReader, f.input())).toEqual({
        outcome: "partial",
        articles: [],
      });
      const actualWork =
        f.keyedReads.length +
        f.scanPages.reduce(
          (sum, page) => sum + Math.max(1, page.physicalRows),
          0,
        );
      expect(actualWork).toBeLessThanOrEqual(12);
      expect(f.scanPages.every((page) => page.requested <= 8)).toBe(true);
      expect(f.scanPasses()).toBe(1);
    });

    it("keeps dependency holds content-free but exposes integrity and programming faults to background operators", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      f.beforeScan(async () => {
        throw new StorageError("Synthetic dependency unavailable");
      });
      expect(await f.observers.observe(authoringReader, f.input())).toEqual({
        outcome: "unavailable",
        articles: [],
      });
      f.beforeScan(async () => {
        throw new RepositoryIntegrityError();
      });
      await expect(
        f.observers.observe(authoringReader, f.input()),
      ).rejects.toBeInstanceOf(RepositoryIntegrityError);
      f.beforeScan(async () => {
        throw new TypeError("Synthetic background programming fault");
      });
      await expect(
        f.observers.observe(authoringReader, f.input()),
      ).rejects.toBeInstanceOf(TypeError);
      f.beforeScan(undefined);
      const observed = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      f.beforeScan(async () => {
        throw new RepositoryIntegrityError();
      });
      await expect(
        f.observers.confirm(authoringReader, observed.observation),
      ).rejects.toBeInstanceOf(RepositoryIntegrityError);
      await expect(
        f.observers.confirm(authoringReader, observed.observation),
      ).rejects.toBeInstanceOf(TypeError);
      f.beforeScan(undefined);
      await f.publishedArticle();
      f.beforeRead(async () => {
        throw new RepositoryIntegrityError();
      });
      await expect(
        f.observers.readArticle(authoringReader, {
          articleId: "article/export",
        }),
      ).rejects.toBeInstanceOf(RepositoryIntegrityError);
      await expect(
        f.app.getPublishedArticle(customer, { articleId: "article/export" }),
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      await expect(
        f.observers.readScope(authoringReader, {
          collectionId: "collection/workshop",
        }),
      ).rejects.toBeInstanceOf(RepositoryIntegrityError);
    });
  });

  describe(`authoring published reads (${backend})`, () => {
    it("compares private audience publications with exact intrinsic permissions and no audience grant", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      await f.publishedArticle();
      expect(authoringReader.permissions).not.toContain("workshop.customer");
      expect(authoringReader.permissions).not.toContain(
        knowledgePermissions.botRead,
      );
      expect(authoringReader.permissions).not.toContain(
        knowledgePermissions.collectionRead,
      );
      expect(authoringReader.roles).toEqual([]);
      expect(authoringReader.entitlements).toEqual([]);
      const current = await f.observers.readArticle(authoringReader, {
        articleId: "article/export",
      });
      expect(current.title).toBe(draft().title);
      expect(current.content).toEqual(draft().content);
      expect(f.scans()).toBe(0);
      await expect(
        f.app.getPublishedArticle(authoringReader, {
          articleId: current.articleId,
        }),
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      await expect(
        f.app.getPublishedArticle(customer, { articleId: current.articleId }),
      ).resolves.toEqual(current);
      const compared = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      expect(compared.articles).toEqual([current]);
      await f.observers.confirm(authoringReader, compared.observation);
    });

    it("admits bot-only authoring comparisons while preserving independent portal and bot readers", async () => {
      const f = retrievalFixture(await createStore());
      const collectionId = "collection/bot-only";
      await f.setupCollection(collectionId, false);
      await f.publishGuide(retrievalGuides[0], collectionId);
      const observers = f.app.publishedSearchObservations!;
      const scope = await observers.readScope(authoringReader, {
        collectionId,
      });
      const current = await observers.readArticle(authoringReader, {
        articleId: retrievalGuides[0]!.id,
      });
      expect(current.collectionId).toBe(scope.collectionId);
      const compared = complete(
        await observers.observe(authoringReader, {
          ...f.portalInput(),
          collectionId,
        }),
      );
      expect(compared.articles).toEqual([current]);
      await observers.confirm(authoringReader, compared.observation);
      await expect(
        f.app.getPublishedArticle(customer, { articleId: current.articleId }),
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      expect(
        await f.app.searchPublishedArticles(customer, {
          ...f.portalInput(),
          collectionId,
        }),
      ).toEqual({ outcome: "no_result", articles: [] });
      const answer = await f.app.retrieveAnswerSources(botCustomer, {
        ...f.botInput(),
        collectionIds: [collectionId],
      });
      expect(answer.sources).toHaveLength(1);
      expect(answer.sources[0]?.citation).not.toHaveProperty("portalArticle");
      expect(
        (
          await f.app.retrieveAnswerSources(authoringReader, {
            ...f.botInput(),
            collectionIds: [collectionId],
          })
        ).sources,
      ).toEqual([]);
    });

    it("refuses portal-only and draft-only callers without changing their ordinary reads", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      await f.publishedArticle();
      await expect(
        f.app.getPublishedArticle(customer, { articleId: "article/export" }),
      ).resolves.toEqual(
        expect.objectContaining({ articleId: "article/export" }),
      );
      const draftOnly = access("staff/draft-only", [
        knowledgePermissions.draftRead,
      ]);
      await expect(
        f.app.getDraft(draftOnly, { articleId: "article/export" }),
      ).resolves.toEqual(
        expect.objectContaining({ articleId: "article/export" }),
      );
      for (const caller of [customer, draftOnly]) {
        await expect(
          f.observers.readScope(caller, {
            collectionId: "collection/workshop",
          }),
        ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
        await expect(
          f.observers.readArticle(caller, {
            articleId: "article/export",
          }),
        ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
        expect(await f.observers.observe(caller, f.input())).toEqual({
          outcome: "unavailable",
          articles: [],
        });
      }
      expect(f.scans()).toBe(0);
    });

    it("rechecks revoked articleRead and draftRead without treating an observation as authority", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      await f.publishedArticle();
      const observed = complete(
        await f.observers.observe(authoringReader, f.input()),
      );
      for (const permission of [
        knowledgePermissions.articleRead,
        knowledgePermissions.draftRead,
      ]) {
        const revoked = resolveAccess(
          { principalId: authoringReader.principalId },
          {
            version: "pg-background-learning-draft-revoked",
            defaults: authoringReader.permissions.filter(
              (value) => value !== permission,
            ),
          },
        );
        await expect(
          f.observers.readScope(revoked, {
            collectionId: "collection/workshop",
          }),
        ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
        await expect(
          f.observers.readArticle(revoked, {
            articleId: "article/export",
          }),
        ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
        await expect(
          f.observers.confirm(revoked, observed.observation),
        ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      }
      await f.observers.confirm(authoringReader, observed.observation);
    });

    it("returns the approved publication while a new private draft exists, then refuses retirement", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      await f.publishedArticle();
      await change(f, "draft");
      const current = await f.observers.readArticle(authoringReader, {
        articleId: "article/export",
      });
      expect(current.title).toBe(draft().title);
      expect(JSON.stringify(current)).not.toContain("UNAPPROVED_DRAFT_CANARY");
      await f.createDraft("article/draft-only");
      for (const articleId of ["article/missing", "article/draft-only"])
        await expect(
          f.observers.readArticle(authoringReader, { articleId }),
        ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      await change(f, "withdraw");
      await expect(
        f.observers.readArticle(authoringReader, {
          articleId: "article/export",
        }),
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      expect(f.scans()).toBe(0);
    });

    it("refuses a publication held by actual evidence revocation", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      await f.publishedArticle();
      const current = await f.app.getDraft(author, {
        articleId: "article/export",
      });
      const proof = (
        await f.app.getEvidence(admin, {
          articleId: current.articleId,
        })
      ).evidence[0]!;
      await f.app.revokeEvidence(admin, {
        ...f.command("authoring-proof-withdrawal", current.generation),
        articleId: current.articleId,
        articleRevision: proof.articleRevision,
        evidenceId: proof.id,
        evidenceVersion: proof.version,
        evidenceHash: proof.hash,
        reason: "Synthetic exact proof withdrawal",
      });
      await expect(
        f.observers.readArticle(authoringReader, {
          articleId: current.articleId,
        }),
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      expect(f.scans()).toBe(0);
    });

    it("keeps current private-source eligibility as a publication read gate", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      let current = await f.createDraft();
      current = await f.setSources(current, [
        {
          id: "source/authoring",
          system: "synthetic",
          resourceId: "row/private",
          version: "1",
        },
      ]);
      current = (await f.submitEvidence(current)).current;
      await f.publish(current);
      await f.observers.readArticle(authoringReader, {
        articleId: current.articleId,
      });
      f.trust.sourceCurrent = false;
      await expect(
        f.observers.readArticle(authoringReader, {
          articleId: current.articleId,
        }),
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      expect(f.scans()).toBe(0);
    });
  });

  describe(`keyed published scope (${backend})`, () => {
    const intrinsic = authoringReader;

    it("reads the actual scope with intrinsic authority and no collectionRead or enumeration", async () => {
      const f = fixture(await createStore());
      const actual = await f.setupCollection();
      expect(intrinsic.permissions).not.toContain(
        knowledgePermissions.collectionRead,
      );
      expect(intrinsic.permissions).not.toContain("workshop.customer");
      expect(intrinsic.roles).toEqual([]);
      expect(intrinsic.entitlements).toEqual([]);
      const state = await f.observers.readScope(intrinsic, {
        collectionId: "collection/workshop",
      });
      expect(Object.keys(state).sort()).toEqual([
        "collectionId",
        "generation",
        "scopeHash",
      ]);
      expect(state.collectionId).toBe(actual.collection.id);
      expect(state.generation).toBe(actual.generation);
      expect(state.scopeHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(f.scans()).toBe(0);
      expect(f.keyedReads.length).toBeGreaterThan(0);
      expect(new Set(f.keyedReads.map(({ key }) => key.partition)).size).toBe(
        1,
      );
      expect(
        await f.observers.readScope(intrinsic, {
          collectionId: "collection/workshop",
        }),
      ).toEqual(state);
      expect(f.scans()).toBe(0);
    });

    it("returns the same actual scopeState with a complete empty observation", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const observed = complete(
        await f.observers.observe(intrinsic, f.input()),
      );
      expect(observed.articles).toEqual([]);
      const scans = f.scans();
      const keyed = await f.observers.readScope(intrinsic, {
        collectionId: "collection/workshop",
      });
      expect(observed.scopeState).toEqual(keyed);
      expect(f.scans()).toBe(scans);
      await f.observers.confirm(intrinsic, observed.observation);
    });

    it("refuses a missing or closed scope without fabricating fresh state", async () => {
      const f = fixture(await createStore());
      await expect(
        f.observers.readScope(intrinsic, {
          collectionId: "collection/missing",
        }),
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      await f.setupCollection("collection/closed", false);
      const preview = await f.authoringApp.previewCollectionPolicy(admin, {
        collectionId: "collection/closed",
        uses: { portal: { enabled: false }, bot: { enabled: false } },
      });
      await f.authoringApp.updateCollectionPolicy(admin, {
        ...f.command("close-all-scope-channels", preview.generation),
        collectionId: "collection/closed",
        preview: preview.preview,
      });
      await expect(
        f.observers.readScope(intrinsic, { collectionId: "collection/closed" }),
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      expect(f.scans()).toBe(0);
    });

    it("rechecks current authoring permission without an ambient audience role", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const request = { collectionId: "collection/workshop" };
      await f.observers.readScope(intrinsic, request);
      const withdrawnRole = {
        ...access(intrinsic.principalId, [knowledgePermissions.articleRead]),
        roles: ["former-learning-role"],
      };
      await expect(
        f.observers.readScope(withdrawnRole, request),
      ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      await expect(
        f.observers.readScope(
          access(intrinsic.principalId, ["workshop.customer"]),
          request,
        ),
      ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      await expect(
        f.observers.readScope(
          access(intrinsic.principalId, [knowledgePermissions.collectionRead]),
          request,
        ),
      ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      await expect(f.observers.readScope(intrinsic, request)).resolves.toEqual(
        expect.objectContaining(request),
      );
      expect(f.scans()).toBe(0);
    });

    it("binds customer audience changes without requiring that audience for staff authoring", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const request = { collectionId: "collection/workshop" };
      const before = await f.observers.readScope(intrinsic, request);
      const preview = await f.authoringApp.previewCollectionPolicy(admin, {
        ...request,
        uses: {
          portal: {
            enabled: true,
            audience: { kind: "permission", permission: "workshop.next" },
          },
          bot: { enabled: false },
        },
      });
      await f.authoringApp.updateCollectionPolicy(admin, {
        ...f.command("replace-scope-audience", preview.generation),
        ...request,
        preview: preview.preview,
      });
      const after = await f.observers.readScope(intrinsic, request);
      expect(intrinsic.permissions).not.toContain("workshop.next");
      expect(after.generation).toBeGreaterThan(before.generation);
      expect(after.scopeHash).not.toBe(before.scopeHash);
      expect(f.scans()).toBe(0);
    });

    it("binds collection generation changes even when portal policy is unchanged", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const request = { collectionId: "collection/workshop" };
      const before = await f.observers.readScope(intrinsic, request);
      const actual = await f.authoringApp.getGovernanceConfiguration(
        admin,
        request,
      );
      await f.authoringApp.putGovernanceConfiguration(admin, {
        ...f.command("replace-scope-generation", actual.generation),
        ...request,
        configuration: {
          ...actual.configuration,
          expectedStagingBuildId: "staging-43",
        },
      });
      const after = await f.observers.readScope(intrinsic, request);
      expect(after.generation).toBeGreaterThan(before.generation);
      expect(after.scopeHash).not.toBe(before.scopeHash);
      expect(f.scans()).toBe(0);
    });

    it("binds an actual opaque collection version change without exposing the version", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const request = { collectionId: "collection/workshop" };
      const before = await f.observers.readScope(intrinsic, request);
      const head = (await allKnowledgeRows(f.backing)).find(
        (row) => row.resourceId === request.collectionId && row.kind === "head",
      );
      if (head === undefined)
        throw new Error("Expected the real collection head");
      const records = f.backing.collection(knowledgeRecords);
      const current = await records.getVersioned(head);
      if (current === null) throw new Error("Expected its opaque version");
      expect(await records.putIfUnchanged(current.value, current.version)).toBe(
        true,
      );
      const after = await f.observers.readScope(intrinsic, request);
      expect(after.generation).toBe(before.generation);
      expect(after.scopeHash).not.toBe(before.scopeHash);
      expect(after).not.toHaveProperty("version");
      expect(f.scans()).toBe(0);
    });

    it("rejects a late policy change after hashing and before the final keyed head read", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const head = (await allKnowledgeRows(f.backing)).find(
        (row) =>
          row.resourceId === "collection/workshop" && row.kind === "head",
      );
      if (head === undefined)
        throw new Error("Expected the real collection head");
      let heads = 0;
      f.beforeRead(async ({ method, key }) => {
        if (
          method !== "getVersioned" ||
          key.partition !== head.partition ||
          key.id !== "head"
        )
          return;
        heads += 1;
        if (heads === 2) await change(f, "policy");
      });
      await expect(
        f.observers.readScope(intrinsic, {
          collectionId: "collection/workshop",
        }),
      ).rejects.toBeInstanceOf(KnowledgeBasePrerequisiteError);
      expect(f.scans()).toBe(0);
    });

    it("validates public policy approval while exposing no policy or staff metadata", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const request = { collectionId: "collection/workshop" };
      const preview = await f.authoringApp.previewCollectionPolicy(admin, {
        ...request,
        uses: {
          portal: { enabled: true, audience: { kind: "anonymous" } },
          bot: { enabled: false },
        },
      });
      await f.authoringApp.updateCollectionPolicy(admin, {
        ...f.command("approve-public-scope", preview.generation),
        ...request,
        preview: preview.preview,
        approvePublic: true,
      });
      const state = await f.observers.readScope(intrinsic, request);
      expect(Object.keys(state).sort()).toEqual([
        "collectionId",
        "generation",
        "scopeHash",
      ]);
      const serialized = JSON.stringify(state);
      for (const hidden of [
        "portal",
        "audience",
        "publicApproval",
        "trustedAttesterIds",
        "staff/workshop",
        "configuration",
      ])
        expect(serialized).not.toContain(hidden);
      expect(f.scans()).toBe(0);
    });

    it("does not turn a keyed authority state into a fresh catalogue membership claim", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const request = { collectionId: "collection/workshop" };
      const before = await f.observers.readScope(intrinsic, request);
      await f.publishedArticle();
      const after = await f.observers.readScope(intrinsic, request);
      expect(after).toEqual(before);
      expect(f.scans()).toBe(0);
    });

    it("throws on dependency or input failure instead of returning invented state", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      f.beforeRead(async () => {
        throw new StorageError(
          "Synthetic current scope dependency unavailable",
        );
      });
      await expect(
        f.observers.readScope(intrinsic, {
          collectionId: "collection/workshop",
        }),
      ).rejects.toBeInstanceOf(KnowledgeBasePrerequisiteError);
      await expect(
        f.observers.readScope(intrinsic, { collectionId: "" }),
      ).rejects.toBeInstanceOf(TypeError);
      expect(f.scans()).toBe(0);
    });
  });
}
