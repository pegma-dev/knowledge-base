import {
  articleKinds,
  type Article,
  type Collection,
  type PublicCollectionApproval,
  type ValidationPolicy,
  type VerificationEvidence,
} from "@pegma/knowledge-base-contracts";
import { describe, expect, it } from "vitest";

import {
  applyCollectionPolicy,
  createArticle,
  createCollection,
  isPublicationBoundToCurrentPolicies,
  knowledgeLimits,
  previewCollectionPolicy,
  publishArticle,
  recordEvidence,
  rejectReview,
  retireArticle,
  reviseArticle,
  submitForReview,
  type ArticleDraft,
  type DraftContext,
  type EvidenceSubmission,
  type ReviewContext,
} from "./index.js";

const at = (offset = 0) =>
  new Date(Date.parse("2026-11-06T20:00:00.000Z") + offset).toISOString();
const policy: ValidationPolicy = {
  id: "policy/documentation",
  version: 1,
  requirements: [
    ...articleKinds.map((kind) => ({
      id: kind + "-content",
      kind,
      testKind: "content",
      maxAgeMilliseconds: 60_000,
      trustedRunnerIds: ["runner/staging"],
    })),
    {
      id: "walkthrough-workflow",
      kind: "walkthrough",
      testKind: "workflow",
      maxAgeMilliseconds: 60_000,
      trustedRunnerIds: ["runner/staging"],
    },
  ],
};
const draft: ArticleDraft = {
  kind: "explanation",
  title: "Export your workspace",
  summary: "Download a workspace export.",
  content: { format: "markdown", text: "Choose [Export](/workspace/export)." },
  tags: ["export"],
  applicability: {
    productId: "fictional-workshop",
    productVersion: "1.0",
    buildId: "staging-42",
    locale: "en-US",
  },
};

function collection(id = "collection/portal"): Collection {
  return createCollection({
    id,
    name: "Workshop guides",
    actorId: "staff/admin",
    at: at(),
  });
}

function authorContext(currentCollection = collection()): DraftContext {
  return {
    collection: currentCollection,
    validationPolicy: policy,
    actorId: "agent/author",
    at: at(),
  };
}

function reviewContext(
  currentCollection = collection(),
  offset = 3_000,
): ReviewContext {
  return {
    collection: currentCollection,
    validationPolicy: policy,
    expectedStagingBuildId: "staging-42",
    trustedAttesterIds: ["staff/verifier"],
    at: at(offset),
  };
}

async function article(
  kind: ArticleDraft["kind"] = "explanation",
  currentCollection = collection(),
) {
  return createArticle({
    id: "article/export",
    draft: { ...draft, kind },
    context: authorContext(currentCollection),
  });
}

function submission(
  current: Article,
  checkId = current.current.kind + "-content",
): EvidenceSubmission {
  const requirement = policy.requirements.find((item) => item.id === checkId)!;
  return {
    id: "evidence/" + checkId,
    articleId: current.id,
    articleRevision: current.current.number,
    contentHash: current.current.contentHash,
    validationPolicy: current.current.validationPolicy,
    checkId,
    testKind: requirement.testKind,
    applicability: current.current.applicability,
    stagingBuildId: "staging-42",
    steps: ["Read the exact draft and check the stated product behavior."],
    result: "passed",
    executedAt: at(1_000),
    runnerId: "runner/staging",
    artifacts: [{ id: "artifact/synthetic-test", hash: "a".repeat(64) }],
  };
}

const attestation: VerificationEvidence["attestation"] = {
  id: "receipt/verified",
  verifiedBy: "staff/verifier",
  verifiedAt: at(2_000),
};

async function checks(
  current: Article,
  context = reviewContext(),
): Promise<Article> {
  let next = current;
  for (const requirement of policy.requirements.filter(
    (item) => item.kind === current.current.kind,
  )) {
    next = await recordEvidence(next, {
      evidence: submission(next, requirement.id),
      attestation,
      context,
    });
  }
  return next;
}

async function reviewed(
  current?: Article,
  context = reviewContext(),
): Promise<Article> {
  const source = current ?? (await article());
  return submitForReview(await checks(source, context), {
    expectedRevision: source.current.number,
    context,
  });
}

