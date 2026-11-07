import type { KnowledgeAgentDispatcher } from "./types.js";
import {
  authorizeKnowledgeAgentRequest,
  knowledgeAgentJsonResponse,
  knowledgeAgentRequestMatches,
  knowledgeAgentTransportError,
  readKnowledgeAgentJsonRequest,
  secureKnowledgeAgentResponse,
  validateKnowledgeAgentTransportOptions,
} from "./transport-common.js";
import type { KnowledgeAgentTransportOptions } from "./transport-common.js";

export interface KnowledgeAgentHttpOptions extends KnowledgeAgentTransportOptions {
  /** Exact canonical versioned API URL; the protected resource remains MCP. */
  readonly apiUrl: string;
  readonly dispatcher: KnowledgeAgentDispatcher;
}

export interface KnowledgeAgentHttp {
  /** Null leaves unmatched paths to the host's router. */
  handle(request: Request): Promise<Response | null>;
}

/** Portable Fetch adapter: host credentials and admission, shared application law. */
export function createKnowledgeAgentHttp(
  options: KnowledgeAgentHttpOptions,
): KnowledgeAgentHttp {
  const configuration = validateKnowledgeAgentTransportOptions(
    options,
    options.apiUrl,
    "http",
  );
  const dispatcher = options.dispatcher;
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
      try {
        const response = await dispatcher.dispatch(identity, parsed.value);
        return knowledgeAgentJsonResponse(
          response,
          "error" in response ? response.error.status : 200,
          dispatcher.limits.maxResponseBytes,
          request,
          configuration,
        );
      } catch {
        return knowledgeAgentTransportError(
          "unavailable",
          request,
          configuration,
        );
      }
    },
  });
}
