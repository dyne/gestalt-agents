import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { commandTarget, runCommand } from "../../plugins/context-mode/scripts/native-command.mjs";
import { tryAcquireRuntimeLock } from "../../plugins/context-mode/scripts/runtime-lock.mjs";
import { ensureManagedRoot } from "../../scripts/setup-storage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temp = () => realpathSync(mkdtempSync(join(realTemp(), "native-setup-")));
function realTemp() { return process.env.TMPDIR || tmpdir(); }
const hash = (text) => createHash("sha256").update(text).digest("hex");
function tree(path) {
  if (!existsSync(path)) return null;
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
    const file = join(path, entry.name), info = lstatSync(file);
    return [entry.name, process.platform === "win32" ? null : info.mode & 0o777, entry.isSymbolicLink() ? readlinkSync(file) : entry.isDirectory() ? tree(file) : hash(readFileSync(file))];
  });
}
function nodeShim(bin, name, script) {
  const entry = join(bin, `${name}.mjs`);
  writeFileSync(entry, `#!/usr/bin/env node\n${script}\n`, { mode: 0o755 });
  if (process.platform !== "win32") {
    cpSync(entry, join(bin, name)); chmodSync(join(bin, name), 0o755);
  } else {
    writeFileSync(join(bin, `${name}.cmd`), `@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT /b\n:start\nSETLOCAL\nCALL :find_dp0\n\nIF EXIST "%dp0%\\node.exe" (\n  SET "_prog=%dp0%\\node.exe"\n) ELSE (\n  SET "_prog=node"\n  SET PATHEXT=%PATHEXT:;.JS;=;%\n)\n\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${name}.mjs" %*\n`);
  }
}

