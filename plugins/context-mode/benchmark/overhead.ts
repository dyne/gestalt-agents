/** Deterministic CI budgets; bounded diagnostics retain every failure. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { runCorpusPass } from "./model-payloads.js";
import { boundResponse, readResponsePage, responseBudgetSchema, MAX_RESPONSE_BUDGET } from "../src/response-budget.js";
import { deduplicateQueryWindows } from "../src/search/query-windows.js";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const diagnosticText = (value: string | undefined, maxBytes: number) => {
  let out = Array.from(value ?? "").slice(0, maxBytes).join("");
  while (bytes(out) > maxBytes) out = Array.from(out).slice(0, -1).join("");
  return out;
};
export const loadOverheadBudgets = () => JSON.parse(readFileSync(join(here, "fixtures/overhead-budgets.json"), "utf8"));
export type BudgetFailure = { id: string; metric: string; observed: number | null; maximum: number; detail?: string };

/** A versioned review record is evidence to inspect, never approval authority. */
export function validateBudgetAmendment(before: any, after: any) {
  const ceilings = (value: any, prefix = ""): Record<string, number> => Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
    ["amendment", "schemaVersion"].includes(key) ? [] : typeof item === "number" ? [[prefix + key, item]]
      : item && typeof item === "object" ? Object.entries(ceilings(item, prefix + key + ".")) : []));
  const old = ceilings(before), next = ceilings(after);
  const increases = Object.keys(old).filter(key => next[key] === undefined || next[key] > old[key]);
  if (!increases.length) return [];
  const record = after.amendment;
  const valid = record && typeof record.reason === "string" && record.reason.trim().length > 0
    && typeof record.evidenceReference === "string" && record.evidenceReference.trim().length > 0
    && typeof record.reviewReference === "string" && record.reviewReference.trim().length > 0
    && record.previousBudgetsSha256 === sha(JSON.stringify(before))
    && Array.isArray(record.metrics) && increases.every(key => record.metrics.includes(key));
  return valid ? [] : increases.map(metric => ({ id: "BUDGET_INCREASE_REQUIRES_REVIEW", metric,
    observed: next[metric] ?? null, maximum: old[metric], detail: "Retain prior ceiling or supply a reviewed, digest-bound amendment; reviewers must verify its references." }));
}

export function assessOverhead(measured: any, budget = loadOverheadBudgets()): BudgetFailure[] {
  const failures: BudgetFailure[] = [];
  if (budget.schemaVersion !== 1) failures.push({ id: "BUDGET_SCHEMA_INVALID", metric: "schemaVersion", observed: null, maximum: 1 });
  const check = (id: string, metric: string, observed: number | null | undefined, maximum: number) => {
    if (!Number.isSafeInteger(maximum) || maximum < 0) {
      failures.push({ id: "BUDGET_SCHEMA_INVALID", metric, observed: null, maximum: 0 }); return;
    }
    if (typeof observed !== "number" || !Number.isFinite(observed) || observed > maximum || observed < 0)
      failures.push({ id, metric, observed: observed ?? null, maximum });
  };
  check("RESPONSE_BYTES", "maxRoutineResponseBytes", measured.maxRoutineResponseBytes, budget.routineResponseBytes);
  check("EXPANSION_CEILING", "maximumExpandedResponseBytes", measured.maximumExpandedResponseBytes, budget.maximumExpandedResponseBytes);
  check("RETRIEVAL_BYTES", "retrievalReturnedBytes", measured.retrievalReturnedBytes, budget.retrievalReturnedBytes);
  check("RETRIEVAL_VISIBLE_BYTES", "retrievalVisibleBytes", measured.retrievalVisibleBytes, budget.retrievalVisibleBytes);
  for (const [group, names] of Object.entries({ profiles: ["profile-reviewer", "profile-executor"], roles: ["root", "executor", "terminal-reviewer"] }))
    for (const name of names) for (const unit of ["bytes", "words"])
      check("BOOTSTRAP_GROWTH", `${group}.${name}.${unit}`, measured[group]?.[name]?.[unit], budget[group]?.[name]?.[unit]);
  check("DISCOVERY_GROWTH", "discoveryBytes", measured.discoveryBytes, budget.discoveryBytes);
  check("DUPLICATE_WINDOW", "duplicateWindows", measured.duplicateWindows, 0);
  check("LOST_QUERY_ATTRIBUTION", "missingQueryAttributions", measured.missingQueryAttributions, 0);
  check("UNCHANGED_STATUS_WAKE", "unchangedStatusAcceptedTurns", measured.unchangedStatusAcceptedTurns, budget.unchangedStatusAcceptedTurns);
  check("DUPLICATE_WAKE", "duplicateAcceptedWakes", measured.duplicateAcceptedWakes, budget.duplicateAcceptedWakes);
  check("LOST_OVERFLOW", "overflowRecoveryFailures", measured.overflowRecoveryFailures, 0);
  check("EXPANSION_UNAVAILABLE", "explicitExpansionFailures", measured.explicitExpansionFailures, 0);
  return failures;
}

