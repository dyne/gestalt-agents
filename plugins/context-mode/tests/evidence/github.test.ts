import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateRawSync } from "node:zlib";
import { captureGitHub, digest } from "../../src/evidence/github.js";
import { unpackEvidenceZip } from "../../src/evidence/zip.js";
import { ingestGitHubCapture } from "../../src/evidence/extract.js";

const faults = vi.hoisted(() => ({ mode: "", spawn: false, fds: new Map<number,string>() }));
vi.mock("node:fs", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...fs,
    openSync: (...args: any[]) => { if(faults.mode==='open'){faults.mode='';throw new Error('PRIVATE open failure');}const fd=(fs.openSync as any)(...args);faults.fds.set(fd,String(args[0]));return fd; },
    readFileSync: (...args: any[]) => {
      if(faults.mode==='read' && String(args[0]).endsWith('-logs-20.capture')) {faults.mode='';throw new Error('PRIVATE storage read failure');}
      return (fs.readFileSync as any)(...args);
    },
    closeSync: (fd:number) => {
      if(faults.fds.get(fd)?.endsWith('-logs-20.capture') && faults.mode.startsWith('close')) {
        const mode=faults.mode;faults.mode='';
        if(mode==='close-after') {fs.closeSync(fd);faults.fds.delete(fd);}
        throw new Error('PRIVATE storage close failure');
      }
      fs.closeSync(fd);faults.fds.delete(fd);
    },
  };
});
vi.mock("node:child_process", async () => {
  const cp=await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {...cp,spawn:(...args:any[])=>{if(faults.spawn){faults.spawn=false;throw new Error('PRIVATE synchronous spawn failure');}return (cp.spawn as any)(...args);}};
});

const sha = "a".repeat(40);
const selector = { repository: "owner/repo", run: 10, attempt: 2 };
let dir: string;
const fake = `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2), scenario = process.env.FAKE_SCENARIO;
fs.appendFileSync(process.env.FAKE_ARGV, JSON.stringify(a)+'\\n');
const endpoint = a[a.length-1];
if (a[0] === 'auth') {
 if(process.env.FAKE_EXPECT_TOKEN && process.env.GH_TOKEN!==process.env.FAKE_EXPECT_TOKEN)process.exit(8);
 if (scenario === 'auth') { console.error('ghp_PRIVATE login required'); process.exit(1); }
 console.log('authenticated ghp_PRIVATE');
} else if (endpoint.includes('/attempts/2') && !endpoint.includes('/jobs')) {
 if(scenario==='bad-json'){console.log('PRIVATE_RAW not JSON');process.exit(0);}
 console.log(JSON.stringify({id:10,run_attempt:scenario==='wrong-attempt'?1:2,head_sha:'${sha}',repository:{full_name:'owner/repo'},updated_at:'2026-10-18T01:00:00Z',status:'completed'}));
} else if (endpoint.includes('/jobs?')) {
 console.log(JSON.stringify({total_count:scenario==='pagination'?101:1,jobs:[{id:20,run_id:10,run_attempt:2,head_sha:'${sha}'}]}));
} else if (endpoint.endsWith('/zip')) {
 const b=Buffer.from(process.env.FAKE_ZIP,'base64');
 process.stdout.write(scenario==='partial-zip'?b.subarray(0,20):b);
 if(scenario==='partial-zip')process.exitCode=4;
} else if (endpoint.includes('/artifacts/')) {
 console.log(JSON.stringify({id:30,expired:scenario==='expired-artifact',size_in_bytes:scenario==='big-artifact'?999999999:200,workflow_run:{id:10,head_sha:'${sha}'}}));
} else if(endpoint.endsWith('/logs')) {
 if(scenario==='timeout'||scenario==='cancel') { process.stdout.write('PARTIAL_PRIVATE'); setInterval(()=>{},1000); }
 else if(scenario==='rate') {console.error('HTTP 429 rate limit ghp_PRIVATE');process.exit(1);}
 else if(scenario==='missing-log') {console.error('HTTP 410 expired ghp_PRIVATE');process.exit(1);}
 else if(scenario==='exit') {console.error('PRIVATE_RAW ghp_PRIVATE');process.exit(7);}
 else if(scenario==='partial') {process.stdout.write('PARTIAL_PRIVATE');process.exitCode=3;}
 else if(scenario==='oversize') {process.stdout.write('PRIVATE_RAW'.repeat(1000));}
 else console.log('PRIVATE_RAW test log ghp_PRIVATE');
} else process.exit(9);
`;
function zip(name = "results.txt", compressed = false): Buffer {
  const n = Buffer.from(name), data = compressed ? deflateRawSync(Buffer.from("hello")) : Buffer.from("hello");
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50);local.writeUInt16LE(compressed?8:0,8); local.writeUInt32LE(0x3610a686,14); local.writeUInt32LE(data.length,18);local.writeUInt32LE(5,22);local.writeUInt16LE(n.length,26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50);central.writeUInt16LE(compressed?8:0,10);central.writeUInt32LE(0x3610a686,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(5,24);central.writeUInt16LE(n.length,28);
  const end = Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+n.length,12);end.writeUInt32LE(30+n.length+data.length,16);
  return Buffer.concat([local,n,data,central,n,end]);
}
beforeEach(() => {
  faults.mode='';faults.spawn=false;faults.fds.clear();
  dir = mkdtempSync(join(tmpdir(), "evidence-gh-test-"));
  writeFileSync(join(dir,"gh"),fake);chmodSync(join(dir,"gh"),0o755);
  vi.stubEnv("PATH", `${dir}:${process.env.PATH}`);
  vi.stubEnv("FAKE_ARGV",join(dir,"argv"));vi.stubEnv("FAKE_SCENARIO", "success");vi.stubEnv("FAKE_ZIP",zip().toString("base64"));
});
afterEach(() => {vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});});
const options = () => ({storageRoot:join(dir,"captures"),timeoutMs:5000});

