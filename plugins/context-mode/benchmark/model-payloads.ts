/** Frozen invented inputs through real registered handlers; output metrics only. */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import { z } from "zod";

const HERE = dirname(fileURLToPath(import.meta.url));
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const byteLength = (value: unknown): number | null => {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return null; }
};
export function loadFrozenCorpus(directory = join(HERE, "fixtures")) {
  const bytes = readFileSync(join(directory, "model-payloads.json"));
  const manifest = JSON.parse(readFileSync(join(directory, "model-payloads.manifest.json"), "utf8"));
  assert.equal(digest(bytes), manifest.corpusSha256, "corpus differs from frozen digest");
  const corpus = JSON.parse(bytes.toString("utf8"));
  for (const [name, content] of Object.entries(corpus.files)) {
    assert.equal(digest(content as string), manifest.fileSha256[name], `invented file drift: ${name}`);
  }
  return { corpus, manifest };
}
interface Observation { tool: string; requestBytes: number; responseBytes: number | null; responseSha256: string | null; overflow: boolean; reportKind?: "audit" | "overflow" }
interface CaseResult { id: string; quality: "complete" | "unsupported"; missingFindings: string[]; observations: Observation[]; knownReturnedBytes: number; returnedBytes: number | null; requestBytes: number; descriptionBytes: number; knownTotalVisibleBytes: number; totalVisibleBytes: number | null; overflowRequestBytes: number; overflowResponseBytes: number; overflowCalls: number; routineReturnedBytes: number; routineVisibleBytes: number | null; routineDescriptionBytes: number; routineRequestBytes: number; auditRetrievalBytes: number; overflowRetrievalBytes: number; routineMissingFindings: string[] }
const text = (response: any) => response.content?.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n") ?? "";
const flush = () => new Promise<void>(done => setImmediate(done));

/** Separate process per pass: no global session/config change in the caller. */
export function runCorpusPass(pluginRoot: string) {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TEMP", "TMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key]!;
  }
  const run = spawnSync(process.execPath, [join(HERE, "../node_modules/tsx/dist/cli.mjs"),
    fileURLToPath(import.meta.url), "--worker", resolve(pluginRoot)], {
    encoding: "utf8", timeout: 60_000, env, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(run.status, 0, `isolated corpus pass failed: ${run.stderr.slice(-1500)}`);
  return JSON.parse(run.stdout);
}

function sourceIdentity(pluginRoot: string) {
  const repo = resolve(pluginRoot, "../..");
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, "cannot identify source revision"); return result.stdout;
  };
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean).sort()
    .map(path => { const value = readFileSync(join(repo, path)); return { bytes: value.length, path, sha256: digest(value) }; });
  const state = { trackedDiffSha256: digest(git(["diff", "HEAD", "--binary"])), untracked };
  return { head: git(["rev-parse", "HEAD"]).toString().trim(), dirtyDigest: digest(JSON.stringify(state)), ...state };
}

