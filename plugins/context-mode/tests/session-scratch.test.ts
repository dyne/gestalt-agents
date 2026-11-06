import { createHash, randomUUID } from "node:crypto";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resolveScratchDirectory, resolveSessionScratch, scratchEnvironment, SESSION_SCRATCH_GUIDANCE, type SessionScratchContext } from "../scripts/session-scratch.mjs";
import { createCodexRoutingReminder } from "../hooks/routing-block.mjs";
import { isMCPReady, sentinelDir, sentinelPathForPid } from "../hooks/core/mcp-ready.mjs";
import { PolyglotExecutor } from "../src/executor.js";
import { buildCommand, type RuntimeMap } from "../src/runtime.js";
import { defaultDBPath } from "../src/db-base.js";
import { resolveWorkspaceStateRoot } from "../src/workspace-state.js";
import { cleanupStaleDBs } from "../src/store.js";
import { retrievalMarkerPath } from "../src/session/retrieval-marker.js";

// Native ESM namespace exports cannot be replaced with spyOn. Vitest's
// module factory supplies mutable mocks while keeping real subprocess/fs work.
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, mkdtempSync: vi.fn(actual.mkdtempSync) };
});

let root: string;
let nativeMkdtemp: typeof fs.mkdtempSync;
let servers: Array<{ close: () => Promise<void> }> = [];
const runtime: RuntimeMap = {
  javascript: process.execPath, typescript: "tsx", python: "python3", shell: "/bin/sh",
  ruby: null, go: null, rust: null, php: null, perl: null, r: null, elixir: null, csharp: null,
};
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function owner(sessionId: string, kind = "mobile-session"): SessionScratchContext {
  const workspacePath = join(root, "workspace with spaces");
  const ownerId = kind === "mobile-session" ? "mobile-" + createHash("sha256").update(sessionId).digest("hex")
    : (kind === "cli-session" ? "cli-" : "service-") + randomUUID();
  const directory = join(workspacePath, "tmp", "sessions", ownerId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const context = { schemaVersion: 1 as const, workspacePath, ownerId, directory, markerPath: join(directory, ".gestalt-owner.json") };
  const leaseId = randomUUID(), createdAt = new Date().toISOString();
  const marker = {
    schemaVersion: 1, ownerKind: kind, ownerId, workspacePath,
    sessionId: kind === "mobile-session" ? sessionId : ownerId, createdAt,
    authority: kind === "mobile-session" ? { kind: "mobile-roster", sessionId } : { kind: "lease", leaseId }, providerThreads: [],
  };
  fs.writeFileSync(context.markerPath, JSON.stringify(marker), { mode: 0o600 });
  if (kind !== "mobile-session") {
    fs.mkdirSync(join(directory, "leases"), { mode: 0o700 });
    fs.writeFileSync(join(directory, "leases", leaseId + ".json"), JSON.stringify({
      schemaVersion: 1, ownerId, workspacePath, leaseId, state: "active", processIdentity: randomUUID(),
      createdAt, updatedAt: createdAt, consumers: [ownerId],
    }), { mode: 0o600 });
  }
  return context;
}

function use(context: SessionScratchContext) {
  vi.stubEnv("GESTALT_SESSION_TMP_CONTEXT", JSON.stringify(context));
  // Deliberately unusable ambient values must not override the validated owner.
  for (const key of ["TMPDIR", "TMP", "TEMP"]) vi.stubEnv(key, join(root, "forbidden-os-temp"));
}

beforeEach(async () => {
  const nativeFs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const nativeChild = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  nativeMkdtemp = nativeFs.mkdtempSync;
  vi.mocked(fs.mkdtempSync).mockReset().mockImplementation(nativeMkdtemp);
  vi.mocked(childProcess.execFileSync).mockReset().mockImplementation(nativeChild.execFileSync);
  root = fs.realpathSync(nativeMkdtemp(join(tmpdir(), "ss-"))); servers = [];
});
afterEach(async () => {
  await Promise.all(servers.map(server => server.close()));
  vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true });
});

