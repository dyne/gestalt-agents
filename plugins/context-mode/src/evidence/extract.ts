/** Deterministic test evidence adapters. A keyword match is never a test result. */
import { constants, closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { digest, reference, type EvidenceReference, type GitHubCapture } from "./github.js";

export interface TestCounts { passed: number; failed: number; skipped: number; total: number }
export interface TestFailure { id: string; cause: string; locator: string; step: string | null; time: string | null; contextOmittedLines:number }
export interface Extraction {
  format: "test-json" | "junit" | "tap" | "vitest" | "pytest" | "unknown";
  counts: TestCounts | null; failures: TestFailure[]; exit: number | null;
  certainty: "known" | "unknown"; reason: string | null;
}
const count = (states:string[]):TestCounts => ({ passed:states.filter(s=>s==='passed').length,failed:states.filter(s=>s==='failed').length,skipped:states.filter(s=>s==='skipped').length,total:states.length });
const validCounts=(c:TestCounts)=>Object.values(c).every(n=>Number.isSafeInteger(n)&&n>=0);
const unknown = (reason:string):Extraction => ({format:'unknown',counts:null,failures:[],exit:null,certainty:'unknown',reason});
const failure = (id:string,cause:string,locator:string):TestFailure => ({id,cause,locator,step:null,time:null,contextOmittedLines:0});

/** Redact known credential forms and the current authenticated context, also in IDs. */
export function redact(text:string):string {
  let safe=text.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g,'[REDACTED]')
    .replace(/\b(Bearer|token)\s+[A-Za-z0-9_.-]{8,}/gi,'$1 [REDACTED]');
  for(const key of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN']) {
    const value=process.env[key];if(value && value.length>=4)safe=safe.split(value).join('[REDACTED]');
  }
  return safe;
}

function parseJson(text:string):Extraction {
  let data:unknown;try {data=JSON.parse(text);}catch{return unknown('malformed JSON');}
  const normalized=z.object({version:z.literal(1),tests:z.array(z.object({id:z.string().min(1),status:z.enum(['passed','failed','skipped']),cause:z.string().optional(),step:z.string().optional(),time:z.string().optional()})).max(100000),exitCode:z.number().int().optional()}).safeParse(data);
  if(normalized.success) {
    const d=normalized.data;
    return {format:'test-json',counts:count(d.tests.map(t=>t.status)),failures:d.tests.flatMap((t,i)=>t.status==='failed'?[{...failure(t.id,t.cause??'No diagnostic cause supplied',`JSON:tests[${i}]`),step:t.step??null,time:t.time??null}]:[]),exit:d.exitCode??null,certainty:'known',reason:null};
  }
  // Jest/Vitest JSON reporter contract; counters must agree with all assertion records.
  const reporter=z.object({numTotalTests:z.number().int().nonnegative(),numPassedTests:z.number().int().nonnegative(),numFailedTests:z.number().int().nonnegative(),numPendingTests:z.number().int().nonnegative(),numTodoTests:z.number().int().nonnegative().optional(),numFailedTestSuites:z.number().int().nonnegative().optional(),testResults:z.array(z.object({name:z.string(),status:z.string().optional(),message:z.string().optional(),assertionResults:z.array(z.object({fullName:z.string().optional(),title:z.string(),ancestorTitles:z.array(z.string()).optional(),status:z.enum(['passed','failed','pending','skipped','todo','disabled']),failureMessages:z.array(z.string()).optional()}))}))}).safeParse(data);
  if(!reporter.success)return unknown('unsupported test JSON schema');
  const d=reporter.data,states:string[]=[],failures:TestFailure[]=[];
  for(const [i,suite] of d.testResults.entries()) {
    for(const [j,t] of suite.assertionResults.entries()) {
      states.push(t.status==='passed'?'passed':t.status==='failed'?'failed':'skipped');
      if(t.status==='failed')failures.push(failure(t.fullName??[...(t.ancestorTitles??[]),t.title].join(' > '),(t.failureMessages??[]).join('\n')||'No diagnostic cause supplied',`JSON:testResults[${i}].assertionResults[${j}]`));
    }
    if(!suite.assertionResults.length && suite.status==='failed')failures.push(failure(`${suite.name}::setup`,suite.message||'Suite failed before assertions',`JSON:testResults[${i}]`));
  }
  const c=count(states);
  // Reporter versions disagree whether todo is part of pending; trust records only
  // when declared totals and the full status partition are consistent.
  if(c.total!==d.numTotalTests||c.passed!==d.numPassedTests||c.failed!==d.numFailedTests||![d.numPendingTests,d.numPendingTests+(d.numTodoTests??0)].includes(c.skipped))
    return {...unknown('contradictory test JSON counters'),format:'test-json',counts:c,failures};
  if((d.numFailedTestSuites??0)>0&&!failures.length)return {...unknown('failed suite has no diagnostic record'),format:'test-json',counts:c};
  return {format:'test-json',counts:c,failures,exit:null,certainty:'known',reason:null};
}

