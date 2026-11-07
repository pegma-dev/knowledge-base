import type { AccessContext } from "@pegma/authorization-core";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import type { Store } from "@pegma/storage-core";

import { KnowledgeBaseNotFoundError, requirePermission } from "./errors.js";
import { indexArticleTerms } from "./lexical.js";
import type {
  CheckedPublication,
  createPublicationChecker,
} from "./publication.js";
import { knowledgeRecords } from "./records.js";
import type { KnowledgeRepository } from "./repository.js";
import type {
  RetrievalBlockedReason,
  RetrievalProjectionState,
  RetrievalProjectionTarget,
} from "./retrieval-records.js";
import type { createRetrievalRepository } from "./retrieval-repository.js";
import type {
  ArticleIndexInput,
  ArticleIndexStatusDto,
  KnowledgeRetrievalApplication,
  KnowledgeRetrievalLimits,
  RepairRetrievalPageInput,
} from "./retrieval-types.js";
import {
  canonicalJson,
  fingerprint,
  RepositoryCapacityError,
  RepositoryConflictError,
  RepositoryIntegrityError,
  requireGeneration,
  requireIdentifier,
  snapshotData,
} from "./storage-helpers.js";

type PublicationChecker = ReturnType<typeof createPublicationChecker>;
type RetrievalRepository = ReturnType<typeof createRetrievalRepository>;
type MaintenanceMethods = Pick<
  KnowledgeRetrievalApplication,
  "repairArticleIndex" | "repairRetrievalPage" | "getArticleIndexStatus"
>;

interface MaintenanceOptions {
  readonly store: Store;
  readonly retrievalLimits: KnowledgeRetrievalLimits;
}

interface BatchBudget {
  remaining: number;
}

interface DesiredProjection {
  readonly articleGeneration: number | null;
  readonly checked?: CheckedPublication;
  readonly targets: readonly RetrievalProjectionTarget[];
  /** An oversized publication is withdrawn, then visibly held for admission. */
  readonly capacity: boolean;
}

function objectInput<T>(value: T, fields: readonly string[]): T {
  const input = snapshotData(value);
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((field) => !fields.includes(field))
  )
    throw new TypeError("Maintenance input contains unsupported fields");
  return input;
}

function articleInput(value: ArticleIndexInput): ArticleIndexInput {
  const input = objectInput(value, ["articleId"]);
  requireIdentifier(input.articleId, "articleId");
  return input;
}

/**
 * Orchestrates the one derived repository. It neither owns another index nor
 * mutates authoritative records/jobs. Hosts persist the returned scan cursor.
 */
