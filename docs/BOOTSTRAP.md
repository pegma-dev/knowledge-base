# First-publication handoff

## Current state and owner

The maintainer owns npm's first-publication and external configuration steps.
All four KB package names are unpublished at synchronized source version
`0.1.0`. No tag, GitHub release, npm publication, publisher setting, or protection
setting is created by merging KB-05 source. Agent Access has its own separate
first-publication process.

This handoff deliberately separates creating the npm names from the first
advertised trusted release. Manual maintainer 2FA publication does not establish
OIDC provenance. It cannot be substituted for the strict `verify` result in
[release operations](RELEASING.md).

## Prepare the initial exact set

1. Confirm ownership and publishing permission for all four names. Record the
   maintainer responsible for each package and its 2FA publication. Keep
   credentials and one-time codes out of repository files and logs.
2. Merge reviewed source and exact pins to protected `origin/main`. Record the
   full commit and passing current-head Node 22/24 gates, clean OpenRouter
   review, and applicable security results. Configure approved signers and
   protected immutable `v*` tags outside this source change.
3. The maintainer creates the approved signed annotated `v0.1.0` tag targeting
   that merged commit. In a clean complete checkout at the tag, configure the
   approved signer verification and run strict preparation. Use the reviewed
   npm `11.18.0` artifact and hash from `publish.yml`, with `RELEASE_NPM_CLI`
   pointing to its absolute `npm-cli.js` path and
   `RELEASE_NPM_VERSION=11.18.0`, or use the workflow's prepare-only dispatch:

   ```sh
   node scripts/release-packages.mjs prepare --tag v0.1.0 --expected-commit FULL_COMMIT_SHA
   ```

4. Independently record the emitted manifest SHA-256, source identity, artifact
   directory, and the four tarball hashes. Retain the prepared directory intact.
   Obtain the digest from the trusted preparation output, not from a file
   bundled alongside downloaded tarballs. The workflow's prepare-only manual
   dispatch can supply immutable artifacts and independent job outputs.
5. Run read-only full-set preflight with that independent digest:

   ```sh
   node scripts/release-packages.mjs preflight --prepared-dir PREPARED_DIRECTORY --manifest-sha256 INDEPENDENT_SHA256 --tag v0.1.0 --expected-commit FULL_COMMIT_SHA
   ```

   Every existing exact version must match the prepared metadata and downloaded
   tarball bytes. Only HTTP 404 establishes absence. Stop for any mismatch,
   access failure, or uncertain registry response.

## Maintainer 2FA bootstrap

Publish only the exact prepared tarballs, in this order, using the maintainer's
interactive npm login and 2FA. Commands below are the handoff for that operator;
they are not CI steps and must not be run by a source-preparation agent:

```sh
npm publish PREPARED_DIRECTORY/pegma-knowledge-base-contracts-0.1.0.tgz --access public --ignore-scripts --tag bootstrap
npm publish PREPARED_DIRECTORY/pegma-knowledge-base-core-0.1.0.tgz --access public --ignore-scripts --tag bootstrap
npm publish PREPARED_DIRECTORY/pegma-knowledge-base-application-0.1.0.tgz --access public --ignore-scripts --tag bootstrap
npm publish PREPARED_DIRECTORY/pegma-knowledge-base-mcp-0.1.0.tgz --access public --ignore-scripts --tag bootstrap
```

Use the filenames from the verified manifest. Do not publish from source
directories or add a token fallback. Rerun full-set preflight before continuing
an interrupted bootstrap. Skip an existing member only after preflight confirms
the identical prepared bytes; npm versions are immutable. After all four exist,
repeat preflight to record the registry metadata and downloaded-byte match.
Retain the manual publication receipts and bootstrap integrity record, with
provenance explicitly recorded as absent. Do not advertise this bootstrap as
the released dependency set or authorize host installation from it.

## First advertised trusted release

After the names exist, the maintainer configures all four trusted publishers,
the protected `npm-publish` environment, approved signers, and immutable tag
protection as described in [release operations](RELEASING.md). Each npm publisher
must name this repository's exact `publish.yml` workflow and environment and
explicitly permit direct publishing. Time new configurations to the prepared
trusted release so their first-use expiry does not strand the release.

The first advertised release needs a separately reviewed synchronized version
and exact dependency-pin change. This source change chooses no future version
and performs no bump. A previously manually published version cannot be
republished through OIDC to add provenance. Run the full review/Node 22/24 gate
for the newly reviewed commit, create its approved signed annotated version tag
on `origin/main`, then create its GitHub release with `--verify-tag` to trigger
the trusted workflow. It prepares once, checks the independent artifact binding,
preflights all four names, and publishes only missing exact tarballs.

Advertise availability only after its separate unprivileged strict `verify` job
succeeds for the entire set:
registry bytes/dependencies, clean exact-version registry consumer, registry
signatures, and matching source/workflow/tag/commit provenance. Preserve those
results with the release identity and independent manifest digest. SD-02 waits
for this published KB set; both hosts additionally require published Agent
Access and their retained actual login/Admin-consent/client/staging acceptance.
