// @ts-check

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NETWORK_GUARD = path.join(ROOT, "tests/no-network-guard.mjs");
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
const languageNeutralExpected = (await Promise.all(manifest.activeIds.map(async (caseId) => {
  const record = JSON.parse(await readFile(path.join(ROOT, "catalog/cases", `${caseId}.json`), "utf8"));
  return record.outputLanguage === "und" ? { caseId, outputLanguage: "und" } : null;
}))).filter((record) => record !== null);

/** @param {string} directory @param {string} prefix */
async function generatedFiles(directory, prefix) {
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = `${prefix}/${entry.name}`;
    const facts = await lstat(absolute);
    assert.equal(facts.isSymbolicLink(), false, relative);
    if (facts.isDirectory()) files.push(...await generatedFiles(absolute, relative));
    else {
      assert.equal(facts.isFile(), true, relative);
      files.push(relative);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

async function generatedSnapshot() {
  const files = [
    ...await generatedFiles(path.join(ROOT, "catalog"), "catalog"),
    ...await generatedFiles(path.join(ROOT, "schemas"), "schemas"),
  ].sort((left, right) => left.localeCompare(right, "en"));
  return Promise.all(files.map(async (relative) => {
    const absolute = path.join(ROOT, relative);
    const [bytes, facts] = await Promise.all([
      readFile(absolute),
      lstat(absolute, { bigint: true }),
    ]);
    return {
      path: relative,
      bytes: bytes.length,
      mtimeNs: facts.mtimeNs.toString(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }));
}

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

test("network preload guard blocks every supported Node outbound primitive", () => {
  const probe = spawnSync(process.execPath, [
    "--import",
    NETWORK_GUARD,
    "--input-type=module",
    "--eval",
    [
      'import http from "node:http";',
      'import https from "node:https";',
      'import net from "node:net";',
      'import tls from "node:tls";',
      "const operations = [",
      '  () => fetch("http://127.0.0.1:9"),',
      '  () => http.request("http://127.0.0.1:9"),',
      '  () => http.get("http://127.0.0.1:9"),',
      '  () => https.request("https://127.0.0.1:9"),',
      '  () => https.get("https://127.0.0.1:9"),',
      '  () => net.connect(9, "127.0.0.1"),',
      '  () => net.createConnection(9, "127.0.0.1"),',
      '  () => tls.connect(9, "127.0.0.1"),',
      "];",
      "for (const operation of operations) {",
      "  try {",
      "    operation();",
      '    throw new Error("NETWORK_GUARD_DID_NOT_BLOCK");',
      "  } catch (error) {",
      '    if (!(error instanceof Error) || error.message !== "MCP_NETWORK_BLOCKED") throw error;',
      "  }",
      "}",
      'process.stdout.write("NETWORK_GUARD_PASS\\n");',
    ].join("\n"),
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stderr, "");
  assert.equal(probe.stdout, "NETWORK_GUARD_PASS\n");
});

test("real stdio transport exposes exactly five deterministic read-only tools", async () => {
  const before = await generatedSnapshot();
  const client = new Client({ name: "filmlune-mcp-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", NETWORK_GUARD, path.join(ROOT, "src/server/stdio.mjs")],
    cwd: ROOT,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "filmlune-mcp");
    assert.equal(client.getServerVersion()?.version, "0.1.0");
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name).sort(), TOOL_NAMES);
    assert.match(
      listed.tools.find(({ name }) => name === "search_cases")?.description ?? "",
      /^Search FilmLune's public, rights-filtered case catalog\.$/,
    );
    assert.match(
      listed.tools.find(({ name }) => name === "get_case")?.description ?? "",
      /^Read one exact public FilmLune case revision or tombstone and its available output-language variants\.$/,
    );

    const firstPage = structured(await client.callTool({
      name: "search_cases",
      arguments: { mediaType: "image", limit: 2 },
    }));
    assert.equal(
      /** @type {unknown[]} */ (firstPage.items).length,
      Math.min(2, manifest.activeIds.length),
    );
    if (manifest.activeIds.length > 2) assert.equal(typeof firstPage.nextCursor, "string");
    else assert.equal(firstPage.nextCursor, null);
    const repeated = structured(await client.callTool({
      name: "search_cases",
      arguments: { mediaType: "image", limit: 2 },
    }));
    assert.deepEqual(repeated, firstPage);

    const languageNeutral = structured(await client.callTool({
      name: "search_cases",
      arguments: { outputLanguage: "und", limit: 50 },
    }));
    assert.deepEqual(
      /** @type {Array<{caseId:string,outputLanguage:string}>} */ (languageNeutral.items)
        .map(({ caseId, outputLanguage }) => ({ caseId, outputLanguage })),
      languageNeutralExpected,
    );
    const englishDiscovery = structured(await client.callTool({
      name: "search_cases",
      arguments: { outputLanguage: "en", limit: 50 },
    }));
    assert.equal(/** @type {Array<{outputLanguage:string}>} */ (englishDiscovery.items)
      .every(({ outputLanguage }) => outputLanguage === "en" || outputLanguage === "und"), true);
    const frenchDiscovery = structured(await client.callTool({
      name: "search_cases",
      arguments: { outputLanguage: "fr", limit: 50 },
    }));
    assert.equal(/** @type {Array<{outputLanguage:string}>} */ (frenchDiscovery.items)
      .every(({ outputLanguage }) => outputLanguage === "fr" || outputLanguage === "und"), true);

    const caseResult = structured(await client.callTool({
      name: "get_case",
      arguments: { caseId: firstActiveId, caseRevisionId: firstActiveRevisionId },
    }));
    const currentCase = /** @type {Record<string,unknown>} */ (caseResult.case);
    assert.equal(currentCase.caseId, firstActiveId);
    assert.equal(currentCase.caseRevisionId, firstActiveRevisionId);
    assert.deepEqual(caseResult.availableOutputVariants, [{
      caseId: firstActiveId,
      caseRevisionId: firstActiveRevisionId,
      outputLanguage: "en",
      outputVariantId: currentCase.outputVariantId,
    }]);

    toolError(await client.callTool({
      name: "get_case",
      arguments: { caseId: firstActiveId, caseRevisionId: staleRevision },
    }), /MCP_STALE_CASE_REVISION/);

    const models = structured(await client.callTool({ name: "list_models", arguments: { limit: 50 } }));
    assert.equal(/** @type {unknown[]} */ (models.items).length, modelsCatalog.models.length);
    let taxonomy = structured(await client.callTool({ name: "list_taxonomy", arguments: { limit: 50 } }));
    const taxonomyItems = [.../** @type {unknown[]} */ (taxonomy.items)];
    while (typeof taxonomy.nextCursor === "string") {
      taxonomy = structured(await client.callTool({
        name: "list_taxonomy",
        arguments: { cursor: taxonomy.nextCursor, limit: 50 },
      }));
      taxonomyItems.push(.../** @type {unknown[]} */ (taxonomy.items));
    }
    assert.equal(taxonomyItems.length, taxonomyCatalog.taxonomy.length);
    const changes = structured(await client.callTool({ name: "get_changes", arguments: { limit: 50 } }));
    assert.equal(/** @type {unknown[]} */ (changes.items).length, manifest.changes.length);

    const removed = structured(await client.callTool({
      name: "get_case",
      arguments: { caseId: firstTombstoneId },
    }));
    assert.equal(/** @type {Record<string,unknown>} */ (removed.case).kind, "tombstone");
    assert.deepEqual(removed.availableOutputVariants, []);

    toolError(await client.callTool({
      name: "get_case",
      arguments: { caseId: "cev_9999" },
    }), /MCP_UNKNOWN_CASE/);
    toolError(await client.callTool({
      name: "search_cases",
      arguments: { limit: 0 },
    }), /Invalid|limit/i);
    toolError(await client.callTool({
      name: "search_cases",
      arguments: { outputLanguage: "FR" },
    }), /Invalid|outputLanguage|language/i);
  } finally {
    await client.close();
    assert.deepEqual(await generatedSnapshot(), before);
  }
});
