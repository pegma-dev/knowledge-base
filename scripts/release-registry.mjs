import { spawnSync } from "node:child_process";
import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { RELEASE_PACKAGES, RELEASE_REPOSITORY } from "./release-contract.mjs";
import {
  validatePreparedManifest,
  verifyPreparedManifest,
} from "./release-manifest.mjs";

export const RELEASE_NPM_VERSION = "11.18.0";
export const RELEASE_WORKFLOW = ".github/workflows/publish.yml";
const registry = "https://registry.npmjs.org/";
const provenanceType = "https://slsa.dev/provenance/v1";
const temporaryPrefix = "knowledge-base-registry-";

function fail(message) {
  // Never surface native command output, registry response bodies, or credentials.
  throw new Error(message);
}

function equal(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hash(bytes, algorithm, encoding = "hex") {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function sameDependencies(actual, expected) {
  return (
    actual !== null &&
    typeof actual === "object" &&
    !Array.isArray(actual) &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(
      ([name, version]) => actual[name] === version,
    )
  );
}

function tarballUrl(record) {
  return `${registry}${record.name}/-/${record.name.split("/")[1]}-${record.version}.tgz`;
}

async function responseBytes(response, maximum) {
  const length = response.headers?.get("content-length");
  if (
    length !== null &&
    length !== undefined &&
    (!/^\d+$/u.test(length) || Number(length) > maximum)
  ) {
    await response.body?.cancel();
    fail("registry response exceeded its release verification limit");
  }
  const chunks = [];
  let size = 0;
  if (response.body === null || response.body === undefined)
    return Buffer.alloc(0);
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) {
      fail("registry response exceeded its release verification limit");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

async function request(url, fetch) {
  try {
    return await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { accept: "application/json" },
    });
  } catch {
    fail("registry lookup failed; package availability is unknown");
  }
}

async function registryRecord(record, fetch) {
  const response = await request(
    `${registry}${encodeURIComponent(record.name)}/${record.version}`,
    fetch,
  );
  // Authentication errors, throttling, server errors, redirects, and malformed
  // responses are unknown states. Only this exact response establishes absence.
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    fail("registry lookup failed; package availability is unknown");
  }
  let metadata;
  try {
    metadata = JSON.parse(
      (await responseBytes(response, 2 * 1024 * 1024)).toString("utf8"),
    );
  } catch {
    fail("registry package metadata verification failed");
  }
  if (
    metadata?.name !== record.name ||
    metadata.version !== record.version ||
    !sameDependencies(metadata.dependencies, record.dependencies) ||
    !equal(metadata.dist?.integrity, record.integrity) ||
    !equal(metadata.dist?.shasum, record.shasum) ||
    metadata.dist?.tarball !== tarballUrl(record) ||
    [
      "optionalDependencies",
      "peerDependencies",
      "bundledDependencies",
      "bundleDependencies",
    ].some((key) => metadata[key] !== undefined)
  ) {
    fail("registry version conflicts with the prepared release");
  }
  const tarball = await request(metadata.dist.tarball, fetch);
  if (tarball.status !== 200) {
    await tarball.body?.cancel();
    fail("registry tarball verification failed");
  }
  let bytes;
  try {
    bytes = await responseBytes(tarball, record.size);
  } catch {
    fail("registry tarball verification failed");
  }
  if (
    bytes.length !== record.size ||
    !equal(hash(bytes, "sha1"), record.shasum) ||
    !equal(`sha512-${hash(bytes, "sha512", "base64")}`, record.integrity)
  ) {
    fail("registry tarball conflicts with the prepared release");
  }
  return metadata;
}

export async function preflightRegistry(
  verified,
  { fetch = globalThis.fetch } = {},
) {
  const manifest = validatePreparedManifest(verified?.manifest);
  const decisions = [];
  // Finish the entire set before the caller can publish even the first package.
  for (const record of manifest.artifacts) {
    const metadata = await registryRecord(record, fetch);
    decisions.push(
      Object.freeze({
        name: record.name,
        version: record.version,
        action: metadata === null ? "publish" : "skip",
        ...(metadata === null ? {} : { metadata }),
      }),
    );
  }
  return Object.freeze(decisions);
}

