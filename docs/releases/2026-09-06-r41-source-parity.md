# Website r41 source parity

The website now verifies its two existing approved playback MP4s as static
release assets. Its changed source-bundle verifier is part of the MCP generator
inventory, so the generated provenance advances to
`mcp-local-4a14a43c60dc033d`.

All 28 active case records, 15 tombstones, 43 change events, prompt/media/rights
content and five tools are unchanged. Outside the manifest's generated revision
and file hashes, changed JSON values are limited to `generatorSha256` (43 case/tombstone files)
and `catalogRevision` (the model and taxonomy indexes).
No media binaries enter this repository.

The catalog validator, TypeScript, ESLint, full tests and official MCP client
with StdioClientTransport pass. The website owns the matching generated runtime
release and Operator r0038 snapshot. Git publication and website production
verification are separate deployment steps.

Upstream `jau123/MeiGen-AI-Design-MCP` was rechecked on 2026-09-06 at
`9f51ef065a68ffcc16701b2769726b8fe820095e` (2026-08-05). Its OpenClaw skill-version
update does not affect this provenance-only repair or expand FilmLune scope.
