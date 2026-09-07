// @ts-check

import { exactInput } from "../catalog-reader/load-catalog.mjs";

/**
 * @param {Awaited<ReturnType<import("../catalog-reader/load-catalog.mjs").loadCatalog>>} catalog
 * @param {unknown} value
 */
export function getCase(catalog, value) {
  const input = exactInput(value, ["caseId", "caseRevisionId"]);
  if (typeof input.caseId !== "string" || !/^cev_[0-9]{4}$/.test(input.caseId)) {
    throw new Error("MCP_INVALID_CASE_ID");
  }
  if (input.caseRevisionId !== undefined
    && (typeof input.caseRevisionId !== "string"
      || !/^cev_[0-9]{4}@r[0-9]{4}$/.test(input.caseRevisionId))) {
    throw new Error("MCP_INVALID_CASE_REVISION_ID");
  }
  const record = catalog.cases.get(input.caseId) ?? catalog.tombstones.get(input.caseId);
  if (!record) throw new Error("MCP_UNKNOWN_CASE");
  if (input.caseRevisionId !== undefined && record.caseRevisionId !== input.caseRevisionId) {
    throw new Error("MCP_STALE_CASE_REVISION");
  }
  const availableOutputVariants = record.kind === "reusable_case"
    ? [...catalog.cases.values()]
      .filter((candidate) => candidate.kind === "reusable_case"
        && candidate.caseFamilyId === record.caseFamilyId)
      .sort((left, right) => String(left.outputLanguage).localeCompare(
        String(right.outputLanguage),
        "en",
      ) || left.caseId.localeCompare(right.caseId, "en"))
      .map((candidate) => ({
        caseId: candidate.caseId,
        caseRevisionId: candidate.caseRevisionId,
        outputLanguage: candidate.outputLanguage,
        outputVariantId: candidate.outputVariantId,
      }))
    : [];
  return {
    catalogRevision: catalog.manifest.catalogRevision,
    case: record,
    availableOutputVariants,
    ...(record.kind === "reusable_case" ? { preview: casePreview(record) } : {}),
  };
}

/** @param {import("../catalog-reader/validate-catalog.mjs").CatalogCase} record */
export function casePreview(record) {
  const video = record.media?.find(asset => asset.kind === "video");
  const image = record.media?.find(asset => asset.kind === "image");
  return {
    imageUrl: new URL(String(video?.posterUrl ?? image?.publicUrl ?? `${record.canonicalUrl}opengraph-image/`), record.canonicalUrl).href,
    pageUrl: record.canonicalUrl,
    watchUrl: record.mediaType === "video" ? new URL(String(video?.publicUrl ?? record.canonicalUrl), record.canonicalUrl).href : null,
    usage: "preview_only",
    description: "View this example before choosing its prompt. Follow the case rights for reuse; access is not permission to republish.",
  };
}
