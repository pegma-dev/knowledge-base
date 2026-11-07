/**
 * Executed ONLY after this file is copied into the isolated tarball consumer.
 * Every component import below resolves through an installed public entrypoint.
 * The existing browser login, limiter and staging runner remain fictional seams.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { isDeepStrictEqual } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  auth,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  createAgentAccess,
  createAgentAccessHttp,
  createProtectedResourceAuthenticator,
} from "@pegma/agent-access";
import { hasPermission, resolveAccess } from "@pegma/authorization-core";
import { createKnowledgeBaseApplication } from "@pegma/knowledge-base-application";
import {
  articleKinds,
  knowledgePermissions,
} from "@pegma/knowledge-base-contracts";
import {
  createKnowledgeAgentDispatcher,
  createKnowledgeAgentHttp,
  createKnowledgeAgentMcp,
  knowledgeAgentScopes,
  knowledgeAgentToolNames,
} from "@pegma/knowledge-base-mcp";
import { createSessionStore } from "@pegma/sessions";
import { createMemoryStore } from "@pegma/storage-core";

const CLIENT_ID = "fictional-pre-registered-kb-agent";
const PRINCIPAL = "fictional/staff/admin";
const RUNNER = "fictional/runner/loopback";
const ATTESTER = "fictional/verifier/registry";
const LINK = "agent.access.link";
const COLLECTION = "fictional/collection/workshop";
const ARTICLE = "fictional/article/export";
const BUILD = "fictional-loopback-build-42";
const COOKIE = "fictional_existing_session";
const scopes = Object.values(knowledgeAgentScopes);
const command = (name, expectedGeneration) => ({
  commandId: `fictional/protocol/${name}`,
  correlationId: "fictional/protocol-proof",
  expectedGeneration,
});
const guide = Object.freeze({
  kind: "walkthrough",
  title: "Download a fictional workshop export",
  summary: "Save the fictional workspace as a CSV spreadsheet.",
  content: {
    format: "markdown",
    text: "1. Open Workspace.\n2. Choose Export.\n3. Download the CSV spreadsheet.",
  },
  tags: ["export", "csv"],
  applicability: {
    productId: "fictional-workshop",
    productVersion: "1.0",
    buildId: BUILD,
    locale: "en-US",
  },
});
let stage = 0;

async function request(url, init = {}) {
  const timeout = AbortSignal.timeout(5_000);
  return fetch(url, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
}

function response(status) {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function formPost(url, values, headers = {}) {
  return request(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(values),
  });
}

async function createHost() {
  const store = createMemoryStore();
  let milliseconds = Date.now();
  let administrator = true;
  const clock = { now: () => new Date(milliseconds).toISOString() };
  const currentAccess = () =>
    resolveAccess(
      { principalId: PRINCIPAL, roles: administrator ? ["Admin"] : ["Viewer"] },
      {
        version: "fictional-kb-protocol-1",
        roles: {
          Admin: [LINK, ...Object.values(knowledgePermissions)],
          Viewer: [],
        },
      },
    );
  const policy = {
    id: "fictional/validation/workshop",
    version: 1,
    requirements: [
      ...articleKinds.map((kind) => ({
        id: `${kind}-content`,
        kind,
        testKind: "content",
        maxAgeMilliseconds: 60_000,
        trustedRunnerIds: [RUNNER],
      })),
      {
        id: "walkthrough-workflow",
        kind: "walkthrough",
        testKind: "workflow",
        maxAgeMilliseconds: 60_000,
        trustedRunnerIds: [RUNNER],
      },
    ],
  };
  const governance = {
    validationPolicy: { id: policy.id, version: policy.version },
    expectedStagingBuildId: BUILD,
    trustedAttesterIds: [ATTESTER],
  };
  const executions = new Map();
  const counts = {
    applicationCalls: 0,
    authenticatedRequests: 0,
    verifiedReceipts: 0,
    callbacks: 0,
  };
  stage = 11;
  const application = createKnowledgeBaseApplication({
    store,
    clock,
    evidenceVerifier: {
      async verify(proof) {
        const execution = executions.get(proof.receipt);
        if (
          !execution ||
          proof.access.principalId !== execution.actor ||
          execution.runner !== RUNNER ||
          execution.build !== BUILD ||
          !isDeepStrictEqual(proof.article, execution.article) ||
          !isDeepStrictEqual(proof.submission, execution.submission) ||
          !isDeepStrictEqual(proof.configuration, governance)
        )
          return null;
        counts.verifiedReceipts += 1;
        return {
          id: execution.id,
          verifiedBy: ATTESTER,
          verifiedAt: clock.now(),
        };
      },
    },
  });
  // Bootstrap through the actual application. No public audience is enabled.
  stage = 12;
  const created = await application.createCollection(currentAccess(), {
    ...command("bootstrap-collection", 0),
    collectionId: COLLECTION,
    name: "Fictional private workshop guides",
  });
  stage = 13;
  await application.putValidationPolicy(currentAccess(), {
    ...command("bootstrap-validation", 0),
    policy,
  });
  stage = 14;
  await application.putGovernanceConfiguration(currentAccess(), {
    ...command("bootstrap-governance", created.value.generation),
    collectionId: COLLECTION,
    configuration: governance,
  });

  // An existing host login is the explicit fixture seam. Sessions owns records;
  // this fixture implements neither credentials nor a login/identity provider.
  stage = 15;
  const sessions = createSessionStore(store, { clock });
  const sessionId = randomUUID();
  const csrf = randomUUID();
  await sessions.create(sessionId, {
    principalId: PRINCIPAL,
    data: JSON.stringify({ csrf }),
  });
  const browserCookie = `${COOKIE}=${sessionId}`;
  let origin = "";
  let route = async () => response(503);
  const sockets = new Set();
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of incoming) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > 262_144) {
          outgoing.writeHead(413);
          outgoing.end();
          return;
        }
        chunks.push(buffer);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (value !== undefined)
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const method = incoming.method ?? "GET";
      const result = await route(
        new Request(new URL(incoming.url ?? "/", origin), {
          method,
          headers,
          ...(method === "GET" || method === "HEAD"
            ? {}
            : { body: Buffer.concat(chunks) }),
        }),
      );
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    })().catch(() => {
      // Request URLs and errors can contain credentials. Never serialize them.
      if (!outgoing.headersSent) outgoing.writeHead(503);
      outgoing.end();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  async function close() {
    for (const socket of sockets) socket.destroy();
    if (server.listening)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }

  try {
    stage = 16;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    const resource = `${origin}/mcp`;
    const apiUrl = `${origin}/api/knowledge/v1`;
    const redirectUri = `${origin}/native/callback`;
    const configuration = {
      issuer: origin,
      resource,
      allowInsecureLoopback: true,
      approvalPermission: LINK,
      endpoints: {
        authorize: `${origin}/authorize`,
        deviceAuthorization: `${origin}/device_authorization`,
        token: `${origin}/token`,
        revocation: `${origin}/revoke`,
        verification: `${origin}/host/device`,
        approval: `${origin}/host/consent`,
        resourceMetadata: `${origin}/.well-known/oauth-protected-resource/mcp`,
      },
      clients: [
        {
          clientId: CLIENT_ID,
          name: "Fictional SDK knowledge author",
          redirectUris: [redirectUri],
          allowedScopes: scopes,
          grantTypes: ["authorization_code", "device_code"],
        },
      ],
      scopes: scopes.map((name) => ({
        name,
        description: `Fictional KB permission ${name}`,
        version: "1",
        permissions: [name],
      })),
      limits: { accessLifetimeSeconds: 30, deviceLifetimeSeconds: 60 },
    };
    stage = 17;
    const service = createAgentAccess({
      configuration,
      store,
      clock,
      resolvePrincipal: async (principalId) =>
        principalId === PRINCIPAL ? currentAccess() : null,
    });
    async function authenticateBrowser(browserRequest, options) {
      const cookies = (browserRequest.headers.get("Cookie") ?? "")
        .split(";")
        .map((part) => part.trim());
      const candidates = cookies.filter((part) =>
        part.startsWith(`${COOKIE}=`),
      );
      if (candidates.length !== 1) return response(401);
      const session = await sessions.get(
        candidates[0].slice(COOKIE.length + 1),
      );
      if (!session || session.principalId !== PRINCIPAL) return response(401);
      const access = currentAccess();
      if (!hasPermission(access, LINK)) return response(403);
      if (options.mutation) {
        let saved;
        try {
          saved = JSON.parse(session.data);
        } catch {
          return response(503);
        }
        if (!saved || typeof saved.csrf !== "string" || !saved.csrf)
          return response(503);
        if (
          browserRequest.headers.get("Origin") !== origin ||
          browserRequest.headers.get("X-CSRF-Token") !== saved.csrf
        )
          return response(403);
      }
      return { authentication: "browser-session", access };
    }
    // Required injection, explicitly synthetic: no real limiter acceptance claim.
    const limit = async () => true;
    const issuer = createAgentAccessHttp({
      service,
      configuration,
      authenticateBrowser,
      limit,
    });
    const authenticator = createProtectedResourceAuthenticator({
      service,
      configuration,
    });
    const trackedApplication = Object.fromEntries(
      [
        "getDraft",
        "createDraft",
        "updateDraft",
        "getValidationRequirements",
        "submitEvidence",
      ].map((method) => [
        method,
        async (...arguments_) => {
          counts.applicationCalls += 1;
          return application[method](...arguments_);
        },
      ]),
    );
    stage = 18;
    const dispatcher = createKnowledgeAgentDispatcher({
      application: trackedApplication,
      resource,
    });
    const common = {
      resource,
      protectedResourceMetadataUrl: configuration.endpoints.resourceMetadata,
      allowedOrigins: [origin],
      allowInsecureLoopback: true,
      limit,
      async authenticate(protectedRequest) {
        // Agent Access rechecks current principal, client, exact resource, expiry,
        // revocation and selected permissions on EVERY transport call and retry.
        const delegated = await authenticator.authenticate(protectedRequest);
        if (delegated instanceof Response) return delegated;
        counts.authenticatedRequests += 1;
        return {
          access: delegated.access,
          scopes: delegated.scopes,
          clientId: delegated.clientId,
          resource: delegated.resource,
        };
      },
    };
    const mcp = createKnowledgeAgentMcp({
      ...common,
      mcpUrl: resource,
      dispatcher,
    });
    const http = createKnowledgeAgentHttp({ ...common, apiUrl, dispatcher });
    // Same actual issuer/store, distinct resource. The fixture obtains this
    // credential through Agent Access's public device API, never by making up
    // token bytes, then presents it to the real KB HTTP and MCP boundaries.
    const otherResource = `${origin}/other-resource`;
    const otherService = createAgentAccess({
      configuration: { ...configuration, resource: otherResource },
      store,
      clock,
      resolvePrincipal: async (principalId) =>
        principalId === PRINCIPAL ? currentAccess() : null,
    });
    route = async (incoming) => {
      const url = new URL(incoming.url);
      if (url.pathname === "/native/callback" && incoming.method === "GET") {
        counts.callbacks += 1;
        return response(200);
      }
      if (
        ["/host/consent", "/host/device"].includes(url.pathname) &&
        incoming.method === "GET"
      ) {
        const browser = await authenticateBrowser(incoming, {
          mutation: false,
        });
        if (browser instanceof Response) return browser;
        const userCode = url.searchParams.get("user_code");
        const view =
          url.pathname === "/host/consent"
            ? await service.getAuthorizationApproval(
                browser,
                url.searchParams.get("request_id") ?? "",
              )
            : userCode
              ? await service.getDeviceApproval(browser, userCode)
              : null;
        return Response.json(
          { syntheticBrowser: true, view },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (url.pathname === "/host/approve" && incoming.method === "POST") {
        const form = new URLSearchParams(await incoming.text());
        if (
          [...new Set(form.keys())].some((key) => form.getAll(key).length !== 1)
        )
          return response(400);
        const browserRequest = new Request(incoming.url, {
          method: "POST",
          headers: incoming.headers,
        });
        browserRequest.headers.set("X-CSRF-Token", form.get("csrf") ?? "");
        const browser = await authenticateBrowser(browserRequest, {
          mutation: true,
        });
        if (browser instanceof Response) return browser;
        const userCode = form.get("user_code");
        const view = userCode
          ? await service.getDeviceApproval(browser, userCode)
          : await service.getAuthorizationApproval(
              browser,
              form.get("request_id") ?? "",
            );
        const decision = form.get("decision");
        if (decision !== "approve" && decision !== "deny") return response(400);
        const result = await service.approve(browser, {
          requestId: view.requestId,
          decision,
          approvedScopes: view.requestedScopes.map(({ name }) => name),
          ...(userCode ? { userCode } : {}),
        });
        return result.flow === "authorization_code"
          ? new Response(null, {
              status: 303,
              headers: {
                Location: result.redirectUri,
                "Cache-Control": "no-store",
              },
            })
          : response(200);
      }
      return (
        (await mcp.handle(incoming)) ??
        (await http.handle(incoming)) ??
        (await issuer.handle(incoming)) ??
        response(404)
      );
    };

    return {
      origin,
      resource,
      apiUrl,
      redirectUri,
      configuration,
      counts,
      browser: { cookie: browserCookie, csrf },
      close,
      advance: (seconds) => {
        milliseconds += seconds * 1_000;
      },
      demote: () => {
        administrator = false;
      },
      async wrongResourceCredential() {
        const issued = await otherService.beginDeviceAuthorization({
          clientId: CLIENT_ID,
          resource: otherResource,
          scopes,
        });
        const browser = {
          authentication: "browser-session",
          access: currentAccess(),
        };
        const view = await otherService.getDeviceApproval(
          browser,
          issued.user_code,
        );
        await otherService.approve(browser, {
          requestId: view.requestId,
          decision: "approve",
          approvedScopes: scopes,
          userCode: issued.user_code,
        });
        return otherService.pollDeviceToken({
          clientId: CLIENT_ID,
          resource: otherResource,
          deviceCode: issued.device_code,
        });
      },
      executeFixtureCheck(current) {
        // A trusted fictional runner recognizes this exact fixture and executes
        // an independent CSV export check. It accepts no claimed pass/result,
        // runner identity, submission, artifact or receipt from its caller.
        assert.equal(current.articleId, ARTICLE);
        assert.equal(current.revision.number, 2);
        assert.equal(current.revision.createdBy, PRINCIPAL);
        assert.equal(current.revision.applicability.buildId, BUILD);
        assert.deepEqual(current.revision.content, guide.content);
        const rows = [
          ["workspace", "records"],
          ["fictional-workshop", "3"],
        ];
        const csv = rows.map((row) => row.join(",")).join("\n");
        assert.equal(csv, "workspace,records\nfictional-workshop,3");
        const artifactHash = createHash("sha256").update(csv).digest("hex");
        const submission = {
          id: "fictional/evidence/content",
          articleId: ARTICLE,
          articleRevision: current.revision.number,
          contentHash: current.revision.contentHash,
          validationPolicy: current.revision.validationPolicy,
          checkId: "walkthrough-content",
          testKind: "content",
          applicability: current.revision.applicability,
          stagingBuildId: BUILD,
          steps: [
            "SYNTHETIC_PRIVATE_EVIDENCE: exact fictional CSV export verified locally.",
          ],
          result: "passed",
          executedAt: clock.now(),
          runnerId: RUNNER,
          artifacts: [
            { id: "fictional/private/csv-output", hash: artifactHash },
          ],
        };
        const receipt = randomUUID();
        executions.set(
          receipt,
          structuredClone({
            id: "fictional/attestation/execution-1",
            actor: PRINCIPAL,
            runner: RUNNER,
            build: BUILD,
            article: current.revision,
            submission,
          }),
        );
        return { evidence: structuredClone(submission), receipt };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

function createProvider(host) {
  let savedTokens;
  let verifier;
  let authorizationUrl;
  let discovery;
  const state = randomUUID();
  const provider = {
    redirectUrl: host.redirectUri,
    clientMetadata: {
      client_name: "Fictional packed KB SDK proof",
      redirect_uris: [host.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: scopes.join(" "),
    },
    clientInformation: () => ({
      client_id: CLIENT_ID,
      issuer: host.configuration.issuer,
    }),
    state: () => state,
    tokens: () => savedTokens,
    saveTokens: (value) => {
      savedTokens = value;
    },
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => {
      assert.ok(verifier);
      return verifier;
    },
    redirectToAuthorization: (value) => {
      authorizationUrl = value;
    },
    discoveryState: () => discovery,
    saveDiscoveryState: (value) => {
      discovery = value;
    },
    invalidateCredentials: (kind) => {
      if (kind === "all" || kind === "tokens") savedTokens = undefined;
    },
  };
  return {
    provider,
    tokens: () => {
      assert.ok(savedTokens);
      return savedTokens;
    },
    authorizationUrl: () => {
      assert.ok(authorizationUrl);
      return authorizationUrl;
    },
    discovery: () => {
      assert.ok(discovery);
      return discovery;
    },
    callbackCode(callback) {
      assert.equal(callback.origin, host.origin);
      assert.equal(callback.pathname, "/native/callback");
      for (const key of ["code", "state", "iss"])
        assert.equal(callback.searchParams.getAll(key).length, 1);
      assert.equal(callback.searchParams.has("error"), false);
      assert.equal(callback.searchParams.get("state"), state);
      assert.equal(callback.searchParams.get("iss"), host.configuration.issuer);
      const code = callback.searchParams.get("code");
      assert.ok(code);
      return code;
    },
  };
}

async function approve(host, authorizationUrl, checkProtections = false) {
  assert.equal(authorizationUrl.origin, host.origin);
  assert.equal(authorizationUrl.pathname, "/authorize");
  assert.equal(
    authorizationUrl.searchParams.get("code_challenge_method"),
    "S256",
  );
  assert.equal(authorizationUrl.searchParams.get("resource"), host.resource);
  assert.equal(authorizationUrl.searchParams.get("client_id"), CLIENT_ID);
  if (checkProtections) {
    const missing = await request(authorizationUrl, { redirect: "manual" });
    assert.equal(missing.status, 401);
    await missing.body?.cancel();
  }
  const started = await request(authorizationUrl, {
    redirect: "manual",
    headers: { Cookie: host.browser.cookie },
  });
  assert.equal(started.status, 303);
  const consent = new URL(started.headers.get("Location"), host.origin);
  assert.equal(consent.origin, host.origin);
  assert.equal(consent.pathname, "/host/consent");
  const consentPage = await request(consent, {
    headers: { Cookie: host.browser.cookie },
  });
  assert.equal(consentPage.status, 200);
  const view = (await consentPage.json()).view;
  assert.equal(view.resource, host.resource);
  assert.deepEqual(
    view.requestedScopes.map(({ name }) => name).sort(),
    [...scopes].sort(),
  );
  const values = {
    request_id: consent.searchParams.get("request_id"),
    decision: "approve",
    csrf: host.browser.csrf,
  };
  if (checkProtections) {
    assert.equal(
      (
        await formPost(`${host.origin}/host/approve`, values, {
          Cookie: host.browser.cookie,
          Origin: "https://foreign.example.test",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await formPost(
          `${host.origin}/host/approve`,
          { ...values, csrf: "incorrect" },
          { Cookie: host.browser.cookie, Origin: host.origin },
        )
      ).status,
      403,
    );
  }
  const approved = await formPost(`${host.origin}/host/approve`, values, {
    Cookie: host.browser.cookie,
    Origin: host.origin,
  });
  assert.equal(approved.status, 303);
  const callback = new URL(approved.headers.get("Location"));
  assert.equal(callback.origin, host.origin);
  assert.equal(callback.pathname, "/native/callback");
  const completed = await request(callback);
  assert.equal(completed.status, 200);
  await completed.body?.cancel();
  return callback;
}

async function httpCall(host, token, operation, input) {
  return request(host.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ apiVersion: "1", operation, input }),
  });
}

async function mcpCall(client, operation, input) {
  const result = await client.callTool(
    { name: knowledgeAgentToolNames[operation], arguments: input },
    undefined,
    { timeout: 5_000 },
  );
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  return JSON.parse(result.content[0].text);
}

async function rejectedCredential(host, token, replay) {
  const before = host.counts.applicationCalls;
  const http = await httpCall(host, token, "createDraft", replay);
  assert.equal(http.status, 401);
  assert.ok(
    http.headers.get("WWW-Authenticate")?.includes("resource_metadata="),
  );
  await http.body?.cancel();
  const mcp = await request(host.resource, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: { name: knowledgeAgentToolNames.createDraft, arguments: replay },
    }),
  });
  assert.equal(mcp.status, 401);
  await mcp.body?.cancel();
  assert.equal(host.counts.applicationCalls, before);
}

async function authorization(host, owned, checkProtections = false) {
  const provider = createProvider(host);
  const initial = new StreamableHTTPClientTransport(new URL(host.resource), {
    authProvider: provider.provider,
    fetch: request,
  });
  const bootstrap = new Client(
    { name: "fictional-kb-sdk-proof", version: "1.0.0" },
    { capabilities: {} },
  );
  bootstrap.onerror = () => {};
  owned.push(initial, bootstrap);
  let redirected = false;
  try {
    await bootstrap.connect(initial);
  } catch (error) {
    assert.ok(error instanceof UnauthorizedError);
    redirected = true;
  }
  assert.equal(redirected, true);
  const callback = await approve(
    host,
    provider.authorizationUrl(),
    checkProtections,
  );
  const code = provider.callbackCode(callback);
  await initial.finishAuth(code);
  assert.equal(provider.discovery().resourceMetadata.resource, host.resource);
  assert.equal(
    provider.discovery().authorizationServerMetadata.issuer,
    host.configuration.issuer,
  );
  const transport = new StreamableHTTPClientTransport(new URL(host.resource), {
    authProvider: provider.provider,
    fetch: request,
  });
  const client = new Client(
    { name: "fictional-kb-sdk-proof", version: "1.0.0" },
    { capabilities: {} },
  );
  client.onerror = () => {};
  owned.push(transport, client);
  await client.connect(transport);
  return { ...provider, client };
}

async function deviceProof(host) {
  const issuance = await formPost(
    host.configuration.endpoints.deviceAuthorization,
    {
      client_id: CLIENT_ID,
      resource: host.resource,
      scope: scopes.join(" "),
    },
  );
  assert.equal(issuance.status, 200);
  const device = await issuance.json();
  const verification = new URL(device.verification_uri);
  assert.equal(verification.origin, host.origin);
  verification.searchParams.set("user_code", device.user_code);
  const page = await request(verification, {
    headers: { Cookie: host.browser.cookie },
  });
  assert.equal(page.status, 200);
  assert.equal((await page.json()).view.resource, host.resource);
  const poll = () =>
    formPost(host.configuration.endpoints.token, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: CLIENT_ID,
      resource: host.resource,
      device_code: device.device_code,
    });
  assert.equal((await (await poll()).json()).error, "authorization_pending");
  assert.equal((await (await poll()).json()).error, "slow_down");
  const approved = await formPost(
    `${host.origin}/host/approve`,
    {
      user_code: device.user_code,
      decision: "approve",
      csrf: host.browser.csrf,
    },
    { Cookie: host.browser.cookie, Origin: host.origin },
  );
  assert.equal(approved.status, 200);
  host.advance(device.interval + 5);
  const exchanged = await poll();
  assert.equal(exchanged.status, 200);
  const tokens = await exchanged.json();
  const read = await httpCall(host, tokens.access_token, "getDraft", {
    articleId: ARTICLE,
  });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).result.revision.number, 2);
  return { pending: true, slowDown: true, protectedRead: true };
}

async function runProof() {
  stage = 10;
  const host = await createHost();
  const owned = [];
  try {
    stage = 20;
    const session = await authorization(host, owned, true);
    stage = 30;
    const tools = await session.client.listTools();
    assert.deepEqual(
      tools.tools.map(({ name }) => name).sort(),
      Object.values(knowledgeAgentToolNames).sort(),
    );
    assert.equal(tools.tools.length, 5);
    const creation = {
      ...command("draft-create", 0),
      articleId: ARTICLE,
      collectionId: COLLECTION,
      draft: guide,
    };
    const created = await mcpCall(session.client, "createDraft", creation);
    assert.equal(created.result.replayed, false);
    assert.equal(created.result.value.articleRevision, 1);
    const retry = await httpCall(
      host,
      session.tokens().access_token,
      "createDraft",
      creation,
    );
    assert.equal(retry.status, 200);
    const retried = await retry.json();
    assert.deepEqual(retried.result.value, created.result.value);
    assert.equal(retried.result.replayed, true);
    const retryAgain = await mcpCall(session.client, "createDraft", creation);
    assert.deepEqual(retryAgain, retried);
    const read = await mcpCall(session.client, "getDraft", {
      articleId: ARTICLE,
    });
    assert.equal(read.result.revision.createdBy, PRINCIPAL);
    const httpRead = await httpCall(
      host,
      session.tokens().access_token,
      "getDraft",
      { articleId: ARTICLE },
    );
    assert.equal(httpRead.status, 200);
    assert.deepEqual(await httpRead.json(), read);
    const update = {
      ...command("draft-update", read.result.generation),
      articleId: ARTICLE,
      collectionId: COLLECTION,
      draft: {
        ...guide,
        summary: "Save the exact fictional workspace as a CSV spreadsheet.",
      },
    };
    const updated = await mcpCall(session.client, "updateDraft", update);
    assert.equal(updated.result.value.articleRevision, 2);
    const current = (
      await mcpCall(session.client, "getDraft", { articleId: ARTICLE })
    ).result;
    stage = 40;
    const requirementsInput = { collectionId: COLLECTION, kind: "walkthrough" };
    const requirements = await mcpCall(
      session.client,
      "getValidationRequirements",
      requirementsInput,
    );
    assert.equal(requirements.result.expectedStagingBuildId, BUILD);
    assert.equal(requirements.result.checks.length, 2);
    const httpRequirements = await httpCall(
      host,
      session.tokens().access_token,
      "getValidationRequirements",
      requirementsInput,
    );
    assert.deepEqual(await httpRequirements.json(), requirements);
    assert.equal("trustedAttesterIds" in requirements.result, false);
    assert.equal("trustedRunnerIds" in requirements.result.checks[0], false);
    const execution = host.executeFixtureCheck(current);
    const submission = {
      ...command("evidence-submit", current.generation),
      articleId: ARTICLE,
      ...execution,
    };
    // A registered receipt cannot authenticate modified result/runner/build or
    // any other evidence field. Compare every complete submission field below.
    const forgeries = [
      { ...execution.evidence, runnerId: "fictional/runner/impostor" },
      { ...execution.evidence, stagingBuildId: "fictional-other-build" },
      { ...execution.evidence, result: "failed" },
      { ...execution.evidence, steps: ["forged caller assertion"] },
      {
        ...execution.evidence,
        artifacts: [{ id: "forged", hash: "f".repeat(64) }],
      },
    ];
    for (const [index, evidence] of forgeries.entries()) {
      const forged = await mcpCall(session.client, "submitEvidence", {
        ...submission,
        ...command(`forged-evidence-${index}`, current.generation),
        evidence,
      });
      assert.ok(forged.error);
    }
    const submitted = await mcpCall(
      session.client,
      "submitEvidence",
      submission,
    );
    assert.equal(submitted.result.replayed, false);
    assert.equal(submitted.result.value.articleRevision, 2);
    const evidenceRetry = await httpCall(
      host,
      session.tokens().access_token,
      "submitEvidence",
      submission,
    );
    const acknowledgement = await evidenceRetry.json();
    assert.deepEqual(acknowledgement.result.value, submitted.result.value);
    assert.equal(acknowledgement.result.replayed, true);
    assert.ok(host.counts.verifiedReceipts > 0);
    const safeDraft = await mcpCall(session.client, "getDraft", {
      articleId: ARTICLE,
    });
    for (const forbidden of [
      "evidence",
      "attestation",
      "provenance",
      "review",
      "published",
    ])
      assert.equal(forbidden in safeDraft.result, false);
    assert.equal(
      JSON.stringify(safeDraft).includes("SYNTHETIC_PRIVATE_EVIDENCE"),
      false,
    );

    stage = 50;
    const wrongResource = await host.wrongResourceCredential();
    await rejectedCredential(host, wrongResource.access_token, creation);

    const badPkce = createProvider(host);
    assert.equal(
      await auth(badPkce.provider, {
        serverUrl: host.resource,
        fetchFn: request,
      }),
      "REDIRECT",
    );
    const callback = await approve(host, badPkce.authorizationUrl());
    const rejected = await formPost(host.configuration.endpoints.token, {
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      resource: host.resource,
      redirect_uri: host.redirectUri,
      code: badPkce.callbackCode(callback),
      code_verifier: "Z".repeat(43),
    });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error, "invalid_grant");

    stage = 60;
    const initialTokens = session.tokens();
    host.advance(31);
    await rejectedCredential(host, initialTokens.access_token, creation);
    assert.equal(
      await auth(session.provider, {
        serverUrl: host.resource,
        fetchFn: request,
      }),
      "AUTHORIZED",
    );
    const rotated = session.tokens();
    assert.notEqual(rotated.access_token, initialTokens.access_token);
    assert.notEqual(rotated.refresh_token, initialTokens.refresh_token);
    const afterRefresh = await httpCall(
      host,
      rotated.access_token,
      "getDraft",
      { articleId: ARTICLE },
    );
    assert.equal(afterRefresh.status, 200);
    await afterRefresh.body?.cancel();
    const revoked = await formPost(host.configuration.endpoints.revocation, {
      client_id: CLIENT_ID,
      token: rotated.refresh_token,
      token_type_hint: "refresh_token",
    });
    assert.equal(revoked.status, 200);
    await rejectedCredential(host, rotated.access_token, creation);

    stage = 70;
    const device = await deviceProof(host);
    stage = 80;
    const fresh = await authorization(host, owned);
    host.demote();
    await rejectedCredential(host, fresh.tokens().access_token, creation);
    return {
      passed: true,
      liveHostsProven: false,
      targetClientAppsProven: 0,
      sdkDiscovery: true,
      s256Pkce: true,
      browserSession: true,
      csrfAndOrigin: true,
      callbackHops: host.counts.callbacks,
      tools: tools.tools.length,
      draftRevision: 2,
      exactReceipt: true,
      tamperedReceiptsRejected: forgeries.length,
      httpMcpParity: true,
      replayAcknowledgements: true,
      privateEvidenceExcluded: true,
      wrongResourceRejected: true,
      wrongPkceRejected: true,
      expiredRejected: true,
      refreshRotated: true,
      revokedRejected: true,
      adminDemotionRejected: true,
      device,
    };
  } finally {
    // Reverse ownership order closes native client transports before listener.
    // No component-owned MCP resource escapes a request in the stateless adapter.
    let cleanupFailed = false;
    try {
      for (const resource of owned.reverse()) {
        try {
          await resource.close();
        } catch {
          cleanupFailed = true;
        }
      }
    } finally {
      await host.close();
    }
    assert.equal(cleanupFailed, false, "Native client cleanup failed.");
  }
}

try {
  console.log(JSON.stringify(await runProof()));
} catch {
  console.error(JSON.stringify({ passed: false, stage }));
  process.exitCode = 1;
}
