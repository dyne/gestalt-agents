/** Durable source navigation; saved findings are leads, never current edit authority. */
import { realpathSync } from 'node:fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readAuthorized } from './evidence/extract.js';
import { digest } from './evidence/github.js';
import { revisionDigest, sourceRevision } from './evidence/revision.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const line = z.number().int().min(1).max(200000);
const range = z.object({start: line, end: line}).strict().refine(r => r.end >= r.start);
const note = z.object({
  range,
  finding: z.string().max(2048).optional(),
  question: z.string().max(2048).optional(),
  references: z.array(z.object({path: z.string().min(1).max(4096), sha256: hash, locator: z.string().max(512)}).strict()).max(16).optional(),
}).strict();
const snapshotSchema = z.object({version: z.literal(1), id: hash, repository: z.string(), path: z.string(), suppliedPath: z.string(),
  sha256: hash, text: z.string().max(2 * 1024 * 1024), notes: z.array(note).max(32), observedAt: z.string().datetime()}).strict();
export const sourceMapRequestSchema = z.object({
  operation: z.enum(['capture', 'read']),
  path: z.string().min(1).max(4096).optional(),
  map: hash.optional(),
  notes: z.array(note).max(32).optional(),
  range: range.optional(),
  context: z.number().int().min(0).max(200).optional(),
  offset: z.number().int().min(0).max(16 * 1024 * 1024).optional(),
  revision: hash.optional(),
  maxBytes: z.number().int().min(1024).max(65536).optional(),
}).strict().superRefine((r, ctx) => {
  const invalid = r.operation === 'capture'
    ? !r.path || r.map !== undefined || r.range !== undefined || r.context !== undefined || r.offset !== undefined || r.revision !== undefined
    : (!r.path && !r.map) || r.notes !== undefined || r.offset !== undefined && !r.revision;
  if (invalid) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'invalid source-map operation'});
});
type Request = z.infer<typeof sourceMapRequestSchema>;
type Snapshot = z.infer<typeof snapshotSchema>;
export interface SourceMapRuntime {
  projectDir(): string;
  resolvePath(path: string): string;
  authorizeRead(path: string): boolean;
  /** Check policy on the original path even after a move/deletion. */
  authorizeSavedPath(path: string): boolean;
  save(repository: string, id: string, payload: string): void;
  load(repository: string, id: string): string | null;
  index(text: string, source: string): unknown;
}
const lines = (text: string) => text === '' ? [] : text.split('\n');
const mapId = (repository: string, path: string) => revisionDigest(['source-map-v1', repository, path]);
type Span = {old: {start: number; end: number}; current: {start: number; end: number}};

/** Unique ordered anchors avoid a quadratic diff. Ambiguous/repeated regions
 * conservatively widen; every differing gap is included, including deletions.
 */
export function changedSourceRanges(before: string[], after: string[]): Span[] {
  let prefix = 0;
  while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < Math.min(before.length, after.length) - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const positions = (all: string[], end: number) => {
    const found = new Map<string, number>();
    for (let i = prefix; i < end; i++) found.set(all[i], found.has(all[i]) ? -1 : i);
    return found;
  };
  const oldEnd = before.length - suffix, newEnd = after.length - suffix;
  const oldPositions = positions(before, oldEnd), newPositions = positions(after, newEnd);
  const anchors: [number, number][] = [[prefix - 1, prefix - 1]];
  for (let i = prefix; i < oldEnd; i++) {
    const j = newPositions.get(before[i]);
    if (oldPositions.get(before[i]) === i && j !== undefined && j > anchors.at(-1)![1]) anchors.push([i, j]);
  }
  anchors.push([oldEnd, newEnd]);
  const changes: Span[] = [];
  for (let i = 1; i < anchors.length; i++) {
    const [oldStart, start] = anchors[i - 1].map(n => n + 1), [oldStop, stop] = anchors[i];
    if (JSON.stringify(before.slice(oldStart, oldStop)) !== JSON.stringify(after.slice(start, stop)))
      changes.push({old: {start: oldStart + 1, end: oldStop}, current: {start: start + 1, end: stop}});
  }
  return changes;
}

/** Pages bind the full derived document, not just a timestamp. Every page rereads
 * and reauthorizes the live source. No saved-source bytes escape after a deny.
 */
function page(document: unknown, request: Request): string {
  const text = JSON.stringify(document), bytes = Buffer.from(text), revision = digest(bytes);
  const budget = request.maxBytes ?? 2048, offset = request.offset ?? 0;
  if (request.revision && request.revision !== revision) throw new Error('changed');
  const envelopeBytes = (body: string) => Buffer.byteLength(JSON.stringify({content: [{type: 'text', text: body}]}));
  if (offset === 0 && !request.revision && envelopeBytes(text) <= budget) return text;
  if (offset > bytes.length || offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) throw new Error('invalid offset');
  let low = 0, high = Math.min(bytes.length - offset, budget), best: string | undefined;
  while (low <= high) {
    const trial = Math.floor((low + high) / 2);let size = trial;
    while (size > 0 && offset + size < bytes.length && (bytes[offset + size] & 0xc0) === 0x80) size--;
    const data = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes.subarray(offset, offset + size));
    const body = JSON.stringify({version: 1, revision, offset, bytes: size, totalBytes: bytes.length,
      data, nextOffset: offset + size < bytes.length ? offset + size : null,
      continuation: 'ctx_source_map read: repeat map/path/range/context with revision and nextOffset; every page verifies live bytes'});
    if (envelopeBytes(body) <= budget) {best = body;low = trial + 1;} else high = trial - 1;
  }
  if (best && (JSON.parse(best).bytes > 0 || offset === bytes.length)) return best;
  throw new Error('page budget');
}

