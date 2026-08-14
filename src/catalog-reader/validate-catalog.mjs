// @ts-check

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const BLOCK = "BLOCK_MCP_CATALOG_DRIFT";

/** @typedef {{path:string,sha256:string}} ManifestFile */
/** @typedef {{caseId:string,caseRevisionId:string,changeKind:"upserted"|"removed",changeId:string,changedAtUtc:string,provenance:Record<string,unknown>}} CatalogChange */
/** @typedef {{schemaVersion:1,catalogRevision:string,activeIds:string[],tombstoneIds:string[],files:ManifestFile[],changes:CatalogChange[],generator:{version:string,sha256:string},source:{websiteRepository:string,revision:string,sha256:string},schemaHashes:Record<string,string>,modelsSha256:string,taxonomySha256:string}} CatalogManifest */
/** @typedef {{schemaVersion:1,kind:"reusable_case"|"locator_only",caseId:string,caseRevisionId:string,publicationState?:string,canonicalUrl?:string,locale?:string,mediaType?:string,titleFr?:string,summaryFr?:string,model?:Record<string,unknown>,taxonomy?:unknown[],creator?:Record<string,unknown>,source:Record<string,unknown>,provenance:Record<string,unknown>,rights:Record<string,unknown>,prompt?:{availability:string,variants:unknown[]},media?:unknown[],recipe?:unknown[]}} CatalogCase */
/** @typedef {{schemaVersion:1,kind:"tombstone",caseId:string,caseRevisionId:string,status:"removed",removedAtUtc:string,reasonCode:string,reportUrl:string,provenance:Record<string,unknown>,rights:Record<string,unknown>}} CatalogTombstone */
/** @typedef {{schemaVersion:1,catalogRevision:string,models:Array<{modelFamilyId:string,displayName:string,mediaType:"image"|"video",activeCaseIds:string[]}>}} ModelsDocument */
/** @typedef {{schemaVersion:1,catalogRevision:string,taxonomy:Array<{id:string,labelFr:string,axis:string,activeCaseIds:string[]}>}} TaxonomyDocument */
/** @typedef {{manifest:CatalogManifest,cases:Map<string,CatalogCase>,tombstones:Map<string,CatalogTombstone>,models:ModelsDocument,taxonomy:TaxonomyDocument}} ValidatedCatalog */

/** @param {string|Uint8Array} value @returns {string} */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @returns {never} */
function fail() {
  throw new Error(BLOCK);
}

/** @param {unknown} value @returns {Record<string,unknown>} */
function object(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail();
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {Record<string,unknown>} value @param {string[]} expected @returns {void} */
function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail();
}

/** @param {unknown} value @returns {string} */
function string(value) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) fail();
  return value;
}

/** @param {unknown} value @returns {string} */
function hash(value) {
  const result = string(value);
  if (!/^[a-f0-9]{64}$/.test(result)) fail();
  return result;
}

/** @param {unknown} value @returns {string[]} */
function stringArray(value) {
  if (!Array.isArray(value)) fail();
  const result = value.map(string);
  if (new Set(result).size !== result.length) fail();
  return result;
}

/** @param {string} relative @returns {string} */
function safePath(relative) {
  if (!/^(catalog|schemas)\/[a-z0-9_./-]+\.json$/.test(relative)
    || relative.includes("..") || path.isAbsolute(relative)) fail();
  return relative;
}

/** @param {string} directory @param {string} prefix @returns {Promise<string[]>} */
async function walk(directory, prefix) {
  /** @type {string[]} */
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = `${prefix}/${entry.name}`;
    const facts = await lstat(absolute);
    if (facts.isSymbolicLink()) fail();
    if (facts.isDirectory()) result.push(...await walk(absolute, relative));
    else if (facts.isFile() && entry.name.endsWith(".json")) result.push(safePath(relative));
    else fail();
  }
  return result.sort();
}

/** @param {string} absolute @returns {Promise<unknown>} */
async function json(absolute) {
  try {
    return JSON.parse(await readFile(absolute, "utf8"));
  } catch {
    fail();
  }
}

