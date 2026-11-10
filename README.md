# Knowledge Base

A standalone MIT Pegma component for product documentation and support knowledge.
Hosts own their users, storage, authorization policy, interfaces, and deployment.
Knowledge Base owns collection policy, immutable article revisions, validation,
and exact publication approval. It requires no GitHub connection or AI provider.

> Development status as of 2026-11-10: KB-01 through KB-03 provide contracts, pure domain
> transitions, authorized application/persistence, and bounded retrieval/repair.
> [Merged KB-04 source](https://github.com/pegma-dev/knowledge-base/pull/5) adds
> the optional five-operation HTTP/MCP adapter and authenticated protocol proof.
> The separate [partial KB-05 source](https://github.com/pegma-dev/knowledge-base/pull/4)
> supplies local D1 conformance and a public synthetic example; the later
> [release-preparation source](https://github.com/pegma-dev/knowledge-base/pull/6)
> supplies exact-artifact tooling. Both are merged. All four `0.1.0` packages
> completed manual bootstrap with exact-byte postflight on 2026-11-07, without
> OIDC provenance. All four `0.1.1` packages subsequently completed
> [verified trusted publication](docs/BOOTSTRAP.md#historical-verified-011-release).
> All four `0.1.2` packages have since completed
> [verified trusted publication](docs/BOOTSTRAP.md#historical-verified-012-release)
> for SD-03 atomic draft/source authoring. All four `0.1.3` packages completed
> [verified trusted publication](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.3)
> for optional human-reviewed [evidence reports](docs/EVIDENCE_REPORTS.md).
> All four `0.1.4` packages completed
> [verified trusted publication](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.4)
> for governed authoring-context reads, report queries and bounded resumable repair.
> Synchronized `0.1.5` is the **unpublished patch candidate** for answering read
> batching; its own review, current-head CI, trusted publication and strict
> consumer verification remain pending.
> Actual two-host existing-login/client acceptance remains open.
> Host activation remains separately gated; this repository supplies no hosted KB.

| Package                                                               | Scope                                                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`@pegma/knowledge-base-contracts`](packages/contracts/README.md)     | Collection, article, evidence, and approval vocabulary                                  |
| [`@pegma/knowledge-base-core`](packages/core/README.md)               | Pure validation and lifecycle transitions                                               |
| [`@pegma/knowledge-base-application`](packages/application/README.md) | Authorized services, bounded persistence/retrieval, private DTOs, and exact publication |
| [`@pegma/knowledge-base-mcp`](packages/mcp/README.md)                 | Optional bounded agent dispatcher, versioned HTTP API, and MCP adapter                  |

Collections default to private and independently specify portal and bot-answer
audiences. Articles inherit collection policy. Staff approval binds the exact
revision, content, collection policy, applicability, validation requirements,
and evidence. A revised guide requires fresh review; prior publication never
authorizes edited content.

Core transitions accept explicit inputs and return new values. The application
enforces current named permissions and resource checks; hosts authenticate
access contexts and evidence/source facts. Private draft, evidence, provenance,
and review reads have separate DTOs. The keyed published read returns
portal-safe content only. The three base packages remain independent of HTTP,
MCP, and provider SDKs.

The `0.1.4` release provides `getAuthoringContext` to read current draft and narrow
requirements together. It requires draft-read plus draft-write or evidence-submit;
requesting complete private evidence also requires evidence-read. Its opaque,
single-use `confirmAuthoringContext` observation is local to the same operation
and application instance, never a credential or publication authority. An
optional report-factory context pair and body-free `query` reduce repeated reads
while preserving legacy ports, full proof history and exact authority fences.
These source changes do not prove a universal 50-query or CPU budget for Workers
Free; real host profiles still require measured acceptance.

The optional adapter exposes exactly `getDraft`, `createDraft`, `updateDraft`,
`getValidationRequirements`, and `submitEvidence` over the same application.
Its scopes reuse `knowledgePermissions.draftRead`, `draftWrite`, and
`evidenceSubmit`; validation requirements need write or evidence-submit
authority. Agents receive no Admin/staff role, collection or evidence reads,
private provenance, review, publication, policy, or grant-management operations.
Read the [agent API](docs/AGENT_API.md) for the exact contract and
[agent workflow](docs/AGENT_WORKFLOW.md) for linking and draft/test/evidence use.

Hosts compose the separate [Agent Access](https://github.com/pegma-dev/agent-access)
producer with their existing human login and current Admin consent. AUTH-01's
[merged source](https://github.com/pegma-dev/agent-access/pull/1) supplies the
source prerequisite, and its
[release preparation](https://github.com/pegma-dev/agent-access/pull/2) is merged.
Agent Access `0.1.0` completed manual bootstrap without OIDC provenance, and its
`0.1.1` trusted release is now verified. The [release receipt](docs/BOOTSTRAP.md#verified-agent-access-prerequisite)
closes that public producer prerequisite only. Initial authoring grants are
app-instance-wide. Collection-specific delegation is a future host seam.
The KB does not issue credentials or implement login, roles, or a limiter.

KB-02 stores normalized heads and bounded immutable history with same-partition
CAS, Audit, replay receipts, and causal jobs. Application generation is separate
from content revision. Replay returns a historical bounded acknowledgement
after current authorization, never a raw aggregate. Current publication reads
reject stale authority; no cross-partition policy transaction is promised.
Read [declared collections](docs/COLLECTIONS.md) and
[host composition](docs/HOST_COMPOSITION.md) for the layout, limits, verifier
contract, and safe read boundaries.

Privileged direct application callers can supply complete `sourceReferences`
with `createDraft`/`updateDraft` to commit content and current provenance in
one article transaction. Presence requires both draft-write and provenance-write
authority, including an explicit empty set. SD-03 host workflows must always
supply the complete nonempty set to close the empty/stale source window;
source readability alone does not establish publication eligibility/currentness.
Omission retains legacy behavior. The five-operation HTTP/MCP schemas continue
to reject this field and add no scope or tool. The
[approved source progression](https://github.com/pegma-dev/support-desk/pull/38)
does not close release or host acceptance gates.

KB-03 adds deterministic lexical retrieval over a bounded, repairable
projection. Hints are confirmed against current authoritative publication,
audience, applicability, and source eligibility before disclosure. Portal and
bot-answer uses have separate safe citations; bot-only knowledge does not
grant an article browse capability. Read [retrieval](docs/RETRIEVAL.md) for
physical work/source budgets, whole-article token accounting, and repair.

[Source preparation](docs/SOURCE_PREPARATION.md) runs shared public KB
conformance against memory, local Azurite, and real local Miniflare D1 through
the released D1 adapter. The [synthetic composition](examples/composition/README.md)
demonstrates author/test/review/publish/retrieve with fictional trust inputs.
The active `agent:proof` gate installs exact registry
`@pegma/agent-access@0.1.1` and all four packed KB candidate artifacts in a fresh
temporary consumer with lifecycle scripts disabled and the official MCP SDK
`1.32.2`, exercising OAuth, the five tools, evidence binding, and HTTP/MCP parity.
The [historical source-gate record](docs/SOURCE_PREPARATION.md#historical-source-gates)
retains reviewed heads and CI links. Current-head results establish execution.
These proofs establish neither actual
requested-client compatibility nor either real host's login/staging acceptance.

Develop on Node 22.6.0+ or 24 with pnpm 10.34.5:

```sh
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run check
pnpm test
pnpm example
pnpm run release:check
pnpm run agent:proof
```

The npm and pnpm workspace declarations deliberately name the same four source
packages: pnpm links them for development, while npm supplies artifact packing.
The release check installs all four tarballs in a consumer outside either
workspace to verify dependency resolution without source links. The protocol
proof's Agent Access producer comes from the public registry with no source
fallback; production hosts must consume exact verified trusted Agent Access
and KB versions.
Frozen installation permits the pinned native `workerd` install script only;
test workers/timeouts and per-factory D1 disposal remain bounded.

The [approved enhancement plan](https://github.com/pegma-dev/support-desk/blob/main/docs/KNOWLEDGE_AI_PLAN.md)
defines KB-01 through KB-05 and the later Support Desk/host integrations.
Its [P-00 handoff](https://github.com/pegma-dev/support-desk/pull/33) records
frozen baselines and activation prerequisites; the
[source/publication clarification](https://github.com/pegma-dev/support-desk/pull/36)
retains actual two-host acceptance in PG-01/RG-01 before activation and pilots.
Codex, Claude Code, Grok Bot's desktop hosted agent, and T3 Code's Codex-provider
mode each need real recorded runs on both hosts. SDK proof cannot close those
gates. The two hosts keep separate stores and policies without a shared control
plane.

Read [AGENTS.md](AGENTS.md) before changing code and
[release operations](docs/RELEASING.md) before preparing artifacts. Development
pack checks are separate from signed-tag release preparation. The release path
binds all four tarballs to source identity and an independently retained manifest
digest, preflights the full registry set, and verifies released consumers.
Merging source does not publish a package. The
[maintainer bootstrap ledger](docs/BOOTSTRAP.md) records the completed manual
`0.1.0` uploads and exact-byte postflight. All five KB/Agent Access trusted
publishers are configured through the CLI. Agent Access's verified trusted
`0.1.1` release and the four-package KB trusted
[`0.1.4` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.4)
are complete; prior exact receipts remain historical evidence. All four KB
packages currently have `latest: 0.1.4`; Agent Access has `latest: 0.1.1`; all
retain historical `bootstrap: 0.1.0`. Synchronized source `0.1.5` remains
unpublished and needs its own review, current-head CI, trusted release and strict
consumer verification. Read batching establishes no universal backend query or
CPU budget. Neither registry publication nor synthetic proof satisfies real
host acceptance or approves activation.

Built in the open by RetireGolden, LLC.
