# Publication ledger

## Current state and owner

The maintainer owns npm publication and external configuration. All four KB
`0.1.0` uploads were accepted through manual bootstrap, and their exact-byte
postflight passed at **2026-11-07T21:56:24Z**. Agent Access `0.1.0` also completed
manual bootstrap and postflight. Neither bootstrap has OIDC provenance.
KB's current verified trusted release is `0.1.2`; Agent Access remains verified
at `0.1.1`. Their receipts close public producer release prerequisites only.
The dated first trusted KB `0.1.1` receipt remains below as history. Synchronized
KB `0.1.3` is the unpublished optional human-reviewed evidence-report candidate;
its own review, current-head CI, trusted publication, strict consumer
verification and host acceptance remain pending.

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
At the subsequent `0.1.1` trusted-release checkpoint, all four KB packages and Agent Access had
`latest: 0.1.1` and `bootstrap: 0.1.0`.
Neither tag behavior nor package availability advertises the KB bootstrap as
the approved dependency set or establishes real-host acceptance.

## Verified Knowledge Base release

### Current verified `0.1.2` release

At **2026-11-08T03:39:55Z**, all four KB `0.1.2` packages completed strict
registry/signature/provenance and clean-consumer verification. The
[`v0.1.2` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.2)
identifies reviewed [PR #9](https://github.com/pegma-dev/knowledge-base/pull/9)
source at
[`004044bfa836b74a61fb5defa49d5ebab1fe37dd`](https://github.com/pegma-dev/knowledge-base/commit/004044bfa836b74a61fb5defa49d5ebab1fe37dd).
The annotated tag object is `85ec72f153be541e8cc551600b16bfd224f06d2d`, with a
valid verified signature. The
[trusted workflow, attempt 5](https://github.com/pegma-dev/knowledge-base/actions/runs/42436081951/attempts/5)
completed successfully at that source. Its separate unprivileged
[strict verification job](https://github.com/pegma-dev/knowledge-base/actions/runs/42436081951/job/128617897564)
recorded:

```text
Verified registry release and clean consumer for 4 packages.
```

| Field                                   | Value                                                              |
| --------------------------------------- | ------------------------------------------------------------------ |
| Original prepared artifact ID           | `13599399407`                                                      |
| Artifact name                           | `knowledge-base-release-42436081951-1`                             |
| Downloaded artifact archive SHA-256     | `c5ad819773292ef100a97a8f30e9c639b4ce5fca96c901a5873f8da6364f8609` |
| Independently retained manifest SHA-256 | `a7369297302182645c5157cd997c2ded0c3698c3e142efcff23866337cb51b33` |

The verifier bound the source/tag/commit, original artifact and independent
manifest digest to all four registry artifacts/dependencies, cryptographic
signatures, source-bound provenance, and clean-consumer imports. Recovery kept
the original prepared artifact; no package version, signed tag or tarball was
replaced. Current KB dist-tags are `latest: 0.1.2` and historical
`bootstrap: 0.1.0`; Agent Access remains `latest: 0.1.1`, `bootstrap: 0.1.0`.

This release provides SD-03 atomic draft/private-source authoring. It contains
no shared human-reviewed report factory. That optional API is new `0.1.3`
candidate source with its own pending review/CI/release/verification gates.
Neither release establishes actual host/client, privacy, activation or pilot
acceptance.

### Historical verified `0.1.1` release

At **2026-11-07T23:35:31Z**, all four KB `0.1.1` packages completed strict registry
and clean-consumer verification. [Release PR #8](https://github.com/pegma-dev/knowledge-base/pull/8)
was reviewed at
[`a3354ec39c5cc0401f4a19b92e08f8aa95c946b3`](https://github.com/pegma-dev/knowledge-base/commit/a3354ec39c5cc0401f4a19b92e08f8aa95c946b3)
and merged at
[`32086e4374f2ef45044cd09c371e506d10b88d64`](https://github.com/pegma-dev/knowledge-base/commit/32086e4374f2ef45044cd09c371e506d10b88d64).
The approved signed annotated [`v0.1.1` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.1)
targets that merged source. The
[trusted workflow run, attempt 5](https://github.com/pegma-dev/knowledge-base/actions/runs/42424148244/attempts/5)
succeeded. Its separate unprivileged
[strict verification job](https://github.com/pegma-dev/knowledge-base/actions/runs/42424148244/job/128564059833)
verified all four exact registry artifacts/dependencies, cryptographic signatures,
source/workflow/tag/commit provenance, and isolated clean-consumer imports.

| Field                                   | Value                                                              |
| --------------------------------------- | ------------------------------------------------------------------ |
| Artifact ID                             | `13595485168`                                                      |
| Artifact name                           | `knowledge-base-release-42424148244-1`                             |
| Downloaded artifact archive SHA-256     | `6274a14ba2780e384fb00d414a7e7f5b2f897aa201104286aece13f732cf54e4` |
| Independently retained manifest SHA-256 | `75cb63984706b964edd073932a8f14e3b53701620320d86a367ec29b5198ba4b` |

The original prepared artifact and independent digest were preserved across
failed-only reruns while registry visibility was delayed. Recovery accepted
only identical existing package bytes; no version, tag, or artifact was replaced.
At that historical checkpoint, all four packages had `latest: 0.1.1` and `bootstrap: 0.1.0`. Manual `0.1.0`
bootstrap receipts remain distinct and have no OIDC provenance.

This dated receipt closed the KB `0.1.1` producer release prerequisite. The
later `0.1.2` release has its own receipt above; neither completes host/client,
privacy, activation or pilot acceptance, nor verifies changed `0.1.3` source.

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
candidate artifacts in a fresh consumer. KB `0.1.2` has its separate verified
receipt above; source `0.1.3` retains its own current-head gates, PR, trusted
release, and strict verification. Existing-login, current-Admin consent, every requested
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

## Subsequent trusted releases

The names now exist and all five KB/Agent Access trusted-publisher entries have
been configured through the CLI. Recheck the protected `npm-publish` environment,
approved signers, immutable tag protection, and publishing policy as described
in [release operations](RELEASING.md). Each KB npm publisher
must name this repository's exact `publish.yml` workflow and environment and
explicitly permit direct publishing. Time new configurations to the prepared
trusted release so their first-use expiry does not strand the release.

The synchronized KB source candidate is `0.1.3` with exact internal dependency
pins. It still needs review and all current-head gates before release. The
historical first advertised trusted release is `0.1.1`; the current verified
release is `0.1.2`, recorded separately above.
A previously manually published version cannot be
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
[source preparation](SOURCE_PREPARATION.md). The verified KB `0.1.2` and Agent
Access `0.1.1` public producer release prerequisites are closed. This candidate
requires its own verified release, and both hosts still require their retained
actual login/Admin-consent/client/staging acceptance.
