// @ts-check

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildPostinstallArtifact } from "./archive-dependency-attempt.mjs";
import { assertDecisionArtifact } from "./assert-dependency-audit.mjs";
import { checkToolchainContract } from "./check-toolchain-contract.mjs";
import { buildPreinstallGate } from "./dependency-install-gate.mjs";
import { buildDependencyReviewInput, sha256, stableJson } from "./dependency-review-gate.mjs";

/** @param {Buffer|string} value */
function bytesSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} filePath */
async function readRegular(filePath) {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("BLOCK_MCP_DEPENDENCY_AUDIT");
  return readFile(filePath);
}

/** @param {string} filePath @param {string} contents */
async function writeAtomic(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/** @param {string} command @param {string[]} args */
async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({
      argv: [command, ...args],
      exitCode,
      signal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    }));
  });
}

/** @param {unknown} value */
function object(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("BLOCK_MCP_DEPENDENCY_AUDIT");
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @returns {string} */
function normalizeLicense(value) {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const type = /** @type {Record<string,unknown>} */ (value).type;
    if (typeof type === "string" && type.trim() !== "") return type.trim();
  }
  if (Array.isArray(value) && value.length > 0) {
    const values = value.map(normalizeLicense);
    return [...new Set(values)].sort().join(" OR ");
  }
  throw new Error("MCP_DEPENDENCY_LICENSE_MISSING");
}

/** @param {unknown} value */
function parseList(value) {
  if (!Array.isArray(value) || value.length !== 1) throw new Error("MCP_DEPENDENCY_GRAPH_INVALID");
  const root = object(value[0]);
  /** @type {Map<string,{coordinate:string,resolved:string}>} */
  const coordinates = new Map();
  /** @param {unknown} dependenciesValue */
  function visit(dependenciesValue) {
    if (dependenciesValue === undefined) return;
    const dependencies = object(dependenciesValue);
    for (const [name, nodeValue] of Object.entries(dependencies)) {
      const node = object(nodeValue);
      if (typeof node.version !== "string" || node.version.length === 0 || typeof node.resolved !== "string") {
        throw new Error("MCP_DEPENDENCY_GRAPH_INVALID");
      }
      const coordinate = `${name}@${node.version}`;
      const previous = coordinates.get(coordinate);
      if (previous && previous.resolved !== node.resolved) throw new Error("MCP_DEPENDENCY_GRAPH_AMBIGUOUS");
      coordinates.set(coordinate, { coordinate, resolved: node.resolved });
      visit(node.dependencies);
      visit(node.devDependencies);
      visit(node.optionalDependencies);
    }
  }
  visit(root.dependencies);
  visit(root.devDependencies);
  visit(root.optionalDependencies);
  const entries = [...coordinates.values()].sort((left, right) => left.coordinate.localeCompare(right.coordinate, "en"));
  if (entries.length === 0) throw new Error("MCP_DEPENDENCY_GRAPH_EMPTY");
  return entries;
}

/** @param {string} coordinate */
function splitCoordinate(coordinate) {
  const delimiter = coordinate.lastIndexOf("@");
  if (delimiter <= 0 || delimiter === coordinate.length - 1) throw new Error("MCP_DEPENDENCY_COORDINATE_INVALID");
  return { name: coordinate.slice(0, delimiter), version: coordinate.slice(delimiter + 1) };
}

