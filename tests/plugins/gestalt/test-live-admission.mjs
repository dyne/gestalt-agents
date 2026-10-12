import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { digest, managerEnvironment, measureTree, prepareAdmission, stable, stageAdmission, verifyAdmission } from "../../../plugins/gestalt/live-admission.mjs";

import { fixture } from "./live-fixture.mjs";

test("trusted tools occur exactly once in isolated configuration; receipt verifies; input is preserved", (t) => {
  const f = fixture(t), before = readFileSync(f.bootstrapPath, "utf8");
  const result = verifyAdmission(f.bootstrapPath);
  assert.equal(result.available, true); assert.equal(result.liveReady, false);
  const config = JSON.parse(readFileSync(join(f.privateRoot, "live-mcp-config.json")));
  assert.deepEqual(Object.keys(config.mcpServers), ["context-mode", "gestalt-org-plan"]);
  assert.deepEqual(config.plugins, []); assert.deepEqual(config.hooks, []);
  assert.ok(config.unavailableWorkflows.includes("remote-mcp"));
  assert.equal(readFileSync(f.bootstrapPath, "utf8"), before);
  assert.deepEqual(f.manifest.sandboxState.permissionProfile.file_system.entries.map((e) => e.access), ["read", "write"]);
});
for (const [name, change, reason] of [
  ["command substitution", (f) => { f.input.effectiveConfig.mcpServers[0].command = "/bin/sh"; }, "unadmitted-launch-surface"],
  ["argument substitution", (f) => { f.input.effectiveConfig.mcpServers[0].args.push("--eval=evil"); }, "unadmitted-launch-surface"],
  ["duplicate alias", (f) => { f.input.effectiveConfig.mcpServers.push(f.input.effectiveConfig.mcpServers[0]); }, "unadmitted-launch-surface"],
  ["duplicate plugin", (f) => { f.input.packages[1] = f.input.packages[0]; }, "unknown-plugin"],
  ["remote MCP", (f) => { f.input.effectiveConfig.remoteMcp.push({ url: "http://localhost/secret" }); }, "unadmitted-launch-surface"],
  ["unexpected hook", (f) => { f.input.effectiveConfig.hooks.push({ command: "echo unsafe" }); }, "unadmitted-launch-surface"],
  ["ambient executable", (f) => { f.input.effectiveConfig.executables.push("project-launcher"); }, "unadmitted-launch-surface"],
  ["package checksum", (f) => { f.input.packages[0].sha256 = "0".repeat(64); }, "package-changed"],
  ["runtime checksum", (f) => { f.input.runtime.sha256 = "0".repeat(64); }, "runtime-changed"],
  ["interpreter checksum", (f) => { f.input.node.sha256 = "0".repeat(64); }, "interpreter-changed"],
  ["unknown bootstrap field", (f) => { f.input.command = "sh"; }, "invalid-admission-input"],
  ["arbitrary host plan", (f) => { f.input.plans = [f.bootstrapPath]; }, "invalid-lifecycle-scope"],
]) test(`reject ${name} with a bounded error`, (t) => {
  const f = fixture(t); change(f); f.saveInput();
  assert.deepEqual(verifyAdmission(f.bootstrapPath), { schemaVersion: 1, available: false, liveReady: false, reason });
});
test("project config in app or an ancestor is explicitly unavailable", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, ".codex"));
  writeFileSync(join(f.root, ".codex/config.toml"), '[mcp_servers.evil]\ncommand="sh"\n');
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "project-config-unavailable");
});
test("package changes and symlink injection fail closed", (t) => {
  const f = fixture(t), file = join(f.input.packages[0].root, "extra.mjs");
  writeFileSync(file, "evil", { mode: 0o600 });
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "package-changed");
  rmSync(file); symlinkSync(f.bootstrapPath, file);
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "package-symlink");
});
test("changed package manifest remains rejected even with a new measured package hash", (t) => {
  const f = fixture(t), pkg = f.input.packages[0];
  f.save(join(pkg.root, ".mcp.json"), { mcpServers: { evil: { command: "sh" } } });
  pkg.sha256 = measureTree(pkg.root); f.saveInput();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "package-launch-changed");
});
test("native command and permission changes cannot reuse admission", (t) => {
  const f = fixture(t);
  f.manifest.commands["context-mode-call"].args.push("--evil"); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "unadmitted-native-command");
});
test("narrowing, components and trusted bootstrap changes invalidate signed admission", (t) => {
  const f = fixture(t);
  f.manifest.sandboxState.permissionProfile.file_system.entries.push({ path: { type: "path", path: "/proc" }, access: "deny" }); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "stale-admission-receipt");
  prepareAdmission(f.bootstrapPath);
  f.manifest.components.agents = "next-tree"; f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "stale-admission-receipt");
  prepareAdmission(f.bootstrapPath);
  f.input.plans = []; f.saveInput(); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "stale-admission-receipt");
});
test("prepared config replacement and MAC forgery are refused", (t) => {
  const f = fixture(t), config = join(f.privateRoot, "live-mcp-config.json");
  f.save(config, { mcpServers: { evil: {} } });
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "configuration-changed");
});
test("forged/missing receipts and a stale native manager refuse admission", (t) => {
  const f = fixture(t), path = join(f.privateRoot, "admission-receipt.json");
  const receipt = JSON.parse(readFileSync(path)); receipt.mac = "0".repeat(64); f.save(path, receipt);
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "invalid-receipt");
  rmSync(path);
  assert.equal(verifyAdmission(f.bootstrapPath).available, false);
  writeFileSync(f.manager, "#!/bin/sh\nexit 1\n"); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "native-policy-unavailable");
});
test("original writable policy/package/interpreter authority is never broadened", (t) => {
  const f = fixture(t);
  f.manifest.sandboxState.permissionProfile.file_system.entries.push({ path: { type: "path", path: f.root }, access: "write" }); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "project-writable-admission");
});
test("insecure bootstrap permissions are rejected", (t) => {
  const f = fixture(t); chmodSync(f.bootstrapPath, 0o644);
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "untrusted-mode");
});
test("staging refuses an active native worker instead of replacing its configuration", (t) => {
  const f = fixture(t), config = join(f.privateRoot, "live-mcp-config.json"), before = readFileSync(config, "utf8");
  f.save(join(f.privateRoot, "dispatch.lock"), { fixture: true });
  assert.throws(() => stageAdmission(f.bootstrapPath), { reason: "native-worker-active" });
  assert.equal(readFileSync(config, "utf8"), before);
});
test("bootstrap and prepared configuration must both belong to the signed native inventory", (t) => {
  const f = fixture(t);
  f.input.plans = []; f.saveInput();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "configuration-changed");
  f.savePolicy(); prepareAdmission(f.bootstrapPath);
  f.manifest.configFiles = f.manifest.configFiles.filter((file) => !file.path.endsWith("live-mcp-config.json")); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "unbound-prepared-config");
});
test("a replaced policy key or receipt cannot authenticate host lifecycle scope", (t) => {
  const f = fixture(t), receiptPath = join(f.privateRoot, "policy-receipt.json");
  const receipt = JSON.parse(readFileSync(receiptPath)); receipt.body.kind = "process-launch"; f.save(receiptPath, receipt);
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "invalid-receipt");
});
test("host manager uses verified Node outside /usr/bin, independent of ambient PATH", (t) => {
  const f = fixture(t);
  copyFileSync(process.execPath, f.input.node.path); chmodSync(f.input.node.path, 0o700);
  f.input.node.sha256 = digest(readFileSync(f.input.node.path));
  f.manifest.commands["context-mode-call"].sha256 = f.input.node.sha256;
  const json = JSON.stringify({ schemaVersion: 1, available: true, policyDigest: "policy", configDigest: "config" });
  writeFileSync(f.manager, `#!/bin/sh\nexec node -e 'process.stdout.write(${JSON.stringify(json)})'\n`, { mode: 0o700 });
  f.saveInput(); f.savePolicy(); prepareAdmission(f.bootstrapPath);
  const oldPath = process.env.PATH;
  process.env.PATH = "/project-untrusted-bin";
  try {
    assert.equal(verifyAdmission(f.bootstrapPath).available, true);
    assert.equal(managerEnvironment(f.input.node, f.manifest.runtimeHome).PATH, `${join(f.root, "node-bin")}:/usr/bin:/bin`);
    assert.equal(f.manifest.environment, undefined); // offline shape; no native env mutation
  } finally { process.env.PATH = oldPath; }
});
test("a separate pinned interpreter directory cannot supply host executable aliases", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, "node-bin/mkdir"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "untrusted-interpreter-directory");
});
