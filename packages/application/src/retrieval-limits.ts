import {
  defaultKnowledgeRetrievalLimits,
  type KnowledgeRetrievalLimits,
} from "./retrieval-types.js";

/** Instance admission settings can reduce the initial fixed component ceilings. */
export function resolveRetrievalLimits(
  overrides: Partial<KnowledgeRetrievalLimits> = {},
): KnowledgeRetrievalLimits {
  if (
    overrides === null ||
    typeof overrides !== "object" ||
    Array.isArray(overrides)
  )
    throw new TypeError("Retrieval limits must be an object");
  const names = Object.keys(defaultKnowledgeRetrievalLimits);
  if (Object.keys(overrides).some((name) => !names.includes(name)))
    throw new TypeError("Unknown knowledge retrieval limit");
  const resolved = { ...defaultKnowledgeRetrievalLimits, ...overrides };
  for (const name of names as (keyof KnowledgeRetrievalLimits)[]) {
    const value = resolved[name];
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > defaultKnowledgeRetrievalLimits[name]
    )
      throw new TypeError(
        "Knowledge retrieval limits must be positive integers within their ceilings",
      );
  }
  return Object.freeze(resolved);
}
