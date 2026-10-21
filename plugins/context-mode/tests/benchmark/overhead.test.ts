import { beforeAll, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assessOverhead, assessWakeTrace, collectOverhead, loadOverheadBudgets, retainBudgetDiagnostics, validateBudgetAmendment } from "../../benchmark/overhead.js";

let measured: ReturnType<typeof collectOverhead>;
beforeAll(() => { measured = collectOverhead(); }, 30_000);

describe("stable overhead CI budgets", () => {
  test("declared L2 envelopes, generated bootstrap, overlap and complete overflow fit fixed ceilings", () => {
    expect(assessOverhead(measured)).toEqual([]);
    expect(measured).toMatchObject({ duplicateWindows: 0, missingQueryAttributions: 0,
      overflowRecoveryFailures: 0, explicitExpansionFailures: 0 });
    expect(measured.scope).toContain("invented trace fixture");
  });
  test.each([
    ["RESPONSE_BYTES", "maxRoutineResponseBytes", 2049],
    ["EXPANSION_CEILING", "maximumExpandedResponseBytes", 65537],
    ["RETRIEVAL_BYTES", "retrievalReturnedBytes", 5466],
    ["RETRIEVAL_VISIBLE_BYTES", "retrievalVisibleBytes", 6206],
    ["DUPLICATE_WINDOW", "duplicateWindows", 1],
    ["LOST_QUERY_ATTRIBUTION", "missingQueryAttributions", 1],
    ["UNCHANGED_STATUS_WAKE", "unchangedStatusAcceptedTurns", 1],
    ["DUPLICATE_WAKE", "duplicateAcceptedWakes", 1],
    ["LOST_OVERFLOW", "overflowRecoveryFailures", 1],
    ["EXPANSION_UNAVAILABLE", "explicitExpansionFailures", 1],
  ])("rejects planted %s regression", (id, metric, value) => {
    expect(assessOverhead({ ...measured, [metric]: value }).map(row => row.id)).toContain(id);
  });
  test("detects one-byte or one-word bootstrap growth and unknown response measurements", () => {
    for (const unit of ["bytes", "words"]) {
      const value = structuredClone(measured); value.profiles["profile-executor"][unit]++;
      expect(assessOverhead(value)).toContainEqual(expect.objectContaining({ id: "BOOTSTRAP_GROWTH", metric: `profiles.profile-executor.${unit}` }));
    }
    expect(assessOverhead({ ...measured, maxRoutineResponseBytes: null }).map(row => row.id)).toContain("RESPONSE_BYTES");
    const budget = loadOverheadBudgets(); delete budget.roles.root.bytes;
    expect(assessOverhead(measured, budget).map(row => row.id)).toContain("BUDGET_SCHEMA_INVALID");
  });
  test("requires digest-bound evidence and review reference for intentional ceiling increases", () => {
    const before = loadOverheadBudgets(), after = structuredClone(before); after.routineResponseBytes++;
    expect(validateBudgetAmendment(before, after)[0].id).toBe("BUDGET_INCREASE_REQUIRES_REVIEW");
    after.amendment = { reason: "Synthetic test of amendment format, not approval", evidenceReference: "fixture evidence",
      reviewReference: "fixture review", previousBudgetsSha256: createHash("sha256").update(JSON.stringify(before)).digest("hex"), metrics: ["routineResponseBytes"] };
    expect(validateBudgetAmendment(before, after)).toEqual([]);
    after.amendment.previousBudgetsSha256 = "a".repeat(64);
    expect(validateBudgetAmendment(before, after)).toHaveLength(1);
    expect(validateBudgetAmendment(before, before)).toEqual([]);
  });
  test("unchanged status yields zero turns; duplicate accepted wakes fail the trace contract", () => {
    const events: Parameters<typeof assessWakeTrace>[0] = Array.from({ length: 100 }, () => ({ kind: "unchangedStatus", wakeId: "same", acceptedTurnId: null }));
    events.push({ kind: "actionableWake", wakeId: "completion", acceptedTurnId: "turn-1" });
    events.push({ ...events.at(-1)! }); // Duplicate receipt is not an extra model turn.
    expect(assessWakeTrace(events)).toEqual({ unchangedStatusAcceptedTurns: 0, duplicateAcceptedWakes: 0 });
    events.push({ kind: "actionableWake", wakeId: "completion", acceptedTurnId: "turn-2" });
    events.push({ kind: "unchangedStatus", wakeId: "status", acceptedTurnId: "turn-3" });
    expect(assessWakeTrace(events)).toEqual({ unchangedStatusAcceptedTurns: 1, duplicateAcceptedWakes: 1 });
  });
  test("bounded diagnostic retains every failure, including a late identifier", () => {
    const root = mkdtempSync(join(tmpdir(), "overhead-diagnostics-"));
    try {
      const failures = Array.from({ length: 100 }, (_, index) => ({ id: `FAIL-${index}`, metric: "\0😀".repeat(1000),
        detail: "\0\n漢".repeat(1000), observed: 2, maximum: 1 }));
      const summary = retainBudgetDiagnostics(failures, root);
      expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThanOrEqual(2048);
      expect(summary).toMatchObject({ failureCount: 100, firstFailure: { id: "FAIL-0" }, evidenceCompleteness: "complete" });
      const body = readFileSync(join(root, summary.overflow.file!));
      expect(createHash("sha256").update(body).digest("hex")).toBe(summary.overflow.sha256);
      expect(body.length).toBe(summary.overflow.bytes);
      expect(JSON.parse(body.toString()).failures).toEqual(failures);
      expect(body.toString()).toContain("FAIL-99");
      // A changed artifact must not be advertised as complete evidence.
      writeFileSync(join(root, summary.overflow.file!), "changed");
      expect(retainBudgetDiagnostics(failures, root)).toMatchObject({ evidenceCompleteness: "partial", overflow: { available: false } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("storage failure reports incomplete evidence without losing failure count", () => {
    const root = mkdtempSync(join(tmpdir(), "overhead-denied-"));
    try {
      const file = join(root, "not-a-directory"); writeFileSync(file, "file");
      const summary = retainBudgetDiagnostics([{ id: "FAIL-STORE", metric: "store", observed: null, maximum: 0 }], file);
      expect(summary).toMatchObject({ failureCount: 1, firstFailure: { id: "FAIL-STORE" }, evidenceCompleteness: "partial" });
      expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThanOrEqual(2048);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("CI entrypoint produces a bounded passing report on the real candidate", () => {
    const root = mkdtempSync(join(tmpdir(), "overhead-cli-"));
    try {
      const run = spawnSync(process.execPath, [new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url).pathname,
        new URL("../../benchmark/overhead.ts", import.meta.url).pathname, "--evidence-dir", root], { encoding: "utf8", timeout: 30_000 });
      expect(run.status, run.stderr).toBe(0);
      expect(Buffer.byteLength(run.stdout)).toBeLessThanOrEqual(2048);
      expect(JSON.parse(run.stdout)).toMatchObject({ status: "passed" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("an unavailable comparison base fails with a recoverable bounded diagnostic", () => {
    const root = mkdtempSync(join(tmpdir(), "overhead-base-"));
    try {
      const run = spawnSync(process.execPath, [new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url).pathname,
        new URL("../../benchmark/overhead.ts", import.meta.url).pathname,
        "--base", "missing-overhead-base-000000", "--evidence-dir", root], { encoding: "utf8", timeout: 30_000 });
      expect(run.status).toBe(1); expect(Buffer.byteLength(run.stdout)).toBeLessThanOrEqual(2048);
      const summary = JSON.parse(run.stdout);
      expect(summary).toMatchObject({ failureCount: 1, firstFailure: { id: "BASE_REVISION_UNAVAILABLE" }, evidenceCompleteness: "complete" });
      expect(JSON.parse(readFileSync(join(root, summary.overflow.file), "utf8")).failures[0].id).toBe("BASE_REVISION_UNAVAILABLE");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