export function assertTrustedPublishingEnvironment(env, identity) {
  const workflow = `${RELEASE_REPOSITORY}/${RELEASE_WORKFLOW}@refs/tags/${identity.tag}`;
  let oidcUrl;
  try {
    oidcUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  } catch {
    fail("publishing requires the approved GitHub Actions OIDC environment");
  }
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "release" ||
    env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY ||
    env.GITHUB_SERVER_URL !== "https://github.com" ||
    env.GITHUB_REF !== `refs/tags/${identity.tag}` ||
    env.GITHUB_SHA !== identity.commit ||
    env.GITHUB_WORKFLOW_REF !== workflow ||
    env.GITHUB_WORKFLOW_SHA !== identity.commit ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    oidcUrl.protocol !== "https:" ||
    oidcUrl.username !== "" ||
    oidcUrl.password !== "" ||
    !/^(?:[A-Za-z0-9-]+\.)*actions\.githubusercontent\.com$/u.test(
      oidcUrl.hostname,
    ) ||
    typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN !== "string" ||
    env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length === 0
  ) {
    fail("publishing requires the approved GitHub Actions OIDC environment");
  }
  if (
    Object.entries(env).some(
      ([key, value]) =>
        value !== undefined &&
        value !== "" &&
        (/^(?:NODE_AUTH_TOKEN|NPM_TOKEN|NPM_AUTH_TOKEN|NPM_AUTH|YARN_NPM_AUTH_TOKEN)$/iu.test(
          key,
        ) ||
          /^npm_config_/iu.test(key)),
    )
  ) {
    fail("publishing rejects npm credentials and inherited npm configuration");
  }
}

async function nativeRun(command, arguments_, { cwd, env }) {
  const result = spawnSync(command, arguments_, {
    cwd,
    env,
    shell: false,
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 5 * 60_000,
  });
  if (result.error || result.status !== 0) {
    fail("release npm or consumer verification command failed");
  }
  return result;
}

async function temporary(action) {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, temporaryPrefix));
  try {
    return await action(directory);
  } finally {
    const target = await realpath(directory);
    if (
      dirname(target) !== parent ||
      !basename(target).startsWith(temporaryPrefix)
    ) {
      fail("registry consumer cleanup refused an unexpected directory");
    }
    await rm(target, { recursive: true, force: true });
  }
}

function isolatedEnvironment(env, directory, publishing) {
  const clean = {};
  // Pinned npm needs public provenance metadata and its OIDC request credential.
  const publishingKeys = new Set([
    "GITHUB_ACTIONS",
    "GITHUB_EVENT_NAME",
    "GITHUB_REPOSITORY",
    "GITHUB_REPOSITORY_ID",
    "GITHUB_REPOSITORY_OWNER_ID",
    "GITHUB_SERVER_URL",
    "GITHUB_REF",
    "GITHUB_SHA",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_WORKFLOW_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "RUNNER_ENVIRONMENT",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  ]);
  for (const [key, value] of Object.entries(env)) {
    if (
      /^(?:PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA)$/iu.test(
        key,
      ) ||
      (publishing && publishingKeys.has(key))
    ) {
      clean[key] = value;
    }
  }
  return {
    ...clean,
    CI: "true",
    npm_config_userconfig: join(directory, "user.npmrc"),
    npm_config_globalconfig: join(directory, "global.npmrc"),
    npm_config_cache: join(directory, "cache"),
    npm_config_registry: registry,
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    ...(publishing ? { GITHUB_ACTIONS: "true" } : {}),
  };
}

