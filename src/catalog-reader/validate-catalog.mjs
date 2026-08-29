// @ts-check

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const BLOCK = "BLOCK_MCP_CATALOG_DRIFT";
const CASE_ID = /^cev_[0-9]{4}$/;
const FAMILY_ID = /^cf_[a-z0-9_]+$/;
const OUTPUT_VARIANT_ID = /^ov_[a-z0-9_]+_r[0-9]{4}$/;
const PROTECTED_LITERAL_ROLES = new Set([
  "dialogue",
  "headline",
  "on_screen_text",
  "spoken_text",
  "ui_text",
  "visible_text",
]);

/** @typedef {{path:string,sha256:string}} ManifestFile */
/** @typedef {{caseId:string,caseRevisionId:string,changeKind:"upserted"|"removed",changeId:string,changedAtUtc:string,provenance:Record<string,unknown>}} CatalogChange */
/** @typedef {{schemaVersion:2,catalogRevision:string,activeIds:string[],tombstoneIds:string[],files:ManifestFile[],changes:CatalogChange[],generator:{version:string,sha256:string},presentation:{language:"en",revision:string,sha256:string},source:{websiteRepository:string,revision:string,sha256:string},schemaHashes:{caseV2:string,manifestV2:string,tombstoneV1:string},modelsSha256:string,taxonomySha256:string}} CatalogManifest */
/** @typedef {{schemaVersion:2,kind:"reusable_case"|"locator_only",caseId:string,caseRevisionId:string,caseFamilyId?:string,outputVariantId?:string,canonicalUrl?:string,presentationLanguage?:"en",outputLanguage?:string,publicationState?:string,mediaType?:"image"|"video",title?:string,summary?:string,purpose?:string,method?:string,variables?:unknown[],model?:Record<string,unknown>,taxonomy?:unknown[],creator?:Record<string,unknown>,source:Record<string,unknown>,provenance:Record<string,unknown>,rights:Record<string,unknown>,prompt?:{availability:string,variants:Array<Record<string,unknown>>},media?:Array<Record<string,unknown>>,recipe?:Array<Record<string,unknown>>,reportUrl?:string}} CatalogCase */
/** @typedef {{schemaVersion:1,kind:"tombstone",caseId:string,caseRevisionId:string,status:"removed",removedAtUtc:string,reasonCode:string,reportUrl:string,provenance:Record<string,unknown>,rights:Record<string,unknown>}} CatalogTombstone */
/** @typedef {{schemaVersion:2,catalogRevision:string,models:Array<{modelFamilyId:string,displayName:string,mediaType:"image"|"video",activeCaseIds:string[]}>}} ModelsDocument */
/** @typedef {{schemaVersion:2,catalogRevision:string,taxonomy:Array<{id:string,label:string,axis:"media"|"model"|"use_case"|"collection"|"style",activeCaseIds:string[]}>}} TaxonomyDocument */
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

/** @param {Record<string,unknown>} value @param {readonly string[]} expected @returns {void} */
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

/** @param {unknown} value @returns {string|null} */
function nullableString(value) {
  return value === null ? null : string(value);
}

/** @param {unknown} value @returns {boolean} */
function boolean(value) {
  if (typeof value !== "boolean") fail();
  return value;
}

/** @param {unknown} value @param {number} minimum @returns {number} */
function integer(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail();
  return Number(value);
}

/** @param {unknown} value @returns {number|null} */
function nullablePositiveNumber(value) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail();
  return value;
}

/** @param {unknown} value @returns {string} */
function hash(value) {
  const result = string(value);
  if (!/^[a-f0-9]{64}$/.test(result)) fail();
  return result;
}

/** @param {unknown} value @param {boolean} emptyAllowed @returns {string[]} */
function stringArray(value, emptyAllowed = true) {
  if (!Array.isArray(value) || (!emptyAllowed && value.length === 0)) fail();
  const result = value.map(string);
  if (new Set(result).size !== result.length) fail();
  return result;
}

/** @param {unknown} value @returns {string} */
function canonicalLanguage(value) {
  const result = string(value);
  try {
    const canonical = Intl.getCanonicalLocales(result);
    if (canonical.length !== 1 || canonical[0] !== result) fail();
  } catch {
    fail();
  }
  return result;
}

/** @param {unknown} value @returns {string} */
function utc(value) {
  const result = string(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result)
    || Number.isNaN(Date.parse(result)) || new Date(result).toISOString() !== result) fail();
  return result;
}

