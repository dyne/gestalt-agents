/** Paired synthetic fixtures through real evidence adapters; no model/provider calls. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { digest } from '../src/evidence/github.js';
import { evidenceFollowup, extractTests, ingestEvidence, readAuthorized, type IngestOptions } from '../src/evidence/extract.js';
import { evidenceRequestSchema, registerTestEvidence } from '../src/evidence/tool.js';
import { ContentStore } from '../src/store.js';

const size = (value:unknown) => Buffer.byteLength(JSON.stringify(value));
const envelope = (text:string) => ({content:[{type:'text',text}]});
type Finding = {id:string;cause:string;locator:string};
type Facts = {counts:unknown;failures:Finding[];certainty:string;completeness:string;exit:number;marker?:string};
type Answer = Facts & {referenceVerified:boolean;sourceSha256:string};
type Observation = {kind:string;requestBytes:number;responseBytes:number};
export type ControlledPath = {
  sourceSha256:string; sourceBytes:number;deliveredBytes:number;requestBytes:number;responseBytes:number;discoverySchemaBytes:number;
  calls:number;executionCalls:number;followupCalls:number;retries:number;indexes:number;
  truncatedResponses:number;summarizedResponses:number;failedCalls:number;captureCompleteness:string;displayCompleteness:string;evidenceCompleteness:string;
  elapsedMs:number;correct:boolean;missing:string[];observations:Observation[];
};

/** A shorter answer is invalid if any required diagnostic or identity is absent. */
export function checkControlledAnswer(expected:Facts, answer:Answer, sourceSha256:string) {
  const missing:string[]=[];
  if(answer.sourceSha256!==sourceSha256) missing.push('source-sha256');
  if(!answer.referenceVerified) missing.push('source-reference');
  for(const key of ['counts','certainty','completeness','exit','marker'] as const)
    if(JSON.stringify(answer[key])!==JSON.stringify(expected[key])) missing.push(key);
  for(const required of expected.failures) {
    const actual=answer.failures.find(f=>f.id===required.id);
    if(!actual) missing.push(`failure:${required.id}`);
    else for(const key of ['cause','locator'] as const)
      if(actual[key]!==required[key]) missing.push(`${key}:${required.id}`);
  }
  if(answer.failures.length!==expected.failures.length) missing.push('failure-count');
  return {correct:missing.length===0,missing};
}

function toolSchemas() {
  let evidence:any;
  // Capture the real registration schema without starting a server or service.
  registerTestEvidence({registerTool:(name:string,config:any)=>{evidence={name,description:config.description,inputSchema:toJsonSchemaCompat(config.inputSchema)};}} as any,{} as any);
  const native={name:'fixture_read_file',description:'Read an authorized complete UTF-8 file.',
    inputSchema:toJsonSchemaCompat(z.object({path:z.string()}))};
  return {baseline:native,coordinated:evidence};
}

function fixture(id:string) {
  const large=id!=='tiny-pass';
  const fails=['large-fail','partial-fail','repeated-fail','retry-fail'].includes(id);
  const failures:Finding[]=fails?[{id:'synthetic.checkout.rejects-empty-cart',cause:'Expected 422; received 200',locator:'JSON:tests[0]'},
    {id:'synthetic.payment.retries-timeout',cause:'Synthetic gateway timeout',locator:'JSON:tests[1]'}]:[];
  const tests=[...failures.map(f=>({id:f.id,cause:f.cause,status:'failed'})),
    ...Array.from({length:large?1200:1},(_,i)=>({id:`synthetic.pass.${i}`,status:'passed',padding:'deterministic harmless padding '.repeat(3)}))];
  const exit=fails?1:0;
  const marker=id==='unknown'?'synthetic.unrecognized-record':undefined;
  const text=marker?'harmless padding\n'.repeat(1200)+marker:JSON.stringify({version:1,exitCode:exit,tests});
  const facts:Facts={failures,counts:marker?null:{passed:large?1200:1,failed:failures.length,skipped:0,total:tests.length},
    certainty:marker?'unknown':'known',completeness:id==='partial-fail'?'partial':'complete',exit,...(marker?{marker}:{})};
  return {text,facts,iterations:id==='repeated-fail'?3:1,retry:id==='retry-fail'};
}

