/** Opt-in synthetic runner and read-only import. Never dispatches a model. */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { COMPARISON_COUNTERS, comparisonInputDigest, validateModelComparison } from "../../gestalt/skills/org-plan/scripts/org-plan-model-comparison.mjs";
import { loadFrozenCorpus } from "./model-payloads.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const observedAt = "2026-10-21T00:00:00Z"; // Invented fixture time, never a live observation.
const difficulties = ["simple", "bounded", "multi-component"];
const counters = COMPARISON_COUNTERS as string[];
const additive = counters.filter(key => !["contextOccupancyTokens", "accountQuotaTokens"].includes(key));

/** Includes failed/cancelled records; unknown samples do not become zero. */
export function distribution(values: Array<number | null>, expected = values.length) {
  const known = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  const middle = Math.floor(known.length / 2);
  return { expected, observed: known.length, missing: expected - known.length,
    complete: known.length === expected,
    median: known.length ? (known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2) : null,
    min: known.at(0) ?? null, max: known.at(-1) ?? null };
}

export function summarizeModelTrials(manifest: any) {
  const validation = validateModelComparison(manifest);
  assert.equal(validation.valid, true, validation.code);
  const groups = manifest.tasks.flatMap((task: any) => manifest.configurations.map((config: any) => {
    const trials = manifest.trials.filter((trial: any) => trial.taskId === task.id && trial.configurationId === config.id);
    const accepted = trials.filter((trial: any) => trial.accepted === true).length;
    const missingTrials = manifest.trialsPerConfiguration - trials.length;
    const totals = (trial: any, key: string): number | null => {
      if (!trial.expectedAgentIds.every((id: string) => trial.agents.some((agent: any) => agent.id === id))) return null;
      // Importing a schema-valid record does not establish disjoint accounting.
      // Scope evidence owns dedup/reset semantics; never infer this from IDs.
      if (trial.agents.some((agent: any) => agent.accountingScope !== "disjoint-trial-total" || agent.counters[key] === null)) return null;
      return trial.agents.reduce((sum: number, agent: any) => sum + agent.counters[key], 0);
    };
    return { taskId: task.id, difficulty: task.difficulty, configurationId: config.id,
      expectedTrials: manifest.trialsPerConfiguration, recordedTrials: trials.length, missingTrials, accepted,
      failed: trials.filter((trial: any) => trial.status === "failed" || trial.accepted === false).length,
      outcomeIncomplete: trials.filter((trial: any) => trial.accepted === null || ["incomplete", "cancelled"].includes(trial.status)).length,
      elapsedMs: distribution(trials.map((trial: any) => trial.elapsedMs), manifest.trialsPerConfiguration),
      retries: distribution(trials.map((trial: any) => trial.retries), manifest.trialsPerConfiguration),
      allAgentCosts: Object.fromEntries(additive.map(key => {
        const values = trials.map((trial: any) => totals(trial, key));
        const samples = distribution(values, manifest.trialsPerConfiguration);
        const knownSubtotal = values.reduce((sum: number, value: number | null) => sum + (value ?? 0), 0);
        return [key, { ...samples, knownSubtotal,
          total: samples.complete ? knownSubtotal : null,
          // The numerator includes every trial, including failed attempts and
          // all retry/reviewer actors. Never divide only successful costs.
          perAcceptedTask: samples.complete && trials.every((trial: any) => trial.accepted !== null)
            && accepted > 0 ? knownSubtotal / accepted : null }];
      })),
      nonAdditive: { contextOccupancyTokens: "per-agent observations in manifest; not summed",
        accountQuotaTokens: "direct per-agent evidence only; never summed or inferred" },
      trials: trials.map((trial: any) => ({ repetition: trial.repetition, status: trial.status, accepted: trial.accepted,
        failureCount: trial.failureCount, failureIds: trial.failureIds, expectedAgentIds: trial.expectedAgentIds,
        attempts: trial.attempts ?? null,
        attemptCoverage: Array.isArray(trial.attempts) && trial.retries !== null
          && trial.attempts.length === trial.retries + 1 ? "recorded; inspect evidence" : "unknown",
        observedAgentIds: trial.agents.map((agent: any) => agent.id), resultEvidence: trial.resultEvidence,
        accountingEvidence: trial.accountingEvidence, acceptanceEvidence: trial.acceptanceEvidence ?? null,
        effectiveSettingsEvidence: trial.effectiveSettingsEvidence })),
    };
  }));
  return { schemaVersion: 1, mode: manifest.mode, validation, representedDifficulties: [...new Set(manifest.tasks.map((task: any) => task.difficulty))], groups,
    population: "Every recorded trial, including failures/cancellations; missing trials and unknown counters disclosed. Median/range describe known samples only.",
    liveQuality: "unverified", liveSavings: "unverified", liveExecutionSupported: false,
    limits: "Synthetic numbers are injected fixture values. Imported evidence references need independent authorization, provenance and acceptance review. No provider calls, runtime attestation, quota estimate or model recommendation." };
}

