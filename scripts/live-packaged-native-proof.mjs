/** Disposable supported-host proof. No model calls, credentials or deployment. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { request as httpRequest, createServer as createHttpServer } from "node:http";
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
    acceptedManagerCommit: "19114b2389501c0a511b8a77ace4161b0dae2f0e", acceptedManagerTree: "966329668f6b967105a4b89b69875d73e54a08f9", nativeSource: "979011409de0a60b52f179721948e65531d26144" },
  limitations: ["No model credentials or production owning-session/picker proof; L11 remains required."],
};
let native, caddy, socketServer, activeAbort, authFd, contextProxy, orgProxy, elected, provider;
let admittedNode, proofManifest;
const minimal = { PATH: "/usr/bin:/bin", HOME: owningHome, CODEX_HOME: owningHome, TMPDIR: "/tmp", LANG: "C.UTF-8" };
const identity = (pid) => {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return { pid, birth: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19], uid: process.getuid(),
    namespaces: Object.fromEntries(["mnt", "user", "pid"].map((name) => [name, readlinkSync(`/proc/${pid}/ns/${name}`)])) };
};
const managerApi = (operation, manifestPath, ...args) => JSON.parse(execFileSync(manager, ["live-policy", operation, "--manifest", manifestPath, ...args], {
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
      if (message.error) {
        const error = new Error("NATIVE_RPC_REFUSED");
        error.rpc = { method: call.method, code: message.error.code,
          template: String(message.error.message).replace(/\/[^\s:;)"']+/g, "<path>").slice(0, 600) };
        call.reject(error);
      } else call.done(message.result);
    }
  });
  return (method, params, timeoutMs = 20000) => new Promise((done, reject) => {
    const id = ++counter, timer = setTimeout(() => { pending.delete(id); reject(new Error("NATIVE_RPC_TIMEOUT")); }, timeoutMs);
    pending.set(id, { done, reject, timer, method }); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
try {
  assert.equal(report.provenance.binarySha256, "b2730ae901da317bcc5933d9b87de6dfbea3e46a46b64f806e4268fd9a095578");
  assert.equal(report.provenance.managerSha256, "17dcb8d57591c00032c23f0af3de67e83da4abe4c21e0c632bd48bd6fa5c281e");
  const bwrap = [join(dirname(binary), "codex-resources/bwrap"), join(dirname(dirname(binary)), "codex-resources/bwrap"), join(dirname(binary), "bwrap")].find((path) => existsSync(path));
  assert.ok(bwrap); report.provenance.bundledBwrapSha256 = hash(readFileSync(bwrap));
  report.provenance.sandboxHelperSha256 = hash(readFileSync(join(dirname(binary), "codex-linux-sandbox")));
  report.provenance.codeModeHostSha256 = hash(readFileSync(join(dirname(binary), "codex-code-mode-host")));
  assert.equal(report.provenance.sandboxHelperSha256, "396915091a1f0387b48fd06e98d06e61d22f6ff6af33bc806891a634ee03d199");
  assert.equal(report.provenance.codeModeHostSha256, "e87096087c02aa6ab90a5a85031659665aa0bf3ee20c07ca0b8ab701c83fcd5b");
  assert.equal(report.provenance.bundledBwrapSha256, "335aa87510fc0eee1bcdbedd3d9bf4aa4d112cffed72d5f1ad7a10b6cc855066");
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
  const { digest, stable, measureTree, prepareAdmission, stageAdmission, verifyAdmission } = await import(pathToFileURL(join(gestaltRoot, "live-admission.mjs")).href);
  const { liveRequest } = await import(pathToFileURL(join(gestaltRoot, "live-mcp-proxy.mjs")).href);
  const runtime = await prepareLiveRuntime(packages.find((p) => p.name === "context-mode").root, join(root, "prepared-runtime"));
  report.provenance.runtime = runtime.sha256;
  report.provenance.canonicalPackages = Object.fromEntries(packages.map((p) => [p.name, { manifestSha256: hash(readFileSync(join(p.root, ".mcp.json"))), identitySha256: hash(readFileSync(join(p.root, ".codex-plugin/plugin.json"))) }]));
  report.provenance.packagedFiles = Object.fromEntries(["live-admission.mjs", "live-org-lifecycle.mjs", "live-mcp-proxy.mjs", "live-context-worker.mjs", "org-plan-mcp.mjs"].map((path) => [path, hash(readFileSync(join(gestaltRoot, path)))]));
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
  const profile = "l10-proof", narrowProfile = "l10-narrow", daemon = `/tmp/codex-daemon-${process.getuid()}`;
  let captureId = randomUUID();
  const narrowRoot = join(app, "narrowed"); mkdirSync(narrowRoot, { mode: 0o700 });
  const narrowFile = join(narrowRoot, "protected.txt"); writeFileSync(narrowFile, "original", { mode: 0o600 });
  const metadata = []; for (let path = app; ; path = dirname(path)) { metadata.push(join(path, ".codex")); if (path === "/") break; }
  const stateFor = (write) => ({ permissionProfile: { type: "managed", file_system: { type: "restricted", entries: [
    { path: { type: "special", value: { kind: "root" } }, access: "read" },
    { path: { type: "path", path: app }, access: "write" },
    { path: { type: "path", path: narrowRoot }, access: write ? "write" : "read" },
    ...[privateRoot, "/proc", daemon, ...metadata].map((path) => ({ path: { type: "path", path }, access: "deny" })),
  ] }, network: "restricted" }, sandboxCwd: pathToFileURL(app).href, useLegacyLandlock: false });
  const nativeProfile = (name, write) => `[permissions.${name}]\nextends = ":read-only"\n[permissions.${name}.filesystem]\n":root" = "read"\n${JSON.stringify(app)} = "write"\n${JSON.stringify(narrowRoot)} = "${write ? "write" : "read"}"\n${[privateRoot, "/proc", daemon, ...metadata].map((path) => `${JSON.stringify(path)} = "deny"\n`).join("")}[permissions.${name}.network]\nenabled = false\n`;
  let modelRequests = 0;
  provider = createHttpServer((req, res) => { if (req.method === "GET" && req.url.startsWith("/v1/models")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "gpt-6-sol", object: "model", owned_by: "controlled" }] })); } else { modelRequests++; res.writeHead(500); res.end("model-work-unavailable"); } });
  await new Promise((done) => provider.listen(0, "127.0.0.1", done));
  const owningConfig = `model = "gpt-6-sol"\nmodel_provider = "controlled"\napproval_policy = "never"\ndefault_permissions = "${profile}"\nmcp_servers = {}\nplugins = {}\n[shell_environment_policy]\ninherit = "none"\n[model_providers.controlled]\nname = "No-model packaged proof"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[features]\nshell_snapshot = false\nshell_snapshot_v2 = false\ndaemon_auto_start = false\ncode_mode = false\nmulti_agent = false\nmulti_agent_v2 = false\nhooks = false\n[projects.${JSON.stringify(app)}]\ntrust_level = "trusted"\n${nativeProfile(profile, true)}${nativeProfile(narrowProfile, false)}`;
  writeFileSync(join(owningHome, "config.toml"), owningConfig, { mode: 0o600 });
  writeFileSync(join(home, "config.toml"), '[shell_environment_policy]\ninherit = "none"\n', { mode: 0o600 });
  writeFileSync(join(app, "AGENTS.md"), "Preserve private state.\n", { mode: 0o644 });
  const { electLiveController } = await import(pathToFileURL(realpathSync(process.env.LIVE_HOST_ELECTION_MODULE)).href);
  elected = await electLiveController({ privateDirectory: privateRoot, controllerId: "l10-proof", initialize: true });
  const holderPid = Number(readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, "utf8").trim().split(/\s+/).find((pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("elected"); } catch { return false; } }));
  assert.ok(holderPid);
  const keyFile = join(privateRoot, "live-policy.key");
  let manifestPath = join(privateRoot, "manifest.json"), bootstrapPath = join(privateRoot, "bootstrap.json");
  writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  const state = stateFor(true);
  let manifest = { schemaVersion: 2, profileId: profile, appRoot: app, controller: identity(process.pid),
    election: { holder: identity(holderPid), lockFile: join(privateRoot, "controller.lock") }, generation: { sessionId: randomUUID(), generation: 1 },
    owningRuntime: { args: ["app-server", "--stdio"], home: owningHome },
    binary: { path: binary, version: "0.161.0", sha256: report.provenance.binarySha256 }, sandboxState: state,
    configFiles: [join(home, "config.toml"), join(owningHome, "config.toml")].map((path) => ({ path, sha256: hash(readFileSync(path)) })),
    components: { manager: report.provenance.acceptedManagerCommit, mobile: hash(readFileSync(fileURLToPath(import.meta.url))), agents: tree },
    privatePaths: { auth: [auth], controller: [privateRoot], caddy: [caddySocket, caddyConfig], daemon: [daemon] },
    keyFile, runtimeHome: home, environment: { PATH: "/usr/bin:/bin", HOME: home, TMPDIR: "/tmp" },
    commands: { "context-mode-call": { executable: node, sha256: digest(readFileSync(node)), args: [join(gestaltRoot, "live-context-worker.mjs"), "--runtime", runtime.root, "--workspace", app], timeoutMs: 120000 } },
  };
  const input = { schemaVersion: 1, manifestPath, consumer: { schemaVersion: 1, component: manifest.components.mobile, capabilities: ["suspension-v1"] }, workspaceRoot: app, packages, runtime, node: { path: node, sha256: digest(readFileSync(node)) }, plans: [plan], effectiveConfig: {
    plugins: packages.map(({ name, root: packageRoot }) => ({ name, root: packageRoot })),
    mcpServers: packages.map((p) => { const [name, config] = Object.entries(JSON.parse(readFileSync(join(p.root, ".mcp.json"))).mcpServers)[0]; return { name, ...config, cwd: p.root }; }), hooks: [], remoteMcp: [], executables: [],
  } };
  // Installer's public return contains schemaVersion; bootstrap runtime is exact.
  input.runtime = { root: runtime.root, sha256: runtime.sha256 };
  proofManifest = manifestPath;
  const save = () => writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  const saveInput = () => writeFileSync(bootstrapPath, JSON.stringify(input), { mode: 0o600 });
  saveInput(); save(); let config = stageAdmission(bootstrapPath);
  report.stage = "managed-owning-native-birth";
  const bootstrap = execFileSync(manager, ["cli", "--", "--live-policy-bootstrap", "--manifest", manifestPath], { cwd: app, env: managerEnvironment(admittedNode, home), timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(lstatSync(daemon).mode & 0o777, 0o700);
  let captured = managerApi("capture-runtime", manifestPath, "--capture-id", captureId);
  native = spawn(manager, ["cli", "--", "--live-policy-owning-runtime", "--manifest", manifestPath, "--capture-id", captureId], { cwd: app, env: managerEnvironment(admittedNode, home), stdio: ["pipe", "pipe", "pipe"] }); native.stderr.resume();
  let rpc = rpcClient(native);
  await rpc("initialize", { clientInfo: { name: "l10-packaged-v2", version: "2" }, capabilities: { experimentalApi: true } });
  native.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  let started = await rpc("thread/start", { cwd: app, permissions: profile, approvalPolicy: "never", model: "gpt-6-sol", modelProvider: "controlled" });
  assert.equal(started.activePermissionProfile.id, profile); assert.equal(started.cwd, app);
  assert.ok(started.instructionSources.includes(join(app, "AGENTS.md")));
  let configuration = await rpc("config/read", { cwd: app, includeLayers: true });
  assert.equal(configuration.config.features.hooks, false); assert.deepEqual(configuration.config.mcp_servers ?? {}, {}); assert.deepEqual(configuration.config.plugins ?? {}, {});
  assert.deepEqual(configuration.config.permissions[profile].filesystem, { glob_scan_max_depth: null, ...Object.fromEntries(state.permissionProfile.file_system.entries.map((entry) => [entry.path.type === "special" ? ":root" : entry.path.path, entry.access])) });
  assert.equal(configuration.config.permissions[profile].network.enabled, false);
  let preparedConfig = JSON.parse(readFileSync(config.configPath));
  for (const descriptor of Object.values(preparedConfig.mcpServers)) assert.deepEqual(descriptor.env, {});
  const resumePackaged = async () => {
    const unloaded = await rpc("thread/unsubscribe", { threadId: started.thread.id });
    assert.ok(["unsubscribed", "notSubscribed", "notLoaded"].includes(unloaded.status));
    const resumed = await rpc("thread/resume", { threadId: started.thread.id, excludeTurns: true,
      cwd: app, permissions: manifest.profileId, approvalPolicy: "never", model: "gpt-6-sol", modelProvider: "controlled",
      config: { mcp_servers: preparedConfig.mcpServers, plugins: {} } });
    assert.equal(resumed.thread.id, started.thread.id);
    return resumed;
  };
  const owningMcpStatus = async () => {
    const data = [];
    // The supported serverName+threadId API reuses the owning connection.
    // Broad discovery creates additional threadless MCP clients, which are not
    // evidence about the original owning thread and can race its single worker.
    for (const serverName of ["context-mode", "gestalt-org-plan"]) {
      const page = await rpc("mcpServerStatus/list", { threadId: started.thread.id, serverName, detail: "full" }, 125000);
      assert.equal(page.nextCursor, null);
      assert.deepEqual(page.data.map((server) => server.name), [serverName]);
      data.push(...page.data);
    }
    return { data, nextCursor: null };
  };
  await rpc("thread/name/set", { threadId: started.thread.id, name: "Packaged MCP environment proof" });
  // Production first configures the exact descriptors while admission is still
  // closed, then seals the resolved Native sources before reconnecting them.
  report.stage = "native-packaged-preseal-reconfigure";
  started = await resumePackaged();
  // Production's post-reconfigure observation awaits full MCP discovery before
  // sealing. Observe the terminal refusal here too: an asynchronously starting
  // old proxy must not acquire newly published receipts during the cold resume.
  const unadmitted = await owningMcpStatus();
  assert.equal(unadmitted.nextCursor, null);
  assert.deepEqual(unadmitted.data.map((server) => server.name).sort(), ["context-mode", "gestalt-org-plan"]);
  for (const server of unadmitted.data) {
    assert.equal(server.runtimeStatus, "failed");
    assert.equal(Object.keys(server.tools).length, 0);
  }
  report.checks.unadmittedNativeMcpRefused = true;
  const observationModule = realpathSync(process.env.LIVE_HOST_RENEWAL_MODULE);
  assert.equal(hash(readFileSync(observationModule)), "0c8f5ed9eec2960d18cbc248555ab2a46bb4dc6cca7517f7dc9d219c9507d2a8");
  const { controlledObservation, quiesceNative } = await import(pathToFileURL(observationModule).href);
  report.provenance.renewalHelperSha256 = hash(readFileSync(observationModule));
  async function sealCurrent() {
    configuration = await rpc("config/read", { cwd: app, includeLayers: true });
    assert.deepEqual(configuration.config.permissions[manifest.profileId].filesystem, { glob_scan_max_depth: null, ...Object.fromEntries(manifest.sandboxState.permissionProfile.file_system.entries.map((entry) => [entry.path.type === "special" ? ":root" : entry.path.path, entry.access])) });
    assert.equal(configuration.config.permissions[manifest.profileId].network.enabled, false);
    assert.equal(started.activePermissionProfile.id, manifest.profileId);
    const pins = new Map(manifest.configFiles.map((file) => [file.path, file])), sources = [];
    for (const layer of configuration.layers) {
      assert.equal(typeof layer.version, "string");
      const name = layer.name;
      if (name.type === "sessionFlags") continue;
      if (name.type === "project") { assert.ok(metadata.includes(name.dotCodexFolder)); assert.deepEqual(layer.config, {}); continue; }
      assert.ok(["user", "system", "packagedDefaults", "legacyManagedConfigTomlFromFile"].includes(name.type));
      if (!existsSync(name.file)) { assert.deepEqual(layer.config, {}); assert.ok(["/etc/codex/config.toml", "/etc/codex/managed_config.toml", "/etc/codex/requirements.toml"].includes(name.file)); continue; }
      assert.ok(pins.has(name.file)); sources.push({ kind: "file", role: name.type === "user" ? "user" : name.type === "system" ? "system" : name.type === "packagedDefaults" ? "packaged-defaults" : "managed", ...pins.get(name.file) });
    }
    sources.push({ kind: "file", role: "sandbox-worker", ...pins.get(join(manifest.runtimeHome, "config.toml")) });
    const birth = JSON.parse(readFileSync(join(dirname(manifestPath), `birth-${captureId}.json`))).body;
    const filePin = (path) => { const i = lstatSync(path); return { sha256: hash(readFileSync(path)), identity: { dev: i.dev, ino: i.ino, uid: i.uid, mode: i.mode, ctime: i.ctimeMs, mtime: i.mtimeMs } }; };
    for (const item of birth.directories) {
      if (!existsSync(item.path)) { sources.push({ kind: "absent", role: "project", path: item.path }); continue; }
      const i = lstatSync(item.path); sources.push({ kind: "directory", role: "project", path: item.path, identity: { dev: i.dev, ino: i.ino, uid: i.uid, mode: i.mode, ctime: i.ctimeMs, mtime: i.mtimeMs, birthtime: i.birthtimeMs } });
    }
    for (const path of ["/etc/codex/config.toml", "/etc/codex/managed_config.toml", "/etc/codex/requirements.toml"]) sources.push({ kind: "absent", role: "system", path });
    for (const path of started.instructionSources) sources.push({ kind: "instruction", path, ...filePin(path) });
    for (const [path, pin] of Object.entries(birth.instructions)) if (pin && !started.instructionSources.includes(path)) sources.push({ kind: "instruction-candidate", path, ...pin });
    const account = await rpc("account/read", { refreshToken: false });
    const observation = controlledObservation(configuration, started, account);
    const flags = observation.sessionFlags;
    const sourceInventory = { schemaVersion: 2, runtime: identity(native.pid), policyDigest: captured.policyDigest, effectiveConfigDigest: hash(stable(configuration.config)), sessionFlagsDigest: hash(stable(flags)), sources, observation };
    const sourcePath = join(dirname(manifestPath), "sources.json"); writeFileSync(sourcePath, JSON.stringify(sourceInventory), { mode: 0o600 });
    managerApi("seal-runtime", manifestPath, "--capture-id", captureId, "--runtime-pid", String(native.pid), "--sources", sourcePath);
    manifest.runtimeProvenance = { captureId, effectiveConfigDigest: sourceInventory.effectiveConfigDigest, sessionFlagsDigest: sourceInventory.sessionFlagsDigest };
    save();
    return { inventoryDigest: hash(stable(sourceInventory)), accountDigest: observation.accountDigest, generation: structuredClone(manifest.generation), runtime: identity(native.pid), kinds: sources.map((source) => source.kind) };
  }
  report.sources = await sealCurrent();
  report.checks.verifiedV2OriginalRuntimeAndCompleteSources = true;
  const inventory = () => { manifest.configFiles = [join(manifest.runtimeHome, "config.toml"), join(owningHome, "config.toml"), bootstrapPath, config.configPath].map((path) => ({ path, sha256: hash(readFileSync(path)) })); };
  const prepare = () => { inventory(); save(); assert.equal(managerApi("prepare", manifestPath).available, true); assert.equal(prepareAdmission(bootstrapPath).available, true); };
  prepare();
  report.stage = "native-launched-packaged-mcp-initialize";
  // Resume the same original Native thread through its supported API. Native's
  // real stdio launcher inherits Manager's TMPDIR=/tmp, unlike a direct proxy
  // fixture. No wrapper or descriptor environment override removes that default.
  const connectCurrent = async () => {
    const catalogStarted = Date.now();
    started = await resumePackaged();
    const sealed = JSON.parse(readFileSync(join(dirname(manifestPath), "sources.json")));
    const currentConfiguration = await rpc("config/read", { cwd: app, includeLayers: true });
    const currentObservation = controlledObservation(currentConfiguration, started, await rpc("account/read", { refreshToken: false }));
    assert.deepEqual(currentObservation, sealed.observation);
    assert.equal(hash(stable(currentConfiguration.config)), sealed.effectiveConfigDigest);
    let nativeMcp;
    for (let attempt = 0; attempt < 30; attempt++) {
      nativeMcp = await owningMcpStatus();
      const states = nativeMcp.data.map((server) => server.runtimeStatus);
      if (!states.includes("starting")) break;
      await wait(1000);
    }
    report.nativeCatalogDurationMs = Date.now() - catalogStarted;
    assert.equal(nativeMcp.nextCursor, null);
    assert.deepEqual(nativeMcp.data.map((server) => server.name).sort(), ["context-mode", "gestalt-org-plan"]);
    report.nativeMcp = nativeMcp.data.map((server) => ({ name: server.name, runtimeStatus: server.runtimeStatus,
      toolCount: Object.keys(server.tools ?? {}).length,
      errorMarkers: ["closed", "initialize", "spawn", "permission", "protocol", "deserialize", "invalid", "timeout", "timed out", "missing", "schema", "parse", "context-call-unavailable", "invalid-native-response", "native-policy-unavailable", "unsupported-live-method", "-32000"].filter((word) => server.toolsError?.toLowerCase().includes(word)) }));
    for (const server of nativeMcp.data) {
      assert.equal(server.runtimeStatus, "connected");
      assert.equal(server.httpOrigin, null);
      assert.equal(server.toolsError, null);
      assert.ok(Object.keys(server.tools).length > 0);
    }
    return { durationMs: Date.now() - catalogStarted, servers: report.nativeMcp };
  };
  report.originalCatalog = await connectCurrent();
  report.checks.actualNativeLaunchedPackagedMcpInitialization = true;
  const proxy = (name) => {
    const descriptor = preparedConfig.mcpServers[name];
    const child = spawn(descriptor.command, descriptor.args, { cwd: descriptor.cwd,
      env: { PATH: "/usr/bin:/bin", HOME: owningHome, LANG: "C.UTF-8", TMPDIR: "/tmp" }, stdio: ["pipe", "pipe", "pipe"] });
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
  const text = (response) => {
    if (response.result?.isError) {
      const message = (response.result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
      report.toolFailure = { bytes: Buffer.byteLength(message), errno: [...new Set(message.match(/\b(?:EACCES|EPERM|ENOENT|ENOTDIR|EROFS|EINVAL|EAGAIN)\b/g) ?? [])],
        procSubstitution: /\/dev\/fd|\/proc\/self\/fd/.test(message), permissionDenied: /Permission denied|Operation not permitted/.test(message),
        timedOut: /[Tt]imed? ?out|[Tt]imeout/.test(message), runtimeMissing: /runtime.*(?:found|available|installed)|command not found|not found.*runtime/i.test(message),
        templates: message.split("\n").filter((line) => /Error:|error:|denied|not found|errno|failed|exit code|Unable|Cannot/i.test(line)).slice(0, 4).map((line) => line.replace(/\/[^\s:;)]+/g, "<path>").replace(/"[^"]*"|'[^']*'/g, "<quoted>").slice(0, 240)) };
    }
    assert.equal(response.error, undefined); assert.equal(response.result?.isError, undefined); return response.result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n"); };
  report.stage = "native-packaged-ordinary";
  report.stage = "packaged-context-initialize";
  const initialized = await contextClient.request(++sequence, "initialize", {}); assert.equal(initialized.error, undefined);
  report.stage = "packaged-org-initialize";
  const orgInitialized = await orgClient.request(++sequence, "initialize", {}); assert.equal(orgInitialized.error, undefined);
  report.stage = "packaged-context-list";
  const list = await contextClient.request(++sequence, "tools/list", {});
  assert.equal(list.error, undefined); const names = list.result.tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, 7); assert.ok(names.includes("ctx_execute")); assert.ok(!names.includes("ctx_doctor"));
  report.stage = "packaged-context-execute";
  assert.match(text(await call("ctx_execute", { language: "javascript", code: 'console.log("ordinary-live-work")' })), /^ordinary-live-work$/m);
  assert.match(text(await call("ctx_execute", { language: "shell", code: 'printf "ordinary-shell-work\\n"' })), /^ordinary-shell-work$/m);
  assert.match(text(await call("ctx_execute_file", { path: publicFile, language: "javascript", code: 'console.log(FILE_CONTENT)' })), /^ordinary-public$/m);
  report.checks.ordinaryInstalledContextTools = true;
  report.stage = "native-private-denial";
  const probes = { publicFile, auth, manifestPath, bootstrapPath, keyFile, caddyConfig, controlSocket, caddySocket, daemon,
    authIdentity: { dev: lstatSync(auth).dev, ino: lstatSync(auth).ino },
    aliases: [`/proc/${process.pid}/root${auth}`, `/proc/self/root${auth}`, `/proc/${process.pid}/fd/${authFd}`] };
  // This exact program runs in the packaged interpreter, child and grandchild.
  async function packagedProbe(p, depth) {
    const fs = require("node:fs"), net = require("node:net"), cp = require("node:child_process");
    const denied = (path) => { try { fs.readFileSync(path); return false; } catch (e) { return ["EPERM", "EACCES", "ENOENT", "ENOTDIR", "EISDIR"].includes(e.code); } };
    const socketDenied = (path) => new Promise((done) => { const peer = net.createConnection(path); let ended = false; const end = (value) => { if (ended) return; ended = true; clearTimeout(timer); peer.destroy(); done(value); }; const timer = setTimeout(() => end(false), 1000); peer.on("connect", () => end(false)); peer.on("error", (e) => end(["EPERM", "EACCES", "ENOENT", "ENOTDIR"].includes(e.code))); });
    const checks = { publicRead: fs.readFileSync(p.publicFile, "utf8") === "ordinary-public", privateFiles: [p.auth, p.manifestPath, p.bootstrapPath, p.keyFile, p.caddyConfig].every(denied), procFD: p.aliases.every(denied), controllerSocket: await socketDenied(p.controlSocket), caddySocket: await socketDenied(p.caddySocket), daemonMask: (fs.lstatSync(p.daemon).mode & 511) === 0, ordinaryCommand: cp.spawnSync("/usr/bin/true", [], { stdio: "ignore" }).status === 0, noCredentials: !Object.keys(process.env).some((k) => /TOKEN|SECRET|API_KEY|ORG_PLAN/.test(k)), noInheritedPrivateFD: true };
    for (let fd = 3; fd < 128; fd++) { try { const i = fs.fstatSync(fd); if (i.dev === p.authIdentity.dev && i.ino === p.authIdentity.ino) checks.noInheritedPrivateFD = false; } catch {} }
    try { fs.readdirSync(p.daemon); checks.daemon = false; } catch (e) { checks.daemon = ["EACCES", "EPERM", "ENOENT"].includes(e.code); }
    if (p.narrowFile) {
      try { fs.writeFileSync(p.narrowFile, "unsafe"); checks.narrowedWrite = false; }
      catch (e) { checks.narrowedWrite = ["EACCES", "EPERM", "EROFS"].includes(e.code); }
    }
    const server = net.createServer();
    checks.restrictedNetwork = await new Promise((done) => { server.once("error", (e) => done(["EACCES", "EPERM"].includes(e.code))); server.listen(0, "127.0.0.1", () => server.close(() => done(false))); });
    console.log("LIVE_PROBE:" + JSON.stringify({ depth, checks }));
    if (depth < 2) {
      const child = cp.spawnSync(process.execPath, ["-e", `(${packagedProbe.toString()})(${JSON.stringify(p)},${depth + 1})`], { stdio: ["ignore", "inherit", "inherit"], timeout: 10000 });
      if (child.status !== 0) throw Error("DESCENDANT_PROBE_FAILED");
    }
  }
  const output = text(await call("ctx_execute", { language: "javascript", code: `(${packagedProbe.toString()})(${JSON.stringify(probes)},0)` }));
  const denial = output.split("\n").filter((line) => line.startsWith("LIVE_PROBE:")).map((line) => JSON.parse(line.slice(11)));
  assert.deepEqual(denial.map((item) => item.depth), [0, 1, 2]);
  assert.ok(denial.every((item) => Object.values(item.checks).every(Boolean))); assert.equal(controllerConnections, 0); report.checks.privateNativeDenials = denial;
  report.stage = "typed-org-lifecycle";
  const lifecycle = await orgClient.request(++sequence, "tools/call", { name: "org_plan_l1_transition", arguments: { plan, id: "first-outcome", state: "WIP" } });
  assert.equal(lifecycle.error, undefined); assert.match(readFileSync(plan, "utf8"), /^\* WIP/m);
  const escape = await orgClient.request(++sequence, "tools/call", { name: "org_plan_validate", arguments: { plan: auth } });
  assert.equal(escape.error.message, "unadmitted-lifecycle-plan"); report.checks.typedOrgLifecycleScope = true;
  const originalPlan = readFileSync(join(repo, "tests/plugins/gestalt/fixtures/valid-minimal.org"), "utf8");
  const header = originalPlan.slice(0, originalPlan.indexOf("* TODO")), block = originalPlan.slice(originalPlan.indexOf("* TODO"));
  writeFileSync(plan, header + block.replaceAll("TODO", "DONE").replace("UNREVIEWED", "REVIEWED") + block.replaceAll("first-", "second-").replaceAll("TODO", "WIP"));
  const lifecycleCall = (name, args) => orgClient.request(++sequence, "tools/call", { name, arguments: { plan, ...args } });
  assert.equal((await lifecycleCall("org_plan_suspend_reopen", { dependentId: "second-outcome", dependencyId: "first-outcome" })).error, undefined);
  assert.match(readFileSync(plan, "utf8"), /\* SUSPENDED/);
  assert.ok((await lifecycleCall("org_plan_resume", { id: "second-outcome" })).error);
  assert.equal((await lifecycleCall("org_plan_l1_transition", { id: "first-outcome", state: "DONE" })).error, undefined);
  assert.equal((await lifecycleCall("org_plan_review_transition", { id: "first-outcome", state: "REVIEWED" })).error, undefined);
  assert.equal((await lifecycleCall("org_plan_resume", { id: "second-outcome" })).error, undefined);
  assert.doesNotMatch(readFileSync(plan, "utf8"), /SUSPENDED/);
  assert.equal(process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES, undefined);
  report.checks.controllerAuthenticatedSuspensionWithoutAmbientExport = true;
  report.stage = "forged-missing-state";
  const receiptPath = join(privateRoot, "admission-receipt.json"), receipt = readFileSync(receiptPath);
  writeFileSync(receiptPath, '{}', { mode: 0o600 }); assert.equal(verifyAdmission(bootstrapPath).available, false);
  assert.ok((await call("ctx_execute", { language: "shell", code: "true" })).error);
  rmSync(receiptPath); assert.equal(verifyAdmission(bootstrapPath).available, false);
  writeFileSync(receiptPath, receipt, { mode: 0o600 });
  const originalState = manifest.sandboxState; delete manifest.sandboxState; save(); assert.equal(verifyAdmission(bootstrapPath).available, false); manifest.sandboxState = originalState; prepare();
  report.checks.forgedMissingStateRefused = true;
  report.stage = "installed-byte-revocation";
  const runtimeFile = join(runtime.root, "package.json"), bytes = readFileSync(runtimeFile);
  writeFileSync(runtimeFile, `${bytes}\n`); assert.equal(verifyAdmission(bootstrapPath).available, false); writeFileSync(runtimeFile, bytes);
  assert.equal(verifyAdmission(bootstrapPath).available, true); report.checks.installedByteChangesInvalidateAdmission = true;
  assert.equal(await caddyAlive(), true); assert.equal(lstatSync(daemon).mode & 0o777, 0o700); assert.equal(readFileSync(auth, "utf8"), "private-auth-fixture");
  // Archive a generation only after its last prepared policy. No archived
  // manifest, bootstrap or source receipt is changed by the renewal proof.
  const archive = () => ({ manifestPath, bootstrapPath, captureId, value: structuredClone(manifest),
    config: structuredClone(preparedConfig), receipt: readFileSync(join(dirname(manifestPath), "admission-receipt.json")),
    inventory: readFileSync(join(dirname(manifestPath), "sources.json")),
    bytes: hash(readFileSync(manifestPath)) });
  const original = archive(), originalBirth = identity(native.pid), generations = [original];
  const oldRefused = async (old) => {
    assert.equal(hash(readFileSync(old.manifestPath)), old.bytes);
    assert.equal(verifyAdmission(old.bootstrapPath).available, false);
    assert.throws(() => prepareAdmission(old.bootstrapPath));
    for (const operation of ["verify", "prepare"]) {
      assert.throws(() => managerApi(operation, old.manifestPath), (error) => {
        const result = JSON.parse(error.stdout); return result.available === false && result.reason === "revoked-runtime-provenance";
      });
    }
    const result = await liveRequest(old.bootstrapPath, "gestalt-org-plan", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "org_plan_validate", arguments: { plan } } }));
    assert.ok(result.error);
    const descriptor = old.config.mcpServers["gestalt-org-plan"];
    const restarted = spawn(descriptor.command, descriptor.args, { cwd: descriptor.cwd,
      env: { PATH: "/usr/bin:/bin", HOME: owningHome, LANG: "C.UTF-8", TMPDIR: "/tmp" }, stdio: "ignore" });
    await until(() => restarted.exitCode !== null); assert.equal(restarted.exitCode, 78);
  };
  const owningCall = async (server, tool, args) => {
    const result = await rpc("mcpServer/tool/call", { threadId: started.thread.id, server, tool, arguments: args }, 125000);
    assert.notEqual(result.isError, true); return result;
  };
  // Use the actual owning Native connection for both tools and all three
  // interpreter depths. The API above cannot silently create threadless clients.
  await owningCall("gestalt-org-plan", "org_plan_validate", { plan });
  const originalWork = text({ result: await owningCall("context-mode", "ctx_execute", { language: "javascript", code: `(${packagedProbe.toString()})(${JSON.stringify(probes)},0)` }) });
  const originalChecks = originalWork.split("\n").filter((line) => line.startsWith("LIVE_PROBE:")).map((line) => JSON.parse(line.slice(11)));
  assert.deepEqual(originalChecks.map((item) => item.depth), [0, 1, 2]);
  assert.ok(originalChecks.every((item) => Object.values(item.checks).every(Boolean)));
  report.originalOwningToolChecks = originalChecks;
  report.checks.actualOwningNativePackagedTools = true;
  report.renewal = { generations: [], quiescence: [], oldAuthorityChecks: 0,
    narrowedSurface: "Existing project subdirectory write-to-read; project-local context storage remains writable." };
  const dead = (record) => { try { return identity(record.pid).birth !== record.birth; } catch { return true; } };
  const descendants = (parent) => {
    const result = [];
    for (const raw of readFileSync(`/proc/${parent}/task/${parent}/children`, "utf8").trim().split(/\s+/).filter(Boolean)) {
      const pid = Number(raw); try { result.push(identity(pid), ...descendants(pid)); } catch {}
    }
    return result;
  };
  const revokeAndQuiesce = async () => {
    managerApi("revoke-runtime", manifestPath, "--capture-id", captureId);
    report.renewal.quiescence.push(await quiesceNative(rpc, [started.thread.id]));
    for (const old of generations) { await oldRefused(old); report.renewal.oldAuthorityChecks++; }
  };
  const nextGeneration = (previous) => {
    const directory = join(privateRoot, `renewal-${randomUUID()}`); mkdirSync(directory, { mode: 0o700 });
    const worker = join(directory, "worker"); mkdirSync(worker, { mode: 0o700 });
    writeFileSync(join(worker, "config.toml"), '[shell_environment_policy]\ninherit = "none"\n', { mode: 0o600 });
    manifest = structuredClone(previous.value); manifest.generation.generation++; manifest.profileId = narrowProfile;
    manifest.sandboxState = stateFor(false); manifest.runtimeHome = worker; manifest.environment.HOME = worker; delete manifest.runtimeProvenance;
    manifest.configFiles = [join(worker, "config.toml"), join(owningHome, "config.toml")].map((path) => ({ path, sha256: hash(readFileSync(path)) }));
    manifestPath = join(directory, "manifest.json"); bootstrapPath = join(directory, "bootstrap.json"); captureId = randomUUID();
    proofManifest = manifestPath; input.manifestPath = manifestPath; saveInput(); save(); config = stageAdmission(bootstrapPath);
    preparedConfig = JSON.parse(readFileSync(config.configPath));
    for (const descriptor of Object.values(preparedConfig.mcpServers)) assert.deepEqual(descriptor.env, {});
  };
  const freshAdmission = async (mode) => {
    started = await resumePackaged();
    assert.equal(started.activePermissionProfile.id, narrowProfile);
    const preseal = await owningMcpStatus();
    for (const server of preseal.data) { assert.equal(server.runtimeStatus, "failed"); assert.equal(Object.keys(server.tools).length, 0); }
    const source = await sealCurrent(); prepare();
    const receiptPath = join(dirname(manifestPath), "admission-receipt.json"), currentReceipt = readFileSync(receiptPath);
    // A genuine signed previous receipt is still unusable with the new policy.
    for (const old of generations) {
      writeFileSync(receiptPath, old.receipt); assert.equal(verifyAdmission(bootstrapPath).available, false);
      writeFileSync(receiptPath, currentReceipt);
      await oldRefused(old); report.renewal.oldAuthorityChecks++;
    }
    assert.equal(verifyAdmission(bootstrapPath).available, true);
    const catalog = await connectCurrent();
    const probe = { ...probes, manifestPath, bootstrapPath, narrowFile };
    const response = await owningCall("context-mode", "ctx_execute", { language: "javascript", code: `(${packagedProbe.toString()})(${JSON.stringify(probe)},0)` });
    const checks = text({ result: response }).split("\n").filter((line) => line.startsWith("LIVE_PROBE:")).map((line) => JSON.parse(line.slice(11)));
    assert.deepEqual(checks.map((item) => item.depth), [0, 1, 2]); assert.ok(checks.every((item) => Object.values(item.checks).every(Boolean)));
    const taskState = mode === "survivor" ? "DONE" : "WIP";
    await owningCall("gestalt-org-plan", "org_plan_l2_transition", { plan, id: "second-task", state: taskState });
    assert.ok(readFileSync(plan, "utf8").includes(`** ${taskState} [#A] First task\n:PROPERTIES:\n:ID: second-task\n`));
    await assert.rejects(rpc("mcpServer/tool/call", { threadId: started.thread.id, server: "gestalt-org-plan", tool: "org_plan_validate", arguments: { plan: auth } }, 30000), /NATIVE_RPC_REFUSED/);
    // Native's own command path also observes the same named restriction.
    const command = await rpc("command/exec", { cwd: app, permissionProfile: narrowProfile,
      command: ["/usr/bin/python3", "-c", `from pathlib import Path\np=Path(${JSON.stringify(narrowFile)})\ntry:p.write_text('unsafe');raise Exception('WRITE_BREACH')\nexcept OSError as e:assert e.errno in (1,13,30)\nprint('WRITE_DENIED')`], timeoutMs: 10000, outputBytesCap: 1024 });
    assert.equal(command.exitCode, 0); assert.match(command.stdout, /WRITE_DENIED/); assert.equal(readFileSync(narrowFile, "utf8"), "original");
    const managedImage = existsSync(join(dirname(manifestPath), `image-${captureId}.json`));
    if (mode === "replacement") assert.equal(managedImage, true);
    report.renewal.generations.push({ mode, source, catalog, checks, authenticatedLifecycle: true, lifecycleState: taskState, nativeCommandNarrowed: true,
      bootstrapDigest: hash(readFileSync(bootstrapPath)), receiptDigest: hash(currentReceipt), manifestDigest: hash(readFileSync(manifestPath)),
      managedImage });
    generations.push(archive());
  };
  report.stage = "renewal-original-drainage";
  const marker = join(app, "descendant-marker"), heartbeat = join(app, "heartbeat.txt"), descendant = join(app, "descendant.mjs");
  writeFileSync(descendant, `import fs from 'node:fs';process.on('SIGTERM',()=>{});setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),100);`);
  const inFlight = call("ctx_execute", { language: "javascript", timeout: 60000, code: `const cp=require('node:child_process');cp.spawn(process.execPath,[${JSON.stringify(descendant)},${JSON.stringify(marker)}],{detached:true,stdio:'inherit'});setInterval(()=>{},1000);` });
  await until(() => existsSync(heartbeat));
  const markerProcesses = () => readdirSync('/proc').filter((pid) => /^\d+$/.test(pid)).filter((pid) => { try { return readFileSync(`/proc/${pid}/cmdline`).toString().split('\0').includes(marker); } catch { return false; } });
  const originalDescendants = markerProcesses().map((pid) => identity(Number(pid))); assert.ok(originalDescendants.length > 0);
  managerApi("revoke-runtime", manifestPath, "--capture-id", captureId);
  assert.ok((await inFlight).error); await until(() => originalDescendants.every(dead) && markerProcesses().length === 0);
  assert.ok((await orgClient.request(++sequence, "tools/call", { name: "org_plan_validate", arguments: { plan } })).error);
  await close(contextProxy); await close(orgProxy);
  report.renewal.quiescence.push(await quiesceNative(rpc, [started.thread.id]));
  assert.deepEqual(identity(native.pid), originalBirth); await oldRefused(original);
  report.checks.revocationReapsDetachedDescendants = true;
  report.stage = "renewal-survivor";
  nextGeneration(original);
  captured = managerApi("renew-runtime", manifestPath, "--capture-id", captureId, "--previous-manifest", original.manifestPath, "--previous-capture-id", original.captureId, "--mode", "survivor");
  await freshAdmission("survivor"); assert.deepEqual(identity(native.pid), originalBirth);
  report.checks.actualOriginalSurvivorPackagedRenewal = true;
  report.stage = "renewal-replacement-drainage";
  await revokeAndQuiesce();
  const oldOwned = descendants(native.pid); await close(native);
  assert.ok(dead(originalBirth)); await until(() => oldOwned.every(dead));
  report.renewal.replacementOldOwner = { process: originalBirth, descendants: oldOwned, allExited: true };
  const survivor = generations.at(-1); nextGeneration(survivor);
  report.stage = "renewal-managed-replacement";
  captured = managerApi("renew-runtime", manifestPath, "--capture-id", captureId, "--previous-manifest", survivor.manifestPath, "--previous-capture-id", survivor.captureId, "--mode", "replacement");
  native = spawn(manager, ["cli", "--", "--live-policy-owning-runtime", "--manifest", manifestPath, "--capture-id", captureId], { cwd: app, env: managerEnvironment(admittedNode, home), stdio: ["pipe", "pipe", "pipe"] }); native.stderr.resume();
  rpc = rpcClient(native);
  await rpc("initialize", { clientInfo: { name: "l10-packaged-renewal", version: "2" }, capabilities: { experimentalApi: true } });
  native.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  assert.notDeepEqual(identity(native.pid), originalBirth);
  await freshAdmission("replacement"); report.checks.actualManagedReplacementPackagedRenewal = true;
  report.stage = "renewal-final-revocation";
  await revokeAndQuiesce();
  report.processLaunches = generations.flatMap((generation) => readdirSync(dirname(generation.manifestPath)).filter((name) => /^process-[a-f0-9-]+\.json$/.test(name)).map((name) => {
    const record = JSON.parse(readFileSync(join(dirname(generation.manifestPath), name))).body;
    return { launchId: record.launchId, status: record.status, commandId: record.commandId, process: record.process, termination: record.termination, policyDigest: record.policy.policyDigest };
  }));
  assert.ok(report.processLaunches.length >= 15); assert.ok(report.processLaunches.every((launch) => launch.status === "exited"));
  assert.equal(new Set(report.processLaunches.map((launch) => launch.launchId)).size, report.processLaunches.length);
  report.checks.noPersistentWorkerReuse = true; report.checks.hostAuthorityPreserved = true;
  report.checks.oldGenerationAndReceiptPermanentlyRefused = true;
  assert.equal(await caddyAlive(), true); assert.equal(controllerConnections, 0);
  report.checks.revocationInvalidatesOldProxyAndRestart = true; assert.equal(modelRequests, 0); report.checks.noModelOrProviderCredentialWork = true; report.stage = "complete"; report.passed = true;
} catch (error) {
  report.failure = /^[A-Z_]{1,64}$/.test(error.message) ? error.message : "PROOF_ASSERTION_FAILED";
  report.failureDetails = { stage: report.stage, operator: error.operator, code: error.code,
    actual: typeof error.actual === "boolean" || typeof error.actual === "number" ? error.actual : undefined,
    boundedActualReason: typeof error.actual?.message === "string" && /^[a-z-]{1,64}$/.test(error.actual.message) ? error.actual.message : undefined,
    rpc: error.rpc };
  if (proofManifest) {
    try { report.managerCurrent = managerApi("verify", proofManifest); } catch (failure) { try { const value = JSON.parse(failure.stdout); report.managerCurrent = { available: value.available, reason: value.reason }; } catch {} }
    report.failedLaunches = readdirSync(privateRoot).filter((name) => /^process-[a-f0-9-]+\.json$/.test(name)).map((name) => { const b = JSON.parse(readFileSync(join(privateRoot, name))).body; return { launchId: b.launchId, status: b.status, termination: b.termination, failure: b.failure }; });
  }
  process.exitCode = 1;
} finally {
  activeAbort?.abort();
  await close(contextProxy); await close(orgProxy);
  await close(native); await close(caddy);
  await elected?.close();
  if (provider?.listening) await new Promise((done) => provider.close(done));
  if (authFd !== undefined) closeSync(authFd);
  if (socketServer) await new Promise((done) => socketServer.close(done));
  mkdirSync(evidence, { recursive: true }); writeFileSync(join(evidence, "native-proof.json"), `${JSON.stringify(report, null, 2)}\n`);
  rmSync(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ passed: report.passed, stage: report.stage, checks: Object.keys(report.checks), failure: report.failure })}\n`);
}