/** @param {Record<string,unknown>} provenance @param {CatalogManifest} manifest @returns {void} */
function validateProvenance(provenance, manifest) {
  exactKeys(provenance, [
    "generatorSha256",
    "generatorVersion",
    "websiteSourceRevision",
    "websiteSourceSha256",
  ]);
  if (provenance.generatorSha256 !== manifest.generator.sha256
    || provenance.generatorVersion !== manifest.generator.version
    || provenance.websiteSourceRevision !== manifest.source.revision
    || provenance.websiteSourceSha256 !== manifest.source.sha256) fail();
}

/** @param {Record<string,unknown>} rights @param {"active"|"tombstone"} kind @returns {void} */
function validateRights(rights, kind) {
  exactKeys(rights, ["decision", "mcp", "media", "prompt", "social", "sourceLink"]);
  if (rights.sourceLink !== "allow") fail();
  if (kind === "active") {
    if (!new Set(["owned", "licensed", "unknown"]).has(string(rights.decision))
      || !new Set(["allow", "source_link_only"]).has(string(rights.mcp))) fail();
  } else if (rights.decision !== "rejected" || rights.mcp !== "deny"
    || rights.prompt !== "deny" || rights.media !== "deny" || rights.social !== "deny") fail();
}

/**
 * @param {CatalogManifest} manifest
 * @param {string} caseId
 * @param {"upserted"|"removed"} changeKind
 * @returns {string}
 */
function manifestRevision(manifest, caseId, changeKind) {
  const matches = manifest.changes.filter((change) =>
    change.caseId === caseId && change.changeKind === changeKind);
  if (matches.length !== 1) fail();
  const match = matches[0];
  if (match === undefined) fail();
  return match.caseRevisionId;
}

/** @param {unknown} value @param {CatalogManifest} manifest @param {string} expectedId @returns {CatalogCase} */
function decodeCase(value, manifest, expectedId) {
  const record = object(value);
  const kind = record.kind;
  const common = ["caseId", "caseRevisionId", "kind", "provenance", "rights", "schemaVersion", "source"];
  if (kind === "locator_only") exactKeys(record, common);
  else if (kind === "reusable_case") exactKeys(record, [
    ...common,
    "canonicalUrl", "creator", "locale", "media", "mediaType", "methodFr", "model",
    "prompt", "publicationState", "purposeFr", "recipe", "reportUrl", "summaryFr",
    "taxonomy", "titleFr", "variables",
  ]);
  else fail();
  if (record.schemaVersion !== 1 || record.caseId !== expectedId
    || record.caseRevisionId !== manifestRevision(manifest, expectedId, "upserted")) fail();
  const provenance = object(record.provenance);
  const rights = object(record.rights);
  validateProvenance(provenance, manifest);
  validateRights(rights, "active");
  const source = object(record.source);
  exactKeys(source, ["canonicalUrl", "kind", "publicEvidenceUrl"]);
  if (!string(source.canonicalUrl).startsWith("https://")) fail();
  if (kind === "locator_only") {
    if (rights.decision !== "unknown" || rights.mcp !== "source_link_only") fail();
  } else {
    if (record.publicationState !== "local_contract_fixture" || record.locale !== "fr"
      || (record.mediaType !== "image" && record.mediaType !== "video")
      || rights.mcp !== "allow" || !Array.isArray(record.taxonomy)) fail();
    const prompt = object(record.prompt);
    const variants = prompt.variants;
    const media = record.media;
    const recipe = record.recipe;
    exactKeys(prompt, ["availability", "variants"]);
    if (!Array.isArray(variants) || !Array.isArray(media) || !Array.isArray(recipe)) fail();
    if ((rights.prompt === "allow") !== (prompt.availability === "available")) fail();
    if (rights.prompt === "deny" && (variants.length !== 0 || recipe.length !== 0)) fail();
    if (rights.media === "deny") {
      for (const value of variants) {
        const variant = object(value);
        if (variant.adaptationClass === "independent_filmlune_rewrite") {
          if (variant.adaptationLabelFr !== "Adaptation indépendante FilmLune"
            || variant.promptAuthorDisplayName !== "FilmLune") fail();
          string(variant.promptRevisionId);
        }
      }
      if (media.length !== 0 || rights.prompt !== "allow" || recipe.length === 0) fail();
      for (const value of recipe) {
        const step = object(value);
        exactKeys(step, [
          "externalMediaBindings", "generatedOutputRole", "inputAssetIds", "inputMode",
          "kind", "labelFr", "mediaBindingPolicy", "outputAssetIds", "recipeContractVersion",
          "requiredAssetRoles", "stepId", "stepIndex", "variantId",
        ]);
        if (step.recipeContractVersion !== 2
          || step.mediaBindingPolicy !== "user_or_filmlune_rights_clear_asset_only"
          || stringArray(step.inputAssetIds).length !== 0
          || stringArray(step.outputAssetIds).length !== 0
          || stringArray(step.externalMediaBindings).length !== 0
          || !Array.isArray(step.requiredAssetRoles)) fail();
        stringArray(step.requiredAssetRoles);
        string(step.generatedOutputRole);
      }
    }
  }
  return /** @type {CatalogCase} */ (record);
}

