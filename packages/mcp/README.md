# @pegma/knowledge-base-mcp

Optional KB-04 agent transport source for Pegma Knowledge Base. This package
adapts the authorized application API to bounded agent commands and the Model
Context Protocol. Hosts compose it with their protected Knowledge Base
endpoints; the package does not supply a hosted service.

The historical synchronized
[`0.1.5` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.5)
includes answering read batching and the aggregate report query introduced in
`0.1.4`. The current verified synchronized release is `0.1.6`, described below.
Changed source requires its own review and current-head gates. Host and actual
client acceptance remain separate. These source README corrections apply to a
future release. Published `0.1.5` tarballs, including their bundled README bytes,
remain unchanged.

The verified [`0.1.6` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.6) accepts bounded
opaque MCP `params._meta` extensions, including native-client correlation and
standard trace fields, while retaining the existing `progressToken` shape
validation: a string of at most 128 characters or a safe integer. Metadata
does not establish identity, permissions or evidence and is not stored or
returned as an application result. Complete-message byte, depth, node and key
ceilings, strict tool arguments and fresh host authentication remain unchanged.
The official-SDK regression and packed protocol proof exercise fictional
extension values; actual requested-client and host acceptance remain separate.

The unpublished `0.1.7` candidate synchronizes all four packages for the staff
report receipt extension. Its combined source requires current-head gates and
release verification before adoption. See the
[application upgrade note](https://github.com/pegma-dev/knowledge-base/blob/61dcaaf19f7a0db644709aef8f52a826f3c1b34d/packages/application/README.md#unpublished-017-candidate).

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

The [host composition contract](https://github.com/pegma-dev/knowledge-base/blob/v0.1.3/docs/HOST_COMPOSITION.md)
describes authenticated contexts, trusted evidence, replay, and safe DTOs. The
[retrieval contract](https://github.com/pegma-dev/knowledge-base/blob/v0.1.3/docs/RETRIEVAL.md)
describes authoritative current-publication confirmation and audience boundaries.

## Optional native-client report mode

`createKnowledgeAgentDispatcher` optionally accepts
`reports: Pick<KnowledgeEvidenceReports, "report" | "ledger" | "status">`.
This composes the shared human-report service without adding tools or scopes.
The existing five operations remain `getDraft`, `createDraft`, `updateDraft`,
`getValidationRequirements` and `submitEvidence`. Configured MCP tool schemas
advertise report discovery/polling and submission variants on the latter two;
HTTP uses the same envelopes. Omitting `reports` preserves the exact legacy
schemas and results, rejecting extension fields.

The verified `0.1.3` release provides that report trio. The verified `0.1.4`
release additionally accepts `reports.query`, typed as the optional
`Partial<Pick<KnowledgeEvidenceReports, "query">>` extension. The dispatcher
calls it once for report-aware requirements, passing only the article ID and
optional owner-status key. It projects the returned governed requirements,
ledger and status into the same wire result. Internal target metadata and
capacity, report bodies, evidence and opaque context observations never appear
as added fields. No tool, scope, schema or client option changes. Supplying only
the original trio retains its existing read sequence; legacy requirements do
not invoke query. A configured query's failure or malformed output refuses
without falling back.

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

Hosts bind all report/query work to the original request, credential, principal,
grant, client and resource. Keep initial request authentication. For pure reads,
hosts may revalidate per port or use one request-local full-credential check
before the first read and another after the completed actual dispatcher call,
checking all required scopes/permissions before disclosure. MCP needs that fence
inside its awaited tool callback, not only around an outer Response. Writes
retain fresh before/after guards; no read group is reused across invocations.
Preserve the restricted context rather than substituting current owner/Admin
authority. Ledger principal resolution is not a host credential verifier.

The optional application context/read-confirm pair is trusted composition only.
Its opaque observation is instance- and caller-bound, single-use read
bookkeeping; it is neither authority nor an attestation and never reaches the
agent or durable records. Fewer repeated reads do not prove that a complete host
invocation fits the Workers Free limit of 50 D1 queries per invocation, or establish
a CPU, physical-row or latency guarantee; actual host profiles remain unproven.

Read the verified `0.1.3` [wire contract](https://github.com/pegma-dev/knowledge-base/blob/v0.1.3/docs/AGENT_API.md#optional-native-client-report-mode),
[native-client workflow](https://github.com/pegma-dev/knowledge-base/blob/v0.1.3/docs/AGENT_WORKFLOW.md#submit-a-report-and-poll-through-the-same-mcp-connection)
and [report lifecycle](https://github.com/pegma-dev/knowledge-base/blob/v0.1.3/docs/EVIDENCE_REPORTS.md)
for the published report trio. The aggregate query and context/read-confirm pair
shipped in verified `0.1.4`; see its
[versioned guide](https://github.com/pegma-dev/knowledge-base/blob/v0.1.4/docs/EVIDENCE_REPORTS.md).
The answering read-batching `0.1.5` release is also verified. Actual client/host
acceptance remains open.

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
[release procedure](https://github.com/pegma-dev/knowledge-base/blob/v0.1.3/docs/RELEASING.md).
The report-trio contract links above retain verified `v0.1.3`; aggregate query
and context-pair support shipped in verified `v0.1.4`. The answering
read-batching `0.1.5` release has its own verified receipt; changed source
requires its own review and current-head gates.
Source readers can use the
explicitly moving
[DEVELOPMENT documentation on main](https://github.com/pegma-dev/knowledge-base/blob/main/docs/HOST_COMPOSITION.md)
while preparing a release. The versioned contract references remain tag-pinned;
the DEVELOPMENT link is a source-reader fallback.

Built in the open by RetireGolden, LLC.
