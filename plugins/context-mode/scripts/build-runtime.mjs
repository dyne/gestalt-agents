#!/usr/bin/env node
/** Shared esbuild owner; no npm lifecycle shell or platform .bin shims. */
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BUNDLES = [
  ["src/server.ts", "server.bundle.mjs", ["better-sqlite3", "turndown", "turndown-plugin-gfm", "@mixmark-io/domino"]],
  ["src/cli.ts", "cli.bundle.mjs", ["better-sqlite3"]],
  ["src/session/extract.ts", "hooks/session-extract.bundle.mjs", []],
  ["src/session/snapshot.ts", "hooks/session-snapshot.bundle.mjs", []],
  ["src/session/project-attribution.ts", "hooks/session-attribution.bundle.mjs", []],
  ["src/session/db.ts", "hooks/session-db.bundle.mjs", ["better-sqlite3"]],
  ["src/security.ts", "hooks/security.bundle.mjs", []],
  ["src/adapters/codex/usage.ts", "hooks/codex-usage.bundle.mjs", []],
];

export async function buildRuntime(pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const require = createRequire(join(pluginRoot, "package.json"));
  const { build } = require("esbuild");
  for (const [entry, output, external] of BUNDLES) await build({
    absWorkingDir: pluginRoot, entryPoints: [entry], outfile: output, external,
    bundle: true, platform: "node", target: "node18", format: "esm", minify: true,
  });
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; } // Library imports through eval/stdin have no entry file.
}

if (isDirectInvocation()) await buildRuntime();
