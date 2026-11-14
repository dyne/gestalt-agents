import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runFakeModelTrials, summarizeModelTrials, verifyEmbeddedEvidence, distribution, validateAdoptionReport } from "../../benchmark/model-trials.js";

const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

// Invented structural records exercise validation, never real-model execution.
function adoptionReport(kind = "not-run"): any {
  const evidence = (source: string) => ({ kind: kind === "fixture" ? "fixture" : source,
    reference: "test-only-structural-reference", sha256: "a".repeat(64), observedAt: "2026-11-06T00:00:00Z" });
  return { schemaVersion: 1, evidenceKind: kind, sourceRevision: "b".repeat(40), installedSourceEquivalence: "unverified",
    roles: ["root", "executor", "solo"].map(role => ({ role, status: kind === "not-run" ? "not-run" : "observed",
      missingInputs: kind === "not-run" ? ["No authorized live provider adapter"] : [],
      runtimeEvidence: kind === "not-run" ? null : evidence("runtime-observation"),
      outcome: kind === "not-run" ? null : { passed: true, evidence: evidence("outcome-check") },
      operations: kind === "not-run" ? [] : ["native/search", "serena/symbol", "serena/references", "native/fallback"].map(id => {
        const [tool, operation] = id.split("/");
        return { tool, operation, sourceRevision: "b".repeat(40), locator: "src/example.py:1",
          fallbackReason: operation === "fallback" ? "Exact-file lookup" : null, evidence: evidence("tool-observation") };
      }), usage: Object.fromEntries(["inputTokens", "outputTokens", "providerLatencyMs"].map(metric => [metric, { value: null, evidence: null }])) })) };
}

