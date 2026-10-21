import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { PolyglotExecutor } from "../src/executor.js";
import { createExecutionAudit, omitExecutableSource } from "../src/execution-provenance.js";

let root: string, workspace: string, server: typeof import("../src/server.js");
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const text = (result: any) => result.content.map((part: any) => part.text).join("\n");
const provenance = (result: any) => JSON.parse(result.content[0].text.split("\n")[0].slice("Execution: ".length));
const call = (name: string, args: Record<string, unknown>) => server.REGISTERED_CTX_TOOLS.find(tool => tool.name === name)!.handler(args) as Promise<any>;
async function report(handle: string) {
  let body = "", offset = 0;
  do {
    const result = await call("ctx_search", { response_report: handle, response_offset: offset, response_bytes: 1024 });
    expect(bytes(result)).toBeLessThanOrEqual(1024); expect(result.isError).not.toBe(true);
    const page = JSON.parse(result.content[0].text); body += page.chunk; offset = page.nextOffset;
  } while (offset !== null);
  return JSON.parse(body);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "execution-provenance-")); workspace = join(root, "workspace"); mkdirSync(workspace);
  vi.stubEnv("CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS", "1"); vi.stubEnv("CONTEXT_MODE_PLATFORM", "codex");
  vi.stubEnv("CONTEXT_MODE_WORKSPACE", workspace); vi.stubEnv("CONTEXT_MODE_PROJECT_DIR", workspace);
  vi.stubEnv("CONTEXT_MODE_DIR", join(workspace, ".gestalt", "context-mode")); vi.stubEnv("CLAUDE_PROJECT_DIR", "");
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude")); vi.stubEnv("CODEX_THREAD_ID", "provenance-session");
  server = await import("../src/server.js");
});
afterAll(async () => {
  await new Promise(resolve => setImmediate(resolve)); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true });
});

