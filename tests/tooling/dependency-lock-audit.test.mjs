// @ts-check

import assert from "node:assert/strict";
import test from "node:test";

import { buildPreinstallGate } from "../../scripts/dependency-install-gate.mjs";
import {
  FROZEN_INSTALL_AUTHORITY_BOUNDARY_V1,
  buildDependencyReviewInput,
  validateDependencyReviewRecord,
} from "../../scripts/dependency-review-gate.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);

function factsFixture() {
  return {
    schemaVersion: 1,
    artifactKind: "dependency-lock-facts",
    policyVersion: 1,
    repository: "filmlune-mcp",
    collectorIdentity: "codex-root-mcp-dependency-facts-attempt-0001",
    capturedAtUtc: "2026-08-11T10:00:00.000Z",
    packageJson: { path: "package.json", sha256: SHA_A },
    lockfile: { path: "pnpm-lock.yaml", sha256: SHA_B },
    toolchain: {
      node: "22.22.2",
      packageManager: "pnpm@10.34.5+sha512.a4ee05f2f73658255bd6a89859c065a45c28a57daefae2c893a168ee2b73168c37b91e83e57ea67654ad03f03031746430e8bce38e362e042605fb8abc80192e",
    },
    graph: {
      complete: true,
      coordinateCount: 1,
      normalizedSha256: SHA_C,
      coordinates: [{
        coordinate: "zod@4.2.0",
        resolved: "https://registry.npmjs.org/zod/-/zod-4.2.0.tgz",
        integrity: "sha512-zod",
        license: "MIT",
        lifecycleScripts: [],
        nativeBinaryFacts: [],
        registryMetadataSha256: SHA_D,
      }],
    },
    advisory: {
      status: "PASS",
      evidenceSha256: SHA_E,
      summary: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    },
    blockers: [],
    remainingRisks: ["INDEPENDENT_DEPENDENCY_REVIEW_REQUIRED"],
  };
}

/**
 * @param {ReturnType<typeof factsFixture>} facts
 * @param {ReturnType<typeof buildDependencyReviewInput>} reviewInput
 */
function reviewFixture(facts, reviewInput) {
  return {
    schemaVersion: 1,
    artifactKind: "dependency-review-decisions",
    policyVersion: 1,
    status: "REVIEWED",
    result: "ALLOW_FROZEN_INSTALL",
    reviewerIdentity: "chatgpt-pro-independent-reviewer-mcp-attempt-0001",
    collectorIdentity: facts.collectorIdentity,
    reviewedAtUtc: "2026-08-11T10:05:00.000Z",
    factsSha256: reviewInput.factsSha256,
    packageJsonSha256: facts.packageJson.sha256,
    lockfileSha256: facts.lockfile.sha256,
    coordinateSetSha256: reviewInput.coordinateSetSha256,
    coordinateDecisions: reviewInput.coordinates.map((coordinate) => ({
      coordinate: coordinate.coordinate,
      factSha256: coordinate.factSha256,
      integrityDecision: "ALLOW",
      advisoryDecision: "ALLOW",
      licenseDecision: "ALLOW",
      lifecycleDecision: "NONE",
      nativeBinaryDecision: "NONE",
      reason: `Exact reviewed facts for ${coordinate.coordinate}.`,
    })),
    remainingRisks: [],
    authorityBoundary: structuredClone(FROZEN_INSTALL_AUTHORITY_BOUNDARY_V1),
    postinstall: null,
  };
}

test("review input rejects a graph coordinate without every exact supply-chain fact", () => {
  const facts = factsFixture();
  const malformed = /** @type {any} */ (structuredClone(facts));
  delete malformed.graph.coordinates[0].license;
  assert.throws(
    () => buildDependencyReviewInput(malformed),
    /BLOCK_DEPENDENCY_REVIEW_MISMATCH/,
  );
});

test("review validation rejects self-review, remaining risk and reviewed lock drift", () => {
  const facts = factsFixture();
  const input = buildDependencyReviewInput(facts);
  const valid = reviewFixture(facts, input);

  assert.equal(
    validateDependencyReviewRecord({ record: valid, facts, reviewInput: input }).result,
    "ALLOW_FROZEN_INSTALL",
  );

  for (const candidate of [
    { ...valid, reviewerIdentity: valid.collectorIdentity },
    { ...valid, remainingRisks: ["UNREVIEWED_LICENSE"] },
    { ...valid, lockfileSha256: "0".repeat(64) },
  ]) {
    assert.throws(
      () => validateDependencyReviewRecord({ record: candidate, facts, reviewInput: input }),
      /BLOCK_DEPENDENCY_REVIEW_MISMATCH/,
    );
  }
});

test("preinstall gate binds the current package, lock, facts and distinct review", () => {
  const facts = factsFixture();
  const input = buildDependencyReviewInput(facts);
  const review = reviewFixture(facts, input);
  assert.equal(buildPreinstallGate({
    facts,
    reviewInput: input,
    review,
    currentPackageJsonSha256: facts.packageJson.sha256,
    currentLockfileSha256: facts.lockfile.sha256,
  }).result, "ALLOW_FROZEN_INSTALL");

  assert.throws(() => buildPreinstallGate({
    facts,
    reviewInput: input,
    review,
    currentPackageJsonSha256: facts.packageJson.sha256,
    currentLockfileSha256: "0".repeat(64),
  }), /BLOCK_DEPENDENCY_PREINSTALL/);
});
