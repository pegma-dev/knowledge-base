import { articleKinds } from "@pegma/knowledge-base-contracts";
import { knowledgeLimits } from "@pegma/knowledge-base-core";
import { z } from "zod";

import { KnowledgeAgentBoundaryError } from "./errors.js";
import {
  defaultKnowledgeAgentLimits,
  minimumKnowledgeAgentResponseBytes,
  type KnowledgeAgentLimits,
} from "./types.js";

const boundedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .regex(
      /^[^\s\u0000-\u001f\u007f](?:[^\u0000-\u001f\u007f]*[^\s\u0000-\u001f\u007f])?$/u,
    )
    .regex(/^[^\ud800-\udfff]*$/u);
const identifier = boundedText(knowledgeLimits.identifierCharacters);
const generation = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const kind = z.enum(articleKinds);

const applicability = z
  .object({
    productId: identifier,
    productVersion: identifier,
    buildId: identifier.optional(),
    locale: z.string().min(1).max(64).optional(),
  })
  .strict();
const content = z
  .object({
    format: z.enum(["markdown", "plain_text"]),
    text: z.string().min(1).max(knowledgeLimits.contentBytes),
  })
  .strict();
const validationPolicy = z
  .object({ id: identifier, version: positiveInteger })
  .strict();

const articleDraft = z
  .object({
    kind,
    title: z.string().min(1).max(knowledgeLimits.titleCharacters),
    summary: z.string().min(1).max(knowledgeLimits.summaryCharacters),
    content,
    tags: z
      .array(z.string().min(1).max(knowledgeLimits.tagCharacters))
      .max(knowledgeLimits.tags),
    applicability,
  })
  .strict();

const evidenceSubmission = z
  .object({
    id: identifier,
    articleId: identifier,
    articleRevision: positiveInteger,
    contentHash: hash,
    validationPolicy,
    checkId: identifier,
    testKind: identifier,
    applicability,
    stagingBuildId: identifier,
    steps: z
      .array(z.string().min(1).max(knowledgeLimits.stepCharacters))
      .min(1)
      .max(knowledgeLimits.steps),
    result: z.enum(["passed", "failed", "inconclusive"]),
    executedAt: z.string().min(1).max(64),
    runnerId: identifier,
    artifacts: z
      .array(z.object({ id: identifier, hash }).strict())
      .max(knowledgeLimits.artifacts),
  })
  .strict();

const command = {
  commandId: identifier,
  correlationId: identifier,
  expectedGeneration: generation,
};

/** Shared strict schemas; HTTP and MCP must use the same dispatcher. */
export const knowledgeAgentInputSchemas = Object.freeze({
  getDraft: z.object({ articleId: identifier }).strict(),
  createDraft: z
    .object({
      ...command,
      expectedGeneration: z.literal(0),
      articleId: identifier,
      collectionId: identifier,
      draft: articleDraft,
    })
    .strict(),
  updateDraft: z
    .object({
      ...command,
      articleId: identifier,
      collectionId: identifier,
      draft: articleDraft,
    })
    .strict(),
  getValidationRequirements: z
    .object({ collectionId: identifier, kind })
    .strict(),
  submitEvidence: z
    .object({
      ...command,
      articleId: identifier,
      evidence: evidenceSubmission,
      receipt: boundedText(8_192).refine(
        (value) => new TextEncoder().encode(value).byteLength <= 8_192,
      ),
    })
    .strict(),
});

export const knowledgeAgentEnvelopeSchema = z.discriminatedUnion("operation", [
  z
    .object({
      apiVersion: z.literal("1"),
      operation: z.literal("getDraft"),
      input: knowledgeAgentInputSchemas.getDraft,
    })
    .strict(),
  z
    .object({
      apiVersion: z.literal("1"),
      operation: z.literal("createDraft"),
      input: knowledgeAgentInputSchemas.createDraft,
    })
    .strict(),
  z
    .object({
      apiVersion: z.literal("1"),
      operation: z.literal("updateDraft"),
      input: knowledgeAgentInputSchemas.updateDraft,
    })
    .strict(),
  z
    .object({
      apiVersion: z.literal("1"),
      operation: z.literal("getValidationRequirements"),
      input: knowledgeAgentInputSchemas.getValidationRequirements,
    })
    .strict(),
  z
    .object({
      apiVersion: z.literal("1"),
      operation: z.literal("submitEvidence"),
      input: knowledgeAgentInputSchemas.submitEvidence,
    })
    .strict(),
]);

