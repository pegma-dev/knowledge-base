# KB-05 source preparation

## Scope and readiness

KB-05 source preparation supplies a real local D1 consumer fixture, a public
synthetic composition, and exact-artifact release tooling. The earlier fixture
slice is [merged](https://github.com/pegma-dev/knowledge-base/pull/4), and
[KB-04 source](https://github.com/pegma-dev/knowledge-base/pull/5) is merged at
`b61fc77aedd22e888ac7292c3597f93e54fcda8e`. That source passed 372 tests on each
Node 22/24 lane and the separate authenticated official-SDK protocol proof.
These are historical merged-source results; current changes require fresh
current-head gates. All four KB packages remain unpublished at synchronized
source version `0.1.0`.

| Evidence area    | This source slice                                                        | Separate remaining proof                                                                          |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Storage consumer | Shared public KB suites on memory, local Azurite, and local Miniflare D1 | Production Azure/Workers configuration, operations, and host acceptance                           |
| Composition      | Runnable fictional author/evidence/review/publication/retrieval flow     | Real host identity, staging verification, existing-login/client acceptance, and UI                |
| Artifacts        | Four-package checks and signed-tag preparation with a schema-2 manifest  | First publication, trusted-publisher setup, registry integrity/provenance, and released consumers |
| Task readiness   | Current-head repository gates establish source readiness                 | Actual publication and two-host/client acceptance remain separately recorded                      |

The historical result above does not certify this working tree. Record verified
current-head gate results before treating changed source as validated.
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
| Repository toolchain             | Node 22.6.0+ or 24, `pnpm@10.34.5`       |

The source example uses `node --experimental-strip-types`, introduced in
[Node 22.6.0](https://nodejs.org/en/blog/release/v22.6.0). The root development
engine floor is therefore `>=22.6.0`. Published package engines remain `>=22`;
the CI matrix continues to track current Node 22 and 24.

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
pnpm run agent:proof
```

The CI workflow runs those checks, including the synthetic example and KB-04's
separate protocol proof, on Node 22 and 24. A local run does not substitute for
required current-head CI, a clean OpenRouter review with zero actionable
findings, or applicable security checks. Adapter conformance does not certify production throughput,
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

## Separate authenticated transport proof

The partial KB-05 composition above still uses synthetic resolved contexts.
KB-04's `pnpm run agent:proof` separately composes the real
[AUTH-01 source](https://github.com/pegma-dev/agent-access/pull/1), pinned to
reviewed public commit `a444e2113db98455b638b2ef8aa7c2faccb16b62`, with all four
KB tarballs and official MCP SDK `1.32.2` in an isolated temporary consumer.
The pinned source build is test-only. It does not become an unpublished
production dependency or authorize host installation.

That gate exercises OAuth and the exact five-tool draft/read/write/requirements/
evidence flow, shared HTTP/MCP behavior, and rejection cases. The evidence
attester must bind the authenticated actor and runner to the exact article
revision/content hash, staging build, execution result, and opaque receipt;
an authenticated agent's claimed `passed` result remains untrusted data.
KB-04's merged-source result records execution; changed source requires fresh
current-head results.
See [agent workflow](AGENT_WORKFLOW.md) for the retained source and host gates.

## Remaining gates

KB-04's source exit is merged; it does not establish actual clients or two-host
authentication/staging acceptance. Those gates remain open in P-00 and
PG-01/RG-01. Every requested client/mode must
record discovery, existing-login/current-Admin consent, the five operations,
and credential/evidence failures on each host using published dependencies.
Synthetic source/SDK success cannot close those activation prerequisites.

KB-05's release tooling separates development pack checks from strict release
preparation. The latter verifies a clean checkout, approved signed annotated
version tag, exact commit and main ancestry; a schema-2 manifest binds all four
tarballs and must be checked against an independently retained digest. Registry
preflight covers the complete release set before a publish, permits recovery
only for identical existing artifacts, and released-consumer checks use the
public registry. See [release operations](RELEASING.md) and the concrete
[bootstrap handoff](BOOTSTRAP.md).

Source readiness leaves package ownership, protected tags/environments, approved
signers, first maintainer 2FA publication, per-package trusted publishers,
registry integrity/provenance verification, and released consumers pending.
Manual bootstrap is not OIDC provenance. Agent Access has its own publication
prerequisites, also required before host assembly; AUTH-01's merged source at
`a444e2113db98455b638b2ef8aa7c2faccb16b62` and its 123-test source result do
not publish it. SD-02 waits for KB publication, and both hosts wait for exact
published KB and Agent Access dependencies before their retained acceptance.
Hosts must wait for exact released artifacts rather than adopting branches,
copied source, local paths, or unpublished production tarballs.
