/** TEST ONLY: exact registry producer + four packed KB artifacts -> loopback SDK proof. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const registry = "https://registry.npmjs.org/";
const agentAccessVersion = "0.1.1";
const agentAccessIntegrity =
  "sha512-C8t2kkv2piE9Jxt48hrRj+dYDoBd4BMgyO9JpgBQT5ycr8xZx4hq43DSG9I/KjjPQhEvRhp7obYnZ/IiBme/Jw==";
const packageManagerVersion = "10.34.5";
const packages = ["contracts", "core", "application", "mcp"];
let stage = 0;
let fixtureStage;

function run(command, arguments_, cwd, env = process.env) {
  const result = spawnSync(command, arguments_, {
    cwd,
    env,
    shell: false,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  // Native command output can contain URLs or credentials. Never relay it.
  if (stage === 5 && result.status !== 0) {
    try {
      const failure = JSON.parse(result.stderr.trim());
      if (failure.passed === false && Number.isSafeInteger(failure.stage))
        fixtureStage = failure.stage;
    } catch {
      /* Suppress every non-receipt command diagnostic. */
    }
  }
  assert.equal(result.error, undefined, "Proof command could not complete.");
  assert.equal(result.status, 0, "Proof command failed.");
  return result.stdout.trim();
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function npmCliPath() {
  const directories = [
    dirname(process.execPath),
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
  ];
  const candidates = directories.map((directory) =>
    join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
  );
  if (basename(process.env.npm_execpath ?? "") === "npm-cli.js")
    candidates.unshift(process.env.npm_execpath);
  for (const directory of directories) {
    const executable = join(directory, "npm");
    if (await exists(executable)) {
      const target = await realpath(executable);
      if (basename(target) === "npm-cli.js") candidates.push(target);
    }
  }
  for (const candidate of candidates)
    if (await exists(candidate)) return candidate;
  throw new Error("npm CLI unavailable.");
}

async function pack(directory, destination, expectedName, npm, env) {
  const records = JSON.parse(
    run(
      process.execPath,
      [npm, "pack", "--json", "--pack-destination", destination],
      directory,
      env,
    ),
  );
  assert.equal(records.length, 1);
  const artifact = records[0];
  assert.equal(artifact.name, expectedName);
  assert.equal(basename(artifact.filename), artifact.filename);
  assert.ok(artifact.files.some(({ path }) => path === "dist/index.js"));
  assert.ok(artifact.files.some(({ path }) => path === "README.md"));
  assert.ok(artifact.files.some(({ path }) => path === "LICENSE"));
  assert.ok(!artifact.files.some(({ path }) => /\.(test|spec)\./u.test(path)));
  return [
    artifact.name,
    pathToFileURL(join(destination, artifact.filename)).href,
  ];
}

function safeReceipt(value) {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  for (const entry of Object.values(value)) {
    if (entry !== null && typeof entry === "object") safeReceipt(entry);
    else assert.ok(typeof entry === "boolean" || Number.isSafeInteger(entry));
  }
  return value;
}

