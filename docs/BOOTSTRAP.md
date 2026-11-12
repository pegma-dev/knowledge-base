# Publication ledger

## Current state and owner

The maintainer owns npm publication and external configuration. All four KB
`0.1.0` uploads were accepted through manual bootstrap, and their exact-byte
postflight passed at **2026-11-07T21:56:24Z**. Agent Access `0.1.0` also completed
manual bootstrap and postflight. Neither bootstrap has OIDC provenance.
KB's current verified trusted release is
[`0.1.7`](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.7); Agent Access
remains verified at `0.1.1`. Their receipts close public producer release
prerequisites only. The dated trusted KB `0.1.1`, `0.1.2`, `0.1.3`, `0.1.4` and `0.1.5`
receipts remain below as history. The answering read-batching `0.1.5` release
completed its own review, current-head gates, trusted publication and strict
registry/consumer qualification. The [retained `0.1.6` receipt](#current-verified-016-release)
records the MCP metadata compatibility release. The `0.1.8` source candidate
remains unpublished and requires its own current-head gates and release.
Host dependency adoption and acceptance remain separate.

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

### Verified `0.1.7` release

All four synchronized [`0.1.7` packages](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.7)
completed exact-registry-byte, native signature, source-provenance and clean
consumer verification. Signed source is `27074b8bba76817ea6960606cf29d8fc239943b0`,
with annotated tag object `8cd14438d9dbff78eb0e1db288cfa09741e12e99`. The
[successful attempt 5](https://github.com/pegma-dev/knowledge-base/actions/runs/43271542639/attempts/5)
verified four identical existing packages and uploaded zero versions. Original
physical writers were attempts 1 through 4. The original preparation artifact
`13969137667` has ZIP SHA-256
`c683fb87be0351ce75d6a99921b5e4428c501f39e22cf6ce04aeba6ad962b75c`;
its manifest SHA-256 is
`514cbf58b297dd73939dc37d833254edfc39de561cd40f525717947d06491116`.
The release adds the canonical receipt to the staff report view. Its original
package bytes and prior release receipts retain their identities.

<a id="current-verified-016-release"></a>

### Historical verified `0.1.6` release

All four synchronized KB `0.1.6` packages completed exact-registry-byte, native
signature, authenticated source-provenance and clean-consumer verification at
**2026-11-12T00:14:56.815468Z**. The
[`v0.1.6` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.6)
and its [verification receipt](https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.6/registry-verification.json)
bind signed source
[`b2946e149078e0ef460f970c2271c196ea9fc759`](https://github.com/pegma-dev/knowledge-base/commit/b2946e149078e0ef460f970c2271c196ea9fc759)
and annotated tag object `44a54d90973bc18356233bc31694163c5a80b5f9`.

The original preparation artifact is `13900971990` from attempt `1`. Its
[prepared archive](https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.6/knowledge-base-v0.1.6-original-artifact-13900971990.zip)
has SHA-256 `efd2327a1f1f3b4889b691c6562764389608d1d8d13350fa67da5a4fb4658960`.
The [exact manifest](https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.6/manifest.json)
has SHA-256 `e92903283bb7fc851623846974301d33ca87ca8fbd5c1b4dd5e55ead4d908c86`.
Original package writers were attempts 1 through 4. The
[successful attempt 5](https://github.com/pegma-dev/knowledge-base/actions/runs/43120006429/attempts/5)
uploaded zero versions and verified four identical existing packages. Its
[separate unprivileged verification job](https://github.com/pegma-dev/knowledge-base/actions/runs/43120006429/job/130875137023)
completed the full registry and consumer checks. The linked public receipt
retains the original writer identities and provenance bindings. Host acceptance
remains separately gated.

<a id="current-verified-015-release"></a>

### Historical verified `0.1.5` release

All four KB `0.1.5` packages completed exact-registry-byte, cryptographic
signature/Sigstore, authenticated source-provenance and public-consumer
qualification. The [`v0.1.5` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.5)
binds signed source
[`6dae20df8dace50ad961d9c5fe8d28c90bf4918f`](https://github.com/pegma-dev/knowledge-base/commit/6dae20df8dace50ad961d9c5fe8d28c90bf4918f)
and signed annotated tag object `916c3880e5786c5293ed5423f81c4cc13b202ea6`.
The [final workflow attempt 5](https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/attempts/5)
has six successful job records, including the separate unprivileged
[strict registry/consumer verification job](https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/job/129895026059),
which completed at **2026-11-10T14:32:38Z**.

The original [Node 22](https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/job/129848540243)
and [Node 24](https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/job/129848540249)
release gates each executed 991 runtime tests across 22 files and 128 release
regressions, with zero failures or skips, plus the required format, type, example,
package and protocol steps. Their successful records and the original preparation
were carried into the final attempt, not executed again in attempt 5.

| Field                                   | Value                                                              |
| --------------------------------------- | ------------------------------------------------------------------ |
| Original prepared attempt               | `1`                                                                |
| Original prepared artifact ID           | `13767614004`                                                      |
| Original ZIP SHA-256                    | `b87b16c0b6badb38dface2eb7e2c60a84eca6c0c0c70f83fb4b9432ee9546e41` |
| Independently retained manifest SHA-256 | `61739de9c3f1d65a481ec96a297cab63f6576787fdd4e01fbd4cea627b12d22d` |
| Successful final attempt                | `5`                                                                |

The [original prepared ZIP](https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.5/knowledge-base-v0.1.5-original-artifact-13767614004.zip),
[exact manifest](https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.5/manifest.json)
and [verification summary](https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.5/registry-verification.json)
are public release assets. Local public snapshots retain the same
[manifest bytes](releases/v0.1.5/package-manifest.json), the
[original artifact binding](releases/v0.1.5/prepared-artifact.json) and the
[final verification job projection](releases/v0.1.5/verification-job.json).
The manifest is retained byte-for-byte: **15,260 bytes**, with the independently
retained SHA-256 above. The offline
[release-receipt regression](../tests/release-receipts.test.ts) checks both
against fixed expectations, independently of the adjacent receipt JSON.
Formatting is excluded for that immutable manifest alone. The summary and
snapshots record evidence; they do not replace cryptographic verification.

The artifact binding's `archiveBytes: 197991` measures the downloaded original
ZIP container, including ZIP metadata, rather than its expanded payload.
`regularOuterFiles: 5` counts non-directory root entries: `manifest.json` and
the four `.tgz` artifacts. Directory entries are excluded. Its `inspection`
object records those names and meanings. These are reproducible inspection
summary fields, not additions to the canonical schema-2 manifest, which still
contains only `schemaVersion`, `identity` and `artifacts`. To repeat inspection,
download the linked original ZIP without repacking, measure its file length,
and list the non-directory ZIP entries. For example, in PowerShell:

```powershell
$archive = 'knowledge-base-v0.1.5-original-artifact-13767614004.zip'
(Get-Item -LiteralPath $archive).Length
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $archive).Path)
try {
  $zip.Entries | Where-Object { $_.Name -ne '' } | Select-Object FullName, Length
} finally {
  $zip.Dispose()
}
```

The verification-job file is a selected-field projection of the authoritative
[GitHub Jobs API record](https://api.github.com/repos/pegma-dev/knowledge-base/actions/jobs/129895026059),
with its returned step records preserved. The API returns the nine step
numbers `1,2,3,4,5,6,11,12,13`; these identifiers are retained exactly rather
than reconstructed from workflow YAML. Their gaps do not authorize inventing
steps `7` through `10` or renumbering the returned post steps. Consult the
[actual job and its logs](https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/job/129895026059)
or the [job-log endpoint](https://api.github.com/repos/pegma-dev/knowledge-base/actions/jobs/129895026059/logs)
for the execution record. The offline regression preserves this exact API
projection; it performs no network check or inference of sequential numbering.

Authenticated source provenance binds each package to its original writer.
All four earlier publisher jobs remain failed records; an accepted write is
not rolled back by a later job failure:

| Package     | Original writer attempt | Original writer job                                                                                   |
| ----------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Contracts   | `1`                     | [129854408848](https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/job/129854408848) |
| Core        | `2`                     | [129866356239](https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/job/129866356239) |
| Application | `3`                     | [129874490043](https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/job/129874490043) |
| MCP         | `4`                     | [129882202265](https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/job/129882202265) |

The [final publisher](https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/job/129890032223)
uploaded zero packages and skipped four byte-identical existing versions.
Recovery preserved the original source, signed tag, manifest and tarballs;
it did not repack or replace a version. No cause for the earlier failures is
inferred from registry availability.

The successful GitHub strict verification job checked registry/installed
bytes and dependencies, signatures and authenticated provenance. Its registry
consumer then performed runtime `typeof` checks on four imported root exports:
`knowledgePermissions`, `createArticle`, `createKnowledgeBaseApplication` and
`createKnowledgeAgentDispatcher`. It did not construct a Memory store or
exercise report-factory construction or MCP metadata. The broader packed
consumer used during preparation is a separate check.

A separately retained independent postflight checked exact original registry
and installed bytes/dependencies, genuine signatures and authenticated
source/writer bindings, then imported the four roots and checked the report
factory and MCP metadata in a controlled Memory composition. The public
[verification summary](https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.5/registry-verification.json)
records this distinct `independentPostflight` on Node `24.18.0` and npm
`11.18.0`, with result SHA-256
`7d23957d576a49e4f637e983054b81a574952cc321450092e0443e73248542dd`
and independent peer SHA-256
`530d18fdb620fdf0c930913bd3493fd84b7e6fd12ae1b7157c791e7994590e58`.
Those checks are not attributed to the GitHub verification job. The controlled
composition admitted no actual host report and established no durable host or
requested-client run. At this checkpoint, all four KB
packages had `latest: 0.1.5` and `bootstrap: 0.1.0`; dist-tags remain mutable
observations.

This patch groups independent answering reads while retaining authority,
publication, approved-evidence and configured work checks. Host dependency
adoption, existing-login/Admin consent, actual client/model runs, provider/privacy
controls, Workers Free query/CPU measurements, full workflows and pilots remain
separate open acceptance gates.

The source package READMEs are corrected after publication to reflect this
status for future releases. The original `0.1.5` tarballs, their bundled README
bytes, the signed source, and the byte-exact manifest above remain immutable.

<a id="current-verified-014-release"></a>

### Historical verified `0.1.4` release

All four synchronized KB packages completed qualified trusted publication at
[`0.1.4`](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.4). This release
provides governed operation-local authoring contexts, optional body-free report
queries, prepared read waves and bounded resumable repair. Its public release
retains the original artifact and verification summary, including qualification
limits. Publication does not establish durable-host or actual-client acceptance.
The earlier receipt below remains as history under its preserved anchor.

<a id="current-verified-013-release"></a>

### Historical verified `0.1.3` release

All four KB `0.1.3` packages completed exact-registry-byte, cryptographic
signature/Sigstore, authenticated source-provenance and public-consumer
qualification at **2026-11-09T00:05:01.700778Z**. The
[`v0.1.3` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.3)
binds signed source
[`8b4c25aa6a40f0c56be97f07e3b7b5ac6136a99b`](https://github.com/pegma-dev/knowledge-base/commit/8b4c25aa6a40f0c56be97f07e3b7b5ac6136a99b)
and signed annotated tag object `07326885d0074075738b27d555790eda2802ffd2`.
The [release run's final attempt 5](https://github.com/pegma-dev/knowledge-base/actions/runs/42533473529/attempts/5)
has six successful job records, including the separate
[strict registry/consumer verification job](https://github.com/pegma-dev/knowledge-base/actions/runs/42533473529/job/128906942012).

The actual original [Node 22](https://github.com/pegma-dev/knowledge-base/actions/runs/42533473529/job/128892580576)
and [Node 24](https://github.com/pegma-dev/knowledge-base/actions/runs/42533473529/job/128892580550)
release gates executed in attempt 1. Each passed 675 runtime tests across 16
files and 128 release regressions, with zero skips, plus the required
format/type/example/package/protocol steps. Their successful records and the
original preparation were reused in the final attempt; they were not newly
executed gates in attempt 5.

| Field                                   | Value                                                              |
| --------------------------------------- | ------------------------------------------------------------------ |
| Original prepared attempt               | `1`                                                                |
| Original prepared artifact ID           | `13638542884`                                                      |
| Original ZIP SHA-256                    | `25a4f95e7d5f9722f3b8ece3e20cf6bd35c5d6618abfa52d218319236b449464` |
| Independently retained manifest SHA-256 | `8a384bf5972eee0cd9796367a632d01b4b57832f33bac073665281dfd7b9ed8a` |
| Successful final attempt                | `5`                                                                |

The original [prepared ZIP is a public release asset](https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.3/knowledge-base-v0.1.3-artifact-13638542884.zip).
Recovery retained that artifact and exact manifest/tarballs without repacking,
moving the signed tag or replacing any version. The authenticated original
per-package publication invocations are distinct from the final successful
idempotent publisher. An earlier writer job could fail after an accepted
upload; recovery did not treat that failure as rollback or republish its bytes:

| Package     | Original writer attempt | Original writer job                                                                                   |
| ----------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Contracts   | `1`                     | [128894569185](https://github.com/pegma-dev/knowledge-base/actions/runs/42533473529/job/128894569185) |
| Core        | `2`                     | [128897903802](https://github.com/pegma-dev/knowledge-base/actions/runs/42533473529/job/128897903802) |
| Application | `3`                     | [128900136498](https://github.com/pegma-dev/knowledge-base/actions/runs/42533473529/job/128900136498) |
| MCP         | `4`                     | [128903298046](https://github.com/pegma-dev/knowledge-base/actions/runs/42533473529/job/128903298046) |

The [public verification summary](https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.3/knowledge-base-v0.1.3-verification.json)
records these bindings and qualified checks. It is a summary, not a substitute
for actual cryptographic verification. The clean synthetic registry consumer
imported all four public package roots and constructed the report factory with
both storage layouts and legacy optional modes. It did not perform report
admission or establish a durable host or actual client/staging acceptance.

This release provides optional human-reviewed evidence reports. The later
verified `0.1.4` release adds governed authoring contexts and optional report
queries. The separately verified `0.1.5` release adds answering read batching.
Its retained receipt above retains its own source and artifact identity.
Producer releases do not close Workers Free call/CPU acceptance, host activation
or pilot gates.

<a id="current-verified-012-release"></a>

### Historical verified `0.1.2` release

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
replaced. At that release checkpoint, KB dist-tags were `latest: 0.1.2` and
`bootstrap: 0.1.0`; Agent Access was `latest: 0.1.1`, `bootstrap: 0.1.0`.

This release provides SD-03 atomic draft/private-source authoring. It contains
no shared human-reviewed report factory; that API subsequently shipped in
`0.1.3`, whose separate receipt is above. This historical release establishes
no actual host/client, privacy, activation or pilot acceptance.

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
later `0.1.2` and `0.1.3` releases have their own receipts above; none completes
host/client, privacy, activation or pilot acceptance or verifies later changed
source. The verified `0.1.4` release has its separate public release record above.

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
candidate artifacts in a fresh consumer. KB `0.1.3` has its separate verified
receipt above; the later `0.1.4` and `0.1.5` releases are also verified. The
retained `0.1.5` receipt retains its own gates, source and artifact identity.
Existing-login, current-Admin consent, every requested
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

The synchronized current verified KB release is `0.1.7` with exact internal dependency
pins. Any changed source needs its own review and current-head gates before a
new release. The historical first advertised trusted release is `0.1.1`; its
receipt and those for `0.1.2` through `0.1.5` remain above alongside the
retained verified `0.1.6` receipt and the `0.1.7` release.
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
[source preparation](SOURCE_PREPARATION.md). The verified KB `0.1.3` receipt
remains historical; KB `0.1.7` and Agent Access `0.1.1` public producer release
prerequisites are closed. Both hosts still require their retained actual
login/Admin-consent/client/staging acceptance.
