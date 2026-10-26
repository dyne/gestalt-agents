/** Offline workflow replay. Persist metrics only; all evidence is synthetic and temporary. */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { captureGitHub, digest } from '../../src/evidence/github.js';
import { evidenceFollowup, ingestEvidence, ingestGitHubCapture, type IngestOptions } from '../../src/evidence/extract.js';
import { EVIDENCE_DESCRIPTION } from '../../src/evidence/tool.js';
import { ContentStore } from '../../src/store.js';
import { runComposedHarmony } from './composed-harmony.js';

const specification = resolve(import.meta.dirname, '../../../../tests/plugins/gestalt/fixtures/context-evidence-workflows.json');
const bytes = (text:string) => Buffer.byteLength(text);
const sha = '1'.repeat(40);
const fakeGh = `#!${process.execPath}
const fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2),endpoint=a.at(-1);
const root=p.dirname(process.argv[1]),state=JSON.parse(fs.readFileSync(p.join(root,'state.json'),'utf8'));
fs.appendFileSync(p.join(root,'calls.jsonl'),JSON.stringify(a)+'\\n');
if(a[0]==='auth')console.log('authenticated synthetic account');
else if(endpoint.includes('/jobs?'))console.log(JSON.stringify({total_count:1,jobs:[{id:20,run_id:101,run_attempt:state.attempt,head_sha:state.sha}]}));
else if(endpoint.includes('/attempts/'))console.log(JSON.stringify({id:101,run_attempt:state.attempt,head_sha:state.sha,repository:{full_name:'synthetic/project'},updated_at:'2026-10-19T00:00:00Z',status:'completed'}));
else if(endpoint.endsWith('/logs'))process.stdout.write(fs.readFileSync(p.join(root,'ci.log')));
else process.exit(9);
`;
interface Workflow { id:string; exitCode:number; expectedFailures:string[]; complete:boolean }
interface Fixture { cases:Workflow[]; padding:{lines:number;template:string}; repeatedQuery:{questions:string[];source:{attempt:number};expectedFailureIds:string[]} }
export interface PathMetrics {
  rawEvidenceBytes:number; capturedBytes:number; downloadedBytes:number;
  returnedBytes:number; initialReturnedBytes:number; requestBytes:number; descriptionBytes:number; totalVisibleBytes:number;
  fetches:number; ghCalls:number; indexes:number; retrievalCalls:number; missingFindings:string[]; missingReferences:number;
  diagnosticMs:number;
}
export interface CaseMetrics { caseId:string; sessionId:string; sourceSha256:string; sourceFormat:string; expectedFindings:number; certainty:string; baseline:PathMetrics; bounded:PathMetrics; initialReduction:number }
const empty=():PathMetrics=>({rawEvidenceBytes:0,capturedBytes:0,downloadedBytes:0,returnedBytes:0,initialReturnedBytes:0,requestBytes:0,descriptionBytes:0,totalVisibleBytes:0,fetches:0,ghCalls:0,indexes:0,retrievalCalls:0,missingFindings:[],missingReferences:0,diagnosticMs:0});
function render(f:Workflow, fixture:Fixture):string {
  const padding=Array.from({length:fixture.padding.lines},(_,i)=>fixture.padding.template.replace('{index:04d}',String(i+1).padStart(4,'0')));
  if(f.id==='unknown')return [...padding,'opaque-result: synthetic-unrecognized-record'].join('\n');
  if(f.id==='setup-failure')return JSON.stringify({numTotalTests:0,numPassedTests:0,numFailedTests:0,numPendingTests:0,numFailedTestSuites:1,padding,testResults:[{name:f.expectedFailures[0],status:'failed',message:'Synthetic dependency unavailable before tests',assertionResults:[]}]},null,2);
  return JSON.stringify({version:1,exitCode:f.exitCode,tests:[...padding.slice(f.expectedFailures.length).map(id=>({id,status:'passed'})),...f.expectedFailures.map(id=>({id,status:'failed',cause:'Synthetic expected value did not match actual value'}))]},null,2);
}
function renderApiLog(f:Workflow,fixture:Fixture):string {
  const lines=['TAP version 13',...Array.from({length:fixture.padding.lines},(_,i)=>`# ${fixture.padding.template.replace('{index:04d}',String(i+1).padStart(4,'0'))}`)];
  for(const [i,id] of f.expectedFailures.entries())lines.push(`not ok ${i+1} - ${id}`,'  cause: Synthetic expected value did not match actual value');
  lines.push(`1..${f.expectedFailures.length}`);
  return lines.map(line=>`2026-10-19T00:00:00.1234567Z ${line}`).join('\n');
}
function validateReference(path:string,sha256:string):boolean {
  try {return digest(readFileSync(path))===sha256;}catch{return false;}
}