async function npmContext(options, seams, directory, publishing) {
  const sourceEnv = seams.env ?? process.env;
  const cli = options.npmCli ?? sourceEnv.RELEASE_NPM_CLI;
  const version =
    options.npmVersion ?? sourceEnv.RELEASE_NPM_VERSION ?? RELEASE_NPM_VERSION;
  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 14)) {
    fail("trusted release verification requires Node 22.14 or newer");
  }
  if (
    typeof cli !== "string" ||
    !isAbsolute(cli) ||
    basename(cli) !== "npm-cli.js" ||
    version !== RELEASE_NPM_VERSION
  ) {
    fail("release operations require the reviewed pinned npm CLI");
  }
  const metadata = await lstat(cli);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail("release operations require the reviewed pinned npm CLI");
  }
  await writeFile(join(directory, "user.npmrc"), "", { flag: "wx" });
  await writeFile(join(directory, "global.npmrc"), "", { flag: "wx" });
  await writeFile(join(directory, ".npmrc"), `registry=${registry}\n`, {
    flag: "wx",
  });
  const env = isolatedEnvironment(sourceEnv, directory, publishing);
  const run = seams.run ?? nativeRun;
  const invoke = async (arguments_) => {
    let result;
    try {
      result = await run(process.execPath, [resolve(cli), ...arguments_], {
        cwd: directory,
        env,
      });
    } catch {
      fail("release npm or consumer verification command failed");
    }
    if (result?.status !== 0 || typeof result.stdout !== "string") {
      fail("release npm or consumer verification command failed");
    }
    return result.stdout;
  };
  if ((await invoke(["--version"])).trim() !== version) {
    fail("release operations require the reviewed pinned npm CLI");
  }
  return { invoke, env, run };
}

function derValue(bytes, start) {
  const tag = bytes[start];
  const initialLength = bytes[start + 1];
  if (initialLength === undefined) fail("invalid provenance certificate");
  let offset = start + 2;
  let length = initialLength;
  if (initialLength > 127) {
    const count = initialLength & 127;
    if (count < 1 || count > 4 || offset + count > bytes.length) {
      fail("invalid provenance certificate");
    }
    length = 0;
    for (let index = 0; index < count; index += 1) {
      length = length * 256 + bytes[offset++];
    }
  }
  if (offset + length > bytes.length) fail("invalid provenance certificate");
  return {
    tag,
    value: bytes.subarray(offset, offset + length),
    end: offset + length,
  };
}

function certificateIssuer(certificate) {
  // Fulcio's OIDC issuer extension (1.3.6.1.4.1.57264.1.1) distinguishes
  // GitHub identities from other OIDC providers trusted by Sigstore. Parse DER
  // structure, rather than searching for attacker-controlled certificate text.
  const outer = derValue(certificate.raw, 0);
  const tbs = derValue(outer.value, 0);
  if (outer.tag !== 0x30 || tbs.tag !== 0x30)
    fail("invalid provenance certificate");
  let extensions;
  for (let offset = 0; offset < tbs.value.length;) {
    const field = derValue(tbs.value, offset);
    if (field.tag === 0xa3) extensions = derValue(field.value, 0);
    offset = field.end;
  }
  if (extensions?.tag !== 0x30) fail("invalid provenance certificate");
  let issuer;
  for (let offset = 0; offset < extensions.value.length;) {
    const extension = derValue(extensions.value, offset);
    const oid = derValue(extension.value, 0);
    let value = derValue(extension.value, oid.end);
    if (value.tag === 0x01) value = derValue(extension.value, value.end);
    if (extension.tag !== 0x30 || oid.tag !== 0x06 || value.tag !== 0x04) {
      fail("invalid provenance certificate");
    }
    if (oid.value.toString("hex") === "2b0601040183bf300101") {
      if (issuer !== undefined) fail("invalid provenance certificate");
      issuer = value.value.toString("utf8");
    }
    offset = extension.end;
  }
  return issuer;
}

function verifyCertificateIdentity(bundle, identity) {
  try {
    const material = bundle.verificationMaterial;
    const encoded =
      material.certificate?.rawBytes ??
      material.x509CertificateChain?.certificates?.[0]?.rawBytes;
    if (typeof encoded !== "string" || encoded.length > 64 * 1024) {
      fail("invalid provenance certificate");
    }
    const certificate = new X509Certificate(Buffer.from(encoded, "base64"));
    if (
      certificate.subjectAltName !==
        `URI:https://github.com/${RELEASE_REPOSITORY}/${RELEASE_WORKFLOW}@refs/tags/${identity.tag}` ||
      certificateIssuer(certificate) !==
        "https://token.actions.githubusercontent.com"
    ) {
      fail("invalid provenance certificate");
    }
  } catch {
    fail(
      "verified provenance signer does not match the approved release workflow",
    );
  }
}

