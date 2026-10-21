import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { retainAuthorizedReport, type ExecutionState } from "./response-budget.js";
import type { EfficiencyArtifactScope } from "./session/efficiency-report.js";
import { compactFailures, summarizeFailures, type ResponseEvidence } from "./response-evidence.js";
import { capBytes } from "./truncate.js";

export const executionAuditField = z.boolean().optional().describe(
  "Explicitly display submitted source and a bounded generated-script preview for audit. Full exact scripts are available via the authorized audit report; the complete response budget still applies.",
);
export type AuditSource = { submitted: string; executed: string | null; label?: string; path?: string; state?: ExecutionState;
  diagnostics?: { stdout?: string; stderr?: string; outputCapped?: boolean; observedOutputBytes?: number; capturedOutputBytes?: number; error?: { name: string; message: string; stack?: string } } };
export type ExecutionAudit = { operationId: string; language: string; sourceDigest: string; sources: AuditSource[] };
type ExecutionResponse = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
export function createExecutionAudit(language: string, sources: AuditSource[]): ExecutionAudit {
  const submitted = sources.length === 1 ? sources[0].submitted : JSON.stringify(sources.map(({ submitted, label }) => ({ submitted, label })));
  return { operationId: randomUUID(), language,
    sourceDigest: createHash("sha256").update(submitted).digest("hex"), sources };
}

export function observedExecutionState(result: { exitCode?: number; timedOut?: boolean; backgrounded?: boolean; outputCapped?: boolean;
  exitCodeObserved?: boolean; processError?: string }): ExecutionState {
  const exitCode = result.exitCodeObserved !== false && Number.isInteger(result.exitCode) ? result.exitCode! : null;
  return { exitCode, timedOut: !!result.timedOut, backgrounded: result.backgrounded,
    status: result.timedOut || result.backgrounded || result.outputCapped ? "partial" : result.processError ? "failed" : exitCode === null ? "unknown" : exitCode === 0 ? "completed" : "failed",
    completeness: exitCode === null || result.timedOut || result.backgrounded || result.outputCapped ? "partial" : "complete",
    ...(result.outputCapped ? { reason: "subprocess output cap discarded bytes" } : {}) };
}

export function aggregateExecutionState(sources: AuditSource[], timedOut = false): ExecutionState {
  const states = sources.map(source => source.state);
  const partial = states.length === 0 || states.some(state => !state || state.completeness !== "complete");
  const failed = states.some(state => state?.status === "failed");
  const known = states.length > 0 && states.every(state => state?.exitCode !== null && state?.exitCode !== undefined);
  return { exitCode: known ? states.find(state => state!.exitCode !== 0)?.exitCode ?? 0 : null,
    timedOut: timedOut || states.some(state => state?.timedOut),
    status: failed ? "failed" : partial ? "partial" : "completed", completeness: partial ? "partial" : "complete" };
}

/** Only metadata appears routinely; source remains in the reauthorized report. */
export function executionProvenance(audit: ExecutionAudit, state: ExecutionState | undefined,
  scope: EfficiencyArtifactScope, displayAudit = false, rawResponse?: ExecutionResponse, sourceEchoesOmitted = 0,
  related?: ResponseEvidence): { text: string; evidence: ResponseEvidence } {
  const commandFailures = summarizeFailures(audit.sources.map((source, index) => ({ source: source.label ?? `command-${index + 1}`,
    ...source.diagnostics, state: source.state ?? state })), "captured command diagnostics");
  const failures = commandFailures.knownFailures ? commandFailures : related?.failures ?? commandFailures;
  const routineFailures = displayAudit ? failures : { ...failures, failures: failures.failures.map(failure => ({ ...failure,
    cause: omitExecutableSource({ content: [{ type: "text", text: failure.cause }] }, audit).response.content[0].text,
  })) };
  const captureCompleteness = related && related.captureCompleteness !== "complete" ? "partial" : state?.completeness ?? "unknown";
  const snapshot = { ...audit, execution: state ?? null, failures, commandFailures, rawResponse,
    ...(related?.snapshot ? { queryEvidence: related.snapshot } : {}) };
  const body = JSON.stringify(snapshot), omittedBytes = Buffer.byteLength(body, "utf8");
  let retrieval: Record<string, unknown>;
  try { retrieval = retainAuthorizedReport(body, scope); }
  catch { retrieval = { available: false, evidenceCompleteness: "partial", bytes: omittedBytes,
    sha256: createHash("sha256").update(body).digest("hex"), reason: "authorized audit unavailable" }; }
  const header = JSON.stringify({ operationId: audit.operationId, language: audit.language,
    sourceDigest: audit.sourceDigest, execution: state ?? null, audit: retrieval,
    evidenceCompleteness: retrieval.available === false || related?.available === false || captureCompleteness !== "complete" ? "partial" : "complete",
    captureCompleteness, failures: compactFailures(routineFailures),
    omittedBytes, omittedBytesScope: "audit record not inlined",
    ...(sourceEchoesOmitted ? { sourceEchoesOmitted } : {}) });
  const text = `Execution: ${header}\n\n` + (displayAudit
    ? `Explicit audit source:\n${JSON.stringify(audit.sources.map(source => {
      const preview = source.executed === null ? null : capBytes(source.executed, 256);
      return { submitted: source.submitted, label: source.label, path: source.path, executedPreview: preview,
        executedOmittedBytes: source.executed === null ? null : Buffer.byteLength(source.executed) - Buffer.byteLength(preview!) };
    }))}\n\n`
    : "");
  return { text, evidence: { available: retrieval.available !== false && related?.available !== false, captureCompleteness,
    snapshot, provenance: { operationId: audit.operationId, language: audit.language, sourceDigest: audit.sourceDigest },
    ...(typeof retrieval.report === "string" ? { reference: { report: retrieval.report, bytes: retrieval.bytes as number } } : {}), failures: routineFailures } };
}

/** Interpreters can repeat source lines in diagnostics; retain those in the
 * authorized audit, while keeping the diagnostic message and stack routinely. */
export function omitExecutableSource<T extends ExecutionResponse>(response: T, audit: ExecutionAudit): { response: T; omitted: number } {
  const excerpts = new Set(audit.sources.flatMap(source => [source.submitted, source.executed ?? ""])
    .flatMap(source => source.split("\n")).map(line => line.trim()).filter(line => line.length >= 8));
  let omitted = 0;
  const content = response.content.map(part => {
    const text = part.text.split("\n").map(line => {
      if (!excerpts.has(line.trim())) return line;
      omitted++;
      return "[source excerpt retained in audit]";
    }).join("\n");
    return text === part.text ? part : { ...part, text };
  });
  return { response: { ...response, content }, omitted };
}
