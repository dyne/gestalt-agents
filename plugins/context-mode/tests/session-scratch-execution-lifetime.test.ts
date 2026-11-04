import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PolyglotExecutor } from "../src/executor.js";
import type { RuntimeMap } from "../src/runtime.js";
import { resolveSessionScratch } from "../scripts/session-scratch.mjs";

// This file must never launch a real command, including runtime probes.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => { throw new Error("Unexpected process probe"); }),
  execSync: vi.fn(() => { throw new Error("Unexpected process execution"); }),
  execFileSync: vi.fn(() => { throw new Error("Unexpected runtime probe"); }),
}));

const runtimes: RuntimeMap = {
  javascript: process.execPath, typescript: null, python: null, shell: "/bin/sh",
  ruby: null, go: null, rust: null, php: null, perl: null, r: null,
  elixir: null, csharp: null,
};

type Lease = {
  schemaVersion: number; ownerId: string; workspacePath: string; leaseId: string;
  processIdentity: string; state: string; consumers: string[];
  createdAt: string; updatedAt: string;
};

let root: string;
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(childProcess.spawn).mockReset();
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "ctx-lifetime-")));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function mobileOwner() {
  const workspacePath = join(root, "workspace with spaces");
  const sessionId = "execution-lifetime";
  const ownerId = "mobile-" + createHash("sha256").update(sessionId).digest("hex");
  const directory = join(workspacePath, "tmp", "sessions", ownerId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const markerPath = join(directory, ".gestalt-owner.json");
  fs.writeFileSync(markerPath, JSON.stringify({
    schemaVersion: 1, ownerKind: "mobile-session", ownerId, workspacePath,
    sessionId, createdAt: new Date().toISOString(),
    authority: { kind: "mobile-roster", sessionId }, providerThreads: [],
  }), { mode: 0o600 });
  const context = { schemaVersion: 1, workspacePath, ownerId, directory, markerPath };
  vi.stubEnv("GESTALT_SESSION_TMP_CONTEXT", JSON.stringify(context));
  for (const name of ["TMPDIR", "TMP", "TEMP"])
    vi.stubEnv(name, join(root, "untrusted-ambient-temp"));
  expect(resolveSessionScratch()).toEqual(context);
  return context;
}

// Read the public v1 records that cleanup consumes, without depending on a
// proposed adapter, lease filename, consumer label or in-memory registry.
function leases(directory: string): Lease[] {
  const path = join(directory, "leases");
  if (!fs.existsSync(path)) return [];
  expect(fs.statSync(path).mode & 0o777).toBe(0o700);
  return fs.readdirSync(path).map(name => {
    const file = join(path, name);
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(false);
    expect(fs.statSync(file).mode & 0o077).toBe(0);
    const lease = JSON.parse(fs.readFileSync(file, "utf8")) as Lease;
    expect(name).toBe(lease.leaseId + ".json");
    return lease;
  });
}

test.each(["foreground", "background"] as const)(
  "%s managed execution protects its owner before spawn until its group is absent",
  async mode => {
    const owner = mobileOwner();
    const child = Object.assign(new EventEmitter(), {
      pid: 2147483000,
      stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
      exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(() => true), unref: vi.fn(),
    });
    let groupPresent = true;
    // A simulated group may outlive its leader. Never probe or signal the OS.
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      expect(pid).toBe(-child.pid);
      if (signal === 0 && !groupPresent)
        throw Object.assign(new Error("No such group"), { code: "ESRCH" });
      return true;
    });
    let protectionAtSpawn: Lease[] = [];
    vi.mocked(childProcess.spawn).mockImplementation((..._args: unknown[]) => {
      protectionAtSpawn = leases(owner.directory).filter(lease => lease.state === "active");
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });
    const executor = new PolyglotExecutor({ runtimes, projectRoot: owner.workspacePath });
    let settled = false;
    const executing = executor.execute({
      language: "javascript", code: "setInterval(() => {}, 1000)",
      ...(mode === "background" ? { background: true, timeout: 100 } : {}),
    }).finally(() => { settled = true; });
    const closeLeader = () => {
      if (child.exitCode !== null) return;
      child.exitCode = 0;
      child.emit("exit", 0, null);
      child.stdout.end(); child.stderr.end();
      child.emit("close", 0, null);
    };
    try {
      await vi.waitFor(() => expect(childProcess.spawn).toHaveBeenCalledOnce());
      expect(protectionAtSpawn, "detached execution must publish durable protection before spawn")
        .toHaveLength(1);
      const claim = protectionAtSpawn[0];
      expect(claim).toMatchObject({
        schemaVersion: 1, ownerId: owner.ownerId, workspacePath: owner.workspacePath,
        state: "active",
      });
      expect(claim.consumers.length).toBeGreaterThan(0);
      expect(claim.processIdentity).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
      expect(Number.isFinite(Date.parse(claim.createdAt))).toBe(true);
      expect(Number.isFinite(Date.parse(claim.updatedAt))).toBe(true);
      if (mode === "background") {
        await vi.advanceTimersByTimeAsync(100);
        expect(await executing).toMatchObject({ backgrounded: true });
      } else {
        expect(settled).toBe(false);
      }
      executor.cleanupBackgrounded();
      expect(leases(owner.directory).find(lease => lease.leaseId === claim.leaseId)?.state)
        .toBe("active");
      closeLeader();
      await vi.advanceTimersByTimeAsync(100);
      expect(leases(owner.directory).find(lease => lease.leaseId === claim.leaseId)?.state,
        "leader close does not establish group release").toBe("active");
      groupPresent = false;
      await vi.advanceTimersByTimeAsync(5000);
      await executing;
      expect(leases(owner.directory).find(lease => lease.leaseId === claim.leaseId))
        .toMatchObject({ state: "released", consumers: [] });
    } finally {
      groupPresent = false;
      closeLeader();
      await vi.advanceTimersByTimeAsync(5000);
      await executing;
      child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
    }
  },
);
