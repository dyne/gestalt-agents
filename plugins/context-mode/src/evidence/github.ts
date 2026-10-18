/** Authenticated, read-only GitHub capture. No source bytes enter routine results. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { killTree } from "../executor.js";
import { runPool } from "../runPool.js";
import { unpackEvidenceZip } from "./zip.js";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const githubSelectorSchema = z.object({
  host: z.string().max(253).regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/).default("github.com"),
  repository: z.string().max(201).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/)
    .refine(v => v.split("/").every(p => p !== "." && p !== "..")),
  run: id,
  attempt: id,
  refresh: z.boolean().optional(),
  job: id.optional(),
  artifact: id.optional(),
}).strict();
export type GitHubSelector = z.input<typeof githubSelectorSchema>;
export type CaptureState = "complete" | "partial" | "failed";
export type FailureCode = "missing-gh" | "authentication" | "rate-limit" | "unavailable" | "exit" | "timeout" | "cancelled" | "oversize" | "invalid-source" | "unsafe-archive" | "storage" | "busy" | "invalid-selector" | "permission";
export interface EvidenceReference {
  path: string; sha256: string; bytes: number; locator: string;
  access: "local-private"; retention: "until local evidence directory is removed";
}
export interface CaptureEntry {
  kind: string; state: CaptureState; exit: number | null; reason?: FailureCode;
  observedAt: string; reference?: EvidenceReference;
}
export interface GitHubCapture {
  version: 1; source: "github"; selector: z.output<typeof githubSelectorSchema> | null;
  headSha: string | null; completedAt: string | null; sourceUpdatedAt: string | null; observedAt: string;
  completeness: CaptureState; reason?: FailureCode;
  manifest?: EvidenceReference;
  reuse?: "cached-terminal" | "captured";
}
export interface CaptureOptions {
  /** Trusted runtime storage, never a model-supplied directory. OS permissions still apply. */
  storageRoot: string;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  /** Trusted host policy, checked for each concrete argv before spawning. */
  authorizeCommand?: (args: readonly string[]) => boolean;
}
export const digest = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
export function reference(path: string, data: Buffer | string, locator = "bytes:0-end"): EvidenceReference {
  return { path, sha256: digest(data), bytes: Buffer.byteLength(data), locator,
    access: "local-private", retention: "until local evidence directory is removed" };
}
function classify(stderr: string): FailureCode {
  // Only a closed vocabulary escapes; gh may echo tokens, URLs or remote log text.
  if (/auth|login|401|403.*credential/i.test(stderr)) return "authentication";
  if (/rate.limit|429/i.test(stderr)) return "rate-limit";
  if (/404|410|expired|not found|not available/i.test(stderr)) return "unavailable";
  return "exit";
}