const reportLookup = z
  .object({ ledgerEpoch: positiveInteger, reportId: identifier })
  .strict();
const reportRequirementsInput = z
  .object({
    collectionId: identifier,
    kind,
    articleId: identifier,
    reportLookup: reportLookup.optional(),
  })
  .strict();
const reportSubmissionInput = z
  .object({
    ...command,
    articleId: identifier,
    evidence: evidenceSubmission,
    ledgerEpoch: positiveInteger,
    report: z
      .object({
        summary: boundedText(1000).regex(/^[^\u007f-\u009f]*$/u),
        details: z
          .string()
          .min(1)
          .max(16_000)
          .regex(
            /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]*$/u,
          ),
      })
      .strict(),
  })
  .strict();

/** Enabled only by the host's explicit report-service composition. The legacy
 * schemas above remain exact when that optional service is omitted. */
export const knowledgeAgentReportInputSchemas = Object.freeze({
  ...knowledgeAgentInputSchemas,
  getValidationRequirements: z.union([
    knowledgeAgentInputSchemas.getValidationRequirements,
    reportRequirementsInput,
  ]),
  submitEvidence: z.union([
    knowledgeAgentInputSchemas.submitEvidence,
    reportSubmissionInput,
  ]),
});
export const knowledgeAgentReportEnvelopeSchema = z.union([
  knowledgeAgentEnvelopeSchema,
  z
    .object({
      apiVersion: z.literal("1"),
      operation: z.literal("getValidationRequirements"),
      input: reportRequirementsInput,
    })
    .strict(),
  z
    .object({
      apiVersion: z.literal("1"),
      operation: z.literal("submitEvidence"),
      input: reportSubmissionInput,
    })
    .strict(),
]);

// Output schemas deliberately construct purpose-specific DTOs. Extra private
// fields from an application wrapper never become transport response fields.
const articleState = z.enum(["draft", "in-review", "published", "retired"]);
const revision = articleDraft
  .extend({
    articleId: identifier,
    number: positiveInteger,
    collectionId: identifier,
    validationPolicy: validationPolicy.strip(),
    contentHash: hash,
    createdBy: identifier,
    createdAt: z.string().min(1).max(64),
    content: content.strip(),
    applicability: applicability.strip(),
  })
  .strip();
const acknowledgement = z
  .object({
    value: z
      .object({
        id: identifier,
        generation: positiveInteger,
        articleRevision: positiveInteger,
        state: articleState,
        contentHash: hash,
      })
      .strip(),
    replayed: z.boolean(),
  })
  .strip();

export const knowledgeAgentResultSchemas = Object.freeze({
  getDraft: z
    .object({
      articleId: identifier,
      generation: positiveInteger,
      state: articleState,
      revision,
      hasPendingReview: z.boolean(),
      hasPublication: z.boolean(),
      publicationHeld: z.boolean(),
    })
    .strip(),
  createDraft: acknowledgement,
  updateDraft: acknowledgement,
  getValidationRequirements: z
    .object({
      collectionId: identifier,
      governanceGeneration: positiveInteger,
      validationPolicy: validationPolicy.strip(),
      expectedStagingBuildId: identifier,
      checks: z
        .array(
          z
            .object({
              id: identifier,
              testKind: identifier,
              maxAgeMilliseconds: positiveInteger,
            })
            .strip(),
        )
        .max(knowledgeLimits.requirements),
    })
    .strip(),
  submitEvidence: acknowledgement,
});

