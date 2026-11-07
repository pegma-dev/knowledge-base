# KB-05 source preparation

## Scope and readiness

KB-05 source preparation has two separately reviewed source slices. The earlier
[partial source slice](https://github.com/pegma-dev/knowledge-base/pull/4)
supplied the real local D1 consumer fixture and public synthetic composition.
The later [release-preparation slice](https://github.com/pegma-dev/knowledge-base/pull/6)
added exact-artifact release tooling. Neither source slice completes full
KB-05 publication or host acceptance.

### Historical source gates

As of **2026-11-07**, [KB-04 source](https://github.com/pegma-dev/knowledge-base/pull/5)
was merged at
[`b61fc77aedd22e888ac7292c3597f93e54fcda8e`](https://github.com/pegma-dev/knowledge-base/commit/b61fc77aedd22e888ac7292c3597f93e54fcda8e).
The historical gate ran on reviewed head
[`c897626de6c7b2ea574f4154b0bc7a7731ee106e`](https://github.com/pegma-dev/knowledge-base/commit/c897626de6c7b2ea574f4154b0bc7a7731ee106e),
not the subsequent merge commit. Its [CI run](https://github.com/pegma-dev/knowledge-base/actions/runs/42390433045)
passed `format:check`, `check`, `test`, `example`, `release:check`, and
`agent:proof` on both Node 22 and 24: each lane ran 372 runtime tests, the
synthetic example, all four packed-artifact imports, and the separate
authenticated five-operation official-SDK protocol proof. The
[final OpenRouter review](https://github.com/pegma-dev/knowledge-base/pull/5#pullrequestreview-5813559169)
recorded a clean verdict with zero `OPEN` findings, and the
[security receipt](https://github.com/pegma-dev/knowledge-base/pull/5#issuecomment-6709727682)
recorded no issues for that same reviewed head.
[CodeQL](https://github.com/pegma-dev/knowledge-base/actions/runs/42390433140)
also passed for that head.

As of **2026-11-07**, [KB-05 release preparation](https://github.com/pegma-dev/knowledge-base/pull/6)
was merged at
[`7f5eee68be692b5489de3965f3f5ede7ef7a812d`](https://github.com/pegma-dev/knowledge-base/commit/7f5eee68be692b5489de3965f3f5ede7ef7a812d).
Its final reviewed head
[`c8ef14af0ec32e3903b9399543b7a9f2e48df2f9`](https://github.com/pegma-dev/knowledge-base/commit/c8ef14af0ec32e3903b9399543b7a9f2e48df2f9)
passed the complete gate in this
[CI run](https://github.com/pegma-dev/knowledge-base/actions/runs/42398508042)
on each Node 22/24 lane:
372 runtime tests plus 128 release regressions (500 per lane, zero skips), the
synthetic example, all four packed-artifact imports, and the authenticated
five-operation official-SDK proof. The merge record retains three OpenRouter
review rounds; final round 3 is clean with zero open actionable findings.
See the [final review](https://github.com/pegma-dev/knowledge-base/pull/6#pullrequestreview-5814111477)
and the [security receipt](https://github.com/pegma-dev/knowledge-base/pull/6#issuecomment-6710997171).
These are historical merged-source results; changed source requires fresh
current-head gates. The historical `0.1.0` absence snapshot below predates the
completed manual bootstrap. All four exact `0.1.0` artifacts passed manual
postflight at **2026-11-07T21:56:24Z**, without OIDC provenance; see the
[operator-recorded bootstrap receipt](BOOTSTRAP.md#recorded-manual-bootstrap-receipt).
Source `0.1.1` is a candidate for the first advertised trusted release, with
its own review, current-head gates, publication, and strict registry/provenance
verification pending.

| Evidence area    | This source slice                                                                   | Separate remaining proof                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Storage consumer | Shared public KB suites on memory, local Azurite, and local Miniflare D1            | Production Azure/Workers configuration, operations, and host acceptance                               |
| Composition      | Runnable fictional author/evidence/review/publication/retrieval flow                | Real host identity, staging verification, existing-login/client acceptance, and UI                    |
| Artifacts        | Four-package checks, schema-2 preparation, and manual `0.1.0` exact-byte postflight | First advertised trusted release with its own registry/provenance verification and released consumers |
| Task readiness   | Current-head repository gates establish source readiness                            | Verified trusted releases and two-host/client acceptance remain separately recorded                   |

The merged-source results above do not certify this working tree. Record verified
current-head gate results before treating changed source as validated.
Local emulator and fixture results are not production or live Workers proof.

## Historical public registry snapshot

At **2026-11-07T18:48:30Z**, unauthenticated exact-version GET requests to the
public npm registry returned these results before the later manual bootstrap:

| Package                             | Exact version | HTTP status |
| ----------------------------------- | ------------- | ----------- |
| `@pegma/agent-access`               | `0.1.0`       | 404         |
| `@pegma/knowledge-base-contracts`   | `0.1.0`       | 404         |
| `@pegma/knowledge-base-core`        | `0.1.0`       | 404         |
| `@pegma/knowledge-base-application` | `0.1.0`       | 404         |
| `@pegma/knowledge-base-mcp`         | `0.1.0`       | 404         |

Reproduce the read-only probe with Node 22/24, for example by piping this
JavaScript to `node --input-type=module`. It requires no install or registry
authentication, requests cache revalidation, rejects redirects, applies a
15-second timeout per request, and cancels each response body:

```js
const names = [
  "@pegma/agent-access",
  "@pegma/knowledge-base-contracts",
  "@pegma/knowledge-base-core",
  "@pegma/knowledge-base-application",
  "@pegma/knowledge-base-mcp",
];
for (const name of names) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/0.1.0`,
    {
      redirect: "error",
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(15_000),
    },
  );
  console.log(`${name}@0.1.0 HTTP ${response.status}`);
  await response.body?.cancel();
}
```

Only HTTP 404 establishes absence of the public exact version. This snapshot
proves no package-name availability, ownership, private registry state, or
publication authority. Other statuses and transport errors are not absence.
The five `0.1.0` versions were subsequently uploaded and passed exact-byte
postflight at **2026-11-07T21:56:24Z**. The normalized commands, verbatim manual
stdout, preparation artifact identities, and independent digests are retained
in the [bootstrap receipt](BOOTSTRAP.md#recorded-manual-bootstrap-receipt).
This earlier 404 snapshot is not their current registry state. Repeat read-only
inspection when needed; strict full-set release preflight remains authoritative
for publication, and trusted-release verification still precedes host assembly.

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

The KB-05 composition above uses synthetic resolved contexts.
The historical KB-04 `pnpm run agent:proof` composed the real
[AUTH-01 source](https://github.com/pegma-dev/agent-access/pull/1), pinned to
reviewed public commit `a444e2113db98455b638b2ef8aa7c2faccb16b62`, with all four
KB tarballs and official MCP SDK `1.32.2` in an isolated temporary consumer.
That source build was test-only. It did not authorize a production dependency
or host installation; the historical source-gate results above retain that
immutable producer evidence.

The active proof now installs exact public-registry
`@pegma/agent-access@0.1.1`, whose trusted release and strict verification
completed at **2026-11-07T22:32:42Z**. The
[verified prerequisite receipt](BOOTSTRAP.md#verified-agent-access-prerequisite)
retains its signed source and exact artifact/provenance record.
The proof composes that one registry producer with four packed KB candidate
artifacts and official MCP SDK `1.32.2` in a fresh temporary consumer, with
lifecycle scripts disabled. It accepts no producer checkout or source fallback.
A local candidate run on **2026-11-07** passed with `packedPackages: 4`,
`registryPackages: 1`, and `exactRegistryProducer: true`; all SDK/OAuth/device
and five-operation positive/negative checks passed. It retained
`liveHostsProven: false` and `targetClientAppsProven: 0`. A separate negative
probe rejected a source override at stage 1 before external commands.
Current-head Node 22/24 CI and the candidate's remaining review/release gates
are still required.

That gate exercises OAuth and the exact five-tool draft/read/write/requirements/
evidence flow, shared HTTP/MCP behavior, and rejection cases. The evidence
attester must bind the authenticated actor and runner to the exact article
revision/content hash, staging build, execution result, and opaque receipt;
an authenticated agent's claimed `passed` result remains untrusted data.
The merged KB-04 and KB-05 source results record execution; changed source
requires fresh current-head results.
See [agent workflow](AGENT_WORKFLOW.md) for the retained source and host gates.

## Remaining gates

KB-04's source exit was merged; it does not establish actual clients or two-host
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

Manual maintainer 2FA bootstrap is complete, and all five KB/Agent Access
trusted-publisher entries have been configured through the CLI. Recheck the
full ownership, protected tag/main, approved signer, approval environment,
per-package publisher binding, direct-publishing, and 2FA/token-policy checklist
in [release operations](RELEASING.md) for the actual trusted release.
Full KB-05 still requires the `0.1.1` candidate's review and current-head gates,
then its own trusted publication, complete-set registry
integrity/signature/provenance verification, and released-consumer proof.
Manual bootstrap is not OIDC provenance.
Agent Access has its own publication history:
[Agent Access release preparation](https://github.com/pegma-dev/agent-access/pull/2)
was merged at
[`eddddd5e333ce16b6a4a8233b84656b3ac784947`](https://github.com/pegma-dev/agent-access/commit/eddddd5e333ce16b6a4a8233b84656b3ac784947).
As of **2026-11-07**, its final reviewed head
[`165e56ab19e9860d6c0bd17f419052b751394b9c`](https://github.com/pegma-dev/agent-access/commit/165e56ab19e9860d6c0bd17f419052b751394b9c),
rather than the merge commit,
passed this [CI run](https://github.com/pegma-dev/agent-access/actions/runs/42399414623).
Its Node 22/24 lanes each passed 123 runtime tests and 136 release
regressions with zero skips; its merge record retains three OpenRouter review
rounds, with final round 3 clean and zero open actionable findings.
See the [final review](https://github.com/pegma-dev/agent-access/pull/2#pullrequestreview-5814178148)
and the [security receipt](https://github.com/pegma-dev/agent-access/pull/2#issuecomment-6711125916).
Agent Access `0.1.0` subsequently completed manual bootstrap and exact-byte
postflight without OIDC provenance. Its verified trusted `0.1.1` release then
closed the public producer prerequisite; see the
[exact receipt](BOOTSTRAP.md#verified-agent-access-prerequisite). The original
source-producer proof remains historical evidence, while the changed registry
composition requires its own current-head gates.
SD-02 waits for the verified trusted KB release, and both hosts wait for exact
verified trusted KB and Agent Access dependencies before their retained acceptance.
Hosts must wait for exact released artifacts rather than adopting branches,
copied source, local paths, or unpublished production tarballs.
