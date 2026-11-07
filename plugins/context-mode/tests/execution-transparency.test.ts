import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { PolyglotExecutor } from "../src/executor.js";
import { detectRuntimes } from "../src/runtime.js";

let root: string, workspace: string, parent: string;
let server: typeof import("../src/server.js");
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const call = (name: string, args: Record<string, unknown>) =>
  server.REGISTERED_CTX_TOOLS.find(tool => tool.name === name)!.handler(args) as Promise<any>;
const text = (result: any) => result.content.map((part: any) => part.text).join("\n");

// A routine 2 KiB preview need not contain every byte. Verify retained output
// through the public authorized continuation, without expanding the boundary.
async function retainedText(result: any): Promise<string> {
  let summary: any;
  try { summary = JSON.parse(result.content[0].text); } catch { return text(result); }
  if (!summary.overflow?.report) return text(result);
  let body = "", offset: number | null = 0;
  do {
    const page = await call("ctx_search", { response_report: summary.overflow.report, response_offset: offset, response_bytes: 4096 });
    expect(page.isError, text(page)).not.toBe(true);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(4096);
    const decoded = JSON.parse(page.content[0].text);
    body += decoded.chunk; offset = decoded.nextOffset;
  } while (offset !== null);
  return text(JSON.parse(body));
}

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "execution-transparency-")));
  workspace = join(root, "workspace with spaces"); mkdirSync(workspace);
  writeFileSync(join(workspace, "input.txt"), "read-accounting-fixture");
  writeFileSync(join(workspace, "child.cjs"), `
require('node:fs').readFileSync(require('node:path').join(__dirname, 'input.txt'));
process.stdout.write('child-output\\n');
if (process.argv[2] === 'failure') { process.stderr.write('child-error\\n'); process.exitCode = 7; }
`);
  parent = join(workspace, "parent.cjs");
  writeFileSync(parent, `
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const child = require('node:path').join(__dirname, 'child.cjs');
const [api, mode] = process.argv.slice(2);
async function main() {
  let result;
  if (api === 'spawn') {
    result = await new Promise((resolve, reject) => {
      const p = cp.spawn(process.execPath, [child, mode]);
      let stdout = '', stderr = '';
      p.stdout.on('data', b => stdout += b); p.stderr.on('data', b => stderr += b);
      p.on('error', reject); p.on('close', status => resolve({ stdout, stderr, status }));
    });
  } else if (api === 'spawnSync') {
    result = cp.spawnSync(process.execPath, [child, mode], { encoding: 'utf8' });
    if (result.error) throw result.error;
  } else {
    try {
      const stdout = cp.execFileSync(process.execPath, [child, mode], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      result = { stdout, stderr: '', status: 0 };
    } catch (e) {
      if (typeof e.status !== 'number') throw e;
      result = e;
    }
  }
  const observed = { stdout: result.stdout, stderr: result.stderr, status: result.status };
  const expected = { stdout: 'child-output\\n', stderr: mode === 'failure' ? 'child-error\\n' : '', status: mode === 'failure' ? 7 : 0 };
  if (JSON.stringify(observed) !== JSON.stringify(expected)) process.stderr.write(JSON.stringify({ api, mode, observed, expected }) + '\\n');
  assert.deepEqual(observed, expected);
  process.stdout.write('parent-ok\\n');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
`);
  vi.stubEnv("CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS", "1"); vi.stubEnv("CONTEXT_MODE_PLATFORM", "codex");
  vi.stubEnv("CONTEXT_MODE_WORKSPACE", workspace); vi.stubEnv("CONTEXT_MODE_PROJECT_DIR", workspace);
  vi.stubEnv("CONTEXT_MODE_DIR", join(workspace, ".gestalt", "context-mode")); vi.stubEnv("CLAUDE_PROJECT_DIR", "");
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude")); vi.stubEnv("CODEX_THREAD_ID", "transparency-session");
  server = await import("../src/server.js");
});

afterAll(async () => {
  await new Promise(resolve => setImmediate(resolve));
  vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true });
});

