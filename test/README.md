# KB-02 application conformance fixtures

The suites in `tests/application.test.ts` and `tests/application-storage.test.ts`
run the same public application commands against Storage Core's real memory
store and its real Azure Tables adapter connected to local Azurite. They use
the actual contracts/core, Authorization Core permission checks, declared
record codec, and application repository. No parallel KB repository or custom
authorization engine is supplied by the fixtures.

`application-fixtures.ts` supplies wholly fictional resolved `AccessContext`
values, a controlled clock, and scripted external evidence/source verifiers.
The receipt fixture binds its permitted reply to the exact actor, revision,
submission and governance configuration. It is a test double for a host trust
boundary, not a production attestation or credential implementation. Evidence
times follow the draft being tested; malformed-time cases call the public
service directly instead of using the successful-staging helper.

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

Run the application conformance suites after building the workspace packages:

```sh
pnpm exec vitest run tests/application.test.ts tests/application-storage.test.ts
```

These tests establish KB-02 service and storage behavior. Passing synthetic
resolved contexts does not establish a real OAuth/MCP credential flow, and
the suites do not establish KB-03 search, browser UI, model-provider settings,
live-host acceptance, production throughput, or retention operations. The full
repository type/test/release gates and later host activation evidence remain
required.
