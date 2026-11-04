import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { borrowSessionScratch, resolveSessionScratch } from "../scripts/session-scratch.mjs";
import { ManagedExecutionLifetime } from "../src/execution-lifetime.js";
import type { ChildProcess } from "node:child_process";
import { PolyglotExecutor } from "../src/executor.js";
import type { RuntimeMap } from "../src/runtime.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => { throw new Error("Unexpected process probe"); }),
  execSync: vi.fn(() => { throw new Error("Unexpected process execution"); }),
  execFileSync: vi.fn(() => { throw new Error("Unexpected runtime probe"); }),
}));

const runtimes: RuntimeMap = {
  javascript: process.execPath, typescript: null, python: null, shell: "/bin/sh",
  ruby: null, go: null, rust: "rustc", php: null, perl: null, r: null,
  elixir: null, csharp: null,
};

let root: string;
beforeEach(() => {
  vi.mocked(childProcess.spawn).mockReset();
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "ctx-borrower-")));
});

function fakeChild(pid?: number) {
  const child = Object.assign(new EventEmitter(), {
    pid, exitCode: null as number | null, signalCode: null,
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    kill: vi.fn(() => true), unref: vi.fn(),
  });
  return Object.assign(child, {
    close() {
      if (child.exitCode !== null) return;
      child.exitCode = 0;
      child.emit("exit", 0, null);
      child.stdout.end(); child.stderr.end(); child.stdin.end();
      child.emit("close", 0, null);
    },
  });
}

test.each(["throw", "error-event"])("spawn %s retires only its never-started execution claim", async failure => {
  const context = owner(), child = fakeChild();
  vi.mocked(childProcess.spawn).mockImplementation(() => {
    if (failure === "throw") throw new Error("fixture spawn failure");
    return child as unknown as ReturnType<typeof childProcess.spawn>;
  });
  const executor = new PolyglotExecutor({ runtimes, projectRoot: context.workspacePath });
  const executing = executor.execute({ language: "javascript", code: "void 0" });
  if (failure === "throw") await expect(executing).rejects.toThrow("fixture spawn failure");
  else {
    try {
      expect(records(context.directory)[0].state).toBe("active");
      child.emit("error", new Error("fixture spawn failure"));
      expect(await executing).toMatchObject({ exitCode: 1, processError: "fixture spawn failure" });
    } finally { child.close(); await executing; }
  }
  expect(records(context.directory)).toHaveLength(1);
  expect(records(context.directory)[0]).toMatchObject({ state: "released", consumers: [] });
});

test("managed Rust compilation and runtime share protection across both groups", async () => {
  vi.useFakeTimers();
  const context = owner(), compiler = fakeChild(2147483000), program = fakeChild(2147482999);
  const absent = new Set<number>();
  vi.spyOn(process, "kill").mockImplementation(pid => {
    if (absent.has(-pid)) throw Object.assign(new Error("absent"), { code: "ESRCH" });
    return true;
  });
  const claimsAtSpawn: string[][] = [];
  vi.mocked(childProcess.spawn).mockImplementation(() => {
    claimsAtSpawn.push(records(context.directory).filter(value => value.state === "active").map(value => value.leaseId));
    return (claimsAtSpawn.length === 1 ? compiler : program) as unknown as ReturnType<typeof childProcess.spawn>;
  });
  const executing = new PolyglotExecutor({ runtimes, projectRoot: context.workspacePath })
    .execute({ language: "rust", code: "fn main() {}" });
  try {
    expect(claimsAtSpawn[0]).toHaveLength(1);
    absent.add(compiler.pid!); compiler.close();
    await vi.waitFor(() => expect(childProcess.spawn).toHaveBeenCalledTimes(2));
    expect(vi.mocked(childProcess.spawn).mock.calls[0][0]).toBe("rustc");
    expect(claimsAtSpawn[1]).toEqual(claimsAtSpawn[0]);
    absent.add(program.pid!); program.close();
    expect(await executing).toMatchObject({ exitCode: 0 });
    expect(records(context.directory)[0]).toMatchObject({ state: "released", consumers: [] });
  } finally {
    absent.add(compiler.pid!); absent.add(program.pid!);
    compiler.close(); program.close();
    await vi.advanceTimersByTimeAsync(5000);
    await executing;
  }
});

