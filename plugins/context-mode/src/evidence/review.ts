/** Review packets are navigation and contradiction checks, never root acceptance. */
import {existsSync, lstatSync, realpathSync} from 'node:fs';
import {isAbsolute, resolve, relative, sep} from 'node:path';
import {z} from 'zod';
import {extractTests, readAuthorized} from './extract.js';
import {digest} from './github.js';
import {candidateRevisionSchema, revisionDigest} from './revision.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ref = z.object({path: z.string().min(1).max(4096), sha256: hash, bytes: z.number().int().min(0).max(128*1024*1024)}).strict();
const file = z.object({path: z.string().min(1).max(4096).refine(p => !isAbsolute(p) && !p.includes('\\') && p.split('/').every(s => s && s !== '.' && s !== '..')),
  sha256: hash.nullable(), mode: z.string().regex(/^100(?:644|755)$/).nullable()}).strict();
const counts = z.object({passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), total: z.number().int().nonnegative()}).strict();
const failure = z.object({id: z.string(), cause: z.string(), locator: z.string()}).strict();
const checkClaim = z.object({report: z.number().int().min(0), index: z.number().int().min(0), command: z.string().nullable(), cwd: z.string().nullable(),
  exit: z.number().int().nullable(), counts: counts.nullable(), decision: z.enum(['supported','failed','needs-evidence','contradictory']),
  failureCount: z.number().int().nonnegative(), firstFailure: failure.nullable()}).strict();
/** Root gathers this independently using native Git/check observations. The
 * complete scope and required-check set are witnesses, not child-selected data.
 * Hashes establish byte identity, not witness freshness or remote CI freshness.
 */
export const reviewStateSchema = z.object({
  repository: z.string().min(1).max(4096), candidate: candidateRevisionSchema.required(),
  scope: z.array(file).max(10000), diff: ref, evidence: z.array(ref).min(1).max(100),
  requiredChecks: z.array(z.object({command: z.string().min(1), cwd: z.string().min(1), exit: z.number().int().nullable()}).strict()).min(1).max(100),
  ci: z.array(z.object({report:z.number().int().min(0),host:z.string().min(1).max(253),repository:z.string().min(1).max(201),
    run:z.number().int().positive(),attempt:z.number().int().positive(),headSha:z.string().regex(/^[a-fA-F0-9]{40}$/),jobs:z.array(z.number().int().positive()).min(1).max(100)}).strict()).max(100).optional(),
}).strict();
export type ReviewState = z.infer<typeof reviewStateSchema>;
const deltaSchema = z.object({previous: hash.nullable(), candidateChanged: z.boolean(), diffChanged: z.boolean(), risksChanged: z.boolean(), files: z.array(z.string()), evidence: z.array(ref)}).strict();
export const reviewPacketSchema = z.object({version: z.literal(1), milestone: z.string().min(1).max(120), state: reviewStateSchema,
  checks: z.array(checkClaim).min(1).max(10000), firstFailure: checkClaim.extend({firstFailure: failure}).nullable(),
  risks: z.array(z.string().max(2048)).max(32), deltaSinceLastReview: deltaSchema}).strict();
export type ReviewPacket = z.infer<typeof reviewPacketSchema>;
type Issue = {kind: 'contradictory'|'needs-evidence'; code: string; locator: string; reason: string};
type ReportCheck = {command?: string|null; cwd?: string|null; exit?: number|null; counts?: z.infer<typeof counts>|null;
  decision: z.infer<typeof checkClaim>['decision']; certainty?: string; completeness?: string; failureCount?: number;
  failures: {id: string; cause: string; locator: string}[]; firstActionableFailure?: {id: string; cause: string; locator: string}|null;
  references: z.infer<typeof ref>[]; observedAt?: string|null; sourceIdentity?: {job?:number}|null};
const asFailure = (f: {id: string; cause: string; locator: string}) => ({id: f.id, cause: f.cause, locator: f.locator});
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => [k,canonical(v)])) : value;
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function reviewDelta(state: ReviewState, previous?: ReviewPacket, risks: string[] = []): z.infer<typeof deltaSchema> {
  const old = new Map(previous?.state.scope.map(f => [f.path,f]) ?? []), current = new Map(state.scope.map(f => [f.path,f]));
  const refs = new Map(previous?.state.evidence.map(r => [r.path,r.sha256]) ?? []);
  return {previous: previous ? revisionDigest(canonical(previous)) : null,
    candidateChanged: !previous || !equal(state.candidate,previous.state.candidate),
    diffChanged: !previous || !equal(state.diff,previous.state.diff),risksChanged: !previous || !equal(risks,previous.risks),
    files: [...new Set([...old.keys(),...current.keys()])].sort().filter(p => !equal(old.get(p),current.get(p))),
    evidence: state.evidence.filter(r => refs.get(r.path) !== r.sha256)};
}

