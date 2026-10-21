import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { request as httpsRequest } from "node:https";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { boundResponse, readResponsePage, responseBudgetSchema } from "../src/response-budget.js";
import { resolveSessionDbPath } from "../src/session/db.js";
import { evidenceRequestSchema } from "../src/evidence/tool.js";

vi.mock("node:https", async importOriginal => {
  const actual = await importOriginal<typeof import("node:https")>();
  return { ...actual, request: vi.fn(actual.request) };
});

const root = mkdtempSync(join(tmpdir(), "response-budget-"));
const scope = { root: join(root, "artifacts"), authorizeRead: () => true };
const decode = (result: any) => JSON.parse(result.content[0].text);
const size = (result: unknown) => Buffer.byteLength(JSON.stringify(result), "utf8");
const response = (text: string) => ({ content: [{ type: "text" as const, text }] });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
let server: typeof import("../src/server.js");
beforeAll(async () => {
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  vi.stubEnv("CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS", "1");
  vi.stubEnv("CONTEXT_MODE_PLATFORM", "codex");
  vi.stubEnv("CONTEXT_MODE_WORKSPACE", workspace);
  vi.stubEnv("CONTEXT_MODE_PROJECT_DIR", workspace);
  vi.stubEnv("CLAUDE_PROJECT_DIR", "");
  vi.stubEnv("CONTEXT_MODE_DIR", join(workspace, ".gestalt", "context-mode"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  vi.stubEnv("CODEX_THREAD_ID", "budget-session");
  server = await import("../src/server.js");
});
afterAll(async () => { await flush(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

describe("whole serialized envelope", () => {
  test("published continuations use the registered schema and distinct byte/failure offsets", () => {
    const documentation = readFileSync(new URL('../../gestalt/skills/context-mode/references/bounded-retrieval.md', import.meta.url), 'utf8');
    const examples = [...documentation.matchAll(/```json\n([^`]+)```/g)].map(match => JSON.parse(match[1]));
    const page = {...examples[1], response_report: `report-${'a'.repeat(64)}`};
    const schema = server.REGISTERED_CTX_TOOLS.find(tool => tool.name === 'ctx_search')!.config.inputSchema;
    expect(schema.parse(page)).toMatchObject(page);
    expect(responseBudgetSchema.safeParse({...page, response_bytes: 65537}).success).toBe(false);
    const failure = {...examples[2], report: 'report-ABC123'};
    expect(evidenceRequestSchema.parse(failure)).toEqual(failure);
    expect(evidenceRequestSchema.safeParse({...failure, offset: 7}).success).toBe(false);
  });
  // Literal compact envelope overhead is 39 ASCII bytes, independent of the limiter.
  test.each([2047, 2048, 2049])("independent %i-byte boundary", total => {
    const original = response("a".repeat(total - 39));
    expect(size(original)).toBe(total);
    const result = boundResponse(original, scope);
    expect(size(result)).toBeLessThanOrEqual(2048);
    if (total <= 2048) expect(result).toBe(original);
    else expect(decode(result)).toMatchObject({ displayCompleteness: "partial", originalBytes: total });
  });

  test.each(["😀é漢字", "\"\\\n\t", "/long/source/".repeat(200)])("counts UTF-8, escaping and paths: %s", fragment => {
    const text = fragment.repeat(Math.ceil(4000 / Buffer.byteLength(fragment, "utf8")));
    const original = { ...response(text), structuredContent: { duplicate: text }, isError: false };
    const bounded = boundResponse(original, scope);
    expect(size(bounded)).toBeLessThanOrEqual(2048);
    expect(bounded.isError).toBe(false);
    const summary = decode(bounded);
    let body = "", offset = 0;
    do {
      const result = readResponsePage(scope, summary.overflow.report, offset);
      expect(size(result)).toBeLessThanOrEqual(2048);
      const page = decode(result); body += page.chunk; offset = page.nextOffset;
    } while (offset !== null);
    expect(body).toBe(JSON.stringify(original));
    expect(body).not.toContain("�");
  });

  test("many sources and structured-only failures remain in the retained envelope", () => {
    const original = { content: [], structuredContent: { sources: Array.from({ length: 100 }, (_, id) => ({ id, path: `/file/${id}`, failure: `FAIL-${id}` })) }, isError: true };
    const bounded = boundResponse(original, scope, 1024, { exitCode: 7, timedOut: false });
    expect(size(bounded)).toBeLessThanOrEqual(1024);
    expect(bounded.isError).toBe(true);
    expect(decode(bounded)).toMatchObject({ evidenceCompleteness: "complete", execution: { exitCode: 7, timedOut: false } });
    let body = "", offset = 0;
    do { const page = decode(readResponsePage(scope, decode(bounded).overflow.report, offset, 1024)); body += page.chunk; offset = page.nextOffset; } while (offset !== null);
    expect(JSON.parse(body)).toEqual(original);
  });

  test("bounded expansion and legacy small responses preserve shape", () => {
    const original = response("a".repeat(3000));
    expect(boundResponse(original, scope, 4096)).toBe(original);
    expect(boundResponse(response("legacy"), scope)).toEqual(response("legacy"));
  });

  test("storage failure declares partial evidence within the minimum budget", () => {
    const bounded = boundResponse(response("x".repeat(5000)), { root: join(root, "denied"), authorizeRead: () => false }, 1024);
    expect(size(bounded)).toBeLessThanOrEqual(1024);
    expect(decode(bounded)).toMatchObject({ evidenceCompleteness: "partial", overflow: { available: false } });
  });

  test.each([0, -1, 1023, 65537, 1.5, NaN, Infinity, "2048", null])("rejects invalid budget %s", response_bytes => {
    expect(responseBudgetSchema.safeParse({ response_bytes }).success).toBe(false);
  });
});

describe("production registered response boundary", () => {
  const call = (name: string, args: Record<string, unknown>) => server.REGISTERED_CTX_TOOLS.find(tool => tool.name === name)!.handler(args) as Promise<any>;

  test.each(["ctx_execute", "ctx_execute_file", "ctx_batch_execute", "ctx_search"])("%s enforces direct-call budget and exposes schema fields", async name => {
    const original = { ...response("😀".repeat(2000)), isError: true };
    const handler = vi.fn(() => original);
    const result: any = await server.wrapToolHandler(name, handler)({});
    expect(size(result)).toBeLessThanOrEqual(2048); expect(result.isError).toBe(true);
    const report = decode(result).overflow.report;
    const page = await call("ctx_search", { response_report: report });
    expect(page.isError).not.toBe(true); expect(decode(page).chunk.length).toBeGreaterThan(0);
    expect(size(page)).toBeLessThanOrEqual(2048);
    const invalid: any = await server.wrapToolHandler(name, handler)({ response_bytes: 999999 });
    expect(invalid.isError).toBe(true); expect(handler).toHaveBeenCalledTimes(1);
    const tool = server.REGISTERED_CTX_TOOLS.find(tool => tool.name === name)!;
    expect((tool.config.inputSchema as any).shape.response_bytes).toBeDefined();
  });

  test("actual stderr/nonzero exit stays visible through overflow and pages", async () => {
    const result = await call("ctx_execute", { language: "shell", code: "printf '%03000d' 0; printf 'FAIL-last' >&2; exit 7" });
    expect(size(result)).toBeLessThanOrEqual(2048); expect(result.isError).toBe(true);
    const summary = decode(result);
    expect(summary.execution).toMatchObject({ exitCode: 7, timedOut: false });
    let body = "", offset = 0;
    do { const page = decode(await call("ctx_search", { response_report: summary.overflow.report, response_offset: offset })); body += page.chunk; offset = page.nextOffset; } while (offset !== null);
    expect(body).toContain("FAIL-last"); expect(body).toContain("Exit code: 7");
  });

  test("unexpected handler errors are also bounded", async () => {
    const result: any = await server.wrapToolHandler("ctx_execute", () => { throw new Error("failure ".repeat(1000)); })({});
    expect(result.isError).toBe(true);
    expect(size(result)).toBeLessThanOrEqual(2048);
    expect(decode(result)).toMatchObject({ displayCompleteness: "partial", evidenceCompleteness: "complete" });
  });

  test("actual file, batch and search results obey the same declared envelope budget", async () => {
    const path = join(root, "workspace", "input.txt"); writeFileSync(path, "fixture");
    const file = await call("ctx_execute_file", { path, language: "javascript", code: "console.log('é'.repeat(2000))" });
    const batch = await call("ctx_batch_execute", { commands: [{ label: "fixture", command: "printf 'searchable failure detail%.0s ' $(seq 1 200)" }], queries: ["failure detail"], concurrency: 1 });
    const search = await call("ctx_search", { queries: ["failure detail"], limit: 100 });
    for (const result of [file, batch, search]) {
      expect(size(result)).toBeLessThanOrEqual(2048);
      expect(result.isError).not.toBe(true);
    }
  });

  test("registered SDK search schema accepts a continuation without normal queries", async () => {
    const tool = server.REGISTERED_CTX_TOOLS.find(tool => tool.name === "ctx_search")!;
    const initial: any = await server.wrapToolHandler("ctx_execute", () => response("x".repeat(3000)))({});
    const report = decode(initial).overflow.report;
    const parsed = (tool.config.inputSchema as any).safeParse({ response_report: report });
    expect(parsed.success).toBe(true);
    expect(parsed.data.response_report).toBe(report);
    // The actual registered schema, as consumed by the SDK, preserves the
    // continuation fields rather than stripping them or requiring queries.
    const result = await tool.handler(parsed.data) as any;
    expect(size(result)).toBeLessThanOrEqual(2048);
    expect(result.isError).not.toBe(true);
    expect(decode(result).chunk).toBeTruthy();
  });

  test("outdated warning is budgeted before measurement; continuation JSON stays parseable at 1024 bytes", async () => {
    const probe = await call("ctx_execute", { language: "shell", code: "printf ''" });
    const outputLength = 2040 - (size(probe) - Buffer.byteLength("(no output)"));
    expect(outputLength).toBeGreaterThan(0);
    vi.mocked(httpsRequest).mockImplementationOnce(((_url: unknown, _options: unknown, callback: (response: EventEmitter) => void) => {
      const req = new EventEmitter() as any;
      req.setTimeout = () => req;
      req.end = () => {
        const incoming = new EventEmitter(); callback(incoming);
        incoming.emit("data", Buffer.from('{"version":"999.0.0"}')); incoming.emit("end");
      };
      return req;
    }) as any);
    await server.refreshLatestVersion();
    const code = `printf '%0${outputLength}d' 0`;
    const result = await call("ctx_execute", { language: "shell", code });
    expect(size(result)).toBeLessThanOrEqual(2048);
    const summary = decode(result);
    expect(summary.originalBytes).toBeGreaterThan(2048);
    expect(summary.preview).toContain("outdated");
    await flush();
    const workspace = join(root, "workspace");
    const db = new Database(resolveSessionDbPath({ projectDir: workspace,
      sessionsDir: join(workspace, ".gestalt", "context-mode", "sessions") }));
    try {
      const row = db.prepare("SELECT data FROM session_events WHERE session_id=? AND type='tool_response_measurement' ORDER BY id DESC LIMIT 1")
        .get("budget-session") as { data: string };
      expect(JSON.parse(row.data).serializedVisibleBytes).toBe(size(result));
    } finally { db.close(); }
    const tool = server.REGISTERED_CTX_TOOLS.find(tool => tool.name === "ctx_search")!;
    const parse = (args: unknown) => (tool.config.inputSchema as any).parse(args);
    const small = await tool.handler(parse({ response_report: summary.overflow.report, response_bytes: 1024 })) as any;
    expect(size(small)).toBeLessThanOrEqual(1024);
    const page = decode(small);
    expect(page.notice).toContain("outdated");
    expect(page.chunk).toBeTruthy(); expect(page.nextOffset).toBeGreaterThan(0);
    const continuation = await tool.handler(parse({ response_report: page.report, response_offset: page.nextOffset })) as any;
    expect(size(continuation)).toBeLessThanOrEqual(2048);
    expect(decode(continuation).notice).toContain("outdated");
    let body = page.chunk + decode(continuation).chunk, offset = decode(continuation).nextOffset;
    while (offset !== null) {
      const next = decode(await tool.handler(parse({ response_report: page.report, response_offset: offset })));
      body += next.chunk; offset = next.nextOffset;
    }
    const retained = JSON.parse(body);
    expect(retained.content[0].text).toContain("outdated");
    expect(retained.content.map((part: any) => part.text).join("\n")).toContain("0".repeat(outputLength));
    retained.content[0].text = retained.content[0].text.split("\n\n").slice(1).join("\n\n");
    delete retained.capturedEvidence; // Retained raw evidence is outside the visible envelope.
    expect(size(retained)).toBeLessThanOrEqual(2048); // Warning alone crossed the boundary.
  });
});
