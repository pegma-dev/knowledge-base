import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
  assertTrustedPublishingEnvironment,
  preflightRegistry,
  publishPreparedRelease,
  RELEASE_WORKFLOW,
  verifyProvenanceAudit,
  verifyRegistryRelease,
} from "../../scripts/release-registry.mjs";
import {
  verifyPreparedManifest,
  writePreparedManifest,
} from "../../scripts/release-manifest.mjs";
import {
  identity,
  preparedFixture,
  syntheticCertificate,
} from "./fixtures.mjs";

const registry = "https://registry.npmjs.org/";

function tarballUrl(record) {
  return `${registry}${record.name}/-/${record.name.split("/")[1]}-${record.version}.tgz`;
}

function metadata(record) {
  return {
    name: record.name,
    version: record.version,
    dependencies: structuredClone(record.dependencies),
    dist: {
      shasum: record.shasum,
      integrity: record.integrity,
      tarball: tarballUrl(record),
    },
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fixture(t) {
  const prepared = await preparedFixture(t);
  const written = await writePreparedManifest(prepared);
  const npmCli = join(prepared.directory, "npm-cli.js");
  await writeFile(npmCli, "// Synthetic seam: never executed.\n");
  const options = {
    preparedDir: prepared.preparedDir,
    expectedManifestSha256: written.manifestSha256,
    expectedTag: identity.tag,
    expectedCommit: identity.commit,
    npmCli,
  };
  const verified = await verifyPreparedManifest(options);
  const blobs = new Map();
  for (const record of verified.artifacts) {
    blobs.set(record.name, await readFile(record.path));
  }
  return { ...prepared, options, verified, blobs };
}

function fakeRegistry(
  fixture,
  present = fixture.verified.artifacts.map(({ name }) => name),
) {
  const state = {
    present: new Set(present),
    requests: [],
    metadata: undefined,
    blob: undefined,
    beforeRequest: undefined,
  };
  state.fetch = async (input, options) => {
    const url = String(input);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    const record = fixture.verified.artifacts.find(
      (record) =>
        url ===
          `${registry}${encodeURIComponent(record.name)}/${record.version}` ||
        url === tarballUrl(record),
    );
    assert.ok(record, `Unexpected registry URL: ${url}`);
    const kind = url === tarballUrl(record) ? "tarball" : "metadata";
    state.requests.push({ kind, name: record.name });
    await state.beforeRequest?.(kind, record);
    if (kind === "metadata") {
      const overridden = await state.metadata?.(record);
      if (overridden !== undefined) return overridden;
      return state.present.has(record.name)
        ? jsonResponse(metadata(record))
        : jsonResponse({ error: "Not found" }, 404);
    }
    const overridden = await state.blob?.(record);
    return overridden ?? new Response(fixture.blobs.get(record.name));
  };
  return state;
}

function trustedEnvironment() {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "release",
    GITHUB_REPOSITORY: "pegma-dev/knowledge-base",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REF: `refs/tags/${identity.tag}`,
    GITHUB_SHA: identity.commit,
    GITHUB_WORKFLOW_REF: `pegma-dev/knowledge-base/${RELEASE_WORKFLOW}@refs/tags/${identity.tag}`,
    GITHUB_WORKFLOW_SHA: identity.commit,
    RUNNER_ENVIRONMENT: "github-hosted",
    ACTIONS_ID_TOKEN_REQUEST_URL:
      "https://pipelines.actions.githubusercontent.com/synthetic",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-oidc-request-token",
    SYNTHETIC_SOURCE_SECRET: "must-not-reach-npm",
  };
}

function publisher(fixture, state) {
  const calls = [];
  const sleeps = [];
  const seams = {
    env: trustedEnvironment(),
    fetch: state.fetch,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    run: async (command, arguments_, context) => {
      calls.push({ command, arguments_, context });
      assert.equal(command, process.execPath);
      assert.equal(arguments_[0], fixture.options.npmCli);
      assert.equal(context.env.SYNTHETIC_SOURCE_SECRET, undefined);
      assert.equal(context.env.npm_config_ignore_scripts, "true");
      assert.equal(context.env.npm_config_registry, registry);
      assert.notEqual(context.cwd, fixture.preparedDir);
      if (arguments_[1] === "--version") {
        return { status: 0, stdout: "11.18.0\n", stderr: "" };
      }
      assert.equal(arguments_[1], "publish");
      const record = fixture.verified.artifacts.find(
        ({ filename }) => filename === basename(arguments_[2]),
      );
      assert.ok(record);
      assert.equal(dirname(arguments_[2]), context.cwd);
      assert.deepEqual(
        await readFile(arguments_[2]),
        fixture.blobs.get(record.name),
      );
      assert.deepEqual(arguments_.slice(3), [
        "--ignore-scripts",
        "--access",
        "public",
        "--provenance",
        "--registry",
        registry,
      ]);
      const initialLookups = new Set(
        state.requests
          .filter(({ kind }) => kind === "metadata")
          .map(({ name }) => name),
      );
      assert.equal(
        initialLookups.size,
        4,
        "every version must be checked before the first npm publish",
      );
      state.present.add(record.name);
      return { status: 0, stdout: "synthetic publication\n", stderr: "" };
    },
  };
  return { seams, calls, sleeps };
}

test("only explicit version 404s produce an ordered all-package publication plan", async (t) => {
  const prepared = await fixture(t);
  const state = fakeRegistry(prepared, []);
  const plan = await preflightRegistry(prepared.verified, {
    fetch: state.fetch,
  });
  assert.deepEqual(
    plan,
    prepared.artifacts.map(({ name, version }) => ({
      name,
      version,
      action: "publish",
    })),
  );
  assert.ok(Object.isFrozen(plan));
  assert.ok(plan.every(Object.isFrozen));
  assert.equal(state.requests.length, 4);
  assert.ok(state.requests.every(({ kind }) => kind === "metadata"));
});

test("existing versions require exact metadata plus downloaded tarball bytes before recovery can skip them", async (t) => {
  const prepared = await fixture(t);
  const state = fakeRegistry(prepared);
  const plan = await preflightRegistry(prepared.verified, {
    fetch: state.fetch,
  });
  assert.deepEqual(
    plan.map(({ action }) => action),
    ["skip", "skip", "skip", "skip"],
  );
  assert.equal(
    state.requests.filter(({ kind }) => kind === "tarball").length,
    4,
  );
});

test("unknown metadata responses and network errors never establish absence", async (t) => {
  for (const status of [
    204,
    301,
    400,
    401,
    403,
    409,
    429,
    500,
    503,
    "network",
    "malformed",
  ]) {
    await t.test(String(status), async (t) => {
      const prepared = await fixture(t);
      const state = fakeRegistry(prepared, []);
      state.metadata = (record) => {
        if (record.name !== prepared.artifacts[3].name) return undefined;
        if (status === "network")
          throw new Error("synthetic-credential-do-not-echo");
        if (status === "malformed")
          return new Response("synthetic-credential-do-not-echo", {
            status: 200,
          });
        return new Response(null, { status });
      };
      const publishing = publisher(prepared, state);
      await assert.rejects(
        publishPreparedRelease(prepared.options, publishing.seams),
        (error) => !error.message.includes("synthetic-credential-do-not-echo"),
      );
      assert.equal(publishing.calls.length, 0);
    });
  }
});

test("a conflicting final version prevents publication of every earlier absent package", async (t) => {
  const prepared = await fixture(t);
  const state = fakeRegistry(prepared, [prepared.artifacts[3].name]);
  state.metadata = (record) => {
    if (record.name !== prepared.artifacts[3].name) return undefined;
    const value = metadata(record);
    value.dependencies.zod = "99.0.0";
    return jsonResponse(value);
  };
  const publishing = publisher(prepared, state);
  await assert.rejects(
    publishPreparedRelease(prepared.options, publishing.seams),
    /conflicts/u,
  );
  assert.equal(publishing.calls.length, 0);
});

test("matching integrity alone cannot authorize wrong metadata or a foreign tarball URL", async (t) => {
  const changes = [
    [
      "name",
      (value) => {
        value.name = "@other/knowledge-base-contracts";
      },
    ],
    [
      "version",
      (value) => {
        value.version = "0.2.0";
      },
    ],
    [
      "dependency",
      (value) => {
        value.dependencies["@pegma/spine"] = "^0.1.2";
      },
    ],
    [
      "extra dependency",
      (value) => {
        value.dependencies.extra = "1.0.0";
      },
    ],
    [
      "SHA-1",
      (value) => {
        value.dist.shasum = "0".repeat(40);
      },
    ],
    [
      "SHA-512",
      (value) => {
        value.dist.integrity = "sha512-unreviewed";
      },
    ],
    [
      "foreign host",
      (value) => {
        value.dist.tarball = "https://example.invalid/package.tgz";
      },
    ],
    [
      "foreign registry path",
      (value) => {
        value.dist.tarball = `${registry}other/-/other-0.1.0.tgz`;
      },
    ],
    [
      "optional dependency",
      (value) => {
        value.optionalDependencies = { extra: "1.0.0" };
      },
    ],
    [
      "peer dependency",
      (value) => {
        value.peerDependencies = { extra: "1.0.0" };
      },
    ],
  ];
  for (const [name, change] of changes) {
    await t.test(name, async (t) => {
      const prepared = await fixture(t);
      const state = fakeRegistry(prepared);
      state.metadata = (record) => {
        const value = metadata(record);
        change(value);
        return jsonResponse(value);
      };
      await assert.rejects(
        preflightRegistry(prepared.verified, { fetch: state.fetch }),
        /conflicts/u,
      );
      assert.equal(
        state.requests.some(({ kind }) => kind === "tarball"),
        false,
      );
    });
  }
});

test("registry tarball bytes, length, and response status are independently verified", async (t) => {
  for (const problem of [
    "changed bytes",
    "too short",
    "too large",
    "404",
    "redirect",
    "declared too large",
  ]) {
    await t.test(problem, async (t) => {
      const prepared = await fixture(t);
      const state = fakeRegistry(prepared);
      state.blob = (record) => {
        const bytes = Buffer.from(prepared.blobs.get(record.name));
        if (problem === "404") return new Response(null, { status: 404 });
        if (problem === "redirect") return new Response(null, { status: 302 });
        if (problem === "too short") return new Response(bytes.subarray(1));
        if (problem === "too large")
          return new Response(Buffer.concat([bytes, Buffer.from("extra")]));
        if (problem === "declared too large")
          return new Response(bytes, {
            headers: { "content-length": String(bytes.length + 1) },
          });
        bytes[0] ^= 1;
        return new Response(bytes);
      };
      await assert.rejects(
        preflightRegistry(prepared.verified, { fetch: state.fetch }),
        /tarball/u,
      );
    });
  }
});

test("a first publication checks the full set then publishes prepared blobs in dependency order", async (t) => {
  const prepared = await fixture(t);
  const state = fakeRegistry(prepared, []);
  const publishing = publisher(prepared, state);
  const result = await publishPreparedRelease(
    prepared.options,
    publishing.seams,
  );
  assert.deepEqual(result, {
    published: prepared.artifacts.map(({ name }) => name),
    skipped: [],
    verified: true,
  });
  assert.deepEqual(
    publishing.calls
      .filter(({ arguments_ }) => arguments_[1] === "publish")
      .map(({ arguments_ }) => basename(arguments_[2])),
    prepared.artifacts.map(({ filename }) => filename),
  );
  assert.equal(publishing.sleeps.length, 0);
  assert.ok(Object.isFrozen(result.published));
});

test("partial publication recovers by skipping verified versions and a rerun performs no writes", async (t) => {
  const prepared = await fixture(t);
  const names = prepared.artifacts.map(({ name }) => name);
  const state = fakeRegistry(prepared, names.slice(0, 2));
  const publishing = publisher(prepared, state);
  const result = await publishPreparedRelease(
    prepared.options,
    publishing.seams,
  );
  assert.deepEqual(result.published, names.slice(2));
  assert.deepEqual(result.skipped, names.slice(0, 2));
  const rerun = publisher(prepared, state);
  const recovered = await publishPreparedRelease(prepared.options, rerun.seams);
  assert.deepEqual(recovered.published, []);
  assert.deepEqual(recovered.skipped, names);
  assert.equal(
    rerun.calls.some(({ arguments_ }) => arguments_[1] === "publish"),
    false,
  );
});

test("a matching version published concurrently is reverified and skipped immediately before publication", async (t) => {
  const prepared = await fixture(t);
  const names = prepared.artifacts.map(({ name }) => name);
  const state = fakeRegistry(prepared, names.slice(1));
  let lookups = 0;
  state.beforeRequest = (kind, record) => {
    if (kind === "metadata" && record.name === names[0] && ++lookups === 2)
      state.present.add(names[0]);
  };
  const publishing = publisher(prepared, state);
  const result = await publishPreparedRelease(
    prepared.options,
    publishing.seams,
  );
  assert.deepEqual(result.published, []);
  assert.deepEqual(result.skipped, names);
  assert.equal(
    publishing.calls.some(({ arguments_ }) => arguments_[1] === "publish"),
    false,
  );
});

test("post-publication absence has a bounded retry budget and unknown states fail immediately", async (t) => {
  for (const problem of ["404", "network"]) {
    await t.test(problem, async (t) => {
      const prepared = await fixture(t);
      const state = fakeRegistry(prepared, []);
      let published = false;
      const publishing = publisher(prepared, state);
      const originalRun = publishing.seams.run;
      publishing.seams.run = async (...arguments_) => {
        const result = await originalRun(...arguments_);
        if (arguments_[1][1] === "publish") published = true;
        return result;
      };
      state.metadata = () => {
        if (!published) return undefined;
        if (problem === "network")
          throw new Error("synthetic unknown network state");
        return jsonResponse({ error: "Not found" }, 404);
      };
      await assert.rejects(
        publishPreparedRelease(prepared.options, publishing.seams),
      );
      assert.equal(
        publishing.calls.filter(({ arguments_ }) => arguments_[1] === "publish")
          .length,
        1,
      );
      assert.deepEqual(
        publishing.sleeps,
        problem === "404" ? [1000, 2000, 4000, 8000, 16000] : [],
      );
    });
  }
});

test("privileged publication requires the exact hosted release workflow identity and rejects inherited npm authority", () => {
  assert.doesNotThrow(() =>
    assertTrustedPublishingEnvironment(trustedEnvironment(), identity),
  );
  for (const [key, value] of Object.entries({
    GITHUB_ACTIONS: "false",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "other/knowledge-base",
    GITHUB_SERVER_URL: "https://example.invalid",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: "b".repeat(40),
    GITHUB_WORKFLOW_REF: "other/workflow@refs/heads/main",
    GITHUB_WORKFLOW_SHA: "b".repeat(40),
    RUNNER_ENVIRONMENT: "self-hosted",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/oidc",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "",
    NPM_TOKEN: "synthetic-token",
    NODE_AUTH_TOKEN: "synthetic-token",
    npm_config_registry: "https://example.invalid/",
    NPM_CONFIG_USERCONFIG: "synthetic-npmrc",
  })) {
    assert.throws(() =>
      assertTrustedPublishingEnvironment(
        { ...trustedEnvironment(), [key]: value },
        identity,
      ),
    );
  }
});

function provenanceAudit(manifest) {
  return {
    invalid: [],
    missing: [],
    verified: manifest.artifacts.map((record) => {
      const statement = {
        _type: "https://in-toto.io/Statement/v1",
        predicateType: "https://slsa.dev/provenance/v1",
        subject: [
          {
            name: `pkg:npm/${record.name.replace("@", "%40")}@${record.version}`,
            digest: {
              sha512: Buffer.from(record.integrity.slice(7), "base64").toString(
                "hex",
              ),
            },
          },
        ],
        predicate: {
          buildDefinition: {
            buildType:
              "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
            externalParameters: {
              workflow: {
                repository: "https://github.com/pegma-dev/knowledge-base",
                path: RELEASE_WORKFLOW,
                ref: `refs/tags/${identity.tag}`,
              },
            },
            internalParameters: { github: { event_name: "release" } },
            resolvedDependencies: [
              {
                uri: `git+https://github.com/pegma-dev/knowledge-base@refs/tags/${identity.tag}`,
                digest: { gitCommit: identity.commit },
              },
            ],
          },
          runDetails: {
            builder: { id: "https://github.com/actions/runner/github-hosted" },
          },
        },
      };
      return {
        name: record.name,
        version: record.version,
        location: `node_modules/${record.name}`,
        registry,
        attestationBundles: [
          {
            predicateType: "https://slsa.dev/provenance/v1",
            bundle: {
              verificationMaterial: {
                certificate: { rawBytes: syntheticCertificate() },
              },
              dsseEnvelope: {
                payloadType: "application/vnd.in-toto+json",
                payload: Buffer.from(JSON.stringify(statement)).toString(
                  "base64",
                ),
              },
            },
          },
        ],
      };
    }),
  };
}

test("cryptographically verified provenance must still bind every prepared package to the exact source workflow", async (t) => {
  const prepared = await fixture(t);
  assert.doesNotThrow(() =>
    verifyProvenanceAudit(
      provenanceAudit(prepared.verified.manifest),
      prepared.verified.manifest,
    ),
  );
  const changes = [
    [
      "missing package",
      (audit) => {
        audit.verified.pop();
      },
    ],
    [
      "invalid signature",
      (audit) => {
        audit.invalid.push({ name: "synthetic" });
      },
    ],
    [
      "missing attestation",
      (audit) => {
        audit.missing.push({ name: "synthetic" });
      },
    ],
    [
      "duplicate package",
      (audit) => {
        audit.verified.push(audit.verified[0]);
      },
    ],
    [
      "foreign registry",
      (audit) => {
        audit.verified[0].registry = "https://example.invalid/";
      },
    ],
    [
      "absent source bundle",
      (audit) => {
        audit.verified[0].attestationBundles = [];
      },
    ],
    [
      "missing certificate",
      (audit) => {
        delete audit.verified[0].attestationBundles[0].bundle
          .verificationMaterial;
      },
    ],
    [
      "wrong certificate workflow",
      (audit) => {
        audit.verified[0].attestationBundles[0].bundle.verificationMaterial.certificate.rawBytes =
          syntheticCertificate({ workflow: ".github/workflows/other.yml" });
      },
    ],
    [
      "wrong certificate issuer",
      (audit) => {
        audit.verified[0].attestationBundles[0].bundle.verificationMaterial.certificate.rawBytes =
          syntheticCertificate({ issuer: "https://example.invalid" });
      },
    ],
  ];
  for (const [name, change] of changes) {
    const audit = provenanceAudit(prepared.verified.manifest);
    change(audit);
    assert.throws(
      () => verifyProvenanceAudit(audit, prepared.verified.manifest),
      undefined,
      name,
    );
  }
  for (const [name, change] of [
    [
      "wrong commit",
      (statement) => {
        statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit =
          "b".repeat(40);
      },
    ],
    [
      "wrong tag",
      (statement) => {
        statement.predicate.buildDefinition.externalParameters.workflow.ref =
          "refs/tags/v0.2.0";
      },
    ],
    [
      "wrong workflow",
      (statement) => {
        statement.predicate.buildDefinition.externalParameters.workflow.path =
          ".github/workflows/other.yml";
      },
    ],
    [
      "wrong repository",
      (statement) => {
        statement.predicate.buildDefinition.externalParameters.workflow.repository =
          "https://github.com/other/knowledge-base";
      },
    ],
    [
      "wrong artifact digest",
      (statement) => {
        statement.subject[0].digest.sha512 = "0".repeat(128);
      },
    ],
    [
      "self hosted builder",
      (statement) => {
        statement.predicate.runDetails.builder.id = "synthetic-self-hosted";
      },
    ],
  ]) {
    const audit = provenanceAudit(prepared.verified.manifest);
    const envelope =
      audit.verified[0].attestationBundles[0].bundle.dsseEnvelope;
    const statement = JSON.parse(
      Buffer.from(envelope.payload, "base64").toString("utf8"),
    );
    change(statement);
    envelope.payload = Buffer.from(JSON.stringify(statement)).toString(
      "base64",
    );
    assert.throws(
      () => verifyProvenanceAudit(audit, prepared.verified.manifest),
      undefined,
      name,
    );
  }
});

test("registry verification uses exact released dependencies, script-free installation, public imports, and npm signature audit", async (t) => {
  const prepared = await fixture(t);
  const state = fakeRegistry(prepared);
  const operations = [];
  const result = await verifyRegistryRelease(prepared.options, {
    fetch: state.fetch,
    env: {
      SYNTHETIC_SOURCE_SECRET: "must-not-reach-consumer",
      NPM_TOKEN: "must-not-reach-consumer",
    },
    run: async (command, arguments_, { cwd, env }) => {
      assert.equal(command, process.execPath);
      assert.equal(env.SYNTHETIC_SOURCE_SECRET, undefined);
      assert.equal(env.NPM_TOKEN, undefined);
      assert.equal(env.npm_config_ignore_scripts, "true");
      const operation =
        arguments_[0] === prepared.options.npmCli
          ? arguments_[1]
          : "public-imports";
      operations.push(operation);
      if (operation === "--version") return { status: 0, stdout: "11.18.0\n" };
      if (operation === "install") {
        assert.deepEqual(arguments_.slice(1), [
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--registry",
          registry,
        ]);
        const consumer = JSON.parse(
          await readFile(join(cwd, "package.json"), "utf8"),
        );
        assert.deepEqual(
          consumer.dependencies,
          Object.fromEntries(
            prepared.artifacts.map(({ name, version }) => [name, version]),
          ),
        );
        await writeFile(
          join(cwd, "package-lock.json"),
          JSON.stringify({
            packages: Object.fromEntries(
              prepared.artifacts.map((record) => [
                `node_modules/${record.name}`,
                {
                  version: record.version,
                  integrity: record.integrity,
                  resolved: tarballUrl(record),
                },
              ]),
            ),
          }),
        );
        return { status: 0, stdout: "" };
      }
      if (operation === "public-imports") {
        const source = await readFile(arguments_[0], "utf8");
        for (const { name } of prepared.artifacts)
          assert.ok(source.includes(name));
        return { status: 0, stdout: "" };
      }
      assert.equal(operation, "audit");
      assert.ok(arguments_.includes("--include-attestations"));
      return {
        status: 0,
        stdout: JSON.stringify(provenanceAudit(prepared.verified.manifest)),
      };
    },
  });
  assert.deepEqual(operations, [
    "--version",
    "install",
    "audit",
    "public-imports",
  ]);
  assert.deepEqual(
    result.packages,
    prepared.artifacts.map(({ name }) => name),
  );
  assert.equal(result.verified, true);
});

test("registry verification stops before npm when any release package is absent", async (t) => {
  const prepared = await fixture(t);
  const state = fakeRegistry(
    prepared,
    prepared.artifacts.slice(0, 3).map(({ name }) => name),
  );
  const publishing = publisher(prepared, state);
  await assert.rejects(
    verifyRegistryRelease(prepared.options, publishing.seams),
    /complete release set/u,
  );
  assert.equal(publishing.calls.length, 0);
});

test("local prepared blob tampering fails before registry access or npm execution", async (t) => {
  const prepared = await fixture(t);
  const state = fakeRegistry(prepared, []);
  const publishing = publisher(prepared, state);
  await writeFile(
    prepared.verified.artifacts[3].path,
    "unreviewed prepared bytes",
  );
  await assert.rejects(
    publishPreparedRelease(prepared.options, publishing.seams),
  );
  assert.equal(state.requests.length, 0);
  assert.equal(publishing.calls.length, 0);
});

test("all four snapshot blobs are rehashed before the first privileged publish", async (t) => {
  const prepared = await fixture(t);
  const state = fakeRegistry(prepared, []);
  const publishing = publisher(prepared, state);
  const originalRun = publishing.seams.run;
  publishing.seams.run = async (...arguments_) => {
    const result = await originalRun(...arguments_);
    if (arguments_[1][1] === "--version") {
      const record = prepared.verified.artifacts[3];
      const bytes = Buffer.from(prepared.blobs.get(record.name));
      bytes[0] ^= 1;
      await writeFile(record.path, bytes);
    }
    return result;
  };
  await assert.rejects(
    publishPreparedRelease(prepared.options, publishing.seams),
    /changed after verification/u,
  );
  assert.equal(
    publishing.calls.some(({ arguments_ }) => arguments_[1] === "publish"),
    false,
  );
});

test("an unexpected npm version cannot publish any prepared package", async (t) => {
  const prepared = await fixture(t);
  const state = fakeRegistry(prepared, []);
  const publishing = publisher(prepared, state);
  publishing.seams.run = async () => ({ status: 0, stdout: "11.17.0\n" });
  await assert.rejects(
    publishPreparedRelease(prepared.options, publishing.seams),
    /pinned npm CLI/u,
  );
  assert.equal(state.present.size, 0);
});

test("the supported certificate-chain attestation shape binds the same source identity", async (t) => {
  const prepared = await fixture(t);
  const audit = provenanceAudit(prepared.verified.manifest);
  audit.verified[0].attestationBundles[0].bundle.verificationMaterial = {
    x509CertificateChain: {
      certificates: [{ rawBytes: syntheticCertificate() }],
    },
  };
  assert.doesNotThrow(() =>
    verifyProvenanceAudit(audit, prepared.verified.manifest),
  );
});

test("consumer lock and provenance failures stop verification before package runtime imports", async (t) => {
  for (const problem of [
    "wrong version",
    "workspace link",
    "invalid crypto audit",
    "wrong provenance source",
  ]) {
    await t.test(problem, async (t) => {
      const prepared = await fixture(t);
      const state = fakeRegistry(prepared);
      const operations = [];
      await assert.rejects(
        verifyRegistryRelease(prepared.options, {
          fetch: state.fetch,
          env: {},
          run: async (_command, arguments_, { cwd }) => {
            const operation =
              arguments_[0] === prepared.options.npmCli
                ? arguments_[1]
                : "public-imports";
            operations.push(operation);
            if (operation === "--version")
              return { status: 0, stdout: "11.18.0\n" };
            if (operation === "install") {
              const packages = Object.fromEntries(
                prepared.artifacts.map((record) => [
                  `node_modules/${record.name}`,
                  {
                    version: record.version,
                    integrity: record.integrity,
                    resolved: tarballUrl(record),
                  },
                ]),
              );
              const installed =
                packages[`node_modules/${prepared.artifacts[3].name}`];
              if (problem === "wrong version") installed.version = "0.2.0";
              if (problem === "workspace link") installed.link = true;
              await writeFile(
                join(cwd, "package-lock.json"),
                JSON.stringify({ packages }),
              );
              return { status: 0, stdout: "" };
            }
            assert.equal(
              operation,
              "audit",
              "package imports cannot precede a valid exact provenance audit",
            );
            if (problem === "invalid crypto audit")
              return { status: 1, stdout: "synthetic failure" };
            const audit = provenanceAudit(prepared.verified.manifest);
            audit.verified[3].attestationBundles[0].bundle.verificationMaterial.certificate.rawBytes =
              syntheticCertificate({ workflow: ".github/workflows/other.yml" });
            return { status: 0, stdout: JSON.stringify(audit) };
          },
        }),
      );
      assert.equal(operations.includes("public-imports"), false);
      assert.deepEqual(
        operations,
        problem === "wrong version" || problem === "workspace link"
          ? ["--version", "install"]
          : ["--version", "install", "audit"],
      );
    });
  }
});