describe("authenticated GitHub transport", () => {
  it("captures selected attempt, logs and artifact outside results with verifiable references",async()=>{
    vi.stubEnv("GH_TOKEN","ghp_PRIVATE");vi.stubEnv("FAKE_EXPECT_TOKEN","ghp_PRIVATE");
    const r = await captureGitHub({...selector,job:20,artifact:30},options());
    expect(r.completeness).toBe("complete");expect(r.headSha).toBe(sha);
    expect(r.completedAt).toBeNull();expect(r.sourceUpdatedAt).toBe("2026-10-18T01:00:00Z");
    const bytes = readFileSync(r.manifest!.path);expect(digest(bytes)).toBe(r.manifest!.sha256);
    const m = JSON.parse(bytes.toString());
    expect(m.entries.map((v:any)=>v.kind)).toContain("artifact-members");
    for(const e of m.entries) if(e.reference) expect(digest(readFileSync(e.reference.path))).toBe(e.reference.sha256);
    const args = readFileSync(join(dir,"argv"),"utf8").trim().split("\n").map(v=>JSON.parse(v));
    expect(args).toContainEqual(["api","--hostname","github.com","--method","GET","repos/owner/repo/actions/jobs/20/logs"]);
    expect(args).toContainEqual(["api","--hostname","github.com","--method","GET","repos/owner/repo/actions/runs/10/attempts/2"]);
    expect(JSON.stringify(args)).not.toContain('ghp_PRIVATE');
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(2048);
    expect(JSON.stringify(r)).not.toMatch(/PRIVATE|ghp_/);
  });
  it("ingests captured logs and members with identity/completeness, excluding auth and retrieval exits",async()=>{
    const capture=await captureGitHub({...selector,artifact:30},options());
    const indexed:string[]=[];
    const evidence=ingestGitHubCapture(capture,{storageRoot:join(dir,'reports'),authorizeRead:p=>p.startsWith(dir+'/'),index:text=>{indexed.push(text);return {sourceId:indexed.length};}});
    expect(evidence.report.source).toMatchObject({kind:'github',repository:'owner/repo',run:10,attempt:2,artifact:30,headSha:sha});
    expect(evidence.report.checks).toHaveLength(2);expect(evidence.report.checks.every((c:any)=>c.exit===null&&c.decision==='needs-evidence')).toBe(true);
    expect(indexed.some(t=>t.includes('authenticated'))).toBe(false);expect(indexed.join('')).not.toContain('ghp_PRIVATE');
    expect(Buffer.byteLength(evidence.routine)).toBeLessThanOrEqual(2048);
  });
  it("rejects a changed capture manifest without indexing foreign contents",async()=>{
    const capture=await captureGitHub(selector,options());writeFileSync(capture.manifest!.path,'PRIVATE changed manifest');
    const index=vi.fn(()=>({sourceId:1}));const evidence=ingestGitHubCapture(capture,{storageRoot:join(dir,'reports'),authorizeRead:p=>p.startsWith(dir+'/'),index});
    expect(index).not.toHaveBeenCalled();expect(evidence.report.source.reason).toBe('invalid-source');expect(evidence.routine).not.toContain('PRIVATE changed');
  });
  it.each([{...selector,repository:"owner/repo;echo secret"},{...selector,run:"10"},{...selector,attempt:0},{...selector,host:"https://github.com"},{...selector,host:"--hostname"},{...selector,token:"secret"},{...selector,repository:"owner/.."}])("rejects malformed selector %j before process creation",async s=>{
    expect((await captureGitHub(s,options())).reason).toBe("invalid-selector");
  });
  it.each([["auth","authentication"],["rate","rate-limit"],["missing-log","unavailable"],["exit","exit"],["partial","exit"],["oversize","oversize"],["wrong-attempt","invalid-source"],["bad-json","invalid-source"],["pagination","unavailable"]])("returns bounded sanitized %s evidence",async(scenario,reason)=>{
    vi.stubEnv("FAKE_SCENARIO",scenario);
    const r = await captureGitHub(selector,{...options(),maxBytes:1024});
    expect(r.reason).toBe(reason);expect(r.completeness).not.toBe("complete");expect(r.manifest).toBeDefined();
    expect(JSON.stringify(r)).not.toMatch(/PRIVATE|ghp_/);
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(2048);
    if(scenario==='partial') expect(JSON.parse(readFileSync(r.manifest!.path,"utf8")).entries.find((e:any)=>e.kind==='logs-20').state).toBe('partial');
  });
  it("handles missing gh without exposing OS errors",async()=>{
    vi.stubEnv("PATH",dir+"/missing");const r=await captureGitHub(selector,options());expect(r.reason).toBe("missing-gh");expect(r.manifest).toBeDefined();
  });
  it("kills timed out children and preserves partial captures",async()=>{
    vi.stubEnv("FAKE_SCENARIO","timeout");const r=await captureGitHub(selector,{...options(),timeoutMs:150});
    expect(r.reason).toBe("timeout");expect(r.manifest).toBeDefined();
  });
  it("cancels an in-flight child",async()=>{
    vi.stubEnv("FAKE_SCENARIO","cancel");const c=new AbortController();
    const timer=setTimeout(()=>c.abort(),500);
    const r=await captureGitHub(selector,{...options(),signal:c.signal});clearTimeout(timer);
    expect(r.reason).toBe("cancelled");expect(r.manifest).toBeDefined();
  });
  it("records cancellation before start",async()=>{
    const c=new AbortController();c.abort();const r=await captureGitHub(selector,{...options(),signal:c.signal});expect(r.reason).toBe("cancelled");
  });
  it.each([["expired-artifact","unavailable"],["big-artifact","oversize"]])("refuses %s before download",async(scenario,reason)=>{
    vi.stubEnv("FAKE_SCENARIO",scenario);const r=await captureGitHub({...selector,artifact:30},options());expect(r.reason).toBe(reason);
    expect(readFileSync(join(dir,"argv"),"utf8")).not.toContain('/30/zip');
  });
  it("rejects an unselected job",async()=>{expect((await captureGitHub({...selector,job:99},options())).reason).toBe("unavailable");});
  it("retains unsafe archive failure without extracting paths",async()=>{
    vi.stubEnv("FAKE_ZIP",zip("../escape").toString("base64"));
    expect((await captureGitHub({...selector,artifact:30},options())).reason).toBe("unsafe-archive");
  });
  it("caps simultaneous captures",async()=>{
    vi.stubEnv("FAKE_SCENARIO","timeout");
    const a=captureGitHub(selector,{...options(),timeoutMs:200});const b=captureGitHub(selector,{...options(),timeoutMs:200});
    expect((await captureGitHub(selector,options())).reason).toBe("busy");await Promise.all([a,b]);
    vi.stubEnv("FAKE_SCENARIO","success");expect((await captureGitHub(selector,options())).completeness).toBe("complete");
  });
  it("keeps partial artifact bytes behind a reference",async()=>{
    vi.stubEnv("FAKE_SCENARIO","partial-zip");const r=await captureGitHub({...selector,artifact:30},options());
    const m=JSON.parse(readFileSync(r.manifest!.path,"utf8"));
    expect(m.entries.find((e:any)=>e.kind==='artifact-zip')).toMatchObject({state:'partial',exit:4});
    expect(r.completeness).toBe('partial');
  });
  it.each(['read','close-before','close-after'])("settles %s failure after child completion, cleans up and releases permits",async mode=>{
    faults.mode=mode;
    const r=await captureGitHub(selector,options());expect(r.reason).toBe('storage');expect(r.manifest).toBeDefined();
    expect(JSON.stringify(r)).not.toContain('PRIVATE');expect(faults.fds.size).toBe(0);
    const again=await Promise.all([captureGitHub(selector,options()),captureGitHub(selector,options())]);
    expect(again.map(v=>v.completeness)).toEqual(['complete','complete']);expect(faults.fds.size).toBe(0);
  });
  it("closes capture fd on synchronous spawn rejection and releases permits",async()=>{
    faults.spawn=true;const r=await captureGitHub(selector,options());
    expect(r.reason).toBe('authentication');expect(faults.fds.size).toBe(0);expect(JSON.stringify(r)).not.toContain('PRIVATE');
    expect((await Promise.all([captureGitHub(selector,options()),captureGitHub(selector,options())])).map(v=>v.completeness)).toEqual(['complete','complete']);
  });
  it("settles synchronous open rejection without leaking capture permits",async()=>{
    faults.mode='open';const r=await captureGitHub(selector,options());expect(r.reason).toBe('storage');expect(faults.fds.size).toBe(0);
    expect((await Promise.all([captureGitHub(selector,options()),captureGitHub(selector,options())])).map(v=>v.completeness)).toEqual(['complete','complete']);
  });
  it("preserves inherited permission preloads for every child",async()=>{
    const preload=join(dir,'permission.cjs'), audit=join(dir,'permission-audit');
    writeFileSync(preload,`require('node:fs').appendFileSync(${JSON.stringify(audit)},'restricted\\n')`);
    vi.stubEnv('NODE_OPTIONS',`--require=${preload}`);
    const r=await captureGitHub({...selector,artifact:30},options());expect(r.completeness).toBe('complete');
    const calls=readFileSync(join(dir,'argv'),'utf8').trim().split('\n').length;
    expect(readFileSync(audit,'utf8').trim().split('\n').length).toBe(calls);
  });
});
describe("bounded ZIP decoding",()=>{
  it("reads stored evidence",()=>expect(unpackEvidenceZip(zip(),100)[0].data.toString()).toBe("hello"));
  it("reads deflated evidence and rejects actual expansion beyond the declared limit",()=>{
    expect(unpackEvidenceZip(zip('results.txt',true),100)[0].data.toString()).toBe('hello');
    const b=zip('results.txt',true),central=b.readUInt32LE(b.length-22+16);b.writeUInt32LE(1,central+24);b.writeUInt32LE(1,22);
    expect(()=>unpackEvidenceZip(b,100)).toThrow();
  });
  it.each(["../escape","/absolute","C:drive","a\\b","a/../b","a/./b","bad\u0000name"])("rejects unsafe path %s", name=>expect(()=>unpackEvidenceZip(zip(name),100)).toThrow());
  it("rejects invalid and oversized data",()=>{
    expect(()=>unpackEvidenceZip(Buffer.from("bad"),100)).toThrow();expect(()=>unpackEvidenceZip(zip(),4)).toThrow();
    const corrupt=zip();corrupt[30+"results.txt".length]=1;expect(()=>unpackEvidenceZip(corrupt,100)).toThrow();
  });
  it("rejects symlinks",()=>{const b=zip();b.writeUInt32LE((0xa1ff<<16)>>>0,30+"results.txt".length+5+38);expect(()=>unpackEvidenceZip(b,100)).toThrow();});
  it("rejects a declared decompression bomb before inflation",()=>{
    const b=zip();const central=30+"results.txt".length+5;b.writeUInt16LE(8,central+10);b.writeUInt32LE(0x7fffffff,central+24);
    expect(()=>unpackEvidenceZip(b,100)).toThrow();
  });
});