for (const path of ["native", "execute", "batch", "javascript", "typescript"] as const) {
  for (const api of ["spawnSync", "spawn", "execFileSync"]) {
    test.each(["success", "failure"])(`${path} preserves nested ${api} %s streams and status`, async mode => {
      if (path === "native") {
        const result = spawnSync(process.execPath, [parent, api, mode], { encoding: "utf8" });
        expect(result.error).toBeUndefined();
        expect({ stdout: result.stdout, stderr: result.stderr, status: result.status })
          .toEqual({ stdout: "parent-ok\n", stderr: "", status: 0 });
        return;
      }
      const observed: any[] = [];
      const execute = PolyglotExecutor.prototype.execute;
      const spy = vi.spyOn(PolyglotExecutor.prototype, "execute").mockImplementation(async function (input) {
        const result = await execute.call(this, input); observed.push(result); return result;
      });
      try {
        if (path === "typescript") expect(detectRuntimes().typescript, "TypeScript runtime must be admitted on host PATH").not.toBeNull();
        const command = [process.execPath, parent, api, mode].map(quote).join(" ");
        let response: any;
        if (path === "execute") response = await call("ctx_execute", { language: "shell", code: command, cwd: workspace });
        else if (path === "batch") response = await call("ctx_batch_execute", { commands: [{ label: "nested-contract", command }], queries: ["parent-ok"], concurrency: 1, cwd: workspace });
        else {
          const code = `const result = require('node:child_process').spawnSync(${JSON.stringify(process.execPath)}, ${JSON.stringify([parent, api, mode])}, { encoding: 'utf8' });
require('node:assert/strict').deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.status }, { stdout: 'parent-ok\\n', stderr: '', status: 0 });
process.stdout.write(result.stdout);`;
          response = await call("ctx_execute", { language: path, code, cwd: workspace });
        }
        expect(response.isError, await retainedText(response)).not.toBe(true);
        expect(spy).toHaveBeenCalledOnce();
        expect(observed).toHaveLength(1);
        expect({ stdout: observed[0].stdout, stderr: observed[0].stderr, status: observed[0].exitCode })
          .toEqual({ stdout: "parent-ok\n", stderr: "", status: 0 });
      } finally { spy.mockRestore(); }
    });
  }
}

test.each(["execute", "typescript", "shell", "batch"])("%s preserves literal application accounting markers", async path => {
  if (path === "typescript") expect(detectRuntimes().typescript, "TypeScript runtime must be admitted on host PATH").not.toBeNull();
  const literal = "__CM_FS__:123\n__CM_NET__:456\n";
  const code = `process.stderr.write(${JSON.stringify(literal)})`;
  const command = `${quote(process.execPath)} -e ${quote(code)}`;
  const result = path === "batch"
    ? await call("ctx_batch_execute", { commands: [{ label: "literal", command }], queries: ["CM_FS"], concurrency: 1 })
    : await call("ctx_execute", { language: path === "execute" ? "javascript" : path, code: path === "shell" ? command : code });
  expect(result.isError, await retainedText(result)).not.toBe(true);
  const output = await retainedText(result);
  expect(output).toContain("__CM_FS__:123");
  expect(output).toContain("__CM_NET__:456");
});

test("parallel batch preserves each nested parent's streams and status", async () => {
  const execute = PolyglotExecutor.prototype.execute;
  const observed: any[] = [];
  const spy = vi.spyOn(PolyglotExecutor.prototype, "execute").mockImplementation(async function (input) {
    const result = await execute.call(this, input); observed.push(result); return result;
  });
  try {
    const commands = ["spawnSync", "spawn", "execFileSync"].flatMap(api => ["success", "failure"].map(mode => ({
      label: `${api}-${mode}`, command: [process.execPath, parent, api, mode].map(quote).join(" "),
    })));
    await call("ctx_batch_execute", { commands, queries: ["parent-ok"], concurrency: 3, cwd: workspace });
    expect(observed).toHaveLength(6);
    for (const result of observed) expect({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode })
      .toEqual({ stdout: "parent-ok\n", stderr: "", status: 0 });
  } finally { spy.mockRestore(); }
});

