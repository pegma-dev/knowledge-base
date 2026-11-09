# KB-03 bounded retrieval

## Design status

This design was recorded before durable retrieval operations and synchronized
with the agreed public types and projection layout. Implementation tests and
repository gates remain required.
KB-03 extends the existing application package; it creates no new package,
database, model integration, or authentication system. The KB `0.1.0` packages
completed manual bootstrap without OIDC provenance. All four `0.1.1` packages
completed [historical verified trusted publication](BOOTSTRAP.md#historical-verified-011-release),
followed by the [historical `0.1.2` release](BOOTSTRAP.md#historical-verified-012-release)
and current [verified `0.1.3` release](BOOTSTRAP.md#current-verified-013-release).
Source `0.1.4` is the unpublished governed authoring-context/report-query candidate. Source tests and
repository gates, not this document, determine completion. KB-04's optional HTTP/MCP adapter source
is [merged](https://github.com/pegma-dev/knowledge-base/pull/5). The candidate's
verified trusted release, real-host acceptance, and production activation retain
their own gates.

The optional bounded repair mode described below is also unpublished `0.1.4`
candidate behavior. It requires the candidate's own validation and release;
this guide does not establish a passing host quota or CPU profile.

Read [declared collections](COLLECTIONS.md) for the authoritative record
layout and [host composition](HOST_COMPOSITION.md) for trusted access,
evidence, source eligibility, and safe DTO boundaries.

## Projection and authority

The index is a maintained, repairable set of derived candidate hints over
approved article revisions. A host instance and collection scope every hint;
policy/use and exact revision bindings scope its use. It is not another
authoritative KB. A search entry never grants publication, audience access,
product applicability, or authority to a title, snippet, count, or citation.

Request paths use keyed reads only. The lexical index uses approved titles,
summaries, and tags, not article bodies or private material. Normalization
folds accents/case, extracts Unicode letter/number terms, and removes common
question words. Approved tags supply explicit aliases; the default path has
no model query expansion. Confirmed metadata scores a title match at 12, tag match at
8, and summary match at 3 per query term. Semantic retrieval is not required
by this task. See [COLLECTIONS.md](COLLECTIONS.md) for physical row families.

Default Store preselection considers at most eight candidates (or a lower
configured bound) by matching-term count, then ordinal article ID. Confirmed
positive lexical matches sort by score descending, then ordinal article ID.
With an optional adapter, preselection preserves first-seen response order
across pages. The host supplies stable relevance ordering; it may match
approved body text or synonyms with zero local
metadata overlap; after confirmation, metadata score ranks those candidates
and adapter order breaks equal-score ties. Both paths rank a bounded candidate
window, without an exhaustive corpus-wide best-match claim.

Every article candidate must pass the shared authoritative publication checker before
any customer/model material is returned. The checker uses the exact current
published revision, its retained review/proofs/source snapshot, current
collection and validation authority, current source eligibility, and the
requested product applicability. It does not use the new draft's metadata.
Retained proof freshness is checked at the stored approval time; proof
availability, revocation, governance, and source eligibility remain live.
A hint must match the immutable approved revision/hash and current
collection/policy. Its observed application/source generations and full
binding hash do not establish authority. A new draft can make those hint
fields old while leaving the retained approved revision unchanged; that
publication remains searchable after full current confirmation. Output
reference fences come from the checker, not the hint.
Collection discovery labels likewise come from the current authorized
collection, never a directory hint.

Portal and bot-answer audiences are independent. The host supplies the
effective customer's authority; a broad service context cannot widen it.
Drafts, evidence, private source references, review metadata, internal notes,
and storage metadata never enter retrieval DTOs. Unauthorized hints are not
exposed through titles, snippets, total counts, or diagnostic errors either.

## Application surface

The existing `createKnowledgeBaseApplication` composition accepts optional
`retrieval` settings: downward-only `limits`, a host `candidateAdapter`, and a
trusted local `tokenCounter`. The
[retrieval types](../packages/application/src/retrieval-types.ts) define these
ports and the following methods; there is no new package or HTTP endpoint.

| Method                                                               | Authority and result boundary                                                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `listPortalCollections`                                              | `articleRead` plus each current portal audience; safe collection ID/label only                                    |
| `searchPublishedArticles`                                            | `articleRead`, current portal audience, and exact requested applicability; confirmed publication metadata/snippet |
| `retrieveAnswerSources`                                              | Effective customer's `articleRead`, `botRead`, and current bot audience; whole approved source payloads           |
| `confirmAnswerSources`                                               | Same bot authority and exact current reference/applicability check before downstream use                          |
| `repairArticleIndex`, `repairRetrievalPage`, `getArticleIndexStatus` | `indexManage`; staff-only maintenance/status DTOs                                                                 |

Customer retrieval results have `outcome: "results" | "no_result"` and no candidate totals.
Search snippets are the confirmed approved summary, never posting text or
truncated procedure steps.
Applicability is an exact tuple, including absent build/locale; absence does
not request a fallback or wildcard. Existing `getPublishedArticle` remains a
portal keyed read and retains its original input contract.
Invalid query/scope/limit input throws `TypeError`. Access failures,
stale/unavailable authority, malformed adapter accounting, exhausted read
budgets, and missing/invalid token counters produce the content-free
`no_result` shape rather than exposing private candidate diagnostics.

The optional `KnowledgeCandidateAdapter` returns source-free hints and bounded
`CandidateWork`. The host adapter must truthfully report keyed reads,
physical rows, posting entries, and pages, including empty pages, misses,
duplicates, malformed, and filtered rows. The application validates and counts
reported work before consuming hints; it cannot meter an external provider's
unreported internal work. An adapter's ranking, hint, or count grants no
authority. Hosts own adapter relevance evaluation and provider data controls.

## Fixed ceilings

These are component work/admission ceilings, not measured production capacity
or retrieval-quality certification. Hosts may configure lower values only.
Each independent bound still applies when another bound has remaining space.

| Scope                 | Ceiling                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Directory             | 64 collections per instance                                                                                                         |
| Catalog               | 256 articles per collection                                                                                                         |
| Terms                 | 256 indexed terms per article                                                                                                       |
| Posting               | 16 entries per page; 16 pages per term                                                                                              |
| Projection partition  | 8,192 physical rows and 16 MiB encoded-record estimate                                                                              |
| Query                 | 256 UTF-16 code units and 8 distinct normalized terms                                                                               |
| Bot query scope       | 4 collections                                                                                                                       |
| Request index work    | 128 keyed index reads and 2,048 posting entries                                                                                     |
| Request article work  | 64 head probes and 8 full authoritative confirmations                                                                               |
| Returned sources      | 5 whole articles and 64 KiB of content                                                                                              |
| Model source budget   | 8,192 tokens in the complete serialized source set                                                                                  |
| Request physical work | 768 total physical keyed reads                                                                                                      |
| Maintenance scan      | Configured row ceiling 100; actual page also bounded by requested limit and shared batch ceiling                                    |
| Maintenance batches   | Legacy advancement allowance 32; optional transaction-attempt budget at most 32 per resource; default physical scan at most 32 rows |

Count physical work before filtering and deduplication. A query cannot bypass
work limits by retrieving many unauthorized, duplicate, or stale entries.
Request handlers never scan the corpus to fill a result count. Bounded
no-result and admission outcomes must remain explicit. Invalid input is not
silently truncated into a different query.

The host's trusted local token counter measures the complete serialization
that will be supplied as sources, including citation labels and metadata.
It must not send text to a model or external token service merely to count it.
`retrieveAnswerSources` selects the largest top-ranked prefix of whole sources
that fits aggregate byte/token bounds; it never truncates a procedure into
partial steps. A nonempty source set requires a positive safe-integer local
token count. A `no_result` has empty sources and zero source tokens.
Later support-answer code must
still account for its complete prompt and output budgets separately.
`AnswerSourcesResult` returns `serializedSources` and `sourceTokens` for that
trusted bot integration. A missing token counter cannot produce an uncounted
bot payload. Portal search DTOs do not contain this model source envelope.
Serialization is canonical JSON of every returned source DTO field, including
its exact reference and citation; counting only body text is insufficient.

## Citations and use

Customer-readable portal sources can carry a safe article browse reference.
Bot-only sources carry an approved source label without a staff URL or a
browse capability. A bot source receives a browse reference only when the
same effective customer can independently read that portal article. Hosts
resolve safe browse references into their own routes; private source-system
URLs never become citations.

Return exact article/revision references for downstream answer validation.
`AnswerSourceReference` also binds collection policy, content hash, and current
application/governance/validation generations. It is an observation fence,
not a lease or authorization capability. `confirmAnswerSources` checks those
references under fresh effective-customer access before they are used again.
Reconfirmation is exact and all-or-nothing: it does not fit a smaller prefix
or return the still-valid subset when any requested source fails.
Retrieval authorization is not a capability to publish a later answer after
inputs change. Support Desk must recheck current source authority and its own
ticket/turn fence before committing a reply. Cache and adapter keys must
include instance, collection, use/audience-policy binding, and exact revision;
a cache hit cannot replace current authoritative confirmation.

## Maintenance, retirement, and repair

Only maintenance scans physical pages of the authoritative record collection.
It counts every scanned row before filtering, uses the backend's opaque
continuation cursor, and treats article/collection heads and their causal jobs
as hints. Candidate deduplication uses resource kind and ID. The worker rereads
the current authoritative resource; job payloads and historical generations
are not content sources. Current collection hints register only a directory
ID, allowing authorized discovery of empty collections. The reader still
confirms collection labels and portal access.

`repairRetrievalPage` scans at most the minimum of its requested limit,
`maxRepairScanRows`, and `maxMaintenanceBatches`. Defaults therefore scan at
most 32 physical rows, even though the configurable scan ceiling is 100.
When `maxBatches` is omitted, each unique resource gets at most one collection
registration or article advancement batch on that page;
`repairArticleIndex` can use the full instance advancement allowance for its one
article, default 32. These legacy allowances include internal prerequisite work
and bounded conflict retries; they are not a count of physical Store transactions.
A completed scan page or cycle is not proof all pending projections
are finished. Hosts persist the actual backend `nextCursor` and repeat full
cycles to revisit pending heads/jobs without starving later resources. Repair
does not mutate or acknowledge authoritative causal jobs; they remain
replay-safe hints.

Both repair methods accept optional `maxBatches`, a positive integer no greater
than the instance's `maxMaintenanceBatches`. Explicit presence selects a shared
physical Store transaction-attempt budget: `repairArticleIndex` shares it across
that article's projection setup, directory/catalog registration, posting rewrites,
completion and blocked-state writes. A failed CAS consumes an attempt too;
nested retries cannot reset the budget. Already-current prerequisites consume
no attempt, so repeated one-attempt calls can reach later phases rather than
repeating the first completed write. `repairRetrievalPage` gives each unique
resource its own budget, including collection-directory work. The page's
physical scan limit remains independent; `maxBatches: 1` does not mean one
transaction across a multi-resource page.

A host can call `repairArticleIndex(access, { articleId, maxBatches: 1 })` in a
dedicated worker invocation. For one-resource scan recovery, use
`repairRetrievalPage(access, { limit: 1, maxBatches: 1, cursor })`, omitting
`cursor` at a cycle's start. Publication and withdrawal commands already persist
their causal `article_changed` jobs atomically with the article change, Audit
and replay receipt. Hosts may schedule derived work separately from the mutation
response; a second enqueue is not required to establish that durable recovery
source. Jobs remain hints: every repair plans from current authoritative facts.

Per-article manifests and pending scopes retain committed progress. After a
lost write acknowledgement, the next invocation re-reads actual state and
resumes the same plan without resetting completed terms or generation floors.
Budget exhaustion or a bounded CAS conflict returns conservative `pending` with
`indexed: false`. Storage or current-source confirmation can still throw after
a partial derived write. Keep the work pending and retry the original scan
cursor on an exception. After a successful bounded page, save its actual
`nextCursor` even if an article remains pending, then revisit it on later full
cycles; pinning the global cursor to one unfinished article can starve others.
Capacity holds remain visible and need available capacity or changed inputs
before convergence.

The attempt budget bounds derived transaction attempts, not all keyed reads,
backend statements, schema initialization, host checkpoint/OCC work, external
source-verifier I/O, CPU or elapsed time. A Store adapter may issue several
queries per operation. Hosts must measure the entire invocation on their actual
composition; neither page size one nor a transaction budget of one certifies a
Workers Free quota or a latency/capacity SLA. No retained proof or revocation
history is discarded. Prepared keyed-read waves preserve every required approved
proof and its current revocation marker, and final current
article/collection/validation-head and source
confirmation; they introduce no authorization cache or provider-specific SQL.

Derived writes and cleanup must be generation-fenced and idempotent so a
delayed job cannot restore obsolete content. Persist bounded per-article
pending/blocked progress and capacity reasons. Do not mark an article indexed
until its desired targets are committed and obsolete scopes are cleaned.
Repeated bounded scan cycles and checkpoints repair missed or failed work.
The host owns scheduling, retry cadence, visibility, and operator recovery;
Spine's in-process event bus is not a durable delivery mechanism.

Retirement, moves, policy revocation, proof revocation, and changed source
eligibility may leave temporary stale hints. Current publication checks must
reject those hints while repair catches up. There is no cross-partition
transaction or claim that projection repair completes before revocation takes
effect. Capacity failure leaves visible repair work rather than accepting a
partial index as complete.

Cleanup reclaims obsolete postings while retaining bounded generation floors
and historical scope identities. Directory/catalog/scope lifetime admission
and epoch limits remain finite, as declared in [COLLECTIONS.md](COLLECTIONS.md).
Do not delete those floors to make space or imply an unimplemented compaction
protocol.

`ArticleIndexStatusDto` reports `status` as `pending`, `ready`, or `blocked`,
an `indexed` boolean, nullable article/projection generations, and an optional
coarse reason (`capacity`, `source-unavailable`, or `conflict`). A converged
withdrawal is `ready` with `indexed: false`; ready does not necessarily mean
there is a usable indexed publication. Terms, postings, hashes, and private
sources are absent. Repair-page diagnostic counts and `nextCursor` are
staff-only and never become customer search totals.
Only a current call returning `ready` establishes completion of that repair
plan. A host's ready-key hint may be acknowledged only against its unchanged
version after that result; `pending`, `blocked`, exceptions and an older ready
observation are not completion acknowledgements. This does not turn the result
into publication or customer-read authority.
Staff maintenance is not a customer no-result path: unexpected configuration,
adapter, or storage errors remain visible exceptions. Supported admission and
source-hold conditions retain their named status/withdrawal behavior.

## Evaluation and acceptance

Use representative fictional product questions and paraphrases, including
known no-result cases. Verify deterministic ordering and supported citations,
then measure retrieval coverage and latency on the activated configuration.
Host owners sign off measured quality/latency budgets; this component does not
invent a percentage target or certify real product knowledge from fixtures.

Public-entry tests must cover separate portal/bot audiences, bot-only labels,
draft exclusion, stale index/cache and policy/proof/source revocation,
applicability mismatches, safe titles/snippets/counts/errors, whole-source
budgets, and instrumented physical read/page ceilings. Maintenance tests cover
duplicate/out-of-order jobs, partial failure, bounded resumable scans,
capacity admission, retirement/move cleanup, and repair convergence. These
public-entry suites run against memory, real Azurite, and real local Miniflare
D1 in the earlier merged [partial KB-05 source slice](SOURCE_PREPARATION.md).
Released-consumer
verification and real host workflows retain their release/activation gates.

The executable source cases live in [retrieval tests](../tests/retrieval.test.ts)
and [physical-bound tests](../tests/retrieval-bounds.test.ts), using
[fictional retrieval fixtures](../test/retrieval-fixtures.ts). A current-head
gate report is the evidence of a passing run; these links do not certify a
host's real product content or deployment.
