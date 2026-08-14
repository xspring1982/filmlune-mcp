// @ts-check

import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { loadCatalog } from "../catalog-reader/load-catalog.mjs";
import { getCase } from "../tools/get-case.mjs";
import { getChanges } from "../tools/get-changes.mjs";
import { listModels } from "../tools/list-models.mjs";
import { listTaxonomy } from "../tools/list-taxonomy.mjs";
import { searchCases } from "../tools/search-cases.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const catalog = await loadCatalog(REPOSITORY_ROOT);

const cursor = z.string().min(1).optional();
const limit = z.number().int().min(1).max(50).optional();

/** @param {Record<string, unknown>} value */
function success(value) {
  return {
    content: [{ type: /** @type {const} */ ("text"), text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

const server = new McpServer({
  name: "filmlune-mcp",
  version: "0.0.0",
});

server.registerTool("search_cases", {
  description: "Rechercher dans le catalogue public et filtré par droits de FilmLune.",
  inputSchema: z.strictObject({
    cursor,
    limit,
    mediaType: z.enum(["image", "video"]).optional(),
    modelFamilyId: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    taxonomyId: z.string().min(1).optional(),
  }),
}, (input) => success(searchCases(catalog, input)));

server.registerTool("get_case", {
  description: "Lire une révision publique précise d’un cas FilmLune, ou son tombstone.",
  inputSchema: z.strictObject({
    caseId: z.string().regex(/^cev_[0-9]{4}$/),
    caseRevisionId: z.string().regex(/^cev_[0-9]{4}@r[0-9]{4}$/).optional(),
  }),
}, (input) => success(getCase(catalog, input)));

server.registerTool("list_models", {
  description: "Lister les familles de modèles présentes dans le catalogue public.",
  inputSchema: z.strictObject({
    cursor,
    limit,
    mediaType: z.enum(["image", "video"]).optional(),
  }),
}, (input) => success(listModels(catalog, input)));

server.registerTool("list_taxonomy", {
  description: "Lister la taxonomie française disponible dans le catalogue public.",
  inputSchema: z.strictObject({
    axis: z.enum(["media", "model", "use_case", "style"]).optional(),
    cursor,
    limit,
  }),
}, (input) => success(listTaxonomy(catalog, input)));

server.registerTool("get_changes", {
  description: "Lire le flux déterministe des ajouts, mises à jour et retraits du catalogue.",
  inputSchema: z.strictObject({
    changeKind: z.enum(["upserted", "removed"]).optional(),
    cursor,
    limit,
  }),
}, (input) => success(getChanges(catalog, input)));

await server.connect(new StdioServerTransport());
