// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} relative */
async function text(relative) {
  return readFile(path.join(ROOT, relative), "utf8");
}

/** @param {string} relative */
async function json(relative) {
  return JSON.parse(await text(relative));
}

test("uses the FilmLune MCP package coordinate and FilmLune public projection", async () => {
  const packageJson = await json("package.json");
  assert.equal(packageJson.name, "filmlune-mcp");

  const manifest = await json("catalog/manifest.json");
  assert.equal(manifest.source.websiteRepository, "filmlune.com");

  const firstCase = await json(`catalog/cases/${manifest.activeIds[0]}.json`);
  assert.equal(firstCase.creator.displayName, "FilmLune");
  assert.match(firstCase.canonicalUrl, /^https:\/\/filmlune\.com\//);
  assert.match(firstCase.source.canonicalUrl, /^https:\/\/filmlune\.com\//);

  const caseSchema = await json("schemas/case.v1.schema.json");
  const tombstoneSchema = await json("schemas/tombstone.v1.schema.json");
  const manifestSchema = await json("schemas/manifest.v1.schema.json");
  assert.equal(caseSchema.$id, "https://filmlune.com/schemas/mcp/case.v1.schema.json");
  assert.equal(tombstoneSchema.$id, "https://filmlune.com/schemas/mcp/tombstone.v1.schema.json");
  assert.equal(manifestSchema.$id, "https://filmlune.com/schemas/mcp/manifest.v1.schema.json");
  assert.match(caseSchema.title, /^FilmLune MCP /);
  assert.match(tombstoneSchema.title, /^FilmLune MCP /);
  assert.match(manifestSchema.title, /^FilmLune MCP /);
});

test("uses FilmLune in active server copy and documentation", async () => {
  for (const relative of ["src/server/stdio.mjs", "README.md", "SECURITY.md", "LICENSE"]) {
    const contents = await text(relative);
    assert.match(contents, /FilmLune/, relative);
    assert.doesNotMatch(contents, /ÉcranGen|EcranGen|ecrangen\.com/, relative);
  }
});
