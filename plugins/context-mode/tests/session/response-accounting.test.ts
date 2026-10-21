import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SessionDB, resolveSessionDbPath } from "../../src/session/db.js";
import { AnalyticsEngine } from "../../src/session/analytics.js";
import { measureVisibleToolResponse } from "../../src/session/response-accounting.js";

// Expected serialized UTF-8 envelopes are authored independently of accounting.
const fixtures = [
  { name: "Unicode duplicate plus overflow and false", response: {
    content: [{ type: "text", text: "café 😀" }],
    structuredContent: { echo: "café 😀", overflow: { omittedBytes: 8 } }, isError: false,
  }, serialized: '{"content":[{"type":"text","text":"café 😀"}],"structuredContent":{"echo":"café 😀","overflow":{"omittedBytes":8}},"isError":false}' },
  { name: "empty", response: { content: [] }, serialized: '{"content":[]}' },
  { name: "explicit error", response: { content: [{ type: "text", text: "failure" }], isError: true },
    serialized: '{"content":[{"type":"text","text":"failure"}],"isError":true}' },
  { name: "wrapper echo with unknown nested calls", response: {
    content: [{ type: "text", text: "ctx_execute: ctx_search" }],
    structuredContent: { nestedTools: ["ctx_search"], delivery: "completed" },
  }, serialized: '{"content":[{"type":"text","text":"ctx_execute: ctx_search"}],"structuredContent":{"nestedTools":["ctx_search"],"delivery":"completed"}}' },
];

