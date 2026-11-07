import type { KnowledgeAgentIdentity, KnowledgeAgentLimits } from "./types.js";
import { KnowledgeAgentBoundaryError } from "./errors.js";
import { parseKnowledgeAgentJson } from "./schemas.js";

export type KnowledgeAgentTransport = "http" | "mcp";

export interface KnowledgeAgentLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

/** Ports receive the original request; neither a cookie nor body is authority. */
export interface KnowledgeAgentTransportOptions {
  /** Canonical protected MCP resource, shared by both agent transports. */
  readonly resource: string;
  /** Host-owned Agent Access protected-resource metadata; never served here. */
  readonly protectedResourceMetadataUrl: string;
  /** Exact serialized origins. Originless native clients are also accepted. */
  readonly allowedOrigins: readonly string[];
  /**
   * Authenticate the bearer credential, issuer, client, exact resource, expiry,
   * revocation and current principal. Re-resolve authority on every request.
   * Rejections are normalized: response bodies and host headers are discarded.
   */
  readonly authenticate: (
    request: Request,
  ) =>
    | KnowledgeAgentIdentity
    | Response
    | Promise<KnowledgeAgentIdentity | Response>;
  /** Required host admission port, called before authentication or body reads. */
  readonly limit: (
    request: Request,
    context: Readonly<{ transport: KnowledgeAgentTransport }>,
  ) =>
    | boolean
    | KnowledgeAgentLimitDecision
    | Promise<boolean | KnowledgeAgentLimitDecision>;
  /** For synthetic loopback composition only; production endpoints use HTTPS. */
  readonly allowInsecureLoopback?: boolean;
}

export interface KnowledgeAgentTransportConfiguration {
  readonly transport: KnowledgeAgentTransport;
  readonly endpointUrl: string;
  readonly endpointOrigin: string;
  readonly endpointPath: string;
  readonly endpointHost: string;
  readonly endpointProtocol: string;
  readonly resource: string;
  readonly protectedResourceMetadataUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly authenticate: KnowledgeAgentTransportOptions["authenticate"];
  readonly limit: KnowledgeAgentTransportOptions["limit"];
}

export type KnowledgeAgentTransportErrorCode =
  | "invalid_request"
  | "invalid_token"
  | "forbidden"
  | "temporarily_unavailable"
  | "unavailable"
  | "capacity"
  | "method_not_allowed"
  | "unsupported_media_type";

const transportErrors = Object.freeze({
  invalid_request: [400, "Invalid knowledge request."],
  invalid_token: [401, "Knowledge authentication is required."],
  forbidden: [403, "Knowledge access is forbidden."],
  temporarily_unavailable: [
    429,
    "Knowledge service is temporarily unavailable.",
  ],
  unavailable: [503, "Knowledge service is unavailable."],
  capacity: [413, "Knowledge request or result exceeds capacity."],
  method_not_allowed: [405, "Knowledge endpoint requires POST."],
  unsupported_media_type: [415, "Knowledge endpoint requires UTF-8 JSON."],
} as const);

const encoder = new TextEncoder();
const maxBodyChunks = 1_024;
const maxAuthorityItems = 256;
const maxAuthorityCharacters = 1_024;

function cancelStream(
  stream: { cancel(): Promise<void> } | null | undefined,
): void {
  try {
    // A peer's cancellation hook must not hold the rejection response open.
    void stream?.cancel().catch(() => {});
  } catch {
    // Cancellation can throw for a locked stream; no content is consumed.
  }
}

function configurationError(): never {
  throw new TypeError("Invalid knowledge agent transport configuration.");
}

function configuredUrl(value: string, allowLoopback: boolean): URL {
  if (typeof value !== "string" || value.length > 2_048)
    return configurationError();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return configurationError();
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" &&
      !(allowLoopback && loopback && url.protocol === "http:")) ||
    url.username !== "" ||
    url.password !== "" ||
    value !== `${url.origin}${url.pathname}`
  )
    return configurationError();
  return url;
}

