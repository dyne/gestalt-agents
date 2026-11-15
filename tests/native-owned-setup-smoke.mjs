/** Real owned commands with host-namespace Agents filesystem orchestration. */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { setupAgents, SETUP_API_VERSION, SETUP_API_CAPABILITIES } from "../gestalt-setup.mjs";
import { SetupCommandContext } from "../plugins/context-mode/scripts/setup-command-context.mjs";
import { verifyPreparedRuntime } from "../plugins/context-mode/scripts/runtime-preflight.mjs";
import { ensureManagedRoot } from "../scripts/setup-storage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = process.env.GESTALT_NATIVE_TEST_EVIDENCE;
if (!evidence) throw new Error("GESTALT_NATIVE_TEST_EVIDENCE is required");
mkdirSync(evidence, { recursive: true });
const fixtureRoot = join(root, ".native-manager-fixture");
const fixture = JSON.parse(readFileSync(join(fixtureRoot, "agents-fixture.json"), "utf8"));
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
assert.equal(fixture.pin, "cb7dbf1bfb2221bd0b3f4366311280e53cd712be");
for (const [name, expected] of Object.entries(fixture.sourceHashes)) assert.equal(digest(join(fixtureRoot, name)), expected, `copied pinned ownership input ${name}`);
const helper = join(fixtureRoot, fixture.helper);
assert.equal(digest(helper), fixture.helperSha256);
writeFileSync(join(evidence, "owned-fixture.json"), JSON.stringify(fixture, null, 2));
const { NativeOwnedProcesses } = await import(pathToFileURL(join(fixtureRoot, "src/cli/platform/processes.ts")).href);
const native = new NativeOwnedProcesses(helper);
const commands = { apiVersion: 1, launch: native.launch.bind(native) };
const emptyInput = async function* () {};
const silent = { stdin: emptyInput(), stdout: async () => {}, stderr: async () => {} };
const scratch = () => realpathSync(mkdtempSync(join(process.env.TMPDIR || tmpdir(), "agents-owned-setup-")));
const ownership = [];
function receipt(record) { ownership.push(record); writeFileSync(join(evidence, "owned-setup-checks.json"), JSON.stringify(ownership, null, 2)); }
function environment(base) {
  const home = join(base, "isolated home"); mkdirSync(home, { mode: 0o700 });
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(base, "Codex ü & owned"), GESTALT_HOME: join(base, "Gestalt ü & owned"), CLAUDE_CONFIG_DIR: join(home, ".claude"), CONTEXT_MODE_DIR: join(home, "context-mode-data"), CONTEXT_MODE_PACKAGE_MANAGER: "npm", npm_config_ignore_scripts: "true", CONTEXT_MODE_PLATFORM: "codex", CONTEXT_MODE_WORKSPACE: base };
  for (const key of Object.keys(env)) if (key.startsWith("GESTALT_MOBILE_ORG_PLAN_")) delete env[key];
  for (const key of ["GESTALT_SESSION_TMP_CONTEXT", "TMPDIR", "TMP", "TEMP"]) assert.equal(env[key], process.env[key], `inherited scratch ${key}`);
  return env;
}

test("actual owned worker sees UID-mapped ancestors while host storage accepts only private roots", { timeout: 30_000 }, async () => {
  const base = scratch(); let retained = false;
  try {
    const privateRoot = join(base, "private host root"); ensureManagedRoot(privateRoot);
    const context = new SetupCommandContext({ mode: "managed", commands, cwd: base, streams: silent });
    const observation = JSON.parse(await context.run(process.execPath, ["-e", "const f=require('node:fs');console.log(JSON.stringify({uid:process.getuid?.()??null,ancestorUid:f.statSync(process.argv[1]).uid,privateUid:f.statSync(process.argv[2]).uid}))", process.platform === "linux" ? "/tmp" : base, privateRoot], { stdin: "ignore", capture: true }));
    const result = context.outcome(); retained = !context.canCleanup();
    receipt({ label: "host-private-root-and-owned-worker", platform: process.platform, observation, result });
    if (process.platform === "linux") { assert.equal(observation.ancestorUid, 65534); assert.equal(observation.privateUid, process.getuid()); }
    if (process.platform !== "darwin") assert.equal(result.ownership.kind, "released");
    else assert.equal(result.ownership.kind, "unknown");
  } finally { if (!retained) rmSync(base, { recursive: true, force: true }); }
});

