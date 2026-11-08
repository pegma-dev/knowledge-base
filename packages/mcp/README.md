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

## Optional native-client report mode (unpublished `0.1.3` source)

`createKnowledgeAgentDispatcher` optionally accepts
`reports: Pick<KnowledgeEvidenceReports, "report" | "ledger" | "status">`.
This composes the shared human-report service without adding tools or scopes.
The existing five operations remain `getDraft`, `createDraft`, `updateDraft`,
`getValidationRequirements` and `submitEvidence`. Configured MCP tool schemas
advertise report discovery/polling and submission variants on the latter two;
HTTP uses the same envelopes. Omitting `reports` preserves the exact legacy
schemas and results, rejecting extension fields.

Both report variants need effective `draftRead` and `evidenceSubmit`.
Requirements input adds `articleId` and optional
`reportLookup: { ledgerEpoch, reportId }`, returning `reportLedger` and optional
owner-only, body-free `reportStatus`. Receipt-free `submitEvidence` adds the
current `ledgerEpoch` and `report: { summary, details }` to the original command
and exact evidence fields. Its `kind: "pending-human-review"` result acknowledges
only a report; it is not an article mutation or verified evidence.

The native client polls through that same requirements tool. A separately
authorized human reviews the private report and records a decision; staff may
review their own agent and no two-person rule is enforced. After confirmation,
the original receipt-bearing `submitEvidence` form performs actual KB
qualification with the exact evidence and current article generation. First
confirmation preserves the report receipt; reassessment rotates its cycle.
Current runner/result/build/governance and freshness checks still apply.
Report bodies, reviewer details and private accepted evidence remain staff-only.

Hosts must bind optional report methods to the same authenticated request/grant
and revalidate it before and after every awaited `report`, `ledger` or `status`
call. Preserve the dispatcher-supplied restricted context rather than replacing
it with current owner/Admin authority. Principal resolution inside a report
ledger does not replace host credential/grant freshness checks.

Read the DEVELOPMENT [wire contract](https://github.com/pegma-dev/knowledge-base/blob/main/docs/AGENT_API.md#optional-native-client-report-mode),
[native-client workflow](https://github.com/pegma-dev/knowledge-base/blob/main/docs/AGENT_WORKFLOW.md#submit-a-report-and-poll-through-the-same-mcp-connection)
and [report lifecycle](https://github.com/pegma-dev/knowledge-base/blob/main/docs/EVIDENCE_REPORTS.md)
before composing this unpublished mode. The verified `0.1.2` release does not
contain it; its own reviewed publication and host/client acceptance remain open.

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
The base-contract links above target verified `v0.1.2`; new report-mode links
explicitly target DEVELOPMENT `main` until their own reviewed release tag exists.
Source readers can use the
explicitly moving
[DEVELOPMENT documentation on main](https://github.com/pegma-dev/knowledge-base/blob/main/docs/HOST_COMPOSITION.md)
while preparing a release. The versioned contract references remain tag-pinned;
the DEVELOPMENT link is a source-reader fallback.

Built in the open by RetireGolden, LLC.
