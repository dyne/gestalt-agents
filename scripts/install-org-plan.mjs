#!/usr/bin/env node
/** Publish immutable Org helper bundles through one atomic public-file rename. */
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync,
  rmSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeLockTimeout, tryAcquireRuntimeLock } from "../plugins/context-mode/scripts/runtime-lock.mjs";

const MODULES = [
  "cli", "core", "files", "parser", "model-policy", "model-schema",
  "executor-launch", "effective-settings", "model-comparison", "publication", "transitions",
].map((name) => `org-plan-${name}.mjs`);
const FILES = ["org-plan", ...MODULES, "LICENSE"];
const RECORD = ".publication.json";
const DISPATCH_HEADER = "#!/bin/sh\n# Gestalt Org helper dispatcher v1\n";
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function optionalStat(path) {
  try { return lstatSync(path); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function regular(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`not a regular helper file: ${path}`);
  return info;
}

function directory(path) {
  try { mkdirSync(path, { mode: 0o755 }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`not a real helper directory: ${path}`);
}

function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: "utf8", maxBuffer: 65536 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`helper validation/copy failed: ${executable} (${result.status ?? result.signal}): ${(result.stderr ?? "").trim().slice(0, 400)}`);
}

function dead(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error?.code === "ESRCH"; }
}

function cleanupInterrupted(bundles, bin) {
  for (const name of readdirSync(bundles)) {
    const match = /^\.stage-([1-9]\d*)-([0-9a-f-]{36})$/.exec(name);
    if (!match || !Number.isSafeInteger(Number(match[1])) || !dead(Number(match[1]))) continue;
    const path = join(bundles, name);
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) continue;
    // Unknown/unpublished ownership is retained; elapsed time is not evidence.
    try {
      regular(join(path, RECORD));
      const owner = JSON.parse(readFileSync(join(path, RECORD), "utf8"));
      if (owner.schemaVersion !== 1 || owner.pid !== Number(match[1]) || owner.token !== match[2]) continue;
    } catch { continue; }
    // Private never-reused name, verified dead owner, publication lock held.
    rmSync(path, { recursive: true });
  }
  for (const name of readdirSync(bin)) {
    const match = /^\.org-plan-([1-9]\d*)-([0-9a-f-]{36})\.tmp$/.exec(name);
    if (!match || !Number.isSafeInteger(Number(match[1])) || !dead(Number(match[1]))) continue;
    const path = join(bin, name);
    const info = lstatSync(path);
    if (info.isFile() && !info.isSymbolicLink() && readFileSync(path, "utf8").startsWith(DISPATCH_HEADER)) rmSync(path);
  }
}

function sourceInventory(sourceRoot) {
  const scripts = join(sourceRoot, "plugins/gestalt/skills/org-plan/scripts");
  const license = join(sourceRoot, "plugins/gestalt/LICENSE");
  const names = readdirSync(scripts).sort();
  const expected = ["org-plan", ...MODULES].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error("unexpected Org helper source inventory");
  return FILES.map((name) => {
    const path = name === "LICENSE" ? license : join(scripts, name);
    const info = regular(path);
    if (realpathSync(path) !== path) throw new Error(`symlinked helper source ancestry: ${path}`);
    if (name === "org-plan" && !(info.mode & 0o111)) throw new Error("source Org helper is not executable");
    return { name, source: path, mode: name === "org-plan" ? 0o755 : 0o644, sha256: sha256(readFileSync(path)) };
  });
}

function validateStage(stage, inventory, recordText) {
  function verifyFiles() {
    const actual = readdirSync(stage).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...FILES, RECORD].sort())) throw new Error("unexpected staged Org helper inventory");
    for (const { name, mode, sha256: expected } of [...inventory, { name: RECORD, mode: 0o644, sha256: sha256(recordText) }]) {
      const path = join(stage, name);
      const info = regular(path);
      if ((info.mode & 0o7777) !== mode || sha256(readFileSync(path)) !== expected) throw new Error(`invalid staged helper file: ${name}`);
    }
  }
  verifyFiles();
  command("bash", ["-n", join(stage, "org-plan")]);
  for (const name of MODULES) command(process.execPath, ["--check", join(stage, name)]);
  command(join(stage, "org-plan"), ["--help"]);
  verifyFiles();
}