export function verifyProvenanceAudit(audit, manifest) {
  validatePreparedManifest(manifest);
  if (
    !Array.isArray(audit?.invalid) ||
    audit.invalid.length !== 0 ||
    !Array.isArray(audit.missing) ||
    audit.missing.length !== 0 ||
    !Array.isArray(audit.verified)
  ) {
    fail("registry signatures or provenance verification failed");
  }
  const identity = manifest.identity;
  for (const record of manifest.artifacts) {
    const matches = audit.verified.filter(
      (entry) =>
        entry.name === record.name &&
        entry.version === record.version &&
        entry.location === `node_modules/${record.name}` &&
        entry.registry === registry,
    );
    if (matches.length !== 1 || !Array.isArray(matches[0].attestationBundles)) {
      fail("release package is missing verified source provenance");
    }
    const bundles = matches[0].attestationBundles.filter(
      (entry) => entry.predicateType === provenanceType,
    );
    if (bundles.length !== 1)
      fail("release package is missing verified source provenance");
    verifyCertificateIdentity(bundles[0].bundle, identity);
    let statement;
    try {
      const envelope = bundles[0].bundle.dsseEnvelope;
      if (
        envelope.payloadType !== "application/vnd.in-toto+json" ||
        typeof envelope.payload !== "string" ||
        envelope.payload.length > 1024 * 1024
      ) {
        fail("invalid provenance statement");
      }
      statement = JSON.parse(
        Buffer.from(envelope.payload, "base64").toString("utf8"),
      );
    } catch {
      fail("release source provenance verification failed");
    }
    const definition = statement.predicate?.buildDefinition;
    const workflow = definition?.externalParameters?.workflow;
    const dependencies = definition?.resolvedDependencies;
    const expectedDigest = Buffer.from(
      record.integrity.slice(7),
      "base64",
    ).toString("hex");
    if (
      statement._type !== "https://in-toto.io/Statement/v1" ||
      statement.predicateType !== provenanceType ||
      !Array.isArray(statement.subject) ||
      statement.subject.length !== 1 ||
      statement.subject[0].name !==
        `pkg:npm/${record.name.split("/").map(encodeURIComponent).join("/")}@${record.version}` ||
      !equal(statement.subject[0].digest?.sha512, expectedDigest) ||
      definition?.buildType !==
        "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1" ||
      workflow?.repository !== `https://github.com/${RELEASE_REPOSITORY}` ||
      workflow.path !== RELEASE_WORKFLOW ||
      workflow.ref !== `refs/tags/${identity.tag}` ||
      definition.internalParameters?.github?.event_name !== "release" ||
      !Array.isArray(dependencies) ||
      dependencies.length !== 1 ||
      dependencies[0].uri !==
        `git+https://github.com/${RELEASE_REPOSITORY}@refs/tags/${identity.tag}` ||
      !equal(dependencies[0].digest?.gitCommit, identity.commit) ||
      statement.predicate?.runDetails?.builder?.id !==
        "https://github.com/actions/runner/github-hosted"
    ) {
      fail("release source provenance does not match the prepared identity");
    }
  }
}

