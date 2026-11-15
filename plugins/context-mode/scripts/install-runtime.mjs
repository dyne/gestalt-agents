#!/usr/bin/env node
/** Install a prepared context-mode runtime outside Codex's replaceable cache. */
import {
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { prepareRuntime } from "./prepare-runtime.mjs";
import { SetupCommandContext } from "./setup-command-context.mjs";
import { getRuntimeIdentity, getRuntimeRoot } from "./runtime-location.mjs";
import { verifyPreparedRuntime } from "./runtime-preflight.mjs";
import { runtimeLockTimeout, tryAcquireRuntimeLock } from "./runtime-lock.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = resolve(SCRIPT_DIR, "..");
const WAIT_MS = 250;
const WAIT_TIMEOUT_MS = 300_000;
const GENERATED = new Set([
  ".context-mode-prepared.json",
  "server.bundle.mjs",
  "cli.bundle.mjs",
  "hooks/security.bundle.mjs",
  "hooks/session-db.bundle.mjs",
  "hooks/session-extract.bundle.mjs",
  "hooks/session-attribution.bundle.mjs",
  "hooks/session-snapshot.bundle.mjs",
  "hooks/codex-usage.bundle.mjs",
]);

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

function shouldCopy(sourceRoot, source) {
  const name = relative(sourceRoot, source).split(sep).join("/");
  if (!name) return true;
  const first = name.split("/", 1)[0];
  if (first === "node_modules" || first === "build") return false;
  if (first.startsWith(".context-mode-prepare")) return false;
  return !GENERATED.has(name);
}

function publishRuntime(stage, target, context) {
  const backup = `${target}.backup-${randomUUID()}`;
  if (existsSync(target)) renameSync(target, backup);
  try {
    renameSync(stage, target);
    if (context.canCleanup()) rmSync(backup, { recursive: true, force: true });
    else context.retain(backup);
  } catch (error) {
    if (context.canCleanup()) { if (!existsSync(target) && existsSync(backup)) renameSync(backup, target); }
    else { context.retain(backup); context.retain(stage); }
    throw error;
  }
}

export function verifyInstalledRuntime(sourceRoot, target) {
  const expectedVersion = getRuntimeIdentity(sourceRoot).packageVersion;
  const prepared = verifyPreparedRuntime(target);
  if (!prepared.ok) return prepared;
  try {
    if (expectedVersion === getRuntimeIdentity(target).packageVersion) return prepared;
  } catch {
    // A concurrent publisher can replace the target between these reads.
  }
  return { ok: false, problems: ["package.json:source-version"] };
}

export async function installRuntime(sourceRoot = SOURCE_ROOT, { force = false, env = process.env, prepare = prepareRuntime, commandContext } = {}) {
  const context = commandContext ?? new SetupCommandContext({ environment: env, cwd: sourceRoot });
  context.check();
  const target = getRuntimeRoot(sourceRoot, env);
  const targetFromSource = relative(sourceRoot, target);
  if (
    targetFromSource === "" ||
    (!isAbsolute(targetFromSource) && !targetFromSource.startsWith(`..${sep}`) && targetFromSource !== "..")
  ) {
    throw new Error(`external runtime must not be inside the context-mode source: ${target}`);
  }
  if (!force && verifyInstalledRuntime(sourceRoot, target).ok) return target;

  mkdirSync(dirname(target), { recursive: true });
  const lockDir = `${target}.install.lock`;
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    context.check();
    const acquired = tryAcquireRuntimeLock(lockDir);
    const releaseLock = acquired ? context.protectLock(lockDir, acquired) : null;
    if (releaseLock) {
      const stage = `${target}.stage-${process.pid}-${Date.now()}`;
      try {
        if (force || !verifyInstalledRuntime(sourceRoot, target).ok) {
          cpSync(sourceRoot, stage, {
            recursive: true,
            filter: (source) => shouldCopy(sourceRoot, source),
          });
          await prepare(stage, { force: true, env, commandContext: context });
          const prepared = verifyInstalledRuntime(sourceRoot, stage);
          if (!prepared.ok) throw new Error(`staged runtime is invalid: ${prepared.problems.join(", ")}`);
          publishRuntime(stage, target, context);
        }
      } finally {
        if (context.canCleanup()) { try { rmSync(stage, { recursive: true, force: true }); } finally { releaseLock(); } }
        else { context.retain(stage); context.retain(lockDir); releaseLock(); }
      }
      return target;
    }

    if (!force && verifyInstalledRuntime(sourceRoot, target).ok) return target;
    await delay(WAIT_MS);
  }
  throw new Error(`timed out waiting for runtime installation lock: ${runtimeLockTimeout(lockDir)}`);
}

function isDirectInvocation() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isDirectInvocation()) {
  const target = getRuntimeRoot(SOURCE_ROOT);
  if (process.argv.includes("--check")) {
    const result = verifyInstalledRuntime(SOURCE_ROOT, target);
    if (!result.ok) {
      process.stderr.write(`context-mode external runtime is not prepared: ${result.problems.join(", ")}\n`);
      process.exit(1);
    }
  } else {
    await installRuntime(SOURCE_ROOT, { force: process.argv.includes("--force") });
  }
  process.stdout.write(`context-mode external runtime: ${target}\n`);
}
