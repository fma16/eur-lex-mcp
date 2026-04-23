#!/usr/bin/env node
import fs from "node:fs";

const path = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(path, "utf8"));

const requiredTopLevel = [
  "manifest_version",
  "name",
  "version",
  "description",
  "author",
  "server"
];

for (const key of requiredTopLevel) {
  if (!(key in manifest)) {
    throw new Error(`manifest.json missing required field: ${key}`);
  }
}

if (!["0.3", "0.4"].includes(manifest.manifest_version)) {
  throw new Error("manifest_version must be 0.3 or 0.4");
}

if (manifest.server?.type !== "node") {
  throw new Error("server.type must be 'node' for this bundle");
}

if (!manifest.server?.entry_point) {
  throw new Error("server.entry_point is required");
}

if (!manifest.server?.mcp_config?.command) {
  throw new Error("server.mcp_config.command is required");
}

if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
  throw new Error("manifest.tools must list at least one tool");
}

console.log("Manifest validation passed.");
