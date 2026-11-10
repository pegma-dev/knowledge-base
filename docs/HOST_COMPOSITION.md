# Application and retrieval host composition

## Status and ownership

This documents the KB-02/KB-03 application and KB-04 transport host boundaries.
[KB-04 source](https://github.com/pegma-dev/knowledge-base/pull/5) and
[KB-05 release preparation](https://github.com/pegma-dev/knowledge-base/pull/6)
are merged; neither real host is ready on that evidence alone. The
application composes contracts/core with host-supplied Storage Core and
Authorization Core. The
optional `@pegma/knowledge-base-mcp` package supplies bounded HTTP/MCP adapters
over that application. All four `0.1.0` packages completed manual bootstrap
and exact-byte postflight without OIDC provenance. The four-package `0.1.1`
trusted release has a [historical receipt](BOOTSTRAP.md#historical-verified-011-release).
The four-package `0.1.2` atomic draft/source release is
[verified](BOOTSTRAP.md#current-verified-012-release). All four `0.1.3`
human-reviewed report packages subsequently completed
[verified trusted publication](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.3).
The governed authoring-context/report-query features shipped in the qualified
[`0.1.4` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.4).
All four answering read-batching `0.1.5` packages have completed
[qualified trusted publication](BOOTSTRAP.md#current-verified-015-release), including
strict registry/provenance and public-consumer verification. Internal read-wave
changes preserve the public ports and do not establish a universal Workers Free
call/CPU allowance or live-host acceptance. Publication does not update either
host's installed dependency pins. Host adoption, supported invocation-profile
measurements and acceptance remain separate.
No package becomes an identity system or an operational hosted endpoint.
See [declared collections](COLLECTIONS.md) for the required
layout, CAS, admission, and replay design.

The earlier merged [partial KB-05 source](https://github.com/pegma-dev/knowledge-base/pull/4),
documented in [source preparation](SOURCE_PREPARATION.md), adds
shared memory/Azurite/local-D1 conformance and a
[public synthetic composition](../examples/composition/README.md). The current D1
fixture passes a real Miniflare binding directly to the released
`@pegma/storage-cloudflare-d1@0.4.6` adapter with isolated per-factory cleanup.
It is local consumer evidence, not a deployed Workers binding or production
acceptance. The example's resolved contexts and receipt registry stand in for
trusted host facts; they authenticate no real browser, agent, or staging run.
AUTH-01's [merged public source](https://github.com/pegma-dev/agent-access/pull/1)
provided KB-04's historical credential producer prerequisite. The separate
`agent:proof` now installs exact registry `@pegma/agent-access@0.1.1` in a fresh
temporary consumer with four packed KB artifacts, lifecycle scripts disabled,
and official SDK `1.32.2`. It tests the synthetic OAuth and
draft/evidence transport loop. Agent Access's
[release-preparation source](https://github.com/pegma-dev/agent-access/pull/2)
is also merged, and its manual `0.1.0` bootstrap is complete without OIDC
provenance. Its trusted `0.1.1` release and strict registry verification have
since closed the public producer prerequisite. Actual existing-login/client
acceptance on both hosts remains open. See the
[release ledger](BOOTSTRAP.md#verified-agent-access-prerequisite) for the exact
Agent Access receipt. Each changed registry proof needs current-head execution;
historical source-producer evidence does not validate changed proof code.

The host owns identity verification, scoped local-agent credentials, current
authorization resolution, browser/transport protections, store construction,
clock/logger, trusted attestation verification, source-resource authorization,
retention/scheduling, safe rendering, and error mapping. The application owns
permission names and current resource checks for its own commands and keyed
reads. Collections own audiences; there are no article ACLs or host roles
inside this package.

## Authenticate before composing access

Resolve a trusted principal and a current Authorization Core access context
for each call, including replay. Apply the authenticated credential's scope
and target audience restrictions before passing effective authority into the
application. An access-context-shaped HTTP object from a customer is not an
authenticated context. The host must not cache permission authority beyond
its supported revocation/freshness boundary.

Each call snapshots its access context. Repeated permission checks use that
immutable authority while reloading current KB resources; they do not poll
the host's identity or policy system during an in-flight call. Resolve access
anew for each call/replay and bound operation duration and authority freshness
to the host's required revocation behavior.

Compose Agent Access through the adapter's host authentication port. It owns
credential issuance, expiry, refresh, replay handling, and revocation; the KB
transport consumes its authenticated restricted identity. The host validates
issuer, exact protected resource/audience, registered client, and current
principal/permission authority for each call. It also owns protected-resource
discovery, browser-route protections, origin/CORS configuration, and durable
request admission through its existing limiter. Public catalog MCP connectivity
does not authenticate private authoring.

Linking uses the host's existing human login and current Admin-only consent.
The device flow follows RFC 8628, including user code, polling interval, and
`slow_down`; the authorization-code flow requires S256 PKCE. Agents receive
neither a browser session nor the consenting Admin's role. A bearer cannot
link, approve, or manage grants. Initial consent is app-instance-wide authoring;
per-collection delegated consent remains a future host seam, while current KB
collection/resource checks continue to apply.

Register only `knowledge.article.draft.read`, `knowledge.article.draft.write`,
and `knowledge.article.evidence.submit`, using the existing `knowledgePermissions`
values. The dispatcher intersects consented known scopes with current permission
authority and strips roles, entitlements, and other permissions. It exposes
exactly `getDraft`, `createDraft`, `updateDraft`, `getValidationRequirements`,
and `submitEvidence`. Validation requirements need `draftWrite` or
`evidenceSubmit`; `draftRead` or `validationManage` alone is insufficient.
There are no collection/evidence/provenance reads, review/publication,
administration, or grant-management tools. New capabilities require explicit
scope registration, host policy, and fresh consent; adding a tool never silently
widens an existing grant. The KB does not issue credentials, create roles,
parse login cookies, implement OAuth, or supply a request limiter.
See the [agent API](AGENT_API.md) and [agent workflow](AGENT_WORKFLOW.md).

For each operation, check its named permission and current resource scope.
An article's collection is authoritative data loaded by the application, not
an arbitrary client-supplied partition. A move between collections must check
the relevant source and destination authority. Portal and approved bot-answer
audiences remain separate; a broad staff/service context cannot silently widen
the effective customer's answer audience.

## Authoring, evidence, and exact review

Compose `createKnowledgeBaseApplication` once with `store` and `clock`, and
optional `limits`, `evidenceVerifier`, `privateSources`, and nested `retrieval`
settings. The full
[application types](../packages/application/src/types.ts) define the command,
result, verifier, and DTO contracts. Keep mutation
commands distinct from trusted contexts: the host supplies actor identity,
clock, current scoped access, and verified external facts. The application
does not take an actor, role list, timestamp, or permission grant from an
untrusted command body as proof of authority.

| Operation family                     | Service methods                                                                                          | Required named permission                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Collection policy                    | `createCollection`, `previewCollectionPolicy`, `updateCollectionPolicy`                                  | `collectionManage`; anonymous portal or bot use additionally needs `publicCollectionApprove` and explicit `approvePublic` |
| Validation/governance                | `putValidationPolicy`, `putGovernanceConfiguration`, `getValidationPolicy`, `getGovernanceConfiguration` | `validationManage`                                                                                                        |
| Collection staff view                | `getCollection`                                                                                          | `collectionRead`                                                                                                          |
| Author requirements                  | `getValidationRequirements`                                                                              | `draftWrite` or `evidenceSubmit`                                                                                          |
| Governed authoring (`0.1.4` release) | `getAuthoringContext`, `confirmAuthoringContext`                                                         | `draftRead` and (`draftWrite` or `evidenceSubmit`); private evidence additionally needs `evidenceRead`                    |
| Drafts                               | `createDraft`, `updateDraft`; `getDraft`                                                                 | `draftWrite`; `draftRead` respectively                                                                                    |
| Evidence                             | `submitEvidence`; `getEvidence`; `revokeEvidence`                                                        | `evidenceSubmit`; `evidenceRead`; `evidenceRevoke` respectively                                                           |
| Private provenance                   | `setProvenance`; `getProvenance`                                                                         | `provenanceWrite`; `provenanceRead`, plus source-resource checks                                                          |
| Review                               | `submitForReview`; `getReview`, `rejectReview`                                                           | `reviewSubmit`; `review` respectively                                                                                     |
| Publication                          | `publishArticle`; `retireArticle`                                                                        | `publish`; `retire` respectively                                                                                          |
| Portal-safe keyed read               | `getPublishedArticle`                                                                                    | `articleRead` and the published collection's current portal audience                                                      |

Names in this table are members of the contracts package's
`knowledgePermissions`; they are permission identifiers, not roles. Resource
and proof checks remain additional requirements. `getPublishedArticle` is a
portal read, not bot-only retrieval. The separate retrieval methods below
enforce their own effective-customer use and audience.

Privileged hosts calling `createDraft` or `updateDraft` directly may pass optional
`sourceReferences` as the complete current private source set. Supplying the
field requires both `draftWrite` and `provenanceWrite`, even for `[]`; every
reference must pass `PrivateSourcesVerifier.canRead`. The application repeats
per-reference checks after a CAS conflict, after a successful commit, and before
acknowledging exact replay; current operation/resource authority also remains
required. Content and current provenance commit
atomically in the existing article transaction, including Audit, receipt, and
causal jobs. Updating a draft preserves the older publication's separate
`publishedProvenance`. Omission means the property is absent and retains legacy
draft-only behavior, preserving an existing current source snapshot. Explicit
`undefined` is rejected by the strict JSON-data boundary rather than normalized
away.

The exact ordered `sourceReferences` array participates in command and
source-snapshot identity. Persist and retry its original order; a same-command-ID
permutation conflicts without writes. Each accepted command supplying the field
creates a fresh current source-snapshot generation even for unchanged references,
as with `setProvenance`, subject to bounded history admission. Exact replay adds
no rows.

SD-03 closes its empty/stale source window only if the owning host always
supplies a complete nonempty reference set for each generated draft create or
update. The [approved source progression](https://github.com/pegma-dev/support-desk/pull/38)
does not establish release, host/client, privacy, or pilot acceptance. Source
readability may coexist with publication ineligibility or staleness;
`canPublish`/`isCurrent` and exact review/publication checks remain required.
The initial local-agent HTTP/MCP schemas reject `sourceReferences`. This direct
host extension adds no tool or consent scope.

`getValidationRequirements` returns the current article-kind checks,
validation-policy reference, governance generation, and expected staging
build for authorized authors. It omits trusted attester IDs; full governance
configuration remains an administrative read.

### Governed authoring context (`0.1.4` release)

`getAuthoringContext(access, { articleId, includeEvidence?: boolean })` returns
`{ context, observation }`. The context combines current `draft` and narrow
`requirements`. It derives collection/kind from the actual article and checks
exact article, collection and validation-policy head versions before returning.
It does not hydrate unrelated publication or provenance material. Explicit
`includeEvidence: true` requires `evidenceRead` and adds the complete current
evidence and retained revocation DTO at the draft's generation. Omission excludes
that DTO; it is never a claim that accepted or revoked evidence is empty.

`confirmAuthoringContext(access, observation)` rechecks those heads for the same
actor and required projection permissions. The opaque handle belongs to one
application instance and current operation. Confirmation consumes it before
storage reads; retrying after a storage failure needs a new observation. Never
clone, serialize, persist, send or hash the handle into report/replay identity.
It exposes no Store version and supplies no permission, verified proof, review
or publication authority. A confirmation cannot turn a restricted context into
the resolver's broader human authority.

The report factory's optional paired `authoringContext` port uses this operation-
local recheck instead of a second full context hydration. Its required legacy
`readContext` port remains supported. Optimized decisions retain live entry,
post-probe prewrite and postcommit staff checks; they omit only the redundant
metadata-probe-adjacent resolution. No DTO or side effect is released before the
fresh prewrite check. A postcommit denial can withhold an accepted ACK, so preserve
the exact original command for recovery.

The released `reports.query` returns body-free target metadata, requirements,
ledger state and optional owner-only status under `draftRead` plus
`evidenceSubmit`. The optional agent report port can use it through the existing
requirements operation; legacy report trios retain their fallback. It returns
no draft body, private evidence, report details, reviewer or provenance. See
[evidence reports](EVIDENCE_REPORTS.md) for composition and exact privacy rules.

These are finite current observations across separate partitions, not a global
snapshot or policy lock. Evidence qualification, exact review/publication and
host credential freshness remain independent checks. Private record keys are
prepared before parallel keyed reads so a provider may batch them through its
existing Store implementation. Full history remains subject to the existing
bounds, without truncation or a new lifetime cap. Fewer calls do not prove a
universal Workers Free 50-query or CPU budget; measure complete real host
invocations, supported histories, cold composition and contention separately.

Use application generation for optimistic mutation commands. Content revision
is only the version of the article text and metadata:

| Accepted action           | Content revision | Application generation |
| ------------------------- | ---------------- | ---------------------- |
| Create draft              | 1                | 1                      |
| Attach evidence           | 1                | 2                      |
| Submit exact review       | 1                | 3                      |
| Publish reviewed revision | 1                | 4                      |
| Edit guide                | 2                | 5                      |

The numbers illustrate separate fences, not a prescribed command sequence.
Creates use `expectedGeneration: 0`; an existing resource mutation supplies
its exact current generation. Every mutation also supplies `commandId`
and `correlationId`; reuse a stable command ID for the same semantic command.
The service derives actor and operation time from trusted
access/clock inputs.
A concurrent evidence, review, or source-reference mutation changes application
generation even when content revision is unchanged. Stale expected generation
must not overwrite that accepted work. Storage conflicts are retried only
within the configured bound with reloaded state and resource checks. The host
owns access-context freshness and revocation behavior.

`submitEvidence` accepts an `EvidenceSubmission` plus an opaque receipt string.
`EvidenceVerifier.verify` receives the authenticated access context, current
article revision, complete submission, opaque receipt, and authoritative
governance configuration. It must authenticate the
runner/proof and return a verification receipt bound to the exact article
revision/hash, evidence/check, product/staging build, execution result, and
trusted verifier identity/time. The application may check configured runner/
verifier membership and freshness after receiving trusted facts. It must not
establish those facts by echoing the caller's `passed` result or attestation.
Missing verification configuration or a null result fails closed; it is not a
testing shortcut for a real integration.

The verification adapter should be read-only or safely idempotent under a
stable operation/evidence identity: transaction retries do not authorize
duplicate external side effects. Replacing evidence produces a new immutable
version and invalidates pending review. Evidence for an old draft cannot
authorize the edited one. Staging execution and protected artifact upload are
host/local-agent work; the application never fetches submitted URLs or runs
guide steps.

Review/publication uses exact current content, collection audience policy,
validation policy, applicability, and evidence bindings. A reviewer's scoped
permission is checked at the command boundary; a matching hash is not a signed
capability. Policy/public-collection approval is a separate authorized admin
operation. The initial host configuration keeps anonymous portal/chat use
disabled even though the contract can represent a reviewed public audience.

## DTO and source privacy boundaries

Use purpose-specific result types. Published-content results contain approved
article content and safe article metadata only. Private staff authoring/history
results require current named permissions and collection/resource checks.
Never send a raw core `Article` aggregate to a browser customer or support model:
it may contain private draft content, review, evidence, attestation references,
and provenance even when the article is retired.

Opaque source references require separate current authorization to the source
resource. A staff member's KB permission does not prove they can read a linked
ticket. The application/host must check that authority before exposing private
source metadata or resolving the reference; unavailable source authorization
must not be treated as an allow. Keep raw customer conversations in the owning
support system rather than copying them into KB history.

`PrivateSourcesVerifier.canRead` checks each private reference supplied through
atomic draft authoring or returned by `getProvenance`. The separate `canPublish`
and `isCurrent` callbacks attest
source eligibility/currentness without returning source bodies. Nonempty
source snapshots fail closed when those required gates are unavailable.
A portal customer does not need permission to read private source tickets in
order to consume an approved guide; the source-currentness gate still runs
independently for source-bearing published content.

Published-content reads hydrate the old publication's revision, exact retained
proofs, `publicationReview`, and `publishedProvenance`, using its published
collection/configuration rather than a new draft's collection or metadata.
They must confirm current collection and validation-policy
authority, exact publication bindings, and the required retained evidence
state. Evidence freshness is revalidated at the recorded approval's
`reviewedAt`, preserving approved guidance as evidence ages; new review and
publication commands use the current clock. Governance generation, current
policy/source eligibility, exact retained proof availability, and revocation
remain live gates. Retirement or current policy revocation defeats old pointers. A
separate collection/profile transaction cannot atomically fence all article
partitions: current checks make stale state unusable on subsequent reads;
the implementation must not promise cross-partition atomic revocation.
Retrieval/search adds bounded candidate and final-authority checks; a keyed
`getPublishedArticle` call is not a search operation.

## Retrieval and trusted local ports

The application extends the same composition with `retrieval.limits`,
`retrieval.candidateAdapter`, and `retrieval.tokenCounter`. Limits may only
reduce fixed component ceilings; unknown, nonpositive, or excessive values
are rejected. Defaults use keyed Storage Core projection reads. No request
path may scan or mutate a corpus. See [retrieval](RETRIEVAL.md) for the exact
[public retrieval types](../packages/application/src/retrieval-types.ts),
physical work limits, lexical behavior, and repair design.

| Methods                                                              | Required current authority                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `listPortalCollections`, `searchPublishedArticles`                   | `articleRead` and the relevant portal audience                           |
| `retrieveAnswerSources`, `confirmAnswerSources`                      | Effective customer's `articleRead`, `botRead`, and relevant bot audience |
| `repairArticleIndex`, `repairRetrievalPage`, `getArticleIndexStatus` | `indexManage`; staff-only DTOs                                           |

Resolve bot calls from the effective customer, not an unrestricted service or
staff principal. Portal permission alone does not authorize bot use, and bot
permission does not grant portal browsing. Search and bot applicability are
exact tuples; an absent build/locale is not a wildcard. Safe no-result DTOs
contain no candidate totals or unconfirmed text.

`SourceTokenCounter.count(serializedSources)` is a trusted synchronous local
port required for counted bot payloads. Count the complete deterministic
source serialization, not just article bodies. `AnswerSourcesResult` returns
that `serializedSources` and `sourceTokens`. Retrieval fits the largest ranked
prefix of whole sources within aggregate byte/token limits, requiring a
positive safe-integer count for nonempty sources. Reconfirmation is exact and
all-or-nothing, without prefix fitting. The owning support integration
separately budgets the full prompt and output. Do not send customer text to an
external tokenizer merely to count it.

A host `KnowledgeCandidateAdapter` supplies source-free hints and truthful
bounded work accounting, including empty pages and discarded rows. Reported
work is checked before hints are consumed; the library cannot meter hidden
remote-provider work. Candidate IDs, ranking, and counts never authorize
content. Current publication, policy, source eligibility, and applicability
are independently confirmed by the shared checker.
The application preserves first-seen adapter order for bounded preselection;
host adapters supply stable ordering across pages and may return
approved body/synonym matches with zero local metadata overlap. Confirmed
metadata scores rank results, with adapter order breaking ties; the default
Store lexical path retains ordinal ID ties. Hosts evaluate adapter relevance
and own provider data controls.

Citations contain a safe label and optional `portalArticle` ID/revision, never
a URL. That browse reference exists only when the same customer independently
passes portal authority. Resolve it into the host's safe article route; never
resolve a private provenance reference into a customer citation. Exact answer
source references are observation fences, not leases. Reconfirm under fresh
effective-customer access before later answer use, then enforce the Support
Desk ticket/turn fence before reply commit.

Schedule bounded `repairRetrievalPage` cycles with its opaque cursor and
staff-visible progress. `getArticleIndexStatus` reports pending/ready/blocked
and `indexed`; a ready withdrawal has `indexed: false`. Projection admission
or partial failure must remain visible. Repair convergence is separate from
live authoritative revocation; do not imply a cross-partition transaction.
Page scans are also bounded by the shared batch allowance (at most 32 physical
rows by default), with one registration/advancement per unique collection or
article. Current collection hints also make empty collections discoverable;
directory IDs do not grant access to their labels. Persist the actual
backend cursor and repeat complete cycles; a single pass may leave pending
work. Authoritative jobs remain hints rather than being acknowledged or
deleted by repair.
Unexpected configuration, adapter, or storage errors in staff maintenance
fail visibly rather than becoming a customer `no_result`; documented admission
and source-hold status paths remain in force.

## Replay, failure, and host operation

Bind a command's ID/fingerprint to the actor, operation, target, and semantic
inputs. `CommandResult` contains `value` and `replayed`. Identical retry
returns the original bounded historical acknowledgement without appending another
Audit event, immutable history version, or causal job. A changed fingerprint
conflicts. Before returning a replay result, recheck current operation and
resource authority. The acknowledgement carries resource ID/generation and
small status/hash/version fields, not article content, evidence, or provenance.
It does not promise that the acknowledged state is current or servable; use
the appropriate current read. An old expected generation may identify an exact
replay, while a new command must match current generation. A retained receipt
cannot restore access after revocation.

A storage or transport failure can leave the caller uncertain whether the
transaction committed. A post-commit source-read denial or dependency error can
also follow an accepted mutation. Do not assume rollback or issue a new command
ID. Retry the same command ID and exact payload, including the source-reference
order and original `expectedGeneration`, under freshly resolved authority.
The committed receipt resolves the bounded historical acknowledgement without
duplicating effects once the current authorization checks pass.

Resource generation, content revision, and opaque store version are distinct:
the first is the application command fence, the second identifies immutable
content, and the last participates in a backend CAS transaction. Persist the
accepted head change, receipt, Audit action, immutable records, and causal jobs
together. No accepted state change depends on an in-process event subscriber
running or a second cross-partition write succeeding.

Host error mapping must preserve named authorization, conflict, capacity,
invalid-input, missing-resource, and unavailable-dependency outcomes while
returning content-free messages to untrusted callers. Operational logs use
safe IDs/generations and coarse categories; they must not serialize content,
evidence, credentials, full receipts, or source references. Audit remains the
transactional Pegma contract, not a parallel host log format.

Configured limits govern physical rows/chunks, retained bytes/history,
transaction actions/bytes, conflict attempts, and control reserve. Reaching a
limit produces a visible admission failure before partial acceptance. Do not
increase a lifetime cap to hide an unbounded read, skip the reserve to force a
publish, or delete referenced evidence to make room. See
[COLLECTIONS.md](COLLECTIONS.md) for the component defaults, enforced ceilings,
and byte accounting definition.

Hosts remain responsible for authorized evidence downloads, retention/deletion,
backup/recovery, blob orphan cleanup, safe Markdown/plain-text rendering,
rate limits, and worker scheduling/checkpoints. Signed-in web/API integration
and a supervised deployment require their own task evidence. Passing local
application tests does not establish live MCP authentication,
provider ZDR configuration, either real host, or production readiness. The
synthetic actual-SDK proof closes only its source protocol evidence when gates
pass. PG-01/RG-01 must consume exact published Agent Access and KB dependencies,
then record existing-login/current-Admin consent and every requested client/mode
against each host's real staging evidence attester before activation. Keep this
acceptance open in P-00 and the parent plan; source proof does not waive staff
review/publication, privacy, isolation, bounded work, or full human-workflow
acceptance before A-01 and either pilot.

Built in the open by RetireGolden, LLC.
