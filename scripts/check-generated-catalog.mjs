// @ts-check

import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateCatalog } from "../src/catalog-reader/validate-catalog.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = await validateCatalog(repositoryRoot);

process.stdout.write(`${JSON.stringify({
  activeCases: catalog.cases.size,
  catalogRevision: catalog.manifest.catalogRevision,
  files: catalog.manifest.files.length,
  result: "PASS",
  tombstones: catalog.tombstones.size,
})}\n`);
