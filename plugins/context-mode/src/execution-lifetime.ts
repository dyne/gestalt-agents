import type { ChildProcess } from "node:child_process";
import { borrowSessionScratch } from "../scripts/session-scratch.mjs";

type Group = { child: ChildProcess; ended: boolean; failedWithoutPid: boolean };

/** One operation may compile and run, or return while its detached group lives. */
export class ManagedExecutionLifetime {
  #groups = new Set<Group>();
  #finished = false;
  #released = false;
  #stopping = false;
  #cleanup?: () => void;
  #timer?: ReturnType<typeof setTimeout>;

  private constructor(
    private readonly claim: { release(): void },
    private readonly onRelease: () => void,
  ) {}

  static begin(onRelease: () => void): ManagedExecutionLifetime | null {
    const claim = borrowSessionScratch();
    return claim ? new ManagedExecutionLifetime(claim, onRelease) : null;
  }

  assertRunning(): void {
    if (this.#stopping) throw new Error("SESSION_EXECUTION_STOPPING");
  }

  track(child: ChildProcess): void {
    const group: Group = { child, ended: false, failedWithoutPid: false };
    this.#groups.add(group);
    child.once("error", () => {
      group.failedWithoutPid = !child.pid;
      group.ended = true;
      this.#poll();
    });
    child.once("exit", () => { group.ended = true; this.#poll(); });
    child.once("close", () => { group.ended = true; this.#poll(); });
    this.#poll();
  }

  finish(cleanup: () => void): void {
    this.#finished = true;
    this.#cleanup = cleanup;
    this.#poll();
  }

  #poll(): void {
    if (this.#released) return;
    for (const group of this.#groups) {
      if (group.failedWithoutPid) { this.#groups.delete(group); continue; }
      // A live ChildProcess handle permits signaling, but not a release claim.
      if (!group.ended && group.child.exitCode === null && group.child.signalCode === null) continue;
      if (process.platform === "win32" || !group.child.pid) continue;
      try { process.kill(-group.child.pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") this.#groups.delete(group);
      }
    }
    if (this.#finished && !this.#groups.size) {
      try {
        this.claim.release();
        this.#released = true;
        clearTimeout(this.#timer);
        this.#cleanup?.();
        this.onRelease();
        return;
      } catch { /* Busy/changed metadata remains durable protection; retry while alive. */ }
    }
    const needsPoll = (this.#finished && !this.#groups.size) ||
      [...this.#groups].some(group => group.ended || group.child.exitCode !== null || group.child.signalCode !== null);
    if (needsPoll && !this.#timer) {
      this.#timer = setTimeout(() => { this.#timer = undefined; this.#poll(); }, 25);
      this.#timer.unref?.();
    }
  }

  /** Bounded best effort; a crash, unknown group or lock never releases a claim. */
  async stop(): Promise<void> {
    this.#stopping = true;
    const signal = (value: NodeJS.Signals) => {
      for (const { child } of this.#groups) {
        // Never signal a cached numeric group after its original leader exited.
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
        try {
          if (process.platform === "win32") child.kill(value);
          else process.kill(-child.pid, value);
        } catch { /* Unknown state stays protected. */ }
      }
    };
    signal("SIGTERM");
    const started = Date.now();
    while (!this.#released && Date.now() - started < 3500) {
      this.#poll();
      if (this.#released) return;
      if (Date.now() - started >= 1500) signal("SIGKILL");
      await new Promise<void>(resolve => setTimeout(resolve, 25));
    }
    this.#poll();
  }
}
