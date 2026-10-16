import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  assert.deepEqual(config.mcpServers["gestalt-org-plan"].env, {});
  assert.equal(Object.hasOwn(config.mcpServers["gestalt-org-plan"], "env_vars"), false);
  assert.deepEqual(f.input.effectiveConfig.mcpServers.find((entry) => entry.name === "gestalt-org-plan").env_vars, [
    "GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY", "GESTALT_MOBILE_ORG_PLAN_STATUS_FILE", "GESTALT_MOBILE_ORG_PLAN_CAPABILITIES",
  ]);
  assert.deepEqual(config.plugins, []); assert.deepEqual(config.hooks, []);
  assert.ok(config.unavailableWorkflows.includes("remote-mcp"));
  assert.equal(readFileSync(f.bootstrapPath, "utf8"), before);
  assert.deepEqual(f.manifest.sandboxState.permissionProfile.file_system.entries.map((e) => e.access), ["read", "write"]);
});
for (const [name, change, reason] of [
  ["command substitution", (f) => { f.input.effectiveConfig.mcpServers[0].command = "/bin/sh"; }, "unadmitted-launch-surface"],
  ["extra Org inherited environment", (f) => { f.input.effectiveConfig.mcpServers.find((entry) => entry.name === "gestalt-org-plan").env_vars.push("UNTRUSTED_COMMAND"); }, "unadmitted-launch-surface"],
  ["Org fixed capability injection", (f) => { f.input.effectiveConfig.mcpServers.find((entry) => entry.name === "gestalt-org-plan").env = { GESTALT_MOBILE_ORG_PLAN_CAPABILITIES: "suspension-v1" }; }, "unadmitted-launch-surface"],
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
]) for (const schemaVersion of [1, 2]) test(`v${schemaVersion} reject ${name} with a bounded error`, (t) => {
  const f = fixture(t, { schemaVersion }); change(f); f.saveInput();
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

for (const network of ["restricted", "enabled"]) test(`v2 consumes verified runtime provenance and preserves original ${network} network`, (t) => {
  const f = fixture(t, { schemaVersion: 2, network });
  // Metadata presence is never locally admitted on emptiness: only the current
  // Manager receipt/report can establish its birth and source provenance.
  const path = join(f.app, ".codex"); mkdirSync(path, { mode: 0o700 });
  const info = lstatSync(path);
  const identity = { dev: info.dev, ino: info.ino, uid: info.uid, mode: info.mode, ctime: info.ctimeMs, mtime: info.mtimeMs, birthtime: info.birthtimeMs };
  f.provenance.directories[path] = identity;
  f.provenance.inventory.sources = f.provenance.inventory.sources.map((source) => source.path === path ? { kind: "directory", role: "project", path, identity } : source);
  const before = stable(f.manifest.sandboxState);
  f.savePolicy(); prepareAdmission(f.bootstrapPath);
  assert.equal(verifyAdmission(f.bootstrapPath).available, true);
  assert.equal(stable(f.manifest.sandboxState), before);
  const { body } = JSON.parse(readFileSync(join(f.privateRoot, "admission-receipt.json")));
  assert.equal(body.schemaVersion, 2);
  assert.deepEqual(body.nativeContract.generation, f.manifest.generation);
  assert.equal(body.nativeContract.sourceInventoryDigest, digest(stable(f.provenance.inventory)));
  assert.equal(body.nativeContract.runtimeProvenanceDigest, f.provenance.receiptDigest);
});

for (const [name, change, reason] of [
  ["missing runtime provenance", (f) => { delete f.manifest.runtimeProvenance; }, "invalid-runtime-provenance"],
  ["changed observed configuration", (f) => { f.manifest.runtimeProvenance.effectiveConfigDigest = "d".repeat(64); }, "invalid-runtime-provenance"],
  ["changed session flags", (f) => { f.manifest.runtimeProvenance.sessionFlagsDigest = "d".repeat(64); }, "invalid-runtime-provenance"],
  ["unknown source kind", (f) => { f.provenance.inventory.sources[0].kind = "snapshot"; }, "invalid-source-inventory"],
  ["omitted ancestor", (f) => { f.provenance.inventory.sources = f.provenance.inventory.sources.filter((source) => source.path !== join(f.app, ".codex")); }, "invalid-source-inventory"],
  ["omitted system config", (f) => { f.provenance.inventory.sources = f.provenance.inventory.sources.filter((source) => source.path !== "/etc/codex/config.toml"); }, "invalid-source-inventory"],
  ["duplicate source", (f) => { f.provenance.inventory.sources.push(f.provenance.inventory.sources[0]); }, "invalid-source-inventory"],
  ["unbound source file", (f) => { f.provenance.inventory.sources[0].sha256 = "d".repeat(64); }, "invalid-source-inventory"],
  ["unsigned empty metadata", (f) => { f.provenance.inventory.sources[1] = { kind: "directory", role: "project", path: join(f.app, ".codex"), identity: {} }; }, "invalid-source-inventory"],
]) test(`v2 refuses ${name}`, (t) => {
  const f = fixture(t, { schemaVersion: 2 }); change(f); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, reason);
});

test("v2 instructions and unselected candidates are bound without treating them as private config files", (t) => {
  const f = fixture(t, { schemaVersion: 2 });
  for (const [kind, name] of [["instruction", "AGENTS.md"], ["instruction-candidate", "AGENTS.override.md"]]) {
    const path = join(f.app, name); writeFileSync(path, "# fixture instruction\n", { mode: 0o600 });
    const info = lstatSync(path);
    f.provenance.inventory.sources.push({ kind, path, sha256: digest(readFileSync(path)), identity: { dev: info.dev, ino: info.ino, uid: info.uid, mode: info.mode, ctime: info.ctimeMs, mtime: info.mtimeMs } });
  }
  f.savePolicy(); prepareAdmission(f.bootstrapPath);
  assert.equal(verifyAdmission(f.bootstrapPath).available, true);
  f.provenance.inventory.sources.pop(); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "stale-admission-receipt");
});

