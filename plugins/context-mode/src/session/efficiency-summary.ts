import { createHash } from "node:crypto";
import type { DatabaseAdapter } from "./analytics.js";
import { createMeasurementLedger, recordUsageMeasurement, summarizeEfficiencyMeasurement,
  type UsageMeasurement } from "./measurement-semantics.js";

const opaque = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const validSize = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const DEFAULT_TOOLS = ["ctx_execute", "ctx_execute_file", "ctx_batch_execute", "ctx_search", "ctx_index", "ctx_fetch_and_index", "ctx_test_evidence", "ctx_stats", "ctx_doctor", "ctx_upgrade", "ctx_purge", "ctx_insight"];


/** Metrics-only view of the existing session database, never legacy usage text.
 * Source IDs are opaque in exported summaries. Expected children must come from
 * trusted topology, not parsed tool output. Omitting topology scopes this view
 * to the selected session and explicitly leaves descendant coverage unknown.
 */
export function collectEfficiencySummary(db: DatabaseAdapter, opts: {
  sessionId: string; captureCutoffMs: number; expectedChildIds?: string[]; allowedTools?: readonly string[];
}) {
  const allowed = new Set((opts.allowedTools ?? DEFAULT_TOOLS).filter(tool => /^ctx_[a-z0-9_]{1,60}$/.test(tool)));
  const safeTool = (value: unknown) => typeof value === "string" && allowed.has(value) ? value : "unknown";
  const ids = [...new Set([opts.sessionId, ...(opts.expectedChildIds ?? [])])];
  const placeholders = ids.map(() => "?").join(",");
  const responseRows = db.prepare(`SELECT session_id, data FROM session_events
    WHERE session_id IN (${placeholders}) AND type = 'tool_response_measurement' ORDER BY id`).all(...ids) as
    Array<{ session_id: string; data: string }>;
  const legacy = db.prepare(`SELECT session_id, tool, calls FROM tool_calls
    WHERE session_id IN (${placeholders})`).all(...ids) as Array<{ session_id: string; tool: string; calls: number }>;
  const byTool = new Map<string, { tool: string; calls: number; observedCalls: number; knownBytes: number; unmeasurableCalls: number }>();
  const bucket = (tool: string) => {
    let value = byTool.get(tool);
    if (!value) { value = { tool, calls: 0, observedCalls: 0, knownBytes: 0, unmeasurableCalls: 0 }; byTool.set(tool, value); }
    return value;
  };
  const observedSources = new Set<string>();
  const delivery = { completed: 0, partial: 0, unknown: 0 };
  let knownBytes = 0, measuredCalls = 0, unmeasurableCalls = 0, undatedCalls = 0;
  let oversizedCalls = 0, maxKnownBytes = 0;
  for (const row of legacy) {
    if (validSize(row.calls)) bucket(safeTool(row.tool)).calls += row.calls;
  }
  for (const row of responseRows) {
    let value: Record<string, unknown> = {};
    try { value = JSON.parse(row.data); } catch { /* Invalid data stays uncovered. */ }
    if (typeof value?.observedAtMs === "number" && value.observedAtMs > opts.captureCutoffMs) continue;
    observedSources.add(row.session_id);
    const item = bucket(safeTool(value?.tool)); item.observedCalls++;
    if (!validSize(value?.observedAtMs)) undatedCalls++;
    const size = value?.serializedVisibleBytes;
    if (validSize(size) && validSize(value?.observedAtMs)) {
      measuredCalls++; knownBytes += size; item.knownBytes += size;
      if (size > 2048) oversizedCalls++;
      maxKnownBytes = Math.max(maxKnownBytes, size);
    } else if (!validSize(size)) { unmeasurableCalls++; item.unmeasurableCalls++; }
    const state = value?.delivery === "completed" || value?.delivery === "partial" ? value.delivery : "unknown";
    delivery[state]++;
  }
  const tools = [...byTool.values()].sort((a, b) => a.tool.localeCompare(b.tool));
  const calls = tools.reduce((sum, item) => sum + Math.max(item.calls, item.observedCalls), 0);
  const missingCalls = tools.reduce((sum, item) => sum + Math.max(0, item.calls - item.observedCalls), 0);
  const denominatorMismatch = tools.some(item => item.observedCalls > item.calls);
  const unobservedSources = ids.filter(id => !observedSources.has(id)).map(opaque);
  const responsesComplete = calls > 0 && !missingCalls && !unmeasurableCalls && !undatedCalls
    && !denominatorMismatch && !unobservedSources.length;

  const usageRows = db.prepare(`SELECT data FROM session_events
    WHERE session_id IN (${placeholders}) AND type = 'efficiency_usage' ORDER BY id`).all(...ids) as Array<{ data: string }>;
  let ledger = createMeasurementLedger({ captureCutoffMs: opts.captureCutoffMs, expectedChildIds: opts.expectedChildIds });
  let malformedUsageSamples = 0;
  const samples: UsageMeasurement[] = [];
  for (const row of usageRows) {
    try {
      const value = JSON.parse(row.data);
      if (!value || typeof value.sourceId !== "string" || !ids.includes(value.sourceId)
        || typeof value.captureId !== "string" || !["root", "child", "unknown"].includes(value.role)
        || !["source_cumulative", "turn_delta"].includes(value.scope)
        || !value.counters || typeof value.counters !== "object") throw new Error();
      if (typeof value.observedAtMs === "number" && value.observedAtMs > opts.captureCutoffMs) continue;
      samples.push(value);
    } catch { malformedUsageSamples++; }
  }
  // The database insertion order need not match the source's observation order.
  // Stable timestamp sorting occurs before the ledger's explicit late-data guard.
  samples.sort((a, b) => (a.observedAtMs ?? Infinity) - (b.observedAtMs ?? Infinity));
  for (const sample of samples) ledger = recordUsageMeasurement(ledger, sample);
  const usage = summarizeEfficiencyMeasurement(ledger);
  const reasons: Record<string, number> = {};
  for (const issue of usage.issues) reasons[issue.reason] = (reasons[issue.reason] ?? 0) + 1;
  const compaction = db.prepare(`SELECT SUM(compact_count) AS count FROM session_meta
    WHERE session_id IN (${placeholders})`).get(...ids) as { count: number | null } | undefined;
  const historical = db.prepare(`SELECT SUM(event_count) AS count FROM session_meta
    WHERE session_id IN (${placeholders})`).get(...ids) as { count: number | null } | undefined;
  const retained = db.prepare(`SELECT COUNT(*) AS count FROM session_events
    WHERE session_id IN (${placeholders})`).get(...ids) as { count: number } | undefined;
  const historicalCount = historical?.count, retainedCount = retained?.count;
  const historyMissingEvents = validSize(historicalCount) && validSize(retainedCount)
    ? Math.max(0, historicalCount - retainedCount) : null;
  // Retention may have removed a whole counter epoch or its historical gap.
  // A later complete reading cannot establish complete session history again.
  const providerComplete = samples.length > 0 && !malformedUsageSamples
    && historyMissingEvents === 0 && usage.coverage === "complete";
  return {
    version: 1,
    scope: { session: opaque(opts.sessionId), captureCutoffMs: opts.captureCutoffMs,
      sources: ids.length, descendants: opts.expectedChildIds === undefined ? "unknown" : "declared" },
    responses: {
      basis: "observed MCP result JSON before framing", denominatorScope: "session call counters; post-cutoff calls force partial coverage", calls, measuredCalls, unmeasurableCalls,
      missingCalls, undatedCalls, denominatorMismatch, knownBytes,
      totalBytes: responsesComplete ? knownBytes : null,
      coverage: responsesComplete ? "complete" : "partial", unobservedSources,
      byTool: tools.map(item => ({ ...item, missingCalls: Math.max(0, item.calls - item.observedCalls) })),
      // No authoritative runtime role or nested-call metadata is exposed here.
      byRole: { root: null, child: null, unknown: knownBytes },
      nestedAttribution: "unknown", delivery,
      oversized: { thresholdBytes: 2048, calls: oversizedCalls, maxKnownBytes },
    },
    providerTokens: {
      basis: "provider counters; reasoning is a subset of output", knownCountsAreLowerBounds: true,
      coverage: providerComplete ? "complete" : "partial", samples: samples.length, malformedUsageSamples, historyMissingEvents,
      knownByRole: { root: usage.direct, children: usage.children.map(child => ({ source: opaque(child.sourceId), counters: child.counters })), unknown: usage.unattributed },
      attributedTotal: providerComplete ? usage.total : null,
      missingChildren: usage.missingChildIds.map(opaque),
      unknownCounters: { root: usage.unknownDirectCounters, child: usage.unknownChildCounters, unknown: usage.unknownUnattributedCounters },
      unresolved: usage.unresolvedContributions.map(({ sourceId, ...rest }) => ({ source: opaque(sourceId), ...rest })),
      issues: reasons, counterResets: usage.counterResets,
      legacyUsage: "excluded: legacy records do not establish raw counter coverage",
    },
    transport: { measuredBytes: null, estimatedModelVisibleBytes: responsesComplete ? knownBytes : null,
      visibility: "estimate; framing and host rendering unobserved" },
    compactions: { observedCount: compaction?.count ?? null, basis: "session counter at capture; historical event coverage unknown" },
    accountQuotaTokens: null,
    savings: { percent: null, reason: "requires a separate comparison with compatible scope and complete coverage" },
  };
}