async function proof() {
  const temporaryParent = await realpath(tmpdir());
  const temporary = await mkdtemp(
    join(temporaryParent, "pegma-kb-agent-proof-"),
  );
  try {
    stage = 1;
    assert.equal(
      process.env.AGENT_ACCESS_SOURCE,
      undefined,
      "Source producer overrides are not supported.",
    );
    const npm = await npmCliPath();
    const npmrc = join(temporary, "npmrc");
    await writeFile(
      npmrc,
      `registry=${registry}\n@pegma:registry=${registry}\n`,
    );
    let env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.toLowerCase().startsWith("npm_config_"),
        ),
      ),
      npm_config_userconfig: npmrc,
      npm_config_registry: registry,
    };
    // Pin the KB packing toolchain even when invoked directly with `node`.
    const toolchain = join(temporary, "toolchain");
    await mkdir(toolchain);
    await writeFile(join(toolchain, "package.json"), '{"private":true}\n');
    run(
      process.execPath,
      [
        npm,
        "install",
        "--ignore-scripts",
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
        `pnpm@${packageManagerVersion}`,
      ],
      toolchain,
      env,
    );
    const pnpm = join(toolchain, "node_modules", "pnpm", "bin", "pnpm.cjs");
    assert.equal(
      run(process.execPath, [pnpm, "--version"], toolchain, env),
      packageManagerVersion,
    );
    const inheritedPath =
      Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ??
      "";
    env = Object.fromEntries(
      Object.entries(env).filter(([key]) => key.toLowerCase() !== "path"),
    );
    env.PATH = `${join(toolchain, "node_modules", ".bin")}${delimiter}${inheritedPath}`;

    stage = 2;
    // The repository release checker builds/packs and verifies all four KB
    // inventories and their clean-consumer public entrypoints first.
    run(process.execPath, [pnpm, "run", "release:check"], root, env);
    const artifacts = join(temporary, "artifacts");
    await mkdir(artifacts);
    const dependencies = [];
    for (const directory of packages) {
      dependencies.push(
        await pack(
          join(root, "packages", directory),
          artifacts,
          `@pegma/knowledge-base-${directory}`,
          npm,
          env,
        ),
      );
    }

    stage = 3;
    const consumer = join(temporary, "consumer");
    await mkdir(consumer);
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({
        name: "pegma-kb-packed-agent-protocol-proof",
        private: true,
        type: "module",
        dependencies: {
          ...Object.fromEntries(dependencies),
          "@pegma/agent-access": agentAccessVersion,
          "@modelcontextprotocol/sdk": "1.32.2",
          "@pegma/sessions": "0.2.0",
          "@pegma/authorization-core": "0.4.0",
          "@pegma/storage-core": "0.4.0",
          "@pegma/spine": "0.1.2",
        },
      }),
    );
    stage = 4;
    run(
      process.execPath,
      [
        npm,
        "install",
        `--registry=${registry}`,
        "--ignore-scripts",
        "--package-lock=true",
        "--no-audit",
        "--no-fund",
      ],
      consumer,
      env,
    );
    const installedProducer = JSON.parse(
      await readFile(
        join(
          consumer,
          "node_modules",
          "@pegma",
          "agent-access",
          "package.json",
        ),
        "utf8",
      ),
    );
    assert.equal(installedProducer.name, "@pegma/agent-access");
    assert.equal(installedProducer.version, agentAccessVersion);
    const lockfile = JSON.parse(
      await readFile(join(consumer, "package-lock.json"), "utf8"),
    );
    const lockedProducer =
      lockfile.packages["node_modules/@pegma/agent-access"];
    assert.equal(lockedProducer.version, agentAccessVersion);
    assert.equal(
      lockedProducer.resolved,
      `${registry}@pegma/agent-access/-/agent-access-${agentAccessVersion}.tgz`,
    );
    assert.equal(lockedProducer.integrity, agentAccessIntegrity);
    await copyFile(
      join(root, "scripts", "agent-protocol-fixture.mjs"),
      join(consumer, "proof.mjs"),
    );
    stage = 5;
    const receipt = safeReceipt(
      JSON.parse(run(process.execPath, ["proof.mjs"], consumer, env)),
    );
    assert.equal(receipt.passed, true);
    assert.equal(receipt.reportWorkflow?.passed, true);
    return {
      ...receipt,
      packedPackages: dependencies.length,
      registryPackages: 1,
      exactRegistryProducer: true,
    };
  } finally {
    const cleanup = await realpath(temporary);
    assert.equal(dirname(cleanup), temporaryParent);
    assert.ok(basename(cleanup).startsWith("pegma-kb-agent-proof-"));
    await rm(cleanup, { recursive: true, force: true });
  }
}

try {
  console.log(JSON.stringify(await proof()));
} catch {
  console.error(
    JSON.stringify({
      passed: false,
      stage,
      ...(fixtureStage === undefined ? {} : { fixtureStage }),
    }),
  );
  process.exitCode = 1;
}
