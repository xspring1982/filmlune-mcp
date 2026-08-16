# Security policy

FilmLune MCP (`filmlune-mcp`) is currently an M0 local stdio candidate. It is read-only and
must fail closed before accepting a client when catalog structure, inventory,
schema bindings, or SHA-256 evidence does not match the generated manifest.

## Current security boundary

- The server accepts no API keys, cookies, OAuth tokens, payment details, or
  provider credentials.
- The five tools read the validated in-memory catalog only.
- The server does not write to `catalog/`, `schemas/`, the website repository,
  a database, or a remote service.
- The server does not call image/video providers or download media.
- Unknown-rights cases are limited to an approved public source locator;
  denied prompt and media payloads are absent.
- Removal records are minimal tombstones and cannot expose stale case content.
- English presentation and exact protected literals are bound to the reviewed
  website projection and its hashes.

The website workflow is the sole editable catalog authority. Generated files
must be replaced only by its deterministic exporter; a locally rehashed hand
edit is not trusted as website approval.

Startup hashes verify internal consistency, not cryptographic authenticity of
the local repository. M0 trusts the reviewed checkout or installed package as a
whole. A future remote updater, separately writable catalog, hosted refresh
path, or public package release must define its own signed or externally pinned
root and bounded catalog resource policy before becoming supported.

## Reporting a vulnerability

Use the repository's private security-reporting channel when one is available.
Do not put access tokens, private media, personal data, unpublished prompts,
security-sensitive reproduction steps, or other secrets in a public issue.

Include the affected revision, tool name, expected boundary, observed behavior,
and the smallest non-sensitive reproduction that demonstrates the problem.

## Unsupported claims

There is no hosted HTTP endpoint, public package release, authentication layer,
provider integration, credit system, or production SLA in M0. A local passing
test is not evidence that any of those external states exists.
