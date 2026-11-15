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

test("standalone RPC sends EOF and observes real child completion before a repeat", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "setup-standalone-rpc-")); t.after(() => rmSync(base, { recursive: true, force: true }));
  const entry = join(base, "codex"), receipt = join(base, "eof.jsonl");
  writeFileSync(entry, `#!/usr/bin/env node
const {createInterface}=require('node:readline');const fs=require('node:fs');
const input=createInterface({input:process.stdin});
input.on('line',line=>{const message=JSON.parse(line);if(message.id)console.log(JSON.stringify({id:message.id,result:{method:message.method,text:'ü & repeat'}}));});
input.on('close',()=>fs.appendFileSync(process.env.RPC_EOF_RECEIPT,JSON.stringify({pid:process.pid,eof:true})+'\\n'));
`); chmodSync(entry, 0o755);
  if (process.platform === "win32") writeFileSync(`${entry}.cmd`, cmdShim("codex"));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH"));
  const environment = { ...inherited, RPC_EOF_RECEIPT: receipt, PATH: base + (process.platform === "win32" ? ";" : ":") + process.env.PATH };
  const context = new SetupCommandContext({ environment, cwd: base, streams: { stdout: async () => {}, stderr: async () => {} } });
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await withCodexRpc((request) => request("config/read", {}), { workspace: base, environment, commandContext: context });
    assert.deepEqual(result, { method: "config/read", text: "ü & repeat" });
    assert.equal(context.canCleanup(), true);
    assert.deepEqual(context.outcome().ownership, { kind: "standalone", completeTree: false });
  }
  const { readFileSync } = await import("node:fs");
  const receipts = readFileSync(receipt, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(receipts.length, 2); assert.ok(receipts.every((value) => value.eof === true));
});
