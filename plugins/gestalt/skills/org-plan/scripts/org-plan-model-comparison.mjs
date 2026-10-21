import { createHash } from "node:crypto";
import { MODEL_IDS, validEffortNecessity } from "./org-plan-model-policy.mjs";

export const COMPARISON_COUNTERS = Object.freeze([
  "inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "reasoningTokens",
  "visibleResponseBytes", "wrapperEnvelopeBytes", "contextOccupancyTokens", "costUsd", "accountQuotaTokens",
]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const evidence = (value) => object(value) && text(value.reference) && sha(value.sha256) &&
  text(value.observedAt) && !Number.isNaN(Date.parse(value.observedAt));
export function comparisonInputDigest(task) {
  return createHash("sha256").update(JSON.stringify([
    task.id, task.baseSha, task.toolsDigest, task.environmentDigest,
    task.dependencyDigest, task.acceptanceChecks,
  ])).digest("hex");
}

// Format validation only: never runs a provider, dispatches work, aggregates
// usage streams or derives quota. L1 accounting artifacts remain authoritative.
export function validateModelComparison(manifest) {
  const invalid = (code) => ({ valid: false, code, liveQuality: "unverified", liveSavings: "unverified" });
  if (!object(manifest) || manifest.schemaVersion !== 1 || manifest.modelPolicyVersion !== 1 || manifest.optIn !== true ||
      !["template", "synthetic", "live"].includes(manifest.mode) ||
      !text(manifest.provenance) || manifest.trialsPerConfiguration !== 3 ||
      !Array.isArray(manifest.tasks) || !manifest.tasks.length ||
      !Array.isArray(manifest.configurations) || !manifest.configurations.length ||
      !Array.isArray(manifest.trials)) return invalid("COMPARISON_SCHEMA_INVALID");
  if (manifest.mode === "live" && !evidence(manifest.authorizationReference)) return invalid("COMPARISON_AUTHORIZATION_REFERENCE_REQUIRED");
  if (manifest.mode === "template" && manifest.trials.length) return invalid("COMPARISON_TEMPLATE_HAS_TRIALS");
  const tasks = new Map(), configurations = new Map();
  for (const task of manifest.tasks) {
    if (!object(task) || !text(task.id) || tasks.has(task.id) ||
        !["simple", "bounded", "multi-component"].includes(task.difficulty) ||
        !/^[a-f0-9]{40}$/.test(task.baseSha ?? "") ||
        ![task.toolsDigest, task.environmentDigest, task.dependencyDigest].every(sha) ||
        !Array.isArray(task.acceptanceChecks) || !task.acceptanceChecks.length ||
        !task.acceptanceChecks.every(text)) return invalid("COMPARISON_TASK_INVALID");
    tasks.set(task.id, task);
    if (manifest.mode !== "template" && (/^0+$/.test(task.baseSha) ||
        [task.toolsDigest, task.environmentDigest, task.dependencyDigest].some((value) => /^0+$/.test(value)) ||
        task.acceptanceChecks.some((value) => value.startsWith("REPLACE:")))) return invalid("COMPARISON_INPUTS_UNPINNED");
  }
  for (const config of manifest.configurations) {
    if (!object(config) || !text(config.id) || configurations.has(config.id) ||
        !MODEL_IDS.includes(config.model) || !["medium", "high", "xhigh"].includes(config.reasoningEffort) ||
        !validEffortNecessity(config.reasoningEffort, config.necessity) ||
        (config.reasoningEffort === "medium" && config.necessity != null)) return invalid("COMPARISON_POLICY_INVALID");
    configurations.set(config.id, config);
  }
  const seen = new Set();
  let accepted = 0, failed = 0, incomplete = 0;
  for (const trial of manifest.trials) {
    if (!object(trial)) return invalid("COMPARISON_TRIAL_INVALID");
    const task = tasks.get(trial.taskId), config = configurations.get(trial.configurationId);
    const key = JSON.stringify([trial.taskId, trial.configurationId, trial.repetition]);
    if (!task || !config || !integer(trial.repetition) || trial.repetition < 1 || trial.repetition > 3 || seen.has(key) ||
        trial.inputDigest !== comparisonInputDigest(task) ||
        !["completed", "failed", "cancelled", "incomplete"].includes(trial.status) ||
        ![true, false, null].includes(trial.accepted) ||
        (trial.retries !== null && !integer(trial.retries)) ||
        (trial.elapsedMs !== null && !integer(trial.elapsedMs)) ||
        !evidence(trial.resultEvidence) || !evidence(trial.accountingEvidence) || !evidence(trial.effectiveSettingsEvidence) ||
        !integer(trial.failureCount) || !Array.isArray(trial.failureIds) ||
        trial.failureIds.length !== trial.failureCount || !trial.failureIds.every(text) ||
        new Set(trial.failureIds).size !== trial.failureIds.length ||
        !Array.isArray(trial.expectedAgentIds) || !trial.expectedAgentIds.length ||
        !trial.expectedAgentIds.every(text) || new Set(trial.expectedAgentIds).size !== trial.expectedAgentIds.length ||
        !Array.isArray(trial.agents)) return invalid("COMPARISON_TRIAL_INVALID");
    seen.add(key);
    if (trial.status === "completed" && (trial.accepted === null || !evidence(trial.acceptanceEvidence) ||
        trial.acceptanceEvidence.decision !== (trial.accepted ? "ACCEPT" : "REJECT"))) return invalid("COMPARISON_ACCEPTANCE_EVIDENCE_REQUIRED");
    if ((trial.status !== "completed" && trial.accepted === true) ||
        (trial.status === "failed" && trial.failureCount === 0) ||
        (trial.accepted === true && trial.failureCount > 0)) return invalid("COMPARISON_OUTCOME_CONTRADICTION");
    const agents = new Set();
    let partial = trial.retries === null || trial.elapsedMs === null || trial.accepted === null ||
      ["cancelled", "incomplete"].includes(trial.status);
    for (const agent of trial.agents) {
      if (!object(agent) || !text(agent.id) || agents.has(agent.id) || !trial.expectedAgentIds.includes(agent.id) ||
          !["root", "child", "unknown"].includes(agent.role) ||
          !["complete", "partial", "unknown"].includes(agent.coverage) || !object(agent.counters) ||
          Object.keys(agent.counters).length !== COMPARISON_COUNTERS.length ||
          !COMPARISON_COUNTERS.every((counter) => Object.hasOwn(agent.counters, counter) &&
            (agent.counters[counter] === null || (counter === "costUsd"
              ? Number.isFinite(agent.counters[counter]) && agent.counters[counter] >= 0 : integer(agent.counters[counter]))))) {
        return invalid("COMPARISON_COUNTERS_INVALID");
      }
      agents.add(agent.id);
      const missing = COMPARISON_COUNTERS.some((counter) => agent.counters[counter] === null);
      if ((missing || agent.role === "unknown" || agent.coverage !== "complete") &&
          (!text(agent.unknownReason) || agent.coverage === "complete")) return invalid("COMPARISON_COVERAGE_REQUIRED");
      if (agent.counters.reasoningTokens !== null && agent.counters.outputTokens !== null &&
          agent.counters.reasoningTokens > agent.counters.outputTokens) return invalid("COMPARISON_REASONING_EXCEEDS_OUTPUT");
      if (agent.counters.accountQuotaTokens !== null && (!evidence(agent.quotaEvidence) ||
          agent.quotaEvidence.source !== "direct-provider-observation")) return invalid("COMPARISON_DIRECT_QUOTA_EVIDENCE_REQUIRED");
      partial ||= missing || agent.role === "unknown" || agent.coverage !== "complete";
    }
    partial ||= trial.expectedAgentIds.some((id) => !agents.has(id));
    if (partial) incomplete += 1;
    if (trial.accepted === true) accepted += 1;
    if (trial.accepted === false || trial.status === "failed") failed += 1;
  }
  const expected = tasks.size * configurations.size * manifest.trialsPerConfiguration;
  const missing = expected - seen.size;
  return { valid: true, code: "COMPARISON_VALID", mode: manifest.mode,
    trials: { expected, recorded: seen.size, accepted, failed, incomplete, missing },
    completeness: missing || incomplete ? "partial" : "complete",
    liveQuality: "unverified", liveSavings: "unverified", executionAuthorized: false };
}
