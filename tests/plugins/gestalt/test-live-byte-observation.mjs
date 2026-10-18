import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withByteObservation } from "../../../plugins/gestalt/live-byte-observation.mjs";

const fixture = (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "live-byte-observation-")), path = join(root, "source");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path, Buffer.alloc(196613, 42), { mode: 0o600 });
  return { root, path };
};
test("one validation hashes bytes once while every new validation starts fresh", (t) => {
  const { path } = fixture(t), expected = createHash("sha256").update(fs.readFileSync(path)).digest("hex");
  let escaped;
  for (let iteration = 0; iteration < 2; iteration++) withByteObservation((scope) => {
    escaped = scope;
    assert.equal(scope.sha256(path), expected); assert.equal(scope.sha256(path), expected);
    assert.deepEqual(scope.counts(), { bytes: 196613, reads: 1, hits: 1, paths: 1 });
  });
  assert.throws(() => escaped.sha256(path), /source-changed/);
});
test("closed hardlink identities share only their digest and retain each binding", (t) => {
  const { root, path } = fixture(t), alias = join(root, "alias"); fs.linkSync(path, alias);
  withByteObservation((scope) => {
    assert.equal(scope.sha256(path), scope.sha256(alias));
    assert.deepEqual(scope.counts(), { bytes: 196613, reads: 1, hits: 1, paths: 2 });
  });
});
for (const [name, mutate] of [
  ["same-byte inode replacement", (path) => { fs.copyFileSync(path, `${path}.new`); fs.renameSync(`${path}.new`, path); }],
  ["mode change", (path) => fs.chmodSync(path, 0o644)],
  ["same-size rewrite with restored mtime", (path) => {
    const info = fs.statSync(path);
    // The disposable filesystem can expose millisecond ctime granularity.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    fs.writeFileSync(path, Buffer.alloc(info.size, 43)); fs.utimesSync(path, info.atime, info.mtime);
  }],
  ["added hardlink", (path) => fs.linkSync(path, `${path}.alias`)],
  ["symlink replacement", (path) => { fs.renameSync(path, `${path}.old`); fs.symlinkSync(`${path}.old`, path); }],
]) test(`repeat use and final fence refuse ${name}`, (t) => {
  for (const reuse of [false, true]) {
    const { path } = fixture(t);
    assert.throws(() => withByteObservation((scope) => {
      scope.sha256(path); mutate(path); if (reuse) scope.sha256(path);
    }));
  }
});
test("a rewrite during streaming cannot publish the partially observed digest", (t) => {
  const { path } = fixture(t), original = fs.readSync; let changed = false;
  const mocked = t.mock.method(fs, "readSync", (...args) => {
    const count = original(...args);
    if (!changed && count && fs.readlinkSync(`/proc/self/fd/${args[0]}`) === path) {
      changed = true; fs.writeFileSync(path, Buffer.alloc(196613, 43)); fs.utimesSync(path, 0, 0);
    }
    return count;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => withByteObservation((scope) => scope.sha256(path)), /source-changed/);
    assert.equal(changed, true);
  }
  finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});
test("observations cannot span an asynchronous boundary", (t) => {
  const { path } = fixture(t);
  assert.throws(() => withByteObservation((scope) => { scope.sha256(path); return Promise.resolve(); }), /source-changed/);
});