function readReference(reference: z.infer<typeof ref>, authorize: (path:string)=>boolean): Buffer {
  let read: ReturnType<typeof readAuthorized>;
  try {read = readAuthorized(reference.path,authorize,128*1024*1024);}catch {throw new ReviewReadError('needs-evidence');}
  if(read.partial)throw new ReviewReadError('needs-evidence');
  if(read.data.length !== reference.bytes || digest(read.data) !== reference.sha256) throw new ReviewReadError('contradictory');
  return read.data;
}
class ReviewReadError extends Error {constructor(readonly kind: Issue['kind']) {super('review reference unavailable or changed');}}
function readReport(reference: z.infer<typeof ref>, authorize: (path:string)=>boolean): {checks:ReportCheck[]; source?:Record<string,unknown>; verification?:{remoteFreshness?:string}} {
  const report = JSON.parse(readReference(reference,authorize).toString('utf8'));
  if(report.version !== 1 || !Array.isArray(report.checks) || report.checks.length < 1 || report.checks.length > 100) throw new Error('unsupported report');
  for(const check of report.checks) {
    if(!Array.isArray(check.failures) || !Array.isArray(check.references) || check.references.length !== 1) throw new Error('incomplete report check');
    for(const r of check.references) ref.parse({path:r.path,sha256:r.sha256,bytes:r.bytes});
    for(const f of check.failures) failure.parse(asFailure(f));
  }
  return report;
}
function claim(report: number, index: number, check: ReportCheck): z.infer<typeof checkClaim> {
  return checkClaim.parse({report,index,command:check.command??null,cwd:check.cwd??null,exit:check.exit??null,counts:check.counts??null,decision:check.decision,
    failureCount:check.failureCount??check.failures.length,firstFailure:check.firstActionableFailure?asFailure(check.firstActionableFailure):check.failures[0]?asFailure(check.failures[0]):null});
}

/** Executor-side packaging does not validate the packet or grant acceptance. */
export function createReviewPacket(stateInput: unknown, milestone: string, risks: string[], authorize: (path:string)=>boolean, previousInput?: unknown): ReviewPacket {
  const state = reviewStateSchema.parse(stateInput), previous = previousInput === undefined ? undefined : reviewPacketSchema.parse(previousInput);
  const checks = state.evidence.flatMap((reference,i) => readReport(reference,authorize).checks.map((check,j) => claim(i,j,check)));
  return reviewPacketSchema.parse({version:1,milestone,state,checks,firstFailure:checks.find(c=>c.firstFailure!==null)??null,risks,deltaSinceLastReview:reviewDelta(state,previous,risks)});
}

/** Native root observations MUST be collected independently and refreshed when
 * Git/config/check/CI state changes. This helper cannot authenticate that caller
 * provenance. It verifies current authorized bytes and expands contradictions;
 * it does not replace relevant diff inspection, check reruns, or root review.
 */
