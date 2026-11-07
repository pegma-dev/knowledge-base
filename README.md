# Knowledge Base

A standalone MIT Pegma component for product documentation and support knowledge.
Hosts own their users, storage, authorization policy, interfaces, and deployment.
Knowledge Base owns collection policy, immutable article revisions, validation,
and exact publication approval. It requires no GitHub connection or AI provider.

> Development status: KB-01 through KB-03 provide contracts, pure domain
> transitions, authorized application/persistence, and bounded retrieval/repair.
> [Merged KB-04 source](https://github.com/pegma-dev/knowledge-base/pull/5) adds
> the optional five-operation HTTP/MCP adapter and authenticated protocol proof.
> KB-05 source preparation supplies local D1 conformance, a public synthetic
> example, and exact-artifact release tooling. All four packages are unpublished
> at `0.1.0`. First publication, trusted-publisher setup, registry verification,
> and actual two-host existing-login/client acceptance remain separate gates.
> This repository is not an operational hosted KB or a production dependency.

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
source prerequisite; publication remains separate. Initial authoring grants are
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
The separate `agent:proof` gate composes reviewed pinned AUTH-01 source and all
four packed KB artifacts in a temporary consumer with the official MCP SDK
`1.32.2`, exercising OAuth, the five tools, evidence binding, and HTTP/MCP parity.
Current-head results establish execution; these proofs establish neither actual
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
workspace to verify dependency resolution without source links. The Agent
Access source fixture is confined to the temporary protocol-proof consumer;
production hosts must consume exact published Agent Access and KB versions.
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
Merging source does not publish a package. Follow the
[maintainer bootstrap handoff](docs/BOOTSTRAP.md) for the four new npm names,
then configure their individual trusted publishers for later releases. Agent
Access follows its separate release process. SD-02 and host installation wait
for actual published dependencies; source and synthetic proof cannot satisfy
real host acceptance.

Built in the open by RetireGolden, LLC.
