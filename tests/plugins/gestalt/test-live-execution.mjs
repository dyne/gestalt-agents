import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { spawn } from "node:child_process";
import { createMcpTestClient } from "./mcp-test-client.mjs";
import { fixture } from "./live-fixture.mjs";
import { executionAuthority, executionInputsCurrent, prepareAdmission, stageAdmission } from "../../../plugins/gestalt/live-admission.mjs";
import { liveRequest } from "../../../plugins/gestalt/live-mcp-proxy.mjs";
import { orgLifecycle } from "../../../plugins/gestalt/live-org-lifecycle.mjs";
import { prepareLiveRuntime } from "../../../plugins/gestalt/scripts/prepare-live-runtime.mjs";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
function lifecycleFixture(t, options) {
  const f = fixture(t, options), plan = f.input.plans[0];
  copyFileSync(join(repo, "tests/plugins/gestalt/fixtures/valid-minimal.org"), plan); chmodSync(plan, 0o600);
  const oldPath = process.env.PATH;
  const statusVariables = ["GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY", "GESTALT_MOBILE_ORG_PLAN_STATUS_FILE"];
  const status = statusVariables.map((name) => process.env[name]);
  for (const name of statusVariables) delete process.env[name];
  process.env.PATH = "/usr/bin:/bin";
  t.after(() => {
    process.env.PATH = oldPath;
    statusVariables.forEach((name, index) => { if (status[index] === undefined) delete process.env[name]; else process.env[name] = status[index]; });
  });
  return { ...f, plan, authority: executionAuthority(f.bootstrapPath) };
}
test("authenticated Org lifecycle uses the canonical helper and only the exact signed plan", { skip: process.platform !== "linux" }, async (t) => {
  const f = lifecycleFixture(t);
  assert.equal(orgLifecycle(f.authority, "tools/list", {}).tools.length, 10);
  const response = await liveRequest(f.bootstrapPath, "gestalt-org-plan", JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: {
    name: "org_plan_l1_transition", arguments: { plan: f.plan, id: "first-outcome", state: "WIP" },
  } }));
  assert.equal(response.error, undefined);
  assert.match(readFileSync(f.plan, "utf8"), /\* WIP/);
  assert.equal(JSON.stringify(response).includes(f.privateRoot), false);
  assert.equal(readdirSync(f.privateRoot).some((name) => name.startsWith("org-") || name === "org-lifecycle.lock"), false);
});
test("host bridge refuses arbitrary paths, commands and publication destinations", (t) => {
  const f = lifecycleFixture(t);
  for (const args of [
    { plan: f.bootstrapPath }, { plan: "../private/bootstrap.json" },
    { plan: f.plan, command: "cat /etc/passwd" }, { plan: f.plan, statusFile: "/etc/profile" },
  ]) assert.throws(() => orgLifecycle(f.authority, "tools/call", { name: "org_plan_validate", arguments: args }));
  for (const name of ["exec", "readFile", "org_plan_prepare_supervision"]) assert.throws(() => orgLifecycle(f.authority, "tools/call", { name, arguments: { plan: f.plan } }));
});
test("signed workspace plan remains usable for an app in a nested repository", { skip: process.platform !== "linux" }, (t) => {
  const f = lifecycleFixture(t), nested = join(f.app, "nested-app");
  mkdirSync(nested, { mode: 0o700 });
  f.manifest.appRoot = nested;
  f.manifest.commands["context-mode-call"].args[f.manifest.commands["context-mode-call"].args.length - 1] = nested;
  f.savePolicy();
  const config = stageAdmission(f.bootstrapPath);
  f.manifest.configFiles = f.manifest.configFiles.map((file) => file.path === config.configPath ? { path: config.configPath, sha256: config.sha256 } : file);
  f.savePolicy(); prepareAdmission(f.bootstrapPath);
  const result = orgLifecycle(executionAuthority(f.bootstrapPath), "tools/call", { name: "org_plan_validate", arguments: { plan: f.plan } });
  assert.equal(result.structuredContent.valid, true); assert.equal(result.structuredContent.plan.path, f.plan);
});
test("quoted workspace/private paths produce valid Org JSON without snapshot leakage", { skip: process.platform !== "linux" }, (t) => {
  const f = lifecycleFixture(t, { privateName: 'private "quoted"', appName: 'app "quoted"' });
  const result = orgLifecycle(f.authority, "tools/call", { name: "org_plan_validate", arguments: { plan: f.plan } });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.structuredContent.plan.path, f.plan);
  assert.equal(JSON.stringify(result).includes("assigned.org"), false);
});
test("normal non-Live Org launcher still starts through an external symlink", async (t) => {
  const f = fixture(t), entry = join(f.root, "normal-org-launcher.mjs");
  symlinkSync(join(repo, "plugins/gestalt/org-plan-mcp.mjs"), entry);
  const child = spawn(process.execPath, [entry], { cwd: f.app, env: { PATH: "/usr/bin:/bin", HOME: f.app }, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume(); t.after(() => child.kill("SIGTERM"));
  const client = createMcpTestClient(child);
  const initialized = await client.request(1, "initialize");
  assert.equal(initialized.result.serverInfo.name, "gestalt-org-plan");
  assert.equal((await client.request(2, "tools/list")).result.tools.length, 10);
});
test("symlinked plans/directories and hardlinks cannot turn lifecycle into private host reads", (t) => {
  const f = lifecycleFixture(t), secret = join(f.privateRoot, "secret.org");
  writeFileSync(secret, "private", { mode: 0o600 });
  rmSync(f.plan); symlinkSync(secret, f.plan);
  assert.throws(() => orgLifecycle(f.authority, "tools/call", { name: "org_plan_validate", arguments: { plan: f.plan } }));
  rmSync(f.plan); linkSync(secret, f.plan);
  assert.throws(() => orgLifecycle(f.authority, "tools/call", { name: "org_plan_validate", arguments: { plan: f.plan } }));
  rmSync(join(f.app, ".gestalt"), { recursive: true }); symlinkSync(f.privateRoot, join(f.app, ".gestalt"));
  assert.throws(() => orgLifecycle(f.authority, "tools/call", { name: "org_plan_validate", arguments: { plan: f.plan } }));
  assert.equal(readFileSync(secret, "utf8"), "private");
});
test("mutable installed/runtime bytes revoke execution authority; workspace state does not", (t) => {
  const f = fixture(t), authority = executionAuthority(f.bootstrapPath);
  assert.equal(executionInputsCurrent(authority), true);
  writeFileSync(join(f.app, "ordinary.txt"), "project state");
  assert.equal(executionInputsCurrent(authority), true);
  writeFileSync(join(f.runtime, "server.bundle.mjs"), "changed");
  assert.equal(executionInputsCurrent(authority), false);
});
test("missing/forged admission and unsupported lifecycle methods fail before work", async (t) => {
  const f = fixture(t);
  rmSync(join(f.privateRoot, "admission-receipt.json"));
  const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.ok((await liveRequest(f.bootstrapPath, "context-mode", request)).error);
  prepareAdmission(f.bootstrapPath);
  const response = await liveRequest(f.bootstrapPath, "gestalt-org-plan", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "host/exec", params: { command: "sh" } }));
  assert.equal(response.error.message, "unsupported-lifecycle-method");
});
test("Live runtime install normalizes executable aliases and rolls back failed preparation/publication", async (t) => {
  const f = fixture(t), source = join(f.root, "source"), target = join(f.root, "installed");
  mkdirSync(source, { mode: 0o700 });
  writeFileSync(join(source, "package.json"), "{}", { mode: 0o644 });
  let failPublish = false;
  const prepare = async (stage) => {
    writeFileSync(join(stage, "server.bundle.mjs"), "prepared", { mode: 0o664 });
    mkdirSync(join(stage, "node_modules/.bin"), { recursive: true });
    symlinkSync("../tool", join(stage, "node_modules/.bin/tool"));
  };
  const verify = (path) => ({ ok: (!failPublish || path !== target) && existsSync(join(path, "server.bundle.mjs")) });
  const first = await prepareLiveRuntime(source, target, { prepare, verify });
  assert.equal(first.sha256.length, 64); assert.equal(existsSync(join(target, "node_modules/.bin")), false);
  assert.equal(readFileSync(join(target, "server.bundle.mjs"), "utf8"), "prepared");
  await assert.rejects(prepareLiveRuntime(source, target, { prepare: async () => { throw new Error("offline"); }, verify }));
  failPublish = true;
  await assert.rejects(prepareLiveRuntime(source, target, { prepare, verify }));
  assert.equal(readFileSync(join(target, "server.bundle.mjs"), "utf8"), "prepared");
  assert.deepEqual(readdirSync(f.root).filter((name) => /stage-|backup-|install.lock/.test(name)), []);
});
