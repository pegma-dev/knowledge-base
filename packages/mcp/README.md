# @pegma/knowledge-base-mcp

Optional KB-04 agent transport source for Pegma Knowledge Base. This package
adapts the authorized application API to bounded agent commands and the Model
Context Protocol. Hosts compose it with their protected Knowledge Base
endpoints; the package does not supply a hosted service.

The contracts, core, and application packages remain independent of MCP, HTTP,
provider SDKs, and login flows. Hosts choose this adapter when exposing agent
access. The adapter pins `@modelcontextprotocol/sdk` at `1.32.2` and `zod` at
`4.6.7`; it composes the matching exact Knowledge Base package versions declared
in its dependencies.

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

The initial `createDraft`/`updateDraft` HTTP/MCP schemas reject
`sourceReferences`. Atomic draft/source authoring is a privileged direct-host
application extension; it adds no agent scope or tool.

`createKnowledgeAgentHttp` and `createKnowledgeAgentMcp` expose that dispatcher
through host-configured protected endpoints. Both require fresh host
authentication and admission control on every request; neither issues tokens.

The [host composition contract](https://github.com/pegma-dev/knowledge-base/blob/v0.1.2/docs/HOST_COMPOSITION.md)
describes authenticated contexts, trusted evidence, replay, and safe DTOs. The
[retrieval contract](https://github.com/pegma-dev/knowledge-base/blob/v0.1.2/docs/RETRIEVAL.md)
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

`release:check` packs and installs all four prepared Knowledge Base packages
in an isolated temporary consumer, verifies their actual artifact bytes and
inventory, and imports their public entry points without workspace links.
`agent:proof` exercises the authenticated SDK path with an exact released Agent
Access registry producer and the four packed KB artifacts in a fresh temporary
consumer, with lifecycle scripts disabled. Agent Access remains a proof
dependency rather than this package's runtime dependency. These local checks
establish neither live host acceptance nor KB trusted npm
publication.

Each package has its own README, MIT LICENSE, build-on-prepack hook, and
compiled-test exclusion. All four package versions remain synchronized with
exact internal dependency pins. Publishing, release tags, trusted-publisher configuration, and
host activation are separate maintainer operations in the
[release procedure](https://github.com/pegma-dev/knowledge-base/blob/v0.1.2/docs/RELEASING.md).
Documentation links target this package's release tag rather than development
`main`. During release preparation that tag may still be pending; it is created
after the reviewed merge and before publishing. Source readers can use the
explicitly moving
[DEVELOPMENT documentation on main](https://github.com/pegma-dev/knowledge-base/blob/main/docs/HOST_COMPOSITION.md)
while preparing a release. The versioned contract references remain tag-pinned;
the DEVELOPMENT link is a source-reader fallback.

Built in the open by RetireGolden, LLC.