// Re-sign only the fixture's manager identity to isolate the per-call verifier
// report check from the separate installed-manager-byte check.
function managerReport(f, report) {
  f.saveManager(report);
  const path = join(f.privateRoot, "policy-receipt.json"), record = JSON.parse(readFileSync(path));
  record.body.manager.sha256 = digest(readFileSync(f.manager));
  record.mac = createHmac("sha256", readFileSync(f.manifest.keyFile)).update(stable(record.body)).digest("hex");
  f.save(path, record);
}
for (const [name, change] of [
  ["v1 response", (report) => { report.schemaVersion = 1; }],
  ["missing contract version", (report) => { delete report.contractVersion; }],
  ["stale source inventory", (report) => { report.sourceInventoryDigest = "d".repeat(64); }],
  ["stale provenance", (report) => { report.runtimeProvenanceDigest = "d".repeat(64); }],
  ["other generation", (report) => { report.generation = { ...report.generation, generation: 2 }; }],
  ["revoked or changed instruction candidate", (report) => { report.available = false; report.reason = "source-changed"; }],
]) test(`v2 per-call Manager verification rejects ${name}`, (t) => {
  const f = fixture(t, { schemaVersion: 2 });
  const report = { schemaVersion: 2, contractVersion: 2, available: true, policyDigest: "policy", configDigest: "config", sourceInventoryDigest: digest(stable(f.provenance.inventory)), runtimeProvenanceDigest: f.provenance.receiptDigest, generation: f.manifest.generation };
  change(report); managerReport(f, report);
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "native-policy-unavailable");
});

test("v1 does not inherit v2 metadata or enabled-network admission", (t) => {
  const f = fixture(t); f.manifest.sandboxState.permissionProfile.network = "enabled"; f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "incompatible-native-policy");
});

test("v2 generation/config receipt changes require fresh admission", (t) => {
  const f = fixture(t, { schemaVersion: 2 });
  f.manifest.generation.generation = 2; f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "stale-admission-receipt");
  prepareAdmission(f.bootstrapPath);
  assert.equal(verifyAdmission(f.bootstrapPath).available, true);
  f.provenance.receiptDigest = "d".repeat(64); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "stale-admission-receipt");
});

