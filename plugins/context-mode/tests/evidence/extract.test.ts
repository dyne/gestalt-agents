import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { evidenceFollowup, extractTests, ingestEvidence, ingestGitHubCapture, ingestSharedManifest, type IngestOptions } from '../../src/evidence/extract.js';
import { digest, reference } from '../../src/evidence/github.js';

let root:string;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'evidence-extract-'));});
afterEach(()=>{vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});
const json=(tests:any[],extra:any={})=>JSON.stringify({version:1,tests,...extra});
const file=(text:string,name='input.log')=>{const path=join(root,name);writeFileSync(path,text);return path;};
const opts=(override:Partial<IngestOptions>={}):IngestOptions=>({storageRoot:join(root,'evidence'),authorizeRead:p=>resolve(p).startsWith(root+sep),index:(_text,source)=>({sourceId:source}),source:{kind:'local',repository:root,run:null,attempt:null,job:null,identityReason:'local command capture'},milestone:'L3.2 evidence-extraction',...override});

describe('deterministic format adapters',()=>{
  it('extracts versioned JSON counts, failures, multiline causes, Unicode and step/time',()=>{
    const r=extractTests(json([{id:'pass',status:'passed'},{id:'失敗 ☃',status:'failed',cause:'expected true\nreceived false\ncontext',step:'unit',time:'2026-10-18T00:00:00Z'},{id:'skip',status:'skipped'}],{exitCode:1}));
    expect(r.counts).toEqual({passed:1,failed:1,skipped:1,total:3});expect(r.exit).toBe(1);
    expect(r.failures[0]).toMatchObject({id:'失敗 ☃',cause:'expected true\nreceived false\ncontext',step:'unit',time:'2026-10-18T00:00:00Z'});
  });
  it('reads Jest/Vitest JSON reporter assertion records',()=>{
    const r=extractTests(JSON.stringify({numTotalTests:2,numPassedTests:1,numFailedTests:1,numPendingTests:0,testResults:[{name:'a.test.ts',assertionResults:[{title:'works',status:'passed'},{title:'breaks',fullName:'suite breaks',status:'failed',failureMessages:['expected 2','received 1']}]}]}));
    expect(r.format).toBe('test-json');expect(r.certainty).toBe('known');expect(r.exit).toBeNull();expect(r.failures[0].cause).toBe('expected 2\nreceived 1');
  });
  it('retains a suite setup failure before any tests',()=>{
    const r=extractTests(JSON.stringify({numTotalTests:0,numPassedTests:0,numFailedTests:0,numPendingTests:0,numFailedTestSuites:1,testResults:[{name:'setup.ts',status:'failed',message:'Cannot import missing module\nimport context',assertionResults:[]}]}));
    expect(r.counts?.total).toBe(0);expect(r.failures[0].id).toBe('setup.ts::setup');expect(r.failures[0].cause).toContain('import context');
  });
  it('marks contradictory JSON totals as uncertain without discarding failures',()=>{
    const r=extractTests(JSON.stringify({numTotalTests:20,numPassedTests:0,numFailedTests:1,numPendingTests:0,testResults:[{name:'a',assertionResults:[{title:'bad',status:'failed',failureMessages:['cause']}]}]}));
    expect(r.certainty).toBe('unknown');expect(r.failures).toHaveLength(1);expect(r.reason).toContain('contradictory');
  });
  it.each(['{"version":1,broken','{"error":"everything exploded"}','[1,2,3]'])('does not infer tests from malformed/unsupported JSON %s',text=>{
    const r=extractTests(text);expect(r.certainty).toBe('unknown');expect(r.counts).toBeNull();
  });
  it('reads JUnit test cases, errors, skips and contextual causes',()=>{
    const r=extractTests(`<?xml version="1.0"?><testsuite name="suite" tests="3" failures="0" errors="1" skipped="1"><testcase name="pass"/><testcase classname="domain" name="broken" time="0.2"><error message="bad &amp; worse"><![CDATA[line 1\nline 2 <context>]]></error></testcase><testcase name="skip"><skipped/></testcase></testsuite>`);
    expect(r.certainty).toBe('known');expect(r.counts).toEqual({passed:1,failed:1,skipped:1,total:3});
    expect(r.failures[0]).toMatchObject({id:'domain::broken',cause:'bad & worse\nline 1\nline 2 <context>',time:'0.2'});
  });
  it.each(['<testsuite><testcase name="x"></testsuite>','<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuite/>','<testsuite tests="2"><testcase name="a"/></testsuite>'])('retains XML uncertainty %s',text=>expect(extractTests(text).certainty).toBe('unknown'));
  it.each(['tests="2"','tests="1" failures="1"','tests="1" errors="1"','tests="1" skipped="1"'])('rejects nested JUnit counter contradictions even with exit zero: %s',attrs=>{
    const text=`<testsuites><testsuite name="partial" ${attrs}><testcase name="passing"/></testsuite></testsuites>`;
    const r=ingestEvidence([{path:file(text),exit:0}],opts());
    expect(r.report.decision).toBe('contradictory');expect(r.report.checks[0].certainty).toBe('unknown');
    expect(r.report.checks[0].counts).toEqual({passed:1,failed:0,skipped:0,total:1});
  });
  it('validates sibling and nested JUnit scopes without mixing their counts or dropping failures',()=>{
    const text='<testsuites tests="3" failures="1" skipped="1"><testsuite tests="1" failures="0"><testcase name="pass"/></testsuite><testsuite tests="2" failures="1" skipped="1"><testsuite tests="1" failures="1"><testcase name="bad"><failure>cause</failure></testcase></testsuite><testcase name="skip"><skipped/></testcase></testsuite></testsuites>';
    expect(extractTests(text)).toMatchObject({certainty:'known',counts:{passed:1,failed:1,skipped:1,total:3}});
    const contradictory=extractTests(text.replace('<testsuite tests="1" failures="1">','<testsuite tests="2" failures="1">'));
    expect(contradictory.certainty).toBe('unknown');expect(contradictory.failures[0]).toMatchObject({id:'bad',cause:'cause'});
  });
  it('retains multiple TAP failures and diagnostics',()=>{
    const r=extractTests('TAP version 13\nnot ok 1 - first\n  ---\n  message: line one\n    line two\n  ...\nnot ok 2 - second\n cause two\nok 3 - skipped # SKIP reason\n1..3\n');
    expect(r.counts).toEqual({passed:0,failed:2,skipped:1,total:3});expect(r.certainty).toBe('known');expect(r.failures.map(f=>f.id)).toEqual(['TAP:1 first','TAP:2 second']);expect(r.failures[0].cause).toContain('line two');
  });
  it('does not mistake error keywords in passing or unrecognized logs for failures',()=>{
    expect(extractTests('TAP version 13\nok 1 - error handling works\n1..1').failures).toHaveLength(0);
    expect(extractTests('Error retries: 0; failed request is expected; successful run').certainty).toBe('unknown');
  });
  it('treats incomplete TAP and bailout coverage as uncertain',()=>{
    expect(extractTests('TAP version 13\nok 1 - pass\n1..2').certainty).toBe('unknown');
    const b=extractTests('TAP version 13\nBail out! dependency missing');expect(b.certainty).toBe('unknown');expect(b.failures[0].id).toBe('TAP::bailout');
  });
  it('extracts Vitest summaries, failure identifiers and GitHub step/time',()=>{
    const r=extractTests('job\tunit tests\t2026-10-18T01:02:03Z FAIL file.test.ts > handles Unicode\njob\tunit tests\t2026-10-18T01:02:04Z expected true\njob\tunit tests\t2026-10-18T01:02:05Z received false\njob\tunit tests\t2026-10-18T01:02:06Z Tests 1 failed | 2 passed (3)');
    expect(r.format).toBe('vitest');expect(r.certainty).toBe('known');expect(r.failures[0]).toMatchObject({id:'file.test.ts > handles Unicode',step:'unit tests',time:'2026-10-18T01:02:03Z'});expect(r.failures[0].cause).toContain('received false');
  });
  it('does not claim complete diagnosis when failure records are missing',()=>expect(extractTests('Tests 2 failed | 1 passed (3)').certainty).toBe('unknown'));
  it.each([
    ['tap','TAP version 13\nnot ok 1 - broken\n  cause: expected true\n1..1','TAP:1 broken','lines:2-3'],
    ['vitest','FAIL file.test.ts > broken\n  expected true\nTests 1 failed (1)','file.test.ts > broken','lines:1-3'],
    ['pytest','FAILED test_unit.py::test_one - AssertionError: wrong value\n=== 1 failed in 0.1s ===','test_unit.py::test_one','lines:1-1'],
  ])('extracts raw GitHub API %s logs with original line locations and timestamps',(format,body,id,locator)=>{
    const timestamp='2026-10-18T01:02:03.1234567Z';
    const raw=body.split('\n').map(line=>`${timestamp} ${line}`).join('\n');
    const r=extractTests(raw);
    expect(r).toMatchObject({format,certainty:'known',counts:{failed:1,total:1}});
    expect(r.failures[0]).toMatchObject({id,locator,time:timestamp,step:null});
    expect(r.failures[0].cause).not.toContain(timestamp);
    if(format==='tap')expect(r.failures[0].cause).toContain('\n  cause: expected true');
    const start=Number(locator.split(':')[1].split('-')[0]);
    expect(raw.split('\n')[start-1]).toContain(id.replace(/^TAP:1 /,'not ok 1 - '));
  });
  it('rejects counters outside safe integer bounds',()=>expect(extractTests(`Tests ${'9'.repeat(1000)} passed (${'9'.repeat(1000)})`).counts).toBeNull());
  it('extracts pytest failure IDs without guessing from keywords',()=>{
    const r=extractTests('FAILED test_unit.py::test_one - AssertionError: wrong value\n=== 1 failed, 2 passed in 0.1s ===');expect(r.format).toBe('pytest');expect(r.certainty).toBe('known');expect(r.failures[0].id).toBe('test_unit.py::test_one');
  });
});