/** @param {unknown} value @returns {string} */
function https(value) {
  const result = string(value);
  try {
    if (new URL(result).protocol !== "https:") fail();
  } catch {
    fail();
  }
  return result;
}

/** @param {unknown} value @returns {string|null} */
function nullableHttps(value) {
  return value === null ? null : https(value);
}

/** @param {unknown} value @returns {string} */
function publicPathOrHttps(value) {
  const result = string(value);
  if (result.startsWith("/")) {
    if (result.startsWith("//") || result.includes("..")) fail();
    return result;
  }
  return https(result);
}

/** @param {unknown} value @param {string} caseId @returns {string} */
function caseRevision(value, caseId) {
  const result = string(value);
  if (!new RegExp(`^${caseId}@r[0-9]{4}$`).test(result)) fail();
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
    "presentationRevision",
    "presentationSha256",
    "websiteSourceRevision",
    "websiteSourceSha256",
  ]);
  if (provenance.generatorSha256 !== manifest.generator.sha256
    || provenance.generatorVersion !== manifest.generator.version
    || provenance.presentationRevision !== manifest.presentation.revision
    || provenance.presentationSha256 !== manifest.presentation.sha256
    || provenance.websiteSourceRevision !== manifest.source.revision
    || provenance.websiteSourceSha256 !== manifest.source.sha256) fail();
}

/** @param {Record<string,unknown>} rights @param {"locator"|"reusable"|"tombstone"} kind @returns {void} */
function validateRights(rights, kind) {
  exactKeys(rights, ["decision", "mcp", "media", "prompt", "social", "sourceLink"]);
  if (rights.sourceLink !== "allow") fail();
  if (kind === "locator") {
    if (rights.decision !== "unknown" || rights.mcp !== "source_link_only") fail();
  } else if (kind === "reusable") {
    if ((rights.decision !== "owned"
      && rights.decision !== "licensed"
      && rights.decision !== "operator_risk_accepted")
      || rights.mcp !== "allow") fail();
  } else if (rights.decision !== "rejected" || rights.mcp !== "deny"
    || rights.prompt !== "deny" || rights.media !== "deny" || rights.social !== "deny") fail();
  for (const key of ["prompt", "media", "social"]) {
    if (rights[key] !== "allow" && rights[key] !== "deny") fail();
  }
}

/** @param {unknown} value @returns {Record<string,unknown>} */
function validateSource(value) {
  const source = object(value);
  exactKeys(source, ["canonicalUrl", "kind", "publicEvidenceUrl"]);
  const sourceKind = string(source.kind);
  if (!new Set(["first_party_fixture", "creator_submission", "external_locator"]).has(sourceKind)) fail();
  https(source.canonicalUrl);
  nullableHttps(source.publicEvidenceUrl);
  return source;
}

/** @param {unknown} value @param {string} promptText @returns {void} */
function validateProtectedLiteral(value, promptText) {
  const literal = object(value);
  exactKeys(literal, ["language", "mustRemainExact", "role", "value"]);
  canonicalLanguage(literal.language);
  if (literal.mustRemainExact !== true || !PROTECTED_LITERAL_ROLES.has(string(literal.role))) fail();
  const exactValue = string(literal.value);
  if (!promptText.includes(exactValue)) fail();
}

/**
 * @param {unknown} value
 * @param {string} outputLanguage
 * @param {number} expectedIndex
 * @param {string} creatorDisplayName
 * @returns {{variantId:string,label:string,external:boolean}}
 */
