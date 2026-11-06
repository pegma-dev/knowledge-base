# Knowledge Base

A standalone MIT Pegma component for product documentation and support knowledge.
Hosts own their users, storage, authorization policy, interfaces, and deployment.
Knowledge Base owns collection policy, immutable article revisions, validation,
and exact publication approval. It requires no GitHub connection or AI provider.

> Development status: KB-01 implements contracts and pure domain transitions.
> The packages are unpublished. Authorized persistence, retrieval, API/MCP,
> and customer/staff interfaces are later tasks. This repository is not yet an
> operational knowledge-base service or a production dependency.

| Package                                                           | Scope                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| [`@pegma/knowledge-base-contracts`](packages/contracts/README.md) | Collection, article, evidence, and approval vocabulary |
| [`@pegma/knowledge-base-core`](packages/core/README.md)           | Pure validation and lifecycle transitions              |

Collections default to private and independently specify portal and bot-answer
audiences. Articles inherit collection policy. Staff approval binds the exact
revision, content, collection policy, applicability, validation requirements,
and evidence. A revised guide requires fresh review; prior publication never
authorizes edited content.

Core transitions accept explicit inputs and return new values. They do not
authenticate a runner or staff member, enforce host roles, fetch evidence URLs,
or execute guide steps. Later application services must enforce current
Authorization Core permissions and authenticated attestation boundaries.
Local agents will test guides against authorized staging and submit evidence
through the later API/MCP adapter.

Develop on Node 22 or 24 with pnpm 10.34.5:

```sh
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run check
pnpm test
pnpm run release:check
```

The npm and pnpm workspace declarations deliberately name the same two source
packages: pnpm links them for development, while npm supplies artifact packing.
The release check installs both tarballs in a consumer outside either workspace
to verify dependency resolution without source links.

The [approved enhancement plan](https://github.com/pegma-dev/support-desk/blob/main/docs/KNOWLEDGE_AI_PLAN.md)
defines KB-01 through KB-05 and the later Support Desk/host integrations.
Its [P-00 handoff](https://github.com/pegma-dev/support-desk/pull/33) records
source/registry baselines, synthetic acceptance cases, and open activation
prerequisites. These two launch hosts use separate stores and policies; the
packages do not introduce a shared tenant control plane.

Read [AGENTS.md](AGENTS.md) before changing code and
[release operations](docs/RELEASING.md) before preparing artifacts. Merging
source does not publish a package. Each new npm name needs the maintainer's
first publication and trusted-publisher setup before hosts can consume it.