async function registryConsumer(verified, options, seams) {
  return temporary(async (directory) => {
    const { invoke, env, run } = await npmContext(
      options,
      seams,
      directory,
      false,
    );
    const dependencies = Object.fromEntries(
      verified.manifest.artifacts.map((record) => [
        record.name,
        record.version,
      ]),
    );
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({
        name: "knowledge-base-registry-proof",
        private: true,
        type: "module",
        dependencies,
      })}\n`,
      { flag: "wx" },
    );
    // Exact registry specifiers only. No tarballs, workspace links, source build,
    // project dependency installation, lifecycle scripts, or inherited npmrc.
    await invoke([
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--registry",
      registry,
    ]);
    const lock = JSON.parse(
      await readFile(join(directory, "package-lock.json"), "utf8"),
    );
    for (const record of verified.manifest.artifacts) {
      const installed = lock.packages?.[`node_modules/${record.name}`];
      if (
        installed?.version !== record.version ||
        installed.link === true ||
        !equal(installed.integrity, record.integrity) ||
        installed.resolved !== tarballUrl(record)
      ) {
        fail("registry consumer did not install the prepared exact release");
      }
    }
    let audit;
    try {
      // npm performs the Sigstore/TUF cryptographic verification; the additional
      // source checks below constrain the verified statement to this exact tag.
      // https://docs.npmjs.com/generating-provenance-statements/#verifying-provenance-attestations
      audit = JSON.parse(
        await invoke([
          "audit",
          "signatures",
          "--json",
          "--include-attestations",
          "--registry",
          registry,
        ]),
      );
    } catch {
      fail("registry signatures or provenance verification failed");
    }
    verifyProvenanceAudit(audit, verified.manifest);
    // Authenticate all installed artifacts before executing any consumer import;
    // imported package code must not be able to forge the preceding npm audit.
    const source = `import assert from "node:assert/strict";\n${RELEASE_PACKAGES.map(
      (entry) =>
        `assert.equal(typeof (await import(${JSON.stringify(entry.name)}))[${JSON.stringify(entry.runtimeExport)}], ${JSON.stringify(entry.runtimeExportType)});`,
    ).join("\n")}\n`;
    const consumer = join(directory, "consumer.mjs");
    await writeFile(consumer, source, { flag: "wx" });
    let imported;
    try {
      imported = await run(process.execPath, [consumer], {
        cwd: directory,
        env,
      });
    } catch {
      fail("registry consumer public imports failed");
    }
    if (imported?.status !== 0) fail("registry consumer public imports failed");
  });
}

async function confirmRegistry(record, seams) {
  const sleep =
    seams.sleep ??
    ((milliseconds) =>
      new Promise((resolve_) => setTimeout(resolve_, milliseconds)));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (
      (await registryRecord(record, seams.fetch ?? globalThis.fetch)) !== null
    )
      return;
    if (attempt < 5) await sleep(2 ** attempt * 1000);
  }
  fail("published registry version was not visible after bounded verification");
}

async function verifyPublishedBytes(verified, seams) {
  const plan = await preflightRegistry(verified, seams);
  if (plan.some((entry) => entry.action !== "skip")) {
    fail("the complete release set is not available from the registry");
  }
  return Object.freeze({
    verified: true,
    packages: Object.freeze(plan.map((entry) => entry.name)),
  });
}

export async function verifyRegistryRelease(options = {}, seams = {}) {
  const verified = await verifyPreparedManifest(options);
  const result = await verifyPublishedBytes(verified, seams);
  await registryConsumer(verified, options, seams);
  return result;
}

export async function publishPreparedRelease(options = {}, seams = {}) {
  const verified = await verifyPreparedManifest(options);
  assertTrustedPublishingEnvironment(
    seams.env ?? process.env,
    verified.manifest.identity,
  );
  const plan = await preflightRegistry(verified, seams);
  const published = [];
  const skipped = [];
  await temporary(async (directory) => {
    const { invoke } = await npmContext(options, seams, directory, true);
    // Snapshot the already verified bytes outside the checkout. Npm cannot read
    // project .npmrc or run source/prepack scripts in this privileged job.
    for (const record of verified.artifacts) {
      const destination = join(directory, record.filename);
      await copyFile(record.path, destination);
      const bytes = await readFile(destination);
      if (
        bytes.length !== record.size ||
        !equal(`sha512-${hash(bytes, "sha512", "base64")}`, record.integrity)
      ) {
        fail("prepared publish artifact changed after verification");
      }
    }
    for (const [index, decision] of plan.entries()) {
      const record = verified.artifacts[index];
      if (decision.action === "skip") {
        skipped.push(record.name);
        continue;
      }
      const destination = join(directory, record.filename);
      // Recheck immutable versions immediately before publication to recover
      // another run's successful publication without overwriting anything.
      if (
        (await registryRecord(record, seams.fetch ?? globalThis.fetch)) !== null
      ) {
        skipped.push(record.name);
        continue;
      }
      await invoke([
        "publish",
        destination,
        "--ignore-scripts",
        "--access",
        "public",
        "--provenance",
        "--registry",
        registry,
      ]);
      published.push(record.name);
      await confirmRegistry(record, seams);
    }
  });
  await verifyPublishedBytes(verified, seams);
  return Object.freeze({
    published: Object.freeze(published),
    skipped: Object.freeze(skipped),
    verified: true,
  });
}
