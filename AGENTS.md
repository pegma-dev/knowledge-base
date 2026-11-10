# Working in this repository

Knowledge Base is a standalone MIT Pegma component. Optimize for a fresh agent
context: small typed contracts, explicit composition, and meaningful public-API
tests. The approved scope is the [Support Desk enhancement plan](https://github.com/pegma-dev/support-desk/blob/main/docs/KNOWLEDGE_AI_PLAN.md).

## Boundaries

- Contracts and core own collection policy, immutable article revisions,
  validation/evidence bindings, approval, publication, and retirement.
- KB-01 owns pure domain work. KB-02 adds declared persistence and authorized
  application services. KB-03 extends the application with bounded retrieval,
  authoritative confirmation, and repair; it adds no package. KB-04 adds the
  optional `@pegma/knowledge-base-mcp` package for the shared five-operation
  dispatcher, versioned HTTP contract, and MCP transport. Live host interfaces
  remain host work; do not create later packages early.
- [KB-04 source](https://github.com/pegma-dev/knowledge-base/pull/5) and
  the separate KB-05 [partial source](https://github.com/pegma-dev/knowledge-base/pull/4)
  and [release-preparation source](https://github.com/pegma-dev/knowledge-base/pull/6)
  slices are merged. The partial slice adds local D1 conformance and a public
  synthetic composition; the release slice adds exact-artifact tooling. All four
  `0.1.0` packages completed manual maintainer bootstrap with exact-byte
  postflight on 2026-11-07, without OIDC provenance. All four `0.1.1` packages
  subsequently completed verified trusted publication; retain the
  [historical release receipt](docs/BOOTSTRAP.md#historical-verified-011-release).
  All four `0.1.2` packages have since completed verified trusted publication
  for SD-03 atomic draft/source authoring. All four `0.1.3` packages completed
  verified trusted publication for optional human-reviewed evidence reports;
  retain the [public release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.3).
  All four `0.1.4` packages completed verified trusted publication for governed
  authoring contexts, report queries and bounded resumable repair; retain the
  [public release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.4).
  Synchronized `0.1.5` is the unpublished answering read-batching candidate and
  requires its own review, current-head gates, trusted publication and strict
  verification. Grouped reads establish no universal query or CPU budget.
  Real-host acceptance remains separate.
- Never implement a database, authorization role model, identity/session/token
  system, audit log, request limiter, or durable scheduler here. Compose the
  corresponding Pegma package in the owning later task.
- Reuse Spine's identity/time types. Pin exact released Pegma versions. A host
  cannot consume an unpublished package through a branch, copied source, or a
  local path as a production release substitute.
- Collections own all access policy. Articles inherit it without ACL overrides.
  Portal visibility and approved bot-answer audiences are independent; private
  is the default. Public access requires an explicit reviewed policy change.
- Approval binds exact content, revision, audience/policy, applicability,
  validation policy, and evidence. Edits and changed authority invalidate it.
  A `passed` string or claimed runner identity does not authenticate evidence.
- Core transitions are not an authorization boundary. The application
  enforces named permissions and current KB resources; the host authenticates
  access contexts and evidence/source facts. Caller-supplied proof fields do
  not establish that trust.
- Direct host `createDraft`/`updateDraft` may supply complete `sourceReferences`
  atomically with content. Presence, including `[]`, requires `draftWrite` and
  `provenanceWrite`; every reference needs current source-read authority on
  conflict retry and replay. Initial HTTP/MCP schemas reject the field and
  expose no new scope or tool. SD-03 hosts must always supply a complete
  nonempty set; omission retains legacy behavior and does not close its source
  window. Readability does not establish publication eligibility/currentness.
- KB-02 article heads are normalized; content/evidence/publication history is
  immutable and bounded. Application generation fences every state change,
  independently of content revision. Same-partition CAS, Audit, receipts, and
  causal jobs commit together. Collection/profile and article partitions do
  not provide a global policy fence; current reads must reject stale authority.
- Replay rechecks current operation/resource permission and returns a bounded
  historical acknowledgement, not raw content or restored publication authority.
- Governed authoring reads require `draftRead` and either `draftWrite` or
  `evidenceSubmit`; explicit private evidence additionally requires `evidenceRead`.
  Keep opaque authoring observations within one operation and application
  instance. They are single-use head observations, never serialized credentials,
  evidence, review or publication authority. Preserve complete admitted proof
  history and the legacy report context path. Provider batching and fewer public
  calls do not establish universal Workers Free query/CPU acceptance.
- Retrieval projections are derived hints. Count physical work before filtering;
  request paths use keyed reads, never a corpus scan. Confirm current publication,
  applicability, and effective portal/bot audience before exposing any title,
  count, content, or citation. Whole source serialization uses the trusted local
  token counter; do not truncate article procedures into partial steps.
- Base packages require no Support Desk, GitHub, model, framework, HTTP, or
  provider SDK. Only the optional MCP package depends on the official MCP SDK
  and Zod. Evidence is data; never execute code or fetch submitted URLs.
- Initial agent access exposes exactly `getDraft`, `createDraft`, `updateDraft`,
  `getValidationRequirements`, and `submitEvidence`. Reuse `knowledgePermissions`
  draft-read/write/evidence-submit values as scopes; requirements need
  `draftWrite` or `evidenceSubmit`, never `draftRead` or `validationManage` alone.
  Agent credentials grant no staff/Admin role, collection/evidence/provenance
  reads, review, publication, policy administration, or grant management.
- The host composes Agent Access with its existing human login and current
  Admin-only consent. Device linking uses RFC 8628; authorization-code linking
  requires S256 PKCE. Initial authoring consent is app-instance-wide;
  collection-specific delegation is a future host seam. New capabilities need
  explicit scope registration, policy, and fresh consent. KB owns no credential
  issuer, login, role model, or request limiter.
- Constrain content and links; host renderers must disable executable content
  and raw HTML. Staff evidence/provenance never enters customer or bot DTOs.
- Use fictional fixtures only. Commercial host internals, credentials, customer
  content, and operational configuration stay in their owning private systems.
- D1 consumer fixtures use the released adapter with a real local Miniflare
  binding, not a fake port or cast. Each factory call gets an isolated database;
  register asynchronous disposal before initialization and clean up failures.
  Keep native workers/timeouts bounded. Fixture contexts/receipts are synthetic
  trust inputs, not live authentication or staging proof.
- Never write literal control bytes into source. Use escaped forms and verify
  bytes after tool-assisted edits.

## Workflow

Work on a `claude/*` branch and open a PR. Required checks are
`pnpm run format:check`, `pnpm run check`, `pnpm test`, `pnpm example`,
`pnpm run release:check`, and `pnpm run agent:proof`, on Node 22 and 24.
Require a clean current-head OpenRouter review with zero actionable findings
and the applicable current-head security checks. Do not bypass pending,
skipped, or failing gates.
Repository development and the TypeScript example require Node 22.6.0+ or 24.
The root engine floor covers the example's `--experimental-strip-types` flag;
published package engines remain `>=22`, and CI tracks current Node 22/24.

Each published package needs its own README and MIT LICENSE, a build-on-prepack
script, and compiled-test exclusion. Merging source does not publish packages.
Release preparation requires a clean checkout at an approved signed annotated
`vX.Y.Z` tag matching the synchronized version, exact event commit, and protected
`origin/main` ancestry. A schema-2 manifest binds that identity and all four
tarballs. Independently retain its SHA-256 digest; never trust a digest taken
only from the downloaded artifact. Preflight all four registry versions before
any publish, and recover only by accepting byte-identical existing artifacts.
See [release operations](docs/RELEASING.md) and the
[publication ledger](docs/BOOTSTRAP.md) for the completed manual bootstrap
and historical KB `0.1.2` and Agent Access `0.1.1` receipts. The
[KB `0.1.3` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.3)
is also verified. All five KB/Agent Access trusted publishers
have been configured through the CLI; that configuration does not prove a
trusted publish. Recheck ownership, signer, tag, approval environment, direct
publishing, and 2FA/token restrictions for the release. OIDC publishing receives only verified prepared
artifacts; it installs nothing, rebuilds no packages, and has no token fallback.
A separate unprivileged job installs registry packages in an isolated temporary
consumer with lifecycle scripts disabled and verifies signatures/provenance.
`pnpm test` includes `test:release`'s release identity, manifest, argument, and
registry regressions; these must execute on both Node lanes.
Agent Access `0.1.1` has completed its verified trusted release; retain its
[receipt](docs/BOOTSTRAP.md#verified-agent-access-prerequisite). The active
protocol proof installs exact registry `@pegma/agent-access@0.1.1` with all four
packed KB candidate artifacts and the official SDK in a fresh temporary consumer,
with lifecycle scripts disabled. It accepts no source-producer fallback.
Historical source-fixture evidence is not evidence for changed proof code;
current-head Node 22/24 gates must execute the registry composition. The KB
`0.1.5` candidate's own review, trusted publication, and strict registry
verification remain open. Host acceptance remains open before activation.
Keep actual existing-login/Admin-consent and every requested client/mode proof
open in P-00 and PG-01/RG-01 until both hosts record them before activation.

## Reading order

Read this file, the root README, then the owning package README. The public
enhancement plan defines KB-01 through KB-05. Give a worker one task and an
explicit file ownership boundary; do not revert another worker's edits.
For KB-02, read [declared collections](docs/COLLECTIONS.md) before changing
durable operations and [host composition](docs/HOST_COMPOSITION.md) before
changing authorization, verifier, replay, or DTO boundaries.
For KB-03, read [retrieval](docs/RETRIEVAL.md) and the declared projection
layout before changing query work, citations, or repair.
For KB-04, read the [agent API](docs/AGENT_API.md) and
[agent workflow](docs/AGENT_WORKFLOW.md) before changing transport, credential,
client, or evidence-proof boundaries.
For KB-05, read [source preparation](docs/SOURCE_PREPARATION.md) before changing
local D1 fixtures, synthetic composition, or release-readiness claims, and
[release operations](docs/RELEASING.md) before changing release tooling.
