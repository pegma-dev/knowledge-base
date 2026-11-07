import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const temporaryPrefix = "pegma-kb-release-test-";

export const identity = Object.freeze({
  repository: "pegma-dev/knowledge-base",
  tag: "v0.1.0",
  commit: "a".repeat(40),
  version: "0.1.0",
});

export const specifications = [
  {
    directory: "contracts",
    name: "@pegma/knowledge-base-contracts",
    dependencies: { "@pegma/spine": "0.1.2" },
  },
  {
    directory: "core",
    name: "@pegma/knowledge-base-core",
    dependencies: { "@pegma/knowledge-base-contracts": "0.1.0" },
  },
  {
    directory: "application",
    name: "@pegma/knowledge-base-application",
    dependencies: {
      "@pegma/audit": "0.2.0",
      "@pegma/authorization-core": "0.4.0",
      "@pegma/knowledge-base-contracts": "0.1.0",
      "@pegma/knowledge-base-core": "0.1.0",
      "@pegma/spine": "0.1.2",
      "@pegma/storage-core": "0.4.0",
    },
  },
  {
    directory: "mcp",
    name: "@pegma/knowledge-base-mcp",
    dependencies: {
      "@cfworker/json-schema": "4.1.6",
      "@modelcontextprotocol/sdk": "1.32.2",
      "@pegma/authorization-core": "0.4.0",
      "@pegma/knowledge-base-application": "0.1.0",
      "@pegma/knowledge-base-contracts": "0.1.0",
      "@pegma/knowledge-base-core": "0.1.0",
      zod: "4.6.7",
    },
  },
];

export function digest(bytes, algorithm = "sha256", encoding = "hex") {
  return createHash(algorithm).update(bytes).digest(encoding);
}

const certificates = new Map();

export function syntheticCertificate({
  workflow = ".github/workflows/publish.yml",
  issuer = "https://token.actions.githubusercontent.com",
} = {}) {
  const identityKey = `${workflow}:${issuer}`;
  if (certificates.has(identityKey)) return certificates.get(identityKey);
  const der = (tag, ...parts) => {
    const value = Buffer.concat(parts);
    let length;
    if (value.length < 128) {
      length = Buffer.from([value.length]);
    } else {
      let hexadecimal = value.length.toString(16);
      if (hexadecimal.length % 2 !== 0) hexadecimal = `0${hexadecimal}`;
      const bytes = Buffer.from(hexadecimal, "hex");
      length = Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes]);
    }
    return Buffer.concat([Buffer.from([tag]), length, value]);
  };
  const oid = (hexadecimal) => der(0x06, Buffer.from(hexadecimal, "hex"));
  const sequence = (...parts) => der(0x30, ...parts);
  const text = (value) => Buffer.from(value, "utf8");
  const algorithm = sequence(oid("2a8648ce3d040302"));
  const name = sequence(
    der(
      0x31,
      sequence(oid("550403"), der(0x0c, text("Synthetic fixture only"))),
    ),
  );
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const extensions = sequence(
    sequence(
      oid("551d11"),
      der(
        0x04,
        sequence(
          der(
            0x86,
            text(
              `https://github.com/pegma-dev/knowledge-base/${workflow}@refs/tags/v0.1.0`,
            ),
          ),
        ),
      ),
    ),
    sequence(oid("2b0601040183bf300101"), der(0x04, text(issuer))),
  );
  const body = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.from([1])),
    algorithm,
    name,
    sequence(
      der(0x17, text("260101000000Z")),
      der(0x17, text("350101000000Z")),
    ),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    der(0xa3, extensions),
  );
  // A real, self-signed X.509 fixture lets the parser inspect DER and SANs.
  // It establishes no Sigstore trust: npm's cryptographic audit is a run seam.
  const certificate = sequence(
    body,
    algorithm,
    der(0x03, Buffer.from([0]), sign("sha256", body, privateKey)),
  ).toString("base64");
  certificates.set(identityKey, certificate);
  return certificate;
}

export async function temporaryDirectory(t) {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, temporaryPrefix));
  t.after(async () => {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(parent));
    assert.ok(basename(target).startsWith(temporaryPrefix));
    assert.notEqual(target, resolve(parent));
    await rm(target, { recursive: true, force: true });
  });
  return directory;
}

