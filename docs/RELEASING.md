# Release operations

## KB-01 status

`@pegma/knowledge-base-contracts` and `@pegma/knowledge-base-core` are prepared
at synchronized version `0.1.0`. Both package names are unpublished. KB-01
establishes packaging checks and the release handoff; it does not publish,
create tags/releases, configure credentials, or enable a publish workflow.

Hosts must wait for an exact public registry release. Git branches, copied
source, local paths, and unpublished production tarballs are not substitutes.
The temporary tarball consumer below is a packaging test only.

## Artifact checks

Run the repository gate on Node 22 and 24 with the pinned pnpm version:

```sh
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run check
pnpm test
pnpm run release:check
```

`release:check` packs contracts and then core using npm. Each package's
`prepack` builds its own output, so a package cannot silently ship a stale
distribution. The checker verifies:

- synchronized stable versions, exact internal/Spine pins, ESM/public metadata,
  and the two declared runtime/type entry points;
- a package-local README and MIT LICENSE, a build-on-prepack script, and
  exclusion of `src/**/*.test.ts` from compilation;
- npm's artifact inventory containing only package metadata, README, LICENSE,
  and JavaScript/declaration output and maps under `dist`, with compiled tests
  excluded and both entry-point files present;
- the actual tarball bytes against npm's reported SHA-1 and SHA-512 integrity;
- an isolated consumer installation of both tarballs and successful ESM
  imports of both public packages.

The consumer disables install scripts, audit, and funding requests and obtains
released external dependencies from the public npm registry. It has no workspace
links. The checker locates `npm-cli.js` and invokes it with Node directly on
Windows and Unix; it does not interpolate commands through a shell. Temporary
files are removed only after checking their resolved directory is the generated
child of the system temporary root. No user npm configuration is inspected or
printed.

To keep the same verified tarballs for maintainer inspection:

```sh
pnpm run release:pack
```

This runs the same checks, then writes a new `.release/knowledge-base-*`
directory containing the two tarballs and `manifest.json` with their inventory
and integrity values. Existing artifact directories are preserved. These files
are local preparation artifacts, not proof of a released version or provenance.
The checker does not verify a source tag, main ancestry, registry publication,
or trusted-publisher configuration. Those are release prerequisites below.

## Maintainer prerequisites before first publication

These operations remain pending and must be recorded when completed:
Recheck npm's current [trusted-publishing guidance](https://docs.npmjs.com/trusted-publishers/)
when implementing the release workflow; this checklist records the Pegma
release procedure, not proof that external publisher settings exist.

- [ ] Confirm package-name ownership and organization publishing permissions.
- [ ] Complete KB-05's application/adapter and dual-store release criteria for
      any additional packages being advertised; do not publish empty packages.
- [ ] Merge reviewed release source and exact version/pin changes to protected
      `origin/main`; require every current-head review, test, build, security,
      and artifact check to pass.
- [ ] Configure protection for immutable `v*` tags and approved release signers.
- [ ] Prepare and verify the exact artifacts from a protected signed annotated
      `vX.Y.Z` tag whose commit is already on `origin/main`.
- [ ] The maintainer performs the new package names' one-time manual 2FA
      publication of those exact verified tarballs. Choose and document the
      bootstrap/first advertised release procedure before this operation.
- [ ] Configure npm trusted publishers for this repository, the reviewed future
      publish workflow, and its protected publishing environment.
- [ ] Establish the future workflow: unprivileged signature/main/gate/pack
      preparation, followed by a minimal environment-approved OIDC publish job
      receiving only the exact prepared artifacts.
- [ ] Verify registry versions, tarball integrity, provenance, and a clean
      public consumer installation before marking the packages available.

The first-publication procedure is a maintainer operation, not a command hidden
in CI. Do not add an npm token or token-based fallback to this repository.
Merging a PR does not publish. Later releases must use the protected signed
annotated tag and trusted-publisher path, preserve published version immutability,
and recover partial publication by verifying identical existing artifacts rather
than overwriting a version. Define that workflow in the release task before
enabling publication.
