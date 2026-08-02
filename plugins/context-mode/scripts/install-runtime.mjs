#!/usr/bin/env node
/** Install a prepared context-mode runtime outside Codex's replaceable cache. */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareRuntime } from "./prepare-runtime.mjs";
import { getRuntimeRoot } from "./runtime-location.mjs";
import { verifyPreparedRuntime } from "./runtime-preflight.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = resolve(SCRIPT_DIR, "..");
const WAIT_MS = 250;
const WAIT_TIMEOUT_MS = 300_000;
const STALE_LOCK_MS = 600_000;
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

function removeStaleLock(lockDir) {
  try {
    const pid = Number.parseInt(readFileSync(resolve(lockDir, "owner.pid"), "utf8"), 10);
    let alive = Number.isInteger(pid) && pid > 0;
    if (alive) {
      try { process.kill(pid, 0); } catch (error) { alive = error?.code !== "ESRCH"; }
    }
    if (!alive || Date.now() - statSync(lockDir).mtimeMs > STALE_LOCK_MS) {
      rmSync(lockDir, { recursive: true, force: true });
    }
  } catch {
    // The owner can release the lock between observations.
  }
}

function publishRuntime(stage, target) {
  const backup = `${target}.backup-${process.pid}`;
  rmSync(backup, { recursive: true, force: true });
  if (existsSync(target)) renameSync(target, backup);
  try {
    renameSync(stage, target);
    rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(target) && existsSync(backup)) renameSync(backup, target);
    throw error;
  }
}

export async function installRuntime(sourceRoot = SOURCE_ROOT, { force = false } = {}) {
  const target = getRuntimeRoot(sourceRoot);
  const targetFromSource = relative(sourceRoot, target);
  if (
    targetFromSource === "" ||
    (!isAbsolute(targetFromSource) && !targetFromSource.startsWith(`..${sep}`) && targetFromSource !== "..")
  ) {
    throw new Error(`external runtime must not be inside the context-mode source: ${target}`);
  }
  if (!force && verifyPreparedRuntime(target).ok) return target;

  mkdirSync(dirname(target), { recursive: true });
  const lockDir = `${target}.install.lock`;
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let ownsLock = false;
    try {
      mkdirSync(lockDir);
      writeFileSync(resolve(lockDir, "owner.pid"), `${process.pid}\n`);
      ownsLock = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      removeStaleLock(lockDir);
    }

    if (ownsLock) {
      const stage = `${target}.stage-${process.pid}-${Date.now()}`;
      try {
        if (force || !verifyPreparedRuntime(target).ok) {
          cpSync(sourceRoot, stage, {
            recursive: true,
            filter: (source) => shouldCopy(sourceRoot, source),
          });
          await prepareRuntime(stage, { force: true });
          const prepared = verifyPreparedRuntime(stage);
          if (!prepared.ok) throw new Error(`staged runtime is invalid: ${prepared.problems.join(", ")}`);
          publishRuntime(stage, target);
        }
      } finally {
        rmSync(stage, { recursive: true, force: true });
        rmSync(lockDir, { recursive: true, force: true });
      }
      return target;
    }

    if (!force && verifyPreparedRuntime(target).ok) return target;
    await delay(WAIT_MS);
  }
  throw new Error(`timed out waiting for runtime installation lock: ${lockDir}`);
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const target = getRuntimeRoot(SOURCE_ROOT);
  if (process.argv.includes("--check")) {
    const result = verifyPreparedRuntime(target);
    if (!result.ok) {
      process.stderr.write(`context-mode external runtime is not prepared: ${result.problems.join(", ")}\n`);
      process.exit(1);
    }
  } else {
    await installRuntime(SOURCE_ROOT, { force: process.argv.includes("--force") });
  }
  process.stdout.write(`context-mode external runtime: ${target}\n`);
}
