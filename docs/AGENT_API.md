# Version 1 agent authoring boundary

`@pegma/knowledge-base-mcp` supplies a shared dispatcher, strict Zod schemas,
an MCP adapter, and a Web Request/Response adapter. Both transports invoke the
existing `KnowledgeBaseApplication`; neither introduces
an authorization engine or another article lifecycle. These source packages are
unpublished. Passing synthetic transport tests does not establish live OAuth,
protected staging execution, publication, or host readiness.

## Trusted host composition

Create `createKnowledgeAgentDispatcher({ application, resource, limits? })` once.
For every call and retry the host must authenticate the credential, validate its
exact audience/resource and client, and resolve current authorization. Supply
`{ access, scopes, clientId, resource }` as a trusted `KnowledgeAgentIdentity`,
separately from the request body. The configured and authenticated `resource`
strings must match exactly. The KB is a resource server: it does not issue
credentials, implement login, store tokens, create roles, or implement a limiter.

`knowledgeAgentScopes` reuses three existing named permissions:

| Scope member     | Exact scope and permission          |
| ---------------- | ----------------------------------- |
| `draftRead`      | `knowledge.article.draft.read`      |
| `draftWrite`     | `knowledge.article.draft.write`     |
| `evidenceSubmit` | `knowledge.article.evidence.submit` |

Register each scope with the host's existing agent-access registry, mapping it
to the same named KB permission. The transport has no runtime dependency on
Agent Access. A host may compose that package after its public release, using
its normal authenticated resolver; copied source, branch references, and local
paths are not production substitutes for a released package.

The dispatcher intersects those three known scope strings with the supplied
current `access.permissions`. Unknown scopes grant nothing. It drops roles,
entitlements, and every other permission before invoking the application, even
when the authenticated host context contains administration or publication
authority. Collection/resource checks and command replay authorization remain
the application's responsibility. The host owns current-access freshness,
credential revocation, request timeouts, and external request limits.
Trusted scope/permission arrays have a separate 256-item ceiling, independent
of the client payload's 32-item array ceiling. A broader current host context
is attenuated to the same three permissions rather than copied into the
application call. Authority is read through own data properties; getters,
sparse arrays, symbols, and custom array prototypes do not establish grants.

## Exact initial operation set

Each envelope is `{ apiVersion: "1", operation, input }`. All input objects,
including nested draft/evidence objects, reject unknown fields.

| Operation                   | MCP tool                                   | Required effective permission    |
| --------------------------- | ------------------------------------------ | -------------------------------- |
| `getDraft`                  | `knowledge_v1_get_draft`                   | `draftRead`                      |
| `createDraft`               | `knowledge_v1_create_draft`                | `draftWrite`                     |
| `updateDraft`               | `knowledge_v1_update_draft`                | `draftWrite`                     |
| `getValidationRequirements` | `knowledge_v1_get_validation_requirements` | `draftWrite` or `evidenceSubmit` |
| `submitEvidence`            | `knowledge_v1_submit_evidence`             | `evidenceSubmit`                 |

Draft-read or validation-management authority alone does not grant author
validation requirements. There are no collection, private-evidence read,
provenance, review, publication, retirement, retrieval, or administration tools
in this initial transport surface.

Inputs mirror the public application contracts:

- `getDraft`: `{ articleId }`.
- `getValidationRequirements`: `{ collectionId, kind }`.
- `createDraft` and `updateDraft`: `{ commandId, correlationId,
expectedGeneration, articleId, collectionId, draft }`. Creates require
  `expectedGeneration: 0`. A draft contains `kind`, `title`, `summary`,
  `content: { format, text }`, `tags`, and `applicability: { productId,
productVersion, buildId?, locale? }`.
- `submitEvidence`: `{ commandId, correlationId, expectedGeneration,
articleId, evidence, receipt }`. Evidence contains `id`, `articleId`,
  `articleRevision`, `contentHash`, `validationPolicy: { id, version }`,
  `checkId`, `testKind`, `applicability`, `stagingBuildId`, `steps`, `result`,
  `executedAt`, `runnerId`, and `artifacts: [{ id, hash }]`. The opaque receipt
  is nonempty and at most 8,192 UTF-8 bytes.

Caller-supplied context, scopes, principal, proof, evidence version/hash, or
attestation fields are rejected. Evidence's revision/content hash, policy
reference, artifact hashes, runner, execution time, and claimed result are
submission data required by the public contract. They do not authenticate
anything. The existing trusted evidence verifier must authenticate and bind the
opaque receipt; missing verification fails closed. The transport fetches no
artifact URL and executes no guide step.

## HTTP composition

`createKnowledgeAgentHttp({ dispatcher, apiUrl, resource,
protectedResourceMetadataUrl, allowedOrigins, authenticate, limit })` returns
`{ handle(request) }`. `handle` returns `null` for unmatched paths so the host's
router can continue. The API endpoint uses an exact canonical HTTPS `apiUrl`;
its authenticated protected resource remains the configured canonical MCP
resource URL. A matching path with a different URL authority, `Host`, or query
is rejected. Explicit `allowInsecureLoopback` is available only for local
synthetic proof.

The trusted host `authenticate(request)` port returns a
`KnowledgeAgentIdentity` or a denial `Response`. It must validate issuer,
client, resource, expiry, credential revocation, and current principal access.
The adapter requires Bearer authorization, normalizes authentication failures,
and discards arbitrary host denial bodies and headers. Missing or invalid
credentials receive the protected-resource metadata challenge; infrastructure
failures remain unavailable.

