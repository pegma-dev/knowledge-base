# Public KB conformance fixtures

The current verified Knowledge Base release is
[`0.1.7`](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.7).
The `0.1.8` source candidate remains unpublished.

The application/storage/review and retrieval/bounds/maintenance/regression
suites under `tests/` share `application-stores.ts`. They target Storage Core's
real memory store, its released Azure Tables adapter connected to local
Azurite, and the released Cloudflare D1 adapter connected to real local
Miniflare D1. Every factory call is awaited, including calls that create
several stores in one test. They use actual contracts/core, Authorization Core
checks, declared codecs, and public application entry points. No parallel KB
repository or custom authorization engine is supplied.

`application-fixtures.ts` supplies wholly fictional resolved `AccessContext`
values, a controlled clock, and scripted external evidence/source verifiers.
The receipt fixture binds its permitted reply to the exact actor, revision,
submission and governance configuration. It is a test double for a host trust
boundary, not a production attestation or credential implementation. Evidence
times follow the draft being tested; malformed-time cases call the public
service directly instead of using the successful-staging helper.

Upgrade tests use the dev-only exact registry alias
`@pegma/knowledge-base-application-previous` to
`npm:@pegma/knowledge-base-application@0.1.1` to write real legacy records before
the candidate reads them. The lockfile integrity pin matches the previously
verified `0.1.1` artifact; no copied source or branch supplies this writer.
The current four-package verified KB release is `0.1.7`, and the Agent Access
protocol-proof pin remains `0.1.1`. Tests exercise the current working tree;
changed-source gates are separate from immutable published-release evidence.

`trace-store.ts` delegates every record operation to the supplied real store.
Its transaction interception adds refusals or a manual race barrier; captured
traces are observations, not another persistence implementation. The race
case permits a cross-partition policy update to race article publication and
asserts that current-policy serving denies the stale publication. It does not
claim cross-partition CAS or atomic policy revocation.

`azurite.ts` starts a local table-only emulator on port 10212, distinct from
Support Desk's tests. Test tables have unique random names. The well-known
development-account connection is local-only; no cloud credentials or actual
customer data are used. Temporary emulator data is removed only after checking
that the resolved path belongs to the expected temporary-directory prefix.

`d1.ts` creates a fresh Miniflare runtime and UUID database per factory call,
including two calls within one test. Its real `getD1Database("DB")` binding is
passed directly to `createCloudflareD1Store`, without a facade or cast.
`cf: false`, loopback/ephemeral port, and `d1Persist: false` keep this a local
fixture. It does not exercise a live Workers deployment or Cloudflare account.
Exact pins and the fixed compatibility date are in
[source preparation](../docs/SOURCE_PREPARATION.md#pinned-local-d1-consumer).

D1 cleanup is registered with `onTestFinished` before native construction or
binding lookup. Initialization failure immediately uses the same memoized
asynchronous disposal path as normal test completion; cleanup errors remain
visible. Create D1 fixtures only inside a Vitest test. Do not share a runtime
between tests or omit awaiting a factory/disposal. The isolation suite uses
the same article IDs in independently created stores and verifies public
publication/retrieval/retirement behavior without inspecting storage.

Vitest is bounded to four workers, a default 180-second test watchdog, and
30-second hooks; D1's disposal hook also has a 30-second limit. The complete-history
Miniflare D1 case in `retrieval-confirm-read-plan.test.ts` uses a 300-second total
fixture watchdog for local construction, transport and readback. That exception
preserves its measured hard limits of 50 D1 calls and 100 parameters per statement,
and its at-most-seven-call confirmation target. It is not a production latency or
whole-host budget qualification. CI jobs on Node 22/24 each have a
30-minute timeout. The workspace allows only the pinned `workerd` install
script. These controls bound local native tooling, not production capacity.
Windows local elapsed time includes Node-to-workerd RPC and setup overhead;
it does not certify production D1 latency. A longer execution budget still
requires every assertion and cleanup step to succeed.

`tests/composition.test.ts` runs the repository-owned fictional example over
the same three factories. The example imports no test helper. Its private
receipt registry matches exact immutable synthetic run bindings; it is not a
production credential or staging-verification implementation. See the
[example README](../examples/composition/README.md).

Use Node 22.6.0+ or 24 for repository development and the TypeScript example.
Run a focused application subset after building the workspace packages:

```sh
pnpm exec vitest run tests/application.test.ts tests/application-storage.test.ts
```

The complete repository gate also runs the retrieval, regression, composition,
and isolation suites plus `pnpm example` and artifact checks. A current-head
gate report supplies pass counts and verdicts; configured fixtures alone do
not assert a passing run.

The domain/storage suites exercise KB-02/KB-03 source and partial KB-05 consumer
preparation. Agent transport suites add KB-04 HTTP/MCP parity and boundary
coverage; `pnpm run agent:proof` separately exercises the actual SDK with exact
registry `@pegma/agent-access@0.1.1` and four packed KB candidate artifacts in a
fresh isolated synthetic consumer. These results do not
establish actual site logins or target-client application acceptance.
Local storage tests establish no browser UI, live
Workers/host acceptance, model-provider settings, production throughput, or
retention operations. All four KB `0.1.0` packages completed manual bootstrap
without OIDC provenance. The four-package KB `0.1.1` trusted release has a
[historical receipt](../docs/BOOTSTRAP.md#historical-verified-011-release), followed
by the [historical verified `0.1.2` release](../docs/BOOTSTRAP.md#historical-verified-012-release)
and [verified `0.1.3` release](../docs/BOOTSTRAP.md#current-verified-013-release).
The later [`0.1.4` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.4)
is qualified. Synchronized `0.1.5` has also completed verified trusted publication
for answering read batching; see the [retained receipt](../docs/BOOTSTRAP.md#current-verified-015-release).
Changed-source and host activation gates remain open.
