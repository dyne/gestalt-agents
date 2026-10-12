#!/usr/bin/env node
/** Trusted installation only; not an MCP tool or Live request operation. */
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { measureTree } from "../live-admission.mjs";

export async function prepareLiveRuntime(sourceRoot, target, { prepare, verify } = {}) {
  if (!isAbsolute(sourceRoot) || realpathSync(sourceRoot) !== sourceRoot || !isAbsolute(target)
    || resolve(target) !== target || realpathSync(dirname(target)) !== dirname(target)
    || target === sourceRoot || target.startsWith(`${sourceRoot}/`)) throw new Error("invalid-live-installation-path");
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("invalid-live-installation-path");
  const stage = `${target}.stage-${randomUUID()}`, backup = `${target}.backup-${randomUUID()}`, lock = `${target}.install.lock`;
  mkdirSync(lock, { mode: 0o700 });
  let backedUp = false, published = false;
  try {
    cpSync(sourceRoot, stage, {
      recursive: true,
      filter: (path) => {
        const name = relative(sourceRoot, path).split(sep)[0];
        return !["node_modules", "build"].includes(name) && !name.startsWith(".context-mode-prepare");
      },
    });
    const preparer = prepare ?? (await import(pathToFileURL(join(sourceRoot, "scripts/prepare-runtime.mjs")).href)).prepareRuntime;
    const verifier = verify ?? (await import(pathToFileURL(join(sourceRoot, "scripts/runtime-preflight.mjs")).href)).verifyPreparedRuntime;
    await preparer(stage, { force: true });
    if (!verifier(stage).ok) throw new Error("live-runtime-not-prepared");
    // npm's executable aliases are not runtime dependencies and are absent
    // from the Live PATH. Remove only .bin directories; all other symlinks are
    // rejected by the complete inventory below, never silently dereferenced.
    function normalize(directory) {
      chmodSync(directory, lstatSync(directory).mode & 0o755);
      for (const name of readdirSync(directory)) {
        const path = join(directory, name), info = lstatSync(path);
        if (name === ".bin" && directory.split(sep).includes("node_modules")) { rmSync(path, { recursive: true, force: true }); continue; }
        if (info.isSymbolicLink()) throw new Error("live-runtime-symlink");
        if (info.isDirectory()) normalize(path);
        else if (info.isFile()) chmodSync(path, info.mode & 0o755);
        else throw new Error("live-runtime-special-file");
      }
    }
    normalize(stage);
    const sha256 = measureTree(stage);
    if (existsSync(target)) { renameSync(target, backup); backedUp = true; }
    renameSync(stage, target); published = true;
    // Recheck installed bytes after rename before retiring the prior runtime.
    if (!verifier(target).ok || measureTree(target) !== sha256) throw new Error("live-runtime-publish-failed");
    rmSync(backup, { recursive: true, force: true });
    return { schemaVersion: 1, root: target, sha256 };
  } catch (error) {
    if (published) rmSync(target, { recursive: true, force: true });
    if (backedUp) renameSync(backup, target);
    throw error;
  } finally {
    rmSync(stage, { recursive: true, force: true });
    rmSync(lock, { recursive: true, force: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [sourceFlag, source, targetFlag, target, ...extra] = process.argv.slice(2);
    if (sourceFlag !== "--source" || targetFlag !== "--target" || extra.length) throw new Error("invalid-live-installation-command");
    process.stdout.write(`${JSON.stringify(await prepareLiveRuntime(source, target))}\n`);
  } catch { process.stderr.write("live-runtime-installation-unavailable\n"); process.exitCode = 1; }
}