function decodeXml(value:string):string {
  if(/&(?!(?:#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);)/.test(value))throw new Error();
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,(_,v:string)=>{
    if(v.startsWith('#')){const n=v[1]==='x'?parseInt(v.slice(2),16):Number(v.slice(1));if(n>0x10ffff||n===0||(n>=0xd800&&n<=0xdfff))throw new Error();return String.fromCodePoint(n);}
    return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[v];
  });
}
function parseJUnit(text:string):Extraction {
  if(/<!DOCTYPE|<!ENTITY/i.test(text))return unknown('XML declarations/entities are unsupported');
  type Node={tag:string;attrs:Record<string,string>;text:string;children:Node[]};
  const root:Node={tag:'root',attrs:{},text:'',children:[]},stack=[root];
  try {
    // Tokenizer consumes the complete input; no external entities or XML execution.
    const tokens=text.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g)??[];
    if(tokens.join('')!==text)throw new Error();
    let nodeCount=0;
    for(const token of tokens) {
      if(token.startsWith('<?')||token.startsWith('<!--'))continue;
      if(token.startsWith('<![CDATA[')){stack.at(-1)!.text+=token.slice(9,-3);continue;}
      if(token.startsWith('</')){if(!/^<\/[\w.-]+\s*>$/.test(token)||stack.length<2||stack.pop()!.tag!==token.slice(2,-1).trim())throw new Error();continue;}
      if(token.startsWith('<')) {
        const m=token.match(/^<([\w.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>$/);if(!m)throw new Error();
        const attrs:Record<string,string>=Object.create(null);
        for(const a of m[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)){if(a[1] in attrs)throw new Error();attrs[a[1]]=decodeXml(a[2]??a[3]);}
        const n:Node={tag:m[1],attrs,text:'',children:[]};stack.at(-1)!.children.push(n);if(!m[3])stack.push(n);if(stack.length>100||++nodeCount>100000)throw new Error();
      } else {if(/&(?!(?:#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);)/.test(token))throw new Error();stack.at(-1)!.text+=decodeXml(token);}
    }
    if(stack.length!==1||root.children.length!==1||!['testsuites','testsuite'].includes(root.children[0].tag)||root.text.trim())throw new Error();
    const states:string[]=[],failures:TestFailure[]=[];
    const walk=(n:Node,suite:string)=>{
      if(n.tag==='testsuite')suite=n.attrs.name??suite;
      if(n.tag==='testcase') {
        if(!n.attrs.name)throw new Error();
        const id=[n.attrs.classname??suite,n.attrs.name].filter(Boolean).join('::');
        const errs=n.children.filter(c=>['failure','error'].includes(c.tag)),skipped=n.children.some(c=>c.tag==='skipped');
        if(errs.length&&skipped)throw new Error();states.push(errs.length?'failed':skipped?'skipped':'passed');
        for(const e of errs)failures.push({...failure(id,[e.attrs.message,e.text].filter(Boolean).join('\n')||'No diagnostic cause supplied',`JUnit:testcase[${states.length}]/${e.tag}`),time:n.attrs.time??null,step:suite||null});
      } else {
        if(n.tag==='error'||n.tag==='failure')failures.push(failure(`${suite||'suite'}::setup`,[n.attrs.message,n.text].filter(Boolean).join('\n'),`JUnit:${n.tag}`));
        for(const child of n.children)walk(child,suite);
      }
    };
    walk(root.children[0],'');const c=count(states);
    const top=root.children[0];
    for(const [attr,expected] of [['tests',c.total],['skipped',c.skipped]] as const) {
      if(top.attrs[attr]!==undefined&&(!/^\d+$/.test(top.attrs[attr])||Number(top.attrs[attr])!==expected))return {...unknown('contradictory JUnit counters'),format:'junit',counts:c,failures};
    }
    if(top.attrs.failures!==undefined||top.attrs.errors!==undefined) {
      const f=top.attrs.failures??'0',e=top.attrs.errors??'0';
      if(!/^\d+$/.test(f)||!/^\d+$/.test(e)||Number(f)+Number(e)!==c.failed)return {...unknown('contradictory JUnit failure/error counters'),format:'junit',counts:c,failures};
    }
    return {format:'junit',counts:c,failures,exit:null,certainty:'known',reason:null};
  }catch{return unknown('malformed or unsupported JUnit XML');}
}

function plain(text:string):Extraction {
  const raw=text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,''),lines=raw.split(/\r?\n/);
  // GitHub gh job logs prefix each line with job, step, and timestamp.
  const metadata=lines.map(line=>line.match(/^([^\t]+)\t([^\t]+)\t(\d{4}-\d\d-\d\dT\S+)\s?(.*)$/));
  const clean=lines.map((line,i)=>metadata[i]?.[4]??line);
  const context=(index:number,id:string,end:number)=>({...failure(id,clean.slice(index,Math.min(end,index+20)).join('\n'),`lines:${index+1}-${Math.min(end,index+20)}`),step:metadata[index]?.[2]??null,time:metadata[index]?.[3]??null,contextOmittedLines:Math.max(0,end-index-20)});
  if(clean.some(l=>/^TAP version 13\s*$/.test(l))||clean.some(l=>/^1\.\.\d+(?:\s+#.*)?$/.test(l))) {
    const states:string[]=[],failures:TestFailure[]=[],ids=new Set<string>();let plan:number|null=null,bail=false;
    for(let i=0;i<clean.length;i++) {
      const p=clean[i].match(/^1\.\.(\d+)(?:\s+#.*)?$/);if(p){if(plan!==null)return unknown('multiple TAP plans or subtests unsupported');plan=Number(p[1]);}
      const b=clean[i].match(/^Bail out!\s*(.*)/i);if(b){bail=true;failures.push(context(i,'TAP::bailout',i+1));}
      const m=clean[i].match(/^(not ok|ok)\s+(\d+)(?:\s+-?\s*(.*))?$/);if(!m)continue;
      if(ids.has(m[2]))return unknown('duplicate TAP test number');ids.add(m[2]);
      const skip=/#\s*(SKIP|TODO)\b/i.test(m[3]??'');states.push(skip?'skipped':m[1]==='ok'?'passed':'failed');
      if(m[1]==='not ok'&&!skip){let end=i+1;while(end<clean.length&&!/^(?:not ok|ok)\s+\d+|^1\.\./.test(clean[end]))end++;failures.push(context(i,`TAP:${m[2]} ${m[3]??''}`,end));}
    }
    const c=count(states),known=plan===c.total&&!bail;
    return {format:'tap',counts:c,failures,exit:null,certainty:known?'known':'unknown',reason:known?null:bail?'TAP bailout; coverage incomplete':'missing or incomplete TAP plan'};
  }
  const summary=[...clean].reverse().find(l=>/^\s*Tests\s+/.test(l));
  if(summary) {
    const c:TestCounts={passed:0,failed:0,skipped:0,total:0};
    for(const m of summary.matchAll(/(\d+)\s+(passed|failed|skipped|todo|pending)\b/g)){const n=Number(m[1]);c[m[2]==='passed'?'passed':m[2]==='failed'?'failed':'skipped']+=n;}
    const declared=summary.match(/\((\d+)\)\s*$/);c.total=c.passed+c.failed+c.skipped;
    const markers=clean.flatMap((l,i)=>/^\s*FAIL\s+\S/.test(l)?[i]:[]);
    const failures=markers.map((i,n)=>context(i,clean[i].trim().replace(/^FAIL\s+/,''),markers[n+1]??clean.length));
    if(!validCounts(c))return {...unknown('invalid or oversized Vitest counters'),failures};
    if(!declared||Number(declared[1])!==c.total)return {...unknown('unrecognized or contradictory Vitest summary'),format:'vitest',counts:c,failures};
    const known=c.failed===failures.length;
    return {format:'vitest',counts:c,failures,exit:null,certainty:known?'known':'unknown',reason:known?null:'failure records do not cover the summary'};
  }
  const py=[...clean].reverse().find(l=>/^=+ .*\b(?:passed|failed|skipped)\b.* =+$/.test(l));
  if(py) {
    const c:TestCounts={passed:0,failed:0,skipped:0,total:0};
    for(const m of py.matchAll(/(\d+)\s+(passed|failed|skipped)\b/g))c[m[2] as 'passed'|'failed'|'skipped']+=Number(m[1]);c.total=c.passed+c.failed+c.skipped;
    const failures=clean.flatMap((l,i)=>l.startsWith('FAILED ')?[context(i,l.slice(7).split(' - ')[0],i+1)]:[]);
    if(!validCounts(c))return {...unknown('invalid or oversized pytest counters'),failures};
    const known=c.failed===failures.length&&!/\d+ (?:error|xfailed|xpassed|deselected)/.test(py);
    return {format:'pytest',counts:c,failures,exit:null,certainty:known?'known':'unknown',reason:known?null:'unsupported or missing pytest result records'};
  }
  return unknown('unsupported plain-text format; search indexed evidence');
}

export function extractTests(text:string):Extraction {
  const start=text.trimStart();
  const r=start.startsWith('{')||start.startsWith('[')?parseJson(text):start.startsWith('<')?parseJUnit(text):plain(text);
  return {...r,failures:r.failures.map(f=>({...f,id:redact(f.id),cause:redact(f.cause),step:f.step?redact(f.step):null}))};
}

export interface EvidenceInput { path:string; command?:string; cwd?:string; exit?:number; completeness?:'complete'|'partial'|'unknown'; expectedSha256?:string; identity?:{job?:number;artifact?:number;member?:string} }
export interface IngestOptions {
  storageRoot:string;
  /** Mandatory host read authorization; called on supplied and resolved/opened paths. */
  authorizeRead:(path:string)=>boolean;
  /** Index the captured, sanitized text in this invocation's existing ContentStore. */
  index:(text:string,source:string)=>{sourceId:number|string};
  indexExists?:(source:string)=>boolean;
  indexScope?:string;
  source:Record<string,unknown>;
  milestone?:string;
  candidate?:Record<string,unknown>;
}
const indexed = new WeakMap<IngestOptions["index"], Map<string, {sourceId:number|string}>>();
const MAX_BYTES=8*1024*1024;
function openAuthorized(path:string,authorize:IngestOptions['authorizeRead']):number {
  if(!authorize(path))throw new Error('denied');
  const real=realpathSync(path);if(!authorize(real))throw new Error('denied');
  const fd=openSync(real,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try {
    const st=fstatSync(fd);if(!st.isFile())throw new Error('not-regular');
    const opened=process.platform==='linux'?realpathSync(`/proc/self/fd/${fd}`):realpathSync(real);
    if(!authorize(opened))throw new Error('denied');
    const current=statSync(opened);if(st.dev!==current.dev||st.ino!==current.ino)throw new Error('changed');
    return fd;
  }catch(error){closeSync(fd);throw error;}
}
function readAuthorized(path:string,authorize:IngestOptions['authorizeRead'],maxBytes=MAX_BYTES):{data:Buffer;partial:boolean;canonical:string} {
  const fd=openAuthorized(path,authorize);
  try {
    const st=fstatSync(fd),data=Buffer.alloc(Math.min(maxBytes+1,st.size+1));let length=0,n=0;
    while(length<data.length&&(n=readSync(fd,data,length,data.length-length,null))>0)length+=n;
    const after=fstatSync(fd);
    return {canonical:process.platform==='linux'?realpathSync(`/proc/self/fd/${fd}`):realpathSync(path),data:data.subarray(0,Math.min(length,maxBytes)),partial:length>maxBytes||length!==st.size||st.size!==after.size||st.mtimeMs!==after.mtimeMs||st.ctimeMs!==after.ctimeMs};
  }finally{closeSync(fd);}
}

/** Full report stays private; return routine() only to the model. */
export function ingestEvidence(inputs:EvidenceInput[],opts:IngestOptions):{report:Record<string,any>;routine:string;id:string} {
  if(!inputs.length||inputs.length>100)throw new Error('invalid evidence count');
  mkdirSync(opts.storageRoot,{recursive:true,mode:0o700});const dir=mkdtempSync(join(opts.storageRoot,'report-')),id=basename(dir);
  const checks:Record<string,any>[]=[],observedAt=new Date().toISOString();
  let remainingBytes=16*1024*1024;
  for(const [i,input] of inputs.entries()) {
    const checkObservedAt=new Date().toISOString();
    try {
      if(remainingBytes<=0)throw new Error('capture budget exhausted');
      const captured=readAuthorized(input.path,opts.authorizeRead,Math.min(MAX_BYTES,remainingBytes)),path=join(dir,`source-${i}.capture`);
      remainingBytes-=captured.data.length;
      writeFileSync(path,captured.data,{mode:0o600});const ref=reference(path,captured.data);
      const text=captured.data.toString('utf8'),parsed=extractTests(text);
      const mismatch=input.expectedSha256!==undefined&&digest(captured.data)!==input.expectedSha256;
      const completeness=captured.partial||mismatch?'partial':input.completeness??'complete';
      let index:Record<string,unknown>;
      try {
        const identity = opts.source.kind === 'github'
          ? {kind:'github',host:opts.source.host,repository:opts.source.repository,run:opts.source.run,attempt:opts.source.attempt,sha:opts.source.headSha,selector:input.identity}
          : {kind:'local',path:captured.canonical};
        const safeText=redact(text),source=`evidence:${digest(opts.indexScope??'invocation')}:${digest(JSON.stringify(identity))}:${digest(safeText)}`;
        let cache=indexed.get(opts.index);if(!cache){cache=new Map();indexed.set(opts.index,cache);}
        const exists=opts.indexExists?.(source)??false;
        let entry=exists?(cache.get(source)??{sourceId:source}):undefined;
        const reused=!!entry;
        if(!entry){entry=opts.index(safeText,source);cache.set(source,entry);}
        index={...entry,source,scope:'current invocation ContentStore',reused,identity,sha256:ref.sha256};
      }
      catch {index={sourceId:null,reason:'index unavailable; captured source remains retrievable'};}
      const exitConflict=input.exit!==undefined&&parsed.exit!==null&&input.exit!==parsed.exit;
      const exit=exitConflict?null:input.exit??parsed.exit;
      const decision=exitConflict||parsed.reason?.startsWith('contradictory')?'contradictory':parsed.failures.length||(parsed.counts?.failed??0)>0||exit!==null&&exit!==0?'failed':parsed.certainty==='known'&&completeness==='complete'&&exit===0&&parsed.counts!==null&&parsed.counts.passed>0?'supported':'needs-evidence';
      const first=parsed.failures[0]?failurePreview(parsed.failures[0]):(parsed.counts?.failed??0)>0?failure('test-summary::failed',`${parsed.counts!.failed} failed tests reported; failure records unavailable`,'test-summary'):exit!==null&&exit!==0?failure('command::exit',`Command exited ${exit}; test diagnosis unknown`,'command:exit'):null;
      checks.push({command:input.command?redact(input.command):null,commandReason:input.command?null:'command not supplied',cwd:input.cwd??null,cwdReason:input.cwd?null:'working directory not supplied',exit,exitReason:exitConflict?'supplied command exit conflicts with embedded exit; neither establishes success':exit===null?'command exit unavailable':null,
        suppliedExit:input.exit??null,embeddedExit:parsed.exit,exitConflict:exitConflict?{supplied:input.exit,embedded:parsed.exit,reference:ref,locator:'JSON:exitCode'}:null,
        format:parsed.format,counts:parsed.counts,countsReason:parsed.counts?null:parsed.reason,certainty:exitConflict?'unknown':parsed.certainty,reason:exitConflict?'contradictory supplied and embedded command exits':mismatch?'source digest changed':parsed.reason,
        completeness,coverage:captured.partial?`first ${captured.data.length} bytes; source exceeded capture budget or changed during read`:mismatch?'digest does not match expected capture':'entire authorized file',decision,observedAt:checkObservedAt,sourceIdentity:input.identity??null,
        failures:parsed.failures,failureCount:Math.max(parsed.failures.length,parsed.counts?.failed??0,first?1:0),firstActionableFailure:first,references:[ref],index});
    }catch {
      // Never return native paths, permission diagnostics or credential-bearing errors.
      checks.push({command:input.command?redact(input.command):null,cwd:input.cwd??null,exit:null,exitReason:'source unavailable; command exit unverified',counts:null,countsReason:'source unavailable',failures:[],firstActionableFailure:null,certainty:'unknown',completeness:'unknown',decision:'needs-evidence',reason:'source unavailable, unauthorized or capture budget exhausted',observedAt:checkObservedAt});
    }
  }
  const report={version:1,milestone:opts.milestone??null,scope:inputs.map((_,i)=>`source-${i}`).sort(),candidate:opts.candidate??null,
    identityReason:opts.candidate?null:'candidate identity not supplied; source capture is not candidate verification',source:opts.source,checks,observedAt,
    completeness:checks.every(c=>c.completeness==='complete')?'complete':'partial',decision:checks.some(c=>c.decision==='contradictory')?'contradictory':checks.some(c=>c.decision==='failed')?'failed':checks.some(c=>c.decision==='needs-evidence')?'needs-evidence':'supported',references:{access:'local-private',retention:'until local evidence directory is removed'},overflow:'none'};
  const text=JSON.stringify(report),path=join(dir,'report.json');writeFileSync(path,text,{mode:0o600});
  const manifest={id,...reference(path,text,'JSON:checks')};
  return {report,routine:boundedRoutine(report,manifest),id};
}

function failurePreview(f:TestFailure):Record<string,unknown> {
  const preview=(text:string,max:number)=>{let out='';for(const c of text){if(Buffer.byteLength(out+c)>max)break;out+=c;}return {text:out,omittedBytes:Buffer.byteLength(text)-Buffer.byteLength(out)};};
  const id=preview(f.id,160),cause=preview(f.cause,240);
  return {...f,id:id.text,cause:cause.text,idOmittedBytes:id.omittedBytes,causeOmittedBytes:cause.omittedBytes,details:'JSON:failures[0]'};
}

function boundedRoutine(report:Record<string,any>,manifest:EvidenceReference&{id:string}):string {
  const full=JSON.stringify({...report,references:manifest});if(Buffer.byteLength(full)<=2048)return full;
  const failures=report.checks.flatMap((c:any)=>c.failures??[]),failureCount=report.checks.reduce((n:number,c:any)=>n+(c.failureCount??0),0),first=report.checks.find((c:any)=>c.firstActionableFailure)?.firstActionableFailure;
  let excerpt:Record<string,unknown>|null=first?{id:first.id,cause:first.cause,locator:first.locator,step:first.step,time:first.time}:null;
  if(excerpt&&Buffer.byteLength(JSON.stringify(excerpt))>400)excerpt={locator:'JSON:checks[*].firstActionableFailure',reason:'failure identifier/context exceed inline budget; retrieve bounded details'};
  const compact={version:1,milestone:report.milestone,source:report.source,candidate:report.candidate,observedAt:report.observedAt,completeness:report.completeness,decision:report.decision,
    checks:report.checks.slice(0,1).map((c:any)=>({command:c.command,exit:c.exit,counts:c.counts,certainty:c.certainty,decision:c.decision,reason:c.reason,index:c.index})),
    firstActionableFailure:excerpt,failureCount,overflow:{omittedChecks:Math.max(0,report.checks.length-1),omittedFailureDetails:failures.length,reportBytes:manifest.bytes,manifest,followup:{id:manifest.id,offset:0,maxBytes:2048}}};
  const routine=JSON.stringify(compact);if(Buffer.byteLength(routine)<=2048)return routine;
  // Extremely long identities/paths cannot crowd out the retrievable manifest handle.
  return JSON.stringify({version:1,completeness:report.completeness,decision:report.decision,firstActionableFailure:first?{reference:manifest.id,locator:'JSON:checks[*].firstActionableFailure'}:null,failureCount,
    overflow:{omittedBytes:Buffer.byteLength(full),reportBytes:manifest.bytes,sha256:manifest.sha256,manifestId:manifest.id,access:'local-private runtime evidence storage',followup:{id:manifest.id,offset:0,maxBytes:2048}}});
}

/** Bridge only log/member captures, never auth output or GitHub metadata as tests. */
export function ingestGitHubCapture(capture:GitHubCapture,opts:Omit<IngestOptions,'source'>):ReturnType<typeof ingestEvidence> {
  const source={kind:'github',host:capture.selector?.host??null,repository:capture.selector?.repository??null,
    run:capture.selector?.run??null,attempt:capture.selector?.attempt??null,job:capture.selector?.job??null,artifact:capture.selector?.artifact??null,
    headSha:capture.headSha,completedAt:capture.completedAt,completionTimeReason:'run completion timestamp unavailable; updated_at is retained separately',sourceUpdatedAt:capture.sourceUpdatedAt,retrievedAt:capture.observedAt,
    reuse:capture.reuse??'captured',statusFreshness:capture.reuse==='cached-terminal'?'cached observation; refresh to revalidate remote state':'retrieved this invocation',captureCompleteness:capture.completeness,reason:capture.reason??null,manifest:capture.manifest??null,
    artifactAttemptBinding:capture.selector?.artifact?'run-scoped; attempt association unknown':null,omittedSources:0};
  const refSchema=z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().nonnegative()});
  const inputs:EvidenceInput[]=[];
  try {
    if(!capture.manifest)throw new Error();
    const bytes=readAuthorized(capture.manifest.path,opts.authorizeRead);if(bytes.partial||digest(bytes.data)!==capture.manifest.sha256)throw new Error();
    const m=z.object({entries:z.array(z.object({kind:z.string(),state:z.enum(['complete','partial','failed']),reference:refSchema.optional()})).max(110)}).parse(JSON.parse(bytes.data.toString('utf8')));
    for(const e of m.entries) {
      if(!e.reference)continue;
      if(/^logs-\d+$/.test(e.kind))inputs.push({path:e.reference.path,expectedSha256:e.reference.sha256,identity:{job:Number(e.kind.slice(5))},completeness:capture.completeness==='complete'&&e.state==='complete'?'complete':'partial'});
      if(e.kind==='artifact-members'&&e.state==='complete') {
        const members=readAuthorized(e.reference.path,opts.authorizeRead);if(members.partial||digest(members.data)!==e.reference.sha256)throw new Error();
        const records=z.array(z.object({name:z.string(),reference:refSchema})).max(100).parse(JSON.parse(members.data.toString('utf8')));
        // GitHub artifacts are run-scoped: equal run/head SHA does not prove rerun attempt.
        for(const member of records)inputs.push({path:member.reference.path,expectedSha256:member.reference.sha256,identity:{artifact:capture.selector?.artifact,member:member.name},completeness:'unknown'});
      }
    }
    if(inputs.length>100){source.omittedSources=inputs.length-100;inputs.splice(100);for(const input of inputs)input.completeness='partial';}
  }catch{inputs.length=0;source.reason='invalid-source';}
  if(!inputs.length)inputs.push({path:join(opts.storageRoot,'unavailable-source'),completeness:'unknown'});
  return ingestEvidence(inputs,{...opts,source});
}

/** Explicit workspace-authorized manifest transfer. Never import another session's index IDs. */
export function ingestSharedManifest(path:string,sha256:string,opts:Omit<IngestOptions,'source'>):ReturnType<typeof ingestEvidence> {
  const bytes=readAuthorized(path,opts.authorizeRead);
  if(bytes.partial||digest(bytes.data)!==sha256)throw new Error('invalid shared manifest');
  const ref=z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
  const identity=z.number().int().positive().nullable().optional();
  const source=z.object({kind:z.enum(['local','github']),host:z.string().max(253).nullable().optional(),
    repository:z.string().max(4096).nullable().optional(),run:identity,attempt:identity,job:identity,artifact:identity,
    headSha:z.string().regex(/^[a-fA-F0-9]{40}$/).nullable().optional(),
    retrievedAt:z.string().datetime().optional(),sourceUpdatedAt:z.string().datetime().nullable().optional()});
  const manifest=z.object({version:z.literal(1),source,checks:z.array(z.object({
    command:z.string().nullable().optional(),cwd:z.string().nullable().optional(),exit:z.number().int().nullable().optional(),
    completeness:z.enum(['complete','partial','unknown']),references:z.array(ref).min(1).max(1),
    sourceIdentity:z.object({job:z.number().int().positive().optional(),artifact:z.number().int().positive().optional(),member:z.string().optional()}).nullable().optional(),
  })).min(1).max(100)}).parse(JSON.parse(bytes.data.toString('utf8')));
  return ingestEvidence(manifest.checks.map(c=>({path:c.references[0].path,expectedSha256:c.references[0].sha256,
    identity:c.sourceIdentity??undefined,command:c.command??undefined,cwd:c.cwd??undefined,exit:c.exit??undefined,completeness:c.completeness})),
    {...opts,source:{...Object.fromEntries(Object.entries(manifest.source).map(([key,value])=>[key,typeof value==='string'?redact(value):value])),sharedManifest:reference(path,bytes.data),transfer:'authorized bytes; indexed in receiving session; original candidate is not verification'}});
}

/** Only generated report IDs resolve; arbitrary paths cannot be used as followups. */
export function evidenceFollowup(storageRoot:string,id:string,offset=0,maxBytes=2048):string {
  if(!/^report-[A-Za-z0-9]+$/.test(id)||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(maxBytes)||maxBytes<512||maxBytes>2048)throw new Error('invalid evidence followup');
  const dir=resolve(realpathSync(storageRoot),id),path=join(dir,'report.json');
  const fd=openAuthorized(path,p=>resolve(p)===path);
  let totalBytes:number,sha256:string,data:Buffer;
  try {
    const before=fstatSync(fd);totalBytes=before.size;
    if(totalBytes>128*1024*1024||offset>totalBytes)throw new Error('invalid evidence size/offset');
    const hash=createHash('sha256'),chunk=Buffer.alloc(64*1024);let read=0,position=0;
    while(position<totalBytes&&(read=readSync(fd,chunk,0,Math.min(chunk.length,totalBytes-position),position))>0){hash.update(chunk.subarray(0,read));position+=read;}
    const after=fstatSync(fd);if(position!==totalBytes||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error('evidence changed');
    sha256=hash.digest('hex');data=Buffer.alloc(Math.min(totalBytes-offset,maxBytes));
    const length=readSync(fd,data,0,data.length,offset);data=data.subarray(0,length);
    const final=fstatSync(fd);if(before.size!==final.size||before.mtimeMs!==final.mtimeMs||before.ctimeMs!==final.ctimeMs)throw new Error('evidence changed');
  }finally{closeSync(fd);}
  // Text pages remain readable, preserve UTF-8 boundaries, and count JSON escaping.
  if(data.length && (data[0]&0xc0)===0x80)throw new Error('offset is not a UTF-8 boundary');
  let length=Math.min(data.length,maxBytes-350);
  while(length>=0) {
    let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,length));}catch{length--;continue;}
    const output=JSON.stringify({id,sha256,offset,bytes:length,totalBytes,encoding:'utf8',data:text,nextOffset:offset+length<totalBytes?offset+length:null});
    if(Buffer.byteLength(output)<=maxBytes)return output;length--;
  }
  throw new Error('followup budget too small');
}
