import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";

import {
  createKnowledgeAgentErrorResponse,
  mapKnowledgeAgentError,
} from "./errors.js";
import {
  knowledgeAgentInputSchemas,
  snapshotKnowledgeAgentJson,
} from "./schemas.js";
import {
  authorizeKnowledgeAgentRequest,
  knowledgeAgentJsonResponse,
  knowledgeAgentRequestMatches,
  knowledgeAgentTransportError,
  readKnowledgeAgentJsonRequest,
  secureKnowledgeAgentResponse,
  validateKnowledgeAgentTransportOptions,
  type KnowledgeAgentTransportOptions,
} from "./transport-common.js";
import {
  knowledgeAgentOperations,
  knowledgeAgentToolNames,
  type KnowledgeAgentDispatcher,
  type KnowledgeAgentOperation,
  type KnowledgeAgentResponse,
} from "./types.js";

export interface KnowledgeAgentMcpOptions extends KnowledgeAgentTransportOptions {
  /** Exact MCP endpoint; it must equal the canonical protected resource. */
  readonly mcpUrl: string;
  readonly dispatcher: KnowledgeAgentDispatcher;
}

export interface KnowledgeAgentMcp {
  /** Null leaves unmatched paths to the host's router. */
  handle(request: Request): Promise<Response | null>;
}

const requestId = z.union([
  z.string().max(128),
  z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
]);
const empty = z.object({}).strict();
const metadata = z.object({ progressToken: requestId.optional() }).strict();
const basicParams = z.object({ _meta: metadata.optional() }).strict();
const featureMap = z.record(
  z.string().max(128),
  z.record(z.string().max(128), z.unknown()),
);