let activeCaptures = 0;
interface PendingCapture { promise:Promise<GitHubCapture>; controller:AbortController; users:number; refresh:boolean }
const pending = new Map<string, PendingCapture>();
// A refresh invalidates both cache writes and joins from earlier in-flight work.
const generations = new Map<string, number>();
const policies = new WeakMap<NonNullable<CaptureOptions['authorizeCommand']>,number>();
let nextPolicy=0;
function subscribe(work:PendingCapture, signal:AbortSignal|undefined, cancelled:GitHubCapture):Promise<GitHubCapture> {
  work.users++;
  return new Promise(resolve=>{
    let done=false;
    const finish=(result:GitHubCapture)=>{
      if(done)return;done=true;signal?.removeEventListener('abort',abort);
      if(--work.users===0)work.controller.abort();resolve(result);
    };
    const abort=()=>{
      if(work.users===1){work.controller.abort();return;}
      finish({...cancelled,reason:'cancelled'});
    };
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    work.promise.then(finish);
  });
}
// Cached bytes are private to the supplied runtime scope, never a global report lookup.
function cachedCapture(path: string, root: string, opts: CaptureOptions): GitHubCapture | null {
  try {
    if(statSync(path).size>2*1024*1024)return null;
    const envelope = JSON.parse(readFileSync(path, "utf8"));
    const result = envelope.result as GitHubCapture;
    if (envelope.key !== path.split("terminal-").at(-1)?.replace(/\.json$/, "")) return null;
    if (result.completeness !== "complete" || !result.manifest || !result.headSha) return null;
    const verify = (ref: EvidenceReference) => {
      const real = realpathSync(ref.path);
      if (!real.startsWith(realpathSync(root) + "/")) throw new Error();
      if(!Number.isSafeInteger(ref.bytes)||ref.bytes<0||ref.bytes>16*1024*1024||statSync(real).size!==ref.bytes)throw new Error();
      const data = readFileSync(real);
      if (data.length !== ref.bytes || digest(data) !== ref.sha256) throw new Error();
      return data;
    };
    const manifest = JSON.parse(verify(result.manifest).toString("utf8"));
    for (const entry of manifest.entries) {
      if (entry.kind === "auth") continue;
      if (entry.reference) {
        const data = verify(entry.reference);
        if (entry.kind === "artifact-members") for (const member of JSON.parse(data.toString("utf8"))) verify(member.reference);
      }
    }
    // Recheck policy for every command that would have supplied the cached bytes.
    for (const args of envelope.commands) if (opts.authorizeCommand && !opts.authorizeCommand(args)) return null;
    return { ...result, reuse: "cached-terminal" };
  } catch { return null; }
}
/** Each gh child has bounded output, wall time, and inherited native sandbox permissions. */
async function gh(args: string[], path: string, opts: CaptureOptions, cap: number): Promise<CaptureEntry> {
  const observedAt = new Date().toISOString();
  if (opts.authorizeCommand && !opts.authorizeCommand(args)) return { kind: "", state: "failed", exit: null, reason: "permission", observedAt };
  if (opts.signal?.aborted) return { kind: "", state: "failed", exit: null, reason: "cancelled", observedAt };
  const fd = openSync(path, "wx", 0o600);
  return new Promise(resolve => {
    let bytes = 0, stderr = "", reason: FailureCode | undefined, finished = false;
    let child: ReturnType<typeof spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const env: NodeJS.ProcessEnv = { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", PAGER: "cat", GH_DEBUG: "" };
    // Preserve gh's authenticated context; do not accept auth material in selectors.
    // Preserve inherited restriction hooks too (including managed NODE_OPTIONS preloads).
    const stop = (why: FailureCode) => { reason ??= why; if (child) killTree(child); };
    const cancel = () => stop("cancelled");
    const finish = (exit: number | null, error?: NodeJS.ErrnoException) => {
      if (finished) return;
      finished = true; clearTimeout(timer); opts.signal?.removeEventListener("abort", cancel);
      let failure = reason ?? (error ? (error.code === "ENOENT" ? "missing-gh" : "exit") : exit === 0 ? undefined : classify(stderr));
      let ref: EvidenceReference | undefined;
      // Event callbacks must never throw: the outer async catch cannot catch them.
      try { closeSync(fd); }
      catch {
        failure = "storage";
        // A close may fail before or after closing. Retry once; EBADF is harmless.
        try { closeSync(fd); } catch { /* bounded best-effort cleanup */ }
      }
      try { ref = reference(path, readFileSync(path)); }
      catch { failure = "storage"; }
      resolve({ kind: "", state: failure ? (bytes ? "partial" : "failed") : "complete", exit,
        ...(failure ? { reason: failure } : {}), observedAt, ...(ref ? { reference: ref } : {}) });
    };
    try {
      child = spawn("gh", args, { shell: false, cwd: opts.cwd, env,
        detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      opts.signal?.addEventListener("abort", cancel, { once: true });
      if (opts.signal?.aborted) cancel();
      timer = setTimeout(() => stop("timeout"), Math.min(120_000, Math.max(1, opts.timeoutMs ?? 30_000)));
      child.stdout!.on("data", (chunk: Buffer) => {
        if (reason || finished) return;
        const keep = chunk.subarray(0, Math.max(0, cap - bytes));
        try { writeSync(fd, keep); bytes += keep.length; } catch { stop("storage"); }
        if (keep.length < chunk.length) stop("oversize");
      });
      child.stderr!.on("data", (chunk: Buffer) => { if (stderr.length < 8192) stderr += chunk.toString("utf8").slice(0, 8192 - stderr.length); });
      child.once("error", err => finish(null, err));
      child.once("close", exit => finish(exit));
    } catch (error) {
      if (child) killTree(child);
      finish(null, error as NodeJS.ErrnoException);
    }
  });
}

/** Captures are bounded globally (2), with at most 2 child processes per capture. */
export async function captureGitHub(input: unknown, opts: CaptureOptions): Promise<GitHubCapture> {
  const parsed = githubSelectorSchema.safeParse(input);
  const result: GitHubCapture = { version: 1, source: "github", selector: parsed.success ? parsed.data : null,
    headSha: null, completedAt: null, sourceUpdatedAt: null, observedAt: new Date().toISOString(), completeness: "failed" };
  if (!parsed.success) return { ...result, reason: "invalid-selector" };
  if (opts.signal?.aborted) return { ...result, reason: "cancelled" };
  try { mkdirSync(opts.storageRoot, { recursive: true, mode: 0o700 }); }
  catch { return { ...result, reason:"storage" }; }
  const { refresh, ...identity } = parsed.data;
  const key = digest(JSON.stringify({ ...identity, host:identity.host.toLowerCase(), repository:identity.repository.toLowerCase(),maxBytes:opts.maxBytes??null }));
  const cachePath = join(realpathSync(opts.storageRoot), `terminal-${key}.json`);
  let policy=0;
  if(opts.authorizeCommand){policy=policies.get(opts.authorizeCommand)??++nextPolicy;policies.set(opts.authorizeCommand,policy);}
  const requestKey=(generation:number)=>`${cachePath}:${generation}:${opts.timeoutMs??"default"}:${opts.cwd??""}:${policy}`;
  let generation=generations.get(cachePath)??0;
  if (refresh) {
    const refreshing=pending.get(requestKey(generation));
    if(refreshing?.refresh&&!refreshing.controller.signal.aborted)return subscribe(refreshing,opts.signal,result);
    generation++;
    try { unlinkSync(cachePath); } catch { /* absent cache */ }
  }
  generations.set(cachePath,generation);
  if (!refresh) {
    const cached = cachedCapture(cachePath, opts.storageRoot, opts);
    if (cached) return cached;
  }
  const pendingKey = requestKey(generation);
  const existing=pending.get(pendingKey);
  if(existing&&!existing.controller.signal.aborted)return subscribe(existing,opts.signal,result);
  if (activeCaptures >= 2) return { ...result, reason: "busy" };
  const controller=new AbortController();
  const promise = (async () => {
    activeCaptures++;
    const commands: string[][] = [];
    try {
      const captured = await capture(parsed.data, { ...opts, signal:controller.signal, authorizeCommand: args => {
        commands.push([...args]); return opts.authorizeCommand?.(args) ?? true;
      } }, result);
      if (captured.completeness === "complete" && generations.get(cachePath) === generation) {
        writeFileSync(cachePath, JSON.stringify({ key, sourceKey:digest(JSON.stringify({identity,sha:captured.headSha,manifest:captured.manifest?.sha256})), result: captured, commands }), { mode: 0o600 });
      }
      return { ...captured, reuse: "captured" as const };
    } catch { return { ...result, completeness: "failed" as const, reason: "storage" as const }; }
    finally { activeCaptures--; if(pending.get(pendingKey)?.controller===controller)pending.delete(pendingKey); }
  })();
  const work={promise,controller,users:0,refresh:!!refresh};
  pending.set(pendingKey,work);
  return subscribe(work,opts.signal,result);
}

async function capture(s: z.output<typeof githubSelectorSchema>, opts: CaptureOptions, result: GitHubCapture): Promise<GitHubCapture> {
  mkdirSync(opts.storageRoot, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(opts.storageRoot, "github-"));
  const entries: CaptureEntry[] = [];
  const maxBytes = Math.min(16 * 1024 * 1024, Math.max(1, opts.maxBytes ?? 8 * 1024 * 1024));
  const api = (endpoint: string) => ["api", "--hostname", s.host, "--method", "GET", endpoint];
  const base = `repos/${s.repository}/actions/runs/${s.run}`;
  const take = async (kind: string, args: string[], cap = maxBytes) => {
    const e = await gh(args, join(dir, `${entries.length}-${kind}.capture`), opts, cap);
    e.kind = kind; entries.push(e); return e;
  };
  const readJson = (entry: CaptureEntry): unknown => JSON.parse(readFileSync(entry.reference!.path, "utf8"));
  const persist = () => {
    const text = JSON.stringify({ ...result, entries, coverage: "selected attempt jobs (first 100) and their logs; selected artifact only",
      completionTimeReason: "GitHub run metadata supplies updated_at, not a run completion timestamp; job timestamps remain in captured metadata",
      artifactAttemptBinding: s.artifact ? "run-scoped; verify artifact workflow_run.head_sha and run id; no attempt binding supplied by GitHub" : null });
    const path = join(dir, "manifest.json"); writeFileSync(path, text, { mode: 0o600 });
    return { ...result, manifest: reference(path, text, "JSON:entries") };
  };
  const fail = (reason: FailureCode) => { result.completeness = entries.some(e => e.state === "complete" && e.kind !== "auth") ? "partial" : "failed"; result.reason = reason; return persist(); };
  const auth = await take("auth", ["auth", "status", "--hostname", s.host], 64 * 1024);
  if (auth.state !== "complete") return fail(auth.reason === "exit" ? "authentication" : auth.reason!);
  const metadata = await take("run", api(`${base}/attempts/${s.attempt}`), 512 * 1024);
  if (metadata.state !== "complete") return fail(metadata.reason!);
  try {
    const m = z.object({ id, run_attempt: id, head_sha: z.string().regex(/^[a-fA-F0-9]{40}$/),
      repository: z.object({ full_name: z.string() }), updated_at: z.string().datetime(), status: z.string() }).parse(readJson(metadata));
    if (m.id !== s.run || m.run_attempt !== s.attempt || m.repository.full_name.toLowerCase() !== s.repository.toLowerCase()) return fail("invalid-source");
    result.headSha = m.head_sha;
    result.sourceUpdatedAt = m.updated_at;
    if (m.status !== "completed") result.reason = "unavailable";
  } catch { return fail("invalid-source"); }
  const jobs = await take("jobs", api(`${base}/attempts/${s.attempt}/jobs?per_page=100`), 1024 * 1024);
  if (jobs.state !== "complete") return fail(jobs.reason!);
  let jobIds: number[];
  let limited = false;
  try {
    const j = z.object({ total_count: z.number().int().nonnegative(), jobs: z.array(z.object({ id, run_id: id, run_attempt: id, head_sha: z.string() })).max(100) }).parse(readJson(jobs));
    if (j.jobs.some(v => v.run_id !== s.run || v.run_attempt !== s.attempt || v.head_sha !== result.headSha)) return fail("invalid-source");
    jobIds = j.jobs.map(v => v.id); limited = j.total_count !== jobIds.length;
    if (s.job && !jobIds.includes(s.job)) return fail("unavailable");
  } catch { return fail("invalid-source"); }
  const work: { run(): Promise<CaptureEntry> }[] = [];
  // IDs come only from the validated attempt's jobs. Stream job bytes directly;
  // gh run view can download an unbounded whole-run archive internally.
  const selectedJobs = s.job ? [s.job] : jobIds;
  if (!selectedJobs.length) limited = true;
  for (const job of selectedJobs) work.push({ run: () => take(`logs-${job}`, api(`repos/${s.repository}/actions/jobs/${job}/logs`), Math.max(1, Math.floor(maxBytes / selectedJobs.length))) });
  if (s.artifact) work.push({ run: async () => {
    const selected = await take("artifact-meta", api(`repos/${s.repository}/actions/artifacts/${s.artifact}`), 256 * 1024);
    if (selected.state !== "complete") return selected;
    try {
      const a = z.object({ id, expired: z.boolean(), size_in_bytes: z.number().nonnegative(), workflow_run: z.object({ id, head_sha: z.string() }) }).parse(readJson(selected));
      if (a.id !== s.artifact || a.workflow_run.id !== s.run || a.workflow_run.head_sha !== result.headSha) throw new Error();
      if (a.expired || a.size_in_bytes > maxBytes) { selected.state = "failed"; selected.reason = a.expired ? "unavailable" : "oversize"; return selected; }
    } catch { selected.state = "failed"; selected.reason = "invalid-source"; return selected; }
    const archive = await take("artifact-zip", api(`repos/${s.repository}/actions/artifacts/${s.artifact}/zip`));
    if (archive.state === "complete") {
      try {
        const members = unpackEvidenceZip(readFileSync(archive.reference!.path), maxBytes);
        const memberRefs = members.map((m, i) => {
          const path = join(dir, `member-${i}.capture`); writeFileSync(path, m.data, { mode: 0o600 });
          return { name: m.name, reference: reference(path, m.data) };
        });
        const text = JSON.stringify(memberRefs); const path = join(dir, "members.json"); writeFileSync(path, text, { mode: 0o600 });
        entries.push({ kind: "artifact-members", state: "complete", exit: null, observedAt: new Date().toISOString(), reference: reference(path, text, "JSON:members") });
      } catch { archive.state = "failed"; archive.reason = "unsafe-archive"; }
    }
    return archive;
  } });
  // Capture kinds are unique, including each job ID, so concurrent writes never collide.
  const outcomes = await runPool(work, { concurrency: 2 });
  if (outcomes.settled.some(v => v.status === "rejected")) return fail("storage");
  const bad = entries.find(e => e.state !== "complete");
  result.completeness = bad || limited || result.reason ? "partial" : "complete";
  if (bad) result.reason = bad.reason;
  if (limited && !result.reason) result.reason = "unavailable";
  return persist();
}
