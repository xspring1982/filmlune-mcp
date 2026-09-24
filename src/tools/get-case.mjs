// @ts-check

import { exactInput } from "../catalog-reader/load-catalog.mjs";

/** @typedef {Awaited<ReturnType<import("../catalog-reader/load-catalog.mjs").loadCatalog>>} LoadedCatalog */
/** @typedef {{catalogRevision:string,case:import("../catalog-reader/validate-catalog.mjs").CatalogCase|import("../catalog-reader/validate-catalog.mjs").CatalogTombstone,availableOutputVariants:Array<{caseId:string,caseRevisionId:string,outputLanguage:string|undefined,outputVariantId:string|undefined}>,preview?:ReturnType<typeof casePreview>}} CaseResult */
/** @typedef {{catalogRevision:string,promptTemplate:import("../catalog-reader/validate-catalog.mjs").CatalogPromptTemplate|import("../catalog-reader/validate-catalog.mjs").CatalogPromptTemplateTombstone}} PromptTemplateResult */

/**
 * @overload
 * @param {LoadedCatalog} catalog
 * @param {{caseId:string,caseRevisionId?:string}} value
 * @returns {CaseResult}
 */
/**
 * @overload
 * @param {LoadedCatalog} catalog
 * @param {{promptTemplateId:string,promptTemplateRevisionId?:string}} value
 * @returns {PromptTemplateResult}
 */
/**
 * @overload
 * @param {LoadedCatalog} catalog
 * @param {unknown} value
 * @returns {CaseResult|PromptTemplateResult}
 */
/**
 * @param {LoadedCatalog} catalog
 * @param {unknown} value
 * @returns {CaseResult|PromptTemplateResult}
 */
export function getCase(catalog, value) {
  const input = exactInput(value, [
    "caseId", "caseRevisionId", "promptTemplateId", "promptTemplateRevisionId",
  ]);
  const hasCaseId = input.caseId !== undefined;
  const hasPromptTemplateId = input.promptTemplateId !== undefined;
  if (hasCaseId === hasPromptTemplateId
    || (!hasCaseId && input.caseRevisionId !== undefined)
    || (!hasPromptTemplateId && input.promptTemplateRevisionId !== undefined)) {
    throw new Error("MCP_INVALID_INPUT");
  }
  if (hasPromptTemplateId) {
    if (typeof input.promptTemplateId !== "string"
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.promptTemplateId)) {
      throw new Error("MCP_INVALID_PROMPT_TEMPLATE_ID");
    }
    if (input.promptTemplateRevisionId !== undefined
      && (typeof input.promptTemplateRevisionId !== "string"
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*@r[0-9]{4}$/.test(input.promptTemplateRevisionId))) {
      throw new Error("MCP_INVALID_PROMPT_TEMPLATE_REVISION_ID");
    }
    const promptTemplate = catalog.promptTemplates.get(input.promptTemplateId)
      ?? catalog.promptTemplateTombstones.get(input.promptTemplateId);
    if (!promptTemplate) throw new Error("MCP_UNKNOWN_PROMPT_TEMPLATE");
    if (input.promptTemplateRevisionId !== undefined
      && promptTemplate.promptTemplateRevisionId !== input.promptTemplateRevisionId) {
      throw new Error("MCP_STALE_PROMPT_TEMPLATE_REVISION");
    }
    return /** @type {PromptTemplateResult} */ ({
      catalogRevision: catalog.manifest.catalogRevision,
      promptTemplate,
    });
  }
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
  return /** @type {CaseResult} */ ({
    catalogRevision: catalog.manifest.catalogRevision,
    case: record,
    availableOutputVariants,
    ...(record.kind === "reusable_case" ? { preview: casePreview(record) } : {}),
  });
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
