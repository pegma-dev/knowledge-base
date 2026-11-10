import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const releaseDirectory = new URL("../docs/releases/v0.1.5/", import.meta.url);
// Independently retained at original preparation, not read from adjacent JSON.
const manifestSha256 =
  "61739de9c3f1d65a481ec96a297cab63f6576787fdd4e01fbd4cea627b12d22d";
const sourceCommit = "6dae20df8dace50ad961d9c5fe8d28c90bf4918f";
const packageNames = [
  "@pegma/knowledge-base-contracts",
  "@pegma/knowledge-base-core",
  "@pegma/knowledge-base-application",
  "@pegma/knowledge-base-mcp",
];

function readReceipt(name: string) {
  return JSON.parse(readFileSync(new URL(name, releaseDirectory), "utf8"));
}

describe("immutable published 0.1.5 release receipts", () => {
  it("binds the local manifest's exact bytes to the independently retained digest and size", () => {
    const bytes = readFileSync(
      new URL("package-manifest.json", releaseDirectory),
    );
    expect(bytes.byteLength).toBe(15_260);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      manifestSha256,
    );
    const manifest = JSON.parse(bytes.toString("utf8"));
    expect(Object.keys(manifest).sort()).toEqual([
      "artifacts",
      "identity",
      "schemaVersion",
    ]);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.identity).toEqual({
      repository: "pegma-dev/knowledge-base",
      tag: "v0.1.5",
      commit: sourceCommit,
      version: "0.1.5",
    });
    expect(
      manifest.artifacts.map((artifact: { name: string }) => artifact.name),
    ).toEqual(packageNames);
    for (const artifact of manifest.artifacts) {
      expect(artifact.version).toBe("0.1.5");
      expect(artifact.size).toBeGreaterThan(0);
      expect(
        artifact.files.map((file: { path: string }) => file.path),
      ).toContain("README.md");
      for (const name of packageNames)
        if (Object.hasOwn(artifact.dependencies, name))
          expect(artifact.dependencies[name]).toBe("0.1.5");
    }
    // The snapshot binds shipped tarballs, not subsequently corrected source READMEs.
  });

  it("keeps the inspection projection tied to the same release and defines its ZIP counts", () => {
    const prepared = readReceipt("prepared-artifact.json");
    const manifest = readReceipt("package-manifest.json");
    expect(prepared).toMatchObject({
      schemaVersion: 1,
      repository: manifest.identity.repository,
      tag: manifest.identity.tag,
      sourceCommit,
      runId: 42821672972,
      originalPreparedAttempt: 1,
      artifactId: 13767614004,
      archiveBytes: 197_991,
      archiveSha256:
        "b87b16c0b6badb38dface2eb7e2c60a84eca6c0c0c70f83fb4b9432ee9546e41",
      manifestSha256,
      manifestBytes: 15_260,
      regularOuterFiles: 5,
      inspection: { kind: "original-zip-inspection-projection" },
    });
    const expectedFiles = [
      "manifest.json",
      ...manifest.artifacts.map(
        (artifact: { filename: string }) => artifact.filename,
      ),
    ].sort();
    expect([...prepared.inspection.regularOuterFileNames].sort()).toEqual(
      expectedFiles,
    );
    expect(prepared.regularOuterFiles).toBe(expectedFiles.length);
    expect(new Set(prepared.inspection.regularOuterFileNames).size).toBe(5);
    const expandedPayloadBytes = manifest.artifacts.reduce(
      (total: number, artifact: { size: number }) => total + artifact.size,
      prepared.manifestBytes,
    );
    expect(prepared.archiveBytes).not.toBe(expandedPayloadBytes);
    expect(prepared.archiveUrl).toBe(
      "https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.5/knowledge-base-v0.1.5-original-artifact-13767614004.zip",
    );
    expect(prepared.manifestUrl).toBe(
      "https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.5/manifest.json",
    );
    expect(prepared.verificationSummaryUrl).toBe(
      "https://github.com/pegma-dev/knowledge-base/releases/download/v0.1.5/registry-verification.json",
    );
    // This validates the committed projection without downloading or repacking a ZIP.
  });

  it("preserves the Jobs API's exact returned step identities instead of inferring sequential numbers", () => {
    const job = readReceipt("verification-job.json");
    const prepared = readReceipt("prepared-artifact.json");
    const sourceUrl =
      "https://api.github.com/repos/pegma-dev/knowledge-base/actions/jobs/129895026059";
    expect(job).toMatchObject({
      id: 129895026059,
      run_id: prepared.runId,
      run_attempt: 5,
      name: "Verify registry release and consumer",
      head_sha: prepared.sourceCommit,
      status: "completed",
      conclusion: "success",
      snapshot: {
        kind: "github-actions-jobs-api-field-projection",
        sourceUrl,
        logsUrl: sourceUrl + "/logs",
      },
    });
    expect(job.html_url).toBe(
      "https://github.com/pegma-dev/knowledge-base/actions/runs/42821672972/job/129895026059",
    );
    // Frozen from the authoritative job response; the absent integers do not
    // imply missing workflow records and must never be filled or renumbered.
    expect(
      job.steps.map((step: { number: number; name: string }) => [
        step.number,
        step.name,
      ]),
    ).toEqual([
      [1, "Set up job"],
      [2, "Check out the exact verified release source"],
      [3, "Set up Node.js"],
      [4, "Use the reviewed npm release"],
      [5, "Download the exact immutable prepared artifact"],
      [6, "Verify registry bytes, provenance, and the public consumer"],
      [11, "Post Set up Node.js"],
      [12, "Post Check out the exact verified release source"],
      [13, "Complete job"],
    ]);
    for (const step of job.steps)
      expect(step).toMatchObject({
        status: "completed",
        conclusion: "success",
      });
  });
});
