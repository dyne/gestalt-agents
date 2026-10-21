import { createHash } from "node:crypto";
import { charSafePrefix } from "../truncate.js";
import { retainAuthorizedReport } from "../response-budget.js";
import type { EfficiencyArtifactScope } from "../session/efficiency-report.js";
import { compactFailures, summarizeFailures, type ResponseEvidence } from "../response-evidence.js";

export type WindowResult = { source: string; title: string; content: string; highlighted?: string;
  chunkId?: string | number; sourceId?: number; sourceRevision?: string; sourcePath?: string;
  origin?: string; timestamp?: string; windowContent?: string };
export type QueryGroup = { query: string; results: WindowResult[] };
type Window = { id: string; source: string; revision: string; chunk: string | number; title: string;
  path?: string; origin?: string; lines: [number, number]; lineScope: "chunk"; offsets: [number, number]; offsetUnit: "utf16";
  matchedQueries: number[]; text: string };

/** UTF-16 offsets address the indexed chunk; lines are explicitly chunk-local. */
function ranges(result: WindowResult, query: string): Array<[number, number]> {
  const content = result.content;
  if (content.length <= 1500) return [[0, content.length]];
  const positions: number[] = [];
  if (result.highlighted?.replace(/[\x02\x03]/g, "") === content) {
    let offset = 0;
    for (const char of result.highlighted) {
      if (char === "\x02") positions.push(offset);
      else if (char !== "\x03") offset += char.length;
    }
  }
  if (!positions.length) {
    const lower = content.toLowerCase();
    for (const term of query.toLowerCase().split(/\s+/).filter(term => term.length > 2)) {
      let offset = lower.indexOf(term);
      while (offset !== -1) { positions.push(offset); offset = lower.indexOf(term, offset + term.length); }
    }
  }
  if (!positions.length) positions.push(0); // Fuzzy/no literal term: explicit prefix window.
  const out: Array<[number, number]> = [];
  let used = 0;
  for (const position of [...new Set(positions)].sort((a, b) => a - b)) {
    if (used >= 1500) break;
    let start = Math.max(0, position - 300), end = Math.min(content.length, position + 300);
    // Extend to whole lines only when they are small enough for a source window.
    const lineStart = content.lastIndexOf("\n", start - 1) + 1;
    const nextBreak = content.indexOf("\n", end), lineEnd = nextBreak < 0 ? content.length : nextBreak;
    if (lineEnd - lineStart <= 1500) { start = lineStart; end = lineEnd; }
    if (start > 0 && /[\uDC00-\uDFFF]/.test(content[start])) start--;
    end = start + charSafePrefix(content.slice(start, end), 1500 - used).length;
    const prior = out[out.length - 1];
    if (prior && start <= prior[1]) { used += Math.max(0, end - prior[1]); prior[1] = Math.max(prior[1], end); }
    else { out.push([start, end]); used += end - start; }
  }
  return out;
}

export function deduplicateQueryWindows(groups: QueryGroup[]) {
  const entries = new Map<string, { result: WindowResult; ranges: Array<{ start: number; end: number; queries: Set<number> }> }>();
  groups.forEach((group, queryIndex) => group.results.forEach((input, resultIndex) => {
    const result = input.windowContent === undefined ? input : { ...input, content: input.windowContent };
    const revision = result.sourceRevision ?? createHash("sha256").update(result.content).digest("hex");
    // Without authoritative chunk identity, retain separate results rather
    // than merge identical text from potentially different source locations.
    const chunk = result.chunkId ?? `unlocated:${queryIndex}:${resultIndex}`;
    const key = JSON.stringify([result.origin ?? "current-session", result.sourcePath ?? result.source,
      result.sourceId ?? null, revision, chunk]);
    let entry = entries.get(key);
    if (!entry) { entry = { result: { ...result, sourceRevision: revision, chunkId: chunk }, ranges: [] }; entries.set(key, entry); }
    for (const [start, end] of ranges(result, group.query)) entry.ranges.push({ start, end, queries: new Set([queryIndex]) });
  }));
  const windows: Window[] = [];
  for (const { result, ranges: candidates } of entries.values()) {
    const merged: typeof candidates = [];
    for (const range of candidates.sort((a, b) => a.start - b.start || a.end - b.end)) {
      const prior = merged[merged.length - 1];
      if (prior && range.start <= prior.end) {
        prior.end = Math.max(prior.end, range.end);
        for (const query of range.queries) prior.queries.add(query);
      } else merged.push({ ...range, queries: new Set(range.queries) });
    }
    for (const range of merged) windows.push({ id: `w${windows.length + 1}`, source: result.source,
      revision: result.sourceRevision!, chunk: result.chunkId!, title: result.title,
      ...(result.sourcePath ? { path: result.sourcePath } : {}), ...(result.origin ? { origin: result.origin } : {}),
      lines: [result.content.slice(0, range.start).split("\n").length,
        result.content.slice(0, range.end).split("\n").length], lineScope: "chunk", offsets: [range.start, range.end], offsetUnit: "utf16",
      matchedQueries: [...range.queries].sort((a, b) => a - b), text: result.content.slice(range.start, range.end) });
  }
  return { queries: groups.map((group, id) => ({ id, query: group.query,
    status: group.results.length ? "matched" : "empty", windows: windows.filter(window => window.matchedQueries.includes(id)).map(window => window.id),
    ...(group.results.length ? {} : { reason: "No matching sections found." }) })), windows };
}