describe("bounded adoption report admission", () => {
  test("requires useful native search and rejects the retired provider operation", () => {
    const report = adoptionReport("fixture");
    expect(report.roles[0].operations[0]).toMatchObject({ tool: "native", operation: "search", fallbackReason: null });
    expect(validateAdoptionReport(report).valid).toBe(true);
    report.roles[0].operations[0].tool = "xerj";
    report.roles[0].operations[0].operation = "query";
    expect(() => validateAdoptionReport(report)).toThrow("ADOPTION_OPERATION_INVALID");
  });
  test("validates all roles through the read-only CLI and exports only a structural verdict", () => {
    for (const kind of ["not-run", "fixture", "real-model"]) {
      const result = validateAdoptionReport(adoptionReport(kind));
      expect(result).toMatchObject({ valid: true, evidenceKind: kind, liveAdoption: "unverified", installedSourceEquivalence: "unverified" });
      expect(result.roles).toHaveLength(3);
    }
    const root = mkdtempSync(join(tmpdir(), "adoption-report-cli-"));
    try {
      const input = join(root, "input.json"), output = join(root, "verdict.json");
      const report = adoptionReport();
      writeFileSync(input, JSON.stringify(report));
      const before = readFileSync(input);
      const invoke = () => spawnSync(process.execPath, ["--import", tsxLoader,
        fileURLToPath(new URL("../../benchmark/model-trials.ts", import.meta.url)), "--validate-adoption-report", input, output], { encoding: "utf8" });
      const run = invoke();
      expect(run.status).toBe(0); expect(run.stdout).toBe("");
      expect(readFileSync(input)).toEqual(before);
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(validateAdoptionReport(report));
      rmSync(output);
      report.roles[0].runtimeEvidence = { prompt: "PRIVATE_SENTINEL" };
      writeFileSync(input, JSON.stringify(report));
      const rejected = invoke();
      expect(rejected.status).not.toBe(0); expect(existsSync(output)).toBe(false);
      expect(rejected.stdout + rejected.stderr).not.toContain("PRIVATE_SENTINEL");
      writeFileSync(input, "PRIVATE_SENTINEL malformed non-JSON input");
      const malformed = invoke();
      expect(malformed.status).not.toBe(0); expect(existsSync(output)).toBe(false);
      expect(malformed.stdout + malformed.stderr).not.toContain("PRIVATE_");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("rejects fixture-only records relabelled real-model", () => {
    const report = adoptionReport("fixture"); report.evidenceKind = "real-model";
    expect(() => validateAdoptionReport(report)).toThrow("ADOPTION_EVIDENCE_KIND_INVALID");
    for (const reference of ["embedded:artifacts/result", "fake-provider:run", "fixture:run", " \tEmBeDdEd:artifacts/result ", "\n fake-provider:run", " fixture:run\t"]) {
      const relabelled = adoptionReport("real-model"); relabelled.roles[0].runtimeEvidence.reference = reference;
      expect(() => validateAdoptionReport(relabelled)).toThrow("ADOPTION_FIXTURE_AS_REAL");
    }
    expect(() => validateAdoptionReport(runFakeModelTrials())).toThrow("ADOPTION_FIELDS_INVALID");
  });
  test("requires outcomes, every role, required operations and fallback provenance", () => {
    const edits = [(r: any) => { r.roles[0].outcome = null; }, (r: any) => { r.roles.pop(); },
      (r: any) => { r.roles[0].operations.pop(); }, (r: any) => { r.roles[0].operations[3].fallbackReason = null; },
      (r: any) => { delete r.roles[0].operations[0].evidence; }];
    for (const edit of edits) {
      const report = adoptionReport("real-model"); edit(report);
      expect(() => validateAdoptionReport(report)).toThrow(/ADOPTION_/);
    }
    const notRun = adoptionReport(); notRun.roles[0].missingInputs = [];
    expect(() => validateAdoptionReport(notRun)).toThrow("ADOPTION_NOT_RUN_CONTRADICTION");
    for (const observedAt of [null, "2026-11-06", "2026-11-06T00:00:00", "1234", "2026-11-06T00:00:00+00:00", "2026-02-31T00:00:00Z"]) {
      const report = adoptionReport("real-model"); report.roles[0].runtimeEvidence.observedAt = observedAt;
      expect(() => validateAdoptionReport(report)).toThrow("ADOPTION_EVIDENCE_INVALID");
    }
  });
  test("keeps unknown usage null and requires observed evidence even for zero", () => {
    const report = adoptionReport("real-model");
    expect(validateAdoptionReport(report).valid).toBe(true);
    report.roles[0].usage.inputTokens.value = 0;
    expect(() => validateAdoptionReport(report)).toThrow("ADOPTION_OBSERVED_USAGE_EVIDENCE_REQUIRED");
    report.roles[0].usage.inputTokens.evidence = { ...report.roles[0].runtimeEvidence, kind: "provider-observation" };
    expect(validateAdoptionReport(report).valid).toBe(true);
    report.roles[0].usage.providerLatencyMs = { value: 0.125, evidence: report.roles[0].usage.inputTokens.evidence };
    expect(validateAdoptionReport(report).valid).toBe(true);
    report.roles[0].usage.inputTokens.value = 0.5;
    expect(() => validateAdoptionReport(report)).toThrow("ADOPTION_OBSERVED_USAGE_EVIDENCE_REQUIRED");
    report.roles[0].usage.inputTokens.value = null;
    expect(() => validateAdoptionReport(report)).toThrow("ADOPTION_UNKNOWN_USAGE_INVALID");
  });
  test("rejects raw payload fields at nested export boundaries", () => {
    for (const field of ["prompt", "modelOutput", "environment", "transcript"]) {
      for (const select of [(r: any) => r, (r: any) => r.roles[0], (r: any) => r.roles[0].outcome,
        (r: any) => r.roles[0].operations[0].evidence, (r: any) => r.roles[0].usage.inputTokens]) {
        const report = adoptionReport("fixture"); select(report)[field] = "PRIVATE_SENTINEL";
        expect(() => validateAdoptionReport(report)).toThrow("ADOPTION_FIELDS_INVALID");
      }
    }
  });
  test("rejects source-to-installed equivalence and preserves source evidence limits", () => {
    const report = adoptionReport("real-model"); report.installedSourceEquivalence = "verified";
    expect(() => validateAdoptionReport(report)).toThrow("ADOPTION_INSTALLATION_CLAIM_UNSUPPORTED");
    report.installedSourceEquivalence = "unverified";
    expect(validateAdoptionReport(report).limits).toContain("No execution or installation attestation");
  });
});

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
  test.each(["gpt-6-astra", "gpt-6.1-terra", "provider/future-model"])("accepts valid model identifier %s for read-only trial analysis", model => {
    const manifest = runFakeModelTrials(); manifest.configurations[0].model = model;
    const summary = summarizeModelTrials(manifest);
    expect(summary.validation.code).toBe("COMPARISON_VALID");
    expect(summary.validation.executionAuthorized).toBe(false);
    expect(summary.liveExecutionSupported).toBe(false);
  });
  test.each(["none", "model with spaces", "x".repeat(65)])("rejects malformed model %s before trial analysis", model => {
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
    expect(() => summarizeModelTrials(manifest)).toThrow("COMPARISON_FIXTURE_AS_LIVE");
    for (const reference of [" \tembedded:artifacts/result ", "\n FaKe-PrOvIdEr:run", " fixture:run\t"]) {
      const relabelled = structuredClone(manifest); delete relabelled.artifacts;
      for (const trial of relabelled.trials) for (const field of ["resultEvidence", "accountingEvidence", "effectiveSettingsEvidence", "acceptanceEvidence"]) {
        if (trial[field]) trial[field].reference = reference;
      }
      expect(() => summarizeModelTrials(relabelled)).toThrow("COMPARISON_FIXTURE_AS_LIVE");
    }
    // Invented external references test format compatibility, not execution provenance.
    delete manifest.artifacts;
    for (const trial of manifest.trials) for (const field of ["resultEvidence", "accountingEvidence", "effectiveSettingsEvidence", "acceptanceEvidence"]) {
      if (trial[field]) trial[field].reference = `test-only-external-reference/${field}`;
    }
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
      const run = spawnSync(process.execPath, ["--import", tsxLoader,
        fileURLToPath(new URL("../../benchmark/model-trials.ts", import.meta.url)), "--live", output], { encoding: "utf8" });
      expect(run.status).not.toBe(0); expect(run.stderr).toContain("live dispatch is unsupported");
      expect(existsSync(output)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("CLI fake output round-trips through read-only import without altering input", () => {
    const root = mkdtempSync(join(tmpdir(), "model-trials-roundtrip-"));
    try {
      const input = join(root, "fake.json"), output = join(root, "summary.json");
      const invoke = (...args: string[]) => spawnSync(process.execPath, [
        "--import", tsxLoader,
        fileURLToPath(new URL("../../benchmark/model-trials.ts", import.meta.url)), ...args], { encoding: "utf8" });
      expect(invoke("--fake", input).status).toBe(0);
      const before = readFileSync(input);
      expect(invoke("--summarize", input, output).status).toBe(0);
      expect(readFileSync(input)).toEqual(before);
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(JSON.parse(before.toString()));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
