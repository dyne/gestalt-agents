/** Real installed helpers on the actual OS; no platform substitutions. */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { installOrgPlan } from "../../scripts/install-org-plan.mjs";
import { installManagedCommands } from "../../scripts/install-managed-commands.mjs";
import { commandTarget } from "../../plugins/context-mode/scripts/native-command.mjs";
import { ensureManagedRoot } from "../../scripts/setup-storage.mjs";
import { parsePlan } from "../../plugins/gestalt/skills/org-plan/scripts/org-plan-parser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = "plugins/gestalt/skills/org-plan/scripts";
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(process.env.TMPDIR || tmpdir(), "gestalt-native-helper-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const codex = join(base, "Codex ü & helpers"), gestalt = join(base, "Gestalt ü & helpers");
  ensureManagedRoot(codex); ensureManagedRoot(gestalt);
  const env = { ...process.env, CODEX_HOME: codex, GESTALT_HOME: gestalt };
  for (const key of Object.keys(env)) if (key.startsWith("GESTALT_MOBILE_ORG_PLAN_")) delete env[key];
  return { base, codex, gestalt, env };
}
function installed(path, args, options = {}) {
  const target = commandTarget(process.platform === "win32" ? `${path}.cmd` : path);
  return spawnSync(target.executable, [...target.prefix, ...args], { encoding: "utf8", timeout: 30_000, ...options, shell: false });
}
function sourceCopy(base) {
  const source = join(base, "updated source");
  cpSync(join(root, scripts), join(source, scripts), { recursive: true });
  copyFileSync(join(root, "plugins/gestalt/LICENSE"), join(source, "plugins/gestalt/LICENSE"));
  return source;
}

