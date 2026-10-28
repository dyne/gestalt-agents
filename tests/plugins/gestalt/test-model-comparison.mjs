import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPARISON_COUNTERS, comparisonInputDigest, validateModelComparison } from "../../../plugins/gestalt/skills/org-plan/scripts/org-plan-model-comparison.mjs";

const template = JSON.parse(readFileSync(new URL("../../../plugins/gestalt/skills/org-plan/assets/model-comparison.template.json", import.meta.url), "utf8"));
const evidence = { reference: "fixture/evidence.json", sha256: "a".repeat(64), observedAt: "2026-10-21T10:00:00Z" };
const agent = (id, role) => ({ id, role, coverage: "complete", unknownReason: null,
  counters: { ...Object.fromEntries(COMPARISON_COUNTERS.map((key) => [key, 0])), inputTokens: 100, outputTokens: 10, reasoningTokens: 5, costUsd: 0.01 },
  quotaEvidence: { ...evidence, source: "direct-provider-observation" } });
function populated() {
  const data = structuredClone(template); data.mode = "synthetic";
  data.provenance = "Invented complete contract fixture, never live model or quota evidence";
  data.tasks = [{ ...data.tasks[0], baseSha: "1".repeat(40), toolsDigest: "2".repeat(64), environmentDigest: "3".repeat(64), dependencyDigest: "4".repeat(64), acceptanceChecks: ["fixture acceptance command; cwd fixture; same criteria"] }];
  for (const config of data.configurations) for (let repetition = 1; repetition <= 3; repetition += 1) data.trials.push({
    taskId: "simple", configurationId: config.id, repetition, inputDigest: comparisonInputDigest(data.tasks[0]),
    status: "completed", accepted: true, retries: 0, elapsedMs: 1000,
    failureCount: 0, failureIds: [], expectedAgentIds: ["root", "child"], agents: [agent("root", "root"), agent("child", "child")],
    resultEvidence: evidence, accountingEvidence: evidence, effectiveSettingsEvidence: evidence,
    acceptanceEvidence: { ...evidence, decision: "ACCEPT" },
  });
  return data;
}
let passed = 0;
const check = (name, action) => { try { action(); passed += 1; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } };
const assess = (data) => {
  const result = validateModelComparison(data);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 2048);
  assert.equal(result.liveQuality, "unverified"); assert.equal(result.liveSavings, "unverified");
  return result;
};
const reject = (data, code) => assert.deepEqual(assess(data), { valid: false, code, liveQuality: "unverified", liveSavings: "unverified" });
check("opt-in template makes no observation or execution claim", () => {
  const report = assess(template);
  assert.equal(report.valid, true); assert.equal(report.executionAuthorized, false);
  assert.deepEqual(report.trials, { expected: 27, recorded: 0, accepted: 0, failed: 0, incomplete: 0, missing: 27 });
  assert.equal(report.completeness, "partial");
  assert.ok(template.configurations.every((config) => config.reasoningEffort === "medium"));
});
check("same-task complete synthetic records remain unverified live claims", () => {
  const report = assess(populated());
  assert.equal(report.valid, true); assert.equal(report.completeness, "complete");
  assert.deepEqual(report.trials, { expected: 9, recorded: 9, accepted: 9, failed: 0, incomplete: 0, missing: 0 });
});
check("planning templates cannot masquerade as completed trial records", () => {
  const data = populated(); data.mode = "template";
  reject(data, "COMPARISON_TEMPLATE_HAS_TRIALS");
});
check("failed attempts, retries, elapsed time and failure identities retained", () => {
  const data = populated(), trial = data.trials[0];
  Object.assign(trial, { status: "failed", accepted: false, retries: 2, elapsedMs: 4000, failureCount: 2, failureIds: ["FAIL-EARLY", "FAIL-LATE"], acceptanceEvidence: null });
  const before = JSON.stringify(data), result = assess(data);
  assert.equal(result.valid, true); assert.equal(result.trials.accepted, 8); assert.equal(result.trials.failed, 1);
  assert.equal(JSON.stringify(data), before);
  trial.failureIds.pop(); reject(data, "COMPARISON_TRIAL_INVALID");
});
check("unknown quota and counters stay null/partial rather than measured zero", () => {
  const data = populated(), source = data.trials[0].agents[0];
  source.counters.accountQuotaTokens = null; source.quotaEvidence = null;
  source.coverage = "partial"; source.unknownReason = "Account quota not observable";
  assert.equal(assess(data).completeness, "partial");
  assert.equal(source.counters.accountQuotaTokens, null);
  source.coverage = "complete"; reject(data, "COMPARISON_COVERAGE_REQUIRED");
});
check("quota estimates cannot masquerade as direct observations", () => {
  for (const source of ["bytes-estimate", "tokens-estimate", undefined]) {
    const data = populated(); data.trials[0].agents[0].quotaEvidence.source = source;
    reject(data, "COMPARISON_DIRECT_QUOTA_EVIDENCE_REQUIRED");
  }
});
check("all expected agent costs required for complete coverage", () => {
  const data = populated(); data.trials[0].agents.pop();
  assert.equal(assess(data).trials.incomplete, 1);
  const unknown = populated().trials[0].agents[0];
  unknown.role = "unknown"; unknown.coverage = "partial"; unknown.unknownReason = "Role unavailable";
  data.trials[0].agents = [unknown, agent("child", "child")];
  assert.equal(assess(data).completeness, "partial");
});
check("counter keys cannot be omitted, negative or double-count reasoning", () => {
  for (const patch of [{ reasoningTokens: 11 }, { inputTokens: -1 }]) {
    const data = populated(); Object.assign(data.trials[0].agents[0].counters, patch);
    reject(data, patch.reasoningTokens ? "COMPARISON_REASONING_EXCEEDS_OUTPUT" : "COMPARISON_COUNTERS_INVALID");
  }
  const data = populated(); delete data.trials[0].agents[0].counters.cacheCreationTokens;
  reject(data, "COMPARISON_COUNTERS_INVALID");
});
check("all trials use identical pinned base tools environment and acceptance", () => {
  for (const patch of [{ baseSha: "b".repeat(40) }, { toolsDigest: "b".repeat(64) }, { environmentDigest: "b".repeat(64) }, { dependencyDigest: "b".repeat(64) }, { acceptanceChecks: ["different acceptance"] }]) {
    const data = populated(); Object.assign(data.tasks[0], patch); reject(data, "COMPARISON_TRIAL_INVALID");
  }
});
check("missing/duplicate trials are disclosed rather than hidden", () => {
  const data = populated(); data.trials.pop();
  assert.equal(assess(data).trials.missing, 1); assert.equal(assess(data).completeness, "partial");
  data.trials.push(structuredClone(data.trials[0])); reject(data, "COMPARISON_TRIAL_INVALID");
});
check("null retries elapsed outcome and incomplete cancellation stay partial", () => {
  const data = populated(); Object.assign(data.trials[0], { status: "cancelled", accepted: null, retries: null, elapsedMs: null, acceptanceEvidence: null });
  assert.equal(assess(data).trials.incomplete, 1);
});
check("acceptance and effective-settings evidence are required", () => {
  for (const field of ["acceptanceEvidence", "effectiveSettingsEvidence"]) {
    const data = populated(); data.trials[0][field] = null;
    reject(data, field === "acceptanceEvidence" ? "COMPARISON_ACCEPTANCE_EVIDENCE_REQUIRED" : "COMPARISON_TRIAL_INVALID");
  }
  const data = populated(); data.trials[0].acceptanceEvidence.decision = "REJECT";
  reject(data, "COMPARISON_ACCEPTANCE_EVIDENCE_REQUIRED");
});
check("malformed model IDs and effort values cannot enter comparison", () => {
  for (const model of ["invalid model", "x".repeat(65), "none"]) {
    const data = populated(); data.configurations[0].model = model; reject(data, "COMPARISON_POLICY_INVALID");
  }
  const data = populated(); data.configurations[0].reasoningEffort = "HIGH"; reject(data, "COMPARISON_POLICY_INVALID");
});
check("supervisor effort needs no exception, while optional packets remain validated", () => {
  const data = populated(), config = data.configurations[0]; config.reasoningEffort = "high";
  assert.equal(assess(data).valid, true);
  config.necessity = { kind: "complexity", whyMediumInadequate: "Hard", evidence: "Hard", affectedScope: "Everything", returnToMedium: "After" };
  reject(data, "COMPARISON_POLICY_INVALID");
  config.necessity = { kind: "unresolved-correctness", whyMediumInadequate: "Focused medium investigation leaves two invariant orderings unresolved", evidence: "Fixture ownership-17", affectedScope: "Ownership proof", returnToMedium: "Ordering proven and regression passes" };
  assert.equal(assess(data).valid, true);
});
check("live manifest needs authorization reference but validation never grants calls", () => {
  const data = populated(); data.mode = "live"; reject(data, "COMPARISON_AUTHORIZATION_REFERENCE_REQUIRED");
  data.authorizationReference = evidence;
  assert.equal(assess(data).executionAuthorized, false);
});
check("non-template inputs cannot retain synthetic placeholders", () => {
  const data = structuredClone(template); data.mode = "synthetic";
  reject(data, "COMPARISON_INPUTS_UNPINNED");
});
console.log(`Model comparison: ${passed} passed, 0 failed, 0 skipped, ${passed} total (read-only format contract; no live trials)`);
