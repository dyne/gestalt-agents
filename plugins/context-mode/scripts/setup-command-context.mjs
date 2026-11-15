/** Async setup commands. Managed release proof is never inferred from child EOF. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { commandTarget, resolveExecutable } from "./native-command.mjs";

export const COMMAND_PORT_VERSION = 1;
const emptyInput = async function* () {};
const write = (stream, bytes) => new Promise((done, reject) => stream.write(bytes, (error) => error ? reject(error) : done()));
const statusOf = (result) => result.kind === "exit" ? result.code : result.kind === "signal"
  ? (Number.isInteger(Number(result.signal)) ? 128 + Number(result.signal) : ({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[result.signal] ?? 143)) : 1;
const validResult = (result) => result && (
  (result.kind === "exit" && Number.isInteger(result.code) && result.code >= 0) ||
  (result.kind === "signal" && typeof result.signal === "string") ||
  (result.kind === "spawn-error" && typeof result.message === "string")
);

export class SetupCommandFailure extends Error {
  constructor(message, status = 1) { super(message); this.status = status; }
}

/** Legacy standalone compatibility only; this adapter makes NO tree claim. */
export function standaloneCommandPort() {
  return {
    apiVersion: COMMAND_PORT_VERSION,
    async launch(executable, invocation, streams) {
      const id = randomUUID();
      const inheritedInput = streams.stdin === process.stdin;
      let cancelled = false, finished = false, result, escalation;
      const child = spawn(executable, invocation.argv, {
        cwd: invocation.cwd, env: invocation.environment, shell: false, windowsHide: true,
        stdio: [inheritedInput ? "inherit" : "pipe", "pipe", "pipe"],
      });
      let resolveResult, resolveCompleted;
      const outcome = new Promise((done) => { resolveResult = done; });
      const completed = new Promise((done) => { resolveCompleted = done; });
      const observe = (value) => { if (!result) { result = value; resolveResult(value); } };
      child.on("error", (error) => observe({ kind: "spawn-error", message: error.message }));
      child.on("exit", (code, signal) => observe(signal ? { kind: "signal", signal } : { kind: "exit", code: code ?? 1 }));
      const readers = [
        (async () => { for await (const bytes of child.stdout) await streams.stdout(bytes); })(),
        (async () => { for await (const bytes of child.stderr) await streams.stderr(bytes); })(),
      ];
      for (const reader of readers) void reader.catch(() => { cancelled = true; child.kill(); });
      if (!inheritedInput) {
        child.stdin.on("error", () => {});
        void (async () => {
          try {
            for await (const bytes of streams.stdin) {
              if (child.exitCode !== null || child.signalCode !== null) break;
              await write(child.stdin, bytes);
            }
            child.stdin.end();
          } catch { if (child.exitCode === null && child.signalCode === null) child.kill(); }
        })();
      }
      child.once("close", () => {
        void Promise.allSettled(readers).then(() => {
          finished = true;
          clearTimeout(escalation);
          observe({ kind: "spawn-error", message: "command ended without an observed result" });
          resolveCompleted(cancelled
            ? { kind: "unknown", lease: id, reason: "Standalone interruption cannot prove descendant absence" }
            : { kind: "standalone", lease: id, scope: "direct-child", completeTree: false, result });
        });
      });
      let stopping;
      const stop = () => {
        stopping ??= (async () => {
          if (!finished && child.exitCode === null && child.signalCode === null) {
            cancelled = true; child.kill("SIGTERM");
            escalation = setTimeout(() => child.kill("SIGKILL"), 1000); escalation.unref();
          }
          let timer;
          const claim = await Promise.race([completed, new Promise((done) => {
            timer = setTimeout(() => done({ kind: "unknown", lease: id, reason: "Standalone stop deadline; retain transaction state" }), 10_000);
          })]);
          clearTimeout(timer);
          return claim;
        })();
        return stopping;
      };
      return { id, result: outcome, completed, stop };
    },
  };
}

