import { constants } from "node:fs";
import { lstat, open, realpath, writeFile } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import {
  RELEASE_PACKAGES,
  RELEASE_REPOSITORY,
  STABLE_VERSION,
  releaseDependencies,
} from "./release-contract.mjs";

export const PREPARED_MANIFEST_LIMITS = Object.freeze({
  manifestBytes: 2 * 1024 * 1024,
  artifactBytes: 16 * 1024 * 1024,
  totalArtifactBytes: 64 * 1024 * 1024,
  filesPerArtifact: 4096,
  fileBytes: 32 * 1024 * 1024,
  unpackedBytesPerArtifact: 64 * 1024 * 1024,
});

function fail() {
  throw new Error("prepared release manifest or artifact verification failed");
}

function exactKeys(value, expected) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail();
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail();
  }
}

function boundedInteger(value, maximum, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail();
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hash(bytes, algorithm, encoding = "hex") {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function validateIdentity(identity) {
  exactKeys(identity, ["repository", "tag", "commit", "version"]);
  if (
    identity.repository !== RELEASE_REPOSITORY ||
    typeof identity.version !== "string" ||
    !STABLE_VERSION.test(identity.version) ||
    identity.tag !== `v${identity.version}` ||
    typeof identity.commit !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(identity.commit)
  ) {
    fail();
  }
}

function validateFiles(files) {
  if (
    !Array.isArray(files) ||
    files.length < 5 ||
    files.length > PREPARED_MANIFEST_LIMITS.filesPerArtifact
  ) {
    fail();
  }
  const paths = new Set();
  let total = 0;
  for (const file of files) {
    exactKeys(file, ["path", "size"]);
    if (
      typeof file.path !== "string" ||
      file.path.length > 256 ||
      paths.has(file.path) ||
      file.path
        .split("/")
        .some((part) => part === "" || part === "." || part === "..") ||
      (!["package.json", "README.md", "LICENSE"].includes(file.path) &&
        (!/^dist\/[A-Za-z0-9_./-]+\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u.test(
          file.path,
        ) ||
          /\.(?:test|spec)\./u.test(file.path)))
    ) {
      fail();
    }
    boundedInteger(file.size, PREPARED_MANIFEST_LIMITS.fileBytes);
    total += file.size;
    if (total > PREPARED_MANIFEST_LIMITS.unpackedBytesPerArtifact) fail();
    paths.add(file.path);
  }
  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    if (!paths.has(required)) fail();
  }
}

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object") deepFreeze(child);
  }
  return Object.freeze(value);
}

export function validatePreparedManifest(manifest) {
  exactKeys(manifest, ["schemaVersion", "identity", "artifacts"]);
  if (manifest.schemaVersion !== 2) fail();
  validateIdentity(manifest.identity);
  if (
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== RELEASE_PACKAGES.length
  ) {
    fail();
  }
  let total = 0;
  for (const [index, record] of manifest.artifacts.entries()) {
    const specification = RELEASE_PACKAGES[index];
    exactKeys(record, [
      "name",
      "version",
      "filename",
      "size",
      "shasum",
      "integrity",
      "dependencies",
      "files",
    ]);
    const filename = `${specification.name.slice(1).replace("/", "-")}-${manifest.identity.version}.tgz`;
    if (
      record.name !== specification.name ||
      record.version !== manifest.identity.version ||
      record.filename !== filename ||
      basename(record.filename) !== record.filename ||
      record.filename.length > 200 ||
      typeof record.shasum !== "string" ||
      !/^[0-9a-f]{40}$/u.test(record.shasum) ||
      typeof record.integrity !== "string" ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(record.integrity)
    ) {
      fail();
    }
    boundedInteger(record.size, PREPARED_MANIFEST_LIMITS.artifactBytes, 1);
    total += record.size;
    if (total > PREPARED_MANIFEST_LIMITS.totalArtifactBytes) fail();
    const dependencies = releaseDependencies(
      specification.directory,
      record.version,
    );
    exactKeys(record.dependencies, Object.keys(dependencies));
    for (const [name, version] of Object.entries(dependencies)) {
      if (record.dependencies[name] !== version) fail();
    }
    validateFiles(record.files);
  }
  return deepFreeze(manifest);
}

