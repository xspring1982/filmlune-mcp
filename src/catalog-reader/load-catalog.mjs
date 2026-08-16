// @ts-check

import { createHash } from "node:crypto";

import { validateCatalog } from "./validate-catalog.mjs";

const INVALID = "MCP_INVALID_CURSOR";

/** @param {string} repositoryRoot */
export async function loadCatalog(repositoryRoot) {
  return validateCatalog(repositoryRoot);
}

/** @param {unknown} value @param {string[]} allowed */
export function exactInput(value, allowed) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("MCP_INVALID_INPUT");
  }
  const input = /** @type {Record<string,unknown>} */ (value);
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new Error("MCP_INVALID_INPUT");
  }
  return input;
}

/** @param {unknown} value @param {number} defaultValue */
export function decodeLimit(value, defaultValue = 10) {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 50) {
    throw new Error("MCP_INVALID_LIMIT");
  }
  return Number(value);
}

/** @param {Record<string,unknown>} scope */
export function scopeHash(scope) {
  const sorted = Object.fromEntries(Object.entries(scope).sort(([left], [right]) =>
    left.localeCompare(right, "en")));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/** @param {string} revision @param {number} offset @param {string} scope */
function encodeCursor(revision, offset, scope) {
  return Buffer.from(JSON.stringify({ r: revision, o: offset, s: scope }), "utf8")
    .toString("base64url");
}

/** @param {unknown} cursor @param {string} revision @param {string} scope */
function decodeCursor(cursor, revision, scope) {
  if (cursor === undefined) return 0;
  if (typeof cursor !== "string" || cursor.length === 0) throw new Error(INVALID);
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "o,r,s"
      || value.r !== revision || value.s !== scope
      || !Number.isSafeInteger(value.o) || value.o < 0) throw new Error(INVALID);
    return /** @type {{o:number}} */ (value).o;
  } catch {
    throw new Error(INVALID);
  }
}

/**
 * @template T
 * @param {readonly T[]} items
 * @param {{cursor?:unknown,limit?:unknown}} input
 * @param {string} revision
 * @param {string} scope
 */
export function paginate(items, input, revision, scope) {
  const limit = decodeLimit(input.limit);
  const offset = decodeCursor(input.cursor, revision, scope);
  if (offset > items.length) throw new Error(INVALID);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    nextCursor: nextOffset < items.length ? encodeCursor(revision, nextOffset, scope) : null,
  };
}
