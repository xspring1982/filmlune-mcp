// @ts-check

import { exactInput, paginate, scopeHash } from "../catalog-reader/load-catalog.mjs";

/**
 * @param {Awaited<ReturnType<import("../catalog-reader/load-catalog.mjs").loadCatalog>>} catalog
 * @param {unknown} value
 */
export function getChanges(catalog, value) {
  const input = exactInput(value, ["changeKind", "cursor", "entityKind", "limit"]);
  if (input.changeKind !== undefined
    && input.changeKind !== "upserted" && input.changeKind !== "removed") {
    throw new Error("MCP_INVALID_CHANGE_KIND");
  }
  if (input.entityKind !== undefined
    && input.entityKind !== "case" && input.entityKind !== "prompt_template") {
    throw new Error("MCP_INVALID_ENTITY_KIND");
  }
  const items = catalog.manifest.changes.filter(({ changeKind, entityKind }) =>
    (input.changeKind === undefined || changeKind === input.changeKind)
      && (input.entityKind === undefined || entityKind === input.entityKind));
  const page = paginate(items, input, catalog.manifest.catalogRevision,
    scopeHash({ changeKind: input.changeKind ?? null, entityKind: input.entityKind ?? null }));
  return { catalogRevision: catalog.manifest.catalogRevision, ...page };
}
