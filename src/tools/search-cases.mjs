// @ts-check
import { casePreview } from "./get-case.mjs";

import { exactInput, paginate, scopeHash } from "../catalog-reader/load-catalog.mjs";

/**
 * @param {Awaited<ReturnType<import("../catalog-reader/load-catalog.mjs").loadCatalog>>} catalog
 * @param {unknown} value
 */
export function searchCases(catalog, value) {
  const input = exactInput(value, [
    "cursor", "limit", "mediaType", "modelFamilyId", "outputLanguage", "query", "taxonomyId",
  ]);
  const optionalText = (/** @type {unknown} */ entry, /** @type {string} */ name) => {
    if (entry === undefined) return null;
    if (typeof entry !== "string" || entry.trim() !== entry || entry.length === 0) {
      throw new Error(`MCP_INVALID_${name.toUpperCase()}`);
    }
    return entry;
  };
  const query = optionalText(input.query, "query")?.toLocaleLowerCase("en") ?? null;
  const mediaType = optionalText(input.mediaType, "media_type");
  if (mediaType !== null && mediaType !== "image" && mediaType !== "video") {
    throw new Error("MCP_INVALID_MEDIA_TYPE");
  }
  const modelFamilyId = optionalText(input.modelFamilyId, "model_family_id");
  const outputLanguage = optionalText(input.outputLanguage, "output_language");
  if (outputLanguage !== null) {
    try {
      const canonical = Intl.getCanonicalLocales(outputLanguage);
      if (canonical.length !== 1 || canonical[0] !== outputLanguage) {
        throw new Error("MCP_INVALID_OUTPUT_LANGUAGE");
      }
    } catch {
      throw new Error("MCP_INVALID_OUTPUT_LANGUAGE");
    }
  }
  const taxonomyId = optionalText(input.taxonomyId, "taxonomy_id");
  const scope = scopeHash({ query, mediaType, modelFamilyId, outputLanguage, taxonomyId });
  const matched = [...catalog.cases.values()].filter((record) => {
    if (record.kind === "locator_only") {
      return mediaType === null && modelFamilyId === null && outputLanguage === null
        && taxonomyId === null
        && (query === null || String(record.source.canonicalUrl).toLocaleLowerCase("en").includes(query));
    }
    const model = /** @type {Record<string,unknown>} */ (record.model);
    const taxonomy = /** @type {Array<Record<string,unknown>>} */ (record.taxonomy);
    if (mediaType !== null && record.mediaType !== mediaType) return false;
    if (modelFamilyId !== null && model.modelFamilyId !== modelFamilyId) return false;
    if (outputLanguage !== null && record.outputLanguage !== outputLanguage
      && !(outputLanguage !== "und" && record.outputLanguage === "und")) return false;
    if (taxonomyId !== null && !taxonomy.some(({ id }) => id === taxonomyId)) return false;
    if (query === null) return true;
    const prompt = record.prompt?.variants.map((variant) =>
      String(/** @type {Record<string,unknown>} */ (variant).promptText ?? "")).join(" ") ?? "";
    return [record.title, record.summary, prompt]
      .some((entry) => String(entry).toLocaleLowerCase("en").includes(query));
  }).sort((left, right) => left.caseId.localeCompare(right.caseId, "en"));
  const summaries = matched.map((record) => record.kind === "locator_only" ? {
    kind: record.kind,
    caseId: record.caseId,
    caseRevisionId: record.caseRevisionId,
    source: record.source,
    provenance: record.provenance,
    rights: record.rights,
  } : {
    kind: record.kind,
    caseId: record.caseId,
    caseRevisionId: record.caseRevisionId,
    caseFamilyId: record.caseFamilyId,
    outputVariantId: record.outputVariantId,
    outputLanguage: record.outputLanguage,
    canonicalUrl: record.canonicalUrl,
    mediaType: record.mediaType,
    title: record.title,
    summary: record.summary,
    preview: casePreview(record),
    model: record.model,
    taxonomy: record.taxonomy,
    provenance: record.provenance,
    rights: record.rights,
  });
  const page = paginate(summaries, input, catalog.manifest.catalogRevision, scope);
  return { catalogRevision: catalog.manifest.catalogRevision, ...page };
}
