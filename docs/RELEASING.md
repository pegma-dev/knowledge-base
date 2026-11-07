# Release operations

## Status and release boundary

The release set is exactly these packages, in dependency order:

1. `@pegma/knowledge-base-contracts`
2. `@pegma/knowledge-base-core`
3. `@pegma/knowledge-base-application`
4. `@pegma/knowledge-base-mcp`

All four have synchronized source version `0.1.0` and remain unpublished.
[KB-04 source](https://github.com/pegma-dev/knowledge-base/pull/5) is merged at
`b61fc77aedd22e888ac7292c3597f93e54fcda8e`; its Node 22/24 lanes passed 372 tests
each and the official-SDK authenticated synthetic protocol proof. KB-05's source
candidate supplies local D1 conformance, public synthetic composition, and the
release tooling.
Changed source still needs all current-head gates before release preparation.
No source merge configures publishers, creates a tag/release, or publishes npm
packages. Follow the [maintainer bootstrap handoff](BOOTSTRAP.md) for first use.

[Agent Access](https://github.com/pegma-dev/agent-access/pull/1) is a separate
release. Its reviewed commit `a444e2113db98455b638b2ef8aa7c2faccb16b62` is built
only in `agent:proof`'s isolated test consumer with the four KB tarballs and
official MCP SDK `1.32.2`. Its merged 123-test source result does not publish it.
Production hosts require exact published versions of both components.

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

After the complete gate, prepare from that exact clean checkout. The example
uses the current source version; substitute the full approved commit SHA:

```sh
node scripts/release-packages.mjs prepare --tag v0.1.0 --expected-commit FULL_COMMIT_SHA
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

These external settings must be configured and recorded by the maintainer:

- ownership and organization publishing permission for all four npm names;
- protected `origin/main`, immutable release tags, and approved SSH signers in
  the reviewed `RELEASE_ALLOWED_SIGNERS` repository variable;
- the GitHub `npm-publish` environment with required approval and release-ref
  restrictions;
- a separate npm trusted publisher for each package, bound to
  `pegma-dev/knowledge-base`, `publish.yml`, and `npm-publish`;
- explicit permission for direct `npm publish`, plus restrictions disallowing
  token-based publishing. There is no repository npm token or token fallback.

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
node scripts/release-packages.mjs preflight --prepared-dir PREPARED_DIRECTORY --manifest-sha256 INDEPENDENT_SHA256 --tag v0.1.0 --expected-commit FULL_COMMIT_SHA
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
`11.18.0` `npm-cli.js` and `RELEASE_NPM_VERSION=11.18.0`. Standalone `verify`
also needs that reviewed CLI path; use the pinned npm artifact and SHA-256 from
the workflow. The read-only `preflight` command needs no npm authentication.
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

## Consumers and retained host gates

KB publication precedes SD-02. Before real host assembly, verify both the exact
KB release set and the separately published Agent Access dependency. Git
branches, copied source, local paths, and unpublished production tarballs do
not substitute for registry releases.

P-00 and PG-01/RG-01 still require actual existing-login/current-Admin consent,
every requested client/mode, host-attested staging evidence, and credential and
evidence failure cases on both hosts. Source, emulator, SDK, registry, and
provenance results cannot close those gates. Staff approval/publication,
privacy, isolation, bounded work, and full human workflows remain required
before activation, A-01, and either supervised pilot. Keep private host
configuration and operational evidence in the owning private systems.
