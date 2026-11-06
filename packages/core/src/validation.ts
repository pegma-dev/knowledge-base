import {
  articleKinds,
  type Applicability,
  type ArticleContent,
  type ArticleRevision,
  type IsoTimestamp,
  type ValidationPolicy,
} from "@pegma/knowledge-base-contracts";

export class KnowledgeBaseError extends Error {
  override readonly name = "KnowledgeBaseError";

  constructor(
    readonly code: "invalid" | "conflict" | "evidence" | "transition",
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

/** Schema ceilings, not host throughput, retention, or model budgets. */
export const knowledgeLimits = {
  identifierCharacters: 200,
  titleCharacters: 200,
  summaryCharacters: 1_000,
  contentBytes: 32_768,
  tags: 16,
  tagCharacters: 64,
  requirements: 32,
  trustedIdentities: 32,
  evidence: 32,
  steps: 16,
  stepCharacters: 1_000,
  artifacts: 8,
} as const;

export function invalid(field: string, message: string): never {
  throw new KnowledgeBaseError("invalid", field, message);
}

export function keys(
  value: object,
  allowed: readonly string[],
  field: string,
): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  ) {
    invalid(field, field + " contains unsupported fields");
  }
}

export function text(
  value: string,
  field: string,
  maximum: number = knowledgeLimits.identifierCharacters,
): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalid(
      field,
      field + " must be bounded, nonempty text without control characters",
    );
  }
}

export function count(value: number, field: string, minimum = 1): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    invalid(field, field + " must be a safe integer of at least " + minimum);
  }
}

export function timestamp(value: IsoTimestamp, field: string): number {
  const milliseconds = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    invalid(field, field + " must be a canonical ISO timestamp");
  }
  return milliseconds;
}

export function hash(value: string, field: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    invalid(field, field + " must be a lowercase SHA-256 digest");
  }
}

export function boundedArray<T>(
  values: readonly T[],
  field: string,
  maximum: number,
): void {
  if (!Array.isArray(values) || values.length > maximum) {
    invalid(field, field + " exceeds its array bound");
  }
}

export function unique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    invalid(field, field + " must not contain duplicate values");
  }
}

export function validateApplicability(value: Applicability): void {
  keys(
    value,
    ["productId", "productVersion", "buildId", "locale"],
    "applicability",
  );
  for (const field of ["buildId", "locale"] as const) {
    if (Object.hasOwn(value, field) && value[field] === undefined) {
      invalid(
        "applicability." + field,
        "Omit an absent optional field instead of setting undefined",
      );
    }
  }
  text(value.productId, "applicability.productId");
  text(value.productVersion, "applicability.productVersion");
  if (value.buildId !== undefined) text(value.buildId, "applicability.buildId");
  if (value.locale !== undefined) {
    if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/u.test(value.locale)) {
      invalid("applicability.locale", "Locale must be a bounded language tag");
    }
    text(value.locale, "applicability.locale", 64);
  }
}

function safeLink(target: string): boolean {
  if (
    target.length > 2_048 ||
    /[\s\\<>"'\x60\u0000-\u001f\u007f]/u.test(target) ||
    target.startsWith("//")
  )
    return false;
  if (target.startsWith("#")) return target.length > 1;
  if (!target.startsWith("/") && !target.startsWith("https://")) return false;
  try {
    const url = new URL(target, "https://knowledge.invalid");
    return (
      url.protocol === "https:" && url.username === "" && url.password === ""
    );
  } catch {
    return false;
  }
}

/**
 * A deliberately restricted source subset. This is not an HTML sanitizer.
 * Hosts still use a Markdown renderer with HTML and executable extensions off.
 */
export function validateContent(value: ArticleContent): void {
  keys(value, ["format", "text"], "content");
  if (value.format !== "markdown" && value.format !== "plain_text") {
    invalid("content.format", "Only Markdown and plain text are supported");
  }
  if (
    typeof value.text !== "string" ||
    value.text.trim().length === 0 ||
    new TextEncoder().encode(value.text).byteLength >
      knowledgeLimits.contentBytes ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.text)
  ) {
    invalid(
      "content.text",
      "Content must be nonempty bounded text without control bytes",
    );
  }
  if (/<\s*(?:[a-zA-Z][\w:-]*\b|[!/?])/u.test(value.text)) {
    invalid(
      "content.text",
      "Raw HTML and JSX are unsupported; escape literal markup",
    );
  }
  if (value.format === "plain_text") return;
  // No embedded images, reference definitions, autolinks, or arbitrary MDX.
  if (
    /!\[/u.test(value.text) ||
    /^\s{0,3}\[[^\]]+\]:/mu.test(value.text) ||
    /<[^>\n]+>/u.test(value.text)
  ) {
    invalid(
      "content.text",
      "Use supported inline links and non-executable Markdown",
    );
  }
  // Inline code and fenced code remain plain Markdown; never execute either.
  const links = value.text.matchAll(/\]\(([^)]*)\)/gu);
  for (const link of links) {
    if (!safeLink(link[1]!))
      invalid("content.link", "Unsupported or unsafe Markdown link");
  }
  // Reference-style links are excluded rather than ambiguously interpreted.
  if (/\]\s*\[/u.test(value.text)) {
    invalid("content.link", "Reference-style Markdown links are unsupported");
  }
}