`limit(request, { transport })` supplies the host's existing request-admission
decision before authentication and body processing. It returns a boolean or
`{ allowed, retryAfterSeconds? }`; denial is 429 and an exception is 503. The
adapter implements no limiter storage or policy.

Authenticated requests use POST with JSON and strict UTF-8. Stream work is
bounded to 1,024 chunks and the configured request-byte allowance, with oversized
streams cancelled. An `Origin`, when present, must exactly match an allowed
origin; native clients may omit it. Responses use `no-store`, `nosniff`, and
`no-referrer`, with CORS limited to the exact admitted origin and no credentialed
cookie mode. Hosts own cross-origin preflight routing when required; this
adapter accepts POST only. Authentication and protocol failures may use their
standard transport error shape before an application envelope is dispatched.

## MCP composition

`createKnowledgeAgentMcp({ dispatcher, mcpUrl, resource,
protectedResourceMetadataUrl, allowedOrigins, authenticate, limit })` returns
the same `{ handle(request) }` router interface. `mcpUrl` must exactly equal
`resource`. It uses the HTTP adapter's trusted authentication/admission ports,
URL/Host/Origin rules, protected-resource challenge, strict UTF-8 reader, and
response protections. Metadata is host-owned and is never served by this
package. Configure the same resource on the dispatcher and both transports.

The adapter uses pinned MCP SDK `1.32.2` and Zod `4.6.7`. Each admitted POST
gets a fresh stateless SDK server and Streamable HTTP transport. It caches no
identity or protocol session: every initialize, tool listing, tool call, and
notification must pass current host admission and authentication. Only tools
are advertised, using the five names above with useful strict input JSON
schemas. Client metadata and capability objects are bounded and validated
before reaching the SDK; they grant no server authority.

Responses use JSON rather than an SSE stream. Authenticated GET and DELETE
receive 405; an accepted initialized notification receives 202. The pinned
SDK negotiates the protocol version. Tool calls use the shared dispatcher;
one text content block contains the exact versioned response JSON, with
`isError` set for application failure. There is no parallel `structuredContent`
representation. The logical application result retains the same complete
response-byte budget; MCP's JSON string escaping/framing is separately capped
at twice that allowance plus 4,096 bytes. No transport executes article steps,
fetches evidence, or acquires review/publication authority.

## Results and safe failures

Success is `{ apiVersion: "1", operation, result }`. Draft reads expose the
application's author-facing `DraftArticleDto`, including revision `createdBy`
and `createdAt`, plus bounded state flags. They exclude evidence, provenance,
review records, and attestation artifacts. Validation requirements expose only
collection/governance generation, policy reference, expected staging build,
and current checks; trusted runner/attester registries remain private.
Mutations return the existing `{ value, replayed }` acknowledgement with
ID/generation, content revision, state, and content hash. Output schemas
explicitly whitelist these DTO fields.

Failures are `{ apiVersion: "1", operation, error: { code, status, message } }`.
Invalid envelopes use `operation: null` rather than reflecting an arbitrary
caller-supplied operation. Messages are fixed and content-free:

| Code              | HTTP status |
| ----------------- | ----------- |
| `invalid_request` | 400         |
| `forbidden`       | 403         |
| `not_found`       | 404         |
| `conflict`        | 409         |
| `capacity`        | 413         |
| `prerequisite`    | 412         |
| `unavailable`     | 503         |

Unknown exceptions become `unavailable`; no input, receipt, verifier message,
internal exception, stack, source reference, or proof artifact is serialized.
Hosts should log only safe operational identifiers and coarse categories.

## Bounds and retry behavior

Defaults bound request and response serialization to 131,072 UTF-8 bytes,
nesting to 12, graph work to 1,024 nodes, arrays to 32 items, and objects to
32 keys. The byte allowance covers the core's complete 32 KiB guide or sixteen
1,000-character evidence steps with UTF-8 expansion, metadata, opaque receipt,
and framing. Individual draft/evidence fields retain the core's ceilings.
These are component bounds, not host throughput promises.

Optional limits may only reduce those ceilings; `maxResponseBytes` must remain
at least 2,048 bytes. This reserves a complete bounded mutation acknowledgement,
including a 200-character identifier at four UTF-8 bytes per character, two
maximum safe integers, a SHA-256 digest, and fixed versioned-envelope framing.
Smaller configurations fail before serving any operation, so a committed
command and its exact historical replay always fit the admitted byte allowance.
Oversized read results fail as a whole. Guides and procedures are never
truncated into incomplete steps. The shared JSON reader applies the complete
configured byte, depth, node, per-array item, and per-object key ceilings before
`JSON.parse`. Its bounded lexical scan respects quoted/escaped text and nested
containers; `JSON.parse` remains responsible for JSON syntax. Schemas and
parsing helpers remain internal; the public factories supply the shared
boundary. The dispatcher checks object graph bounds before Zod and detaches
and freezes input and effective authority before any application await. It
rejects getters, custom prototypes, symbols, cycles, and sparse arrays rather
than invoking coercion hooks. Zod validates transport shape; the application
still owns all semantic, lifecycle, proof, resource, and generation checks.

For an uncertain command outcome, retry the same `commandId` and exact semantic
input, including the original `expectedGeneration`, with newly authenticated
current access. The transport forwards those fields unchanged. The application's
transactional receipt returns the original historical acknowledgement with
`replayed: true` and does not append duplicate history, Audit, or causal jobs.
Changed semantic input conflicts. A replay never restores revoked authority or
claims the acknowledged historical state remains current; read the draft anew.
