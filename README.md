# Knowledge Base

A standalone MIT Pegma component for product documentation and support knowledge.
Hosts own their users, storage, authorization policy, interfaces, and deployment.
Knowledge Base owns collection policy, immutable article revisions, validation,
and exact publication approval. It requires no GitHub connection or AI provider.

> Development status: KB-01 provides contracts and pure domain transitions;
> KB-02 adds authorized application/persistence source, and KB-03 extends that
> application with bounded retrieval and repair. Implementation and repository
> gates determine source evidence. Independent partial KB-05 preparation adds
> local D1 conformance and a public synthetic example. KB-04 credentials and the
> full KB-05 release task remain unfinished. All three packages are unpublished
> at `0.1.0`. API/MCP and live customer/staff interfaces remain later tasks. This
> repository is not yet an operational hosted KB or a production dependency.

| Package                                                               | Scope                                                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`@pegma/knowledge-base-contracts`](packages/contracts/README.md)     | Collection, article, evidence, and approval vocabulary                                  |
| [`@pegma/knowledge-base-core`](packages/core/README.md)               | Pure validation and lifecycle transitions                                               |
| [`@pegma/knowledge-base-application`](packages/application/README.md) | Authorized services, bounded persistence/retrieval, private DTOs, and exact publication |

Collections default to private and independently specify portal and bot-answer
audiences. Articles inherit collection policy. Staff approval binds the exact
revision, content, collection policy, applicability, validation requirements,
and evidence. A revised guide requires fresh review; prior publication never
authorizes edited content.

Core transitions accept explicit inputs and return new values. They do not
authenticate a runner or staff member, enforce host roles, fetch evidence URLs,
or execute guide steps. The application enforces current named permissions
and resource checks; hosts authenticate scoped access contexts and trusted
evidence/source facts. Private draft, evidence, provenance, and review reads
have separate DTOs. The keyed published read returns portal-safe content only.
Local agents will test guides against authorized staging and submit evidence
through the later API/MCP adapter.

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

Partial [source preparation](docs/SOURCE_PREPARATION.md) runs shared public KB
conformance against memory, local Azurite, and real local Miniflare D1 through
the released D1 adapter. The [synthetic composition](examples/composition/README.md)
demonstrates the public author/test/review/publish/retrieve flow with fictional
trust inputs. Local emulators and that example establish neither live Workers
deployment nor scoped API/MCP credentials, publication, or host acceptance.

Develop on Node 22.6.0+ or 24 with pnpm 10.34.5:

```sh
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run check
pnpm test
pnpm example
pnpm run release:check
```

The npm and pnpm workspace declarations deliberately name the same source
packages: pnpm links them for development, while npm supplies artifact packing.
The release check installs all three tarballs in a consumer outside either workspace
to verify dependency resolution without source links.
Frozen installation permits the pinned native `workerd` install script only;
test workers/timeouts and per-factory D1 disposal remain bounded.

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

Built in the open by RetireGolden, LLC.
