import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scripts = fileURLToPath(new URL("../../plugins/context-mode/scripts", import.meta.url));
const worker = fileURLToPath(new URL("./fixtures/runtime-lock-worker.mjs", import.meta.url));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `fixture precondition timed out: ${label}`);
    await pause(5);
  }
}
function fixture(t, kind, scenario) {
  const directory = mkdtempSync(join(tmpdir(), "gestalt-lock-"));
  const source = join(directory, "source");
  const home = join(directory, "home");
  const lock = kind === "install" ? join(home, "runtime", "context-mode.install.lock") : join(source, ".context-mode-prepare.lock");
  mkdirSync(source);
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(join(source, "package.json"), '{"version":"1.0.0"}');
  const children = [];
  const gates = [];
  t.after(async () => {
    for (const gate of gates) writeFileSync(gate, "release");
    for (const child of children) if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill("SIGTERM");
    await Promise.all(children.map((child) => child.done));
    assert.ok(children.every((child) => child.process.exitCode !== null || child.process.signalCode !== null), "all owned children settled");
    rmSync(directory, { recursive: true, force: true });
    assert.equal(existsSync(directory), false, "temporary roots removed");
  });
  const config = { scripts, source, home, lock, kind, scenario, ownerPid: process.pid,
    successorPid: process.pid, entered: join(directory, "entered"), injected: join(directory, "injected") };
  function start(extra = {}) {
    const selected = { ...config, ...extra };
    if (selected.gate) gates.push(selected.gate);
    const processChild = spawn(process.execPath, [worker, JSON.stringify(selected)], {
      env: { ...process.env, CONTEXT_MODE_PACKAGE_MANAGER: "npm" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    processChild.stdout.on("data", (data) => { stdout += data; });
    processChild.stderr.on("data", (data) => { stderr += data; });
    const child = { process: processChild, done: new Promise((resolve, reject) => {
      processChild.on("error", reject);
      processChild.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    }) };
    children.push(child);
    return child;
  }
  function owner(value = `${process.pid}\n`, aged = false, format = "legacy") {
    mkdirSync(lock);
    const pid = Number.parseInt(value, 10) || process.pid;
    const token = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    if (format === "legacy") writeFileSync(join(lock, "owner.pid"), value);
    else writeFileSync(join(lock, `owner-${pid}-${token}.json`), value === "" ? "" :
      JSON.stringify({ schemaVersion: 1, pid, token }));
    if (aged) { const old = new Date(Date.now() - 3600000); utimesSync(lock, old, old); }
  }
  async function result(child) {
    const output = await child.done;
    assert.equal(output.code, 0, output.stderr);
    return JSON.parse(output.stdout.trim());
  }
  return { ...config, directory, start, owner, result };
}
function ownerPid(lock) {
  const name = readdirSync(lock).find((name) => /^(?:owner\.pid|owner-.*\.json|legacy-.*\.pid)$/.test(name));
  const value = readFileSync(join(lock, name), "utf8");
  return name.endsWith(".json") ? JSON.parse(value).pid : Number(value.trim());
}
async function deadPid() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  return pid;
}

for (const kind of ["install", "prepare"]) {
  for (const scenario of ["aged-live", "partial", "unreadable", "permission"]) {
    test(`${kind}: ${scenario} owner is retained without entering build`, { timeout: 10000 }, async (t) => {
      const f = fixture(t, kind, scenario);
      f.owner(scenario === "partial" ? "" : `${process.pid}\n`, scenario !== "partial");
      const result = await f.result(f.start());
      assert.equal(result.entered, false, "uncertain or live owner must exclude build");
      assert.match(result.message, /timed out waiting/);
      assert.ok(result.polls > 1, "bounded timeout exercised repeated normal acquisition polls");
      assert.equal(existsSync(f.lock), true);
    });
  }
  test(`${kind}: demonstrably dead owner is recovered`, { timeout: 10000 }, async (t) => {
    const f = fixture(t, kind, "dead");
    f.owner(`${await deadPid()}\n`);
    const result = await f.result(f.start());
    assert.equal(result.entered, true);
    assert.equal(result.status, "completed", result.message);
    assert.ok(result.polls >= 1, "dead-owner recovery retried acquisition after polling");
    assert.ok(result.elapsed < 180000, "recovery did not consume the preparation wait budget");
    assert.equal(existsSync(f.lock), false);
  });
  for (const scenario of ["release-replacement", "observation-replacement", "unlink-replacement", "rmdir-replacement", "legacy-rename-replacement"]) {
    test(`${kind}: ${scenario} preserves successor ownership`, { timeout: 10000 }, async (t) => {
      const f = fixture(t, kind, scenario);
      if (scenario !== "release-replacement") f.owner(`${await deadPid()}\n`);
      await f.result(f.start());
      assert.equal(existsSync(f.injected), true, "replacement precondition occurred");
      assert.equal(readFileSync(join(f.lock, "successor"), "utf8"), "keep");
      assert.equal(ownerPid(f.lock), process.pid);
    });
  }
  test(`${kind}: concurrent contender cannot enter while aged owner builds`, { timeout: 15000 }, async (t) => {
    const f = fixture(t, kind, "concurrent");
    const gate = join(f.directory, "release");
    const first = f.start({ gate });
    await until(() => existsSync(f.entered), "first owner entered build");
    assert.equal(ownerPid(f.lock), first.process.pid);
    const old = new Date(Date.now() - 3600000); utimesSync(f.lock, old, old);
    const secondMarker = join(f.directory, "second-entered");
    try {
      const second = await f.result(f.start({ entered: secondMarker }));
      assert.equal(existsSync(f.lock), true, "first owner's lock remains held before gate release");
      assert.equal(ownerPid(f.lock), first.process.pid,
        "contender must preserve the first owner's PID before gate release");
      assert.equal(second.entered, false, "second contender must stay outside build");
      assert.equal(existsSync(secondMarker), false);
    } finally {
      writeFileSync(gate, "release");
      assert.equal((await f.result(first)).status, "completed");
    }
  });
  test(`${kind}: build failure releases its own lock`, { timeout: 10000 }, async (t) => {
    const f = fixture(t, kind, "failure");
    const result = await f.result(f.start());
    assert.equal(result.entered, true);
    assert.match(result.message, /injected build failure/);
    assert.equal(existsSync(f.lock), false);
    assert.equal(readdirSync(dirname(f.lock)).some((name) => name.includes(".claim-")), false);
  });
  test(`${kind}: interrupted owner preserves prepared runtime and can be recovered`, { timeout: 15000 }, async (t) => {
    const f = fixture(t, kind, "interrupted");
    assert.equal((await f.result(f.start())).status, "completed");
    const preparedRoot = kind === "install" ? join(f.home, "runtime", "context-mode") : f.source;
    const manifest = join(preparedRoot, ".context-mode-prepared.json");
    const original = readFileSync(manifest, "utf8");
    const marker = join(f.directory, "interrupted-entered");
    const child = f.start({ force: true, entered: marker, gate: join(f.directory, "release-interrupted") });
    await until(() => existsSync(marker), "interrupted owner holds build gate");
    assert.equal(ownerPid(f.lock), child.process.pid);
    child.process.kill("SIGTERM");
    const stopped = await child.done;
    assert.equal(stopped.signal, "SIGTERM");
    assert.equal(readFileSync(manifest, "utf8"), original, "previous prepared runtime remains intact");
    assert.equal((await f.result(f.start({ force: true, entered: join(f.directory, "recovered-entered") }))).status, "completed");
    assert.equal(existsSync(f.lock), false);
  });
  test(`${kind}: abandoned unpublished claim recovers`, { timeout: 10000 }, async (t) => {
    const f = fixture(t, kind, "claim");
    const claim = `${f.lock}.claim-${await deadPid()}-cccccccc-cccc-4ccc-accc-cccccccccccc`;
    mkdirSync(claim);
    writeFileSync(join(claim, "partial"), "crashed publication");
    const result = await f.result(f.start());
    assert.equal(result.status, "completed", result.message);
    assert.equal(existsSync(claim), false);
    assert.equal(existsSync(f.lock), false);
  });
  test(`${kind}: new-format dead owner is recovered`, { timeout: 10000 }, async (t) => {
    const f = fixture(t, kind, "new-dead");
    f.owner(`${await deadPid()}\n`, false, "new");
    const result = await f.result(f.start());
    assert.equal(result.entered, true);
    assert.equal(result.status, "completed", result.message);
    assert.equal(existsSync(f.lock), false);
  });
  test(`${kind}: missing metadata protects a held legacy initializer`, { timeout: 15000 }, async (t) => {
    const f = fixture(t, kind, "missing");
    mkdirSync(f.lock);
    const first = f.start();
    await until(() => existsSync(f.injected), "contender observed empty initializer");
    assert.equal(existsSync(f.lock), true, "empty initializer was not displaced");
    writeFileSync(join(f.lock, "owner.pid"), `${process.pid}\n`);
    const result = await f.result(first);
    assert.equal(result.entered, false);
    assert.match(result.message, /timed out waiting/);
    assert.equal(ownerPid(f.lock), process.pid, "published initializer still owns lock");
  });
  test(`${kind}: failed stale unlink cannot remove an empty successor initializer`, { timeout: 10000 }, async (t) => {
    const f = fixture(t, kind, "unlink-empty-replacement");
    f.owner(`${await deadPid()}\n`);
    const result = await f.result(f.start());
    assert.equal(existsSync(f.injected), true, "successor replaced owner immediately before unlink");
    assert.equal(result.entered, false);
    assert.match(result.message, /timed out waiting/);
    assert.equal(existsSync(f.lock), true, "ENOENT unlink must not authorize rmdir of successor");
    assert.deepEqual(readdirSync(f.lock), [], "missing metadata remains uncertain");
  });
}
