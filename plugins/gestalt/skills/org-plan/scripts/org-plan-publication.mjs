import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  chmodThroughPath,
  fail,
  renameStatusThroughPath,
  resolvePlanPath,
} from "./org-plan-files.mjs";

function safeStatusDirectory(path) {
  try {
    const canonicalPath = realpathSync(path);
    const status = lstatSync(canonicalPath);
    if (
      status.isSymbolicLink() ||
      !status.isDirectory() ||
      status.uid !== process.getuid() ||
      status.mode & 0o022
    ) {
      fail("unsafe status file directory");
    }
    return canonicalPath;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "unsafe status file directory"
    ) {
      throw error;
    }
    fail("unsafe status file directory");
  }
}

function validateStatusTarget(path) {
  try {
    const status = lstatSync(path);
    if (status.isSymbolicLink()) fail("status file must not be a symlink");
    if (!status.isFile()) fail("status file must be a regular file");
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT"))
      throw error;
  }
}

export function publishStatus(path, reason) {
  const directoryInput = process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY;
  const legacyFile = process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE;
  if (!directoryInput && !legacyFile)
    return { attempted: false, published: false };

  try {
    const planPath = resolvePlanPath(path);
    let directory;
    let targetName;
    if (directoryInput) {
      if (!isAbsolute(directoryInput))
        fail("status directory must be absolute");
      directory = safeStatusDirectory(directoryInput);
      targetName = `${createHash("sha256").update(planPath).digest("hex")}.plan-status.json`;
    } else {
      if (!isAbsolute(legacyFile)) fail("status file must be absolute");
      directory = safeStatusDirectory(dirname(legacyFile));
      targetName = basename(legacyFile);
    }

    const target = join(directory, targetName);
    validateStatusTarget(target);
    const temporary = join(directory, `.${targetName}.tmp.${randomUUID()}`);
    try {
      const record = {
        schemaVersion: 1,
        planPath,
        reason,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      chmodThroughPath(temporary, 0o600);
      renameStatusThroughPath(temporary, target);
    } catch (error) {
      try {
        unlinkSync(temporary);
      } catch {}
      throw error;
    }
    return { attempted: true, published: true, path: target };
  } catch (error) {
    return {
      attempted: true,
      published: false,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}