describe("v1 managed scratch validation", () => {
  test.each(["mobile-session", "cli-session", "workspace-service"])("validates %s and derives exactly three temp values", kind => {
    const context = owner("session-a", kind); use(context);
    expect(resolveSessionScratch()).toEqual(context);
    const environment = scratchEnvironment();
    expect(environment.GESTALT_SESSION_TMP_CONTEXT).toBe(JSON.stringify(context));
    for (const key of ["TMPDIR", "TMP", "TEMP"]) expect(environment[key]).toBe(context.directory);
    if (process.platform === "win32") return;
    fs.chmodSync(join(context.workspacePath, "tmp"), 0o755);
    expect(resolveSessionScratch()).toEqual(context); // Existing tmp modes are preserved.
    expect(fs.statSync(join(context.workspacePath, "tmp")).mode & 0o777).toBe(0o755);
  });

  test.each(["", "null", "{}", "not-json", '{"schemaVersion":2}'])("fails visibly for present invalid context %j", value => {
    vi.stubEnv("GESTALT_SESSION_TMP_CONTEXT", value);
    expect(() => resolveScratchDirectory(() => { throw Error("fallback must not run"); })).toThrow("SESSION_SCRATCH_INVALID_CONTEXT");
    expect(() => sentinelDir()).toThrow("SESSION_SCRATCH_INVALID_CONTEXT");
    expect(() => isMCPReady()).toThrow("SESSION_SCRATCH_INVALID_CONTEXT");
  });

  test.each(["directory", "marker", "container", "workspace", "mode", "marker-mode", "uid", "identity", "traversal"].filter(fault => process.platform !== "win32" || !["mode", "marker-mode", "uid"].includes(fault)))("rejects %s mismatch without path leakage", fault => {
    const context = owner("session-a"); use(context);
    if (fault === "directory") {
      const moved = context.directory + "-real"; fs.renameSync(context.directory, moved); fs.symlinkSync(moved, context.directory, "dir");
    } else if (fault === "marker") {
      const moved = context.markerPath + "-real"; fs.renameSync(context.markerPath, moved); fs.symlinkSync(moved, context.markerPath);
    } else if (fault === "container" || fault === "workspace") {
      const target = fault === "container" ? dirname(context.directory) : context.workspacePath;
      fs.renameSync(target, target + "-real"); fs.symlinkSync(target + "-real", target, "dir");
    } else if (fault === "mode") fs.chmodSync(context.directory, 0o755);
    else if (fault === "marker-mode") fs.chmodSync(context.markerPath, 0o644);
    else if (fault === "uid") vi.spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 1);
    else if (fault === "identity") {
      const marker = JSON.parse(fs.readFileSync(context.markerPath, "utf8")); marker.sessionId = "different";
      fs.writeFileSync(context.markerPath, JSON.stringify(marker));
    } else vi.stubEnv("GESTALT_SESSION_TMP_CONTEXT", JSON.stringify({ ...context, directory: context.directory + "/../escaped" }));
    expect(() => resolveSessionScratch()).toThrow(/^SESSION_SCRATCH_INVALID_CONTEXT: managed temporary context validation failed$/);
  });

  test.each(["released", "missing", "link", "foreign-owner"])("rejects %s primary lease", fault => {
    const context = owner("service", "workspace-service"); use(context);
    const leases = join(context.directory, "leases"), file = join(leases, fs.readdirSync(leases)[0]);
    if (fault === "missing") fs.unlinkSync(file);
    else if (fault === "link") { fs.renameSync(file, file + "-real"); fs.symlinkSync(file + "-real", file); }
    else { const lease = JSON.parse(fs.readFileSync(file, "utf8")); if (fault === "released") lease.state = "released"; else lease.ownerId = "other"; fs.writeFileSync(file, JSON.stringify(lease)); }
    expect(() => resolveSessionScratch()).toThrow("SESSION_SCRATCH_INVALID_CONTEXT");
  });

  test("absent context retains operator fallback and legacy Unix readiness", () => {
    delete process.env.GESTALT_SESSION_TMP_CONTEXT;
    vi.stubEnv("TMPDIR", root); vi.stubEnv("TMP", "operator-tmp"); vi.stubEnv("TEMP", "operator-temp");
    delete process.env.CONTEXT_MODE_MCP_SENTINEL_DIR;
    expect(resolveSessionScratch()).toBeNull();
    expect(resolveScratchDirectory()).toBe(tmpdir());
    expect(scratchEnvironment().TMP).toBe("operator-tmp");
    expect(scratchEnvironment().TEMP).toBe("operator-temp");
    expect(sentinelDir()).toBe(process.platform === "win32" ? tmpdir() : "/tmp");
    expect(buildCommand(runtime, "typescript", "/script.ts")).toEqual(["tsx", "/script.ts"]);
  });
});

