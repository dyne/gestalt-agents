import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {ContentStore} from '../src/store.js';
import {changedSourceRanges, sourceMapRequest, type SourceMapRuntime} from '../src/source-map.js';
import {digest} from '../src/evidence/github.js';

let root: string, store: ContentStore, denied: boolean;
const file = () => join(root, 'module.ts');
const source = () => Array.from({length: 120}, (_, i) => `line ${i + 1}: current source ☃`).join('\n');
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'source-map-'))); store = new ContentStore(join(root, 'content.db')); denied = false;
  writeFileSync(file(), source());
});
afterEach(() => {store.close(); rmSync(root, {recursive: true, force: true});});
const runtime = (extra: Partial<SourceMapRuntime> = {}): SourceMapRuntime => ({
  projectDir: () => root, resolvePath: p => resolve(root, p),
  authorizeRead: p => !denied && resolve(p).startsWith(root + sep),
  authorizeSavedPath: p => !denied && resolve(p).startsWith(root + sep),
  save: (repository, id, payload) => store.saveSourceMap(repository, id, payload),
  load: (repository, id) => store.loadSourceMap(repository, id),
  index: (text, label) => store.indexPlainText(text, label), ...extra,
});
const request = (args: Record<string, unknown>, rt = runtime()) => {
  const result = sourceMapRequest(args, rt);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(Number(args.maxBytes ?? 2048));
  return {error: result.isError, ...JSON.parse(result.content[0].text)};
};
const capture = (rt = runtime()) => request({operation: 'capture', path: 'module.ts', notes: [{range: {start: 30, end: 32}, finding: 'resolver ownership', question: 'Does fallback preserve scope?',
  references: [{path: 'design.txt', sha256: digest('design'), locator: 'section:resolver'}]}]}, rt);
function full(args: Record<string, unknown>, rt = runtime()) {
  let page = request(args, rt);
  if (!('data' in page)) return page;
  const revision = page.revision; let text = '';
  for (;;) {
    text += page.data;
    if (page.nextOffset === null) break;
    page = request({...args, revision, offset: page.nextOffset}, rt);
    expect(page.error).toBeUndefined();
  }
  expect(digest(text)).toBe(revision);
  return JSON.parse(text);
}

