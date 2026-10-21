import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runFakeModelTrials, summarizeModelTrials, verifyEmbeddedEvidence, distribution } from "../../benchmark/model-trials.js";

describe("opt-in controlled model comparison", () => {
  test("repeats identical fake inputs three times per configuration and difficulty", () => {
    const manifest = runFakeModelTrials();
    expect(manifest).toEqual(runFakeModelTrials());
    expect(manifest.mode).toBe("synthetic"); expect(manifest.authorizationReference).toBeNull();
    const summary = summarizeModelTrials(manifest);
    expect(summary.validation.trials).toMatchObject({ expected: 27, recorded: 27, accepted: 25, failed: 1, missing: 0 });
    expect(summary.representedDifficulties).toEqual(["simple", "bounded", "multi-component"]);
    expect(summary.groups).toHaveLength(9);
    for (const group of summary.groups) {
      expect(group.recordedTrials).toBe(3);
      expect(new Set(manifest.trials.filter((trial: any) => trial.taskId === group.taskId).map((trial: any) => trial.inputDigest)).size).toBe(1);
    }
    verifyEmbeddedEvidence(manifest);
    expect(summary.liveQuality).toBe("unverified"); expect(summary.liveSavings).toBe("unverified");
    expect(summary.liveExecutionSupported).toBe(false);
  });
  test("includes root, retries and independent reviewer costs, even for rejected trials", () => {
    const summary = summarizeModelTrials(runFakeModelTrials());
    const group = summary.groups.find((row: any) => row.taskId === "bounded" && row.configurationId === "gpt-6-luna-medium");
    expect(group).toMatchObject({ accepted: 2, failed: 1, outcomeIncomplete: 0,
      elapsedMs: { median: 2000, min: 1000, max: 3000 }, retries: { median: 0, min: 0, max: 1 } });
    // 3 actors + 5 retry actors + 3 actors = 11, including all reviewers.
    expect(group.allAgentCosts.costUsd.total).toBeCloseTo(0.11);
    expect(group.allAgentCosts.costUsd.perAcceptedTask).toBeCloseTo(0.055);
    expect(group.allAgentCosts.inputTokens.total).toBe(303 + 510 + 303);
    expect(group.trials[1].failureIds).toEqual(["FAKE-ACCEPTANCE-REJECTED"]);
    expect(group.trials[1].attempts[0].failureIds).toEqual(["FAKE-RETRY-RECOVERED"]);
    expect(group.trials[1].expectedAgentIds).toContain("reviewer-attempt-2");
  });
  test("discloses interrupted and missing trials and never fills their costs with zero", () => {
    const manifest = runFakeModelTrials();
    const group = summarizeModelTrials(manifest).groups.find((row: any) => row.taskId === "multi-component" && row.configurationId === "gpt-6-sol-medium");
    expect(group.outcomeIncomplete).toBe(1);
    expect(group.elapsedMs).toMatchObject({ expected: 3, observed: 2, missing: 1, complete: false, median: 1500 });
    expect(group.allAgentCosts.costUsd).toMatchObject({ observed: 2, missing: 1, total: null, perAcceptedTask: null });
    expect(group.trials[2].failureIds).toEqual(["FAKE-PROVIDER-INTERRUPTED"]);
    expect(group.trials[2].observedAgentIds).toEqual(["root"]);
    manifest.trials.pop();
    expect(summarizeModelTrials(manifest).validation.trials.missing).toBe(1);
  });
  test("preserves quota as unknown and keeps occupancy separate from cumulative costs", () => {
    const manifest = runFakeModelTrials(), summary = summarizeModelTrials(manifest);
    expect(summary.validation.completeness).toBe("partial");
    for (const group of summary.groups) {
      expect(group.allAgentCosts).not.toHaveProperty("accountQuotaTokens");
      expect(group.allAgentCosts).not.toHaveProperty("contextOccupancyTokens");
    }
    for (const trial of manifest.trials) for (const agent of trial.agents) expect(agent.counters.accountQuotaTokens).toBeNull();
    manifest.trials[0].agents[0].counters.accountQuotaTokens = 1;
    expect(() => summarizeModelTrials(manifest)).toThrow("COMPARISON_DIRECT_QUOTA_EVIDENCE_REQUIRED");
  });
  test.each(["gpt-6-astra", "gpt-6", "kimi"])("rejects prohibited model %s before trial analysis", model => {
    const manifest = runFakeModelTrials(); manifest.configurations[0].model = model;
    expect(() => summarizeModelTrials(manifest)).toThrow("COMPARISON_POLICY_INVALID");
  });
  test("rejects input drift, insufficient repetition policy and corrupt embedded evidence", () => {
    const manifest = runFakeModelTrials(); manifest.tasks[0].acceptanceChecks = ["different gate"];
    expect(() => summarizeModelTrials(manifest)).toThrow("COMPARISON_TRIAL_INVALID");
    const short = runFakeModelTrials(); short.trialsPerConfiguration = 2;
    expect(() => summarizeModelTrials(short)).toThrow("COMPARISON_SCHEMA_INVALID");
    const corrupt = runFakeModelTrials(); corrupt.artifacts[Object.keys(corrupt.artifacts)[0]] = { lostFailure: true };
    expect(() => verifyEmbeddedEvidence(corrupt)).toThrow("digest mismatch");
  });
  test("read-only live import requires authorization evidence and never grants dispatch", () => {
    const manifest = runFakeModelTrials(); manifest.mode = "live";
    expect(() => summarizeModelTrials(manifest)).toThrow("COMPARISON_AUTHORIZATION_REFERENCE_REQUIRED");
    manifest.authorizationReference = { reference: "test-only-invented-authorization", sha256: "a".repeat(64), observedAt: "2026-10-21T00:00:00Z" };
    const summary = summarizeModelTrials(manifest);
    expect(summary.validation.executionAuthorized).toBe(false);
    expect(summary.liveExecutionSupported).toBe(false); expect(summary.liveQuality).toBe("unverified");
    // Import must not infer cost coverage from IDs when disjoint scope is absent.
    delete manifest.trials[0].agents[0].accountingScope;
    expect(summarizeModelTrials(manifest).groups[0].allAgentCosts.costUsd.total).toBeNull();
  });
  test("computes known-sample median/range with explicit missing coverage", () => {
    expect(distribution([4, null, 2, 10], 5)).toEqual({ expected: 5, observed: 3, missing: 2, complete: false, median: 4, min: 2, max: 10 });
    expect(distribution([4, 2])).toMatchObject({ median: 3, complete: true });
    expect(distribution([], 3)).toMatchObject({ median: null, min: null, max: null, missing: 3, complete: false });
  });
  test("resolves each fake evidence reference to exactly its embedded bytes", () => {
    const manifest = runFakeModelTrials();
    for (const trial of manifest.trials) {
      const accounting = trial.accountingEvidence;
      const key = accounting.reference.replace("embedded:artifacts/", "");
      expect(createHash("sha256").update(JSON.stringify(manifest.artifacts[key])).digest("hex")).toBe(accounting.sha256);
      expect(manifest.artifacts[key].agents).toEqual(trial.agents);
    }
  });
  test("rejects unsupported live dispatch before creating an output", () => {
    const root = mkdtempSync(join(tmpdir(), "model-trials-cli-"));
    try {
      const output = join(root, "must-not-exist.json");
      const run = spawnSync(process.execPath, [new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url).pathname,
        new URL("../../benchmark/model-trials.ts", import.meta.url).pathname, "--live", output], { encoding: "utf8" });
      expect(run.status).not.toBe(0); expect(run.stderr).toContain("live dispatch is unsupported");
      expect(existsSync(output)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("CLI fake output round-trips through read-only import without altering input", () => {
    const root = mkdtempSync(join(tmpdir(), "model-trials-roundtrip-"));
    try {
      const input = join(root, "fake.json"), output = join(root, "summary.json");
      const invoke = (...args: string[]) => spawnSync(process.execPath, [
        new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url).pathname,
        new URL("../../benchmark/model-trials.ts", import.meta.url).pathname, ...args], { encoding: "utf8" });
      expect(invoke("--fake", input).status).toBe(0);
      const before = readFileSync(input);
      expect(invoke("--summarize", input, output).status).toBe(0);
      expect(readFileSync(input)).toEqual(before);
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(JSON.parse(before.toString()));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
