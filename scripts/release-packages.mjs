import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  appendFile,
  copyFile,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RELEASE_PACKAGES,
  STABLE_VERSION,
  releaseDependencies,
  verifyReleaseIdentity,
} from "./release-contract.mjs";
import {
  verifyPreparedManifest,
  writePreparedManifest,
} from "./release-manifest.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packages = RELEASE_PACKAGES;
export { RELEASE_PACKAGES, releaseDependencies };

function run(command, arguments_, cwd, env = process.env) {
  const result = spawnSync(command, arguments_, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${basename(command)} failed (${String(result.status)}): ${result.stderr || result.stdout}`,
    );
  }
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

export async function resolveReleaseNpmCli(env = process.env) {
  const candidate = env.RELEASE_NPM_CLI;
  assert.ok(
    typeof candidate === "string" &&
      isAbsolute(candidate) &&
      basename(candidate) === "npm-cli.js",
    "The reviewed release npm CLI must be an explicit absolute npm-cli.js path.",
  );
  assert.equal(
    env.RELEASE_NPM_VERSION,
    "11.18.0",
    "Release preparation requires the reviewed npm version.",
  );
  const path = resolve(candidate);
  const metadata = await lstat(path);
  assert.ok(
    metadata.isFile() && !metadata.isSymbolicLink(),
    "The release npm CLI must be a regular file.",
  );
  const canonical = await realpath(path);
  assert.equal(
    canonical,
    path,
    "The release npm CLI must use its canonical path.",
  );
  return canonical;
}

async function npmCliPath(preparedRelease = false) {
  if (preparedRelease) {
    const candidate = await resolveReleaseNpmCli();
    const [major, minor] = process.versions.node.split(".").map(Number);
    assert.ok(
      major > 22 || (major === 22 && minor >= 14),
      "Release preparation requires Node 22.14 or newer.",
    );
    const versionEnvironment = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (
        /^(?:PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA)$/iu.test(
          key,
        )
      ) {
        versionEnvironment[key] = value;
      }
    }
    assert.equal(
      run(
        process.execPath,
        [candidate, "--version"],
        tmpdir(),
        versionEnvironment,
      ),
      "11.18.0",
      "Release preparation npm CLI differs from the reviewed version.",
    );
    return candidate;
  }
  const directories = [
    dirname(process.execPath),
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
  ];
  const candidates = directories.map((directory) =>
    join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
  );
  if (basename(process.env.npm_execpath ?? "") === "npm-cli.js") {
    candidates.unshift(process.env.npm_execpath);
  }
  for (const directory of directories) {
    const executable = join(directory, "npm");
    if (await exists(executable)) {
      const target = await realpath(executable);
      if (basename(target) === "npm-cli.js") candidates.push(target);
    }
  }
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error("Cannot locate npm-cli.js beside Node.js or on PATH.");
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function validatePackages() {
  const manifests = [];
  for (const specification of packages) {
    const directory = join(root, "packages", specification.directory);
    const manifest = await json(join(directory, "package.json"));
    assert.equal(manifest.name, specification.name);
    assert.match(manifest.version, STABLE_VERSION);
    assert.equal(manifest.version, manifests[0]?.version ?? manifest.version);
    assert.equal(
      manifest.private,
      undefined,
      "Published packages cannot be private.",
    );
    assert.equal(manifest.type, "module");
    assert.equal(manifest.license, "MIT");
    assert.deepEqual(manifest.publishConfig, { access: "public" });
    assert.equal(manifest.engines?.node, ">=22");
    assert.deepEqual(manifest.repository, {
      type: "git",
      url: "git+https://github.com/pegma-dev/knowledge-base.git",
      directory: `packages/${specification.directory}`,
    });
    assert.ok(
      ["pnpm run build", "pnpm run --silent build"].includes(
        manifest.scripts?.prepack,
      ),
      `${manifest.name} must build during prepack.`,
    );
    assert.deepEqual(manifest.exports, {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    });
    assert.deepEqual(
      manifest.dependencies,
      releaseDependencies(specification.directory, manifest.version),
    );
    for (const kind of [
      "peerDependencies",
      "optionalDependencies",
      "bundledDependencies",
      "bundleDependencies",
    ]) {
      assert.equal(manifest[kind], undefined);
    }
    for (const document of ["README.md", "LICENSE"]) {
      const content = await readFile(join(directory, document), "utf8");
      assert.ok(
        content.trim().length > 0,
        `${manifest.name} requires its own ${document}.`,
      );
      if (document === "LICENSE") assert.match(content, /MIT License/u);
    }
    const configuration = await json(join(directory, "tsconfig.json"));
    assert.ok(
      configuration.exclude?.includes("src/**/*.test.ts"),
      `${manifest.name} must exclude compiled tests.`,
    );
    manifests.push(manifest);
  }
  const publicPackages = [];
  for (const entry of await readdir(join(root, "packages"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const manifest = await json(
      join(root, "packages", entry.name, "package.json"),
    );
    if (manifest.private !== true) publicPackages.push(manifest.name);
  }
  assert.deepEqual(
    publicPackages.sort(),
    packages.map(({ name }) => name).sort(),
    "The public workspace must contain exactly the reviewed release packages.",
  );
  return manifests;
}

function validateInventory(metadata) {
  const paths = metadata.files.map(({ path }) => path);
  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    assert.ok(paths.includes(required), `Tarball is missing ${required}.`);
  }
  for (const path of paths) {
    const parts = path.split("/");
    assert.ok(!parts.some((part) => part === "." || part === ".."));
    assert.ok(
      ["package.json", "README.md", "LICENSE"].includes(path) ||
        (/^dist\/[A-Za-z0-9_./-]+\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u.test(
          path,
        ) &&
          !/\.(?:test|spec)\./u.test(path)),
      `Unexpected packaged file: ${path}`,
    );
  }
}

async function prepareArtifacts(mode, options = {}) {
  const manifests = await validatePackages();
  const identity =
    mode === "prepare"
      ? verifyReleaseIdentity({
          root,
          tag: options.tag,
          expectedCommit: options.expectedCommit,
          version: manifests[0].version,
        })
      : undefined;
  const npm = await npmCliPath(mode === "prepare");
  const temporaryParent = await realpath(tmpdir());
  const temporary = await mkdtemp(join(temporaryParent, "pegma-kb-release-"));
  try {
    const npmrc = join(temporary, "npmrc");
    await writeFile(npmrc, "registry=https://registry.npmjs.org/\n");
    const env = {
      ...process.env,
      npm_config_userconfig: npmrc,
      npm_config_registry: "https://registry.npmjs.org/",
    };
    await cleanBuildOutputs();
    run(
      process.execPath,
      [
        join(root, "node_modules", "typescript", "bin", "tsc"),
        "-b",
        "--force",
        ...packages.map(({ directory }) =>
          join(root, "packages", directory, "tsconfig.json"),
        ),
      ],
      root,
      env,
    );
    const artifacts = [];
    for (const [index, specification] of packages.entries()) {
      const output = run(
        process.execPath,
        [
          npm,
          "pack",
          "--json",
          "--ignore-scripts=false",
          "--pack-destination",
          temporary,
        ],
        join(root, "packages", specification.directory),
        env,
      );
      const packed = JSON.parse(output);
      assert.equal(packed.length, 1);
      const metadata = packed[0];
      assert.equal(metadata.name, specification.name);
      assert.equal(metadata.version, manifests[index].version);
      assert.equal(basename(metadata.filename), metadata.filename);
      assert.equal(
        metadata.filename,
        `${specification.name.slice(1).replace("/", "-")}-${manifests[index].version}.tgz`,
      );
      validateInventory(metadata);
      const bytes = await readFile(join(temporary, metadata.filename));
      assert.equal(bytes.length, metadata.size);
      assert.equal(
        createHash("sha1").update(bytes).digest("hex"),
        metadata.shasum,
      );
      assert.equal(
        `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
        metadata.integrity,
      );
      artifacts.push(metadata);
    }
    const consumer = join(temporary, "consumer");
    await mkdir(consumer);
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({
        name: "knowledge-base-artifact-smoke",
        private: true,
        type: "module",
        dependencies: Object.fromEntries(
          artifacts.map(({ name, filename }) => [
            name,
            pathToFileURL(join(temporary, filename)).href,
          ]),
        ),
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
    run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          'import assert from "node:assert/strict";',
          'import { readFile } from "node:fs/promises";',
          'import { createMemoryStore } from "@pegma/storage-core";',
          'import { createKnowledgeBaseApplication } from "@pegma/knowledge-base-application";',
          'import { createKnowledgeAgentDispatcher, createKnowledgeAgentMcp } from "@pegma/knowledge-base-mcp";',
          ...packages.map(
            ({ name, runtimeExport, runtimeExportType }, index) =>
              `const package${index} = await import(${JSON.stringify(name)});\nassert.equal(typeof package${index}[${JSON.stringify(runtimeExport)}], ${JSON.stringify(runtimeExportType)});`,
          ),
          `
const mcpManifest = JSON.parse(await readFile(
  new URL("../package.json", import.meta.resolve("@pegma/knowledge-base-mcp")),
  "utf8",
));
const resource = "https://knowledge-artifact.example/mcp";
const application = createKnowledgeBaseApplication({
  store: createMemoryStore(),
  clock: { now: () => "2026-11-07T12:00:00.000Z" },
});
const dispatcher = createKnowledgeAgentDispatcher({ application, resource });
const identity = {
  clientId: "synthetic-artifact-client",
  resource,
  scopes: [],
  access: {
    principalId: "synthetic/artifact-principal",
    policyVersion: "synthetic-artifact-policy-1",
    roles: [],
    entitlements: [],
    permissions: [],
  },
};
const mcp = createKnowledgeAgentMcp({
  dispatcher,
  resource,
  mcpUrl: resource,
  protectedResourceMetadataUrl:
    "https://knowledge-artifact.example/.well-known/oauth-protected-resource/mcp",
  allowedOrigins: [],
  limit: () => true,
  authenticate(request) {
    assert.equal(request.headers.get("Authorization"), "Bearer synthetic-artifact-smoke");
    return identity;
  },
});
const initialized = await mcp.handle(new Request(resource, {
  method: "POST",
  headers: {
    Authorization: "Bearer synthetic-artifact-smoke",
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "knowledge-base-artifact-smoke", version: "1.0.0" },
    },
  }),
}));
assert.ok(initialized instanceof Response);
assert.equal(initialized.status, 200);
const initializedBody = await initialized.json();
assert.equal(initializedBody.jsonrpc, "2.0");
assert.equal(initializedBody.id, 1);
assert.equal(initializedBody.error, undefined);
assert.equal(initializedBody.result.serverInfo.name, mcpManifest.name);
assert.equal(initializedBody.result.serverInfo.version, mcpManifest.version);
`,
        ].join("\n"),
      ],
      consumer,
      env,
    );
    if (mode === "pack") {
      const releases = join(root, ".release");
      await mkdir(releases, { recursive: true });
      const destination = await mkdtemp(join(releases, "knowledge-base-"));
      for (const { filename } of artifacts) {
        await copyFile(join(temporary, filename), join(destination, filename));
      }
      await writeFile(
        join(destination, "manifest.json"),
        `${JSON.stringify({ schemaVersion: 1, artifacts }, null, 2)}\n`,
      );
      console.log(`Prepared verified artifacts in ${destination}`);
    }
    if (mode === "prepare") {
      // Check the reviewed source again after build and consumer execution,
      // before creating any output directory that could dirty the checkout.
      assert.deepEqual(
        verifyReleaseIdentity({
          root,
          tag: options.tag,
          expectedCommit: options.expectedCommit,
          version: identity.version,
        }),
        identity,
      );
      const preparedDir = await preparedDirectory(options.output);
      for (const { filename } of artifacts) {
        await copyFile(
          join(temporary, filename),
          join(preparedDir, filename),
          constants.COPYFILE_EXCL,
        );
      }
      const prepared = await writePreparedManifest({
        preparedDir,
        identity,
        artifacts: artifacts.map((artifact, index) => ({
          name: artifact.name,
          version: artifact.version,
          filename: artifact.filename,
          size: artifact.size,
          shasum: artifact.shasum,
          integrity: artifact.integrity,
          dependencies: manifests[index].dependencies,
          files: artifact.files
            .map(({ path, size }) => ({ path, size }))
            .sort((left, right) => left.path.localeCompare(right.path)),
        })),
      });
      return { preparedDir, ...prepared };
    }
    console.log(
      `Verified packaging and clean-consumer imports for ${artifacts.length} packages, including MCP server metadata.`,
    );
  } finally {
    const cleanup = await realpath(temporary);
    assert.equal(dirname(cleanup), temporaryParent);
    assert.ok(basename(cleanup).startsWith("pegma-kb-release-"));
    await rm(cleanup, { recursive: true, force: true });
  }
}

