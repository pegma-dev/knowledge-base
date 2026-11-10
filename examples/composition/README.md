# Fictional Knowledge Base composition

This runnable Node example uses public package entry points and Storage Core's
real memory Store. It demonstrates authoring, bound synthetic verification
evidence, separate staff review/publication, bounded index repair, and bot-source
retrieval followed immediately by citation confirmation.

Run from the repository root on Node 22.6.0+ or 24 after installing the repository's
pinned dependencies:

The runner uses `--experimental-strip-types`, introduced in
[Node 22.6.0](https://nodejs.org/en/blog/release/v22.6.0). This is a repository
development requirement; published package engines remain `>=22`.

```sh
pnpm run example
```

[`composition.ts`](composition.ts) exports `createExampleComposition(store?)`
and `runCompleteExampleFlow(composition)`. The optional Store defaults to
`createMemoryStore()`; the example imports no test helpers. [`run.ts`](run.ts)
prints a safe completion summary. These are workspace source examples. The KB
`0.1.0` packages completed manual bootstrap without OIDC provenance, and the
four-package `0.1.1` trusted release has a
[historical receipt](../../docs/BOOTSTRAP.md#historical-verified-011-release).
The four-package `0.1.2` release has a
[historical verified receipt](../../docs/BOOTSTRAP.md#historical-verified-012-release).
The four-package `0.1.3` release has a
[historical verified receipt](../../docs/BOOTSTRAP.md#current-verified-013-release).
All four packages subsequently completed qualified trusted publication at
[`0.1.4`](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.4) for the
governed context/query features. The answering read-batching `0.1.5` release is
also verified; see its [current receipt](../../docs/BOOTSTRAP.md#current-verified-015-release).
Changed source requires its own review and current-head gates, followed by a
separate verified release before host adoption.
Production hosts retain their separate acceptance gates.

The flow creates a fictional workshop collection with portal use disabled and a
separate bot audience. A synthetic author creates a walkthrough, submits its
content/workflow evidence, and requests review. A different synthetic staff
context publishes the exact review snapshot. Each mutation uses the current
application generation, rather than the content revision. A finite repair loop
requires the article's projection to converge before retrieval.

The synthetic runner recognizes the known fictional procedure and constructs
fixed check results. Its private registry stores immutable serialized bindings
to the actor, complete article revision/hash, complete evidence submission, and
governance configuration. The verifier accepts only an exact registry match;
editing submitted evidence cannot create a valid receipt. This scripted fixture
does not execute a product guide on staging or authenticate any real runner.

All AccessContext values are explicitly trusted synthetic inputs. They are not
credentials, request bodies, a role model, or an authentication implementation.
The customer's context governs retrieval; broad staff authority never supplies
the answer audience. Bot-only citations carry a label and omit a portal browse
reference. The returned serialization contains approved article content, not
private evidence or verifier facts. One UTF-8 byte counts as one fixture token;
that counter is unrelated to a provider's tokenizer or billing.

[`composition.test.ts`](../../tests/composition.test.ts) runs the same public flow
over the real memory, Azurite, and local Miniflare D1 Store factories. It also
checks tampered evidence, denied author publication, private-data exclusion,
bot-only citations, and refusal of references after retirement while an old
projection remains. Each D1 test owns and disposes its local runtime.

A host must supply authenticated and freshly resolved scoped access, an actual
trusted evidence verifier and staging execution/artifact integration, a durable
Store, operational clock, the intended model's local token counter, safe content
rendering, and durable maintenance scheduling. The default memory Store loses
state when the process exits. Confirmation is a current observation, not an
authorization lease; use confirmed sources promptly and resolve access again
for the next operation.

This is independent KB-05 source preparation. It establishes no KB-04 API/MCP
credential proof, live host acceptance, deployment, publication, or production
readiness. See [host composition](../../docs/HOST_COMPOSITION.md) and
[release operations](../../docs/RELEASING.md) for the remaining boundaries.
