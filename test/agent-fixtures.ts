import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createKnowledgeAgentDispatcher,
  createKnowledgeAgentHttp,
  createKnowledgeAgentMcp,
  knowledgeAgentScopes,
  knowledgeAgentToolNames,
  type KnowledgeAgentHttpOptions,
  type KnowledgeAgentIdentity,
  type KnowledgeAgentInputMap,
  type KnowledgeAgentLimits,
  type KnowledgeAgentOperation,
  type KnowledgeAgentResponse,
  type KnowledgeAgentResultMap,
} from "@pegma/knowledge-base-mcp";
import type { Store } from "@pegma/storage-core";
import { expect, onTestFinished, vi } from "vitest";
import { applicationFixture, author } from "./application-fixtures.js";

export const agentResource = "https://knowledge.example/agent/mcp";
export const agentApiUrl = "https://knowledge.example/agent/v1";
export const agentMetadataUrl =
  "https://knowledge.example/.well-known/oauth-protected-resource/agent/mcp";
export const agentOrigin = "https://author.example";
export const agentChannels = ["HTTP", "MCP"] as const;
export type AgentChannel = (typeof agentChannels)[number];

export function agentIdentity(): KnowledgeAgentIdentity {
  return {
    access: author,
    scopes: Object.values(knowledgeAgentScopes),
    clientId: "synthetic-local-agent",
    resource: agentResource,
  };
}

/** Current scripted host facts. This is deliberately not an OAuth proof. */
export function agentFixture(
  store: Store,
  limits?: Partial<KnowledgeAgentLimits>,
) {
  const f = applicationFixture(store);
  const authority: {
    current: KnowledgeAgentIdentity;
    rejected?: Response;
    unavailable: boolean;
  } = { current: agentIdentity(), unavailable: false };
  const authenticate = vi.fn(async (_request: Request) => {
    if (authority.unavailable)
      throw new Error("PRIVATE_AUTHORITY_BACKEND_OUTAGE");
    return authority.rejected ?? authority.current;
  });
  const limit = vi.fn(async () => true);
  const dispatcher = createKnowledgeAgentDispatcher({
    application: f.app,
    resource: agentResource,
    ...(limits === undefined ? {} : { limits }),
  });
  const common = {
    dispatcher,
    resource: agentResource,
    protectedResourceMetadataUrl: agentMetadataUrl,
    allowedOrigins: [agentOrigin],
    authenticate,
    limit,
  };
  const http = createKnowledgeAgentHttp({ ...common, apiUrl: agentApiUrl });
  const mcp = createKnowledgeAgentMcp({ ...common, mcpUrl: agentResource });
  let client: Client | undefined;
  const requests: Request[] = [];
  const responses: Response[] = [];
  async function sdk(handler = mcp) {
    if (client !== undefined) return client;
    const connected = new Client({ name: "synthetic-kb-agent", version: "1" });
    onTestFinished(() => connected.close());
    const transport = new StreamableHTTPClientTransport(
      new URL(agentResource),
      {
        requestInit: {
          headers: { Authorization: "Bearer synthetic-credential" },
        },
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request.clone());
          const response = await handler.handle(request);
          if (response === null) throw new Error("MCP request was not routed");
          responses.push(response.clone());
          return response;
        },
      },
    );
    await connected.connect(transport);
    client = connected;
    return connected;
  }
  async function httpRequest(
    envelope: unknown,
    init: RequestInit = {},
    url = agentApiUrl,
  ) {
    const headers = new Headers({
      Authorization: "Bearer synthetic-credential",
      "Content-Type": "application/json",
    });
    for (const [key, value] of new Headers(init.headers))
      headers.set(key, value);
    const response = await http.handle(
      new Request(url, {
        method: "POST",
        body: JSON.stringify(envelope),
        ...init,
        headers,
      }),
    );
    if (response === null) throw new Error("HTTP request was not routed");
    return response;
  }
  async function call(
    channel: AgentChannel,
    operation: KnowledgeAgentOperation,
    input: unknown,
  ): Promise<KnowledgeAgentResponse> {
    if (channel === "HTTP") {
      const response = await httpRequest({ apiVersion: "1", operation, input });
      const envelope = (await response.json()) as KnowledgeAgentResponse;
      expect(response.status).toBe(
        "error" in envelope ? envelope.error.status : 200,
      );
      return envelope;
    }
    const result = await (
      await sdk()
    ).callTool({
      name: knowledgeAgentToolNames[operation],
      arguments: input as KnowledgeAgentInputMap[typeof operation] &
        Record<string, unknown>,
    });
    const content = result.content;
    if (!Array.isArray(content) || content.length !== 1)
      throw new Error("Expected one complete MCP result");
    const block = content[0] as { type?: string; text?: string };
    if (block.type !== "text" || typeof block.text !== "string")
      throw new Error("Expected a text MCP result");
    const envelope = JSON.parse(block.text) as KnowledgeAgentResponse;
    expect(result.isError === true).toBe("error" in envelope);
    return envelope;
  }
  return {
    ...f,
    authority,
    authenticate,
    limit,
    dispatcher,
    http,
    mcp,
    common,
    sdk,
    requests,
    responses,
    httpRequest,
    call,
    makeHttp: (overrides: Partial<KnowledgeAgentHttpOptions>) =>
      createKnowledgeAgentHttp({
        ...common,
        apiUrl: agentApiUrl,
        ...overrides,
      }),
  };
}

export function agentResult<Operation extends KnowledgeAgentOperation>(
  response: KnowledgeAgentResponse,
  operation: Operation,
): KnowledgeAgentResultMap[Operation] {
  expect(response).toMatchObject({ apiVersion: "1", operation });
  if ("error" in response) throw new Error(JSON.stringify(response));
  return response.result as KnowledgeAgentResultMap[Operation];
}

/** No exception text, receipt, verifier, private source, or evidence is public. */
export function expectPrivateAgentError(response: unknown, code?: string) {
  expect(response).toMatchObject({
    apiVersion: "1",
    error: {
      ...(code === undefined ? {} : { code }),
      status: expect.any(Number),
    },
  });
  const encoded = JSON.stringify(response);
  for (const secret of [
    "PRIVATE_",
    "receipt/",
    "staff/verifier",
    "staff/workshop",
    "trustedRunnerIds",
    "trustedAttesterIds",
    "stack",
  ])
    expect(encoded).not.toContain(secret);
}
