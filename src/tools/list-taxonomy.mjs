// @ts-check

import { exactInput, paginate, scopeHash } from "../catalog-reader/load-catalog.mjs";

const AXES = new Set(["media", "model", "use_case", "style"]);

/**
 * @param {Awaited<ReturnType<import("../catalog-reader/load-catalog.mjs").loadCatalog>>} catalog
 * @param {unknown} value
 */
export function listTaxonomy(catalog, value) {
  const input = exactInput(value, ["axis", "cursor", "limit"]);
  if (input.axis !== undefined && (typeof input.axis !== "string" || !AXES.has(input.axis))) {
    throw new Error("MCP_INVALID_TAXONOMY_AXIS");
  }
  const items = catalog.taxonomy.taxonomy.filter(({ axis }) =>
    input.axis === undefined || axis === input.axis)
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  const page = paginate(items, input, catalog.manifest.catalogRevision,
    scopeHash({ axis: input.axis ?? null }));
  return { catalogRevision: catalog.manifest.catalogRevision, ...page };
}