function runPath(root:string,path:'baseline'|'coordinated',id:string,schema:any) {
  const {text,facts,iterations,retry}=fixture(id),sourceSha256=digest(text);
  const file=join(root,`${id}-${path}.log`);writeFileSync(file,text);
  const store=new ContentStore(join(root,`${id}-${path}.db`));
  const start=performance.now(),observations:Observation[]=[];
  let indexes=0,executionCalls=0,followupCalls=0,retries=0,summarizedResponses=0;
  const record=(kind:string,request:unknown,response:unknown)=>observations.push({kind,requestBytes:size(request),responseBytes:size(response)});
  const options:IngestOptions={storageRoot:join(root,`${id}-${path}`),authorizeRead:p=>p.startsWith(root+'/'),
    source:{kind:'local',repository:'synthetic/controlled'},indexScope:`controlled:${id}:${path}`,
    index:(data,source)=>{indexes++;return store.indexPlainText(data,source);},indexExists:source=>store.getSourceMeta(source)!==null,
    candidate:{sha:'a'.repeat(40),branch:'synthetic/controlled',dirtySha256:digest('candidate'),dependencyConfigSha256:digest('config'),environmentSha256:digest('environment')},
    observedAt:'2026-10-26T00:00:00.000Z'};
  let answer:Answer|undefined;
  try {
    record('discovery',{operation:'discover',query:schema.name},{tools:[{name:schema.name,description:schema.description}]});
    record('schema',{operation:'schema',name:schema.name},{tool:schema});
    for(let iteration=0;iteration<iterations;iteration++) {
      const input={path:file,exit:facts.exit,completeness:facts.completeness as 'complete'|'partial',command:'synthetic-test --all',cwd:root};
      const request={name:schema.name,arguments:path==='baseline'?{path:file}:{operation:'local',files:[input],candidate:options.candidate}};
      if(path==='coordinated') assert.ok(evidenceRequestSchema.safeParse(request.arguments).success);
      // An explicit synthetic transient transport failure. Both paths retry once;
      // the bytes and failed call remain in the comparison, not erased by success.
      if(retry&&iteration===0) {
        record('retry',request,{...envelope('synthetic transport unavailable'),isError:true});
        executionCalls++;retries++;
      }
      executionCalls++;
      if(path==='baseline') {
        const captured=readAuthorized(file,options.authorizeRead),data=captured.data.toString();
        record('read',request,envelope(data));
        const parsed=extractTests(data);
        answer={counts:parsed.counts,failures:parsed.failures,certainty:parsed.certainty,
          completeness:captured.partial?'partial':facts.completeness,exit:facts.exit,
          ...(facts.marker?{marker:data.includes(facts.marker)?facts.marker:''}:{}),
          referenceVerified:digest(readFileSync(file))===sourceSha256,sourceSha256:digest(captured.data)};
      } else {
        const ingested=ingestEvidence([input],options);
        record('ingest',request,envelope(ingested.routine));
        // Routine responses intentionally omit full report detail; follow every
        // byte page until complete, including every required failure and locator.
        summarizedResponses++;
        let offset:number|null=0,body='';
        while(offset!==null) {
          const page=evidenceFollowup(options.storageRoot,ingested.id,offset,2048);
          assert.ok(Buffer.byteLength(page)<=2048);
          record('followup',{name:schema.name,arguments:{operation:'followup',report:ingested.id,offset,maxBytes:2048}},envelope(page));
          const parsed=JSON.parse(page);body+=parsed.data;offset=parsed.nextOffset;followupCalls++;
        }
        const report=JSON.parse(body),check=report.checks[0],ref=check.references[0];
        assert.equal(report.decision,facts.failures.length?'failed':facts.certainty==='unknown'?'needs-evidence':'supported');
        let marker:string|undefined;
        if(facts.marker) {
          const matches=store.search(facts.marker,3,check.index.source,'AND',undefined,'exact');
          record('search',{query:facts.marker,source:check.index.source},{results:matches});followupCalls++;
          marker=matches.some(m=>m.content.includes(facts.marker!))?facts.marker:'';
        }
        answer={counts:check.counts,failures:check.failures,certainty:check.certainty,completeness:check.completeness,
          exit:check.exit,...(marker===undefined?{}:{marker}),referenceVerified:options.authorizeRead(ref.path)&&digest(readFileSync(ref.path))===ref.sha256,
          sourceSha256:ref.sha256};
      }
      const correctness=checkControlledAnswer(facts,answer,sourceSha256);
      assert.ok(correctness.correct,`${id}/${path}: ${correctness.missing.join(',')}`);
    }
    const correctness=checkControlledAnswer(facts,answer!,sourceSha256);
    const requestBytes=observations.reduce((n,o)=>n+o.requestBytes,0),responseBytes=observations.reduce((n,o)=>n+o.responseBytes,0);
    const result:ControlledPath={sourceSha256,sourceBytes:Buffer.byteLength(text),requestBytes,responseBytes,deliveredBytes:requestBytes+responseBytes,
      discoverySchemaBytes:observations.slice(0,2).reduce((n,o)=>n+o.requestBytes+o.responseBytes,0),
      calls:observations.length,executionCalls,followupCalls,retries,indexes,truncatedResponses:0,summarizedResponses,failedCalls:retries,
      captureCompleteness:facts.completeness,displayCompleteness:followupCalls?'complete after followup recovery':'complete',
      evidenceCompleteness:facts.certainty==='unknown'?'unknown':facts.completeness,
      elapsedMs:+(performance.now()-start).toFixed(3),...correctness,observations};
    return {result,answer:answer!,facts};
  } finally {store.close();}
}