describe('authorized capture and bounded reporting',()=>{
  it('preserves exact source digests, counts, command exit and retrievable index references',()=>{
    const raw=json([{id:'works',status:'passed'}]),path=file(raw),seen:string[]=[];
    const r=ingestEvidence([{path,command:'npm test',exit:0}],opts({index:(text,source)=>{seen.push(text,source);return {sourceId:42};}}));
    const c=r.report.checks[0];expect(c.decision).toBe('supported');expect(c.exit).toBe(0);expect(c.index.sourceId).toBe(42);expect(seen[0]).toBe(raw);
    expect(readFileSync(c.references[0].path,'utf8')).toBe(raw);expect(c.references[0].sha256).toBe(digest(raw));expect(Buffer.byteLength(r.routine)).toBeLessThanOrEqual(2048);
  });
  it('indexes unknown formats and retains uncertainty despite exit zero',()=>{
    const r=ingestEvidence([{path:file('success Error ignored'),exit:0}],opts());const c=r.report.checks[0];expect(c.counts).toBeNull();expect(c.decision).toBe('needs-evidence');expect(c.index.sourceId).toBeDefined();
  });
  it('keeps missing exit status explicit and all-skipped results distinct from passing',()=>{
    const a=ingestEvidence([{path:file(json([{id:'pass',status:'passed'}]))}],opts());expect(a.report.checks[0].exit).toBeNull();expect(a.report.checks[0].decision).toBe('needs-evidence');
    const b=ingestEvidence([{path:file(json([{id:'skip',status:'skipped'}])),exit:0}],opts());expect(b.report.checks[0].counts.skipped).toBe(1);expect(b.report.checks[0].decision).toBe('needs-evidence');
  });
  it.each([[0,1],[1,0]])('retains contradictory supplied %i and embedded %i exits without a success claim',(supplied,embedded)=>{
    const r=ingestEvidence([{path:file(json([{id:'pass',status:'passed'}],{exitCode:embedded})),exit:supplied}],opts());
    const c=r.report.checks[0];expect(r.report.decision).toBe('contradictory');expect(c.decision).toBe('contradictory');expect(c.certainty).toBe('unknown');expect(c.exit).toBeNull();
    expect(c.suppliedExit).toBe(supplied);expect(c.embeddedExit).toBe(embedded);expect(c.exitConflict).toMatchObject({supplied,embedded,locator:'JSON:exitCode'});
    expect(c.reason).toContain('contradictory');expect(JSON.parse(readFileSync(c.exitConflict.reference.path,'utf8')).exitCode).toBe(embedded);
    expect(JSON.parse(r.routine).decision).toBe('contradictory');expect(Buffer.byteLength(r.routine)).toBeLessThanOrEqual(2048);
  });
  it('retains every known failure and its source in an exit contradiction',()=>{
    const tests=[{id:'first',status:'failed',cause:'multiline\nfirst cause'},{id:'second',status:'failed',cause:'second cause'}];
    const r=ingestEvidence([{path:file(json(tests,{exitCode:1})),exit:0}],opts());const c=r.report.checks[0];
    expect(r.report.decision).toBe('contradictory');expect(c.counts.failed).toBe(2);expect(c.failures.map((f:any)=>f.id)).toEqual(['first','second']);expect(c.failures[0].cause).toContain('first cause');
    expect(JSON.parse(readFileSync(c.references[0].path,'utf8')).tests).toEqual(tests);
  });
  it('keeps supplied-only, embedded-only and absent exits explicit',()=>{
    const cases=[{embedded:undefined,supplied:0,exit:0},{embedded:0,supplied:undefined,exit:0},{embedded:undefined,supplied:undefined,exit:null}];
    for(const test of cases){const r=ingestEvidence([{path:file(json([{id:'pass',status:'passed'}],test.embedded===undefined?{}:{exitCode:test.embedded})),...(test.supplied===undefined?{}:{exit:test.supplied})}],opts());
      const c=r.report.checks[0];expect(c.exit).toBe(test.exit);expect(c.suppliedExit).toBe(test.supplied??null);expect(c.embeddedExit).toBe(test.embedded??null);expect(c.exitConflict).toBeNull();expect(c.decision).toBe(test.exit===null?'needs-evidence':'supported');}
  });
  it('records nonzero command failure without inventing test counts',()=>{
    const r=ingestEvidence([{path:file('Cannot find compiler\ncontext'),command:'npm test',exit:127}],opts());const c=r.report.checks[0];expect(c.decision).toBe('failed');expect(c.counts).toBeNull();expect(c.firstActionableFailure.id).toBe('command::exit');
  });
  it('retains partial capture and changed digest even when parsed tests pass',()=>{
    const path=file(json([{id:'pass',status:'passed'}]));
    for(const entry of [{path,exit:0,completeness:'partial' as const},{path,exit:0,expectedSha256:'0'.repeat(64)}]){const c=ingestEvidence([entry],opts()).report.checks[0];expect(c.completeness).toBe('partial');expect(c.decision).toBe('needs-evidence');}
  });
  it('retains known failures in partial evidence',()=>{
    const r=ingestEvidence([{path:file('TAP version 13\nnot ok 1 - bad\n multiline cause\n1..2'),exit:1,completeness:'partial'}],opts());expect(r.report.checks[0].decision).toBe('failed');expect(r.report.checks[0].failures[0].id).toBe('TAP:1 bad');
  });
  it('reports known summary failures even when failure IDs are unavailable',()=>{
    const r=ingestEvidence([{path:file('Tests 2 failed | 1 passed (3)'),exit:0}],opts());expect(r.report.decision).toBe('failed');expect(r.report.checks[0].failureCount).toBe(2);expect(r.report.checks[0].firstActionableFailure.id).toBe('test-summary::failed');
  });
  it('denies local files before reading/indexing and rechecks symlink targets',()=>{
    const index=vi.fn(()=>({sourceId:1})),path=file('PRIVATE');
    const r=ingestEvidence([{path}],opts({authorizeRead:()=>false,index}));expect(index).not.toHaveBeenCalled();expect(r.routine).not.toContain('PRIVATE');expect(r.report.checks[0].reason).toContain('unauthorized');
    const link=join(root,'link.log');symlinkSync(path,link);
    const a=ingestEvidence([{path:link}],opts({authorizeRead:p=>p===link,index}));expect(index).not.toHaveBeenCalled();expect(a.report.checks[0].completeness).toBe('unknown');
  });
  it('rejects nonregular files and missing files with sanitized uncertainty',()=>{
    const r=ingestEvidence([{path:root},{path:join(root,'missing PRIVATE')}],opts());expect(r.report.checks.every((c:any)=>c.decision==='needs-evidence')).toBe(true);expect(r.routine).not.toContain('PRIVATE');
  });
  it('keeps originals private while redacting credentials from findings and index text',()=>{
    vi.stubEnv('GH_TOKEN','credential-from-host');let indexed='';
    const r=ingestEvidence([{path:file(json([{id:'ghp_PRIVATE_TOKEN',status:'failed',cause:'Bearer abcdefghijkl credential-from-host\ncontext'}])),exit:1}],opts({index:text=>{indexed=text;return {sourceId:1};}}));
    expect(r.routine).not.toMatch(/ghp_PRIVATE_TOKEN|abcdefghijkl|credential-from-host/);expect(indexed).not.toMatch(/ghp_PRIVATE_TOKEN|abcdefghijkl|credential-from-host/);expect(r.report.checks[0].failures[0].cause).toContain('[REDACTED]');
  });
  it('makes every failure discoverable behind explicit overflow without dumping raw logs',()=>{
    const tests=Array.from({length:50},(_,i)=>({id:`failure-${i}☃`,status:'failed',cause:`cause ${i}\ncontext`.repeat(50)})),raw=json(tests);
    const r=ingestEvidence([{path:file(raw),exit:1,command:'npm test'}],opts());
    expect(Buffer.byteLength(r.routine)).toBeLessThanOrEqual(2048);expect(Buffer.byteLength(r.routine)).toBeLessThan(Buffer.byteLength(raw)/5);
    const compact=JSON.parse(r.routine);expect(compact.failureCount).toBe(50);expect(compact.overflow).toBeDefined();expect(r.report.checks[0].failures.map((f:any)=>f.id)).toEqual(tests.map(t=>t.id));
    let offset=0,parts:Buffer[]=[];
    for(let i=0;i<200;i++){
      const chunk=evidenceFollowup(join(root,'evidence'),r.id,offset,2048);expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(2048);
      const page=JSON.parse(chunk);expect(page.encoding).toBe('utf8');parts.push(Buffer.from(page.data,'utf8'));if(page.nextOffset===null)break;offset=page.nextOffset;
    }
    const bytes=Buffer.concat(parts);expect(JSON.parse(bytes.toString()).checks[0].failures).toHaveLength(50);expect(digest(bytes)).toBe(JSON.parse(evidenceFollowup(join(root,'evidence'),r.id)).sha256);
  });
  it('handles a huge single-line unknown artifact and a huge Unicode failure identifier',()=>{
    const a=ingestEvidence([{path:file('unknown '.repeat(200000))}],opts());expect(Buffer.byteLength(a.routine)).toBeLessThanOrEqual(2048);expect(a.report.checks[0].certainty).toBe('unknown');
    const id='☃'.repeat(5000),b=ingestEvidence([{path:file(json([{id,status:'failed',cause:'cause'}]))}],opts());expect(Buffer.byteLength(b.routine)).toBeLessThanOrEqual(2048);expect(b.report.checks[0].failures[0].id).toBe(id);expect(b.report.checks[0].firstActionableFailure.idOmittedBytes).toBeGreaterThan(0);
  });
  it('caps source reads before indexing and reports incomplete coverage',()=>{
    const raw='x'.repeat(8*1024*1024+20),path=file(raw);let indexed=0;
    const r=ingestEvidence([{path,exit:0}],opts({index:text=>{indexed=Buffer.byteLength(text);return {sourceId:1};}}));expect(indexed).toBe(8*1024*1024);expect(r.report.checks[0].completeness).toBe('partial');expect(r.report.checks[0].coverage).toContain('exceeded capture budget');
  });
  it('retains usable raw references when indexing is unavailable',()=>{
    const r=ingestEvidence([{path:file('unknown')}],opts({index:()=>{throw new Error('PRIVATE index error');}}));expect(r.report.checks[0].index.sourceId).toBeNull();expect(r.report.checks[0].references).toHaveLength(1);expect(r.routine).not.toContain('PRIVATE');
  });
  it('keeps a passing run-scoped artifact uncertain for a selected rerun attempt',()=>{
    const body=json([{id:'old-attempt-pass',status:'passed'}],{exitCode:0}),member=file(body,'member.capture');
    const members=JSON.stringify([{name:'results.json',reference:reference(member,body)}]),membersPath=file(members,'members.json');
    const manifest=JSON.stringify({entries:[{kind:'artifact-members',state:'complete',reference:reference(membersPath,members)}]}),manifestPath=file(manifest,'capture.json');
    const o=opts();const {source:_,...common}=o;
    const r=ingestGitHubCapture({version:1,source:'github',selector:{host:'github.com',repository:'owner/repo',run:10,attempt:2,artifact:30},headSha:'a'.repeat(40),completedAt:null,sourceUpdatedAt:null,observedAt:new Date().toISOString(),completeness:'complete',manifest:reference(manifestPath,manifest)},common);
    expect(r.report.checks[0].counts.passed).toBe(1);expect(r.report.checks[0].exit).toBe(0);expect(r.report.checks[0].completeness).toBe('unknown');expect(r.report.decision).toBe('needs-evidence');expect(r.report.source.artifactAttemptBinding).toContain('unknown');
  });
  it('limits followups and refuses path traversal and foreign report IDs',()=>{
    const r=ingestEvidence([{path:file('unknown')}],opts());
    for(const id of ['../input.log','report-../../etc/passwd','/etc/passwd'])expect(()=>evidenceFollowup(join(root,'evidence'),id)).toThrow();
    expect(()=>evidenceFollowup(join(root,'evidence'),r.id,-1)).toThrow();expect(()=>evidenceFollowup(join(root,'evidence'),r.id,0,10000)).toThrow();
    const page=evidenceFollowup(join(root,'evidence'),r.id,0,512);expect(Buffer.byteLength(page)).toBeLessThanOrEqual(512);
  });
});

