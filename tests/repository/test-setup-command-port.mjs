import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SetupCommandContext } from "../../plugins/context-mode/scripts/setup-command-context.mjs";
import { tryAcquireRuntimeLock } from "../../plugins/context-mode/scripts/runtime-lock.mjs";
const silent = { stdout: async () => {}, stderr: async () => {} };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const released = (id, result = { kind: "exit", code: 0 }) => ({ kind: "released", lease: id, backend: "controlled-unit-capability", result });
function owned(launch) { return { mode: "managed", commands: { apiVersion: 1, launch }, streams: silent }; }

test("managed setup requires a versioned owned capability and never falls back", () => {
  for (const commands of [undefined, {}, { apiVersion: 2, launch() {} }, { apiVersion: 1 }]) assert.throws(() => new SetupCommandContext({ mode: "managed", commands }), /explicit version1 owned/);
  assert.throws(() => new SetupCommandContext({ mode: "standalone", commands: { apiVersion: 1, launch() {} } }), /requires managed/);
  assert.throws(() => new SetupCommandContext({ mode: "other" }), /standalone or managed/);
});

test("standalone executes literal argv, stdin, streams and per-call env with direct-child scope", async () => {
  const before = process.env.SETUP_PORT_LITERAL;
  const context = new SetupCommandContext({ environment: { ...process.env, SETUP_PORT_LITERAL: "isolated ü & value" }, streams: silent });
  const literal = "ü & | % ! ' \" $ ` ( )";
  const output = await context.run(process.execPath, ["-e", "let s='';for await(const b of process.stdin)s+=b;console.log(JSON.stringify({args:process.argv.slice(1),env:process.env.SETUP_PORT_LITERAL,input:s}));", literal], { input: "stdin ü & literal\n", capture: true });
  assert.deepEqual(JSON.parse(output), { args: [literal], env: "isolated ü & value", input: "stdin ü & literal\n" });
  assert.equal(process.env.SETUP_PORT_LITERAL, before);
  assert.deepEqual(context.outcome().ownership, { kind: "standalone", completeTree: false });
  await assert.rejects(context.run(process.execPath, ["-e", "process.exit(37)"], { stdin: "ignore" }), (error) => error.status === 37);
  assert.equal(context.canCleanup(), true);
});

test("command result alone cannot release a managed transaction lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "setup-port-test-"));
  const lock = join(directory, "lock"), done = deferred(), stopping = deferred(); let stopCalled = false;
  try {
    const context = new SetupCommandContext(owned(async () => ({ id: "one", result: Promise.resolve({ kind: "exit", code: 0 }), completed: done.promise, stop: () => { stopCalled = true; return stopping.promise; } })));
    const release = context.protectLock(lock, tryAcquireRuntimeLock(lock));
    let returned = false;
    const running = context.run(process.execPath, [], { stdin: "ignore" }).then(() => { returned = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stopCalled, true); assert.equal(returned, false); assert.equal(context.canCleanup(), false);
    assert.ok(readdirSync(lock).some((name) => name.startsWith("command-")));
    stopping.resolve(released("one")); done.resolve(released("one")); await running;
    assert.equal(context.canCleanup(), true); assert.equal(release(), true); assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("unknown and malformed release proofs durably fence locks after owner death", async () => {
  for (const proof of [{ kind: "unknown", reason: "absence unconfirmed" }, released("different"), { ...released("one"), result: {} }, { ...released("one"), backend: "" }]) {
    const directory = mkdtempSync(join(tmpdir(), "setup-port-unknown-")), lock = join(directory, "lock");
    try {
      const context = new SetupCommandContext(owned(async () => ({ id: "one", result: Promise.resolve({ kind: "exit", code: 0 }), completed: Promise.resolve(proof), stop: async () => proof })));
      const release = context.protectLock(lock, tryAcquireRuntimeLock(lock));
      try { await context.run(process.execPath, [], { stdin: "ignore" }); } catch (error) { assert.match(error.message, /lifetime is unknown/); }
      assert.equal(context.canCleanup(), false); assert.equal(release(), false);
      const marker = readdirSync(lock).find((name) => name.startsWith("command-"));
      assert.equal(JSON.parse(readFileSync(join(lock, marker))).schemaVersion, 1);
      assert.equal(tryAcquireRuntimeLock(lock), null);
      // The marker remains an independent recovery fence even if a later owner
      // record says the orchestrator is dead. Recovery never trusts PID alone.
      const owner = readdirSync(lock).find((name) => !name.startsWith("command-"));
      assert.ok(owner); assert.ok(readdirSync(lock).length > 1);
      const exited = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" });
      assert.equal(exited.status, 0); const deadPid = Number(exited.stdout.trim());
      assert.throws(() => process.kill(deadPid, 0), { code: "ESRCH" });
      const record = JSON.parse(readFileSync(join(lock, owner), "utf8")); record.pid = deadPid;
      const deadOwner = `owner-${deadPid}-${record.token}.json`;
      renameSync(join(lock, owner), join(lock, deadOwner)); writeFileSync(join(lock, deadOwner), JSON.stringify(record));
      assert.equal(tryAcquireRuntimeLock(lock), null); assert.ok(readdirSync(lock).includes(marker));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test("malformed launch retains authority and does not use the default adapter", async () => {
  const directory = mkdtempSync(join(tmpdir(), "setup-port-malformed-")), lock = join(directory, "lock"); let calls = 0;
  try {
    const context = new SetupCommandContext(owned(async () => { calls++; return { id: "broken" }; }));
    const release = context.protectLock(lock, tryAcquireRuntimeLock(lock));
    await assert.rejects(context.run(process.execPath, []), /malformed lease/);
    assert.equal(calls, 1); assert.equal(context.canCleanup(), false); assert.equal(release(), false);
    assert.ok(readdirSync(lock).some((name) => name.startsWith("command-")));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("cancellation awaits the owned stop proof before cleanup can begin", async () => {
  const controller = new AbortController(), result = deferred(), done = deferred(), stopped = deferred(); let stops = 0;
  const context = new SetupCommandContext({ ...owned(async () => ({ id: "cancelled", result: result.promise, completed: done.promise, stop: () => { stops++; return stopped.promise; } })), signal: controller.signal });
  let settled = false;
  const running = context.run(process.execPath, []).catch((error) => { settled = true; assert.equal(error.status, 130); });
  await new Promise((resolve) => setImmediate(resolve)); controller.abort({ status: 130 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(stops > 0); assert.equal(settled, false); assert.equal(context.canCleanup(), false);
  const proof = released("cancelled", { kind: "signal", signal: "SIGTERM" });
  stopped.resolve(proof); done.resolve(proof); result.resolve(proof.result); await running;
  assert.equal(context.canCleanup(), true);
});


test("cancellation during asynchronous launch retains authority and stops a late lease", async () => {
  const controller = new AbortController(), launching = deferred(), stopped = deferred(); let lateStop = false;
  const context = new SetupCommandContext({ ...owned(() => launching.promise), signal: controller.signal });
  const running = context.run(process.execPath, []);
  await new Promise((resolve) => setImmediate(resolve)); controller.abort({ status: 130 });
  await assert.rejects(running, (error) => error.status === 130);
  assert.equal(context.canCleanup(), false);
  launching.resolve({ id: "late", stop: async () => { lateStop = true; stopped.resolve(); return released("late"); } });
  await stopped.promise; assert.equal(lateStop, true); assert.equal(context.canCleanup(), false);
});
