# @pegma/knowledge-base-application

This package composes contracts/core with
host-supplied Storage Core, Authorization Core, Audit, and a clock. Source
implementation and repository gates determine task completion; neither this
package nor local tests establish a live host or production readiness.

The [declared layout](https://github.com/pegma-dev/knowledge-base/blob/v0.1.1/docs/COLLECTIONS.md) records the agreement made
before durable operations. [Host composition](https://github.com/pegma-dev/knowledge-base/blob/v0.1.1/docs/HOST_COMPOSITION.md) describes the host
authentication, current-resource authorization, verified-evidence, and privacy
boundaries. [Retrieval](https://github.com/pegma-dev/knowledge-base/blob/v0.1.1/docs/RETRIEVAL.md)
documents bounded lexical lookup, authoritative confirmation, citations, and
repair. The optional `@pegma/knowledge-base-mcp` package adds HTTP/MCP adapters
over this API; it supplies no login or token issuer. Real-host acceptance and
production activation remain separately gated.

GitHub documentation links target this package's release tag rather than
development `main`. During release preparation that tag may still be pending;
it is created after the reviewed merge and before publishing. Source readers
can use the explicitly moving
[DEVELOPMENT documentation on main](https://github.com/pegma-dev/knowledge-base/blob/main/docs/HOST_COMPOSITION.md)
while preparing a release. The versioned contract references remain tag-pinned;
the DEVELOPMENT link is a source-reader fallback.

The application API owns authorized commands, application-generation CAS,
bounded immutable revision/evidence history, exact review/publication,
transactional Audit/receipts/causal jobs, bounded retrieval/repair, and safe
published-content DTOs.
Collections own audience policy; articles inherit it without per-article ACLs.
Role models, token issuance, sessions, HTTP, provider SDKs, arbitrary URL
fetching, code execution, and a new database are outside this package.

Passing evidence requires a host-authenticated verifier receipt bound to the
exact submitted evidence. Echoing caller-supplied `passed`, runner identity,
or an attestation object does not establish proof. Command replay likewise
rechecks current permission and resource authority before returning a result.
Never expose raw aggregates or private evidence/source references to customers
or a support model.

## Composition and commands

`createKnowledgeBaseApplication` takes `store` and `clock`, with optional
`limits`, `evidenceVerifier`, `privateSources`, and nested `retrieval` settings.
Hosts authenticate callers
and resolve current scoped `AccessContext` values. The
[public types](https://github.com/pegma-dev/knowledge-base/blob/v0.1.1/packages/application/src/types.ts) define commands and purpose-specific results;
the package owns no HTTP routes or credentials.

Creates use `expectedGeneration: 0`; later mutations use exact application
generation, which also advances for evidence/review/provenance changes.
Content revision advances only when content changes. All mutation inputs
include a stable `commandId` and observability `correlationId`. The service
derives actor/time from the trusted context and clock.

Collection/validation/governance commands establish private defaults, current
validation requirements, staging applicability, and trusted attesters. Article
commands create/update drafts, submit verified evidence and review, publish an
exact `ReviewSnapshot`, reject, retire, set private provenance, or revoke an
exact historical proof. The snapshot includes the core approval binding plus
article/source/governance generations.

`CommandResult` returns `{ value, replayed }`, where `value` is a bounded
historical acknowledgement. It contains no body/evidence/provenance. Replay
rechecks current operation/resource authority, conflicts on changed semantic
input, and does not claim the historical result is currently servable.

## Reads and trust

`getDraft`, `getEvidence`, `getProvenance`, and `getReview` have distinct
permissions and DTOs. Private references additionally require current source
resource authorization. `getValidationRequirements` gives authorized authors
current kind-specific checks, policy reference, and staging build without
disclosing trusted attester IDs. `getPublishedArticle` is a portal-safe keyed read:
it checks the published collection's current portal audience and returns only
approved content/safe metadata. It is not KB-03 search or bot-only retrieval.

`EvidenceVerifier.verify` authenticates an opaque receipt against the entire
submission, authenticated actor, exact article, and governance configuration.
It returns trusted attestation facts or null. A missing verifier fails closed.
`PrivateSourcesVerifier.canRead` controls private reference disclosure;
`canPublish` and `isCurrent` independently attest source eligibility without
making source tickets readable to customers. Missing required gates fail
closed for nonempty source snapshots.

An existing publication retains its own review/source snapshot and exact
historical proof references while a new draft is prepared. Replacing current
evidence does not revoke an old proof; explicit revocation holds an affected
publication and clears pending review. Current reads reject stale governance
or source authority. Retained evidence freshness is checked at the recorded
approval time; later aging alone does not expire an approved guide. New review
and publication use current time, while current policy/source eligibility,
proof availability, and revocation remain live checks. Article CAS cannot
globally fence separate collection/
validation-policy partitions.

## Bounded retrieval and repair

`listPortalCollections` and `searchPublishedArticles` require current portal
authority. `retrieveAnswerSources` and `confirmAnswerSources` use the effective
customer's `articleRead`, `botRead`, independent bot audience, and exact product
applicability. Read results report `results` or `no_result`, never candidate
totals. Titles, snippets, content, and citations come from freshly confirmed
publications rather than index text. Bot-only citations have a safe label;
`portalArticle` appears only when that customer can also browse the article.

The default lexical projection uses approved titles, summaries, and tags, not
body text. Requests use only bounded keyed reads. Optional
`retrieval.candidateAdapter` hints remain untrusted; the host adapter must
report all physical work, including empty pages and discarded rows.
Adapters may match approved body text/synonyms with zero metadata overlap;
bounded preselection preserves their order, and confirmed metadata scores
rank results with adapter-order ties. Hosts own relevance evaluation and
provider data controls; current publication checks remain mandatory.
`retrieval.tokenCounter` is a trusted local counter over the complete
`serializedSources` returned with `sourceTokens`. Retrieval fits the largest
ranked prefix of whole articles within aggregate byte/token budgets with a
positive local count; reconfirmation is exact and all-or-nothing.
`retrieval.limits` can only lower fixed component ceilings.
See [retrieval](https://github.com/pegma-dev/knowledge-base/blob/v0.1.1/docs/RETRIEVAL.md)
for the exact API, limits, authority/reference fences, and evaluation boundary.

`repairArticleIndex`, `repairRetrievalPage`, and `getArticleIndexStatus` require
`indexManage`. Only maintenance performs bounded physical scans with opaque
cursors. Pending/blocked status remains visible until repair converges;
`ready` with `indexed: false` means a converged withdrawal. Projection cleanup
may lag retirement/revocation, but current authority checks still reject
ineligible publications. The host owns scheduling and recovery.

## Storage and limits

All accepted head changes, immutable rows, generic Audit actions, receipts, and
causal jobs share one resource partition in `knowledge-base.records.v1`.
Native flat chunk properties keep bounded rows compatible with the host's
store adapter. The application separately bounds physical rows, encoded bytes,
history, transaction work, retries, and control reserve. Read the
[layout limits](https://github.com/pegma-dev/knowledge-base/blob/v0.1.1/docs/COLLECTIONS.md#physical-representation-and-hard-bounds)
before changing admission or retention; these are component safety bounds,
not measured host throughput. No private persistence or parallel audit log is
implemented here.

Merging source does not publish a package. Hosts verify exact registry artifacts
and provenance and complete their release/host activation gates. See
[release operations](https://github.com/pegma-dev/knowledge-base/blob/v0.1.1/docs/RELEASING.md).

Built in the open by RetireGolden, LLC.
