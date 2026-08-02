#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const required = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "hooks/codex-hooks.json",
  "start.mjs",
  "scripts/prepare-runtime.mjs",
  "scripts/runtime-preflight.mjs",
];

for (const relative of required) {
  if (!existsSync(resolve(root, relative))) failures.push(`missing ${relative}`);
}

try {
  const mcp = JSON.parse(readFileSync(resolve(root, ".mcp.json"), "utf8"));
  const config = mcp.mcpServers?.["context-mode"];
  if (config?.command !== "node") failures.push("MCP command must be node");
  if (JSON.stringify(config?.args) !== JSON.stringify(["./start.mjs"])) {
    failures.push('MCP args must be ["./start.mjs"]');
  }
  if (config?.env?.CONTEXT_MODE_PLATFORM !== "codex") {
    failures.push("MCP environment must select the codex platform");
  }
} catch (error) {
  failures.push(`invalid .mcp.json: ${error.message}`);
}

if (failures.length) {
  process.stderr.write(`codex-package: FAIL\n${failures.map((item) => `  - ${item}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("codex-package: OK\n");
