// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL_NAMES = [
  "get_case",
  "get_changes",
  "list_models",
  "list_taxonomy",
  "search_cases",
];

/** @type {{activeIds:string[],tombstoneIds:string[],changes:Array<{caseId:string,caseRevisionId:string,changeKind:string}>}} */
const manifest = JSON.parse(await readFile(path.join(ROOT, "catalog/manifest.json"), "utf8"));
/** @type {{models:unknown[]}} */
const modelsCatalog = JSON.parse(await readFile(path.join(ROOT, "catalog/models.json"), "utf8"));
/** @type {{taxonomy:unknown[]}} */
const taxonomyCatalog = JSON.parse(await readFile(path.join(ROOT, "catalog/taxonomy.json"), "utf8"));
const firstActiveId = manifest.activeIds[0];
const firstActiveChange = manifest.changes.find(({ caseId, changeKind }) =>
  caseId === firstActiveId && changeKind === "upserted");
const firstTombstoneId = manifest.tombstoneIds[0];
assert.equal(typeof firstActiveId, "string");
assert.ok(firstActiveChange);
const firstActiveRevisionId = firstActiveChange.caseRevisionId;
assert.equal(typeof firstActiveRevisionId, "string");
assert.equal(typeof firstTombstoneId, "string");
const staleRevision = `${firstActiveId}@r9999`;
assert.notEqual(staleRevision, firstActiveRevisionId);

/** @param {unknown} result */
function structured(result) {
  assert.equal(typeof result, "object");
  assert.ok(result !== null);
  const value = /** @type {{ structuredContent?: unknown }} */ (result).structuredContent;
  assert.ok(value);
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} result @param {RegExp} expected */
function toolError(result, expected) {
  assert.equal(typeof result, "object");
  assert.ok(result !== null);
  const value = /** @type {{isError?:boolean,content?:Array<{type?:string,text?:string}>}} */ (result);
  assert.equal(value.isError, true);
  assert.equal(value.content?.[0]?.type, "text");
  assert.match(value.content?.[0]?.text ?? "", expected);
}

test("real stdio transport exposes exactly five deterministic read-only tools", async () => {
  const client = new Client({ name: "filmlune-mcp-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "src/server/stdio.mjs")],
    cwd: ROOT,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "filmlune-mcp");
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name).sort(), TOOL_NAMES);
    assert.match(
      listed.tools.find(({ name }) => name === "search_cases")?.description ?? "",
      /FilmLune/,
    );
    assert.match(
      listed.tools.find(({ name }) => name === "get_case")?.description ?? "",
      /FilmLune/,
    );

    const firstPage = structured(await client.callTool({
      name: "search_cases",
      arguments: { mediaType: "video", limit: 2 },
    }));
    assert.equal(/** @type {unknown[]} */ (firstPage.items).length, 2);
    assert.equal(typeof firstPage.nextCursor, "string");
    const repeated = structured(await client.callTool({
      name: "search_cases",
      arguments: { mediaType: "video", limit: 2 },
    }));
    assert.deepEqual(repeated, firstPage);

    const caseResult = structured(await client.callTool({
      name: "get_case",
      arguments: { caseId: firstActiveId, caseRevisionId: firstActiveRevisionId },
    }));
    assert.equal(caseResult.caseId, firstActiveId);
    assert.equal(caseResult.caseRevisionId, firstActiveRevisionId);

    toolError(await client.callTool({
      name: "get_case",
      arguments: { caseId: firstActiveId, caseRevisionId: staleRevision },
    }), /MCP_STALE_CASE_REVISION/);

    const models = structured(await client.callTool({ name: "list_models", arguments: { limit: 50 } }));
    assert.equal(/** @type {unknown[]} */ (models.items).length, modelsCatalog.models.length);
    const taxonomy = structured(await client.callTool({ name: "list_taxonomy", arguments: { limit: 50 } }));
    assert.equal(/** @type {unknown[]} */ (taxonomy.items).length, taxonomyCatalog.taxonomy.length);
    const changes = structured(await client.callTool({ name: "get_changes", arguments: { limit: 50 } }));
    assert.equal(/** @type {unknown[]} */ (changes.items).length, manifest.changes.length);

    const removed = structured(await client.callTool({
      name: "get_case",
      arguments: { caseId: firstTombstoneId },
    }));
    assert.equal(removed.kind, "tombstone");

    toolError(await client.callTool({
      name: "get_case",
      arguments: { caseId: "cev_9999" },
    }), /MCP_UNKNOWN_CASE/);
    toolError(await client.callTool({
      name: "search_cases",
      arguments: { limit: 0 },
    }), /Invalid|limit/i);
  } finally {
    await client.close();
  }
});