async function published(
  current?: Article,
  context = reviewContext(),
): Promise<Article> {
  const source = current ?? (await reviewed());
  return publishArticle(source, {
    expectedRevision: source.current.number,
    binding: source.review!,
    reviewerId: "staff/reviewer",
    context,
  });
}

describe("collection audience changes", () => {
  it("creates private collections with independent portal and bot uses", async () => {
    const initial = collection();
    expect(initial.policy).toEqual({
      version: 1,
      portal: { enabled: false },
      bot: { enabled: false },
    });
    const preview = await previewCollectionPolicy(initial, {
      portal: { enabled: false },
      bot: {
        enabled: true,
        audience: { kind: "permission", permission: "workshop.customer" },
      },
    });
    const updated = await applyCollectionPolicy(initial, {
      preview,
      actorId: "staff/admin",
      at: at(1_000),
    });
    expect(updated.policy.portal.enabled).toBe(false);
    expect(updated.policy.bot).toEqual({
      enabled: true,
      audience: { kind: "permission", permission: "workshop.customer" },
    });
    expect(initial.policy.version).toBe(1);
    expect(updated.policy.version).toBe(2);
    expect(updated).not.toHaveProperty("publicApproval");
  });

  it("requires explicit public approval of the exact preview and defeats replay", async () => {
    const initial = collection();
    const preview = await previewCollectionPolicy(initial, {
      portal: { enabled: true, audience: { kind: "anonymous" } },
      bot: { enabled: false },
    });
    await expect(
      applyCollectionPolicy(initial, {
        preview,
        actorId: "staff/admin",
        at: at(1_000),
      }),
    ).rejects.toMatchObject({ field: "publicApproval" });
    const approval: PublicCollectionApproval = {
      collectionId: initial.id,
      policyVersion: preview.policy.version,
      policyHash: preview.policyHash,
      reviewerId: "staff/reviewer",
      reviewedAt: at(1_000),
    };
    await expect(
      applyCollectionPolicy(initial, {
        preview,
        actorId: "staff/admin",
        at: at(1_000),
        publicApproval: { ...approval, policyHash: "b".repeat(64) },
      }),
    ).rejects.toMatchObject({ field: "publicApproval" });
    const publicCollection = await applyCollectionPolicy(initial, {
      preview,
      actorId: "staff/admin",
      at: at(1_000),
      publicApproval: approval,
    });
    expect(publicCollection.publicApproval).toEqual(approval);
    await expect(
      applyCollectionPolicy(publicCollection, {
        preview,
        actorId: "staff/admin",
        at: at(2_000),
        publicApproval: approval,
      }),
    ).rejects.toMatchObject({ field: "preview" });
    const privatePreview = await previewCollectionPolicy(publicCollection, {
      portal: { enabled: false },
      bot: { enabled: false },
    });
    const privateAgain = await applyCollectionPolicy(publicCollection, {
      preview: privatePreview,
      actorId: "staff/admin",
      at: at(2_000),
    });
    expect(privateAgain).not.toHaveProperty("publicApproval");
  });

  it("rejects a mutated preview even when its policy version is unchanged", async () => {
    const initial = collection();
    const preview = await previewCollectionPolicy(initial, {
      portal: { enabled: false },
      bot: { enabled: false },
    });
    await expect(
      applyCollectionPolicy(initial, {
        preview: {
          ...preview,
          policy: {
            ...preview.policy,
            bot: { enabled: true, audience: { kind: "anonymous" } },
          },
        },
        actorId: "staff/admin",
        at: at(1_000),
      }),
    ).rejects.toMatchObject({ field: "preview" });
  });

  it("rejects public approval predating the source policy but allows review before application", async () => {
    const initial = collection();
    const privatePreview = await previewCollectionPolicy(initial, {
      portal: {
        enabled: true,
        audience: { kind: "permission", permission: "workshop.customer" },
      },
      bot: { enabled: false },
    });
    const updated = await applyCollectionPolicy(initial, {
      preview: privatePreview,
      actorId: "staff/admin",
      at: at(10_000),
    });
    const publicPreview = await previewCollectionPolicy(updated, {
      portal: { enabled: true, audience: { kind: "anonymous" } },
      bot: { enabled: false },
    });
    const approval: PublicCollectionApproval = {
      collectionId: updated.id,
      policyVersion: publicPreview.policy.version,
      policyHash: publicPreview.policyHash,
      reviewerId: "staff/reviewer",
      reviewedAt: at(5_000),
    };
    await expect(
      applyCollectionPolicy(updated, {
        preview: publicPreview,
        actorId: "staff/admin",
        at: at(20_000),
        publicApproval: approval,
      }),
    ).rejects.toMatchObject({ field: "publicApproval.reviewedAt" });
    const approved = await applyCollectionPolicy(updated, {
      preview: publicPreview,
      actorId: "staff/admin",
      at: at(20_000),
      publicApproval: { ...approval, reviewedAt: at(15_000) },
    });
    await expect(
      applyCollectionPolicy(updated, {
        preview: publicPreview,
        actorId: "staff/admin",
        at: at(20_000),
        publicApproval: { ...approval, reviewedAt: at(25_000) },
      }),
    ).rejects.toMatchObject({ field: "publicApproval.reviewedAt" });
    expect(approved.publicApproval?.reviewedAt).toBe(at(15_000));
    expect(approved.updatedAt).toBe(at(20_000));
    expect(approved.policy.portal).toEqual({
      enabled: true,
      audience: { kind: "anonymous" },
    });
  });
});

