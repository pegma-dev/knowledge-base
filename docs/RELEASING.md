# Release operations

## Status and release boundary

The release set is exactly these packages, in dependency order:

1. `@pegma/knowledge-base-contracts`
2. `@pegma/knowledge-base-core`
3. `@pegma/knowledge-base-application`
4. `@pegma/knowledge-base-mcp`

All four `0.1.0` packages completed manual bootstrap with exact-byte postflight
at **2026-11-07T21:56:24Z**, without OIDC provenance. The first advertised trusted
KB release, `0.1.1`, completed strict complete-set registry/signature/provenance
and clean-consumer verification at **2026-11-07T23:35:31Z**. The
[historical release receipt](BOOTSTRAP.md#historical-verified-011-release) retains its
reviewed head, merged source, signed tag, immutable artifact/digests, successful
attempt-5 workflow, and separate unprivileged verification job.
The historical SD-03 KB `0.1.2` release, at signed source
`004044bfa836b74a61fb5defa49d5ebab1fe37dd`. Its separate
[strict verification job](https://github.com/pegma-dev/knowledge-base/actions/runs/42436081951/job/128617897564)
completed complete-set registry/signature/provenance and clean-consumer checks
at **2026-11-08T03:39:55Z**; the
[historical receipt](BOOTSTRAP.md#historical-verified-012-release) retains its
source/tag and original prepared artifact bindings.

The historical verified release is [`0.1.3`](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.3)
at signed source `8b4c25aa6a40f0c56be97f07e3b7b5ac6136a99b`. All four exact
registry packages passed signature/provenance and public-consumer qualification;
the [receipt](BOOTSTRAP.md#current-verified-013-release) distinguishes original
writer attempts 1–4 from the final successful attempt 5 and binds the unchanged
original prepared artifact.

The historical verified `0.1.4` release is
[retained separately](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.4). All four
packages were qualified against their signed-source preparation, with registry
signatures, source provenance and public-consumer verification. The public
release retains the original preparation archive and verification summary,
including the original writer attempts and final recovery. It ships governed
authoring-context reads, report queries and bounded resumable repair.
The [historical local receipt](BOOTSTRAP.md#current-verified-014-release) retains
that release's separate publication boundary under its preserved anchor.

The current verified release is
[`0.1.5`](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.5), the
synchronized answering read-batching patch at signed source
`6dae20df8dace50ad961d9c5fe8d28c90bf4918f`. All four registry packages completed
exact-byte, signature/source-provenance and public-consumer qualification. The
[final attempt-5 verification job](https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/job/129895026059)
and [current receipt](BOOTSTRAP.md#current-verified-015-release) bind the unchanged
original artifact and manifest. Original writer attempts 1 through 4 remain
failed records; the final publisher uploaded zero packages and skipped four
identical versions. The earlier gates/preparation were carried, not rerun in
attempt 5. Existing release receipts remain historical contracts; do not relabel
their source or artifacts as `0.1.5`. Grouped reads establish no universal backend
query or CPU budget. Host dependency adoption and acceptance remain separate.
[KB-04 source](https://github.com/pegma-dev/knowledge-base/pull/5)
and [KB-05 release preparation](https://github.com/pegma-dev/knowledge-base/pull/6)
are merged. The separate earlier [partial KB-05 source slice](https://github.com/pegma-dev/knowledge-base/pull/4)
supplied local D1 conformance and public synthetic composition; PR #6 added
release tooling. The canonical [historical source-gate record](SOURCE_PREPARATION.md#historical-source-gates)
identifies reviewed heads separately from merge commits and retains exact
CI links, counts, review, and security receipts. The verified `0.1.3` publication
is a separate receipt, not a claim about changed candidate source.
Changed source still needs all current-head gates before release preparation.
No source merge configures publishers, creates a tag/release, or publishes npm
packages. The [maintainer bootstrap ledger](BOOTSTRAP.md) retains the actual
manual commands/stdout, exact identities, preparation runs/artifacts, and
independently retained digests. The qualified release versions are KB `0.1.5`
and Agent Access `0.1.1`. The manual `0.1.0` bootstraps and their dated dist-tag
observations remain historical integrity receipts without OIDC provenance.

[Agent Access](https://github.com/pegma-dev/agent-access) is a separate release.
Its `0.1.1` trusted publication and strict registry verification completed at
**2026-11-07T22:32:42Z** for signed source
`ffe4d8616632ce9d057caaf65124746f03d4d349`. The
[verified prerequisite receipt](BOOTSTRAP.md#verified-agent-access-prerequisite)
retains its exact artifact/digest, successful attempt-2 workflow, and unprivileged
verification job. That public producer prerequisite is closed.
The active `agent:proof` installs exact registry `@pegma/agent-access@0.1.1`
with four packed KB artifacts and official MCP SDK `1.32.2` in a fresh consumer.
The KB `0.1.5` release has completed its own current-head gates, review, trusted
publication and strict verification. Future changed source and proof code require
their own current-head gates; historical results do not validate changed
composition. Production hosts require verified trusted versions of both
components and their separately retained acceptance.

## Verified 0.1.6 release

All four [`0.1.6` packages](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.6)
completed verified trusted publication for MCP extension metadata compatibility.
The adapter accepts bounded opaque `params._meta` values used by native clients.
An optional `progressToken` must be a string of at most 128 characters or a safe
integer, without a registered-value allowlist. Strict tool arguments, current
authorization and existing complete-message limits remain unchanged. The
release adds no tool, scope, durable record, credential or migration. The generic
SDK error-response mapping is unchanged.

Existing release receipts, tag links and tarballs retain their original
identities. Host and native-client acceptance remain separately gated.

## Unpublished 0.1.7 candidate

All four source package versions and exact internal pins are synchronized at
`0.1.7`. The candidate adds the required `receipt: string` to the existing staff
`KnowledgeReportView` for its authenticated canonical report receipt. Authorized staff workflows can associate Support
test results with the exact report receipt and check its revocation when another
authorized staff member recorded the decision. The existing verifier and
owner-only status behavior remain unchanged. The candidate adds no tool, scope,
role or durable state.

The current qualified release remains `0.1.6`. Combined candidate source requires
current-head Node 22 and 24 gates, review, signed-tag preparation, trusted
publication and strict complete-set registry verification before adoption.
Host and native-client acceptance remain separately gated. Read the
[application upgrade note](../packages/application/README.md#unpublished-017-candidate) for the receipt boundary and synchronized graph.

## Repository and development artifact gates

Use Node 22.6.0+ or 24 with `pnpm@10.34.5`. Published package engines remain
`>=22`; the development floor supports the source example's type stripping.
The complete gate runs on current Node 22 and 24:

```sh
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run check
pnpm test
pnpm example
pnpm run release:check
pnpm run agent:proof
```

Require clean current-head OpenRouter review with zero actionable findings and
all applicable security checks. Absent, skipped, pending, or failing gates do
not authorize release. `pnpm test` includes `pnpm run test:release`, which covers
release identity, manifest integrity, strict arguments, and registry failure and
recovery cases. Both Node lanes must execute those regressions.

`release:check` builds on each package's `prepack`, packs all four using npm,
and verifies synchronized stable versions, exact dependency pins, ESM exports,
package-local README/MIT LICENSE, and compiled-test exclusion. It checks the
artifact file allowlist, runtime/type entry points, SHA-1, and SHA-512 integrity.
An isolated consumer outside the workspaces installs all four tarballs with
scripts disabled, resolves released external dependencies, imports the public
packages, and initializes the MCP adapter to check its packed name/version.
`agent:proof` separately exercises authenticated OAuth/tool/evidence behavior.
Neither check establishes real requested-client or host acceptance.

`pnpm run release:pack` preserves those development artifacts in a new
`.release/knowledge-base-*` directory with a schema-1 manifest. It requires no
release tag and supplies no release identity or provenance. Publication rejects
this development manifest. Use strict `prepare` for a releasable artifact set.

## Strict release preparation

Merge reviewed release source and synchronized version/pin changes to protected
`origin/main` first. Configure immutable protected `v*` tags and approved release
signers outside this source change. A stable `vX.Y.Z` must be a signed annotated
tag whose target matches the synchronized package version and exact expected
commit. The checkout must be clean, at that commit, in the fixed public source
repository, with complete ancestry and the commit contained in `origin/main`.
Signature verification must use independently approved signer configuration.
Neither a lightweight tag nor a tag at an unmerged commit qualifies.

After the complete gate, prepare from that exact clean checkout. In all current
runbook commands, replace `vX.Y.Z` with the approved synchronized release tag,
`FULL_COMMIT_SHA` with its full approved source commit, `PREPARED_DIRECTORY` with
the verified artifact directory, and `INDEPENDENT_SHA256` with the independently
retained manifest digest. The literal `v0.1.0` commands in the bootstrap ledger
are historical receipts, not current release instructions.

Strict `prepare` requires both `RELEASE_NPM_CLI` and
`RELEASE_NPM_VERSION=11.18.0`. The CLI path must be canonical, absolute, and name
a regular `npm-cli.js` file; linked paths are rejected. Extract the reviewed npm
tarball after checking the SHA-256 pinned in the
[npm setup action](../.github/actions/setup-release-npm/action.yml), then set
both variables before standalone preparation. The workflow configures them
automatically. Development `check` and `pack` continue to use ambient npm.

```sh
node scripts/release-packages.mjs prepare --tag vX.Y.Z --expected-commit FULL_COMMIT_SHA
```

An optional `--out EMPTY_DIRECTORY` selects a new empty output directory.
Preparation repeats the strict identity checks and package/consumer checks,
then preserves the four exact tarballs plus `manifest.json`. Its schema is 2:

- `identity`: fixed repository, tag, exact commit, and synchronized version;
- `artifacts`: exactly the four packages in dependency order, with name,
  version, safe filename, byte size, SHA-1, SHA-512 integrity, exact dependencies,
  and bounded file inventory.

The producer emits `prepared-dir`, `manifest-path`, and `manifest-sha256`.
Retain the SHA-256 independently with the approved source identity and job
outputs. A digest copied only from a downloaded artifact provides no independent
binding. Consumers require the digest, tag, and expected commit as explicit
inputs and rehash every tarball. They reject extra or malformed manifest data,
unsafe paths, symlinks, missing files, wrong package order/pins, and changed bytes.
Preparing artifacts does not establish registry availability or provenance.

## Protected trusted-publisher workflow

[Publish](../.github/workflows/publish.yml) prepares on a stable published GitHub
release. The release is created only after the protected signed annotated tag
exists on `origin/main`, using `gh release create vX.Y.Z --verify-tag`.
Its manual `workflow_dispatch` accepts `tag` and `expected_commit` to prepare
and inspect artifacts; manual dispatch cannot publish.

The workflow first verifies tag/event identity, complete main ancestry, and the
approved SSH signature before running repository source. Node 22/24 jobs run
the full gate. The unprivileged preparation job repeats strict verification,
packs once, uploads an immutable artifact, and exposes its artifact ID and
manifest SHA-256 independently. Only the protected `npm-publish` job receives
`id-token: write`. It downloads that exact artifact ID and checks the independent
digest/tag/commit before npm writes. It installs no repository dependencies,
executes no package lifecycle scripts, and does not rebuild or repack.
A separate unprivileged `verify` job has `id-token: none` and installs only
registry packages in its temporary consumer. It verifies bytes, signatures, and
provenance using the same immutable artifact ID and independent digest. Manual
dispatch skips both publishing and registry verification.

All five KB/Agent Access trusted-publisher entries have been configured through
the CLI. Configuration alone does not prove a trusted publish. The maintainer
must verify and record the full external checklist for each release:

- ownership and organization publishing permission for all four npm names;
- protected `origin/main`, immutable release tags, and approved SSH signers in
  the reviewed `RELEASE_ALLOWED_SIGNERS` repository variable;
- the GitHub `npm-publish` environment with required approval and release-ref
  restrictions;
- a separate npm trusted publisher for each package, bound to
  `pegma-dev/knowledge-base`, `publish.yml`, and `npm-publish`;
- explicit permission for direct `npm publish`, with 2FA required and token-based
  publishing disallowed. There is no repository npm token or token fallback.

As checked on 2026-11-07, npm requires Node 22.14.0+ and npm 11.5.1+ for trusted
publishing. New publisher configurations allow staged publishing by default;
direct publishing needs its own permission. A new configuration expires unless
its first successful publish occurs within two days. Create it when the reviewed
trusted release is ready; recreate an expired configuration. The workflow pins
npm `11.18.0`. Recheck the [official npm guidance](https://docs.npmjs.com/trusted-publishers/)
before changing these external settings.

## Preflight, publication, and interrupted-release recovery

The read-only preflight is also the first-publication inspection command:

```sh
node scripts/release-packages.mjs preflight --prepared-dir PREPARED_DIRECTORY --manifest-sha256 INDEPENDENT_SHA256 --tag vX.Y.Z --expected-commit FULL_COMMIT_SHA
```

It validates the schema-2 artifact set, then checks every exact package version
in the public npm registry before any publishing operation. Only an exact
version's HTTP 404 means absent. Authentication/network/server errors, invalid
metadata, wrong names/versions/dependencies, or changed registry tarball bytes
stop the release. Every existing version must match the prepared SHA-1,
SHA-512 integrity, and downloaded bytes.

The protected OIDC job runs:

```sh
node scripts/release-packages.mjs publish --prepared-dir PREPARED_DIRECTORY --manifest-sha256 INDEPENDENT_SHA256 --tag vX.Y.Z --expected-commit FULL_COMMIT_SHA
```

The workflow supplies `RELEASE_NPM_CLI` as an absolute path to its reviewed npm
`11.18.0` `npm-cli.js` and `RELEASE_NPM_VERSION=11.18.0`. Standalone `prepare`
and `verify` also need both variables and the canonical regular CLI path; use
the npm artifact and SHA-256 pinned in the
[npm setup action](../.github/actions/setup-release-npm/action.yml).
The read-only `preflight` command needs no npm authentication.
`publish` additionally requires the matching GitHub release OIDC environment;
local interactive bootstrap uses the maintainer procedure instead.

`publish` repeats full-set preflight before its first npm write. It skips only
identical existing versions and publishes missing packages in the stated
dependency order using the prepared tarballs. A partial release is incomplete.
Preserve its original source identity, independent digest, and artifact bytes;
retry only after the full preflight accepts that same set. Never overwrite a
published version, rebuild a missing member from another checkout, move a tag,
or treat an npm error as proof of absence. Any conflicting existing artifact
requires maintainer investigation and a separately reviewed release decision.

## Registry verification and availability

After `publish`, the separate unprivileged workflow job runs strict verification.
The same command is available independently:

```sh
node scripts/release-packages.mjs verify --prepared-dir PREPARED_DIRECTORY --manifest-sha256 INDEPENDENT_SHA256 --tag vX.Y.Z --expected-commit FULL_COMMIT_SHA
```

All four exact registry versions must exist and match the approved artifact
metadata and downloaded bytes. A fresh consumer installs the four exact
versions from the public registry, without workspace links, local tarballs, or
lifecycle scripts, then checks their public imports.
The pinned npm CLI verifies registry signatures and provenance attestations;
the release verifier requires the attested source repository, workflow, tag,
and source commit to match the prepared identity. Package availability requires
these complete-set results, not a successful upload of one tarball. Preserve
the prepared artifact/digest, source identity, workflow run and verification
results in the release record.

Manual first publication cannot satisfy this trusted-provenance gate. The
[bootstrap handoff](BOOTSTRAP.md) records the required two-step release boundary;
bootstrap integrity checks must not be reported as OIDC provenance.

## Observed npm audit shape: 2026-11-07

A real isolated registry consumer used the installed npm `11.18.0` CLI and exact
`@pegma/spine@0.1.2`, with its known integrity checked and lifecycle scripts
disabled. No package runtime was imported. The command
`npm audit signatures --json --include-attestations` succeeded; the
[official npm audit documentation](https://docs.npmjs.com/cli/v11/commands/npm-audit/#audit-signatures)
documents that flag and its attestation output.

The sanitized observed shape was:

```text
top-level keys: invalid, missing, verified
counts: invalid=0, missing=0, verified=1
verified entry keys: attestationBundles, attestations, location, name, registry, version
attestationBundles: 2 bundles, including one SLSA v1 provenance bundle
bundle keys: dsseEnvelope, mediaType, verificationMaterial
verificationMaterial: certificate.rawBytes, timestampVerificationData, tlogEntries
```

A second isolated run installed all seven exact external runtime pins used by
the two components, resolving 102 packages. Root lock versions and public
registry URLs matched; the real audit reported `invalid=0`, `missing=0`,
and `verified=21`. Lifecycle scripts and runtime imports remained disabled.
This historical check examined the existing external dependency graph without
publishing either new component.

The observed public source was [pegma-dev/spine](https://github.com/pegma-dev/spine)
at `refs/tags/v0.1.2`. This records the pinned CLI's working flag, output, and
certificate shape. It proves no provenance for KB or Agent Access
packages and performs no publisher operation. Their own exact repository,
workflow, tag, and source-commit post-release verification remains mandatory.
Raw bundles and certificate bytes are intentionally omitted.

## Consumers and retained host gates

The verified trusted KB release precedes SD-02. Before real host assembly,
verify both the exact trusted KB release set and the separately released Agent
Access dependency. The manual `0.1.0` bootstraps do not satisfy that gate. Git
branches, copied source, local paths, and unpublished production tarballs do
not substitute for registry releases.

P-00 and PG-01/RG-01 still require actual existing-login/current-Admin consent,
every requested client/mode, host-attested staging evidence, and credential and
evidence failure cases on both hosts. Source, emulator, SDK, registry, and
provenance results cannot close those gates. Staff approval/publication,
privacy, isolation, bounded work, and full human workflows remain required
before activation, A-01, and either supervised pilot. Keep private host
configuration and operational evidence in the owning private systems.
