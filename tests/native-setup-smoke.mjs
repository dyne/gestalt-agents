/** Actual package/runtime/Codex setup; fixtures live in test-native-setup.mjs. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { runCommand } from "../plugins/context-mode/scripts/native-command.mjs";
import { verifyPreparedRuntime } from "../plugins/context-mode/scripts/runtime-preflight.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = process.env.GESTALT_NATIVE_TEST_EVIDENCE;
if (!evidence) throw new Error("GESTALT_NATIVE_TEST_EVIDENCE is required for native setup evidence");
mkdirSync(evidence, { recursive: true });
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function mcpProbe(launcher, env, cwd, calls, label) {
  const child = spawn(process.execPath, [launcher], { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
  let raw = "", stderr = "";
  child.stdout.on("data", (chunk) => { raw += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  const readers = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try { const message = JSON.parse(line); readers.get(message.id)?.(message); } catch {}
  });
  const completion = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (status, signal) => resolve({ status, signal })); });
  let id = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => { readers.delete(next); reject(new Error(`${label} MCP response timeout: ${method}: ${stderr.slice(-1000)}`)); }, 25_000);
    readers.set(next, (message) => { clearTimeout(timer); readers.delete(next); resolve(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: next, method, params }) + "\n");
  });
  try {
    const initialized = await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "native-installed-smoke", version: "1" } });
    assert.ok(initialized.result?.serverInfo, JSON.stringify(initialized));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = await request("tools/list", {});
    const responses = [];
    for (const params of calls) responses.push(await request("tools/call", params));
    child.stdin.end();
    const exit = await Promise.race([completion, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} MCP EOF timeout`)), 10_000).unref())]);
    assert.equal(exit.status, 0, stderr);
    return { label, ...exit, tools: listed.result.tools.map((tool) => tool.name), responses };
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await completion; }
    lines.close();
    writeFileSync(join(evidence, `${label}-mcp.log`), raw + stderr);
  }
}

test("actual native runner identity and standard-user Windows token", () => {
  const checkoutPath = join(evidence, "checkout.json");
  const checkout = existsSync(checkoutPath) ? JSON.parse(readFileSync(checkoutPath, "utf8")) : null;
  const identity = { platform: process.platform, arch: process.arch, node: process.version, sha: checkout?.checkoutSha ?? process.env.GITHUB_SHA ?? null, checkoutTree: checkout?.checkoutTree ?? null, observedAt: new Date().toISOString(), standardUser: null, sourceHashes: {} };
  for (const path of ["gestalt-setup.mjs", "gestalt-setup.sh", "scripts/setup-agents.mjs", "scripts/verify-gestalt-skill-catalog.mjs", "plugins/gestalt/scripts/verify-skill-catalog.mjs", "plugins/context-mode/scripts/setup-command-context.mjs", "scripts/prepare-owned-setup-fixture.mjs", "scripts/owned-helper-diagnostics.mjs", "tests/native-owned-setup-smoke.mjs", "tests/repository/test-setup-api.mjs", "tests/repository/test-setup-command-port.mjs", "tests/repository/test-setup-rpc.mjs", "scripts/setup-storage.mjs", "scripts/prepare-agent-profiles.mjs", "scripts/install-org-plan.mjs", "scripts/install-managed-commands.mjs", "scripts/native-command-shims.mjs", "scripts/test-setup-standard-user.ps1", "plugins/context-mode/package.json", "plugins/context-mode/package-lock.json", "plugins/context-mode/scripts/native-command.mjs", "plugins/context-mode/scripts/prepare-runtime.mjs", "plugins/context-mode/scripts/build-runtime.mjs", "plugins/context-mode/scripts/assert-bundle.mjs", "plugins/context-mode/scripts/install-runtime.mjs", "plugins/context-mode/scripts/runtime-preflight.mjs", "plugins/context-mode/scripts/runtime-lock.mjs", "plugins/context-mode/scripts/session-scratch.mjs", "plugins/context-mode/scripts/configure-codex.mjs", "plugins/gestalt/scripts/codex-rpc.mjs", "plugins/gestalt/scripts/native-command.mjs", "plugins/gestalt/skills/org-plan/scripts/org-plan-cli.mjs", "plugins/gestalt/skills/org-plan/scripts/org-plan-files.mjs", "plugins/gestalt/skills/org-plan/scripts/org-plan-parser.mjs", "tests/plugins/gestalt/fixtures/valid-minimal.org", "plugins/gestalt/skills/org-plan/scripts/org-plan-profiles.mjs", "plugins/gestalt/skills/org-plan/scripts/org-plan-profile-defaults.mjs", "plugins/gestalt/skills/org-plan/scripts/org-plan-storage.mjs", "plugins/gestalt/skills/org-plan/scripts/org-plan-publication.mjs", "plugins/gestalt/skills/org-plan/scripts/org-plan-transitions.mjs", "tests/native-setup-smoke.mjs", "tests/repository/test-native-setup.mjs", "tests/repository/test-native-helpers.mjs"]) identity.sourceHashes[path] = digest(join(root, path));
  if (process.platform === "win32") {
    assert.match(identity.sha ?? "", /^[0-9a-f]{40}$/, "copied checkout SHA must be supplied to the credential child");
    assert.match(identity.checkoutTree ?? "", /^[0-9a-f]{40}$/);
    const result = spawnSync(join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", "$p=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent());if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 1};Write-Output 'standard-user'"], { encoding: "utf8", shell: false });
    assert.equal(result.status, 0, "Windows setup acceptance requires a standard-user token"); identity.standardUser = true;
    // Product execution and build subprocesses receive no Git Bash/WSL entries.
    assert.doesNotMatch(process.env.PATH, /(?:\\Git\\|\\msys|\\cygwin)/i);
  }
  writeFileSync(join(evidence, "runner.json"), JSON.stringify(identity, null, 2));
});

test("unmodified Node setup installs real runtime/plugins and repeats offline", { timeout: 600_000 }, async (t) => {
  const base = realpathSync(mkdtempSync(join(process.env.TMPDIR || tmpdir(), "gestalt-native-setup-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const codexHome = join(base, "Codex ü & native"), gestaltHome = join(base, "Gestalt ü & native");
  const home = join(base, "isolated home"); mkdirSync(home, { mode: 0o700 });
  const workspace = join(base, "workspace"); mkdirSync(workspace, { mode: 0o700 });
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), CONTEXT_MODE_DIR: join(home, "context-mode-data"), CODEX_HOME: codexHome, GESTALT_HOME: gestaltHome, CONTEXT_MODE_PACKAGE_MANAGER: "npm", npm_config_ignore_scripts: "true", CONTEXT_MODE_PLATFORM: "codex", CONTEXT_MODE_WORKSPACE: workspace };
  for (const key of Object.keys(env)) if (key.startsWith("GESTALT_MOBILE_ORG_PLAN_")) delete env[key];
  const checks = [];
  const run = (label, args, extra = {}) => {
    const observedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, [join(root, "gestalt-setup.mjs"), ...args], { env: { ...env, ...extra }, encoding: "utf8", timeout: 540_000, maxBuffer: 8 * 1024 * 1024 });
    const log = join(evidence, `${label}.log`);
    writeFileSync(log, (result.stdout ?? "") + (result.stderr ?? ""));
    checks.push({ command: [process.execPath, "gestalt-setup.mjs", ...args], status: result.status, signal: result.signal, error: result.error?.message ?? null, observedAt, log, sha256: digest(log) });
    writeFileSync(join(evidence, "setup-checks.json"), JSON.stringify(checks, null, 2));
    assert.equal(result.status, 0, `${label} failed; see ${log}: ${(result.stderr ?? "").slice(-2500)}`);
  };
  run("fresh", []);
  for (const home of [gestaltHome, codexHome]) {
    assert.equal(existsSync(join(home, ".gestalt-setup.lock")), false, "ordinary standalone diagnostics must permit transaction cleanup");
  }
  assert.equal(verifyPreparedRuntime(join(gestaltHome, "runtime/context-mode")).ok, true);
  const managed = ["config.toml", "hooks.json", "bin/context-mode-mcp.mjs", "bin/context-mode-hook.mjs"];
  const before = managed.map((path) => digest(join(codexHome, path)));
  run("repeat-offline", [], { npm_config_offline: "true" });
  for (const home of [gestaltHome, codexHome]) assert.equal(existsSync(join(home, ".gestalt-setup.lock")), false);
  assert.deepEqual(managed.map((path) => digest(join(codexHome, path))), before);
  const installed = JSON.parse(runCommand("codex", ["plugin", "list", "--marketplace", "dyne-gestalt-agents", "--json"], { env, stdio: "pipe" }));
  assert.deepEqual(installed.installed.filter((entry) => entry.installed).map((entry) => entry.name).sort(), ["context-mode", "gestalt"]);
  for (const role of ["reviewer", "executor"]) assert.ok(existsSync(join(codexHome, `agents/org-plan-${role}.toml`)));
  const manifest = JSON.parse(readFileSync(join(gestaltHome, "runtime/context-mode/.context-mode-prepared.json"), "utf8"));
  assert.equal(manifest.platform, process.platform); assert.equal(manifest.arch, process.arch); assert.equal(manifest.nodeModulesAbi, process.versions.modules);
  writeFileSync(join(evidence, "prepared-runtime.json"), JSON.stringify(manifest, null, 2));
  // Exercise the exact installed MCP launchers with real stdin and both owners.
  const plan = join(workspace, "native MCP ü & plan.org");
  copyFileSync(join(root, "tests/plugins/gestalt/fixtures/valid-minimal.org"), plan);
  const integrations = [];
  for (const [label, launcher] of [["context-mode", join(codexHome, "bin/context-mode-mcp.mjs")], ["org-plan", join(codexHome, "plugins/cache/dyne-gestalt-agents/gestalt", manifest.packageVersion, "org-plan-mcp.mjs")]]) {
    const calls = label === "context-mode"
      ? [{ name: "ctx_execute", arguments: { language: "javascript", code: "console.log('native MCP execution ü')", timeout: 5000 } }]
      : [{ name: "org_plan_l1_transition", arguments: { plan, id: "first-outcome", state: "WIP" } }, { name: "org_plan_review_transition", arguments: { plan, id: "first-outcome", state: "REVIEWED" } }];
    const result = await mcpProbe(launcher, env, workspace, calls, label);
    assert.ok(result.tools.includes(label === "context-mode" ? "ctx_execute" : "org_plan_l2_transition"), `${label} native tools missing`);
    assert.ok(result.responses[0].result && !result.responses[0].result.isError, JSON.stringify(result.responses[0]));
    if (label === "context-mode") assert.match(JSON.stringify(result.responses[0]), /native MCP execution ü/);
    else {
      assert.equal(result.responses[1].result.isError, true);
      assert.match(readFileSync(plan, "utf8"), /\* WIP \[#A\] First outcome/);
      assert.match(readFileSync(plan, "utf8"), /:REVIEW_STATUS: UNREVIEWED/);
    }
    integrations.push(result);
  }
  const hooks = JSON.parse(readFileSync(join(codexHome, "hooks.json"), "utf8"));
  const command = hooks.hooks.SessionStart.flatMap((entry) => entry.hooks).find((hook) => hook.command.includes("context-mode hook codex sessionstart")).command;
  const payload = JSON.stringify({ source: "startup", session_id: "native-installed-smoke", cwd: workspace }) + "\n";
  const hook = process.platform === "win32"
    ? spawnSync(process.env.ComSpec, ["/d", "/s", "/c", command], { env, cwd: workspace, input: payload, encoding: "utf8", timeout: 30_000, windowsVerbatimArguments: true })
    : spawnSync("/bin/sh", ["-c", command], { env, cwd: workspace, input: payload, encoding: "utf8", timeout: 30_000 });
  writeFileSync(join(evidence, "installed-sessionstart-hook.log"), (hook.stdout ?? "") + (hook.stderr ?? ""));
  assert.equal(hook.status, 0, hook.stderr);
  assert.equal(JSON.parse(hook.stdout).hookSpecificOutput.hookEventName, "SessionStart");
  integrations.push({ label: "configured-sessionstart-hook", shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh", status: hook.status });
  if (process.platform === "win32") {
    const script = "$ErrorActionPreference='Stop'; Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:HELPER_TEST_HOOK))); exit $LASTEXITCODE";
    const ps = spawnSync(join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { env: { ...env, HELPER_TEST_HOOK: Buffer.from(command).toString("base64") }, cwd: workspace, input: payload, encoding: "utf8", timeout: 30_000 });
    writeFileSync(join(evidence, "installed-sessionstart-powershell.log"), (ps.stdout ?? "") + (ps.stderr ?? ""));
    assert.equal(ps.status, 0, ps.stderr);
    assert.equal(JSON.parse(ps.stdout).hookSpecificOutput.hookEventName, "SessionStart");
    integrations.push({ label: "configured-sessionstart-hook", shell: "Windows PowerShell 5.1", status: ps.status });
  }
  writeFileSync(join(evidence, "installed-integrations.json"), JSON.stringify(integrations, null, 2));
});
