import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import type { collectEfficiencySummary } from "./efficiency-summary.js";

type Summary = ReturnType<typeof collectEfficiencySummary>;
export type EfficiencyToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
export interface EfficiencyArtifactScope { root: string; authorizeRead(path: string): boolean }
export const EFFICIENCY_RESPONSE_BUDGET = 2048;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const result = (value: unknown): EfficiencyToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
export const efficiencyResultBytes = (value: EfficiencyToolResult) => Buffer.byteLength(JSON.stringify(value), "utf8");
const fits = (value: EfficiencyToolResult) => efficiencyResultBytes(value) <= EFFICIENCY_RESPONSE_BUDGET;
const failure = (reason: string) => ({ ...result({ version: 1, evidenceCompleteness: "partial", reason }), isError: true });

/** Reject symlinked storage components, including pre-existing report roots. */
function checkedRoot(path: string, create: boolean): string {
  if (!isAbsolute(path)) throw new Error();
  let current = parse(path).root;
  for (const part of resolve(path).slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const st = lstatSync(current);
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" || !create) throw err;
      mkdirSync(current, { mode: 0o700 });
    }
  }
  return realpathSync.native(path);
}
function readArtifact(scope: EfficiencyArtifactScope, report: string): Buffer {
  if (!/^report-[a-f0-9]{64}$/.test(report)) throw new Error();
  const root = checkedRoot(scope.root, false), path = join(root, `${report}.json`);
  if (!scope.authorizeRead(path) || relative(root, realpathSync.native(path)) !== `${report}.json`) throw new Error();
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > 16 * 1024 * 1024) throw new Error();
    const data = readFileSync(fd);
    if (hash(data) !== report.slice(7)) throw new Error();
    return data;
  } finally { closeSync(fd); }
}

/** Full metrics stay in the existing workspace/session storage, never raw logs. */
export function formatEfficiencySummary(summary: Summary, scope: EfficiencyArtifactScope): EfficiencyToolResult {
  const direct = result(summary);
  if (fits(direct)) return direct;
  const body = JSON.stringify(summary), digest = hash(body), report = `report-${digest}`;
  let overflow: Record<string, unknown>;
  try {
    const root = checkedRoot(scope.root, true), path = join(root, `${report}.json`);
    if (!scope.authorizeRead(path)) throw new Error();
    try { writeFileSync(path, body, { flag: "wx", mode: 0o600 }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; }
    const retained = readArtifact(scope, report);
    overflow = { report, sha256: digest, bytes: retained.length, access: "same workspace/session via ctx_stats report" };
  } catch { overflow = { available: false, reason: "authorized overflow unavailable" }; }
  const childCounters = summary.providerTokens.knownByRole.children.reduce<Record<string, number>>((sum, child) => {
    for (const [key, value] of Object.entries(child.counters)) sum[key] = (sum[key] ?? 0) + value;
    return sum;
  }, {});
  const compact = {
    version: 1, scope: summary.scope,
    evidenceCompleteness: overflow.available === false ? "partial" : "complete",
    responses: { basis: "observed MCP JSON; known bytes are lower bounds", calls: summary.responses.calls,
      knownBytes: summary.responses.knownBytes, totalBytes: summary.responses.totalBytes,
      coverage: summary.responses.coverage, missingCalls: summary.responses.missingCalls,
      unmeasurableCalls: summary.responses.unmeasurableCalls, oversized: summary.responses.oversized.calls,
      role: "unknown", delivery: summary.responses.delivery },
    providerTokens: { coverage: summary.providerTokens.coverage, knownCountsAreLowerBounds: true, knownByRole: {
      root: summary.providerTokens.knownByRole.root, child: childCounters, unknown: summary.providerTokens.knownByRole.unknown,
    }, historyMissingEvents: summary.providerTokens.historyMissingEvents,
      unresolved: summary.providerTokens.unresolved.length, missingChildren: summary.providerTokens.missingChildren.length },
    transport: summary.transport, compactions: summary.compactions.observedCount,
    accountQuotaTokens: null, savingsPercent: null, overflow,
  };
  const bounded = result(compact);
  if (fits(bounded)) return bounded;
  // Long metric identities/numbers cannot force an oversized response. The
  // complete numeric report remains behind the authorized digest-bound handle.
  return result({ version: 1, evidenceCompleteness: compact.evidenceCompleteness,
    responses: { knownBytes: summary.responses.knownBytes, totalBytes: summary.responses.totalBytes, coverage: summary.responses.coverage },
    providerCoverage: summary.providerTokens.coverage, accountQuotaTokens: null, savingsPercent: null, overflow });
}

/** UTF-8 byte offsets refer to the retained report; pages include their own cost. */
export function readEfficiencySummary(scope: EfficiencyArtifactScope, report: string, offset = 0): EfficiencyToolResult {
  try {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error();
    const data = readArtifact(scope, report);
    if (offset >= data.length || (data[offset] & 0xc0) === 0x80) throw new Error();
    let chunk = "", nextOffset = offset;
    const page = (text: string, next: number) => result({ version: 1, report, sha256: report.slice(7), bytes: data.length,
      offset, nextOffset: next < data.length ? next : null, chunk: text });
    for (const character of data.subarray(offset).toString("utf8")) {
      const next = nextOffset + Buffer.byteLength(character, "utf8");
      if (!fits(page(chunk + character, next))) break;
      chunk += character; nextOffset = next;
    }
    if (!chunk) throw new Error();
    return page(chunk, nextOffset);
  } catch { return failure("report unavailable, changed, denied, or outside this session"); }
}
