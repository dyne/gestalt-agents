/**
 * Build generated runtime artifacts for source-only marketplace checkouts.
 *
 * Dyne's marketplace intentionally does not commit esbuild/tsc output. Codex
 * can start the MCP server and hooks concurrently, so the first process owns an
 * atomic directory lock while siblings wait for the same generated outputs.
 * Published context-mode packages already contain the outputs and return
 * immediately without touching disk.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(SCRIPT_DIR, "..");
const LOCK_DIR = join(PLUGIN_ROOT, ".context-mode-source-build.lock");
const WAIT_MS = 250;
const WAIT_TIMEOUT_MS = 180_000;
const STALE_LOCK_MS = 300_000;
const REQUIRED_OUTPUTS = [
  "server.bundle.mjs",
  "cli.bundle.mjs",
  join("hooks", "security.bundle.mjs"),
  join("hooks", "session-db.bundle.mjs"),
  join("hooks", "session-extract.bundle.mjs"),
  join("hooks", "session-attribution.bundle.mjs"),
  join("hooks", "session-snapshot.bundle.mjs"),
];

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const outputsReady = () => REQUIRED_OUTPUTS.every((path) => existsSync(join(PLUGIN_ROOT, path)));
const isSourceCheckout = () =>
  existsSync(join(PLUGIN_ROOT, "src", "server.ts")) &&
  existsSync(join(PLUGIN_ROOT, "package.json"));

function findBun() {
  if (typeof globalThis.Bun !== "undefined") return process.execPath;
  const candidates = [
    process.env.BUN_INSTALL ? join(process.env.BUN_INSTALL, "bin", "bun") : null,
    join(homedir(), ".bun", "bin", "bun"),
    "/usr/local/bin/bun",
    "/usr/bin/bun",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function run(command, args, timeout) {
  execFileSync(command, args, {
    cwd: PLUGIN_ROOT,
    env: process.env,
    stdio: ["ignore", "ignore", "pipe"],
    timeout,
    windowsHide: true,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
  });
}

function installBuildDependencies() {
  if (existsSync(join(PLUGIN_ROOT, "node_modules", ".bin", "tsc"))) return;
  const bun = findBun();
  if (bun) {
    run(bun, ["install", "--frozen-lockfile"], WAIT_TIMEOUT_MS);
    return;
  }
  run(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "--no-audit", "--no-fund", "--silent"],
    WAIT_TIMEOUT_MS,
  );
}

function buildRuntimeArtifacts() {
  installBuildDependencies();
  run(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "build", "--silent"],
    WAIT_TIMEOUT_MS,
  );
}

function removeStaleLock() {
  try {
    if (Date.now() - statSync(LOCK_DIR).mtimeMs > STALE_LOCK_MS) {
      rmSync(LOCK_DIR, { recursive: true, force: true });
    }
  } catch {
    // Another process may have released the lock between stat and cleanup.
  }
}

export async function ensureSourceBuild() {
  if (outputsReady() || !isSourceCheckout()) return;

  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let ownsLock = false;
    try {
      mkdirSync(LOCK_DIR);
      ownsLock = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      removeStaleLock();
    }

    if (ownsLock) {
      try {
        if (!outputsReady()) buildRuntimeArtifacts();
      } finally {
        rmSync(LOCK_DIR, { recursive: true, force: true });
      }
      if (outputsReady()) return;
      throw new Error("context-mode source build completed without required runtime artifacts");
    }

    if (outputsReady()) return;
    await delay(WAIT_MS);
  }

  throw new Error(`timed out waiting for context-mode source build lock: ${LOCK_DIR}`);
}

await ensureSourceBuild();
