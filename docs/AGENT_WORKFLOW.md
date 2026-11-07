# Agent authoring and test-evidence workflow

The [merged KB-04 source](https://github.com/pegma-dev/knowledge-base/pull/5)
adds optional authoring transports over the existing Knowledge Base
application. [KB-05 release-preparation source](https://github.com/pegma-dev/knowledge-base/pull/6)
is also merged. All four KB packages are unpublished at `0.1.0`; this document
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
4. Submit evidence and the host's opaque receipt using the current generation.
   The host attester must verify the authenticated actor and runner, exact
   revision/content hash, check, staging build, result, and receipt before
   returning trusted verification facts. An authenticated agent's own `passed`
   string, runner ID, timestamps, or artifact hashes do not prove execution.
5. Read the draft again as needed. Evidence submission changes application
   generation even when content revision stays unchanged. Editing content
   changes the revision and invalidates older evidence/review authority. Staff
   review and publication separately bind the exact current revision, audience,
   policy, applicability, and verified evidence.

For an uncertain mutation result, authenticate again and retry the same
`commandId` and exact semantic input, including the original
`expectedGeneration`. An accepted replay returns its historical bounded
acknowledgement without duplicate history, Audit, or jobs. Changed input
conflicts; revoked authority remains denied. The acknowledgement is not a
claim that the historical state is still current.

## Source proof and retained host acceptance

[AUTH-01 PR #1](https://github.com/pegma-dev/agent-access/pull/1) merged the public
credential producer source. The KB `pnpm run agent:proof` gate pins reviewed
commit `a444e2113db98455b638b2ef8aa7c2faccb16b62`, builds it only in an isolated
temporary test consumer, and installs all four KB tarballs with the official
MCP SDK `1.32.2`. It exercises OAuth and real SDK protocol calls through the
five-operation loop, host-attested evidence, HTTP/MCP parity, and rejection
cases. The fictional human session, staging run, and attester remain test
inputs. The merged-source gate results are recorded in
[source preparation](SOURCE_PREPARATION.md); changed source requires fresh
current-head gates.

The merged KB-04 source exit passed format, type, tests, synthetic example,
artifact checks, and `agent:proof` on Node 22 and 24, plus clean OpenRouter
review with zero actionable findings and the applicable security checks.
Changed source requires the same current-head gates. KB-05 release-preparation
source is merged; full KB-05 publication remains open. Agent Access's
[release-preparation source](https://github.com/pegma-dev/agent-access/pull/2)
is also merged and follows its separate first-publication and
trusted-publisher process. Both public releases precede production host
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
evidence submission, and matching HTTP/MCP outcomes using exact released
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
