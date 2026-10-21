import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {mkdtempSync,realpathSync,readFileSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {digest} from '../../src/evidence/github.js';
import {ingestEvidence} from '../../src/evidence/extract.js';
import {createReviewPacket,verifyReviewPacket,type ReviewState,type ReviewPacket} from '../../src/evidence/review.js';

let root:string,state:ReviewState;
const plugin=resolve(import.meta.dirname,'../..');
const authorize=(path:string)=>resolve(path).startsWith(root+sep);
const ref=(path:string)=>{const bytes=readFileSync(path);return {path,sha256:digest(bytes),bytes:bytes.length};};
function report(failed=false,command='npm test') {
  const path=join(root,failed?'fail.json':'pass.json');
  writeFileSync(path,JSON.stringify({version:1,exitCode:failed?1:0,tests:[{id:failed?'hidden failure':'passing check',status:failed?'failed':'passed',cause:failed?'expected true; received false':undefined}]}));
  const ingested=ingestEvidence([{path,command,cwd:root,exit:failed?1:0,observedAt:'2020-01-01T00:00:00.000Z'}],{storageRoot:join(root,'captures'),authorizeRead:authorize,index:()=>({sourceId:1}),source:{kind:'local',repository:root}});
  return ref(join(root,'captures',ingested.id,'report.json'));
}
beforeEach(()=>{
  root=realpathSync(mkdtempSync(join(tmpdir(),'review-packet-')));
  writeFileSync(join(root,'a.ts'),'current source a');writeFileSync(join(root,'b.ts'),'current source b');writeFileSync(join(root,'candidate.diff'),'native root diff artifact');
  state={repository:root,candidate:{sha:'a'.repeat(40),base:'b'.repeat(40),branch:'feature',dirtySha256:digest('dirty'),dependencyConfigSha256:digest('lock/config'),environmentSha256:digest('environment')},
    scope:['a.ts','b.ts'].map(path=>({path,sha256:digest(readFileSync(join(root,path))),mode:'100644'})),diff:ref(join(root,'candidate.diff')),evidence:[report()],requiredChecks:[{command:'npm test',cwd:root,exit:0}]};
});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
const packet=(s:ReviewState=state,previous?:ReviewPacket)=>createReviewPacket(s,'L3.4 independent-delta-review',['Shared evidence adapters require regression checks'],authorize,previous);
const verify=(p:ReviewPacket,current=state,previous?:ReviewPacket)=>verifyReviewPacket(p,current,authorize,previous);

describe('independent review packet contradictions',()=>{
  it('rejects forged report/source/diff digests without trusting a child success summary',()=>{
    const p=packet();p.state.evidence[0].sha256='0'.repeat(64);
    expect(verify(p).decision).toBe('contradictory');
    const clean=packet(),reportPath=state.evidence[0].path,data=JSON.parse(readFileSync(reportPath,'utf8'));
    writeFileSync(data.checks[0].references[0].path,'forged raw tests');
    expect(verify(clean).issues.map(i=>i.code)).toContain('evidence-digest');
    writeFileSync(state.diff.path,'changed diff');expect(verify(clean).issues.map(i=>i.code)).toContain('diff-digest');
  });
  it.each(['sha','base','branch','dirtySha256','dependencyConfigSha256','environmentSha256'] as const)('rejects changed candidate %s',field=>{
    const p=packet(),current=structuredClone(state);
    current.candidate[field]=field==='branch'?'other':field==='sha'||field==='base'?'c'.repeat(40):digest('changed');
    expect(verify(p,current).issues.map(i=>i.code)).toContain('candidate-mismatch');expect(verify(p,current).decision).toBe('contradictory');
  });
  it('rejects omitted files, untracked additions in the root witness and changed live file bytes',()=>{
    const child=structuredClone(state);child.scope=child.scope.slice(0,1);
    expect(verify(packet(child)).issues.map(i=>i.code)).toContain('scope-mismatch');
    const p=packet(),current=structuredClone(state);writeFileSync(join(root,'untracked.ts'),'untracked delivery');
    current.scope.push({path:'untracked.ts',sha256:digest('untracked delivery'),mode:'100644'});
    expect(verify(p,current).decision).toBe('contradictory');
    writeFileSync(join(root,'a.ts'),'changed after witness');expect(verify(p).issues.map(i=>i.code)).toContain('file-revision');
  });
  it('rejects omitted and hidden failing checks, even if a forged report claims a pass',()=>{
    state.evidence.push(report(true,'npm run integration'));state.requiredChecks.push({command:'npm run integration',cwd:root,exit:1});
    const p=packet();p.checks=p.checks.slice(0,1);p.firstFailure=null;
    const rejected=verify(p);expect(rejected.decision).toBe('contradictory');
    expect(rejected.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['check-claim','failed-check','first-failure']));
    const forged=JSON.parse(readFileSync(state.evidence[1].path,'utf8'));
    Object.assign(forged.checks[0],{counts:{passed:1,failed:0,skipped:0,total:1},exit:0,decision:'supported',failureCount:0,failures:[],firstActionableFailure:null});
    writeFileSync(state.evidence[1].path,JSON.stringify(forged));state.evidence[1]=ref(state.evidence[1].path);
    const forgedResult=verify(packet());expect(forgedResult.decision).toBe('contradictory');
    expect(forgedResult.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['raw-test-results','command-exit','failed-check']));
    const omitted=structuredClone(state);omitted.evidence=omitted.evidence.slice(0,1);omitted.requiredChecks=omitted.requiredChecks.slice(0,1);
    expect(verify(packet(omitted)).issues.map(i=>i.code)).toContain('evidence-mismatch');
    const missing=structuredClone(omitted);missing.requiredChecks=state.requiredChecks;
    expect(verify(packet(omitted),missing).issues.map(i=>i.code)).toContain('missing-required-check');
  });
  it('rejects forged deltas and expands only new/changed evidence for a consistent unchanged packet',()=>{
    const first=packet(),initial=verify(first);expect(initial.decision).toBe('ready-for-independent-review');
    const next=packet(state,first),unchanged=verify(next,state,first);
    expect(unchanged.issues).toEqual([]);expect(unchanged.expand).toEqual({files:[],diff:null,evidence:[],risks:[],contradictions:[]});
    expect(unchanged.unchangedEvidence).toBe(1);expect(unchanged.observations[0].observedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(Buffer.byteLength(JSON.stringify(unchanged.expand))).toBeLessThan(Buffer.byteLength(JSON.stringify(initial.expand)));
    expect(unchanged.authority).toContain('root-only');expect(unchanged.freshness).toContain('cannot be inferred');
    next.deltaSinceLastReview.files=['omitted-path'];expect(verify(next,state,first).decision).toBe('contradictory');
  });
  it('keeps an unchanged clean scope consistent and expands all evidence when the prior review is unavailable',()=>{
    state.scope=[];writeFileSync(state.diff.path,'');state.diff=ref(state.diff.path);
    const first=packet(),next=packet(state,first),result=verify(next,state,first);
    expect(result.decision).toBe('ready-for-independent-review');expect(result.unchangedEvidence).toBe(1);expect(result.expand.files).toEqual([]);
    const unavailable=verify(next);expect(unavailable.decision).toBe('needs-evidence');expect(unavailable.expand.evidence).toHaveLength(1);
  });
  it('keeps unavailable artifacts, unsupported tests and cached remote status uncertain',()=>{
    const p=packet();rmSync(state.evidence[0].path);expect(verify(p).decision).toBe('needs-evidence');
    const unknown=join(root,'unknown.log');writeFileSync(unknown,'unrecognized success');
    const ingested=ingestEvidence([{path:unknown,command:'npm test',cwd:root,exit:0}],{storageRoot:join(root,'captures'),authorizeRead:authorize,index:()=>({sourceId:1}),source:{kind:'local',repository:root}});
    state.evidence=[ref(join(root,'captures',ingested.id,'report.json'))];expect(verify(packet()).decision).toBe('needs-evidence');
    state.evidence=[report()];const remote=JSON.parse(readFileSync(state.evidence[0].path,'utf8'));remote.source={kind:'github',headSha:state.candidate.sha};remote.verification.remoteFreshness='needs-refresh';
    writeFileSync(state.evidence[0].path,JSON.stringify(remote));state.evidence[0]=ref(state.evidence[0].path);
    expect(verify(packet()).issues.map(i=>i.code)).toContain('remote-freshness');
    const anonymous=ingestEvidence([{path:join(root,'pass.json'),exit:0}],{storageRoot:join(root,'captures'),authorizeRead:authorize,index:()=>({sourceId:1}),source:{kind:'local',repository:root}});
    state.evidence=[ref(join(root,'captures',anonymous.id,'report.json'))];expect(verify(packet()).decision).toBe('needs-evidence');
  });
  it('compares independently selected CI attempt/head/jobs instead of treating a local digest as remote identity',()=>{
    const remote=JSON.parse(readFileSync(state.evidence[0].path,'utf8'));
    remote.source={kind:'github',host:'github.com',repository:'owner/repo',run:10,attempt:1,job:20,headSha:state.candidate.sha};
    remote.verification.remoteFreshness='retrieved observation; not continuously polled';
    writeFileSync(state.evidence[0].path,JSON.stringify(remote));state.evidence[0]=ref(state.evidence[0].path);
    state.ci=[{report:0,host:'github.com',repository:'owner/repo',run:10,attempt:2,headSha:state.candidate.sha,jobs:[20]}];
    expect(verify(packet()).issues.map(i=>i.code)).toContain('ci-identity');
    state.ci[0].attempt=1;expect(verify(packet()).decision).toBe('ready-for-independent-review');
    state.ci[0].jobs=[21];expect(verify(packet()).decision).toBe('contradictory');
  });
  it('does not certify witness freshness or accept forged predecessor data as review authority',()=>{
    const p=packet(),previous=structuredClone(p);previous.risks=[];
    const next=packet(state,previous),result=verify(next,state,previous);
    expect(result.decision).toBe('ready-for-independent-review');expect(result.authority).toContain('fresh independent Git/check/CI observations');
    expect(result).not.toHaveProperty('accepted');expect(result).not.toHaveProperty('reviewStatus');
  });
});

