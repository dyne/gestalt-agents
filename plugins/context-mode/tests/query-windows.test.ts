import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ContentStore } from "../src/store.js";
import { deduplicateQueryWindows, formatQueryWindows, type WindowResult } from "../src/search/query-windows.js";
import { readResponsePage } from "../src/response-budget.js";

const root = mkdtempSync(join(tmpdir(), "query-windows-"));
const scope = { root: join(root, "reports"), authorizeRead: () => true };
const result = (patch: Partial<WindowResult> = {}): WindowResult => ({ source: "a.txt", title: "section",
  content: "alpha beta finding\nsecond line", chunkId: 1, sourceId: 1, sourceRevision: "revision-one", ...patch });
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
function readFull(handle: string) {
  let body = "", offset = 0;
  do { const page = JSON.parse(readResponsePage(scope, handle, offset).content[0].text); body += page.chunk; offset = page.nextOffset; } while (offset !== null);
  return JSON.parse(body);
}

describe("revision/range query-window identity", () => {
  test("same window appears once with all matched queries and exact locators", () => {
    const report = deduplicateQueryWindows([{ query: "alpha", results: [result()] }, { query: "beta", results: [result()] }]);
    expect(report.windows).toHaveLength(1);
    expect(report.windows[0]).toMatchObject({ source: "a.txt", revision: "revision-one", chunk: 1,
      lines: [1, 2], lineScope: "chunk", offsets: [0, 30], matchedQueries: [0, 1], text: result().content });
    expect(report.queries.map(query => query.windows)).toEqual([["w1"], ["w1"]]);
  });

  test.each([
    { source: "b.txt", sourceId: 2 }, { sourceRevision: "revision-two" }, { chunkId: 2 },
    { sourcePath: "/other/a.txt" }, { origin: "prior-session" },
  ])("equal text with distinct provenance remains distinct: %j", patch => {
    const report = deduplicateQueryWindows([{ query: "alpha", results: [result(), result(patch)] }]);
    expect(report.windows).toHaveLength(2);
  });

  test("unknown chunk locations are preserved separately rather than conflated", () => {
    const report = deduplicateQueryWindows([{ query: "alpha", results: [result({ chunkId: undefined }), result({ chunkId: undefined })] }]);
    expect(report.windows).toHaveLength(2);
  });

  test("overlapping ranges merge but disjoint ranges keep their attribution", () => {
    const content = Array.from({ length: 100 }, (_, i) => `${i}: ${i === 20 ? "alpha" : i === 22 ? "beta" : i === 80 ? "gamma" : "padding"} ${"x".repeat(40)}`).join("\n");
    const report = deduplicateQueryWindows(["alpha", "beta", "gamma"].map(query => ({ query, results: [result({ content })] })));
    expect(report.windows).toHaveLength(2);
    expect(report.windows[0].matchedQueries).toEqual([0, 1]);
    expect(report.windows[1].matchedQueries).toEqual([2]);
    expect(report.windows[0].offsets[1]).toBeLessThan(report.windows[1].offsets[0]);
    for (const window of report.windows) expect(window.text).toBe(content.slice(...window.offsets));
  });

  test("highlighted exact/fallback windows merge with deterministic ordering", () => {
    const content = `prefix ${"x".repeat(1600)} database failure ${"y".repeat(1000)}`;
    const highlighted = content.replace("database", "\x02database\x03");
    const groups = [{ query: "databse", results: [result({ content, highlighted })] },
      { query: "database", results: [result({ content })] }];
    expect(deduplicateQueryWindows(groups).windows).toHaveLength(1);
    expect(deduplicateQueryWindows(groups)).toEqual(deduplicateQueryWindows(groups));
  });

  test("empty/no-match queries stay explicit", () => {
    const report = deduplicateQueryWindows([{ query: "", results: [] }, { query: "absent", results: [] }]);
    expect(report.windows).toEqual([]); expect(report.queries.map(query => query.status)).toEqual(["empty", "empty"]);
    expect(report.queries.every(query => query.reason === "No matching sections found.")).toBe(true);
  });

  test("incremental whole-envelope budget retains every omitted query/window", () => {
    const groups = Array.from({ length: 12 }, (_, i) => ({ query: `query-${i}`, results: [result({ source: `file-${i}`, sourceId: i, content: `finding-${i} ${"😀".repeat(400)}` })] }));
    const full = deduplicateQueryWindows(groups);
    const compact = JSON.parse(formatQueryWindows(groups, 2048, scope));
    expect(bytes({ content: [{ type: "text", text: JSON.stringify(compact) }] })).toBeLessThanOrEqual(2048);
    expect(compact.overflow.report).toBeDefined();
    expect(readFull(compact.overflow.report)).toMatchObject(full);
    expect(readFull(compact.overflow.report).retrievedSources).toHaveLength(12);
    if (compact.queries) expect(compact.queries.every((query: any) => query.windows.length > 0 || query.status === "overflow")).toBe(true);
    else expect(compact.omittedQueries).toBe(groups.length);
  });

  test("small later window can use remaining budget after an oversized earlier result", () => {
    const groups = [{ query: "large", results: [result({ content: "large ".repeat(400) })] },
      { query: "tiny", results: [result({ source: "tiny.txt", sourceId: 2, content: "tiny-finding" })] }];
    const compact = JSON.parse(formatQueryWindows(groups, 1600, scope));
    expect(compact.queries[0].status).toBe("overflow");
    expect(compact.windows.some((window: any) => window.text === "tiny-finding")).toBe(true);
    expect(readFull(compact.overflow.report).windows).toHaveLength(2);
  });

  test("query-overflow storage failure is explicit partial evidence", () => {
    const groups = [{ query: "finding", results: [result({ content: "finding ".repeat(400) })] }];
    const compact = JSON.parse(formatQueryWindows(groups, 1024, { root: join(root, "denied"), authorizeRead: () => false }));
    expect(compact).toMatchObject({ evidenceCompleteness: "partial", overflow: { available: false } });
    expect(bytes({ content: [{ type: "text", text: JSON.stringify(compact) }] })).toBeLessThanOrEqual(1024);
  });
});

