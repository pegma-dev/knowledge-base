import {
  createExampleComposition,
  runCompleteExampleFlow,
} from "./composition.ts";

const result = await runCompleteExampleFlow(createExampleComposition());
process.stdout.write(
  [
    "Knowledge Base synthetic composition completed.",
    `articleId=${result.articleId}`,
    `revision=${result.revision}`,
    `citation=${result.citationLabel}`,
    `confirmedSources=${result.answerSources.sources.length}`,
    `syntheticSourceTokens=${result.answerSources.sourceTokens}`,
    "",
  ].join("\n"),
);
