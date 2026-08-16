// @ts-check

import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

/** @returns {never} */
function blocked() {
  throw new Error("MCP_NETWORK_BLOCKED");
}

const guardedGlobal = /** @type {Record<string, unknown>} */ (globalThis);
Object.defineProperty(guardedGlobal, "fetch", {
  configurable: false,
  enumerable: true,
  value: blocked,
  writable: false,
});

/** @type {Array<[object, string]>} */
const blockedMethods = [
  [http, "request"],
  [http, "get"],
  [https, "request"],
  [https, "get"],
  [net, "connect"],
  [net, "createConnection"],
  [tls, "connect"],
];

for (const [owner, name] of blockedMethods) {
  Object.defineProperty(owner, name, {
    configurable: false,
    enumerable: true,
    value: blocked,
    writable: false,
  });
}
