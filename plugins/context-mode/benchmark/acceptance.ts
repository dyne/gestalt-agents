/** Deterministic retrieval acceptance; no provider calls or quota estimates. */
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compareModelPayloads, loadFrozenCorpus } from "./model-payloads.js";

type Comparison = ReturnType<typeof compareModelPayloads>;

export function summarizeAcceptance(runs: Comparison[]) {
  assert.ok(runs.length >= 2, "repeat both baseline and candidate at least twice");
  const { corpus, manifest } = loadFrozenCorpus();
  // Freeze the denominator before inspecting results: only retrieval scenarios,
  // including indexing and overlapping queries. Execution and evidence parsing
  // remain separately reported and must still recover their planted findings.
  const retrievalIds = corpus.scenarios.filter((row: any) => row.kind === "retrieval").map((row: any) => row.id);
  const reference = runs[0];
  const passes = runs.map((run, index) => {
    assert.equal(run.corpusSha256, manifest.corpusSha256, "corpus identity changed");
    for (const key of ["baselineIdentity", "candidateIdentity"] as const)
      assert.deepEqual(run[key], reference[key], `${key} changed across repeated pair`);
    for (const side of ["baseline", "candidate"] as const) {
      assert.deepEqual(run[side].environment, reference.baseline.environment, "environment changed");
      assert.deepEqual(run[side].inputFileSha256, manifest.fileSha256, "input changed");
      for (const scenario of corpus.scenarios) {
        const row = run[side].cases.find((value: any) => value.id === scenario.id);
        assert.ok(row, `missing ${side} scenario ${scenario.id}`);
        assert.deepEqual(row.missingFindings, [], `unrecoverable ${side} findings`);
        // Legacy stats/accounting is unsupported, not silently complete.
        if (scenario.kind !== "stats") assert.equal(row.quality, "complete");
      }
    }
    const retrieval = run.cases.filter((row: any) => retrievalIds.includes(row.id));
    assert.deepEqual(retrieval.map((row: any) => row.id).sort(), [...retrievalIds].sort());
    assert.ok(retrieval.every((row: any) => row.findingsComparable), "incomplete retrieval coverage");
    const sum = (key: "baselineRoutineReturnedBytes" | "candidateRoutineReturnedBytes" | "baselineRoutineVisibleBytes" | "candidateRoutineVisibleBytes") =>
      retrieval.reduce((total: number, row: any) => {
        assert.ok(typeof row[key] === "number", `unknown ${key}`);
        return total + row[key]!;
      }, 0);
    const baselineReturnedBytes = sum("baselineRoutineReturnedBytes"), candidateReturnedBytes = sum("candidateRoutineReturnedBytes");
    const baselineVisibleBytes = sum("baselineRoutineVisibleBytes"), candidateVisibleBytes = sum("candidateRoutineVisibleBytes");
    assert.ok(baselineReturnedBytes > 0 && baselineVisibleBytes > 0);
    const returnedByteReduction = 1 - candidateReturnedBytes / baselineReturnedBytes;
    const visibleByteReduction = 1 - candidateVisibleBytes / baselineVisibleBytes;
    assert.ok(returnedByteReduction >= 0.5 && visibleByteReduction >= 0.5, "routine retrieval reduction below 50%");
    return { pass: index + 1, retrievalIds, baselineReturnedBytes, candidateReturnedBytes,
      baselineVisibleBytes, candidateVisibleBytes, returnedByteReduction, visibleByteReduction,
      scenarios: run.cases.map((row: any) => ({ ...row,
        baselineCalls: run.baseline.cases.find((value: any) => value.id === row.id)!.observations.length,
        candidateCalls: run.candidate.cases.find((value: any) => value.id === row.id)!.observations.length,
        baselineOverflowCalls: run.baseline.cases.find((value: any) => value.id === row.id)!.overflowCalls,
        candidateOverflowCalls: run.candidate.cases.find((value: any) => value.id === row.id)!.overflowCalls,
      })) };
  });
  return { schemaVersion: 1, corpusSha256: manifest.corpusSha256, passes,
    quality: "all frozen planted findings recovered in both repeated sides",
    schedulingAndModelPolicy: "not measured by payload replay; require separate pinned Mobile production-boundary fixtures",
    totalSavings: null, providerTokens: null, accountQuota: null,
    limits: "Routine retrieval includes initial index/search envelopes, with request/description costs separately gated. Full overflow/audit costs and non-retrieval cases remain visible; broader candidate evidence scope prevents a total-savings claim. No live model, latency, production scheduling, or runtime-attestation claim." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [baseline, candidate, output] = process.argv.slice(2);
  assert.ok(baseline && candidate && output, "usage: acceptance.ts BASELINE_PLUGIN CANDIDATE_PLUGIN OUTPUT_JSON");
  const runs = Array.from({ length: 2 }, () => compareModelPayloads(resolve(baseline), resolve(candidate)));
  writeFileSync(resolve(output), JSON.stringify({ observedAt: new Date().toISOString(),
    ...summarizeAcceptance(runs), runs }, null, 2) + "\n", { mode: 0o600 });
}
