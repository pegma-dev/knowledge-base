import type { AccessContext } from "@pegma/authorization-core";
import { KnowledgeEvidenceReportsError } from "@pegma/knowledge-base-application";
import { articleKinds } from "@pegma/knowledge-base-contracts";
import { z } from "zod";

import {
  createKnowledgeAgentErrorResponse,
  KnowledgeAgentBoundaryError,
  mapKnowledgeAgentError,
} from "./errors.js";
import {
  knowledgeAgentEnvelopeSchema,
  knowledgeAgentReportEnvelopeSchema,
  knowledgeAgentReportResultSchemas,
  knowledgeAgentResultSchemas,
  resolveKnowledgeAgentLimits,
  snapshotKnowledgeAgentJson,
} from "./schemas.js";
import {
  knowledgeAgentScopes,
  type KnowledgeAgentDispatcher,
  type KnowledgeAgentDispatcherOptions,
  type KnowledgeAgentEnvelope,
  type KnowledgeAgentIdentity,
  type KnowledgeAgentOperation,
  type KnowledgeAgentSuccess,
} from "./types.js";

const initialPermissions = Object.freeze(Object.values(knowledgeAgentScopes));
// Trusted host authority is independently bounded. Client payload array limits
// must not reject an administrator's broad context before it can be attenuated.
const maximumAuthorityItems = 256;
const maximumAuthorityCharacters = 1_024;

function own(value: unknown, key: string): unknown {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new KnowledgeAgentBoundaryError("forbidden");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor))
    throw new KnowledgeAgentBoundaryError("forbidden");
  return descriptor.value;
}

function trustedText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)
  ) {
    throw new KnowledgeAgentBoundaryError("forbidden");
  }
  return value;
}

function knownPermissions(value: unknown): ReadonlySet<string> {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw new KnowledgeAgentBoundaryError("forbidden");
  }
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (
    length === undefined ||
    !("value" in length) ||
    typeof length.value !== "number" ||
    length.value > maximumAuthorityItems ||
    Reflect.ownKeys(value).length !== length.value + 1
  ) {
    throw new KnowledgeAgentBoundaryError("forbidden");
  }
  const result = new Set<string>();
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw new KnowledgeAgentBoundaryError("forbidden");
    }
    const permission: unknown = descriptor.value;
    if (
      typeof permission !== "string" ||
      permission.length > maximumAuthorityCharacters
    ) {
      throw new KnowledgeAgentBoundaryError("forbidden");
    }
    if (initialPermissions.some((known) => known === permission))
      result.add(permission);
  }
  return result;
}

/** Snapshot the exact least-authority context without reading host role data. */
function effectiveAccess(
  identity: KnowledgeAgentIdentity,
  resource: string,
): AccessContext {
  if (trustedText(own(identity, "resource"), 2_048) !== resource)
    throw new KnowledgeAgentBoundaryError("forbidden");
  trustedText(own(identity, "clientId"), 200);
  const scopes = knownPermissions(own(identity, "scopes"));
  const access = own(identity, "access");
  const principalId = trustedText(own(access, "principalId"), 200);
  const policyVersion = trustedText(own(access, "policyVersion"), 200);
  const currentPermissions = knownPermissions(own(access, "permissions"));
  return Object.freeze({
    principalId,
    policyVersion,
    roles: Object.freeze([]),
    entitlements: Object.freeze([]),
    permissions: Object.freeze(
      initialPermissions.filter(
        (permission) =>
          scopes.has(permission) && currentPermissions.has(permission),
      ),
    ),
  });
}

function requireOperation(
  access: AccessContext,
  operation: KnowledgeAgentOperation,
): void {
  const has = (permission: string) => access.permissions.includes(permission);
  const allowed =
    operation === "getValidationRequirements"
      ? has(knowledgeAgentScopes.draftWrite) ||
        has(knowledgeAgentScopes.evidenceSubmit)
      : has(
          operation === "getDraft"
            ? knowledgeAgentScopes.draftRead
            : operation === "submitEvidence"
              ? knowledgeAgentScopes.evidenceSubmit
              : knowledgeAgentScopes.draftWrite,
        );
  if (!allowed) throw new KnowledgeAgentBoundaryError("forbidden");
}