/** One call-scoped context is threaded through every setup filesystem owner. */
export class SetupCommandContext {
  constructor({ mode = "standalone", commands, environment = process.env, cwd = process.cwd(), streams = {}, signal } = {}) {
    if (!["standalone", "managed"].includes(mode)) throw new Error("setup execution mode must be standalone or managed");
    if (mode === "managed" && (!commands || commands.apiVersion !== COMMAND_PORT_VERSION || typeof commands.launch !== "function"))
      throw new Error("managed setup requires an explicit version1 owned command capability");
    if (mode === "standalone" && commands !== undefined) throw new Error("an injected owned command capability requires managed setup mode");
    if (!isAbsolute(cwd)) throw new Error("setup command cwd must be absolute");
    for (const name of ["stdout", "stderr"]) if (streams[name] !== undefined && typeof streams[name] !== "function") throw new Error(`setup ${name} stream must be an asynchronous byte callback`);
    if (streams.stdin !== undefined && typeof streams.stdin?.[Symbol.asyncIterator] !== "function") throw new Error("setup stdin must be an asynchronous byte iterable");
    this.mode = mode;
    this.commands = commands ?? standaloneCommandPort();
    this.environment = Object.freeze({ ...environment });
    this.cwd = cwd;
    this.streams = {
      stdin: streams.stdin ?? (mode === "standalone" ? process.stdin : emptyInput()),
      stdout: streams.stdout ?? ((bytes) => write(process.stdout, bytes)),
      stderr: streams.stderr ?? ((bytes) => write(process.stderr, bytes)),
    };
    this.signal = signal;
    this.active = new Set();
    this.locks = new Set();
    this.unknown = [];
    this.retained = new Set();
  }
  cancellationStatus() { return this.signal?.aborted ? this.signal.reason?.status || 130 : 0; }
  check() {
    if (this.signal?.aborted) throw new SetupCommandFailure("setup interrupted", this.cancellationStatus());
    if (this.unknown.length && process.platform !== "darwin") throw new SetupCommandFailure("setup subprocess lifetime is unknown; snapshots and locks retained");
  }
  canCleanup() { return this.unknown.length === 0 && this.active.size === 0; }
  retain(path) { this.retained.add(path); }
  protectLock(path, release) {
    const lock = { path, release, fences: new Set() };
    this.locks.add(lock);
    // A newly acquired nested lock also retains preceding unknown authority.
    if (this.unknown.length) this.fence(lock, randomUUID(), { kind: "unknown", reason: "preceding setup command lifetime is unknown" });
    return () => {
      // The filesystem owner is done using this lock. Retained lock metadata
      // stays on disk, but future commands must not address an old stage path
      // after its containing runtime is atomically published elsewhere.
      if (!this.canCleanup()) { this.retain(path); this.locks.delete(lock); return false; }
      this.locks.delete(lock); release(); return true;
    };
  }
  fence(lock, token, detail) {
    const path = join(lock.path, `command-${token}.json`);
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, pid: process.pid, token, mode: this.mode, detail }) + "\n", { flag: "wx", mode: 0o600 });
    lock.fences.add(path); return path;
  }
  async launch(executable, invocation, streams, limits = {}) {
    this.check();
    const token = randomUUID(), fences = [];
    try {
      for (const lock of this.locks) fences.push([lock, this.fence(lock, token, { kind: "pending", executable })]);
    } catch (error) {
      // No external command has started: these markers are exclusively ours.
      for (const [lock, path] of fences) { unlinkSync(path); lock.fences.delete(path); }
      throw error;
    }
    let raw, recorded = false;
    const record = (claim) => {
      if (recorded) return claim;
      const valid = claim && claim.lease === raw?.id && validResult(claim.result) &&
        (this.mode === "managed" ? claim.kind === "released" && typeof claim.backend === "string" && claim.backend.length > 0 : claim.kind === "standalone" && claim.scope === "direct-child" && claim.completeTree === false);
      if (valid) {
        try { for (const [lock, path] of fences) { unlinkSync(path); lock.fences.delete(path); } }
        catch (error) { claim = { kind: "unknown", reason: `command fence removal failed: ${error.message}` }; }
      }
      if (!valid || claim.kind === "unknown") {
        const retained = { kind: "unknown", lease: raw?.id ?? token, reason: claim?.reason || "No valid command lifetime proof" };
        this.unknown.push(retained);
        for (const [lock, path] of fences) { this.retain(lock.path); this.retain(path); }
      }
      recorded = true;
      return this.unknown.length ? { ...claim, kind: "unknown", reason: claim.reason ?? "A preceding command lifetime remains unknown" } : claim;
    };
    let startupTimer, startupAbort;
    const launching = Promise.resolve().then(() => this.commands.launch(executable, { argv: [...invocation.argv], cwd: invocation.cwd, environment: { ...invocation.environment } }, streams, limits));
    try {
      raw = await Promise.race([launching, new Promise((_, reject) => {
        startupTimer = setTimeout(() => reject(new Error("owned command launch deadline; lifetime is unknown")), limits.deadlineMs ?? 10_000);
        startupAbort = () => reject(new SetupCommandFailure("setup interrupted during command launch", this.cancellationStatus()));
        this.signal?.addEventListener("abort", startupAbort, { once: true });
        if (this.signal?.aborted) startupAbort();
      })]);
      if (!raw || typeof raw.id !== "string" || raw.id.length === 0 || typeof raw.stop !== "function" || !raw.result?.then || !raw.completed?.then)
        throw new Error("owned command capability returned a malformed lease");
    } catch (error) {
      record({ kind: "unknown", reason: `command launch failed: ${error.message}` });
      // A late capability completion is still ours to stop. Its eventual proof
      // cannot erase the durable unknown decision already exposed to the caller.
      void launching.then((lease) => lease?.stop?.()).catch(() => {});
      throw error;
    } finally { clearTimeout(startupTimer); this.signal?.removeEventListener("abort", startupAbort); }
    let settled = false;
    const entry = { raw };
    this.active.add(entry);
    const abort = () => { void entry.stop().catch(() => {}); };
    const finish = (claim) => {
      if (!settled) {
        settled = true; this.active.delete(entry); this.signal?.removeEventListener("abort", abort); record(claim);
      }
      return claim;
    };
    const completed = Promise.resolve(raw.completed).then(finish, (error) => finish({ kind: "unknown", reason: error.message }));
    entry.stop = async () => {
        try { return finish(await raw.stop()); }
        catch (error) { return finish({ kind: "unknown", lease: raw.id, reason: error.message }); }
    };
    this.signal?.addEventListener("abort", abort, { once: true });
    if (this.signal?.aborted) abort();
    return { id: raw.id, result: raw.result, completed, stop: entry.stop };
  }
  async run(command, argv, options = {}) {
    this.check();
    const environment = options.env ?? this.environment;
    const target = commandTarget(resolveExecutable(command, environment));
    const chunks = []; let bytes = 0, streamError;
    const input = options.input === undefined
      ? (options.stdin === "ignore" ? emptyInput() : this.streams.stdin)
      : typeof options.input === "string" || options.input instanceof Uint8Array
        ? (async function* () { yield Buffer.from(options.input); })() : options.input;
    const lease = await this.launch(target.executable, { argv: [...target.prefix, ...argv], cwd: options.cwd ?? this.cwd, environment }, {
      stdin: input,
      stdout: async (chunk) => {
        try {
          if (options.capture) { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) throw new Error("command output exceeds16MiB"); chunks.push(Buffer.from(chunk)); }
          else await (options.stdout ?? this.streams.stdout)(chunk);
        } catch (error) { streamError = error; throw error; }
      },
      stderr: async (chunk) => {
        try { await (options.stderr ?? this.streams.stderr)(chunk); }
        catch (error) { streamError = error; throw error; }
      },
    }, { graceMs: 1000, deadlineMs: 10_000 });
    let timer;
    if (options.timeout) { timer = setTimeout(() => { void lease.stop(); }, options.timeout); timer.unref(); }
    let result;
    try { result = await Promise.race([lease.result, lease.completed.then((claim) => claim.result ?? { kind: "unknown", message: claim.reason || "command outcome unavailable" })]); }
    catch (error) { result = { kind: "unknown", message: error.message }; }
    finally { clearTimeout(timer); await lease.stop(); }
    this.check();
    if (streamError) throw streamError;
    const status = statusOf(result);
    if (status !== 0) throw new SetupCommandFailure(`${command} failed (${status}): ${result.message ?? result.signal ?? ""}`, status);
    return Buffer.concat(chunks).toString("utf8");
  }
  async stopActive() { await Promise.allSettled([...this.active].map((entry) => entry.stop())); }
  outcome() { return { mode: this.mode, ownership: this.unknown.length || this.active.size ? { kind: "unknown", claims: [...this.unknown], active: this.active.size } : { kind: this.mode === "managed" ? "released" : "standalone", completeTree: this.mode === "managed" }, retained: [...this.retained] }; }
}