export async function preparedFixture(t) {
  const directory = await temporaryDirectory(t);
  const preparedDir = join(directory, "prepared");
  await mkdir(preparedDir);
  const artifacts = [];
  for (const specification of specifications) {
    // Manifest verification treats tarballs as opaque, previously reviewed
    // blobs. These fixtures exercise its byte boundary without executing npm.
    const bytes = Buffer.from(`synthetic artifact: ${specification.name}\n`);
    const filename = `${specification.name.slice(1).replace("/", "-")}-0.1.0.tgz`;
    await writeFile(join(preparedDir, filename), bytes);
    artifacts.push({
      name: specification.name,
      version: "0.1.0",
      filename,
      size: bytes.length,
      shasum: digest(bytes, "sha1"),
      integrity: `sha512-${digest(bytes, "sha512", "base64")}`,
      dependencies: structuredClone(specification.dependencies),
      files: [
        { path: "package.json", size: 250 },
        { path: "README.md", size: 32 },
        { path: "LICENSE", size: 1_000 },
        { path: "dist/index.js", size: 64 },
        { path: "dist/index.d.ts", size: 64 },
      ],
    });
  }
  return { directory, preparedDir, identity: { ...identity }, artifacts };
}

export async function rewriteManifest(preparedDir, change) {
  const manifestPath = join(preparedDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  change(manifest);
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(manifestPath, bytes);
  return digest(bytes);
}

export function run(command, arguments_, cwd, env) {
  const result = spawnSync(command, arguments_, {
    cwd,
    env,
    shell: false,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  return result.stdout.trim();
}

export function withGitEnvironment(env, operation) {
  const isGit = (key) => key.toUpperCase().startsWith("GIT_");
  const original = Object.entries(process.env).filter(([key]) => isGit(key));
  const clear = () => {
    for (const key of Object.keys(process.env)) {
      if (isGit(key)) delete process.env[key];
    }
  };
  // The release verifier is synchronous, so the environment is restored before
  // any other asynchronous test work can observe these scoped fixture values.
  clear();
  try {
    for (const [key, value] of Object.entries(env)) {
      if (isGit(key)) process.env[key] = value;
    }
    return operation();
  } finally {
    clear();
    for (const [key, value] of original) process.env[key] = value;
  }
}

export async function signedGitFixture(t) {
  const directory = await temporaryDirectory(t);
  const root = join(directory, "checkout");
  const signingKey = join(directory, "signing-key");
  const allowedSigners = join(directory, "allowed-signers");
  const emptyConfig = join(directory, "empty-gitconfig");
  await mkdir(root);
  await writeFile(emptyConfig, "");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith("GIT_")) delete env[key];
  }
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  });
  const git = (...arguments_) =>
    run(
      process.platform === "win32" ? "git.exe" : "git",
      ["--no-replace-objects", ...arguments_],
      root,
      env,
    );
  run(
    process.platform === "win32" ? "ssh-keygen.exe" : "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-f", signingKey],
    directory,
    env,
  );
  const publicKey = (await readFile(`${signingKey}.pub`, "utf8")).trim();
  await writeFile(
    allowedSigners,
    `release-fixture@example.invalid ${publicKey}\n`,
  );
  git("init", "--initial-branch=main");
  git("config", "user.name", "Synthetic Release Fixture");
  git("config", "user.email", "release-fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("config", "core.hooksPath", join(directory, "unused-hooks"));
  git("config", "gpg.format", "ssh");
  git("config", "user.signingkey", signingKey);
  git("config", "gpg.ssh.allowedSignersFile", allowedSigners);
  await writeFile(join(root, "README.md"), "Synthetic release fixture.\n");
  git("add", "README.md");
  git("commit", "-m", "Create synthetic release fixture");
  const commit = git("rev-parse", "HEAD");
  git(
    "remote",
    "add",
    "origin",
    "https://github.com/pegma-dev/knowledge-base.git",
  );
  git("update-ref", "refs/remotes/origin/main", commit);
  git("tag", "-s", "v0.1.0", "-m", "Synthetic signed release");
  return { directory, root, git, env, commit, allowedSigners };
}
