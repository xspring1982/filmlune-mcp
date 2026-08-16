// @ts-check

import { exactInput, paginate, scopeHash } from "../catalog-reader/load-catalog.mjs";

/**
 * @param {Awaited<ReturnType<import("../catalog-reader/load-catalog.mjs").loadCatalog>>} catalog
 * @param {unknown} value
 */
export function getChanges(catalog, value) {
  const input = exactInput(value, ["changeKind", "cursor", "limit"]);
  if (input.changeKind !== undefined
    && input.changeKind !== "upserted" && input.changeKind !== "removed") {
    throw new Error("MCP_INVALID_CHANGE_KIND");
  }
  const items = catalog.manifest.changes.filter(({ changeKind }) =>
    input.changeKind === undefined || changeKind === input.changeKind);
  const page = paginate(items, input, catalog.manifest.catalogRevision,
    scopeHash({ changeKind: input.changeKind ?? null }));
  return { catalogRevision: catalog.manifest.catalogRevision, ...page };
}
