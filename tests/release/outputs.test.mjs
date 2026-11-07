import assert from "node:assert/strict";
import {
  access,
  mkdir,
  readFile,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { cleanBuildOutputs } from "../../scripts/release-packages.mjs";
import { specifications, temporaryDirectory } from "./fixtures.mjs";

async function outputFixture(t) {
  const directory = await temporaryDirectory(t);
  const root = join(directory, "checkout");
  for (const { directory: name } of specifications) {
    const packageRoot = join(root, "packages", name);
    await mkdir(join(packageRoot, "src"), { recursive: true });
    await mkdir(join(packageRoot, "dist", "nested"), { recursive: true });
    await writeFile(
      join(packageRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          rootDir: "src",
          outDir: "dist",
          tsBuildInfoFile: "tsconfig.tsbuildinfo",
        },
      }),
    );
    await writeFile(
      join(packageRoot, "src", "index.ts"),
      "export const reviewed = true;\n",
    );
    await writeFile(
      join(packageRoot, "dist", "index.js"),
      "export const reviewed = false; // tampered ignored output\n",
    );
    await writeFile(
      join(packageRoot, "dist", "extra.js"),
      "throw new Error('unreviewed extra');\n",
    );
    await writeFile(
      join(packageRoot, "dist", "nested", "stale.js"),
      "// stale nested output\n",
    );
    await writeFile(
      join(packageRoot, "tsconfig.tsbuildinfo"),
      "stale incremental cache",
    );
  }
  await writeFile(join(root, "tsconfig.tsbuildinfo"), "unowned root cache");
  const unrelated = join(root, "packages", "unrelated", "dist");
  await mkdir(unrelated, { recursive: true });
  await writeFile(join(unrelated, "keep.js"), "// unowned output\n");
  return { directory, root };
}

test("fresh packaging removes tampered ignored dist trees and incremental caches for all four owned packages", async (t) => {
  const fixture = await outputFixture(t);
  await cleanBuildOutputs(fixture.root);
  for (const { directory } of specifications) {
    const packageRoot = join(fixture.root, "packages", directory);
    await assert.rejects(access(join(packageRoot, "dist")), { code: "ENOENT" });
    await assert.rejects(access(join(packageRoot, "tsconfig.tsbuildinfo")), {
      code: "ENOENT",
    });
    assert.equal(
      await readFile(join(packageRoot, "src", "index.ts"), "utf8"),
      "export const reviewed = true;\n",
    );
    await access(join(packageRoot, "tsconfig.json"));
  }
  assert.equal(
    await readFile(join(fixture.root, "tsconfig.tsbuildinfo"), "utf8"),
    "unowned root cache",
  );
  await access(join(fixture.root, "packages", "unrelated", "dist", "keep.js"));
  await cleanBuildOutputs(fixture.root);
});

test("unsafe output configuration in the last package fails the complete preflight before any cleanup", async (t) => {
  const fixture = await outputFixture(t);
  const configuration = join(fixture.root, "packages", "mcp", "tsconfig.json");
  await writeFile(
    configuration,
    JSON.stringify({
      compilerOptions: {
        rootDir: "src",
        outDir: "../outside",
        tsBuildInfoFile: "tsconfig.tsbuildinfo",
      },
    }),
  );
  await assert.rejects(cleanBuildOutputs(fixture.root));
  await access(join(fixture.root, "packages", "contracts", "dist", "extra.js"));
  await access(
    join(fixture.root, "packages", "contracts", "tsconfig.tsbuildinfo"),
  );
});

test("a linked owned output directory is rejected without touching its target or earlier packages", async (t) => {
  const fixture = await outputFixture(t);
  const target = join(fixture.directory, "outside-output");
  await mkdir(target);
  await writeFile(join(target, "keep.js"), "synthetic outside sentinel\n");
  const output = join(fixture.root, "packages", "mcp", "dist");
  await rename(output, join(fixture.directory, "original-mcp-dist"));
  await symlink(
    target,
    output,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(cleanBuildOutputs(fixture.root));
  assert.equal(
    await readFile(join(target, "keep.js"), "utf8"),
    "synthetic outside sentinel\n",
  );
  await access(join(fixture.root, "packages", "contracts", "dist", "extra.js"));
});

test("a link nested inside an output tree is rejected before recursive cleanup", async (t) => {
  const fixture = await outputFixture(t);
  const target = join(fixture.directory, "outside-nested");
  await mkdir(target);
  await writeFile(join(target, "keep.js"), "synthetic nested sentinel\n");
  const output = join(fixture.root, "packages", "mcp", "dist", "linked");
  await symlink(
    target,
    output,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(cleanBuildOutputs(fixture.root));
  await access(join(target, "keep.js"));
  await access(join(fixture.root, "packages", "contracts", "dist", "extra.js"));
});

test("a non-file incremental cache is rejected rather than recursively removed", async (t) => {
  const fixture = await outputFixture(t);
  const cache = join(fixture.root, "packages", "mcp", "tsconfig.tsbuildinfo");
  await rename(cache, join(fixture.directory, "original-mcp-cache"));
  await mkdir(cache);
  await writeFile(
    join(cache, "keep.txt"),
    "must not recursively delete a cache directory\n",
  );
  await assert.rejects(cleanBuildOutputs(fixture.root));
  await access(join(cache, "keep.txt"));
  await access(join(fixture.root, "packages", "contracts", "dist", "extra.js"));
});

test("a linked package directory cannot redirect cleanup outside the checkout", async (t) => {
  const fixture = await outputFixture(t);
  const packageRoot = join(fixture.root, "packages", "mcp");
  const target = join(fixture.directory, "outside-mcp");
  await rename(packageRoot, target);
  await symlink(
    target,
    packageRoot,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(cleanBuildOutputs(fixture.root));
  await access(join(target, "dist", "extra.js"));
  await access(join(fixture.root, "packages", "contracts", "dist", "extra.js"));
});