test("bounded shutdown retains a live claim and later absence can finish its release", async () => {
  vi.useFakeTimers();
  const context = owner(), child = fakeChild(2147483000);
  let absent = false;
  vi.spyOn(process, "kill").mockImplementation(() => {
    if (absent) throw Object.assign(new Error("absent"), { code: "ESRCH" });
    return true;
  });
  vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);
  const executor = new PolyglotExecutor({ runtimes, projectRoot: context.workspacePath });
  const executing = executor.execute({ language: "javascript", code: "void 0", background: true, timeout: 100 });
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(await executing).toMatchObject({ backgrounded: true });
    const stopping = executor.shutdownManagedExecutions();
    await vi.advanceTimersByTimeAsync(3600);
    await stopping;
    expect(records(context.directory)[0].state).toBe("active");
    child.close(); // Even this event is insufficient while the group is present.
    await vi.advanceTimersByTimeAsync(100);
    expect(records(context.directory)[0].state).toBe("active");
    absent = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(records(context.directory)[0]).toMatchObject({ state: "released", consumers: [] });
    await expect(executor.execute({ language: "javascript", code: "void 0" }))
      .rejects.toThrow("SESSION_EXECUTION_STOPPING");
  } finally {
    absent = true; child.close();
    await vi.advanceTimersByTimeAsync(5000);
    await executing;
  }
});
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function owner(kind = "mobile-session") {
  const workspacePath = join(root, "workspace");
  const sessionId = kind === "mobile-session" ? "session" : (kind === "cli-session" ? "cli-" : "service-") + randomUUID();
  const ownerId = kind === "mobile-session" ? "mobile-" + createHash("sha256").update(sessionId).digest("hex") : sessionId;
  const directory = join(workspacePath, "tmp", "sessions", ownerId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const leaseId = randomUUID(), time = new Date().toISOString();
  const markerPath = join(directory, ".gestalt-owner.json");
  fs.writeFileSync(markerPath, JSON.stringify({ schemaVersion: 1, ownerKind: kind,
    ownerId, workspacePath, sessionId, createdAt: time, providerThreads: [],
    authority: kind === "mobile-session" ? { kind: "mobile-roster", sessionId } : { kind: "lease", leaseId },
  }), { mode: 0o600 });
  if (kind !== "mobile-session") {
    fs.mkdirSync(join(directory, "leases"), { mode: 0o700 });
    fs.writeFileSync(join(directory, "leases", leaseId + ".json"), JSON.stringify({
      schemaVersion: 1, ownerId, workspacePath, leaseId, state: "active", processIdentity: randomUUID(),
      createdAt: time, updatedAt: time, consumers: ["primary-controller"],
    }), { mode: 0o600 });
  }
  const context = { schemaVersion: 1, workspacePath, ownerId, directory, markerPath };
  vi.stubEnv("GESTALT_SESSION_TMP_CONTEXT", JSON.stringify(context));
  expect(resolveSessionScratch()).toEqual(context);
  return context;
}
const records = (directory: string) => fs.readdirSync(join(directory, "leases"))
  .map(name => JSON.parse(fs.readFileSync(join(directory, "leases", name), "utf8")));

test.each(["mobile-session", "cli-session", "workspace-service"])(
  "%s borrowers preserve primary metadata, simultaneous consumers and released records", kind => {
    const context = owner(kind), marker = fs.readFileSync(context.markerPath, "utf8");
    const primary = kind === "mobile-session" ? [] : records(context.directory);
    const first = borrowSessionScratch()!, second = borrowSessionScratch()!;
    expect(records(context.directory).filter(value => value.state === "active")).toHaveLength(primary.length + 2);
    first.release(); first.release();
    const afterFirst = records(context.directory);
    expect(afterFirst.filter(value => value.state === "released")).toHaveLength(1);
    expect(afterFirst.filter(value => value.state === "active")).toHaveLength(primary.length + 1);
    const third = borrowSessionScratch()!;
    second.release(); third.release();
    expect(records(context.directory).filter(value => value.state === "released" && value.consumers.length === 0)).toHaveLength(3);
    for (const value of primary) expect(records(context.directory)).toContainEqual(value);
    expect(fs.readFileSync(context.markerPath, "utf8")).toBe(marker);
  },
);

test.each([".containment-lock", ".controller-lock", ".association-lock"])(
  "retains an existing %s without publishing a borrower", name => {
    const context = owner();
    fs.mkdirSync(join(context.directory, name), { mode: 0o700 });
    expect(() => borrowSessionScratch()).toThrow();
    expect(fs.existsSync(join(context.directory, "leases"))).toBe(false);
    expect(fs.readdirSync(join(context.directory, name))).toEqual([]);
  },
);

test("invalid context, linked leases and malformed records never publish or repair ownership", () => {
  const context = owner();
  vi.stubEnv("GESTALT_SESSION_TMP_CONTEXT", "{}");
  expect(() => borrowSessionScratch()).toThrow("SESSION_SCRATCH_INVALID_CONTEXT");
  vi.stubEnv("GESTALT_SESSION_TMP_CONTEXT", JSON.stringify(context));
  const outside = join(root, "outside"); fs.mkdirSync(outside);
  fs.symlinkSync(outside, join(context.directory, "leases"), "dir");
  expect(() => borrowSessionScratch()).toThrow();
  expect(fs.readdirSync(outside)).toEqual([]);
  fs.unlinkSync(join(context.directory, "leases"));
  fs.mkdirSync(join(context.directory, "leases"), { mode: 0o700 });
  const broken = join(context.directory, "leases", "broken.json");
  fs.writeFileSync(broken, "{}", { mode: 0o600 });
  expect(() => borrowSessionScratch()).toThrow();
  expect(fs.readFileSync(broken, "utf8")).toBe("{}");
});

test("unknown group probes retain protection until a later positive absence observation", async () => {
  vi.useFakeTimers();
  const context = owner();
  let absent = false;
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("probe"), { code: absent ? "ESRCH" : "EPERM" });
  });
  const child = Object.assign(new EventEmitter(), { pid: 2147483000, exitCode: 0, signalCode: null });
  const lifetime = ManagedExecutionLifetime.begin(() => {})!;
  lifetime.track(child as unknown as ChildProcess);
  lifetime.finish(() => {});
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(records(context.directory)[0].state).toBe("active");
    absent = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(records(context.directory)[0]).toMatchObject({ state: "released", consumers: [] });
  } finally {
    absent = true;
    await vi.advanceTimersByTimeAsync(100);
  }
});
