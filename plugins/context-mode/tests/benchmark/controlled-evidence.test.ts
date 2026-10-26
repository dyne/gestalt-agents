import { describe, expect, it } from 'vitest';
import { checkControlledAnswer, runControlledEvidenceComparison } from '../../benchmark/controlled-evidence.js';

describe('controlled evidence cost and correctness',()=>{
  it('counts schema/discovery and every envelope, reports regressions, preserves findings and cleans fixtures',()=>{
    const report=runControlledEvidenceComparison(2);
    expect(report.caseCount).toBe(14);expect(report.cleanupVerified).toBe(true);
    expect(report.units.bytes).toContain('UTF-8');expect(report.coverage.providerUsage).toContain('unknown');
    expect(report.negative.correct).toBe(false);
    expect(report.negative.shorterAnswerBytes).toBeLessThan(report.negative.completeAnswerBytes);
    expect(report.negative.missing).toContain('failure:synthetic.payment.retries-timeout');
    for(const c of report.cases) {
      expect(c.baseline.sourceSha256).toBe(c.coordinated.sourceSha256);
      for(const path of [c.baseline,c.coordinated]) {
        expect(path.correct,c.id).toBe(true);expect(path.missing).toEqual([]);
        expect(path.deliveredBytes).toBe(path.requestBytes+path.responseBytes);
        expect(path.discoverySchemaBytes).toBeGreaterThan(0);
        expect(path.calls).toBe(2+path.executionCalls+path.followupCalls);
        expect(path.elapsedMs).toBeGreaterThanOrEqual(0);
        expect(path.retries).toBe(c.id==='retry-fail'?1:0);
      }
      expect(c.byteDelta).toBe(c.coordinated.deliveredBytes-c.baseline.deliveredBytes);
      expect(c.byteOutcome).toBe(c.byteDelta<0?'improved':c.byteDelta>0?'regressed':'equal');
      if(c.id==='tiny-pass') expect(c.byteOutcome).toBe('regressed');
      if(c.id==='large-fail') expect(c.byteOutcome).toBe('improved');
      if(c.id==='unknown') expect(c.coordinated.evidenceCompleteness).toBe('unknown');
      if(c.id==='partial-fail') expect(c.coordinated.captureCompleteness).toBe('partial');
    }
  });
  it('rejects missing causes, locators, incorrect counts, identity and certainty',()=>{
    const failure={id:'test.required',cause:'cause',locator:'JSON:tests[0]'};
    const expected={failures:[failure],counts:{passed:0,failed:1,skipped:0,total:1},certainty:'known',completeness:'complete',exit:1};
    const answer={...expected,sourceSha256:'a'.repeat(64),referenceVerified:true};
    expect(checkControlledAnswer(expected,answer,answer.sourceSha256).correct).toBe(true);
    for(const change of [{failures:[]},{failures:[{...failure,cause:''}]},{failures:[{...failure,locator:''}]},
      {counts:null},{certainty:'unknown'},{completeness:'partial'},{exit:0},{sourceSha256:'b'.repeat(64)},{referenceVerified:false}])
      expect(checkControlledAnswer(expected,{...answer,...change},answer.sourceSha256).correct).toBe(false);
  });
});
