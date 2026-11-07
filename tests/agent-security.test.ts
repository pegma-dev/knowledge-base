import type { AccessContext } from "@pegma/authorization-core";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import { knowledgeLimits } from "@pegma/knowledge-base-core";
import {
  createKnowledgeAgentDispatcher,
  createKnowledgeAgentHttp,
  createKnowledgeAgentMcp,
  defaultKnowledgeAgentLimits,
  knowledgeAgentScopes,
  knowledgeAgentToolNames,
  type KnowledgeAgentIdentity,
} from "@pegma/knowledge-base-mcp";
import { createMemoryStore } from "@pegma/storage-core";
import { describe, expect, it, vi } from "vitest";
import {
  access,
  admin,
  author,
  draft,
  evidence,
} from "../test/application-fixtures.js";
import {
  agentApiUrl,
  agentChannels,
  agentFixture,
  agentIdentity,
  agentMetadataUrl,
  agentOrigin,
  agentResource,
  agentResult,
  expectPrivateAgentError,
} from "../test/agent-fixtures.js";
import { allKnowledgeRows } from "../test/application-stores.js";

const read = {
  apiVersion: "1",
  operation: "getDraft",
  input: { articleId: "article/export" },
};

function request(
  body: BodyInit | null = JSON.stringify(read),
  init: RequestInit = {},
  url = agentApiUrl,
) {
  const headers = new Headers({
    Authorization: "Bearer synthetic-credential",
    "Content-Type": "application/json",
  });
  for (const [key, value] of new Headers(init.headers)) headers.set(key, value);
  return new Request(url, {
    method: "POST",
    body,
    duplex: "half",
    ...init,
    headers,
  } as RequestInit);
}

async function error(response: Response | null, status: number, code?: string) {
  expect(response).not.toBeNull();
  expect(response!.status).toBe(status);
  expect(response!.headers.get("Cache-Control")).toBe("no-store");
  expectPrivateAgentError(await response!.json(), code);
  return response!;
}

