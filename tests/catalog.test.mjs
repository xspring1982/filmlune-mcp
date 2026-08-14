// @ts-check

import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateCatalog } from "../src/catalog-reader/validate-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("catalog validates the exact manifest-driven active and tombstone inventories", async () => {
  const result = await validateCatalog(ROOT);
  assert.equal(result.cases.size, result.manifest.activeIds.length);
  assert.equal(result.tombstones.size, result.manifest.tombstoneIds.length);
  assert.deepEqual([...result.cases.keys()], result.manifest.activeIds);
  assert.deepEqual([...result.tombstones.keys()], result.manifest.tombstoneIds);
  assert.ok(result.models.models.length >= 1);
  assert.ok(result.taxonomy.taxonomy.length >= 1);
  const firstActiveId = result.manifest.activeIds[0];
  assert.ok(firstActiveId);
  const firstActive = result.cases.get(firstActiveId);
  assert.ok(firstActive);
  assert.equal(
    result.manifest.changes.find(({ caseId, changeKind }) =>
      caseId === firstActiveId && changeKind === "upserted")?.caseRevisionId,
    firstActive.caseRevisionId,
  );
});

test("catalog rejects an altered declared file and an untracked generated file", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "filmlune-mcp-catalog-test-"));
  try {
    await cp(path.join(ROOT, "catalog"), path.join(temporary, "catalog"), { recursive: true });
    await cp(path.join(ROOT, "schemas"), path.join(temporary, "schemas"), { recursive: true });
    const manifest = JSON.parse(await readFile(path.join(temporary, "catalog/manifest.json"), "utf8"));
    const firstActiveId = manifest.activeIds[0];
    assert.equal(typeof firstActiveId, "string");
    const casePath = path.join(temporary, `catalog/cases/${firstActiveId}.json`);
    await writeFile(casePath, `${await readFile(casePath, "utf8")}\n`, "utf8");
    await assert.rejects(validateCatalog(temporary), /BLOCK_MCP_CATALOG_DRIFT/);

    await rm(temporary, { recursive: true, force: true });
    const second = await mkdtemp(path.join(tmpdir(), "filmlune-mcp-catalog-test-"));
    try {
      await cp(path.join(ROOT, "catalog"), path.join(second, "catalog"), { recursive: true });
      await cp(path.join(ROOT, "schemas"), path.join(second, "schemas"), { recursive: true });
      await writeFile(path.join(second, "catalog/cases/extra.json"), "{}\n", "utf8");
      await assert.rejects(validateCatalog(second), /BLOCK_MCP_CATALOG_DRIFT/);
    } finally {
      await rm(second, { recursive: true, force: true });
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