test("host ancestor rejection precedes any managed launch or installation mutation", async () => {
  const base = scratch();
  try {
    const env = environment(base), unsafe = join(base, "unsafe parent"); ensureManagedRoot(unsafe);
    if (process.platform === "win32") {
      const script = "$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TEST_ACL_PATH));$d=Get-Item -LiteralPath $p;$a=$d.GetAccessControl();$s=New-Object Security.Principal.SecurityIdentifier('S-1-1-0');$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($s,'WriteData,DeleteSubdirectoriesAndFiles','Allow')));$d.SetAccessControl($a)";
      const result = spawnSync(join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { env: { ...process.env, TEST_ACL_PATH: Buffer.from(unsafe).toString("base64") }, encoding: "utf8", shell: false });
      assert.equal(result.status, 0, result.stderr); env.GESTALT_HOME = join(unsafe, "managed");
    } else { chmodSync(unsafe, 0o777); env.GESTALT_HOME = join(unsafe, "managed"); }
    let launches = 0;
    await assert.rejects(setupAgents(["--prepare-only"], { mode: "managed", commands: { apiVersion: 1, launch: async (...args) => { launches++; return native.launch(...args); } }, environment: env, cwd: base, streams: silent }), process.platform === "win32" ? /Windows managed storage refused/ : /untrusted managed directory ancestor/);
    assert.equal(launches, 0); assert.equal(existsSync(join(unsafe, "managed")), false);
    receipt({ label: "unsafe-namespace-refused-before-launch", launches, platform: process.platform });
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("real managed setup builds and installs through owned commands, then repeats offline", { timeout: 600_000 }, async () => {
  const base = scratch(), env = environment(base); let clean = false;
  const beforeEnvironment = JSON.stringify(process.env);
  const calls = [];
  const port = { apiVersion: 1, async launch(executable, invocation, streams, limits) {
    const lease = await native.launch(executable, invocation, streams, limits);
    void lease.completed.then((claim) => { calls.push({ executable, argv: invocation.argv, cwd: invocation.cwd, result: claim.result ?? null, ownership: claim.kind, backend: claim.backend ?? null, reason: claim.reason ?? null }); });
    return lease;
  } };
  try {
    const invoke = async (label, extra = {}) => {
      const log = join(evidence, `${label}.log`), observedAt = new Date().toISOString(); writeFileSync(log, "");
      try {
        const result = await setupAgents([], { mode: "managed", commands: port, environment: { ...env, ...extra }, cwd: base, streams: { stdin: emptyInput(), stdout: async (bytes) => appendFileSync(log, bytes), stderr: async (bytes) => appendFileSync(log, bytes) } });
        receipt({ label, status: 0, observedAt, result, log, sha256: digest(log), calls: [...calls], apiVersion: SETUP_API_VERSION, capabilities: SETUP_API_CAPABILITIES, node: process.version, abi: process.versions.modules });
        return result;
      } catch (error) { receipt({ label, status: error.status || 1, error: error.message, execution: error.execution ?? null, observedAt, log, sha256: digest(log), calls: [...calls] }); throw error; }
    };
    const fresh = await invoke("owned-fresh");
    assert.equal(verifyPreparedRuntime(join(env.GESTALT_HOME, "runtime/context-mode")).ok, true);
    assert.ok(existsSync(join(env.CODEX_HOME, "agents/org-plan-executor.toml")));
    assert.ok(calls.some((call) => call.argv.includes("--check") && call.argv.some((arg) => arg.endsWith("org-plan-parser.mjs"))), "Org validation is owned");
    assert.equal(calls.filter((call) => call.argv.includes("app-server")).length, 2, "both catalog/RPC sessions are owned");
    assert.ok(calls.some((call) => call.argv.some((arg) => arg.endsWith("build-runtime.mjs"))), "esbuild runs inside an owned worker");
    assert.equal(JSON.stringify(process.env), beforeEnvironment);
    if (process.platform === "darwin") {
      assert.equal(fresh.ownership.kind, "unknown");
      assert.ok(existsSync(join(env.GESTALT_HOME, ".gestalt-setup.lock")));
      assert.ok(readdirSync(env.GESTALT_HOME).some((name) => name.startsWith(".gestalt-setup-state-")));
      await assert.rejects(setupAgents(["--prepare-only"], { mode: "managed", commands: port, environment: env, cwd: base, streams: silent }), /setup is already running/);
      receipt({ label: "macos-success-separate-from-unknown-retention", base, repeatRefused: true, cleanupAuthorized: false });
    } else {
      assert.equal(fresh.ownership.kind, "released");
      const repeated = await invoke("owned-repeat-offline", { npm_config_offline: "true" });
      assert.equal(repeated.ownership.kind, "released"); clean = true;
      assert.equal(existsSync(join(env.GESTALT_HOME, ".gestalt-setup.lock")), false);
      assert.equal(existsSync(join(env.CODEX_HOME, ".gestalt-setup.lock")), false);
    }
  } finally { if (clean) rmSync(base, { recursive: true, force: true }); }
});

test("real setup cancellation fences detached writes before compensation or lock release", { timeout: 40_000 }, async () => {
  const base = scratch(), env = environment(base), controller = new AbortController(); let clean = false;
  ensureManagedRoot(env.GESTALT_HOME);
  const oldRuntime = join(env.GESTALT_HOME, "runtime/context-mode"); mkdirSync(oldRuntime, { recursive: true });
  const sentinel = join(oldRuntime, "previous-runtime-sentinel"); writeFileSync(sentinel, "keep until absence proof");
  const late = join(base, "late-descendant-write");
  const child = "const f=require('node:fs');setTimeout(()=>f.writeFileSync(process.argv[1],'late'),2500);";
  const program = "const{spawn}=require('node:child_process');spawn(process.execPath,['-e',process.argv[1],process.argv[2]],{detached:true,stdio:'ignore'}).unref();console.log('writer-started');setInterval(()=>{},1000);";
  const selected = [];
  const cancellingPort = { apiVersion: 1, async launch(executable, invocation, streams, limits) {
    selected.push({ executable, argv: invocation.argv, cwd: invocation.cwd });
    // Substitute only the expensive external build capability. Real setup,
    // storage, snapshot, lock, runtime owners and cancellation stay unmodified.
    return native.launch(process.execPath, { ...invocation, argv: ["-e", program, child, late] }, streams, limits);
  } };
  try {
    let failure;
    try {
      await setupAgents(["--prepare-only"], { mode: "managed", commands: cancellingPort, environment: env, cwd: base, signal: controller.signal,
        streams: { stdin: emptyInput(), stderr: async () => {}, stdout: async (bytes) => { if (bytes.toString().includes("writer-started")) controller.abort({ status: 130 }); } } });
    } catch (error) { failure = error; }
    assert.equal(failure?.status, 130, failure?.message); assert.equal(selected.length, 1);
    assert.equal(readFileSync(sentinel, "utf8"), "keep until absence proof");
    await new Promise((resolve) => setTimeout(resolve, 3200));
    const lateWrite = existsSync(late), outcome = failure.execution;
    const lockRetained = existsSync(join(env.GESTALT_HOME, ".gestalt-setup.lock"));
    receipt({ label: "owned-setup-cancellation-descendant-write-fence", status: 130, lateWrite, lockRetained, outcome, selected, base });
    if (process.platform !== "darwin") {
      assert.equal(lateWrite, false); assert.equal(lockRetained, false); assert.equal(outcome.ownership.kind, "released");
      assert.equal(readdirSync(env.GESTALT_HOME).some((name) => name.startsWith(".gestalt-setup-state-")), false); clean = true;
    } else {
      assert.equal(outcome.ownership.kind, "unknown"); assert.equal(lockRetained, true);
      assert.ok(readdirSync(join(env.GESTALT_HOME, ".gestalt-setup.lock")).some((name) => name.startsWith("command-")));
      assert.ok(readdirSync(env.GESTALT_HOME).some((name) => name.startsWith(".gestalt-setup-state-")));
    }
  } finally { if (clean) rmSync(base, { recursive: true, force: true }); }
});
