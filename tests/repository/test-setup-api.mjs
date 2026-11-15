import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = new URL("../../gestalt-setup.mjs", import.meta.url);

test("setup import is inert with unrelated argv and exports the canonical owner", () => {
  const program = `process.argv=[process.execPath,'unrelated-entry.mjs','--help'];
const before=JSON.stringify(process.env);
const owner=await import(${JSON.stringify(entry.href)});
console.log(JSON.stringify({version:owner.SETUP_API_VERSION,type:typeof owner.setupAgents,environmentUnchanged:before===JSON.stringify(process.env)}));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, type: "function", environmentUnchanged: true });
});

test("standalone Node setup help preserves the CLI contract", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(entry), "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: node gestalt-setup\.mjs/);
  for (const flag of ["--prepare-only", "--force", "--dry-run", "--extra-skills", "--extra-skills-only"]) assert.ok(result.stdout.includes(flag));
});

test("library calls use supplied streams without changing per-call or process environment", async () => {
  const { setupAgents } = await import(entry.href);
  const before = JSON.stringify(process.env), outputs = [[], []];
  const environments = [{ CODEX_HOME: "profile-a" }, { CODEX_HOME: "profile-b" }];
  await Promise.all(environments.map((environment, index) => setupAgents(["--help"], {
    environment,
    streams: { stdout: async (bytes) => { outputs[index].push(Buffer.from(bytes)); } },
  })));
  assert.deepEqual(environments, [{ CODEX_HOME: "profile-a" }, { CODEX_HOME: "profile-b" }]);
  assert.equal(JSON.stringify(process.env), before);
  for (const chunks of outputs) assert.match(Buffer.concat(chunks).toString(), /^Usage: node gestalt-setup\.mjs/);
});
