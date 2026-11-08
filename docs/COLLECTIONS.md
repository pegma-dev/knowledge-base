# Declared collections and durable layout

## Design status

The authoritative layout was written before KB-02 durable operations. The
KB-03 retrieval layout below was recorded before its durable operations and
synchronized with the implementation seam agreement. Source work
remains subject to owning implementation tests and repository gates; this
document alone does not mark a task complete. The authoritative collection is
`knowledge-base.records.v1`.
The approved scope is the
[implementation plan](https://github.com/pegma-dev/support-desk/blob/main/docs/KNOWLEDGE_AI_PLAN.md)
and its P-00 capacity/privacy requirements. KB-04's optional HTTP/MCP adapter
source is [merged](https://github.com/pegma-dev/knowledge-base/pull/5). The
[verified `0.1.1` release](BOOTSTRAP.md#verified-knowledge-base-release) is
complete; the `0.1.2` source candidate, real-host acceptance, and production
readiness retain their own gates.

## Partition and authority rules

Use host-supplied `@pegma/storage-core` collections and codecs. Do not add a
private database or a second in-memory persistence implementation. Every
accepted mutation, its Audit action, replay receipt, and causal jobs must
share one declared collection and one partition so one `transact` commits
all of them. Storage Core provides no cross-partition transaction.

The logical partition families are:

| Partition family  | Authoritative records                                                                                           | Transaction scope              |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Article           | Normalized head, immutable revisions/evidence/publication history, receipts, Audit events, causal jobs          | One article mutation           |
| Collection        | Current collection policy, exact public-policy approval, governance configuration, receipts, Audit, causal jobs | One collection mutation        |
| Validation policy | Current validation policy, receipts, Audit, causal jobs                                                         | One validation-policy mutation |

The physical partition is `<kind>:<sha256>`, where `kind` is `article`,
`collection`, or `validation` and the lowercase digest covers canonical JSON
of `[kind, resourceId]`. Logical resource/command IDs are bounded, well-formed
Unicode: normal astral pairs are accepted and lone surrogates are rejected.
Canonical JSON hashing avoids raw text-encoding ambiguity. IDs remain data;
callers cannot select another resource through an arbitrary storage key.
The synchronous codec validates stored metadata, JSON shape, and bounds; it
cannot see the backend key or recompute the resource's asynchronous hash.
Repository keyed reads check the expected resource, partition, and row
identity. These checks reject malformed or inconsistent records within the
supported storage boundary; they do not authenticate database contents.

This layout assumes the application is the exclusive writer to its declared
collection and the host/store adapter is trusted. Quota counters and immutable
history depend on every write following the application transaction protocol.
Direct database writes or tampering are outside that integrity model; hashes
and codecs are not signatures or database-access controls.

Collection and validation-policy partitions are separate authorities. Reading
them before an article transaction cannot globally fence a concurrent policy
change. Article CAS protects the article generation only. Recheck current
authority before read/projection use and reject stale publication bindings;
do not claim an atomic policy-revocation transaction across those partitions.

## Article record families

The application reconstructs the bounded core `Article` transition aggregate
from records. It does not persist that entire aggregate as one ever-growing
JSON envelope.

| Logical row                                             | Required identity/binding                                                                                                                                     | Lifecycle                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `head`                                                  | Article ID, application generation, state, current revision/evidence references, private source generation, pending review, and separate publication pointers | Conditional replacement                                       |
| `revision:<articleRevision>`                            | Immutable content hash and applicability                                                                                                                      | Insert-only retained history                                  |
| `evidence:<articleRevision>:<evidenceIdHash>:<version>` | Article revision, exact evidence ID/version/hash and trusted verifier receipt                                                                                 | Insert-only retained history                                  |
| `review:<applicationGeneration>:pending\|publication`   | Exact review binding and source/governance generation fence                                                                                                   | Immutable review history; unchanged snapshots can reuse a row |
| `publication:<applicationGeneration>`                   | Approval binding; content remains in the separately referenced revision row                                                                                   | Immutable approval; head pointers control current use         |
| `provenance:<sourceGeneration>`                         | Opaque private source references and application-computed hash                                                                                                | Immutable private snapshot                                    |
| `revoked:<proofHash>`                                   | Revoked exact historical evidence tuple and reason                                                                                                            | Immutable marker                                              |
| `command:<commandIdHash>`                               | Request fingerprint, actor/resource binding, committed bounded acknowledgement                                                                                | Idempotent accepted-command result                            |
| Audit action                                            | Audit's stable event ID and accepted mutation metadata                                                                                                        | Same transaction as the accepted mutation                     |
| `job:<commandIdHash>:<ordinal>`                         | Stable command/ordinal/generation and bounded payload/state                                                                                                   | Same transaction as its cause; retries update bounded state   |

Evidence-ID and command-ID hashes use canonical JSON of the exact ID. Causal
job identity includes the stable command and ordinal. Audit uses
`auditRecordId(commandIdHash)`. Collection partitions retain
`collection-policy:<collectionRevision>` and `configuration:<applicationGeneration>`;
unchanged configuration can reuse its prior row. Validation-policy partitions
retain `policy:<version>`. No cross-family read grants authority.

Application generation advances on every accepted article mutation, including
evidence and review changes. Content revision advances only on a content edit.
They are separate fences: two evidence submissions for the same content
revision must not overwrite each other through a content-only CAS.

An evidence key includes the article revision as well as its own ID/version.
Core may restart an evidence ID's version sequence on a new draft; omitting
the article revision would collide with retained evidence from the old draft.
Publication references exact retained evidence versions. Editing a draft may
clear current evidence/review pointers while preserving those immutable rows
needed by an existing approved publication.

`publicationReview` remains separate from the pending `review`. It binds the
published revision to its own source snapshot and collection-governance
generation while a new draft/review is prepared. Current publication reads
hydrate that published snapshot, not the new draft's evidence or provenance.
Proof freshness is rechecked as of the stored approval's `reviewedAt`; an
approved guide does not expire merely because its evidence ages after approval.
Current policy/source eligibility, governance generation, retained proof
availability, and revocation remain live checks.
Explicit evidence revocation records its article revision/ID/version/hash,
clears pending review, and holds an affected publication. Replacing current
evidence does not silently revoke a previously approved historical proof.

Source references and evidence are private staff material. Store only opaque
external source references and bounded verification metadata, never copied
ticket transcripts or a raw-source archive. Resolving a source reference
requires current permission to that external resource; KB permission alone
does not authorize the source ticket. Customer/bot DTOs contain approved
content only and must not serialize an aggregate, receipts, evidence, review,
provenance, or private storage metadata.

## Physical representation and hard bounds

The codec maps one record to native flat `StoredRecord` metadata plus
`part0` through `part14`. Its canonical JSON payload is split into at most
15 string properties of at most 30,000 UTF-16 units each, without splitting
a surrogate pair. The payload is limited to 895,904 UTF-16 bytes, reserving
4,096 bytes within a 900,000-byte component entity budget for metadata.
The adapter maps these properties natively; the whole map must not be wrapped
inside one large Azure string property.

| Bound                 | Component default and enforced ceiling                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `maxPhysicalRows`     | 1,024 retained physical rows per resource partition; configurable up to 10,000                              |
| `maxRetainedBytes`    | 16 MiB encoded-record JSON estimate per partition; configurable up to 64 MiB                                |
| `controlReserveRows`  | 32 rows held back from ordinary authoring admission                                                         |
| `controlReserveBytes` | 512 KiB held back from ordinary authoring admission                                                         |
| `maxArticleRevisions` | 64 retained content revisions and maximum revision number; configurable up to 1,000                         |
| `maxEvidenceVersions` | 256 retained evidence versions across revisions; configurable up to 1,000                                   |
| `maxConflictAttempts` | 3 storage-conflict attempts; configurable up to 8                                                           |
| Native row payload    | At most 15 parts; 30,000 UTF-16 units per part; payload plus reserved metadata at most 900,000 UTF-16 bytes |
| Transaction           | At most 100 actions and 3 MiB encoded-record JSON estimate                                                  |

The 16 MiB and 3 MiB metrics count
`new TextEncoder().encode(canonicalJson(nativeStoredRecord)).length`; they are conservative
component admission estimates, not a claim to measure Azure SDK wire framing.
Rows, native string properties, and transaction work have independent bounds.
Configured values are bounded integers; reserves must be nonnegative and
strictly smaller than their respective partition totals.
Host/adapter constraints still apply. Deployment throughput, retention periods,
and live capacity require the owning host's evidence.

The smallest supported adapter limit governs a transaction. Admission counts
every physical row and its native chunk bytes before filtering. When a bound is
reached, return a named capacity outcome without partial accepted state.
Heads account for all application-created physical rows, including immutable
history, Audit, commands, and jobs. Online commands use keyed reads rather
than partition scans. No full-history API, automatic pruning, or unlimited
revision history is provided. A future retention/compaction operation must
preserve live references, replay commitments, and its own completion capacity,
or fail visibly for operator action.

## Mutation, replay, and recovery

Read the authoritative head/version and current collection/validation policy,
authorize the operation, and validate its expected application generation.
Prepare the pure core transition from the bounded hydrated aggregate. Plan
the resulting physical writes and admission reservation before committing a
single-partition CAS transaction containing the head change, immutable rows,
Audit, receipt, and causal work. A conflict reloads/redecides within a bound
and repeats resource checks under the call's trusted access-context freshness
boundary; it does not append an unbounded attempt log.

Direct host `createDraft`/`updateDraft` inputs may include complete
`sourceReferences`. Presence, including `[]`, requires both `draftWrite` and
`provenanceWrite`. Every supplied reference must pass current `canRead` checks,
repeated on CAS retry, after a successful commit, and on exact replay. Content
and current private provenance commit in the existing article transaction with its head,
immutable rows, Audit, receipt, and causal jobs; there is no second provenance
write. An update preserves the older publication's separate
`publishedProvenance`. Each accepted command supplying the field creates a fresh
current source-snapshot generation even when the references are unchanged, as
with `setProvenance`; bounded history admission still applies. Exact replay adds
no rows. An absent property retains legacy draft-only behavior and preserves an
existing current source snapshot; `sourceReferences: undefined` is rejected by
the strict JSON-data boundary.

The exact ordered array participates in both command and source-snapshot
identity. Persist and retry its original order; a same-command-ID permutation
conflicts without writes.

This closes SD-03's empty/stale source window only when the owning host always
supplies its complete nonempty reference set. A readable source may still be
ineligible or stale: review/publication and current published reads retain
their independent source eligibility/currentness gates. This operation adds no
cross-partition fence over external source policy. The initial HTTP/MCP
authoring schemas reject `sourceReferences` and add no scope or tool.

A command ID is scoped to its actor, operation, target, and exact input
semantic fingerprint. Identical replay returns a bounded historical
acknowledgement without duplicating history/Audit/jobs; a changed fingerprint
conflicts. Overlapping identical commands return that same acknowledgement
once the accepted command's receipt exists, even when their original expected
generation is now stale. Replay still
requires the caller's current operation/resource permissions. A receipt is
not an access capability, and replay cannot recover private data after access
revocation. It returns no content, evidence, or provenance, and does not promise
that the acknowledged content is still published or usable. A separate current
read establishes current availability. Published-history hydration uses its
exact retained immutable versions, not the new mutable draft's material.

A post-commit source-read denial or unavailable dependency can return an error
after the mutation was accepted. Do not assume rollback or issue a new command
ID. Under refreshed authority, retry the same command ID, exact payload and
source order, and original `expectedGeneration` to resolve its bounded historical
acknowledgement without duplicate writes.

Invalid rows or an unavailable dependency produce a visible failure. There is
no best-effort acceptance through Spine's event bus. Projection/search repair
cannot authorize a read or hide a failed authoritative
mutation. Host blob uploads are separate from record transactions and need
pending references plus orphan cleanup in the owning integration.

## KB-03 retrieval projection layout

The derived collection is `knowledge-base.retrieval.v1`. This layout was
recorded before its operations and synchronized with source. The host-supplied
Store is isolated per KB
instance, as in KB-02. There is no tenant/instance-ID option or shared tenant
control plane. Cross-instance isolation depends on supplying separate stores.

| Partition family             | Row families                                                                        | Meaning                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Singleton `directory`        | `head`                                                                              | Bounded collection discovery hints                                                        |
| `catalog:<collectionIdHash>` | `head`                                                                              | Bounded article discovery hints for one collection                                        |
| `article:<articleIdHash>`    | `head`                                                                              | Bounded projection progress/status for one article                                        |
| `scope:<scopeHash>`          | `head`, `manifest:<articleIdHash>`, `posting:<termHash>`, `page:<termHash>:<0..15>` | Quota ledger, per-article term/progress manifest, posting head, and bounded posting pages |

Article/catalog ID hashes and normalized-term hashes use
`SHA256(canonicalJson(value))`. Scope hashes cover canonical JSON of the object
`{ collectionId, policyVersion, use }`, where use is `portal` or `bot`.
Candidate entries contain article revision/content hash plus observed
application/source generations and a binding hash. Queries match the immutable
published revision/hash and current collection/policy; the hint's older
generations or full binding hash neither grant authority nor hide an unchanged
retained publication after a new draft. Current authority comes from the
publication checker. Hints contain no titles,
article bodies, raw source text, or URLs; lexical terms are hashed. These are
lookup/integrity bindings, not encryption or access capabilities. Current
authoritative confirmation still gates every exposed result.

Request retrieval uses only keyed directory/catalog/posting reads and bounded
article confirmation. It never lists or scans a projection partition. Only
maintenance scans bounded physical pages of `knowledge-base.records.v1`,
counting all rows before filtering and returning an opaque backend cursor.

Projection rows use native flat chunk properties with the same independent
row/string limits as the authoritative collection. Scope partitions admit at
most 8,192 physical rows and 16 MiB of encoded-record JSON estimates; batches
are bounded to 100 actions and a 3 MiB transaction estimate. A transaction
counts encoded native rows (or encoded delete keys) plus 256 bytes per action;
retained partition bytes count encoded rows without that action allowance.
These byte estimates
remain distinct from native UTF-16 property/entity bounds and backend wire
framing. Lower host limits still apply.

Each scope batch handles at most two terms: even two full sixteen-page
postings require at most 36 physical mutations including manifest and scope
head. Three bounded CAS attempts protect the scope ledger, which subtracts
old rows/bytes and adds replacements and the new head. Scope CAS protects a
batch, not a whole corpus or all partitions. Partial batches and
directory/catalog/article-status changes are
resumable derived work. Maintain generation-fenced target manifests and
conditional cleanup, with visible pending/blocked status on failure. Do not
report indexing complete until new targets and obsolete-scope cleanup have
converged. Retirement/revocation remains effective through authoritative read
checks while projection repair catches up. See [retrieval](RETRIEVAL.md) for
query bounds, audience-safe citations, and repair/acceptance requirements.

Cleanup reclaims obsolete term/page rows while retaining small manifest and
catalog generation floors so delayed work cannot recreate older projections.
The directory retains at most 64 collection IDs. A collection catalog retains
at most 256 article identities and 32 historical policy/use epochs; a scope
retains at most 256 article floors. An article plan admits at most 32
known/pending scopes while cleanup converges. These are finite admission
budgets, not unbounded lifetime history. When retained floors/epochs exhaust
capacity, report blocked capacity work; no safe floor/epoch compaction is
implemented or implied.
