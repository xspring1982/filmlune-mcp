// @ts-check

import { exactInput, paginate, scopeHash } from "../catalog-reader/load-catalog.mjs";

/**
 * @param {Awaited<ReturnType<import("../catalog-reader/load-catalog.mjs").loadCatalog>>} catalog
 * @param {unknown} value
 */
export function searchCases(catalog, value) {
  const input = exactInput(value, ["cursor", "limit", "mediaType", "modelFamilyId", "query", "taxonomyId"]);
  const optionalText = (/** @type {unknown} */ entry, /** @type {string} */ name) => {
    if (entry === undefined) return null;
    if (typeof entry !== "string" || entry.trim() !== entry || entry.length === 0) {
      throw new Error(`MCP_INVALID_${name.toUpperCase()}`);
    }
    return entry;
  };
  const query = optionalText(input.query, "query")?.toLocaleLowerCase("fr") ?? null;
  const mediaType = optionalText(input.mediaType, "media_type");
  if (mediaType !== null && mediaType !== "image" && mediaType !== "video") {
    throw new Error("MCP_INVALID_MEDIA_TYPE");
  }
  const modelFamilyId = optionalText(input.modelFamilyId, "model_family_id");
  const taxonomyId = optionalText(input.taxonomyId, "taxonomy_id");
  const scope = scopeHash({ query, mediaType, modelFamilyId, taxonomyId });
  const matched = [...catalog.cases.values()].filter((record) => {
    if (record.kind === "locator_only") {
      return mediaType === null && modelFamilyId === null && taxonomyId === null
        && (query === null || String(record.source.canonicalUrl).toLocaleLowerCase("fr").includes(query));
    }
    const model = /** @type {Record<string,unknown>} */ (record.model);
    const taxonomy = /** @type {Array<Record<string,unknown>>} */ (record.taxonomy);
    if (mediaType !== null && record.mediaType !== mediaType) return false;
    if (modelFamilyId !== null && model.modelFamilyId !== modelFamilyId) return false;
    if (taxonomyId !== null && !taxonomy.some(({ id }) => id === taxonomyId)) return false;
    if (query === null) return true;
    const prompt = record.prompt?.variants.map((variant) =>
      String(/** @type {Record<string,unknown>} */ (variant).promptText ?? "")).join(" ") ?? "";
    return [record.titleFr, record.summaryFr, prompt]
      .some((entry) => String(entry).toLocaleLowerCase("fr").includes(query));
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
    canonicalUrl: record.canonicalUrl,
    mediaType: record.mediaType,
    titleFr: record.titleFr,
    summaryFr: record.summaryFr,
    model: record.model,
    taxonomy: record.taxonomy,
    provenance: record.provenance,
    rights: record.rights,
  });
  const page = paginate(summaries, input, catalog.manifest.catalogRevision, scope);
  return { catalogRevision: catalog.manifest.catalogRevision, ...page };
}
