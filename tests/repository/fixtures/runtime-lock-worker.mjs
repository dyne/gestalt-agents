// Isolated process adapter: production lock code and filesystem operations stay real.
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const config = JSON.parse(process.argv[2]);
const realRead = fs.readFileSync;
const realUnlink = fs.unlinkSync;
const realRmdir = fs.rmdirSync;
const realRename = fs.renameSync;
const realMkdir = fs.mkdirSync;
const realKill = process.kill.bind(process);
const realNow = Date.now;
const realTimeout = globalThis.setTimeout;
let elapsed = 0;
let polls = 0;
// Only awaited polling time advances. Owner ages come from real fixture mtimes.
// Keep each requested interval intact so reclamation can retry acquisition;
// shortening wall time must not skip the remaining lock-wait budget.
Date.now = () => realNow() + elapsed;
globalThis.setTimeout = (callback, milliseconds, ...args) => {
  elapsed += milliseconds;
  polls++;
  return realTimeout(callback, 2, ...args);
};
const isOwnerPath = (path) => dirname(String(path)) === config.lock && /^(?:owner\.pid|owner-.*\.json|legacy-.*\.pid)$/.test(String(path).split(/[\\/]/).at(-1));
function replaceOwner(legacy = false) {
  fs.rmSync(config.lock, { recursive: true, force: true });
  fs.mkdirSync(config.lock);
  const token = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
  if (legacy) fs.writeFileSync(join(config.lock, "owner.pid"), `${config.successorPid}\n`);
  else fs.writeFileSync(join(config.lock, `owner-${config.successorPid}-${token}.json`),
    JSON.stringify({ schemaVersion: 1, pid: config.successorPid, token }));
  fs.writeFileSync(join(config.lock, "successor"), "keep");
  fs.writeFileSync(config.injected, config.scenario);
}
if (config.scenario === "legacy-rename-replacement") {
  let replaced = false;
  fs.renameSync = (source, target, ...args) => {
    if (String(source) === join(config.lock, "owner.pid") && !replaced) {
      replaced = true;
      replaceOwner(true);
    }
    return realRename(source, target, ...args);
  };
}
if (config.scenario === "missing") {
  fs.mkdirSync = (path, ...args) => {
    if (String(path) === config.lock) fs.writeFileSync(config.injected, "contender observed held initializer");
    return realMkdir(path, ...args);
  };
}
if (config.scenario === "unreadable") {
  fs.readFileSync = (path, ...args) => {
    if (isOwnerPath(path)) {
      throw Object.assign(new Error("fixture denied owner read"), { code: "EACCES" });
    }
    return realRead(path, ...args);
  };
}
if (config.scenario === "permission") {
  process.kill = (pid, signal) => {
    if (pid === config.ownerPid && signal === 0) {
      throw Object.assign(new Error("fixture denied process probe"), { code: "EPERM" });
    }
    return realKill(pid, signal);
  };
}
if (config.scenario === "observation-replacement") {
  let replaced = false;
  fs.readFileSync = (path, ...args) => {
    const result = realRead(path, ...args);
    if (isOwnerPath(path) && !replaced) {
      replaced = true;
      replaceOwner();
    }
    return result;
  };
}
if (["unlink-replacement", "unlink-empty-replacement"].includes(config.scenario)) {
  let replaced = false;
  fs.unlinkSync = (path, ...args) => {
    if (isOwnerPath(path) && !replaced) {
      replaced = true;
      if (config.scenario === "unlink-empty-replacement") {
        fs.rmSync(config.lock, { recursive: true, force: true });
        fs.mkdirSync(config.lock);
        fs.writeFileSync(config.injected, "successor initializing before stale unlink");
      } else replaceOwner();
    }
    return realUnlink(path, ...args);
  };
}
if (config.scenario === "rmdir-replacement") {
  let replaced = false;
  fs.rmdirSync = (path, ...args) => {
    if (String(path) === config.lock && !replaced) { replaced = true; replaceOwner(); }
    return realRmdir(path, ...args);
  };
}
syncBuiltinESMExports();
const { REQUIRED_FILES } = await import(pathToFileURL(join(config.scripts, "runtime-preflight.mjs")));
function artifacts(root, manifest = false) {
  const files = {};
  for (const name of REQUIRED_FILES) {
    const path = join(root, name);
    fs.mkdirSync(dirname(path), { recursive: true });
    const content = name === join("node_modules", "better-sqlite3", "package.json")
      ? '{"main":"index.cjs"}' : `fixture ${name}\n`;
    fs.writeFileSync(path, content);
    files[name] = createHash("sha256").update(content).digest("hex");
  }
  fs.writeFileSync(join(root, "node_modules", "better-sqlite3", "index.cjs"),
    "module.exports = class Database { close() {} };\n");
  if (manifest) fs.writeFileSync(join(root, ".context-mode-prepared.json"), JSON.stringify({
    schemaVersion: 2, packageVersion: "1.0.0", nodeModulesAbi: process.versions.modules,
    platform: process.platform, arch: process.arch, files,
  }));
}
let entered = false;
function build(root) {
  if (!entered) {
    entered = true;
    fs.writeFileSync(config.entered, String(process.pid));
    if (config.scenario === "release-replacement") {
      replaceOwner();
    }
    if (config.scenario === "failure") throw new Error("injected build failure");
    const deadline = realNow() + 10000;
    while (config.gate && !fs.existsSync(config.gate)) {
      if (realNow() >= deadline) throw new Error("fixture gate was not released");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  artifacts(root, config.kind === "install");
}
// Preparation still performs its real manifest and native-dependency checks.
childProcess.execFileSync = (_command, _args, options) => {
  build(options.cwd);
  return Buffer.from("");
};
syncBuiltinESMExports();
try {
  if (config.kind === "install") {
    const { installRuntime } = await import(pathToFileURL(join(config.scripts, "install-runtime.mjs")));
    await installRuntime(config.source, { force: config.force, env: { GESTALT_HOME: config.home }, prepare: async (stage) => build(stage) });
  } else {
    const { prepareRuntime } = await import(pathToFileURL(join(config.scripts, "prepare-runtime.mjs")));
    await prepareRuntime(config.source, { force: config.force });
  }
  console.log(JSON.stringify({ status: "completed", entered, elapsed, polls }));
} catch (error) {
  console.log(JSON.stringify({ status: "error", message: error.message, entered, elapsed, polls }));
}
