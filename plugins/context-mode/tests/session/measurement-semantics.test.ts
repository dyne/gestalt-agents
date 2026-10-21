import { describe, expect, test } from "vitest";
import {
  createMeasurementLedger,
  measureResponseBytes,
  recordUsageMeasurement,
  summarizeEfficiencyMeasurement,
} from "../../src/session/measurement-semantics.js";

const CUTOFF = 1_000;

describe("efficiency measurement semantics", () => {
  test("deduplicates repeated notifications without treating them as missing coverage", () => {
    const initial = createMeasurementLedger({ captureCutoffMs: CUTOFF });
    const first = recordUsageMeasurement(initial, {
      captureId: "notice-1", sourceId: "root", role: "root", scope: "turn_delta", observedAtMs: 10,
      counters: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 },
    });
    const duplicate = recordUsageMeasurement(first, {
      captureId: "notice-1", sourceId: "root", role: "root", scope: "turn_delta", observedAtMs: 10,
      counters: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 },
    });

    const summary = summarizeEfficiencyMeasurement(duplicate);
    expect(summary.direct).toMatchObject({ inputTokens: 10, outputTokens: 4 });
    expect(summary.coverage).toBe("complete");
    expect(summary.issues).toEqual([{ captureId: "notice-1", sourceId: "root", reason: "duplicate" }]);
  });

  test("derives deltas from monotonic cumulative sources and counts a reset once", () => {
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "one", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 1,
      counters: { inputTokens: 10, outputTokens: 8, reasoningTokens: 3 },
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "two", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 2,
      counters: { inputTokens: 14, outputTokens: 10, reasoningTokens: 4 },
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "after-reset", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 3,
      counters: { inputTokens: 2, outputTokens: 1, reasoningTokens: 0 },
    });

    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.direct).toMatchObject({ inputTokens: 16, outputTokens: 11, reasoningTokens: 4 });
    expect(summary.counterResets).toBe(3);
  });

  test("retains direct and child attribution across compaction without double counting", () => {
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF, expectedChildIds: ["child-a"] });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "parent-turn", sourceId: "root", role: "root", scope: "turn_delta", observedAtMs: 1,
      counters: { inputTokens: 0, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 },
    });
    // The JSON-safe ledger is the compaction/resume boundary.
    ledger = JSON.parse(JSON.stringify(ledger));
    ledger = recordUsageMeasurement(ledger, {
      captureId: "child-summary", sourceId: "child-a", role: "child", scope: "source_cumulative", observedAtMs: 2,
      counters: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 },
    });

    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.children).toEqual([{ sourceId: "child-a", counters: expect.objectContaining({ inputTokens: 7, outputTokens: 3 }) }]);
    expect(summary.total).toMatchObject({ inputTokens: 7, outputTokens: 8 });
    expect(summary.coverage).toBe("complete");
  });

  test("keeps omitted cumulative fields unavailable instead of resetting them to zero", () => {
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "a", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 1,
      counters: { inputTokens: 10, outputTokens: 5 },
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "b", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 2,
      counters: { inputTokens: 12 },
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "c", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 3,
      counters: { inputTokens: 14, outputTokens: 7 },
    });

    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.direct).toMatchObject({ inputTokens: 14, outputTokens: 7 });
    expect(summary.counterResets).toBe(0);
    expect(summary.unknownDirectCounters).toEqual(["cacheCreationTokens", "cacheReadTokens", "reasoningTokens"]);
  });

  test("requires complete counters from every expected child, not just one child", () => {
    const full = {
      inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 1,
    };
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF, expectedChildIds: ["a", "b"] });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "root", sourceId: "root", role: "root", scope: "turn_delta", observedAtMs: 1, counters: full,
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "a", sourceId: "a", role: "child", scope: "turn_delta", observedAtMs: 2, counters: full,
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "b", sourceId: "b", role: "child", scope: "turn_delta", observedAtMs: 3, counters: { outputTokens: 3 },
    });

    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.coverage).toBe("partial");
    expect(summary.unknownChildCounters).toEqual(["cacheCreationTokens", "cacheReadTokens", "inputTokens", "reasoningTokens"]);
    expect(summary.unresolvedContributions).toContainEqual(expect.objectContaining({
      sourceId: "b", counter: "inputTokens", reason: "missing_delta", scope: "turn_delta",
    }));
  });

  test("a partial turn delta leaves its missing counters unresolved", () => {
    const full = {
      inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 1,
    };
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "first", sourceId: "root", role: "root", scope: "turn_delta", observedAtMs: 1, counters: full,
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "partial", sourceId: "root", role: "root", scope: "turn_delta", observedAtMs: 2,
      counters: { inputTokens: 2, outputTokens: 2 },
    });

    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.coverage).toBe("partial");
    expect(summary.unknownDirectCounters).toEqual(["cacheCreationTokens", "cacheReadTokens", "reasoningTokens"]);
    expect(summary.unresolvedContributions).toContainEqual(expect.objectContaining({
      sourceId: "root", counter: "reasoningTokens", reason: "missing_delta", scope: "turn_delta",
    }));
  });

  test("a later cumulative observation repairs a same-epoch omission without double counting", () => {
    const full = {
      inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 1,
    };
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "a", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 1, counters: full,
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "b", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 2,
      counters: { inputTokens: 12 },
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "c", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 3,
      counters: { inputTokens: 14, outputTokens: 7, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 1 },
    });

    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.direct.outputTokens).toBe(7);
    expect(summary.coverage).toBe("complete");
    expect(summary.unresolvedContributions).toEqual([]);
  });

  test.each([
    {
      name: "repairs a same-epoch cumulative gap",
      rows: [
        { counters: { inputTokens: 10, outputTokens: 10, reasoningTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } },
        { counters: { inputTokens: 12 } },
        { counters: { inputTokens: 14, outputTokens: 14, reasoningTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } },
      ],
      outputTokens: 14,
      coverage: "complete" as const,
      gapReason: undefined,
    },
    {
      name: "keeps a pre-reset cumulative gap historical after later restoration",
      rows: [
        { counters: { inputTokens: 10, outputTokens: 10, reasoningTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } },
        { counters: { inputTokens: 12 } },
        { counters: { inputTokens: 2, outputTokens: 2, reasoningTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } },
        { counters: { inputTokens: 3 } },
        { counters: { inputTokens: 4, outputTokens: 4, reasoningTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } },
      ],
      outputTokens: 14,
      coverage: "partial" as const,
      gapReason: "historical_cumulative_gap",
    },
    {
      name: "never repairs a missing delta with a later delta",
      rows: [
        { counters: { inputTokens: 10, outputTokens: 10, reasoningTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } },
        { counters: { inputTokens: 2, outputTokens: 2 } },
        { counters: { inputTokens: 3, outputTokens: 3, reasoningTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } },
      ],
      outputTokens: 15,
      coverage: "partial" as const,
      gapReason: "missing_delta",
      gapCounter: "reasoningTokens" as const,
      scope: "turn_delta" as const,
    },
  ])("availability transition: $name", ({ rows, outputTokens, coverage, gapReason, gapCounter = "outputTokens", scope = "source_cumulative" }) => {
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF });
    for (const [index, row] of rows.entries()) {
      ledger = recordUsageMeasurement(ledger, {
        captureId: `transition-${index}`,
        sourceId: "root",
        role: "root",
        scope,
        observedAtMs: index,
        counters: row.counters,
      });
    }

    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.direct.outputTokens).toBe(outputTokens);
    expect(summary.coverage).toBe(coverage);
    if (gapReason) {
      expect(summary.unresolvedContributions).toContainEqual(expect.objectContaining({
        sourceId: "root", counter: gapCounter, reason: gapReason,
      }));
    } else {
      expect(summary.unresolvedContributions).toEqual([]);
    }
  });

  test("rejects mixed source scopes before they can double count", () => {
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "cumulative", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 1,
      counters: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "delta", sourceId: "root", role: "root", scope: "turn_delta", observedAtMs: 2,
      counters: { inputTokens: 3, outputTokens: 2, reasoningTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    });

    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.direct).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(summary.coverage).toBe("partial");
    expect(summary.issues).toContainEqual({ captureId: "delta", sourceId: "root", reason: "mixed_usage_scope" });
  });

  test("does not label unknown-role usage as root usage", () => {
    const ledger = recordUsageMeasurement(createMeasurementLedger({ captureCutoffMs: CUTOFF }), {
      captureId: "unknown-role", sourceId: "unverified-source", role: "unknown", scope: "turn_delta", observedAtMs: 1,
      counters: { inputTokens: 4, outputTokens: 2 },
    });
    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.direct).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    expect(summary.total).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    expect(summary.unattributed).toMatchObject({ inputTokens: 4, outputTokens: 2 });
    expect(summary.coverage).toBe("partial");
    expect(summary.issues).toEqual([{ captureId: "unknown-role", sourceId: "unverified-source", reason: "unknown_attribution" }]);
  });

  test("scopes duplicate capture ids by source and excludes out-of-order cumulative samples", () => {
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "same", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 10,
      counters: { outputTokens: 5 },
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "same", sourceId: "child", role: "child", scope: "source_cumulative", observedAtMs: 10,
      counters: { outputTokens: 3 },
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "older", sourceId: "root", role: "root", scope: "source_cumulative", observedAtMs: 9,
      counters: { outputTokens: 4 },
    });

    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.total.outputTokens).toBe(8);
    expect(summary.issues).toContainEqual({ captureId: "older", sourceId: "root", reason: "out_of_order_cumulative" });
  });

  test("excludes undated samples at the capture cutoff and reports missing child coverage", () => {
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF, expectedChildIds: ["child-a", "child-b"] });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "missing-time", sourceId: "root", role: "root", scope: "turn_delta", observedAtMs: null,
      counters: { outputTokens: 9 },
    });
    ledger = recordUsageMeasurement(ledger, {
      captureId: "after-cutoff", sourceId: "child-a", role: "child", scope: "turn_delta", observedAtMs: CUTOFF + 1,
      counters: { outputTokens: 9 },
    });

    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.total.outputTokens).toBe(0);
    expect(summary.coverage).toBe("partial");
    expect(summary.missingChildIds).toEqual(["child-a", "child-b"]);
    expect(summary.issues).toEqual([{ captureId: "missing-time", sourceId: "root", reason: "missing_timestamp" }]);
  });

  test("keeps reasoning as an output subset and leaves account quota unknown", () => {
    const ledger = recordUsageMeasurement(createMeasurementLedger({ captureCutoffMs: CUTOFF }), {
      captureId: "bad-reasoning", sourceId: "root", role: "root", scope: "turn_delta", observedAtMs: 1,
      counters: { outputTokens: 3, reasoningTokens: 4 },
    });
    const summary = summarizeEfficiencyMeasurement(ledger);
    expect(summary.total.outputTokens).toBe(0);
    expect(summary.accountQuotaTokens).toBeNull();
    expect(summary.coverage).toBe("partial");
    expect(summary.issues[0]).toMatchObject({ reason: "reasoning_exceeds_output" });
  });

  test("uses UTF-8 bytes and reports wrapper framing separately", () => {
    const content = "café 😀";
    const envelope = JSON.stringify({ content });
    const measured = measureResponseBytes(content, envelope);
    expect(measured.visibleResponseBytes).toBe(Buffer.byteLength(content, "utf8"));
    expect(measured.transportBytes).toBe(Buffer.byteLength(envelope, "utf8"));
    expect(measured.wrapperEnvelopeBytes).toBeGreaterThan(0);
    expect(measureResponseBytes(content).transportVisibility).toBe("unknown");
  });
});