describe.skipIf(process.platform === "win32")("managed native execution", () => {
  test("generated executables run under managed workspace scratch", () => {
    const context = owner("session-a"); use(context);
    const script = join(context.directory, "generated-command");
    fs.writeFileSync(script, "#!/bin/sh\nprintf workspace-executable", { mode: 0o700 });
    expect(childProcess.execFileSync(script, [], { encoding: "utf8", env: scratchEnvironment() })).toBe("workspace-executable");
  });
  test.each(["javascript", "shell", "python"] as const)("%s stays executable inside owner when OS temp creation is forbidden", async language => {
    const context = owner("session-a"); use(context);
    const fallback = vi.mocked(childProcess.execFileSync).mockImplementation(() => { throw Error("OS temp discovery forbidden"); });
    const allocations = vi.mocked(fs.mkdtempSync).mockImplementation(((prefix: string) => {
      if (!prefix.startsWith(context.directory + "/")) throw Error("EACCES: OS temporary creation forbidden (noexec fixture)");
      return nativeMkdtemp(prefix);
    }) as typeof fs.mkdtempSync);
    const executor = new PolyglotExecutor({ runtimes: runtime, projectRoot: context.workspacePath });
    const code = language === "javascript" ? "console.log(JSON.stringify([process.env.TMPDIR,process.env.TMP,process.env.TEMP,process.env.GESTALT_SESSION_TMP_CONTEXT,__filename]))"
      : language === "python" ? "import os,json\nprint(json.dumps([os.environ[k] for k in ['TMPDIR','TMP','TEMP','GESTALT_SESSION_TMP_CONTEXT']]+[__file__]))"
      : "printf '%s\\n' \"$TMPDIR\" \"$TMP\" \"$TEMP\" \"$GESTALT_SESSION_TMP_CONTEXT\" \"$0\"";
    const result = await executor.execute({ language, code, timeout: 10_000 });
    expect(result.exitCode, result.stderr).toBe(0);
    const values = language === "shell" ? result.stdout.trim().split("\n") : JSON.parse(result.stdout.trim());
    expect(values.slice(0, 3)).toEqual(Array(3).fill(context.directory));
    expect(JSON.parse(values[3])).toEqual(context);
    expect(values[4]).toContain(join(context.directory, ".ctx-mode-"));
    expect(fallback).not.toHaveBeenCalled(); expect(allocations).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(context.directory).sort()).toEqual([".gestalt-owner.json", "leases"]);
    const completedLeases = fs.readdirSync(join(context.directory, "leases"))
      .map(name => JSON.parse(fs.readFileSync(join(context.directory, "leases", name), "utf8")));
    expect(completedLeases).toHaveLength(1);
    expect(completedLeases[0]).toMatchObject({ state: "released", consumers: [] });
  });

  test("concurrent executions have separate children and preserve sibling crash leftovers", async () => {
    const context = owner("session-a"), sibling = owner("session-b"); use(context);
    const leftover = join(context.directory, ".ctx-mode-crash-leftover"); fs.mkdirSync(leftover); fs.writeFileSync(join(leftover, "keep"), "retained");
    const executor = new PolyglotExecutor({ runtimes: runtime, projectRoot: context.workspacePath });
    const results = await Promise.all([1, 2].map(() => executor.execute({ language: "javascript", code: "setTimeout(()=>console.log(__filename),50)", timeout: 5_000 })));
    expect(results.map(result => result.exitCode)).toEqual([0, 0]);
    expect(results[0].stdout).not.toBe(results[1].stdout);
    expect(fs.existsSync(join(leftover, "keep"))).toBe(true); expect(fs.existsSync(sibling.markerPath)).toBe(true);
    expect(fs.readdirSync(context.directory).sort()).toEqual([".ctx-mode-crash-leftover", ".gestalt-owner.json", "leases"]);
    const completedLeases = fs.readdirSync(join(context.directory, "leases"))
      .map(name => JSON.parse(fs.readFileSync(join(context.directory, "leases", name), "utf8")));
    expect(completedLeases).toHaveLength(2);
    expect(completedLeases.every(lease => lease.state === "released" && lease.consumers.length === 0)).toBe(true);
  });

  test("managed TypeScript loads from the runtime installation without the tsx IPC socket", async () => {
    const context = owner("session-a"); use(context);
    const command = buildCommand(runtime, "typescript", join(root, "example.ts"));
    expect(command[0]).toBe(process.execPath); expect(command[1]).toBe("--import");
    expect(command[2]).toContain("tsx"); expect(command[2]).not.toContain(context.workspacePath);
    const executor = new PolyglotExecutor({ runtimes: runtime, projectRoot: context.workspacePath });
    const result = await executor.execute({ language: "typescript", code: "const value: string = 'typed-ok'; console.log(value)", timeout: 10_000 });
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toContain("typed-ok");
    // Transpilation cache files may remain in the owner; no CLI IPC server
    // is needed, and this deliberately long workspace/owner path still works.
    expect(context.directory.length).toBeGreaterThan(100);
  });

  test("standalone executor retains OS discovery instead of ambient TMPDIR", async () => {
    delete process.env.GESTALT_SESSION_TMP_CONTEXT;
    const legacy = join(root, "legacy-os"); fs.mkdirSync(legacy);
    vi.stubEnv("TMPDIR", join(root, "unusable-override"));
    vi.mocked(childProcess.execFileSync).mockReturnValue(process.platform === "darwin" ? legacy : join(legacy, "unused"));
    const result = await new PolyglotExecutor({ runtimes: runtime, projectRoot: root }).execute({ language: "javascript", code: "console.log(__filename)", timeout: 5_000 });
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toContain(join(legacy, ".ctx-mode-"));
  });
});

