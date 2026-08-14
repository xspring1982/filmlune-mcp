// @ts-check

import { createHash } from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const FROZEN_INSTALL_AUTHORITY_BOUNDARY_V1 = Object.freeze({
  policyVersion: 1,
  permittedOperation: "ONE_FROZEN_INSTALL_ONLY",
  maxInstallExecutions: 1,
  installCommand: Object.freeze([
    "corepack", "pnpm", "install", "--frozen-lockfile", "--ignore-scripts",
  ]),
  prohibitedOperations: Object.freeze([
    "lifecycle", "build", "test", "mvp", "release", "deployment",
    "provider", "payment", "production",
  ]),
});

/** @param {unknown} value */
export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** @param {unknown} value */
export function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" || Buffer.isBuffer(value) ? value : stableJson(value))
    .digest("hex");
}

/** @param {unknown} value @returns {Record<string,unknown>} */
function object(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) block("object required");
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {Record<string, unknown>} value @param {readonly string[]} keys */
function exactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    block("keys do not match");
  }
}

/** @param {unknown} value @returns {string} */
function text(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) block("text required");
  return value;
}

/** @param {unknown} value @returns {string} */
function hash(value) {
  const result = text(value);
  if (!SHA256.test(result)) block("sha256 required");
  return result;
}

/** @param {unknown} message @returns {never} */
function block(message) {
  throw new Error(`BLOCK_DEPENDENCY_REVIEW_MISMATCH: ${String(message)}`);
}

/** @param {unknown} value */
function validateFacts(value) {
  const facts = object(value);
  exactKeys(facts, [
    "schemaVersion", "artifactKind", "policyVersion", "repository",
    "collectorIdentity", "capturedAtUtc", "packageJson", "lockfile",
    "toolchain", "graph", "advisory", "blockers", "remainingRisks",
  ]);
  if (
    facts.schemaVersion !== 1
    || facts.artifactKind !== "dependency-lock-facts"
    || facts.policyVersion !== 1
    || facts.repository !== "filmlune-mcp"
    || !UTC.test(text(facts.capturedAtUtc))
  ) block("facts identity invalid");
  text(facts.collectorIdentity);
  const packageJson = object(facts.packageJson);
  const lockfile = object(facts.lockfile);
  exactKeys(packageJson, ["path", "sha256"]);
  exactKeys(lockfile, ["path", "sha256"]);
  if (packageJson.path !== "package.json" || lockfile.path !== "pnpm-lock.yaml") block("manifest path invalid");
  hash(packageJson.sha256);
  hash(lockfile.sha256);
  const toolchain = object(facts.toolchain);
  exactKeys(toolchain, ["node", "packageManager"]);
  if (toolchain.node !== "22.22.2") block("node coordinate invalid");
  text(toolchain.packageManager);
  const graph = object(facts.graph);
  exactKeys(graph, ["complete", "coordinateCount", "normalizedSha256", "coordinates"]);
  if (graph.complete !== true || !Array.isArray(graph.coordinates) || graph.coordinateCount !== graph.coordinates.length || graph.coordinates.length === 0) {
    block("graph incomplete");
  }
  hash(graph.normalizedSha256);
  const seen = new Set();
  const coordinates = graph.coordinates.map((entryValue) => {
    const entry = object(entryValue);
    exactKeys(entry, [
      "coordinate", "resolved", "integrity", "license", "lifecycleScripts",
      "nativeBinaryFacts", "registryMetadataSha256",
    ]);
    const coordinate = text(entry.coordinate);
    if (seen.has(coordinate)) block("duplicate coordinate");
    seen.add(coordinate);
    const resolved = text(entry.resolved);
    if (!resolved.startsWith("https://registry.npmjs.org/")) block("registry source invalid");
    text(entry.integrity);
    text(entry.license);
    hash(entry.registryMetadataSha256);
    if (!Array.isArray(entry.lifecycleScripts) || !Array.isArray(entry.nativeBinaryFacts)) block("risk facts missing");
    return {
      coordinate,
      resolved,
      integrity: entry.integrity,
      license: entry.license,
      lifecycleScripts: entry.lifecycleScripts,
      nativeBinaryFacts: entry.nativeBinaryFacts,
      registryMetadataSha256: entry.registryMetadataSha256,
    };
  });
  const sorted = [...coordinates].sort((left, right) => left.coordinate.localeCompare(right.coordinate, "en"));
  if (coordinates.some((entry, index) => entry.coordinate !== sorted[index]?.coordinate)) block("coordinate order invalid");
  const advisory = object(facts.advisory);
  exactKeys(advisory, ["status", "evidenceSha256", "summary"]);
  if (advisory.status !== "PASS") block("advisory did not pass");
  hash(advisory.evidenceSha256);
  const summary = object(advisory.summary);
  exactKeys(summary, ["info", "low", "moderate", "high", "critical", "total"]);
  if (Object.values(summary).some((count) => count !== 0)) block("advisory findings remain");
  if (!Array.isArray(facts.blockers) || facts.blockers.length !== 0) block("facts blockers remain");
  if (
    !Array.isArray(facts.remainingRisks)
    || facts.remainingRisks.length !== 1
    || facts.remainingRisks[0] !== "INDEPENDENT_DEPENDENCY_REVIEW_REQUIRED"
  ) block("collector risk boundary invalid");
  return { facts, coordinates };
}

