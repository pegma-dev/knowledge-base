import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import { knowledgeLimits } from "@pegma/knowledge-base-core";
import {
  createKnowledgeBaseApplication,
  type PrivateSourceReference,
  type PrivateSourcesVerifier,
  type SourceEligibilityRequest,
} from "@pegma/knowledge-base-application";
import { describe, expect, it, vi } from "vitest";
import {
  access,
  admin,
  at,
  applicationFixture,
  author,
  customer,
  draft,
  evidence,
  outsider,
  validationPolicy,
} from "../test/application-fixtures.js";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";

const source: PrivateSourceReference = {
  id: "source/private",
  system: "synthetic-support",
  resourceId: "PRIVATE_SOURCE_TICKET_7",
  version: "resolution-2",
};
const missing = { name: "KnowledgeBaseNotFoundError" };
const conflict = { name: "RepositoryConflictError" };

for (const [name, createStore] of storeFactories) {
  describe(`authorized KB application public entries (${name})`, () => {
    it("refuses collection management for a published-content reader", async () => {
      const f = applicationFixture(createStore());
      await expect(
        f.app.createCollection(customer, {
          ...f.command("denied", 0),
          collectionId: "collection/workshop",
          name: "Workshop guides",
        }),
      ).rejects.toMatchObject({
        permission: knowledgePermissions.collectionManage,
      });
    });

    it("lets authors inspect safe active validation requirements before creating a draft", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      const requirements = await f.app.getValidationRequirements(author, {
        collectionId: "collection/workshop",
        kind: "walkthrough",
      });
      expect(requirements.validationPolicy).toEqual({
        id: validationPolicy.id,
        version: 1,
      });
      expect(requirements.expectedStagingBuildId).toBe("staging-42");
      expect(requirements.checks.map((check) => check.id).sort()).toEqual([
        "walkthrough-content",
        "walkthrough-workflow",
      ]);
      for (const secret of [
        "trustedRunnerIds",
        "trustedAttesterIds",
        "runner/staging",
        "staff/verifier",
      ])
        expect(JSON.stringify(requirements)).not.toContain(secret);
      await expect(
        f.app.getValidationRequirements(customer, {
          collectionId: "collection/workshop",
          kind: "explanation",
        }),
      ).rejects.toMatchObject({ name: "KnowledgeBaseAuthorizationError" });
    });

    it("keeps author, reviewer, and private-read authority separate", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      let current = await f.createDraft();
      current = (await f.submitEvidence(current)).current;
      const reviewed = await f.review(current);
      const noPublish = access(author.principalId, [
        ...author.permissions,
        knowledgePermissions.review,
      ]);
      await expect(
        f.app.publishArticle(noPublish, {
          ...f.command("denied-publish", reviewed.generation),
          articleId: current.articleId,
          review: reviewed.review,
        }),
      ).rejects.toMatchObject({ permission: knowledgePermissions.publish });
      for (const [read, permission] of [
        [f.app.getDraft, knowledgePermissions.draftRead],
        [f.app.getEvidence, knowledgePermissions.evidenceRead],
        [f.app.getProvenance, knowledgePermissions.provenanceRead],
      ] as const) {
        await expect(
          read(customer, { articleId: current.articleId }),
        ).rejects.toMatchObject({ permission });
      }
      await expect(
        f.app.getEvidence(author, { articleId: current.articleId }),
      ).rejects.toMatchObject({
        permission: knowledgePermissions.evidenceRead,
      });
      const visible = await f.app.getDraft(author, {
        articleId: current.articleId,
      });
      expect(visible.hasPendingReview).toBe(true);
      for (const privateField of ["evidence", "review", "provenance"])
        expect(visible).not.toHaveProperty(privateField);
    });

    it("returns an explicit approved-content DTO without evidence, actors, or provenance", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      let current = await f.createDraft();
      current = await f.setSources(current, [source]);
      current = (await f.submitEvidence(current)).current;
      await f.publish(current);
      const visible = await f.app.getPublishedArticle(customer, {
        articleId: current.articleId,
      });
      expect(Object.keys(visible).sort()).toEqual([
        "applicability",
        "articleId",
        "collectionId",
        "content",
        "contentHash",
        "kind",
        "revision",
        "summary",
        "tags",
        "title",
      ]);
      for (const forbidden of [
        "PRIVATE_STAFF_EVIDENCE",
        "PRIVATE_SOURCE_TICKET_7",
        "createdBy",
        "attestation",
        "evidence",
        "reviewerId",
        "sourceSnapshot",
      ])
        expect(JSON.stringify(visible)).not.toContain(forbidden);
      expect(visible.content.text).toBe(draft().content.text);
      expect(
        (await f.app.getEvidence(admin, { articleId: current.articleId }))
          .evidence[0]?.steps[0],
      ).toContain("PRIVATE_STAFF_EVIDENCE");
      expect(
        (await f.app.getProvenance(admin, { articleId: current.articleId }))
          .snapshot.references,
      ).toEqual([source]);
    });

    it("does not expose unpublished drafts, bot-only collections, or unauthorized portal audiences", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      const unpublished = await f.createDraft("article/draft-only");
      await expect(
        f.app.getPublishedArticle(customer, {
          articleId: unpublished.articleId,
        }),
      ).rejects.toMatchObject(missing);
      await f.publishedArticle("article/published");
      await expect(
        f.app.getPublishedArticle(outsider, { articleId: "article/published" }),
      ).rejects.toMatchObject(missing);
      await f.setupCollection("collection/bot-only", false);
      await f.publishedArticle("article/bot-guide", "collection/bot-only");
      for (const caller of [customer, admin])
        await expect(
          f.app.getPublishedArticle(caller, { articleId: "article/bot-guide" }),
        ).rejects.toMatchObject(missing);
    });

    it("preserves old publication identity while a moved draft awaits review", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      let sourced = await f.createDraft();
      sourced = await f.setSources(sourced, [source]);
      sourced = (await f.submitEvidence(sourced)).current;
      await f.publish(sourced);
      const old = await f.app.getPublishedArticle(customer, {
        articleId: "article/export",
      });
      await f.setupCollection("collection/bot-only", false);
      const current = await f.app.getDraft(author, {
        articleId: old.articleId,
      });
      await f.app.updateDraft(author, {
        ...f.command("move", current.generation),
        articleId: current.articleId,
        collectionId: "collection/bot-only",
        draft: {
          ...draft(),
          title: "UNAPPROVED_NEW_TITLE",
          content: { format: "plain_text", text: "UNAPPROVED_NEW_CONTENT" },
        },
      });
      expect(
        (await f.app.getDraft(author, { articleId: current.articleId }))
          .revision.collectionId,
      ).toBe("collection/bot-only");
      expect(
        await f.app.getPublishedArticle(customer, {
          articleId: current.articleId,
        }),
      ).toEqual(old);
      expect(f.privateSources.isCurrent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          article: expect.objectContaining({
            collectionId: "collection/workshop",
            number: 1,
          }),
          snapshot: expect.objectContaining({ references: [source] }),
        }),
      );
    });

    it("isolates independently composed stores with matching resource IDs", async () => {
      const a = applicationFixture(createStore());
      const b = applicationFixture(createStore());
      await a.setupCollection();
      await a.publishedArticle();
      await expect(
        b.app.getPublishedArticle(customer, { articleId: "article/export" }),
      ).rejects.toMatchObject(missing);
      await b.setupCollection();
      await b.publishedArticle(
        "article/export",
        "collection/workshop",
        draft("explanation", "Different fictional guide."),
      );
      expect(
        (
          await a.app.getPublishedArticle(customer, {
            articleId: "article/export",
          })
        ).content.text,
      ).toBe(draft().content.text);
      expect(
        (
          await b.app.getPublishedArticle(customer, {
            articleId: "article/export",
          })
        ).content.text,
      ).toBe("Different fictional guide.");
    });

    it.each(["false", "throw", "missing"] as const)(
      "hides published content when live source publication eligibility is %s after a draft move",
      async (mode) => {
        const f = applicationFixture(createStore());
        await f.setupCollection();
        let current = await f.createDraft();
        current = await f.setSources(current, [source]);
        current = (await f.submitEvidence(current)).current;
        const publishedRevision = current.revision;
        current = (await f.publish(current)).current;
        await f.setupCollection("collection/bot-only", false);
        await f.app.updateDraft(author, {
          ...f.command("move-before-source-revocation", current.generation),
          articleId: current.articleId,
          collectionId: "collection/bot-only",
          draft: { ...draft(), title: "Unapproved moved draft" },
        });
        expect(
          (
            await f.app.getPublishedArticle(customer, {
              articleId: current.articleId,
            })
          ).revision,
        ).toBe(1);
        const canPublish = vi.fn(async (_request: SourceEligibilityRequest) => {
          if (mode === "throw")
            throw new Error("PRIVATE_SOURCE_SERVICE_FAILURE");
          return false;
        });
        // A partially configured host port must fail closed at runtime too.
        const privateSources = {
          canRead: f.privateSources.canRead,
          isCurrent: f.privateSources.isCurrent,
          ...(mode === "missing" ? {} : { canPublish }),
        } as PrivateSourcesVerifier;
        const reader = createKnowledgeBaseApplication({
          store: f.store,
          clock: { now: () => at(10_000) },
          privateSources,
        });
        const before = await allKnowledgeRows(f.store);
        await expect(
          reader.getPublishedArticle(customer, {
            articleId: current.articleId,
          }),
        ).rejects.toMatchObject({ ...missing, resource: "article" });
        expect(await allKnowledgeRows(f.store)).toEqual(before);
        if (mode !== "missing")
          expect(canPublish).toHaveBeenLastCalledWith({
            article: publishedRevision,
            snapshot: expect.objectContaining({ references: [source] }),
          });
        expect(f.trust.sourceCurrent).toBe(true);
      },
    );

    it("replays bounded acknowledgements without duplicate rows and rechecks current authority", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      const input = {
        ...f.command("create-once", 0),
        articleId: "article/replay",
        collectionId: "collection/workshop",
        draft: draft(),
      };
      const first = await f.app.createDraft(author, input);
      const before = await allKnowledgeRows(f.store);
      expect(first.replayed).toBe(false);
      expect(await f.app.createDraft(author, input)).toEqual({
        value: first.value,
        replayed: true,
      });
      await expect(
        f.app.createDraft(author, {
          ...input,
          draft: { ...draft(), title: "Changed payload" },
        }),
      ).rejects.toMatchObject(conflict);
      await expect(f.app.createDraft(admin, input)).rejects.toMatchObject(
        conflict,
      );
      await expect(
        f.app.createDraft(access(author.principalId, []), input),
      ).rejects.toMatchObject({ permission: knowledgePermissions.draftWrite });
      expect(await allKnowledgeRows(f.store)).toEqual(before);
    });

    it("fences evidence changes with application generation rather than content revision", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      const old = await f.createDraft();
      const changed = (await f.submitEvidence(old)).current;
      expect(changed.revision.number).toBe(old.revision.number);
      expect(changed.generation).toBeGreaterThan(old.generation);
      await expect(
        f.app.updateDraft(author, {
          ...f.command("stale-edit", old.generation),
          articleId: old.articleId,
          collectionId: old.revision.collectionId,
          draft: { ...draft(), title: "Stale title" },
        }),
      ).rejects.toMatchObject(conflict);
      expect(
        await f.app.getDraft(author, { articleId: old.articleId }),
      ).toEqual(changed);
    });

    it("rejects forged or rebound verifier receipts without accepted state", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      const current = await f.createDraft();
      f.setTime(3_000);
      const proof = evidence(current.revision);
      const issued = await f.issueReceipt(current, proof);
      const before = await allKnowledgeRows(f.store);
      for (const [suffix, changed, receipt] of [
        ["forged", proof, "caller-claims-passed"],
        [
          "wrong-content",
          { ...proof, contentHash: "b".repeat(64) },
          issued.receipt,
        ],
        [
          "wrong-build",
          { ...proof, stagingBuildId: "staging-wrong" },
          issued.receipt,
        ],
        [
          "wrong-runner",
          { ...proof, runnerId: "untrusted/runner" },
          issued.receipt,
        ],
      ] as const) {
        await expect(
          f.app.submitEvidence(author, {
            ...f.command(suffix, current.generation),
            articleId: current.articleId,
            evidence: changed,
            receipt,
          }),
        ).rejects.toMatchObject({
          name: expect.stringMatching(
            /^(KnowledgeBaseError|KnowledgeBasePrerequisiteError)$/u,
          ),
        });
        expect(await allKnowledgeRows(f.store)).toEqual(before);
      }
      expect(
        (await f.app.getEvidence(admin, { articleId: current.articleId }))
          .evidence,
      ).toEqual([]);
    });

    it("fails closed when evidence verification is absent or unavailable", async () => {
      const store = createStore();
      const f = applicationFixture(store, { missingEvidenceVerifier: true });
      await f.setupCollection();
      const current = await f.createDraft();
      f.setTime(3_000);
      const before = await allKnowledgeRows(store);
      await expect(
        f.app.submitEvidence(author, {
          ...f.command("missing-verifier", current.generation),
          articleId: current.articleId,
          evidence: evidence(current.revision),
          receipt: "claimed-receipt",
        }),
      ).rejects.toMatchObject({ name: "KnowledgeBasePrerequisiteError" });
      const live = applicationFixture(store);
      live.setTime(3_000);
      live.trust.verifierThrows = true;
      await expect(
        live.app.submitEvidence(author, {
          ...live.command("offline-verifier", current.generation),
          articleId: current.articleId,
          evidence: evidence(current.revision),
          receipt: "claimed-receipt",
        }),
      ).rejects.toThrow();
      expect(await allKnowledgeRows(store)).toEqual(before);
    });

    it("invalidates pending review after provenance or active governance changes", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      let current = await f.createDraft();
      current = (await f.submitEvidence(current)).current;
      const oldReview = await f.review(current);
      current = await f.app.getDraft(author, { articleId: current.articleId });
      current = await f.setSources(current, [source]);
      await expect(
        f.app.publishArticle(admin, {
          ...f.command("old-source-review", current.generation),
          articleId: current.articleId,
          review: oldReview.review,
        }),
      ).rejects.toThrow();
      expect(
        (await f.app.getDraft(author, { articleId: current.articleId }))
          .hasPublication,
      ).toBe(false);
      const newReview = await f.review(current);
      const collection = await f.app.getCollection(admin, {
        collectionId: current.revision.collectionId,
      });
      await f.app.putGovernanceConfiguration(admin, {
        ...f.command("profile-change", collection.generation),
        collectionId: collection.collection.id,
        configuration: {
          validationPolicy: { id: validationPolicy.id, version: 1 },
          expectedStagingBuildId: "staging-new",
          trustedAttesterIds: ["staff/verifier"],
        },
      });
      await expect(
        f.app.publishArticle(admin, {
          ...f.command("old-profile-review", newReview.generation),
          articleId: current.articleId,
          review: newReview.review,
        }),
      ).rejects.toThrow();
    });

    it("rechecks current collection policy and governance before published reads", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      await f.publishedArticle();
      const collectionId = "collection/workshop";
      const preview = await f.app.previewCollectionPolicy(admin, {
        collectionId,
        uses: {
          portal: { enabled: false },
          bot: {
            enabled: true,
            audience: { kind: "permission", permission: "workshop.customer" },
          },
        },
      });
      await f.app.updateCollectionPolicy(admin, {
        ...f.command("revoke-portal", preview.generation),
        collectionId,
        preview: preview.preview,
      });
      await expect(
        f.app.getPublishedArticle(customer, { articleId: "article/export" }),
      ).rejects.toMatchObject(missing);
      const other = applicationFixture(createStore());
      await other.setupCollection();
      await other.publishedArticle();
      const head = await other.app.getCollection(admin, { collectionId });
      await other.app.putGovernanceConfiguration(admin, {
        ...other.command("profile", head.generation),
        collectionId,
        configuration: {
          validationPolicy: { id: validationPolicy.id, version: 1 },
          expectedStagingBuildId: "staging-next",
          trustedAttesterIds: ["staff/verifier"],
        },
      });
      await expect(
        other.app.getPublishedArticle(customer, {
          articleId: "article/export",
        }),
      ).rejects.toMatchObject(missing);
    });

    it("requires source-resource permission and current source proof separately", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      let current = await f.createDraft();
      current = await f.setSources(current, [source]);
      current = (await f.submitEvidence(current)).current;
      f.trust.canPublishSource = false;
      const beforeReview = await allKnowledgeRows(f.store);
      await expect(f.review(current)).rejects.toMatchObject({
        name: "KnowledgeBasePrerequisiteError",
      });
      expect(await allKnowledgeRows(f.store)).toEqual(beforeReview);
      f.trust.canPublishSource = true;
      await f.publish(current);
      f.trust.canReadSource = false;
      await expect(
        f.app.getProvenance(admin, { articleId: current.articleId }),
      ).rejects.toThrow();
      expect(f.privateSources.canRead).toHaveBeenLastCalledWith(
        expect.objectContaining({
          access: expect.objectContaining({ principalId: admin.principalId }),
          articleId: current.articleId,
          reference: source,
        }),
      );
      f.trust.canReadSource = true;
      f.trust.sourceCurrent = false;
      await expect(
        f.app.getPublishedArticle(customer, { articleId: current.articleId }),
      ).rejects.toMatchObject(missing);
      const withoutVerifier = applicationFixture(f.store, {
        missingPrivateSources: true,
      });
      await expect(
        withoutVerifier.app.getPublishedArticle(customer, {
          articleId: current.articleId,
        }),
      ).rejects.toThrow();
      const latest = await withoutVerifier.app.getDraft(admin, {
        articleId: current.articleId,
      });
      const beforeWrite = await allKnowledgeRows(f.store);
      await expect(
        withoutVerifier.app.setProvenance(admin, {
          ...withoutVerifier.command(
            "missing-source-verifier",
            latest.generation,
          ),
          articleId: current.articleId,
          references: [source],
        }),
      ).rejects.toMatchObject({ name: "KnowledgeBasePrerequisiteError" });
      expect(await allKnowledgeRows(f.store)).toEqual(beforeWrite);
    });

    it("revokes a historical evidence binding, holds publication, and replays safely", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      const published = await f.publishedArticle();
      const proof = (
        await f.app.getEvidence(admin, {
          articleId: published.current.articleId,
        })
      ).evidence[0]!;
      const input = {
        ...f.command("revoke-proof", published.current.generation),
        articleId: published.current.articleId,
        articleRevision: proof.articleRevision,
        evidenceId: proof.id,
        evidenceVersion: proof.version,
        evidenceHash: proof.hash,
        reason: "Synthetic evidence withdrawal",
      };
      await f.app.revokeEvidence(admin, input);
      const before = await allKnowledgeRows(f.store);
      expect(
        (
          await f.app.getDraft(admin, {
            articleId: published.current.articleId,
          })
        ).publicationHeld,
      ).toBe(true);
      await expect(
        f.app.getPublishedArticle(customer, {
          articleId: published.current.articleId,
        }),
      ).rejects.toMatchObject(missing);
      expect((await f.app.revokeEvidence(admin, input)).replayed).toBe(true);
      expect(await allKnowledgeRows(f.store)).toEqual(before);
    });

    it("retains evidence by content revision without replacing an older publication", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      const published = await f.publishedArticle();
      const old = await f.app.getPublishedArticle(customer, {
        articleId: "article/export",
      });
      await f.app.updateDraft(author, {
        ...f.command("new-revision", published.current.generation),
        articleId: "article/export",
        collectionId: "collection/workshop",
        draft: { ...draft(), title: "New unapproved revision" },
      });
      let current = await f.app.getDraft(author, {
        articleId: "article/export",
      });
      current = (await f.submitEvidence(current)).current;
      const proof = (
        await f.app.getEvidence(admin, { articleId: current.articleId })
      ).evidence[0]!;
      expect(proof.articleRevision).toBe(2);
      expect(proof.version).toBe(1);
      expect(
        await f.app.getPublishedArticle(customer, {
          articleId: current.articleId,
        }),
      ).toEqual(old);
    });

    it("requires explicit privileged approval for public collection changes", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      const collectionId = "collection/workshop";
      const preview = await f.app.previewCollectionPolicy(admin, {
        collectionId,
        uses: {
          portal: { enabled: true, audience: { kind: "anonymous" } },
          bot: { enabled: false },
        },
      });
      const input = {
        ...f.command("public-change", preview.generation),
        collectionId,
        preview: preview.preview,
      };
      await expect(
        f.app.updateCollectionPolicy(admin, input),
      ).rejects.toThrow();
      await expect(
        f.app.updateCollectionPolicy(
          access("staff/manager", [knowledgePermissions.collectionManage]),
          { ...input, approvePublic: true },
        ),
      ).rejects.toMatchObject({
        permission: knowledgePermissions.publicCollectionApprove,
      });
      await f.app.updateCollectionPolicy(admin, {
        ...input,
        approvePublic: true,
      });
      expect(
        (await f.app.getCollection(admin, { collectionId })).collection
          .publicApproval?.reviewerId,
      ).toBe(admin.principalId);
    });

    it("rejects a stale policy preview after a governance-only generation change", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      const collectionId = "collection/workshop";
      const preview = await f.app.previewCollectionPolicy(admin, {
        collectionId,
        uses: { portal: { enabled: false }, bot: { enabled: false } },
      });
      await f.app.putGovernanceConfiguration(admin, {
        ...f.command("profile-metadata", preview.generation),
        collectionId,
        configuration: {
          validationPolicy: { id: validationPolicy.id, version: 1 },
          expectedStagingBuildId: "staging-42",
          trustedAttesterIds: ["staff/verifier"],
        },
      });
      await expect(
        f.app.updateCollectionPolicy(admin, {
          ...f.command("stale-preview", preview.generation),
          collectionId,
          preview: preview.preview,
        }),
      ).rejects.toMatchObject(conflict);
    });

    it("roundtrips maximum quote-heavy content and verification metadata", async () => {
      const f = applicationFixture(createStore());
      await f.setupCollection();
      const before = await allKnowledgeRows(f.store);
      await expect(
        f.createDraft(
          "article/too-large",
          "collection/workshop",
          draft("explanation", '"'.repeat(knowledgeLimits.contentBytes + 1)),
        ),
      ).rejects.toMatchObject({
        name: "KnowledgeBaseError",
        field: "content.text",
      });
      expect(await allKnowledgeRows(f.store)).toEqual(before);
      const body = '"'.repeat(knowledgeLimits.contentBytes);
      let current = await f.createDraft(
        "article/heavy",
        "collection/workshop",
        draft("explanation", body),
      );
      expect(current.revision.content.text).toBe(body);
      const proof = {
        ...evidence(current.revision),
        steps: Array.from({ length: knowledgeLimits.steps }, () =>
          '"'.repeat(knowledgeLimits.stepCharacters),
        ),
      };
      current = (await f.submitEvidence(current, undefined, proof)).current;
      expect(
        (await f.app.getEvidence(admin, { articleId: current.articleId }))
          .evidence[0]?.steps,
      ).toEqual(proof.steps);
      await f.publish(current);
      expect(
        (
          await f.app.getPublishedArticle(customer, {
            articleId: current.articleId,
          })
        ).content.text,
      ).toBe(body);
    }, 30_000);
  });
}