/** Accepts a sanitized trace contract, not a scheduler implementation. */
export function assessWakeTrace(events: Array<{ kind: "unchangedStatus" | "actionableWake"; wakeId: string; acceptedTurnId: string | null }>) {
  // Repeated telemetry for the same runtime turn is not another model turn.
  const accepted = [...new Map(events.filter(row => row.acceptedTurnId !== null).map(row => [row.acceptedTurnId, row])).values()];
  const duplicateAcceptedWakes = accepted.length - new Set(accepted.map(row => row.wakeId)).size;
  return { unchangedStatusAcceptedTurns: accepted.filter(row => row.kind === "unchangedStatus").length, duplicateAcceptedWakes };
}

export function collectOverhead() {
  const script = "import json,runpy;print(json.dumps(runpy.run_path('tests/plugins/gestalt/instruction-baseline.py')['inventory']()))";
  const inventory = spawnSync("python3", ["-c", script], { cwd: repository, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30_000 });
  if (inventory.status !== 0) throw new Error("instruction inventory failed; rerun python3 tests/plugins/gestalt/instruction-baseline.py for diagnostics");
  const instructions = JSON.parse(inventory.stdout);
  const corpus = runCorpusPass(resolve(here, ".."));
  if (corpus.cases.some((row: any) => row.quality !== "complete" || row.missingFindings.length)) throw new Error("frozen candidate quality incomplete");
  const responses = corpus.cases.flatMap((row: any) => row.observations);
  // L2's declared whole-envelope contract applies to exactly these four tools.
  // Evidence-followup envelopes are also measured, but have a separate legacy
  // text-report budget and must not be silently claimed as 2048-byte envelopes.
  const routineTools = ["ctx_execute", "ctx_execute_file", "ctx_batch_execute", "ctx_search"];
  const routineResponses = responses.filter((row: any) => routineTools.includes(row.tool));
  const otherResponses = responses.filter((row: any) => row.tool === "ctx_test_evidence");
  const retrieval = corpus.cases.filter((row: any) => ["broad-retrieval", "overlapping-queries"].includes(row.id));
  const source = { source: "fixture.md", title: "shared", sourceRevision: "fixture-revision", chunkId: 1,
    content: "alpha beta FAIL-DEDUP-FIXTURE" };
  const queries = Array.from({ length: 30 }, (_, index) => ({ query: index % 2 ? "alpha" : "beta", results: [source] }));
  const windows = deduplicateQueryWindows(queries);
  // macOS temporary roots can contain symlinks; artifact scopes require canonical paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "overhead-ci-")));
  let overflowRecoveryFailures = 0, explicitExpansionFailures = 0;
  try {
    const scope = { root: join(root, "reports"), authorizeRead: () => true };
    const original = { content: [{ type: "text" as const, text: "😀 padding\n".repeat(2000) + "FAIL-OVERFLOW-LATE" }], isError: true };
    const compact = boundResponse(original, scope);
    const summary = JSON.parse(compact.content[0].text);
    let body = "", offset: number | null = 0, pages = 0;
    while (offset !== null && pages++ < 1000) {
      const response = readResponsePage(scope, summary.overflow.report, offset);
      if (bytes(response) > 2048) overflowRecoveryFailures++;
      const page = JSON.parse(response.content[0].text); body += page.chunk; offset = page.nextOffset;
    }
    if (offset !== null || body !== JSON.stringify(original) || !body.includes("FAIL-OVERFLOW-LATE")) overflowRecoveryFailures++;
    const expanded = { content: [{ type: "text" as const, text: "x".repeat(3000) }] };
    if (boundResponse(expanded, scope, 4096) !== expanded || !responseBudgetSchema.safeParse({ response_bytes: 65_536 }).success
      || responseBudgetSchema.safeParse({ response_bytes: 65_537 }).success) explicitExpansionFailures++;
  } finally { rmSync(root, { recursive: true, force: true }); }
  // This fixture validates budget handling. The real scheduler regression gate
  // is Mobile's owning wake-attribution.test.ts, rerun separately at pinned SHA.
  const trace: Parameters<typeof assessWakeTrace>[0] = Array.from({ length: 30 }, () => ({ kind: "unchangedStatus", wakeId: "same-status", acceptedTurnId: null }));
  trace.push({ kind: "actionableWake", wakeId: "process-completed", acceptedTurnId: "accepted-root" });
  return { maxRoutineResponseBytes: routineResponses.some((row: any) => row.responseBytes === null) ? null
      : Math.max(...routineResponses.map((row: any) => row.responseBytes)),
    nonBudgetedEvidenceEnvelopeMaxBytes: !otherResponses.length || otherResponses.some((row: any) => row.responseBytes === null)
      ? null : Math.max(...otherResponses.map((row: any) => row.responseBytes)),
    maximumExpandedResponseBytes: MAX_RESPONSE_BUDGET,
    retrievalReturnedBytes: retrieval.reduce((sum: number, row: any) => sum + row.routineReturnedBytes, 0),
    retrievalVisibleBytes: retrieval.every((row: any) => row.routineVisibleBytes !== null)
      ? retrieval.reduce((sum: number, row: any) => sum + row.routineVisibleBytes, 0) : null,
    profiles: Object.fromEntries(Object.entries(instructions.sources).filter(([key]) => key.startsWith("profile-"))),
    roles: instructions.roles, discoveryBytes: instructions.delivery.discoveryCatalog.bytes,
    duplicateWindows: Math.max(0, windows.windows.length - 1),
    missingQueryAttributions: queries.length - new Set(windows.windows.flatMap(window => window.matchedQueries)).size,
    ...assessWakeTrace(trace), overflowRecoveryFailures, explicitExpansionFailures,
    scope: "L2 execute/execute_file/batch/search envelopes; other evidence envelopes separately disclosed. Local bootstrap and production dedup/overflow helpers; wake policy is an invented trace fixture. Host inputs/live quota unmeasured." };
}