/** @param {unknown} factsValue */
export function buildDependencyReviewInput(factsValue) {
  const { facts, coordinates } = validateFacts(factsValue);
  const reviewedCoordinates = coordinates.map((coordinate) => ({
    ...coordinate,
    factSha256: sha256(coordinate),
  }));
  return {
    schemaVersion: 1,
    artifactKind: "dependency-review-input",
    policyVersion: 1,
    repository: "filmlune-mcp",
    collectorIdentity: facts.collectorIdentity,
    packageJsonSha256: object(facts.packageJson).sha256,
    lockfileSha256: object(facts.lockfile).sha256,
    factsSha256: sha256(facts),
    coordinateSetSha256: sha256(reviewedCoordinates),
    coordinates: reviewedCoordinates,
  };
}

/**
 * @param {{record:unknown,facts:unknown,reviewInput:unknown}} options
 */
export function validateDependencyReviewRecord({ record: recordValue, facts: factsValue, reviewInput: inputValue }) {
  const input = object(inputValue);
  const rebuilt = buildDependencyReviewInput(factsValue);
  if (stableJson(input) !== stableJson(rebuilt)) block("review input drift");
  const facts = object(factsValue);
  const record = object(recordValue);
  exactKeys(record, [
    "schemaVersion", "artifactKind", "policyVersion", "status", "result",
    "reviewerIdentity", "collectorIdentity", "reviewedAtUtc", "factsSha256",
    "packageJsonSha256", "lockfileSha256", "coordinateSetSha256",
    "coordinateDecisions", "remainingRisks", "authorityBoundary", "postinstall",
  ]);
  if (
    record.schemaVersion !== 1
    || record.artifactKind !== "dependency-review-decisions"
    || record.policyVersion !== 1
    || !["REVIEWED", "PASS"].includes(String(record.status))
    || record.result !== "ALLOW_FROZEN_INSTALL"
    || !UTC.test(text(record.reviewedAtUtc))
  ) block("review identity invalid");
  const reviewerIdentity = text(record.reviewerIdentity);
  const collectorIdentity = text(record.collectorIdentity);
  if (reviewerIdentity === collectorIdentity || collectorIdentity !== facts.collectorIdentity) block("collector cannot self-review");
  for (const [actual, expected] of [
    [record.factsSha256, rebuilt.factsSha256],
    [record.packageJsonSha256, rebuilt.packageJsonSha256],
    [record.lockfileSha256, rebuilt.lockfileSha256],
    [record.coordinateSetSha256, rebuilt.coordinateSetSha256],
  ]) {
    if (hash(actual) !== expected) block("review hash drift");
  }
  if (!Array.isArray(record.coordinateDecisions) || record.coordinateDecisions.length !== rebuilt.coordinates.length) {
    block("coordinate decisions incomplete");
  }
  for (const [index, decisionValue] of record.coordinateDecisions.entries()) {
    const decision = object(decisionValue);
    exactKeys(decision, [
      "coordinate", "factSha256", "integrityDecision", "advisoryDecision",
      "licenseDecision", "lifecycleDecision", "nativeBinaryDecision", "reason",
    ]);
    const expected = rebuilt.coordinates[index];
    if (expected === undefined) block("coordinate decision missing");
    if (
      decision.coordinate !== expected.coordinate
      || decision.factSha256 !== expected.factSha256
      || decision.integrityDecision !== "ALLOW"
      || decision.advisoryDecision !== "ALLOW"
      || decision.licenseDecision !== "ALLOW"
      || !["NONE", "REVIEWED"].includes(String(decision.lifecycleDecision))
      || !["NONE", "REVIEWED"].includes(String(decision.nativeBinaryDecision))
      || (expected.lifecycleScripts.length === 0 ? decision.lifecycleDecision !== "NONE" : decision.lifecycleDecision !== "REVIEWED")
      || (expected.nativeBinaryFacts.length === 0 ? decision.nativeBinaryDecision !== "NONE" : decision.nativeBinaryDecision !== "REVIEWED")
    ) block("coordinate decision mismatch");
    text(decision.reason);
  }
  if (!Array.isArray(record.remainingRisks) || record.remainingRisks.length !== 0) block("remaining risks are not empty");
  if (stableJson(record.authorityBoundary) !== stableJson(FROZEN_INSTALL_AUTHORITY_BOUNDARY_V1)) block("authority boundary drift");
  if (record.status === "REVIEWED" && record.postinstall !== null) block("premature postinstall evidence");
  return {
    result: "ALLOW_FROZEN_INSTALL",
    reviewerIdentity,
    collectorIdentity,
    coordinateCount: rebuilt.coordinates.length,
    remainingRisks: [],
  };
}
