import type { AccessContext } from "@pegma/authorization-core";
import type {
  CreateDraftInput,
  PrivateSourceReference,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import {
  access,
  applicationFixture,
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
