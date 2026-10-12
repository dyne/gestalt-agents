/** Disposable supported-host proof. No model calls, credentials or deployment. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareLiveRuntime } from "../plugins/gestalt/scripts/prepare-live-runtime.mjs";
import { managerEnvironment } from "../plugins/gestalt/live-admission.mjs";
import { createMcpTestClient } from "../tests/plugins/gestalt/mcp-test-client.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url)), evidence = resolve(process.env.LIVE_PACKAGED_EVIDENCE ?? "test-results/live-packaged");
const binary = realpathSync(process.env.LIVE_HOST_CODEX_BINARY), manager = realpathSync(process.env.LIVE_HOST_MANAGER_BINARY), caddyBinary = realpathSync(process.env.LIVE_HOST_CADDY_BINARY);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(predicate, budget = 15000) {
  const deadline = Date.now() + budget;
  while (Date.now() < deadline) { try { if (predicate()) return; } catch {} await wait(50); }
  throw new Error("PROOF_DEADLINE");
}
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repo, encoding: "utf8" }).trim();
const root = mkdtempSync(join(dirname(manager), "l10 packaged proof "));
const app = join(root, "project with spaces"), privateRoot = join(root, "controller"), owningHome = join(privateRoot, "owning"), home = join(privateRoot, "sandbox"), packagesRoot = join(root, "packages");
for (const path of [app, privateRoot, owningHome, home, packagesRoot, join(app, ".gestalt")]) mkdirSync(path, { mode: 0o700 });
const report = {
  schemaVersion: 1, passed: false, stage: "installation", checks: {},
  provenance: { tree, commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID,
    nativeVersion: "0.161.0", binarySha256: hash(readFileSync(binary)), managerSha256: hash(readFileSync(manager)),
    acceptedManagerCommit: "9b55cd1281a167f8cc19476a6ebf0b9c2d513bfe", nativeSource: "979011409de0a60b52f179721948e65531d26144" },
  limitations: ["No model credentials or production owning-session/picker proof; L11 remains required."],
};
let native, caddy, socketServer, activeAbort, authFd, contextProxy, orgProxy;
let admittedNode;
const minimal = { PATH: "/usr/bin:/bin", HOME: owningHome, CODEX_HOME: owningHome, TMPDIR: "/tmp", LANG: "C.UTF-8" };
const identity = (pid) => {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return { pid, birth: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19], uid: process.getuid(),
    namespaces: Object.fromEntries(["mnt", "user", "pid"].map((name) => [name, readlinkSync(`/proc/${pid}/ns/${name}`)])) };
};
const managerApi = (operation, manifestPath) => JSON.parse(execFileSync(manager, ["live-policy", operation, "--manifest", manifestPath], {
  cwd: privateRoot, env: managerEnvironment(admittedNode, home), encoding: "utf8", timeout: 30000, maxBuffer: 4096,
}));
async function close(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try { await until(() => child.exitCode !== null || child.signalCode !== null, 4000); }
  catch { child.kill("SIGKILL"); await until(() => child.exitCode !== null || child.signalCode !== null, 4000); }
}
function rpcClient(child) {
  let counter = 0, buffer = ""; const pending = new Map();
  child.stdout.on("data", (bytes) => {
    buffer += bytes;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n"), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      const call = pending.get(message.id); if (!call) continue;
      pending.delete(message.id); clearTimeout(call.timer);
      if (message.error) call.reject(new Error("NATIVE_RPC_REFUSED")); else call.done(message.result);
    }
  });
  return (method, params) => new Promise((done, reject) => {
    const id = ++counter, timer = setTimeout(() => { pending.delete(id); reject(new Error("NATIVE_RPC_TIMEOUT")); }, 20000);
    pending.set(id, { done, reject, timer }); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
try {
  assert.equal(report.provenance.binarySha256, "9a820c17865fa825d04db416818679a9d63bd72e50835c396f496e5684626c9c");
  assert.equal(report.provenance.managerSha256, "785f300578a98f214724b1f65b9a52d880cecf9429ab2dc30a099dbafd049ea7");
  const bwrap = [join(dirname(binary), "codex-resources/bwrap"), join(dirname(dirname(binary)), "codex-resources/bwrap"), join(dirname(binary), "bwrap")].find((path) => existsSync(path));
  assert.ok(bwrap); report.provenance.bundledBwrapSha256 = hash(readFileSync(bwrap));
  assert.equal(report.provenance.bundledBwrapSha256, "77360cb751ccedc5971391444ac86a8a33c15b04d6b4a6fe45f5d25496e62c4c");
  mkdirSync(join(root, "node-bin"), { mode: 0o700 });
  const node = join(root, "node-bin/node"); copyFileSync(realpathSync(process.execPath), node); chmodSync(node, 0o700);
  admittedNode = { path: node, sha256: hash(readFileSync(node)) };
  const packages = ["context-mode", "gestalt"].map((name) => {
    const target = join(packagesRoot, name);
    cpSync(join(repo, "plugins", name), target, { recursive: true, filter: (path) => !path.split("/").some((piece) => piece === "node_modules" || piece === "build" || piece.startsWith(".context-mode-prepare")) && !path.endsWith(".bundle.mjs") });
    return { name, root: target };
  });
  const gestaltRoot = packages.find((p) => p.name === "gestalt").root;
  // Import the INSTALLED package, not the source checkout, for admission and RPC.
  const { digest, measureTree, prepareAdmission, stageAdmission, verifyAdmission } = await import(pathToFileURL(join(gestaltRoot, "live-admission.mjs")).href);
  const { liveRequest } = await import(pathToFileURL(join(gestaltRoot, "live-mcp-proxy.mjs")).href);
  const runtime = await prepareLiveRuntime(packages.find((p) => p.name === "context-mode").root, join(root, "prepared-runtime"));
  report.provenance.runtime = runtime.sha256;
  report.provenance.packages = packages.map((p) => ({ name: p.name, sha256: measureTree(p.root) }));
  packages.forEach((p, index) => { p.sha256 = report.provenance.packages[index].sha256; });
  report.checks.installedPreparedBytes = true;
  const plan = join(app, ".gestalt/assigned.org"); copyFileSync(join(repo, "tests/plugins/gestalt/fixtures/valid-minimal.org"), plan); chmodSync(plan, 0o600);
  const publicFile = join(app, "public.txt"); writeFileSync(publicFile, "ordinary-public", { mode: 0o600 });
  const auth = join(privateRoot, "auth.fixture"), controlSocket = join(privateRoot, "controller.sock"), caddySocket = join(privateRoot, "caddy.sock"), caddyConfig = join(privateRoot, "caddy.json");
  writeFileSync(auth, "private-auth-fixture", { mode: 0o600 });
  authFd = openSync(auth, "r");
  let controllerConnections = 0;
  socketServer = createServer((peer) => { controllerConnections++; peer.end(); });
  await new Promise((done, reject) => { socketServer.once("error", reject); socketServer.listen(controlSocket, done); });
  writeFileSync(caddyConfig, JSON.stringify({ admin: { listen: `unix/${caddySocket}` }, apps: { http: { servers: { fixture: { listen: ["127.0.0.1:0"], routes: [{ handle: [{ handler: "static_response", body: "fixture" }] }] } } } } }), { mode: 0o600 });
  caddy = spawn(caddyBinary, ["run", "--config", caddyConfig], { env: minimal, stdio: "ignore" }); await until(() => lstatSync(caddySocket).isSocket());
  const caddyAlive = () => new Promise((done, reject) => { const req = httpRequest({ socketPath: caddySocket, path: "/config/" }, (response) => { response.resume(); response.once("end", () => done(response.statusCode === 200)); }); req.once("error", reject); req.end(); });
  assert.equal(await caddyAlive(), true);
  const profile = "l10-proof";
  const owningConfig = `approval_policy = "never"\ndefault_permissions = "${profile}"\nmcp_servers = {}\nplugins = {}\n[features]\ndaemon_auto_start = false\nmulti_agent = false\nmulti_agent_v2 = false\nhooks = false\n[permissions.${profile}]\nextends = ":workspace"\n[permissions.${profile}.filesystem]\n":root" = "read"\n${JSON.stringify(app)} = "write"\n${JSON.stringify(privateRoot)} = "deny"\n[permissions.${profile}.network]\nenabled = false\n`;
  writeFileSync(join(owningHome, "config.toml"), owningConfig, { mode: 0o600 });
  writeFileSync(join(home, "config.toml"), '[shell_environment_policy]\ninherit = "none"\n', { mode: 0o600 });
  report.stage = "stock-native-bootstrap";
  native = spawn(binary, ["app-server", "--stdio"], { cwd: app, env: minimal, stdio: ["pipe", "pipe", "pipe"] }); native.stderr.resume();
  const rpc = rpcClient(native);
  await rpc("initialize", { clientInfo: { name: "l10-packaged-proof", version: "1" }, capabilities: { experimentalApi: true } });
  native.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  assert.equal((await rpc("command/exec", { command: ["/usr/bin/true"], cwd: app, permissionProfile: profile, timeoutMs: 12000, outputBytesCap: 1024 })).exitCode, 0);
  const daemon = `/tmp/codex-daemon-${process.getuid()}`;
  assert.equal(lstatSync(daemon).mode & 0o777, 0o700);
  const keyFile = join(privateRoot, "key"), manifestPath = join(privateRoot, "manifest.json"), bootstrapPath = join(privateRoot, "bootstrap.json");
  writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  const state = { permissionProfile: { type: "managed", file_system: { type: "restricted", entries: [
    { path: { type: "special", value: { kind: "root" } }, access: "read" },
    { path: { type: "special", value: { kind: "slash_tmp" } }, access: "write" },
    { path: { type: "path", path: app }, access: "write" },
    { path: { type: "path", path: join(app, ".gestalt") }, access: "write" },
    { path: { type: "path", path: privateRoot }, access: "deny" },
  ] }, network: "restricted" }, sandboxCwd: pathToFileURL(app).href, useLegacyLandlock: false };
  const manifest = { schemaVersion: 1, profileId: profile, appRoot: app, controller: identity(process.pid), binary: { path: binary, version: "0.161.0", sha256: report.provenance.binarySha256 }, sandboxState: state,
    configFiles: [], components: { manager: report.provenance.acceptedManagerCommit, mobile: "l10-native-controller-fixture", agents: tree },
    privatePaths: { auth: [auth], controller: [privateRoot, controlSocket], caddy: [caddySocket, caddyConfig], daemon: [daemon] },
    keyFile, runtimeHome: home, environment: { PATH: "/usr/bin:/bin", HOME: home, TMPDIR: "/tmp" },
    commands: { "context-mode-call": { executable: node, sha256: digest(readFileSync(node)), args: [join(gestaltRoot, "live-context-worker.mjs"), "--runtime", runtime.root, "--workspace", app], timeoutMs: 120000 } },
  };
  const input = { schemaVersion: 1, manifestPath, workspaceRoot: app, packages, runtime, node: { path: node, sha256: digest(readFileSync(node)) }, plans: [plan], effectiveConfig: {
    plugins: packages.map(({ name, root: packageRoot }) => ({ name, root: packageRoot })),
    mcpServers: packages.map((p) => { const [name, config] = Object.entries(JSON.parse(readFileSync(join(p.root, ".mcp.json"))).mcpServers)[0]; return { name, ...config, cwd: p.root }; }), hooks: [], remoteMcp: [], executables: [],
  } };
  // Installer's public return contains schemaVersion; bootstrap runtime is exact.
  input.runtime = { root: runtime.root, sha256: runtime.sha256 };
  const save = () => writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  const saveInput = () => writeFileSync(bootstrapPath, JSON.stringify(input), { mode: 0o600 });
  saveInput(); save(); const config = stageAdmission(bootstrapPath);
  const inventory = () => { manifest.configFiles = [join(home, "config.toml"), join(owningHome, "config.toml"), bootstrapPath, config.configPath].map((path) => ({ path, sha256: hash(readFileSync(path)) })); };
  const prepare = () => { inventory(); save(); assert.equal(managerApi("prepare", manifestPath).available, true); assert.equal(prepareAdmission(bootstrapPath).available, true); };
  prepare();
  const preparedConfig = JSON.parse(readFileSync(config.configPath));
  const proxy = (name) => {
    const descriptor = preparedConfig.mcpServers[name];
    const child = spawn(descriptor.command, descriptor.args, { cwd: descriptor.cwd,
      env: { PATH: "/usr/bin:/bin", HOME: owningHome, LANG: "C.UTF-8" }, stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.resume(); return child;
  };
  contextProxy = proxy("context-mode"); orgProxy = proxy("gestalt-org-plan");
  const contextClient = createMcpTestClient(contextProxy, { timeoutMs: 125000 }), orgClient = createMcpTestClient(orgProxy, { timeoutMs: 30000 });
  // Host lifecycle tests require the controller's exact minimal PATH and no
  // inherited publication destination; no request can choose these settings.
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, { PATH: "/usr/bin:/bin", HOME: owningHome, LANG: "C.UTF-8" });
  let sequence = 0;
  const call = (name, args) => contextClient.request(++sequence, "tools/call", { name, arguments: args });
  const text = (response) => { assert.equal(response.error, undefined); assert.equal(response.result?.isError, undefined); return response.result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n"); };
  report.stage = "native-packaged-ordinary";
  const initialized = await contextClient.request(++sequence, "initialize", {}); assert.equal(initialized.error, undefined);
  const orgInitialized = await orgClient.request(++sequence, "initialize", {}); assert.equal(orgInitialized.error, undefined);
  const list = await contextClient.request(++sequence, "tools/list", {});
  assert.equal(list.error, undefined); const names = list.result.tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, 7); assert.ok(names.includes("ctx_execute")); assert.ok(!names.includes("ctx_doctor"));
  assert.match(text(await call("ctx_execute", { language: "javascript", code: 'console.log("ordinary-live-work")' })), /^ordinary-live-work$/m);
  assert.match(text(await call("ctx_execute", { language: "shell", code: 'printf "ordinary-shell-work\\n"' })), /^ordinary-shell-work$/m);
  assert.match(text(await call("ctx_execute_file", { path: publicFile, language: "javascript", code: 'console.log(FILE_CONTENT)' })), /^ordinary-public$/m);
  report.checks.ordinaryInstalledContextTools = true;
  report.stage = "native-private-denial";
  const probes = { publicFile, auth, manifestPath, bootstrapPath, keyFile, caddyConfig, controlSocket, caddySocket, daemon,
    authIdentity: { dev: lstatSync(auth).dev, ino: lstatSync(auth).ino },
    aliases: [`/proc/${process.pid}/root${auth}`, `/proc/self/root${auth}`, `/proc/${process.pid}/fd/${authFd}`] };
  const code = `const fs=require('node:fs'),net=require('node:net'),cp=require('node:child_process');const p=${JSON.stringify(probes)};
const denied=path=>{try{fs.readFileSync(path);return false;}catch(e){return ['EPERM','EACCES','ENOENT','ENOTDIR','EISDIR'].includes(e.code);}};
const socketDenied=path=>new Promise(done=>{const peer=net.createConnection(path);peer.on('connect',()=>{peer.destroy();done(false)});peer.on('error',()=>done(true));setTimeout(()=>{peer.destroy();done(true)},500)});
(async()=>{const checks={publicRead:fs.readFileSync(p.publicFile,'utf8')==='ordinary-public',privateFiles:[p.auth,p.manifestPath,p.bootstrapPath,p.keyFile,p.caddyConfig].every(denied),procFD:p.aliases.every(denied),controllerSocket:await socketDenied(p.controlSocket),caddySocket:await socketDenied(p.caddySocket),daemonMask:(fs.lstatSync(p.daemon).mode&511)===0,ordinaryCommand:cp.spawnSync('/usr/bin/true',[],{stdio:'ignore'}).status===0,noCredentials:!Object.keys(process.env).some(k=>/TOKEN|SECRET|API_KEY|ORG_PLAN_STATUS/.test(k)),noInheritedPrivateFD:true};for(let fd=3;fd<128;fd++){try{const i=fs.fstatSync(fd);if(i.dev===p.authIdentity.dev&&i.ino===p.authIdentity.ino)checks.noInheritedPrivateFD=false}catch{}}try{fs.readdirSync(p.daemon);checks.daemon=false}catch{checks.daemon=true}console.log('LIVE_PROBE:'+JSON.stringify(checks))})()`;
  const output = text(await call("ctx_execute", { language: "javascript", code }));
  const denial = JSON.parse(output.slice(output.lastIndexOf("LIVE_PROBE:") + 11).split("\n")[0]);
  assert.ok(Object.values(denial).every(Boolean)); assert.equal(controllerConnections, 0); report.checks.privateNativeDenials = denial;
  report.stage = "typed-org-lifecycle";
  const lifecycle = await orgClient.request(++sequence, "tools/call", { name: "org_plan_l1_transition", arguments: { plan, id: "first-outcome", state: "WIP" } });
  assert.equal(lifecycle.error, undefined); assert.match(readFileSync(plan, "utf8"), /^\* WIP/m);
  const escape = await orgClient.request(++sequence, "tools/call", { name: "org_plan_validate", arguments: { plan: auth } });
  assert.equal(escape.error.message, "unadmitted-lifecycle-plan"); report.checks.typedOrgLifecycleScope = true;
  report.stage = "forged-missing-state";
  const receiptPath = join(privateRoot, "admission-receipt.json"), receipt = readFileSync(receiptPath);
  writeFileSync(receiptPath, '{}', { mode: 0o600 }); assert.equal(verifyAdmission(bootstrapPath).available, false);
  assert.ok((await call("ctx_execute", { language: "shell", code: "true" })).error);
  rmSync(receiptPath); assert.equal(verifyAdmission(bootstrapPath).available, false);
  writeFileSync(receiptPath, receipt, { mode: 0o600 });
  const originalState = manifest.sandboxState; delete manifest.sandboxState; save(); assert.equal(verifyAdmission(bootstrapPath).available, false); manifest.sandboxState = originalState; prepare();
  report.checks.forgedMissingStateRefused = true;
  report.stage = "descendant-narrowing";
  const marker = join(app, "descendant-marker"), heartbeat = join(app, "heartbeat.txt");
  const descendant = join(app, "descendant.mjs");
  writeFileSync(descendant, `import fs from 'node:fs';process.on('SIGTERM',()=>{});setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),100);`);
  const inFlight = call("ctx_execute", { language: "javascript", timeout: 60000, code: `const cp=require('node:child_process');cp.spawn(process.execPath,[${JSON.stringify(descendant)},${JSON.stringify(marker)}],{detached:true,stdio:'inherit'});setInterval(()=>{},1000);` });
  await until(() => existsSync(heartbeat));
  manifest.sandboxState.permissionProfile.file_system.entries.find((entry) => entry.path.path === app).access = "read"; save();
  assert.ok((await inFlight).error); activeAbort = undefined;
  const owned = readdirSync('/proc').filter((pid) => /^\d+$/.test(pid)).filter((pid) => { try { return readFileSync(`/proc/${pid}/cmdline`).toString().split('\0').includes(marker); } catch { return false; } });
  assert.equal(owned.length, 0); report.checks.narrowingReapsDetachedDescendants = true;
  assert.equal(verifyAdmission(bootstrapPath).available, false); prepare();
  const narrowFile = join(app, "denied-write.txt");
  const narrow = text(await call("ctx_execute", { language: "javascript", code: `const fs=require('node:fs');try{fs.writeFileSync(${JSON.stringify(narrowFile)},'unsafe');console.log('WRITE_ALLOWED')}catch{console.log('WRITE_DENIED')}` }));
  assert.match(narrow, /^WRITE_DENIED$/m); assert.equal(existsSync(narrowFile), false); report.checks.narrowedRestartCannotReuseAuthority = true;
  report.stage = "installed-byte-revocation";
  const runtimeFile = join(runtime.root, "package.json"), bytes = readFileSync(runtimeFile);
  writeFileSync(runtimeFile, `${bytes}\n`); assert.equal(verifyAdmission(bootstrapPath).available, false); writeFileSync(runtimeFile, bytes);
  assert.equal(verifyAdmission(bootstrapPath).available, true); report.checks.installedByteChangesInvalidateAdmission = true;
  assert.equal(await caddyAlive(), true); assert.equal(lstatSync(daemon).mode & 0o777, 0o700); assert.equal(readFileSync(auth, "utf8"), "private-auth-fixture");
  report.processLaunches = readdirSync(privateRoot).filter((name) => /^process-[a-f0-9-]+\.json$/.test(name)).map((name) => {
    const record = JSON.parse(readFileSync(join(privateRoot, name))).body;
    return { launchId: record.launchId, status: record.status, commandId: record.commandId, process: record.process, termination: record.termination, policyDigest: record.policy.policyDigest };
  });
  assert.ok(report.processLaunches.length >= 7); assert.ok(report.processLaunches.every((launch) => launch.status === "exited"));
  assert.equal(new Set(report.processLaunches.map((launch) => launch.launchId)).size, report.processLaunches.length);
  report.checks.noPersistentWorkerReuse = true;
  report.checks.hostAuthorityPreserved = true; report.stage = "complete"; report.passed = true;
} catch (error) {
  report.failure = /^[A-Z_]{1,64}$/.test(error.message) ? error.message : "PROOF_ASSERTION_FAILED";
  report.failureDetails = { stage: report.stage, operator: error.operator, code: error.code,
    actual: typeof error.actual === "boolean" || typeof error.actual === "number" ? error.actual : undefined };
  process.exitCode = 1;
} finally {
  activeAbort?.abort();
  await close(contextProxy); await close(orgProxy);
  await close(native); await close(caddy);
  if (authFd !== undefined) closeSync(authFd);
  if (socketServer) await new Promise((done) => socketServer.close(done));
  mkdirSync(evidence, { recursive: true }); writeFileSync(join(evidence, "native-proof.json"), `${JSON.stringify(report, null, 2)}\n`);
  rmSync(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ passed: report.passed, stage: report.stage, checks: Object.keys(report.checks), failure: report.failure })}\n`);
}