async function optionalMetadata(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function canonicalNode(path, kind) {
  const metadata = await lstat(path);
  assert.ok(
    !metadata.isSymbolicLink() &&
      (kind === "directory" ? metadata.isDirectory() : metadata.isFile()),
    "Release build output paths must not contain symlinks or special files.",
  );
  assert.equal(
    await realpath(path),
    path,
    "Release build output paths must stay inside their canonical package.",
  );
}

async function validateOutputTree(path) {
  await canonicalNode(path, "directory");
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    assert.equal(dirname(child), path);
    if (entry.isDirectory()) {
      await validateOutputTree(child);
    } else {
      await canonicalNode(child, "file");
    }
  }
}

export async function cleanBuildOutputs(checkoutRoot = root) {
  const checkout = resolve(checkoutRoot);
  await canonicalNode(checkout, "directory");
  const packageRoot = join(checkout, "packages");
  await canonicalNode(packageRoot, "directory");
  const outputs = [];
  // Preflight every target before removing any file. Output names are fixed by
  // this reviewed producer; never turn tsconfig values into deletion targets.
  for (const specification of packages) {
    const packageDirectory = join(packageRoot, specification.directory);
    assert.equal(dirname(packageDirectory), packageRoot);
    await canonicalNode(packageDirectory, "directory");
    const configurationPath = join(packageDirectory, "tsconfig.json");
    await canonicalNode(configurationPath, "file");
    const configuration = await json(configurationPath);
    assert.equal(configuration.compilerOptions?.outDir, "dist");
    assert.equal(configuration.compilerOptions?.rootDir, "src");
    assert.equal(
      configuration.compilerOptions?.tsBuildInfoFile,
      "tsconfig.tsbuildinfo",
    );
    const directory = join(packageDirectory, "dist");
    const buildInfo = join(packageDirectory, "tsconfig.tsbuildinfo");
    assert.equal(dirname(directory), packageDirectory);
    assert.equal(dirname(buildInfo), packageDirectory);
    if (await optionalMetadata(directory)) await validateOutputTree(directory);
    if (await optionalMetadata(buildInfo))
      await canonicalNode(buildInfo, "file");
    outputs.push({ directory, buildInfo });
  }
  for (const { directory, buildInfo } of outputs) {
    // Recheck the exact targets immediately before deletion as well. Do not
    // follow junctions/symlinks even when they point back inside the checkout.
    if (await optionalMetadata(directory)) {
      await validateOutputTree(directory);
      await rm(directory, { recursive: true, force: true });
    }
    if (await optionalMetadata(buildInfo)) {
      await canonicalNode(buildInfo, "file");
      await rm(buildInfo);
    }
  }
}

