/** TEST ONLY: immutable public producer -> packed consumer -> loopback SDK proof. */
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
const reviewedAgentAccess = "a444e2113db98455b638b2ef8aa7c2faccb16b62";
const publicProducer = "https://github.com/pegma-dev/agent-access.git";
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
    const npm = await npmCliPath();
    const npmrc = join(temporary, "npmrc");
    await writeFile(npmrc, "registry=https://registry.npmjs.org/\n");
    let env = {
      ...process.env,
      npm_config_userconfig: npmrc,
      npm_config_registry: "https://registry.npmjs.org/",
    };
    // Pin the producer's toolchain even when invoked directly with `node`.
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
    const suppliedSource = process.env.AGENT_ACCESS_SOURCE;
    if (suppliedSource) {
      // Read only. Clone committed Git objects; never copy a dirty source tree
      // or install/build in the user's checkout.
      assert.equal(
        run("git", ["rev-parse", "HEAD"], suppliedSource, env),
        reviewedAgentAccess,
      );
    }
    const producer = join(temporary, "agent-access-producer");
    run(
      "git",
      [
        "clone",
        "--no-local",
        "--no-checkout",
        suppliedSource ?? publicProducer,
        producer,
      ],
      temporary,
      env,
    );
    run("git", ["checkout", "--detach", reviewedAgentAccess], producer, env);
    assert.equal(
      run("git", ["rev-parse", "HEAD"], producer, env),
      reviewedAgentAccess,
    );
    const manifest = JSON.parse(
      await readFile(join(producer, "package.json"), "utf8"),
    );
    assert.equal(manifest.packageManager, `pnpm@${packageManagerVersion}`);
    run(
      process.execPath,
      [pnpm, "install", "--frozen-lockfile"],
      producer,
      env,
    );
    run(process.execPath, [pnpm, "run", "build"], producer, env);
    dependencies.push(
      await pack(
        join(producer, "packages", "agent-access"),
        artifacts,
        "@pegma/agent-access",
        npm,
        env,
      ),
    );

    stage = 4;
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
          "@modelcontextprotocol/sdk": "1.32.2",
          "@pegma/sessions": "0.2.0",
          "@pegma/authorization-core": "0.4.0",
          "@pegma/storage-core": "0.4.0",
          "@pegma/spine": "0.1.2",
        },
      }),
    );
    run(
      process.execPath,
      [
        npm,
        "install",
        "--ignore-scripts",
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
      ],
      consumer,
      env,
    );
    await copyFile(
      join(root, "scripts", "agent-protocol-fixture.mjs"),
      join(consumer, "proof.mjs"),
    );
    stage = 5;
    const receipt = safeReceipt(
      JSON.parse(run(process.execPath, ["proof.mjs"], consumer, env)),
    );
    assert.equal(receipt.passed, true);
    return {
      packedPackages: dependencies.length,
      immutableProducer: true,
      ...receipt,
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