function validatePromptVariant(value, outputLanguage, expectedIndex, creatorDisplayName) {
  const variant = object(value);
  const base = [
    "inputMode", "instructionLanguage", "kind", "label", "promptSha256",
    "promptText", "protectedLiterals", "stepIndex", "variantId",
  ];
  const external = [
    "adaptationClass", "adaptationLabel", "promptAuthorDisplayName", "promptRevisionId",
  ];
  const hasExternal = external.some((key) => Object.hasOwn(variant, key));
  exactKeys(variant, hasExternal ? [...base, ...external] : base);
  const stepIndex = integer(variant.stepIndex, 1);
  if (stepIndex !== expectedIndex || variant.instructionLanguage !== "en"
    || (variant.kind !== "image" && variant.kind !== "video")) fail();
  string(variant.inputMode);
  const label = string(variant.label);
  const promptText = string(variant.promptText);
  if (hash(variant.promptSha256) !== sha256(promptText)) fail();
  const protectedLiterals = variant.protectedLiterals;
  if (!Array.isArray(protectedLiterals)) fail();
  for (const literal of protectedLiterals) validateProtectedLiteral(literal, promptText);
  if (outputLanguage === "und" && protectedLiterals.length > 0) fail();
  if (hasExternal) {
    const adaptationClass = string(variant.adaptationClass);
    if (!new Set([
      "source_exact_permitted",
      "licensed_adaptation",
      "independent_filmlune_rewrite",
    ]).has(adaptationClass)) fail();
    const expectedLabel = adaptationClass === "independent_filmlune_rewrite"
      ? "Independent FilmLune adaptation"
      : adaptationClass === "licensed_adaptation"
        ? "Licensed adaptation"
        : "Authorized source instruction";
    const expectedAuthor = adaptationClass === "independent_filmlune_rewrite"
      ? "FilmLune"
      : creatorDisplayName;
    if (variant.adaptationLabel !== expectedLabel
      || variant.promptAuthorDisplayName !== expectedAuthor) fail();
    string(variant.promptRevisionId);
  }
  return { variantId: string(variant.variantId), label, external: hasExternal };
}

/**
 * @param {unknown} value
 * @param {number} expectedIndex
 * @param {{variantId:string,label:string,external:boolean}} prompt
 * @param {ReadonlySet<string>} assetIds
 * @param {boolean} mediaDenied
 * @returns {void}
 */
function validateRecipeStep(value, expectedIndex, prompt, assetIds, mediaDenied) {
  const step = object(value);
  const base = [
    "inputAssetIds", "inputMode", "kind", "label", "outputAssetIds", "stepId",
    "stepIndex", "variantId",
  ];
  const external = [
    "externalMediaBindings", "generatedOutputRole", "mediaBindingPolicy",
    "recipeContractVersion", "requiredAssetRoles",
  ];
  const hasExternal = external.some((key) => Object.hasOwn(step, key));
  exactKeys(step, hasExternal ? [...base, ...external] : base);
  if (integer(step.stepIndex, 1) !== expectedIndex
    || step.variantId !== prompt.variantId || step.label !== prompt.label
    || (step.kind !== "image" && step.kind !== "video")) fail();
  string(step.stepId);
  string(step.inputMode);
  const inputAssetIds = stringArray(step.inputAssetIds);
  const outputAssetIds = stringArray(step.outputAssetIds);
  if ([...inputAssetIds, ...outputAssetIds].some((assetId) => !assetIds.has(assetId))) fail();
  if (hasExternal) {
    if (!prompt.external || step.recipeContractVersion !== 2
      || step.mediaBindingPolicy !== "user_or_filmlune_rights_clear_asset_only") fail();
    string(step.generatedOutputRole);
    stringArray(step.requiredAssetRoles);
    if (!Array.isArray(step.externalMediaBindings) || step.externalMediaBindings.length !== 0) fail();
    if (inputAssetIds.length !== 0 || outputAssetIds.length !== 0 || !mediaDenied) fail();
  } else if (prompt.external || mediaDenied) fail();
}

