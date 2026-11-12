# Agent authoring and test-evidence workflow

The current verified Knowledge Base release is
[`0.1.7`](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.7).
The `0.1.8` source candidate remains unpublished.

The [merged KB-04 source](https://github.com/pegma-dev/knowledge-base/pull/5)
adds optional authoring transports over the existing Knowledge Base
application. [KB-05 release-preparation source](https://github.com/pegma-dev/knowledge-base/pull/6)
is also merged. All four KB `0.1.0` packages completed manual bootstrap and
exact-byte postflight without OIDC provenance. All four `0.1.1` packages have
since completed verified trusted publication. Optional human-report mode shipped
in [`0.1.3`](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.3).
Governed context reads and an optional aggregate report query shipped in
[`0.1.4`](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.4).
All four synchronized `0.1.5` packages have completed verified trusted
publication for answering read batching; see the
[retained receipt](BOOTSTRAP.md#current-verified-015-release). Changed source
requires its own review and current-head gates. This document
describes the composition and retained acceptance contract, not a live service
or a client-compatibility claim. The exact wire contract is in
[AGENT_API.md](AGENT_API.md).

## Link through the host

The host composes [Agent Access](https://github.com/pegma-dev/agent-access) with
its existing human login. A current Admin approves the registered client,
exact protected resource, and requested scopes. Device linking follows RFC
8628 with its human user code, polling interval, and `slow_down` handling.
Authorization-code linking requires S256 PKCE. The agent receives an opaque
machine credential rather than a browser cookie, password, or Admin role.
Only the host's current Admin browser authority can approve or manage grants.

Before each request or replay, the host validates credential issuer,
resource/audience, client, expiry, revocation, current principal status, and
current permission authority. It supplies a trusted identity separately from
the untrusted input body. Missing or unavailable authority fails closed. The
transport uses that host authentication port and the same application services;
KB owns no credential issuer, login, roles, or limiter.

Bind this bearer verifier to the KB resource routes. Do not add these credentials
to a generic account, staff, or browser-session authenticator; those endpoints
must reject agent credentials regardless of the approving administrator's ID.

Initial consent covers authoring across the app instance. Existing collection
and resource checks still apply. Per-collection delegated grants remain a
future application/resource-authority seam and are not offered by this source.
A future capability needs
an explicitly registered scope, host policy, and fresh consent; changing a tool
list cannot silently widen a saved grant.

## Use the five initial operations

The three scope strings are the existing `knowledgePermissions` values:

| Member           | Exact scope                         |
| ---------------- | ----------------------------------- |
| `draftRead`      | `knowledge.article.draft.read`      |
| `draftWrite`     | `knowledge.article.draft.write`     |
| `evidenceSubmit` | `knowledge.article.evidence.submit` |

The dispatcher intersects those known scopes with current authority and removes
roles, entitlements, and other permissions. HTTP and MCP expose the same five
operations, inputs, bounded DTOs, and application outcomes:

| Operation                   | MCP tool                                   | Required effective permission    |
| --------------------------- | ------------------------------------------ | -------------------------------- |
| `getDraft`                  | `knowledge_v1_get_draft`                   | `draftRead`                      |
| `createDraft`               | `knowledge_v1_create_draft`                | `draftWrite`                     |
| `updateDraft`               | `knowledge_v1_update_draft`                | `draftWrite`                     |
| `getValidationRequirements` | `knowledge_v1_get_validation_requirements` | `draftWrite` or `evidenceSubmit` |
| `submitEvidence`            | `knowledge_v1_submit_evidence`             | `evidenceSubmit`                 |

`draftRead` or `validationManage` alone cannot read author validation
requirements. There is no collection reading/listing, evidence reading, private
provenance, review submission/reading, publication/retirement, administration,
or grant-management tool. Agents cannot act as staff or Admin through this
surface. Hosts use their separately authorized staff services for review and
publication.

Both transports reject `sourceReferences` on draft create/update. Atomic
draft/source authoring remains a privileged direct host application operation;
the five tools and three consent scopes remain unchanged.

## Prepare, test, and submit

1. Obtain the target collection and article identity through the host's
   authorized workflow. Read an existing draft when permitted, or create a new
   one with `expectedGeneration: 0`. Mutations supply a stable `commandId` and
   `correlationId`; updates use the exact current application generation.
2. Read validation requirements for the collection and article kind. The result
   identifies current checks, policy reference, governance generation, and
   expected staging build. It does not disclose private attester registries or
   give policy-management authority.
3. Run the applicable checks against authorized staging for the exact draft
   revision/content hash and product/build. Protect test artifacts through the
   host's evidence channel. The KB transport executes no steps and fetches no
   submitted artifact URL.
4. Submit evidence and the host's opaque receipt using the current generation,
   or use the configured human-report flow below to obtain confirmation first.
   The host attester must verify the authenticated actor and runner, exact
   revision/content hash, check, staging build, result, and receipt before
   returning trusted verification facts. An authenticated agent's own `passed`
   string, runner ID, timestamps, or artifact hashes do not prove execution.
5. Read the draft again as needed. Evidence submission changes application
   generation even when content revision stays unchanged. Editing content
   changes the revision and invalidates older evidence/review authority. Staff
   review and publication separately bind the exact current revision, audience,
   policy, applicability, and verified evidence.

## Submit a report and poll through the same MCP connection

When the host composes the optional `reports` port, native clients use the same
five tools and three consent scopes. The requirements and evidence tools
advertise their additional input variants; there is no report-management or
staff tool. Without that port, their legacy schemas and behavior remain exact.
The [wire contract](AGENT_API.md#optional-native-client-report-mode) defines
the public DTOs. Both variants need effective `draftRead` and `evidenceSubmit`.

The verified `0.1.4` release can compose optional `reports.query` behind that
same requirements tool. It consolidates the current target/requirements,
ledger and optional owner-status observations without changing the client
request, result schema, five tools or three scopes. The original three report
methods remain a compatible fallback; omitting reports retains legacy mode.
Query target metadata, private report data and opaque context observations are
never added to the wire. A failed configured query refuses rather than silently
switching read paths. Clients do not request or authorize this optimization.

1. Read the exact draft and call `getValidationRequirements` with its
   `collectionId`, `kind` and `articleId`. Keep the returned
   `reportLedger.ledgerEpoch`; a resetting ledger needs authorized staff
   recovery before new report work.
2. Run the actual required checks against authorized staging. Call the existing
   `submitEvidence` tool with the whole exact evidence submission, original
   command/correlation fields, current `expectedGeneration`, `ledgerEpoch`,
   and `report: { summary, details }`, omitting `receipt`. Preserve the returned
   `{ kind: "pending-human-review", ledgerEpoch, reportId, receipt,
reportGeneration }` and exact command input. This acknowledges a private
   report, not verified evidence or an article mutation.
3. A currently authorized human reviews the full report, exact revision/build,
   hashes, execution and current requirements through the host's staff surface.
   Staff may explicitly review their own agent's report; there is no two-person
   rule. The agent's same-principal bearer still cannot perform that decision.
4. Poll `getValidationRequirements` with `articleId` and
   `reportLookup: { ledgerEpoch, reportId }`. `reportStatus` contains only the
   owner's opaque receipt/generation/status. Pending means wait; rejected or
   changed/expired context requires a fresh authorized workflow. Polling never
   exposes private report bodies, reviewers, accepted evidence or registries.
   Observed report receipt/generation/status drift conflicts; retry the poll
   for a fresh point-in-time view, not an atomic cross-system snapshot.
5. After confirmation, read the current draft generation and use the original
   receipt-bearing `submitEvidence` input with the same exact evidence and
   report receipt. First confirmation preserves that receipt. Explicit staff
   reassessment rotates its cycle, so obtain the current receipt and a new
   confirmation if reassessment occurred. Actual KB qualification can still
   refuse runner, result, staging/build, governance, applicability, revision or
   freshness mismatches. Complete every required check, then let staff perform
   separate exact review/publication.

The host must bind optional report/query calls to the original authenticated
request, credential, principal, grant, client and resource. Keep initial request
authentication. Pure reads may use a request-local full-credential check before
the first read and another after the complete actual dispatcher invocation,
checking every required scope/permission clause before disclosing its result.
That final check belongs inside the awaited MCP tool callback; guarding only an
outer Response is insufficient. Per-port read checks remain valid, and writes
retain fresh before/after guards. Never cache a read group across invocations.
Current owner/Admin authority never substitutes for the restricted delegated
context. An opaque application context observation only rechecks the producing
instance's exact read; it supplies no credential, human review or proof authority.
Report/KB transactions remain
separate; a final conflict or lost response can follow a queued report without
rolling it back. See [report retention and replay](EVIDENCE_REPORTS.md#capacity-retention-and-replay)
for epoch reset, receipt cycles and bounded recovery.

If a report acknowledgement is lost, retry that exact report command under
fresh authority with its **original** `expectedGeneration`, even if the article
has since advanced. The dispatcher forwards this generation as the shared
report service's optional `expectedArticleGeneration`; exact replay precedes
new-admission checks. At a stable newer generation the accepted command returns
its historical acknowledgement without another report write. Changing the
expected generation on that same command conflicts, and a new command with a
stale generation is refused. The observed draft fence can still withhold a
response if the article changes during recovery. After recovering the report
key, poll its status: the acknowledgement does not establish the current human
decision, receipt cycle or eligibility for actual KB evidence acceptance.

For an uncertain mutation result, authenticate again and retry the same
`commandId` and exact semantic input, including the original
`expectedGeneration`. An accepted replay returns its historical bounded
acknowledgement without duplicate history, Audit, or jobs. Changed input
conflicts; revoked authority remains denied. The acknowledgement is not a
claim that the historical state is still current.

## Source proof and retained host acceptance

[AUTH-01 PR #1](https://github.com/pegma-dev/agent-access/pull/1) merged the public
credential producer source. The active KB `pnpm run agent:proof` gate now
installs exact public-registry `@pegma/agent-access@0.1.1` and all four packed
KB candidate artifacts in a fresh temporary consumer with lifecycle scripts
disabled and official MCP SDK `1.32.2`. It exercises OAuth and real SDK protocol calls through the
five-operation loop, host-attested evidence, HTTP/MCP parity, and rejection
cases. The fictional human session, staging run, and attester remain test
inputs. The historical reviewed-head gate results and exact CI links are
recorded in [source preparation](SOURCE_PREPARATION.md#historical-source-gates);
changed source requires fresh
current-head gates.
Historical source-proof evidence retains the original reviewed AUTH-01
`a444e2113db98455b638b2ef8aa7c2faccb16b62` fixture. The registry composition
accepts no source fallback and requires its own current-head gate results.

The merged KB-04 source exit closes only its source slice. KB-05 release-preparation
source is merged, and all four KB `0.1.3` packages have completed verified
publication. The earlier `0.1.2` release remains historical evidence.
Agent Access's
[release-preparation source](https://github.com/pegma-dev/agent-access/pull/2)
is also merged; its manual `0.1.0` bootstrap is complete and its verified
trusted `0.1.1` release closed the public producer prerequisite at
**2026-11-07T22:32:42Z**. The
[release ledger](BOOTSTRAP.md#verified-agent-access-prerequisite) records exact
identities, the successful attempt-2 workflow, and strict verification stdout.
KB `0.1.4` and the answering read-batching `0.1.5` release have since completed
verified trusted publication; see the [retained KB receipt](BOOTSTRAP.md#current-verified-015-release).
Changed source still requires its own gates. Both verified trusted dependencies precede production host
assembly. Branches, copied source, local paths, and unpublished production
tarballs cannot substitute for them.

The [approved source/publication split](https://github.com/pegma-dev/support-desk/pull/36)
retains actual acceptance in P-00 and PG-01/RG-01. The initial compatibility
targets all remain unproven until actual results are recorded on both hosts:

| Client      | Initial target mode                                               | Actual two-host proof |
| ----------- | ----------------------------------------------------------------- | --------------------- |
| Codex       | Actual supported client and host credential flow                  | Pending               |
| Claude Code | Actual supported client and host credential flow                  | Pending               |
| Grok Bot    | Desktop application with hosted agent; Grok Build CLI is excluded | Pending               |
| T3 Code     | Codex-provider mode; other providers remain unproven              | Pending               |

For every target client/mode on each host, record discovery, existing human
login/current-Admin consent, draft read/create/update, requirements, verified
evidence submission, configured report submission/own-status polling/human
confirmation where used, and matching HTTP/MCP outcomes using exact released
dependencies. Record unsupported or unavailable flows as open gaps.

Retain explicit expiry, wrong-audience, revocation, excess-scope, current
principal/permission-change, and wrong revision/build/runner or stale-evidence
rejections. Prove initial agent credentials cannot publish, submit/read
reviews, act as staff/Admin, manage collections or validation policy, read
collections/evidence/private provenance, or link/manage grants. Test the exact
requirements permission alternatives, including denial with only `draftRead`
or only `validationManage`.

PG-01 uses the real D1 host composition; RG-01 uses the real Azure Tables host
composition. Keep host-specific routes, credentials, configuration, customer
content, and operational evidence in their owning private systems. Actual
client runs, staff review/publication, privacy, isolation, bounded work, and
full human-workflow acceptance remain prerequisites before activation, A-01,
and either supervised pilot. Synthetic SDK success waives none of them.
Fewer repeated reads do not prove a Free-tier D1 budget, CPU allowance or bounded
physical-row cost. Measure the actual supported host invocation profiles before
claiming readiness; the `0.1.5` release closes no such acceptance gate.
