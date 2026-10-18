import { describe, expect, it } from 'vitest';
import { runEvidenceBenchmark } from './efficiency-benchmark.js';

describe('sanitized end-to-end evidence efficiency',()=>{
  it('preserves findings and references, measures complete payload cost and avoids redundant terminal work',async()=>{
    const report=await runEvidenceBenchmark();
    expect(Object.values(report.criteria).every(Boolean)).toBe(true);
    expect(report.cases.map(c=>c.caseId)).toEqual(['passing','failing','setup-failure','repeated-ci','rerun','unknown']);
    for(const c of report.cases) {
      expect(c.baseline.missingFindings,c.caseId).toEqual([]);expect(c.bounded.missingFindings,c.caseId).toEqual([]);
      expect(c.bounded.missingReferences,c.caseId).toBe(0);
      expect(c.bounded.initialReturnedBytes,c.caseId).toBeLessThanOrEqual(2048);
      if(c.baseline.initialReturnedBytes>20*1024)expect(c.initialReduction,c.caseId).toBeGreaterThanOrEqual(0.8);
      expect(c.bounded.totalVisibleBytes).toBe(c.bounded.returnedBytes+c.bounded.descriptionBytes+c.bounded.requestBytes);
      expect(c.bounded.descriptionBytes).toBeGreaterThan(0);expect(c.bounded.retrievalCalls).toBeGreaterThan(0);
      expect(c.bounded.diagnosticMs).toBeGreaterThanOrEqual(0);
      expect(c.bounded.totalVisibleBytes,c.caseId).toBeLessThan(c.baseline.totalVisibleBytes);
    }
    const repeated=report.cases.find(c=>c.caseId==='repeated-ci')!;
    expect(repeated.baseline.fetches).toBe(3);expect(repeated.bounded.fetches).toBe(1);
    expect(repeated.baseline.indexes).toBe(3);expect(repeated.bounded.indexes).toBe(1);
    expect(repeated.bounded.ghCalls).toBe(4);
    const rerun=report.cases.find(c=>c.caseId==='rerun')!;
    expect(rerun.bounded.fetches).toBe(2);expect(rerun.bounded.indexes).toBe(2);
    expect(report.cases.find(c=>c.caseId==='unknown')!.certainty).toBe('unknown');
  },30000);
});