/** @param {CatalogManifest} manifest @param {string} caseId @param {"upserted"|"removed"} changeKind @returns {string} */
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
  const common = ["caseId", "caseRevisionId", "kind", "provenance", "rights", "schemaVersion", "source"];
  if (record.kind === "locator_only") exactKeys(record, common);
  else if (record.kind === "reusable_case") exactKeys(record, [
    ...common,
    "canonicalUrl", "caseFamilyId", "creator", "media", "mediaType", "method", "model",
    "outputLanguage", "outputVariantId", "presentationLanguage", "prompt",
    "publicationState", "purpose", "recipe", "reportUrl", "summary", "taxonomy",
    "title", "variables",
  ]);
  else fail();
  if (record.schemaVersion !== 2 || record.caseId !== expectedId || !CASE_ID.test(expectedId)
    || record.caseRevisionId !== manifestRevision(manifest, expectedId, "upserted")) fail();
  caseRevision(record.caseRevisionId, expectedId);
  validateProvenance(object(record.provenance), manifest);
  validateSource(record.source);
  if (record.kind === "locator_only") {
    validateRights(object(record.rights), "locator");
    return /** @type {CatalogCase} */ (record);
  }

  validateRights(object(record.rights), "reusable");
  const rights = object(record.rights);
  if ((record.publicationState !== "local_contract_fixture"
      && record.publicationState !== "website_master_projection")
    || record.presentationLanguage !== "en"
    || (record.mediaType !== "image" && record.mediaType !== "video")) fail();
  if (!FAMILY_ID.test(string(record.caseFamilyId))
    || !OUTPUT_VARIANT_ID.test(string(record.outputVariantId))) fail();
  const outputLanguage = canonicalLanguage(record.outputLanguage);
  https(record.canonicalUrl);
  string(record.title);
  string(record.summary);
  string(record.purpose);
  string(record.method);
  const variables = record.variables;
  if (!Array.isArray(variables) || variables.length === 0) fail();
  for (const value of variables) {
    const variable = object(value);
    exactKeys(variable, ["name", "value"]);
    string(variable.name);
    string(variable.value);
  }

  const model = object(record.model);
  exactKeys(model, ["capabilityRevisionId", "displayName", "modelFamilyId", "modelId", "modelVersion"]);
  for (const value of Object.values(model)) string(value);

  const taxonomy = record.taxonomy;
  if (!Array.isArray(taxonomy) || taxonomy.length === 0) fail();
  const taxonomyIds = taxonomy.map((value) => {
    const entry = object(value);
    exactKeys(entry, ["axis", "id", "label"]);
    if (!new Set(["media", "model", "use_case", "collection", "style"]).has(string(entry.axis))) fail();
    string(entry.label);
    return string(entry.id);
  });
  if (new Set(taxonomyIds).size !== taxonomyIds.length) fail();

  const creator = object(record.creator);
  exactKeys(creator, ["displayName", "handle", "profileUrl"]);
  const creatorDisplayName = string(creator.displayName);
  nullableString(creator.handle);
  nullableHttps(creator.profileUrl);

  const media = record.media;
  if (!Array.isArray(media)) fail();
  const requiresMediaSha256 = manifest.generator.version === "mcp-catalog-v3"
    && record.publicationState === "website_master_projection";
  const assetIds = new Set(media.map((value, index) => {
    const asset = object(value);
    const keys = [
      "alt", "assetId", "assetRevisionId", "bytes", "durationSeconds",
      "generationReferenceUse", "height", "kind", "mimeType", "ordinal", "posterUrl",
      "publicUrl", "role", "width",
    ];
    if (requiresMediaSha256) keys.push("sha256");
    exactKeys(asset, keys);
    const assetId = string(asset.assetId);
    if (asset.assetRevisionId !== `${assetId}@r0001` || integer(asset.ordinal, 1) !== index + 1
      || (asset.kind !== "image" && asset.kind !== "video")
      || (asset.mimeType !== "image/webp" && asset.mimeType !== "video/mp4")
      || (asset.kind === "image") !== (asset.mimeType === "image/webp")
      || !new Set(["hero", "reference", "keyframe", "output", "poster"]).has(string(asset.role))) fail();
    integer(asset.bytes, 1);
    integer(asset.width, 1);
    integer(asset.height, 1);
    nullablePositiveNumber(asset.durationSeconds);
    boolean(asset.generationReferenceUse);
    string(asset.alt);
    publicPathOrHttps(asset.publicUrl);
    if (asset.posterUrl !== null) publicPathOrHttps(asset.posterUrl);
    if (requiresMediaSha256) hash(asset.sha256);
    return assetId;
  }));
  if (assetIds.size !== media.length) fail();
  if ((rights.media === "allow") !== (media.length > 0)) fail();

  const prompt = object(record.prompt);
  exactKeys(prompt, ["availability", "variants"]);
  const variants = prompt.variants;
  if (!Array.isArray(variants)) fail();
  if ((rights.prompt === "allow") !== (prompt.availability === "available")
    || (rights.prompt === "allow") !== (variants.length > 0)) fail();
  const decodedPrompts = variants.map((variant, index) =>
    validatePromptVariant(variant, outputLanguage, index + 1, creatorDisplayName));
  if (new Set(decodedPrompts.map(({ variantId }) => variantId)).size !== decodedPrompts.length) fail();

  const recipe = record.recipe;
  if (!Array.isArray(recipe) || recipe.length !== variants.length) fail();
  recipe.forEach((step, index) => {
    const promptBinding = decodedPrompts[index];
    if (!promptBinding) fail();
    validateRecipeStep(step, index + 1, promptBinding, assetIds, rights.media === "deny");
  });
  const reportUrl = string(record.reportUrl);
  if (reportUrl !== `/signaler/${expectedId}/`) fail();
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
    || record.caseId !== expectedId || !CASE_ID.test(expectedId)
    || record.caseRevisionId !== manifestRevision(manifest, expectedId, "removed")) fail();
  caseRevision(record.caseRevisionId, expectedId);
  validateProvenance(object(record.provenance), manifest);
  validateRights(object(record.rights), "tombstone");
  utc(record.removedAtUtc);
  string(record.reasonCode);
  if (record.reportUrl !== `/signaler/${expectedId}/`) fail();
  return /** @type {CatalogTombstone} */ (record);
}

