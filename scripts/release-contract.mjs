import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_REPOSITORY = "pegma-dev/knowledge-base";
export const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
export const RELEASE_PACKAGES = Object.freeze(
  [
    {
      directory: "contracts",
      name: "@pegma/knowledge-base-contracts",
      runtimeExport: "knowledgePermissions",
      runtimeExportType: "object",
    },
    {
      directory: "core",
      name: "@pegma/knowledge-base-core",
      runtimeExport: "createArticle",
      runtimeExportType: "function",
    },
    {
      directory: "application",
      name: "@pegma/knowledge-base-application",
      runtimeExport: "createKnowledgeBaseApplication",
      runtimeExportType: "function",
    },
    {
      directory: "mcp",
      name: "@pegma/knowledge-base-mcp",
      runtimeExport: "createKnowledgeAgentDispatcher",
      runtimeExportType: "function",
    },
  ].map((entry) => Object.freeze(entry)),
);

export function releaseDependencies(directory, version) {
  if (typeof version !== "string" || !STABLE_VERSION.test(version)) {
    throw new Error("release version must be stable semver");
  }
  if (!RELEASE_PACKAGES.some((entry) => entry.directory === directory)) {
    throw new Error("release package is not in the reviewed package set");
  }
  const contracts = { "@pegma/spine": "0.1.2" };
  const core = { "@pegma/knowledge-base-contracts": version };
  const application = {
    "@pegma/audit": "0.2.0",
    "@pegma/authorization-core": "0.4.0",
    "@pegma/knowledge-base-contracts": version,
    "@pegma/knowledge-base-core": version,
    "@pegma/spine": "0.1.2",
    "@pegma/storage-core": "0.4.0",
  };
  const mcp = {
    "@cfworker/json-schema": "4.1.6",
    "@modelcontextprotocol/sdk": "1.32.2",
    "@pegma/authorization-core": "0.4.0",
    "@pegma/knowledge-base-application": version,
    "@pegma/knowledge-base-contracts": version,
    "@pegma/knowledge-base-core": version,
    zod: "4.6.7",
  };
  const dependencies = { contracts, core, application, mcp }[directory];
  return Object.freeze(dependencies);
}

function fail(message) {
  throw new Error(message);
}

function git(root, arguments_, allowFailure = false) {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" };
  // The checkout supplied by the workflow is authoritative. Keep its approved
  // signer configuration, but do not let inherited repository overrides select
  // a different worktree, index, or object database.
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
  ]) {
    delete env[key];
  }
  const result = spawnSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["--no-replace-objects", ...arguments_],
    {
      cwd: root,
      env,
      shell: false,
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  if (result.error || (!allowFailure && result.status !== 0)) {
    fail("release identity Git verification failed");
  }
  return result;
}

export function verifyReleaseIdentity({
  root = fileURLToPath(new URL("../", import.meta.url)),
  tag,
  expectedCommit,
  version,
} = {}) {
  if (
    typeof version !== "string" ||
    !STABLE_VERSION.test(version) ||
    tag !== `v${version}`
  ) {
    fail("release tag must match the stable package version");
  }
  if (
    typeof expectedCommit !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(expectedCommit)
  ) {
    fail("release event must supply the exact expected commit");
  }
  let checkout;
  try {
    checkout = realpathSync(resolve(root));
    const gitRoot = git(checkout, [
      "rev-parse",
      "--show-toplevel",
    ]).stdout.trim();
    if (realpathSync(gitRoot) !== checkout) {
      fail("release identity requires the checkout root");
    }
  } catch {
    fail("release identity requires the checkout root");
  }
  const origin = git(checkout, ["remote", "get-url", "origin"]).stdout.trim();
  if (
    !/^(?:https:\/\/github\.com\/pegma-dev\/knowledge-base(?:\.git)?|git@github\.com:pegma-dev\/knowledge-base(?:\.git)?|ssh:\/\/git@github\.com\/pegma-dev\/knowledge-base(?:\.git)?)$/u.test(
      origin,
    )
  ) {
    fail("release origin must be the reviewed source repository");
  }
  if (
    git(checkout, ["rev-parse", "--is-shallow-repository"]).stdout.trim() !==
    "false"
  ) {
    fail("release identity requires complete Git ancestry");
  }
  if (
    git(checkout, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]).stdout !== ""
  ) {
    fail("release preparation requires a clean checkout");
  }
  const tagRef = `refs/tags/${tag}`;
  const type = git(checkout, ["cat-file", "-t", tagRef], true);
  if (type.status !== 0 || type.stdout.trim() !== "tag") {
    fail("release ref must be an annotated tag object");
  }
  const commit = git(checkout, ["rev-parse", "HEAD"]).stdout.trim();
  const tagCommit = git(checkout, [
    "rev-parse",
    `${tagRef}^{commit}`,
  ]).stdout.trim();
  if (commit !== expectedCommit || tagCommit !== expectedCommit) {
    fail("release checkout, tag target, and event commit must match");
  }
  // Signer approval comes from the workflow's reviewed Git verification
  // configuration (for example SSH allowedSignersFile), never from this script.
  if (git(checkout, ["verify-tag", "--raw", tagRef], true).status !== 0) {
    fail("release tag signature is not valid for an approved signer");
  }
  if (
    git(
      checkout,
      ["merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"],
      true,
    ).status !== 0
  ) {
    fail("release tag commit must be contained in origin/main");
  }
  return Object.freeze({
    repository: RELEASE_REPOSITORY,
    tag,
    commit,
    version,
  });
}
