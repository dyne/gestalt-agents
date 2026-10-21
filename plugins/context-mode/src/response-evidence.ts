import { extractTests, redact } from "./evidence/extract.js";
import { capBytes } from "./truncate.js";
import type { ExecutionState } from "./response-budget.js";

export type Failure = { id: string; cause: string; locator: string; source: string };
export type FailureReport = { totalFailures: number | null; knownFailures: number; coverage: "complete" | "partial" | "unknown";
  failures: Failure[]; scope: string };
export type ResponseEvidence = { captureCompleteness: "complete" | "partial" | "unknown";
  available: boolean; reference?: { report: string; bytes: number }; failures: FailureReport;
  provenance?: { operationId: string; language: string; sourceDigest: string };
  /** Retained only behind authorization, never copied into routine metadata. */
  snapshot?: Record<string, unknown> };
type Diagnostic = { source: string; stdout?: string; stderr?: string; state?: ExecutionState;
  error?: { message: string } };

/** Existing format adapters establish counts; keyword matches never establish
 * test success or a complete failure total. Raw diagnostics stay in the report. */
export function summarizeFailures(inputs: Diagnostic[], scope: string): FailureReport {
  const failures: Failure[] = [];
  let total = 0, known = 0, complete = inputs.length > 0;
  for (const input of inputs) {
    let parsed = extractTests(input.stdout ?? "");
    if (parsed.certainty !== "known") {
      const combined = extractTests([input.stdout, input.stderr].filter(Boolean).join("\n"));
      if (combined.failures.length > parsed.failures.length || combined.certainty === "known") parsed = combined;
    }
    const found: Failure[] = parsed.failures.map(failure => ({ id: failure.id, cause: failure.cause,
      locator: failure.locator, source: input.source }));
    const processFailed = input.state?.status === "failed" || input.state?.exitCode !== null && input.state?.exitCode !== undefined && input.state.exitCode !== 0 || !!input.error;
    if (!found.length && processFailed) {
      const cause = input.error?.message || input.stderr?.split("\n").find(line => /^\s*(?:(?:\w*Error|\w*Exception):|FATAL\b|FAIL\b)/.test(line))
        || input.stderr?.split("\n").find(line => line.trim()) || `Command exited ${input.state?.exitCode ?? "without an observed code"}`;
      found.push({ id: redact(`${input.source}::execution`), cause: redact(cause), locator: "execution", source: input.source });
    }
    failures.push(...found); known += found.length;
    if (parsed.certainty === "known" && input.state?.completeness !== "partial") total += Math.max(parsed.counts?.failed ?? 0, found.length);
    else complete = false;
  }
  return { totalFailures: complete ? total : null, knownFailures: known, coverage: complete ? "complete" : known ? "partial" : "unknown", failures, scope };
}

export function compactFailures(report: FailureReport) {
  const first = report.failures[0];
  const cause = first?.cause.split("\n").find(line => /(?:Error|Exception|expected|Assertion|message:)/i.test(line)) ?? first?.cause.split("\n")[0] ?? "";
  const bounded = first ? { id: capBytes(first.id, 48), cause: capBytes(cause, 80) } : null;
  const omittedBytes = first && bounded ? Object.entries(bounded).reduce((sum, [key, value]) =>
    sum + Math.max(0, Buffer.byteLength(first[key as keyof Failure]) - Buffer.byteLength(value)), 0) : 0;
  return { totalFailures: report.totalFailures, knownFailures: report.knownFailures, coverage: report.coverage, scope: report.scope,
    firstFailure: bounded, ...(omittedBytes ? { firstFailureOmittedBytes: omittedBytes } : {}) };
}