/** Replays the L1 sanitized corpus and repeated-run/rerun identities through both paths. */
export async function runEvidenceBenchmark() {
  // Exercise the same cross-tool boundaries in executable overhead replays.
  const composedHarmony = runComposedHarmony();
  const fixtureBytes=readFileSync(specification),fixture=JSON.parse(fixtureBytes.toString()) as Fixture;
  const root=realpathSync(mkdtempSync(join(tmpdir(),'evidence-efficiency-'))),previousPath=process.env.PATH;
  const cases:CaseMetrics[]=[];
  try {
    const bin=join(root,'bin');mkdirSync(bin);writeFileSync(join(bin,'gh'),fakeGh);chmodSync(join(bin,'gh'),0o755);
    process.env.PATH=`${bin}:${previousPath??''}`;
    for(const id of ['passing','failing','setup-failure','repeated-ci','rerun','unknown']) {
      const template=fixture.cases.find(f=>f.id===(id==='repeated-ci'||id==='rerun'?'failing':id))!;
      const remote=id==='repeated-ci'||id==='rerun';
      const text=remote?renderApiLog(template,fixture):render(template,fixture),expected=template.expectedFailures;
      const local=join(root,`${id}.log`);writeFileSync(local,text);writeFileSync(join(bin,'ci.log'),text);
      const sessionId=`sanitized-benchmark:${id}`,result:CaseMetrics={caseId:id,sessionId,sourceSha256:digest(text),sourceFormat:remote?'github-api-tap':id==='unknown'?'opaque-text':id==='setup-failure'?'jest-setup-json':'normalized-test-json',expectedFindings:expected.length+(id==='unknown'?1:0),certainty:template.complete?'known':'unknown',baseline:empty(),bounded:empty(),initialReduction:0};
      const iterations=id==='repeated-ci'?fixture.repeatedQuery.questions.length:id==='rerun'?2:1;
      for(const path of ['baseline','bounded'] as const) {
        const metric=result[path],store=new ContentStore(join(root,`${id}-${path}.db`));
        const start=performance.now();
        // Baseline adds no new description to existing raw-tool workflows: conservative overhead comparison.
        metric.descriptionBytes=path==='bounded'?bytes(EVIDENCE_DESCRIPTION):0;
        const index:IngestOptions['index']=(content,source)=>{metric.indexes++;return store.indexPlainText(content,source,undefined,{sessionId});};
        const options:IngestOptions={storageRoot:join(root,`${id}-${path}`),authorizeRead:p=>resolve(p).startsWith(root+'/'),index,indexExists:source=>store.getSourceMeta(source)!==null,indexScope:sessionId,source:{kind:'local',repository:'sanitized-workspace'},candidate:{sha},milestone:'benchmark'};
        try {
          for(let i=0;i<iterations;i++) {
            const attempt=id==='rerun'?i+1:fixture.repeatedQuery.source.attempt;
            writeFileSync(join(bin,'state.json'),JSON.stringify({attempt,sha:id==='rerun'&&i===1?'2'.repeat(40):sha}));
            let captured:Awaited<ReturnType<typeof captureGitHub>>|undefined;
            let input=local;
            if(remote) {
              const before=readCalls(bin).length;
              captured=await captureGitHub({host:'github.example.invalid',repository:'synthetic/project',run:101,attempt,refresh:path==='baseline'}, {storageRoot:options.storageRoot,timeoutMs:5000});
              const calls=readCalls(bin).slice(before);metric.ghCalls+=calls.length;metric.fetches+=calls.filter(a=>a.at(-1)?.endsWith('/logs')).length;
              if(captured.completeness!=='complete'||!captured.manifest)throw new Error(`capture incomplete: ${id}`);
              const manifest=JSON.parse(readFileSync(captured.manifest.path,'utf8'));
              input=manifest.entries.find((e:any)=>e.kind==='logs-20').reference.path;
              if(calls.length)metric.downloadedBytes+=manifest.entries.reduce((n:number,e:any)=>n+(e.reference?.bytes??0),0);
            }
            metric.rawEvidenceBytes+=bytes(text);metric.capturedBytes+=bytes(readFileSync(input,'utf8'));
            const request=remote?{operation:'github',github:{host:'github.example.invalid',repository:'synthetic/project',run:101,attempt,...(path==='baseline'?{refresh:true}:{})}}:{operation:'local',files:[{path:'sanitized.log',exit:template.exitCode,completeness:template.complete?'complete':'unknown'}]};
            metric.requestBytes+=bytes(JSON.stringify(request));
            if(path==='baseline') {
              index(text,`baseline:${id}:${i}`);metric.returnedBytes+=bytes(text);
              if(i===0)metric.initialReturnedBytes=bytes(text);
              for(const finding of expected)if(!text.includes(finding))metric.missingFindings.push(finding);
              if(id==='unknown'&&!text.includes('synthetic-unrecognized-record'))metric.missingFindings.push('synthetic-unrecognized-record');
              continue;
            }
            const ingested=captured?ingestGitHubCapture(captured,options):ingestEvidence([{path:input,exit:template.exitCode,completeness:template.complete?'complete':'unknown'}],options);
            metric.returnedBytes+=bytes(ingested.routine);if(i===0)metric.initialReturnedBytes=bytes(ingested.routine);
            // Retrieve every report through the actual bounded API: no uncounted report-file reads for diagnosis.
            let offset:number|null=0,reportText='';
            while(offset!==null) {
              const args={operation:'followup',report:ingested.id,offset,maxBytes:2048};
              const page=evidenceFollowup(options.storageRoot,ingested.id,offset,2048);
              if(bytes(page)>2048)throw new Error('unbounded followup');
              metric.retrievalCalls++;metric.requestBytes+=bytes(JSON.stringify(args));metric.returnedBytes+=bytes(page);
              const parsed=JSON.parse(page);reportText+=parsed.data;offset=parsed.nextOffset;
            }
            const report=JSON.parse(reportText),check=report.checks[0];
            if(check.certainty!==result.certainty)throw new Error(`certainty regression: ${id}`);
            if(remote)for(const finding of check.failures) {
              const line=Number(finding.locator.match(/^lines:(\d+)-\d+$/)?.[1]);
              if(!line||!text.split('\n')[line-1]?.includes(finding.id.replace(/^TAP:\d+ /,''))||finding.time!=='2026-10-19T00:00:00.1234567Z')throw new Error(`raw API location regression: ${id}`);
            }
            for(const finding of expected)if(!check.failures.some((f:any)=>f.id.includes(finding)))metric.missingFindings.push(finding);
            for(const c of report.checks)for(const ref of c.references??[])if(!validateReference(ref.path,ref.sha256))metric.missingReferences++;
            if(!report.checks.some((c:any)=>c.references?.length))metric.missingReferences++;
            // Unknown formats must be searchable and remain explicitly uncertain.
            if(id==='unknown') {
              const query='synthetic-unrecognized-record';
              const matches=store.search(query,3,check.index.source,'AND',undefined,'exact');
              const match=matches.find(m=>m.content.includes(query));
              const location=match?.content.indexOf(query)??-1;
              const focused=JSON.stringify({source:check.index.source,title:match?.title??null,excerpt:match?.content.slice(Math.max(0,location-80),location+query.length+80)??'',uncertainty:check.certainty});
              if(bytes(focused)>2048)throw new Error('unbounded search');
              metric.retrievalCalls++;metric.requestBytes+=bytes(JSON.stringify({query,source:check.index.source}));metric.returnedBytes+=bytes(focused);
              if(!match)metric.missingFindings.push('synthetic-unrecognized-record');
              if(report.decision!=='failed'||check.certainty!=='unknown')throw new Error('unknown source incorrectly certified');
            }
          }
          metric.diagnosticMs=+(performance.now()-start).toFixed(3);
          metric.totalVisibleBytes=metric.returnedBytes+metric.descriptionBytes+metric.requestBytes;
        } finally {store.close();}
      }
      result.initialReduction=1-result.bounded.initialReturnedBytes/result.baseline.initialReturnedBytes;
      cases.push(result);
    }
    const repeated=cases.find(c=>c.caseId==='repeated-ci')!,rerun=cases.find(c=>c.caseId==='rerun')!;
    const criteria={
      composedBoundaries:composedHarmony.cases.length===9,
      allFindingsPreserved:cases.every(c=>!c.baseline.missingFindings.length&&!c.bounded.missingFindings.length),
      allReferencesVerified:cases.every(c=>c.bounded.missingReferences===0),
      largeInitialPayloadReduction:cases.every(c=>c.baseline.initialReturnedBytes<=20*1024||c.initialReduction>=0.8),
      boundedInitialResponses:cases.every(c=>c.bounded.initialReturnedBytes<=2048),
      unchangedTerminalReuse:repeated.bounded.fetches===1&&repeated.bounded.indexes===1&&repeated.bounded.ghCalls===4,
      rerunInvalidation:rerun.bounded.fetches===2&&rerun.bounded.indexes===2,
    };
    return {schemaVersion:1,criteria,composedHarmony,renderer:'version 1: L1 padding/expected IDs rendered as normalized test JSON, Jest setup JSON or opaque text; each pair uses identical bytes',fixtureSha256:digest(fixtureBytes),provenance:'Synthetic L1 corpus, identical source bytes in each replay. Baseline is an uncached raw workflow, not a historical binary or private session. No prompts, runtime records or model outputs retained.',units:'UTF-8 bytes; local mechanical diagnostic retrieval milliseconds measured without timing assertions or model calls',overhead:'Actual added evidence-tool description once per workflow; baseline adds zero description bytes to existing tools. Request and followup bytes included; MCP transport framing excluded equally.',counts:'fetches = log downloads; ghCalls includes auth/metadata; capturedBytes = source bytes per ingestion; downloadedBytes includes captured gh metadata',tokenizer:'not measured; no token estimates or API cache counters',cases};
  } finally {if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;rmSync(root,{recursive:true,force:true});}
}
function readCalls(bin:string):string[][] {try{return readFileSync(join(bin,'calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{return [];}}
