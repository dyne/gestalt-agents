#!/usr/bin/env node
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPreparedRuntime } from "./scripts/runtime-preflight.mjs";

const pluginRoot = dirname(fileURLToPath(import.meta.url));
const projectDir = process.cwd();

process.env.CONTEXT_MODE_PLATFORM = "codex";
process.env.CONTEXT_MODE_PROJECT_DIR ??= projectDir;
process.env.CLAUDE_PROJECT_DIR ??= projectDir; // shared storage compatibility
process.chdir(pluginRoot);

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  process.stderr.write(
    `CONTEXT_MODE_UNSUPPORTED_RUNTIME\n` +
    `context-mode requires Node.js 22.5 or newer; found ${process.versions.node}.\n`,
  );
  process.exit(78);
}

const prepared = verifyPreparedRuntime(pluginRoot);
if (!prepared.ok) {
  process.stderr.write(
    `CONTEXT_MODE_NOT_PREPARED\n` +
    `context-mode cannot start because its prepared runtime is incomplete.\n` +
    `Missing or invalid: ${prepared.problems.join(", ")}\n` +
    `Run gestalt-setup.sh from the Gestalt marketplace checkout, then restart Codex.\n`,
  );
  process.exit(78);
}

await import("./server.bundle.mjs");
