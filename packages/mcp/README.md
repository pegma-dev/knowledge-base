# @pegma/knowledge-base-mcp

Optional KB-04 agent transport source for Pegma Knowledge Base. This package
adapts the authorized application API to bounded agent commands and the Model
Context Protocol. It is unpublished at `0.1.0`; merging its source does not
publish it or establish a live hosted Knowledge Base.

The contracts, core, and application packages remain independent of MCP, HTTP,
provider SDKs, and login flows. Hosts choose this adapter when exposing agent
access. The adapter pins `@modelcontextprotocol/sdk` at `1.32.2` and `zod` at
`4.6.7`; it composes the same exact `0.1.0` Knowledge Base packages.

The MCP adapter explicitly uses the SDK's Workers-compatible JSON Schema
validator, which requires no generated code. Its `@cfworker/json-schema`
dependency is pinned at `4.1.6` and required by this package even though the
SDK declares it as an optional peer. Packed consumers receive the validator
without needing to discover or install that peer themselves.

## Trust and composition

The host owns credential issuance, authentication, resource binding, current
authorization, and evidence verification. Compose the adapter with the
Knowledge Base application and host authentication ports. Agent Access is a
separate producer; it is not a runtime dependency of this package. An opaque
credential, caller-supplied actor, or claimed evidence result does not establish
an authenticated `AccessContext` or trusted evidence.

Agent operations use the same current-resource authorization, application
generation, immutable evidence, replay, and publication rules as other
application callers. Agents can prepare drafts and submit evidence through the
declared tool surface. Review and publication remain separate staff authority.
The adapter never executes article steps, fetches evidence URLs, provisions a
runner, or creates a second database or identity system.

`createKnowledgeAgentDispatcher` provides the shared operation boundary.
`knowledgeAgentScopes`, `knowledgeAgentOperations`, and
`knowledgeAgentToolNames` declare its finite surface. Inputs are validated
against shared internal schemas and fixed component ceilings before dispatch.
Errors use bounded public responses rather than exposing internal exceptions
or private evidence and provenance.

`createKnowledgeAgentHttp` and `createKnowledgeAgentMcp` expose that dispatcher
through host-configured protected endpoints. Both require fresh host
authentication and admission control on every request; neither issues tokens.

The [host composition contract](https://github.com/pegma-dev/knowledge-base/blob/main/docs/HOST_COMPOSITION.md)
describes authenticated contexts, trusted evidence, replay, and safe DTOs. The
[retrieval contract](https://github.com/pegma-dev/knowledge-base/blob/main/docs/RETRIEVAL.md)
describes authoritative current-publication confirmation and audience boundaries.

## Local verification and release

Repository development uses Node 22.6.0+ or 24 with pnpm 10.34.5:

```sh
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run check
pnpm test
pnpm example
pnpm run release:check
pnpm run agent:proof
```

`release:check` packs and installs all four unpublished Knowledge Base packages
in an isolated temporary consumer, verifies their actual artifact bytes and
inventory, and imports their public entry points without workspace links.
`agent:proof` exercises the authenticated SDK path with a pinned public Agent
Access producer packed only into a temporary test consumer. That producer
source is a test fixture, not a production release substitute or package
dependency. These local checks establish neither live host acceptance nor npm
publication.

Each package has its own README, MIT LICENSE, build-on-prepack hook, and
compiled-test exclusion. All four package versions remain synchronized at
`0.1.0`. First publication, release tags, trusted-publisher configuration, and
host activation are separate maintainer operations in the
[release procedure](https://github.com/pegma-dev/knowledge-base/blob/main/docs/RELEASING.md).
Development links above track `main`; release preparation must pin verified
release documentation before first publication.

Built in the open by RetireGolden, LLC.