test("Org LF and CRLF plans retain source fingerprints, line endings and final-newline state", (t) => {
  const base = realpathSync(mkdtempSync(join(process.env.TMPDIR || tmpdir(), "org-eol-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const original = readFileSync(join(root, "tests/plugins/gestalt/fixtures/valid-minimal.org"), "utf8");
  const lf = original.replace(/\r\n/g, "\n").replace(/\n$/, "");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GESTALT_MOBILE_ORG_PLAN_")) delete env[key];
  for (const ending of ["\n", "\r\n"]) for (const finalNewline of [false, true]) {
    const text = lf.replace(/\n/g, ending) + (finalNewline ? ending : "");
    const plan = join(base, `${ending.length}-${finalNewline}.org`); writeFileSync(plan, text);
    assert.equal(parsePlan(text).fingerprint, `sha256:${hash(plan)}`);
    const run = (...args) => spawnSync(process.execPath, [join(root, scripts, "org-plan-cli.mjs"), ...args], { env, encoding: "utf8" });
    const transition = run("set", plan, "first-outcome", "WIP");
    assert.equal(transition.status, 0, transition.stderr);
    const measurement = run("measure", "start", plan, "first-outcome", '{"observedAt":"2026-11-15T13:00:00Z","tokensUsed":1}');
    assert.equal(measurement.status, 0, measurement.stderr);
    const updated = readFileSync(plan, "utf8");
    assert.equal(updated.endsWith(ending), finalNewline);
    assert.equal(ending === "\r\n" ? /(?<!\r)\n/.test(updated) : /\r/.test(updated), false);
    assert.equal(parsePlan(updated).fingerprint, `sha256:${hash(plan)}`);
    assert.equal(run("review", plan, "first-outcome", "REVIEWED").status, 1);
  }
});

test("installed Org lifecycle preserves review gates, status schema and profile isolation", async (t) => {
  const f = fixture(t);
  await installOrgPlan(root, f.codex);
  const command = join(f.codex, "bin/org-plan"), plan = join(f.base, "literal ü & plan.org");
  copyFileSync(join(root, "tests/plugins/gestalt/fixtures/valid-minimal.org"), plan);
  if (process.env.GESTALT_NATIVE_TEST_EVIDENCE) {
    const bytes = readFileSync(plan);
    mkdirSync(process.env.GESTALT_NATIVE_TEST_EVIDENCE, { recursive: true });
    writeFileSync(join(process.env.GESTALT_NATIVE_TEST_EVIDENCE, "plan-source-eol.json"), JSON.stringify({ sha256: hash(plan), bytes: bytes.length, crlf: bytes.toString().includes("\r\n"), platform: process.platform }, null, 2));
  }
  const status = join(f.base, "status"); ensureManagedRoot(status);
  const env = { ...f.env, GESTALT_MOBILE_ORG_PLAN_STATUS_FILE: join(status, "status.json") };
  const run = (...args) => installed(command, args, { env });
  const validation = run("validate", plan);
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(run("review", plan, "first-outcome", "REVIEWED").status, 1);
  assert.equal(run("set", plan, "first-outcome", "WIP").status, 0);
  assert.equal(run("set", plan, "first-outcome", "DONE").status, 1);
  assert.equal(run("l2", plan, "first-task", "WIP").status, 0);
  assert.equal(run("l2", plan, "first-task", "DONE").status, 0);
  assert.equal(run("set", plan, "first-outcome", "DONE").status, 0);
  assert.equal(run("review", plan, "first-outcome", "REVIEWED").status, 0);
  const record = JSON.parse(readFileSync(join(status, "status.json"), "utf8"));
  assert.equal(record.schemaVersion, 1); assert.equal(record.planPath, realpathSync(plan));
  assert.equal(record.reason, "review:first-outcome:REVIEWED");
  assert.match(record.updatedAt, /^\d{4}-\d\d-\d\dT/);
  const profile = run("prepare-supervision", "--executor-model", "gpt-6.1-sol", "--reviewer-profile-name", "independent-reviewer");
  assert.equal(profile.status, 0, profile.stderr);
  assert.ok(existsSync(join(f.codex, "agents/independent-reviewer.toml")));
  const second = join(f.base, "independent Codex"); ensureManagedRoot(second);
  const before = hash(join(f.codex, "agents/org-plan-executor.toml"));
  assert.equal(installed(command, ["prepare-executor", "--model", "gpt-6.1-terra"], { env: { ...f.env, CODEX_HOME: second } }).status, 0);
  assert.equal(hash(join(f.codex, "agents/org-plan-executor.toml")), before);
  assert.match(readFileSync(join(second, "agents/org-plan-executor.toml"), "utf8"), /model = "gpt-6.1-terra"/);
  assert.equal(run("prepare-supervision", "--executor-profile-name", "same", "--reviewer-profile-name", "same").status, 2);
  assert.equal(run("prepare-executor", "--model", 'invalid"model').status, 2);
});

test("installed managed command forwards literal tokens, stdin, defaults and exact exit", (t) => {
  const f = fixture(t), probe = join(f.base, "probe ü & literal.mjs");
  writeFileSync(probe, "import {readFileSync} from 'node:fs';console.log(JSON.stringify({args:process.argv.slice(2),stdin:readFileSync(0,'utf8'),value:process.env.HELPER_DEFAULT}));process.exit(23);\n");
  installManagedCommands(f.gestalt, [{ name: "literal-probe", command: ["node", probe], env: { HELPER_DEFAULT: "default ü & value" } }]);
  const command = join(f.gestalt, "bin/literal-probe");
  const args = ["", "space ü & | ^ % !", "$(false)", "a'b\"c", "line\nnext", "--flag=value"];
  const input = "literal ü stdin\nsecond line\n";
  const result = installed(command, args, { env: f.env, input });
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args, stdin: input, value: "default ü & value" });
  assert.equal(JSON.parse(installed(command, [], { env: { ...f.env, HELPER_DEFAULT: "override" }, input: "" }).stdout).value, "override");
  installManagedCommands(f.gestalt, [{ name: "literal-probe", command: ["node", probe], env: { HELPER_DEFAULT: "updated" } }]);
  assert.equal(JSON.parse(installed(command, [], { env: f.env, input: "" }).stdout).value, "updated");
  writeFileSync(join(f.gestalt, "bin/user-command"), "user owned");
  assert.throws(() => installManagedCommands(f.gestalt, [{ name: "user-command", command: ["node", probe] }]), /unmanaged/);
  assert.equal(readFileSync(join(f.gestalt, "bin/user-command"), "utf8"), "user owned");
});

test("installed command executes through the actual native user shells", async (t) => {
  const f = fixture(t); await installOrgPlan(root, f.codex);
  installManagedCommands(f.gestalt, [{ name: "org-plan", command: ["node", join(f.codex, "bin/org-plan")], env: { CODEX_HOME: f.codex } }]);
  const command = join(f.gestalt, "bin/org-plan");
  if (process.platform === "win32") {
    // cmd uses its own documented command quoting; no Bash/WSL/DevMode.
    const cmd = spawnSync(process.env.ComSpec, ["/d", "/s", "/c", `""${command}.cmd" --help"`], { env: f.env, encoding: "utf8", windowsVerbatimArguments: true });
    assert.equal(cmd.status, 0, cmd.stderr); assert.match(cmd.stdout, /usage: org-plan/);
    const script = "$ErrorActionPreference='Stop'; & ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:HELPER_TEST_COMMAND))) '--help'; exit $LASTEXITCODE";
    const ps = spawnSync(join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { env: { ...f.env, HELPER_TEST_COMMAND: Buffer.from(`${command}.cmd`).toString("base64") }, encoding: "utf8" });
    assert.equal(ps.status, 0, ps.stderr); assert.match(ps.stdout, /usage: org-plan/);
    const probe = join(f.base, "shell ü & probe.mjs");
    writeFileSync(probe, "import {readFileSync} from 'node:fs';console.log(JSON.stringify({args:process.argv.slice(2),input:readFileSync(0,'utf8')}));process.exit(17);\n");
    installManagedCommands(f.gestalt, [{ name: "shell-probe", command: ["node", probe] }]);
    const shellProbe = join(f.gestalt, "bin/shell-probe.cmd"), literal = "literal ü & | ^ % !", input = "literal ü stdin\n";
    const cmdProbe = spawnSync(process.env.ComSpec, ["/d", "/s", "/c", `""${shellProbe}" "${literal}""`], { env: f.env, input, encoding: "utf8", windowsVerbatimArguments: true });
    assert.equal(cmdProbe.status, 17, cmdProbe.stderr);
    assert.deepEqual(JSON.parse(cmdProbe.stdout), { args: [literal], input });
    const psScript = "$ErrorActionPreference='Stop'; & ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:HELPER_TEST_COMMAND))) 'literal ü & | ^ % !'; exit $LASTEXITCODE";
    const psProbe = spawnSync(join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(psScript, "utf16le").toString("base64")], { env: { ...f.env, HELPER_TEST_COMMAND: Buffer.from(shellProbe).toString("base64") }, input, encoding: "utf8" });
    assert.equal(psProbe.status, 17, psProbe.stderr);
    assert.deepEqual(JSON.parse(psProbe.stdout), { args: [literal], input });
  } else {
    const result = spawnSync("/bin/sh", ["-c", '"$1" --help', "helper-shell", command], { env: f.env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /usage: org-plan/);
  }
});

test("complete bundle update pins open launchers and failed activation keeps previous version", async (t) => {
  const f = fixture(t); await installOrgPlan(root, f.codex);
  const publicPath = join(f.codex, "bin/org-plan"), old = join(f.codex, "bin/pinned-old");
  copyFileSync(publicPath, old); chmodSync(old, 0o755);
  const source = sourceCopy(f.base), cli = join(source, scripts, "org-plan-cli.mjs");
  writeFileSync(cli, readFileSync(cli, "utf8").replaceAll("usage: org-plan", "usage: org-plan-updated"));
  await installOrgPlan(source, f.codex);
  assert.match(installed(publicPath, ["--help"], { env: f.env }).stdout, /usage: org-plan-updated/);
  assert.doesNotMatch(spawnSync(process.execPath, [old, "--help"], { env: f.env, encoding: "utf8" }).stdout, /org-plan-updated/);
  const before = hash(publicPath), preload = join(f.base, "activation-fault.mjs");
  writeFileSync(preload, "import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;fs.renameSync=(s,t)=>{if(String(t).endsWith('/org-plan')||String(t).endsWith('\\\\org-plan'))throw Object.assign(new Error('interrupted activation'),{code:'EINTR'});return rename(s,t);};syncBuiltinESMExports();");
  const failed = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, join(root, "scripts/install-org-plan.mjs"), source, f.codex], { env: f.env, encoding: "utf8", timeout: 30_000 });
  assert.equal(failed.status, 1, failed.stderr); assert.match(failed.stderr, /interrupted activation/);
  assert.equal(hash(publicPath), before);
  assert.match(installed(publicPath, ["--help"], { env: f.env }).stdout, /org-plan-updated/);
  writeFileSync(cli, "invalid fixture syntax !!!\n");
  await assert.rejects(installOrgPlan(source, f.codex), /validation/);
  assert.equal(hash(publicPath), before);
});

