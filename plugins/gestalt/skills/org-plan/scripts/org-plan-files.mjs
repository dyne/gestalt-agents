import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync as nodeChmodSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export function fail(message) {
  throw new Error(message);
}

export function resolvePlanPath(path) {
  const absolutePath = resolve(path);
  const input = lstatSync(absolutePath);
  if (!input.isFile() && !input.isSymbolicLink()) {
    fail("plan must be a regular non-symlink file");
  }

  const canonicalPath = input.isSymbolicLink()
    ? realpathSync(absolutePath)
    : join(realpathSync(dirname(absolutePath)), basename(absolutePath));
  const canonical = lstatSync(canonicalPath);
  if (canonical.isSymbolicLink() || !canonical.isFile()) {
    fail("plan must be a regular non-symlink file");
  }
  return canonicalPath;
}

// Keep chmod and mv on PATH so compatibility tests can inject deterministic
// failures at the same process boundary as the original Bash implementation.
export function chmodThroughPath(path, mode) {
  execFileSync("chmod", [mode.toString(8), path], { stdio: "ignore" });
  nodeChmodSync(path, mode);
}

export function renameThroughPath(source, target) {
  execFileSync("mv", [source, target], { stdio: "ignore" });
}

export function renameStatusThroughPath(source, target) {
  // Preserve cleanup and reporting if the injected compatibility seam receives
  // SIGTERM while moving the candidate into place.
  process.once("SIGTERM", () => {});
  renameThroughPath(source, target);
}

export function temporarySibling(path) {
  return join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
}