test.each(["execute", "batch"])("%s retains literal markers on command failure and timeout", async path => {
  const execute = PolyglotExecutor.prototype.execute;
  const observed: any[] = [];
  const spy = vi.spyOn(PolyglotExecutor.prototype, "execute").mockImplementation(async function (input) {
    const result = await execute.call(this, input); observed.push(result); return result;
  });
  try {
    for (const timeout of [false, true]) {
      const code = `process.stdout.write('__CM_FS__:111\\n'); process.stderr.write('__CM_NET__:222\\n'); ${timeout ? "setInterval(() => {}, 1000)" : "process.exitCode = 7"}`;
      const command = `${quote(process.execPath)} -e ${quote(code)}`;
      const result = path === "execute"
        ? await call("ctx_execute", { language: "shell", code: command, timeout: 1000 })
        : await call("ctx_batch_execute", { commands: [{ label: "partial", command }], queries: ["CM_FS CM_NET"], concurrency: 2, timeout: 1000 });
      const raw = observed.at(-1);
      expect(raw.stdout).toBe("__CM_FS__:111\n"); expect(raw.stderr).toBe("__CM_NET__:222\n");
      expect(raw.timedOut).toBe(timeout);
      if (!timeout) expect(raw.exitCode).toBe(7);
      const output = await retainedText(result);
      expect(output).toContain("__CM_FS__:111"); expect(output).toContain("__CM_NET__:222");
    }
  } finally { spy.mockRestore(); }
});

test("batch honors explicit quoted caller NODE_OPTIONS without adding accounting", async () => {
  const preload = join(workspace, "caller preload's file.cjs");
  writeFileSync(preload, "globalThis.CALLER_PRELOAD = 'caller-loaded';");
  const code = "require('node:assert/strict').equal(globalThis.CALLER_PRELOAD, 'caller-loaded'); process.stdout.write('caller-ok')";
  const command = `NODE_OPTIONS=${quote(`--require ${JSON.stringify(preload)}`)} ${quote(process.execPath)} -e ${quote(code)}`;
  const result = await call("ctx_batch_execute", { commands: [{ label: "caller", command }], queries: ["caller-ok"], concurrency: 1 });
  expect(result.isError, await retainedText(result)).not.toBe(true);
  expect(await retainedText(result)).toContain("caller-ok");
});

test.each([false, true])("timeout/background=%s preserves partial streams and releases its process and script", async background => {
  const executor = new PolyglotExecutor({ runtimes: { ...detectRuntimes(), javascript: process.execPath }, projectRoot: workspace });
  const literal = "__CM_FS__:321\n__CM_NET__:654\n";
  let pid: number | undefined, filename: string | undefined;
  try {
    const result = await executor.execute({ language: "javascript", background, timeout: 1000,
      code: `process.stdout.write(JSON.stringify({ pid: process.pid, filename: __filename }) + '\\n');
process.stdout.write(${JSON.stringify(literal)}); process.stderr.write(${JSON.stringify(literal)}); setInterval(() => {}, 1000);` });
    const [identity, ...output] = result.stdout.split("\n");
    ({ pid, filename } = JSON.parse(identity));
    expect(output.join("\n")).toBe(literal); expect(result.stderr).toBe(literal);
    expect(result.timedOut).toBe(true);
    expect(!!result.backgrounded).toBe(background);
  } finally {
    executor.cleanupBackgrounded();
    await executor.shutdownManagedExecutions();
    if (pid !== undefined) await vi.waitFor(() => {
      try { process.kill(pid!, 0); throw new Error("Owned process remains live"); }
      catch (error: any) { if (error.code !== "ESRCH") throw error; }
    }, { timeout: 5000 });
    // Standalone background scripts are retained by the executor. This test
    // removes only its own allocated script directory after confirmed absence.
    if (background && filename) rmSync(dirname(filename), { recursive: true, force: true });
    if (filename) await vi.waitFor(() => expect(existsSync(filename!)).toBe(false));
  }
});
