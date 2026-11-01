/** Same-filesystem directory locks; every published owner has a unique pathname. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const OWNER = /^owner-([1-9]\d*)-([0-9a-f-]{36})\.json$/;

function dead(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error?.code === "ESRCH"; }
}

function removeOwner(lockDir, name) {
  // No check-then-recursive-delete: a successor never reuses this owner name.
  try { unlinkSync(join(lockDir, name)); }
  catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  // Only the successful unlinker may attempt this removal, exactly once.
  // Other cleaners must not remove an empty successor during initialization.
  removeEmpty(lockDir);
}

function removeEmpty(lockDir) {
  // Cooperative acquisition uses mkdir, so no successor can initialize until
  // this removal finishes. Nonempty replacement also makes rmdir fail safely.
  try { rmdirSync(lockDir); }
  catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
  }
}

function recover(lockDir) {
  try {
    const names = readdirSync(lockDir);
    // Empty means unknown, including a crash before publication or after
    // unlink. Fail closed; elapsed time cannot distinguish a live initializer.
    if (names.length !== 1) return;
    let name = names[0];
    if (name === "owner.pid") {
      // Convert the ACTUAL record atomically, without deciding from an earlier
      // PID read. Keep the directory nonempty throughout. A replaced legacy
      // owner's record can move instead, so validate its moved contents below.
      name = `legacy-${randomUUID()}.pid`;
      renameSync(join(lockDir, "owner.pid"), join(lockDir, name));
    }
    if (/^legacy-[0-9a-f-]{36}\.pid$/.test(name)) {
      const value = readFileSync(join(lockDir, name), "utf8");
      if (!/^\s*[1-9]\d*\s*$/.test(value)) return;
      const pid = Number(value.trim());
      if (Number.isSafeInteger(pid) && dead(pid)) removeOwner(lockDir, name);
      return;
    }
    const match = OWNER.exec(name);
    if (!match) return;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid)) return;
    const owner = JSON.parse(readFileSync(join(lockDir, name), "utf8"));
    if (owner.pid !== pid || owner.token !== match[2] || owner.schemaVersion !== 1) return;
    if (dead(pid)) removeOwner(lockDir, name);
  } catch {
    // Missing, unreadable, partial or changing metadata never establishes death.
  }
}

export function tryAcquireRuntimeLock(lockDir) {
  // Crashed unpublished claims have private, never-reused names too. A live or
  // unprobeable PID is retained; there is no age-based scratch reclamation.
  const prefix = `${basename(lockDir)}.claim-`;
  for (const entry of readdirSync(dirname(lockDir))) {
    if (!entry.startsWith(prefix)) continue;
    const match = /^([1-9]\d*)-([0-9a-f-]{36})$/.exec(entry.slice(prefix.length));
    if (match && Number.isSafeInteger(Number(match[1])) && dead(Number(match[1]))) {
      rmSync(join(dirname(lockDir), entry), { recursive: true, force: true });
    }
  }
  const token = randomUUID();
  const name = `owner-${process.pid}-${token}.json`;
  const claim = `${lockDir}.claim-${process.pid}-${token}`;
  mkdirSync(claim);
  try {
    writeFileSync(join(claim, name), JSON.stringify({ schemaVersion: 1, pid: process.pid, token }) + "\n", { flag: "wx" });
    try {
      // mkdir is an atomic no-replace acquisition on all supported platforms.
      // Missing metadata, including a legacy initializer, is never reclaimed.
      mkdirSync(lockDir);
      renameSync(join(claim, name), join(lockDir, name));
      return () => removeOwner(lockDir, name);
    } catch (error) {
      if (error?.code !== "EEXIST" || !existsSync(lockDir)) throw error;
      recover(lockDir);
      return null;
    }
  } finally {
    // Private, never-reused name; never recursively remove the canonical lock.
    rmSync(claim, { recursive: true, force: true });
  }
}

export function runtimeLockTimeout(lockDir) {
  return `${lockDir}; owner is live or cannot be verified. Retry after the owner exits; inspect inaccessible or legacy lock metadata before manual cleanup.`;
}
