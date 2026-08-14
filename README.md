# FilmLune MCP

Read-only local MCP access to the rights-filtered public FilmLune case catalog.
The repository, package, and stdio server use the technical coordinate
`filmlune-mcp`.
This Phase 1 server communicates over stdio and exposes exactly five tools:

- `search_cases`
- `get_case`
- `list_models`
- `list_taxonomy`
- `get_changes`

## Local use

Requirements: Node.js 22.22.2 and the exact pnpm version declared in
`package.json`.

```bash
corepack pnpm start
```

The server validates every generated file and hash before accepting a client.
It does not host an HTTP endpoint, generate media, change catalog state, or call
an external provider.

## Catalog ownership and rights

The FilmLune website workflow is the only editable source of catalog truth.
`catalog/` and `schemas/` are generated, versioned projections and must never be
hand-edited. Changes flow one way from the reviewed website source into this
repository; this server never writes them back.

The MIT license covers the server software only. It does not grant rights to
catalog records, prompts, media, social derivatives, or third-party source
material. Each record carries its own current rights projection. Only records
approved for the exact MCP projection are emitted; denied prompt or media
payloads are structurally absent. Removed records are represented by minimal
tombstones.

## Local verification

```bash
node scripts/check-generated-catalog.mjs
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
```

Passing locally does not mean the repository, package, or service has been
published. Publication, hosting, quotas, authentication, and production support
remain separate release decisions.
