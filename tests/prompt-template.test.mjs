// @ts-check

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  validateCatalog,
  validateManifestDocument,
} from "../src/catalog-reader/validate-catalog.mjs";
import { getCase } from "../src/tools/get-case.mjs";
import { getChanges } from "../src/tools/get-changes.mjs";
import { searchCases } from "../src/tools/search-cases.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string|Buffer} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {(temporary:string,manifest:Record<string,unknown>)=>Promise<void>} mutate */
async function withCatalogCopy(mutate) {
  const temporary = await mkdtemp(path.join(tmpdir(), "filmlune-mcp-prompt-test-"));
  try {
    await cp(path.join(ROOT, "catalog"), path.join(temporary, "catalog"), { recursive: true });
    await cp(path.join(ROOT, "schemas"), path.join(temporary, "schemas"), { recursive: true });
    const manifestPath = path.join(temporary, "catalog/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await mutate(temporary, manifest);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return await validateCatalog(temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

test("manifest decoder dual-reads historical v2 and normalizes case entity kinds", () => {
  const hash = "a".repeat(64);
  const provenance = {
    generatorSha256: hash,
    generatorVersion: "mcp-catalog-v3",
    presentationRevision: "presentation-r1",
    presentationSha256: hash,
    websiteSourceRevision: "source-r1",
    websiteSourceSha256: hash,
  };
  const paths = [
    "catalog/cases/cev_0001.json",
    "catalog/models.json",
    "catalog/taxonomy.json",
    "catalog/tombstones/cev_0002.json",
    "schemas/case.v2.schema.json",
    "schemas/manifest.v2.schema.json",
    "schemas/tombstone.v1.schema.json",
  ];
  const manifest = validateManifestDocument({
    schemaVersion: 2,
    catalogRevision: "mcp-local-v2-test",
    generator: { version: "mcp-catalog-v3", sha256: hash },
    presentation: { language: "en", revision: "presentation-r1", sha256: hash },
    source: { websiteRepository: "filmlune.com", revision: "source-r1", sha256: hash },
    schemaHashes: { caseV2: hash, manifestV2: hash, tombstoneV1: hash },
    activeIds: ["cev_0001"],
    tombstoneIds: ["cev_0002"],
    modelsSha256: hash,
    taxonomySha256: hash,
    changes: [
      {
        changeId: "change-cev_0001@r0001",
        caseId: "cev_0001",
        caseRevisionId: "cev_0001@r0001",
        changeKind: "upserted",
        changedAtUtc: "2026-08-12T00:00:00.000Z",
        provenance,
      },
      {
        changeId: "change-cev_0002@r0001-removed",
        caseId: "cev_0002",
        caseRevisionId: "cev_0002@r0001",
        changeKind: "removed",
        changedAtUtc: "2026-08-12T00:00:00.000Z",
        provenance,
      },
    ],
    files: paths.map((entry) => ({ path: entry, sha256: hash })),
  });
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(manifest.promptTemplateIds, []);
  assert.equal(manifest.changes.every(({ entityKind }) => entityKind === "case"), true);
});

test("prompt-only records are searchable/gettable without Website, media, model, or preview claims", async () => {
  const catalog = await validateCatalog(ROOT);
  assert.equal(catalog.manifest.schemaVersion, 3);
  assert.equal(catalog.promptTemplates.size, 30);
  assert.equal(catalog.promptTemplateTombstones.size, 0);
  const first = catalog.promptTemplates.values().next().value;
  assert.ok(first);
  for (const record of catalog.promptTemplates.values()) {
    assert.deepEqual(record.websiteProjection, {
      canonical: false,
      caseWall: false,
      hreflang: false,
      route: false,
      sitemap: false,
    });
    assert.equal(record.mediaBytesIncluded, false);
    assert.equal(record.generationClaim, "none");
    assert.equal(record.referenceClaim, "none");
    for (const forbidden of ["canonicalUrl", "media", "model", "recipe", "reportUrl"]) {
      assert.equal(Object.hasOwn(record, forbidden), false);
    }
  }

  const search = searchCases(catalog, { query: first.prompt.text, limit: 50 });
  const summary = search.items.find((entry) => entry.promptTemplateId === first.promptTemplateId);
  assert.ok(summary);
  assert.equal(Object.hasOwn(summary, "preview"), false);
  assert.equal(Object.hasOwn(summary, "canonicalUrl"), false);
  assert.equal(Object.hasOwn(/** @type {Record<string,unknown>} */ (summary.prompt), "text"), false);
  assert.equal(searchCases(catalog, { mediaType: "image", query: first.prompt.text }).items
    .some((entry) => entry.promptTemplateId === first.promptTemplateId), false);

  const get = getCase(catalog, {
    promptTemplateId: first.promptTemplateId,
    promptTemplateRevisionId: first.promptTemplateRevisionId,
  });
  assert.equal(get.promptTemplate.promptTemplateId, first.promptTemplateId);
  assert.ok("license" in get.promptTemplate);
  assert.equal(sha256(String(get.promptTemplate.license.text)), first.license.sha256);
  assert.equal(Object.hasOwn(get, "preview"), false);
  assert.throws(() => getCase(catalog, {
    caseId: catalog.manifest.activeIds[0],
    promptTemplateId: first.promptTemplateId,
  }), /MCP_INVALID_INPUT/);
  assert.throws(() => getCase(catalog, {}), /MCP_INVALID_INPUT/);

  const changes = getChanges(catalog, { entityKind: "prompt_template", limit: 50 });
  assert.equal(changes.items.length, 30);
  assert.equal(changes.items.every(({ entityKind }) => entityKind === "prompt_template"), true);
});

test("validator fails closed on prompt, license, and duplicate drift after file hashes are reconciled", async () => {
  for (const mutation of ["prompt", "license", "license-text", "duplicate", "unknown-field", "unknown-version"]) {
    await assert.rejects(withCatalogCopy(async (temporary, manifest) => {
      const ids = /** @type {string[]} */ (manifest.promptTemplateIds);
      const firstId = ids[0];
      const secondId = ids[1];
      assert.ok(firstId && secondId);
      const firstPath = `catalog/prompt-templates/${firstId}.json`;
      const firstAbsolute = path.join(temporary, firstPath);
      const first = JSON.parse(await readFile(firstAbsolute, "utf8"));
      if (mutation === "prompt") first.prompt.text = `${first.prompt.text} changed`;
      if (mutation === "license") first.license.sha256 = "b".repeat(64);
      if (mutation === "license-text") first.license.text = "Changed license";
      if (mutation === "unknown-field") first.canonicalUrl = "https://filmlune.com/not-allowed/";
      if (mutation === "unknown-version") first.schemaVersion = 99;
      if (mutation === "duplicate") {
        const second = JSON.parse(await readFile(
          path.join(temporary, `catalog/prompt-templates/${secondId}.json`),
          "utf8",
        ));
        first.prompt = second.prompt;
      }
      const bytes = `${JSON.stringify(first, null, 2)}\n`;
      await writeFile(firstAbsolute, bytes, "utf8");
      const files = /** @type {Array<{path:string,sha256:string}>} */ (manifest.files);
      const row = files.find(({ path: relative }) => relative === firstPath);
      assert.ok(row);
      row.sha256 = sha256(bytes);
    }), /BLOCK_MCP_CATALOG_DRIFT/, mutation);
  }
});

test("prompt tombstones remain retrievable and contain no prompt payload", async () => {
  const catalog = await withCatalogCopy(async (temporary, manifest) => {
    const promptTemplateIds = /** @type {string[]} */ (manifest.promptTemplateIds);
    const promptTemplateId = promptTemplateIds.shift();
    assert.ok(promptTemplateId);
    manifest.promptTemplateTombstoneIds = [promptTemplateId];
    const sourcePath = `catalog/prompt-templates/${promptTemplateId}.json`;
    const source = JSON.parse(await readFile(path.join(temporary, sourcePath), "utf8"));
    await rm(path.join(temporary, sourcePath));
    const tombstone = {
      schemaVersion: 1,
      kind: "prompt_template_tombstone",
      promptTemplateId,
      promptTemplateRevisionId: source.promptTemplateRevisionId,
      status: "removed",
      removedAtUtc: "2026-09-22T00:00:00.000Z",
      reasonCode: "RIGHTS_REVIEW_REQUIRED",
      provenance: source.provenance,
    };
    const tombstonePath = `catalog/prompt-template-tombstones/${promptTemplateId}.json`;
    const tombstoneBytes = `${JSON.stringify(tombstone, null, 2)}\n`;
    await mkdir(path.dirname(path.join(temporary, tombstonePath)), { recursive: true });
    await writeFile(path.join(temporary, tombstonePath), tombstoneBytes, "utf8");
    const files = /** @type {Array<{path:string,sha256:string}>} */ (manifest.files);
    manifest.files = files.filter(({ path: relative }) => relative !== sourcePath)
      .concat({ path: tombstonePath, sha256: sha256(tombstoneBytes) })
      .sort((left, right) => left.path.localeCompare(right.path, "en"));
    const changes = /** @type {Array<Record<string,unknown>>} */ (manifest.changes);
    manifest.changes = changes.filter((change) => change.promptTemplateId !== promptTemplateId)
      .concat({
        entityKind: "prompt_template",
        changeId: `change-${source.promptTemplateRevisionId}-removed`,
        promptTemplateId,
        promptTemplateRevisionId: source.promptTemplateRevisionId,
        changeKind: "removed",
        changedAtUtc: "2026-09-22T00:00:00.000Z",
        provenance: source.provenance,
      });
  });
  const [promptTemplateId] = catalog.manifest.promptTemplateTombstoneIds;
  assert.ok(promptTemplateId);
  const result = getCase(catalog, { promptTemplateId });
  assert.equal(result.promptTemplate.kind, "prompt_template_tombstone");
  assert.equal(Object.hasOwn(result.promptTemplate, "prompt"), false);
  assert.equal(searchCases(catalog, { query: "bond", limit: 50 }).items
    .some((entry) => entry.promptTemplateId === promptTemplateId), false);
  const changes = getChanges(catalog, { entityKind: "prompt_template", changeKind: "removed", limit: 50 });
  assert.equal(changes.items.length, 1);
  assert.equal(changes.items[0]?.promptTemplateId, promptTemplateId);
  assert.equal(changes.items[0]?.changedAtUtc, result.promptTemplate.removedAtUtc);
});