/** Validate and snapshot host configuration once, before accepting requests. */
export function validateKnowledgeAgentTransportOptions(
  options: KnowledgeAgentTransportOptions,
  endpointUrl: string,
  transport: KnowledgeAgentTransport,
): KnowledgeAgentTransportConfiguration {
  const allowLoopback = options.allowInsecureLoopback === true;
  const endpoint = configuredUrl(endpointUrl, allowLoopback);
  configuredUrl(options.resource, allowLoopback);
  configuredUrl(options.protectedResourceMetadataUrl, allowLoopback);
  if (
    (transport !== "http" && transport !== "mcp") ||
    (transport === "mcp" && endpointUrl !== options.resource) ||
    typeof options.authenticate !== "function" ||
    typeof options.limit !== "function" ||
    !Array.isArray(options.allowedOrigins) ||
    options.allowedOrigins.length > 64 ||
    (options.allowInsecureLoopback !== undefined &&
      typeof options.allowInsecureLoopback !== "boolean")
  )
    return configurationError();
  const origins = options.allowedOrigins.map((origin) => {
    const parsed = configuredUrl(`${origin}/`, allowLoopback);
    if (parsed.origin !== origin) return configurationError();
    return origin;
  });
  return Object.freeze({
    transport,
    endpointUrl,
    endpointOrigin: endpoint.origin,
    endpointPath: endpoint.pathname,
    endpointHost: endpoint.host,
    endpointProtocol: endpoint.protocol,
    resource: options.resource,
    protectedResourceMetadataUrl: options.protectedResourceMetadataUrl,
    allowedOrigins: Object.freeze([...new Set(origins)]),
    authenticate: options.authenticate,
    limit: options.limit,
  });
}

/** A matching path is claimed so a hostile authority cannot bypass admission. */
export function knowledgeAgentRequestMatches(
  request: Request,
  configuration: KnowledgeAgentTransportConfiguration,
): boolean {
  try {
    return new URL(request.url).pathname === configuration.endpointPath;
  } catch {
    return false;
  }
}

function baseHeaders(): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
}

/** Replace implicit CORS and caching with this endpoint's explicit policy. */
export function secureKnowledgeAgentResponse(
  response: Response,
  request: Request,
  configuration: KnowledgeAgentTransportConfiguration,
): Response {
  const headers = new Headers(response.headers);
  for (const key of [...headers.keys()]) {
    if (key.toLowerCase().startsWith("access-control-")) headers.delete(key);
  }
  for (const [key, value] of baseHeaders()) headers.set(key, value);
  headers.delete("Set-Cookie");
  const vary = new Set(
    (headers.get("Vary") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  vary.add("Origin");
  headers.set("Vary", [...vary].join(", "));
  const origin = request.headers.get("Origin");
  if (origin !== null && configuration.allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set(
      "Access-Control-Expose-Headers",
      "WWW-Authenticate, Retry-After",
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function rawTransportError(
  code: KnowledgeAgentTransportErrorCode,
  retryAfterSeconds?: number,
): Response {
  const [status, message] = transportErrors[code];
  const headers = baseHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (code === "method_not_allowed") headers.set("Allow", "POST");
  if (
    code === "temporarily_unavailable" &&
    retryAfterSeconds !== undefined &&
    Number.isSafeInteger(retryAfterSeconds) &&
    retryAfterSeconds >= 0 &&
    retryAfterSeconds <= 86_400
  )
    headers.set("Retry-After", String(retryAfterSeconds));
  return new Response(
    JSON.stringify({
      apiVersion: "1",
      operation: null,
      error: { code, status, message },
    }),
    { status, headers },
  );
}

export function knowledgeAgentTransportError(
  code: KnowledgeAgentTransportErrorCode,
  request: Request,
  configuration: KnowledgeAgentTransportConfiguration,
  retryAfterSeconds?: number,
): Response {
  const response = rawTransportError(code, retryAfterSeconds);
  if (code === "invalid_token" || code === "forbidden") {
    const error =
      code === "invalid_token" ? "invalid_token" : "insufficient_scope";
    response.headers.set(
      "WWW-Authenticate",
      `Bearer error="${error}", resource_metadata="${configuration.protectedResourceMetadataUrl}"`,
    );
  }
  return secureKnowledgeAgentResponse(response, request, configuration);
}

function validHost(
  request: Request,
  configuration: KnowledgeAgentTransportConfiguration,
): boolean {
  const host = request.headers.get("Host");
  // Fetch runtimes may omit Host: the absolute request URL remains mandatory.
  if (host === null) return true;
  try {
    const parsed = new URL(`${configuration.endpointProtocol}//${host}`);
    return (
      parsed.host === configuration.endpointHost &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      !/[\s/@?#\\]/u.test(host)
    );
  } catch {
    return false;
  }
}

function authorityString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxAuthorityCharacters &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function authorityRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32) return false;
  for (let index = 0; index < keys.length; index += 1) {
    if (typeof keys[index] !== "string") return false;
  }
  return true;
}

function ownAuthorityData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function authorityList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return null;
  const length = ownAuthorityData(value, "length");
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maxAuthorityItems ||
    Reflect.ownKeys(value).length !== length + 1
  )
    return null;
  const output: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !authorityString(descriptor.value)
    )
      return null;
    output[index] = descriptor.value;
  }
  return Object.freeze(output);
}