let server: typeof import("../src/server.js");
const call = (name: string, args: Record<string, unknown>) => server.REGISTERED_CTX_TOOLS.find(tool => tool.name === name)!.handler(args) as Promise<any>;
async function readServerReport(handle: string) {
  let body = "", offset = 0;
  do {
    const response = await call("ctx_search", { response_report: handle, response_offset: offset });
    expect(bytes(response)).toBeLessThanOrEqual(2048);
    const page = JSON.parse(response.content[0].text); body += page.chunk; offset = page.nextOffset;
  } while (offset !== null);
  return JSON.parse(body);
}
async function queryReport(response: any): Promise<any> {
  for (const line of response.content.flatMap((part: any) => part.text.split("\n"))) {
    try {
      const value = JSON.parse(line);
      if (value.originalBytes && value.overflow?.report) return queryReport(await readServerReport(value.overflow.report));
      if (value.queries || value.omittedQueries) return value.overflow?.report ? readServerReport(value.overflow.report) : value;
    } catch { /* Markdown scope/provenance lines are not query objects. */ }
  }
  throw new Error("query report missing");
}

beforeAll(async () => {
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  vi.stubEnv("CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS", "1"); vi.stubEnv("CONTEXT_MODE_PLATFORM", "codex");
  vi.stubEnv("CONTEXT_MODE_WORKSPACE", workspace); vi.stubEnv("CONTEXT_MODE_PROJECT_DIR", workspace);
  vi.stubEnv("CONTEXT_MODE_DIR", join(workspace, ".gestalt", "context-mode")); vi.stubEnv("CLAUDE_PROJECT_DIR", "");
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude")); vi.stubEnv("CODEX_THREAD_ID", "query-window-session");
  server = await import("../src/server.js");
});
afterAll(async () => { await new Promise(resolve => setImmediate(resolve)); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

describe("actual indexed retrieval and registered tool formatting", () => {
  test("store supplies source revisions and chunk identities through exact and fallback search", () => {
    const store = new ContentStore(":memory:");
    try {
      store.index({ source: "file-a", content: "# section\n\ndatabase connection responseBodyParser finding" });
      const exact = store.searchWithFallback("database", 3, "file-a", undefined, "exact");
      const fallback = store.searchWithFallback("databse", 3, "file-a", undefined, "exact");
      expect(exact[0].chunkId).toBeDefined(); expect(exact[0].sourceRevision).toMatch(/^index:/);
      expect(fallback[0].chunkId).toBe(exact[0].chunkId);
      expect(deduplicateQueryWindows([{ query: "database", results: exact }, { query: "databse", results: fallback }]).windows).toHaveLength(1);
      const oldRevision = exact[0].sourceRevision;
      store.index({ source: "file-a", content: "# section\n\ndatabase new revision" });
      expect(store.searchWithFallback("database", 1, "file-a")[0].sourceRevision).not.toBe(oldRevision);
      const file = join(root, "source.txt"), content = "# actual file\n\nfile-backed database finding";
      writeFileSync(file, content); store.index({ source: "file-backed", path: file });
      const fileResult = store.searchWithFallback("database", 1, "file-backed", undefined, "exact")[0];
      expect(fileResult.sourceRevision).toBe(createHash("sha256").update(content).digest("hex"));
      expect(fileResult.sourcePath).toBe(file);
    } finally { store.close(); }
  });

  test("registered search deduplicates query overlap but preserves identical distinct files", async () => {
    for (const source of ["doc-a", "doc-b"]) await call("ctx_index", { source, content: "# shared\n\nalpha beta database shared-finding" });
    const response = await call("ctx_search", { queries: ["alpha", "beta", "databse", ""], response_bytes: 8192 });
    const report = await queryReport(response);
    expect(report.windows).toHaveLength(2);
    expect(report.windows.map((window: any) => window.source).sort()).toEqual(["doc-a", "doc-b"]);
    expect(report.windows.every((window: any) => window.matchedQueries.join() === "0,1,2")).toBe(true);
    expect(report.queries[3].status).toBe("empty");
    const routine = await call("ctx_search", { queries: Array.from({ length: 30 }, () => "alpha") });
    expect(bytes(routine)).toBeLessThanOrEqual(2048);
    const full = await queryReport(routine);
    expect(full.queries).toHaveLength(30); expect(full.windows).toHaveLength(2);
    expect(full.windows[0].matchedQueries).toHaveLength(30);
  });

  test("batch exact scope and global scope share the same deduplication contract", async () => {
    await call("ctx_index", { source: "older-doc", content: "# old\n\nunique-prior-needle" });
    const commands = [{ label: "fresh", command: "printf 'fresh-alpha fresh-beta'" }];
    const local = await call("ctx_batch_execute", { commands, queries: ["fresh-alpha", "fresh-beta", "unique-prior-needle"], query_scope: "batch", concurrency: 1, response_bytes: 8192 });
    const localReport = await queryReport(local);
    expect(localReport.windows).toHaveLength(1); expect(localReport.windows[0].matchedQueries).toEqual([0, 1]);
    expect(localReport.queries[2].status).toBe("empty");
    const global = await call("ctx_batch_execute", { commands, queries: ["unique-prior-needle", "fresh-alpha", "fresh-beta"], query_scope: "global", concurrency: 1, response_bytes: 8192 });
    const globalReport = await queryReport(global);
    expect(globalReport.windows.some((window: any) => window.source === "older-doc")).toBe(true);
    expect(globalReport.windows.find((window: any) => window.source.startsWith("batch:")).matchedQueries).toEqual([1, 2]);
  });

  test("registered timeline retrieval merges file-backed auto-memory windows", async () => {
    const path = join(root, "workspace", "CLAUDE.md");
    writeFileSync(path, "# memory\n\nautomemoryuniquealpha automemoryuniquebeta shared-memory-finding\n");
    try {
      const response = await call("ctx_search", { queries: ["automemoryuniquealpha", "automemoryuniquebeta"], sort: "timeline", response_bytes: 8192 });
      const report = await queryReport(response);
      const memoryWindows = report.windows.filter((window: any) => window.origin === "auto-memory");
      expect(memoryWindows).toHaveLength(1);
      expect(memoryWindows[0]).toMatchObject({ path, matchedQueries: [0, 1], lineScope: "chunk" });
    } finally { rmSync(path); }
  });
});
