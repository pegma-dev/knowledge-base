import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  RELEASE_PACKAGES,
  RELEASE_REPOSITORY,
  releaseDependencies,
  verifyReleaseIdentity,
} from "../../scripts/release-contract.mjs";
import { signedGitFixture, specifications } from "./fixtures.mjs";

test("the reviewed release package order and exact dependency pins are fixed", () => {
  assert.equal(RELEASE_REPOSITORY, "pegma-dev/knowledge-base");
  assert.deepEqual(
    RELEASE_PACKAGES.map(({ name, directory }) => ({ name, directory })),
    specifications.map(({ name, directory }) => ({ name, directory })),
  );
  for (const specification of specifications) {
    assert.deepEqual(
      releaseDependencies(specification.directory, "0.1.0"),
      specification.dependencies,
    );
  }
  assert.throws(() => releaseDependencies("unknown", "0.1.0"));
  for (const version of [
    "v0.1.0",
    "0.1.0-rc.1",
    "01.1.0",
    "1.0",
    "1.0.0+build",
  ]) {
    assert.throws(() => releaseDependencies("contracts", version));
  }
});

function verify(fixture, overrides = {}) {
  return verifyReleaseIdentity({
    root: fixture.root,
    tag: "v0.1.0",
    expectedCommit: fixture.commit,
    version: "0.1.0",
    ...overrides,
  });
}

test("an approved SSH signed annotated tag at the exact clean main commit verifies", async (t) => {
  const fixture = await signedGitFixture(t);
  const result = verify(fixture);
  assert.deepEqual(result, {
    repository: "pegma-dev/knowledge-base",
    tag: "v0.1.0",
    commit: fixture.commit,
    version: "0.1.0",
  });
  assert.ok(Object.isFrozen(result));
});

test("release identity rejects a wrong tag, version, or event commit", async (t) => {
  const fixture = await signedGitFixture(t);
  for (const overrides of [
    { tag: "v0.2.0" },
    { version: "0.1.0-rc.1" },
    { expectedCommit: "0".repeat(40) },
    { expectedCommit: fixture.commit.toUpperCase() },
    { expectedCommit: "HEAD" },
  ]) {
    assert.throws(() => verify(fixture, overrides));
  }
});

test("a lightweight tag cannot satisfy the signed annotated release contract", async (t) => {
  const fixture = await signedGitFixture(t);
  fixture.git("tag", "-d", "v0.1.0");
  fixture.git("tag", "v0.1.0");
  assert.throws(() => verify(fixture), /annotated tag object/u);
});

test("an unsigned annotated tag cannot satisfy the release contract", async (t) => {
  const fixture = await signedGitFixture(t);
  fixture.git("tag", "-d", "v0.1.0");
  fixture.git("tag", "-a", "v0.1.0", "-m", "Unsigned fixture");
  assert.throws(() => verify(fixture), /signature/u);
});

test("a cryptographic signature from an unapproved signer is rejected", async (t) => {
  const fixture = await signedGitFixture(t);
  await writeFile(fixture.allowedSigners, "");
  assert.throws(() => verify(fixture), /signature/u);
});

test("a tag targeting an older commit is rejected even when HEAD matches the event", async (t) => {
  const fixture = await signedGitFixture(t);
  await writeFile(
    join(fixture.root, "README.md"),
    "Synthetic second commit.\n",
  );
  fixture.git("add", "README.md");
  fixture.git("commit", "-m", "Advance fixture main");
  const commit = fixture.git("rev-parse", "HEAD");
  fixture.git("update-ref", "refs/remotes/origin/main", commit);
  assert.throws(
    () => verify(fixture, { expectedCommit: commit }),
    /must match/u,
  );
});

test("tracked modifications and untracked files each block release preparation", async (t) => {
  const fixture = await signedGitFixture(t);
  await writeFile(join(fixture.root, "README.md"), "Unreviewed source edit.\n");
  assert.throws(() => verify(fixture), /clean checkout/u);
  fixture.git("restore", "README.md");
  await writeFile(join(fixture.root, "untracked.txt"), "Unreviewed file.\n");
  assert.throws(() => verify(fixture), /clean checkout/u);
});

test("a signed clean commit outside origin/main is rejected", async (t) => {
  const fixture = await signedGitFixture(t);
  fixture.git("checkout", "--orphan", "unrelated");
  fixture.git("commit", "-m", "Unrelated synthetic main");
  const unrelated = fixture.git("rev-parse", "HEAD");
  fixture.git("update-ref", "refs/remotes/origin/main", unrelated);
  fixture.git("checkout", "--detach", fixture.commit);
  assert.throws(() => verify(fixture), /contained in origin\/main/u);
});

test("a shallow checkout is rejected before tag ancestry can be trusted", async (t) => {
  const fixture = await signedGitFixture(t);
  await writeFile(join(fixture.root, ".git", "shallow"), `${fixture.commit}\n`);
  assert.throws(() => verify(fixture), /complete Git ancestry/u);
});

test("a different remote or a package subdirectory cannot supply release identity", async (t) => {
  const fixture = await signedGitFixture(t);
  fixture.git(
    "remote",
    "set-url",
    "origin",
    "https://github.com/other/knowledge-base.git",
  );
  assert.throws(() => verify(fixture), /reviewed source repository/u);
  fixture.git(
    "remote",
    "set-url",
    "origin",
    "https://github.com/pegma-dev/knowledge-base.git",
  );
  assert.throws(
    () => verify(fixture, { root: join(fixture.root, ".git") }),
    /checkout root/u,
  );
});
