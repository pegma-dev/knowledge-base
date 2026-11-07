import { describe, expect, it } from "vitest";
import { customer } from "../test/application-fixtures.js";
import { createD1Store } from "../test/d1.js";
import {
  botCustomer,
  indexAdministrator,
  retrievalFixture,
  retrievalGuides,
} from "../test/retrieval-fixtures.js";

describe("separate native D1 database composition", () => {
  it("isolates matching collection, article, command and principal IDs through public application calls", async () => {
    const first = retrievalFixture(await createD1Store());
    const second = retrievalFixture(await createD1Store());
    await first.setupCollection();
    await second.setupCollection();
    const firstGuide = {
      ...retrievalGuides[0]!,
      id: "article/shared-export",
      draft: {
        ...retrievalGuides[0]!.draft,
        title: "Export from the first fictional workspace",
        content: {
          format: "plain_text" as const,
          text: "First database: choose Export to download the workspace.",
        },
      },
    };
    const secondGuide = {
      ...firstGuide,
      draft: {
        ...firstGuide.draft,
        title: "Export from the second fictional workspace",
        content: {
          format: "plain_text" as const,
          text: "Second database: choose Export to save this independent workspace.",
        },
      },
    };
    const publishedFirst = await first.publishGuide(firstGuide);
    await expect(
      second.app.getPublishedArticle(customer, { articleId: firstGuide.id }),
    ).rejects.toMatchObject({ name: "KnowledgeBaseNotFoundError" });
    expect(
      (await second.app.searchPublishedArticles(customer, second.portalInput()))
        .articles,
    ).toEqual([]);
    expect(
      (await second.app.retrieveAnswerSources(botCustomer, second.botInput()))
        .sources,
    ).toEqual([]);

    const publishedSecond = await second.publishGuide(secondGuide);
    expect(publishedFirst.current.articleId).toBe(
      publishedSecond.current.articleId,
    );
    expect(publishedFirst.current.revision.number).toBe(1);
    expect(publishedSecond.current.revision.number).toBe(1);
    for (const [fixture, guide] of [
      [first, firstGuide],
      [second, secondGuide],
    ] as const) {
      expect(
        (
          await fixture.app.getPublishedArticle(customer, {
            articleId: guide.id,
          })
        ).content,
      ).toEqual(guide.draft.content);
      expect(
        (
          await fixture.app.searchPublishedArticles(
            customer,
            fixture.portalInput(),
          )
        ).articles[0]?.title,
      ).toBe(guide.draft.title);
      expect(
        (
          await fixture.app.retrieveAnswerSources(
            botCustomer,
            fixture.botInput(),
          )
        ).sources[0]?.content,
      ).toEqual(guide.draft.content);
    }

    await first.authoringApp.retireArticle(indexAdministrator, {
      ...first.command(
        "retire-one-database",
        publishedFirst.current.generation,
      ),
      articleId: firstGuide.id,
    });
    expect(
      (await first.app.searchPublishedArticles(customer, first.portalInput()))
        .articles,
    ).toEqual([]);
    expect(
      (await first.app.retrieveAnswerSources(botCustomer, first.botInput()))
        .sources,
    ).toEqual([]);
    expect(
      (
        await second.app.getDraft(indexAdministrator, {
          articleId: secondGuide.id,
        })
      ).generation,
    ).toBe(publishedSecond.current.generation);
    expect(
      (await second.app.retrieveAnswerSources(botCustomer, second.botInput()))
        .sources[0]?.content,
    ).toEqual(secondGuide.draft.content);
  });
});