export function validatePolicy(policy: ValidationPolicy): void {
  keys(policy, ["id", "version", "requirements"], "validationPolicy");
  text(policy.id, "validationPolicy.id");
  count(policy.version, "validationPolicy.version");
  boundedArray(
    policy.requirements,
    "validationPolicy.requirements",
    knowledgeLimits.requirements,
  );
  const ids: string[] = [];
  for (const requirement of policy.requirements) {
    keys(
      requirement,
      ["id", "kind", "testKind", "maxAgeMilliseconds", "trustedRunnerIds"],
      "requirement",
    );
    text(requirement.id, "requirement.id");
    ids.push(requirement.id);
    if (!articleKinds.includes(requirement.kind))
      invalid("requirement.kind", "Unknown article kind");
    text(requirement.testKind, "requirement.testKind", 64);
    count(requirement.maxAgeMilliseconds, "requirement.maxAgeMilliseconds");
    boundedArray(
      requirement.trustedRunnerIds,
      "requirement.trustedRunnerIds",
      knowledgeLimits.trustedIdentities,
    );
    if (requirement.trustedRunnerIds.length === 0) {
      invalid(
        "requirement.trustedRunnerIds",
        "Each check must name trusted runners",
      );
    }
    for (const runner of requirement.trustedRunnerIds)
      text(runner, "requirement.runner");
    unique(requirement.trustedRunnerIds, "requirement.trustedRunnerIds");
  }
  unique(ids, "validationPolicy.requirements");
  for (const kind of articleKinds) {
    const requirements = policy.requirements.filter(
      (item) => item.kind === kind,
    );
    if (!requirements.some((item) => item.testKind === "content")) {
      invalid(
        "validationPolicy.requirements",
        "Every article kind requires a content check",
      );
    }
    if (
      kind === "walkthrough" &&
      !requirements.some((item) => item.testKind === "workflow")
    ) {
      invalid(
        "validationPolicy.requirements",
        "Walkthroughs require a workflow check",
      );
    }
  }
}

export function validateRevisionFields(
  revision: Omit<ArticleRevision, "contentHash">,
): void {
  keys(
    revision,
    [
      "articleId",
      "number",
      "collectionId",
      "kind",
      "title",
      "summary",
      "content",
      "tags",
      "applicability",
      "validationPolicy",
      "createdBy",
      "createdAt",
    ],
    "articleRevision",
  );
  text(revision.articleId, "articleId");
  count(revision.number, "articleRevision");
  text(revision.collectionId, "collectionId");
  if (!articleKinds.includes(revision.kind))
    invalid("kind", "Unknown article kind");
  text(revision.title, "title", knowledgeLimits.titleCharacters);
  text(revision.summary, "summary", knowledgeLimits.summaryCharacters);
  validateContent(revision.content);
  boundedArray(revision.tags, "tags", knowledgeLimits.tags);
  for (const tag of revision.tags)
    text(tag, "tag", knowledgeLimits.tagCharacters);
  unique(revision.tags, "tags");
  validateApplicability(revision.applicability);
  keys(revision.validationPolicy, ["id", "version"], "validationPolicy");
  text(revision.validationPolicy.id, "validationPolicy.id");
  count(revision.validationPolicy.version, "validationPolicy.version");
  text(revision.createdBy, "createdBy");
  timestamp(revision.createdAt, "createdAt");
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            canonical((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    invalid("hash", "Hash input must contain JSON values only");
  return encoded;
}

export async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export async function verifyRevision(revision: ArticleRevision): Promise<void> {
  const { contentHash, ...fields } = revision;
  validateRevisionFields(fields);
  hash(contentHash, "contentHash");
  if ((await digest(fields)) !== contentHash) {
    throw new KnowledgeBaseError(
      "conflict",
      "contentHash",
      "Revision content no longer matches its hash",
    );
  }
}
