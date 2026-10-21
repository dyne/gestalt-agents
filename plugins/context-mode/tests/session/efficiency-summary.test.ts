import { afterAll, describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { SessionDB, resolveSessionDbPath } from "../../src/session/db.js";
import { AnalyticsEngine } from "../../src/session/analytics.js";
import { formatEfficiencySummary, readEfficiencySummary, efficiencyResultBytes } from "../../src/session/efficiency-report.js";
import { extractCodexMeasurementsSince } from "../../src/adapters/codex/usage.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "efficiency-summary-")));
afterAll(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
let sequence = 0;
const full = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 2 };
function fixture(ids = ["root"]) {
  const path = join(root, `case-${sequence++}.db`); const db = new SessionDB({ dbPath: path });
  for (const id of ids) db.ensureSession(id, root);
  return { db, path };
}
function observe(db: SessionDB, id: string, tool: string, size: number | null, at = 10) {
  const n = sequence++;
  db.insertEvent(id, { type: "tool_response_measurement", category: "mcp", priority: 4,
    data: JSON.stringify({ captureId: `r-${n}`, tool, observedAtMs: at, serializedVisibleBytes: size, delivery: "unknown" }) });
  db.incrementToolCall(id, tool, size ?? 0);
}
function usage(db: SessionDB, id: string, role: "root" | "child" | "unknown", counters = full, at = 10) {
  db.insertEvent(id, { type: "efficiency_usage", category: "cost", priority: 4, data: JSON.stringify({
    captureId: `u-${sequence++}`, sourceId: id, role, scope: "source_cumulative", observedAtMs: at, counters,
  }) });
}
function summary(path: string, id = "root", children?: string[], cutoff = 1000, allowedTools?: string[]) {
  const db = new Database(path);
  try { return new AnalyticsEngine(db).getEfficiencySummary({ sessionId: id, expectedChildIds: children, captureCutoffMs: cutoff, allowedTools }); }
  finally { db.close(); }
}
function manyTools() {
  const { db, path } = fixture();
  for (let i = 0; i < 80; i++) observe(db, "root", `ctx_tool_${i}`, i === 79 ? 3000 : 10);
  db.incrementCompactCount("root"); db.incrementCompactCount("root"); db.close();
  return summary(path, "root", undefined, 1000, Array.from({ length: 80 }, (_, i) => `ctx_tool_${i}`));
}
const scope = (suffix: string) => ({ root: join(root, suffix), authorizeRead: (_path: string) => true });
const parsed = (response: ReturnType<typeof formatEfficiencySummary>) => JSON.parse(response.content[0].text);

describe("coverage-preserving session efficiency analytics", () => {
  test("complete root and one child do not conceal another incomplete child", () => {
    const { db, path } = fixture(["root", "a", "b"]);
    usage(db, "root", "root"); usage(db, "a", "child");
    usage(db, "b", "child", { inputTokens: 4 } as typeof full);
    observe(db, "root", "ctx_execute", 100); observe(db, "a", "ctx_search", 200); observe(db, "b", "ctx_search", null);
    db.close(); const report = summary(path, "root", ["a", "b"]);
    expect(report.providerTokens.coverage).toBe("partial");
    expect(report.providerTokens.attributedTotal).toBeNull();
    expect(report.providerTokens.unknownCounters.child).toContain("outputTokens");
    expect(report.responses).toMatchObject({ knownBytes: 300, totalBytes: null, unmeasurableCalls: 1, coverage: "partial" });
    expect(report.responses.byTool).toEqual([
      { tool: "ctx_execute", calls: 1, observedCalls: 1, knownBytes: 100, unmeasurableCalls: 0, missingCalls: 0 },
      { tool: "ctx_search", calls: 2, observedCalls: 2, knownBytes: 200, unmeasurableCalls: 1, missingCalls: 0 },
    ]);
    expect(report.responses.byRole).toEqual({ root: null, child: null, unknown: 300 });
    expect(report.savings.percent).toBeNull(); expect(report.accountQuotaTokens).toBeNull();
  });
  test("missing children and absent usage remain unknown, while known bytes are reproducible", () => {
    const { db, path } = fixture(); observe(db, "root", "ctx_search", 40); db.close();
    const report = summary(path, "root", ["missing"]);
    expect(report.responses.totalBytes).toBeNull(); expect(report.responses.unobservedSources).toHaveLength(1);
    expect(report.providerTokens.missingChildren).toHaveLength(1); expect(report.providerTokens.coverage).toBe("partial");
    expect(report.responses.knownBytes).toBe(40); expect(report.transport.measuredBytes).toBeNull();
    expect(report.transport.estimatedModelVisibleBytes).toBeNull();
  });
  test("complete counter coverage keeps output and reasoning separate", () => {
    const { db, path } = fixture(); usage(db, "root", "root"); observe(db, "root", "ctx_search", 64); db.close();
    const report = summary(path, "root", []);
    expect(report.providerTokens.attributedTotal).toEqual(full);
    expect(report.responses.totalBytes).toBe(64); expect(report.transport.estimatedModelVisibleBytes).toBe(64);
    expect(report.providerTokens.knownByRole.unknown.inputTokens).toBe(0);
    expect(report.savings.percent).toBeNull();
  });
  test("retained complete counters cannot conceal an evicted epoch or historical gap", () => {
    const { db, path } = fixture(); usage(db, "root", "root"); observe(db, "root", "ctx_search", 64); db.close();
    const raw = new Database(path); raw.prepare("DELETE FROM session_events WHERE type='efficiency_usage'").run(); raw.close();
    const reopened = new SessionDB({ dbPath: path }); usage(reopened, "root", "root", full, 30); reopened.close();
    const report = summary(path, "root", []);
    expect(report.providerTokens).toMatchObject({ historyMissingEvents: 1, coverage: "partial", attributedTotal: null });
    expect(report.responses.totalBytes).toBe(64); expect(report.savings.percent).toBeNull();
  });
  test("empty sessions and legacy records never establish zero usage or complete coverage", () => {
    const { db, path } = fixture();
    db.insertEvent("root", { type: "agent_usage", category: "cost", priority: 2, data: "tokens_in:999 tokens_out:999" });
    db.close(); const report = summary(path);
    expect(report.responses.totalBytes).toBeNull(); expect(report.responses.coverage).toBe("partial");
    expect(report.providerTokens).toMatchObject({ samples: 0, coverage: "partial", attributedTotal: null });
  });
  test("legacy call gaps, missing timestamps and a cutoff cannot improve coverage or savings", () => {
    const { db, path } = fixture(); observe(db, "root", "ctx_search", 50);
    observe(db, "root", "ctx_search", 500, 2000); db.incrementToolCall("root", "ctx_search", 600);
    db.insertEvent("root", { type: "tool_response_measurement", category: "mcp", priority: 4,
      data: JSON.stringify({ captureId: "undated", tool: "ctx_other", serializedVisibleBytes: 12 }) });
    db.close(); const report = summary(path);
    expect(report.responses).toMatchObject({ knownBytes: 50, missingCalls: 2, undatedCalls: 1, totalBytes: null, coverage: "partial" });
    expect(report.savings.percent).toBeNull();
  });
  test("prompts, commands, model output, source IDs and environment canaries are absent from full artifacts", () => {
    const canary = "ctx_private_canary_abcdefghijklmnopqrstuvwxyz"; vi.stubEnv("FAKE_SECRET", canary);
    const { db, path } = fixture([canary]);
    for (const type of ["prompt", "user_message", "agent_usage", "command", "model_output"]) {
      db.insertEvent(canary, { type, category: "data", priority: 1, data: canary });
    }
    usage(db, canary, "unknown"); observe(db, canary, canary, 10); db.close();
    const report = summary(path, canary); const safe = JSON.stringify(report);
    expect(safe).not.toContain(canary); expect(report.responses.byTool[0].tool).toBe("unknown");
    const artifact = formatEfficiencySummary(report, scope("redaction"));
    expect(JSON.stringify(artifact)).not.toContain(canary);
    const pointer = parsed(artifact).overflow;
    if (pointer?.report) expect(readFileSync(join(root, "redaction", `${pointer.report}.json`), "utf8")).not.toContain(canary);
  });
});

describe("2048-byte summaries and authorized overflow", () => {
  test("many tools, oversized responses and compactions remain recoverable within envelope budget", () => {
    const report = manyTools(); expect(report.responses.oversized).toEqual({ thresholdBytes: 2048, calls: 1, maxKnownBytes: 3000 });
    expect(report.compactions.observedCount).toBe(2);
    const storage = scope("many"); const routine = formatEfficiencySummary(report, storage);
    expect(efficiencyResultBytes(routine)).toBeLessThanOrEqual(2048);
    const pointer = parsed(routine).overflow; expect(pointer.report).toMatch(/^report-[a-f0-9]{64}$/);
    let offset: number | null = 0; let reconstructed = "", retrievalBytes = 0;
    while (offset !== null) {
      const page = readEfficiencySummary(storage, pointer.report, offset);
      const bytes = efficiencyResultBytes(page); retrievalBytes += bytes; expect(bytes).toBeLessThanOrEqual(2048);
      const data = parsed(page); reconstructed += data.chunk; offset = data.nextOffset;
    }
    expect(JSON.parse(reconstructed)).toEqual(report);
    expect(retrievalBytes).toBeGreaterThan(Buffer.byteLength(reconstructed));
  });
  test("denied or failed overflow storage marks evidence partial", () => {
    const report = manyTools(); const denied = formatEfficiencySummary(report, { ...scope("denied"), authorizeRead: () => false });
    expect(parsed(denied)).toMatchObject({ evidenceCompleteness: "partial", overflow: { available: false } });
    const blocked = join(root, "blocker"); writeFileSync(blocked, "file");
    expect(parsed(formatEfficiencySummary(report, { ...scope("unused"), root: blocked }))).toMatchObject({ evidenceCompleteness: "partial" });
  });
  test("cross-session, denied, tampered, deleted, traversal and symlink references fail closed", () => {
    const storage = scope("access"); const pointer = parsed(formatEfficiencySummary(manyTools(), storage)).overflow;
    for (const [access, name] of [[scope("other-session"), pointer.report],
      [{ ...storage, authorizeRead: () => false }, pointer.report], [storage, "../escape"]] as const) {
      expect(readEfficiencySummary(access, name).isError).toBe(true);
    }
    const path = join(storage.root, `${pointer.report}.json`); writeFileSync(path, "{}");
    expect(readEfficiencySummary(storage, pointer.report).isError).toBe(true);
    rmSync(path); expect(readEfficiencySummary(storage, pointer.report).isError).toBe(true);
    if (process.platform !== "win32") {
      symlinkSync(join(root, "redaction"), join(root, "symlink"), "dir");
      expect(parsed(formatEfficiencySummary(manyTools(), scope("symlink")))).toMatchObject({ evidenceCompleteness: "partial" });
    }
  });
  test("UTF-8 pagination preserves code points and rejects continuation-byte offsets", () => {
    const report = manyTools(); report.scope.session = "é😀".repeat(100);
    const storage = scope("unicode"); const pointer = parsed(formatEfficiencySummary(report, storage)).overflow;
    const data = readFileSync(join(storage.root, `${pointer.report}.json`));
    const invalid = data.indexOf(Buffer.from("é")) + 1;
    expect(readEfficiencySummary(storage, pointer.report, invalid).isError).toBe(true);
    let offset: number | null = 0, text = "";
    while (offset !== null) { const page = readEfficiencySummary(storage, pointer.report, offset); expect(efficiencyResultBytes(page)).toBeLessThanOrEqual(2048); const value = parsed(page); text += value.chunk; offset = value.nextOffset; }
    expect(Buffer.from(text)).toEqual(data);
  });
});

describe("raw provider measurements", () => {
  test("actual Stop hook persists raw observations locally once across its shared cursor", () => {
    const workspace = join(root, "hook-workspace"), codex = join(root, "hook-codex");
    mkdirSync(workspace); mkdirSync(join(codex, "sessions"), { recursive: true });
    const sid = "hook-metrics-session";
    const rollout = [
      { type: "turn_context", payload: { model: "synthetic-model", secret: "PRIVATE_CONVERSATION_CANARY" } },
      { timestamp: "2026-01-01T00:00:00Z", type: "event_msg", payload: { type: "token_count", info: {
        total_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 2 },
        last_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 2 },
      } } },
    ].map(value => JSON.stringify(value)).join("\n");
    writeFileSync(join(codex, "sessions", `rollout-synthetic-${sid}.jsonl`), rollout);
    const plugin = join(import.meta.dirname, "../..");
    for (let repeat = 0; repeat < 2; repeat++) {
      const run = spawnSync(process.execPath, [join(plugin, "hooks/codex/stop.mjs")], {
        input: JSON.stringify({ session_id: sid, cwd: workspace, workspace_roots: [workspace] }), encoding: "utf8",
        env: { ...process.env, CODEX_HOME: codex, CONTEXT_MODE_WORKSPACE: workspace,
          CONTEXT_MODE_DIR: join(workspace, ".gestalt", "context-mode"), CONTEXT_MODE_SESSION_SUFFIX: "",
          XDG_CONFIG_HOME: join(root, "isolated-config"), APPDATA: join(root, "isolated-config") },
      });
      expect(run.status, run.stderr).toBe(0);
    }
    const path = resolveSessionDbPath({ projectDir: workspace, sessionsDir: join(workspace, ".gestalt", "context-mode", "sessions") });
    const db = new Database(path);
    try {
      const rows = db.prepare("SELECT data FROM session_events WHERE type='efficiency_usage'").all() as Array<{ data: string }>;
      expect(rows).toHaveLength(1); expect(rows[0].data).not.toContain("PRIVATE_CONVERSATION_CANARY");
      expect(JSON.parse(rows[0].data)).toMatchObject({ role: "unknown", counters: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2 } });
    } finally { db.close(); }
  });

  test("raw cumulative extraction preserves missing fields, timestamps and reasoning subset without conversation exports", () => {
    const line = (index: number, total: Record<string, number>) => JSON.stringify({ timestamp: new Date(index).toISOString(), type: "event_msg",
      payload: { type: "token_count", info: { total_token_usage: total }, secret: "RAW_CONVERSATION_CANARY" } });
    const rollout = [line(10, { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 2 }),
      line(20, { input_tokens: 12 }), line(30, { input_tokens: 14, output_tokens: 7, reasoning_output_tokens: 2 })].join("\n");
    const events = extractCodexMeasurementsSince(rollout, null, "root");
    expect(events).toHaveLength(3); expect(JSON.stringify(events)).not.toContain("RAW_CONVERSATION_CANARY");
    const first = JSON.parse(events[0].data); expect(first.counters).toEqual({ inputTokens: 10, outputTokens: 5, reasoningTokens: 2 });
    expect(JSON.parse(events[1].data).counters).toEqual({ inputTokens: 12 });
    expect(extractCodexMeasurementsSince(rollout, "1", "root")).toHaveLength(1);
    const lastOnly = JSON.stringify({ timestamp: new Date(40).toISOString(), type: "event_msg",
      payload: { type: "token_count", info: { last_token_usage: { output_tokens: 99 } } } });
    expect(JSON.parse(extractCodexMeasurementsSince(lastOnly, null, "root")[0].data))
      .toMatchObject({ scope: "source_cumulative", counters: {} });
    const { db, path } = fixture(); for (const event of events) db.insertEvent("root", event); db.close();
    const report = summary(path); expect(report.providerTokens.knownByRole.unknown.outputTokens).toBe(7);
    expect(report.providerTokens.knownByRole.unknown.reasoningTokens).toBe(2);
    expect(report.providerTokens.coverage).toBe("partial");
  });
});
