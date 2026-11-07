import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packages = [
  { directory: "contracts", name: "@pegma/knowledge-base-contracts" },
  { directory: "core", name: "@pegma/knowledge-base-core" },
  { directory: "application", name: "@pegma/knowledge-base-application" },
];
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

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

async function npmCliPath() {
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
    assert.match(manifest.version, stableVersion);
    assert.equal(manifest.version, manifests[0]?.version ?? manifest.version);
    assert.equal(
      manifest.private,
      undefined,
      "Published packages cannot be private.",
    );
    assert.equal(manifest.type, "module");
    assert.equal(manifest.license, "MIT");
    assert.equal(manifest.publishConfig?.access, "public");
    assert.equal(manifest.engines?.node, ">=22");
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
      specification.directory === "application"
        ? {
            "@pegma/audit": "0.2.0",
            "@pegma/authorization-core": "0.4.0",
            "@pegma/knowledge-base-contracts": manifest.version,
            "@pegma/knowledge-base-core": manifest.version,
            "@pegma/spine": "0.1.2",
            "@pegma/storage-core": "0.4.0",
          }
        : specification.directory === "core"
          ? { "@pegma/knowledge-base-contracts": manifest.version }
          : { "@pegma/spine": "0.1.2" },
    );
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

async function prepare(mode) {
  assert.ok(
    ["check", "pack"].includes(mode),
    "Usage: release-packages.mjs check|pack",
  );
  assert.equal(
    process.argv.length,
    3,
    "No additional arguments are supported.",
  );
  const manifests = await validatePackages();
  const npm = await npmCliPath();
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
      validateInventory(metadata);
      const bytes = await readFile(join(temporary, metadata.filename));
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
        packages
          .map(({ name }) => `await import(${JSON.stringify(name)});`)
          .join("\n"),
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
    console.log(
      `Verified packaging and clean-consumer imports for ${artifacts.length} packages.`,
    );
  } finally {
    const cleanup = await realpath(temporary);
    assert.equal(dirname(cleanup), temporaryParent);
    assert.ok(basename(cleanup).startsWith("pegma-kb-release-"));
    await rm(cleanup, { recursive: true, force: true });
  }
}

prepare(process.argv[2]).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
