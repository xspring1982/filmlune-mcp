// @ts-check

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateCatalog } from "../src/catalog-reader/validate-catalog.mjs";
import { getCase } from "../src/tools/get-case.mjs";
import { getChanges } from "../src/tools/get-changes.mjs";
import { listModels } from "../src/tools/list-models.mjs";
import { listTaxonomy } from "../src/tools/list-taxonomy.mjs";
import { searchCases } from "../src/tools/search-cases.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string|Uint8Array} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} value @returns {string} */
function canonical(value) {
  /** @param {unknown} entry @returns {unknown} */
  const sort = (entry) => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (typeof entry !== "object" || entry === null) return entry;
    return Object.fromEntries(Object.entries(entry).sort(([left], [right]) =>
      left.localeCompare(right, "en")).map(([key, child]) => [key, sort(child)]));
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/**
 * Add one website-projected external record to a temporary generated tree.
 * The real repository catalog remains byte-for-byte untouched.
 * @param {string} target
 */
async function addExternalRecord(target) {
  const manifestPath = path.join(target, "catalog/manifest.json");
  /** @type {any} */
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const modelsPath = path.join(target, "catalog/models.json");
  /** @type {any} */
  const models = JSON.parse(await readFile(modelsPath, "utf8"));
  const model = models.models.find((/** @type {any} */ entry) => entry.mediaType === "video");
  assert.ok(model);
  const provenance = {
    generatorSha256: manifest.generator.sha256,
    generatorVersion: manifest.generator.version,
    websiteSourceRevision: manifest.source.revision,
    websiteSourceSha256: manifest.source.sha256,
  };
  const promptText = "Create a continuous moonlit railway-platform shot with natural motion and a quiet wide ending.";
  const record = {
    schemaVersion: 1,
    kind: "reusable_case",
    publicationState: "local_contract_fixture",
    caseId: "cev_0201",
    caseRevisionId: "cev_0201@r0001",
    canonicalUrl: "https://filmlune.com/prompts/video/scene-ferroviaire-cev_0201/",
    locale: "fr",
    mediaType: "video",
    titleFr: "Scène ferroviaire au clair de lune",
    summaryFr: "Une recette vidéo courte avec continuité visuelle.",
    purposeFr: "Préparer un plan autonome sans reprendre le média externe.",
    methodFr: "Décrire le mouvement, la lumière et la fin du plan.",
    variables: [{ name: "Ambiance", value: "Clair de lune" }],
    model: {
      modelFamilyId: model.modelFamilyId,
      modelId: `${model.modelFamilyId}-external`,
      modelVersion: "synthetic-test-v1",
      capabilityRevisionId: `capability_${model.modelFamilyId.replaceAll("-", "_")}@2026-08-13`,
      displayName: model.displayName,
    },
    taxonomy: [
      { id: "media-video", labelFr: "Vidéo", axis: "media" },
      { id: `model-${model.modelFamilyId}`, labelFr: model.displayName, axis: "model" },
      { id: "usage-scene-cinematographique", labelFr: "Scène cinématographique", axis: "use_case" },
    ],
    creator: { displayName: "Auteur public", handle: "@public_author", profileUrl: null },
    source: {
      kind: "external_locator",
      canonicalUrl: "https://x.com/public_author/status/201",
      publicEvidenceUrl: "https://x.com/public_author/status/201",
    },
    provenance,
    rights: {
      decision: "licensed",
      sourceLink: "allow",
      prompt: "allow",
      media: "deny",
      social: "deny",
      mcp: "allow",
    },
    prompt: {
      availability: "available",
      variants: [{
        variantId: "ppv_201_01",
        stepIndex: 1,
        kind: "video",
        inputMode: "video_direct",
        labelFr: "VIDEO · 1",
        promptText,
        promptSha256: sha256(promptText),
        promptRevisionId: "candidate_external@prompt-r0001",
        adaptationClass: "independent_filmlune_rewrite",
        adaptationLabelFr: "Adaptation indépendante FilmLune",
        promptAuthorDisplayName: "FilmLune",
      }],
    },
    media: [],
    recipe: [{
      stepId: "step_cev_0201_01",
      stepIndex: 1,
      kind: "video",
      inputMode: "video_direct",
      labelFr: "VIDEO · 1",
      variantId: "ppv_201_01",
      inputAssetIds: [],
      outputAssetIds: [],
      recipeContractVersion: 2,
      requiredAssetRoles: [],
      generatedOutputRole: "generated_video",
      externalMediaBindings: [],
      mediaBindingPolicy: "user_or_filmlune_rights_clear_asset_only",
    }],
    reportUrl: "/signaler/cev_0201/",
  };
  const recordRelative = "catalog/cases/cev_0201.json";
  const recordBytes = canonical(record);
  await writeFile(path.join(target, recordRelative), recordBytes, "utf8");

  model.activeCaseIds.push(record.caseId);
  const modelBytes = canonical(models);
  await writeFile(modelsPath, modelBytes, "utf8");

  const taxonomyPath = path.join(target, "catalog/taxonomy.json");
  /** @type {any} */
  const taxonomy = JSON.parse(await readFile(taxonomyPath, "utf8"));
  for (const entry of record.taxonomy) {
    const existing = taxonomy.taxonomy.find((/** @type {any} */ candidate) => candidate.id === entry.id);
    if (existing) existing.activeCaseIds.push(record.caseId);
    else taxonomy.taxonomy.push({ ...entry, activeCaseIds: [record.caseId] });
  }
  taxonomy.taxonomy.sort((/** @type {any} */ left, /** @type {any} */ right) =>
    left.id.localeCompare(right.id, "en"));
  const taxonomyBytes = canonical(taxonomy);
  await writeFile(taxonomyPath, taxonomyBytes, "utf8");

  manifest.activeIds.push(record.caseId);
  const externalChange = {
    changeId: `change-${record.caseRevisionId}`,
    caseId: record.caseId,
    caseRevisionId: record.caseRevisionId,
    changeKind: "upserted",
    changedAtUtc: "2026-08-13T09:00:00.000Z",
    provenance,
  };
  manifest.changes = [
    ...manifest.changes.filter((/** @type {any} */ { changeKind }) => changeKind === "upserted"),
    externalChange,
    ...manifest.changes.filter((/** @type {any} */ { changeKind }) => changeKind === "removed"),
  ];
  const updates = new Map([
    [recordRelative, sha256(recordBytes)],
    ["catalog/models.json", sha256(modelBytes)],
    ["catalog/taxonomy.json", sha256(taxonomyBytes)],
  ]);
  manifest.files = manifest.files.filter((/** @type {any} */ { path: relative }) => !updates.has(relative));
  for (const [relative, hash] of updates) manifest.files.push({ path: relative, sha256: hash });
  manifest.files.sort((/** @type {any} */ left, /** @type {any} */ right) =>
    left.path.localeCompare(right.path, "en"));
  manifest.modelsSha256 = updates.get("catalog/models.json");
  manifest.taxonomySha256 = updates.get("catalog/taxonomy.json");
  await writeFile(manifestPath, canonical(manifest), "utf8");
}

/**
 * Replace the temporary external active record with a website-master removal projection.
 * @param {string} target
 */
async function removeExternalRecord(target) {
  const manifestPath = path.join(target, "catalog/manifest.json");
  /** @type {any} */
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const provenance = {
    generatorSha256: manifest.generator.sha256,
    generatorVersion: manifest.generator.version,
    websiteSourceRevision: manifest.source.revision,
    websiteSourceSha256: manifest.source.sha256,
  };
  const caseId = "cev_0201";
  const caseRevisionId = "cev_0201@r0002";
  const tombstone = {
    schemaVersion: 1,
    kind: "tombstone",
    caseId,
    caseRevisionId,
    status: "removed",
    removedAtUtc: "2026-08-13T10:00:00.000Z",
    reasonCode: "SourceRemoved",
    reportUrl: "/signaler/cev_0201/",
    provenance,
    rights: {
      decision: "rejected",
      sourceLink: "allow",
      prompt: "deny",
      media: "deny",
      social: "deny",
      mcp: "deny",
    },
  };

  await rm(path.join(target, "catalog/cases/cev_0201.json"));
  const tombstoneRelative = "catalog/tombstones/cev_0201.json";
  const tombstoneBytes = canonical(tombstone);
  await writeFile(path.join(target, tombstoneRelative), tombstoneBytes, "utf8");

  const catalogRevision = `mcp-external-removed-${sha256(canonical({
    caseId,
    caseRevisionId,
    source: manifest.source,
    generator: manifest.generator,
  })).slice(0, 16)}`;
  const modelsPath = path.join(target, "catalog/models.json");
  /** @type {any} */
  const models = JSON.parse(await readFile(modelsPath, "utf8"));
  models.catalogRevision = catalogRevision;
  for (const model of models.models) {
    model.activeCaseIds = model.activeCaseIds.filter((/** @type {string} */ id) => id !== caseId);
  }
  const modelBytes = canonical(models);
  await writeFile(modelsPath, modelBytes, "utf8");

  const taxonomyPath = path.join(target, "catalog/taxonomy.json");
  /** @type {any} */
  const taxonomy = JSON.parse(await readFile(taxonomyPath, "utf8"));
  taxonomy.catalogRevision = catalogRevision;
  for (const entry of taxonomy.taxonomy) {
    entry.activeCaseIds = entry.activeCaseIds.filter((/** @type {string} */ id) => id !== caseId);
  }
  const taxonomyBytes = canonical(taxonomy);
  await writeFile(taxonomyPath, taxonomyBytes, "utf8");

  manifest.catalogRevision = catalogRevision;
  manifest.activeIds = manifest.activeIds.filter((/** @type {string} */ id) => id !== caseId);
  manifest.tombstoneIds.push(caseId);
  manifest.tombstoneIds.sort((/** @type {string} */ left, /** @type {string} */ right) =>
    left.localeCompare(right, "en"));
  const removedChanges = [
    ...manifest.changes.filter((/** @type {any} */ change) =>
      change.caseId !== caseId && change.changeKind === "removed"),
    {
      changeId: `change-${caseRevisionId}-removed`,
      caseId,
      caseRevisionId,
      changeKind: "removed",
      changedAtUtc: tombstone.removedAtUtc,
      provenance,
    },
  ].sort((/** @type {any} */ left, /** @type {any} */ right) =>
    left.caseId.localeCompare(right.caseId, "en"));
  manifest.changes = [
    ...manifest.changes.filter((/** @type {any} */ change) =>
      change.caseId !== caseId && change.changeKind === "upserted"),
    ...removedChanges,
  ];
  const updates = new Map([
    [tombstoneRelative, sha256(tombstoneBytes)],
    ["catalog/models.json", sha256(modelBytes)],
    ["catalog/taxonomy.json", sha256(taxonomyBytes)],
  ]);
  manifest.files = manifest.files.filter((/** @type {any} */ { path: relative }) =>
    relative !== "catalog/cases/cev_0201.json" && !updates.has(relative));
  for (const [relative, hash] of updates) manifest.files.push({ path: relative, sha256: hash });
  manifest.files.sort((/** @type {any} */ left, /** @type {any} */ right) =>
    left.path.localeCompare(right.path, "en"));
  manifest.modelsSha256 = updates.get("catalog/models.json");
  manifest.taxonomySha256 = updates.get("catalog/taxonomy.json");
  await writeFile(manifestPath, canonical(manifest), "utf8");
}

test("media-free external prompt recipe validates and is readable through all five tool domains", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "filmlune-external-mcp-"));
  try {
    await cp(path.join(ROOT, "catalog"), path.join(target, "catalog"), { recursive: true });
    await cp(path.join(ROOT, "schemas"), path.join(target, "schemas"), { recursive: true });
    await addExternalRecord(target);
    const catalog = await validateCatalog(target);
    const record = getCase(catalog, { caseId: "cev_0201" });
    assert.equal(record.kind, "reusable_case");
    if (record.kind !== "reusable_case" || !record.recipe) throw new Error("EXPECTED_REUSABLE_CASE");
    const recipe = /** @type {Array<Record<string,unknown>>} */ (record.recipe);
    assert.equal(record.rights.media, "deny");
    assert.deepEqual(record.media, []);
    assert.equal(recipe.length, 1);
    assert.deepEqual(recipe[0]?.externalMediaBindings, []);

    assert.deepEqual(searchCases(catalog, { query: "railway", limit: 50 }).items
      .map(({ caseId }) => caseId), ["cev_0201"]);
    assert.ok(listModels(catalog, { mediaType: "video", limit: 50 }).items
      .some(({ activeCaseIds }) => activeCaseIds.includes("cev_0201")));
    assert.ok(listTaxonomy(catalog, { axis: "use_case", limit: 50 }).items
      .some(({ activeCaseIds }) => activeCaseIds.includes("cev_0201")));
    assert.ok(getChanges(catalog, { changeKind: "upserted", limit: 50 }).items
      .some(({ caseId }) => caseId === "cev_0201"));

    const serialized = JSON.stringify(record);
    assert.doesNotMatch(serialized, /publicUrl|mediaAssets|rawPrompt|sourceRaw/i);
    assert.deepEqual(recipe[0]?.inputAssetIds, []);
    assert.deepEqual(recipe[0]?.outputAssetIds, []);
    assert.equal((serialized.match(/https:\/\/x\.com\//g) ?? []).length, 2);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("website-master removal becomes a hash-bound media-free tombstone across all five tool domains", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "filmlune-external-mcp-removal-"));
  try {
    await cp(path.join(ROOT, "catalog"), path.join(target, "catalog"), { recursive: true });
    await cp(path.join(ROOT, "schemas"), path.join(target, "schemas"), { recursive: true });
    await addExternalRecord(target);
    await removeExternalRecord(target);

    const catalog = await validateCatalog(target);
    assert.equal(catalog.cases.has("cev_0201"), false);
    assert.equal(catalog.tombstones.has("cev_0201"), true);
    const current = getCase(catalog, { caseId: "cev_0201" });
    assert.equal(current.kind, "tombstone");
    assert.equal(current.caseRevisionId, "cev_0201@r0002");
    assert.deepEqual(getCase(catalog, {
      caseId: "cev_0201",
      caseRevisionId: "cev_0201@r0002",
    }), current);
    assert.throws(() => getCase(catalog, {
      caseId: "cev_0201",
      caseRevisionId: "cev_0201@r0001",
    }), /MCP_STALE_CASE_REVISION/);

    assert.deepEqual(searchCases(catalog, { query: "railway", limit: 50 }).items, []);
    assert.equal(listModels(catalog, { mediaType: "video", limit: 50 }).items
      .some(({ activeCaseIds }) => activeCaseIds.includes("cev_0201")), false);
    assert.equal(listTaxonomy(catalog, { axis: "use_case", limit: 50 }).items
      .some(({ activeCaseIds }) => activeCaseIds.includes("cev_0201")), false);
    assert.deepEqual(getChanges(catalog, { changeKind: "removed", limit: 50 }).items
      .filter(({ caseId }) => caseId === "cev_0201")
      .map(({ caseRevisionId }) => caseRevisionId), ["cev_0201@r0002"]);

    const serialized = JSON.stringify(current);
    assert.doesNotMatch(serialized, /promptText|mediaAssets|creator|titleFr|canonicalUrl|x\.com|sourceRaw/i);
    assert.deepEqual(Object.keys(current).sort(), [
      "caseId", "caseRevisionId", "kind", "provenance", "reasonCode", "removedAtUtc",
      "reportUrl", "rights", "schemaVersion", "status",
    ]);
    assert.match(catalog.manifest.catalogRevision, /^mcp-external-removed-[a-f0-9]{16}$/);
    assert.equal(catalog.manifest.activeIds.includes("cev_0201"), false);
    assert.equal(catalog.manifest.tombstoneIds.includes("cev_0201"), true);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