describe("KB agent least-authority security", () => {
  it("intersects credential scopes with fresh current permissions for every operation", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    const current = await f.createDraft();
    const requirements = {
      collectionId: current.revision.collectionId,
      kind: "explanation",
    };
    const before = await allKnowledgeRows(f.store);
    const cases = [
      {
        scopes: [knowledgeAgentScopes.draftRead],
        permissions: [knowledgeAgentScopes.draftWrite],
      },
      {
        scopes: [knowledgeAgentScopes.draftWrite],
        permissions: [knowledgeAgentScopes.draftRead],
      },
      { scopes: [], permissions: Object.values(knowledgePermissions) },
      { scopes: Object.values(knowledgeAgentScopes), permissions: [] },
    ];
    for (const test of cases) {
      f.authority.current = {
        ...agentIdentity(),
        scopes: test.scopes,
        access: {
          ...access(author.principalId, test.permissions),
          roles: ["knowledge.admin", "knowledge.author"],
          entitlements: Object.values(knowledgePermissions),
        },
      };
      for (const channel of agentChannels) {
        expectPrivateAgentError(
          await f.call(channel, "getDraft", { articleId: current.articleId }),
          "forbidden",
        );
        expectPrivateAgentError(
          await f.call(channel, "createDraft", {
            ...f.command("scope-denied", 0),
            articleId: "article/denied",
            collectionId: current.revision.collectionId,
            draft: draft(),
          }),
          "forbidden",
        );
        expectPrivateAgentError(
          await f.call(channel, "getValidationRequirements", requirements),
          "forbidden",
        );
      }
    }
    // Read and management permissions do not imply author requirements.
    f.authority.current = {
      ...agentIdentity(),
      access: admin,
      scopes: [
        knowledgeAgentScopes.draftRead,
        knowledgePermissions.validationManage,
      ],
    };
    for (const channel of agentChannels)
      expectPrivateAgentError(
        await f.call(channel, "getValidationRequirements", requirements),
        "forbidden",
      );
    for (const scope of [
      knowledgeAgentScopes.draftWrite,
      knowledgeAgentScopes.evidenceSubmit,
    ]) {
      f.authority.current = {
        ...agentIdentity(),
        scopes: [scope],
        access: access(author.principalId, [scope]),
      };
      for (const channel of agentChannels)
        expect(
          agentResult(
            await f.call(channel, "getValidationRequirements", requirements),
            "getValidationRequirements",
          ).checks,
        ).toHaveLength(1);
    }
    expect(await allKnowledgeRows(f.store)).toEqual(before);
  });

  it("passes a detached context containing only the three intersected permissions", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    const current = await f.createDraft();
    const forwarded: AccessContext[] = [];
    const dispatcher = createKnowledgeAgentDispatcher({
      resource: agentResource,
      application: {
        ...f.app,
        getDraft: async (context, input) => {
          forwarded.push(context);
          return f.app.getDraft(context, input);
        },
      },
    });
    const identity: KnowledgeAgentIdentity = {
      ...agentIdentity(),
      access: {
        ...admin,
        roles: ["admin"],
        entitlements: ["all"],
        permissions: [
          ...admin.permissions,
          ...Array.from(
            { length: 100 },
            (_, index) => `unrelated.permission.${index}`,
          ),
        ],
      },
      scopes: [...Object.values(knowledgePermissions), "*"],
    };
    agentResult(await dispatcher.dispatch(identity, read), "getDraft");
    expect(forwarded).toEqual([
      {
        principalId: admin.principalId,
        policyVersion: admin.policyVersion,
        roles: [],
        entitlements: [],
        permissions: Object.values(knowledgeAgentScopes),
      },
    ]);
    expect(forwarded[0]).not.toBe(identity.access);
    expect(current.revision.createdBy).toBe(author.principalId);
    f.authority.current = identity;
    for (const channel of agentChannels)
      agentResult(await f.call(channel, "getDraft", read.input), "getDraft");
  });

  it("exposes exactly five tools even to an administrator and refuses private or staff operations", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    await f.createDraft();
    f.authority.current = {
      ...agentIdentity(),
      access: admin,
      scopes: [...Object.values(knowledgePermissions), "*"],
    };
    const client = await f.sdk();
    expect(
      (await client.listTools()).tools.map((tool) => tool.name).sort(),
    ).toEqual(Object.values(knowledgeAgentToolNames).sort());
    const before = await allKnowledgeRows(f.store);
    for (const operation of [
      "getEvidence",
      "getProvenance",
      "setProvenance",
      "getReview",
      "submitForReview",
      "rejectReview",
      "publishArticle",
      "retireArticle",
      "revokeEvidence",
      "createCollection",
      "getCollection",
      "updateCollectionPolicy",
      "putValidationPolicy",
      "getGovernanceConfiguration",
      "putGovernanceConfiguration",
      "getPublishedArticle",
      "searchPublishedArticles",
    ]) {
      const response = await f.httpRequest({
        apiVersion: "1",
        operation,
        input: {
          articleId: "article/export",
          credential: "PRIVATE_SUBMITTED_CREDENTIAL",
        },
      });
      await error(response, 400, "invalid_request");
      expectPrivateAgentError(
        await f.dispatcher.dispatch(f.authority.current, {
          apiVersion: "1",
          operation,
          input: {},
        }),
        "invalid_request",
      );
    }
    for (const name of [
      "knowledge_v1_publish_article",
      "knowledge_v1_get_evidence",
      "knowledge_v1_set_provenance",
    ]) {
      const result = await client.callTool({
        name,
        arguments: {
          articleId: "article/export",
          receipt: "PRIVATE_FAKE_PROOF",
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(
        /PRIVATE_FAKE_PROOF|staff\/workshop/u,
      );
    }
    expect(await allKnowledgeRows(f.store)).toEqual(before);
  });

  it("re-resolves current authority on both transports and fails closed on revocation and outage", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    await f.createDraft();
    for (const channel of agentChannels)
      agentResult(await f.call(channel, "getDraft", read.input), "getDraft");
    const authenticatedBefore = f.authenticate.mock.calls.length;
    f.authority.current = {
      ...agentIdentity(),
      access: access(author.principalId, []),
    };
    for (const channel of agentChannels)
      expectPrivateAgentError(
        await f.call(channel, "getDraft", read.input),
        "forbidden",
      );
    expect(f.authenticate.mock.calls.length).toBeGreaterThanOrEqual(
      authenticatedBefore + 2,
    );
    f.authority.current = agentIdentity();
    agentResult(await f.call("MCP", "getDraft", read.input), "getDraft");
    f.authority.unavailable = true;
    await error(await f.http.handle(request()), 503, "unavailable");
    await error(
      await f.mcp.handle(
        request(
          JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
          {},
          agentResource,
        ),
      ),
      503,
      "unavailable",
    );
  });

  it("binds credentials to the exact resource and keeps independently composed stores isolated", async () => {
    const a = agentFixture(createMemoryStore());
    const b = agentFixture(createMemoryStore());
    await a.setupCollection();
    await a.createDraft();
    for (const channel of agentChannels)
      expectPrivateAgentError(
        await b.call(channel, "getDraft", read.input),
        "not_found",
      );
    a.authority.current = {
      ...agentIdentity(),
      resource: "https://other.example/agent/mcp",
    };
    await error(await a.http.handle(request()), 401, "invalid_token");
    await error(
      await a.mcp.handle(request("{}", {}, agentResource)),
      401,
      "invalid_token",
    );
    expectPrivateAgentError(
      await a.dispatcher.dispatch(a.authority.current, read),
      "forbidden",
    );
  });

  it("rejects supplied actors, authority and proof fields without trusting a passed string", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    const current = await f.createDraft();
    f.setTime(3_000);
    const input = {
      ...f.command("forged", current.generation),
      articleId: current.articleId,
      evidence: evidence(current.revision),
      receipt: "PRIVATE_FORGED_RECEIPT",
    };
    const before = await allKnowledgeRows(f.store);
    const forged = [
      { ...input, access: admin },
      { ...input, actorId: admin.principalId },
      { ...input, scopes: Object.values(knowledgePermissions) },
      {
        ...input,
        evidence: {
          ...input.evidence,
          attestation: {
            id: "PRIVATE_PROOF",
            verifiedBy: "staff/verifier",
            verifiedAt: "2026-11-06T20:00:03.000Z",
          },
        },
      },
      {
        ...input,
        evidence: { ...input.evidence, hash: "a".repeat(64), version: 1 },
      },
    ];
    for (const candidate of forged)
      for (const channel of agentChannels)
        expectPrivateAgentError(
          await f.call(channel, "submitEvidence", candidate),
          "invalid_request",
        );
    expect(f.verify).not.toHaveBeenCalled();
    for (const channel of agentChannels)
      expectPrivateAgentError(
        await f.call(channel, "submitEvidence", input),
        "prerequisite",
      );
    expect(await allKnowledgeRows(f.store)).toEqual(before);
  });
});

