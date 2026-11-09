# @pegma/knowledge-base-application

This package composes contracts/core with
host-supplied Storage Core, Authorization Core, Audit, and a clock. Source
implementation and repository gates determine task completion; neither this
package nor local tests establish a live host or production readiness.

The [declared layout](https://github.com/pegma-dev/knowledge-base/blob/v0.1.2/docs/COLLECTIONS.md) records the agreement made
before durable operations. [Host composition](https://github.com/pegma-dev/knowledge-base/blob/v0.1.2/docs/HOST_COMPOSITION.md) describes the host
authentication, current-resource authorization, verified-evidence, and privacy
boundaries. [Retrieval](https://github.com/pegma-dev/knowledge-base/blob/v0.1.2/docs/RETRIEVAL.md)
documents bounded lexical lookup, authoritative confirmation, citations, and
repair. The optional `@pegma/knowledge-base-mcp` package adds HTTP/MCP adapters
over this API; it supplies no login or token issuer. Real-host acceptance and
production activation remain separately gated.

Existing versioned documentation links below describe the verified `v0.1.2`
release. The optional report service shipped in the verified
[`v0.1.3` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.3).
Governed authoring-context and report-query additions are unpublished `0.1.4`
candidate source; their guide uses DEVELOPMENT `main` until their reviewed
release tag exists.
Source readers can use the explicitly moving
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
[public types](https://github.com/pegma-dev/knowledge-base/blob/v0.1.2/packages/application/src/types.ts) define commands and purpose-specific results;
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

Privileged direct host calls to `createDraft`/`updateDraft` may supply optional
`sourceReferences` as the complete current private source set. Presence,
including `[]`, requires both `draftWrite` and `provenanceWrite`; every reference
must pass current `PrivateSourcesVerifier.canRead` checks on the initial
attempt, CAS retry, after a successful commit, and on exact replay. Content and
current provenance commit in one existing article transaction with Audit,
receipt, and causal jobs. An update preserves the older publication's
`publishedProvenance`. Omission means the
property is absent and retains legacy draft-only behavior, preserving an existing
current source snapshot. Explicit `undefined` is rejected by the strict JSON-data
boundary.

The exact ordered array participates in command and source-snapshot identity.
Persist and retry that order: a same-command-ID permutation conflicts without
writes. Each accepted command supplying the field creates a fresh current
source-snapshot generation even when references are unchanged, as with
`setProvenance`, subject to bounded history admission. Exact replay adds no rows.

Historical source snapshots retain the `0.1.1` structural and hash rules;
stricter URL-prefix hygiene applies only to newly supplied write inputs.
Existing opaque keys such as `git:issue/1` or `data:row42` remain reviewable and
publishable subject to the same current source eligibility and exact approval
gates. Draft edits that omit `sourceReferences` preserve those snapshots.

SD-03 hosts must always supply a complete nonempty set to close the empty/stale
source window. A readable reference may still be ineligible or stale;
review/publication and published reads retain their eligibility/currentness
checks. The initial HTTP/MCP schemas reject `sourceReferences`; this extension
adds no agent scope or tool.

`CommandResult` returns `{ value, replayed }`, where `value` is a bounded
historical acknowledgement. It contains no body/evidence/provenance. Replay
rechecks current operation/resource authority, conflicts on changed semantic
input, and does not claim the historical result is currently servable.

A source-read denial or dependency error after commit may follow an accepted
mutation. Do not assume rollback or use a new command ID. Under refreshed
authority, retry the same command ID and exact payload, including source order
and the original `expectedGeneration`, to resolve the bounded historical
acknowledgement without duplicate writes.

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
`PrivateSourcesVerifier.canRead` controls atomic draft source input and private
reference disclosure;
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

## Governed authoring reads (new source)

`getAuthoringContext(access, { articleId, includeEvidence?: boolean })`
returns `{ context, observation }`. The context contains the current draft and
narrow validation requirements, without hydrating private provenance or an
unrelated retained publication. It requires `draftRead` and either `draftWrite`
or `evidenceSubmit`. Explicit `includeEvidence: true` additionally requires
`evidenceRead` and returns the complete current evidence and revocation DTO at
the same article generation. Omission excludes that material; it does not mean
empty accepted evidence or revocation history.

The read confirms exact article, collection and validation-policy head versions.
`confirmAuthoringContext(access, observation)` checks those heads again under
the original actor and required permissions. It consumes the instance-bound
handle before storage, including on failure. Keep it only within the current
operation: never clone, serialize, persist or send it to a client. It grants
no permission or evidence/publication authority, and supplies no cross-partition
lock. Resolve host authority freshly at its existing operation boundaries.

Reports can opt into these methods through the optional paired
`authoringContext` factory port. Deferred forwarding closures preserve the
application/verifier construction cycle. The required legacy `readContext`
port and its two-context behavior remain supported. A report decision using
the optional pair retains live entry, post-probe prewrite and postcommit staff
checks; exact replay fingerprints contain no observation.

`reports.query(access, { articleId, status?: { ledgerEpoch, reportId } })`
combines safe requirements, ledger state and optional owner-only status. It
requires `draftRead` plus `evidenceSubmit` and returns a body-free target binding,
never a draft body, report, evidence or provenance. The optional MCP query port
uses the existing requirements tool and response shape; it adds no scope/tool.

Evidence/revocation keys are prepared before a parallel keyed-read wave, allowing
a provider's optional batching without a new Store method or private SQL. This
does not establish a host query/CPU budget: legitimate histories remain bounded
by the existing component limits, and real host profiles need measured proof.

## Human-reviewed evidence reports (`0.1.3` release)

New source exports `createKnowledgeEvidenceReports` and its public option,
input, view, acknowledgement and error types. The factory shipped in verified
`0.1.3`; the governed context/report-query additions are the unpublished
synchronized `0.1.4` candidate.
Its own review, current-head CI, trusted publication, strict consumer
verification and host acceptance remain pending. The
[DEVELOPMENT evidence-report guide](https://github.com/pegma-dev/knowledge-base/blob/main/docs/EVIDENCE_REPORTS.md)
describes explicit Store namespace/current-authority ports, human confirmation
before actual KB qualification, bounded epochs/retention, and the separate
report-ledger-to-article commit window.

Choose default `portable-v1` encoded physical keys for a new ledger. Select
`legacy-raw-v1` explicitly only to retain a compatible existing raw-key ledger;
no populated-namespace detection, layout switch or migration is automatic.
The factory adds no agent scope, MCP tool, role, login, scheduler or provenance
bridge. Hosts retain exact-publication and activation prerequisites.

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
See [retrieval](https://github.com/pegma-dev/knowledge-base/blob/main/docs/RETRIEVAL.md)
for the exact API, limits, authority/reference fences, and evaluation boundary.

`repairArticleIndex`, `repairRetrievalPage`, and `getArticleIndexStatus` require
`indexManage`. Only maintenance performs bounded physical scans with opaque
cursors. Pending/blocked status remains visible until repair converges;
`ready` with `indexed: false` means a converged withdrawal. Projection cleanup
may lag retirement/revocation, but current authority checks still reject
ineligible publications. The host owns scheduling and recovery.

The unpublished `0.1.4` candidate accepts optional `maxBatches` on keyed and
paged repair. It must be a positive integer within the instance's
`maxMaintenanceBatches`. Explicit `maxBatches: 1` shares one physical Store
transaction attempt across the article's prerequisites, posting work and
completion; failed CAS attempts count, while already-current prerequisites do
not. Page repair applies the allowance separately to each resource, including
collection-directory work. Use `limit: 1` as well when scheduling one resource
per invocation. Omission retains legacy behavior: keyed repair can perform up
to the instance's advancement allowance (default 32), and page repair gives
each candidate one advancement with internal prerequisite/retry work.

Committed manifests and pending scopes let later calls resume after partial
failure or a lost acknowledgement. Budget exhaustion returns conservative
`pending`; storage or current-source confirmation may still throw. Retain work
on pending, blocked or error; acknowledge a host ready-key hint only after a
current `ready` result and an unchanged hint version. Save actual successful
scan continuations and repeat full cycles, including when individual articles
remain pending. Existing atomic `article_changed` jobs remain recovery hints.
No article mutation, Audit, receipt or proof history is discarded or reset.

This bounds derived transaction attempts, not total backend queries, verifier
I/O, host checkpoints, CPU or elapsed time. Prepared read waves preserve all
required approved proofs and revocation markers, and final current publication,
audience, source and head checks. Retained history is unchanged. They add no
authorization cache and do not establish
Workers Free quota acceptance. The candidate's own gates, trusted release and
whole-host measurements remain separate.

## Storage and limits

All accepted head changes, immutable rows, generic Audit actions, receipts, and
causal jobs share one resource partition in `knowledge-base.records.v1`.
Native flat chunk properties keep bounded rows compatible with the host's
store adapter. The application separately bounds physical rows, encoded bytes,
history, transaction work, retries, and control reserve. Read the
[layout limits](https://github.com/pegma-dev/knowledge-base/blob/v0.1.2/docs/COLLECTIONS.md#physical-representation-and-hard-bounds)
before changing admission or retention; these are component safety bounds,
not measured host throughput. No private persistence or parallel audit log is
implemented here.

Merging source does not publish a package. Hosts verify exact registry artifacts
and provenance and complete their release/host activation gates. See
[release operations](https://github.com/pegma-dev/knowledge-base/blob/v0.1.2/docs/RELEASING.md).

Built in the open by RetireGolden, LLC.