// Client capabilities are descriptive, never an authorization source. Accept
// the pinned protocol vocabulary without enabling any corresponding server API.
const clientCapabilities = z
  .object({
    experimental: featureMap.optional(),
    extensions: featureMap.optional(),
    sampling: z
      .object({ context: empty.optional(), tools: empty.optional() })
      .strict()
      .optional(),
    elicitation: z
      .object({
        form: z
          .object({ applyDefaults: z.boolean().optional() })
          .strict()
          .optional(),
        url: empty.optional(),
      })
      .strict()
      .optional(),
    roots: z
      .object({ listChanged: z.boolean().optional() })
      .strict()
      .optional(),
    tasks: z
      .object({
        list: empty.optional(),
        cancel: empty.optional(),
        requests: z
          .object({
            sampling: z
              .object({ createMessage: empty.optional() })
              .strict()
              .optional(),
            elicitation: z
              .object({ create: empty.optional() })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const clientInfo = z
  .object({
    name: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
    title: z.string().max(256).optional(),
    description: z.string().max(1_024).optional(),
    websiteUrl: z.string().max(2_048).optional(),
    icons: z
      .array(
        z
          .object({
            src: z.string().max(2_048),
            mimeType: z.string().max(128).optional(),
            sizes: z.array(z.string().max(32)).max(16).optional(),
            theme: z.enum(["light", "dark"]).optional(),
          })
          .strict(),
      )
      .max(16)
      .optional(),
  })
  .strict();
const base = { jsonrpc: z.literal("2.0"), id: requestId };
const rpcHeader = z
  .object({
    ...base,
    method: z.string().min(1).max(128),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const methods = new Set([
  "initialize",
  "ping",
  "tools/list",
  "tools/call",
  "notifications/initialized",
]);
const cancelledParams = basicParams.extend({
  requestId,
  reason: z.string().max(1_024).optional(),
});
// Idless envelopes use only SDK notification handlers, even for a tool method.
// Unknown notifications are ignored; cancellation is best-effort and stateless.
const rpcNotification = z
  .object({
    jsonrpc: z.literal("2.0"),
    method: z.string().min(1).max(128),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((notification) => {
    if (notification.method === "notifications/initialized")
      return (
        notification.params === undefined ||
        basicParams.safeParse(notification.params).success
      );
    if (notification.method === "notifications/cancelled")
      return cancelledParams.safeParse(notification.params).success;
    return true;
  });
const rpcRequest = z.union([
  z
    .object({
      ...base,
      method: z.literal("initialize"),
      params: basicParams.extend({
        protocolVersion: z.string().min(1).max(64),
        capabilities: clientCapabilities,
        clientInfo,
      }),
    })
    .strict(),
  z
    .object({
      ...base,
      method: z.literal("ping"),
      params: basicParams.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      method: z.literal("tools/list"),
      params: basicParams.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      method: z.literal("tools/call"),
      params: basicParams.extend({
        name: z.string().min(1).max(256),
        arguments: z.record(z.string(), z.unknown()).optional(),
      }),
    })
    .strict(),
  rpcNotification,
]);

const descriptions: Readonly<Record<KnowledgeAgentOperation, string>> = {
  getDraft: "Read an authorized knowledge draft.",
  createDraft:
    "Create a knowledge draft using a replay-safe command identifier.",
  updateDraft:
    "Update a knowledge draft at its expected application generation.",
  getValidationRequirements:
    "Read current validation requirements for a draft.",
  submitEvidence:
    "Submit evidence with a host-verifiable receipt for an exact revision.",
};
const tools = knowledgeAgentOperations.map((operation) =>
  ToolSchema.parse({
    name: knowledgeAgentToolNames[operation],
    description: descriptions[operation],
    inputSchema: z.toJSONSchema(knowledgeAgentInputSchemas[operation], {
      unrepresentable: "any",
    }),
    annotations: {
      readOnlyHint:
        operation === "getDraft" || operation === "getValidationRequirements",
      destructiveHint: false,
      openWorldHint: false,
    },
  }),
);

function operationForTool(name: string): KnowledgeAgentOperation | null {
  return (
    knowledgeAgentOperations.find(
      (operation) => knowledgeAgentToolNames[operation] === name,
    ) ?? null
  );
}

function toolResult(response: KnowledgeAgentResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response) }],
    isError: "error" in response,
  };
}

function protocolError(id: string | number | null, code = -32600): unknown {
  const message =
    code === -32601
      ? "MCP method is unavailable."
      : code === -32603
        ? "MCP service is unavailable."
        : code === -32000
          ? "MCP response exceeds capacity."
          : "Invalid MCP request.";
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

/**
 * Stateless, JSON-response Streamable HTTP. Every request resolves fresh host
 * authority and owns a short-lived SDK server; no session or credential is cached.
 */
export function createKnowledgeAgentMcp(
  options: KnowledgeAgentMcpOptions,
): KnowledgeAgentMcp {
  const configuration = validateKnowledgeAgentTransportOptions(
    options,
    options.mcpUrl,
    "mcp",
  );
  const dispatcher = options.dispatcher;
  // The logical response is identical to HTTP. JSON text inside JSON-RPC can
  // double its escaping; bounded framing must not reject a complete valid guide.
  const wireBudget = dispatcher.limits.maxResponseBytes * 2 + 4_096;
  return Object.freeze({
    async handle(request: Request): Promise<Response | null> {
      if (!knowledgeAgentRequestMatches(request, configuration)) return null;
      const identity = await authorizeKnowledgeAgentRequest(
        request,
        configuration,
      );
      if (identity instanceof Response) return identity;
      if (request.method !== "POST")
        return knowledgeAgentTransportError(
          "method_not_allowed",
          request,
          configuration,
        );
      const parsed = await readKnowledgeAgentJsonRequest(
        request,
        dispatcher.limits,
      );
      if (parsed instanceof Response)
        return secureKnowledgeAgentResponse(parsed, request, configuration);
      const json = (value: unknown, status: number) =>
        knowledgeAgentJsonResponse(
          value,
          status,
          wireBudget,
          request,
          configuration,
        );
      let snapshot: unknown;
      try {
        snapshot = snapshotKnowledgeAgentJson(parsed.value, dispatcher.limits);
      } catch (error) {
        return knowledgeAgentTransportError(
          mapKnowledgeAgentError(error).code === "capacity"
            ? "capacity"
            : "invalid_request",
          request,
          configuration,
        );
      }
      const validated = rpcRequest.safeParse(snapshot);
      if (!validated.success) {
        const header = rpcHeader.safeParse(snapshot);
        if (header.success && !methods.has(header.data.method))
          return json(protocolError(header.data.id, -32601), 200);
        return json(protocolError(header.success ? header.data.id : null), 400);
      }
      const rpc = validated.data;
      const id = "id" in rpc ? rpc.id : null;
      const transport = new WebStandardStreamableHTTPServerTransport({
        enableJsonResponse: true,
        // An omitted generator is the SDK's explicit stateless mode.
        maxRequestBodySize: dispatcher.limits.maxRequestBytes,
      });
      const server = new Server(
        { name: "@pegma/knowledge-base-mcp", version: "0.1.1" },
        {
          capabilities: { tools: {} },
          // Workers prohibit the runtime code generation used by SDK-default AJV.
          jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
        },
      );
      server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
      server.setRequestHandler(CallToolRequestSchema, async (call) => {
        const operation = operationForTool(call.params.name);
        if (operation === null)
          return toolResult(
            createKnowledgeAgentErrorResponse("invalid_request"),
          );
        try {
          return toolResult(
            await dispatcher.dispatch(identity, {
              apiVersion: "1",
              operation,
              input: call.params.arguments,
            }),
          );
        } catch {
          return toolResult(
            createKnowledgeAgentErrorResponse("unavailable", operation),
          );
        }
      });
      try {
        await server.connect(transport);
        // In the pinned SDK, JSON mode resolves only after the asynchronous
        // request handler has sent its complete result. Buffer before close.
        const response = await transport.handleRequest(request, {
          parsedBody: rpc,
        });
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > wireBudget) {
          if ("id" in rpc && rpc.method === "tools/call")
            return json(
              {
                jsonrpc: "2.0",
                id,
                result: toolResult(
                  createKnowledgeAgentErrorResponse(
                    "capacity",
                    operationForTool(rpc.params.name),
                  ),
                ),
              },
              200,
            );
          return json(protocolError(id, -32000), 413);
        }
        if (response.status === 202)
          return secureKnowledgeAgentResponse(
            new Response(null, { status: 202 }),
            request,
            configuration,
          );
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (
          response.status !== 200 ||
          (value !== null && typeof value === "object" && "error" in value)
        )
          return json(
            protocolError(id),
            response.status === 200 ? 200 : response.status,
          );
        return json(value, 200);
      } catch {
        return json(protocolError(id, -32603), 503);
      } finally {
        // Server.close owns transport cleanup. Await it after the JSON body is
        // complete, including for failures and initialized notifications.
        try {
          await server.close();
        } catch {
          try {
            await transport.close();
          } catch {
            // Cleanup failures never replace the bounded public response.
          }
        }
      }
    },
  });
}
