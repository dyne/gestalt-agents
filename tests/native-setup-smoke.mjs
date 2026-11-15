/** Actual package/runtime/Codex setup; fixtures live in test-native-setup.mjs. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runCommand } from "../plugins/context-mode/scripts/native-command.mjs";
import { ensureManagedRoot } from "../scripts/setup-storage.mjs";
import { verifyPreparedRuntime } from "../plugins/context-mode/scripts/runtime-preflight.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = process.env.GESTALT_NATIVE_TEST_EVIDENCE;
if (!evidence) throw new Error("GESTALT_NATIVE_TEST_EVIDENCE is required for native setup evidence");
mkdirSync(evidence, { recursive: true });
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("actual native runner identity and standard-user Windows token", () => {
  const identity = { platform: process.platform, arch: process.arch, node: process.version, sha: process.env.GITHUB_SHA ?? null, observedAt: new Date().toISOString(), standardUser: null };
  if (process.platform === "win32") {
    const result = spawnSync(join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", "$p=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent());if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 1};Write-Output 'standard-user'"], { encoding: "utf8", shell: false });
    assert.equal(result.status, 0, "Windows setup acceptance requires a standard-user token"); identity.standardUser = true;
    // Product execution and build subprocesses receive no Git Bash/WSL entries.
    assert.doesNotMatch(process.env.PATH, /(?:\\Git\\|\\msys|\\cygwin)/i);
  }
  writeFileSync(join(evidence, "runner.json"), JSON.stringify(identity, null, 2));
});

test("unmodified Node setup installs real runtime/plugins and repeats offline", { timeout: 600_000 }, (t) => {
  const base = realpathSync(mkdtempSync(join(process.env.TMPDIR || tmpdir(), "gestalt-native-setup-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const codexHome = join(base, "Codex ü & native"), gestaltHome = join(base, "Gestalt ü & native");
  ensureManagedRoot(codexHome); ensureManagedRoot(gestaltHome);
  writeFileSync(join(codexHome, "config.toml"), 'approval_policy = "never"\n', { mode: 0o600 });
  const env = { ...process.env, CODEX_HOME: codexHome, GESTALT_HOME: gestaltHome, CONTEXT_MODE_PACKAGE_MANAGER: "npm", npm_config_ignore_scripts: "true" };
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
  assert.equal(verifyPreparedRuntime(join(gestaltHome, "runtime/context-mode")).ok, true);
  const managed = ["config.toml", "hooks.json", "bin/context-mode-mcp.mjs", "bin/context-mode-hook.mjs"];
  const before = managed.map((path) => digest(join(codexHome, path)));
  run("repeat-offline", [], { npm_config_offline: "true" });
  assert.deepEqual(managed.map((path) => digest(join(codexHome, path))), before);
  const installed = JSON.parse(runCommand("codex", ["plugin", "list", "--marketplace", "dyne-gestalt-agents", "--json"], { env, stdio: "pipe" }));
  assert.deepEqual(installed.installed.filter((entry) => entry.installed).map((entry) => entry.name).sort(), ["context-mode", "gestalt"]);
  for (const role of ["reviewer", "executor"]) assert.ok(existsSync(join(codexHome, `agents/org-plan-${role}.toml`)));
  const manifest = JSON.parse(readFileSync(join(gestaltHome, "runtime/context-mode/.context-mode-prepared.json"), "utf8"));
  assert.equal(manifest.platform, process.platform); assert.equal(manifest.arch, process.arch); assert.equal(manifest.nodeModulesAbi, process.versions.modules);
  writeFileSync(join(evidence, "prepared-runtime.json"), JSON.stringify(manifest, null, 2));
});