/** @param {unknown} value @param {CatalogManifest} manifest @param {string} expectedId @returns {CatalogTombstone} */
function decodeTombstone(value, manifest, expectedId) {
  const record = object(value);
  exactKeys(record, [
    "caseId", "caseRevisionId", "kind", "provenance", "reasonCode", "removedAtUtc",
    "reportUrl", "rights", "schemaVersion", "status",
  ]);
  if (record.schemaVersion !== 1 || record.kind !== "tombstone" || record.status !== "removed"
    || record.caseId !== expectedId
    || record.caseRevisionId !== manifestRevision(manifest, expectedId, "removed")) fail();
  validateProvenance(object(record.provenance), manifest);
  validateRights(object(record.rights), "tombstone");
  string(record.removedAtUtc);
  string(record.reasonCode);
  string(record.reportUrl);
  return /** @type {CatalogTombstone} */ (record);
}

/** @param {unknown} value @returns {CatalogManifest} */
function decodeManifest(value) {
  const manifest = object(value);
  exactKeys(manifest, [
    "activeIds", "catalogRevision", "changes", "files", "generator", "modelsSha256",
    "schemaHashes", "schemaVersion", "source", "taxonomySha256", "tombstoneIds",
  ]);
  if (manifest.schemaVersion !== 1) fail();
  const activeIds = stringArray(manifest.activeIds);
  const tombstoneIds = stringArray(manifest.tombstoneIds);
  if (activeIds.length < 1 || tombstoneIds.length < 1
    || activeIds.some((id) => !/^cev_[0-9]{4}$/.test(id))
    || tombstoneIds.some((id) => !/^cev_[0-9]{4}$/.test(id))
    || activeIds.join("\n") !== [...activeIds].sort().join("\n")
    || tombstoneIds.join("\n") !== [...tombstoneIds].sort().join("\n")
    || activeIds.some((id) => tombstoneIds.includes(id))) fail();
  const generator = object(manifest.generator);
  exactKeys(generator, ["sha256", "version"]);
  const source = object(manifest.source);
  exactKeys(source, ["revision", "sha256", "websiteRepository"]);
  if (source.websiteRepository !== "filmlune.com") fail();
  const schemaHashes = object(manifest.schemaHashes);
  exactKeys(schemaHashes, ["caseV1", "manifestV1", "tombstoneV1"]);
  const files = manifest.files;
  if (!Array.isArray(files) || files.length !== activeIds.length + tombstoneIds.length + 5) fail();
  const fileRows = files.map((entry) => {
    const row = object(entry);
    exactKeys(row, ["path", "sha256"]);
    return { path: safePath(string(row.path)), sha256: hash(row.sha256) };
  });
  const paths = fileRows.map(({ path: relative }) => relative);
  if (new Set(paths).size !== paths.length || paths.join("\n") !== [...paths].sort().join("\n")) fail();
  const changes = manifest.changes;
  if (!Array.isArray(changes) || changes.length !== activeIds.length + tombstoneIds.length) fail();
  const decodedChanges = changes.map((entry, index) => {
    const change = object(entry);
    exactKeys(change, ["caseId", "caseRevisionId", "changeId", "changeKind", "changedAtUtc", "provenance"]);
    const expectedId = index < activeIds.length
      ? activeIds[index]
      : tombstoneIds[index - activeIds.length];
    if (expectedId === undefined) fail();
    const expectedKind = index < activeIds.length ? "upserted" : "removed";
    const caseRevisionId = string(change.caseRevisionId);
    if (change.caseId !== expectedId
      || !new RegExp(`^${expectedId}@r[0-9]{4}$`).test(caseRevisionId)
      || change.changeKind !== expectedKind
      || change.changeId !== `change-${caseRevisionId}${expectedKind === "removed" ? "-removed" : ""}`) fail();
    string(change.changedAtUtc);
    return /** @type {CatalogChange} */ (change);
  });
  const result = /** @type {CatalogManifest} */ ({
    schemaVersion: 1,
    catalogRevision: string(manifest.catalogRevision),
    activeIds,
    tombstoneIds,
    files: fileRows,
    changes: decodedChanges,
    generator: { version: string(generator.version), sha256: hash(generator.sha256) },
    source: {
      websiteRepository: "filmlune.com",
      revision: string(source.revision),
      sha256: hash(source.sha256),
    },
    schemaHashes: {
      caseV1: hash(schemaHashes.caseV1),
      manifestV1: hash(schemaHashes.manifestV1),
      tombstoneV1: hash(schemaHashes.tombstoneV1),
    },
    modelsSha256: hash(manifest.modelsSha256),
    taxonomySha256: hash(manifest.taxonomySha256),
  });
  for (const change of result.changes) validateProvenance(change.provenance, result);
  return result;
}

