# Packed local agent protocol proof

Run `pnpm run agent:proof` from the repository after
`pnpm install --frozen-lockfile`, on Node 22.6+ or Node 24. Git and npm must be
available. The proof needs public GitHub and npm registry access and binds an
ephemeral listener to `127.0.0.1` only. Both component configurations explicitly
enable `allowInsecureLoopback` for this test.

This is an independently reproducible, **test-only source composition**. It
exercises the actual MCP TypeScript SDK `1.32.2`, Sessions `0.2.0`, Authorization
Core `0.4.0`, Storage Core `0.4.0`, Agent Access and all four KB tarballs. It does
not establish any of the four target client applications, a deployed host,
real browser login, real staging execution, first publication, or host activation.
Those acceptance tasks remain open.

## Artifact boundary

The [orchestrator](../../scripts/agent-protocol-proof.mjs):

1. Bootstraps exactly `pnpm@10.34.5` inside its bounded temporary directory.
2. Runs KB `release:check`, then packs contracts, core, application and MCP.
3. Clones the public
   [Agent Access repository](https://github.com/pegma-dev/agent-access), checks out
   the reviewed, publicly merged commit
   [`a444e2113db98455b638b2ef8aa7c2faccb16b62`](https://github.com/pegma-dev/agent-access/commit/a444e2113db98455b638b2ef8aa7c2faccb16b62),
   verifies its exact HEAD and declared package manager, installs its frozen
   lockfile, builds, and packs its package.
4. Installs those five tarballs and the exact released SDK/Pegma dependencies
   into a fresh npm consumer, with installation scripts disabled.
5. Copies only the [protocol fixture](../../scripts/agent-protocol-fixture.mjs)
   into that consumer and executes it. Component code is loaded exclusively
   through installed public package entrypoints.
6. Closes native client and server resources and removes the verified owned
   temporary directory, including producer, toolchain, consumer and tarballs.

Agent Access is currently unpublished. Its immutable producer is a dev fixture,
not a root dependency, runtime dependency, workspace package, copied auth source,
lockfile substitution, or production release substitute. The proof performs no
deployment, tagging, release creation or publication. It does not claim that
the producer's own review/validation gates were rerun; its immutable public merge
is the producer provenance boundary.

For a preexisting local checkout, the optional `AGENT_ACCESS_SOURCE` environment
variable avoids a network clone. Its HEAD must equal that same exact reviewed
commit. The script clones its committed Git objects into the temporary directory;
it never installs, builds, checks out, or edits the supplied checkout, and never
consumes its uncommitted files. Omitting this variable uses the public repository.

## Actual protocol and application path

The fixture composes `createAgentAccess`, `createAgentAccessHttp` and
`createProtectedResourceAuthenticator` with released Sessions, Authorization Core
and Storage Core. The seeded fictional Admin browser session represents a login
already completed by a host. Cookie/session lookup, same-origin approval and a
per-session CSRF value guard approval; a desktop bearer cannot establish browser
identity. The required request-limiter port is explicitly an always-allow
synthetic input, with no distributed-limiting claim.

The host registers a public client and the three exact `knowledgeAgentScopes`
values, mapping each scope to the same named KB permission. Every protected
request and command retry receives newly authenticated Agent Access authority:
`{ access, scopes, clientId, resource }`. No request body supplies access context.
Current Admin demotion invalidates active credentials at the real issuer.

An actual SDK `Client` and `StreamableHTTPClientTransport`, using an
`OAuthClientProvider` for the pre-registered public client, perform:

- An unauthenticated MCP initialization, protected-resource and issuer discovery,
  S256 PKCE authorization, fictional browser consent, a loopback callback, and
  authorization-code exchange using the saved SDK verifier.
- Initialization and `tools/list`, asserting exactly the five v1 tools and no
  review, publication, provenance, private-evidence read or administration tools.
- Draft creation, authorized draft read, revision-creating update, validation
  requirement read and exact-revision evidence submission through actual MCP.
- HTTP/MCP DTO parity and identical-command historical retry acknowledgements
  across both transports.
- Wrong-resource token, expired credential, revoked credential and current
  Admin-demotion rejection before either transport invokes the application,
  including attempted command replays. A separate code exchange checks wrong
  PKCE rejection. Actual SDK refresh rotates both access and refresh credentials.
- Separate HTTP device authorization, pending and slow-down responses,
  browser-session consent, actual token redemption and protected KB read.

The KB's actual application bootstraps a private collection, validation policy
and governance configuration. The synthetic runner independently recognizes the
exact known revision/build/procedure and executes a small fictional CSV export
check. Only that runner writes an opaque receipt registry. The verifier compares
the authenticated actor, trusted runner, build, complete article, complete
submission and authoritative governance against that registry before returning
an attestation. It rejects modified runner/build/result/steps/artifact claims;
it never authenticates evidence by echoing a caller's `passed` string. This
registry remains a fictional host trust input, not real staging-run evidence.

Draft DTO checks exclude private evidence, attestation, provenance and review
records. No review or publication is performed. Guides and evidence content,
receipts, tokens, codes, verifiers, browser cookies and full authorization URLs
are never printed.

## Safe result and failure diagnostics

Success prints one JSON receipt containing only booleans and numeric counts,
including `packedPackages: 5`, `tools: 5`, `draftRevision: 2`,
`liveHostsProven: false` and `targetClientAppsProven: 0`. Native command output is
captured and suppressed. Failure prints only `passed: false` and a numeric
`stage`, plus a numeric `fixtureStage` when available:

| Stage         | Work                                             |
| ------------- | ------------------------------------------------ |
| 1             | Isolated pinned pnpm bootstrap                   |
| 2             | KB release check and tarballs                    |
| 3             | Immutable Agent Access preparation               |
| 4             | Clean consumer installation                      |
| 5             | Protocol fixture                                 |
| Fixture 10–18 | Host/application bootstrap                       |
| Fixture 20    | SDK discovery, browser approval and exchange     |
| Fixture 30    | Tools, drafts, retries and DTO parity            |
| Fixture 40    | Validation requirements and receipt verification |
| Fixture 50    | Wrong resource and wrong PKCE                    |
| Fixture 60    | Expiry, refresh and revocation                   |
| Fixture 70    | Device authorization                             |
| Fixture 80    | Current Admin demotion                           |

Bootstrap substages are application factory 11, collection 12, validation
policy 13, governance 14, session 15, listener 16, issuer 17 and adapters 18.

The repository CI runs this same proof on Node 22 and Node 24. Real-host
activation and the four target-client compatibility records require separate
supervised evidence.