describe('durable source maps', () => {
  it('survives compaction/restart and locates current source through the existing workspace index', () => {
    const saved = capture(); store.close(); store = new ContentStore(join(root, 'content.db'));
    const matches = store.searchWithFallback('resolver ownership', 3);
    expect(matches.some(m => m.content.includes(saved.map))).toBe(true);
    const current = full({operation: 'read', map: saved.map});
    expect(current.state).toBe('current');expect(current.path).toBe(file());
    expect(current.notes[0]).toMatchObject({finding: 'resolver ownership', question: 'Does fallback preserve scope?', references: [{locator: 'section:resolver'}]});
    expect(current.windows).toEqual([{start: 27, end: 35, text: source().split('\n').slice(26, 35).join('\n')}]);
    expect(current.preEdit).toContain('natively');
  });
  it('detects same-timestamp stale maps and fetches disjoint changed regions with context', () => {
    const saved = capture(), before = source().split('\n'), changed = [...before];changed[9] = 'changed early';changed[99] = 'changed late';
    writeFileSync(file(), changed.join('\n'));utimesSync(file(), new Date(0), new Date(0));
    const result = full({operation: 'read', map: saved.map, context: 2});
    expect(result.state).toBe('stale');expect(result.notesState).toContain('stale');
    expect(result.changes).toEqual([{old: {start: 10, end: 10}, current: {start: 10, end: 10}}, {old: {start: 100, end: 100}, current: {start: 100, end: 100}}]);
    expect(result.windows.map((w: any) => [w.start, w.end])).toEqual([[8, 12], [98, 102]]);
    expect(result.windows.map((w: any) => w.text).join('\n')).not.toContain('line 50:');
  });
  it('detects moved and deleted files without searching or claiming an old path is current', () => {
    const saved = capture();renameSync(file(), join(root, 'moved.ts'));
    expect(request({operation: 'read', map: saved.map}).error).toBe(true);
    const moved = full({operation: 'read', map: saved.map, path: 'moved.ts'});
    expect(moved.state).toBe('moved');expect(moved.previousPath).toBe(file());expect(moved.path).toBe(join(root, 'moved.ts'));
    expect(moved.revision.key).not.toBe(moved.previousRevision.key);expect(moved.windows[0].text).toContain('line 30:');
    unlinkSync(join(root, 'moved.ts'));expect(request({operation: 'read', map: saved.map, path: 'moved.ts'}).error).toBe(true);
  });
  it('retains exact map lookup when FTS indexing is unavailable and fails explicitly if storage is missing', () => {
    const rt = runtime({index: () => {throw new Error('index offline');}}), saved = capture(rt);
    expect(saved.index).toContain('unavailable');
    expect(full({operation: 'read', path: 'module.ts'}, rt).state).toBe('current');
    expect(request({operation: 'read', map: saved.map}, runtime({load: () => null})).error).toBe(true);
    expect(capture(runtime({save: () => {throw new Error('offline');}})).error).toBe(true);
  });
  it('supports explicit wider current-source ranges and rejects ranges outside the live file', () => {
    const saved = capture();
    const wider = full({operation: 'read', map: saved.map, range: {start: 20, end: 45}, context: 5});
    expect(wider.windows[0]).toMatchObject({start: 15, end: 50});
    expect(request({operation: 'read', map: saved.map, range: {start: 100, end: 140}}).error).toBe(true);
  });
  it('binds every bounded Unicode page to current content and reauthorizes after policy changes', () => {
    const saved = capture(), args = {operation: 'read', map: saved.map, range: {start: 1, end: 120}, maxBytes: 1024};
    const first = request(args);expect(first.nextOffset).toBeGreaterThan(0);
    expect(full(args).windows[0].text).toBe(source());
    denied = true;const rejected = request({...args, revision: first.revision, offset: first.nextOffset});
    expect(rejected.error).toBe(true);expect(JSON.stringify(rejected)).not.toContain('resolver ownership');
    denied = false;writeFileSync(file(), source() + '\nnew content');
    expect(request({...args, revision: first.revision, offset: first.nextOffset}).error).toBe(true);
  });
  it('rejects forged snapshots, foreign repositories, symlink escapes and invalid requests', () => {
    const saved = capture(), record = JSON.parse(store.loadSourceMap(root, saved.map)!);
    record.text += 'forged';store.saveSourceMap(root, saved.map, JSON.stringify(record));
    expect(request({operation: 'read', map: saved.map}).error).toBe(true);
    expect(request({operation: 'read', map: saved.map}, runtime({projectDir: () => tmpdir()})).error).toBe(true);
    symlinkSync('/etc/hosts', join(root, 'escape.ts'));
    expect(request({operation: 'capture', path: 'escape.ts'}).error).toBe(true);
    expect(request({operation: 'read', map: saved.map, offset: 1}).error).toBe(true);
    expect(request({operation: 'capture', path: 'module.ts', notes: [{range: {start: 2, end: 1}}]}).error).toBe(true);
  });
  it('does not alter saved findings when reading a changed range', () => {
    const saved = capture(), original = store.loadSourceMap(root, saved.map);
    writeFileSync(file(), 'inserted\n' + readFileSync(file(), 'utf8'));
    expect(full({operation: 'read', map: saved.map}).state).toBe('stale');
    expect(store.loadSourceMap(root, saved.map)).toBe(original);
  });
  it('preserves BOM bytes and bounds large quoted-line pages with explicit wider budgets', () => {
    const text = '\ufeff' + '"☃\\'.repeat(20000);writeFileSync(file(), text);
    const saved = request({operation: 'capture', path: 'module.ts', notes: [{range: {start: 1, end: 1}}]});
    expect(saved.error).toBeUndefined();
    expect(full({operation: 'read', map: saved.map, maxBytes: 65536}).windows[0].text).toBe(text);
  });
});

describe('conservative line deltas', () => {
  it('reconstructs edited, moved and repeated blocks without dropping a differing gap', () => {
    for (let seed = 0; seed < 80; seed++) {
      const before = Array.from({length: 15}, (_, i) => `line-${(i * (seed + 1)) % 11}`), after = [...before];
      after.splice(seed % 15, seed % 4, 'inserted', `seed-${seed}`);
      const moved = after.splice(seed % 7, 3);after.splice(10, 0, ...moved);
      const spans = changedSourceRanges(before, after), rebuilt: string[] = [];let cursor = 0;
      for (const span of spans) {
        rebuilt.push(...before.slice(cursor, span.old.start - 1), ...after.slice(span.current.start - 1, span.current.end));cursor = span.old.end;
      }
      rebuilt.push(...before.slice(cursor));expect(rebuilt).toEqual(after);
    }
  });
  it.each([
    [[], ['new'], [{old: {start: 1, end: 0}, current: {start: 1, end: 1}}]],
    [['gone'], [], [{old: {start: 1, end: 1}, current: {start: 1, end: 0}}]],
    [['a', 'b'], ['a', 'insert', 'b'], [{old: {start: 2, end: 1}, current: {start: 2, end: 2}}]],
    [['a', 'a', 'b'], ['a', 'b'], [{old: {start: 2, end: 2}, current: {start: 2, end: 1}}]],
    [['a', 'b'], ['a', 'b'], []],
  ])('preserves inserted/deleted/repeated gaps %#', (before, after, expected) => {
    expect(changedSourceRanges(before as string[], after as string[])).toEqual(expected);
  });
});