describe('stable scoped index references',()=>{
  it('reuses canonical source plus digest and resolves failure locators',()=>{
    const path=file('TAP version 13\nnot ok 1 - regression\n cause\n1..1');
    const sources=new Map<string,string>();const index=vi.fn((text:string,source:string)=>{sources.set(source,text);return {sourceId:sources.size};});
    const options=opts({index,indexExists:source=>sources.has(source)});
    const a=ingestEvidence([{path}],options),b=ingestEvidence([{path}],options);
    expect(index).toHaveBeenCalledTimes(1);expect(b.report.checks[0].index.sourceId).toBe(a.report.checks[0].index.sourceId);
    expect(b.report.checks[0].index.reused).toBe(true);expect(b.report.checks[0].failures[0].locator).toBe('lines:2-3');
    expect(sources.get(b.report.checks[0].index.source)).toContain('not ok 1 - regression');
    sources.clear();ingestEvidence([{path}],options);expect(index).toHaveBeenCalledTimes(2);
    writeFileSync(path,'TAP version 13\nok 1 - fixed\n1..1');ingestEvidence([{path}],options);expect(index).toHaveBeenCalledTimes(3);
  });
  it('reindexes an authorized shared capture locally, without sharing session source IDs',()=>{
    const a=ingestEvidence([{path:file('TAP version 13\nok 1 - works\n1..1')}],opts());
    const captured=a.report.checks[0].references[0].path,index=vi.fn(()=>({sourceId:'root-session'}));
    const b=ingestEvidence([{path:captured,expectedSha256:a.report.checks[0].references[0].sha256}],opts({index}));
    expect(index).toHaveBeenCalledTimes(1);expect(b.report.checks[0].index.sourceId).toBe('root-session');
    const denied=ingestEvidence([{path:captured}],opts({authorizeRead:()=>false,index}));
    expect(denied.report.decision).toBe('needs-evidence');expect(index).toHaveBeenCalledTimes(1);
  });
  it('does not let a partial capture establish complete evidence on reuse',()=>{
    const path=file('TAP version 13\nok 1 - works\n1..1'),sources=new Set<string>(),index=vi.fn((_text:string,source:string)=>{sources.add(source);return {sourceId:1};});
    const options=opts({index,indexExists:source=>sources.has(source)});
    const a=ingestEvidence([{path,exit:0,completeness:'partial'}],options);
    const b=ingestEvidence([{path,exit:0,completeness:'complete'}],options);
    expect(a.report.decision).toBe('needs-evidence');expect(b.report.decision).toBe('supported');expect(index).toHaveBeenCalledTimes(1);
  });
});