// Independent expected arithmetic, including every prefix across two resets.
const fullCounters = (value: number) => ({
  inputTokens: value, outputTokens: value, cacheReadTokens: 0,
  cacheCreationTokens: 0, reasoningTokens: 0,
});

describe("independent accounting regressions", () => {
  test.each([
    {
      name: "restoration uses latest cumulative value",
      readings: [fullCounters(10), { inputTokens: 12 }, fullCounters(14)],
      expected: [[10, 10], [12, 10], [14, 14]],
      coverage: "complete", historicalEpochs: [],
    },
    {
      name: "two historical gaps survive resets and JSON compaction",
      readings: [fullCounters(10), { inputTokens: 12 }, fullCounters(2),
        { inputTokens: 3 }, fullCounters(4), { inputTokens: 5 },
        fullCounters(1), { inputTokens: 2 }, fullCounters(3)],
      expected: [[10, 10], [12, 10], [14, 12], [15, 12], [16, 14],
        [17, 14], [18, 15], [19, 15], [20, 17]],
      coverage: "partial", historicalEpochs: [0, 1],
    },
  ])("$name", ({ readings, expected, coverage, historicalEpochs }) => {
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF });
    readings.forEach((counters, index) => {
      ledger = JSON.parse(JSON.stringify(recordUsageMeasurement(ledger, {
        captureId: `sample-${index}`, sourceId: "root", role: "root",
        scope: "source_cumulative", observedAtMs: index, counters,
      })));
      const result = summarizeEfficiencyMeasurement(ledger);
      expect([result.total.inputTokens, result.total.outputTokens]).toEqual(expected[index]);
      if (historicalEpochs.length && index === 7) {
        expect(result.unresolvedContributions.filter(({ counter }) => counter === "outputTokens"))
          .toEqual([
            expect.objectContaining({ reason: "historical_cumulative_gap", epoch: 0 }),
            expect.objectContaining({ reason: "historical_cumulative_gap", epoch: 1 }),
            expect.objectContaining({ reason: "pending_cumulative", epoch: 2 }),
          ]);
      }
    });
    const result = summarizeEfficiencyMeasurement(ledger);
    expect(result.coverage).toBe(coverage);
    expect(result.unresolvedContributions.filter(({ counter, reason }) =>
      counter === "outputTokens" && reason === "historical_cumulative_gap",
    ).map(({ epoch }) => epoch)).toEqual(historicalEpochs);
  });

  test("empty capture has no measured root counters", () => {
    const result = summarizeEfficiencyMeasurement(createMeasurementLedger({ captureCutoffMs: CUTOFF }));
    expect(result.coverage).toBe("partial");
    expect(result.unknownDirectCounters).toEqual([
      "cacheCreationTokens", "cacheReadTokens", "inputTokens", "outputTokens", "reasoningTokens",
    ]);
    expect(result.accountQuotaTokens).toBeNull();
  });

  test("rejects changed roles without moving a source between totals", () => {
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF });
    for (const [index, role] of (["unknown", "root", "child"] as const).entries()) {
      ledger = recordUsageMeasurement(ledger, {
        captureId: `role-${index}`, sourceId: "same-source", role,
        scope: "turn_delta", observedAtMs: index, counters: fullCounters(5),
      });
    }
    const result = summarizeEfficiencyMeasurement(ledger);
    expect(result.total.inputTokens).toBe(0);
    expect(result.unattributed.inputTokens).toBe(5);
    expect(result.issues.filter(({ reason }) => reason === "role_changed")).toHaveLength(2);
    expect(result.coverage).toBe("partial");
  });

  test("source identities include prototype property names", () => {
    let ledger = createMeasurementLedger({ captureCutoffMs: CUTOFF, expectedChildIds: ["__proto__"] });
    for (const [sourceId, role] of [["constructor", "root"], ["__proto__", "child"]] as const) {
      ledger = recordUsageMeasurement(ledger, {
        captureId: "shared", sourceId, role, scope: "source_cumulative",
        observedAtMs: 1, counters: fullCounters(3),
      });
    }
    const result = summarizeEfficiencyMeasurement(ledger);
    expect(result.total.inputTokens).toBe(6);
    expect(result.coverage).toBe("complete");
    expect(result.missingChildIds).toEqual([]);
  });

  test("reasoning with unknown denominator remains partial without adding to output", () => {
    const ledger = recordUsageMeasurement(createMeasurementLedger({ captureCutoffMs: CUTOFF }), {
      captureId: "reasoning-only", sourceId: "root", role: "root", scope: "turn_delta",
      observedAtMs: 1, counters: { reasoningTokens: 3 },
    });
    const result = summarizeEfficiencyMeasurement(ledger);
    expect(result.total.outputTokens).toBe(0);
    expect(result.total.reasoningTokens).toBe(3);
    expect(result.unknownDirectCounters).toContain("outputTokens");
    expect(result.coverage).toBe("partial");
  });
});
