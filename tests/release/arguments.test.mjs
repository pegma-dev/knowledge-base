import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "../../scripts/release-packages.mjs";

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