// A report acknowledgement fits the existing prepaid 2048-byte minimum: one
// 200-character identifier, a <=512-byte JSON-encoded receipt, safe integers and fixed
// framing. Current report receipts are compact epoch/generation/opaque-ID data.
const reportAcknowledgement = z
  .object({
    ledgerEpoch: positiveInteger,
    reportId: identifier,
    receipt: boundedText(512).refine(
      (value) =>
        new TextEncoder().encode(JSON.stringify(value)).byteLength <= 512,
    ),
    reportGeneration: positiveInteger,
  })
  .strip();
const reportRequirementsResult =
  knowledgeAgentResultSchemas.getValidationRequirements
    .extend({
      reportLedger: z
        .object({
          ledgerEpoch: positiveInteger,
          status: z.enum(["active", "resetting"]),
        })
        .strip(),
      reportStatus: reportAcknowledgement
        .extend({ status: z.enum(["pending", "confirmed", "rejected"]) })
        .strip()
        .optional(),
    })
    .strip();
export const knowledgeAgentReportResultSchemas = Object.freeze({
  ...knowledgeAgentResultSchemas,
  getValidationRequirements: reportRequirementsResult,
  submitEvidence: reportAcknowledgement
    .extend({ kind: z.literal("pending-human-review") })
    .strip(),
});

export function resolveKnowledgeAgentLimits(
  requested: Partial<KnowledgeAgentLimits> = {},
): KnowledgeAgentLimits {
  if (
    requested === null ||
    typeof requested !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(requested))
  ) {
    throw new TypeError("Invalid knowledge agent limits");
  }
  const result = { ...defaultKnowledgeAgentLimits };
  for (const key of Reflect.ownKeys(requested)) {
    if (typeof key !== "string" || !Object.hasOwn(result, key)) {
      throw new TypeError("Unknown knowledge agent limit");
    }
    const descriptor = Object.getOwnPropertyDescriptor(requested, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError("Invalid knowledge agent limit");
    }
    const value: unknown = descriptor.value;
    const name = key as keyof KnowledgeAgentLimits;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > defaultKnowledgeAgentLimits[name] ||
      (name === "maxResponseBytes" &&
        value < minimumKnowledgeAgentResponseBytes)
    ) {
      throw new TypeError("Knowledge agent limits may only reduce ceilings");
    }
    result[name] = value;
  }
  return Object.freeze(result);
}

/**
 * Detach only plain JSON data properties, with work/encoded-byte accounting
 * before Zod reads them. Accessors, sparse arrays, cycles, symbols, and custom
 * prototypes are rejected without invoking JSON coercion or a getter.
 */
export function snapshotKnowledgeAgentJson(
  value: unknown,
  limits: KnowledgeAgentLimits,
  maximumBytes = limits.maxRequestBytes,
): unknown {
  const ancestors = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  const reserve = (count: number) => {
    bytes += count;
    if (bytes > maximumBytes) throw new KnowledgeAgentBoundaryError("capacity");
  };
  const encodedText = (item: string) => {
    if (item.length > maximumBytes)
      throw new KnowledgeAgentBoundaryError("capacity");
    const encoded = JSON.stringify(item);
    if (encoded.length > maximumBytes)
      throw new KnowledgeAgentBoundaryError("capacity");
    reserve(new TextEncoder().encode(encoded).byteLength);
  };
  const visit = (item: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > limits.maxNodes || depth > limits.maxDepth)
      throw new KnowledgeAgentBoundaryError("capacity");
    if (item === null) {
      reserve(4);
      return item;
    }
    if (typeof item === "string") {
      encodedText(item);
      return item;
    }
    if (typeof item === "boolean") {
      reserve(item ? 4 : 5);
      return item;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      reserve(String(item).length);
      return item;
    }
    if (typeof item !== "object" || ancestors.has(item))
      throw new KnowledgeAgentBoundaryError("invalid_request");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (item.length > limits.maxArrayLength)
          throw new KnowledgeAgentBoundaryError("capacity");
        const keys = Reflect.ownKeys(item);
        if (keys.length !== item.length + 1)
          throw new KnowledgeAgentBoundaryError("invalid_request");
        reserve(2 + Math.max(0, item.length - 1));
        const output: unknown[] = [];
        for (let index = 0; index < item.length; index += 1) {
          const property = Object.getOwnPropertyDescriptor(item, String(index));
          if (
            property === undefined ||
            !("value" in property) ||
            !property.enumerable
          ) {
            throw new KnowledgeAgentBoundaryError("invalid_request");
          }
          output.push(visit(property.value, depth + 1));
        }
        return Object.freeze(output);
      }
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item)))
        throw new KnowledgeAgentBoundaryError("invalid_request");
      const keys = Reflect.ownKeys(item);
      if (keys.length > limits.maxObjectKeys)
        throw new KnowledgeAgentBoundaryError("capacity");
      reserve(2 + Math.max(0, keys.length - 1));
      const output: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        if (typeof key !== "string")
          throw new KnowledgeAgentBoundaryError("invalid_request");
        const property = Object.getOwnPropertyDescriptor(item, key);
        if (
          property === undefined ||
          !("value" in property) ||
          !property.enumerable
        ) {
          throw new KnowledgeAgentBoundaryError("invalid_request");
        }
        encodedText(key);
        reserve(1);
        output[key] = visit(property.value, depth + 1);
      }
      return Object.freeze(output);
    } finally {
      ancestors.delete(item);
    }
  };
  return visit(value, 0);
}