async function preparedDirectory(output) {
  if (output === undefined) {
    const releases = join(root, ".release");
    await mkdir(releases, { recursive: true });
    return realpath(await mkdtemp(join(releases, "knowledge-base-")));
  }
  assert.equal(typeof output, "string", "Release output must be a directory.");
  assert.ok(output.length > 0, "Release output must be a directory.");
  const destination = resolve(root, output);
  await mkdir(destination, { recursive: true });
  const metadata = await lstat(destination);
  assert.ok(
    metadata.isDirectory() && !metadata.isSymbolicLink(),
    "Release output must be a regular directory.",
  );
  assert.equal(
    (await readdir(destination)).length,
    0,
    "Release output directory must be empty.",
  );
  return realpath(destination);
}

export async function prepareRelease(options = {}) {
  return prepareArtifacts("prepare", options);
}

export async function preflightRelease(options = {}) {
  const verified = await verifyPreparedManifest(options);
  const { preflightRegistry } = await import("./release-registry.mjs");
  return preflightRegistry(verified);
}

export async function publishPreparedRelease(options = {}) {
  await verifyPreparedManifest(options);
  const { publishPreparedRelease: publish } =
    await import("./release-registry.mjs");
  return publish(options);
}

export async function verifyRelease(options = {}) {
  await verifyPreparedManifest(options);
  const { verifyRegistryRelease } = await import("./release-registry.mjs");
  return verifyRegistryRelease(options);
}

