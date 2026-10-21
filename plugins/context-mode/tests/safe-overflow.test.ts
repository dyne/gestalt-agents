import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { PolyglotExecutor } from "../src/executor.js";
import { observedExecutionState } from "../src/execution-provenance.js";
import { boundResponse, readResponsePage, retainAuthorizedReport } from "../src/response-budget.js";
import { summarizeFailures, type ResponseEvidence } from "../src/response-evidence.js";

const root = mkdtempSync(join(tmpdir(), "safe-overflow-")), workspace = join(root, "workspace");
const scope = { root: join(root, "reports"), authorizeRead: () => true };
const tap = `TAP version 13\nok 1 passing\n# ${"é😀 padding ".repeat(10000)}\nnot ok 2 LATE-FAIL-α\n  message: expected alpha\nnot ok 3 LATE-FAIL-β\n  message: expected beta\n1..3\n`;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const decode = (result: any) => JSON.parse(result.content[0].text);
let server: typeof import("../src/server.js");
const call = (name: string, args: Record<string, unknown>) => server.REGISTERED_CTX_TOOLS.find(tool => tool.name === name)!.handler(args) as Promise<any>;
async function fullReport(handle: string) {
  let body = "", offset = 0;
  do {
    const result = await call("ctx_search", { response_report: handle, response_offset: offset, response_bytes: 8192 });
    expect(bytes(result)).toBeLessThanOrEqual(8192); expect(result.isError).not.toBe(true);
    const page = decode(result); body += page.chunk; offset = page.nextOffset;
  } while (offset !== null);
  expect(createHash("sha256").update(body).digest("hex")).toBe(handle.slice(7));
  return JSON.parse(body);
}
beforeAll(async () => {
  mkdirSync(workspace);
  vi.stubEnv("CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS", "1"); vi.stubEnv("CONTEXT_MODE_PLATFORM", "codex");
  vi.stubEnv("CONTEXT_MODE_WORKSPACE", workspace); vi.stubEnv("CONTEXT_MODE_PROJECT_DIR", workspace);
  vi.stubEnv("CONTEXT_MODE_DIR", join(workspace, ".gestalt", "context-mode")); vi.stubEnv("CLAUDE_PROJECT_DIR", "");
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude")); vi.stubEnv("CODEX_THREAD_ID", "safe-overflow-session");
  server = await import("../src/server.js");
});
afterAll(async () => { await new Promise(resolve => setImmediate(resolve)); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

describe("complete captured evidence survives inner and outer summaries", () => {
  test.each([1024, 2048])("late failures survive intent summaries within %i bytes", async response_bytes => {
    const spy = vi.spyOn(PolyglotExecutor.prototype, "execute").mockResolvedValue({ stdout: tap, stderr: "", exitCode: 7, timedOut: false });
    let result: any;
    try { result = await call("ctx_execute", { language: "shell", code: "printf fixture", intent: "unmatched-specific-vocabulary", response_bytes }); }
    finally { spy.mockRestore(); }
    expect(bytes(result)).toBeLessThanOrEqual(response_bytes); expect(result.isError).toBe(true);
    const summary = result.content[0].text.startsWith("Execution:")
      ? JSON.parse(result.content[0].text.split("\n")[0].slice(11)) : decode(result);
    expect(summary).toMatchObject({ evidenceCompleteness: "complete", captureCompleteness: "complete",
      failures: { totalFailures: 2, knownFailures: 2, coverage: "complete", firstFailure: { id: "TAP:2 LATE-FAIL-α" } } });
    const reference = summary.overflow ?? summary.audit;
    expect(summary.omittedBytes).toBeGreaterThan(0); expect(reference.sha256).toBe(reference.report.slice(7));
    expect(summary.provenance ?? summary).toMatchObject({ language: "shell" });
    const retained = await fullReport(reference.report), audit = retained.capturedEvidence ?? retained;
    expect(audit.sources[0].diagnostics.stdout).toBe(tap);
    expect(audit.failures.failures.map((failure: any) => failure.id)).toEqual(["TAP:2 LATE-FAIL-α", "TAP:3 LATE-FAIL-β"]);
    expect(audit.rawResponse.content[0].text.length).toBeLessThan(tap.length);
  });

  test("search snippets retain whole retrieved chunks and scoped failure records", async () => {
    const sourceText = tap.replace("é😀 padding ".repeat(10000), "é😀 padding ".repeat(200));
    await call("ctx_index", { source: "late-tap", content: `# TAP log\n\n${sourceText}` });
    const result = await call("ctx_search", { queries: ["padding"], response_bytes: 2048 });
    expect(bytes(result)).toBeLessThanOrEqual(2048);
    let report = JSON.parse(result.content[0].text.split("\n")[0]);
    if (report.originalBytes) {
      const retained = await fullReport(report.overflow.report);
      report = JSON.parse(retained.content[0].text.split("\n")[0]);
    }
    expect(report.overflow.report).toBeDefined();
    const retained = await fullReport(report.overflow.report);
    expect(retained.retrievedSources.some((source: any) => source.content.includes("LATE-FAIL-β"))).toBe(true);
    expect(retained.windows.every((window: any) => window.text.length < tap.length)).toBe(true);
    expect(retained.failures.scope).toBe("retrieved indexed chunks only");
  });

  test("unsupported logs retain unknown totals despite exit zero", () => {
    expect(summarizeFailures([{ source: "unknown", stdout: "PASS-looking words", state: { exitCode: 0, timedOut: false, completeness: "complete" } }], "fixture"))
      .toMatchObject({ totalFailures: null, knownFailures: 0, coverage: "unknown" });
  });

  test("batch does not turn unavailable inner query evidence into complete evidence", async () => {
    const sourceText = tap.replace("é😀 padding ".repeat(10000), "relatedunique " + "é😀 padding ".repeat(100));
    await call("ctx_index", { source: "related-tap", content: `# related TAP\n\n${sourceText}` });
    const args = { commands: [{ label: "current", command: "printf 'current plain output'" }], queries: ["relatedunique"],
      query_scope: "global", concurrency: 1, response_bytes: 4096 };
    const first = await call("ctx_batch_execute", args);
    const firstMeta = first.content[0].text.startsWith("Execution:")
      ? JSON.parse(first.content[0].text.split("\n")[0].slice(11)) : decode(first);
    const retained = await fullReport((firstMeta.overflow ?? firstMeta.audit).report);
    const audit = retained.capturedEvidence ?? retained;
    const deniedHandle = "report-" + createHash("sha256").update(JSON.stringify(audit.queryEvidence)).digest("hex");
    const policy = join(workspace, ".claude"); mkdirSync(policy, { recursive: true });
    writeFileSync(join(policy, "settings.json"), JSON.stringify({ permissions: { deny: [`Read(**/${deniedHandle}.json)`] } }));
    let result: any;
    try { result = await call("ctx_batch_execute", args); }
    finally { rmSync(join(policy, "settings.json")); }
    expect(bytes(result)).toBeLessThanOrEqual(4096); expect(result.isError).toBe(true);
    const summary = result.content[0].text.startsWith("Execution:")
      ? JSON.parse(result.content[0].text.split("\n")[0].slice(11)) : decode(result);
    expect(summary.evidenceCompleteness).toBe("partial");
    // Markdown chunking separates the first passing test from the matched
    // failure chunk. Its plan cannot establish a complete total.
    expect(summary.failures).toMatchObject({ totalFailures: null, knownFailures: 2, coverage: "partial", scope: "retrieved indexed chunks only" });
  });

  test("actual spawn error keeps its synthesized compatibility code unobserved", async () => {
    const executor = new PolyglotExecutor({ projectRoot: join(root, "missing-cwd") });
    const result = await executor.execute({ language: "javascript", code: "console.log('not run')" });
    expect(result.exitCodeObserved).toBe(false); expect(result.processError).toBeTruthy();
    expect(observedExecutionState(result)).toMatchObject({ exitCode: null, status: "failed", completeness: "partial" });
  });

  test("escaped failure identities and provenance also fit the minimum envelope", () => {
    const id = '"\\'.repeat(300), cause = '\\"'.repeat(300);
    const evidence: ResponseEvidence = { available: true, captureCompleteness: "complete",
      provenance: { operationId: "a".repeat(36), language: "javascript", sourceDigest: "b".repeat(64) },
      failures: { totalFailures: 1, knownFailures: 1, coverage: "complete", scope: "captured command diagnostics",
        failures: [{ id, cause, locator: "fixture", source: "fixture" }] }, snapshot: { id, cause } };
    const result = boundResponse({ content: [{ type: "text", text: "x".repeat(4000) }], isError: true }, scope, 1024,
      { exitCode: 7, timedOut: false, status: "failed", completeness: "complete" }, evidence);
    expect(bytes(result)).toBeLessThanOrEqual(1024);
    expect(decode(result)).toMatchObject({ failures: { totalFailures: 1, coverage: "complete" } });
    expect(decode(result).failures.firstFailureOmittedBytes).toBeGreaterThan(0);
    const path = join(scope.root, `${decode(result).overflow.report}.json`);
    expect(JSON.parse(readFileSync(path, "utf8")).capturedEvidence).toEqual({ id, cause });
  });

  test("the existing subprocess cap becomes explicit incomplete capture", async () => {
    const executor = new PolyglotExecutor({ projectRoot: workspace, hardCapBytes: 512 });
    const captured = await executor.execute({ language: "javascript", code: "process.stdout.write('x'.repeat(200000));", timeout: 2000 });
    expect(captured.outputCapped).toBe(true);
    expect(captured.observedOutputBytes!).toBeGreaterThan(captured.capturedOutputBytes!);
    expect(observedExecutionState(captured)).toMatchObject({ completeness: "partial", status: "partial" });
    const spy = vi.spyOn(PolyglotExecutor.prototype, "execute").mockResolvedValue(captured);
    let result: any;
    try { result = await call("ctx_execute", { language: "shell", code: "echo capped" }); }
    finally { spy.mockRestore(); }
    expect(bytes(result)).toBeLessThanOrEqual(2048);
    const summary = result.content[0].text.startsWith("Execution:")
      ? JSON.parse(result.content[0].text.split("\n")[0].slice(11)) : decode(result);
    expect(summary.evidenceCompleteness).toBe("partial"); expect(summary.captureCompleteness).toBe("partial");
    expect(summary.failures.totalFailures).toBeNull();
  });

  test("denied audit and overflow storage cannot appear complete or successful", async () => {
    const policy = join(workspace, ".claude"); mkdirSync(policy, { recursive: true });
    writeFileSync(join(policy, "settings.json"), JSON.stringify({ permissions: { deny: ["Read(**/responses/**)"] } }));
    const spy = vi.spyOn(PolyglotExecutor.prototype, "execute").mockResolvedValue({ stdout: tap, stderr: "", exitCode: 7, timedOut: false });
    let result: any;
    try { result = await call("ctx_execute", { language: "shell", code: "echo fixture", intent: "unmatched", response_bytes: 1024 }); }
    finally { spy.mockRestore(); rmSync(join(policy, "settings.json")); }
    expect(bytes(result)).toBeLessThanOrEqual(1024); expect(result.isError).toBe(true);
    const summary = result.content[0].text.startsWith("Execution:")
      ? JSON.parse(result.content[0].text.split("\n")[0].slice(11)) : decode(result);
    expect(summary).toMatchObject({ evidenceCompleteness: "partial", failures: { totalFailures: 2 } });
    expect(summary.overflow?.available ?? summary.audit?.available).toBe(false);
  });
});

describe("digest-bound authorized availability", () => {
  test("deleted or changed artifacts return bounded incomplete errors", () => {
    for (const changed of [false, true]) {
      const ref = retainAuthorizedReport(JSON.stringify({ content: "é😀 original" }), scope);
      const path = join(scope.root, `${ref.report}.json`);
      if (changed) writeFileSync(path, "tampered"); else rmSync(path);
      const result = readResponsePage(scope, ref.report, 0, 1024);
      expect(bytes(result)).toBeLessThanOrEqual(1024); expect(result.isError).toBe(true);
      expect(decode(result).evidenceCompleteness).toBe("partial");
      if (changed) rmSync(path);
    }
  });

  test("invalid UTF-8 offsets, denied paths and symlinks fail closed", () => {
    const ref = retainAuthorizedReport("😀 original", scope);
    for (const result of [readResponsePage(scope, ref.report, 1), readResponsePage({ ...scope, authorizeRead: () => false }, ref.report)]) {
      expect(result.isError).toBe(true); expect(decode(result).evidenceCompleteness).toBe("partial");
    }
    const link = join(root, "symlink-root"); symlinkSync(scope.root, link);
    expect(() => retainAuthorizedReport("private", { root: link, authorizeRead: () => true })).toThrow();
  });

  test("storage failure is explicit; oversized artifacts are rejected before writing", () => {
    const file = join(root, "not-directory"); writeFileSync(file, "file");
    const result = boundResponse({ content: [{ type: "text", text: "x".repeat(4000) }] }, { root: file, authorizeRead: () => true }, 1024);
    expect(bytes(result)).toBeLessThanOrEqual(1024); expect(result.isError).toBe(true);
    expect(decode(result).evidenceCompleteness).toBe("partial");
    const hugeRoot = join(root, "huge");
    expect(() => retainAuthorizedReport("x".repeat(16 * 1024 * 1024 + 1), { root: hugeRoot, authorizeRead: () => true })).toThrow();
    expect(existsSync(hugeRoot)).toBe(false);
  });

  test("same-session MCP restart recovers pages; another session cannot", async () => {
    const bundle = resolve("server.bundle.mjs");
    const connect = async (session: string) => {
      const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      const transport = new StdioClientTransport({ command: process.execPath, args: [bundle], cwd: workspace,
        env: { ...env, CODEX_THREAD_ID: session, CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS: "0" }, stderr: "pipe" });
      const client = new Client({ name: "overflow-restart-regression", version: "1" });
      await client.connect(transport); return client;
    };
    let client = await connect("restart-session"), handle = "";
    try {
      const result: any = await client.callTool({ name: "ctx_execute", arguments: { language: "shell", code: "printf '%05000d' 0", response_bytes: 1024 } });
      expect(bytes(result)).toBeLessThanOrEqual(1024); handle = decode(result).overflow.report;
    } finally { await client.close(); }
    client = await connect("restart-session");
    try {
      const result: any = await client.callTool({ name: "ctx_search", arguments: { response_report: handle, response_bytes: 1024 } });
      expect(bytes(result)).toBeLessThanOrEqual(1024); expect(result.isError).not.toBe(true);
      expect(decode(result).chunk).toBeTruthy();
    } finally { await client.close(); }
    client = await connect("different-session");
    try {
      const result: any = await client.callTool({ name: "ctx_search", arguments: { response_report: handle } });
      expect(result.isError).toBe(true); expect(decode(result).evidenceCompleteness).toBe("partial");
    } finally { await client.close(); }
  }, 20000);
});