describe("KB agent hostile request and transport boundary", () => {
  it("requires host admission configuration and refuses insecure or ambiguous endpoint URLs", () => {
    const f = agentFixture(createMemoryStore());
    const options = { ...f.common, apiUrl: agentApiUrl };
    for (const apiUrl of [
      "http://knowledge.example/agent/v1",
      `${agentApiUrl}?token=secret`,
      `${agentApiUrl}#fragment`,
      "https://user:secret@knowledge.example/agent/v1",
    ])
      expect(() => createKnowledgeAgentHttp({ ...options, apiUrl })).toThrow(
        TypeError,
      );
    expect(() =>
      createKnowledgeAgentHttp({ ...options, limit: undefined! }),
    ).toThrow(TypeError);
    expect(() =>
      createKnowledgeAgentHttp({ ...options, authenticate: undefined! }),
    ).toThrow(TypeError);
    expect(() =>
      createKnowledgeAgentMcp({
        ...f.common,
        mcpUrl: "https://other.example/mcp",
      }),
    ).toThrow(TypeError);
    expect(() => f.makeHttp({ allowedOrigins: [`${agentOrigin}/`] })).toThrow(
      TypeError,
    );
    expect(() =>
      f.makeHttp({
        protectedResourceMetadataUrl: "http://metadata.example/resource",
      }),
    ).toThrow(TypeError);
  });

  it("rejects wrong Host, Origin, endpoint authority, query tokens, and DNS rebinding before authentication", async () => {
    const f = agentFixture(createMemoryStore());
    const hostile = [
      request(undefined, { headers: { Host: "attacker.example" } }),
      request(undefined, {
        headers: { Host: "knowledge.example@attacker.example" },
      }),
      request(undefined, { headers: { Origin: "https://attacker.example" } }),
      request(undefined, { headers: { Origin: "null" } }),
      request(undefined, {}, "https://attacker.example/agent/v1"),
      request(undefined, {}, `${agentApiUrl}?access_token=PRIVATE_TOKEN`),
      request(undefined, {}, `${agentApiUrl}?unrelated=1`),
    ];
    for (const candidate of hostile) {
      const response = await f.http.handle(candidate);
      expect(response).not.toBeNull();
      expect([400, 403]).toContain(response!.status);
      expectPrivateAgentError(await response!.json());
    }
    const loopback = f.makeHttp({
      apiUrl: "http://127.0.0.1:19999/agent/v1",
      allowInsecureLoopback: true,
    });
    await error(
      await loopback.handle(
        request(
          undefined,
          { headers: { Host: "rebound.attacker.example:19999" } },
          "http://127.0.0.1:19999/agent/v1",
        ),
      ),
      400,
      "invalid_request",
    );
    expect(f.authenticate).not.toHaveBeenCalled();
    expect(f.limit).not.toHaveBeenCalled();
    expect(
      await f.http.handle(
        request(undefined, {}, "https://knowledge.example/unrelated"),
      ),
    ).toBeNull();
  });

  it("accepts only bounded ASCII header bearer credentials and normalizes host rejections", async () => {
    const f = agentFixture(createMemoryStore());
    for (const authorization of [
      "",
      "Basic c2VjcmV0",
      "Bearer",
      "Bearer x,y",
      "Bearer PRIVATE_\u00e9_TOKEN",
      `Bearer ${"a".repeat(8_193)}`,
    ])
      await error(
        await f.http.handle(
          request(undefined, {
            headers: {
              Authorization: authorization,
              Cookie: "session=PRIVATE_COOKIE",
            },
          }),
        ),
        401,
        "invalid_token",
      );
    expect(f.authenticate).not.toHaveBeenCalled();
    for (const status of [401, 403, 302, 500]) {
      f.authority.rejected = new Response("PRIVATE_AUTHENTICATION_DETAILS", {
        status,
        headers: {
          "Set-Cookie": "PRIVATE_COOKIE",
          Location: "https://private.example",
          "WWW-Authenticate": "PRIVATE_CHALLENGE",
        },
      });
      const response = await error(
        await f.http.handle(request()),
        status === 401 || status === 403 ? status : 503,
      );
      for (const header of ["Set-Cookie", "Location"])
        expect(response.headers.get(header)).toBeNull();
      if (status === 401 || status === 403) {
        expect(response.headers.get("WWW-Authenticate")).toContain(
          `resource_metadata="${agentMetadataUrl}"`,
        );
        expect(response.headers.get("WWW-Authenticate")).not.toContain(
          "PRIVATE_CHALLENGE",
        );
      }
    }
  });

  it("runs the required limiter before authentication and body reads and fails closed", async () => {
    const f = agentFixture(createMemoryStore());
    for (const decision of [
      false,
      { allowed: false, retryAfterSeconds: 17 },
      "throws",
    ] as const) {
      let readCount = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull() {
            readCount += 1;
          },
        },
        { highWaterMark: 0 },
      );
      const limit = vi.fn(async () => {
        if (decision === "throws") throw new Error("PRIVATE_LIMITER_OUTAGE");
        return decision;
      });
      const handler = f.makeHttp({ limit });
      const response = await error(
        await handler.handle(request(stream)),
        decision === "throws" ? 503 : 429,
      );
      expect(response.headers.get("Retry-After")).toBe(
        typeof decision === "object" ? "17" : null,
      );
      expect(limit).toHaveBeenCalledOnce();
      expect(readCount).toBe(0);
      expect(f.authenticate).not.toHaveBeenCalled();
      await stream.cancel();
    }
  });

  it("limits actual streaming bytes and chunk count and cancels rejected streams", async () => {
    const f = agentFixture(createMemoryStore());
    for (const mode of ["bytes", "chunks"] as const) {
      let pulls = 0;
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            controller.enqueue(
              new Uint8Array(
                mode === "bytes"
                  ? defaultKnowledgeAgentLimits.maxRequestBytes + 1
                  : 0,
              ),
            );
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      await error(await f.http.handle(request(stream)), 413, "capacity");
      expect(cancel).toHaveBeenCalledOnce();
      expect(pulls).toBeLessThanOrEqual(mode === "bytes" ? 1 : 1_025);
    }
    const cancel = vi.fn();
    const declared = new ReadableStream<Uint8Array>(
      { cancel },
      { highWaterMark: 0 },
    );
    await error(
      await f.http.handle(
        request(declared, {
          headers: {
            "Content-Length": String(
              defaultKnowledgeAgentLimits.maxRequestBytes + 1,
            ),
          },
        }),
      ),
      413,
      "capacity",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects invalid UTF-8, dishonest lengths, compressed or non-JSON bodies, and excessive graphs", async () => {
    const f = agentFixture(createMemoryStore());
    await error(
      await f.http.handle(request(new Uint8Array([0xc3, 0x28]))),
      400,
      "invalid_request",
    );
    await error(
      await f.http.handle(
        request("{}", { headers: { "Content-Length": "1" } }),
      ),
      400,
      "invalid_request",
    );
    await error(
      await f.http.handle(
        request("{}", { headers: { "Content-Length": "-1" } }),
      ),
      400,
      "invalid_request",
    );
    for (const headers of [
      { "Content-Type": "text/plain" },
      { "Content-Type": "application/json; charset=latin1" },
      { "Content-Encoding": "gzip" },
    ])
      await error(
        await f.http.handle(request("{}", { headers })),
        415,
        "unsupported_media_type",
      );
    for (const body of [
      "[".repeat(30) + "0" + "]".repeat(30),
      JSON.stringify(Array(2_000).fill(0)),
      JSON.stringify({
        ...read,
        unexpected: "x".repeat(defaultKnowledgeAgentLimits.maxRequestBytes),
      }),
    ])
      await error(await f.http.handle(request(body)), 413, "capacity");
    for (const envelope of [
      { ...read, apiVersion: "2" },
      { ...read, input: { ...read.input, access: admin } },
      { ...read, extra: "PRIVATE_UNKNOWN_FIELD" },
      { apiVersion: "1", operation: "PRIVATE_UNKNOWN_OPERATION", input: {} },
    ])
      await error(await f.httpRequest(envelope), 400, "invalid_request");
  });

  it("rejects accessors and hostile object graphs without running getters or toJSON", async () => {
    const f = agentFixture(createMemoryStore());
    const getter = vi.fn(() => "PRIVATE_GETTER");
    const accessor = { ...read };
    Object.defineProperty(accessor, "input", { enumerable: true, get: getter });
    const toJSON = vi.fn(() => read);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse = Array(1);
    const symbolic = { ...read, [Symbol("PRIVATE_KEY")]: "PRIVATE_VALUE" };
    const inherited = Object.create(read) as unknown;
    for (const candidate of [
      accessor,
      { ...read, toJSON },
      cycle,
      sparse,
      symbolic,
      inherited,
    ])
      expectPrivateAgentError(
        await f.dispatcher.dispatch(agentIdentity(), candidate),
        "invalid_request",
      );
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
    const identity = agentIdentity();
    Object.defineProperty(identity, "scopes", {
      enumerable: true,
      get: getter,
    });
    expectPrivateAgentError(
      await f.dispatcher.dispatch(identity, read),
      "forbidden",
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("counts UTF-8 rather than characters and never returns truncated guides", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    const input = {
      ...f.command("utf8-limit", 0),
      articleId: "article/utf8",
      collectionId: "collection/workshop",
      draft: draft(
        "explanation",
        "\u00e9".repeat(knowledgeLimits.contentBytes / 2 + 1),
      ),
    };
    for (const channel of agentChannels)
      expectPrivateAgentError(
        await f.call(channel, "createDraft", input),
        "invalid_request",
      );
    const current = await f.createDraft(
      "article/large",
      "collection/workshop",
      draft("explanation", "x".repeat(8_000)),
    );
    const bounded = createKnowledgeAgentDispatcher({
      application: f.app,
      resource: agentResource,
      limits: { maxResponseBytes: 2_048 },
    });
    expectPrivateAgentError(
      await bounded.dispatch(agentIdentity(), {
        ...read,
        input: { articleId: current.articleId },
      }),
      "capacity",
    );
    expect(
      (await f.app.getDraft(author, { articleId: current.articleId })).revision
        .content.text,
    ).toHaveLength(8_000);
    for (const limits of [
      { maxDepth: 0 },
      { maxRequestBytes: defaultKnowledgeAgentLimits.maxRequestBytes + 1 },
      { maxResponseBytes: 512 },
      { maxNodes: 1, extra: 1 },
    ])
      expect(() =>
        createKnowledgeAgentDispatcher({
          application: f.app,
          resource: agentResource,
          limits,
        }),
      ).toThrow(TypeError);
  });

  it("reserves enough response space for the largest legal acknowledgement before permitting mutations", async () => {
    const store = createMemoryStore();
    const f = agentFixture(store, { maxResponseBytes: 2_048 });
    await f.setupCollection();
    const before = await allKnowledgeRows(store);
    expect(() =>
      createKnowledgeAgentDispatcher({
        application: f.app,
        resource: agentResource,
        limits: { maxResponseBytes: 512 },
      }),
    ).toThrow(TypeError);
    expect(await allKnowledgeRows(store)).toEqual(before);
    const input = {
      ...f.command("largest-acknowledgement", 0),
      articleId: "\u6587".repeat(200),
      collectionId: "collection/workshop",
      draft: draft(),
    };
    const created = agentResult(
      await f.call("HTTP", "createDraft", input),
      "createDraft",
    );
    expect(created.value.id).toBe(input.articleId);
    expect(created.value.generation).toBe(1);
    const committed = await allKnowledgeRows(store);
    expect(
      agentResult(await f.call("MCP", "createDraft", input), "createDraft"),
    ).toEqual({ ...created, replayed: true });
    expect(await allKnowledgeRows(store)).toEqual(committed);
  });

  it("serves explicit CORS for accepted origins and omits credentials and caching", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    await f.createDraft();
    for (const origin of [agentOrigin, undefined]) {
      const response = await f.httpRequest(read, {
        headers: origin === undefined ? {} : { Origin: origin },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        origin ?? null,
      );
      expect(
        response.headers.get("Access-Control-Allow-Credentials"),
      ).toBeNull();
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Vary")).toContain("Origin");
    }
    await error(
      await f.http.handle(request(null, { method: "GET" })),
      405,
      "method_not_allowed",
    );
  });
});