export async function installOrgPlan(sourceRoot, codexHome) {
  if (!isAbsolute(sourceRoot) || !isAbsolute(codexHome)) throw new Error("Org helper source and Codex home must be absolute");
  sourceRoot = realpathSync(sourceRoot);
  codexHome = realpathSync(codexHome);
  const inventory = sourceInventory(sourceRoot);
  const bin = join(codexHome, "bin");
  const lib = join(codexHome, "lib");
  directory(bin);
  directory(lib);
  const target = join(lib, "gestalt-org-plan");
  directory(target); // Legacy flat files stay here, unchanged for live callers.
  const bundles = join(target, "bundles");
  directory(bundles);
  const publicPath = join(bin, "org-plan");
  const lock = join(target, ".install.lock");
  const deadline = Date.now() + 300_000;
  let release;
  while (!(release = tryAcquireRuntimeLock(lock))) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for Org helper publication: ${runtimeLockTimeout(lock)}`);
    await delay(100);
  }
  const token = randomUUID();
  const stage = join(bundles, `.stage-${process.pid}-${token}`);
  const bundle = join(bundles, token);
  const temporary = join(bin, `.org-plan-${process.pid}-${token}.tmp`);
  let ownsStage = false;
  let ownsTemporary = false;
  try {
    const existing = optionalStat(publicPath);
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error(`not a regular public Org helper: ${publicPath}`);
    cleanupInterrupted(bundles, bin);
    mkdirSync(stage, { mode: 0o755 });
    ownsStage = true;
    const recordText = JSON.stringify({ schemaVersion: 1, pid: process.pid, token, files: inventory.map(({ name, mode, sha256 }) => ({ name, mode, sha256 })) }) + "\n";
    writeFileSync(join(stage, RECORD), recordText, { flag: "wx", mode: 0o644 });
    chmodSync(join(stage, RECORD), 0o644);
    for (const { name, source, mode } of inventory) command("install", ["-m", mode.toString(8), "--", source, join(stage, name)]);
    validateStage(stage, inventory, recordText);
    // Both names are in bundles: this rename never touches an old bundle.
    renameSync(stage, bundle);
    ownsStage = false;
    // The literal UUID pins the wrapper and its imports, even if this open
    // dispatcher inode is replaced. Resolve once relative to the public path
    // to preserve relocation; there is no mutable current-version pointer.
    const dispatcher = `${DISPATCH_HEADER}bundle=$(CDPATH='' cd -- "$(dirname -- "$0")/../lib/gestalt-org-plan/bundles/${token}" && pwd -P) || exit 1\nexec "$bundle/org-plan" "$@"\n`;
    writeFileSync(temporary, dispatcher, { flag: "wx", mode: 0o755 });
    ownsTemporary = true;
    chmodSync(temporary, 0o755);
    command("bash", ["-n", temporary]);
    // Same-directory rename is the sole public activation point. On error the
    // previous public file and every old/legacy module remain untouched.
    renameSync(temporary, publicPath);
    ownsTemporary = false;
    return bundle;
  } finally {
    try {
      if (ownsTemporary) rmSync(temporary, { force: true });
      if (ownsStage) rmSync(stage, { recursive: true, force: true });
    } finally { release(); }
  }
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    // Compare physical paths even when the CLI spelling retains symlink ancestors.
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // Eval, stdin and library callers need not supply an existing entry file.
    return false;
  }
}

if (isDirectInvocation()) {
  try {
    if (process.argv.length !== 4) throw new Error("usage: install-org-plan.mjs SOURCE_ROOT CODEX_HOME");
    const bundle = await installOrgPlan(process.argv[2], process.argv[3]);
    process.stdout.write(`Org helper bundle installed: ${bundle}\n`);
  } catch (error) {
    process.stderr.write(`Org helper installation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
