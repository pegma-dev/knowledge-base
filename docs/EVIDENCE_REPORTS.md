# Human-reviewed evidence reports

The current verified Knowledge Base release is
[`0.1.6`](BOOTSTRAP.md#current-verified-016-release).
The `0.1.7` source candidate remains unpublished.

`createKnowledgeEvidenceReports` shipped in the four synchronized, verified
[`0.1.3` packages](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.3).
The optional governed context pair and body-free `query` described below shipped
in the qualified [`0.1.4` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.4).
Synchronized `0.1.5` has completed verified trusted publication for answering
read batching; see the [retained release receipt](BOOTSTRAP.md#current-verified-015-release).
Changed source still requires its own review and current-head gates. Source
tests and local adapter fixtures do not establish host activation, actual
client acceptance, or a real staging test.

The factory stores bounded test reports for authorized human review and supplies
an `EvidenceVerifier` to the existing KB application. It adds no login, roles,
credential issuer, HTTP routes, MCP tools, scheduler, or test runner. It never
fetches report/artifact URLs, executes submitted steps, or creates a private
provenance/source-verification bridge.

## Compose the trusted host ports

The [public types](../packages/application/src/evidence-reports-types.ts) and
[implementation](../packages/application/src/evidence-reports.ts) define the
current source contract:

| Factory option                       | Host responsibility                                                                                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`, `clock`                     | Supply the real Storage Core Store and trusted clock.                                                                                                                                                    |
| `collectionName`                     | Choose an explicit, exclusive report namespace, separate from KB article/retrieval collections. Preserve it for retained reports and receipts.                                                           |
| `storageLayout`                      | Choose the physical-key layout deliberately; the default is `portable-v1`.                                                                                                                               |
| `confirmationPermission`             | Supply a human-only permission distinct from all three initial agent scopes. The factory creates no assignment or role.                                                                                  |
| `resolvePrincipal`                   | Resolve the same principal's current authority on every call and verification; return null for known absence and let dependency failures remain unavailable.                                             |
| `readContext`                        | Read the current authorized `draft`, narrow `requirements`, and optional accepted `evidence` through the public KB application.                                                                          |
| `authoringContext` (`0.1.4` release) | Optionally forward both public `getAuthoringContext` and `confirmAuthoringContext` methods for an operation-local governed read/recheck. The legacy `readContext` option remains required and supported. |
| `logger`                             | Optionally receive coarse verifier-unavailable categories, without report bodies or raw dependency errors.                                                                                               |

Authenticate before calling the service. Pass the effective credential's scoped
`AccessContext`, including for replay. Current principal resolution confirms
that its retained named permissions remain valid; it never replaces a restricted agent context
with the owner's broader Admin context. Preserve that same effective context
inside `readContext` and use actual `getDraft`, `getValidationRequirements`, and,
only when authorized, `getEvidence` reads. The optional pair uses the
same restricted context through the new governed read instead. A report-supplied article, permission
array, runner name, or `passed` value does not supply authority.

The initial delegated scopes remain only `knowledgePermissions.draftRead`,
`draftWrite`, and `evidenceSubmit`. Report submission/status can be exposed by
an authenticated host boundary using existing evidence-submit authority; this
factory registers no additional scope or transport operation. Keep human
confirmation, private report reads, review and publication outside agent grants.

The optional agent dispatcher's `reports` port can expose `report`, `ledger`
and owner-only `status` through modes of its existing requirements/evidence
tools, letting native clients submit and poll through the same MCP connection.
The [agent wire contract](AGENT_API.md#optional-native-client-report-mode) defines
those shapes; omitted-port legacy schemas stay unchanged. Keep initial request
authentication and bind all work to the same original request, credential,
principal, grant, client and resource. For pure report-port reads, hosts may
revalidate before and after each awaited call or use the
[request-local read-group boundary](AGENT_API.md#optional-native-client-report-mode):
refresh full credential authority before the first read and after the completed
actual dispatcher invocation, enforcing every required scope/permission clause
before disclosure. The final MCP check belongs inside its awaited tool callback.
Every write retains fresh before/after guards. Never reuse a read group across
invocations or replace the restricted effective context with owner/Admin authority.
The ledger's current-principal resolver is not a host credential/grant verifier.

## Optional governed context and query (`0.1.4` release)

The application's
`getAuthoringContext(access, { articleId, includeEvidence?: boolean })` returns
`{ context, observation }`. It requires `draftRead` and either `draftWrite` or
`evidenceSubmit`, deriving the collection/kind from the current article. The
context contains the existing draft and narrow requirements DTOs. Explicit
`includeEvidence: true` additionally requires `evidenceRead` and includes the
complete current evidence and retained revocation DTO at that same generation.
Otherwise evidence is omitted, never substituted with empty history. Trusted
attester lists, full configuration, provenance and publication proofs remain out
of this projection.

Forward the paired methods through `authoringContext`, using deferred closures
when the application receives this factory's verifier. Keep `readContext` for
legacy compatibility. The factory requests no private evidence for pending
agent admission/query and complete evidence for human qualification. With no
pair it retains the legacy full-context observation path.

Keep the opaque observation only in the current operation and owning application
instance. `confirmAuthoringContext(access, observation)` requires the same actor
and projection permissions and checks exact article, collection and validation
head versions. It consumes the handle before storage, so a failed storage probe
needs a fresh observation. Copying, serializing or recreating the object does not
make a valid handle. It belongs in no database, wire response, command fingerprint,
report hash or retained receipt. It grants no permission, human confirmation,
evidence qualification or publication authority.

Optimized report decisions retain fresh same-principal staff checks at entry,
after the metadata probe/preparation immediately before the write, and after
commit before releasing an ACK. Only the extra probe-adjacent resolution is
omitted; no content or side effect escapes before the fresh prewrite check.
Revoked authority can withhold an ACK after commit. Retry the exact command under
refreshed authority rather than assuming rollback or issuing a new command ID.

`query(access, { articleId, status?: { ledgerEpoch, reportId } })` requires current
`draftRead` plus `evidenceSubmit`. It returns
`{ target, requirements, ledger, status? }`, where target contains only
`articleId`, application `generation`, `collectionId` and `kind`. Status contains
only the existing acknowledgement plus pending/confirmed/rejected state and is
available only to the submitting principal. It is not a report download or staff
listing. A lookup from another epoch, resetting ledger, changed report or changed
observed context refuses rather than presenting a synthesized current receipt.

The query observes ledger/report state, confirms the governed context and reads
selected owner status again after the other awaited fences. These separate
collections still provide no atomic snapshot or receipt consumption. Its target
metadata is for the trusted dispatcher to match the requested collection/kind;
the existing wire projection excludes it, the full draft and all private fields.

The dispatcher's report port may optionally include `query`. It uses
that aggregate once for the article-specific requirements mode, retaining the
old `report`/`ledger`/`status` trio fallback and exactly the same five tools,
three scopes and wire DTOs. The host must preserve its reviewed current-credential
and same-principal disclosure fences; one SDK port call is not one database call
and does not replace Agent Access authentication.

Prepared keyed-read waves can use optional provider batching without a new Store
API, SQL or collection layout. All admitted evidence/revocation history remains
intact. This source change establishes no universal Workers Free 50-query, CPU
or wall-clock guarantee. Complete host invocations, real authorities, supported
histories, retries and cold composition require their own measured acceptance.

## Submit, review, then qualify evidence

`report(access, input)` accepts `SubmitKnowledgeReportInput`: `commandId`,
`articleId`, current `ledgerEpoch`, a whole `EvidenceSubmission`, and a
`KnowledgeTestReport` containing `summary` and `details`. Preserve the complete
submission: article revision/content hash, validation policy, check/test kind,
applicability/build, steps, result, original execution time, runner, and artifact
IDs/hashes. The authenticated context supplies the submitting principal.

The optional `expectedArticleGeneration` is a nonnegative safe integer. When
supplied, it is part of the exact command fingerprint and must match the current
draft generation for **new** admission. An exact accepted replay is looked up
before that admission check, so retry the original value even after another
article mutation. Changing, adding or removing the bound field on the same
command conflicts. Omitting it preserves the existing legacy fingerprints;
the service does not invent a default generation. The agent dispatcher passes
its wire `expectedGeneration` through this field.

After an exact replay lookup misses, new report admission rejects evidence text
fields and steps that Core rejects for surrounding whitespace, a supplied locale outside Core's
language-tag syntax or longer than 64 characters, and duplicate artifact IDs.
These are rejection checks: no evidence, opaque ID or receipt is normalized.
The report boundary also retains its existing C1-control rejection, which is
intentionally stricter than Core's legacy syntax. The legacy MCP schemas are
unchanged.

| Method                    | Purpose and authority                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ledger`                  | Body-free current epoch/capacity state; requires current `evidenceSubmit`.                                        |
| `query` (`0.1.4` release) | Governed body-free requirements/ledger/optional owner status; requires current `draftRead` plus `evidenceSubmit`. |
| `report`                  | Save a pending report and return a bounded acknowledgement/opaque receipt; requires current `evidenceSubmit`.     |
| `status`                  | Return acknowledgement plus status only to the original submitting principal under current `evidenceSubmit`.      |
| `list`, `read`            | Staff summaries or the complete private `KnowledgeReportView`.                                                    |
| `decide`                  | Explicitly confirm, reject, or reassess a report using its exact reviewed binding.                                |
| `reset`, `drain`          | Authorized bounded ledger retention/recovery.                                                                     |

Every staff method requires the configured `confirmationPermission` plus
`draftRead`, `evidenceRead`, and either `evidenceSubmit` or `draftWrite`, under
current same-principal authority. The recommended minimum human reviewer has
exactly the confirmation permission, `draftRead`, `evidenceRead` and
`evidenceSubmit`: neither an Admin role nor `draftWrite` is required. The
either/or requirement supplies the public `getValidationRequirements` read
prerequisite. Choose `evidenceSubmit` to review without draft-editing authority.
The full view includes the report/submission, hashes, exact current draft/requirements,
`reviewBindingHash`, `expectedReportGeneration`, and any confirmation. Its `receipt`
is the canonical acknowledgement receipt for that same report snapshot, including
pending and rejected reports; reassessment rotates its cycle and reset fences its
epoch. The field does not change verifier or owner-only status authority. Keep
these private; the agent's body-free `status` is not a staff listing or report
download. Render untrusted report text safely and do not fetch submitted links.

Call `decide` with `DecideKnowledgeReportInput`: `commandId`, `articleId`,
`ledgerEpoch`, `reportId`, `expectedReportGeneration`, and the exact
`reviewBindingHash` returned by `read`. Use `"confirmed"` or `"rejected"` for
a pending report. Changed report or KB context requires a fresh read/review.
A host-authorized Admin may human-confirm their own agent's report; the factory
enforces no reviewer-different-from-submitter or two-person rule. A restricted
agent with that same principal ID still lacks the human permission.

Confirmation records human review. The agent then supplies its current opaque
receipt and exact submission to the existing KB `submitEvidence` command.
The verifier rechecks the submitting identity, receipt cycle, whole submission,
current exact revision/context and reviewer authority, including current
trusted-attester membership. Actual KB qualification still enforces runner,
result, staging build, governance, applicability, policy and freshness.
A confirmed receipt can therefore be refused. Every required check must qualify
before the separate exact SDK review/publication workflow can proceed.

The stored decoder, scalar rules and fingerprints are unchanged. Evidence
previously admitted but failing the added syntax checks can still recover an
exact retained command's historical acknowledgement. That replay does not
qualify the evidence: confirmation, reassessment and the verifier refuse its
malformed syntax, even if the retained report was already confirmed. Such a
confirmed report uses the existing authorized ledger reset/drain recovery;
there is no new repair or reactivation transition.

To reassess a confirmed or rejected report, freshly `read` it and call `decide`
with `"pending"`. This clears confirmation, advances report generation and
rotates the receipt cycle. The original execution must still match the current
revision and be fresh; reassessment neither refreshes its timestamp nor turns
it into a test of an edited revision. The owner retrieves the new receipt with
`status`, then obtains a new explicit human decision before submission.

## Choose physical keys before writing

`portable-v1`, the default, uses `a-` partition and `r-` row-key prefixes followed
by fixed-width hexadecimal UTF-16 code units. It preserves opaque logical IDs
while keeping physical keys backend-safe and bounded. The logical envelope,
payload bindings and opaque receipt semantics are separate from that encoding.
The portable codec stores that logical JSON in a strict versioned envelope
with at most six flat string parts, each bounded to 12,000 UTF-16 code units.
It preserves surrogate pairs and enforces the original 60,000-byte UTF-8 bound
after joining. This keeps permitted reports within Azure's native per-property
limit without changing their logical payload, hashes or receipts.

`legacy-raw-v1` must be selected explicitly for a compatible existing raw-key
**epoch ledger**, such as PG's retained R1 D1 report ledger. With its exact
existing `collectionName`, it preserves physical article partition/row keys,
logical JSON, hashes and receipt layout. It does not migrate the earlier
pre-epoch PG ledger's unversioned rows. It does not make raw keys portable to
Azure Tables; unsupported raw identities fail rather than being escaped or
retried under another layout.

There is no detection, fallback, copying or migration. A portable read against
a raw populated namespace can look empty because the physical keys differ.
Never switch layouts on a populated namespace or use a changed collection name
as an implicit upgrade. Any data/adapter transition needs a separate deliberate
migration and proof; compatibility fixtures are not evidence of a live migration.

In either layout, an absent head permits initialization only when the selected
physical article partition is empty. Existing readable rows without a head
produce unavailable stage `head_partition_orphaned` before any write; malformed
or oversized partitions can instead fail earlier integrity checks. Pre-epoch
rows are refused rather than silently assigned a new epoch. The guard checks
the selected physical partition, not an alternate layout's keys.

Before activation, quiesce old writers and inspect the actual namespace and
layout. Any pre-epoch data requires a separate verified migration before this
factory can use it. Do not automatically copy or delete rows, synthesize a head,
or retry under another layout to bypass the refusal.

## Capacity, retention and replay

Each article ledger's admitted state is bounded to 16 reports, 160 physical rows
including its head/Audit/command records, and 60,000 UTF-8 bytes per record's JSON
payload. Report and decision writes commit their head/report changes, Audit and
command receipt in one report partition. Admission refuses further work at
capacity; it does not silently evict retained reports or accepted proof.

These admission limits do not bound physical reads against uncontrolled legacy
or corrupt data. Storage Core `0.4` has no bounded partition probe: the
missing-head guard uses a full `list(partition)` before initialization. An
existing head skips that extra probe, but staff listing and reset/drain integrity
reads also read the full partition before checking its size and contents. There
is no constant physical-work or wall-clock guarantee for these reads.

Execution-age limits govern new human confirmation, reassessment and evidence
qualification. There is no automatic report TTL eviction. Hosts own authorized
retention/export procedures and decide when to reset the ledger.

`reset` takes `ResetKnowledgeReportsInput` with `commandId`, `articleId`, and
`expectedLedgerEpoch`. It advances the epoch and enters `resetting`, immediately
fencing old report receipts and commands. `drain` takes `articleId` and the new
`ledgerEpoch`, deleting at most 48 old ledger rows per call. At most four calls
cover an admitted finite old ledger; this deletion bound does not limit each
call's full-partition integrity read. Resume after interruption until it is
`active`. New report work remains held while resetting. `rowsRemaining` means
admission capacity while active and rows left to delete while resetting.

Exact accepted report/decision retries under current authority return historical
acknowledgements within the active epoch, without repeating transitions. An
exact report retry can recover its lost acknowledgement at a stable newer
article generation; the original bound generation is not updated on retry.
Current principal authority and epoch fences still apply. Transport target
reads and observed draft fences can withhold the response again if the article
changes during recovery. Poll owner-only `status` after recovery: an old
acknowledgement does not prove that its receipt cycle or review status is still
current after reassessment. Reset ends that epoch's replay horizon. The head retains a bounded
history seal and only the latest reset intent: its exact retry returns current
metadata without another reset; after a subsequent reset, the older intent
conflicts. It is not an indefinite archive of drained reports or Audit receipts.

Reset/reassessment does not revoke evidence already accepted by KB or withdraw
an approved publication. Retained publication uses its reviewed proof snapshot;
a later draft or elapsed original execution TTL alone does not expire it.
Current SDK policy/source authority, proof availability, explicit evidence
revocation and retirement still apply.

The report ledger and KB article commit are separate transactions. Reset fences
subsequent verification; it cannot cancel an article commit already independently
verified before reset. Do not describe a receipt as atomically consumed across
both collections, or promise globally atomic revocation.

## Fictional source example and failures

The [synthetic fixture](../test/evidence-reports-fixtures.ts) uses
`workshop.knowledge-reports.v1`, human permission
`workshop.knowledge.report.confirm`, and a fictional export walkthrough. Its
`baseOptions` has the public `KnowledgeEvidenceReportsOptions` type; this
composition excerpt is taken from that fixture:

```ts
const reports: KnowledgeEvidenceReports =
  createKnowledgeEvidenceReports(baseOptions);
const app: KnowledgeBaseApplication = createKnowledgeBaseApplication({
  store: observed.store,
  clock,
  evidenceVerifier: reports.verifier,
});
```

The fixture's current-principal map and report data are synthetic trust inputs,
not a login or staging verifier to copy into a host. Its
[public-API cases](../tests/evidence-reports.test.ts) exercise report/review,
actual evidence submission/publication, same-human confirmation, layout choice,
retention and failure boundaries. Current-head gates establish execution.

Hosts map `KnowledgeEvidenceReportsError.code` to their refusal/conflict/input
responses. `KnowledgeEvidenceReportsUnavailableError` has safe code
`report_ledger_unavailable` and a coarse stage for dependency or stored-integrity
failure; do not return stored bodies or raw exceptions. The `verifier` fails
closed with null on unavailable or invalid proof. Retry uncertain accepted
commands using the same command ID and exact input under refreshed authority.
These APIs establish no host credential, production deployment, or client proof.
