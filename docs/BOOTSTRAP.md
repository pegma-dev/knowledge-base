# First-publication handoff

## Current state and owner

The maintainer owns npm publication and external configuration. All four KB
`0.1.0` uploads were accepted through manual bootstrap, and their exact-byte
postflight passed at **2026-11-07T21:56:24Z**. Agent Access `0.1.0` also completed
manual bootstrap and postflight. Neither bootstrap has OIDC provenance.
Source `0.1.1` is the KB candidate for a separately reviewed first advertised
trusted release; it is not published or verified by this document.
Agent Access has since completed its verified trusted `0.1.1` release, recorded
below; that closes the public producer prerequisite only.

The five KB/Agent Access trusted-publisher entries have been configured through
the CLI. An actual trusted release still requires the reviewed source and
current-head gates, approved signed tag, protected main ancestry, environment
approval, direct-publishing permission, 2FA/token restrictions, and its own
strict registry/provenance verification. See the full external checklist in
[release operations](RELEASING.md).

This handoff deliberately separates creating the npm names from the first
advertised trusted release. Manual maintainer 2FA publication does not establish
OIDC provenance. It cannot be substituted for the strict `verify` result in
[release operations](RELEASING.md).

## Recorded manual bootstrap receipt

The public preparation identities were:

| Producer              | Signed tag and exact source commit                     | Prepare-only workflow                                                               | Artifact ID   | Independently retained manifest SHA-256                            |
| --------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| KB, all four packages | `v0.1.0` at `f053db194eb73610e9b4872e1562f071ab8e6a5f` | [42415793421](https://github.com/pegma-dev/knowledge-base/actions/runs/42415793421) | `13591841615` | `45117cadad75a51aa9b818934974b60c17ba5ddee229fa766157a75035a653ee` |
| Agent Access          | `v0.1.0` at `d4db0065f22a9c090fc2831b3e18fbbc37c1639c` | [42415787142](https://github.com/pegma-dev/agent-access/actions/runs/42415787142)   | `13591317099` | `885d5422930e2dd3435f0ebea02fb74238b946c962715b2b1d81954684a10312` |

The workflows prepared artifacts only. The maintainer separately uploaded the
verified `0.1.0` tarballs with interactive 2FA, using the historical procedure
below. After all five uploads were accepted, the operator ran each producer's
read-only `preflight` at **2026-11-07T21:56:24Z**. The following command blocks
are normalized reproducible forms: `PREPARED_DIRECTORY` replaces the private
local exact-artifact directory. The public identity arguments and digests are
the actual recorded values.

KB command:

```sh
node scripts/release-packages.mjs preflight --prepared-dir PREPARED_DIRECTORY --manifest-sha256 45117cadad75a51aa9b818934974b60c17ba5ddee229fa766157a75035a653ee --tag v0.1.0 --expected-commit f053db194eb73610e9b4872e1562f071ab8e6a5f
```

Operator-recorded stdout, verbatim; exit code `0`:

```text
@pegma/knowledge-base-contracts@0.1.0: skip
@pegma/knowledge-base-core@0.1.0: skip
@pegma/knowledge-base-application@0.1.0: skip
@pegma/knowledge-base-mcp@0.1.0: skip
```

Agent Access command, run with that producer's script:

```sh
node scripts/release-packages.mjs preflight --prepared-dir PREPARED_DIRECTORY --manifest-sha256 885d5422930e2dd3435f0ebea02fb74238b946c962715b2b1d81954684a10312 --tag v0.1.0 --expected-commit d4db0065f22a9c090fc2831b3e18fbbc37c1639c
```

Operator-recorded stdout, verbatim; exit code `0`:

```text
@pegma/agent-access@0.1.0: skip
```

These are manual operator receipts, not CI results. Each `skip` means the
strict postflight accepted the existing exact version's metadata and tarball
bytes against its prepared artifact. This is bootstrap integrity evidence;
it is not the trusted-release `verify` result or OIDC provenance.

At the manual-bootstrap checkpoint, the observed npm `latest` dist-tags resolved
to `0.1.0` despite the publishes using `--tag bootstrap`. An earlier attempt to
delete Agent Access's `latest` tag returned HTTP 400 before its `0.1.1` release.
The four KB packages' `latest` tags still resolve to `0.1.0`; their intended
correction is a verified forward `0.1.1` release.
Agent Access's current `latest` is `0.1.1` and its `bootstrap` remains `0.1.0`.
Neither tag behavior nor package availability advertises the KB bootstrap as
the approved dependency set or authorizes host installation.

## Verified Agent Access prerequisite

At **2026-11-07T22:32:42Z**, Agent Access `0.1.1` completed strict registry and
clean-consumer verification. Its [release PR #4](https://github.com/pegma-dev/agent-access/pull/4)
was merged, and its signed annotated `v0.1.1` tag targets
[`ffe4d8616632ce9d057caaf65124746f03d4d349`](https://github.com/pegma-dev/agent-access/commit/ffe4d8616632ce9d057caaf65124746f03d4d349).
The [trusted workflow run](https://github.com/pegma-dev/agent-access/actions/runs/42420302775)
succeeded on attempt 2. The separate unprivileged
[strict verification job](https://github.com/pegma-dev/agent-access/actions/runs/42420302775/job/128549453970)
recorded this stdout:

```text
Verified registry release and clean consumer for 1 packages.
```

That verification covered exact registry bytes/dependencies, cryptographic
signatures, source-bound provenance, and clean consumer imports. The retained
artifact identity is:

| Field                                   | Value                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Artifact ID                             | `13592934200`                                                                                     |
| Downloaded artifact archive SHA-256     | `8a29c3a60cfe1307d4dd5375d02c36b136bcdd404dcbea256ce32970e26ccbe6`                                |
| Independently retained manifest SHA-256 | `aff861e5e7e62612f42ce7b633519e86b0b5d11712e215f7c33fe5d30ba2198c`                                |
| Prepared producer tarball filename      | `pegma-agent-access-0.1.1.tgz`                                                                    |
| Producer tarball SHA-1                  | `e590e4cfc8dc1c5a44292628099706b0ab919479`                                                        |
| Producer tarball SHA-512 integrity      | `sha512-C8t2kkv2piE9Jxt48hrRj+dYDoBd4BMgyO9JpgBQT5ycr8xZx4hq43DSG9I/KjjPQhEvRhp7obYnZ/IiBme/Jw==` |

The prepared producer filename and tarball hashes come from the independently
digest-bound manifest above in CI artifact `13592934200`. The linked strict
verification job verified that prepared identity against the registry release;
the proof's integrity pin uses those bound bytes rather than live registry
metadata as its trust anchor.

Attempt 1's bounded registry-visibility window elapsed before verification
could observe the release. After the exact version became visible, strict
preflight accepted its identical bytes and the failed-only rerun reused the
original artifact and independent manifest binding. Attempt 2 then completed
verification; no package version or artifact was replaced.

This closes the verified public Agent Access `0.1.1` prerequisite. The KB
protocol proof now composes that exact registry producer with four packed KB
candidate artifacts in a fresh consumer. KB `0.1.1` remains an unpublished
candidate with its own current-head gates, PR, trusted release, and strict
verification pending. Existing-login, current-Admin consent, every requested
client/mode, and both real hosts remain separately unproven.

## Historical initial preparation procedure (`0.1.0`)

The following procedure and literal versioned commands describe the completed
bootstrap. Current trusted-release operations use the placeholders in
[release operations](RELEASING.md); do not rerun a completed publication.

1. Confirm ownership and publishing permission for all four names. Record the
   maintainer responsible for each package and its 2FA publication. Keep
   credentials and one-time codes out of repository files and logs.
2. Merge reviewed source and exact pins to protected `origin/main`. Record the
   full commit and passing current-head Node 22/24 gates, clean OpenRouter
   review, and applicable security results. Configure approved signers and
   protected immutable `v*` tags outside this source change.
3. The maintainer creates the approved signed annotated `v0.1.0` tag targeting
   that merged commit. In a clean complete checkout at the tag, configure the
   approved signer verification. Before standalone preparation, extract the
   reviewed npm `11.18.0` tarball after checking the SHA-256 pinned in the
   [npm setup action](../.github/actions/setup-release-npm/action.yml).
   Explicitly set `RELEASE_NPM_CLI` to the extracted regular `npm-cli.js` file's
   canonical absolute path and set `RELEASE_NPM_VERSION=11.18.0`; both are
   required, and linked paths are rejected. Alternatively use the workflow's
   prepare-only dispatch, which supplies both variables. Then run strict
   preparation:

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

## Historical maintainer 2FA bootstrap (`0.1.0`)

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

The names now exist and all five KB/Agent Access trusted-publisher entries have
been configured through the CLI. Recheck the protected `npm-publish` environment,
approved signers, immutable tag protection, and publishing policy as described
in [release operations](RELEASING.md). Each KB npm publisher
must name this repository's exact `publish.yml` workflow and environment and
explicitly permit direct publishing. Time new configurations to the prepared
trusted release so their first-use expiry does not strand the release.

The first advertised KB release candidate is synchronized version `0.1.1` with
exact internal dependency pins. It still needs review and all current-head
gates before release. A previously manually published version cannot be
republished through OIDC to add provenance. Run the full review/Node 22/24 gate
for the newly reviewed commit, create its approved signed annotated version tag
on `origin/main`, then create its GitHub release with `--verify-tag` to trigger
the trusted workflow. It prepares once, checks the independent artifact binding,
preflights all four names, and publishes only missing exact tarballs.

Advertise availability only after its separate unprivileged strict `verify` job
succeeds for the entire set:
registry bytes/dependencies, clean exact-version registry consumer, registry
signatures, and matching source/workflow/tag/commit provenance. Preserve those
results with the release identity and independent manifest digest. The active
KB protocol proof uses the verified registry producer
`@pegma/agent-access@0.1.1`; historical source-producer evidence remains in
[source preparation](SOURCE_PREPARATION.md). SD-02 still waits for the verified
trusted KB set. The Agent Access release prerequisite is closed; both hosts
still require their retained actual login/Admin-consent/client/staging acceptance.