export function createRetrievalMaintenanceServices(
  repository: KnowledgeRepository,
  retrieval: RetrievalRepository,
  checker: PublicationChecker,
  options: MaintenanceOptions,
): MaintenanceMethods {
  const limits = snapshotData(options.retrievalLimits);
  for (const [bound, ceiling] of [
    [limits.maxMaintenanceBatches, 32],
    [limits.maxRepairScanRows, 100],
    [limits.maxTermsPerArticle, 256],
  ] as const) {
    if (!Number.isSafeInteger(bound) || bound < 1 || bound > ceiling)
      throw new TypeError("Maintenance bounds exceed their supported ceiling");
  }
  const records = options.store.collection(knowledgeRecords);

  function caller(access: AccessContext): AccessContext {
    const current = snapshotData(access);
    requirePermission(current, knowledgePermissions.indexManage);
    return current;
  }

  async function desired(
    access: AccessContext,
    articleId: string,
  ): Promise<DesiredProjection> {
    const before = await repository.readResourceGeneration(
      "article",
      articleId,
    );
    let checked: CheckedPublication;
    try {
      checked = await checker.check({ articleId, purpose: "index", access });
    } catch (error) {
      if (!(error instanceof KnowledgeBaseNotFoundError)) throw error;
      // An old negative observation cannot withdraw a newly published revision.
      const after = await repository.readResourceGeneration(
        "article",
        articleId,
      );
      if (after !== before) throw new RepositoryConflictError();
      return { articleGeneration: after, targets: [], capacity: false };
    }
    let terms: readonly string[];
    try {
      terms = indexArticleTerms(checked.article, limits.maxTermsPerArticle);
    } catch (error) {
      if (
        !(error instanceof TypeError) &&
        !(error instanceof RepositoryCapacityError)
      )
        throw error;
      return {
        articleGeneration: checked.binding.articleGeneration,
        checked,
        targets: [],
        capacity: true,
      };
    }
    if (terms.length > limits.maxTermsPerArticle)
      return {
        articleGeneration: checked.binding.articleGeneration,
        checked,
        targets: [],
        capacity: true,
      };
    const bindingHash = await fingerprint(checked.binding);
    return {
      articleGeneration: checked.binding.articleGeneration,
      checked,
      capacity: false,
      targets: checked.enabledUses.map((use) => {
        const scope = {
          collectionId: checked.binding.collectionId,
          policyVersion: checked.binding.collectionPolicyVersion,
          use,
        };
        return {
          scope,
          hint: {
            ...scope,
            articleId,
            articleRevision: checked.binding.revision,
            contentHash: checked.binding.contentHash,
            generation: checked.binding.articleGeneration,
            sourceGeneration: checked.binding.sourceGeneration,
            bindingHash,
          },
          terms,
        };
      }),
    };
  }

  async function recheckDesired(
    articleId: string,
    plan: DesiredProjection,
  ): Promise<void> {
    if (plan.checked !== undefined) {
      // Preserve the original object: the checker owns its private confirmation.
      await checker.recheck(plan.checked);
    } else if (
      (await repository.readResourceGeneration("article", articleId)) !==
      plan.articleGeneration
    )
      throw new RepositoryConflictError();
  }

  function status(
    articleId: string,
    articleGeneration: number | null,
    state: RetrievalProjectionState | null,
    value: ArticleIndexStatusDto["status"],
    indexed = false,
    reason?: RetrievalBlockedReason,
  ): ArticleIndexStatusDto {
    return {
      articleId,
      status: value,
      indexed,
      articleGeneration,
      projectionGeneration: state?.generation ?? null,
      ...(reason === undefined ? {} : { reason }),
    };
  }

  function sameTargets(
    state: RetrievalProjectionState,
    plan: DesiredProjection,
  ): boolean {
    const targetKey = (value: {
      readonly scope: RetrievalProjectionTarget["scope"];
      readonly hint: RetrievalProjectionTarget["hint"];
    }) => canonicalJson({ scope: value.scope, hint: value.hint });
    return (
      state.targets.length === plan.targets.length &&
      canonicalJson(state.targets.map(targetKey).sort()) ===
        canonicalJson(plan.targets.map(targetKey).sort())
    );
  }

  async function currentStatus(
    access: AccessContext,
    articleId: string,
  ): Promise<ArticleIndexStatusDto> {
    const state = await retrieval.readArticleProjection(articleId);
    let plan: DesiredProjection;
    try {
      plan = await desired(access, articleId);
      await recheckDesired(articleId, plan);
    } catch (error) {
      if (error instanceof RepositoryCapacityError)
        return status(articleId, null, state, "blocked", false, "capacity");
      if (
        !(error instanceof RepositoryConflictError) &&
        !(error instanceof KnowledgeBaseNotFoundError)
      )
        throw error;
      const generation = await repository.readResourceGeneration(
        "article",
        articleId,
      );
      return status(articleId, generation, state, "pending", false, "conflict");
    }
    if (plan.capacity)
      return status(
        articleId,
        plan.articleGeneration,
        state,
        "blocked",
        false,
        "capacity",
      );
    if (state === null)
      return status(
        articleId,
        plan.articleGeneration,
        null,
        plan.articleGeneration === null ? "ready" : "pending",
      );
    const sourceGeneration = plan.articleGeneration ?? state.sourceGeneration;
    if (state.sourceGeneration !== sourceGeneration)
      return status(
        articleId,
        plan.articleGeneration,
        state,
        "pending",
        false,
        "conflict",
      );
    // Initial admission failures intentionally retain only a minimal marker.
    // It remains useful only while a positive plan still needs admission;
    // withdrawn or otherwise changed plans need cleanup instead of an old hold.
    const same = sameTargets(state, plan);
    const positiveAdmissionMarker =
      state.status === "blocked" &&
      state.reason === "capacity" &&
      state.targets.length === 0 &&
      state.knownScopes.length === 0 &&
      state.pendingScopes.length === 0 &&
      plan.targets.length > 0;
    if (
      (!same && !positiveAdmissionMarker) ||
      (state.status === "blocked" && plan.targets.length === 0)
    )
      return status(
        articleId,
        plan.articleGeneration,
        state,
        "pending",
        false,
        plan.targets.length === 0 ? "source-unavailable" : "conflict",
      );
    if (state.status === "blocked")
      return status(
        articleId,
        plan.articleGeneration,
        state,
        "blocked",
        false,
        state.reason,
      );
    return status(
      articleId,
      plan.articleGeneration,
      state,
      state.status,
      state.status === "ready" && plan.targets.length > 0,
    );
  }

  async function markBlocked(
    articleId: string,
    state: RetrievalProjectionState | null,
    reason: RetrievalBlockedReason,
    sourceGeneration?: number,
  ): Promise<RetrievalProjectionState | null> {
    if (state === null && sourceGeneration === undefined) return null;
    try {
      return await retrieval.markArticleProjectionBlocked(
        articleId,
        state?.generation ?? 1,
        reason,
        state === null ? sourceGeneration : undefined,
      );
    } catch (error) {
      if (!(error instanceof RepositoryConflictError)) throw error;
      // A stale worker must not attach its failure to a newer plan.
      return retrieval.readArticleProjection(articleId);
    }
  }

  async function repair(
    access: AccessContext,
    articleId: string,
    budget: BatchBudget,
  ): Promise<ArticleIndexStatusDto> {
    for (
      let attempt = 0;
      attempt < repository.limits.maxConflictAttempts;
      attempt += 1
    ) {
      if (budget.remaining === 0) return currentStatus(access, articleId);
      let state = await retrieval.readArticleProjection(articleId);
      let plan: DesiredProjection | undefined;
      try {
        plan = await desired(access, articleId);
        if (plan.articleGeneration === null && state === null)
          return status(articleId, null, null, "ready");
        await recheckDesired(articleId, plan);
        const generation = (state?.generation ?? 0) + 1;
        requireGeneration(generation, 1);
        state = await retrieval.beginArticleProjection({
          articleId,
          generation,
          sourceGeneration: plan.articleGeneration ?? state!.sourceGeneration,
          targets: plan.targets,
        });
        await recheckDesired(articleId, plan);
        while (state.status === "pending" && budget.remaining > 0) {
          await recheckDesired(articleId, plan);
          budget.remaining -= 1;
          const advanced = await retrieval.advanceArticleProjection(
            articleId,
            state.generation,
          );
          state = advanced.state;
          await recheckDesired(articleId, plan);
          if (advanced.complete) break;
        }
        if (plan.capacity) {
          state = await markBlocked(articleId, state, "capacity");
          return status(
            articleId,
            plan.articleGeneration,
            state,
            "blocked",
            false,
            "capacity",
          );
        }
        return status(
          articleId,
          plan.articleGeneration,
          state,
          state.status,
          state.status === "ready" && plan.targets.length > 0,
          state.status === "blocked" ? state.reason : undefined,
        );
      } catch (error) {
        if (error instanceof RepositoryCapacityError) {
          state = await markBlocked(
            articleId,
            state,
            "capacity",
            plan?.articleGeneration ?? undefined,
          );
          return status(
            articleId,
            plan?.articleGeneration ?? null,
            state,
            "blocked",
            false,
            "capacity",
          );
        }
        if (error instanceof RepositoryConflictError) {
          // Contention is not a durable hold. A same-plan winner may still be
          // advancing this exact generation; blocking it would stall recovery.
          continue;
        }
        if (error instanceof KnowledgeBaseNotFoundError) {
          await markBlocked(articleId, state, "source-unavailable");
          continue;
        }
        throw error;
      }
    }
    return currentStatus(access, articleId);
  }

  async function repairCollectionDirectory(
    collectionId: string,
  ): Promise<ArticleIndexStatusDto["status"]> {
    for (
      let attempt = 0;
      attempt < repository.limits.maxConflictAttempts;
      attempt += 1
    ) {
      try {
        const current = await repository.readCollectionVersioned(collectionId);
        if (current === null) return "ready";
        // Only the opaque ID is derived. Request readers re-authorize policy.
        await retrieval.registerCollection(collectionId);
        const latest = await repository.readResourceGeneration(
          "collection",
          collectionId,
        );
        if (latest === current.value.generation) return "ready";
      } catch (error) {
        if (error instanceof RepositoryCapacityError) return "blocked";
        if (!(error instanceof RepositoryConflictError)) throw error;
      }
    }
    return "pending";
  }

  return {
    async repairArticleIndex(access, request) {
      access = caller(access);
      const input = articleInput(request);
      const result = await repair(access, input.articleId, {
        remaining: limits.maxMaintenanceBatches,
      });
      requirePermission(access, knowledgePermissions.indexManage);
      return result;
    },

    async getArticleIndexStatus(access, request) {
      access = caller(access);
      const input = articleInput(request);
      const result = await currentStatus(access, input.articleId);
      requirePermission(access, knowledgePermissions.indexManage);
      return result;
    },

    async repairRetrievalPage(access, request) {
      access = caller(access);
      const input: RepairRetrievalPageInput = objectInput(request, [
        "cursor",
        "limit",
      ]);
      const requestedLimit = input.limit ?? limits.maxRepairScanRows;
      if (
        !Number.isSafeInteger(requestedLimit) ||
        requestedLimit < 1 ||
        requestedLimit > limits.maxRepairScanRows
      )
        throw new TypeError("Repair page size exceeds the physical scan bound");
      // Each candidate receives one advancement, even when early articles block.
      // The requested page size is an upper bound, not an obligation to scan it.
      const limit = Math.min(requestedLimit, limits.maxMaintenanceBatches);
      if (
        input.cursor !== undefined &&
        (typeof input.cursor !== "string" ||
          input.cursor.length === 0 ||
          input.cursor.length > 16_384)
      )
        throw new TypeError("Expected a bounded opaque repair continuation");
      const page = await records.scan({
        limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
      if (!Array.isArray(page.records) || page.records.length > limit)
        throw new RepositoryIntegrityError();
      if (page.nextCursor !== null && typeof page.nextCursor !== "string")
        throw new RepositoryIntegrityError();
      const candidates = new Map<
        string,
        { readonly kind: "article" | "collection"; readonly id: string }
      >();
      for (const row of page.records) {
        if (
          row.key.partition !== row.value.partition ||
          row.key.id !== row.value.id
        )
          throw new RepositoryIntegrityError();
        const value = row.value;
        if (
          value.resourceKind !== "article" &&
          value.resourceKind !== "collection"
        )
          continue;
        if (value.kind !== "head" && value.kind !== "job") continue;
        if (
          value.partition !==
            value.resourceKind +
              ":" +
              (await fingerprint([value.resourceKind, value.resourceId])) ||
          (value.kind === "head" && value.id !== "head") ||
          (value.kind === "job" && !value.id.startsWith("job:"))
        )
          throw new RepositoryIntegrityError();
        // Jobs are hints only. Never index their old payload or generation.
        if (value.kind === "job") {
          const data = value.data as { readonly task?: unknown };
          if (
            data.task !==
            (value.resourceKind === "article"
              ? "article_changed"
              : "collection_changed")
          )
            continue;
        }
        candidates.set(canonicalJson([value.resourceKind, value.resourceId]), {
          kind: value.resourceKind,
          id: value.resourceId,
        });
      }
      let repaired = 0;
      let pending = 0;
      let blocked = 0;
      for (const candidate of candidates.values()) {
        const state =
          candidate.kind === "article"
            ? (await repair(access, candidate.id, { remaining: 1 })).status
            : await repairCollectionDirectory(candidate.id);
        if (state === "ready") repaired += 1;
        else if (state === "blocked") blocked += 1;
        else pending += 1;
      }
      requirePermission(access, knowledgePermissions.indexManage);
      return {
        physicalRows: page.records.length,
        candidates: candidates.size,
        repaired,
        pending,
        blocked,
        nextCursor: page.nextCursor,
      };
    },
  };
}
