import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createMcpTestClient } from "./mcp-test-client.mjs";
import { fixture } from "./live-fixture.mjs";
import { contextExecutionBudget, digest, executionAuthority, executionInputsCurrent, nativeExitVerified, prepareAdmission, stable, stageAdmission } from "../../../plugins/gestalt/live-admission.mjs";
import { liveRequest, validateProxyEnvironment } from "../../../plugins/gestalt/live-mcp-proxy.mjs";
import { orgLifecycle } from "../../../plugins/gestalt/live-org-lifecycle.mjs";
import { prepareLiveRuntime } from "../../../plugins/gestalt/scripts/prepare-live-runtime.mjs";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
test("successful stdout and signed exit alone cannot substitute for post-spawn monitor readiness", (t) => {
  const f = fixture(t), authority = executionAuthority(f.bootstrapPath), launchId = randomUUID();
  const path = join(f.privateRoot, `process-${launchId}.json`);
  assert.equal(nativeExitVerified(authority, launchId), false);
  const ready = { kind: "process-launch", launchId, commandId: "context-mode-call", status: "exited", termination: "leader-exit", postSpawnValidated: true,
    policy: { manifestDigest: digest(readFileSync(f.input.manifestPath)) } };
  const save = (body) => f.save(path, { body, mac: createHmac("sha256", readFileSync(f.manifest.keyFile)).update(stable(body)).digest("hex") });
  for (const change of [
    (body) => { delete body.postSpawnValidated; }, (body) => { body.postSpawnValidated = false; },
    (body) => { body.postSpawnValidated = "true"; }, (body) => { body.status = "running"; },
    (body) => { body.termination = "policy-changed"; }, (body) => { body.commandId = "other"; },
    (body) => { body.policy.manifestDigest = "0".repeat(64); },
  ]) { const body = structuredClone(ready); change(body); save(body); assert.equal(nativeExitVerified(authority, launchId), false); }
  save(ready); assert.equal(nativeExitVerified(authority, launchId), true);
});
test("installed-source call deadline preserves both observation phases and the existing command clock", () => {
  assert.equal(contextExecutionBudget({}), 125000);
  assert.equal(contextExecutionBudget({ originalLaunchSources: [{}] }), 305000);
});
test("proxy accepts only Native's optional fixed TMPDIR and the existing minimal environment", () => {
  const minimal = { PATH: "/usr/bin:/bin", HOME: "/fixed/owning/home", LANG: "C.UTF-8" };
  assert.doesNotThrow(() => validateProxyEnvironment(minimal));
  assert.doesNotThrow(() => validateProxyEnvironment({ ...minimal, TMPDIR: "/tmp" }));
  for (const TMPDIR of ["", "/tmp/", "/tmp/other", "/var/tmp", "relative", "/tmp/../tmp", undefined])
    assert.throws(() => validateProxyEnvironment({ ...minimal, TMPDIR }), /unsafe-live-proxy-environment/);
  for (const extra of ["CODEX_HOME", "NODE_OPTIONS", "LD_PRELOAD", "TMP", "TEMP", "GESTALT_MOBILE_ORG_PLAN_CAPABILITIES", "UNRELATED"])
    assert.throws(() => validateProxyEnvironment({ ...minimal, TMPDIR: "/tmp", [extra]: "" }), /unsafe-live-proxy-environment/);
  for (const PATH of [undefined, "", "/usr/bin:/bin:/extra", "/bin:/usr/bin"])
    assert.throws(() => validateProxyEnvironment({ ...minimal, PATH, TMPDIR: "/tmp" }), /unsafe-live-proxy-environment/);
});
test("Native helper PATH requires the exact authenticated parent, private aliases and held lock", { skip: process.platform !== "linux" }, (t) => {
  const f = fixture(t);
  // Offline filesystem/process contract fixture: Python stands in for the
  // already-authenticated Native parent. The hosted proof uses real Native.
  const python = join(f.root, "python");
  copyFileSync("/usr/bin/python3", python); chmodSync(python, 0o700);
  const result = spawnSync(python, ["-c", String.raw`
import copy,fcntl,hashlib,json,os,pathlib,subprocess,sys
node,module,home=sys.argv[1:]
home=pathlib.Path(home);directory=home/'tmp'/'arg0'/'codex-arg0Ab1234'
directory.mkdir(parents=True,mode=0o700)
for p in [home,home/'tmp',directory.parent,directory]:p.chmod(0o700)
executable=os.path.realpath(sys.executable)
names=['apply_patch','applypatch','codex-execve-wrapper','codex-linux-sandbox']
for name in names:(directory/name).symlink_to(executable)
lock=open(directory/'.lock','w');os.chmod(directory/'.lock',0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
image=os.stat('/proc/self/exe');stat=pathlib.Path('/proc/self/stat').read_text()
identity={'pid':os.getpid(),'birth':stat[stat.rindex(')')+2:].split()[19],'uid':os.getuid(),'namespaces':{name:os.readlink('/proc/self/ns/'+name) for name in ['mnt','user','pid']}}
binary={'path':executable,'version':'0.161.0','sha256':hashlib.sha256(pathlib.Path(executable).read_bytes()).hexdigest()}
authority={'manifest':{'schemaVersion':2,'owningRuntime':{'home':str(home)},'binary':binary},'nativeRuntime':{'process':identity,'executable':binary,'executableIdentity':{'dev':image.st_dev,'ino':image.st_ino}}}
environment={'PATH':str(directory)+':/usr/bin:/bin','HOME':str(home),'LANG':'C.UTF-8','TMPDIR':'/tmp'}
script='import {validateProxyEnvironment} from '+json.dumps(module)+';const x=JSON.parse(process.argv[1]);try{validateProxyEnvironment(x.environment,x.authority);process.exit(0)}catch{process.exit(78)}'
results={}
def check(name,env=None,auth=None):
 p=subprocess.run([node,'--input-type=module','-e',script,json.dumps({'environment':env or environment,'authority':auth or authority})],capture_output=True,timeout=10)
 results[name]=p.returncode
check('valid')
for name,path in [('extra-prefix','/other:'+environment['PATH']),('extra-suffix',environment['PATH']+':/other'),('relative-prefix','relative:/usr/bin:/bin'),('dot-components',str(directory)+'/../'+directory.name+':/usr/bin:/bin')]:
 env=environment.copy();env['PATH']=path;check(name,env)
for name,key,value in [('wrong-home','HOME',str(home.parent)),('wrong-lang','LANG','C'),('wrong-tmpdir','TMPDIR','/var/tmp'),('unrelated','NODE_OPTIONS','')]:
 env=environment.copy();env[key]=value;check(name,env)
for name,edit in [('stale-birth',lambda a:a['nativeRuntime']['process'].update(birth='0')),('wrong-parent',lambda a:a['nativeRuntime']['process'].update(pid=1)),('wrong-namespace',lambda a:a['nativeRuntime']['process']['namespaces'].update(mnt='mnt:[0]')),('v1',lambda a:a['manifest'].update(schemaVersion=1)),('missing-runtime',lambda a:a.pop('nativeRuntime'))]:
 a=copy.deepcopy(authority);edit(a);check(name,auth=a)
(directory/'extra').write_text('');check('extra-alias');(directory/'extra').unlink()
alias=directory/names[0];alias.unlink();alias.symlink_to('/usr/bin/true');check('wrong-target');alias.unlink();alias.symlink_to(executable)
alias.unlink();alias.write_text('not an alias');check('regular-alias');alias.unlink();alias.symlink_to(executable)
directory.chmod(0o600);check('unsafe-directory-mode');directory.chmod(0o700)
directory.parent.chmod(0o770);check('unsafe-parent-mode');directory.parent.chmod(0o700)
home.chmod(0o770);check('unsafe-home-mode');home.chmod(0o700)
(home/'tmp').chmod(0o777);directory.chmod(0o777);os.chmod(directory/'.lock',0o666);check('valid-private-home-umask');(home/'tmp').chmod(0o700);directory.chmod(0o700);os.chmod(directory/'.lock',0o600)
os.chmod(directory/'.lock',0o700);check('unsafe-lock-mode');os.chmod(directory/'.lock',0o600)
fcntl.flock(lock,fcntl.LOCK_UN);check('unheld-lock');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
os.link(directory/'.lock',home/'second-lock');check('hardlinked-lock');(home/'second-lock').unlink()
other=directory.parent/'codex-arg0Zz9999';other.mkdir(mode=0o700)
for name in names:(other/name).symlink_to(executable)
(other/'.lock').write_text('');(other/'.lock').chmod(0o600)
env=environment.copy();env['PATH']=str(other)+':/usr/bin:/bin';check('fabricated-directory',env)
check('valid-after-refusals')
print(json.dumps(results))
`, process.execPath, pathToFileURL(join(repo, "plugins/gestalt/live-mcp-proxy.mjs")).href, join(f.root, "owning")], {
    encoding: "utf8", timeout: 45000, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
  });
  assert.equal(result.status, 0, result.stderr);
  const results = JSON.parse(result.stdout);
  assert.equal(results.valid, 0, result.stderr); assert.equal(results["valid-after-refusals"], 0); assert.equal(results["valid-private-home-umask"], 0);
  for (const [name, status] of Object.entries(results)) if (!["valid", "valid-after-refusals", "valid-private-home-umask"].includes(name)) assert.equal(status, 78, name);
});
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
  assert.equal(orgLifecycle(f.authority, "tools/list", {}).tools.length, 12);
  const oldCapability = process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;
  delete process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;
  try {
    for (const [name, args] of [
      ["org_plan_suspend_reopen", { dependentId: "first-outcome", dependencyId: "first-outcome" }],
      ["org_plan_resume", { id: "first-outcome" }],
    ]) {
      const before = readFileSync(f.plan);
      assert.throws(() => orgLifecycle(f.authority, "tools/call", { name, arguments: { plan: f.plan, ...args } }), /unsupported-suspension-consumer/);
      assert.deepEqual(readFileSync(f.plan), before);
    }
  } finally {
    if (oldCapability === undefined) delete process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;
    else process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES = oldCapability;
  }
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
test("Native thread routing metadata never grants Org lifecycle authority", async (t) => {
  const f = lifecycleFixture(t, { schemaVersion: 2 }), threadId = "019ac134-1234-7123-a123-0123456789ab";
  const request = (args, meta) => liveRequest(f.bootstrapPath, "gestalt-org-plan", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
    name: "org_plan_validate", arguments: args, _meta: meta,
  } }));
  const valid = await request({ plan: f.plan }, { threadId });
  assert.equal(valid.error, undefined); assert.equal(valid.result.structuredContent.valid, true);
  for (const progressToken of [0, 1, 0xffffffff])
    assert.equal((await request({ plan: f.plan }, { threadId, progressToken })).error, undefined);
  const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
  for (const extra of [{ traceparent }, { traceparent: traceparent.replace(/01$/, "ff"), tracestate: "vendor=opaque,1@tenant=value" }])
    assert.equal((await request({ plan: f.plan }, { threadId, progressToken: 1, ...extra })).error, undefined);
  for (const meta of [null, [], {}, { threadId: "" }, { threadId: 1 }, { threadId, command: "true" }, { threadId, capabilities: ["suspension-v1"] },
    { threadId, traceparent: "unknown-annotation" }, { threadId, progressToken: 1, command: "true" }])
    assert.equal((await request({ plan: f.plan }, meta)).error.message, "invalid-lifecycle-request");
  for (const progressToken of [null, "1", true, {}, [], -1, 0.5, 0x100000000, Number.MAX_SAFE_INTEGER])
    assert.equal((await request({ plan: f.plan }, { threadId, progressToken })).error.message, "invalid-lifecycle-request");
  for (const extra of [{ traceparent: null }, { traceparent: "" }, { traceparent: traceparent.toUpperCase() },
    { traceparent: traceparent.replace("0123456789abcdef0123456789abcdef", "0".repeat(32)) },
    { traceparent: traceparent.replace("-0123456789abcdef-", `-${"0".repeat(16)}-`) },
    { tracestate: "vendor=value" }, { traceparent, tracestate: "" }, { traceparent, tracestate: "vendor=value\n" },
    { traceparent, tracestate: "vendor=value,vendor=other" }, { traceparent, tracestate: "vendor=" + "x".repeat(513) },
    { traceparent, tracestate: Array.from({ length: 33 }, (_, i) => `v${i}=x`).join(",") }])
    assert.equal((await request({ plan: f.plan }, { threadId, progressToken: 1, ...extra })).error.message, "invalid-lifecycle-request");
  assert.equal((await request({ plan: f.bootstrapPath }, { threadId })).error.message, "unadmitted-lifecycle-plan");
  assert.ok((await request({ plan: f.plan, command: "true" }, { threadId })).error);
  f.manifest.generation.generation++; f.savePolicy();
  assert.ok((await request({ plan: f.plan }, { threadId })).error);
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
  assert.equal((await client.request(2, "tools/list")).result.tools.length, 12);
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