describe("immutable drafts and publication", () => {
  it.each(["buildId", "locale"] as const)(
    "rejects supplied approval applicability.%s before comparison",
    async (field) => {
      const inReview = await reviewed();
      await expect(
        publishArticle(inReview, {
          expectedRevision: 1,
          binding: {
            ...inReview.review!,
            applicability: {
              ...inReview.review!.applicability,
              [field]: undefined,
            } as ArticleDraft["applicability"],
          },
          reviewerId: "staff/reviewer",
          context: reviewContext(),
        }),
      ).rejects.toMatchObject({ field: "applicability." + field });
    },
  );

  it.each(["buildId", "locale"] as const)(
    "rejects stored review applicability.%s before comparison",
    async (field) => {
      const inReview = await reviewed();
      const malformed = {
        ...inReview,
        review: {
          ...inReview.review!,
          applicability: {
            ...inReview.review!.applicability,
            [field]: undefined,
          } as ArticleDraft["applicability"],
        },
      };
      await expect(
        publishArticle(malformed, {
          expectedRevision: 1,
          binding: inReview.review!,
          reviewerId: "staff/reviewer",
          context: reviewContext(),
        }),
      ).rejects.toMatchObject({ field: "applicability." + field });
    },
  );

  it.each(["buildId", "locale"] as const)(
    "rejects published binding applicability.%s before policy comparison",
    async (field) => {
      const approved = await published();
      const malformed = {
        ...approved,
        published: {
          ...approved.published!,
          approval: {
            ...approved.published!.approval,
            binding: {
              ...approved.published!.approval.binding,
              applicability: {
                ...approved.published!.approval.binding.applicability,
                [field]: undefined,
              } as ArticleDraft["applicability"],
            },
          },
        },
      };
      await expect(
        isPublicationBoundToCurrentPolicies(malformed, collection(), policy),
      ).rejects.toMatchObject({ field: "applicability." + field });
    },
  );

  it("computes hashes, snapshots caller input, and freezes nested revisions", async () => {
    const input = structuredClone(draft);
    const pending = createArticle({
      id: "article/export",
      draft: input,
      context: authorContext(),
    });
    (input.content as { text: string }).text =
      "Caller changed this during hashing.";
    const created = await pending;
    expect(created.current.content.text).toBe(draft.content.text);
    expect(created.current.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(created.current.content)).toBe(true);
    expect(created).not.toHaveProperty("published");
    expect(created.current).not.toHaveProperty("audience");
  });

  it("publishes only an exact verified review snapshot", async () => {
    const created = await article();
    await expect(
      submitForReview(created, {
        expectedRevision: 1,
        context: reviewContext(),
      }),
    ).rejects.toMatchObject({ code: "evidence" });
    const inReview = await reviewed(created);
    await expect(
      publishArticle(inReview, {
        expectedRevision: 1,
        binding: { ...inReview.review!, contentHash: "b".repeat(64) },
        reviewerId: "staff/reviewer",
        context: reviewContext(),
      }),
    ).rejects.toMatchObject({ field: "approval" });
    const ready = await published(inReview);
    expect(ready.state).toBe("published");
    expect(ready.published?.approval.binding).toEqual(inReview.review);
    expect(ready.published?.revision.contentHash).toBe(
      created.current.contentHash,
    );
    expect(ready).not.toHaveProperty("review");
  });

  it("edits preserve the old publication but invalidate pending review and evidence", async () => {
    const first = await published();
    const changed = await reviseArticle(first, {
      expectedRevision: 1,
      draft: { ...draft, title: "Export a snapshot" },
      context: { ...authorContext(), at: at(4_000) },
    });
    expect(changed.current.number).toBe(2);
    expect(changed.current.contentHash).not.toBe(first.current.contentHash);
    expect(changed.evidence).toEqual([]);
    expect(changed).not.toHaveProperty("review");
    expect(changed.published).toEqual(first.published);
    expect(first.current.title).toBe(draft.title);
    await expect(
      publishArticle(changed, {
        expectedRevision: 2,
        binding: first.published!.approval.binding,
        reviewerId: "staff/reviewer",
        context: reviewContext(),
      }),
    ).rejects.toMatchObject({ code: "transition" });
    await expect(
      reviseArticle(changed, {
        expectedRevision: 1,
        draft,
        context: authorContext(),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("moves only a draft's collection while retaining the old approved collection binding", async () => {
    const initial = await published();
    const other = collection("collection/bot-only");
    const moved = await reviseArticle(initial, {
      expectedRevision: 1,
      draft,
      context: { ...authorContext(other), at: at(4_000) },
    });
    expect(moved.current.collectionId).toBe(other.id);
    expect(moved.published?.revision.collectionId).toBe("collection/portal");
    expect(
      await isPublicationBoundToCurrentPolicies(moved, collection(), policy),
    ).toBe(true);
    expect(
      await isPublicationBoundToCurrentPolicies(moved, other, policy),
    ).toBe(false);
  });

  it("changed audience or validation requirements defeat stale approval, including same-version mutation", async () => {
    const current = await reviewed();
    const originalCollection = collection();
    const preview = await previewCollectionPolicy(originalCollection, {
      portal: {
        enabled: true,
        audience: { kind: "permission", permission: "staff.read" },
      },
      bot: { enabled: false },
    });
    const changedCollection = await applyCollectionPolicy(originalCollection, {
      preview,
      actorId: "staff/admin",
      at: at(1_000),
    });
    await expect(
      publishArticle(current, {
        expectedRevision: 1,
        binding: current.review!,
        reviewerId: "staff/reviewer",
        context: reviewContext(changedCollection),
      }),
    ).rejects.toMatchObject({ field: "approval" });
    const sameVersion = {
      ...originalCollection,
      policy: {
        ...originalCollection.policy,
        bot: {
          enabled: true as const,
          audience: { kind: "permission" as const, permission: "staff.read" },
        },
      },
    };
    await expect(
      publishArticle(current, {
        expectedRevision: 1,
        binding: current.review!,
        reviewerId: "staff/reviewer",
        context: reviewContext(sameVersion),
      }),
    ).rejects.toMatchObject({ field: "approval" });
    const changedPolicy = {
      ...policy,
      requirements: policy.requirements.map((item) => ({
        ...item,
        maxAgeMilliseconds: item.maxAgeMilliseconds + 1,
      })),
    };
    await expect(
      publishArticle(current, {
        expectedRevision: 1,
        binding: current.review!,
        reviewerId: "staff/reviewer",
        context: { ...reviewContext(), validationPolicy: changedPolicy },
      }),
    ).rejects.toMatchObject({ field: "approval" });
  });

  it("rejects tampered content with a claimed old hash", async () => {
    const current = structuredClone(await reviewed());
    const tampered = {
      ...current,
      current: {
        ...current.current,
        content: { format: "markdown" as const, text: "Changed after review." },
      },
    };
    await expect(
      publishArticle(tampered, {
        expectedRevision: 1,
        binding: current.review!,
        reviewerId: "staff/reviewer",
        context: reviewContext(),
      }),
    ).rejects.toMatchObject({ field: "contentHash" });
  });

  it("requires operation time to follow the current collection policy while retaining older valid evidence", async () => {
    const originalCollection = collection();
    const verified = await checks(await article());
    const originalEvidence = verified.evidence;
    const preview = await previewCollectionPolicy(originalCollection, {
      portal: {
        enabled: true,
        audience: { kind: "permission", permission: "workshop.customer" },
      },
      bot: { enabled: false },
    });
    const updatedCollection = await applyCollectionPolicy(originalCollection, {
      preview,
      actorId: "staff/admin",
      at: at(10_000),
    });
    const staleContext = reviewContext(updatedCollection, 3_000);
    await expect(
      submitForReview(verified, {
        expectedRevision: 1,
        context: staleContext,
      }),
    ).rejects.toMatchObject({ field: "at" });
    await expect(
      recordEvidence(verified, {
        evidence: submission(verified),
        attestation,
        context: staleContext,
      }),
    ).rejects.toMatchObject({ field: "at" });

    const inReview = await submitForReview(verified, {
      expectedRevision: 1,
      context: reviewContext(updatedCollection, 11_000),
    });
    expect(inReview.evidence).toEqual(originalEvidence);
    await expect(
      publishArticle(inReview, {
        expectedRevision: 1,
        binding: inReview.review!,
        reviewerId: "staff/reviewer",
        context: staleContext,
      }),
    ).rejects.toMatchObject({ field: "at" });
    const approved = await published(
      inReview,
      reviewContext(updatedCollection, 12_000),
    );
    expect(approved.published?.approval.reviewedAt).toBe(at(12_000));
    expect(approved.published?.approval.binding.collectionPolicyVersion).toBe(
      updatedCollection.policy.version,
    );
    expect(approved.evidence).toEqual(originalEvidence);
    expect(approved.evidence[0]?.executedAt).toBe(at(1_000));
  });

  it("rejection and retirement clear authority; a retired article requires a new draft", async () => {
    const inReview = await reviewed();
    expect(rejectReview(inReview, 1)).toMatchObject({ state: "draft" });
    expect(rejectReview(inReview, 1)).not.toHaveProperty("review");
    const retired = retireArticle(await published(inReview), 1);
    expect(retired.state).toBe("retired");
    expect(retired).not.toHaveProperty("published");
    expect(retired.evidence).toEqual(inReview.evidence);
    expect(
      await isPublicationBoundToCurrentPolicies(retired, collection(), policy),
    ).toBe(false);
    await expect(
      submitForReview(retired, {
        expectedRevision: 1,
        context: reviewContext(),
      }),
    ).rejects.toMatchObject({ code: "transition" });
    const restoredDraft = await reviseArticle(retired, {
      expectedRevision: 1,
      draft,
      context: { ...authorContext(), at: at(4_000) },
    });
    expect(restoredDraft).toMatchObject({
      state: "draft",
      current: { number: 2 },
    });
    expect(restoredDraft).not.toHaveProperty("published");
  });
});

describe("bound evidence and article-appropriate checks", () => {
  it.each(["buildId", "locale"] as const)(
    "rejects submitted evidence applicability.%s before hashing",
    async (field) => {
      const current = await article();
      const evidence = submission(current);
      await expect(
        recordEvidence(current, {
          evidence: {
            ...evidence,
            applicability: {
              ...evidence.applicability,
              [field]: undefined,
            } as EvidenceSubmission["applicability"],
          },
          attestation,
          context: reviewContext(),
        }),
      ).rejects.toMatchObject({ field: "applicability." + field });
    },
  );

  it.each(["buildId", "locale"] as const)(
    "rejects stored evidence applicability.%s before review hashing",
    async (field) => {
      const verified = await checks(await article());
      const malformed = {
        ...verified,
        evidence: verified.evidence.map((evidence) => ({
          ...evidence,
          applicability: {
            ...evidence.applicability,
            [field]: undefined,
          } as VerificationEvidence["applicability"],
        })),
      };
      await expect(
        submitForReview(malformed, {
          expectedRevision: 1,
          context: reviewContext(),
        }),
      ).rejects.toMatchObject({ field: "applicability." + field });
    },
  );

  it("walkthroughs need workflow evidence in addition to a content check", async () => {
    const current = await article("walkthrough");
    const contentOnly = await recordEvidence(current, {
      evidence: submission(current),
      attestation,
      context: reviewContext(),
    });
    await expect(
      submitForReview(contentOnly, {
        expectedRevision: 1,
        context: reviewContext(),
      }),
    ).rejects.toMatchObject({ code: "evidence" });
    const complete = await recordEvidence(contentOnly, {
      evidence: submission(current, "walkthrough-workflow"),
      attestation,
      context: reviewContext(),
    });
    expect(
      (
        await submitForReview(complete, {
          expectedRevision: 1,
          context: reviewContext(),
        })
      ).state,
    ).toBe("in-review");
  });

  it.each([
    { field: "contentHash", value: "b".repeat(64) },
    { field: "stagingBuildId", value: "staging-wrong" },
    { field: "runnerId", value: "untrusted/runner" },
    { field: "executedAt", value: at(-1_000) },
    { field: "executedAt", value: at(10_000) },
  ])("rejects wrong evidence $field=$value", async ({ field, value }) => {
    const current = await article();
    await expect(
      recordEvidence(current, {
        evidence: { ...submission(current), [field]: value },
        attestation,
        context: reviewContext(),
      }),
    ).rejects.toMatchObject({ code: "evidence" });
  });

  it("requires a trusted authenticated-receipt fact, not just a passed result", async () => {
    const current = await article();
    await expect(
      recordEvidence(current, {
        evidence: submission(current),
        attestation: { ...attestation, verifiedBy: "agent/self-reported" },
        context: reviewContext(),
      }),
    ).rejects.toMatchObject({ field: "evidence.attestation" });
  });

  it("does not review failed checks and rechecks freshness at publication", async () => {
    const current = await article();
    const failed = await recordEvidence(current, {
      evidence: { ...submission(current), result: "failed" },
      attestation,
      context: reviewContext(),
    });
    await expect(
      submitForReview(failed, {
        expectedRevision: 1,
        context: reviewContext(),
      }),
    ).rejects.toMatchObject({ code: "evidence" });
    const inReview = await reviewed(current);
    await expect(
      publishArticle(inReview, {
        expectedRevision: 1,
        binding: inReview.review!,
        reviewerId: "staff/reviewer",
        context: reviewContext(collection(), 70_000),
      }),
    ).rejects.toMatchObject({ field: "evidence.executedAt" });
  });

  it("replacing evidence increments its version and invalidates submitted review", async () => {
    const current = await reviewed();
    const replacement = await recordEvidence(current, {
      evidence: {
        ...submission(current),
        steps: ["Rechecked the exact draft."],
      },
      attestation: { ...attestation, id: "receipt/rechecked" },
      context: reviewContext(),
    });
    expect(replacement.state).toBe("draft");
    expect(replacement).not.toHaveProperty("review");
    expect(replacement.evidence[0]?.version).toBe(2);
    expect(replacement.evidence[0]?.hash).not.toBe(current.evidence[0]?.hash);
    await expect(
      publishArticle(replacement, {
        expectedRevision: 1,
        binding: current.review!,
        reviewerId: "staff/reviewer",
        context: reviewContext(),
      }),
    ).rejects.toMatchObject({ code: "transition" });
  });
});

describe("malformed and bounded source content", () => {
  it.each(["buildId", "locale"] as const)(
    "rejects explicit undefined at applicability.%s",
    async (field) => {
      await expect(
        createArticle({
          id: "article/undefined-applicability",
          draft: {
            ...draft,
            applicability: {
              ...draft.applicability,
              [field]: undefined,
            } as ArticleDraft["applicability"],
          },
          context: authorContext(),
        }),
      ).rejects.toMatchObject({ field: "applicability." + field });
    },
  );

  it("accepts applicability with optional build and locale omitted", async () => {
    const created = await createArticle({
      id: "article/omitted-applicability",
      draft: {
        ...draft,
        applicability: {
          productId: draft.applicability.productId,
          productVersion: draft.applicability.productVersion,
        },
      },
      context: authorContext(),
    });
    expect(created.current.applicability).toEqual({
      productId: draft.applicability.productId,
      productVersion: draft.applicability.productVersion,
    });
    expect(created.current.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    const verified = await checks(created);
    expect(verified.evidence[0]?.applicability).toEqual(
      created.current.applicability,
    );
    const inReview = await submitForReview(verified, {
      expectedRevision: 1,
      context: reviewContext(),
    });
    expect(inReview.state).toBe("in-review");
    const approved = await published(inReview);
    expect(
      await isPublicationBoundToCurrentPolicies(approved, collection(), policy),
    ).toBe(true);
  });

  it("rejects extra nested payloads instead of retaining unbounded unsupported fields", async () => {
    await expect(
      createArticle({
        id: "article/bad",
        draft: {
          ...draft,
          content: {
            ...draft.content,
            hidden: "unsupported",
          } as ArticleDraft["content"],
        },
        context: authorContext(),
      }),
    ).rejects.toMatchObject({ field: "content" });
    await expect(
      createArticle({
        id: "article/bad",
        draft: {
          ...draft,
          applicability: {
            ...draft.applicability,
            acl: ["anonymous"],
          } as ArticleDraft["applicability"],
        },
        context: authorContext(),
      }),
    ).rejects.toMatchObject({ field: "applicability" });
    const current = await article();
    await expect(
      recordEvidence(current, {
        evidence: {
          ...submission(current),
          hidden: "unsupported",
        } as EvidenceSubmission,
        attestation,
        context: reviewContext(),
      }),
    ).rejects.toMatchObject({ field: "evidence" });
  });

  it("never carries an article-level audience override through a transition", async () => {
    const current = {
      ...(await article()),
      audience: { kind: "anonymous" },
    } as Article;
    await expect(
      reviseArticle(current, {
        expectedRevision: 1,
        draft,
        context: authorContext(),
      }),
    ).rejects.toMatchObject({ field: "article" });
  });

  it.each([
    '<script>alert("bad")</script>',
    '<Widget execute="bad" />',
    "[unsafe](javascript:alert(1))",
    "[unsafe](data:text/html,bad)",
    "[unsafe](//other.invalid/path)",
    "[unsafe](https://user:secret@other.invalid/path)",
    "[unsafe](https:\\\\other.invalid)",
    "[reference][unsafe]\n[unsafe]: javascript:alert(1)",
    "![unreviewed image](https://other.invalid/image.png)",
    "Bad\u0000content",
  ])("rejects unsupported content %s", async (body) => {
    await expect(
      createArticle({
        id: "article/bad",
        draft: { ...draft, content: { format: "markdown", text: body } },
        context: authorContext(),
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects byte overflow and executable content formats", async () => {
    await expect(
      createArticle({
        id: "article/bad",
        draft: {
          ...draft,
          content: {
            format: "markdown",
            text: "🙂".repeat(knowledgeLimits.contentBytes / 4 + 1),
          },
        },
        context: authorContext(),
      }),
    ).rejects.toMatchObject({ field: "content.text" });
    await expect(
      createArticle({
        id: "article/bad",
        draft: {
          ...draft,
          content: { format: "mdx" as "markdown", text: "{execute()}" },
        },
        context: authorContext(),
      }),
    ).rejects.toMatchObject({ field: "content.format" });
  });

  it("accepts inert plain text and supported secure links without fetching them", async () => {
    const content = await createArticle({
      id: "article/secure",
      draft: {
        ...draft,
        content: {
          format: "markdown",
          text: "[Guide](https://docs.invalid/guide?x=1&y=2)\n\n[Section](#export)\n\nUse &lt;literal markup&gt;.",
        },
      },
      context: authorContext(),
    });
    expect(content.current.content.text).toContain("https://docs.invalid");
    expect(
      (
        await createArticle({
          id: "article/plain",
          draft: {
            ...draft,
            content: {
              format: "plain_text",
              text: "[This is plain text](javascript:inert)",
            },
          },
          context: authorContext(),
        })
      ).current.content.format,
    ).toBe("plain_text");
  });

  it("rejects a validation policy that removes walkthrough workflow checks", async () => {
    await expect(
      createArticle({
        id: "article/bad",
        draft,
        context: {
          ...authorContext(),
          validationPolicy: {
            ...policy,
            requirements: policy.requirements.filter(
              (item) => item.testKind !== "workflow",
            ),
          },
        },
      }),
    ).rejects.toMatchObject({ field: "validationPolicy.requirements" });
  });
});