test("killed publication is recoverable without activating an incomplete bundle", { timeout: 60_000 }, async (t) => {
  const f = fixture(t); await installOrgPlan(root, f.codex);
  const publicPath = join(f.codex, "bin/org-plan"), before = hash(publicPath);
  const gate = join(f.base, "publication-gate"), preload = join(f.base, "kill-publication.mjs");
  writeFileSync(preload, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;fs.renameSync=(s,t)=>{if(String(t)===${JSON.stringify(publicPath)}){fs.writeFileSync(${JSON.stringify(gate)},'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);}return rename(s,t);};syncBuiltinESMExports();`);
  const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, join(root, "scripts/install-org-plan.mjs"), root, f.codex], { env: f.env, stdio: "ignore" });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const deadline = Date.now() + 25_000;
  while (!existsSync(gate) && Date.now() < deadline && child.exitCode === null && child.signalCode === null) await setTimeout(50);
  assert.ok(existsSync(gate), "installer must reach the real activation boundary before interruption");
  child.kill("SIGKILL"); await exited;
  assert.equal(hash(publicPath), before);
  assert.equal(installed(publicPath, ["--help"], { env: f.env }).status, 0);
  await installOrgPlan(root, f.codex);
  assert.equal(installed(publicPath, ["--help"], { env: f.env }).status, 0);
  assert.ok(readdirSync(join(f.codex, "lib/gestalt-org-plan/bundles")).length >= 2);
});

test("profile publication rolls back both existing profiles after a partial native rename", async (t) => {
  const f = fixture(t); await installOrgPlan(root, f.codex);
  const command = join(f.codex, "bin/org-plan");
  assert.equal(installed(command, ["prepare-supervision"], { env: f.env }).status, 0);
  const paths = ["reviewer", "executor"].map((role) => join(f.codex, `agents/org-plan-${role}.toml`));
  paths.forEach((path, index) => writeFileSync(path, `old-${index}\n`));
  const before = paths.map(hash), preload = join(f.base, "profile-fault.mjs");
  writeFileSync(preload, "import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;let count=0;fs.renameSync=(s,t)=>{if(++count===2)throw new Error('partial profile rename');return rename(s,t);};syncBuiltinESMExports();");
  const result = installed(command, ["prepare-supervision"], { env: { ...f.env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` } });
  assert.equal(result.status, 1); assert.match(result.stderr, /partial profile rename/);
  assert.deepEqual(paths.map(hash), before);
  assert.equal(readdirSync(join(f.codex, "agents")).some((name) => name.startsWith(".org-plan-stage.")), false);
  assert.equal(result.stdout, "");
});