describe('session scope and durable source labels',()=>{
  it('resolves existing labels after process-local cache loss and isolates sessions',()=>{
    const path=file('TAP version 13\nok 1 - works\n1..1'),sources=new Set<string>();
    const first=vi.fn((_text:string,source:string)=>{sources.add(source);return {sourceId:1};});
    const a=ingestEvidence([{path}],opts({index:first,indexScope:'executor',indexExists:s=>sources.has(s)}));
    const restarted=vi.fn(()=>({sourceId:2}));
    const b=ingestEvidence([{path}],opts({index:restarted,indexScope:'executor',indexExists:s=>sources.has(s)}));
    expect(restarted).not.toHaveBeenCalled();expect(b.report.checks[0].index.sourceId).toBe(a.report.checks[0].index.source);
    ingestEvidence([{path}],opts({index:restarted,indexScope:'root',indexExists:s=>sources.has(s)}));expect(restarted).toHaveBeenCalledTimes(1);
  });
});


describe('authorized manifest transfers',()=>{
  it('does not reflect arbitrary provenance or credential-like identity strings',()=>{
    const a=ingestEvidence([{path:file('TAP version 13\nok 1 - shared\n1..1')}],opts());
    const path=join(root,'evidence',a.id,'report.json'),manifest=JSON.parse(readFileSync(path,'utf8'));
    manifest.source={kind:'local',repository:'ghp_PRIVATE_REPOSITORY',ghp_PRIVATE_KEY:'PRIVATE_BODY'};
    writeFileSync(path,JSON.stringify(manifest));
    const b=ingestSharedManifest(path,digest(readFileSync(path)),opts());
    expect(JSON.stringify(b.report.source)).not.toMatch(/ghp_PRIVATE|PRIVATE_BODY/);
    expect(b.report.source.repository).toBe('[REDACTED]');
  });
  it('verifies the shared manifest digest, reauthorizes sources and reindexes locally',()=>{
    const a=ingestEvidence([{path:file('TAP version 13\nnot ok 1 - shared failure\n1..1')}],opts());
    const path=join(root,'evidence',a.id,'report.json'),sha=digest(readFileSync(path));
    const index=vi.fn(()=>({sourceId:'receiving-session'}));
    const b=ingestSharedManifest(path,sha,opts({index}));
    expect(b.report.checks[0].failures[0].id).toContain('shared failure');expect(index).toHaveBeenCalledTimes(1);
    expect(()=>ingestSharedManifest(path,'0'.repeat(64),opts({index}))).toThrow();
    const denied=ingestSharedManifest(path,sha,opts({index,authorizeRead:p=>p===path}));
    expect(denied.report.decision).toBe('needs-evidence');expect(index).toHaveBeenCalledTimes(1);
    expect(()=>ingestSharedManifest(path,sha,opts({authorizeRead:()=>false}))).toThrow();
  });
});
