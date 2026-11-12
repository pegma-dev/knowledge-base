import {
  createKnowledgeBaseApplication,
  knowledgeRecords,
  KnowledgeBaseAuthorizationError,
  KnowledgeBaseNotFoundError,
  KnowledgeBasePrerequisiteError,
  type KnowledgeRetrievalOptions,
  type PublishedSearchObservationResult,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
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

interface KeyedRead {
  readonly method: "get" | "getVersioned";
  readonly key: EntityKey;
}

function fixture(backing: Store, retrieval: KnowledgeRetrievalOptions = {}) {
  const f = applicationFixture(backing);
  let scans = 0;
  let beforeScan: ((ordinal: number) => Promise<void>) | undefined;
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
              await beforeScan?.(scans);
              return object.scan(input);
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

for (const [backend, createStore] of storeFactories) {
  describe(`background published search observations (${backend})`, () => {
    it("completes and confirms a genuinely empty authorized scope without the index", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const result = complete(await f.observers.observe(customer, f.input()));
      expect(result.articles).toEqual([]);
      expect(f.scans()).toBe(2);
      await expect(
        f.observers.confirm(customer, result.observation),
      ).resolves.toBeUndefined();
      expect(f.scans()).toBe(4);
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
      const result = complete(await f.observers.observe(customer, f.input()));
      expect(result.articles.map(({ articleId }) => articleId)).toEqual([
        "article/export",
      ]);
      expect(result.articles[0]?.content).toEqual(draft().content);
      await f.observers.confirm(customer, result.observation);
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
      const result = complete(await f.observers.observe(customer, f.input()));
      expect(result.articles.map(({ articleId }) => articleId)).toEqual([
        "article/export",
      ]);
      const absent = complete(
        await f.observers.observe(customer, f.input("quasar")),
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
      const result = complete(await f.observers.observe(customer, f.input()));
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
      await f.observers.confirm(customer, result.observation);
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
        await f.observers.observe(customer, { ...f.input(), limit: 1 }),
      ).toEqual({ outcome: "partial", articles: [] });
    });

    it("holds whole approved content when the content bound cannot fit it", async () => {
      const f = fixture(await createStore(), {
        limits: { maxContentBytes: 1 },
      });
      await f.setupCollection();
      await f.publishedArticle();
      expect(await f.observers.observe(customer, f.input())).toEqual({
        outcome: "partial",
        articles: [],
      });
    });

    it("counts every physical history/nonmatching row before filtering and refuses a scan continuation", async () => {
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
      expect(await f.observers.observe(customer, f.input())).toEqual({
        outcome: "partial",
        articles: [],
      });
      expect(f.scans()).toBe(1);
    });

    it("reports scan dependency failure as unavailable, never as complete empty", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      f.beforeScan(async () => {
        throw new Error("Synthetic backing scan unavailable");
      });
      expect(await f.observers.observe(customer, f.input())).toEqual({
        outcome: "unavailable",
        articles: [],
      });
    });

    it("rejects missing article permission and wrong collection audience before enumerating", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      for (const denied of [
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
        f.beforeScan(async (ordinal) => {
          if (ordinal === 2) await change(f, kind);
        });
        expect(await f.observers.observe(customer, f.input())).toEqual({
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
        const result = complete(await f.observers.observe(customer, f.input()));
        await change(f, kind);
        await expect(
          f.observers.confirm(customer, result.observation),
        ).rejects.toBeInstanceOf(KnowledgeBasePrerequisiteError);
        await expect(
          f.observers.confirm(customer, result.observation),
        ).rejects.toBeInstanceOf(TypeError);
      },
    );

    it("rejects a new publication during confirmation's final async fence", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const result = complete(await f.observers.observe(customer, f.input()));
      f.beforeScan(async (ordinal) => {
        if (ordinal === 4) await change(f, "publish");
      });
      await expect(
        f.observers.confirm(customer, result.observation),
      ).rejects.toBeInstanceOf(KnowledgeBasePrerequisiteError);
    });

    it("rejects an opaque head-version change even when its generation and payload are unchanged", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      await f.publishedArticle();
      const result = complete(await f.observers.observe(customer, f.input()));
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
        f.observers.confirm(customer, result.observation),
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
      const result = complete(await f.observers.observe(customer, f.input()));
      f.trust.sourceCurrent = false;
      await expect(
        f.observers.confirm(customer, result.observation),
      ).rejects.toBeInstanceOf(KnowledgeBasePrerequisiteError);
      expect(await f.observers.observe(customer, f.input())).toEqual({
        outcome: "unavailable",
        articles: [],
      });
    });

    it("binds the opaque single-use token to the instance and actor, and rechecks current permission", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const result = complete(await f.observers.observe(customer, f.input()));
      const foreign = createKnowledgeBaseApplication({
        store: f.backing,
        clock: { now: () => at(600_000) },
      }).publishedSearchObservations!;
      for (const [observer, token] of [
        [f.observers, structuredClone(result.observation)],
        [foreign, result.observation],
      ] as const)
        await expect(observer.confirm(customer, token)).rejects.toBeInstanceOf(
          TypeError,
        );
      await expect(
        f.observers.confirm(
          access("customer/different", customer.permissions),
          result.observation,
        ),
      ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      await expect(
        f.observers.confirm(
          access(customer.principalId, []),
          result.observation,
        ),
      ).rejects.toBeInstanceOf(KnowledgeBaseAuthorizationError);
      await f.observers.confirm(customer, result.observation);
      await expect(
        f.observers.confirm(customer, result.observation),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it("consumes the token before the first awaited re-observation", async () => {
      const f = fixture(await createStore());
      await f.setupCollection();
      const result = complete(await f.observers.observe(customer, f.input()));
      const pause = barrier();
      f.beforeScan(async (ordinal) => {
        if (ordinal === 3) await pause.wait();
      });
      const pending = f.observers.confirm(customer, result.observation);
      await pause.reached;
      await expect(
        f.observers.confirm(customer, result.observation),
      ).rejects.toBeInstanceOf(TypeError);
      pause.release();
      await expect(pending).resolves.toBeUndefined();
    });

    it("never allows budget exhaustion or invalid scope input to become complete empty", async () => {
      const f = fixture(await createStore(), {
        limits: { maxRequestPhysicalGets: 2 },
      });
      await f.setupCollection();
      expect(await f.observers.observe(customer, f.input())).toEqual({
        outcome: "partial",
        articles: [],
      });
      await expect(
        f.observers.observe(customer, { ...f.input(), limit: 6 }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        f.observers.observe(customer, { ...f.input(), query: "the" }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        f.observers.observe(customer, {
          ...f.input(),
          applicability: { ...draft().applicability, productVersion: "" },
        }),
      ).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe(`keyed published scope (${backend})`, () => {
    const intrinsic = access("service/learning-draft", [
      knowledgePermissions.articleRead,
      "workshop.customer",
    ]);

    it("reads the actual scope with intrinsic authority and no collectionRead or enumeration", async () => {
      const f = fixture(await createStore());
      const actual = await f.setupCollection();
      expect(intrinsic.permissions).not.toContain(
        knowledgePermissions.collectionRead,
      );
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
      await expect(
        f.observers.readScope(intrinsic, { collectionId: "collection/closed" }),
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      expect(f.scans()).toBe(0);
    });

    it("rechecks current named permission and resolved role audience on every call", async () => {
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
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
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

    it("changes generation and scopeHash on a current audience change and denies the prior audience", async () => {
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
      await expect(
        f.observers.readScope(intrinsic, request),
      ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
      const after = await f.observers.readScope(
        access(intrinsic.principalId, [
          knowledgePermissions.articleRead,
          "workshop.next",
        ]),
        request,
      );
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
      const state = await f.observers.readScope(
        access("portal/approved", [knowledgePermissions.articleRead]),
        request,
      );
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
        throw new Error("Synthetic current scope dependency unavailable");
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
