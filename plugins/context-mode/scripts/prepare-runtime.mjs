#!/usr/bin/env node
/** Prepare immutable context-mode runtime artifacts before Codex starts MCP. */
import { SetupCommandContext } from "./setup-command-context.mjs";
import { scratchEnvironment } from "./session-scratch.mjs";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_FILES,
  verifyPreparedRuntime,
} from "./runtime-preflight.mjs";
import { runtimeLockTimeout, tryAcquireRuntimeLock } from "./runtime-lock.mjs";
import { BUNDLES } from "./build-runtime.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = resolve(SCRIPT_DIR, "..");
const MANIFEST = ".context-mode-prepared.json";
const WAIT_MS = 250;
const WAIT_TIMEOUT_MS = 180_000;

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function findBun(env, context, pluginRoot) {
  const selection = env.CONTEXT_MODE_PACKAGE_MANAGER ?? "auto";
  if (!["auto", "bun", "npm"].includes(selection)) throw new Error(`CONTEXT_MODE_PACKAGE_MANAGER must be auto, bun, or npm; found ${selection}`);
  if (selection === "npm") return null;
  if (typeof globalThis.Bun !== "undefined") return process.execPath;
  const home = env.HOME || env.USERPROFILE || homedir();
  const candidates = [env.BUN_INSTALL ? join(env.BUN_INSTALL, "bin", process.platform === "win32" ? "bun.exe" : "bun") : null,
    join(home, ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun"), "/usr/local/bin/bun", "/usr/bin/bun"].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try { await context.run(candidate, ["--version"], { env, cwd: pluginRoot, stdin: "ignore", stdout: async () => {}, stderr: async () => {}, timeout: 1000 }); return candidate; }
    catch { context.check(); if (!context.canCleanup()) throw new Error("Bun probe ownership is unknown; retain preparation state"); }
  }
  if (selection === "bun") throw new Error("CONTEXT_MODE_PACKAGE_MANAGER=bun but no working Bun executable was found");
  return null;
}

async function run(pluginRoot, tempDir, command, args, context, env, timeout = WAIT_TIMEOUT_MS) {
  mkdirSync(tempDir, { recursive: true });
  await context.run(command, args, {
    cwd: pluginRoot,
    env: {
      ...scratchEnvironment(env),
      ...(!Object.hasOwn(env, "GESTALT_SESSION_TMP_CONTEXT") ? { TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir } : {}),
      BUN_INSTALL_CACHE_DIR: join(tempDir, "bun-cache"),
      npm_config_cache: join(tempDir, "npm-cache"),
      ESBUILD_BINARY_PATH: "", // Use the locked platform package, not an external override.
    },
    timeout,
    windowsHide: true,
  });
}

async function installBuildDependencies(pluginRoot, tempDir, context, env) {
  const bun = await findBun(env, context, pluginRoot);
  if (bun) {
    await run(pluginRoot, tempDir, bun, ["install", "--frozen-lockfile", "--ignore-scripts"], context, env);
    return;
  }
  await run(
    pluginRoot,
    tempDir,
    "npm",
    ["ci", "--no-audit", "--no-fund", "--ignore-scripts=true", "--include=optional"], context, env,
  );
}

async function buildRuntimeArtifacts(pluginRoot, tempDir, context, env) {
  await installBuildDependencies(pluginRoot, tempDir, context, env);
  const require = createRequire(join(pluginRoot, "package.json"));
  const policy = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8")).allowScripts;
  if (JSON.stringify(policy) !== JSON.stringify({ "better-sqlite3": true, esbuild: true })) throw new Error("unexpected runtime dependency installer allowlist");
  // The esbuild installer otherwise attempts an npm-shell repair when its
  // optional platform package is omitted. Require the locked binary first.
  const esbuild = JSON.parse(readFileSync(require.resolve("esbuild/package.json"), "utf8"));
  const binaryName = `@esbuild/${process.platform}-${process.arch}`;
  let binary;
  try {
    const metadata = JSON.parse(readFileSync(require.resolve(`${binaryName}/package.json`), "utf8"));
    if (metadata.name !== binaryName || metadata.version !== esbuild.version || esbuild.optionalDependencies?.[binaryName] !== esbuild.version) throw new Error("platform package version mismatch");
    binary = require.resolve(`${binaryName}/${process.platform === "win32" ? "esbuild.exe" : "bin/esbuild"}`);
  } catch (error) {
    throw new Error(`locked esbuild platform binary is unavailable for ${process.platform}/${process.arch}; optional dependencies are required`, { cause: error });
  }
  if (!existsSync(binary)) throw new Error("locked esbuild platform binary is missing");
  // These are the only dependency install entrypoints. Invoke JS through Node
  // with literal argv/cwd; npm's .bin batch dispatch breaks paths containing &.
  await run(pluginRoot, tempDir, process.execPath, [require.resolve("esbuild/install.js")], context, env);
  const sqliteRoot = dirname(require.resolve("better-sqlite3/package.json"));
  const sqliteRequire = createRequire(join(sqliteRoot, "package.json"));
  try {
    await run(sqliteRoot, tempDir, process.execPath, [sqliteRequire.resolve("prebuild-install/bin.js")], context, env);
  } catch (error) {
    throw new Error(`context-mode requires a prebuilt better-sqlite3 binary for ${process.platform}/${process.arch}/Node ABI ${process.versions.modules}; native compilation is not attempted`, { cause: error });
  }
  await verifyNativeDependencies(pluginRoot, tempDir, context, env);
  await run(pluginRoot, tempDir, process.execPath, [require.resolve("typescript/bin/tsc"), "--noEmit"], context, env);
  await run(pluginRoot, tempDir, process.execPath, [join(pluginRoot, "scripts/build-runtime.mjs")], context, env);
  await run(pluginRoot, tempDir, process.execPath, [join(pluginRoot, "scripts/assert-bundle.mjs"), ...BUNDLES.map(([, output]) => output)], context, env);
}

async function verifyNativeDependencies(pluginRoot, tempDir, context, env) {
  // Loading third-party native code is an external command boundary too.
  const program = "const r=require('node:module').createRequire(process.argv[1]);const D=r('better-sqlite3');const d=new D(':memory:');d.close();";
  await run(pluginRoot, tempDir, process.execPath, ["-e", program, join(pluginRoot, "package.json")], context, env);
}

function writeManifest(pluginRoot) {
  const packageVersion = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8")).version;
  const files = {};
  for (const relative of REQUIRED_FILES) {
    const absolute = join(pluginRoot, relative);
    if (!existsSync(absolute)) throw new Error(`prepared runtime is missing ${relative}`);
    files[relative] = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  }
  writeFileSync(
    join(pluginRoot, MANIFEST),
    JSON.stringify({
      schemaVersion: 2,
      packageVersion,
      preparedAt: new Date().toISOString(),
      node: process.versions.node,
      nodeModulesAbi: process.versions.modules,
      platform: process.platform,
      arch: process.arch,
      bun: process.versions.bun ?? null,
      files,
    }, null, 2) + "\n",
  );
}

export async function prepareRuntime(pluginRoot = DEFAULT_PLUGIN_ROOT, { force = false, env = process.env, commandContext } = {}) {
  const context = commandContext ?? new SetupCommandContext({ environment: env, cwd: pluginRoot });
  context.check();
  scratchEnvironment(env); // Present-invalid context fails before any writes.
  const lockDir = join(pluginRoot, ".context-mode-prepare.lock");
  const tempDir = join(pluginRoot, ".context-mode-prepare-tmp");
  if (!force && verifyPreparedRuntime(pluginRoot).ok) return;

  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    context.check();
    const acquired = tryAcquireRuntimeLock(lockDir);
    const releaseLock = acquired ? context.protectLock(lockDir, acquired) : null;
    if (releaseLock) {
      try {
        if (force || !verifyPreparedRuntime(pluginRoot).ok) {
          await buildRuntimeArtifacts(pluginRoot, tempDir, context, env);
          await verifyNativeDependencies(pluginRoot, tempDir, context, env);
          writeManifest(pluginRoot);
        }
      } finally {
        if (context.canCleanup()) { try { rmSync(tempDir, { recursive: true, force: true }); } finally { releaseLock(); } }
        else { context.retain(tempDir); context.retain(lockDir); releaseLock(); }
      }
      const result = verifyPreparedRuntime(pluginRoot);
      if (!result.ok) throw new Error(`preparation incomplete: ${result.problems.join(", ")}`);
      return;
    }

    if (verifyPreparedRuntime(pluginRoot).ok) return;
    await delay(WAIT_MS);
  }
  throw new Error(`timed out waiting for preparation lock: ${runtimeLockTimeout(lockDir)}`);
}

function isDirectInvocation() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isDirectInvocation()) {
  const checkOnly = process.argv.includes("--check");
  const force = process.argv.includes("--force");
  if (checkOnly) {
    const result = verifyPreparedRuntime(DEFAULT_PLUGIN_ROOT);
    if (!result.ok) {
      process.stderr.write(`context-mode is not prepared: ${result.problems.join(", ")}\n`);
      process.exit(1);
    }
  } else {
    await prepareRuntime(DEFAULT_PLUGIN_ROOT, { force });
  }
  process.stdout.write(`context-mode prepared: ${DEFAULT_PLUGIN_ROOT}\n`);
}
