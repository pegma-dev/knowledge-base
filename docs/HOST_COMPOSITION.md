# Application and retrieval host composition

## Status and ownership

This documents the agreed KB-02/KB-03 source API and host boundary. Implementation
and repository gates determine task completion; this document does not assert
that either real host is ready. The unpublished application composes
contracts/core with host-supplied Storage Core and Authorization Core. It is
not an HTTP server, an identity system, or an operational MCP endpoint.
See [declared collections](COLLECTIONS.md) for the required
layout, CAS, admission, and replay design.

Independent partial KB-05 [source preparation](SOURCE_PREPARATION.md) adds
shared memory/Azurite/local-D1 conformance and a
[public synthetic composition](../examples/composition/README.md). The D1
fixture passes a real Miniflare binding directly to the released
`@pegma/storage-cloudflare-d1@0.4.1` adapter with isolated per-factory cleanup.
It is local consumer evidence, not a deployed Workers binding or production
acceptance. The example's resolved contexts and receipt registry stand in for
trusted host facts; they authenticate no real browser, agent, or staging run.
KB-04's credential/client flow and full KB-05 publication remain unfinished.

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

API/MCP author credentials initially permit draft authoring and evidence
submission. They do not acquire review/publication or collection-management
authority by declaring a runner, reviewer, attester, or permission string.
Hosts map named KB permissions into existing policy and role administration;
the KB does not issue credentials, create roles, parse cookies, or implement
OAuth. Existing public catalog MCP connectivity is not private authoring
authentication. The live credential/protected-resource proofs remain
KB-04/host activation prerequisites.

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

| Operation family       | Service methods                                                                                          | Required named permission                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Collection policy      | `createCollection`, `previewCollectionPolicy`, `updateCollectionPolicy`                                  | `collectionManage`; anonymous portal or bot use additionally needs `publicCollectionApprove` and explicit `approvePublic` |
| Validation/governance  | `putValidationPolicy`, `putGovernanceConfiguration`, `getValidationPolicy`, `getGovernanceConfiguration` | `validationManage`                                                                                                        |
| Collection staff view  | `getCollection`                                                                                          | `collectionRead`                                                                                                          |
| Author requirements    | `getValidationRequirements`                                                                              | `draftWrite` or `evidenceSubmit`                                                                                          |
| Drafts                 | `createDraft`, `updateDraft`; `getDraft`                                                                 | `draftWrite`; `draftRead` respectively                                                                                    |
| Evidence               | `submitEvidence`; `getEvidence`; `revokeEvidence`                                                        | `evidenceSubmit`; `evidenceRead`; `evidenceRevoke` respectively                                                           |
| Private provenance     | `setProvenance`; `getProvenance`                                                                         | `provenanceWrite`; `provenanceRead`, plus source-resource checks                                                          |
| Review                 | `submitForReview`; `getReview`, `rejectReview`                                                           | `reviewSubmit`; `review` respectively                                                                                     |
| Publication            | `publishArticle`; `retireArticle`                                                                        | `publish`; `retire` respectively                                                                                          |
| Portal-safe keyed read | `getPublishedArticle`                                                                                    | `articleRead` and the published collection's current portal audience                                                      |

Names in this table are members of the contracts package's
`knowledgePermissions`; they are permission identifiers, not roles. Resource
and proof checks remain additional requirements. `getPublishedArticle` is a
portal read, not bot-only retrieval. The separate retrieval methods below
enforce their own effective-customer use and audience.

`getValidationRequirements` returns the current article-kind checks,
validation-policy reference, governance generation, and expected staging
build for authorized authors. It omits trusted attester IDs; full governance
configuration remains an administrative read.

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

`PrivateSourcesVerifier.canRead` checks each private reference returned by
`getProvenance`. The separate `canPublish` and `isCurrent` callbacks attest
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
transaction committed. Retry the same command ID and exact semantic input,
including its original expected generation, under freshly resolved access.
The committed receipt resolves an accepted command without duplicating its
effects; an unknown outcome is not a reason to issue a new command ID.

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
application tests does not establish MCP authentication,
provider ZDR configuration, either real host, or production readiness.

Built in the open by RetireGolden, LLC.
