import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { REQUIRED_FILES } from "../../scripts/runtime-preflight.mjs";

const plugin = resolve(import.meta.dirname, "../..");
let root: string, workspace: string, policy: string, client: Client;
const clients: Client[] = [];
const sha = "a".repeat(40);
const fakeGh = `#!/usr/bin/env node
const fs=require('node:fs'),a=process.argv.slice(2),mode=fs.readFileSync(process.env.FAKE_MODE,'utf8');
fs.appendFileSync(process.env.FAKE_ARGV,JSON.stringify(a)+'\\n');
if(process.env.GH_TOKEN!=='ghp_FAKE_PRIVATE_TOKEN')process.exit(9);
if(a[0]==='auth'){
 if(mode==='auth'){console.error('PRIVATE_AUTH_STDERR ghp_FAKE_PRIVATE_TOKEN');process.exit(1);}
 console.log('authenticated ghp_FAKE_PRIVATE_TOKEN');
}else if(a.at(-1).endsWith('/jobs?per_page=100')){
 console.log(JSON.stringify({total_count:1,jobs:[{id:20,run_id:10,run_attempt:2,head_sha:'${sha}'}]}));
}else if(a.at(-1).endsWith('/attempts/2')){
 console.log(JSON.stringify({id:10,run_attempt:2,head_sha:'${sha}',repository:{full_name:'owner/repo'},updated_at:'2026-10-18T01:00:00Z',status:'completed'}));
}else if(a.at(-1).endsWith('/logs')){
 if(mode==='cancel'){
  fs.writeFileSync(process.env.FAKE_PID,String(process.pid));process.stdout.write('TAP version 13\\n');setInterval(()=>{},1000);
 }else{
 console.log('TAP version 13');
 for(let i=1;i<=20;i++)console.log('not ok '+i+' - failure-'+i+'\\n  ---\\n  message: expected true, received false\\n  context: '+('context detail '.repeat(300))+'\\n  ...');
 console.log('1..20');
 }
}else process.exit(8);
`;