function observedFixture(t) {
  const f = fixture(t, { schemaVersion: 2 });
  f.manifest.profileId = "observed-profile";
  f.provenance.inventory.observation = {
    sessionFlags: { model: "fixture-model", modelProvider: "controlled", cwd: f.app, approvalPolicy: "never",
      activePermissionProfile: { id: f.manifest.profileId, extends: ":read-only" },
      sandbox: { type: "readOnly", networkAccess: false }, reasoningEffort: "medium",
      runtimeWorkspaceRoots: [f.app], instructionSources: [] },
    // Contract fixture only. Actual account RPC production/renewal proof is a
    // separate supported-host gate; the consumer never invents this value.
    accountDigest: digest(stable({ providerId: "controlled", accountId: null })),
  };
  refreshObservation(f);
  return f;
}
function refreshObservation(f) {
  const flags = f.provenance.inventory.observation?.sessionFlags;
  if (flags !== undefined) f.manifest.runtimeProvenance.sessionFlagsDigest = f.provenance.inventory.sessionFlagsDigest = digest(stable(flags));
  f.savePolicy();
}
for (const variant of ["complete", "absent optional flags", "null thinking/profile parent", "granular approval", "workspace projection", "external projection", "full-access legacy projection", "renewed capture"]) test(`v2 consumes typed observation: ${variant}`, (t) => {
  const f = observedFixture(t), flags = f.provenance.inventory.observation.sessionFlags;
  if (variant === "absent optional flags") { delete flags.runtimeWorkspaceRoots; delete flags.instructionSources; }
  if (variant === "null thinking/profile parent") { flags.reasoningEffort = null; flags.activePermissionProfile.extends = null; }
  if (variant === "granular approval") flags.approvalPolicy = { granular: { sandbox_approval: false, rules: false, skill_approval: false, request_permissions: false, mcp_elicitations: false } };
  if (variant === "workspace projection") flags.sandbox = { type: "workspaceWrite", writableRoots: [f.app], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true };
  if (variant === "external projection") flags.sandbox = { type: "externalSandbox", networkAccess: "restricted" };
  if (variant === "full-access legacy projection") flags.sandbox = { type: "dangerFullAccess" };
  if (variant === "renewed capture") f.provenance.renewalDigest = "e".repeat(64);
  refreshObservation(f);
  const before = stable(f.manifest.sandboxState);
  prepareAdmission(f.bootstrapPath);
  assert.equal(verifyAdmission(f.bootstrapPath).available, true);
  const receipt = JSON.parse(readFileSync(join(f.privateRoot, "admission-receipt.json"))).body;
  assert.equal(receipt.nativeContract.sourceInventoryDigest, digest(stable(f.provenance.inventory)));
  assert.equal(receipt.nativeContract.sessionFlagsDigest, digest(stable(flags)));
  assert.equal(stable(f.manifest.sandboxState), before);
  assert.deepEqual(JSON.parse(readFileSync(join(f.privateRoot, "live-mcp-config.json"))).mcpServers["context-mode"].env, {});
});
for (const [name, mutate] of [
  ["null observation", (f) => { f.provenance.inventory.observation = null; }],
  ["unknown inventory field", (f) => { f.provenance.inventory.renewable = true; }],
  ["unknown observation field", (f, o) => { o.renewable = true; }],
  ["raw account assertion", (f, o) => { o.account = null; }],
  ["missing account digest", (f, o) => { delete o.accountDigest; }],
  ["uppercase account digest", (f, o) => { o.accountDigest = "A".repeat(64); }],
  ["coercible account array", (f, o) => { o.accountDigest = ["a".repeat(64)]; }],
  ["missing session flags", (f, o) => { delete o.sessionFlags; }],
  ["null flags", (f, o) => { o.sessionFlags = null; }],
  ["unknown flags", (f, o, flags) => { flags.config = {}; }],
  ["missing model", (f, o, flags) => { delete flags.model; }],
  ["empty provider", (f, o, flags) => { flags.modelProvider = ""; }],
  ["wrong cwd", (f, o, flags) => { flags.cwd = f.root; }],
  ["wrong profile", (f, o, flags) => { flags.activePermissionProfile.id = "another"; }],
  ["profile extension field", (f, o, flags) => { flags.activePermissionProfile.extra = true; }],
  ["invalid profile parent", (f, o, flags) => { flags.activePermissionProfile.extends = {}; }],
  ["object thinking", (f, o, flags) => { flags.reasoningEffort = {}; }],
  ["unknown approval", (f, o, flags) => { flags.approvalPolicy = "always"; }],
  ["coerced granular flag", (f, o, flags) => { flags.approvalPolicy = { granular: { sandbox_approval: 0, rules: false, skill_approval: false, request_permissions: false, mcp_elicitations: false } }; }],
  ["null optional roots", (f, o, flags) => { flags.runtimeWorkspaceRoots = null; }],
  ["relative roots", (f, o, flags) => { flags.runtimeWorkspaceRoots = ["relative"]; }],
  ["noncanonical instructions", (f, o, flags) => { flags.instructionSources = [f.app + "/../AGENTS.md"]; }],
  ["unknown sandbox projection", (f, o, flags) => { flags.sandbox = { type: "unknown" }; }],
  ["sandbox extension field", (f, o, flags) => { flags.sandbox.extra = true; }],
  ["coerced sandbox network", (f, o, flags) => { flags.sandbox.networkAccess = 0; }],
  ["malformed lineage digest", (f) => { f.provenance.renewalDigest = ["e".repeat(64)]; }],
  ["renewal without observation", (f) => { f.provenance.renewalDigest = "e".repeat(64); delete f.provenance.inventory.observation; }],
]) test(`v2 typed observation refuses ${name} even with a matching canonical flags digest`, (t) => {
  const f = observedFixture(t), o = f.provenance.inventory.observation;
  mutate(f, o, o.sessionFlags); refreshObservation(f);
  assert.equal(verifyAdmission(f.bootstrapPath).available, false);
  assert.throws(() => prepareAdmission(f.bootstrapPath));
});
test("typed observation binds complete canonical flags, array order and opaque account intent without stale admission reuse", (t) => {
  const f = observedFixture(t), o = f.provenance.inventory.observation;
  prepareAdmission(f.bootstrapPath);
  o.sessionFlags.model = "changed"; f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "invalid-inventory-observation");
  refreshObservation(f); prepareAdmission(f.bootstrapPath);
  o.sessionFlags.runtimeWorkspaceRoots.push(f.root); refreshObservation(f);
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "stale-admission-receipt");
  prepareAdmission(f.bootstrapPath);
  o.sessionFlags.runtimeWorkspaceRoots.reverse(); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "invalid-inventory-observation");
  refreshObservation(f); prepareAdmission(f.bootstrapPath);
  o.accountDigest = "f".repeat(64); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "stale-admission-receipt");
});
for (const reason of ["renewal-intent-changed", "invalid-renewal-lineage", "stale-runtime-provenance"]) test(`typed observation cannot bypass per-call Manager ${reason}`, (t) => {
  const f = observedFixture(t); prepareAdmission(f.bootstrapPath);
  managerReport(f, { schemaVersion: 2, contractVersion: 2, available: false, reason });
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "native-policy-unavailable");
  assert.throws(() => prepareAdmission(f.bootstrapPath));
});
test("typed renewed generation requires fresh package admission and refuses an old-generation Manager report", (t) => {
  const f = observedFixture(t); prepareAdmission(f.bootstrapPath);
  f.manifest.generation.generation = 2;
  f.provenance.receiptDigest = "d".repeat(64); f.provenance.renewalDigest = "e".repeat(64);
  refreshObservation(f);
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "stale-admission-receipt");
  prepareAdmission(f.bootstrapPath);
  assert.equal(verifyAdmission(f.bootstrapPath).available, true);
  managerReport(f, { schemaVersion: 2, contractVersion: 2, available: true, policyDigest: "policy", configDigest: "config",
    sourceInventoryDigest: digest(stable(f.provenance.inventory)), runtimeProvenanceDigest: f.provenance.receiptDigest,
    generation: { ...f.manifest.generation, generation: 1 } });
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "native-policy-unavailable");
});
test("unobserved legacy schema2 remains initial-admission compatible without a renewability assertion", (t) => {
  const f = fixture(t, { schemaVersion: 2 });
  assert.equal(verifyAdmission(f.bootstrapPath).available, true);
  assert.equal(Object.hasOwn(f.provenance.inventory, "observation"), false);
  const receipt = JSON.parse(readFileSync(join(f.privateRoot, "admission-receipt.json"))).body;
  assert.equal(Object.hasOwn(receipt.nativeContract, "renewable"), false);
});

