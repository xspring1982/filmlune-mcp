// @ts-check

import { exactInput, paginate, scopeHash } from "../catalog-reader/load-catalog.mjs";

/**
 * @param {Awaited<ReturnType<import("../catalog-reader/load-catalog.mjs").loadCatalog>>} catalog
 * @param {unknown} value
 */
export function listModels(catalog, value) {
  const input = exactInput(value, ["cursor", "limit", "mediaType"]);
  if (input.mediaType !== undefined && input.mediaType !== "image" && input.mediaType !== "video") {
    throw new Error("MCP_INVALID_MEDIA_TYPE");
  }
  const items = catalog.models.models.filter(({ mediaType }) =>
    input.mediaType === undefined || mediaType === input.mediaType)
    .sort((left, right) => left.modelFamilyId.localeCompare(right.modelFamilyId, "en"));
  const page = paginate(items, input, catalog.manifest.catalogRevision,
    scopeHash({ mediaType: input.mediaType ?? null }));
  return { catalogRevision: catalog.manifest.catalogRevision, ...page };
}
