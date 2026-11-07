import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../tests/release/", import.meta.url));
const entries = await readdir(directory, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.name.endsWith(".test.mjs"))
  .map((entry) => {
    assert.ok(
      entry.isFile(),
      "Release regression entries must be regular files.",
    );
    return join(directory, entry.name);
  })
  .sort();
assert.ok(files.length > 0, "No release regression tests were found.");
const result = spawnSync(process.execPath, ["--test", ...files], {
  shell: false,
  stdio: "inherit",
  timeout: 300_000,
});
if (result.error)
  throw new Error("Release regression tests could not complete.");
process.exitCode = result.status ?? 1;