test("sentinel producer/consumer and temporary DB share ownership; persistent state stays separate", () => {
  const a = owner("session-a"), b = owner("session-b"); use(a);
  vi.stubEnv("CONTEXT_MODE_MCP_SENTINEL_DIR", join(root, "untrusted-override"));
  const sentinel = sentinelPathForPid(process.pid);
  expect(sentinel).toBe(join(a.directory, `context-mode-mcp-ready-${process.pid}`));
  fs.writeFileSync(sentinel, String(process.pid)); expect(isMCPReady()).toBe(true);
  expect(defaultDBPath()).toBe(join(a.directory, `context-mode-${process.pid}.db`));
  expect(retrievalMarkerPath("/persistent/session.db", "/untrusted-temp")).toBe(join(a.directory, "context-mode-retrieval-session.db.txt"));
  const crashDB = join(a.directory, "context-mode-999999999.db"); fs.writeFileSync(crashDB, "unknown crash state");
  expect(cleanupStaleDBs()).toBe(0); expect(fs.existsSync(crashDB)).toBe(true);
  expect(resolveWorkspaceStateRoot({ CONTEXT_MODE_WORKSPACE: a.workspacePath })).toBe(join(a.workspacePath, ".gestalt", "context-mode"));
  use(b); expect(isMCPReady()).toBe(false); expect(fs.existsSync(sentinel)).toBe(true);
});

test("actual Codex SessionStart and child reminder deliver conditional scratch boundaries", () => {
  const context = owner("session-guidance"); use(context);
  const reminder = createCodexRoutingReminder((name: string) => name);
  expect(reminder).toContain(SESSION_SCRATCH_GUIDANCE);
  const result = childProcess.spawnSync(process.execPath, [join(pluginRoot, "hooks", "codex", "sessionstart.mjs")], {
    input: JSON.stringify({ source: "clear", cwd: context.workspacePath, session_id: "session-guidance" }),
    encoding: "utf8", env: { ...scratchEnvironment(), CODEX_HOME: join(root, "codex"), CONTEXT_MODE_WORKSPACE: context.workspacePath },
    timeout: 10_000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain(SESSION_SCRATCH_GUIDANCE);
  expect(SESSION_SCRATCH_GUIDANCE).toContain("With GESTALT_SESSION_TMP_CONTEXT, use validated owner TMPDIR");
  expect(SESSION_SCRATCH_GUIDANCE).toContain("children inherit context + TMPDIR/TMP/TEMP");
  expect(SESSION_SCRATCH_GUIDANCE).toContain("until Forget");
  expect(SESSION_SCRATCH_GUIDANCE).toContain("DBs/evidence/caches stay persistent");
});

async function startServer(context: SessionScratchContext) {
  const env: NodeJS.ProcessEnv = {
    ...process.env, GESTALT_SESSION_TMP_CONTEXT: JSON.stringify(context),
    TMPDIR: join(root, "forbidden-os-temp"), TMP: join(root, "forbidden-os-temp"), TEMP: join(root, "forbidden-os-temp"),
    CONTEXT_MODE_PLATFORM: "codex", CONTEXT_MODE_WORKSPACE: context.workspacePath,
    CONTEXT_MODE_PROJECT_DIR: context.workspacePath, CONTEXT_MODE_DIR: join(context.workspacePath, ".gestalt", "context-mode"),
    CODEX_THREAD_ID: context.ownerId, CONTEXT_MODE_DISABLE_VERSION_CHECK: "1",
    CLAUDE_CONFIG_DIR: join(root, "isolated-claude"), CODEX_HOME: join(root, "isolated-codex"),
  };
  delete env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS; delete env.CONTEXT_MODE_BRIDGE_DEPTH; delete env.CONTEXT_MODE_BRIDGE_IDLE_MS;
  const child = childProcess.spawn(process.execPath, [join(pluginRoot, "server.bundle.mjs")], { cwd: context.workspacePath, env, stdio: "pipe" });
  let stderr = "", buffer = "", id = 0, closing: Promise<void> | undefined;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  child.stdout.on("data", chunk => {
    buffer += String(chunk);
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n"), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let message: any; try { message = JSON.parse(line); } catch { continue; }
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
      }
    }
  });
  child.on("error", error => { for (const request of pending.values()) request.reject(error); pending.clear(); });
  child.on("close", code => { for (const request of pending.values()) request.reject(new Error(`MCP exited ${code}: ${stderr.slice(-1200)}`)); pending.clear(); });
  const close = () => closing ??= (async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, "close"); child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
    try { await ended; } finally { clearTimeout(timer); }
  })();
  servers.push({ close });
  function request(method: string, params: Record<string, unknown>) {
    return new Promise<any>((resolveResult, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`MCP ${method} timed out: ${stderr.slice(-1200)}`)); }, 12_000);
      pending.set(requestId, {
        resolve: value => { clearTimeout(timer); resolveResult(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
    });
  }
  await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "scratch-regression", version: "1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await request("tools/list", {});
  return { pid: child.pid!, close, call: (name: string, args: Record<string, unknown>) => request("tools/call", { name, arguments: args }) };
}