export function runControlledEvidenceComparison(repetitions=3) {
  assert.ok(Number.isInteger(repetitions)&&repetitions>0&&repetitions<=10);
  const schemas=toolSchemas(),cases=[];
  let negative:any;
  for(let repetition=1;repetition<=repetitions;repetition++) {
    for(const id of ['tiny-pass','large-pass','large-fail','partial-fail','repeated-fail','retry-fail','unknown']) {
      const root=realpathSync(mkdtempSync(join(tmpdir(),'controlled-evidence-')));
      try {
        const baseline=runPath(root,'baseline',id,schemas.baseline),coordinated=runPath(root,'coordinated',id,schemas.coordinated);
        assert.equal(baseline.result.sourceSha256,coordinated.result.sourceSha256);
        const delta=coordinated.result.deliveredBytes-baseline.result.deliveredBytes;
        cases.push({id,repetition,sourceSha256:baseline.result.sourceSha256,baseline:baseline.result,coordinated:coordinated.result,
          requiredFacts:baseline.facts,answers:{baseline:baseline.answer,coordinated:coordinated.answer},
          byteDelta:delta,byteOutcome:delta<0?'improved':delta>0?'regressed':'equal',
          callDelta:coordinated.result.calls-baseline.result.calls,elapsedDeltaMs:+(coordinated.result.elapsedMs-baseline.result.elapsedMs).toFixed(3)});
        if(id==='large-fail'&&repetition===1) {
          const shorter={...coordinated.answer,failures:coordinated.answer.failures.slice(0,1)};
          const validation=checkControlledAnswer(coordinated.facts,shorter,coordinated.result.sourceSha256);
          negative={id:'shorter-lost-failure',completeAnswerBytes:size(coordinated.answer),shorterAnswerBytes:size(shorter),...validation};
          assert.ok(negative.shorterAnswerBytes<negative.completeAnswerBytes);
          assert.equal(negative.correct,false);assert.ok(negative.missing.includes('failure:synthetic.payment.retries-timeout'));
        }
      } finally {rmSync(root,{recursive:true,force:true});assert.equal(existsSync(root),false);}
    }
  }
  return {version:1,repetitions,caseCount:cases.length,cases,negative,cleanupVerified:true,
    units:{bytes:'UTF-8 serialized requests plus MCP content envelopes; discovery metadata and actual registered evidence schema included',elapsed:'milliseconds; descriptive local harness time, no threshold',calls:'discovery + schema + read/ingest + every followup/search + failed retry'},
    coverage:{providerUsage:'unknown; not observed',transportFraming:'not measured',baselineSchema:'synthetic authorized read-file schema; no historical host baseline',correctness:'exact test counts, failure IDs/causes/locators, source digests, references, certainty and completeness',timing:'includes discovery serialization, local parsing/indexing and delivery accounting; excludes fixture setup and cleanup',indexing:'coordinated uses actual ContentStore; baseline is uncached raw read'},
    limitation:'Synthetic fixture costs do not prove model adherence, production latency or a guaranteed saving. Integrity verification is mechanical local IO, not delivered content.'};
}
