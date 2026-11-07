import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  PREPARED_MANIFEST_LIMITS,
  validatePreparedManifest,
  verifyPreparedManifest,
  writePreparedManifest,
} from "../../scripts/release-manifest.mjs";
import {
  digest,
  identity,
  preparedFixture,
  rewriteManifest,
} from "./fixtures.mjs";

const failure = /prepared release manifest or artifact verification failed/u;

async function prepare(t) {
  const fixture = await preparedFixture(t);
  const written = await writePreparedManifest(fixture);
  return {
    ...fixture,
    written,
    options: {
      preparedDir: fixture.preparedDir,
      expectedManifestSha256: written.manifestSha256,
      expectedTag: identity.tag,
      expectedCommit: identity.commit,
      expectedVersion: identity.version,
    },
  };
}

test("prepared manifest is frozen, digest-bound, ordered, and independent of mutable producer metadata", async (t) => {
  const fixture = await prepare(t);
  const bytes = await readFile(fixture.written.manifestPath);
  assert.equal(fixture.written.manifestSha256, digest(bytes));
  assert.ok(bytes.toString("utf8").endsWith("\n"));
  const result = await verifyPreparedManifest(fixture.options);
  assert.deepEqual(result.manifest.identity, identity);
  assert.deepEqual(
    result.artifacts.map(({ name }) => name),
    fixture.artifacts.map(({ name }) => name),
  );
  for (const artifact of result.artifacts) {
    assert.equal(artifact.path, join(fixture.preparedDir, artifact.filename));
    assert.ok(Object.isFrozen(artifact));
  }
  assert.ok(Object.isFrozen(result.manifest.artifacts[0].dependencies));
  assert.ok(Object.isFrozen(result.manifest.artifacts[0].files[0]));
  assert.ok(Object.isFrozen(result.artifacts));
  assert.equal(Object.isFrozen(fixture.artifacts[0]), false);
  fixture.identity.commit = "b".repeat(40);
  fixture.artifacts[0].dependencies["@pegma/spine"] = "99.0.0";
  assert.deepEqual(result.manifest.identity, identity);
  assert.equal(result.artifacts[0].dependencies["@pegma/spine"], "0.1.2");
});

test("manifest digest and expected source identity come from independent trusted inputs", async (t) => {
  const fixture = await prepare(t);
  for (const overrides of [
    { expectedManifestSha256: undefined },
    { expectedManifestSha256: "0".repeat(64) },
    { expectedManifestSha256: fixture.written.manifestSha256.toUpperCase() },
    { expectedTag: "v0.2.0" },
    { expectedCommit: "b".repeat(40) },
    { expectedCommit: "HEAD" },
    { expectedVersion: "0.2.0" },
  ]) {
    await assert.rejects(
      verifyPreparedManifest({ ...fixture.options, ...overrides }),
      failure,
    );
  }
  await rewriteManifest(fixture.preparedDir, (manifest) => {
    manifest.identity.commit = "b".repeat(40);
  });
  await assert.rejects(verifyPreparedManifest(fixture.options), failure);
});

test("artifact byte tampering is rejected even when the blob size is unchanged", async (t) => {
  const fixture = await prepare(t);
  const artifact = join(fixture.preparedDir, fixture.artifacts[0].filename);
  const bytes = await readFile(artifact);
  bytes[0] ^= 1;
  await writeFile(artifact, bytes);
  await assert.rejects(verifyPreparedManifest(fixture.options), failure);
});

test("artifact size and both independent hash encodings must match the exact blob", async (t) => {
  for (const [name, change] of [
    [
      "size",
      (record) => {
        record.size += 1;
      },
    ],
    [
      "SHA-1",
      (record) => {
        record.shasum = "0".repeat(40);
      },
    ],
    [
      "SHA-512",
      (record) => {
        record.integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
      },
    ],
  ]) {
    await t.test(name, async (t) => {
      const fixture = await prepare(t);
      const expectedManifestSha256 = await rewriteManifest(
        fixture.preparedDir,
        (manifest) => {
          change(manifest.artifacts[0]);
        },
      );
      await assert.rejects(
        verifyPreparedManifest({ ...fixture.options, expectedManifestSha256 }),
        failure,
      );
    });
  }
});

test("recomputed manifest hashes cannot authorize altered package sets, order, pins, or source identity", async (t) => {
  const mutations = [
    [
      "missing package",
      (manifest) => {
        manifest.artifacts.pop();
      },
    ],
    [
      "duplicate package",
      (manifest) => {
        manifest.artifacts[1] = manifest.artifacts[0];
      },
    ],
    [
      "wrong order",
      (manifest) => {
        manifest.artifacts.reverse();
      },
    ],
    [
      "unexpected dependency",
      (manifest) => {
        manifest.artifacts[0].dependencies.extra = "1.0.0";
      },
    ],
    [
      "wrong external pin",
      (manifest) => {
        manifest.artifacts[0].dependencies["@pegma/spine"] = "^0.1.2";
      },
    ],
    [
      "wrong internal pin",
      (manifest) => {
        manifest.artifacts[1].dependencies["@pegma/knowledge-base-contracts"] =
          "0.2.0";
      },
    ],
    [
      "wrong package version",
      (manifest) => {
        manifest.artifacts[0].version = "0.2.0";
      },
    ],
    [
      "prerelease",
      (manifest) => {
        manifest.identity.version = "0.1.0-rc.1";
      },
    ],
    [
      "different repository",
      (manifest) => {
        manifest.identity.repository = "other/knowledge-base";
      },
    ],
    [
      "different source commit",
      (manifest) => {
        manifest.identity.commit = "b".repeat(40);
      },
    ],
    [
      "different release tag",
      (manifest) => {
        manifest.identity.tag = "v0.2.0";
      },
    ],
    [
      "schema downgrade",
      (manifest) => {
        manifest.schemaVersion = 1;
      },
    ],
    [
      "unreviewed source field",
      (manifest) => {
        manifest.source = "copied-local-source";
      },
    ],
    [
      "unreviewed record field",
      (manifest) => {
        manifest.artifacts[0].path = "../source/package.tgz";
      },
    ],
  ];
  for (const [name, change] of mutations) {
    await t.test(name, async (t) => {
      const fixture = await prepare(t);
      const expectedManifestSha256 = await rewriteManifest(
        fixture.preparedDir,
        change,
      );
      await assert.rejects(
        verifyPreparedManifest({ ...fixture.options, expectedManifestSha256 }),
        failure,
      );
    });
  }
});

