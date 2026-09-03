# FilmLune MCP

FilmLune MCP is a read-only Model Context Protocol server for FilmLune's
rights-filtered public case catalog. This repository is an **M0 local candidate**:
it exposes an English catalog over stdio and does not yet provide an HTTP
service, hosted endpoint, package release, or media-generation API.

The server exposes exactly five tools:

| Tool | Purpose |
| --- | --- |
| `search_cases` | Search English case presentation, prompt text, model, taxonomy, media type, and output language. |
| `get_case` | Read one exact case revision or tombstone and list the available output-language variants in its case family. |
| `list_models` | List model families represented by active reusable cases. |
| `list_taxonomy` | List the generated English taxonomy. |
| `get_changes` | Read the deterministic additions, updates, and removals feed. |

## What M0 does

- validates every generated path and SHA-256 before startup;
- serves only the website workflow's reviewed public projection;
- keeps MCP presentation, taxonomy, labels, examples, and tool descriptions in
  English;
- stores a language-neutral case once as `outputLanguage: "und"` and makes it
  discoverable for any requested language;
- stores each language-specific result as a separate reviewed variant under the
  same `caseFamilyId`;
- preserves required dialogue and visible text as exact BCP 47-tagged
  `protectedLiterals`; and
- returns minimal tombstones for removed cases without stale prompt, creator, or
  media payloads.

M0 never translates a case at request time. `search_cases` with
`outputLanguage: "fr"`, for example, may return exact `fr` variants plus reusable
`und` variants. `get_case` reports the exact variants that already exist; it does
not synthesize one.

## Local requirements

- Node.js `22.22.2`
- the exact pnpm release declared in `package.json#packageManager`
- a dependency tree installed from the frozen lockfile under the repository's
  reviewed dependency policy

The reviewed install shape is:

```bash
corepack pnpm install --frozen-lockfile --ignore-scripts
```

That command is setup only. It is not a provider login, model download, build,
deployment, or publication step.

## Connect a local MCP client

Replace `/absolute/path/to/filmlune-mcp` with this repository's absolute path.

Codex CLI:

```bash
codex mcp add filmlune -- corepack pnpm --dir /absolute/path/to/filmlune-mcp start
```

Claude Code:

```bash
claude mcp add filmlune -- corepack pnpm --dir /absolute/path/to/filmlune-mcp start
```

Claude Desktop-style configuration:

```json
{
  "mcpServers": {
    "filmlune": {
      "command": "corepack",
      "args": [
        "pnpm",
        "--dir",
        "/absolute/path/to/filmlune-mcp",
        "start"
      ]
    }
  }
}
```

The client starts the process and exchanges MCP messages over stdin/stdout. A
browser address bar cannot call this M0 server. Streamable HTTP is a separate
future milestone, not another view of the stdio process.

No FilmLune API key is needed because M0 does not generate images or videos. It
does not use a user's provider key, FilmLune's provider key, credits, or payment.

## Catalog ownership and rights

The FilmLune website workflow is the sole editable source of catalog truth.
`catalog/` and `schemas/` are deterministic generated projections and must never
be hand-edited. Changes flow one way from the reviewed website source into this
repository; the server never writes them back.

Manifest and record hashes prove internal consistency of one projection; they
are not signatures and cannot authenticate a locally replaced repository by
themselves. Website exporter parity, code review, and trusted repository or
package distribution establish approval. Any future remote catalog updater
must add a signed or externally pinned authenticity root before release.

The [MIT license](LICENSE) covers the server software only. Prompt and catalog
use is governed separately by the
[FilmLune Prompt and Catalog Content License](CONTENT_LICENSE.md), together with
each record's current rights projection. Eligible prompt records permit
personal use, commercial generation, modification, and attributed individual
reposting; they do not permit bulk scraping, prompt-pack/dataset resale,
catalog mirroring, or competing MCP/API redistribution. Case images, videos,
source posts, trademarks, likenesses, and third-party materials are not
licensed with a prompt. Denied prompt or media payloads are structurally
absent.

Forking or cloning this public repository lets you run, evaluate, or contribute
to the MCP software. It does not grant broader rights to the generated catalog
or its media.

## Verify the candidate

```bash
node scripts/check-generated-catalog.mjs
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
```

Passing these local checks does not prove external-client installation,
repository publication, npm publication, HTTP hosting, generation, payment,
provider acceptance, or production support.

## Current boundary

M0 is local, deterministic, English-first, and read-only. The following are not
implemented or claimed:

- HTTP or a hosted remote MCP endpoint;
- image or video generation;
- provider selection, failover, or API-key handling;
- FilmLune credits, billing, or subscriptions;
- npm/package publication;
- a public GitHub release; or
- production support or uptime commitments.

See [SECURITY.md](SECURITY.md) for the fail-closed security boundary.