export function sourceMapRequest(input: unknown, runtime: SourceMapRuntime): {content: {type: 'text'; text: string}[]; isError?: boolean} {
  const result = (value: string, isError?: boolean) => ({content: [{type: 'text' as const, text: value}], ...(isError ? {isError} : {})});
  const parsed = sourceMapRequestSchema.safeParse(input);
  if (!parsed.success) return result(JSON.stringify({state: 'unavailable', reason: 'invalid source-map request'}), true);
  const r = parsed.data;
  try {
    const repository = realpathSync(runtime.projectDir());
    const supplied = r.path ? runtime.resolvePath(r.path) : undefined;
    let saved: Snapshot | undefined;
    if (r.operation === 'read') {
      // Looking up an existing path does not read its contents; capture/read below
      // rechecks policy on both supplied and canonical/opened paths.
      const id = r.map ?? mapId(repository, realpathSync(supplied!));
      const record = runtime.load(repository, id);
      if (!record) throw new Error('map unavailable');
      saved = snapshotSchema.parse(JSON.parse(record));
      if (saved.repository !== repository || saved.id !== id || mapId(repository, saved.path) !== id || digest(saved.text) !== saved.sha256) throw new Error('invalid map');
      if (![saved.path, saved.suppliedPath].every(path => runtime.authorizeSavedPath(path))) throw new Error('denied');
    }
    const current = readAuthorized(supplied ?? saved!.suppliedPath, runtime.authorizeRead, 2 * 1024 * 1024);
    if (current.partial) throw new Error('incomplete source');
    const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(current.data), currentLines = lines(text);
    if (currentLines.length > 200000) throw new Error('source too large');
    const revision = sourceRevision(repository, current.canonical, digest(current.data));
    if (r.operation === 'capture') {
      if (r.notes?.some(n => n.range.end > currentLines.length)) throw new Error('invalid source range');
      const snapshot: Snapshot = {version: 1, id: mapId(repository, current.canonical), repository, path: current.canonical, suppliedPath: supplied!,
        sha256: revision.sha256, text, notes: r.notes ?? [], observedAt: new Date().toISOString()};
      runtime.save(repository, snapshot.id, JSON.stringify(snapshot));
      let index = 'available';
      try {runtime.index(JSON.stringify({map: snapshot.id, path: snapshot.path, revision, notes: snapshot.notes,
        status: 'navigation leads; use ctx_source_map read to check current source'}), `source-map:${snapshot.id}`);} catch {index = 'unavailable; map retained; use map id or exact path'}
      return result(page({version: 1, map: snapshot.id, sourceRevision: revision.key, sha256: revision.sha256, observedAt: snapshot.observedAt, index,
        preEdit: 'Inspect current source natively before editing; saved findings/references require independent verification'}, r));
    }
    const changes = changedSourceRanges(lines(saved!.text), currentLines);
    const state = saved!.path !== current.canonical ? 'moved' : saved!.sha256 !== revision.sha256 ? 'stale' : 'current';
    if (r.range && r.range.end > currentLines.length) throw new Error('range outside current source');
    const selected = r.range ? [r.range] : changes.length === 0 ? saved!.notes.map(n => n.range) : changes.map(c => c.current);
    const context = r.context ?? 3;
    const ranges = selected.map(s => ({start: Math.max(1, Math.min(s.start, currentLines.length) - context), end: Math.min(currentLines.length, Math.max(s.start, s.end) + context)}))
      .sort((a, b) => a.start - b.start);
    const merged: {start: number; end: number}[] = [];
    for (const next of ranges) {
      const last = merged.at(-1);
      if (last && next.start <= last.end + 1) last.end = Math.max(last.end, next.end); else merged.push({...next});
    }
    return result(page({version: 1, map: saved!.id, state, repository, path: current.canonical, previousPath: saved!.path,
      previousRevision: sourceRevision(repository, saved!.path, saved!.sha256), revision, observedAt: saved!.observedAt,
      notes: saved!.notes, notesState: state === 'current' ? 'revision matches; independently verify findings/references' : 'stale leads; old ranges are not current locations',
      changes, changeCoverage: 'all differing gaps; ambiguous repeated regions conservatively widened',
      windows: merged.map(s => ({...s, text: currentLines.slice(s.start - 1, s.end).join('\n')})),
      preEdit: 'Inspect current source natively before editing; request range/context for wider context'}, r));
  } catch {
    return result(JSON.stringify({version: 1, state: 'unavailable', reason: 'map/index or authorized current source unavailable, changed page, invalid range or incomplete capture; inspect current source natively and recapture as needed'}), true);
  }
}

export function registerSourceMap(server: McpServer, runtime: SourceMapRuntime): void {
  server.registerTool('ctx_source_map', {
    title: 'Source navigation and deltas',
    description: 'Persist source paths/ranges/findings/questions/references in workspace retrieval. Read reauthorizes live bytes and flags stale/moved maps; changed windows retain context. Optional range/context widens inspection. Pages bind revision; repeat the request with nextOffset. Use native current-source inspection before editing.',
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false},
    // Defer invalid values to the bounded handler rather than serializing the
    // SDK's potentially unbounded validation issues (including hostile keys).
    inputSchema: z.object(Object.fromEntries(Object.entries(sourceMapRequestSchema.innerType().shape)
      .map(([key, schema]) => [key, (schema as z.ZodTypeAny).catch(null)]))).passthrough(),
  }, async input => sourceMapRequest(input, runtime));
}
