import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, realpathSync, renameSync } from "node:fs";
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

// Retain exported names for hosts while using native filesystem operations.
export function chmodThroughPath(path, mode) {
  chmodSync(path, mode);
}

export function renameThroughPath(source, target) {
  renameSync(source, target);
}

export function renameStatusThroughPath(source, target) {
  renameThroughPath(source, target);
}

export function temporarySibling(path) {
  return join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
}
