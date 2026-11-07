# Working in this repository

Knowledge Base is a standalone MIT Pegma component. Optimize for a fresh agent
context: small typed contracts, explicit composition, and meaningful public-API
tests. The approved scope is the [Support Desk enhancement plan](https://github.com/pegma-dev/support-desk/blob/main/docs/KNOWLEDGE_AI_PLAN.md).

## Boundaries

- Contracts and core own collection policy, immutable article revisions,
  validation/evidence bindings, approval, publication, and retirement.
- KB-01 is pure domain work. Storage, authorized services, retrieval, API/MCP,
  and host interfaces are later tasks; do not create their packages early.
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
- Core transitions are not an authorization boundary. The later application
  must authenticate/authorize the actor, attestations, and current resources.
- Base packages require no Support Desk, GitHub, model, framework, HTTP, or
  provider SDK. Evidence is data; never execute code or fetch submitted URLs.
- Constrain content and links; host renderers must disable executable content
  and raw HTML. Staff evidence/provenance never enters customer or bot DTOs.
- Use fictional fixtures only. Commercial host internals, credentials, customer
  content, and operational configuration stay in their owning private systems.
- Never write literal control bytes into source. Use escaped forms and verify
  bytes after tool-assisted edits.

## Workflow

Work on a `claude/*` branch and open a PR. Required checks are
`pnpm run format:check`, `pnpm run check`, `pnpm test`, and
`pnpm run release:check`, on Node 22 and 24. Run the applicable review/security
checks for the current head. Do not bypass pending, skipped, or failing gates.

Each published package needs its own README and MIT LICENSE, a build-on-prepack
script, and compiled-test exclusion. Merging source does not publish packages.
See [release operations](docs/RELEASING.md); first publication and external
trusted-publisher configuration are separate maintainer operations.

## Reading order

Read this file, the root README, then the owning package README. The public
enhancement plan defines KB-01 through KB-05. Give a worker one task and an
explicit file ownership boundary; do not revert another worker's edits.
