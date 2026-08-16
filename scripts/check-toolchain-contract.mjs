// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PACKAGE_MANAGER = "pnpm@10.34.5+sha512.a4ee05f2f73658255bd6a89859c065a45c28a57daefae2c893a168ee2b73168c37b91e83e57ea67654ad03f03031746430e8bce38e362e042605fb8abc80192e";

export const EXPECTED_SCRIPTS = Object.freeze({
  typecheck: "tsc -p tsconfig.json",
  lint: "eslint .",
  test: "node --test",
  start: "node src/server/stdio.mjs",
});

export const EXPECTED_DEPENDENCIES = Object.freeze({
  "@modelcontextprotocol/server": "2.0.0",
  zod: "4.2.0",
});

export const EXPECTED_DEV_DEPENDENCIES = Object.freeze({
  "@modelcontextprotocol/client": "2.0.0",
  "@types/node": "22.19.15",
  eslint: "9.39.4",
  typescript: "5.9.2",
});

/** @param {unknown} actual @param {unknown} expected @param {string} code */
function exact(actual, expected, code) {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch {
    throw new Error(code);
  }
}

/** @param {string} root */
export async function checkToolchainContract(root = process.cwd()) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  } catch {
    throw new Error("MCP_PACKAGE_MANIFEST_INVALID");
  }
  exact(Object.keys(manifest), [
    "name", "version", "private", "type", "engines", "packageManager",
    "scripts", "dependencies", "devDependencies",
  ], "MCP_PACKAGE_MANIFEST_KEYS_DRIFT");
  exact(manifest.name, "filmlune-mcp", "MCP_PACKAGE_NAME_DRIFT");
  exact(manifest.version, "0.1.0", "MCP_PACKAGE_VERSION_DRIFT");
  exact(manifest.private, true, "MCP_PACKAGE_PRIVATE_DRIFT");
  exact(manifest.type, "module", "MCP_PACKAGE_MODULE_DRIFT");
  exact(manifest.engines, { node: "22.22.2" }, "MCP_PACKAGE_ENGINE_DRIFT");
  exact(manifest.packageManager, PACKAGE_MANAGER, "MCP_PACKAGE_MANAGER_DRIFT");
  exact(manifest.scripts, EXPECTED_SCRIPTS, "MCP_PACKAGE_SCRIPTS_DRIFT");
  exact(manifest.dependencies, EXPECTED_DEPENDENCIES, "MCP_PACKAGE_DEPENDENCIES_DRIFT");
  exact(manifest.devDependencies, EXPECTED_DEV_DEPENDENCIES, "MCP_PACKAGE_DEV_DEPENDENCIES_DRIFT");
  if (await readFile(path.join(root, ".node-version"), "utf8") !== "22.22.2\n") {
    throw new Error("MCP_NODE_VERSION_FILE_DRIFT");
  }
  return Object.freeze({ node: "22.22.2", packageManager: PACKAGE_MANAGER });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await checkToolchainContract();
}