function parsed(result: any): any {
  const text = result.content.find((c: any) => c.type === "text").text;
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(2048);
  expect(text).not.toMatch(/ghp_FAKE_PRIVATE_TOKEN|PRIVATE_AUTH_STDERR/);
  return JSON.parse(text);
}
function reportPath(result: any): string {
  const data = parsed(result);
  const path = data.overflow?.manifest?.path ?? data.references?.path;
  if (path) return path;
  const id = data.overflow?.manifestId;
  const visit = (dir: string): string | undefined => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === id) return join(p, "report.json");
        const found = visit(p); if (found) return found;
      }
    }
  };
  return visit(join(workspace, ".gestalt"))!;
}
async function launch(session: string): Promise<Client> {
  const env = Object.fromEntries(Object.entries({ ...process.env,
    CONTEXT_MODE_WORKSPACE: workspace, CODEX_HOME: join(root, "codex-home"), CODEX_THREAD_ID: session,
    GESTALT_HOME: join(root, "gestalt-home"), CONTEXT_MODE_PLATFORM: "codex",
    CONTEXT_MODE_BRIDGE_DEPTH: "", CONTEXT_MODE_BRIDGE_IDLE_MS: "",
    GH_TOKEN: "ghp_FAKE_PRIVATE_TOKEN", FAKE_MODE: join(root, "mode"), FAKE_ARGV: join(root, "argv"), FAKE_PID: join(root, "gh-pid"),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${join(root, "read-audit.cjs")}`].filter(Boolean).join(" "),
    PATH: `${root}:${process.env.PATH}`,
  }).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(plugin, "start.mjs")], cwd: plugin, env, stderr: "pipe" });
  // Consume bounded diagnostics without returning runtime output to the test reporter.
  transport.stderr?.on("data", () => {});
  const c = new Client({ name: "packaged-evidence-test", version: "1" });
  clients.push(c); await c.connect(transport); return c;
}
const call = (args: Record<string, unknown>, c = client) => c.callTool({ name: "ctx_test_evidence", arguments: args });

describe.skipIf(process.platform === "win32")("packaged test evidence MCP", () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "context-evidence-package-")); workspace = join(root, "workspace");
    mkdirSync(workspace); mkdirSync(join(workspace, ".claude")); policy = join(workspace, ".claude", "settings.json");
    writeFileSync(policy, "{}"); writeFileSync(join(root, "mode"), "success"); writeFileSync(join(root, "gh"), fakeGh); chmodSync(join(root, "gh"), 0o755);
    writeFileSync(join(root, "read-audit.cjs"), `const fs=require('node:fs');const open=fs.openSync;fs.openSync=function(path,...args){if(String(path).endsWith('/invalid-optional.json'))fs.appendFileSync(${JSON.stringify(join(root, "read-audit"))},'read\\n');return open.call(this,path,...args)};require('node:module').syncBuiltinESMExports();`);
    const runtime = join(root, "gestalt-home", "runtime", "context-mode"); mkdirSync(runtime, { recursive: true });
    // Exercise the real shipped start.mjs/preflight/bundle with an isolated runtime.
    // The local lockfile dependencies are shared read-only; no installation/service runs.
    symlinkSync(join(plugin, "node_modules"), join(runtime, "node_modules"), "dir");
    for (const relative of [...REQUIRED_FILES.filter((p: string) => !p.startsWith("node_modules/")), "package.json"]) {
      const target = join(runtime, relative); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(plugin, relative), target);
    }
    const files = Object.fromEntries(REQUIRED_FILES.map((p: string) => [p, createHash("sha256").update(readFileSync(join(runtime, p))).digest("hex")]));
    writeFileSync(join(runtime, ".context-mode-prepared.json"), JSON.stringify({ schemaVersion: 2, packageVersion: JSON.parse(readFileSync(join(plugin, "package.json"), "utf8")).version, nodeModulesAbi: process.versions.modules, platform: process.platform, arch: process.arch, files }));
    client = await launch("package-evidence-a");
  });
  afterEach(() => { writeFileSync(policy, "{}"); writeFileSync(join(root, "mode"), "success"); });
  afterAll(async () => { for (const c of clients) await c.close(); if (root) rmSync(root, { recursive: true, force: true }); });

  it("discovers one typed tool with bounded descriptions and no credential fields", async () => {
    const { tools } = await client.listTools(); const matches = tools.filter(t => t.name === "ctx_test_evidence");
    expect(matches).toHaveLength(1); expect(Buffer.byteLength(matches[0].description!)).toBeLessThan(300);
    expect(tools.reduce((n, t) => n + Buffer.byteLength(t.description ?? ""), 0)).toBeLessThanOrEqual(3000);
    const schema = matches[0].inputSchema as any;
    expect(schema.properties.github.properties.run.type).toBe("integer"); expect(schema.properties.files.type).toBe("array");
    expect(JSON.stringify(schema)).not.toMatch(/token|password|credential/i);
  });
  it("invokes authenticated fake gh and preserves failures behind bounded provenance references", async () => {
    const result = await call({ operation: "github", github: { repository: "owner/repo", run: 10, attempt: 2, job: 20 } });
    const summary = parsed(result); expect(summary.decision).toBe("failed");
    const report = JSON.parse(readFileSync(reportPath(result), "utf8"));
    expect(report.source).toMatchObject({ host: "github.com", repository: "owner/repo", run: 10, attempt: 2, job: 20, headSha: sha });
    expect(report.checks[0].failures).toHaveLength(20); expect(report.checks[0].failures[19].id).toBe("TAP:20 failure-20"); expect(report.checks[0].exit).toBeNull();
    expect(report.checks[0].sourceIdentity.job).toBe(20);
    const argv = readFileSync(join(root, "argv"), "utf8"); expect(argv).toContain("actions/jobs/20/logs"); expect(argv).not.toContain("ghp_");
  });
  it("ingests authorized local files and attributes indexed chunks to this session", async () => {
    writeFileSync(join(workspace, "local.json"), JSON.stringify({ version: 1, tests: [{ id: "works", status: "passed" }], exitCode: 0 }));
    const result = await call({ operation: "local", files: [{ path: "local.json", command: "npm test", exit: 0, cwd: workspace }] });
    const report = JSON.parse(readFileSync(reportPath(result), "utf8")); expect(report.decision).toBe("supported"); expect(report.checks[0].index.sourceId).toBeGreaterThan(0);
    const contentRoot = resolve(reportPath(result), "../../../..");
    const db = new Database(join(contentRoot, readdirSync(contentRoot).find(p => p.endsWith(".db"))!), { readonly: true });
    try { const rows = db.prepare("SELECT DISTINCT session_id FROM chunks WHERE source_id=?").all(report.checks[0].index.sourceId); expect(rows).toEqual([{ session_id: "package-evidence-a" }]); } finally { db.close(); }
  });
  it("denies external, symlink-escaped and Read-denied local files", async () => {
    const outside = join(root, "outside.json"); writeFileSync(outside, "PRIVATE_OUTSIDE"); symlinkSync(outside, join(workspace, "escaped.json"));
    writeFileSync(join(workspace, "denied.json"), "PRIVATE_DENIED"); writeFileSync(policy, JSON.stringify({ permissions: { deny: ["Read(denied.json)"] } }));
    for (const path of [outside, "escaped.json", "denied.json"]) {
      const result = await call({ operation: "local", files: [{ path }] }); const data = parsed(result);
      expect(data.decision).toBe("needs-evidence"); expect(JSON.stringify(data)).not.toMatch(/PRIVATE_OUTSIDE|PRIVATE_DENIED/);
      const report = JSON.parse(readFileSync(reportPath(result), "utf8")); expect(report.checks[0].index).toBeUndefined();
    }
  });
  it("enforces concrete gh argv policy before API requests", async () => {
    writeFileSync(join(root, "argv"), ""); writeFileSync(policy, JSON.stringify({ permissions: { deny: ["Bash(gh api *)"] } }));
    const result = await call({ operation: "github", github: { repository: "owner/repo", run: 10, attempt: 2 } }); expect(result.isError).toBe(true); parsed(result);
    expect(readFileSync(join(root, "argv"), "utf8")).not.toContain('"api"');
  });
  it("bounds invalid selector/hostile-key errors without reflecting values", async () => {
    const hostile = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`ghp_FAKE_PRIVATE_TOKEN-${i}`, "PRIVATE_AUTH_STDERR"]));
    for (const args of [{ operation: "github", github: { repository: "owner/repo; echo PRIVATE_AUTH_STDERR", run: 10, attempt: 2 } }, { operation: "local", files: [{ path: 1 }], ...hostile }]) {
      const result = await call(args); expect(result.isError).toBe(true); expect(parsed(result).reason).toBe("invalid evidence request");
    }
  });
  it("rejects malformed present optional fields before gh, file reads or indexing", async () => {
    writeFileSync(join(workspace, "invalid-optional.json"), JSON.stringify({ version: 1, tests: [{ id: "must-not-index", status: "passed" }], exitCode: 0 }));
    writeFileSync(join(workspace, "baseline.json"), JSON.stringify({ version: 1, tests: [{ id: "baseline", status: "passed" }], exitCode: 0 }));
    const baseline = await call({ operation: "local", files: [{ path: "baseline.json" }] });
    const path = reportPath(baseline), id = dirname(path).split(/[\\/]/).at(-1)!;
    const contentRoot = resolve(path, "../../../.."), dbPath = join(contentRoot, readdirSync(contentRoot).find(p => p.endsWith(".db"))!);
    const db = new Database(dbPath, { readonly: true });
    const before = db.prepare("SELECT count(*) AS count FROM sources").get();
    const argvBefore = readFileSync(join(root, "argv"), "utf8");
    const local = { operation: "local", files: [{ path: "invalid-optional.json" }] };
    const followup = { operation: "followup", report: id };
    const github = { operation: "github", github: { repository: "owner/repo", run: 10, attempt: 2 } };
    try {
      for (const args of [
        { ...local, candidate: { sha: "bad" } },
        { ...local, candidate: { sha, branch: 5 } },
        { ...local, milestone: { invalid: true } },
        { ...local, offset: -1 }, { ...local, maxBytes: 99999 },
        { ...local, offset: 0 }, { ...local, maxBytes: 512 },
        { ...followup, offset: -1 }, { ...followup, offset: "0" }, { ...followup, maxBytes: 99999 },
        { ...local, github: { repository: "bad", run: 10, attempt: 2 } },
        { ...local, report: "../foreign" }, { ...local, github: null },
        { ...github, files: "invalid" }, { ...followup, files: [{ path: 5 }] },
        { ...followup, candidate: { sha } }, { ...github, offset: 0 },
      ]) {
        const result = await call(args); expect(result.isError).toBe(true);
        expect(parsed(result).reason).toBe("invalid evidence request");
      }
      expect(readFileSync(join(root, "argv"), "utf8")).toBe(argvBefore);
      expect(existsSync(join(root, "read-audit"))).toBe(false);
      expect(db.prepare("SELECT count(*) AS count FROM sources").get()).toEqual(before);
      // Positive control: missing optionals remain valid, and the read/index
      // probes must detect the same file when an authorized request reaches it.
      expect(parsed(await call(local)).decision).toBe("supported");
      expect(readFileSync(join(root, "read-audit"), "utf8")).toContain("read");
      expect(db.prepare("SELECT count(*) AS count FROM sources").get()).toEqual({ count: (before as { count: number }).count + 1 });
    } finally { db.close(); }
  });
  it("returns usable bounded authentication failure evidence", async () => {
    writeFileSync(join(root, "mode"), "auth");
    const result = await call({ operation: "github", github: { repository: "owner/repo", run: 10, attempt: 2 } }); expect(result.isError).toBe(true); parsed(result);
    const report = JSON.parse(readFileSync(reportPath(result), "utf8")); expect(report.source.reason).toBe("authentication"); expect(report.decision).toBe("needs-evidence");
  });
  it("forwards MCP cancellation to the gh child and releases capture permits", async () => {
    writeFileSync(join(root, "mode"), "cancel");
    const controller = new AbortController();
    const pending = client.callTool({ name: "ctx_test_evidence", arguments: { operation: "github", github: { repository: "owner/repo", run: 10, attempt: 2 } } }, undefined, { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow();
    const deadline = Date.now() + 4000;
    while (!existsSync(join(root, "gh-pid")) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    expect(existsSync(join(root, "gh-pid"))).toBe(true);
    const pid = Number(readFileSync(join(root, "gh-pid"), "utf8")); controller.abort(); await rejected;
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    while (alive() && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    expect(alive()).toBe(false); await new Promise(r => setTimeout(r, 50)); writeFileSync(join(root, "mode"), "success");
    const next = await Promise.all([call({ operation: "github", github: { repository: "owner/repo", run: 10, attempt: 2 } }), call({ operation: "github", github: { repository: "owner/repo", run: 10, attempt: 2 } })]);
    for (const result of next) expect(parsed(result).decision).toBe("failed");
  });
  it("returns bounded followups only for this session's generated report IDs", async () => {
    writeFileSync(join(workspace, "unknown.log"), "unrecognized format");
    const result = await call({ operation: "local", files: [{ path: "unknown.log" }] });
    const path = reportPath(result), id = dirname(path).split(/[\\/]/).at(-1)!;
    const page = parsed(await call({ operation: "followup", report: id, offset: 0, maxBytes: 512 })); expect(page.encoding).toBe("utf8"); expect(page.totalBytes).toBeGreaterThan(0);
    const foreign = await launch("package-evidence-b"); const denied = await call({ operation: "followup", report: id }, foreign); expect(denied.isError).toBe(true); expect(parsed(denied).reason).toContain("scope");
    expect((await call({ operation: "followup", report: "../../etc/passwd" })).isError).toBe(true);
  });
  it("sanitizes storage failures without exposing native errors", async () => {
    writeFileSync(join(workspace, "storage.log"), "unknown"); const result = await call({ operation: "local", files: [{ path: "storage.log" }] });
    const scope = resolve(reportPath(result), "../.."), saved = scope + "-saved";
    renameSync(scope, saved); writeFileSync(scope, "PRIVATE_STORAGE_FAILURE");
    try { const failure = await call({ operation: "local", files: [{ path: "storage.log" }] }); expect(failure.isError).toBe(true); expect(parsed(failure).reason).toContain("storage"); }
    finally { rmSync(scope); renameSync(saved, scope); }
  });
});