test("v2 signed consumer capability enables the typed suspension lifecycle without ambient export", (t) => {
  const f = lifecycleFixture(t, { schemaVersion: 2 });
  f.input.consumer = { schemaVersion: 1, component: f.manifest.components.mobile, capabilities: ["suspension-v1"] };
  f.saveInput(); f.savePolicy(); prepareAdmission(f.bootstrapPath);
  const original = readFileSync(f.plan, "utf8"), header = original.slice(0, original.indexOf("* TODO"));
  const block = original.slice(original.indexOf("* TODO"));
  writeFileSync(f.plan, header + block.replaceAll("TODO", "DONE").replace("UNREVIEWED", "REVIEWED") +
    block.replaceAll("first-", "second-").replaceAll("TODO", "WIP"));
  const before = process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;
  delete process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;
  try {
    const authority = executionAuthority(f.bootstrapPath);
    const call = (name, args) => orgLifecycle(authority, "tools/call", { name, arguments: { plan: f.plan, ...args } });
    call("org_plan_suspend_reopen", { dependentId: "second-outcome", dependencyId: "first-outcome" });
    assert.match(readFileSync(f.plan, "utf8"), /\* SUSPENDED/);
    assert.throws(() => call("org_plan_resume", { id: "second-outcome" }), /lifecycle-operation-refused/);
    call("org_plan_l1_transition", { id: "first-outcome", state: "DONE" });
    call("org_plan_review_transition", { id: "first-outcome", state: "REVIEWED" });
    call("org_plan_resume", { id: "second-outcome" });
    assert.doesNotMatch(readFileSync(f.plan, "utf8"), /SUSPENDED/);
    assert.equal(process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES, undefined);
    assert.throws(() => call("org_plan_validate", { consumerCapabilities: ["suspension-v1"] }));
  } finally {
    if (before === undefined) delete process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;
    else process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES = before;
  }
});