test("v2 rejects a signing key outside its elected-controller location", (t) => {
  const f = fixture(t, { schemaVersion: 2 });
  f.manifest.keyFile = join(f.privateRoot, "key"); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "invalid-signing-key");
});

test("v2 uses the elected controller key above its generation directory", (t) => {
  const f = fixture(t, { schemaVersion: 2, generationDirectory: true });
  assert.equal(verifyAdmission(f.bootstrapPath).available, true);
  const body = JSON.parse(readFileSync(join(f.privateRoot, "admission-receipt.json"))).body;
  assert.equal(body.nativeContract.schemaVersion, 2);
});

for (const consumer of [
  { schemaVersion: 1, component: "wrong", capabilities: ["suspension-v1"] },
  { schemaVersion: 1, component: "1", capabilities: ["suspension-v1", "host-exec"] },
  { schemaVersion: 1, component: "1", capabilities: ["suspension-v1"], command: "sh" },
]) test("consumer assertions must match the exact v2 component and capability contract", (t) => {
  const f = fixture(t, { schemaVersion: 2 }); f.input.consumer = consumer; f.saveInput(); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).available, false);
});
test("changed consumer capability invalidates admission and v1 cannot assert it", (t) => {
  const f = fixture(t, { schemaVersion: 2 });
  f.input.consumer = { schemaVersion: 1, component: f.manifest.components.mobile, capabilities: ["suspension-v1"] };
  f.saveInput(); f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "stale-admission-receipt");
  prepareAdmission(f.bootstrapPath); assert.equal(verifyAdmission(f.bootstrapPath).available, true);
  f.manifest.components.mobile = "changed"; f.savePolicy();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "unsupported-lifecycle-consumer");
  const v1 = fixture(t); v1.input.consumer = f.input.consumer; v1.saveInput(); v1.savePolicy();
  assert.equal(verifyAdmission(v1.bootstrapPath).reason, "unsupported-lifecycle-consumer");
});
