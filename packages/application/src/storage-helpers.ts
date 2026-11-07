import type { StoredRecord } from "@pegma/storage-core";

export class RepositoryConflictError extends Error {
  override readonly name = "RepositoryConflictError";
  constructor() {
    super("Knowledge resource changed or command identity was reused");
  }
}

export class RepositoryCapacityError extends Error {
  override readonly name = "RepositoryCapacityError";
  constructor(readonly budget: string) {
    super("Knowledge resource reached its configured " + budget + " limit");
  }
}

export class RepositoryIntegrityError extends Error {
  override readonly name = "RepositoryIntegrityError";
  constructor() {
    super("Stored knowledge data is inconsistent");
  }
}

/** Snapshots data properties only; no getters, sparse arrays, or JSON coercion. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  let nodes = 0;
  let characters = 0;
  const reserve = (count: number): void => {
    characters += count;
    if (characters > 2_000_000)
      throw new TypeError("JSON data exceeds its encoded bound");
  };
  const visit = (item: unknown, depth = 0): string => {
    nodes += 1;
    if (depth > 32 || nodes > 50_000)
      throw new TypeError("JSON data exceeds its graph bound");
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      if (typeof item === "string" && item.length > 500_000)
        throw new TypeError("JSON string exceeds its bound");
      const encoded = JSON.stringify(item);
      reserve(encoded.length);
      return encoded;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      const encoded = String(item);
      reserve(encoded.length);
      return encoded;
    }
    if (typeof item !== "object" || item === null || ancestors.has(item)) {
      throw new TypeError("Expected bounded JSON data properties");
    }
    ancestors.add(item);
    try {
      if (Object.getOwnPropertySymbols(item).length !== 0) {
        throw new TypeError("Symbol properties are not JSON data");
      }
      const own = (key: string): unknown => {
        const property = Object.getOwnPropertyDescriptor(item, key);
        if (property === undefined || !("value" in property)) {
          throw new TypeError("Accessors and sparse arrays are not JSON data");
        }
        return property.value;
      };
      if (Array.isArray(item)) {
        if (item.length > 4_096)
          throw new TypeError("JSON array exceeds its bound");
        if (Object.keys(item).length !== item.length) {
          throw new TypeError("Arrays must be dense data without extra keys");
        }
        reserve(2 + item.length);
        return (
          "[" +
          Array.from({ length: item.length }, (_, i) =>
            visit(own(String(i)), depth + 1),
          ).join(",") +
          "]"
        );
      }
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
        throw new TypeError("Only plain JSON objects are supported");
      }
      const names = Object.keys(item);
      if (names.length > 4_096)
        throw new TypeError("JSON object exceeds its bound");
      reserve(2 + names.length);
      return (
        "{" +
        names
          .sort()
          .map((key) => {
            if (key.length > 500_000)
              throw new TypeError("JSON property exceeds its bound");
            const encoded = JSON.stringify(key);
            reserve(encoded.length + 1);
            return encoded + ":" + visit(own(key), depth + 1);
          })
          .join(",") +
        "}"
      );
    } finally {
      ancestors.delete(item);
    }
  };
  return visit(value);
}

export function snapshotData<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export const commandFingerprint = fingerprint;

export function requireIdentifier(value: string, field = "identifier"): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(field + " must be bounded nonempty text");
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new TypeError(field + " must be well-formed Unicode");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff)
      throw new TypeError(field + " must be well-formed Unicode");
  }
}

export function requireGeneration(value: number, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError("Expected a safe resource generation");
  }
}

export function encodedBytes(record: StoredRecord): number {
  return new TextEncoder().encode(canonicalJson(record)).length;
}