test("ambient consumer assertions cannot grant Live suspension authority", (t) => {
  const f = lifecycleFixture(t, { schemaVersion: 2 });
  const before = process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;
  process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES = "suspension-v1";
  try {
    assert.throws(() => orgLifecycle(executionAuthority(f.bootstrapPath), "tools/call", { name: "org_plan_resume", arguments: { plan: f.plan, id: "first-outcome" } }), /unsupported-suspension-consumer/);
  } finally {
    if (before === undefined) delete process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;
    else process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES = before;
  }
});

test("Live worker scopes runtime and interpreter temporary writes to its admitted workspace", { skip: process.platform !== "linux" }, (t) => {
  const f = fixture(t, { appName: "app with spaces" });
  // A tiny transport fixture observes runtime initialization paths. Real package
  // and filesystem denial are independently exercised by the hosted Native proof.
  writeFileSync(join(f.runtime, "server.bundle.mjs"), `
    import {tmpdir} from 'node:os';
    import {execFileSync} from 'node:child_process';
    import {dirname,join} from 'node:path';
    import {writeFileSync} from 'node:fs';
    const temporary=tmpdir();
    const probeRoot=process.env.CONTEXT_MODE_LIVE_TEMP_DIR;
    writeFileSync(join(temporary,'runtime-preload'),'fixture');
    writeFileSync(join(probeRoot,'interpreter-temp'),'fixture');
    export const server={async connect(t){t.onmessage=r=>t.send({id:r.id,result:{temporary,probeRoot,ambientCapability:process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES??null}})},async close(){}};
  `);
  const worker = spawnSync(process.execPath, [join(repo, "plugins/gestalt/live-context-worker.mjs"), "--runtime", f.runtime, "--workspace", f.app], {
    input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", TMPDIR: "/tmp", GESTALT_MOBILE_ORG_PLAN_CAPABILITIES: "suspension-v1" }, timeout: 15000,
  });
  assert.equal(worker.status, 0);
  const result = JSON.parse(worker.stdout).result, expected = join(f.app, ".gestalt/context-mode/tmp");
  assert.equal(result.temporary, expected); assert.equal(result.probeRoot, expected);
  assert.equal(result.ambientCapability, null);
  assert.equal(readFileSync(join(expected, "runtime-preload"), "utf8"), "fixture");
  assert.equal(readFileSync(join(expected, "interpreter-temp"), "utf8"), "fixture");
});