async function canonicalDirectory(preparedDir) {
  if (typeof preparedDir !== "string" || preparedDir.length === 0) fail();
  const directory = resolve(preparedDir);
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail();
  return realpath(directory);
}

async function readBoundedFile(path, directory, maximum) {
  if (dirname(resolve(path)) !== directory) fail();
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail();
  if ((await realpath(path)) !== join(directory, basename(path))) fail();
  boundedInteger(metadata.size, maximum, 1);
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== metadata.dev ||
      opened.ino !== metadata.ino ||
      opened.size !== metadata.size
    ) {
      fail();
    }
    // Read no more than the validated size plus one byte, including if a file
    // grows concurrently. No archive contents or package scripts are executed.
    const bytes = Buffer.alloc(metadata.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length !== metadata.size) fail();
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

async function verifyArtifacts(manifest, directory) {
  const artifacts = [];
  for (const record of manifest.artifacts) {
    const path = join(directory, record.filename);
    const bytes = await readBoundedFile(
      path,
      directory,
      PREPARED_MANIFEST_LIMITS.artifactBytes,
    );
    if (
      bytes.length !== record.size ||
      !safeEqual(hash(bytes, "sha1"), record.shasum) ||
      !safeEqual(`sha512-${hash(bytes, "sha512", "base64")}`, record.integrity)
    ) {
      fail();
    }
    artifacts.push(Object.freeze({ ...record, path }));
  }
  return Object.freeze(artifacts);
}

export async function writePreparedManifest({
  preparedDir,
  identity,
  artifacts,
} = {}) {
  try {
    // Copy the approved data before freezing it; never freeze the producer's
    // npm metadata or mutable source package manifests as a side effect.
    const manifest = validatePreparedManifest(
      structuredClone({ schemaVersion: 2, identity, artifacts }),
    );
    const directory = await canonicalDirectory(preparedDir);
    await verifyArtifacts(manifest, directory);
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    if (bytes.length > PREPARED_MANIFEST_LIMITS.manifestBytes) fail();
    const manifestPath = join(directory, "manifest.json");
    await writeFile(manifestPath, bytes, { flag: "wx", mode: 0o644 });
    return Object.freeze({
      manifestPath,
      manifest,
      manifestSha256: hash(bytes, "sha256"),
    });
  } catch {
    fail();
  }
}

export async function verifyPreparedManifest({
  preparedDir,
  manifestPath,
  expectedManifestSha256,
  expectedTag,
  expectedCommit,
  expectedVersion,
} = {}) {
  try {
    if (
      typeof expectedManifestSha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(expectedManifestSha256) ||
      typeof expectedTag !== "string" ||
      typeof expectedCommit !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(expectedCommit)
    ) {
      fail();
    }
    const directory = await canonicalDirectory(preparedDir);
    const path =
      manifestPath === undefined
        ? join(directory, "manifest.json")
        : resolve(manifestPath);
    if (basename(path) !== "manifest.json") fail();
    const bytes = await readBoundedFile(
      path,
      directory,
      PREPARED_MANIFEST_LIMITS.manifestBytes,
    );
    const manifestSha256 = hash(bytes, "sha256");
    if (!safeEqual(manifestSha256, expectedManifestSha256)) fail();
    const manifest = validatePreparedManifest(
      JSON.parse(bytes.toString("utf8")),
    );
    if (
      manifest.identity.tag !== expectedTag ||
      manifest.identity.commit !== expectedCommit ||
      (expectedVersion !== undefined &&
        manifest.identity.version !== expectedVersion)
    ) {
      fail();
    }
    const artifacts = await verifyArtifacts(manifest, directory);
    return Object.freeze({
      manifestPath: path,
      manifest,
      manifestSha256,
      artifacts,
    });
  } catch {
    // Do not include parsed contents, paths, environment values, native command
    // output, or registry credentials in release errors.
    fail();
  }
}
