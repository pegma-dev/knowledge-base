# @pegma/knowledge-base-contracts

Provider-free collection, immutable article revision, validation evidence, and
exact approval contracts for a composable knowledge base. This package owns
permission names; the host's Authorization Core composition owns their meaning
and enforcement. Identity and time types come from `@pegma/spine`.

Collections independently enable portal and bot use for an explicit audience.
Every article inherits its collection policy; there are no article-level access
overrides. An enabled permission audience names a permission the host resolves.
Anonymous use is representable for future opt-in publication, with an exact
public collection approval; both initial hosts keep it disabled.

Content edits create a new immutable `ArticleRevision`. `Article` is a bounded
transition aggregate containing the current draft and at most one published
snapshot; it is not a revision archive. Application services must retain
bounded revision history separately and authorize access to it. An existing
publication can remain while an update awaits review. Retirement removes the
published snapshot from the transition result.

`ApprovalBinding` names the exact content hash, collection audience policy,
applicability, validation policy, and evidence versions/hashes that a reviewer
approved. Evidence includes steps, a staging build, a runner, timestamps,
protected artifact references, and an attestation receipt. A `passed` result
alone is insufficient. Hashes use lowercase hexadecimal SHA-256.

These types do not authenticate identity or prove a submitted attestation. The
later application/host boundary must authenticate the runner and reviewer,
verify the attestation against its trusted verifier, apply current permission
and resource checks, and control private evidence access. Authoring callers
cannot grant themselves publication authority by supplying these fields.

The package does not own persistence, an access model, HTTP/MCP transports,
safe HTML rendering, arbitrary URL fetching, code execution, GitHub, or model
integration. Evidence and approval records are private staff material; later
customer/bot projections must return approved article content only.
