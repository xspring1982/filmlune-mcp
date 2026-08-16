// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "../src/catalog-reader/load-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("generated reusable records expose only explicitly allowed first-party fields", async () => {
  const catalog = await loadCatalog(ROOT);
  for (const record of catalog.cases.values()) {
    assert.equal(record.kind, "reusable_case");
    assert.equal(record.schemaVersion, 2);
    assert.equal(record.publicationState, "local_contract_fixture");
    assert.equal(record.presentationLanguage, "en");
    assert.equal(record.rights.mcp, "allow");
    const creator = record.creator;
    const prompt = record.prompt;
    const media = record.media;
    assert.ok(creator);
    assert.ok(prompt);
    assert.ok(media);
    assert.equal(creator.displayName, "FilmLune");
    assert.ok(prompt.variants.length >= 1);
    assert.ok(prompt.variants.every((variant) => variant.instructionLanguage === "en"));
    assert.equal(media.length, 2);
  }
  const serialized = JSON.stringify([...catalog.cases.values()]);
  assert.doesNotMatch(serialized, /privateRemix|operatorEmail|gmail|filesystem|generationAccount/i);
  assert.doesNotMatch(serialized, /"(?:locale|titleFr|summaryFr|purposeFr|methodFr|labelFr|altFr)"/);
});

test("tombstones never carry title, prompt, creator or media payloads", async () => {
  const catalog = await loadCatalog(ROOT);
  assert.equal(catalog.tombstones.size, catalog.manifest.tombstoneIds.length);
  for (const tombstone of catalog.tombstones.values()) {
    assert.deepEqual(Object.keys(tombstone).sort(), [
      "caseId",
      "caseRevisionId",
      "kind",
      "provenance",
      "reasonCode",
      "removedAtUtc",
      "reportUrl",
      "rights",
      "schemaVersion",
      "status",
    ]);
    assert.equal(tombstone.rights.mcp, "deny");
    assert.doesNotMatch(JSON.stringify(tombstone), /promptText|publicUrl|assetId|titleFr|creator/);
  }
});
