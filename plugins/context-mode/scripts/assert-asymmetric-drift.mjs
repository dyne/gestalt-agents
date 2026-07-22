#!/usr/bin/env node
// Issue #531 — asymmetric-drift invariant asserter.
//
// The Claude MCP configuration lives in TWO source-tracked files:
//
//   1. `.mcp.json.example`                    (Claude contributor template.)
//   2. `.claude-plugin/plugin.json`           (Claude Code's primary read path
//                                              for installed plugins. cli.ts
//                                              upgrade() writes a matching
//                                              .mcp.json into the plugin cache.)
//
// If the two source-tracked files drift, fresh installs break silently
// (the #253 regression survived a full release cycle because no invariant
// caught the bare `./start.mjs` shape).
//
// This script is the build-chain half of the slice-9 invariant pair.
// The vitest sibling (tests/scripts/asymmetric-drift-assert.test.ts) covers
// the source tree at test time; this script covers the build chain — wired
// into `npm run build` so any regression surfaces in CI before publish.
//
// Contract:
//   - Read `.mcp.json.example` and `.claude-plugin/plugin.json` from --root.
//   - Extract mcpServers["context-mode"].args[0] from each.
//   - Assert both equal the literal `${CLAUDE_PLUGIN_ROOT}/start.mjs`.
//   - Assert the two values are equal (the explicit drift check).
//   - Read the shipped Codex `.mcp.json` separately and assert its relative
//     path contract. Codex does not interpolate `${CLAUDE_PLUGIN_ROOT}`.
//   - Exit 0 on success, 1 with a violations report on failure.
//
// Usage:
//   node scripts/assert-asymmetric-drift.mjs              # checks repo root
//   node scripts/assert-asymmetric-drift.mjs --root <dir> # checks <dir>

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}/start.mjs";
const CODEX_ENTRYPOINT = "./start.mjs";
const PLUGIN_KEY = "context-mode";
const SKILLS_PATH = "./skills/";
const REQUIRED_PLUGIN_RUNTIME_FILES = [
  "start.mjs",
  "server.bundle.mjs",
  "cli.bundle.mjs",
];

function parseArgs(argv) {
  const out = { root: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && i + 1 < argv.length) {
      out.root = argv[i + 1];
      i++;
    }
  }
  return out;
}

function readArgs0(filePath) {
  if (!existsSync(filePath)) return { ok: false, error: `missing: ${filePath}` };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    return { ok: false, error: `parse-failed (${filePath}): ${err && err.message}` };
  }
  const servers = parsed && parsed.mcpServers;
  if (!servers || typeof servers !== "object") {
    return { ok: false, error: `no mcpServers in ${filePath}` };
  }
  const ours = servers[PLUGIN_KEY];
  if (!ours || typeof ours !== "object" || !Array.isArray(ours.args) || ours.args.length === 0) {
    return { ok: false, error: `no args[] for ${PLUGIN_KEY} in ${filePath}` };
  }
  const a0 = ours.args[0];
  if (typeof a0 !== "string") {
    return { ok: false, error: `args[0] not a string in ${filePath}` };
  }
  return { ok: true, value: a0 };
}

function readJson(filePath) {
  if (!existsSync(filePath)) return { ok: false, error: `missing: ${filePath}` };
  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, "utf-8")) };
  } catch (err) {
    return { ok: false, error: `parse-failed (${filePath}): ${err && err.message}` };
  }
}

function main() {
  const { root: explicitRoot } = parseArgs(process.argv.slice(2));
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const root = explicitRoot
    ? resolve(explicitRoot)
    : resolve(__dirname, "..");

  const exampleJsonPath = resolve(root, ".mcp.json.example");
  const pluginJsonPath = resolve(root, ".claude-plugin", "plugin.json");
  const codexMcpJsonPath = resolve(root, ".mcp.json");

  /** @type {string[]} */
  const violations = [];

  const example = readArgs0(exampleJsonPath);
  const plg = readArgs0(pluginJsonPath);
  const pluginJson = readJson(pluginJsonPath);

  if (!example.ok) violations.push(example.error);
  if (!plg.ok) violations.push(plg.error);

  if (example.ok && example.value !== PLACEHOLDER) {
    violations.push(
      `.mcp.json.example args[0] is "${example.value}" but must equal "${PLACEHOLDER}". ` +
        `Contributors copy this template to .mcp.json for local dev, so the template MUST hold the canonical form. (Issue #531 / #253 class.)`,
    );
  }
  if (plg.ok && plg.value !== PLACEHOLDER) {
    violations.push(
      `.claude-plugin/plugin.json args[0] is "${plg.value}" but must equal "${PLACEHOLDER}". (Issue #523 class.)`,
    );
  }
  if (example.ok && plg.ok && example.value !== plg.value) {
    violations.push(
      `asymmetric drift: .mcp.json.example args[0]="${example.value}" vs .claude-plugin/plugin.json args[0]="${plg.value}". The two source-tracked manifests MUST agree so contributors copying the template and end-users via marketplace install resolve the same start.mjs.`,
    );
  }

  if (pluginJson.ok) {
    const skills = pluginJson.value && pluginJson.value.skills;
    if (skills !== SKILLS_PATH) {
      violations.push(
        `.claude-plugin/plugin.json skills is "${skills}" but must equal "${SKILLS_PATH}". The npm package ships top-level skills/, not .claude/skills/.`,
      );
    }
    if (!existsSync(resolve(root, "skills"))) {
      violations.push(`missing skills directory at ${resolve(root, "skills")}`);
    }
  } else {
    violations.push(pluginJson.error);
  }

  for (const rel of REQUIRED_PLUGIN_RUNTIME_FILES) {
    if (!existsSync(resolve(root, rel))) {
      violations.push(
        `missing plugin runtime file at ${resolve(root, rel)}. ` +
          `.claude-plugin/plugin.json can load but the MCP server will expose zero tools if ${rel} is absent.`,
      );
    }
  }

  const codex = readArgs0(codexMcpJsonPath);
  if (!codex.ok) {
    violations.push(codex.error);
  } else if (codex.value !== CODEX_ENTRYPOINT) {
    violations.push(
      `.mcp.json args[0] is "${codex.value}" but must equal "${CODEX_ENTRYPOINT}". ` +
        `Codex does not interpolate plugin-root placeholders.`,
    );
  }

  if (violations.length > 0) {
    process.stderr.write("asymmetric-drift: FAIL\n");
    for (const v of violations) {
      process.stderr.write(`  - ${v}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `asymmetric-drift: OK (Claude manifests pin args[0] to ${PLACEHOLDER}; Codex .mcp.json pins ${CODEX_ENTRYPOINT}; plugin skills path is ${SKILLS_PATH}; runtime files present)\n`,
  );
}

main();
