# KB-05 source preparation

## Scope and readiness

This is an independent, partial KB-05 source-preparation slice. It adds a real
local D1 consumer fixture and a public synthetic composition example over the
existing contracts/core/application packages. It does not finish KB-04 or the
full KB-05 release task. All three KB packages remain unpublished at source
version `0.1.0`.

| Evidence area    | This source slice                                                        | Separate remaining proof                                                                          |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Storage consumer | Shared public KB suites on memory, local Azurite, and local Miniflare D1 | Production Azure/Workers configuration, operations, and host acceptance                           |
| Composition      | Runnable fictional author/evidence/review/publication/retrieval flow     | Real host identity, staging verification, scoped API/MCP credentials, and UI                      |
| Artifacts        | Existing three-package pack/import checks                                | First publication, trusted-publisher setup, registry integrity/provenance, and released consumers |
| Task readiness   | Current-head repository gates establish this slice's evidence            | KB-04 credential/client proof and all remaining KB-05 exit criteria                               |

No test counts or pass verdicts are implied by this document. Record verified
current-head gate results before treating the source slice as validated.
Local emulator and fixture results are not production or live Workers proof.

## Pinned local D1 consumer

The source dependency snapshot was verified on **2026-11-07**. These are exact
repository pins, not a claim about the latest available versions:

| Dependency/configuration         | Pin                                      |
| -------------------------------- | ---------------------------------------- |
| Released D1 adapter              | `@pegma/storage-cloudflare-d1@0.4.1`     |
| Storage contract                 | `@pegma/storage-core@0.4.0`              |
| Local emulator                   | `miniflare@4.20260730.0`                 |
| Miniflare declaration dependency | `@cloudflare/workers-types@5.20260730.1` |
| Locked native runtime            | `workerd@1.20260730.1` (transitive)      |
| Local compatibility date         | `2026-07-28`                             |
| Repository toolchain             | Node 22/24, `pnpm@10.34.5`               |

[test/d1.ts](../test/d1.ts) obtains Miniflare's real `getD1Database("DB")`
binding and passes it directly to the released `createCloudflareD1Store`.
It uses no handwritten SQL/HTTP facade, fake D1 binding, or type cast to hide
an incompatible adapter port. Miniflare owns the local D1 execution and native
runtime; the KB still owns no database implementation. Cloudflare types are
test tooling, not a new public core dependency.

Each factory invocation creates a fresh Miniflare runtime and randomly named
D1 database, even when a test asks for multiple stores. It uses loopback with
an ephemeral port, `cf: false`, and `d1Persist: false`; no live Cloudflare
account or persistent production database participates.

The fixture registers Vitest's `onTestFinished` cleanup before native
construction or binding lookup. A shared memoized asynchronous disposal path
handles both initialization failure and normal completion; cleanup failures
remain visible, including combined setup/cleanup failure. Calling this helper
outside a Vitest test fails before a native runtime can be left behind.
[D1 isolation cases](../tests/d1-isolation.test.ts) exercise factory isolation.

## Shared conformance and bounded execution

[test/application-stores.ts](../test/application-stores.ts) supplies the same
store-factory surface to public KB application, storage, retrieval, and
regression suites. Memory uses Storage Core's real memory adapter; Azurite
uses the released Azure Tables adapter and unique table names; D1 uses the
released D1 adapter above. Tests call public application entry points and the
actual declared codecs. No parallel KB repository or authorization engine is
introduced. [test/README.md](../test/README.md) records fixture usage.

Memory stores are fresh per factory call. Azurite's emulator lifecycle and
guarded temporary-directory cleanup remain in
[test/azurite.ts](../test/azurite.ts). D1's per-factory native disposal is
separate from that global emulator lifecycle. Do not reuse a D1 database for
convenience or omit asynchronous cleanup on a failing test.

Native execution has explicit repository bounds:

| Control           | Bound                         |
| ----------------- | ----------------------------- |
| Vitest workers    | At most 4                     |
| Test timeout      | 180 seconds                   |
| Hook timeout      | 30 seconds                    |
| D1 disposal hook  | 30 seconds                    |
| CI validation job | 30 minutes per Node 22/24 job |

Windows development measurements include local Node-to-workerd RPC and setup
overhead across the real adapter's operations. These bounded budgets allow
that native conformance work; assertions, cleanup, and full current-head gates
still establish correctness. Local elapsed time is not production D1 latency
or a performance certification.

The frozen pnpm workspace explicitly permits only the pinned `workerd`
dependency's install script through `onlyBuiltDependencies`. It does not
authorize unrelated dependency scripts. New workspaces use the normal pinned
installation path:

```sh
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run check
pnpm test
pnpm example
pnpm run release:check
```

The CI workflow runs those checks, including the synthetic example, on Node
22 and 24. A local run does not substitute for required current-head CI or
reviews. Adapter conformance also does not certify production throughput,
retention, backups, network protections, or distributed deployment behavior.

## Public synthetic composition

[examples/composition](../examples/composition/README.md) is repository-owned
fictional source. `createExampleComposition` accepts a host Store (memory by
default), and `runCompleteExampleFlow` exercises the public KB services. The
example imports no test-only helper and contains no commercial host routes,
credentials, customer data, or operational topology.

Its resolved access contexts are synthetic trusted inputs, not authenticated
browser/API requests. A private receipt registry binds immutable serialized
synthetic-run facts to the exact principal, article revision, whole evidence
submission, and governance configuration. The verifier returns a fixed
synthetic attester only after lookup and exact comparison; it does not echo
caller-supplied `passed` or runner identity as proof. This demonstrates the
host trust seam, not a production runner, OAuth server, signature scheme, or
live staging test.

Source checks, review/publication, audience separation, and safe retrieval
still pass through the real application. The example does not establish real
external source-reference eligibility. One UTF-8 byte counts as one fixture
token; that is not a provider tokenizer or billing measurement. No model
provider or GitHub connection is required.

[tests/composition.test.ts](../tests/composition.test.ts) runs the same public
flow through all three store factories and defines negative cases for tampered
evidence, author publication authority, private-data exclusion, bot-only
citations, and retirement with old projection hints. Current-head gate results
remain the evidence of execution.

## Remaining gates

KB-04 must still establish the real scoped/revocable/audience-bound author
credential and protected-resource/client flow. Manually supplied fixture
contexts do not close that prerequisite. The optional API/MCP contract and
real local-client author/test/evidence loop require their own task evidence.

The full KB-05 release candidate still needs its advertised package/adapter
and client criteria, reviewed bootstrap/trusted-publisher configuration, exact
registry publication, artifact/provenance verification, and released consumer
checks. See [release operations](RELEASING.md). No empty adapter package,
release tag, publication, or host activation is created by this source slice.
Hosts must wait for exact released artifacts rather than adopting branches,
copied source, local paths, or unpublished production tarballs.
