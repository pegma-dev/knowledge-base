import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, sep } from "node:path";
import {
  parseArguments,
  resolveReleaseNpmCli,
} from "../../scripts/release-packages.mjs";
import { temporaryDirectory } from "./fixtures.mjs";

const commit = "a".repeat(40);
const manifestSha256 = "b".repeat(64);

test("existing check and pack commands accept no publication options", () => {
  for (const command of ["check", "pack"]) {
    assert.deepEqual(parseArguments([command]), { command, options: {} });
    assert.throws(() => parseArguments([command, "--tag", "v0.1.0"]));
  }
});

test("prepare requires an exact stable tag and independent commit before any work", () => {
  assert.deepEqual(
    parseArguments(["prepare", "--tag", "v0.1.0", "--expected-commit", commit]),
    { command: "prepare", options: { tag: "v0.1.0", expectedCommit: commit } },
  );
  assert.deepEqual(
    parseArguments([
      "prepare",
      "--out",
      "synthetic output",
      "--expected-commit",
      "c".repeat(64),
      "--tag",
      "v1.2.3",
    ]),
    {
      command: "prepare",
      options: {
        output: "synthetic output",
        expectedCommit: "c".repeat(64),
        tag: "v1.2.3",
      },
    },
  );
});

test("preflight, publish, and verify require the same prepared artifact identity", () => {
  for (const command of ["preflight", "publish", "verify"]) {
    assert.deepEqual(
      parseArguments([
        command,
        "--prepared-dir",
        "synthetic/prepared",
        "--manifest-sha256",
        manifestSha256,
        "--tag",
        "v0.1.0",
        "--expected-commit",
        commit,
      ]),
      {
        command,
        options: {
          preparedDir: "synthetic/prepared",
          expectedManifestSha256: manifestSha256,
          expectedTag: "v0.1.0",
          expectedCommit: commit,
        },
      },
    );
  }
});

test("missing, duplicate, unknown, malformed, and credential options fail closed", () => {
  const prepare = ["prepare", "--tag", "v0.1.0", "--expected-commit", commit];
  const publish = [
    "publish",
    "--prepared-dir",
    "synthetic",
    "--manifest-sha256",
    manifestSha256,
    "--tag",
    "v0.1.0",
    "--expected-commit",
    commit,
  ];
  for (const arguments_ of [
    [],
    ["unknown"],
    ["prepare"],
    ["prepare", "--tag", "v0.1.0"],
    ["prepare", "--expected-commit", commit],
    ["prepare", "--tag", "v0.1.0-rc.1", "--expected-commit", commit],
    ["prepare", "--tag", "0.1.0", "--expected-commit", commit],
    ["prepare", "--tag", "v01.1.0", "--expected-commit", commit],
    ["prepare", "--tag", "v0.1.0", "--expected-commit", "HEAD"],
    [...prepare, "--tag", "v0.1.0"],
    [...prepare, "--out"],
    [...prepare, "--out", ""],
    [...prepare, "--out", "--tag"],
    [...prepare, "--out", "synthetic\u0000directory"],
    [...prepare, "--out", "synthetic\ndirectory"],
    [...prepare, "--force", "true"],
    [...prepare, "--__proto__", "value"],
    [...prepare, "unexpected"],
    [...publish, "--manifest-sha256", manifestSha256],
    [...publish, "--npm-token", "synthetic-credential"],
    [...publish, "--out", "synthetic"],
    publish.filter(
      (value) => value !== "--manifest-sha256" && value !== manifestSha256,
    ),
    [
      "verify",
      "--prepared-dir",
      "synthetic",
      "--manifest-sha256",
      "B".repeat(64),
      "--tag",
      "v0.1.0",
      "--expected-commit",
      commit,
    ],
  ]) {
    assert.throws(() => parseArguments(arguments_));
  }
});

function releaseNpmEnvironment(cli) {
  return { RELEASE_NPM_CLI: cli, RELEASE_NPM_VERSION: "11.18.0" };
}

async function npmCliFixture(t) {
  const directory = await temporaryDirectory(t);
  const cli = join(directory, "npm-cli.js");
  // The resolver is a filesystem boundary. Executing this file would fail the
  // success case; no installed npm or version subprocess belongs in these tests.
  await writeFile(
    cli,
    "throw new Error('synthetic npm fixture must not execute');\n",
  );
  return { directory, cli };
}

test("strict preparation resolves a canonical reviewed CLI without executing it", async (t) => {
  const { directory, cli } = await npmCliFixture(t);
  await mkdir(join(directory, "nested"));
  const candidate = `${directory}${sep}nested${sep}..${sep}npm-cli.js`;
  const env = Object.freeze(releaseNpmEnvironment(candidate));
  assert.equal(await resolveReleaseNpmCli(env), await realpath(cli));
  assert.equal(env.RELEASE_NPM_CLI, candidate);
});

test("strict preparation requires an explicit absolute CLI and never uses ambient npm discovery", async (t) => {
  const { directory, cli } = await npmCliFixture(t);
  for (const candidate of [undefined, "", "npm-cli.js", "../npm-cli.js"]) {
    await assert.rejects(
      resolveReleaseNpmCli({
        ...releaseNpmEnvironment(candidate),
        npm_execpath: cli,
        PATH: directory,
      }),
    );
  }
  await assert.rejects(resolveReleaseNpmCli({}));
});

test("strict preparation requires the exact independently configured npm version", async (t) => {
  const { cli } = await npmCliFixture(t);
  for (const version of [
    undefined,
    "",
    "11.17.0",
    "^11.18.0",
    "11.18.0-rc.1",
    "11.18.0\n",
  ]) {
    await assert.rejects(
      resolveReleaseNpmCli({
        ...releaseNpmEnvironment(cli),
        RELEASE_NPM_VERSION: version,
      }),
    );
  }
});

test("strict preparation rejects non-CLI names, missing files, and CLI-named directories", async (t) => {
  const { directory } = await npmCliFixture(t);
  const nonCli = join(directory, "not-npm-cli.js");
  await writeFile(nonCli, "// synthetic non-CLI file\n");
  const cliDirectory = join(directory, "directory", "npm-cli.js");
  await mkdir(cliDirectory, { recursive: true });
  for (const candidate of [
    nonCli,
    join(directory, "missing", "npm-cli.js"),
    cliDirectory,
  ]) {
    await assert.rejects(
      resolveReleaseNpmCli(releaseNpmEnvironment(candidate)),
    );
  }
});

test("strict preparation rejects a leaf npm-cli.js symlink even to matching regular bytes", async (t) => {
  const { directory, cli } = await npmCliFixture(t);
  const linkedDirectory = join(directory, "leaf-link");
  await mkdir(linkedDirectory);
  const linkedCli = join(linkedDirectory, "npm-cli.js");
  try {
    await symlink(cli, linkedCli, "file");
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") {
      t.skip("Windows file symlinks require Developer Mode or elevation");
      return;
    }
    throw error;
  }
  await assert.rejects(resolveReleaseNpmCli(releaseNpmEnvironment(linkedCli)));
});

test("strict preparation rejects a CLI reached through a linked ancestor directory", async (t) => {
  const { directory, cli } = await npmCliFixture(t);
  const linkedDirectory = join(directory, "ancestor-link");
  const actualDirectory = join(directory, "actual-cli-directory");
  await mkdir(actualDirectory);
  await writeFile(join(actualDirectory, "npm-cli.js"), await readFile(cli));
  await symlink(
    actualDirectory,
    linkedDirectory,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    resolveReleaseNpmCli(
      releaseNpmEnvironment(join(linkedDirectory, "npm-cli.js")),
    ),
  );
});