/** Detach bounded trusted facts so later host mutation cannot change authority. */
function snapshotIdentity(
  value: KnowledgeAgentIdentity,
  resource: string,
): KnowledgeAgentIdentity | null {
  if (!authorityRecord(value)) return null;
  const clientId = ownAuthorityData(value, "clientId");
  const scopes = authorityList(ownAuthorityData(value, "scopes"));
  const access = ownAuthorityData(value, "access");
  if (
    ownAuthorityData(value, "resource") !== resource ||
    !authorityString(clientId) ||
    scopes === null ||
    !authorityRecord(access)
  )
    return null;
  const principalId = ownAuthorityData(access, "principalId");
  const policyVersion = ownAuthorityData(access, "policyVersion");
  const permissions = authorityList(ownAuthorityData(access, "permissions"));
  if (
    !authorityString(principalId) ||
    !authorityString(policyVersion) ||
    permissions === null
  )
    return null;
  return Object.freeze({
    clientId,
    resource,
    scopes,
    access: Object.freeze({
      principalId,
      policyVersion,
      roles: Object.freeze([]),
      entitlements: Object.freeze([]),
      permissions,
    }),
  });
}

/** Shared HTTP/MCP admission. No untrusted body is read by this function. */
export async function authorizeKnowledgeAgentRequest(
  request: Request,
  configuration: KnowledgeAgentTransportConfiguration,
): Promise<KnowledgeAgentIdentity | Response> {
  const reject = (
    code: KnowledgeAgentTransportErrorCode,
    retryAfterSeconds?: number,
  ) =>
    knowledgeAgentTransportError(
      code,
      request,
      configuration,
      retryAfterSeconds,
    );
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return reject("invalid_request");
  }
  if (
    url.href !== configuration.endpointUrl ||
    !validHost(request, configuration)
  )
    return reject("invalid_request");
  const origin = request.headers.get("Origin");
  if (origin !== null && !configuration.allowedOrigins.includes(origin))
    return reject("forbidden");

  try {
    const decision = await configuration.limit(request, {
      transport: configuration.transport,
    });
    if (decision === false) return reject("temporarily_unavailable");
    if (decision !== true) {
      if (
        decision === null ||
        typeof decision !== "object" ||
        typeof decision.allowed !== "boolean"
      )
        return reject("unavailable");
      if (!decision.allowed)
        return reject("temporarily_unavailable", decision.retryAfterSeconds);
    }
  } catch {
    return reject("unavailable");
  }

  const authorization = request.headers.get("Authorization");
  if (
    authorization === null ||
    authorization.length > 8_192 ||
    !/^Bearer +[A-Za-z0-9._~+/-]+=*$/i.test(authorization)
  )
    return reject("invalid_token");
  try {
    const authenticated = await configuration.authenticate(request);
    if (authenticated instanceof Response) {
      // Host error messages, cookies, redirects and custom challenges are private.
      cancelStream(authenticated.body);
      if (authenticated.status === 401) return reject("invalid_token");
      if (authenticated.status === 403) return reject("forbidden");
      return reject("unavailable");
    }
    const identity = snapshotIdentity(authenticated, configuration.resource);
    return identity ?? reject("invalid_token");
  } catch {
    return reject("unavailable");
  }
}

