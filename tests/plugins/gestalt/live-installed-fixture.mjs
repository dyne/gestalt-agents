import { createHmac } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fixture } from "./live-fixture.mjs";
import { configureCodexIntegration } from "../../../plugins/context-mode/scripts/configure-codex.mjs";
import { digest, measureTree, stable, stageAdmission } from "../../../plugins/gestalt/live-admission.mjs";
import { observeOriginalLaunchSources } from "../../../plugins/gestalt/live-installed-source.mjs";
import fs from "node:fs";
import test from "node:test";
import { syncBuiltinESMExports } from "node:module";

// Offline fixtures only: this filesystem namespace maps immutable root-owned
// / and /tmp to overflow UID65534. Model their host ownership, preserving every
// other stat field. Real source paths, permissions and identities stay strict.
const hostStat = fs.lstatSync, hostFstat = fs.fstatSync;
const owner = (path, info) => ["/", "/tmp"].includes(path) && info.uid === 65534
  ? Object.assign(Object.create(Object.getPrototypeOf(info)), info, { uid: 0 }) : info;
const statMock = test.mock.method(fs, "lstatSync", (path, ...args) => owner(path, hostStat(path, ...args)));
const fdMock = test.mock.method(fs, "fstatSync", (fd, ...args) => owner(fs.readlinkSync(`/proc/self/fd/${fd}`), hostFstat(fd, ...args)));
syncBuiltinESMExports();
test.after(() => { statMock.mock.restore(); fdMock.mock.restore(); syncBuiltinESMExports(); });

/** Offline receipt fixture with the ACTUAL configurator, not a model process.
 * Small runtime files model the preparation contract; actual preparation and
 * independent Manager comparison are separate integration evidence.
 */
export function installedFixture(t) {
  const f = fixture(t, { schemaVersion: 2 });
  f.manifest.owningRuntime = { home: f.manifest.runtimeHome };
  const version = JSON.parse(readFileSync(new URL("../../../plugins/context-mode/package.json", import.meta.url))).version;
  const pkg = f.input.packages.find((item) => item.name === "context-mode");
  const packageRoot = join(f.root, "cache/context-mode", version);
  mkdirSync(dirname(packageRoot), { recursive: true, mode: 0o700 }); renameSync(pkg.root, packageRoot);
  pkg.root = packageRoot;
  const file = (root, path, bytes = "// contract fixture\n") => {
    mkdirSync(dirname(join(root, path)), { recursive: true, mode: 0o700 });
    writeFileSync(join(root, path), bytes, { mode: 0o644 });
  };
  file(packageRoot, "package.json", JSON.stringify({ name: "context-mode", version }));
  file(packageRoot, "start.mjs"); file(packageRoot, "hooks/runtime-hook.mjs");
  const gestaltHome = join(f.root, "gestalt-home"), runtime = join(gestaltHome, "runtime/context-mode");
  mkdirSync(dirname(runtime), { recursive: true, mode: 0o700 }); renameSync(f.runtime, runtime); f.runtime = runtime;
  file(runtime, "package.json", JSON.stringify({ name: "context-mode", version }));
  const files = {};
  for (const path of ["start.mjs", "scripts/codex-profile.mjs", "scripts/runtime-location.mjs", "scripts/runtime-preflight.mjs", "server.bundle.mjs", "cli.bundle.mjs",
    ...["security", "session-db", "session-extract", "session-attribution", "session-snapshot", "codex-usage"].map((name) => `hooks/${name}.bundle.mjs`),
    "node_modules/better-sqlite3/package.json", "node_modules/better-sqlite3/build/Release/better_sqlite3.node", "node_modules/turndown/package.json", "node_modules/turndown-plugin-gfm/package.json", "node_modules/@mixmark-io/domino/package.json"]) {
    file(runtime, path); files[path] = digest(readFileSync(join(runtime, path)));
  }
  file(runtime, ".context-mode-prepared.json", JSON.stringify({ schemaVersion: 2, packageVersion: version, preparedAt: "fixture", node: process.version,
    nodeModulesAbi: process.versions.modules, platform: process.platform, arch: process.arch, bun: null, files }));
  mkdirSync(join(f.manifest.runtimeHome, "bin"), { mode: 0o700 });
  const configured = configureCodexIntegration({ codexHome: f.manifest.runtimeHome, gestaltHome, pluginRoot: packageRoot, pluginId: "context-mode@dyne-gestalt-agents" });
  // The sandbox's /usr/bin image is owned by overflow UID65534. Copy exact
  // interpreter bytes into private fixture storage; never weaken ownership.
  const node = join(f.root, "node-bin/node"); copyFileSync(process.execPath, node); chmodSync(node, 0o755);
  f.input.node = { path: node, sha256: digest(readFileSync(node)) };
  f.input.runtime = { root: runtime, sha256: measureTree(runtime) }; pkg.sha256 = measureTree(packageRoot);
  f.input.effectiveConfig.plugins.find((p) => p.name === "context-mode").root = packageRoot;
  f.input.effectiveConfig.mcpServers.find((p) => p.name === "context-mode").cwd = packageRoot;
  Object.assign(f.manifest.commands["context-mode-call"], { executable: node, sha256: f.input.node.sha256 });
  f.manifest.commands["context-mode-call"].args[2] = runtime;
  const config = f.manifest.configFiles.find((entry) => entry.path === configured.configPath);
  config.sha256 = digest(readFileSync(config.path));
  Object.assign(f.provenance.inventory.sources.find((entry) => entry.path === config.path), config);
  f.manifest.originalLaunchSources = [{ kind: "context-mode-bridge-v1", path: configured.launcherPath, sha256: digest(readFileSync(configured.launcherPath)), gestaltHome,
    interpreter: f.input.node, package: { root: packageRoot, version, treeDigest: pkg.sha256 }, runtime: { root: runtime, treeDigest: f.input.runtime.sha256 } }];
  f.observations = observeOriginalLaunchSources(f.manifest, f.input);
  f.saveInput(); f.save(f.input.manifestPath, f.manifest); const staged = stageAdmission(f.bootstrapPath);
  f.manifest.configFiles.find((entry) => entry.path === staged.configPath).sha256 = staged.sha256;
  f.provenance.inventory.sources.push(...f.observations);
  f.publish = (observations = f.observations, extension = true) => {
    f.saveInput(); f.savePolicy();
    f.saveManager({ schemaVersion: 2, contractVersion: 2, available: true, policyDigest: "policy", configDigest: "config",
      sourceInventoryDigest: digest(stable(f.provenance.inventory)), runtimeProvenanceDigest: f.provenance.receiptDigest, generation: f.manifest.generation,
      ...(extension ? { extensions: ["original-installed-launch-source-v1"] } : {}), originalLaunchSources: observations });
    const path = join(f.privateRoot, "policy-receipt.json"), record = JSON.parse(readFileSync(path));
    record.body.originalLaunchSources = observations; record.body.manager.sha256 = digest(readFileSync(f.manager));
    record.mac = createHmac("sha256", readFileSync(f.manifest.keyFile)).update(stable(record.body)).digest("hex"); f.save(path, record);
  };
  f.publish(); return { ...f, configured };
}
