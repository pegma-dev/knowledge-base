# KB-02 declared collections and durable layout

## Design status

This layout was written before durable operations and synchronized with the
storage/application seam agreement. KB-02 source work remains subject to the
owning implementation tests and repository gate; this document alone does not
mark the task complete. The declared collection is `knowledge-base.records.v1`.
The approved scope is the
[implementation plan](https://github.com/pegma-dev/support-desk/blob/main/docs/KNOWLEDGE_AI_PLAN.md)
and its P-00 capacity/privacy requirements. No KB-03 search projection, MCP
endpoint, real-host acceptance, or production readiness is established here.

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

Invalid rows or an unavailable dependency produce a visible failure. There is
no best-effort acceptance through Spine's event bus. Projection/search repair
is KB-03 work and cannot authorize a read or hide a failed authoritative
mutation. Host blob uploads are separate from record transactions and need
pending references plus orphan cleanup in the owning integration.