/** @param {unknown} value @returns {CatalogManifest} */
function decodeManifest(value) {
  const manifest = object(value);
  exactKeys(manifest, [
    "activeIds", "catalogRevision", "changes", "files", "generator", "modelsSha256",
    "presentation", "schemaHashes", "schemaVersion", "source", "taxonomySha256",
    "tombstoneIds",
  ]);
  if (manifest.schemaVersion !== 2) fail();
  const activeIds = stringArray(manifest.activeIds, false);
  const tombstoneIds = stringArray(manifest.tombstoneIds, false);
  if (activeIds.some((id) => !CASE_ID.test(id)) || tombstoneIds.some((id) => !CASE_ID.test(id))
    || activeIds.join("\n") !== [...activeIds].sort().join("\n")
    || tombstoneIds.join("\n") !== [...tombstoneIds].sort().join("\n")
    || activeIds.some((id) => tombstoneIds.includes(id))) fail();
  const generator = object(manifest.generator);
  exactKeys(generator, ["sha256", "version"]);
  const generatorVersion = string(generator.version);
  if (generatorVersion !== "mcp-catalog-v2" && generatorVersion !== "mcp-catalog-v3") fail();
  const presentation = object(manifest.presentation);
  exactKeys(presentation, ["language", "revision", "sha256"]);
  if (presentation.language !== "en") fail();
  const source = object(manifest.source);
  exactKeys(source, ["revision", "sha256", "websiteRepository"]);
  if (source.websiteRepository !== "filmlune.com") fail();
  const schemaHashes = object(manifest.schemaHashes);
  exactKeys(schemaHashes, ["caseV2", "manifestV2", "tombstoneV1"]);
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
    const expectedId = index < activeIds.length ? activeIds[index] : tombstoneIds[index - activeIds.length];
    if (expectedId === undefined) fail();
    const expectedKind = index < activeIds.length ? "upserted" : "removed";
    const revision = caseRevision(change.caseRevisionId, expectedId);
    if (change.caseId !== expectedId || change.changeKind !== expectedKind
      || change.changeId !== `change-${revision}${expectedKind === "removed" ? "-removed" : ""}`) fail();
    utc(change.changedAtUtc);
    return /** @type {CatalogChange} */ (change);
  });
  const result = /** @type {CatalogManifest} */ ({
    schemaVersion: 2,
    catalogRevision: string(manifest.catalogRevision),
    activeIds,
    tombstoneIds,
    files: fileRows,
    changes: decodedChanges,
    generator: { version: generatorVersion, sha256: hash(generator.sha256) },
    presentation: {
      language: "en",
      revision: string(presentation.revision),
      sha256: hash(presentation.sha256),
    },
    source: {
      websiteRepository: "filmlune.com",
      revision: string(source.revision),
      sha256: hash(source.sha256),
    },
    schemaHashes: {
      caseV2: hash(schemaHashes.caseV2),
      manifestV2: hash(schemaHashes.manifestV2),
      tombstoneV1: hash(schemaHashes.tombstoneV1),
    },
    modelsSha256: hash(manifest.modelsSha256),
    taxonomySha256: hash(manifest.taxonomySha256),
  });
  for (const change of result.changes) validateProvenance(change.provenance, result);
  return result;
}

