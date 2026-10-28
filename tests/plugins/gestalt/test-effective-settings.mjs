import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessExecutorSettings, requireExecutorSettings, executionPolicyDigest } from "../../../plugins/gestalt/skills/org-plan/scripts/org-plan-effective-settings.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/effective-settings.json", import.meta.url), "utf8"));
let passed = 0, reports = 0;
const evaluate = (input = structuredClone(fixture)) => {
  const result = assessExecutorSettings(input);
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 2048, `oversized ${result.code}`);
  reports += 1;
  return result;
};
const check = (name, action) => { try { action(); passed += 1; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } };
const changed = (section, patch) => ({ ...structuredClone(fixture), [section]: { ...structuredClone(fixture[section]), ...patch } });
const denies = (input, code) => {
  const report = evaluate(input);
  assert.equal(report.admitted, false);
  assert.equal(report.code, code);
  assert.ok(report.action.length > 0);
  let edits = 0;
  assert.throws(() => { requireExecutorSettings(input); edits += 1; }, (error) => error.code === code && error.handshake.admitted === false);
  assert.equal(edits, 0);
  return report;
};
check("exact child match admits with all required bounded fields", () => {
  const report = evaluate();
  assert.equal(report.admitted, true);
  assert.equal(report.code, "MATCH");
  assert.deepEqual(report.l1, { id: "simple-fixture", position: 1 });
  assert.equal(report.policyVersion, 1);
  assert.deepEqual(report.requested, report.effective);
  assert.equal(report.effective.reasoningEffort, "medium");
  assert.deepEqual(report.unknown, []);
  assert.equal(requireExecutorSettings(fixture).admitted, true);
});
check("execution digest is independently pinned and stable through lifecycle changes", () => {
  assert.equal(executionPolicyDigest(fixture.policy), "0bc1a81fe73c239a15509e00a0b2f1f81768d6f550f6fa6e2d5e3f8e474fad7b");
  assert.equal(executionPolicyDigest({ ...fixture.policy, state: "WIP", review: "UNREVIEWED" }), fixture.runtime.policyDigest);
});
check("role model and effort pins cannot override the explicit request", () => {
  denies(changed("runtime", { model: "gpt-6.1-sol" }), "MODEL_MISMATCH");
  denies(changed("runtime", { reasoningEffort: "high" }), "EFFORT_MISMATCH");
});
check("unavailable requested model never silently falls back", () => {
  const input = changed("catalog", { models: fixture.catalog.models.slice(1) });
  input.policy.allowedFallbacks = ["gpt-6-sol"];
  input.runtime.model = "gpt-6-sol";
  denies(input, "MODEL_UNAVAILABLE");
});
check("unsupported catalog effort fails before work", () => {
  denies(changed("catalog", { models: [{ id: "gpt-6-luna", reasoningEfforts: ["high"] }] }), "EFFORT_UNSUPPORTED");
});
check("missing effort remains unknown even when medium requested", () => {
  const input = changed("runtime", { reasoningEffort: undefined });
  const report = denies(input, "EFFECTIVE_EFFORT_UNKNOWN");
  assert.equal(report.requested.reasoningEffort, "medium");
  assert.equal(report.effective.reasoningEffort, null);
  assert.ok(report.unknown.includes("effective.reasoningEffort"));
});
check("non-runtime sources cannot establish effective values", () => {
  for (const source of [undefined, "profile", "spawn-request", "root-settings", "executor-assertion"]) {
    const report = denies(changed("runtime", { source }), "RUNTIME_UNKNOWN");
    assert.deepEqual(report.effective, { model: null, reasoningEffort: null });
  }
});
check("missing actual model stays unknown", () => {
  const report = denies(changed("runtime", { model: null }), "EFFECTIVE_MODEL_UNKNOWN");
  assert.equal(report.effective.model, null);
});
check("an inherited model cannot override the supervisor's exact requested model", () => {
  for (const model of ["gpt-6-astra", "gpt-6", "gpt-6.1", "luna", "kimi"]) denies(changed("runtime", { model }), "MODEL_MISMATCH");
  const report = evaluate({ ...structuredClone(fixture), rootModel: "gpt-6-astra" });
  assert.equal(report.admitted, true); // Root metadata is never mistaken for child metadata.
});
check("Terra/high is valid when explicitly selected and supported by the runtime catalog", () => {
  const input = structuredClone(fixture);
  input.policy.model = 'gpt-6.1-terra'; input.policy.reasoningEffort = 'high'; input.policy.necessity = null;
  input.catalog.models.push({ id: 'gpt-6.1-terra', reasoningEfforts: ['high'] });
  input.runtime.model = 'gpt-6.1-terra'; input.runtime.reasoningEffort = 'high';
  input.runtime.policyDigest = executionPolicyDigest(input.policy);
  assert.equal(evaluate(input).admitted, true);
});
check("catalog source/revision must be authoritative and complete", () => {
  for (const catalog of [null, {}, { ...fixture.catalog, source: "tool-schema" }, { ...fixture.catalog, revision: "" }, { ...fixture.catalog, models: [] }, { ...fixture.catalog, models: [...fixture.catalog.models, fixture.catalog.models[0]] }]) denies({ ...structuredClone(fixture), catalog }, "CATALOG_UNKNOWN");
  denies(changed("runtime", { catalogRevision: undefined }), "CATALOG_UNKNOWN");
});
check("catalog change invalidates old receipt until refreshed", () => {
  const input = changed("catalog", { revision: "catalog-2" });
  const report = denies(input, "CATALOG_CHANGED");
  assert.deepEqual(report.catalog, { currentRevision: "catalog-2", observedRevision: "catalog-1" });
  input.runtime.catalogRevision = "catalog-2";
  assert.equal(evaluate(input).admitted, true);
});
check("resume requires a new controller epoch and fresh observation", () => {
  const input = changed("binding", { executionEpoch: "resume-2" });
  denies(input, "BINDING_MISMATCH");
  input.runtime.executionEpoch = "resume-2";
  input.runtime.observedAt = "2026-10-21T11:00:00Z";
  assert.equal(evaluate(input).admitted, true);
});
check("canonical child identity cannot cross L1 or thread boundaries", () => {
  for (const patch of [{ l1Id: "other-l1" }, { position: 2 }, { threadId: "root-thread" }]) denies(changed("runtime", patch), "BINDING_MISMATCH");
});
check("current settings revision invalidates retained receipt", () => {
  const input = changed("binding", { settingsRevision: "settings-2" });
  denies(input, "SETTINGS_CHANGED");
  input.runtime.settingsRevision = "settings-2";
  assert.equal(evaluate(input).admitted, true);
});
check("policy change requires a new binding rather than reusing old admission", () => {
  const input = changed("policy", { model: "gpt-6-sol" });
  denies(input, "POLICY_CHANGED");
  input.runtime.policyDigest = executionPolicyDigest(input.policy);
  input.runtime.model = "gpt-6-sol";
  assert.equal(evaluate(input).admitted, true);
});
check("unknown identity and revision cannot be guessed", () => {
  for (const key of ["l1Id", "position", "threadId", "executionEpoch", "settingsRevision"]) {
    denies(changed("binding", { [key]: undefined }), "BINDING_UNKNOWN");
  }
  denies(changed("runtime", { settingsRevision: undefined }), "SETTINGS_CHANGED");
});
check("invalid or unapproved policy fails", () => {
  for (const policy of [null, {}, { ...fixture.policy, version: 2 }, { ...fixture.policy, model: "invalid model" }, { ...fixture.policy, reasoningEffort: "HIGH" }, { ...fixture.policy, reasoningEffort: "" }]) denies({ ...structuredClone(fixture), policy }, "POLICY_INVALID");
});
check("high requires documented necessity and exact actual effort", () => {
  const input = changed("policy", { reasoningEffort: "high", necessity: { kind: "unresolved-correctness", whyMediumInadequate: "Focused medium investigation cannot resolve competing orderings", evidence: "Synthetic ownership-17 trace and invariant-3 failure", affectedScope: "Ownership proof", returnToMedium: "Ordering proof and deterministic invariant-3 pass" } });
  input.runtime.policyDigest = executionPolicyDigest(input.policy);
  denies(input, "EFFORT_MISMATCH");
  input.runtime.reasoningEffort = "high";
  assert.equal(evaluate(input).admitted, true);
});
check("timestamps are retained rather than replaced with retrieval time", () => {
  assert.equal(evaluate().observedAt, "2026-10-21T10:00:00Z");
  denies(changed("runtime", { observedAt: undefined }), "OBSERVATION_UNKNOWN");
  denies(changed("runtime", { observedAt: "not-a-time" }), "OBSERVATION_UNKNOWN");
});
check("oversized metadata never becomes a diagnostic dump", () => {
  const canary = "private-transcript-canary".repeat(1000);
  for (const [section, field, code] of [["binding", "threadId", "BINDING_UNKNOWN"], ["runtime", "model", "EFFECTIVE_MODEL_UNKNOWN"], ["runtime", "reasoningEffort", "EFFECTIVE_EFFORT_UNKNOWN"], ["catalog", "revision", "CATALOG_UNKNOWN"]]) {
    const report = denies(changed(section, { [field]: canary }), code);
    assert.equal(JSON.stringify(report).includes("private-transcript-canary"), false);
  }
});
check("worst bounded UTF8/escaping reports remain within 2048 bytes", () => {
  const input = structuredClone(fixture);
  for (const key of ["l1Id", "threadId", "executionEpoch", "settingsRevision"]) input.binding[key] = input.runtime[key] = "\\".repeat(46);
  input.catalog.revision = input.runtime.catalogRevision = "界".repeat(31);
  assert.equal(evaluate(input).admitted, true);
  const report = denies(changed("runtime", { model: "\\".repeat(30) }), "MODEL_PROHIBITED");
  assert.ok(!JSON.stringify(report).includes("�"));
});
check("assessment does not mutate trusted input or infer missing source fields", () => {
  const input = structuredClone(fixture), before = JSON.stringify(input);
  evaluate(input); requireExecutorSettings(input);
  assert.equal(JSON.stringify(input), before);
  denies({}, "POLICY_INVALID");
});
console.log(`Effective settings: ${passed} passed, 0 failed, 0 skipped, ${passed} total; ${reports} bounded reports (synthetic receipts; live integration unverified)`);
