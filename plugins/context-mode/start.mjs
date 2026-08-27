#!/usr/bin/env node
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { existsSync, lstatSync, realpathSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureCodexHome } from "./scripts/codex-profile.mjs";
import { getRuntimeRoot } from "./scripts/runtime-location.mjs";
import { verifyPreparedRuntime } from "./scripts/runtime-preflight.mjs";

const pluginRoot = dirname(fileURLToPath(import.meta.url));

function resolveWorkspaceStateRoot(workspace) {
  if (!isAbsolute(workspace)) throw new Error("CONTEXT_MODE_WORKSPACE must be an absolute workspace path.");
  const canonical = realpathSync.native(resolve(workspace));
  if (canonical === resolve(canonical, "..")) throw new Error("CONTEXT_MODE_WORKSPACE must not be a filesystem root.");
  const gestalt = join(canonical, ".gestalt");
  const state = join(gestalt, "context-mode");
  if ((existsSync(gestalt) && lstatSync(gestalt).isSymbolicLink()) ||
      (existsSync(state) && lstatSync(state).isSymbolicLink())) {
    throw new Error("context-mode workspace state must not traverse a symlink.");
  }
  const rel = relative(canonical, state);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("context-mode state escapes workspace.");
  return state;
}

// Codex does not publish a workspace environment variable to MCP children.
// Its supported per-thread session transcript is therefore the authoritative
// handoff: line one records meta.cwd (CLI) or session_meta.payload.cwd
// (Desktop). Never substitute the MCP launch cwd or a generic project env.
function resolveCodexSessionWorkspace() {
  const threadId = process.env.CODEX_THREAD_ID;
  const codexHome = process.env.CODEX_HOME;
  if (!threadId || !codexHome) return null;
  const sessions = join(codexHome, "sessions");
  const escapedThreadId = threadId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rolloutName = new RegExp(`^rollout-.+-${escapedThreadId}\\.jsonl$`);
  const stack = [[sessions, 0]];
  const matches = [];
  let seen = 0;
  while (stack.length > 0 && seen < 10_000) {
    const [dir, depth] = stack.pop();
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (++seen > 10_000) break;
      const file = join(dir, name);
      let stat;
      try { stat = lstatSync(file); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory() && depth < 4) { stack.push([file, depth + 1]); continue; }
      if (!stat.isFile() || (name !== `${threadId}.jsonl` && !rolloutName.test(name))) continue;
      matches.push(file);
    }
  }
  matches.sort();
  for (const file of matches) {
      let fd;
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        fd = openSync(file, "r");
        const bytes = readSync(fd, buffer, 0, buffer.length, 0);
        for (const line of buffer.subarray(0, bytes).toString("utf8").split("\n").slice(0, 10)) {
          const record = JSON.parse(line); const cwd = record?.meta?.cwd ?? (record?.type === "session_meta" ? record?.payload?.cwd : undefined);
          if (typeof cwd === "string" && cwd.length > 0 &&
              !/[/\\]\.codex[/\\]plugins[/\\](cache|marketplaces)[/\\]/.test(cwd)) return cwd;
        }
      } catch { /* malformed or transient transcript: bounded failure below */
      } finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
  }
  return null;
}

const suppliedWorkspace = process.env.CONTEXT_MODE_WORKSPACE?.trim() || resolveCodexSessionWorkspace();
if (!suppliedWorkspace) {
  process.stderr.write(
    "CONTEXT_MODE_WORKSPACE_REQUIRED\n" +
    "context-mode requires the canonical session workspace in CONTEXT_MODE_WORKSPACE; refusing to infer state from cwd or a legacy project variable.\n",
  );
  process.exit(78);
}

let stateRoot;
try {
  stateRoot = resolveWorkspaceStateRoot(suppliedWorkspace);
} catch (error) {
  process.stderr.write(`CONTEXT_MODE_WORKSPACE_INVALID\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(78);
}

const workspace = realpathSync.native(resolve(suppliedWorkspace));
ensureCodexHome(pluginRoot);
process.env.CONTEXT_MODE_PLATFORM = "codex";
process.env.CONTEXT_MODE_WORKSPACE = workspace;
process.env.CONTEXT_MODE_PROJECT_DIR = workspace;
process.env.CONTEXT_MODE_DIR = stateRoot;
process.env.CONTEXT_MODE_DATA_DIR = dirname(stateRoot);
process.env.CLAUDE_PROJECT_DIR = workspace; // shared storage compatibility

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  process.stderr.write(
    `CONTEXT_MODE_UNSUPPORTED_RUNTIME\n` +
    `context-mode requires Node.js 22.5 or newer; found ${process.versions.node}.\n`,
  );
  process.exit(78);
}

const runtimeRoot = getRuntimeRoot(pluginRoot);
const prepared = verifyPreparedRuntime(runtimeRoot);
if (!prepared.ok) {
  process.stderr.write(
    `CONTEXT_MODE_NOT_PREPARED\n` +
    `context-mode cannot start because its external runtime is incomplete: ${runtimeRoot}\n` +
    `Missing or invalid: ${prepared.problems.join(", ")}\n` +
    `Run gestalt-setup.sh from the Gestalt marketplace checkout, then restart Codex.\n`,
  );
  process.exit(78);
}

process.chdir(runtimeRoot);
await import(pathToFileURL(join(runtimeRoot, "server.bundle.mjs")).href);