/** @param {{coordinate:string,resolved:string}} entry */
async function registryFact(entry) {
  const { name, version } = splitCoordinate(entry.coordinate);
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
    headers: { accept: "application/json", "user-agent": "filmlune-mcp-dependency-audit/1" },
  });
  if (!response.ok) throw new Error(`MCP_DEPENDENCY_REGISTRY_${response.status}`);
  const metadata = object(await response.json());
  const dist = object(metadata.dist);
  if (metadata.name !== name || metadata.version !== version || typeof dist.integrity !== "string" || dist.integrity.length === 0) {
    throw new Error("MCP_DEPENDENCY_REGISTRY_INVALID");
  }
  const scriptsValue = metadata.scripts === undefined ? {} : object(metadata.scripts);
  const lifecycleNames = ["preinstall", "install", "postinstall", "prepare"];
  const lifecycleScripts = lifecycleNames
    .filter((scriptName) => scriptsValue[scriptName] !== undefined)
    .map((scriptName) => {
      const command = scriptsValue[scriptName];
      if (typeof command !== "string") throw new Error("MCP_DEPENDENCY_LIFECYCLE_INVALID");
      return { name: scriptName, command, commandSha256: bytesSha256(command) };
    });
  const selected = {
    name,
    version,
    dist: { tarball: dist.tarball ?? null, integrity: dist.integrity, shasum: dist.shasum ?? null },
    license: metadata.license ?? null,
    scripts: scriptsValue,
    gypfile: metadata.gypfile ?? null,
    binary: metadata.binary ?? null,
    os: metadata.os ?? null,
    cpu: metadata.cpu ?? null,
    libc: metadata.libc ?? null,
    bin: metadata.bin ?? null,
  };
  const nativeBinaryFacts = [];
  for (const [kind, value] of Object.entries({
    gypfile: selected.gypfile,
    binary: selected.binary,
    os: selected.os,
    cpu: selected.cpu,
    libc: selected.libc,
  })) {
    if (value !== null && value !== false) nativeBinaryFacts.push({ kind, valueSha256: sha256(value) });
  }
  return {
    coordinate: entry.coordinate,
    resolved: entry.resolved,
    integrity: dist.integrity,
    license: normalizeLicense(metadata.license),
    lifecycleScripts,
    nativeBinaryFacts,
    registryMetadataSha256: sha256(selected),
  };
}

/** @param {{coordinate:string,resolved:string}[]} entries */
async function registryFacts(entries) {
  const output = [];
  for (let index = 0; index < entries.length; index += 8) {
    output.push(...await Promise.all(entries.slice(index, index + 8).map(registryFact)));
  }
  return output.sort((left, right) => left.coordinate.localeCompare(right.coordinate, "en"));
}

/** @param {Buffer} stdout */
function advisoryFact(stdout) {
  let value;
  try {
    value = object(JSON.parse(stdout.toString("utf8")));
  } catch {
    throw new Error("MCP_DEPENDENCY_ADVISORY_INVALID");
  }
  const metadata = object(value.metadata);
  const vulnerabilities = object(metadata.vulnerabilities);
  /** @type {Record<string,number>} */
  const summary = {};
  for (const severity of ["info", "low", "moderate", "high", "critical"]) {
    const count = vulnerabilities[severity];
    if (!Number.isSafeInteger(count) || Number(count) !== 0) throw new Error("MCP_DEPENDENCY_ADVISORY_FINDING");
    summary[severity] = Number(count);
  }
  summary.total = Object.values(summary).reduce((total, count) => total + Number(count), 0);
  return { status: "PASS", evidenceSha256: bytesSha256(stdout), summary };
}

/** @param {string} collectorIdentity */
export async function collectDependencyFacts(collectorIdentity) {
  if (typeof collectorIdentity !== "string" || collectorIdentity.trim() !== collectorIdentity || collectorIdentity.length === 0) {
    throw new Error("MCP_DEPENDENCY_COLLECTOR_INVALID");
  }
  const toolchain = await checkToolchainContract();
  const packageJsonBytes = await readRegular("package.json");
  const lockfileBytes = await readRegular("pnpm-lock.yaml");
  const listCommand = await run("corepack", ["pnpm", "list", "--lockfile-only", "--json", "--depth", "Infinity"]);
  if (listCommand.exitCode !== 0 || listCommand.signal !== null) throw new Error("MCP_DEPENDENCY_GRAPH_NOT_RUN");
  const entries = parseList(JSON.parse(listCommand.stdout.toString("utf8")));
  const coordinates = await registryFacts(entries);
  const normalizedSha256 = sha256(coordinates.map(({ coordinate, resolved }) => ({ coordinate, resolved })));
  const auditCommand = await run("corepack", ["pnpm", "audit", "--json"]);
  if (auditCommand.exitCode !== 0 || auditCommand.signal !== null || auditCommand.stderr.length !== 0) {
    throw new Error("MCP_DEPENDENCY_ADVISORY_NOT_RUN");
  }
  return {
    schemaVersion: 1,
    artifactKind: "dependency-lock-facts",
    policyVersion: 1,
    repository: "filmlune-mcp",
    collectorIdentity,
    capturedAtUtc: new Date().toISOString(),
    packageJson: { path: "package.json", sha256: bytesSha256(packageJsonBytes) },
    lockfile: { path: "pnpm-lock.yaml", sha256: bytesSha256(lockfileBytes) },
    toolchain,
    graph: { complete: true, coordinateCount: coordinates.length, normalizedSha256, coordinates },
    advisory: advisoryFact(auditCommand.stdout),
    blockers: [],
    remainingRisks: ["INDEPENDENT_DEPENDENCY_REVIEW_REQUIRED"],
  };
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const mode = argv[0];
  /** @type {Record<string,string>} */
  const args = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) throw new Error("MCP_DEPENDENCY_ARGUMENT_INVALID");
    args[flag.slice(2)] = value;
  }
  return { mode, args };
}

