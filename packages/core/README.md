# @pegma/knowledge-base-core

Pure collection, draft, verification, review, publication, and retirement
transitions. It requires no Support
Desk, GitHub, model, framework, database, or provider SDK.

The current verified synchronized release is
[`0.1.6`](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.6), including
MCP extension metadata compatibility. The historical
[`0.1.5` release](https://github.com/pegma-dev/knowledge-base/releases/tag/v0.1.5)
provided application answering read batching. Changed source still requires
its own review and current-head gates; host acceptance remains separate.
These source README corrections apply to a future release. Published `0.1.5`
tarballs, including their bundled README bytes, remain unchanged.

Core owns domain invariants. The application service checks current named
permissions, loads authoritative records, uses host-verified evidence facts,
and commits state with Audit through Storage Core. The host authenticates
callers and resolves scoped Authorization Core contexts. Calling a pure
function does not grant a permission.

## Entry points

- **validateValidationPolicy** exposes the bounded core validation used by
  application governance before persistence. It checks policy requirements,
  including content checks and walkthrough workflow checks; it grants no
  policy-administration permission.
- **createCollection** always starts with portal and bot use disabled.
- **previewCollectionPolicy** binds proposed independent portal/bot audiences to
  the current collection revision. **applyCollectionPolicy** rejects stale or
  changed previews. Anonymous use additionally requires explicit approval of
  that exact collection, policy version, and policy hash.
  Its review time must fall between the source collection's latest update and
  application of the approved change; review and application can occur at
  different times.
  The preview hash is a deterministic snapshot binding, not a signature,
  capability, or proof that the preview function was called. The application
  loads the trusted current collection and authenticates the actor and approval.
- **createArticle** and **reviseArticle** compute SHA-256 over the complete numbered
  revision using canonical JSON and Web Crypto. A supplied hash is never
  accepted as content proof. Revision outputs and their nested values are
  frozen, and asynchronous operations snapshot their inputs before hashing.
- **recordEvidence** checks exact article revision/hash, applicability,
  validation policy, expected staging build, required check, runner, trusted
  verification receipt, execution/verification time, steps, and artifacts.
  Replacing evidence increments its version and invalidates pending review.
- **submitForReview** requires exactly one current verified passing result for
  every check required by that article kind. Every kind requires a content
  check; walkthroughs additionally require a workflow check. Policies can
  require further check kinds.
- **publishArticle** recomputes the approval binding against current facts and
  compares both the submitted review and the reviewer's exact requested
  binding. Changed content, audience, validation policy, evidence, or expired
  checks defeat stale approval.
- **rejectReview** returns a submitted review to draft. The application records
  the authorized rejection reason in its command/audit transaction.
- **retireArticle** removes the publication and pending review. Republishing a
  retired article requires creating a new draft revision and review.
  Retirement retains the current private revision and evidence in the bounded
  staff aggregate; it is not deletion or anonymization.

An article has no access override. Its numbered revision names one collection.
Moving a draft to another collection requires a new reviewed publication. An
existing approved publication remains bound to its previous collection while
that draft is being prepared.

## Bounded state and publication checks

The aggregate retains one current revision, at most one published revision,
and a bounded set of current evidence. It does not store a revision archive.
Editing clears current evidence and pending review while preserving the old
published snapshot. A published snapshot contains exact evidence references;
application storage must retain or revoke the corresponding evidence
versions and private provenance according to policy.

**isPublicationBoundToCurrentPolicies** checks the published snapshot against
the supplied authoritative collection and validation policy, including hashes
to detect same-version mutation. It is only a policy-binding predicate. It does
not authorize a read, authenticate external evidence, establish retained
evidence availability/revocation, or implement customer retrieval. Never expose
an aggregate or its private approval/evidence fields directly to customers or
the model. Never expose or log raw aggregates. Authorized DTO construction
and evidence access belong to the application. Hosts own retention/deletion;
the bounded application history has no compaction operation.

All times, identities, and policies are explicit inputs. A **ReviewContext**
must come from the trusted application: it supplies current collection and
validation policy, the expected staging build, authenticated receipt verifier
allowlist, and current time. Core validates claimed bindings and configured
runner/verifier membership; it cannot authenticate a claimed identity. A
review or evidence operation cannot predate the supplied collection's latest
update. Older evidence can remain valid when the operation uses current time
and the evidence still satisfies its exact binding and freshness requirements.
A caller inventing an attestation object has not produced verification proof.
The application verifies receipts through its trusted host port and authorizes
evidence submission before calling these transitions. The optional HTTP/MCP
adapter uses that same application boundary.

A draft targeting a future build waits for matching verification or is revised;
evidence for a different staging build fails closed.

## Source format and schema ceilings

Content is Markdown or plain text, never MDX. The Markdown subset supports
ordinary text, headings, lists, code, and inline links to HTTPS URLs, root-relative
paths, or fragments. Raw HTML/JSX, embedded images, autolinks, reference links,
credentialed URLs, protocol-relative URLs, and other schemes are rejected.
Escape literal markup as entities, including markup shown inside code examples.
Core never fetches links/artifacts or executes code. Hosts must use a safe
renderer with raw HTML and executable extensions disabled; plain text must be
rendered as text.

**knowledgeLimits** exposes hard schema ceilings: 32 KiB of UTF-8 content,
200-character titles, 1,000-character summaries, 16 tags, 32 policy requirements,
32 current evidence records, 16 steps per record, and eight artifact references
per record. Other strings and identity lists also have explicit bounds.
These are validation ceilings, not measured production throughput, retention,
rate limits, or model budgets. The application separately bounds durable
partitions, retained history, and transaction work.

Domain failures are **KnowledgeBaseError** with code and field. Core does
not implement HTTP mappings, replay receipts, concurrent storage updates,
authorization roles, audit persistence, or network retry behavior.

## Validation

From the repository root:

    pnpm run check
    pnpm exec vitest run packages/core/src/index.test.ts

Tests exercise exported entry points for immutable edits, private/bot-only and
public policies, stale approval and evidence replacement, wrong build/runner,
expired checks, retirement, malformed content, and byte bounds. They establish
pure domain behavior, not authenticated authoring or real-host acceptance.