function requireReportAccess(access: AccessContext): void {
  if (
    !access.permissions.includes(knowledgeAgentScopes.draftRead) ||
    !access.permissions.includes(knowledgeAgentScopes.evidenceSubmit)
  ) {
    throw new KnowledgeAgentBoundaryError("forbidden");
  }
}

function reportError(
  error: KnowledgeEvidenceReportsError,
): KnowledgeAgentBoundaryError {
  switch (error.code) {
    case "invalid_request":
      return new KnowledgeAgentBoundaryError("invalid_request");
    case "report_too_large":
    case "report_capacity":
      return new KnowledgeAgentBoundaryError("capacity");
    case "forbidden":
      return new KnowledgeAgentBoundaryError("forbidden");
    case "report_not_found":
      return new KnowledgeAgentBoundaryError("not_found");
    case "invalid_configuration":
      return new KnowledgeAgentBoundaryError("unavailable");
    case "report_target_unavailable":
    case "report_not_verifiable":
      return new KnowledgeAgentBoundaryError("prerequisite");
    default:
      return new KnowledgeAgentBoundaryError("conflict");
  }
}

/**
 * One versioned least-authority boundary shared by HTTP and MCP. Authentication,
 * credential issuance, current access resolution, and rate limits are host work.
 */
export function createKnowledgeAgentDispatcher(
  options: KnowledgeAgentDispatcherOptions,
): KnowledgeAgentDispatcher {
  const limits = resolveKnowledgeAgentLimits(options.limits);
  const resource = trustedText(options.resource, 2_048);
  const application = options.application;
  const suppliedReports = options.reports;
  if (
    suppliedReports !== undefined &&
    (!suppliedReports ||
      typeof suppliedReports.report !== "function" ||
      typeof suppliedReports.ledger !== "function" ||
      typeof suppliedReports.status !== "function" ||
      (suppliedReports.query !== undefined &&
        typeof suppliedReports.query !== "function"))
  ) {
    throw new TypeError("Invalid knowledge agent report service");
  }
  const reports =
    suppliedReports === undefined
      ? undefined
      : Object.freeze({
          report: suppliedReports.report.bind(suppliedReports),
          ledger: suppliedReports.ledger.bind(suppliedReports),
          status: suppliedReports.status.bind(suppliedReports),
          ...(suppliedReports.query === undefined
            ? {}
            : { query: suppliedReports.query.bind(suppliedReports) }),
        });
  const envelopeSchema =
    reports === undefined
      ? knowledgeAgentEnvelopeSchema
      : knowledgeAgentReportEnvelopeSchema;
  function reportOutput<T>(
    schema: { parse(value: unknown): T },
    value: unknown,
  ): T {
    try {
      return schema.parse(
        snapshotKnowledgeAgentJson(value, limits, limits.maxResponseBytes),
      );
    } catch {
      throw new KnowledgeAgentBoundaryError("unavailable");
    }
  }
  const reportResult =
    knowledgeAgentReportResultSchemas.getValidationRequirements.shape;
  // Trusted aggregate data is still bounded and projected; none of its internal
  // target binding or private implementation fields become new wire fields.
  const aggregateResult = z
    .object({
      target: z
        .object({
          articleId: z.unknown().transform((value) => trustedText(value, 200)),
          generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          collectionId: z
            .unknown()
            .transform((value) => trustedText(value, 200)),
          kind: z.enum(articleKinds),
        })
        .strip(),
      requirements: knowledgeAgentResultSchemas.getValidationRequirements,
      ledger: reportResult.reportLedger,
      status: reportResult.reportStatus,
    })
    .strip();
  return Object.freeze({
    limits,
    ...(reports === undefined ? {} : { reportWorkflow: true as const }),
    async dispatch(identity: KnowledgeAgentIdentity, request: unknown) {
      let operation: KnowledgeAgentOperation | null = null;
      try {
        // All caller-owned objects are detached before the first application
        // await. The application still performs current resource/replay checks.
        const access = effectiveAccess(identity, resource);
        const snapshot = snapshotKnowledgeAgentJson(request, limits);
        const parsed = envelopeSchema.safeParse(snapshot);
        if (!parsed.success)
          throw new KnowledgeAgentBoundaryError("invalid_request");
        const envelope = snapshotKnowledgeAgentJson(
          parsed.data,
          limits,
        ) as KnowledgeAgentEnvelope;
        operation = envelope.operation;
        requireOperation(access, operation);
        let result: unknown;
        switch (envelope.operation) {
          case "getDraft":
            result = await application.getDraft(access, envelope.input);
            break;
          case "createDraft":
            result = await application.createDraft(access, envelope.input);
            break;
          case "updateDraft":
            result = await application.updateDraft(access, envelope.input);
            break;
          case "getValidationRequirements":
            if (!("articleId" in envelope.input)) {
              result = await application.getValidationRequirements(
                access,
                envelope.input,
              );
              break;
            }
            requireReportAccess(access);
            if (reports === undefined)
              throw new KnowledgeAgentBoundaryError("invalid_request");
            {
              const input = envelope.input;
              if (reports.query !== undefined) {
                const lookup = input.reportLookup;
                const queried = reportOutput(
                  aggregateResult,
                  await reports.query(access, {
                    articleId: input.articleId,
                    ...(lookup === undefined ? {} : { status: lookup }),
                  }),
                );
                if (
                  queried.target.articleId !== input.articleId ||
                  queried.requirements.collectionId !==
                    queried.target.collectionId
                )
                  throw new KnowledgeAgentBoundaryError("unavailable");
                if (
                  queried.target.collectionId !== input.collectionId ||
                  queried.target.kind !== input.kind
                )
                  throw new KnowledgeAgentBoundaryError("conflict");
                if (
                  lookup !== undefined &&
                  queried.ledger.ledgerEpoch !== lookup.ledgerEpoch
                )
                  throw new KnowledgeAgentBoundaryError("conflict");
                if (
                  (lookup === undefined) !== (queried.status === undefined) ||
                  (queried.status !== undefined &&
                    (queried.status.ledgerEpoch !== lookup?.ledgerEpoch ||
                      queried.status.reportId !== lookup?.reportId))
                )
                  throw new KnowledgeAgentBoundaryError("unavailable");
                result = {
                  ...queried.requirements,
                  reportLedger: queried.ledger,
                  ...(queried.status === undefined
                    ? {}
                    : { reportStatus: queried.status }),
                };
                break;
              }
              const target = await application.getDraft(access, {
                articleId: input.articleId,
              });
              if (
                target.revision.collectionId !== input.collectionId ||
                target.revision.kind !== input.kind
              )
                throw new KnowledgeAgentBoundaryError("conflict");
              // Closed application DTOs receive only their actual public fields.
              const query = {
                collectionId: input.collectionId,
                kind: input.kind,
              };
              const requirements = await application.getValidationRequirements(
                access,
                query,
              );
              const ledger = reportOutput(
                reportResult.reportLedger,
                await reports.ledger(access, { articleId: input.articleId }),
              );
              const lookup = input.reportLookup;
              if (
                lookup !== undefined &&
                ledger.ledgerEpoch !== lookup.ledgerEpoch
              )
                throw new KnowledgeAgentBoundaryError("conflict");
              const status =
                lookup === undefined
                  ? undefined
                  : reportOutput(
                      reportResult.reportStatus.unwrap(),
                      await reports.status(access, {
                        articleId: input.articleId,
                        ...lookup,
                      }),
                    );
              const latestRequirements =
                await application.getValidationRequirements(access, query);
              const latestLedger = reportOutput(
                reportResult.reportLedger,
                await reports.ledger(access, { articleId: input.articleId }),
              );
              const latest = await application.getDraft(access, {
                articleId: input.articleId,
              });
              if (
                latest.generation !== target.generation ||
                latest.revision.collectionId !== input.collectionId ||
                latest.revision.kind !== input.kind ||
                JSON.stringify(latestRequirements) !==
                  JSON.stringify(requirements) ||
                latestLedger.ledgerEpoch !== ledger.ledgerEpoch ||
                latestLedger.status !== ledger.status
              )
                throw new KnowledgeAgentBoundaryError("conflict");
              if (
                status !== undefined &&
                (status.ledgerEpoch !== lookup?.ledgerEpoch ||
                  status.reportId !== lookup?.reportId)
              )
                throw new KnowledgeAgentBoundaryError("unavailable");
              // Observe the bounded report DTO again after all other awaited
              // fences. This does not lock a decision atomically with a response.
              const latestStatus =
                lookup === undefined
                  ? undefined
                  : reportOutput(
                      reportResult.reportStatus.unwrap(),
                      await reports.status(access, {
                        articleId: input.articleId,
                        ...lookup,
                      }),
                    );
              if (
                latestStatus !== undefined &&
                (latestStatus.ledgerEpoch !== lookup?.ledgerEpoch ||
                  latestStatus.reportId !== lookup?.reportId)
              )
                throw new KnowledgeAgentBoundaryError("unavailable");
              if (JSON.stringify(latestStatus) !== JSON.stringify(status))
                throw new KnowledgeAgentBoundaryError("conflict");
              result = {
                ...latestRequirements,
                reportLedger: {
                  ledgerEpoch: latestLedger.ledgerEpoch,
                  status: latestLedger.status,
                },
                ...(latestStatus === undefined
                  ? {}
                  : {
                      reportStatus: {
                        ledgerEpoch: latestStatus.ledgerEpoch,
                        reportId: latestStatus.reportId,
                        receipt: latestStatus.receipt,
                        reportGeneration: latestStatus.reportGeneration,
                        status: latestStatus.status,
                      },
                    }),
              };
            }
            break;
          case "submitEvidence":
            if ("receipt" in envelope.input) {
              result = await application.submitEvidence(access, envelope.input);
              break;
            }
            requireReportAccess(access);
            if (reports === undefined)
              throw new KnowledgeAgentBoundaryError("invalid_request");
            {
              const input = envelope.input;
              const target = await application.getDraft(access, {
                articleId: input.articleId,
              });
              const ack = await reports.report(access, {
                commandId: input.commandId,
                articleId: input.articleId,
                ledgerEpoch: input.ledgerEpoch,
                expectedArticleGeneration: input.expectedGeneration,
                evidence: input.evidence,
                report: input.report,
              });
              // The report and article live in separate partitions. A changed
              // article withholds this ACK; it does not roll back a queued report.
              const latest = await application.getDraft(access, {
                articleId: input.articleId,
              });
              if (latest.generation !== target.generation)
                throw new KnowledgeAgentBoundaryError("conflict");
              result = {
                kind: "pending-human-review",
                ledgerEpoch: ack.ledgerEpoch,
                reportId: ack.reportId,
                receipt: ack.receipt,
                reportGeneration: ack.reportGeneration,
              };
            }
            break;
        }
        let detached: unknown;
        try {
          detached = snapshotKnowledgeAgentJson(
            result,
            limits,
            limits.maxResponseBytes,
          );
        } catch (error) {
          if (
            error instanceof KnowledgeAgentBoundaryError &&
            error.code === "capacity"
          ) {
            throw error;
          }
          throw new KnowledgeAgentBoundaryError("unavailable");
        }
        const resultSchema =
          envelope.operation === "getValidationRequirements" &&
          "articleId" in envelope.input
            ? knowledgeAgentReportResultSchemas.getValidationRequirements
            : envelope.operation === "submitEvidence" &&
                !("receipt" in envelope.input)
              ? knowledgeAgentReportResultSchemas.submitEvidence
              : knowledgeAgentResultSchemas[operation];
        const safe = resultSchema.safeParse(detached);
        if (!safe.success) throw new KnowledgeAgentBoundaryError("unavailable");
        return snapshotKnowledgeAgentJson(
          { apiVersion: "1", operation, result: safe.data },
          limits,
          limits.maxResponseBytes,
        ) as KnowledgeAgentSuccess;
      } catch (error) {
        return createKnowledgeAgentErrorResponse(
          mapKnowledgeAgentError(
            error instanceof KnowledgeEvidenceReportsError
              ? reportError(error)
              : error,
          ).code,
          operation,
        );
      }
    },
  });
}
