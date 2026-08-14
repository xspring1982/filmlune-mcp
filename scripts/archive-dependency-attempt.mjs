// @ts-check

import { sha256, stableJson, validateDependencyReviewRecord } from "./dependency-review-gate.mjs";

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** @param {unknown} value */
function object(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("BLOCK_DEPENDENCY_POSTINSTALL");
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {{facts:unknown,reviewInput:unknown,review:unknown,currentGraphSha256:string,currentPackageJsonSha256:string,currentLockfileSha256:string,installedAtUtc:string,verifiedAtUtc:string,nodeModulesType:string}} value
 */
export function buildPostinstallArtifact(value) {
  const facts = object(value.facts);
  const review = object(value.review);
  const approved = validateDependencyReviewRecord({ record: review, facts, reviewInput: value.reviewInput });
  const graph = object(facts.graph);
  const packageJson = object(facts.packageJson);
  const lockfile = object(facts.lockfile);
  if (
    value.currentGraphSha256 !== graph.normalizedSha256
    || value.currentPackageJsonSha256 !== packageJson.sha256
    || value.currentLockfileSha256 !== lockfile.sha256
    || !UTC.test(value.installedAtUtc)
    || !UTC.test(value.verifiedAtUtc)
    || value.nodeModulesType !== "directory"
  ) throw new Error("BLOCK_DEPENDENCY_POSTINSTALL");
  const reviewedDecisionSha256 = sha256(stableJson(review));
  return {
    ...review,
    status: "PASS",
    postinstall: {
      status: "PASS",
      installedAtUtc: value.installedAtUtc,
      verifiedAtUtc: value.verifiedAtUtc,
      installCommand: [
        "corepack", "pnpm", "install", "--frozen-lockfile", "--ignore-scripts",
      ],
      installExecutions: 1,
      lifecycleInstallPolicy: "IGNORE_SCRIPTS",
      nodeModulesType: value.nodeModulesType,
      packageJsonSha256: value.currentPackageJsonSha256,
      lockfileSha256: value.currentLockfileSha256,
      graphSha256: value.currentGraphSha256,
      coordinateCount: approved.coordinateCount,
      reviewedDecisionSha256,
      remainingRisks: [],
    },
  };
}
