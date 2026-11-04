/** Validated v1 consumer with delegated execution-borrower publication. */
import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
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
function resolveScratchContext(environment, allowReleased = false) {
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
        lease.leaseId === marker.authority.leaseId && (lease.state === "active" || allowReleased && lease.state === "released" && lease.consumers.length === 0) && uuid(lease.processIdentity) &&
        timestamp(lease.createdAt) && timestamp(lease.updatedAt) &&
        Array.isArray(lease.consumers) && lease.consumers.every(validId));
    }
    return context;
  } catch {
    // Do not expose private workspace paths or attacker-controlled JSON/errors.
    throw new Error("SESSION_SCRATCH_INVALID_CONTEXT: managed temporary context validation failed");
  }
}

export function resolveSessionScratch(environment = process.env) {
  return resolveScratchContext(environment);
}

export function resolveScratchDirectory(fallback = tmpdir) {
  return resolveSessionScratch()?.directory ?? fallback();
}

/** Forward the exact four-variable contract, deriving temp values from ownership. */
export function scratchEnvironment(environment = process.env) {
  const context = resolveSessionScratch(environment);
  return context ? { ...environment, TMPDIR: context.directory, TMP: context.directory, TEMP: context.directory } : { ...environment };
}

const identity = directory => {
  const info = lstatSync(directory, { bigint: true });
  assert(info.isDirectory() && !info.isSymbolicLink());
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`;
};

function leaseRecords(context) {
  const directory = join(context.directory, "leases");
  privateDirectory(directory);
  return readdirSync(directory).map(name => {
    const value = jsonRecord(join(directory, name));
    assert(uuid(value.leaseId) && name === value.leaseId + ".json" &&
      value.schemaVersion === 1 && value.ownerId === context.ownerId &&
      value.workspacePath === context.workspacePath && uuid(value.processIdentity) &&
      timestamp(value.createdAt) && timestamp(value.updatedAt) &&
      ["active", "released"].includes(value.state) && Array.isArray(value.consumers) &&
      value.consumers.every(validId) && (value.state !== "released" || value.consumers.length === 0));
    return value;
  });
}

/** Same outermost-first containment and owner fences as Mobile/Launcher. */
function withBorrowerFences(context, operation) {
  const ancestors = [], claims = [];
  const parts = context.directory.slice(parse(context.directory).root.length).split(sep).filter(Boolean);
  let directory = parse(context.directory).root;
  for (let index = 0; index < parts.length; index++) {
    directory = join(directory, parts[index]);
    if (index >= 2 && parts[index - 1] === "sessions" && parts[index - 2] === "tmp") {
      assert(ancestors.length < 64);
      const workspacePath = dirname(dirname(dirname(directory)));
      const locator = { schemaVersion: 1, workspacePath, ownerId: parts[index], directory,
        markerPath: join(directory, ".gestalt-owner.json") };
      // Capture the path per ancestor, not the mutable traversal variable.
      const path = directory;
      const provenance = () => {
        resolveScratchContext({ [SESSION_TMP_CONTEXT]: JSON.stringify(locator) }, true);
        const marker = jsonRecord(locator.markerPath);
        if (readdirSync(path).includes("leases")) leaseRecords(locator);
        else assert(marker.ownerKind === "mobile-session");
        return JSON.stringify([identity(path), marker.schemaVersion, marker.ownerKind,
          marker.ownerId, marker.workspacePath, marker.sessionId, marker.createdAt, marker.authority]);
      };
      ancestors.push({ path, provenance, expected: provenance() });
    }
  }
  const claim = path => {
    mkdirSync(path, { mode: 0o700 });
    const expected = identity(path);
    const held = { path, expected, fd: undefined };
    claims.push(held);
    privateDirectory(path);
    held.fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const info = fstatSync(held.fd, { bigint: true });
    assert(expected === `${info.dev}:${info.ino}:${info.birthtimeNs}`);
  };
  try {
    for (const ancestor of ancestors) {
      claim(join(ancestor.path, ".containment-lock"));
      assert(ancestor.expected === ancestor.provenance());
    }
    const marker = jsonRecord(context.markerPath);
    claim(join(context.directory, marker.ownerKind === "mobile-session" ? ".controller-lock" : ".association-lock"));
    resolveScratchContext({ [SESSION_TMP_CONTEXT]: JSON.stringify(context) }, true);
    for (const ancestor of ancestors) assert(ancestor.expected === ancestor.provenance());
    if (marker.ownerKind === "mobile-session")
      assert(!readdirSync(context.directory).includes(".association-lock"));
    return operation();
  } finally {
    let failure;
    for (const held of claims.reverse()) {
      try {
        assert(held.expected === identity(held.path));
        rmdirSync(held.path);
      } catch (error) { failure ??= error; }
      finally { if (held.fd !== undefined) closeSync(held.fd); }
    }
    if (failure) throw failure;
  }
}

function publishLease(file, value, initial = false) {
  const staged = initial ? file : join(dirname(file), "." + randomUUID() + ".json");
  const fd = openSync(staged, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
  if (!initial) renameSync(staged, file);
}

/** Delegated borrower only: never changes primary ownership or grants cleanup. */
export function borrowSessionScratch(environment = process.env) {
  const context = resolveSessionScratch(environment);
  if (!context) return null;
  try { return publishBorrower(context); }
  catch { throw new Error("SESSION_SCRATCH_BORROW_FAILED: managed execution protection unavailable"); }
}

function publishBorrower(context) {
  let record, file;
  withBorrowerFences(context, () => {
    // Recheck active primary authority after fencing against release/cleanup.
    resolveSessionScratch({ [SESSION_TMP_CONTEXT]: JSON.stringify(context) });
    const directory = join(context.directory, "leases");
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    leaseRecords(context);
    const leaseId = randomUUID(), time = new Date().toISOString();
    record = { schemaVersion: 1, ownerId: context.ownerId, workspacePath: context.workspacePath,
      leaseId, state: "active", processIdentity: randomUUID(), createdAt: time, updatedAt: time,
      consumers: ["context-mode-execution"] };
    file = join(directory, leaseId + ".json");
    publishLease(file, record, true);
  });
  let released = false;
  return {
    release() {
      if (released) return;
      withBorrowerFences(context, () => {
        const current = leaseRecords(context).find(value => value.leaseId === record.leaseId);
        assert(current && JSON.stringify(current) === JSON.stringify(record));
        publishLease(file, { ...record, state: "released", consumers: [], updatedAt: new Date().toISOString() });
        released = true;
      });
    },
  };
}