let root: string, workspace: string, state: string;
let boundary: typeof import("../../src/server.js");
let index = 0;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function database(sessionId: string) {
  const path = resolveSessionDbPath({ projectDir: workspace, sessionsDir: join(state, "sessions") });
  const seed = new SessionDB({ dbPath: path }); seed.ensureSession(sessionId, workspace); seed.close();
  return path;
}
function capture(path: string, sessionId: string) {
  const db = new Database(path);
  try {
    const rows = db.prepare("SELECT data FROM session_events WHERE session_id=? AND type='tool_response_measurement' ORDER BY id").all(sessionId) as Array<{ data: string }>;
    return { rows: rows.map(row => JSON.parse(row.data)), aggregate: new AnalyticsEngine(db).getToolResponseMeasurements(sessionId) };
  } finally { db.close(); }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "response-accounting-"));
  workspace = join(root, "workspace"); state = join(workspace, ".gestalt", "context-mode"); mkdirSync(workspace); mkdirSync(join(state, "sessions"), { recursive: true });
  vi.stubEnv("CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS", "1");
  vi.stubEnv("CONTEXT_MODE_PLATFORM", "codex");
  vi.stubEnv("CONTEXT_MODE_DIR", state);
  vi.stubEnv("CONTEXT_MODE_WORKSPACE", workspace);
  vi.stubEnv("CONTEXT_MODE_PROJECT_DIR", workspace);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  vi.stubEnv("CLAUDE_PROJECT_DIR", "");
  boundary = await import("../../src/server.js");
});
afterAll(async () => { await flush(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

describe("production handler response boundary → persistence → analytics", () => {
  test.each(fixtures)("$name", async ({ response, serialized }) => {
    const sid = `fixture-${index++}`; vi.stubEnv("CODEX_THREAD_ID", sid); const path = database(sid);
    const handler = boundary.wrapToolHandler("fixture_wrapper", () => response);
    const returned = await handler({}, { _meta: { nestedTools: ["forged"], delivery: "completed" } });
    expect(returned).toBe(response); await flush();
    const { rows, aggregate } = capture(path, sid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serializedVisibleBytes: Buffer.byteLength(serialized, "utf8"),
      nestedToolNames: null, nestedAttribution: "unknown", delivery: "unknown", hostTransportVisibility: "estimate" });
    expect(aggregate).toMatchObject({ calls: 1, measuredCalls: 1, knownBytes: Buffer.byteLength(serialized, "utf8"),
      totalBytes: Buffer.byteLength(serialized, "utf8"), coverage: "complete" });
    // Only metadata and counts are persisted, including for echo-rich responses.
    expect(JSON.stringify(rows)).not.toContain("café");
    expect(rows[0]).not.toHaveProperty("content"); expect(rows[0]).not.toHaveProperty("structuredContent");
  });

  test("authoritative restore and missing Codex identity never borrow a sibling", async () => {
    const { restoreSessionStats } = await import("../../src/session/persist-tool-calls.js");
    const sid = `restore-${index++}`; const path = database(sid);
    const db = new SessionDB({ dbPath: path });
    db.incrementToolCall(sid, "ctx_search", 17);
    db.ensureSession("newer-sibling", workspace);
    db.incrementToolCall("newer-sibling", "ctx_search", 999);
    db.close();
    expect(restoreSessionStats(path, sid)?.bytesReturned).toEqual({ ctx_search: 17 });
    expect(restoreSessionStats(path, "absent")?.bytesReturned).toEqual({});
    vi.stubEnv("CODEX_THREAD_ID", "");
    expect(boundary.currentAttribution()).toBeUndefined();
    const before = capture(path, "newer-sibling").rows.length;
    await boundary.wrapToolHandler("fixture_wrapper", () => ({ content: [] }))({}); await flush();
    expect(capture(path, "newer-sibling").rows).toHaveLength(before);
    expect(restoreSessionStats(path, "newer-sibling")?.calls).toEqual({ ctx_search: 1 });
  });

  test("actual registered handler is measured once, even when its implementation tracks a response", async () => {
    const sid = `registered-${index++}`; vi.stubEnv("CODEX_THREAD_ID", sid); const path = database(sid);
    const tool = boundary.REGISTERED_CTX_TOOLS.find(tool => tool.name === "ctx_upgrade")!;
    const returned = await tool.handler({}); await tool.handler({}); await flush();
    const { rows, aggregate } = capture(path, sid);
    expect(rows).toHaveLength(2); // Identical responses are two actual calls.
    expect(rows[0].captureId).not.toBe(rows[1].captureId);
    expect(aggregate.totalBytes).toBe(2 * Buffer.byteLength(JSON.stringify(returned), "utf8"));
    expect(aggregate.calls).toBe(2);
  });

  test("serialization failure stays null in stored observation and aggregate", async () => {
    const sid = `circular-${index++}`; vi.stubEnv("CODEX_THREAD_ID", sid); const path = database(sid);
    const circular: Record<string, unknown> = {}; circular.self = circular;
    const response = { content: [{ type: "text", text: "private-canary" }], structuredContent: circular };
    await boundary.wrapToolHandler("fixture_wrapper", () => response)({});
    await boundary.wrapToolHandler("fixture_wrapper", () => ({ content: [] }))({}); await flush();
    const { rows, aggregate } = capture(path, sid);
    expect(rows[0]).toMatchObject({ serializedVisibleBytes: null, digest: null, delivery: "unknown" });
    expect(aggregate).toEqual({ calls: 2, measuredCalls: 1, unmeasurableCalls: 1, missingCalls: 0,
      knownBytes: 14, totalBytes: null, coverage: "partial" });
    expect(JSON.stringify(rows)).not.toContain("private-canary");
  });

  test("mixed registered tool calls retain their own envelopes and one shared denominator", async () => {
    const sid = `mixed-${index++}`; vi.stubEnv("CODEX_THREAD_ID", sid); const path = database(sid);
    const call = (name: string, args: Record<string, unknown>) =>
      boundary.REGISTERED_CTX_TOOLS.find(tool => tool.name === name)!.handler(args);
    const returned = await Promise.all([call("ctx_upgrade", {}), call("ctx_purge", { confirm: false })]);
    await flush();
    const { rows, aggregate } = capture(path, sid);
    expect(rows.map(row => row.tool).sort()).toEqual(["ctx_purge", "ctx_upgrade"]);
    expect(aggregate.totalBytes).toBe(returned.reduce<number>((sum, response) =>
      sum + Buffer.byteLength(JSON.stringify(response), "utf8"), 0));
    expect(aggregate.calls).toBe(2);
  });

  test("registered stats returns a bounded metrics-only summary and scoped overflow pages", async () => {
    const sid = `stats-${index++}`; vi.stubEnv("CODEX_THREAD_ID", sid); database(sid);
    const call = (name: string, args: Record<string, unknown>) =>
      boundary.REGISTERED_CTX_TOOLS.find(tool => tool.name === name)!.handler(args) as Promise<any>;
    await call("ctx_upgrade", {}); await flush();
    const response = await call("ctx_stats", {}); await flush();
    expect(Buffer.byteLength(JSON.stringify(response), "utf8")).toBeLessThanOrEqual(2048);
    const report = JSON.parse(response.content[0].text);
    expect(report.accountQuotaTokens).toBeNull();
    expect(report.responses.knownBytes).toBeGreaterThan(0);
    if (report.overflow?.report) {
      const page = await call("ctx_stats", { report: report.overflow.report }); await flush();
      expect(page.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThanOrEqual(2048);
      const policy = join(workspace, ".claude"); mkdirSync(policy, { recursive: true });
      writeFileSync(join(policy, "settings.json"), JSON.stringify({ permissions: { deny: ["Read(**/efficiency/**)"] } }));
      const policyDenied = await call("ctx_stats", { report: report.overflow.report }); await flush();
      expect(policyDenied.isError).toBe(true); rmSync(join(policy, "settings.json"));
      vi.stubEnv("CODEX_THREAD_ID", `${sid}-other`);
      const denied = await call("ctx_stats", { report: report.overflow.report }); await flush();
      expect(denied.isError).toBe(true);
    }
    const snapshots = readdirSync(join(state, "sessions")).filter(name => name.startsWith("stats-") && name.endsWith(".json"));
    expect(snapshots.length).toBeGreaterThan(0);
    const snapshot = JSON.parse(readFileSync(join(state, "sessions", snapshots[0]), "utf8"));
    expect(snapshot).toMatchObject({ schemaVersion: 3, bytes_returned_scope: "known_only", comparison_coverage: "unavailable", reduction_pct: null,
      tokens_saved: null, dollars_saved_session: null, tokens_saved_lifetime: null, dollars_saved_lifetime: null });
    const invalid = await call("ctx_stats", { report: "../../PRIVATE_CANARY" }); await flush();
    expect(invalid.isError).toBe(true); expect(JSON.stringify(invalid)).not.toContain("PRIVATE_CANARY");
  });

  test("missing observations from retention or legacy history keep totals partial", async () => {
    const sid = `missing-${index++}`; const path = database(sid);
    const db = new SessionDB({ dbPath: path }); db.incrementToolCall(sid, "old_tool", 10); db.close();
    expect(capture(path, sid).aggregate).toMatchObject({ calls: 1, missingCalls: 1, totalBytes: null, coverage: "partial" });
  });
});

describe("trusted runtime metadata and framing definitions", () => {
  test.each(["partial", "completed"] as const)("keeps trusted %s delivery", delivery => {
    const response = { content: [], isError: false };
    const measurement = measureVisibleToolResponse(response, { delivery, nestedToolNames: ["b", "a", "a"] });
    expect(measurement).toMatchObject({ delivery, nestedToolNames: ["a", "b"], nestedAttribution: "runtime" });
    expect(measurement.serializedVisibleBytes).toBe(30); // UTF-8 of {"content":[],"isError":false}
  });
  test("host-only metadata and JSON-RPC framing are unobserved", () => {
    const measurement = measureVisibleToolResponse({ content: [], _meta: { private: "secret" } } as any);
    expect(measurement.serializedVisibleBytes).toBe(14); // {"content":[]}
    expect(measurement.delivery).toBe("unknown");
    expect(measurement.hostTransportVisibility).toBe("estimate");
  });
});
