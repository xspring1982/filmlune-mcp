// @ts-check

import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
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
  version: "0.1.0",
});

server.registerTool("search_cases", {
  description: "Search FilmLune's rights-filtered public cases and MCP-only prompt templates.",
  inputSchema: z.strictObject({
    cursor,
    limit,
    mediaType: z.enum(["image", "video"]).optional(),
    modelFamilyId: z.string().min(1).optional(),
    outputLanguage: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    taxonomyId: z.string().min(1).optional(),
  }),
}, (input) => success(searchCases(catalog, input)));

server.registerTool("get_case", {
  description: "Read exactly one public FilmLune case/tombstone or MCP-only prompt template/tombstone.",
  inputSchema: fromJsonSchema({
    type: "object",
    properties: {
      caseId: { type: "string", pattern: "^cev_[0-9]{4}$" },
      caseRevisionId: { type: "string", pattern: "^cev_[0-9]{4}@r[0-9]{4}$" },
      promptTemplateId: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
      promptTemplateRevisionId: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*@r[0-9]{4}$" },
    },
    oneOf: [
      { required: ["caseId"], not: { anyOf: [
        { required: ["promptTemplateId"] }, { required: ["promptTemplateRevisionId"] },
      ] } },
      { required: ["promptTemplateId"], not: { anyOf: [
        { required: ["caseId"] }, { required: ["caseRevisionId"] },
      ] } },
    ],
    additionalProperties: false,
  }),
}, (input) => success(getCase(catalog, input)));

server.registerTool("list_models", {
  description: "List model families represented in the public FilmLune catalog.",
  inputSchema: z.strictObject({
    cursor,
    limit,
    mediaType: z.enum(["image", "video"]).optional(),
  }),
}, (input) => success(listModels(catalog, input)));

server.registerTool("list_taxonomy", {
  description: "List the English taxonomy available in the public FilmLune catalog.",
  inputSchema: z.strictObject({
    axis: z.enum(["media", "model", "use_case", "collection", "style"]).optional(),
    cursor,
    limit,
  }),
}, (input) => success(listTaxonomy(catalog, input)));

server.registerTool("get_changes", {
  description: "Read the deterministic feed of catalog additions, updates, and removals.",
  inputSchema: z.strictObject({
    changeKind: z.enum(["upserted", "removed"]).optional(),
    cursor,
    entityKind: z.enum(["case", "prompt_template"]).optional(),
    limit,
  }),
}, (input) => success(getChanges(catalog, input)));

await server.connect(new StdioServerTransport());
