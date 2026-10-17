import assert from "node:assert/strict";
import { chmodSync, copyFileSync, linkSync, lstatSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { installedFixture } from "./live-installed-fixture.mjs";
import { executionAuthority, executionInputsCurrent, prepareAdmission, verifyAdmission, digest, measureTree, stable } from "../../../plugins/gestalt/live-admission.mjs";

test("authentic 0755 configured bridge is independently bound outside config roles without rewriting original configuration", (t) => {
  const f = installedFixture(t), before = readFileSync(f.configured.configPath), hooks = readFileSync(f.configured.hooksPath);
  assert.match(before.toString(), /enabled = false/); assert.match(before.toString(), /hooks = true/);
  prepareAdmission(f.bootstrapPath); assert.equal(verifyAdmission(f.bootstrapPath).available, true);
  const config = JSON.parse(readFileSync(join(f.privateRoot, "live-mcp-config.json")));
  assert.equal(config.mcpServers["context-mode"].startup_timeout_sec, 880);
  assert.equal(config.mcpServers["context-mode"].tool_timeout_sec, 395);
  assert.equal(config.mcpServers["gestalt-org-plan"].startup_timeout_sec, 270);
  assert.equal(config.mcpServers["gestalt-org-plan"].tool_timeout_sec, 90);
  assert.equal(lstatSync(f.configured.launcherPath).mode & 0o7777, 0o755);
  assert.equal(f.manifest.configFiles.some((entry) => entry.path === f.configured.launcherPath), false);
  const authority = executionAuthority(f.bootstrapPath);
  assert.deepEqual(authority.originalLaunchSources, f.observations);
  const receipt = JSON.parse(readFileSync(authority.receiptPath));
  assert.deepEqual(receipt.body.nativeContract.originalLaunchSources, f.observations);
  assert.equal(executionInputsCurrent(authority), true);
  assert.deepEqual(readFileSync(f.configured.configPath), before); assert.deepEqual(readFileSync(f.configured.hooksPath), hooks);
});

for (const [name, change] of [
  ["missing descriptor", (f) => { delete f.manifest.originalLaunchSources; }],
  ["empty descriptors", (f) => { f.manifest.originalLaunchSources = []; }],
  ["unknown descriptor kind", (f) => { f.manifest.originalLaunchSources[0].kind = "arbitrary-command"; }],
  ["byte-identical substitute for actual controller interpreter", (f) => {
    const path = join(f.root, "node-bin/node"); copyFileSync(process.execPath, path); chmodSync(path, 0o755);
    f.input.node = { path, sha256: digest(readFileSync(path)) }; f.manifest.originalLaunchSources[0].interpreter = f.input.node;
    Object.assign(f.manifest.commands["context-mode-call"], { executable: path, sha256: f.input.node.sha256 });
  }],
  ["extra descriptor authority", (f) => { f.manifest.originalLaunchSources[0].env = {}; }],
  ["missing inventory source", (f) => { f.provenance.inventory.sources = f.provenance.inventory.sources.filter((s) => s.kind !== "installed-launch-source"); }],
  ["duplicate inventory source", (f) => { f.provenance.inventory.sources.push(f.observations[0]); }],
  ["invented inventory source kind", (f) => { f.provenance.inventory.sources.find((s) => s.kind === "installed-launch-source").kind = "executable"; }],
  ["forged Manager observation", (f) => { f.observations[0].observation.launcher.identity.ino++; }],
  ["writable launcher", (f) => { chmodSync(f.configured.launcherPath, 0o775); }],
  ["writable bin", (f) => { chmodSync(join(f.manifest.runtimeHome, "bin"), 0o777); }],
  ["project writable source tree", (f) => { f.manifest.sandboxState.permissionProfile.file_system.entries.push({ access: "write", path: { type: "path", path: f.input.runtime.root } }); }],
  ["symlinked launcher", (f) => { const other = `${f.configured.launcherPath}.other`; renameSync(f.configured.launcherPath, other); symlinkSync(other, f.configured.launcherPath); }],
  ["same-byte replaced launcher", (f) => { const other = `${f.configured.launcherPath}.other`; copyFileSync(f.configured.launcherPath, other); chmodSync(other, 0o755); renameSync(other, f.configured.launcherPath); }],
  ["outside runtime hardlink", (f) => { linkSync(join(f.runtime, "server.bundle.mjs"), join(f.root, "outside")); }],
  ["changed runtime bytes", (f) => { writeFileSync(join(f.runtime, "server.bundle.mjs"), "tampered"); }],
  ["missing package input", (f) => { unlinkSync(join(f.manifest.originalLaunchSources[0].package.root, "start.mjs")); }],
]) test(`installed source refuses ${name} even with a successful signed fixture Manager`, (t) => {
  const f = installedFixture(t); change(f); f.publish(); assert.equal(verifyAdmission(f.bootstrapPath).available, false);
  assert.throws(() => prepareAdmission(f.bootstrapPath));
});

test("Manager capability is mandatory and its current source observation must match", (t) => {
  const f = installedFixture(t); f.publish(f.observations, false);
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "native-policy-unavailable");
  f.publish([]); assert.equal(verifyAdmission(f.bootstrapPath).available, false);
});