/** Bound UTF-8 bytes and every structural ceiling before invoking JSON.parse. */
export function parseKnowledgeAgentJson(
  source: string,
  requested?: Partial<KnowledgeAgentLimits>,
): unknown {
  const limits = resolveKnowledgeAgentLimits(requested);
  if (typeof source !== "string")
    throw new KnowledgeAgentBoundaryError("invalid_request");
  if (
    source.length > limits.maxRequestBytes ||
    new TextEncoder().encode(source).byteLength > limits.maxRequestBytes
  ) {
    throw new KnowledgeAgentBoundaryError("capacity");
  }
  type Frame =
    | { kind: "array"; entries: number; expectsValue: boolean }
    | { kind: "object"; keys: number };
  const frames: Frame[] = [];
  const beginValue = () => {
    const frame = frames.at(-1);
    if (frame?.kind === "array" && frame.expectsValue) {
      frame.entries += 1;
      frame.expectsValue = false;
      if (frame.entries > limits.maxArrayLength)
        throw new KnowledgeAgentBoundaryError("capacity");
    }
  };
  let nodes = 0;
  let quoted = false;
  let escaped = false;
  let primitive = false;
  for (const character of source) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      beginValue();
      quoted = true;
      primitive = false;
      nodes += 1;
    } else if (character === "{" || character === "[") {
      beginValue();
      frames.push(
        character === "["
          ? { kind: "array", entries: 0, expectsValue: true }
          : { kind: "object", keys: 0 },
      );
      nodes += 1;
      primitive = false;
    } else if (character === "}" || character === "]") {
      frames.pop();
      primitive = false;
    } else if (character === ",") {
      const frame = frames.at(-1);
      if (frame?.kind === "array") frame.expectsValue = true;
      primitive = false;
    } else if (character === ":") {
      // For valid JSON, each structural colon belongs to exactly one object
      // key. Counting physical keys also bounds duplicate-key parse work.
      const frame = frames.at(-1);
      if (frame?.kind === "object") {
        frame.keys += 1;
        if (frame.keys > limits.maxObjectKeys)
          throw new KnowledgeAgentBoundaryError("capacity");
      }
      primitive = false;
    } else if (/\s/u.test(character)) {
      primitive = false;
    } else if (!primitive) {
      beginValue();
      primitive = true;
      nodes += 1;
    }
    if (frames.length > limits.maxDepth || nodes > limits.maxNodes)
      throw new KnowledgeAgentBoundaryError("capacity");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new KnowledgeAgentBoundaryError("invalid_request");
  }
  return snapshotKnowledgeAgentJson(parsed, limits);
}
