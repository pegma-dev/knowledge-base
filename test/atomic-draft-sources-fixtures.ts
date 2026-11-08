import type { AccessContext } from "@pegma/authorization-core";
import type {
  CreateDraftInput,
  PrivateSourceReference,
} from "@pegma/knowledge-base-application";
import { createKnowledgeBaseApplication as createPreviousApplication } from "@pegma/knowledge-base-application-previous";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  access,
  applicationFixture,
  at,
  author,
  draft,
} from "./application-fixtures.js";

export type DraftOperation = "create" | "update";
export type ApplicationFixture = ReturnType<typeof applicationFixture>;

export const sourceAuthor = access(author.principalId, [
  ...author.permissions,
  knowledgePermissions.provenanceWrite,
]);

export const firstSource: PrivateSourceReference = {
  id: "source/first",
  system: "fictional-support",
  resourceId: "ticket/first",
  version: "resolved/1",
};

export const secondSource: PrivateSourceReference = {
  ...firstSource,
  id: "source/second",
  resourceId: "ticket/second",
  version: "resolved/2",
};

/** Uses the exact published previous writer, never reconstructed storage rows. */
export async function publishedPreviousApplication(
  fixture: ApplicationFixture,
) {
  const manifest: { name?: unknown; version?: unknown } = JSON.parse(
    await readFile(
      new URL(
        "../package.json",
        import.meta.resolve("@pegma/knowledge-base-application-previous"),
      ),
      "utf8",
    ),
  );
  assert.equal(manifest.name, "@pegma/knowledge-base-application");
  assert.equal(manifest.version, "0.1.1");
  return createPreviousApplication({
    store: fixture.store,
    clock: { now: () => at() },
    privateSources: fixture.privateSources,
  });
}

/** Seeds updates through the public API; it owns no persistence or trust port. */
export async function prepareDraftCommand(
  fixture: ApplicationFixture,
  operation: DraftOperation,
  articleId = "article/atomic-sources",
): Promise<CreateDraftInput> {
  const expectedGeneration =
    operation === "create"
      ? 0
      : (await fixture.createDraft(articleId)).generation;
  return {
    ...fixture.command(`atomic-${operation}`, expectedGeneration),
    articleId,
    collectionId: "collection/workshop",
    draft: { ...draft(), title: `Atomic ${operation} with private sources` },
  };
}

export function invokeDraftCommand(
  fixture: ApplicationFixture,
  operation: DraftOperation,
  input: CreateDraftInput,
  caller: AccessContext = sourceAuthor,
) {
  return operation === "create"
    ? fixture.app.createDraft(caller, input)
    : fixture.app.updateDraft(caller, input);
}
