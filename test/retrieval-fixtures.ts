import type { ArticleDraft } from "@pegma/knowledge-base-core";
import {
  createKnowledgeBaseApplication,
  retrievalRecords,
  type KnowledgeCandidateHint,
  type KnowledgeRetrievalOptions,
  type RetrievalRecord,
} from "@pegma/knowledge-base-application";
import { knowledgePermissions } from "@pegma/knowledge-base-contracts";
import type { Store } from "@pegma/storage-core";
import {
  access,
  admin,
  applicationFixture,
  at,
  customer,
  draft,
} from "./application-fixtures.js";
import { traceStore } from "./trace-store.js";

/** Fictional approved wording and alias tags; no semantic-model quality claim. */
export const retrievalGuides: readonly {
  readonly id: string;
  readonly draft: ArticleDraft;
  readonly questions: readonly string[];
}[] = [
  {
    id: "article/export",
    draft: {
      ...draft(
        "explanation",
        "Open Workspace, choose Export, then download the CSV spreadsheet.",
      ),
      title: "Download a workspace export",
      summary: "Save your workspace data as a CSV spreadsheet.",
      tags: ["download", "export", "csv", "spreadsheet"],
    },
    questions: [
      "How can I download my data as a CSV spreadsheet?",
      "Where is workspace export?",
    ],
  },
  {
    id: "article/password",
    draft: {
      ...draft(
        "explanation",
        "Choose Forgot password on the sign-in page and follow the reset link.",
      ),
      title: "Reset a forgotten sign-in password",
      summary: "Recover access after forgetting an account password.",
      tags: ["reset", "password", "login", "sign-in", "account"],
    },
    questions: [
      "I forgot my password and cannot login",
      "How do I reset the sign in password?",
    ],
  },
  {
    id: "article/invite",
    draft: {
      ...draft(
        "explanation",
        "Open Members, choose Invite, and enter your teammate's email address.",
      ),
      title: "Invite a teammate to a workspace",
      summary: "Add a collaborator through the workspace Members screen.",
      tags: ["team", "member", "invite", "collaborator", "add"],
    },
    questions: [
      "How can I invite another team member?",
      "Add a collaborator to my workspace",
    ],
  },
];

export const unsupportedRetrievalQuestion = "interplanetary warranty quasar";

/** One UTF-8 byte is one fixture token, deliberately unrelated to model billing. */
export function countSyntheticTokens(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export const botCustomer = access(customer.principalId, [
  ...customer.permissions,
  knowledgePermissions.botRead,
]);
export const indexAdministrator = access(admin.principalId, [
  ...admin.permissions,
  knowledgePermissions.indexManage,
]);
export const retrievalApplicability = draft().applicability;

/** Actual authoring and index services share one real Store and scripted host facts. */
export function retrievalFixture(
  backing: Store,
  options: KnowledgeRetrievalOptions = {},
) {
  const traced = traceStore(backing);
  const authoring = applicationFixture(traced.store);
  const app = createKnowledgeBaseApplication({
    store: traced.store,
    clock: { now: () => at(600_000) },
    evidenceVerifier: { verify: authoring.verify },
    privateSources: authoring.privateSources,
    retrieval: {
      tokenCounter: { count: countSyntheticTokens },
      ...options,
    },
  });
  async function repair(articleId: string) {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const status = await app.repairArticleIndex(indexAdministrator, {
        articleId,
      });
      if (status.status !== "pending") return status;
    }
    throw new Error(
      "Synthetic projection did not settle within 16 bounded calls",
    );
  }
  async function publishGuide(
    guide = retrievalGuides[0]!,
    collectionId = "collection/workshop",
  ) {
    const published = await authoring.publishedArticle(
      guide.id,
      collectionId,
      guide.draft,
    );
    const status = await repair(guide.id);
    if (status.status !== "ready" || !status.indexed)
      throw new Error(
        `Synthetic guide indexing was ${status.status}, indexed=${status.indexed}`,
      );
    return published;
  }
  async function corpus() {
    await authoring.setupCollection();
    for (const guide of retrievalGuides) await publishGuide(guide);
  }
  return {
    ...authoring,
    authoringApp: authoring.app,
    app,
    traced,
    repair,
    publishGuide,
    corpus,
    clearObservations() {
      traced.reads.length = 0;
      traced.enumerations.length = 0;
      traced.transactions.length = 0;
    },
    portalInput(query = "export") {
      return {
        collectionId: "collection/workshop",
        query,
        applicability: retrievalApplicability,
      };
    },
    botInput(query = "export") {
      return {
        collectionIds: ["collection/workshop"],
        query,
        applicability: retrievalApplicability,
      };
    },
  };
}

/** Offline fixture inspection of derived hints; never used in a request handler. */
export async function allRetrievalRows(
  store: Store,
): Promise<RetrievalRecord[]> {
  const records = store.collection(retrievalRecords);
  const rows: RetrievalRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 16; page += 1) {
    const result = await records.scan({
      limit: 1_000,
      ...(cursor === undefined ? {} : { cursor }),
    });
    rows.push(...result.records.map((record) => record.value));
    if (result.nextCursor === null)
      return rows.sort((left, right) =>
        `${left.partition}/${left.id}`.localeCompare(
          `${right.partition}/${right.id}`,
        ),
      );
    cursor = result.nextCursor;
  }
  throw new Error(
    "Synthetic retrieval snapshot exceeded 16 bounded scan pages",
  );
}

export async function realBotHint(
  store: Store,
): Promise<KnowledgeCandidateHint> {
  const hint = (await realBotHints(store))[0];
  if (hint !== undefined) return hint;
  throw new Error("Synthetic guide has no maintained bot posting hint");
}

export async function realBotHints(
  store: Store,
): Promise<readonly KnowledgeCandidateHint[]> {
  const hints = new Map<string, KnowledgeCandidateHint>();
  for (const row of await allRetrievalRows(store)) {
    if (row.kind !== "page") continue;
    const page = row.data as {
      readonly entries: readonly {
        readonly hint: KnowledgeCandidateHint;
        readonly projectionGeneration: number;
      }[];
    };
    for (const entry of page.entries)
      if (entry.hint.use === "bot") hints.set(entry.hint.articleId, entry.hint);
  }
  return [...hints.values()];
}