/** @param {unknown} value @param {CatalogManifest} manifest @param {ReadonlyMap<string,CatalogCase>} cases @returns {ModelsDocument} */
function decodeModels(value, manifest, cases) {
  const document = object(value);
  exactKeys(document, ["catalogRevision", "models", "schemaVersion"]);
  if (document.schemaVersion !== 2 || document.catalogRevision !== manifest.catalogRevision
    || !Array.isArray(document.models)) fail();
  const seenModels = new Set();
  const seenCases = new Set();
  const models = document.models.map((value) => {
    const model = object(value);
    exactKeys(model, ["activeCaseIds", "displayName", "mediaType", "modelFamilyId"]);
    const modelFamilyId = string(model.modelFamilyId);
    if (seenModels.has(modelFamilyId) || (model.mediaType !== "image" && model.mediaType !== "video")) fail();
    seenModels.add(modelFamilyId);
    const activeCaseIds = stringArray(model.activeCaseIds, false);
    if (activeCaseIds.join("\n") !== [...activeCaseIds].sort().join("\n")) fail();
    for (const caseId of activeCaseIds) {
      const record = cases.get(caseId);
      if (!record || record.kind !== "reusable_case" || seenCases.has(caseId)
        || record.mediaType !== model.mediaType || record.model?.modelFamilyId !== modelFamilyId) fail();
      seenCases.add(caseId);
    }
    return {
      modelFamilyId,
      displayName: string(model.displayName),
      mediaType: /** @type {"image"|"video"} */ (model.mediaType),
      activeCaseIds,
    };
  });
  const reusableIds = [...cases.values()].filter(({ kind }) => kind === "reusable_case")
    .map(({ caseId }) => caseId).sort();
  if ([...seenCases].sort().join("\n") !== reusableIds.join("\n")) fail();
  return { schemaVersion: 2, catalogRevision: manifest.catalogRevision, models };
}

/** @param {unknown} value @param {CatalogManifest} manifest @param {ReadonlyMap<string,CatalogCase>} cases @returns {TaxonomyDocument} */
function decodeTaxonomy(value, manifest, cases) {
  const document = object(value);
  exactKeys(document, ["catalogRevision", "schemaVersion", "taxonomy"]);
  if (document.schemaVersion !== 2 || document.catalogRevision !== manifest.catalogRevision
    || !Array.isArray(document.taxonomy)) fail();
  /** @type {Set<string>} */
  const ids = new Set();
  const taxonomy = document.taxonomy.map((value) => {
    const entry = object(value);
    exactKeys(entry, ["activeCaseIds", "axis", "id", "label"]);
    const id = string(entry.id);
    const label = string(entry.label);
    if (ids.has(id) || !new Set(["media", "model", "use_case", "collection", "style"]).has(string(entry.axis))) fail();
    ids.add(id);
    const activeCaseIds = stringArray(entry.activeCaseIds, false);
    if (activeCaseIds.join("\n") !== [...activeCaseIds].sort().join("\n")) fail();
    for (const caseId of activeCaseIds) {
      const record = cases.get(caseId);
      if (!record || record.kind !== "reusable_case") fail();
      const matches = /** @type {Array<Record<string,unknown>>} */ (record.taxonomy)
        .filter((candidate) => candidate.id === id && candidate.label === label && candidate.axis === entry.axis);
      if (matches.length !== 1) fail();
    }
    return {
      id,
      label,
      axis: /** @type {"media"|"model"|"use_case"|"collection"|"style"} */ (entry.axis),
      activeCaseIds,
    };
  });
  if (taxonomy.map(({ id }) => id).join("\n") !== [...taxonomy].map(({ id }) => id).sort().join("\n")) fail();
  for (const record of cases.values()) {
    if (record.kind !== "reusable_case") continue;
    for (const entry of /** @type {Array<Record<string,unknown>>} */ (record.taxonomy)) {
      const catalogEntry = taxonomy.find(({ id }) => id === entry.id);
      if (!catalogEntry || !catalogEntry.activeCaseIds.includes(record.caseId)) fail();
    }
  }
  return { schemaVersion: 2, catalogRevision: manifest.catalogRevision, taxonomy };
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
    || fileHash("schemas/case.v2.schema.json") !== manifest.schemaHashes.caseV2
    || fileHash("schemas/tombstone.v1.schema.json") !== manifest.schemaHashes.tombstoneV1
    || fileHash("schemas/manifest.v2.schema.json") !== manifest.schemaHashes.manifestV2) fail();

  /** @type {Map<string,CatalogCase>} */
  const cases = new Map();
  const familyLanguages = new Set();
  for (const caseId of manifest.activeIds) {
    const record = decodeCase(
      await json(path.join(repositoryRoot, `catalog/cases/${caseId}.json`)),
      manifest,
      caseId,
    );
    if (record.kind === "reusable_case") {
      const identity = `${record.caseFamilyId}\u0000${record.outputLanguage}`;
      if (familyLanguages.has(identity)) fail();
      familyLanguages.add(identity);
    }
    cases.set(caseId, record);
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
  const models = decodeModels(await json(path.join(repositoryRoot, "catalog/models.json")), manifest, cases);
  const taxonomy = decodeTaxonomy(
    await json(path.join(repositoryRoot, "catalog/taxonomy.json")),
    manifest,
    cases,
  );
  return { manifest, cases, tombstones, models, taxonomy };
}
