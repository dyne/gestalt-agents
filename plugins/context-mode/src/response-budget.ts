import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { capBytes, charSafePrefix } from "./truncate.js";
import { checkedRoot, readArtifact, MAX_ARTIFACT_BYTES, type EfficiencyArtifactScope } from "./session/efficiency-report.js";
import { compactFailures, summarizeFailures, type ResponseEvidence } from "./response-evidence.js";

export const RESPONSE_BUDGET = 2048;
export const MAX_RESPONSE_BUDGET = 65_536;
export const budgetedTools = new Set(["ctx_execute", "ctx_execute_file", "ctx_batch_execute", "ctx_search"]);
export const responseBudgetFields = {
  response_bytes: z.number().int().min(1024).max(MAX_RESPONSE_BUDGET).optional()
    .describe("Whole serialized response UTF-8 budget, including metadata (default 2048; 1024–65536)."),
  response_report: z.string().regex(/^report-[a-f0-9]{64}$/).optional()
    .describe("Retrieve an authorized overflow page using ctx_search; no search runs when supplied."),
  response_offset: z.number().int().nonnegative().optional()
    .describe("UTF-8 byte offset from the preceding overflow page's nextOffset."),
};
export const responseBudgetSchema = z.object(responseBudgetFields).refine(
  value => value.response_offset === undefined || value.response_report !== undefined,
);
type Envelope = { content: Array<{ type: "text"; text: string }>; isError?: boolean; [key: string]: unknown };
export type ExecutionState = { exitCode: number | null; timedOut: boolean; backgrounded?: boolean;
  status?: "completed" | "failed" | "unknown" | "not-started" | "partial";
  completeness?: "complete" | "partial"; reason?: string };
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const envelope = (value: unknown, isError?: boolean): Envelope => ({
  content: [{ type: "text", text: JSON.stringify(value) }], ...(isError === undefined ? {} : { isError }),
});
export const responseBudgetError = (reason: string) => envelope({ evidenceCompleteness: "partial", reason }, true);

export function retainAuthorizedReport(body: string, scope: EfficiencyArtifactScope) {
  if (Buffer.byteLength(body, "utf8") > MAX_ARTIFACT_BYTES) throw new Error("authorized report size limit exceeded");
  const digest = createHash("sha256").update(body).digest("hex"), report = `report-${digest}`;
  const path = join(checkedRoot(scope.root, true), `${report}.json`);
  if (!scope.authorizeRead(path)) throw new Error("report access denied");
  try { writeFileSync(path, body, { flag: "wx", mode: 0o600 }); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; }
  const retained = readArtifact(scope, report);
  return { report, sha256: digest, bytes: retained.length, access: "same workspace/session",
    continuation: "ctx_search(response_report, response_offset)", offset: 0 };
}

/** Measure JSON escaping and metadata too; a character cap alone is insufficient. */
export function boundResponse(response: Envelope, scope: EfficiencyArtifactScope, budget = RESPONSE_BUDGET,
  execution?: ExecutionState, evidence?: ResponseEvidence): Envelope {
  if (evidence?.available === false) response = { ...response, isError: true };
  const body = JSON.stringify(response);
  if (Buffer.byteLength(body, "utf8") <= budget) return response;
  let overflow: Record<string, unknown>;
  try {
    overflow = retainAuthorizedReport(evidence?.snapshot ? JSON.stringify({ ...response, capturedEvidence: evidence.snapshot }) : body, scope);
  } catch { overflow = { available: false, reason: "authorized overflow unavailable" }; }
  const text = response.content.filter(part => part.type === "text").map(part => part.text).join("\n");
  const failures = compactFailures(evidence?.failures ?? summarizeFailures([{ source: "tool response", stdout: text,
    state: response.isError ? { exitCode: null, timedOut: false, status: "failed" } : undefined }], "returned envelope"));
  const make = (preview: string, minimal = false) => envelope({ evidenceCompleteness: overflow.available === false || evidence?.available === false
      || evidence?.captureCompleteness === "partial" || evidence?.captureCompleteness === "unknown" ? "partial" : "complete",
    displayCompleteness: "partial", originalBytes: Buffer.byteLength(body, "utf8"), execution: execution ?? null,
    captureCompleteness: evidence?.captureCompleteness ?? "unknown", failures,
    ...(evidence?.provenance ? { provenance: evidence.provenance } : {}),
    ...(evidence?.reference && !evidence.snapshot ? { evidence: evidence.reference } : {}), overflow,
    omittedBytes: Buffer.byteLength(text, "utf8") - Buffer.byteLength(preview, "utf8"),
    omittedBytesScope: "display text", ...(minimal ? {} : { preview }) }, overflow.available === false ? true : response.isError);
  // At the minimum explicit budget, omit only redundant display metadata;
  // complete identities and diagnostic locators stay behind the references.
  if (bytes(make("")) > budget) {
    const compact = make("", true);
    const value = JSON.parse(compact.content[0].text);
    delete value.displayCompleteness;
    if (value.overflow.report) {
      delete value.overflow.offset;
      value.overflow.continuation = "ctx_search";
    }
    if (value.evidence) delete value.evidence.bytes;
    for (const limit of [32, 16, 8]) {
      if (bytes(envelope(value, compact.isError)) <= budget) break;
      const first = value.failures.firstFailure;
      if (first) for (const key of ["id", "cause"]) {
        const original = first[key]; first[key] = capBytes(original, limit);
        value.failures.firstFailureOmittedBytes = (value.failures.firstFailureOmittedBytes ?? 0)
          + Buffer.byteLength(original) - Buffer.byteLength(first[key]);
      }
    }
    if (bytes(envelope(value, compact.isError)) > budget && value.provenance) {
      delete value.provenance; value.provenanceOmitted = true;
    }
    return envelope(value, compact.isError);
  }
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (bytes(make(charSafePrefix(text, mid))) <= budget) lo = mid; else hi = mid - 1;
  }
  return make(charSafePrefix(text, lo));
}

/** Pages preserve the original envelope verbatim; offsets count UTF-8 bytes. */
export function readResponsePage(scope: EfficiencyArtifactScope, report: string, offset = 0, budget = RESPONSE_BUDGET, notice?: string): Envelope {
  try {
    const data = readArtifact(scope, report);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= data.length || (data[offset] & 0xc0) === 0x80) throw new Error();
    const remaining = data.subarray(offset).toString("utf8");
    const make = (chunk: string) => {
      const next = offset + Buffer.byteLength(chunk, "utf8");
      return envelope({ report, sha256: report.slice(7), bytes: data.length, offset,
        nextOffset: next < data.length ? next : null, ...(notice ? { notice } : {}), chunk });
    };
    let lo = 0, hi = remaining.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (bytes(make(charSafePrefix(remaining, mid))) <= budget) lo = mid; else hi = mid - 1;
    }
    const chunk = charSafePrefix(remaining, lo);
    if (!chunk) throw new Error();
    return make(chunk);
  } catch { return envelope({ evidenceCompleteness: "partial", reason: "report unavailable, changed, denied, or outside this session", ...(notice ? { notice } : {}) }, true); }
}
