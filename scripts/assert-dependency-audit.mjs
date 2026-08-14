// @ts-check

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** @param {Buffer|string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} value */
function object(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("BLOCK_DEPENDENCY_AUDIT_ASSERTION");
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string,string>} */
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) throw new Error("BLOCK_DEPENDENCY_AUDIT_ASSERTION");
    args[flag.slice(2)] = value;
  }
  if (!args.artifact || !args["require-status"]) throw new Error("BLOCK_DEPENDENCY_AUDIT_ASSERTION");
  return args;
}

/** @param {unknown} value @param {string} requiredStatus */
export function assertDecisionArtifact(value, requiredStatus) {
  const artifact = object(value);
  if (
    artifact.schemaVersion !== 1
    || artifact.artifactKind !== "dependency-review-decisions"
    || artifact.repository === "website"
    || artifact.status !== requiredStatus
    || artifact.result !== "ALLOW_FROZEN_INSTALL"
    || !Array.isArray(artifact.remainingRisks)
    || artifact.remainingRisks.length !== 0
  ) throw new Error("BLOCK_DEPENDENCY_AUDIT_ASSERTION");
  if (requiredStatus === "PASS") {
    const postinstall = object(artifact.postinstall);
    if (
      postinstall.status !== "PASS"
      || postinstall.installExecutions !== 1
      || postinstall.lifecycleInstallPolicy !== "IGNORE_SCRIPTS"
      || !Array.isArray(postinstall.remainingRisks)
      || postinstall.remainingRisks.length !== 0
    ) throw new Error("BLOCK_DEPENDENCY_AUDIT_ASSERTION");
  }
  return artifact;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const artifactPath = args.artifact;
  const requiredStatus = args["require-status"];
  if (artifactPath === undefined || requiredStatus === undefined) {
    throw new Error("BLOCK_DEPENDENCY_AUDIT_ASSERTION");
  }
  const stat = await lstat(artifactPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("BLOCK_DEPENDENCY_AUDIT_ASSERTION");
  const artifact = assertDecisionArtifact(JSON.parse(await readFile(artifactPath, "utf8")), requiredStatus);
  if (requiredStatus === "PASS") {
    const postinstall = object(artifact.postinstall);
    if (
      postinstall.packageJsonSha256 !== sha256(await readFile("package.json"))
      || postinstall.lockfileSha256 !== sha256(await readFile("pnpm-lock.yaml"))
    ) throw new Error("BLOCK_DEPENDENCY_AUDIT_ASSERTION");
  }
  process.stdout.write(`${JSON.stringify({ status: requiredStatus, artifact: path.resolve(artifactPath) })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "BLOCK_DEPENDENCY_AUDIT_ASSERTION"}\n`);
    process.exitCode = 1;
  });
}
