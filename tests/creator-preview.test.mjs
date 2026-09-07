// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/catalog-reader/load-catalog.mjs";
import { getCase } from "../src/tools/get-case.mjs";
import { searchCases } from "../src/tools/search-cases.mjs";

test("creator selections expose viewing media without an official social grant", async () => {
  const catalog = await loadCatalog(process.cwd());
  for (const caseId of ["cev_9200", "cev_9201"]) {
    const result = getCase(catalog, { caseId });
    assert.equal(result.case.kind, "reusable_case");
    assert.equal(result.case.rights.social, "deny");
    assert.equal(result.case.rights.media, "allow");
    assert.match(result.preview?.imageUrl ?? "", /^https:\/\/filmlune.com\//);
    assert.equal(result.preview?.pageUrl, result.case.canonicalUrl);
    const found = searchCases(catalog, { query: result.case.title, limit: 20 });
    assert.ok(JSON.stringify(found).includes(caseId));
    assert.ok(JSON.stringify(found).includes(result.preview?.imageUrl ?? "INVALID"));
  }
  assert.match(getCase(catalog, { caseId: "cev_9200" }).preview?.watchUrl ?? "", /^https:\/\//);
  assert.equal(getCase(catalog, { caseId: "cev_9201" }).preview?.watchUrl, null);
});