/** Artifact bytes remain complete, including every failure ID and metric. */
export function retainBudgetDiagnostics(failures: BudgetFailure[], directory: string) {
  const body = JSON.stringify({ schemaVersion: 1, failures }, null, 2) + "\n";
  const digest = sha(body), name = `overhead-failures-${digest}.json`;
  const firstFailure = { id: diagnosticText(failures[0]?.id, 128), metric: diagnosticText(failures[0]?.metric, 256),
    observed: failures[0]?.observed ?? null, maximum: failures[0]?.maximum ?? null,
    detail: diagnosticText(failures[0]?.detail, 512) };
  try {
    mkdirSync(directory, { recursive: true });
    const path = join(directory, name);
    if (!existsSync(path)) writeFileSync(path, body, { mode: 0o600, flag: "wx" });
    if (sha(readFileSync(path)) !== digest) throw new Error("diagnostic artifact integrity failure");
  } catch {
    return { status: "failed", failureCount: failures.length, firstFailure, evidenceCompleteness: "partial",
      overflow: { available: false, reason: "diagnostic artifact storage/integrity failure" } };
  }
  return { status: "failed", failureCount: failures.length, firstFailure, evidenceCompleteness: "complete",
    overflow: { file: name, directory: "supplied --evidence-dir (default current directory)", bytes: Buffer.byteLength(body), sha256: digest,
      access: "local CI artifact; retrieve complete JSON from the supplied directory" } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), directoryIndex = args.indexOf("--evidence-dir"), baseIndex = args.indexOf("--base");
  const evidenceDirectory = directoryIndex < 0 ? process.cwd() : resolve(args[directoryIndex + 1]);
  try {
    const budget = loadOverheadBudgets(), measured = collectOverhead(), failures = assessOverhead(measured, budget);
    const baseRevision = baseIndex >= 0 ? args[baseIndex + 1] : process.env.OVERHEAD_BASE_REVISION;
    if (baseRevision) {
      const verified = spawnSync("git", ["rev-parse", "--verify", `${baseRevision}^{commit}`], { cwd: repository, encoding: "utf8" });
      if (verified.status !== 0) failures.push({ id: "BASE_REVISION_UNAVAILABLE", metric: "base-revision", observed: null, maximum: 0 });
      else {
        const path = "plugins/context-mode/benchmark/fixtures/overhead-budgets.json";
        const tree = spawnSync("git", ["ls-tree", "-z", verified.stdout.trim(), "--", path], { cwd: repository, encoding: "utf8" });
        const before = tree.status === 0 && tree.stdout ? spawnSync("git", ["show", `${verified.stdout.trim()}:${path}`], { cwd: repository, encoding: "utf8" }) : null;
        // A verified commit without this new fixture is its initial introduction.
        // Subsequent increases require the digest-bound reviewed amendment.
        if (tree.status !== 0 || (before && before.status !== 0)) failures.push({ id: "BASE_BUDGET_UNAVAILABLE", metric: "base-budget", observed: null, maximum: 0 });
        else if (before) failures.push(...validateBudgetAmendment(JSON.parse(before.stdout), budget));
      }
    }
    if (failures.length) { process.stdout.write(JSON.stringify(retainBudgetDiagnostics(failures, evidenceDirectory)) + "\n"); process.exitCode = 1; }
    else process.stdout.write(JSON.stringify({ status: "passed", measured, reviewPolicy: budget.reviewPolicy }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify(retainBudgetDiagnostics([{ id: "OVERHEAD_CHECK_FAILED", metric: "fixture-or-inventory", observed: null, maximum: 0,
      detail: `Fixture/inventory failure; no unknown result is passing. ${error instanceof Error ? error.stack : String(error)}` }], evidenceDirectory)) + "\n");
    process.exitCode = 1;
  }
}