/** A fixed in-process fake provider, with no network/SDK/dispatch adapter. */
export function runFakeModelTrials() {
  const { manifest: corpus } = loadFrozenCorpus();
  const artifacts: Record<string, unknown> = {};
  const evidence = (key: string, value: unknown) => {
    artifacts[key] = value;
    return { reference: `embedded:artifacts/${key}`, sha256: digest(value), observedAt };
  };
  const manifest: any = {
    schemaVersion: 1, modelPolicyVersion: 1, optIn: true, mode: "synthetic",
    provenance: "Fixed fake-provider demonstration. Invented results, times, costs and evidence; never live model, quota or runtime-setting observations.",
    authorizationReference: null, trialsPerConfiguration: 3,
    tasks: difficulties.map(id => ({ id, difficulty: id, baseSha: corpus.baselineRevision,
      toolsDigest: digest("fixed fake-provider tools v1"), environmentDigest: digest("fixed in-process fake environment v1"),
      dependencyDigest: corpus.packageLockSha256,
      acceptanceChecks: [`FAKE: ${id} observable-contract check; cwd disposable fixture; same independent reviewer criteria`] })),
    configurations: ["gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"].map(model => ({ id: `${model}-medium`, model, reasoningEffort: "medium", necessity: null })),
    trials: [], artifacts,
  };
  for (const task of manifest.tasks) for (const config of manifest.configurations) for (let repetition = 1; repetition <= 3; repetition++) {
    const key = `${task.id}-${config.id}-${repetition}`;
    const failed = task.id === "bounded" && config.model === "gpt-6-luna" && repetition === 2;
    const incomplete = task.id === "multi-component" && config.model === "gpt-6-sol" && repetition === 3;
    const retries = repetition === 2 ? 1 : 0;
    const expectedAgentIds = ["root", "executor-attempt-1", "reviewer-attempt-1",
      ...(retries ? ["executor-attempt-2", "reviewer-attempt-2"] : [])];
    const agents = expectedAgentIds.map((id, index) => ({ id, role: id === "root" ? "root" : "child",
      purpose: id.startsWith("reviewer") ? "independent-review" : id.startsWith("executor") ? "implementation" : "supervision",
      accountingScope: "disjoint-trial-total", coverage: "partial", unknownReason: "Synthetic quota is unobserved; all other counters are injected fixture values.",
      counters: { inputTokens: 100 + index, outputTokens: 20, cacheReadTokens: 10, cacheCreationTokens: 0,
        reasoningTokens: 5, visibleResponseBytes: 200, wrapperEnvelopeBytes: 30,
        contextOccupancyTokens: 400, costUsd: 0.01, accountQuotaTokens: null }, quotaEvidence: null }));
    const failureIds = failed ? ["FAKE-ACCEPTANCE-REJECTED"] : incomplete ? ["FAKE-PROVIDER-INTERRUPTED"] : [];
    const attempts = Array.from({ length: retries + 1 }, (_, index) => ({ attempt: index + 1,
      executorAgentId: `executor-attempt-${index + 1}`, reviewerAgentId: `reviewer-attempt-${index + 1}`,
      decision: incomplete ? null : failed || index < retries ? "REJECT" : "ACCEPT",
      failureIds: incomplete ? ["FAKE-PROVIDER-INTERRUPTED"] : index < retries ? ["FAKE-RETRY-RECOVERED"] : failureIds }));
    const trial: any = { taskId: task.id, configurationId: config.id, repetition, inputDigest: comparisonInputDigest(task),
      status: incomplete ? "incomplete" : failed ? "failed" : "completed", accepted: incomplete ? null : !failed,
      retries: incomplete ? null : retries, elapsedMs: incomplete ? null : repetition * 1000,
      failureCount: failureIds.length, failureIds, attempts, expectedAgentIds, agents: incomplete ? agents.slice(0, 1) : agents,
      resultEvidence: evidence(`${key}-result`, { status: incomplete ? "interrupted" : "finished", failureIds, attempts }),
      effectiveSettingsEvidence: evidence(`${key}-settings`, { ...config, scope: "fake-provider injected configuration", runtimeAttestation: false }),
    };
    trial.accountingEvidence = evidence(`${key}-accounting`, { expectedAgentIds, agents: trial.agents,
      scope: "Disjoint per-actor fake totals; retry and reviewer actors included; no live counters." });
    trial.acceptanceEvidence = incomplete ? null : { ...evidence(`${key}-acceptance`, {
      reviewer: "fixed independent fake reviewer", checks: task.acceptanceChecks, decision: failed ? "REJECT" : "ACCEPT" }), decision: failed ? "REJECT" : "ACCEPT" };
    manifest.trials.push(trial);
  }
  summarizeModelTrials(manifest); // Fail before returning malformed generated data.
  return manifest;
}

export function verifyEmbeddedEvidence(manifest: any) {
  for (const trial of manifest.trials) for (const field of ["resultEvidence", "accountingEvidence", "effectiveSettingsEvidence", "acceptanceEvidence"]) {
    const value = trial[field]; if (!value) continue;
    assert.ok(value.reference.startsWith("embedded:artifacts/"), "fake evidence must be embedded");
    const key = value.reference.slice("embedded:artifacts/".length);
    assert.ok(Object.hasOwn(manifest.artifacts, key), "missing embedded evidence");
    assert.equal(digest(manifest.artifacts[key]), value.sha256, "embedded evidence digest mismatch");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, input, output] = process.argv.slice(2);
  assert.ok((operation === "--fake" && input && !output) || (operation === "--summarize" && input && output),
    "usage: model-trials.ts --fake OUTPUT_JSON | --summarize MANIFEST_JSON OUTPUT_JSON; live dispatch is unsupported");
  const imported = operation === "--fake" ? null : JSON.parse(readFileSync(resolve(input), "utf8"));
  const manifest = operation === "--fake" ? runFakeModelTrials() : imported.manifest ?? imported;
  if (operation === "--fake") verifyEmbeddedEvidence(manifest);
  writeFileSync(resolve(operation === "--fake" ? input : output), JSON.stringify({ manifest, summary: summarizeModelTrials(manifest) }, null, 2) + "\n", { mode: 0o600 });
}
