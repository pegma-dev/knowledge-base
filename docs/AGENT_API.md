# Version 1 agent authoring boundary

`@pegma/knowledge-base-mcp` supplies a shared dispatcher, strict Zod schemas,
an MCP adapter, and a Web Request/Response adapter. Both transports invoke the
existing `KnowledgeBaseApplication`; neither introduces
an authorization engine or another article lifecycle. The KB `0.1.0` packages
completed manual bootstrap without OIDC provenance. All four `0.1.1` packages
have since completed verified trusted publication. The current verified KB
release is [`0.1.2`](BOOTSTRAP.md#verified-knowledge-base-release).
Optional report mode is new unpublished `0.1.3` candidate source, with its own
review, gates and verified trusted release pending.
Agent Access's verified public `0.1.1` producer prerequisite is closed; see the
[release receipt](BOOTSTRAP.md#verified-agent-access-prerequisite). Passing
synthetic transport tests does not establish live host login, protected staging
execution, KB trusted publication, or host readiness.

## Trusted host composition

Create `createKnowledgeAgentDispatcher({ application, resource, reports?, limits? })`.
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

Legacy inputs use the following bounded subset of the public application
contracts; configured report-mode variants are described below:

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

`sourceReferences` is rejected by the strict `createDraft`/`updateDraft` schemas
over both HTTP and MCP. The optional atomic draft/source input belongs only to
privileged direct host application calls; no scope or tool is added here.

Caller-supplied context, scopes, principal, proof, evidence version/hash, or
attestation fields are rejected. Evidence's revision/content hash, policy
reference, artifact hashes, runner, execution time, and claimed result are
submission data required by the public contract. They do not authenticate
anything. The existing trusted evidence verifier must authenticate and bind the
opaque receipt; missing verification fails closed. The transport fetches no
artifact URL and executes no guide step.

## Optional native-client report mode

The unpublished `0.1.3` source adds an optional `reports` port:
`Pick<KnowledgeEvidenceReports, "report" | "ledger" | "status">`. A host can
compose the shared [human-report factory](EVIDENCE_REPORTS.md) behind this port.
It adds no tool or scope. The same MCP connection advertises extended strict
input schemas/descriptions for the existing requirements and evidence tools;
HTTP accepts the same versioned envelopes. Clients cannot enable the mode
through a request flag. When `reports` is omitted, legacy tool schemas,
accepted inputs and result shapes remain unchanged; extension fields reject.

The public types are `KnowledgeAgentReportRequirementsInput`,
`KnowledgeAgentReportRequirementsResult`, `KnowledgeAgentReportSubmissionInput`,
`KnowledgeAgentPendingReport`, `KnowledgeAgentReportEnvelope`, and
`KnowledgeAgentReportSuccess`. Both report variants require the effective
`draftRead` **and** `evidenceSubmit` permissions. This does not change the
legacy requirements variant's `draftWrite`-or-`evidenceSubmit` rule.

For report-aware `getValidationRequirements`, input is strictly
`{ collectionId, kind, articleId, reportLookup?: { ledgerEpoch, reportId } }`.
The current draft must match the supplied collection/kind. The result adds
`reportLedger: { ledgerEpoch, status: "active" | "resetting" }` to the normal
requirements. Supplying `reportLookup` also returns the submitting owner's
body-free `reportStatus: { ledgerEpoch, reportId, receipt, reportGeneration,
status: "pending" | "confirmed" | "rejected" }`. No report body, reviewer,
private accepted evidence or trusted-attester registry is exposed. An epoch
mismatch conflicts; another submitter's report is not found.

For report submission, the existing `submitEvidence` tool accepts strictly
`{ commandId, correlationId, expectedGeneration, articleId, evidence,
ledgerEpoch, report: { summary, details } }`, with **no `receipt` field**.
`evidence` remains the whole original `EvidenceSubmission`; `summary` is at
most 1,000 characters and `details` at most 16,000, within the existing complete
request bounds. Admission checks the exact current article generation and
ledger epoch. The result is
`{ kind: "pending-human-review", ledgerEpoch, reportId, receipt,
reportGeneration }`, with a receipt bounded to 512 UTF-8 bytes. This records a
private report only: it is not `{ value, replayed }`, does not accept KB evidence,
and does not change the article generation. Keep that distinction in clients.

A human uses separately authorized staff services to inspect the private
report and record a decision. A current authorized Admin may review their own
agent's report; no two-person rule is enforced. The agent polls through the
report-aware requirements input. After first confirmation, it uses the same
original opaque report receipt and exact evidence in the legacy `submitEvidence`
input, with the current article generation. Only that call performs actual KB
qualification. Current runner/result/build/governance, reviewer trust, exact
revision and freshness checks still apply; `confirmed` is not accepted evidence.
Explicit reassessment rotates the receipt cycle; poll for its current receipt
and obtain a new human confirmation before submitting it.

The optional port is trusted host composition, not a credential verifier. Bind
each `report`, `ledger` and `status` call to the same authenticated request/grant
and recheck that grant's identity, scope/resource restrictions and revocation
before and after awaited work. Preserve the dispatcher-supplied restricted
context; a freshly resolved owner/Admin context must not replace it. The host
must fence current grant changes during these awaits as well as authenticate
the initial transport request. The shared ledger's current-principal checks
do not independently authenticate a host grant.

Report writes and article reads/commits are separate. A later fence failure
can withhold a response after a report was queued; conflict or unavailability
does not prove rollback. Retry an uncertain report command with the same ID
and exact input under fresh authority. Report epoch/generation conflicts and
resetting ledgers map to `conflict`; report bounds/capacity to `capacity`;
missing grants to `forbidden`; unconfirmed or altered receipts fail actual
evidence qualification with `prerequisite`. No agent report-listing, human
decision, reset/drain, private-evidence read or publication tool is added.
The [public types](../packages/mcp/src/types.ts) and
[source protocol cases](../tests/agent-reports.test.ts) cover this optional mode;
actual native-client/host acceptance remains separate.

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
Article mutations return the existing `{ value, replayed }` acknowledgement with
ID/generation, content revision, state, and content hash. Output schemas
explicitly whitelist these DTO fields. Configured report queuing instead
returns the distinct `pending-human-review` result described above.

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