describe("compact execution provenance and explicit authorized audit", () => {
  test.each(["", "56 | "])("omits interpreter source with diagnostic prefix %j", prefix => {
    const code = "const broken = ; // PARSE-SOURCE-CANARY";
    const audit = createExecutionAudit("javascript", [{ submitted: code, executed: code }]);
    const raw = { content: [{ type: "text" as const, text: `${prefix}${code}\nerror: Unexpected ;\n    at script.js:56:16` }] };
    const result = omitExecutableSource(raw, audit);
    expect(result.omitted).toBe(1);
    expect(text(result.response)).not.toContain("PARSE-SOURCE-CANARY");
    expect(text(result.response)).toContain("error: Unexpected ;");
    expect(text(result.response)).toContain("at script.js:56:16");
    expect(text(raw)).toContain(code);
  });
  test("long heredoc source is absent routinely and recoverable exactly", async () => {
    const canary = "PRIVATE-SOURCE-CANARY";
    const code = `: <<'AUDIT'\n${canary.repeat(800)}\nAUDIT\nprintf 'derived-result'`;
    const result = await call("ctx_execute", { language: "shell", code });
    expect(bytes(result)).toBeLessThanOrEqual(2048); expect(result.isError).not.toBe(true);
    expect(text(result)).toContain("derived-result"); expect(text(result)).not.toContain(canary);
    const meta = provenance(result);
    expect(meta.language).toBe("shell"); expect(meta.operationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(meta.sourceDigest).toBe(sha(code)); expect(meta.execution).toMatchObject({ exitCode: 0, timedOut: false });
    const audit = await report(meta.audit.report);
    expect(audit.operationId).toBe(meta.operationId); expect(audit.sources[0].submitted).toBe(code);
    expect(audit.sources[0].executed).toContain(code);
    expect(audit.sources[0].executed).toMatch(/^export PATH=/); // Exact generated shell script, including wrapper.
  });

  test("JS audit recovers actual instrumentation while routine output omits source", async () => {
    const code = "// JS-SOURCE-CANARY\nconsole.log('computed-value')";
    const result = await call("ctx_execute", { language: "javascript", code });
    expect(text(result)).not.toContain("JS-SOURCE-CANARY"); expect(text(result)).toContain("computed-value");
    const audit = await report(provenance(result).audit.report);
    expect(audit.sources[0].submitted).toBe(code);
    expect(audit.sources[0].executed).toContain(code); expect(audit.sources[0].executed).toContain("__cm_main");
    expect(audit.sources[0].executed).not.toBe(code);
  });

  test("errors retain exit status and audit without routine source echo", async () => {
    const code = "# ERROR-SOURCE-CANARY\nprintf 'FAIL-visible' >&2\nexit 7";
    const result = await call("ctx_execute", { language: "shell", code });
    expect(result.isError).toBe(true); expect(text(result)).toContain("FAIL-visible");
    expect(text(result)).not.toContain("ERROR-SOURCE-CANARY");
    const meta = provenance(result); expect(meta.execution.exitCode).toBe(7);
    const audit = await report(meta.audit.report); expect(audit.execution.exitCode).toBe(7);
    expect(audit.sources[0].submitted).toBe(code);
  });

  test("interpreter diagnostics retain source excerpts only in the audit", async () => {
    const code = "const broken = ; // Error-PARSE-SOURCE-CANARY";
    const result = await call("ctx_execute", { language: "javascript", code });
    expect(result.isError).toBe(true); expect(bytes(result)).toBeLessThanOrEqual(2048);
    expect(text(result)).toMatch(/SyntaxError|error: Unexpected ;/); expect(text(result)).not.toContain("PARSE-SOURCE-CANARY");
    const meta = provenance(result); expect(meta.sourceEchoesOmitted).toBeGreaterThan(0);
    const audit = await report(meta.audit.report);
    expect(text(audit.rawResponse)).toContain(code);
    expect(audit.sources[0].submitted).toBe(code);
  });

  test("file execution audit includes path and the final FILE_CONTENT wrapper", async () => {
    const path = join(workspace, "fixture.txt"); writeFileSync(path, "file-value");
    const code = "// FILE-SOURCE-CANARY\nconsole.log(FILE_CONTENT.toUpperCase())";
    const result = await call("ctx_execute_file", { path, language: "javascript", code });
    expect(text(result)).toContain("FILE-VALUE"); expect(text(result)).not.toContain("FILE-SOURCE-CANARY");
    const audit = await report(provenance(result).audit.report);
    expect(audit.sources[0]).toMatchObject({ path, submitted: code });
    expect(audit.sources[0].executed).toContain("const FILE_CONTENT_PATH =");
    expect(audit.sources[0].executed).toContain(code);
  });

  test("batch inventory and indexed hits omit commands; audit retains each final script", async () => {
    const commands = [{ label: "first", command: "# BATCH-SOURCE-CANARY\nprintf 'batch-finding'" },
      { label: "second", command: "printf 'second-finding'; exit 7" }];
    const result = await call("ctx_batch_execute", { commands, queries: ["batch-finding"], concurrency: 2, response_bytes: 4096 });
    expect(bytes(result)).toBeLessThanOrEqual(4096); expect(text(result)).not.toContain("BATCH-SOURCE-CANARY");
    for (const command of commands) expect(text(result)).not.toContain(command.command);
    const meta = provenance(result); expect(meta.execution.exitCode).toBe(7);
    const audit = await report(meta.audit.report);
    expect(audit.sources.map((source: any) => source.submitted)).toEqual(commands.map(command => command.command));
    expect(audit.sources[1].state.exitCode).toBe(7);
    expect(audit.sources[0].executed).toContain("NODE_OPTIONS=");
    const search = await call("ctx_search", { queries: ["batch-finding"], response_bytes: 4096 });
    expect(text(search)).not.toContain("BATCH-SOURCE-CANARY");
  });

  test.each([false, true])("registered parallel batch reports spawn failures with mixed success=%s", async mixed => {
    const commands = [{ label: "spawn-failure", command: "echo first" }, { label: "sibling", command: "echo second" }];
    const spawnFailure = new Error("SPAWN-EAGAIN-DIAGNOSTIC");
    const spy = vi.spyOn(PolyglotExecutor.prototype, "execute").mockImplementation(async ({ code }) => {
      if (!mixed || code.includes("echo first")) throw spawnFailure;
      return { stdout: "sibling-success", stderr: "", exitCode: 0, timedOut: false };
    });
    let result: any;
    try { result = await call("ctx_batch_execute", { commands, queries: ["SPAWN EAGAIN"], concurrency: 2, response_bytes: 4096 }); }
    finally { spy.mockRestore(); }
    const meta = provenance(result);
    expect(meta.execution).toMatchObject({ exitCode: null, timedOut: false, status: "failed", completeness: "partial" });
    const audit = await report(meta.audit.report);
    expect(audit.execution).toEqual(meta.execution);
    expect(audit.sources[0].state).toMatchObject({ exitCode: null, status: "failed", completeness: "partial" });
    expect(audit.sources[0].diagnostics.error).toMatchObject({ name: "Error", message: spawnFailure.message, stack: spawnFailure.stack });
    expect(audit.sources[1].state.status).toBe(mixed ? "completed" : "failed");
  });

  test("registered batch never invents a missing exit code", async () => {
    const spy = vi.spyOn(PolyglotExecutor.prototype, "execute").mockResolvedValue({ stdout: "missing-code-finding", stderr: "MISSING-CODE-STDERR" } as any);
    let result: any;
    try { result = await call("ctx_batch_execute", { commands: [{ label: "missing", command: "echo missing" }], queries: ["finding"], concurrency: 1, response_bytes: 4096 }); }
    finally { spy.mockRestore(); }
    const meta = provenance(result);
    expect(meta.execution).toMatchObject({ exitCode: null, status: "partial", completeness: "partial" });
    const audit = await report(meta.audit.report);
    expect(audit.sources[0].state).toMatchObject({ exitCode: null, status: "unknown", completeness: "partial" });
    expect(audit.sources[0].diagnostics).toEqual({ stdout: "missing-code-finding", stderr: "MISSING-CODE-STDERR" });
  });

  test("registered timeout batch marks skipped commands not-started", async () => {
    const spy = vi.spyOn(PolyglotExecutor.prototype, "execute").mockResolvedValue({ stdout: "partial-finding", stderr: "TIMEOUT-DIAGNOSTIC", exitCode: 124, timedOut: true });
    let result: any;
    try {
      result = await call("ctx_batch_execute", { commands: [{ label: "timeout", command: "echo first" }, { label: "skipped", command: "echo second" }],
        queries: ["partial finding"], concurrency: 1, timeout: 1000, response_bytes: 4096 });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
    const meta = provenance(result);
    expect(meta.execution).toMatchObject({ exitCode: null, timedOut: true, status: "partial", completeness: "partial" });
    const audit = await report(meta.audit.report);
    expect(audit.sources[0].state).toMatchObject({ exitCode: 124, timedOut: true, completeness: "partial" });
    expect(audit.sources[0].diagnostics.stderr).toBe("TIMEOUT-DIAGNOSTIC");
    expect(audit.sources[1]).toMatchObject({ executed: null, state: { exitCode: null, timedOut: false, status: "not-started", reason: "batch timeout exceeded" } });
  });

  test("registered serial spawn exception retains failed and undispatched command states", async () => {
    const spy = vi.spyOn(PolyglotExecutor.prototype, "execute").mockImplementation(() => { throw new Error("SYNC-SPAWN-FAILURE"); });
    let result: any;
    try { result = await call("ctx_batch_execute", { commands: [{ label: "failed", command: "echo one" }, { label: "undispatched", command: "echo two" }], queries: ["failure"], concurrency: 1 }); }
    finally { spy.mockRestore(); }
    expect(result.isError).toBe(true);
    const meta = provenance(result);
    expect(meta.execution).toMatchObject({ exitCode: null, status: "failed", completeness: "partial" });
    const audit = await report(meta.audit.report);
    expect(audit.sources[0].diagnostics.error.message).toBe("SYNC-SPAWN-FAILURE");
    expect(audit.sources[1].state.status).toBe("not-started");
    expect(text(audit.rawResponse)).toContain("SYNC-SPAWN-FAILURE");
  });

  test("explicit audit display is opt-in and still obeys the entire response budget", async () => {
    const code = "# EXPLICIT-AUDIT-CANARY\nprintf 'answer'";
    const tool = server.REGISTERED_CTX_TOOLS.find(tool => tool.name === "ctx_execute")!;
    const args = (tool.config.inputSchema as any).parse({ language: "shell", code, audit: true });
    const result = await tool.handler(args) as any;
    expect(bytes(result)).toBeLessThanOrEqual(2048); expect(text(result)).toContain("EXPLICIT-AUDIT-CANARY");
    const long = await call("ctx_execute", { language: "shell", code: `# ${"AUDIT-LONG".repeat(1000)}\nprintf 'answer'`, audit: true, response_bytes: 1024 });
    expect(bytes(long)).toBeLessThanOrEqual(1024);
    const summary = JSON.parse(long.content[0].text);
    const full = await report(summary.overflow.report);
    expect(text(full)).toContain("AUDIT-LONG");
    const invalid = await call("ctx_execute", { language: "shell", code, audit: "true" });
    expect(invalid.isError).toBe(true);
  });

  test("audit retrieval rechecks Read policy and session ownership", async () => {
    const result = await call("ctx_execute", { language: "shell", code: "# ACCESS-CANARY\nprintf 'done'" });
    const handle = provenance(result).audit.report;
    vi.stubEnv("CODEX_THREAD_ID", "other-session");
    const other = await call("ctx_search", { response_report: handle }); expect(other.isError).toBe(true);
    vi.stubEnv("CODEX_THREAD_ID", "provenance-session");
    const policy = join(workspace, ".claude"); mkdirSync(policy, { recursive: true });
    writeFileSync(join(policy, "settings.json"), JSON.stringify({ permissions: { deny: ["Read(**/responses/**)"] } }));
    try {
      const denied = await call("ctx_search", { response_report: handle }); expect(denied.isError).toBe(true);
      expect(text(denied)).not.toContain("ACCESS-CANARY");
      const unavailable = await call("ctx_execute", { language: "shell", code: "# STORE-CANARY\nprintf 'done'" });
      expect(provenance(unavailable).audit).toMatchObject({ available: false, evidenceCompleteness: "partial" });
      expect(text(unavailable)).not.toContain("STORE-CANARY");
    } finally { rmSync(join(policy, "settings.json")); }
  });

  test("audit display does not bypass execution policies or file boundaries", async () => {
    const policy = join(workspace, ".claude"); mkdirSync(policy, { recursive: true });
    const marker = join(workspace, "forbidden.txt");
    vi.stubEnv("CLAUDE_PROJECT_DIR", workspace);
    writeFileSync(join(policy, "settings.json"), JSON.stringify({ permissions: { deny: ["Bash(touch *)"] } }));
    try {
      const denied = await call("ctx_execute", { language: "shell", code: `touch '${marker}'`, audit: true });
      expect(denied.isError).toBe(true); expect(existsSync(marker)).toBe(false);
      expect(text(denied)).not.toContain("operationId");
      const outside = await call("ctx_execute_file", { path: join(root, "outside.txt"), language: "shell", code: "echo no", audit: true });
      expect(outside.isError).toBe(true); expect(text(outside)).not.toContain("operationId");
    } finally { rmSync(join(policy, "settings.json")); vi.stubEnv("CLAUDE_PROJECT_DIR", ""); }
    const tool = server.REGISTERED_CTX_TOOLS.find(tool => tool.name === "ctx_execute")!;
    expect(tool.config.title).toContain("executes the supplied code");
    expect(tool.config.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect((tool.config.inputSchema as any).shape.code).toBeDefined();
  });
});