describe('native bounded review helper',()=>{
  const save=(name:string,value:unknown)=>{const path=join(root,name),body=JSON.stringify(value);writeFileSync(path,body);return {path,sha256:digest(body)};};
  const run=(args:string[])=>spawnSync(process.execPath,[join(plugin,'node_modules/tsx/dist/cli.mjs'),join(plugin,'scripts/review-evidence.ts'),...args],{cwd:plugin,encoding:'utf8'});
  it('prepares and independently compares digest-bound files with a bounded summary and complete result artifact',()=>{
    const current=save('current.json',state),output=join(root,'packet.json');
    const prepared=run(['prepare','--workspace',root,'--current',current.path,'--current-sha256',current.sha256,'--milestone','L3.4','--output',output]);
    expect(prepared.status,prepared.stderr).toBe(0);expect(Buffer.byteLength(prepared.stdout)).toBeLessThanOrEqual(2048);
    const child=ref(output),resultPath=join(root,'review.json');
    const result=run(['verify','--workspace',root,'--current',current.path,'--current-sha256',current.sha256,'--packet',child.path,'--packet-sha256',child.sha256,'--output',resultPath]);
    expect(result.status,result.stderr).toBe(0);expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(2048);
    const summary=JSON.parse(result.stdout);expect(summary.decision).toBe('ready-for-independent-review');expect(summary.authority).toBe('root acceptance required');
    expect(digest(readFileSync(resultPath))).toBe(summary.reference.sha256);
    const forged=run(['verify','--workspace',root,'--current',current.path,'--current-sha256',current.sha256,'--packet',child.path,'--packet-sha256','0'.repeat(64),'--output',join(root,'forged.json')]);
    expect(forged.status).toBe(2);expect(JSON.parse(forged.stdout).decision).toBe('needs-evidence');
  });
  it('honors native Read denies and never publishes a result as acceptance',()=>{
    const current=save('current.json',state),child=save('packet.json',packet());mkdirSync(join(root,'.claude'));
    writeFileSync(join(root,'.claude/settings.json'),JSON.stringify({permissions:{deny:['Read(a.ts)']}}));
    const result=run(['verify','--workspace',root,'--current',current.path,'--current-sha256',current.sha256,'--packet',child.path,'--packet-sha256',child.sha256,'--output',join(root,'denied-review.json')]);
    expect(result.status).toBe(1);expect(JSON.parse(result.stdout).decision).toBe('needs-evidence');
  });
});
