import type {
  CreateDraftInput,
  KnowledgeRecord,
  PrivateSourceReference,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import { describe, expect, it } from "vitest";
import {
  access,
  admin,
  applicationFixture,
  author,
  customer,
} from "../test/application-fixtures.js";
import {
  allKnowledgeRows,
  storeFactories,
} from "../test/application-stores.js";
import {
  firstSource,
  invokeDraftCommand,
  prepareDraftCommand,
  publishedPreviousApplication,
  secondSource,
  sourceAuthor,
} from "../test/atomic-draft-sources-fixtures.js";
import { barrier, traceStore } from "../test/trace-store.js";

const operations = ["create", "update"] as const;
const prerequisite = { name: "KnowledgeBasePrerequisiteError" };
const conflict = { name: "RepositoryConflictError" };

function articleRows(rows: readonly KnowledgeRecord[], articleId: string) {
  return rows.filter(
    (row) => row.resourceKind === "article" && row.resourceId === articleId,
  );
}

for (const [name, createStore] of storeFactories) {
  describe(`Atomic draft content and private sources (${name})`, () => {
    it.each(operations)(
      "makes %s content and its new source snapshot observable in one transaction",
      async (operation) => {
        const backing = await createStore();
        const traced = traceStore(backing);
        const f = applicationFixture(traced.store);
        await f.setupCollection();
        const input = {
          ...(await prepareDraftCommand(f, operation)),
          sourceReferences: [firstSource, secondSource],
        };
        const before = await allKnowledgeRows(backing);
        const observations: KnowledgeRecord[][] = [];
        traced.transactions.length = 0;
        f.privateSources.canRead.mockClear();
        traced.intercept(async (_trace, commit) => {
          observations.push(await allKnowledgeRows(backing));
          if (operation === "create") {
            expect(articleRows(observations[0]!, input.articleId)).toHaveLength(
              0,
            );
            for (const reference of input.sourceReferences)
              expect(f.privateSources.canRead).toHaveBeenCalledWith({
                access: sourceAuthor,
                articleId: input.articleId,
                reference,
              });
          }
          const outcome = await commit();
          observations.push(await allKnowledgeRows(backing));
          return outcome;
        });
        const accepted = await invokeDraftCommand(f, operation, input);
        traced.intercept(undefined);
        expect(traced.transactions).toHaveLength(1);
        expect(traced.transactions[0]).toMatchObject({
          collection: "knowledge-base.records.v1",
          partition: expect.stringMatching(/^article:[a-f0-9]{64}$/u),
        });
        expect(observations[0]).toEqual(before);
        const after = await allKnowledgeRows(backing);
        expect(observations[1]).toEqual(after);
        const priorIds = new Set(
          articleRows(before, input.articleId).map((row) => row.id),
        );
        const additions = articleRows(after, input.articleId).filter(
          (row) => !priorIds.has(row.id),
        );
        expect(additions.map((row) => row.kind).sort()).toEqual(
          operation === "create"
            ? ["audit", "command", "head", "job", "provenance", "revision"]
            : ["audit", "command", "job", "provenance", "revision"],
        );
        const current = await f.app.getDraft(admin, {
          articleId: input.articleId,
        });
        const provenance = await f.app.getProvenance(admin, {
          articleId: input.articleId,
        });
        expect(current).toMatchObject({
          generation: input.expectedGeneration + 1,
          revision: { title: input.draft.title },
        });
        expect(provenance).toMatchObject({
          generation: current.generation,
          snapshot: {
            generation: operation === "create" ? 1 : 2,
            references: input.sourceReferences,
            hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
        });
        expect(accepted.value).toMatchObject({
          generation: current.generation,
          contentHash: current.revision.contentHash,
        });
        for (const reference of input.sourceReferences)
          expect(f.privateSources.canRead).toHaveBeenCalledWith({
            access: sourceAuthor,
            articleId: input.articleId,
            reference,
          });
        expect(f.privateSources.isCurrent).not.toHaveBeenCalled();
        expect(f.privateSources.canPublish).not.toHaveBeenCalled();
      },
    );

    it.each(operations)(
      "leaves no losing %s revision or provenance after a real competing transaction wins",
      async (operation) => {
        const backing = await createStore();
        const winner = applicationFixture(backing);
        await winner.setupCollection();
        const original = await prepareDraftCommand(winner, operation);
        const traced = traceStore(backing);
        const loser = applicationFixture(traced.store);
        const losingInput = {
          ...original,
          sourceReferences: [firstSource],
        };
        const gate = barrier();
        let refusedTransactions = 0;
        traced.intercept(async (_trace, commit) => {
          await gate.wait();
          const outcome = await commit();
          if (!outcome.committed) refusedTransactions += 1;
          return outcome;
        });
        const pending = invokeDraftCommand(loser, operation, losingInput).then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        let committedRows: KnowledgeRecord[] | undefined;
        try {
          await Promise.race([
            gate.reached,
            pending.then(() => {
              throw new Error("Draft did not reach its transaction barrier");
            }),
          ]);
          await invokeDraftCommand(winner, operation, {
            ...original,
            ...winner.command("winning-draft", original.expectedGeneration),
            draft: { ...original.draft, title: "Winning content and sources" },
            sourceReferences: [secondSource],
          });
          committedRows = await allKnowledgeRows(backing);
        } finally {
          gate.release();
        }
        expect(await pending).toMatchObject({ error: conflict });
        traced.intercept(undefined);
        expect(refusedTransactions).toBe(1);
        expect(await allKnowledgeRows(backing)).toEqual(committedRows);
        expect(
          await winner.app.getProvenance(admin, {
            articleId: original.articleId,
          }),
        ).toMatchObject({ snapshot: { references: [secondSource] } });
        expect(
          await winner.app.getDraft(admin, { articleId: original.articleId }),
        ).toMatchObject({ revision: { title: "Winning content and sources" } });
      },
    );

    it("keeps omitted sources compatible with legacy authority and exact replay fingerprints", async () => {
      const backing = await createStore();
      const f = applicationFixture(backing);
      await f.setupCollection();
      const withoutSources = applicationFixture(backing, {
        missingPrivateSources: true,
      });
      const create = await prepareDraftCommand(withoutSources, "create");
      const created = await invokeDraftCommand(
        withoutSources,
        "create",
        create,
        author,
      );
      let current = await f.app.getDraft(author, {
        articleId: create.articleId,
      });
      expect(
        await withoutSources.app.getProvenance(admin, {
          articleId: create.articleId,
        }),
      ).toMatchObject({ snapshot: { generation: 1, references: [] } });
      current = await f.setSources(current, [firstSource]);
      const originalSources = await f.app.getProvenance(admin, {
        articleId: create.articleId,
      });
      const update = {
        ...create,
        ...f.command("legacy-update", current.generation),
        draft: { ...create.draft, title: "Legacy source-preserving edit" },
      };
      const updated = await invokeDraftCommand(
        withoutSources,
        "update",
        update,
        author,
      );
      expect(
        (await f.app.getProvenance(admin, { articleId: create.articleId }))
          .snapshot,
      ).toEqual(originalSources.snapshot);
      f.trust.canReadSource = false;
      const beforeReplay = await allKnowledgeRows(backing);
      for (const [operation, input, accepted] of [
        ["create", create, created],
        ["update", update, updated],
      ] as const) {
        expect(
          await invokeDraftCommand(withoutSources, operation, input, author),
        ).toEqual({ value: accepted.value, replayed: true });
        await expect(
          invokeDraftCommand(f, operation, {
            ...input,
            sourceReferences: [],
          }),
        ).rejects.toMatchObject(conflict);
      }
      expect(await allKnowledgeRows(backing)).toEqual(beforeReplay);
      // Empty supplied snapshots still require both permissions, but need no
      // external source verifier even when replacing a nonempty snapshot.
      current = await withoutSources.app.getDraft(author, {
        articleId: create.articleId,
      });
      await withoutSources.app.updateDraft(sourceAuthor, {
        ...update,
        ...f.command("clear-without-verifier", current.generation),
        sourceReferences: [],
      });
      expect(
        await withoutSources.app.getProvenance(admin, {
          articleId: create.articleId,
        }),
      ).toMatchObject({
        snapshot: {
          generation: originalSources.snapshot.generation + 1,
          references: [],
        },
      });
    });

    it.each(operations)(
      "requires draft-write and provenance-write together for supplied %s sources, including an empty list",
      async (operation) => {
        const f = applicationFixture(await createStore());
        await f.setupCollection();
        for (const references of [[], [firstSource]]) {
          for (const permissions of [
            [],
            [knowledgePermissions.draftWrite],
            [knowledgePermissions.provenanceWrite],
            [
              knowledgePermissions.draftWrite,
              knowledgePermissions.provenanceWrite,
            ],
          ]) {
            const input = {
              ...(await prepareDraftCommand(
                f,
                operation,
                `article/permissions-${references.length}-${permissions.join("-") || "none"}`,
              )),
              sourceReferences: references,
            };
            const caller = access(author.principalId, permissions);
            const before = await allKnowledgeRows(f.store);
            if (permissions.length === 2) {
              await invokeDraftCommand(f, operation, input, caller);
              expect(
                await f.app.getProvenance(admin, {
                  articleId: input.articleId,
                }),
              ).toMatchObject({ snapshot: { references } });
            } else {
              await expect(
                invokeDraftCommand(f, operation, input, caller),
              ).rejects.toMatchObject({
                name: "KnowledgeBaseAuthorizationError",
                permission: permissions.includes(
                  knowledgePermissions.draftWrite,
                )
                  ? knowledgePermissions.provenanceWrite
                  : knowledgePermissions.draftWrite,
              });
              expect(await allKnowledgeRows(f.store)).toEqual(before);
            }
          }
        }
      },
    );

    it.each(["missing", "throwing", "denied"] as const)(
      "fails closed before either draft write when source authorization is %s",
      async (defect) => {
        const backing = await createStore();
        const traced = traceStore(backing);
        const f = applicationFixture(traced.store);
        await f.setupCollection();
        for (const operation of operations) {
          const input = {
            ...(await prepareDraftCommand(
              f,
              operation,
              `article/${defect}-${operation}`,
            )),
            sourceReferences: [firstSource],
          };
          const writer =
            defect === "missing"
              ? applicationFixture(traced.store, {
                  missingPrivateSources: true,
                })
              : f;
          if (defect === "throwing")
            f.privateSources.canRead.mockRejectedValue(
              new Error("Source port unavailable"),
            );
          if (defect === "denied") f.trust.canReadSource = false;
          traced.transactions.length = 0;
          const before = await allKnowledgeRows(backing);
          await expect(
            invokeDraftCommand(writer, operation, input),
          ).rejects.toMatchObject({
            ...prerequisite,
            prerequisite:
              defect === "missing"
                ? "private-source-verifier"
                : "source-access",
          });
          expect(traced.transactions).toHaveLength(0);
          expect(await allKnowledgeRows(backing)).toEqual(before);
        }
      },
    );

    it.each(operations)(
      "rechecks current permissions and source access before replaying an accepted %s",
      async (operation) => {
        const backing = await createStore();
        const f = applicationFixture(backing);
        await f.setupCollection();
        for (const sourceReferences of [[], [firstSource]]) {
          const input = {
            ...(await prepareDraftCommand(
              f,
              operation,
              `article/replay-${sourceReferences.length}`,
            )),
            sourceReferences,
          };
          const accepted = await invokeDraftCommand(f, operation, input);
          const before = await allKnowledgeRows(backing);
          for (const permission of [
            knowledgePermissions.draftWrite,
            knowledgePermissions.provenanceWrite,
          ]) {
            const revoked = access(
              sourceAuthor.principalId,
              sourceAuthor.permissions.filter((value) => value !== permission),
            );
            await expect(
              invokeDraftCommand(f, operation, input, revoked),
            ).rejects.toMatchObject({
              name: "KnowledgeBaseAuthorizationError",
              permission,
            });
          }
          if (sourceReferences.length > 0) {
            f.trust.canReadSource = false;
            await expect(
              invokeDraftCommand(f, operation, input),
            ).rejects.toMatchObject({
              ...prerequisite,
              prerequisite: "source-access",
            });
            f.trust.canReadSource = true;
            f.privateSources.canRead.mockImplementationOnce(async () => {
              f.trust.canReadSource = false;
              return true;
            });
            await expect(
              invokeDraftCommand(f, operation, input),
            ).rejects.toMatchObject({
              ...prerequisite,
              prerequisite: "source-access",
            });
            f.trust.canReadSource = true;
            await expect(
              invokeDraftCommand(f, operation, {
                ...input,
                sourceReferences: [secondSource],
              }),
            ).rejects.toMatchObject(conflict);
          }
          expect(await invokeDraftCommand(f, operation, input)).toEqual({
            value: accepted.value,
            replayed: true,
          });
          expect(await allKnowledgeRows(backing)).toEqual(before);
        }
      },
    );

    it.each(operations)(
      "withdraws source access between a refused %s CAS and its retry without writing",
      async (operation) => {
        const backing = await createStore();
        const traced = traceStore(backing);
        const f = applicationFixture(traced.store);
        await f.setupCollection();
        const input = {
          ...(await prepareDraftCommand(f, operation)),
          sourceReferences: [firstSource],
        };
        const before = await allKnowledgeRows(backing);
        f.privateSources.canRead.mockClear();
        traced.transactions.length = 0;
        traced.intercept(async () => {
          f.trust.canReadSource = false;
          return { committed: false, reason: "changed" };
        });
        await expect(
          invokeDraftCommand(f, operation, input),
        ).rejects.toMatchObject({
          ...prerequisite,
          prerequisite: "source-access",
        });
        traced.intercept(undefined);
        expect(traced.transactions).toHaveLength(1);
        expect(f.privateSources.canRead).toHaveBeenCalledTimes(2);
        expect(await allKnowledgeRows(backing)).toEqual(before);
      },
    );

    it.each(operations)(
      "retains ordered opaque namespace sources for exact %s replay and snapshots supplied new mutations",
      async (operation) => {
        const backing = await createStore();
        const f = applicationFixture(backing);
        await f.setupCollection();
        const references: readonly PrivateSourceReference[] = [
          {
            ...firstSource,
            id: "source:first",
            system: "support:desk",
            resourceId: "ticket:123",
            version: "resolved:1",
          },
          {
            ...secondSource,
            id: "source:second",
            system: "pegma:support",
            resourceId: "urn:pegma:ticket:456",
            version: "version:2",
          },
        ];
        const input = {
          ...(await prepareDraftCommand(f, operation)),
          sourceReferences: references,
        };
        const accepted = await invokeDraftCommand(f, operation, input);
        const original = await f.app.getProvenance(admin, {
          articleId: input.articleId,
        });
        expect(original.snapshot.references).toEqual(references);
        for (const reference of references)
          expect(f.privateSources.canRead).toHaveBeenCalledWith({
            access: sourceAuthor,
            articleId: input.articleId,
            reference,
          });
        const committedRows = await allKnowledgeRows(backing);
        await expect(
          invokeDraftCommand(f, operation, {
            ...input,
            sourceReferences: [...references].reverse(),
          }),
        ).rejects.toMatchObject(conflict);
        expect(await allKnowledgeRows(backing)).toEqual(committedRows);
        expect(await invokeDraftCommand(f, operation, input)).toEqual({
          value: accepted.value,
          replayed: true,
        });
        expect(await allKnowledgeRows(backing)).toEqual(committedRows);
        expect(
          (await f.app.getProvenance(admin, { articleId: input.articleId }))
            .snapshot,
        ).toEqual(original.snapshot);

        const next = {
          ...input,
          ...f.command("same-sources-new-content", accepted.value.generation),
          draft: {
            ...input.draft,
            title: "New draft retaining ordered sources",
          },
        };
        const updated = await f.app.updateDraft(sourceAuthor, next);
        const supplied = await f.app.getProvenance(admin, {
          articleId: input.articleId,
        });
        expect(supplied.snapshot).toMatchObject({
          generation: original.snapshot.generation + 1,
          references,
        });
        expect(supplied.snapshot.hash).not.toBe(original.snapshot.hash);
        const beforeReplay = await allKnowledgeRows(backing);
        expect(await f.app.updateDraft(sourceAuthor, next)).toEqual({
          value: updated.value,
          replayed: true,
        });
        expect(await allKnowledgeRows(backing)).toEqual(beforeReplay);

        const { sourceReferences: _references, ...omitted } = next;
        await f.app.updateDraft(author, {
          ...omitted,
          ...f.command("same-sources-omitted", updated.value.generation),
        });
        expect(
          (await f.app.getProvenance(admin, { articleId: input.articleId }))
            .snapshot,
        ).toEqual(supplied.snapshot);
      },
    );

    it.each(["unknown outcome", "postcommit source withdrawal"] as const)(
      "recovers an atomic accepted command after %s without duplicating retained work",
      async (failure) => {
        const backing = await createStore();
        const traced = traceStore(backing);
        const f = applicationFixture(traced.store);
        await f.setupCollection();
        for (const operation of operations) {
          const input = {
            ...(await prepareDraftCommand(
              f,
              operation,
              `article/recovery-${operation}`,
            )),
            sourceReferences: [firstSource],
          };
          traced.transactions.length = 0;
          traced.intercept(async (_trace, commit) => {
            const outcome = await commit();
            if (!outcome.committed)
              throw new Error("Expected the real transaction to commit");
            if (failure === "unknown outcome")
              throw new Error(
                "Synthetic transport lost the accepted acknowledgement",
              );
            f.trust.canReadSource = false;
            return outcome;
          });
          await expect(
            invokeDraftCommand(f, operation, input),
          ).rejects.toMatchObject(
            failure === "unknown outcome"
              ? {
                  message:
                    "Synthetic transport lost the accepted acknowledgement",
                }
              : { ...prerequisite, prerequisite: "source-access" },
          );
          traced.intercept(undefined);
          f.trust.canReadSource = true;
          const committed = await allKnowledgeRows(backing);
          expect(
            await f.app.getDraft(admin, { articleId: input.articleId }),
          ).toMatchObject({ revision: { title: input.draft.title } });
          expect(
            await f.app.getProvenance(admin, { articleId: input.articleId }),
          ).toMatchObject({ snapshot: { references: [firstSource] } });
          const replayed = await invokeDraftCommand(f, operation, input);
          expect(replayed.replayed).toBe(true);
          expect(replayed.value.generation).toBe(input.expectedGeneration + 1);
          expect(Object.keys(replayed.value).sort()).toEqual([
            "articleRevision",
            "contentHash",
            "generation",
            "id",
            "state",
          ]);
          expect(await allKnowledgeRows(backing)).toEqual(committed);
          expect(traced.transactions).toHaveLength(1);
          const rows = articleRows(committed, input.articleId);
          for (const kind of [
            "audit",
            "command",
            "job",
            "provenance",
            "revision",
          ])
            expect(rows.filter((row) => row.kind === kind)).toHaveLength(
              operation === "create" ? 1 : 2,
            );
        }
      },
    );

    it("rejects malformed, excessive, duplicate, and URL source references before either draft can mutate", async () => {
      const backing = await createStore();
      const traced = traceStore(backing);
      const f = applicationFixture(traced.store);
      await f.setupCollection();
      const { version: _version, ...missingVersion } = firstSource;
      const invalidReferences: readonly (readonly [unknown, string])[] = [
        [null, "TypeError"],
        ["ticket:123", "TypeError"],
        [{ reference: firstSource }, "TypeError"],
        [undefined, "TypeError"],
        [[null], "TypeError"],
        [[missingVersion], "TypeError"],
        [
          [{ ...firstSource, body: "Source content is forbidden" }],
          "TypeError",
        ],
        [[{ ...firstSource, version: "v".repeat(201) }], "TypeError"],
        [[{ ...firstSource, resourceId: "ticket/\u0000" }], "TypeError"],
        [[{ ...firstSource, id: "source/\ud800" }], "TypeError"],
        [
          [firstSource, { ...firstSource, resourceId: "ticket/duplicate-id" }],
          "TypeError",
        ],
        [
          Array.from({ length: 33 }, (_, ordinal) => ({
            ...firstSource,
            id: `source/${ordinal}`,
          })),
          "RepositoryCapacityError",
        ],
        ...["id", "system", "resourceId", "version"].map(
          (field) =>
            [
              [
                {
                  ...firstSource,
                  [field]: "https://fictional.invalid/private",
                },
              ],
              "TypeError",
            ] as const,
        ),
        ...[
          "//fictional.invalid/private",
          "https:/fictional.invalid/private",
          "data:text/plain,private",
          "HtTpS:fictional.invalid/private",
        ].map(
          (resourceId) =>
            [[{ ...firstSource, resourceId }], "TypeError"] as const,
        ),
      ];
      for (const operation of operations) {
        const input = await prepareDraftCommand(
          f,
          operation,
          `article/invalid-${operation}`,
        );
        const before = await allKnowledgeRows(backing);
        traced.transactions.length = 0;
        for (const [references, errorName] of invalidReferences) {
          // Exercise malformed runtime inputs beyond the static declarations.
          const malformed = {
            ...input,
            sourceReferences: references as readonly PrivateSourceReference[],
          } satisfies CreateDraftInput;
          await expect(
            invokeDraftCommand(f, operation, malformed),
          ).rejects.toMatchObject({ name: errorName });
        }
        expect(traced.transactions).toHaveLength(0);
        expect(await allKnowledgeRows(backing)).toEqual(before);
      }
    });

    it("reviews and publishes actual 0.1.1 source snapshots under current source gates without admitting new URL-like writes", async () => {
      const backing = await createStore();
      const f = applicationFixture(backing);
      await f.setupCollection();
      const previous = await publishedPreviousApplication(f);
      const input = await prepareDraftCommand(f, "create");
      const created = await previous.createDraft(author, input);
      const historicalReferences = [
        { ...firstSource, resourceId: "git:issue/1" },
        { ...secondSource, resourceId: "data:row42" },
      ];
      await previous.setProvenance(admin, {
        ...f.command("previous-release-sources", created.value.generation),
        articleId: input.articleId,
        references: historicalReferences,
      });
      const historical = await previous.getProvenance(admin, {
        articleId: input.articleId,
      });
      expect(historical.snapshot.references).toEqual(historicalReferences);
      expect(
        await f.app.getProvenance(admin, { articleId: input.articleId }),
      ).toEqual(historical);
      let current = await f.app.getDraft(author, {
        articleId: input.articleId,
      });
      current = (await f.submitEvidence(current)).current;
      const beforeReview = await allKnowledgeRows(backing);
      for (const gate of ["sourceCurrent", "canPublishSource"] as const) {
        f.trust[gate] = false;
        await expect(f.review(current)).rejects.toMatchObject(prerequisite);
        f.trust[gate] = true;
        expect(await allKnowledgeRows(backing)).toEqual(beforeReview);
      }
      const reviewed = await f.review(current);
      expect(reviewed.review).toMatchObject({
        sourceGeneration: historical.snapshot.generation,
        sourceSnapshotHash: historical.snapshot.hash,
      });
      const publish = {
        ...f.command("publish-previous-release-sources", reviewed.generation),
        articleId: input.articleId,
        review: reviewed.review,
      };
      const beforePublish = await allKnowledgeRows(backing);
      for (const gate of ["sourceCurrent", "canPublishSource"] as const) {
        f.trust[gate] = false;
        await expect(
          f.app.publishArticle(admin, publish),
        ).rejects.toMatchObject(prerequisite);
        f.trust[gate] = true;
        expect(await allKnowledgeRows(backing)).toEqual(beforePublish);
      }
      const published = await f.app.publishArticle(admin, publish);
      const publishedSources = await f.app.getProvenance(admin, {
        articleId: input.articleId,
      });
      expect(publishedSources.snapshot).toEqual(historical.snapshot);
      expect(publishedSources.publishedSnapshot).toEqual(historical.snapshot);
      const approved = await f.app.getPublishedArticle(customer, {
        articleId: input.articleId,
      });
      for (const gate of ["sourceCurrent", "canPublishSource"] as const) {
        f.trust[gate] = false;
        await expect(
          f.app.getPublishedArticle(customer, { articleId: input.articleId }),
        ).rejects.toMatchObject({ name: "KnowledgeBaseNotFoundError" });
        f.trust[gate] = true;
      }
      expect(
        await f.app.getPublishedArticle(customer, {
          articleId: input.articleId,
        }),
      ).toEqual(approved);

      const beforeRejectedWrites = await allKnowledgeRows(backing);
      for (const reference of historicalReferences) {
        const sourceReferences = [reference];
        await expect(
          f.app.createDraft(sourceAuthor, {
            ...input,
            ...f.command("reject-new-url-source-create", 0),
            articleId: "article/rejected-new-url-source",
            sourceReferences,
          }),
        ).rejects.toMatchObject({ name: "TypeError" });
        await expect(
          f.app.updateDraft(sourceAuthor, {
            ...input,
            ...f.command(
              "reject-new-url-source-update",
              published.value.generation,
            ),
            sourceReferences,
          }),
        ).rejects.toMatchObject({ name: "TypeError" });
        await expect(
          f.app.setProvenance(admin, {
            ...f.command(
              "reject-new-url-source-provenance",
              published.value.generation,
            ),
            articleId: input.articleId,
            references: sourceReferences,
          }),
        ).rejects.toMatchObject({ name: "TypeError" });
      }
      expect(await allKnowledgeRows(backing)).toEqual(beforeRejectedWrites);
    });

    it("accepts readable draft sources independently of publication eligibility and preserves the old publication snapshot", async () => {
      const f = applicationFixture(await createStore());
      await f.setupCollection();
      f.trust.sourceCurrent = false;
      f.trust.canPublishSource = false;
      const input = {
        ...(await prepareDraftCommand(f, "create")),
        sourceReferences: [firstSource],
      };
      await invokeDraftCommand(f, "create", input);
      expect(f.privateSources.isCurrent).not.toHaveBeenCalled();
      expect(f.privateSources.canPublish).not.toHaveBeenCalled();
      let current = await f.app.getDraft(author, {
        articleId: input.articleId,
      });
      current = (await f.submitEvidence(current)).current;
      const beforeReview = await allKnowledgeRows(f.store);
      await expect(f.review(current)).rejects.toMatchObject(prerequisite);
      expect(await allKnowledgeRows(f.store)).toEqual(beforeReview);
      f.trust.sourceCurrent = true;
      f.trust.canPublishSource = true;
      const reviewed = await f.review(current);
      const publish = {
        ...f.command("publish-after-source-approval", reviewed.generation),
        articleId: input.articleId,
        review: reviewed.review,
      };
      f.trust.canPublishSource = false;
      const beforePublish = await allKnowledgeRows(f.store);
      await expect(f.app.publishArticle(admin, publish)).rejects.toMatchObject(
        prerequisite,
      );
      expect(await allKnowledgeRows(f.store)).toEqual(beforePublish);
      f.trust.canPublishSource = true;
      await f.app.publishArticle(admin, publish);
      const published = await f.app.getPublishedArticle(customer, {
        articleId: input.articleId,
      });
      const oldSources = await f.app.getProvenance(admin, {
        articleId: input.articleId,
      });
      expect(oldSources.publishedSnapshot).toEqual(oldSources.snapshot);
      current = await f.app.getDraft(author, { articleId: input.articleId });
      f.trust.sourceCurrent = false;
      f.trust.canPublishSource = false;
      f.privateSources.isCurrent.mockClear();
      f.privateSources.canPublish.mockClear();
      await f.app.updateDraft(sourceAuthor, {
        ...f.command("new-draft-with-new-source", current.generation),
        articleId: input.articleId,
        collectionId: input.collectionId,
        draft: { ...input.draft, title: "Unapproved second-source draft" },
        sourceReferences: [secondSource],
      });
      expect(f.privateSources.isCurrent).not.toHaveBeenCalled();
      expect(f.privateSources.canPublish).not.toHaveBeenCalled();
      const updatedSources = await f.app.getProvenance(admin, {
        articleId: input.articleId,
      });
      expect(updatedSources.snapshot).toMatchObject({
        generation: oldSources.snapshot.generation + 1,
        references: [secondSource],
      });
      expect(updatedSources.publishedSnapshot).toEqual(
        oldSources.publishedSnapshot,
      );
      f.privateSources.isCurrent.mockImplementation(async ({ snapshot }) =>
        snapshot.references.every(
          (reference) => reference.id === firstSource.id,
        ),
      );
      f.privateSources.canPublish.mockImplementation(async ({ snapshot }) =>
        snapshot.references.every(
          (reference) => reference.id === firstSource.id,
        ),
      );
      expect(
        await f.app.getPublishedArticle(customer, {
          articleId: input.articleId,
        }),
      ).toEqual(published);
      expect(f.privateSources.isCurrent).toHaveBeenLastCalledWith(
        expect.objectContaining({ snapshot: oldSources.publishedSnapshot }),
      );
      current = await f.app.getDraft(author, { articleId: input.articleId });
      current = (await f.submitEvidence(current)).current;
      await expect(f.review(current)).rejects.toMatchObject(prerequisite);
      expect(
        await f.app.getPublishedArticle(customer, {
          articleId: input.articleId,
        }),
      ).toEqual(published);
    });
  });
}
