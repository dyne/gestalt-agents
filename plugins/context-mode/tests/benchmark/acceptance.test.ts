import { describe, expect, test } from "vitest";
import { loadFrozenCorpus } from "../../benchmark/model-payloads.js";
import { summarizeAcceptance } from "../../benchmark/acceptance.js";

// Independent arithmetic fixtures for the acceptance gate, not measured savings.
const pair = () => {
  const { corpus, manifest } = loadFrozenCorpus();
  const rows = corpus.scenarios.map((row: any) => ({ id: row.id, quality: "complete", missingFindings: [],
    observations: [{}], overflowCalls: 0 }));
  const side = { environment: { node: "synthetic" }, inputFileSha256: manifest.fileSha256, cases: rows };
  return { corpusSha256: manifest.corpusSha256, baselineIdentity: { head: "base" }, candidateIdentity: { head: "candidate", dirtyDigest: "dirty" },
    baseline: structuredClone(side), candidate: structuredClone(side), cases: rows.map((row: any) => ({ id: row.id,
      findingsComparable: true, baselineRoutineReturnedBytes: 100, candidateRoutineReturnedBytes: 40,
      baselineRoutineVisibleBytes: 200, candidateRoutineVisibleBytes: 90 })) } as any;
};

describe("deterministic acceptance gate", () => {
  test("uses every frozen retrieval case and discloses incomparable full costs", () => {
    const value = pair();
    const report = summarizeAcceptance([value, structuredClone(value)]);
    expect(report.passes[0]).toMatchObject({ retrievalIds: ["broad-retrieval", "overlapping-queries"],
      baselineReturnedBytes: 200, candidateReturnedBytes: 80, baselineVisibleBytes: 400,
      candidateVisibleBytes: 180, returnedByteReduction: 0.6, visibleByteReduction: 0.55 });
    expect(report.totalSavings).toBeNull(); expect(report.accountQuota).toBeNull();
    expect(report.schedulingAndModelPolicy).toContain("not measured");
  });
  test.each(["bytes", "requests", "findings", "dirty", "environment", "inputs", "missing-case"])("rejects %s regression", (fault) => {
    const first = pair(), second = structuredClone(first);
    if (fault === "bytes") second.cases[1].candidateRoutineReturnedBytes = 1000;
    if (fault === "requests") second.cases[1].candidateRoutineVisibleBytes = 1000;
    if (fault === "findings") second.candidate.cases[0].missingFindings = ["FAIL-BROAD-OMEGA"];
    if (fault === "dirty") second.candidateIdentity.dirtyDigest = "changed";
    if (fault === "environment") second.candidate.environment.node = "different";
    if (fault === "inputs") second.candidate.inputFileSha256 = {};
    if (fault === "missing-case") second.candidate.cases.pop();
    expect(() => summarizeAcceptance([first, second])).toThrow();
  });
  test("requires repeats and rejects unknown retrieval accounting", () => {
    expect(() => summarizeAcceptance([pair()])).toThrow("repeat");
    const value = pair(); value.cases[0].candidateRoutineVisibleBytes = null;
    expect(() => summarizeAcceptance([value, structuredClone(value)])).toThrow("unknown");
  });
});
