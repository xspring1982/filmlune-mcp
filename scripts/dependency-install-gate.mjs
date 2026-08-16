// @ts-check

import { buildDependencyReviewInput, validateDependencyReviewRecord } from "./dependency-review-gate.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const INSTALL_COMMAND = Object.freeze([
  "corepack", "pnpm", "install", "--frozen-lockfile", "--ignore-scripts",
]);

/** @param {unknown} value */
function object(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("BLOCK_DEPENDENCY_PREINSTALL");
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value */
function hash(value) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error("BLOCK_DEPENDENCY_PREINSTALL");
  return value;
}

/**
 * @param {{facts:unknown,reviewInput:unknown,review:unknown,currentPackageJsonSha256:unknown,currentLockfileSha256:unknown}} value
 */
export function buildPreinstallGate(value) {
  const facts = object(value.facts);
  const input = buildDependencyReviewInput(facts);
  if (JSON.stringify(input) !== JSON.stringify(value.reviewInput)) throw new Error("BLOCK_DEPENDENCY_PREINSTALL");
  const approved = validateDependencyReviewRecord({
    record: value.review,
    facts,
    reviewInput: input,
  });
  const packageJson = object(facts.packageJson);
  const lockfile = object(facts.lockfile);
  const packageJsonSha256 = hash(packageJson.sha256);
  const lockfileSha256 = hash(lockfile.sha256);
  if (
    hash(value.currentPackageJsonSha256) !== packageJsonSha256
    || hash(value.currentLockfileSha256) !== lockfileSha256
  ) throw new Error("BLOCK_DEPENDENCY_PREINSTALL");
  return {
    schemaVersion: 1,
    artifactKind: "dependency-preinstall-gate",
    repository: "filmlune-mcp",
    result: "ALLOW_FROZEN_INSTALL",
    installCommand: [...INSTALL_COMMAND],
    packageJsonSha256,
    lockfileSha256,
    factsSha256: input.factsSha256,
    coordinateSetSha256: input.coordinateSetSha256,
    reviewerIdentity: approved.reviewerIdentity,
    collectorIdentity: approved.collectorIdentity,
    coordinateCount: approved.coordinateCount,
    lifecycleInstallPolicy: "IGNORE_SCRIPTS",
    remainingRisks: [],
  };
}