/** @param {string} filePath */
async function jsonFile(filePath) {
  return JSON.parse((await readRegular(filePath)).toString("utf8"));
}

/** @param {Record<string,string>} args */
async function runFacts(args) {
  if (!args.collector || !args.output) throw new Error("MCP_DEPENDENCY_ARGUMENT_INVALID");
  const facts = await collectDependencyFacts(args.collector);
  buildDependencyReviewInput(facts);
  await writeAtomic(args.output, stableJson(facts));
  process.stdout.write(`${JSON.stringify({ status: "AWAITING_INDEPENDENT_DEPENDENCY_REVIEW", output: args.output, coordinateCount: facts.graph.coordinateCount, factsSha256: sha256(facts) })}\n`);
}

/** @param {Record<string,string>} args */
async function runPreinstall(args) {
  if (!args.facts || !args.review) throw new Error("MCP_DEPENDENCY_ARGUMENT_INVALID");
  const facts = await jsonFile(args.facts);
  const review = assertDecisionArtifact(await jsonFile(args.review), "REVIEWED");
  const reviewInput = buildDependencyReviewInput(facts);
  const gate = buildPreinstallGate({
    facts,
    reviewInput,
    review,
    currentPackageJsonSha256: bytesSha256(await readRegular("package.json")),
    currentLockfileSha256: bytesSha256(await readRegular("pnpm-lock.yaml")),
  });
  process.stdout.write(`${JSON.stringify(gate)}\n`);
}

/** @param {Record<string,string>} args */
async function runPostinstall(args) {
  if (!args.facts || !args.review || !args["installed-at-utc"]) throw new Error("MCP_DEPENDENCY_ARGUMENT_INVALID");
  const facts = await jsonFile(args.facts);
  const review = assertDecisionArtifact(await jsonFile(args.review), "REVIEWED");
  const reviewInput = buildDependencyReviewInput(facts);
  buildPreinstallGate({
    facts,
    reviewInput,
    review,
    currentPackageJsonSha256: bytesSha256(await readRegular("package.json")),
    currentLockfileSha256: bytesSha256(await readRegular("pnpm-lock.yaml")),
  });
  const listCommand = await run("corepack", ["pnpm", "list", "--json", "--depth", "Infinity"]);
  if (listCommand.exitCode !== 0 || listCommand.signal !== null) throw new Error("MCP_DEPENDENCY_POSTINSTALL_GRAPH_NOT_RUN");
  const installed = parseList(JSON.parse(listCommand.stdout.toString("utf8")));
  const currentGraphSha256 = sha256(installed.map(({ coordinate, resolved }) => ({ coordinate, resolved })));
  const nodeModules = await lstat("node_modules");
  const completed = buildPostinstallArtifact({
    facts,
    reviewInput,
    review,
    currentGraphSha256,
    currentPackageJsonSha256: bytesSha256(await readRegular("package.json")),
    currentLockfileSha256: bytesSha256(await readRegular("pnpm-lock.yaml")),
    installedAtUtc: args["installed-at-utc"],
    verifiedAtUtc: new Date().toISOString(),
    nodeModulesType: nodeModules.isDirectory() && !nodeModules.isSymbolicLink() ? "directory" : "invalid",
  });
  await writeAtomic(args.review, stableJson(completed));
  process.stdout.write(`${JSON.stringify({ status: "PASS", review: args.review, coordinateCount: installed.length })}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const { mode, args } = parseArgs(argv);
  if (mode === "facts") return runFacts(args);
  if (mode === "preinstall") return runPreinstall(args);
  if (mode === "postinstall") return runPostinstall(args);
  throw new Error("MCP_DEPENDENCY_MODE_NOT_IMPLEMENTED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "BLOCK_MCP_DEPENDENCY_AUDIT"}\n`);
    process.exitCode = 1;
  });
}
