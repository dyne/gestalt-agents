import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { digest, measureTree, prepareAdmission, stable, stageAdmission, verifyAdmission } from "../../../plugins/gestalt/live-admission.mjs";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
// The outer native sandbox materializes an empty read-only /tmp/.codex mask.
// Isolate that host observation ONLY in offline fixtures. Production keeps its
// strict ancestor check and the accepted manager's controller/native verifier.
const lstat = fs.lstatSync;
const observation = test.mock.method(fs, "lstatSync", (path, ...args) => {
  if (path === "/tmp/.codex") {
    const info = lstat(path);
    if (info.isDirectory() && !(info.mode & 0o222) && fs.readdirSync(path).length === 0) {
      throw Object.assign(new Error("offline native placeholder"), { code: "ENOENT" });
    }
  }
  return lstat(path, ...args);
});
syncBuiltinESMExports();
test.after(() => { observation.mock.restore(); syncBuiltinESMExports(); });
export function fixture(t, { privateName = "private", appName = "app", schemaVersion = 1, network = "restricted", generationDirectory = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "live-admission-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, appName), privateRoot = join(root, privateName, ...(generationDirectory ? ["generation"] : [])), runtime = join(root, "runtime");
  for (const path of [app, privateRoot, runtime, join(app, ".gestalt"), join(privateRoot, "home")]) mkdirSync(path, { recursive: true, mode: 0o700 });
  const plan = join(app, ".gestalt/work.org");
  writeFileSync(plan, "* TODO Work\n", { mode: 0o600 });
  const key = randomBytes(32), keyFile = join(privateRoot, "key"), manifestPath = join(privateRoot, "manifest.json"), bootstrapPath = join(privateRoot, "bootstrap.json");
  writeFileSync(keyFile, key, { mode: 0o600 });
  mkdirSync(join(root, "node-bin"), { mode: 0o700 });
  const node = join(root, "node-bin/node");
  writeFileSync(node, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  const manager = join(root, "manager");
  // Offline contract fixture only. This is deliberately NOT native enforcement proof.
  writeFileSync(manager, '#!/bin/sh\nprintf \'%s\\n\' \'{"schemaVersion":1,"available":true,"policyDigest":"policy","configDigest":"config"}\'\n', { mode: 0o700 });
  const packages = ["context-mode", "gestalt"].map((name) => {
    const path = join(root, name);
    mkdirSync(join(path, ".codex-plugin"), { recursive: true, mode: 0o700 });
    for (const file of [".codex-plugin/plugin.json", ".mcp.json"]) {
      copyFileSync(join(repo, "plugins", name, file), join(path, file)); chmodSync(join(path, file), 0o644);
    }
    return { name, root: path, sha256: measureTree(path) };
  });
  const plugin = (name) => packages.find((item) => item.name === name).root;
  writeFileSync(join(runtime, "server.bundle.mjs"), "// measured fixture\n", { mode: 0o644 });
  const manifest = {
    schemaVersion, appRoot: app, keyFile, runtimeHome: join(privateRoot, "home"), components: { manager: "1", mobile: "1", agents: "tree" },
    sandboxState: { permissionProfile: { type: "managed", network, file_system: { type: "restricted", entries: [
      { path: { type: "special", value: { kind: "root" } }, access: "read" },
      { path: { type: "path", path: app }, access: "write" },
    ] } } }, configFiles: [],
    commands: { "context-mode-call": { executable: node, sha256: digest(readFileSync(node)), args: [join(plugin("gestalt"), "live-context-worker.mjs"), "--runtime", runtime, "--workspace", app], timeoutMs: 120000 } },
  };
  const input = {
    schemaVersion: 1, manifestPath, workspaceRoot: app, packages, runtime: { root: runtime, sha256: measureTree(runtime) }, node: { path: node, sha256: digest(readFileSync(node)) }, plans: [plan],
    effectiveConfig: {
      plugins: ["context-mode", "gestalt"].map((name) => ({ name, root: plugin(name) })),
      mcpServers: ["context-mode", "gestalt"].map((name) => {
        const config = JSON.parse(readFileSync(join(plugin(name), ".mcp.json")));
        const [server, entry] = Object.entries(config.mcpServers)[0];
        return { name: server, ...entry, cwd: plugin(name) };
      }), hooks: [], remoteMcp: [], executables: [],
    },
  };
  const save = (path, data) => writeFileSync(path, `${JSON.stringify(data)}\n`, { mode: 0o600 });
  const saveInput = () => save(bootstrapPath, input);
  // Synthetic authenticated v2 observation. These fixtures prove consumption
  // and refusal only; Manager's real capture/seal/native proof is separate.
  const generation = { sessionId: "12345678-1234-4234-8234-123456789abc", generation: 1 };
  const provenance = schemaVersion === 2 ? {
    captureId: "22345678-1234-4234-8234-123456789abc", receiptDigest: "a".repeat(64),
    runtime: { process: { pid: 123, birth: "456", uid: process.getuid(), namespaces: { mnt: "mnt:[1]", user: "user:[2]", pid: "pid:[3]" } } },
    directories: {}, inventory: {
      schemaVersion: 2, policyDigest: "policy", effectiveConfigDigest: "b".repeat(64), sessionFlagsDigest: "c".repeat(64), sources: [],
    },
  } : undefined;
  if (provenance) {
    const electionRoot = generationDirectory ? dirname(privateRoot) : privateRoot;
    manifest.keyFile = join(electionRoot, "live-policy.key");
    writeFileSync(manifest.keyFile, key, { mode: 0o600 });
    manifest.election = { lockFile: join(electionRoot, "controller.lock") };
    manifest.generation = generation;
    manifest.runtimeProvenance = { captureId: provenance.captureId, effectiveConfigDigest: provenance.inventory.effectiveConfigDigest, sessionFlagsDigest: provenance.inventory.sessionFlagsDigest };
    provenance.inventory.runtime = provenance.runtime.process;
    const config = join(manifest.runtimeHome, "config.toml");
    writeFileSync(config, "# original owning config\n", { mode: 0o600 });
    manifest.configFiles.push({ path: config, sha256: digest(readFileSync(config)) });
    provenance.inventory.sources.push({ kind: "file", role: "sandbox-worker", ...manifest.configFiles[0] });
    for (let ancestor = app; ; ancestor = dirname(ancestor)) {
      const path = join(ancestor, ".codex");
      provenance.directories[path] = null;
      provenance.inventory.sources.push({ kind: "absent", role: "project", path });
      if (ancestor === "/") break;
    }
    for (const name of ["config", "managed_config", "requirements"]) provenance.inventory.sources.push({ kind: "absent", role: "system", path: `/etc/codex/${name}.toml` });
  }
  const saveManager = (report) => writeFileSync(manager, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(report)}'\n`, { mode: 0o700 });
  const savePolicy = () => {
    const bootstrapEntry = { path: bootstrapPath, sha256: digest(readFileSync(bootstrapPath)) };
    manifest.configFiles = [...manifest.configFiles.filter((file) => file.path !== bootstrapPath), bootstrapEntry];
    save(manifestPath, manifest);
    if (provenance) saveManager({ schemaVersion: 2, contractVersion: 2, available: true, policyDigest: "policy", configDigest: "config", sourceInventoryDigest: digest(stable(provenance.inventory)), runtimeProvenanceDigest: provenance.receiptDigest, generation });
    const body = { schemaVersion, kind: "policy-contract", manifestDigest: digest(readFileSync(manifestPath)), policyDigest: "policy", configDigest: "config", manager: { path: manager, sha256: digest(readFileSync(manager)) }, ...(provenance ? { authority: { generation }, provenance } : {}) };
    save(join(privateRoot, "policy-receipt.json"), { body, mac: createHmac("sha256", key).update(stable(body)).digest("hex") });
  };
  saveInput(); savePolicy();
  const staged = stageAdmission(bootstrapPath);
  manifest.configFiles.push({ path: staged.configPath, sha256: staged.sha256 });
  savePolicy(); prepareAdmission(bootstrapPath);
  return { root, app, runtime, privateRoot, input, manifest, bootstrapPath, saveInput, savePolicy, save, manager, provenance, saveManager };
}
