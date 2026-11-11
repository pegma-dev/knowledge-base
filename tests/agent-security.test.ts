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

const nativeRequestMetadata = {
  callId: "fictional-call",
  threadId: "fictional-thread",
  sessionId: "fictional-session",
  itemId: "fictional-item",
  windowId: "fictional-window",
  traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
  tracestate: "fictional=opaque",
  "x-codex-turn-metadata": {
    turn_id: "fictional-turn",
    workspaces: [{ id: "fictional-workspace" }],
  },
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
  it.each([
    ["native identity and trace fields", nativeRequestMetadata],
    [
      "unknown extension JSON",
      {
        progressToken: 7,
        "com.example/client": {
          enabled: false,
          values: [null, 1, "fictional"],
        },
      },
    ],
  ])(
    "accepts bounded MCP extension metadata from the official SDK: %s",
    async (_name, metadata) => {
      const f = agentFixture(createMemoryStore());
      await f.setupCollection();
      const client = await f.sdk();
      const input = {
        collectionId: "collection/workshop",
        kind: "explanation" as const,
      };
      const expected = await f.call("MCP", "getValidationRequirements", input);
      const before = await allKnowledgeRows(f.store);
      const result = await client.callTool({
        name: knowledgeAgentToolNames.getValidationRequirements,
        arguments: input,
        _meta: metadata,
      });
      expect(result.isError).toBe(false);
      const content = result.content;
      if (
        !Array.isArray(content) ||
        content.length !== 1 ||
        content[0]?.type !== "text"
      )
        throw new Error("Expected one complete official SDK text result");
      expect(JSON.parse(content[0].text)).toEqual(expected);
      const sent = await f.requests.at(-1)!.json();
      expect(sent).toMatchObject({
        method: "tools/call",
        params: { _meta: metadata, arguments: input },
      });
      expect(await allKnowledgeRows(f.store)).toEqual(before);
      expect(JSON.stringify(result)).not.toContain("fictional-thread");
    },
  );

  it.each([
    null,
    [],
    true,
    1,
    "not-an-object",
    { progressToken: null },
    { progressToken: false },
    { progressToken: 0.5 },
    { progressToken: Number.MAX_SAFE_INTEGER + 1 },
    { progressToken: "x".repeat(129) },
  ])(
    "retains MCP metadata object and known progress-token validation: %j",
    async (metadata) => {
      const f = agentFixture(createMemoryStore());
      await f.setupCollection();
      const before = await allKnowledgeRows(f.store);
      const response = await f.mcp.handle(
        request(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 70,
            method: "tools/call",
            params: {
              name: knowledgeAgentToolNames.getValidationRequirements,
              arguments: {
                collectionId: "collection/workshop",
                kind: "explanation",
              },
              _meta: metadata,
            },
          }),
          { headers: { Accept: "application/json, text/event-stream" } },
          agentResource,
        ),
      );
      expect(response?.status).toBe(400);
      expect(await response!.json()).toEqual({
        jsonrpc: "2.0",
        id: 70,
        error: { code: -32600, message: "Invalid MCP request." },
      });
      expect(await allKnowledgeRows(f.store)).toEqual(before);
    },
  );

  it("treats authority-looking and prototype-named metadata as inert JSON, not host identity", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    f.authority.current = {
      ...agentIdentity(),
      scopes: [],
      access: access(author.principalId, []),
    };
    const before = await allKnowledgeRows(f.store);
    const metadata: unknown = JSON.parse(
      '{"__proto__":{"knowledgeMetadataPolluted":true},"constructor":{"prototype":{"knowledgeMetadataPolluted":true}},"permissions":["knowledge.draft.write"],"access":{"principalId":"fictional/admin","roles":["Admin"]},"clientId":"fictional-other-client"}',
    );
    const response = await f.mcp.handle(
      request(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 71,
          method: "tools/call",
          params: {
            name: knowledgeAgentToolNames.getValidationRequirements,
            arguments: {
              collectionId: "collection/workshop",
              kind: "explanation",
            },
            _meta: metadata,
          },
        }),
        { headers: { Accept: "application/json, text/event-stream" } },
        agentResource,
      ),
    );
    expect(response?.status).toBe(200);
    const rpc = await response!.json();
    expect(rpc).toMatchObject({
      result: { isError: true, content: [{ type: "text" }] },
    });
    expect(JSON.stringify(rpc)).toContain("forbidden");
    const result = await f.call("HTTP", "getValidationRequirements", {
      collectionId: "collection/workshop",
      kind: "explanation",
    });
    expectPrivateAgentError(result, "forbidden");
    expect(Object.hasOwn(Object.prototype, "knowledgeMetadataPolluted")).toBe(
      false,
    );
    expect(await allKnowledgeRows(f.store)).toEqual(before);
  });

  it.each([
    { limits: { maxRequestBytes: 256 }, metadata: { value: "x".repeat(257) } },
    { limits: { maxDepth: 4 }, metadata: { nested: { child: { value: 0 } } } },
    { limits: { maxArrayLength: 2 }, metadata: { values: [0, 1, 2] } },
    {
      limits: { maxObjectKeys: 4 },
      metadata: { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 },
    },
  ])(
    "applies the existing complete-message budget to opaque MCP metadata: %j",
    async ({ limits, metadata }) => {
      const f = agentFixture(createMemoryStore(), limits);
      const dispatch = vi.fn(f.dispatcher.dispatch);
      const mcp = createKnowledgeAgentMcp({
        ...f.common,
        dispatcher: { ...f.dispatcher, dispatch },
        mcpUrl: agentResource,
      });
      const response = await mcp.handle(
        request(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 72,
            method: "tools/call",
            params: {
              name: knowledgeAgentToolNames.getValidationRequirements,
              arguments: {
                collectionId: "collection/workshop",
                kind: "explanation",
              },
              _meta: metadata,
            },
          }),
          { headers: { Accept: "application/json, text/event-stream" } },
          agentResource,
        ),
      );
      await error(response, 413, "capacity");
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it("admits the same MCP request with absent or small metadata before rejecting metadata node growth", async () => {
    const f = agentFixture(createMemoryStore(), { maxNodes: 64 });
    await f.setupCollection();
    const dispatch = vi.fn(f.dispatcher.dispatch);
    const mcp = createKnowledgeAgentMcp({
      ...f.common,
      dispatcher: { ...f.dispatcher, dispatch },
      mcpUrl: agentResource,
    });
    const send = (metadata?: unknown) =>
      mcp.handle(
        request(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 72,
            method: "tools/call",
            params: {
              name: knowledgeAgentToolNames.getValidationRequirements,
              arguments: {
                collectionId: "collection/workshop",
                kind: "explanation",
              },
              ...(metadata === undefined ? {} : { _meta: metadata }),
            },
          }),
          { headers: { Accept: "application/json, text/event-stream" } },
          agentResource,
        ),
      );
    for (const metadata of [undefined, { first: [null], second: [null] }]) {
      const response = await send(metadata);
      expect(response?.status).toBe(200);
      expect(await response!.json()).toMatchObject({
        result: { isError: false },
      });
    }
    expect(dispatch).toHaveBeenCalledTimes(2);
    dispatch.mockClear();
    // Each array independently fits the existing array ceiling. Their aggregate
    // graph work exceeds this reduced node budget only when metadata is counted.
    await error(
      await send({ first: Array(32).fill(null), second: Array(32).fill(null) }),
      413,
      "capacity",
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    {
      method: "initialize",
      id: 75,
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "fictional-metadata-client", version: "1" },
      },
      status: 200,
    },
    { method: "ping", id: 76, params: {}, status: 200 },
    { method: "tools/list", id: 77, params: {}, status: 200 },
    { method: "notifications/initialized", params: {}, status: 202 },
    {
      method: "notifications/cancelled",
      params: { requestId: 78, reason: "Fictional cancellation." },
      status: 202,
    },
  ])(
    "accepts bounded shared-schema metadata on $method without invoking the dispatcher",
    async ({ method, id, params, status }) => {
      const f = agentFixture(createMemoryStore());
      const dispatch = vi.fn(f.dispatcher.dispatch);
      const mcp = createKnowledgeAgentMcp({
        ...f.common,
        dispatcher: { ...f.dispatcher, dispatch },
        mcpUrl: agentResource,
      });
      const send = (metadata: unknown) =>
        mcp.handle(
          request(
            JSON.stringify({
              jsonrpc: "2.0",
              ...(id === undefined ? {} : { id }),
              method,
              params: { ...params, _meta: metadata },
            }),
            { headers: { Accept: "application/json, text/event-stream" } },
            agentResource,
          ),
        );
      const response = await send(nativeRequestMetadata);
      expect(response?.status).toBe(status);
      if (status === 202) expect(await response!.text()).toBe("");
      else {
        const value: unknown = await response!.json();
        expect(value).toHaveProperty("result");
        expect(value).not.toHaveProperty("error");
        if (method === "initialize")
          expect(value).toMatchObject({
            result: { capabilities: { tools: {} } },
          });
        if (method === "tools/list")
          expect(value).toMatchObject({
            result: {
              tools: Object.values(knowledgeAgentToolNames).map((name) =>
                expect.objectContaining({ name }),
              ),
            },
          });
      }
      expect((await send({ progressToken: false }))?.status).toBe(400);
      expect(f.authenticate).toHaveBeenCalledTimes(2);
      expect(f.limit).toHaveBeenCalledTimes(2);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it.each(["NaN", "Infinity", "undefined"])(
    "rejects the whole request as invalid JSON when a metadata-position token is %s",
    async (value) => {
      const f = agentFixture(createMemoryStore());
      // This pins whole-body JSON parsing before the metadata schema; it is not
      // a metadata-specific validation oracle.
      const source =
        '{"jsonrpc":"2.0","id":73,"method":"tools/call","params":{"name":"knowledge_v1_get_validation_requirements","arguments":{"collectionId":"collection/workshop","kind":"explanation"},"_meta":{"value":' +
        value +
        "}}}";
      await error(
        await f.mcp.handle(
          request(
            source,
            { headers: { Accept: "application/json, text/event-stream" } },
            agentResource,
          ),
        ),
        400,
        "invalid_request",
      );
    },
  );

  it("keeps extension acceptance inside metadata and leaves envelope and tool arguments closed", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    const packet = {
      jsonrpc: "2.0",
      id: 74,
      method: "tools/call",
      params: {
        name: knowledgeAgentToolNames.getValidationRequirements,
        arguments: { collectionId: "collection/workshop", kind: "explanation" },
        _meta: nativeRequestMetadata,
      },
    };
    for (const body of [
      { ...packet, _meta: nativeRequestMetadata },
      { ...packet, params: { ...packet.params, authority: "forged" } },
    ]) {
      const response = await f.mcp.handle(
        request(
          JSON.stringify(body),
          { headers: { Accept: "application/json, text/event-stream" } },
          agentResource,
        ),
      );
      expect(response?.status).toBe(400);
      expect(await response!.json()).toMatchObject({ error: { code: -32600 } });
    }
    const client = await f.sdk();
    const result = await client.callTool({
      name: packet.params.name,
      arguments: { ...packet.params.arguments, authority: "forged" },
      _meta: nativeRequestMetadata,
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("invalid_request");
  });

  it("does not retain or echo opaque metadata when an actual SDK draft command commits", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    const client = await f.sdk();
    const result = await client.callTool({
      name: knowledgeAgentToolNames.createDraft,
      arguments: {
        ...f.command("metadata-draft", 0),
        articleId: "article/metadata",
        collectionId: "collection/workshop",
        draft: draft(),
      },
      _meta: {
        ...nativeRequestMetadata,
        "com.example/private": "METADATA_ONLY_FICTIONAL_CANARY",
      },
    });
    expect(result.isError).toBe(false);
    expect(
      (await f.app.getDraft(author, { articleId: "article/metadata" })).revision
        .number,
    ).toBe(1);
    expect(JSON.stringify(await allKnowledgeRows(f.store))).not.toContain(
      "METADATA_ONLY_FICTIONAL_CANARY",
    );
    expect(JSON.stringify(result)).not.toContain(
      "METADATA_ONLY_FICTIONAL_CANARY",
    );
  });

  it("authenticates and admits valid MCP notifications without dispatching domain commands", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    const application = { ...f.app };
    const serviceCalls = [
      vi.spyOn(application, "getDraft"),
      vi.spyOn(application, "createDraft"),
      vi.spyOn(application, "updateDraft"),
      vi.spyOn(application, "getValidationRequirements"),
      vi.spyOn(application, "submitEvidence"),
    ];
    const dispatcher = createKnowledgeAgentDispatcher({
      application,
      resource: agentResource,
    });
    const mcp = createKnowledgeAgentMcp({
      ...f.common,
      dispatcher,
      mcpUrl: agentResource,
    });
    const client = await f.sdk(mcp);
    const before = await allKnowledgeRows(f.store);
    f.authenticate.mockClear();
    f.limit.mockClear();
    f.responses.length = 0;
    await client.notification({
      method: "notifications/cancelled",
      params: { requestId: 42, reason: "Synthetic operation was cancelled." },
    });
    expect(f.responses).toHaveLength(1);
    expect(f.responses[0]!.status).toBe(202);
    expect(await f.responses[0]!.text()).toBe("");
    expect(f.authenticate).toHaveBeenCalledTimes(1);
    expect(f.limit).toHaveBeenCalledTimes(1);

    const notifications = [
      {
        jsonrpc: "2.0",
        method: "notifications/synthetic-extension",
        params: { requestId: 43 },
      },
      {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: knowledgeAgentToolNames.createDraft,
          arguments: {
            ...f.command("notification-must-not-create", 0),
            articleId: "article/notification-must-not-exist",
            collectionId: "collection/workshop",
            draft: draft(),
          },
        },
      },
    ];
    for (const notification of notifications) {
      const admittedBefore = f.limit.mock.calls.length;
      const authenticatedBefore = f.authenticate.mock.calls.length;
      const response = await mcp.handle(
        request(
          JSON.stringify(notification),
          { headers: { Accept: "application/json, text/event-stream" } },
          agentResource,
        ),
      );
      expect(response?.status).toBe(202);
      expect(await response!.text()).toBe("");
      expect(f.limit).toHaveBeenCalledTimes(admittedBefore + 1);
      expect(f.authenticate).toHaveBeenCalledTimes(authenticatedBefore + 1);
    }
    const malformed = [
      {
        jsonrpc: "1.0",
        method: "notifications/cancelled",
        params: { requestId: 42 },
      },
      {
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: {} },
      },
      { jsonrpc: "2.0", method: "notifications/cancelled", params: {} },
    ];
    for (const notification of malformed) {
      const response = await mcp.handle(
        request(
          JSON.stringify(notification),
          { headers: { Accept: "application/json, text/event-stream" } },
          agentResource,
        ),
      );
      expect(response?.status).toBe(400);
      expect(JSON.stringify(await response!.json())).not.toContain(
        "Synthetic operation",
      );
    }
    for (const service of serviceCalls) expect(service).not.toHaveBeenCalled();
    expect(await allKnowledgeRows(f.store)).toEqual(before);
  });

  it("enforces each reduced graph budget before parsing JSON on HTTP and MCP", async () => {
    const cases = [
      { limits: { maxDepth: 1 }, body: { child: { value: 0 } } },
      { limits: { maxNodes: 3 }, body: [0, 1, 2, 3] },
      { limits: { maxArrayLength: 2 }, body: [0, 1, 2] },
      { limits: { maxObjectKeys: 2 }, body: { first: 0, second: 1, third: 2 } },
    ];
    for (const test of cases) {
      const f = agentFixture(createMemoryStore(), test.limits);
      const dispatch = vi.fn(f.dispatcher.dispatch);
      const dispatcher = { ...f.dispatcher, dispatch };
      const handlers = [
        [
          agentApiUrl,
          createKnowledgeAgentHttp({
            ...f.common,
            dispatcher,
            apiUrl: agentApiUrl,
          }),
        ],
        [
          agentResource,
          createKnowledgeAgentMcp({
            ...f.common,
            dispatcher,
            mcpUrl: agentResource,
          }),
        ],
      ] as const;
      const source = JSON.stringify(test.body);
      for (const [url, handler] of handlers) {
        const incoming = request(source, {}, url);
        const parse = vi.spyOn(JSON, "parse");
        let response: Response | null;
        try {
          response = await handler.handle(incoming);
          // Filter by the exact caller body so unrelated runtime JSON activity
          // cannot satisfy or invalidate the parse-order assertion.
          expect(
            parse.mock.calls.filter(([input]) => input === source),
          ).toHaveLength(0);
        } finally {
          parse.mockRestore();
        }
        await error(response!, 413, "capacity");
        expect(dispatch).not.toHaveBeenCalled();
      }
    }
  });

  it("accepts explicit IPv6 loopback configuration for synthetic HTTP and MCP hosts", () => {
    const f = agentFixture(createMemoryStore());
    const resource = "http://[::1]:19999/agent/mcp";
    const dispatcher = createKnowledgeAgentDispatcher({
      application: f.app,
      resource,
    });
    const common = {
      ...f.common,
      dispatcher,
      resource,
      protectedResourceMetadataUrl:
        "http://[::1]:19999/.well-known/oauth-protected-resource/agent/mcp",
      allowedOrigins: ["http://[::1]:19999"],
      allowInsecureLoopback: true,
    };
    expect(() =>
      createKnowledgeAgentHttp({
        ...common,
        apiUrl: "http://[::1]:19999/agent/v1",
      }),
    ).not.toThrow();
    expect(() =>
      createKnowledgeAgentMcp({ ...common, mcpUrl: resource }),
    ).not.toThrow();
  });

  it("rejects a UTF-8 BOM instead of accepting otherwise valid HTTP and MCP messages", async () => {
    const f = agentFixture(createMemoryStore());
    await f.setupCollection();
    await f.createDraft();
    const messages = [
      [agentApiUrl, f.http, read],
      [
        agentResource,
        f.mcp,
        {
          jsonrpc: "2.0",
          id: 73,
          method: "tools/call",
          params: {
            name: knowledgeAgentToolNames.getDraft,
            arguments: read.input,
          },
        },
      ],
    ] as const;
    for (const [url, handler, message] of messages) {
      const source = JSON.stringify(message);
      const headers = { Accept: "application/json, text/event-stream" };
      const accepted = await handler.handle(request(source, { headers }, url));
      expect(accepted?.status).toBe(200);
      await accepted!.body?.cancel();
      const bytes = new TextEncoder().encode(`\ufeff${source}`);
      await error(
        await handler.handle(request(bytes, { headers }, url)),
        400,
        "invalid_request",
      );
    }
  });

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