test("freshly pinned arbitrary generated launcher bytes cannot become admitted source", (t) => {
  const f = installedFixture(t), source = f.manifest.originalLaunchSources[0];
  writeFileSync(source.path, "#!/usr/bin/env node\nprocess.exit(0);\n"); source.sha256 = digest(readFileSync(source.path));
  f.observations[0].descriptor = source; f.publish();
  assert.equal(verifyAdmission(f.bootstrapPath).available, false);
});

test("complete protected internal hardlink closure is admitted but additional outside aliases revoke it", (t) => {
  const f = installedFixture(t), pkg = f.manifest.originalLaunchSources[0].package;
  linkSync(join(pkg.root, "start.mjs"), join(pkg.root, "start-alias.mjs"));
  pkg.treeDigest = measureTree(pkg.root); f.input.packages.find((p) => p.name === "context-mode").sha256 = pkg.treeDigest;
  // Re-observe only this new pre-birth fixture; old admitted generations cannot
  // adopt a changed identity by editing digests.
  return import("../../../plugins/gestalt/live-installed-source.mjs").then(({ observeOriginalLaunchSources }) => {
    f.observations = observeOriginalLaunchSources(f.manifest, f.input);
    f.provenance.inventory.sources = f.provenance.inventory.sources.filter((s) => s.kind !== "installed-launch-source");
    f.provenance.inventory.sources.push(...f.observations); f.publish(f.observations);
    prepareAdmission(f.bootstrapPath); const authority = executionAuthority(f.bootstrapPath);
    assert.equal(executionInputsCurrent(authority), true);
    linkSync(join(pkg.root, "start.mjs"), join(f.root, "outside"));
    assert.equal(executionInputsCurrent(authority), false);
  });
});

test("renewal retains the exact source observation and old per-call authority cannot survive source replacement", (t) => {
  const f = installedFixture(t); prepareAdmission(f.bootstrapPath); const previous = executionAuthority(f.bootstrapPath), pins = stable(f.observations);
  f.manifest.generation.generation++; f.provenance.receiptDigest = "e".repeat(64); f.publish();
  assert.equal(verifyAdmission(f.bootstrapPath).reason, "stale-admission-receipt");
  prepareAdmission(f.bootstrapPath); const current = executionAuthority(f.bootstrapPath);
  assert.equal(stable(current.originalLaunchSources), pins); assert.equal(executionInputsCurrent(previous), false);
  const path = join(f.runtime, "server.bundle.mjs"), other = `${path}.replacement`;
  copyFileSync(path, other); renameSync(other, path);
  assert.equal(executionInputsCurrent(current), false); assert.equal(verifyAdmission(f.bootstrapPath).available, false);
});
