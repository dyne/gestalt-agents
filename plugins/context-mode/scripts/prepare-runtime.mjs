#!/usr/bin/env node
/** Prepare immutable context-mode runtime artifacts before Codex starts MCP. */
import { execFileSync } from "node:child_process";
import { runCommand } from "./native-command.mjs";
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
function findBun() {
  const selection = process.env.CONTEXT_MODE_PACKAGE_MANAGER ?? "auto";
  if (!new Set(["auto", "bun", "npm"]).has(selection)) {
    throw new Error(`CONTEXT_MODE_PACKAGE_MANAGER must be auto, bun, or npm; found ${selection}`);
  }
  if (selection === "npm") return null;
  if (typeof globalThis.Bun !== "undefined") return process.execPath;
  const candidates = [
    process.env.BUN_INSTALL ? join(process.env.BUN_INSTALL, "bin", process.platform === "win32" ? "bun.exe" : "bun") : null,
    join(homedir(), ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun"),
    "/usr/local/bin/bun",
    "/usr/bin/bun",
  ].filter(Boolean);
  const bun = candidates.find((candidate) => {
    if (!existsSync(candidate)) return false;
    try {
      execFileSync(candidate, ["--version"], {
        stdio: "ignore",
        timeout: 1_000,
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  }) ?? null;
  if (selection === "bun" && !bun) {
    throw new Error("CONTEXT_MODE_PACKAGE_MANAGER=bun but no working Bun executable was found");
  }
  return bun;
}

function run(pluginRoot, tempDir, command, args, timeout = WAIT_TIMEOUT_MS) {
  mkdirSync(tempDir, { recursive: true });
  runCommand(command, args, {
    cwd: pluginRoot,
    env: {
      ...scratchEnvironment(process.env),
      ...(!Object.hasOwn(process.env, "GESTALT_SESSION_TMP_CONTEXT") ? { TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir } : {}),
      BUN_INSTALL_CACHE_DIR: join(tempDir, "bun-cache"),
      npm_config_cache: join(tempDir, "npm-cache"),
      ESBUILD_BINARY_PATH: "", // Use the locked platform package, not an external override.
    },
    stdio: "inherit",
    timeout,
    windowsHide: true,
  });
}

function installBuildDependencies(pluginRoot, tempDir) {
  const bun = findBun();
  if (bun) {
    run(pluginRoot, tempDir, bun, ["install", "--frozen-lockfile", "--ignore-scripts"]);
    return;
  }
  run(
    pluginRoot,
    tempDir,
    "npm",
    ["ci", "--no-audit", "--no-fund", "--ignore-scripts=true", "--include=optional"],
  );
}

function buildRuntimeArtifacts(pluginRoot, tempDir) {
  installBuildDependencies(pluginRoot, tempDir);
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
  run(pluginRoot, tempDir, process.execPath, [require.resolve("esbuild/install.js")]);
  const sqliteRoot = dirname(require.resolve("better-sqlite3/package.json"));
  const sqliteRequire = createRequire(join(sqliteRoot, "package.json"));
  try {
    run(sqliteRoot, tempDir, process.execPath, [sqliteRequire.resolve("prebuild-install/bin.js")]);
  } catch (error) {
    throw new Error(`context-mode requires a prebuilt better-sqlite3 binary for ${process.platform}/${process.arch}/Node ABI ${process.versions.modules}; native compilation is not attempted`, { cause: error });
  }
  verifyNativeDependencies(pluginRoot);
  run(pluginRoot, tempDir, process.execPath, [require.resolve("typescript/bin/tsc"), "--noEmit"]);
  run(pluginRoot, tempDir, process.execPath, [join(pluginRoot, "scripts/build-runtime.mjs")]);
  run(pluginRoot, tempDir, process.execPath, [join(pluginRoot, "scripts/assert-bundle.mjs"), ...BUNDLES.map(([, output]) => output)]);
}

function verifyNativeDependencies(pluginRoot) {
  const require = createRequire(join(pluginRoot, "package.json"));
  const Database = require("better-sqlite3");
  const database = new Database(":memory:");
  database.close();
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

export async function prepareRuntime(pluginRoot = DEFAULT_PLUGIN_ROOT, { force = false } = {}) {
  scratchEnvironment(process.env); // Present-invalid context fails before any writes.
  const lockDir = join(pluginRoot, ".context-mode-prepare.lock");
  const tempDir = join(pluginRoot, ".context-mode-prepare-tmp");
  if (!force && verifyPreparedRuntime(pluginRoot).ok) return;

  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const releaseLock = tryAcquireRuntimeLock(lockDir);
    if (releaseLock) {
      try {
        if (force || !verifyPreparedRuntime(pluginRoot).ok) {
          buildRuntimeArtifacts(pluginRoot, tempDir);
          verifyNativeDependencies(pluginRoot);
          writeManifest(pluginRoot);
        }
      } finally {
        try { rmSync(tempDir, { recursive: true, force: true }); }
        finally { releaseLock(); }
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

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
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
