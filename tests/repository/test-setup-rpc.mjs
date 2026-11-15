import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { SetupCommandContext } from "../../plugins/context-mode/scripts/setup-command-context.mjs";
import { withCodexRpc } from "../../plugins/gestalt/scripts/codex-rpc.mjs";
import { cmdShim } from "../../scripts/native-command-shims.mjs";

function fixture(t, respond) {
  const base = mkdtempSync(join(tmpdir(), "setup-owned-rpc-")); t.after(() => rmSync(base, { recursive: true, force: true }));
  writeFileSync(join(base, "codex"), "#!/usr/bin/env node\n// Controlled RPC capability: never launched.\n"); chmodSync(join(base, "codex"), 0o755);
  if (process.platform === "win32") writeFileSync(join(base, "codex.cmd"), cmdShim("codex"));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH"));
  const environment = { ...inherited, PATH: base }, launches = [], messages = []; let stops = 0;
  const commands = { apiVersion: 1, async launch(executable, invocation, streams) {
    launches.push({ executable, invocation }); let result, completed;
    const resultPromise = new Promise((done) => { result = done; }), completedPromise = new Promise((done) => { completed = done; });
    const stop = async () => {
      stops++; const outcome = { kind: "exit", code: 0 };
      const claim = { kind: "released", lease: "rpc-unit", backend: "controlled-rpc-unit", result: outcome };
      result(outcome); completed(claim); return claim;
    };
    void (async () => {
      for await (const bytes of streams.stdin) {
        const message = JSON.parse(bytes.toString("utf8")); messages.push(message);
        if (!message.id) continue;
        const reply = message.method === "initialize" ? {} : respond(message);
        if (reply === undefined) continue;
        const encoded = Buffer.from(JSON.stringify({ id: message.id, result: reply }) + "\n");
        // Split inside a multi-byte codepoint to verify streamed UTF-8 parsing.
        const split = Math.max(1, encoded.indexOf(Buffer.from("ü")) + 1);
        await streams.stdout(encoded.subarray(0, split)); await streams.stdout(encoded.subarray(split));
      }
    })().catch(() => {});
    return { id: "rpc-unit", result: resultPromise, completed: completedPromise, stop };
  } };
  const context = new SetupCommandContext({ mode: "managed", commands, environment, cwd: base, streams: { stdout: async () => {}, stderr: async () => {} } });
  return { base, environment, context, messages, launches, stops: () => stops };
}

test("setup RPC uses the supplied capability with literal requests and awaited shutdown", async (t) => {
  const f = fixture(t, (message) => ({ literal: message.params, text: "ü & native" }));
  const result = await withCodexRpc((request) => request("skills/list", { cwds: ["ü & path"], forceReload: true }), { workspace: f.base, environment: f.environment, commandContext: f.context });
  assert.deepEqual(result, { literal: { cwds: ["ü & path"], forceReload: true }, text: "ü & native" });
  assert.equal(f.launches.length, 1); assert.deepEqual(f.launches[0].invocation.argv.slice(-2), ["app-server", "--stdio"]);
  assert.equal(f.launches[0].invocation.cwd, f.base); assert.deepEqual(f.launches[0].invocation.environment, f.environment);
  assert.deepEqual(f.messages.map((message) => message.method), ["initialize", "initialized", "skills/list"]);
  assert.ok(f.stops() > 0); assert.equal(f.context.canCleanup(), true);
});

test("setup RPC timeout stops the supplied lease and retains the error", async (t) => {
  const f = fixture(t, () => undefined);
  await assert.rejects(withCodexRpc((request) => request("never", {}), { workspace: f.base, environment: f.environment, timeoutMs: 25, commandContext: f.context }), /timed out/);
  assert.ok(f.stops() > 0); assert.equal(f.context.canCleanup(), true);
});
