/** Controller-only Live admission. Never import this from an untrusted MCP worker. */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const LIVE_SERVERS = Object.freeze(["context-mode", "gestalt-org-plan"]);
export const UNAVAILABLE_WORKFLOWS = Object.freeze([
  "project-codex-configuration", "remote-mcp", "additional-plugins", "hooks",
  "ambient-executables", "persistent-native-workers", "credential-dependent-tools",
  "context-mode-maintenance", "context-mode-network-fetch",
]);
const LIMIT = 262144;
const HASH = /^[a-f0-9]{64}$/;
export class AdmissionError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const fail = (reason) => { throw new AdmissionError(reason); };
export const stable = (value) => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
  return value;
}
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (root, path) => path === root || path.startsWith(`${root === "/" ? "" : root}/`);
/** Manager's shell dispatch needs `node` on its host PATH. The native launch
 * environment remains the fixed L9 environment. Never use the caller's PATH.
 */
export function managerEnvironment(node, runtimeHome) {
  canonical(node.path);
  const directory = canonical(dirname(node.path), true);
  if (basename(node.path) !== "node" || !(lstatSync(node.path).mode & 0o111)
    || !HASH.test(node.sha256) || digest(readFileSync(node.path)) !== node.sha256) fail("interpreter-unavailable");
  // A separate interpreter directory cannot add other host utility aliases.
  if (directory !== "/usr/bin" && stable(readdirSync(directory).sort()) !== stable(["node"])) fail("untrusted-interpreter-directory");
  return { PATH: [...new Set([directory, "/usr/bin", "/bin"])].join(":"), HOME: runtimeHome, LANG: "C.UTF-8" };
}
function exact(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== "object" || stable(Object.keys(value).sort()) !== stable([...keys].sort())) fail("invalid-admission-input");
}
function canonical(path, directory = false, privateMode = false) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) fail("untrusted-path");
  const stat = lstatSync(path);
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail("untrusted-path");
  if (stat.uid !== process.getuid() && stat.uid !== 0) fail("untrusted-owner");
  if (stat.mode & (privateMode ? 0o077 : 0o022)) fail("untrusted-mode");
  for (let ancestor = dirname(path); ; ancestor = dirname(ancestor)) {
    const info = lstatSync(ancestor);
    // Sticky /tmp is permissible; a non-sticky replaceable ancestor is not.
    if (info.isSymbolicLink() || (info.mode & 0o022) && !(info.mode & 0o1000)) fail("untrusted-ancestor");
    if (ancestor === "/") break;
  }
  return path;
}
function boundedJson(path) {
  if (lstatSync(path).size > LIMIT) fail("oversized-admission-input");
  return JSON.parse(readFileSync(path, "utf8"));
}
function protectedPath(path, manifest) {
  for (const entry of manifest.sandboxState?.permissionProfile?.file_system?.entries ?? []) {
    if (entry.access !== "write") continue;
    const root = entry.path?.type === "path" ? entry.path.path
      : entry.path?.value?.kind === "root" ? "/"
      : entry.path?.value?.kind === "slash_tmp" ? "/tmp" : null;
    if (!root || inside(root, path)) fail("project-writable-admission");
  }
}
/** Complete, bounded installed-byte inventory; symlinks and special files fail closed. */
export function measureTree(root) {
  canonical(root, true);
  const files = [];
  let bytes = 0;
  function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), info = lstatSync(path);
      if (info.isSymbolicLink()) fail("package-symlink");
      if (info.isDirectory()) { if (info.mode & 0o022) fail("untrusted-package-directory"); walk(path); continue; }
      if (!info.isFile() || info.mode & 0o022) fail("untrusted-package-file");
      bytes += info.size;
      if (files.length >= 20000 || bytes > 512 * 1024 * 1024) fail("oversized-package");
      files.push([relative(root, path).split(sep).join("/"), info.mode & 0o777, digest(readFileSync(path))]);
    }
  }
  walk(root);
  return digest(stable(files));
}
function readBootstrap(path) {
  canonical(path, false, true);
  const input = boundedJson(path);
  exact(input, ["schemaVersion", "manifestPath", "workspaceRoot", "packages", "runtime", "node", "effectiveConfig", "plans"]);
  if (input.schemaVersion !== 1) fail("unsupported-admission-version");
  canonical(input.manifestPath, false, true);
  const manifest = boundedJson(input.manifestPath);
  canonical(dirname(input.manifestPath), true, true);
  if (!inside(dirname(input.manifestPath), path)) fail("untrusted-bootstrap-storage");
  protectedPath(dirname(input.manifestPath), manifest);
  protectedPath(path, manifest);
  const filesystem = manifest.sandboxState?.permissionProfile?.file_system;
  if (manifest.schemaVersion !== 1 || manifest.sandboxState?.permissionProfile?.type !== "managed" || manifest.sandboxState?.permissionProfile?.network !== "restricted"
    || filesystem?.type !== "restricted" || !Array.isArray(filesystem.entries) || !filesystem.entries.length) fail("incompatible-native-policy");
  canonical(manifest.appRoot, true);
  canonical(input.workspaceRoot, true);
  if (!inside(input.workspaceRoot, manifest.appRoot) || input.workspaceRoot === "/") fail("invalid-lifecycle-scope");
  for (let ancestor = manifest.appRoot; ; ancestor = dirname(ancestor)) {
    // Do not parse or hide a project configuration. Its presence is unsupported.
    try { lstatSync(join(ancestor, ".codex")); fail("project-config-unavailable"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (ancestor === "/") break;
  }
  if (!Array.isArray(input.packages) || input.packages.length !== 2) fail("unknown-plugin");
  const packages = new Map();
  for (const item of input.packages) {
    exact(item, ["name", "root", "sha256"]);
    if (!["gestalt", "context-mode"].includes(item.name) || packages.has(item.name)) fail("unknown-plugin");
    canonical(item.root, true); protectedPath(item.root, manifest);
    if (!HASH.test(item.sha256) || measureTree(item.root) !== item.sha256) fail("package-changed");
    const plugin = boundedJson(join(item.root, ".codex-plugin/plugin.json"));
    if (plugin.name !== item.name || plugin.mcpServers !== "./.mcp.json") fail("package-identity-mismatch");
    packages.set(item.name, item.root);
  }
  exact(input.runtime, ["root", "sha256"]);
  canonical(input.runtime.root, true); protectedPath(input.runtime.root, manifest);
  if (!HASH.test(input.runtime.sha256) || measureTree(input.runtime.root) !== input.runtime.sha256) fail("runtime-changed");
  exact(input.node, ["path", "sha256"]);
  canonical(input.node.path); protectedPath(input.node.path, manifest);
  protectedPath(dirname(input.node.path), manifest);
  if (!(lstatSync(input.node.path).mode & 0o111)) fail("interpreter-unavailable");
  if (!HASH.test(input.node.sha256) || digest(readFileSync(input.node.path)) !== input.node.sha256) fail("interpreter-changed");
  managerEnvironment(input.node, manifest.runtimeHome);
  const expectedCommands = {
    "context-mode-call": {
      executable: input.node.path, sha256: input.node.sha256,
      args: [join(packages.get("gestalt"), "live-context-worker.mjs"), "--runtime", input.runtime.root, "--workspace", manifest.appRoot],
      timeoutMs: 120000,
    },
  };
  if (stable(manifest.commands) !== stable(expectedCommands)) fail("unadmitted-native-command");
  const expected = {
    plugins: ["context-mode", "gestalt"].map((name) => ({ name, root: packages.get(name) })),
    mcpServers: [
      { name: "context-mode", command: "node", args: ["./start.mjs"], cwd: packages.get("context-mode"), env: { CONTEXT_MODE_PLATFORM: "codex" }, default_tools_approval_mode: "approve" },
      { name: "gestalt-org-plan", command: "node", args: ["./org-plan-mcp.mjs"], cwd: packages.get("gestalt"), env_vars: ["GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY", "GESTALT_MOBILE_ORG_PLAN_STATUS_FILE"], default_tools_approval_mode: "approve" },
    ],
    hooks: [], remoteMcp: [], executables: [],
  };
  if (stable(input.effectiveConfig) !== stable(expected)) fail("unadmitted-launch-surface");
  for (const [name, root] of packages) {
    const server = name === "gestalt" ? "gestalt-org-plan" : "context-mode";
    const entry = expected.mcpServers.find((item) => item.name === server);
    const { name: _name, ...expectedEntry } = entry;
    expectedEntry.cwd = ".";
    if (stable(boundedJson(join(root, ".mcp.json"))) !== stable({ mcpServers: { [server]: expectedEntry } })) fail("package-launch-changed");
  }
  if (!Array.isArray(input.plans) || input.plans.length > 32 || new Set(input.plans).size !== input.plans.length) fail("invalid-lifecycle-scope");
  for (const plan of input.plans) {
    canonical(plan);
    if (dirname(plan) !== join(input.workspaceRoot, ".gestalt") || !plan.endsWith(".org")) fail("invalid-lifecycle-scope");
  }
  return { input, manifest, packages };
}
/** Controller stages these exact bytes BEFORE L9 prepares its policy receipt. */
export function stageAdmission(bootstrapPath) {
  const { input, manifest, packages } = readBootstrap(bootstrapPath);
  const root = dirname(input.manifestPath);
  try { lstatSync(join(root, "dispatch.lock")); fail("native-worker-active"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const config = {
    schemaVersion: 1,
    mcpServers: Object.fromEntries(LIVE_SERVERS.map((server) => [server, {
      command: input.node.path,
      args: [join(packages.get("gestalt"), "live-mcp-proxy.mjs"), "--bootstrap", bootstrapPath, "--server", server],
      cwd: manifest.appRoot,
      env: {}, default_tools_approval_mode: "approve",
    }])),
    plugins: [], hooks: [], unavailableWorkflows: UNAVAILABLE_WORKFLOWS,
  };
  const configPath = join(root, "live-mcp-config.json");
  atomicPrivate(configPath, `${stable(config)}\n`);
  return { schemaVersion: 1, available: true, liveReady: false, configPath, sha256: digest(readFileSync(configPath)) };
}
function atomicPrivate(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, bytes); closeSync(fd); renameSync(temporary, path); }
  catch (error) { try { closeSync(fd); } catch {} try { unlinkSync(temporary); } catch {} throw error; }
}
function authenticate(record, key) {
  exact(record, ["body", "mac"]);
  if (!HASH.test(record.mac)) fail("invalid-receipt");
  const actual = createHmac("sha256", key).update(stable(record.body)).digest();
  if (!timingSafeEqual(actual, Buffer.from(record.mac, "hex"))) fail("invalid-receipt");
  return record.body;
}
function current(bootstrapPath) {
  const checked = readBootstrap(bootstrapPath), { input, manifest } = checked;
  canonical(manifest.keyFile, false, true);
  if (!inside(dirname(input.manifestPath), manifest.keyFile)) fail("invalid-signing-key");
  const key = readFileSync(manifest.keyFile);
  if (key.length !== 32) fail("invalid-signing-key");
  const policyPath = join(dirname(input.manifestPath), "policy-receipt.json");
  canonical(policyPath, false, true);
  const policy = authenticate(boundedJson(policyPath), key);
  if (policy.kind !== "policy-contract" || policy.manifestDigest !== digest(readFileSync(input.manifestPath))) fail("stale-policy-receipt");
  canonical(policy.manager?.path); protectedPath(policy.manager.path, manifest);
  if (digest(readFileSync(policy.manager.path)) !== policy.manager.sha256) fail("manager-changed");
  for (const file of manifest.configFiles ?? []) {
    canonical(file.path, false, true); protectedPath(file.path, manifest);
    if (digest(readFileSync(file.path)) !== file.sha256) fail("configuration-changed");
  }
  const configPath = join(dirname(input.manifestPath), "live-mcp-config.json");
  canonical(configPath, false, true);
  if (!manifest.configFiles?.some((file) => file.path === configPath && file.sha256 === digest(readFileSync(configPath)))) fail("unbound-prepared-config");
  if (!manifest.configFiles?.some((file) => file.path === bootstrapPath && file.sha256 === digest(readFileSync(bootstrapPath)))) fail("unbound-bootstrap");
  // Recompute config without mutating it: it must equal the exact staged launch set.
  const config = boundedJson(configPath);
  const expectedServers = Object.fromEntries(LIVE_SERVERS.map((server) => [server, {
    command: input.node.path,
    args: [join(checked.packages.get("gestalt"), "live-mcp-proxy.mjs"), "--bootstrap", bootstrapPath, "--server", server],
    cwd: manifest.appRoot, env: {}, default_tools_approval_mode: "approve",
  }]));
  if (stable(config) !== stable({ schemaVersion: 1, mcpServers: expectedServers, plugins: [], hooks: [], unavailableWorkflows: UNAVAILABLE_WORKFLOWS })) fail("prepared-config-changed");
  // Only the accepted manager can establish freshness of native/controller state.
  // This is a fixed typed operation, never a model-supplied command or arguments.
  let manager;
  try {
    manager = JSON.parse(execFileSync(policy.manager.path, ["live-policy", "verify", "--manifest", input.manifestPath], {
      cwd: dirname(input.manifestPath),
      env: managerEnvironment(input.node, manifest.runtimeHome),
      stdio: ["ignore", "pipe", "pipe"], timeout: 30000, maxBuffer: 4096,
    }));
  } catch { fail("native-policy-unavailable"); }
  if (manager.available !== true || manager.schemaVersion !== 1 || manager.policyDigest !== policy.policyDigest || manager.configDigest !== policy.configDigest) fail("native-policy-unavailable");
  const body = {
    schemaVersion: 1, kind: "live-package-admission", bootstrapDigest: digest(readFileSync(bootstrapPath)),
    manifestDigest: policy.manifestDigest, policyDigest: digest(stable(policy)),
    configDigest: digest(readFileSync(configPath)), packages: input.packages,
    runtime: input.runtime, node: input.node, components: manifest.components,
    workspaceRoot: input.workspaceRoot, plans: input.plans, servers: LIVE_SERVERS, unavailableWorkflows: UNAVAILABLE_WORKFLOWS,
  };
  return { ...checked, key, body };
}
export function prepareAdmission(bootstrapPath) {
  const { input, key, body } = current(bootstrapPath);
  const receiptPath = join(dirname(input.manifestPath), "admission-receipt.json");
  atomicPrivate(receiptPath, `${stable({ body, mac: createHmac("sha256", key).update(stable(body)).digest("hex") })}\n`);
  return { schemaVersion: 1, available: true, liveReady: false, admissionDigest: digest(stable(body)), receiptPath };
}
export function verifyAdmission(bootstrapPath) {
  try {
    const checked = current(bootstrapPath);
    const receiptPath = join(dirname(checked.input.manifestPath), "admission-receipt.json");
    canonical(receiptPath, false, true);
    if (stable(authenticate(boundedJson(receiptPath), checked.key)) !== stable(checked.body)) fail("stale-admission-receipt");
    return { schemaVersion: 1, available: true, liveReady: false, admissionDigest: digest(stable(checked.body)), receiptPath };
  } catch (error) {
    return { schemaVersion: 1, available: false, liveReady: false, reason: error instanceof AdmissionError ? error.reason : "admission-unavailable" };
  }
}
/** Trusted proxy only: return fixed dispatch authority, never expose it in MCP. */
export function executionAuthority(bootstrapPath) {
  const checked = current(bootstrapPath);
  const receiptPath = join(dirname(checked.input.manifestPath), "admission-receipt.json");
  canonical(receiptPath, false, true);
  if (stable(authenticate(boundedJson(receiptPath), checked.key)) !== stable(checked.body)) fail("stale-admission-receipt");
  return {
    input: checked.input, manifest: checked.manifest,
    manager: authenticate(boundedJson(join(dirname(checked.input.manifestPath), "policy-receipt.json")), checked.key).manager,
    bootstrapPath, bootstrapDigest: checked.body.bootstrapDigest,
    receiptPath, receiptDigest: digest(readFileSync(receiptPath)),
  };
}
/** During native lifetime: no second manager verify / project metadata parsing.
 * L9 monitors native/controller/policy freshness; this adds installed-byte and
 * admission monitoring. A mismatch revokes the in-flight transaction.
 */
export function executionInputsCurrent(authority) {
  try {
    const { input, manifest, bootstrapPath, bootstrapDigest, receiptPath, receiptDigest } = authority;
    if (digest(readFileSync(bootstrapPath)) !== bootstrapDigest || digest(readFileSync(receiptPath)) !== receiptDigest) return false;
    if (input.packages.some((item) => measureTree(item.root) !== item.sha256) || measureTree(input.runtime.root) !== input.runtime.sha256) return false;
    if (digest(readFileSync(input.node.path)) !== input.node.sha256) return false;
    managerEnvironment(input.node, manifest.runtimeHome);
    return manifest.configFiles.every((file) => digest(readFileSync(file.path)) === file.sha256);
  } catch { return false; }
}
export function nativeExitVerified(authority, launchId) {
  try {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(launchId)) return false;
    const path = join(dirname(authority.input.manifestPath), `process-${launchId}.json`);
    canonical(path, false, true);
    const body = authenticate(boundedJson(path), readFileSync(authority.manifest.keyFile));
    return body.kind === "process-launch" && body.launchId === launchId && body.commandId === "context-mode-call"
      && body.status === "exited" && body.termination === "leader-exit"
      && body.policy.manifestDigest === digest(readFileSync(authority.input.manifestPath));
  } catch { return false; }
}
