/** Read-only consumer of docs/session-scratch.md's shared v1 ownership contract. */
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

export const SESSION_TMP_CONTEXT = "GESTALT_SESSION_TMP_CONTEXT";
// Canonical generated SessionStart/subagent reminder; keep this conditional
// so standalone/operator temporary roots retain their documented behavior.
export const SESSION_SCRATCH_GUIDANCE = "With GESTALT_SESSION_TMP_CONTEXT, use validated owner TMPDIR; children inherit context + TMPDIR/TMP/TEMP. Keep owner until Forget; DBs/evidence/caches stay persistent. No context: standalone fallback. Details: context-mode skill.";
const validId = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value);
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const timestamp = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const assert = condition => { if (!condition) throw new Error("invalid context"); };
const ownUid = info => !process.getuid || info.uid === process.getuid();

function canonical(directory) {
  assert(typeof directory === "string" && isAbsolute(directory) &&
    !/[\x00-\x1f\x7f]/.test(directory) && resolve(directory) === directory);
  let current = parse(directory).root;
  for (const part of directory.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = lstatSync(current);
    assert(info.isDirectory() && !info.isSymbolicLink());
  }
  assert(realpathSync(directory) === directory);
}

function privateDirectory(directory) {
  canonical(directory);
  const info = lstatSync(directory);
  assert(ownUid(info) && (process.platform === "win32" || (info.mode & 0o777) === 0o700));
}

function jsonRecord(file) {
  // O_NOFOLLOW and a single hard link prevent marker/lease aliases.
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = fstatSync(fd);
    assert(!lstatSync(file).isSymbolicLink() && info.isFile() && info.nlink === 1 &&
      info.size <= 16384 && ownUid(info) &&
      (process.platform === "win32" || (info.mode & 0o077) === 0));
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}

/** An absent context preserves operator fallback; any present invalid value fails. */
export function resolveSessionScratch(environment = process.env) {
  if (!Object.hasOwn(environment, SESSION_TMP_CONTEXT)) return null;
  try {
    const context = JSON.parse(environment[SESSION_TMP_CONTEXT]);
    assert(context?.schemaVersion === 1 && validId(context.ownerId));
    canonical(context.workspacePath);
    const container = join(context.workspacePath, "tmp", "sessions");
    assert(context.directory === join(container, context.ownerId) &&
      context.markerPath === join(context.directory, ".gestalt-owner.json"));
    // An existing user tmp parent keeps its modes; managed descendants are private.
    canonical(dirname(container));
    assert(ownUid(lstatSync(dirname(container))));
    privateDirectory(container);
    privateDirectory(context.directory);
    const marker = jsonRecord(context.markerPath);
    assert(marker?.schemaVersion === 1 && marker.ownerId === context.ownerId &&
      marker.workspacePath === context.workspacePath && validId(marker.sessionId) &&
      timestamp(marker.createdAt) && Array.isArray(marker.providerThreads) &&
      marker.providerThreads.every(thread => ["codex", "kimi"].includes(thread?.provider) && validId(thread.threadId)));
    if (marker.ownerKind === "mobile-session") {
      assert(context.ownerId === "mobile-" + createHash("sha256").update(marker.sessionId).digest("hex") &&
        marker.authority?.kind === "mobile-roster" && marker.authority.sessionId === marker.sessionId);
    } else {
      const prefix = marker.ownerKind === "cli-session" ? "cli-" : marker.ownerKind === "workspace-service" ? "service-" : "";
      assert(prefix && context.ownerId.startsWith(prefix) && uuid(context.ownerId.slice(prefix.length)) &&
        marker.sessionId === context.ownerId && marker.authority?.kind === "lease" && uuid(marker.authority.leaseId));
      const leases = join(context.directory, "leases");
      privateDirectory(leases);
      const lease = jsonRecord(join(leases, marker.authority.leaseId + ".json"));
      assert(lease?.schemaVersion === 1 && lease.ownerId === context.ownerId && lease.workspacePath === context.workspacePath &&
        lease.leaseId === marker.authority.leaseId && lease.state === "active" && uuid(lease.processIdentity) &&
        timestamp(lease.createdAt) && timestamp(lease.updatedAt) &&
        Array.isArray(lease.consumers) && lease.consumers.every(validId));
    }
    return context;
  } catch {
    // Do not expose private workspace paths or attacker-controlled JSON/errors.
    throw new Error("SESSION_SCRATCH_INVALID_CONTEXT: managed temporary context validation failed");
  }
}

export function resolveScratchDirectory(fallback = tmpdir) {
  return resolveSessionScratch()?.directory ?? fallback();
}

/** Forward the exact four-variable contract, deriving temp values from ownership. */
export function scratchEnvironment(environment = process.env) {
  const context = resolveSessionScratch(environment);
  return context ? { ...environment, TMPDIR: context.directory, TMP: context.directory, TEMP: context.directory } : { ...environment };
}