test("package inventories reject unsafe paths, tests, duplicates, missing exports, and invalid bounds", async (t) => {
  const mutations = [
    [
      "parent traversal",
      (record) => {
        record.files.push({ path: "dist/../escape.js", size: 1 });
      },
    ],
    [
      "absolute path",
      (record) => {
        record.files.push({ path: "/dist/escape.js", size: 1 });
      },
    ],
    [
      "Windows path",
      (record) => {
        record.files.push({ path: "dist\\escape.js", size: 1 });
      },
    ],
    [
      "compiled test",
      (record) => {
        record.files.push({ path: "dist/index.test.js", size: 1 });
      },
    ],
    [
      "duplicate inventory",
      (record) => {
        record.files.push(record.files[0]);
      },
    ],
    [
      "missing runtime export",
      (record) => {
        record.files = record.files.filter(
          ({ path }) => path !== "dist/index.js",
        );
      },
    ],
    [
      "negative size",
      (record) => {
        record.files[0].size = -1;
      },
    ],
    [
      "fractional size",
      (record) => {
        record.files[0].size = 1.5;
      },
    ],
    [
      "oversized file",
      (record) => {
        record.files[0].size = PREPARED_MANIFEST_LIMITS.fileBytes + 1;
      },
    ],
    [
      "artifact filename traversal",
      (record) => {
        record.filename = `../${record.filename}`;
      },
    ],
    [
      "artifact too large",
      (record) => {
        record.size = PREPARED_MANIFEST_LIMITS.artifactBytes + 1;
      },
    ],
  ];
  for (const [name, change] of mutations) {
    await t.test(name, async (t) => {
      const fixture = await preparedFixture(t);
      change(fixture.artifacts[0]);
      assert.throws(
        () =>
          validatePreparedManifest({
            schemaVersion: 2,
            identity,
            artifacts: fixture.artifacts,
          }),
        failure,
      );
    });
  }
});

test("prepared manifests are created once and invalid blobs never produce a manifest", async (t) => {
  const fixture = await prepare(t);
  await assert.rejects(writePreparedManifest(fixture), failure);
  const invalid = await preparedFixture(t);
  await writeFile(
    join(invalid.preparedDir, invalid.artifacts[0].filename),
    "different bytes",
  );
  await assert.rejects(writePreparedManifest(invalid), failure);
  await assert.rejects(readFile(join(invalid.preparedDir, "manifest.json")), {
    code: "ENOENT",
  });
});

test("the verifier rejects missing blobs and artifact directories", async (t) => {
  const fixture = await prepare(t);
  const artifact = join(fixture.preparedDir, fixture.artifacts[0].filename);
  await unlink(artifact);
  await assert.rejects(verifyPreparedManifest(fixture.options), failure);
  await mkdir(artifact);
  await assert.rejects(verifyPreparedManifest(fixture.options), failure);
});

test("a manifest outside the prepared directory is rejected even with the exact trusted digest", async (t) => {
  const fixture = await prepare(t);
  const manifestPath = join(fixture.directory, "manifest.json");
  await writeFile(manifestPath, await readFile(fixture.written.manifestPath));
  await assert.rejects(
    verifyPreparedManifest({ ...fixture.options, manifestPath }),
    failure,
  );
});

test("oversized and malformed manifests fail without disclosing paths or contents", async (t) => {
  const fixture = await prepare(t);
  for (const bytes of [
    Buffer.alloc(PREPARED_MANIFEST_LIMITS.manifestBytes + 1, 32),
    Buffer.from('{"synthetic-secret":"do-not-echo"'),
  ]) {
    await writeFile(fixture.written.manifestPath, bytes);
    await assert.rejects(
      verifyPreparedManifest({
        ...fixture.options,
        expectedManifestSha256: digest(bytes),
      }),
      (error) =>
        error.message ===
        "prepared release manifest or artifact verification failed",
    );
  }
});

test("a linked prepared directory is rejected", async (t) => {
  const fixture = await prepare(t);
  const preparedDir = join(fixture.directory, "linked-prepared");
  await symlink(
    fixture.preparedDir,
    preparedDir,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    verifyPreparedManifest({ ...fixture.options, preparedDir }),
    failure,
  );
});

test("artifact and manifest file symlinks are rejected even when their bytes match", async (t) => {
  for (const target of ["artifact", "manifest"]) {
    await t.test(target, async (t) => {
      const fixture = await prepare(t);
      const path =
        target === "artifact"
          ? join(fixture.preparedDir, fixture.artifacts[0].filename)
          : fixture.written.manifestPath;
      const moved = join(fixture.directory, `${target}-target`);
      await rename(path, moved);
      try {
        await symlink(moved, path, "file");
      } catch (error) {
        if (process.platform === "win32" && error.code === "EPERM") {
          t.skip("Windows file symlinks require Developer Mode or elevation");
          return;
        }
        throw error;
      }
      await assert.rejects(verifyPreparedManifest(fixture.options), failure);
    });
  }
});