async function worker(pluginRoot: string) {
  const { corpus, manifest } = loadFrozenCorpus();
  const lockBytes = readFileSync(join(pluginRoot, "package-lock.json"));
  assert.equal(digest(lockBytes), manifest.packageLockSha256, "dependency lock differs");
  const lock = JSON.parse(lockBytes.toString());
  const dependencyVersions: Record<string, { version: string; packageSha256: string }> = {};
  for (const name of ["tsx", "better-sqlite3", "@modelcontextprotocol/sdk", "zod"]) {
    const bytes = readFileSync(join(pluginRoot, "node_modules", name, "package.json"));
    const version = JSON.parse(bytes.toString()).version;
    assert.equal(version, lock.packages[`node_modules/${name}`].version, `installed dependency drift: ${name}`);
    dependencyVersions[name] = { version, packageSha256: digest(bytes) };
  }
  const BetterSQLite = createRequire(join(pluginRoot, "package.json"))("better-sqlite3");
  const nativeProbe = new BetterSQLite(":memory:");
  try { assert.equal(nativeProbe.prepare("SELECT 1 AS ready").get().ready, 1); } finally { nativeProbe.close(); }
  const root = realpathSync(mkdtempSync(join(os.tmpdir(), "model-payload-corpus-")));
  const workspace = join(root, "workspace"); mkdirSync(workspace); mkdirSync(join(root, "isolated-home"));
  // Baseline legacy analytics can enumerate host homes. Stub the home resolver
  // inside this disposable child instead of inspecting any real user records.
  os.homedir = () => join(root, "isolated-home"); syncBuiltinESMExports();
  const sid = "synthetic-corpus-session";
  Object.assign(process.env, { CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS: "1", CONTEXT_MODE_PLATFORM: "codex",
    CONTEXT_MODE_WORKSPACE: workspace,
    CONTEXT_MODE_DIR: join(workspace, ".gestalt", "context-mode"), CODEX_THREAD_ID: sid,
    CLAUDE_CONFIG_DIR: join(root, "isolated-home", ".claude"), XDG_CONFIG_HOME: join(root, "isolated-home", "config") });
  process.chdir(workspace);
  const cases: CaseResult[] = [];
  try {
    for (const [name, content] of Object.entries(corpus.files)) writeFileSync(join(workspace, name), content as string);
    const runtime = await import(pathToFileURL(join(pluginRoot, "src/server.ts")).href);
    const tools = runtime.REGISTERED_CTX_TOOLS as any[];
    const dbApi = await import(pathToFileURL(join(pluginRoot, "src/session/db.ts")).href);
    const databasePath = dbApi.resolveSessionDbPath({ projectDir: workspace, sessionsDir: join(workspace, ".gestalt", "context-mode", "sessions") });
    mkdirSync(dirname(databasePath), { recursive: true });
    const seed = new dbApi.SessionDB({ dbPath: databasePath }); seed.ensureSession(sid, workspace); seed.close();

    let records: Observation[] = [];
    const call = async (name: string, args: Record<string, unknown>, overflow = false) => {
      const tool = tools.find(tool => tool.name === name); assert.ok(tool, `missing handler ${name}`);
      const response = await tool.handler(args); await flush();
      if (response.isError && !name.startsWith("ctx_fixture_")) throw new Error(`${name}: ${text(response).slice(0, 1000)}`);
      const bytes = byteLength(response);
      records.push({ tool: name, requestBytes: byteLength({ name, arguments: args })!, responseBytes: bytes,
        responseSha256: bytes === null ? null : digest(JSON.stringify(response)), overflow });
      return response;
    };
    // Follow only handles returned by the real handler, rechecking authorization
    // through its public continuation path. Every request/envelope is measured.
    const recover = async (response: any) => {
      let seen = text(response), pending = seen;
      const visited = new Set<string>();
      for (;;) {
        const handles = [...new Set(pending.match(/report-[a-f0-9]{64}/g) ?? [])].filter(id => !visited.has(id));
        if (!handles.length) return seen;
        pending = "";
        for (const handle of handles) {
          visited.add(handle);
          let offset: number | null = 0, body = "";
          const start = records.length;
          while (offset !== null) {
            assert.ok(records.length - start < 10000, "continuation failed to terminate");
            const page = await call("ctx_search", { response_report: handle, response_offset: offset }, true);
            assert.ok(byteLength(page)! <= 2048, "continuation exceeds whole-envelope budget");
            const value = JSON.parse(text(page));
            assert.equal(value.offset, offset); assert.equal(typeof value.chunk, "string");
            body += value.chunk;
            assert.ok(value.nextOffset === null || value.nextOffset > offset, "continuation did not advance");
            offset = value.nextOffset;
          }
          assert.equal(digest(body), handle.slice(7), "retrieved evidence digest mismatch");
          const parsed = JSON.parse(body);
          const reportKind = Array.isArray(parsed.sources) && parsed.operationId ? "audit" : "overflow";
          for (const record of records.slice(start)) record.reportKind = reportKind;
          seen += "\n" + body; pending += "\n" + body;
        }
      }
    };
    const finish = (id: string, quality: CaseResult["quality"], findings: string[], seen: string, routineSeen = seen) => {
      const descriptions = [...new Set(records.map(row => row.tool))].reduce((sum, name) =>
        sum + Buffer.byteLength(tools.find(tool => tool.name === name)?.config.description ?? ""), 0);
      const routine = records.filter(row => !row.overflow);
      const routineDescriptionBytes = [...new Set(routine.map(row => row.tool))].reduce((sum, name) =>
        sum + Buffer.byteLength(tools.find(tool => tool.name === name)?.config.description ?? ""), 0);
      const routineVisibleBytes = routine.every(row => row.responseBytes !== null)
        ? routine.reduce((sum, row) => sum + row.requestBytes + row.responseBytes!, routineDescriptionBytes) : null;
      const known = records.reduce((sum, row) => sum + (row.responseBytes ?? 0), 0);
      const requests = records.reduce((sum, row) => sum + row.requestBytes, 0);
      const completeBytes = records.every(row => row.responseBytes !== null);
      const missingFindings = findings.filter(id => !seen.includes(id));
      if (missingFindings.length) process.stderr.write(`synthetic ${id} response preview: ${seen.slice(0, 1000)}\n`);
      assert.deepEqual(missingFindings, [], `missing planted findings in ${id}`);
      cases.push({ id, quality, missingFindings, observations: records, knownReturnedBytes: known,
        returnedBytes: completeBytes ? known : null, requestBytes: requests, descriptionBytes: descriptions,
        knownTotalVisibleBytes: known + requests + descriptions, totalVisibleBytes: completeBytes ? known + requests + descriptions : null,
        overflowRequestBytes: records.filter(row => row.overflow).reduce((sum, row) => sum + row.requestBytes, 0),
        overflowResponseBytes: records.filter(row => row.overflow).reduce((sum, row) => sum + (row.responseBytes ?? 0), 0),
        overflowCalls: records.filter(row => row.overflow).length,
        routineVisibleBytes, routineDescriptionBytes,
        routineReturnedBytes: records.filter(row => !row.overflow).reduce((sum, row) => sum + (row.responseBytes ?? 0), 0),
        routineRequestBytes: records.filter(row => !row.overflow).reduce((sum, row) => sum + row.requestBytes, 0),
        auditRetrievalBytes: records.filter(row => row.reportKind === "audit").reduce((sum, row) => sum + row.requestBytes + (row.responseBytes ?? 0), 0),
        overflowRetrievalBytes: records.filter(row => row.overflow && row.reportKind !== "audit").reduce((sum, row) => sum + row.requestBytes + (row.responseBytes ?? 0), 0),
        routineMissingFindings: findings.filter(id => !routineSeen.includes(id)) });
      records = [];
    };
    const evidence = async (scenario: any) => {
      const initial = await call("ctx_test_evidence", { operation: "local", files: [{ path: scenario.source,
        command: "synthetic-check", exit: 1, completeness: "complete" }], ...(scenario.candidate ? { candidate: scenario.candidate } : {}) });
      const routine = JSON.parse(text(initial));
      const handle = routine.overflow?.followup?.id ?? routine.overflow?.manifestId;
      let report = routine;
      if (handle) {
        let offset: number | null = 0, body = "";
        while (offset !== null) {
          const page = await call("ctx_test_evidence", { operation: "followup", report: handle, offset, maxBytes: 2048 }, true);
          const value = JSON.parse(text(page)); assert.equal(typeof value.data, "string");
          body += value.data; offset = value.nextOffset;
        }
        report = JSON.parse(body);
      }
      assert.equal(report.completeness, "complete");
      assert.deepEqual(report.checks[0].counts, scenario.expectedCounts);
      if (scenario.candidate) {
        assert.equal(report.candidate.sha, scenario.candidate.sha);
        assert.equal(report.candidate.dirtySha256, scenario.candidate.dirtySha256);
      }
      return JSON.stringify(report.checks[0].failures.map((failure: any) => failure.id));
    };
    for (const scenario of corpus.scenarios) {
      let seen = "", routineSeen = "", quality: CaseResult["quality"] = "complete";
      if (scenario.kind === "retrieval") {
        await call("ctx_index", { path: scenario.source, source: `synthetic:${scenario.id}` });
        const response = await call("ctx_search", { queries: scenario.queries, source: `synthetic:${scenario.id}`, limit: 5 });
        routineSeen = text(response); seen = await recover(response);
      } else if (scenario.kind === "revision") {
        const args = { path: scenario.source, language: "javascript", code: "console.log(FILE_CONTENT)" };
        await recover(await call("ctx_execute_file", args)); writeFileSync(join(workspace, scenario.source), scenario.replacement);
        const response = await call("ctx_execute_file", args); routineSeen = text(response); seen = await recover(response);
        for (const forbidden of scenario.forbiddenAfterChange) assert.ok(!seen.includes(forbidden), "stale revision returned");
      } else if (scenario.kind === "ci") {
        for (const state of scenario.states) await recover(await call("ctx_execute", { language: "javascript", code: `console.log(${JSON.stringify(JSON.stringify(state))})` }));
        seen = await evidence(scenario);
      } else if (scenario.kind === "review") {
        seen = await evidence(scenario);
      } else if (scenario.kind === "stats") {
        const response = await call("ctx_stats", {});
        let report: any;
        try { report = JSON.parse(text(response)); } catch { quality = "unsupported"; }
        if (quality === "complete") {
          assert.equal(report.accountQuotaTokens, null);
          assert.equal(report.providerTokens?.coverage ?? report.providerCoverage, scenario.candidateExpectedCoverage);
          assert.ok(byteLength(response)! <= 2048);
          if (report.overflow?.report) {
            let offset: number | null = 0, body = "";
            while (offset !== null) {
              const page = await call("ctx_stats", { report: report.overflow.report, offset }, true);
              assert.ok(byteLength(page)! <= 2048); const value = JSON.parse(text(page)); body += value.chunk; offset = value.nextOffset;
            }
            report = JSON.parse(body);
          }
          assert.equal(report.savings ? report.savings.percent : report.savingsPercent, null);
        }
      }
      finish(scenario.id, quality, scenario.expectedFindings ?? [], seen, scenario.kind === "retrieval" || scenario.kind === "revision" ? routineSeen : seen);
    }

    const semanticsPath = join(pluginRoot, "src/session/measurement-semantics.ts");
    let counters: any = { supported: false, coverage: "unknown", totals: null };
    if (existsSync(semanticsPath)) {
      const api = await import(pathToFileURL(semanticsPath).href); const results = [];
      for (const spec of corpus.counterScenarios) {
        let ledger = api.createMeasurementLedger({ captureCutoffMs: 1000 });
        for (const [i, values] of spec.readings.entries()) {
          ledger = api.recordUsageMeasurement(ledger, { captureId: `sample-${i}`, sourceId: "root", role: "root", scope: spec.scope, observedAtMs: i, counters: values });
          if (spec.compactAfter.includes(i)) ledger = JSON.parse(JSON.stringify(ledger));
        }
        const value = api.summarizeEfficiencyMeasurement(ledger);
        assert.equal(value.total.inputTokens, spec.expectedInput); assert.equal(value.total.outputTokens, spec.expectedOutput);
        assert.equal(value.coverage, spec.expectedCoverage); assert.equal(value.counterResets, spec.expectedResets);
        results.push({ id: spec.id, input: value.total.inputTokens, output: value.total.outputTokens, coverage: value.coverage });
      }
      for (const spec of corpus.counterSpecials) {
        let ledger = api.createMeasurementLedger({ captureCutoffMs: 1000, expectedChildIds: spec.expectedChildIds });
        for (const sample of spec.samples) ledger = api.recordUsageMeasurement(ledger, sample);
        const value = api.summarizeEfficiencyMeasurement(ledger);
        assert.equal(value.total.inputTokens, spec.expectedInput); assert.equal(value.total.outputTokens, spec.expectedOutput);
        assert.equal(value.coverage, spec.expectedCoverage);
        if (spec.expectedIssue) assert.ok(value.issues.some((issue: any) => issue.reason === spec.expectedIssue));
        if (spec.expectedUnknownInput) assert.equal(value.unattributed.inputTokens, spec.expectedUnknownInput);
        if (spec.expectedUnknownChildCounter) assert.ok(value.unknownChildCounters.includes(spec.expectedUnknownChildCounter));
        results.push({ id: spec.id, input: value.total.inputTokens, output: value.total.outputTokens, coverage: value.coverage });
      }
      counters = { supported: true, results };
    }
    const native = await import(pathToFileURL(join(pluginRoot, "src/db-base.ts")).href);
    const Database = native.loadDatabase();
    const responseCoverage = [];
    for (const fixture of corpus.responseFixtures) {
      const name = `ctx_fixture_${fixture.id.replaceAll("-", "_")}`;
      const value = fixture.failure ? { content: [], structuredContent: {} as any } : JSON.parse(fixture.json);
      if (fixture.failure) value.structuredContent.self = value.structuredContent;
      runtime.server.registerTool(name, { description: "Invented corpus response fixture", inputSchema: z.object({}) }, () => value);
      const returned = await call(name, {}); assert.equal(byteLength(returned), fixture.expectedBytes);
      const db = new Database(databasePath, { readonly: true });
      try {
        const row = db.prepare("SELECT data FROM session_events WHERE session_id=? AND type='tool_response_measurement' ORDER BY id DESC LIMIT 1").get(sid) as any;
        const measurement = row ? JSON.parse(row.data) : null;
        const supported = measurement?.tool === name;
        if (supported) {
          assert.equal(measurement.serializedVisibleBytes, fixture.expectedBytes);
          assert.equal(measurement.delivery, "unknown"); assert.equal(measurement.nestedToolNames, null);
        }
        responseCoverage.push({ id: fixture.id, independentlyObservedBytes: fixture.expectedBytes,
          accounting: supported ? fixture.expectedCoverage : "unknown", supported });
      } finally { db.close(); }
    }
    finish("response-boundaries", responseCoverage.every(row => row.supported) ? "complete" : "unsupported", [], "");
    return { schemaVersion: 1, corpusSha256: manifest.corpusSha256, inputFileSha256: manifest.fileSha256,
      environment: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch,
        dependencyLockSha256: manifest.packageLockSha256, dependencyVersions, nativeSQLite: true, betterSqliteNativeProbe: true, homeIsolation: "disposable child builtin resolver" },
      isolation: { credentialsInherited: false, stateShared: false, liveSessionReads: false, temporaryStateRemoved: true },
      cases, counters, responseCoverage, accountQuotaTokens: null,
      scope: "complete returned MCP result envelopes plus request JSON and descriptions; JSON-RPC framing and model/provider usage unobserved" };
  } finally { await flush(); process.chdir(HERE); rmSync(root, { recursive: true, force: true }); }
}