function fixture(t) {
  const base = temp(); t.after(() => rmSync(base, { recursive: true, force: true }));
  const source = join(base, "marketplace with ünicode & spaces");
  mkdirSync(source);
  for (const path of ["gestalt-setup.mjs", "gestalt-setup.sh", "scripts", "plugins/gestalt", "plugins/context-mode/scripts", ".agents/plugins"]) cpSync(join(root, path), join(source, path), { recursive: true });
  const bin = join(base, "tools"); mkdirSync(bin);
  nodeShim(bin, "npm", `import { appendFileSync } from 'node:fs'; appendFileSync(process.env.SETUP_CALLS, JSON.stringify(['npm', ...process.argv.slice(2)])+'\\n'); if (process.env.FAIL_NPM) process.exit(42);`);
  nodeShim(bin, "npx", `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; appendFileSync(process.env.SETUP_CALLS, JSON.stringify(['npx', process.cwd(), ...process.argv.slice(2)])+'\\n'); const path=join(process.cwd(),'.agents/skills/fixture-skill'); mkdirSync(path,{recursive:true}); writeFileSync(join(path,'SKILL.md'),'fixture'); writeFileSync(join(process.cwd(),'skills-lock.json'),JSON.stringify({fixture:process.env.FAIL_NPX||'success'})); if(process.env.FAIL_NPX)process.exit(43);`);
  nodeShim(bin, "codex", `
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'; import { join } from 'node:path';
const args=process.argv.slice(2), home=process.env.CODEX_HOME;
appendFileSync(process.env.SETUP_CALLS,JSON.stringify(['codex',...args])+'\\n');
if(args.join(' ')==='plugin marketplace list') { console.log('Marketplace  Path'); if(existsSync(join(home,'marketplace.txt'))) console.log('dyne-gestalt-agents  '+readFileSync(join(home,'marketplace.txt'),'utf8')); }
else if(args.join(' ').startsWith('plugin marketplace add ')) { mkdirSync(home,{recursive:true}); writeFileSync(join(home,'marketplace.txt'),args[3]); }
else if(args[0]==='plugin'&&args[1]==='add') {
 const name=args[2].split('@')[0], dest=join(home,'plugins/cache/dyne-gestalt-agents',name,'2.26.0');
 mkdirSync(dest,{recursive:true}); if(name==='context-mode') { mkdirSync(join(dest,'hooks'),{recursive:true}); writeFileSync(join(dest,'package.json'),JSON.stringify({version:'2.26.0'})); writeFileSync(join(dest,'start.mjs'),'// fixture'); writeFileSync(join(dest,'hooks/runtime-hook.mjs'),'// fixture'); }
 else { cpSync(join(process.env.SETUP_SOURCE,'plugins/gestalt'),dest,{recursive:true}); if(process.env.FAIL_PLUGIN) { writeFileSync(join(home,'config.toml'),'partial config'); process.exit(44); } }
} else if(args.join(' ')==='plugin list --marketplace dyne-gestalt-agents --json') console.log(JSON.stringify({installed:[{name:'context-mode',installed:true,version:'2.26.0'}]}));
else process.exit(45);
`);
  // Runtime build and catalog transport are explicit fixture boundaries here.
  // The native smoke suite separately builds and installs the unmodified source.
  writeFileSync(join(source, "plugins/context-mode/scripts/install-runtime.mjs"), `
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'; import { join } from 'node:path'; import { runCommand } from './native-command.mjs';
const dest=join(process.env.GESTALT_HOME,'runtime/context-mode');
if(!process.argv.includes('--check')&&(!existsSync(dest)||process.argv.includes('--force'))) { runCommand('npm',['ci','--ignore-scripts=false']); mkdirSync(dest,{recursive:true}); writeFileSync(join(dest,'cli.bundle.mjs'),'// fixture'); writeFileSync(join(dest,'builds'),String(Number(existsSync(join(dest,'builds'))?readFileSync(join(dest,'builds'),'utf8'):0)+1)); }
if(!existsSync(join(dest,'cli.bundle.mjs')))process.exit(46);
`);
  writeFileSync(join(source, "scripts/verify-gestalt-skill-catalog.mjs"), `if(process.env.FAIL_CATALOG)process.exit(47);`);
  const home = join(base, "user"); mkdirSync(home);
  const gestalt = join(base, "Gestalt ü & home"), codex = join(base, "Codex ü & home");
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  const env = { ...inherited, HOME: home, USERPROFILE: home, CODEX_HOME: codex, GESTALT_HOME: gestalt, SETUP_SOURCE: source, SETUP_CALLS: join(base, "calls.jsonl"), PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` };
  const run = (args = [], overrides = {}) => spawnSync(process.execPath, [join(source, "gestalt-setup.mjs"), ...args], { env: { ...env, ...overrides }, encoding: "utf8", timeout: 60_000 });
  return { base, source, bin, home, gestalt, codex, env, run, calls: () => existsSync(env.SETUP_CALLS) ? readFileSync(env.SETUP_CALLS, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] };
}

test("Node setup fresh, repeated/offline and force preserve independent profiles", (t) => {
  const f = fixture(t), independent = join(f.base, "independent-profile"); mkdirSync(independent); writeFileSync(join(independent, "config.toml"), "sentinel");
  const before = tree(independent);
  for (const args of [[], [], ["--force"]]) { const result = f.run(args, args.length ? {} : { npm_config_offline: "true" }); assert.equal(result.status, 0, result.stderr); }
  assert.equal(readFileSync(join(f.gestalt, "runtime/context-mode/builds"), "utf8"), "2");
  assert.equal(f.calls().filter(([name]) => name === "npm").length, 2);
  assert.ok(existsSync(join(f.codex, "agents/org-plan-reviewer.toml")));
  assert.ok(existsSync(join(f.codex, "bin/org-plan")));
  assert.deepEqual(tree(independent), before);
  assert.equal(readdirSync(f.codex).filter((name) => name.startsWith(".gestalt-setup-")).length, 0);
});

test("dry-run and prepare-only isolate Codex and do not mutate destinations", (t) => {
  const f = fixture(t);
  assert.equal(f.run(["--dry-run", "--extra-skills"]).status, 0);
  assert.equal(existsSync(f.codex), false); assert.equal(existsSync(f.gestalt), false); assert.deepEqual(f.calls(), []);
  const result = f.run(["--prepare-only"]); assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(f.codex), false); assert.ok(existsSync(join(f.gestalt, "bin/context-mode")));
  assert.equal(f.calls().some(([name]) => name === "codex"), false);
});

test("missing Codex, invalid roots and incompatible flags fail before mutation", (t) => {
  const f = fixture(t);
  rmSync(join(f.bin, process.platform === "win32" ? "codex.cmd" : "codex"));
  const missing = f.run([], { PATH: f.bin }); assert.notEqual(missing.status, 0); assert.match(missing.stderr, /codex/);
  for (const [args, env] of [[[], { GESTALT_HOME: "relative" }], [["--dry-run"], { GESTALT_HOME: resolve(f.base, "/") }], [["--extra-skills-only", "--force"], {}]]) assert.notEqual(f.run(args, env).status, 0);
  assert.equal(existsSync(f.codex), false); assert.equal(existsSync(f.gestalt), false);
});

test("setup lock contention fails closed with live and unknown owners", (t) => {
  const f = fixture(t); ensureManagedRoot(f.gestalt);
  const lock = join(f.gestalt, ".gestalt-setup.lock"), release = tryAcquireRuntimeLock(lock);
  try { const result = f.run(["--prepare-only"]); assert.notEqual(result.status, 0); assert.match(result.stderr, /already running/); } finally { release(); }
  mkdirSync(lock);
  const result = f.run(["--prepare-only"]); assert.notEqual(result.status, 0); assert.match(result.stderr, /cannot be verified/);
  assert.deepEqual(readdirSync(lock), []);
});

test("present-invalid managed scratch fails before any setup mutation", (t) => {
  const f = fixture(t);
  for (const value of ["", "{}", "invalid"]) {
    const result = f.run(["--prepare-only"], { GESTALT_SESSION_TMP_CONTEXT: value });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /SESSION_SCRATCH_INVALID_CONTEXT/);
  }
  assert.equal(existsSync(f.gestalt), false); assert.equal(existsSync(f.codex), false); assert.deepEqual(f.calls(), []);
});

test("unsafe writable installation namespaces are refused before creating managed homes", (t) => {
  const f = fixture(t), parent = join(f.base, "unsafe-parent");
  ensureManagedRoot(parent);
  if (process.platform === "win32") {
    const script = "$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TEST_ACL_PATH));$d=Get-Item -LiteralPath $p;$a=$d.GetAccessControl();$s=New-Object Security.Principal.SecurityIdentifier('S-1-1-0');$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($s,'WriteData,DeleteSubdirectoriesAndFiles','Allow')));$d.SetAccessControl($a)";
    const result = spawnSync(join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { env: { ...process.env, TEST_ACL_PATH: Buffer.from(parent).toString("base64") }, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
  } else chmodSync(parent, 0o777);
  assert.throws(() => ensureManagedRoot(join(parent, "managed")));
  assert.equal(existsSync(join(parent, "managed")), false);
});

test("existing managed roots readable by another user are rejected without changing permissions", (t) => {
  const f = fixture(t);
  if (process.platform === "win32") {
    ensureManagedRoot(f.gestalt);
    const script = "$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TEST_ACL_PATH));$d=Get-Item -LiteralPath $p;$a=$d.GetAccessControl();$s=New-Object Security.Principal.SecurityIdentifier('S-1-1-0');$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($s,'ReadAndExecute','Allow')));$d.SetAccessControl($a)";
    const result = spawnSync(join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { env: { ...process.env, TEST_ACL_PATH: Buffer.from(f.gestalt).toString("base64") }, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
    const rejected = f.run(["--prepare-only"]);
    assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /ACL permits another principal/);
    assert.equal(readdirSync(f.gestalt).length, 0);
    return;
  }
  for (const mode of [0o755, 0o750, 0o701]) {
    mkdirSync(f.gestalt, { mode }); chmodSync(f.gestalt, mode);
    const result = f.run(["--prepare-only"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be private to its owner/);
    assert.equal(lstatSync(f.gestalt).mode & 0o777, mode);
    assert.equal(readdirSync(f.gestalt).length, 0);
    rmSync(f.gestalt, { recursive: true });
  }
});

test("npm and post-plugin failures restore prior runtime and selected profile", (t) => {
  const f = fixture(t);
  let result = f.run(); assert.equal(result.status, 0, result.stderr);
  const profile = tree(f.codex), runtime = tree(f.gestalt);
  for (const failure of [{ FAIL_NPM: "1" }, { FAIL_PLUGIN: "1" }, { FAIL_CATALOG: "1" }]) {
    result = f.run(["--force"], failure); assert.notEqual(result.status, 0, JSON.stringify(failure));
    assert.deepEqual(tree(f.codex), profile); assert.deepEqual(tree(f.gestalt), runtime);
  }
});

test("optional skills keep all 19 explicit selections confined and preserve existing skills", (t) => {
  const f = fixture(t); let result = f.run(["--extra-skills-only"]); assert.equal(result.status, 0, result.stderr);
  assert.equal(f.calls().length, 19); assert.ok(f.calls().every(([name, cwd, ...args]) => name === "npx" && cwd === f.gestalt && args.slice(-3).join(" ") === "-a codex -y"));
  const existing = join(f.codex, "skills/fixture-skill/SKILL.md"); assert.equal(readFileSync(existing, "utf8"), "fixture");
  result = f.run(["--extra-skills-only"]); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /keeping existing/);
  const beforeGestalt = tree(f.gestalt), beforeCodex = tree(f.codex);
  result = f.run(["--extra-skills-only"], { FAIL_NPX: "1" }); assert.notEqual(result.status, 0);
  assert.deepEqual(tree(f.gestalt), beforeGestalt); assert.deepEqual(tree(f.codex), beforeCodex);
  assert.equal(existsSync(join(f.gestalt, "runtime")), false);
});

test("native npm Node shim forwards literal argv/stdin and exit without evaluating batch", (t) => {
  const path = temp(); t.after(() => rmSync(path, { recursive: true, force: true }));
  nodeShim(path, "echo-args", `let input=''; for await(const chunk of process.stdin)input+=chunk; console.log(JSON.stringify({args:process.argv.slice(2),input})); process.exit(Number(process.env.TEST_EXIT||0));`);
  const command = join(path, process.platform === "win32" ? "echo-args.cmd" : "echo-args");
  const args = ["space ü", "&|<>^%!", '"quoted"', "trailing\\", "$(echo bad)"];
  const output = runCommand(command, args, { stdio: "pipe", input: "literal input\n" });
  assert.deepEqual(JSON.parse(output), { args, input: "literal input\n" });
  assert.throws(() => runCommand(command, [], { stdio: "pipe", env: { ...process.env, TEST_EXIT: "17" } }), /17/);
  const batch = join(path, "hostile.cmd"); writeFileSync(batch, "@echo off\nnode evil.mjs %*\n");
  assert.throws(() => commandTarget(batch), /Unsupported batch shim/);
  const bundled = join(path, "npm.cmd"), npm = join(path, "node_modules/npm");
  mkdirSync(join(npm, "bin"), { recursive: true });
  writeFileSync(bundled, "@echo off\nrem bundled npm launcher must not be evaluated\nexit 97\n", { mode: 0o755 });
  writeFileSync(join(npm, "package.json"), JSON.stringify({ name: "npm", bin: { npm: "bin/npm-cli.js" } }));
  writeFileSync(join(npm, "bin/npm-cli.js"), "#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n");
  assert.deepEqual(JSON.parse(runCommand(bundled, args, { stdio: "pipe" })), args);
});

test("runtime preparation runs allowlisted dependency JS with scripts disabled and no compiler fallback", (t) => {
  const f = fixture(t), runtime = join(f.source, "plugins/context-mode");
  writeFileSync(join(runtime, "package.json"), JSON.stringify({ version: "2.26.0", allowScripts: { "better-sqlite3": true, esbuild: true } }));
  writeFileSync(join(runtime, "start.mjs"), "// fixture launcher\n");
  const pkg = (name, manifest, files) => {
    const directory = join(runtime, "node_modules", name); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    for (const [name, contents] of Object.entries(files)) { mkdirSync(dirname(join(directory, name)), { recursive: true }); writeFileSync(join(directory, name), contents); }
  };
  const record = "require('node:fs').appendFileSync(process.env.PREPARE_ENTRY_LOG,JSON.stringify([require('node:path').basename(__filename),process.env.npm_config_ignore_scripts])+'\\n');";
  const binaryName = `@esbuild/${process.platform}-${process.arch}`;
  pkg(binaryName, { name: binaryName, version: "0.27.7" }, { [process.platform === "win32" ? "esbuild.exe" : "bin/esbuild"]: "fixture binary" });
  pkg("esbuild", { main: "index.cjs", version: "0.27.7", optionalDependencies: { [binaryName]: "0.27.7" } }, {
    "install.js": `${record}if(process.env.FAIL_ESBUILD)process.exit(51);`,
    "index.cjs": "exports.build=async o=>{const fs=require('node:fs'),p=require('node:path');fs.mkdirSync(p.dirname(p.join(o.absWorkingDir,o.outfile)),{recursive:true});fs.writeFileSync(p.join(o.absWorkingDir,o.outfile),'// fixture bundle\\n');};",
  });
  pkg("better-sqlite3", { main: "index.cjs" }, { "index.cjs": "module.exports=class Database {close(){}};" });
  pkg("prebuild-install", {}, { "bin.js": `${record}if(process.env.FAIL_PREBUILD)process.exit(52);const fs=require('node:fs');fs.mkdirSync('build/Release',{recursive:true});fs.writeFileSync('build/Release/better_sqlite3.node','fixture native binary');` });
  pkg("typescript", {}, { "bin/tsc": record });
  for (const name of ["turndown", "turndown-plugin-gfm", "@mixmark-io/domino"]) pkg(name, {}, {});
  const runtimeAlias = join(f.base, "runtime alias");
  symlinkSync(runtime, runtimeAlias, process.platform === "win32" ? "junction" : "dir");
  const aliasedBuild = spawnSync(process.execPath, [join(runtimeAlias, "scripts/build-runtime.mjs")], { env: f.env, encoding: "utf8" });
  const aliasedValidation = spawnSync(process.execPath, [join(runtimeAlias, "scripts/assert-bundle.mjs"), join(runtime, "missing.bundle.mjs")], { env: f.env, encoding: "utf8" });
  assert.deepEqual({ buildExit: aliasedBuild.status, serverProduced: existsSync(join(runtime, "server.bundle.mjs")), missingBundleExit: aliasedValidation.status }, { buildExit: 0, serverProduced: true, missingBundleExit: 1 }, "aliased entrypoints must build artifacts and reject a missing bundle, rather than silently exiting0");
  const entryLog = join(f.base, "preparation-entries.jsonl");
  const invoke = (extra = {}) => spawnSync(process.execPath, [join(runtime, "scripts/prepare-runtime.mjs"), "--force"], { env: { ...f.env, CONTEXT_MODE_PACKAGE_MANAGER: "npm", npm_config_ignore_scripts: "true", PREPARE_ENTRY_LOG: entryLog, ...extra }, encoding: "utf8", timeout: 30_000 });
  let result = invoke(); assert.equal(result.status, 0, result.stderr);
  const npmCall = f.calls().find(([name]) => name === "npm"); assert.ok(npmCall.includes("--ignore-scripts=true"));
  assert.deepEqual(readFileSync(entryLog, "utf8").trim().split("\n").map(JSON.parse), [["install.js", "true"], ["bin.js", "true"], ["tsc", "true"]]);
  result = invoke({ FAIL_PREBUILD: "1" }); assert.notEqual(result.status, 0); assert.match(result.stderr, /prebuilt better-sqlite3 binary.*native compilation is not attempted/);
  result = invoke({ FAIL_ESBUILD: "1" }); assert.notEqual(result.status, 0); assert.match(result.stderr, /51/);
  rmSync(join(runtime, "node_modules", binaryName), { recursive: true });
  result = invoke(); assert.notEqual(result.status, 0); assert.match(result.stderr, /optional dependencies are required/);
  assert.equal(f.calls().some((call) => call.some((value) => /node-gyp|rebuild/.test(value))), false);
});