const usage =
  "Usage: release-packages.mjs check|pack|prepare|preflight|publish|verify [options]";

export function parseArguments(arguments_) {
  const [command, ...flags] = arguments_;
  assert.ok(
    ["check", "pack", "prepare", "preflight", "publish", "verify"].includes(
      command,
    ),
    usage,
  );
  if (command === "check" || command === "pack") {
    assert.equal(flags.length, 0, "No additional arguments are supported.");
    return { command, options: {} };
  }
  const keys =
    command === "prepare"
      ? {
          "--tag": "tag",
          "--expected-commit": "expectedCommit",
          "--out": "output",
        }
      : {
          "--prepared-dir": "preparedDir",
          "--manifest-sha256": "expectedManifestSha256",
          "--tag": "expectedTag",
          "--expected-commit": "expectedCommit",
        };
  const options = {};
  for (let index = 0; index < flags.length; index += 2) {
    const key = Object.hasOwn(keys, flags[index])
      ? keys[flags[index]]
      : undefined;
    const value = flags[index + 1];
    assert.ok(
      key !== undefined &&
        !Object.hasOwn(options, key) &&
        typeof value === "string" &&
        value.length > 0 &&
        !value.startsWith("--") &&
        !/[\u0000-\u001f\u007f]/u.test(value),
      "Unknown, repeated, or incomplete release argument.",
    );
    options[key] = value;
  }
  const tag = command === "prepare" ? options.tag : options.expectedTag;
  assert.ok(
    typeof tag === "string" &&
      tag.startsWith("v") &&
      STABLE_VERSION.test(tag.slice(1)),
    "An exact stable release tag is required.",
  );
  assert.ok(
    typeof options.expectedCommit === "string" &&
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(options.expectedCommit),
    "An exact release event commit is required.",
  );
  if (command !== "prepare") {
    assert.equal(
      typeof options.preparedDir,
      "string",
      "A prepared release directory is required.",
    );
    assert.ok(
      typeof options.expectedManifestSha256 === "string" &&
        /^[0-9a-f]{64}$/u.test(options.expectedManifestSha256),
      "An independent prepared manifest SHA-256 is required.",
    );
  }
  return { command, options };
}

async function reportPrepared(prepared) {
  const values = {
    "prepared-dir": prepared.preparedDir,
    "manifest-path": prepared.manifestPath,
    "manifest-sha256": prepared.manifestSha256,
  };
  const output = Object.entries(values)
    .map(([key, value]) => {
      assert.ok(
        !/[\u0000-\u001f\u007f]/u.test(value),
        "Release output must be single-line.",
      );
      return `${key}=${value}\n`;
    })
    .join("");
  process.stdout.write(output);
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, output);
  }
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "check" || command === "pack") {
    await prepareArtifacts(command);
  } else if (command === "prepare") {
    await reportPrepared(await prepareRelease(options));
  } else if (command === "preflight") {
    const plan = await preflightRelease(options);
    for (const record of plan) {
      console.log(`${record.name}@${record.version}: ${record.action}`);
    }
  } else if (command === "publish") {
    const result = await publishPreparedRelease(options);
    console.log(
      `Verified publication of ${result.published.length} packages; ${result.skipped.length} already identical.`,
    );
  } else {
    const result = await verifyRelease(options);
    console.log(
      `Verified registry release and clean consumer for ${result.packages.length} packages.`,
    );
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