/** Read actual bytes/chunks before decoding or parsing; never trust Length alone. */
export async function readKnowledgeAgentJsonRequest(
  request: Request,
  limits: KnowledgeAgentLimits,
): Promise<{ readonly value: unknown } | Response> {
  const maxBytes = limits.maxRequestBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    return rawTransportError("unavailable");
  const contentType = request.headers.get("Content-Type") ?? "";
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/iu.test(
      contentType,
    )
  )
    return rawTransportError("unsupported_media_type");
  const encoding = request.headers.get("Content-Encoding");
  if (encoding !== null && encoding.toLowerCase() !== "identity")
    return rawTransportError("unsupported_media_type");
  const declared = request.headers.get("Content-Length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || !Number.isSafeInteger(Number(declared)))
  )
    return rawTransportError("invalid_request");
  if (declared !== null && Number(declared) > maxBytes) {
    cancelStream(request.body);
    return rawTransportError("capacity");
  }
  if (request.body === null) return rawTransportError("invalid_request");
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return rawTransportError("invalid_request");
  }
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let count = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      count += 1;
      bytes += next.value.byteLength;
      if (bytes > maxBytes || count > maxBodyChunks) {
        cancelStream(reader);
        return rawTransportError("capacity");
      }
      chunks.push(next.value.slice());
    }
    if (declared !== null && Number(declared) !== bytes)
      return rawTransportError("invalid_request");
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(body);
    return {
      value: parseKnowledgeAgentJson(text, limits),
    };
  } catch (error) {
    if (
      error instanceof KnowledgeAgentBoundaryError &&
      error.code === "capacity"
    )
      return rawTransportError("capacity");
    return rawTransportError("invalid_request");
  } finally {
    reader.releaseLock();
  }
}

/** Serialize only complete bounded messages; never truncate application results. */
export function knowledgeAgentJsonResponse(
  value: unknown,
  status: number,
  maxBytes: number,
  request: Request,
  configuration: KnowledgeAgentTransportConfiguration,
): Response {
  try {
    const body = JSON.stringify(value);
    if (
      body === undefined ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0 ||
      encoder.encode(body).byteLength > maxBytes
    )
      throw new TypeError("Knowledge response exceeds capacity");
    return secureKnowledgeAgentResponse(
      new Response(body, {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
      request,
      configuration,
    );
  } catch {
    const fallback = rawTransportError("unavailable");
    // Even reduced budgets that cannot fit the fixed error remain bounded.
    const fixedBytes = encoder.encode(
      JSON.stringify({
        apiVersion: "1",
        operation: null,
        error: {
          code: "unavailable",
          status: 503,
          message: "Knowledge service is unavailable.",
        },
      }),
    ).byteLength;
    return secureKnowledgeAgentResponse(
      fixedBytes <= maxBytes ? fallback : new Response(null, { status: 503 }),
      request,
      configuration,
    );
  }
}