/** @param {string} repositoryRoot @returns {Promise<ValidatedCatalog>} */
export async function validateCatalog(repositoryRoot) {
  const rootFacts = await lstat(repositoryRoot);
  if (!rootFacts.isDirectory() || rootFacts.isSymbolicLink()) fail();
  const manifest = decodeManifest(await json(path.join(repositoryRoot, "catalog/manifest.json")));
  const actualPaths = [
    ...await walk(path.join(repositoryRoot, "catalog"), "catalog"),
    ...await walk(path.join(repositoryRoot, "schemas"), "schemas"),
  ].sort();
  const expectedPaths = [...manifest.files.map(({ path: relative }) => relative), "catalog/manifest.json"].sort();
  if (actualPaths.join("\n") !== expectedPaths.join("\n")) fail();
  for (const row of manifest.files) {
    if (sha256(await readFile(path.join(repositoryRoot, row.path))) !== row.sha256) fail();
  }
  const fileHash = (/** @type {string} */ relative) =>
    manifest.files.find((entry) => entry.path === relative)?.sha256 ?? fail();
  if (fileHash("catalog/models.json") !== manifest.modelsSha256
    || fileHash("catalog/taxonomy.json") !== manifest.taxonomySha256
    || fileHash("schemas/case.v1.schema.json") !== manifest.schemaHashes.caseV1
    || fileHash("schemas/tombstone.v1.schema.json") !== manifest.schemaHashes.tombstoneV1
    || fileHash("schemas/manifest.v1.schema.json") !== manifest.schemaHashes.manifestV1) fail();

  /** @type {Map<string,CatalogCase>} */
  const cases = new Map();
  for (const caseId of manifest.activeIds) {
    cases.set(caseId, decodeCase(
      await json(path.join(repositoryRoot, `catalog/cases/${caseId}.json`)),
      manifest,
      caseId,
    ));
  }
  /** @type {Map<string,CatalogTombstone>} */
  const tombstones = new Map();
  for (const caseId of manifest.tombstoneIds) {
    tombstones.set(caseId, decodeTombstone(
      await json(path.join(repositoryRoot, `catalog/tombstones/${caseId}.json`)),
      manifest,
      caseId,
    ));
  }
  const modelsRaw = object(await json(path.join(repositoryRoot, "catalog/models.json")));
  exactKeys(modelsRaw, ["catalogRevision", "models", "schemaVersion"]);
  const taxonomyRaw = object(await json(path.join(repositoryRoot, "catalog/taxonomy.json")));
  exactKeys(taxonomyRaw, ["catalogRevision", "schemaVersion", "taxonomy"]);
  if (modelsRaw.schemaVersion !== 1 || taxonomyRaw.schemaVersion !== 1
    || modelsRaw.catalogRevision !== manifest.catalogRevision
    || taxonomyRaw.catalogRevision !== manifest.catalogRevision
    || !Array.isArray(modelsRaw.models) || !Array.isArray(taxonomyRaw.taxonomy)) fail();
  return {
    manifest,
    cases,
    tombstones,
    models: /** @type {ModelsDocument} */ (modelsRaw),
    taxonomy: /** @type {TaxonomyDocument} */ (taxonomyRaw),
  };
}
