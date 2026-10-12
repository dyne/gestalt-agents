#!/usr/bin/env node
/** One transaction. This entry is launched ONLY inside L9's native boundary. */
import { readFileSync, realpathSync, mkdirSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

export const LIVE_CONTEXT_TOOLS = Object.freeze([
  "ctx_execute", "ctx_execute_file", "ctx_batch_execute", "ctx_index",
  "ctx_search", "ctx_stats", "ctx_purge",
]);
const bridge = 'exec "$@" < <(exec /usr/bin/cat) > >(exec /usr/bin/cat) 2> >(exec /usr/bin/cat >&2)';
const nativeSpawn = childProcess.spawn, nativeSpawnSync = childProcess.spawnSync;
// Native restricted-network seccomp denies getsockname. Node socketpair stdio
// is then unusable in child interpreters. Give descendants real POSIX pipes,
// without changing any filesystem/network policy or inherited authority.
function bridgeArgs(command, args) { return ["-c", bridge, "live-stdio", command, ...args]; }
function installPosixStdio() {
  childProcess.spawn = (command, args = [], options = {}) => nativeSpawn("/usr/bin/bash", bridgeArgs(command, args), options);
  childProcess.spawnSync = (command, args = [], options = {}) => nativeSpawnSync("/usr/bin/bash", bridgeArgs(command, args), options);
  syncBuiltinESMExports();
}

async function main() {
  const [runtimeFlag, runtime, workspaceFlag, workspace, ...extra] = process.argv.slice(2);
  if (runtimeFlag !== "--runtime" || workspaceFlag !== "--workspace" || extra.length
    || !isAbsolute(runtime ?? "") || !isAbsolute(workspace ?? "")
    || realpathSync(runtime) !== runtime || realpathSync(workspace) !== workspace) throw new Error("invalid-worker-input");
  const bytes = readFileSync(0);
  if (bytes.length > 262144) throw new Error("oversized-worker-request");
  const request = JSON.parse(bytes);
  if (!["initialize", "tools/list", "tools/call"].includes(request.method)
    || request.method === "tools/call" && !LIVE_CONTEXT_TOOLS.includes(request.params?.name)) throw new Error("unsupported-live-tool");
  const state = join(workspace, ".gestalt", "context-mode");
  mkdirSync(state, { recursive: true, mode: 0o700 });
  // All runtime/storage settings are fixed by controller arguments. No private
  // bootstrap, signing key, credentials or host CODEX_HOME enters this process.
  for (const key of Object.keys(process.env)) {
    if (!["PATH", "LANG", "TMPDIR"].includes(key)) delete process.env[key];
  }
  Object.assign(process.env, {
    // Same admitted interpreter, discovered inside native confinement. This
    // changes no filesystem/network grants and never imports the host PATH.
    PATH: [...new Set([dirname(process.execPath), "/usr/bin", "/bin"])].join(":"),
    HOME: state, CONTEXT_MODE_PLATFORM: "codex", CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS: "1",
    CONTEXT_MODE_WORKSPACE: workspace, CONTEXT_MODE_PROJECT_DIR: workspace,
    CONTEXT_MODE_DIR: state, CONTEXT_MODE_DATA_DIR: join(workspace, ".gestalt"),
    CLAUDE_PROJECT_DIR: workspace,
  });
  process.chdir(workspace);
  installPosixStdio();
  const { server } = await import(pathToFileURL(join(runtime, "server.bundle.mjs")).href);
  let resolveResponse;
  const response = new Promise((done) => { resolveResponse = done; });
  const transport = {
    async start() {}, async close() {},
    async send(message) {
      if (message.id === "live-init") {
        if (message.error) { resolveResponse(message); return; }
        if (request.method === "initialize") { resolveResponse({ ...message, id: request.id }); return; }
        transport.onmessage({ jsonrpc: "2.0", method: "notifications/initialized" });
        transport.onmessage({ ...request, id: "live-request" });
      } else if (message.id === "live-request") {
        if (request.method === "tools/list" && message.result?.tools) {
          message.result.tools = message.result.tools.filter((tool) => LIVE_CONTEXT_TOOLS.includes(tool.name));
        }
        resolveResponse({ ...message, id: request.id });
      }
    },
  };
  await server.connect(transport);
  transport.onmessage({ jsonrpc: "2.0", id: "live-init", method: "initialize", params: {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "codex-live", version: "1" },
  } });
  const result = await response;
  await server.close();
  process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
}
// Importing the tool-name list in a host proxy must not execute worker code.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write("live-context-unavailable\n"); process.exit(1); });
}
