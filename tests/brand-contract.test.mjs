// @ts-check

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

test("uses the FilmLune MCP package coordinate and website-owned public projection", async () => {
  const packageJson = await json("package.json");
  assert.equal(packageJson.name, "filmlune-mcp");
  assert.equal(packageJson.version, "0.1.0");

  /** @type {{source:{websiteRepository:string},activeIds:string[]}} */
  const manifest = await json("catalog/manifest.json");
  assert.equal(manifest.source.websiteRepository, "filmlune.com");

  const firstCase = await json(`catalog/cases/${manifest.activeIds[0]}.json`);
  assert.equal(firstCase.creator.displayName, "ᴍᴜʀᴘʜʏ");
  assert.equal(firstCase.creator.handle, "@Diplomeme");
  assert.match(firstCase.canonicalUrl, /^https:\/\/filmlune\.com\//);
  assert.equal(firstCase.source.canonicalUrl, "https://x.com/Diplomeme/status/2050044222041124979");

  const caseSchema = await json("schemas/case.v2.schema.json");
  const tombstoneSchema = await json("schemas/tombstone.v1.schema.json");
  const manifestSchema = await json("schemas/manifest.v2.schema.json");
  assert.equal(caseSchema.$id, "https://filmlune.com/schemas/mcp/case.v2.schema.json");
  assert.equal(tombstoneSchema.$id, "https://filmlune.com/schemas/mcp/tombstone.v1.schema.json");
  assert.equal(manifestSchema.$id, "https://filmlune.com/schemas/mcp/manifest.v2.schema.json");
  assert.match(caseSchema.title, /^FilmLune MCP /);
  assert.match(tombstoneSchema.title, /^FilmLune MCP /);
  assert.match(manifestSchema.title, /^FilmLune MCP /);
});

test("uses FilmLune in active server copy and documentation", async () => {
  for (const relative of [
    "src/server/stdio.mjs",
    "README.md",
    "SECURITY.md",
    "LICENSE",
    "CONTENT_LICENSE.md",
  ]) {
    const contents = await text(relative);
    assert.match(contents, /FilmLune/, relative);
    assert.doesNotMatch(contents, /ÉcranGen|EcranGen|ecrangen\.com/, relative);
  }
});

test("separates eligible prompt permissions from media and bulk redistribution", async () => {
  const license = await text("CONTENT_LICENSE.md");
  assert.match(license, /Personal use/);
  assert.match(license, /Commercial generation/);
  assert.match(license, /Modification/);
  assert.match(license, /Individual reposting/);
  assert.match(license, /does \*\*not\*\* grant permission[\s\S]+case image, video, audio/);
  assert.match(license, /may not:[\s\S]+distribute prompts or catalog records in bulk/);
});

test("keeps repository, schemas, generated presentation and tool descriptions English-only", async () => {
  /** @type {{schemaVersion:number,presentation:{language:string,revision:string,sha256:string},activeIds:string[]}} */
  const manifest = await json("catalog/manifest.json");
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(manifest.presentation, {
    language: "en",
    revision: "local-demo-mcp-en-2026-08-15.1",
    sha256: manifest.presentation.sha256,
  });
  assert.match(manifest.presentation.sha256, /^[a-f0-9]{64}$/);
  const generated = [
    await text("catalog/models.json"),
    await text("catalog/taxonomy.json"),
    ...await Promise.all(manifest.activeIds.map((caseId) => text(`catalog/cases/${caseId}.json`))),
  ].join("\n");
  assert.doesNotMatch(generated, /"(?:locale|titleFr|summaryFr|purposeFr|methodFr|labelFr|altFr)"/);
  assert.doesNotMatch(await text("src/server/stdio.mjs"), /Rechercher|Lire une|Lister|française|retraits/);
  assert.deepEqual((await readdir(ROOT)).filter((entry) => entry.startsWith("README")), ["README.md"]);
  assert.match(await text("README.md"), /M0 local candidate/);
  assert.match(await text("README.md"), /does not yet provide an HTTP\s+service/);
});