/** Admit windows in first-query/result order against one cumulative budget.
 * Every omitted query/window remains in the complete authorized report. */
export function formatQueryWindows(groups: QueryGroup[], budget: number, scope?: EfficiencyArtifactScope,
  onEvidence?: (evidence: ResponseEvidence) => void): string {
  const report = deduplicateQueryWindows(groups);
  const sources = new Map<string, WindowResult>();
  groups.forEach((group, query) => group.results.forEach((result, index) => {
    const key = JSON.stringify([result.origin, result.sourcePath ?? result.source, result.sourceId,
      result.sourceRevision ?? createHash("sha256").update(result.windowContent ?? result.content).digest("hex"), result.chunkId ?? `unlocated:${query}:${index}`]);
    if (!sources.has(key)) sources.set(key, result);
  }));
  const retrievedSources = [...sources.values()].map(({ windowContent, highlighted, ...source }) => ({
    ...source, content: windowContent ?? source.content }));
  const failures = summarizeFailures(retrievedSources.map(source => ({ source: source.source, stdout: source.content })), "retrieved indexed chunks only");
  const display = { ...report, captureCompleteness: "complete", failures: compactFailures(failures) };
  const full = { ...report, failures, retrievedSources };
  const completeWindows = retrievedSources.every(source => {
    const revision = source.sourceRevision ?? createHash("sha256").update(source.content).digest("hex");
    const windows = report.windows.filter(window => window.source === source.source && window.chunk === source.chunkId && window.revision === revision);
    let end = 0;
    for (const window of windows) { if (window.offsets[0] > end) return false; end = Math.max(end, window.offsets[1]); }
    return end >= source.content.length;
  });
  const fits = (value: unknown) => Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(value) }] }), "utf8") <= budget;
  if (fits(display) && completeWindows) {
    onEvidence?.({ available: true, captureCompleteness: "complete", failures, snapshot: full });
    return JSON.stringify(display);
  }
  let overflow: Record<string, unknown>;
  const body = JSON.stringify(full);
  try {
    if (!scope) throw new Error();
    overflow = retainAuthorizedReport(body, scope);
  } catch { overflow = { available: false, bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex"), reason: "authorized query overflow unavailable" }; }
  onEvidence?.({ available: overflow.available !== false, captureCompleteness: overflow.available === false ? "partial" : "complete", failures, snapshot: full,
    ...(typeof overflow.report === "string" ? { reference: { report: overflow.report, bytes: overflow.bytes as number } } : {}) });
  const selected: Window[] = [];
  const compact = () => ({ evidenceCompleteness: overflow.available === false ? "partial" : "complete",
    failures: compactFailures(failures),
    omittedBytes: overflow.bytes, omittedBytesScope: "query report not inlined",
    queries: report.queries.map(query => ({ ...query,
      status: query.windows.some(id => !selected.some(window => window.id === id)) ? "overflow" : query.status,
      windows: query.windows.filter(id => selected.some(window => window.id === id)) })), windows: selected, overflow });
  if (!fits(compact())) return JSON.stringify({ evidenceCompleteness: overflow.available === false ? "partial" : "complete",
    failures: compactFailures(failures), omittedBytes: overflow.bytes, omittedBytesScope: "query report not inlined",
    omittedQueries: report.queries.length, omittedWindows: report.windows.length, overflow });
  for (const window of report.windows) {
    selected.push(window);
    if (!fits(compact())) selected.pop();
  }
  return JSON.stringify(compact());
}