const resultText = (result: any) => result.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");

test.skipIf(process.platform === "win32")("real MCP handshake, execution, batch and reopen use isolated owners and durable workspace state", async () => {
  const a = owner("session-a"), b = owner("session-b");
  const [first, second] = await Promise.all([startServer(a), startServer(b)]);
  expect(fs.existsSync(join(a.directory, `context-mode-mcp-ready-${first.pid}`))).toBe(true);
  expect(fs.existsSync(join(b.directory, `context-mode-mcp-ready-${second.pid}`))).toBe(true);
  for (const [server, context] of [[first, a], [second, b]] as const) {
    const response = await server.call("ctx_execute", { language: "javascript", code: "console.log('managed-ok', process.env.TMPDIR, process.env.TMP, process.env.TEMP)", timeout: 5_000 });
    expect(response.isError, resultText(response)).not.toBe(true);
    expect(resultText(response)).toContain("managed-ok"); expect(resultText(response)).toContain(context.directory);
    expect(fs.readdirSync(context.directory).some(name => name.startsWith("cm-fs-preload-"))).toBe(false);
    const claims = () => fs.readdirSync(join(context.directory, "leases")).map(name =>
      JSON.parse(fs.readFileSync(join(context.directory, "leases", name), "utf8")));
    expect(claims().length).toBeGreaterThan(0);
    for (const claim of claims()) expect(claim).toMatchObject({ schemaVersion: 1,
      ownerId: context.ownerId, workspacePath: context.workspacePath });
    // A response alone does not prove release. Wait for the executor's durable
    // group-absence transition while preserving the existing lifetime tests.
    await vi.waitFor(() => expect(claims().every(claim => claim.state === "released" && claim.consumers.length === 0)).toBe(true));
  }
  const readFile = join(a.workspacePath, "batch input.txt"); fs.writeFileSync(readFile, "batch input");
  const script = `require('node:fs').readFileSync(${JSON.stringify(readFile)}); console.log('managed-batch-ok')`;
  const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  const batch = await first.call("ctx_batch_execute", { commands: [{ label: "managed-read", command: `${shellQuote(process.execPath)} -e ${shellQuote(script)}` }], queries: ["managed-batch-ok"], response_bytes: 8192 });
  expect(batch.isError, resultText(batch)).not.toBe(true); expect(resultText(batch)).toContain("managed-batch-ok");
  expect(resultText(batch)).not.toContain("__CM_FS__");
  const indexed = await first.call("ctx_index", { content: "# Durable nebula\n\nThe durable nebula evidence survives a session scratch cleanup.", source: "scratch-nebula" });
  expect(indexed.isError, resultText(indexed)).not.toBe(true);
  await first.close();
  expect(fs.existsSync(join(a.directory, `context-mode-mcp-ready-${first.pid}`))).toBe(false);
  expect(fs.readdirSync(a.directory).some(name => name.startsWith("cm-fs-preload-"))).toBe(false);
  expect(fs.existsSync(join(b.directory, `context-mode-mcp-ready-${second.pid}`))).toBe(true);
  const reopened = await startServer(a);
  const searched = await reopened.call("ctx_search", { queries: ["durable nebula"], source: "scratch-nebula" });
  expect(searched.isError, resultText(searched)).not.toBe(true); expect(resultText(searched)).toContain("nebula");
  expect(fs.existsSync(join(a.workspacePath, ".gestalt", "context-mode"))).toBe(true);
}, 60_000);