export function verifyReviewPacket(packetInput: unknown, independentlyObservedState: unknown, authorize: (path:string)=>boolean, previousInput?: unknown) {
  const packet = reviewPacketSchema.parse(packetInput), current = reviewStateSchema.parse(independentlyObservedState);
  const previous = previousInput === undefined ? undefined : reviewPacketSchema.parse(previousInput);
  const issues: Issue[] = [];
  const issue = (kind: Issue['kind'],code:string,locator:string,reason:string) => issues.push({kind,code,locator,reason});
  for(const [name,a,b] of [['repository',packet.state.repository,current.repository],['candidate',packet.state.candidate,current.candidate],
    ['scope',packet.state.scope,current.scope],['diff',packet.state.diff,current.diff],['evidence',packet.state.evidence,current.evidence],['requiredChecks',packet.state.requiredChecks,current.requiredChecks],['ci',packet.state.ci,current.ci]] as const)
    if(!equal(a,b))issue('contradictory',`${name}-mismatch`,`state.${name}`,'child declaration differs from independent root observation');
  if(packet.deltaSinceLastReview.previous!==null&&!previous)issue('needs-evidence','prior-review-unavailable','deltaSinceLastReview','prior root-retained packet unavailable; expand full current evidence');
  else if(!equal(packet.deltaSinceLastReview,reviewDelta(packet.state,previous,packet.risks)))issue('contradictory','delta-mismatch','deltaSinceLastReview','declared delta omits or changes independently recomputed entries');
  const scopePaths = current.scope.map(f=>f.path);
  if(!equal(scopePaths,[...new Set(scopePaths)].sort()))issue('contradictory','scope-order','state.scope','scope must be complete, unique and sorted');
  if(new Set(current.requiredChecks.map(c=>revisionDigest([c.command,c.cwd]))).size!==current.requiredChecks.length)
    issue('contradictory','required-check-inventory','state.requiredChecks','root check inventory must contain unique command/cwd pairs');
  try {if(!isAbsolute(current.repository)||realpathSync(current.repository)!==current.repository)throw new Error();}
  catch {issue('needs-evidence','repository-unavailable','state.repository','canonical absolute repository identity required');}
  for(const entry of current.scope) {
    const path = resolve(current.repository,entry.path), rel = relative(current.repository,path);
    if(rel === '..' || rel.startsWith('..'+sep) || isAbsolute(rel)) {issue('contradictory','scope-escape',entry.path,'path escapes repository');continue;}
    try {
      if(entry.sha256 === null) {
        if(existsSync(path) || entry.mode !== null)issue('contradictory','deleted-file-changed',entry.path,'declared deletion is not current');
      } else {
        const bytes = readAuthorized(path,authorize,16*1024*1024), mode = lstatSync(path).mode;
        if(bytes.partial || bytes.canonical !== path || lstatSync(path).isSymbolicLink())throw new Error('unsupported source');
        if(digest(bytes.data)!==entry.sha256 || (mode&0o111?'100755':'100644')!==entry.mode)issue('contradictory','file-revision',entry.path,'current file bytes/mode differ from root observation');
      }
    } catch {issue('needs-evidence','source-unavailable',entry.path,'current authorized source unavailable or unsupported');}
  }
  try {readReference(current.diff,authorize);} catch(error) {issue(error instanceof ReviewReadError?error.kind:'needs-evidence','diff-digest','state.diff','current diff artifact missing, unauthorized, changed or incomplete');}
  const observations: {report:number;index:number;observedAt:string|null;claim:z.infer<typeof checkClaim>}[] = [];
  let completeInventory = true;
  for(const [i,reference] of current.evidence.entries()) {
    try {
      const report = readReport(reference,authorize);
      if(report.source?.kind === 'github') {
        const expectedCI=current.ci?.find(c=>c.report===i);
        if(!expectedCI)issue('needs-evidence','ci-witness-unavailable',`evidence[${i}]`,'independent current run/attempt/head/job selection required');
        else {
          const actualCI={report:i,host:report.source.host,repository:report.source.repository,run:report.source.run,attempt:report.source.attempt,
            headSha:typeof report.source.headSha==='string'?report.source.headSha.toLowerCase():null,
            jobs:[...new Set(report.checks.map(c=>c.sourceIdentity?.job??report.source?.job).filter(j=>typeof j==='number'))].sort((a,b)=>Number(a)-Number(b))};
          if(!actualCI.host||!actualCI.repository||!Number.isSafeInteger(actualCI.run)||!Number.isSafeInteger(actualCI.attempt)||!actualCI.headSha)
            issue('needs-evidence','ci-metadata-unavailable',`evidence[${i}]`,'incomplete report CI identity cannot establish a match');
          else if(!equal(actualCI,{...expectedCI,headSha:expectedCI.headSha.toLowerCase(),jobs:[...expectedCI.jobs].sort((a,b)=>a-b)}))
            issue('contradictory','ci-identity',`evidence[${i}]`,'report run/attempt/head/job selection differs from independent current CI observation');
        }
        if(typeof report.source.headSha==='string'&&report.source.headSha.toLowerCase()!==current.candidate.sha.toLowerCase())issue('contradictory','ci-candidate',`evidence[${i}]`,'CI head differs from current candidate SHA');
        if(report.verification?.remoteFreshness !== 'retrieved observation; not continuously polled')
          issue('needs-evidence','remote-freshness',`evidence[${i}]`,'local digest identity does not establish current remote freshness; independently refresh selected CI state');
      }
      for(const [j,check] of report.checks.entries()) {
        const actual = claim(i,j,check);observations.push({report:i,index:j,observedAt:check.observedAt??null,claim:actual});
        if(!actual.command||!actual.cwd) {completeInventory=false;issue('needs-evidence','check-identity',`evidence[${i}].checks[${j}]`,'exact command/cwd unavailable; cannot bind this observation to a required check');}
        if(!equal(packet.checks.find(c=>c.report===i&&c.index===j),actual))issue('contradictory','check-claim',`evidence[${i}].checks[${j}]`,'check was omitted or summary disagrees with independently read report');
        const raw = readReference(check.references[0],authorize), parsed = extractTests(raw.toString('utf8'));
        if(!equal(check.counts??null,parsed.counts) || !equal(check.failures.map(asFailure),parsed.failures.map(asFailure))
          || parsed.exit!==null && parsed.exit!==check.exit && check.decision!=='contradictory')
          issue('contradictory','raw-test-results',`evidence[${i}].checks[${j}]`,'report counters/failures/exit disagree with authorized source bytes');
        if(actual.decision==='supported'&&(actual.failureCount!==0||actual.firstFailure!==null))
          issue('contradictory','failure-summary',`evidence[${i}].checks[${j}]`,'success contradicts reported failure count/first failure');
        const expected = current.requiredChecks.find(c=>c.command===actual.command&&c.cwd===actual.cwd);
        if(expected && expected.exit!==actual.exit)issue('contradictory','command-exit',`evidence[${i}].checks[${j}]`,'check exit differs from independent root observation');
        if(actual.decision==='failed'||actual.decision==='contradictory'||(parsed.counts?.failed??0)>0||parsed.failures.length||actual.exit!==null&&actual.exit!==0)
          issue('contradictory','failed-check',`evidence[${i}].checks[${j}]`,'known failing/contradictory check cannot establish review readiness');
        else if(check.completeness!=='complete'||parsed.certainty!=='known'||actual.exit===null||actual.decision!=='supported'||expected?.exit===null)
          issue('needs-evidence','incomplete-check',`evidence[${i}].checks[${j}]`,'unknown, incomplete or unverified check requires focused evidence');
      }
    } catch(error) {completeInventory=false;issue(error instanceof ReviewReadError?error.kind:'needs-evidence','evidence-digest',`evidence[${i}]`,'report or source artifact missing, unauthorized, changed or unsupported');}
  }
  for(const required of current.requiredChecks)
    if(!observations.some(o=>o.claim.command===required.command&&o.claim.cwd===required.cwd))issue(completeInventory?'contradictory':'needs-evidence','missing-required-check','state.requiredChecks','required command/cwd omitted or unavailable in evidence');
  if(completeInventory&&packet.checks.length!==observations.length)issue('contradictory','check-inventory','checks','check inventory is incomplete or contains unobserved entries');
  if(current.ci&&(new Set(current.ci.map(c=>c.report)).size!==current.ci.length||current.ci.some(c=>c.report>=current.evidence.length)))
    issue('contradictory','ci-witness-inventory','state.ci','CI witnesses must uniquely identify existing reports');
  const firstFailure = observations.map(o=>o.claim).find(c=>c.firstFailure!==null)??null;
  if(completeInventory&&!equal(packet.firstFailure,firstFailure))issue('contradictory','first-failure','firstFailure','first failure was omitted or altered');
  const delta = reviewDelta(current,previous,packet.risks);
  return {version:1,decision:issues.some(i=>i.kind==='contradictory')?'contradictory':issues.length?'needs-evidence':'ready-for-independent-review',
    authority:'root-only acceptance; fresh independent Git/check/CI observations and relevant diff inspection remain required',
    candidate:current.candidate,issues,deltaSinceLastReview:delta,
    expand:{files:delta.files,diff:delta.diffChanged?current.diff:null,evidence:delta.evidence,risks:delta.risksChanged?packet.risks:[],contradictions:issues.map(i=>i.locator)},
    verified:{files:current.scope.length,reports:current.evidence.length,checks:observations.length},
    observations,risks:packet.risks,unchangedEvidence:current.evidence.length-delta.evidence.length,
    freshness:'authorized bytes checked now; witness provenance/remote freshness cannot be inferred from digests or timestamps'};
}