export function compareModelPayloads(baselinePlugin: string, candidatePlugin: string) {
  const { manifest } = loadFrozenCorpus();
  const baselineRepo = resolve(baselinePlugin, "../..");
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: baselineRepo, encoding: "utf8" });
  assert.equal(revision.status, 0); assert.equal(revision.stdout.trim(), manifest.baselineRevision, "wrong actual baseline revision");
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: baselineRepo, encoding: "utf8" });
  assert.equal(dirty.stdout.trim(), "", "baseline has source edits");
  const baselineIdentity = sourceIdentity(baselinePlugin), candidateIdentity = sourceIdentity(candidatePlugin);
  const baseline = runCorpusPass(baselinePlugin), candidate = runCorpusPass(candidatePlugin);
  assert.deepEqual(sourceIdentity(baselinePlugin), baselineIdentity, "baseline changed during comparison");
  assert.deepEqual(sourceIdentity(candidatePlugin), candidateIdentity, "candidate changed during comparison");
  assert.equal(baseline.corpusSha256, candidate.corpusSha256); assert.deepEqual(baseline.inputFileSha256, candidate.inputFileSha256);
  assert.deepEqual(baseline.environment, candidate.environment, "comparison environments differ");
  assert.ok(candidate.cases.every((row: CaseResult) => row.quality === "complete"), "candidate quality contract unsupported");
  assert.equal(candidate.counters.supported, true, "candidate counter semantics unavailable");
  assert.ok(candidate.responseCoverage.every((row: any) => row.supported), "candidate response accounting unavailable");
  const cases = candidate.cases.map((next: CaseResult) => {
    const prior = baseline.cases.find((row: CaseResult) => row.id === next.id)!;
    const findingsComparable = prior.quality === "complete" && next.quality === "complete"
      && prior.totalVisibleBytes !== null && next.totalVisibleBytes !== null;
    // New complete source/audit retrieval has broader evidence scope than a
    // baseline snippet-only response. Its costs are known, its savings are not.
    const evidenceScopeComparable = !next.observations.some(row => row.reportKind)
      && JSON.stringify(prior.observations.map(row => [row.tool, row.overflow]))
        === JSON.stringify(next.observations.map(row => [row.tool, row.overflow]));
    const comparable = findingsComparable && evidenceScopeComparable;
    const routineReduction = findingsComparable && prior.routineReturnedBytes > 0 ? 1 - next.routineReturnedBytes / prior.routineReturnedBytes : null;
    const routineVisibleReduction = findingsComparable && prior.routineVisibleBytes !== null && next.routineVisibleBytes !== null
      && prior.routineVisibleBytes > 0 ? 1 - next.routineVisibleBytes / prior.routineVisibleBytes : null;
    if (next.id === "broad-retrieval") assert.ok(routineReduction !== null && routineReduction >= 0.5
      && routineVisibleReduction !== null && routineVisibleReduction >= 0.5,
      "routine broad-query response must reduce visible bytes by at least 50% with recoverable findings");
    return { id: next.id, comparable, findingsComparable, evidenceScopeComparable,
      scopeNote: evidenceScopeComparable ? "same measured workflow scope" : "complete candidate evidence/audit retrieval adds scope; total savings incomparable",
      baselineBytes: prior.totalVisibleBytes, candidateBytes: next.totalVisibleBytes,
      visibleByteReduction: comparable && prior.totalVisibleBytes! > 0 ? 1 - next.totalVisibleBytes! / prior.totalVisibleBytes! : null,
      baselineOverflowBytes: prior.overflowRequestBytes + prior.overflowResponseBytes,
      candidateOverflowBytes: next.overflowRequestBytes + next.overflowResponseBytes,
      baselineRoutineReturnedBytes: prior.routineReturnedBytes, candidateRoutineReturnedBytes: next.routineReturnedBytes,
      routineReturnedByteReduction: routineReduction,
      baselineRoutineVisibleBytes: prior.routineVisibleBytes, candidateRoutineVisibleBytes: next.routineVisibleBytes,
      routineVisibleByteReduction: routineVisibleReduction,
      candidateAuditRetrievalBytes: next.auditRetrievalBytes, candidateNonAuditRetrievalBytes: next.overflowRetrievalBytes,
      candidateRoutineMissingFindings: next.routineMissingFindings };
  });
  return { schemaVersion: 1, baselineRevision: manifest.baselineRevision, corpusSha256: manifest.corpusSha256,
    referenceEnvironment: manifest.referenceEnvironment,
    referenceEnvironmentMatch: Object.entries(manifest.referenceEnvironment).every(([key, value]) => candidate.environment[key] === value),
    baselineIdentity, candidateIdentity, baseline, candidate, cases,
    interpretation: "Controlled invented inputs on the actual baseline revision; unsupported or incomplete scope never supports a savings claim. No live-session, latency, billing or account-quota claims." };
}

if (process.argv[2] === "--worker") {
  worker(resolve(process.argv[3])).then(report => process.stdout.write(JSON.stringify(report))).catch(error => { process.stderr.write(String(error.stack ?? error)); process.exitCode = 1; });
} else if (process.argv[2] === "--compare") {
  const report = compareModelPayloads(resolve(process.argv[3]), resolve(process.argv[4]));
  const output = JSON.stringify(report, null, 2) + "\n";
  if (process.argv[5]) writeFileSync(process.argv[5], output, { mode: 0o600 }); else process.stdout.write(output);
}
