#!/usr/bin/env node
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { ensureCodexHome } from "../scripts/codex-profile.mjs";
import { getRuntimeRoot } from "../scripts/runtime-location.mjs";
import { verifyPreparedRuntime } from "../scripts/runtime-preflight.mjs";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const hook = process.argv[2];
const allowed = new Set([
  "pretooluse",
  "posttooluse",
  "sessionstart",
  "precompact",
  "userpromptsubmit",
  "stop",
]);

if (!allowed.has(hook)) {
  process.stderr.write(`CONTEXT_MODE_INVALID_HOOK\nUnknown Codex hook: ${hook ?? ""}\n`);
  process.exit(64);
}

ensureCodexHome(pluginRoot);
const runtimeRoot = getRuntimeRoot(pluginRoot);
const prepared = verifyPreparedRuntime(runtimeRoot);
if (!prepared.ok) {
  process.stderr.write(
    `CONTEXT_MODE_NOT_PREPARED\n` +
    `context-mode hook runtime is incomplete: ${runtimeRoot}\n` +
    `Missing or invalid: ${prepared.problems.join(", ")}\n` +
    `Run gestalt-setup.sh, then restart Codex.\n`,
  );
  process.exit(78);
}

process.env.CONTEXT_MODE_PLATFORM = "codex";
await import(pathToFileURL(join(runtimeRoot, "hooks", "codex", `${hook}.mjs`)).href);
