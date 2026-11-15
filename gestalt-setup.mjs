#!/usr/bin/env node
/** One setup transaction owner for native Windows, macOS and Linux. */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand, resolveExecutable } from "./plugins/context-mode/scripts/native-command.mjs";
import { runtimeLockTimeout, tryAcquireRuntimeLock } from "./plugins/context-mode/scripts/runtime-lock.mjs";
import { scratchEnvironment } from "./plugins/context-mode/scripts/session-scratch.mjs";
import { beginSetupSnapshot, ensureManagedRoot, optionalStat, resolveRoot } from "./scripts/setup-storage.mjs";

const sourceRoot = realpathSync(dirname(fileURLToPath(import.meta.url)));
const runtimeInstaller = join(sourceRoot, "plugins/context-mode/scripts/install-runtime.mjs");
const commandInstaller = join(sourceRoot, "scripts/install-managed-commands.mjs");
const orgInstaller = join(sourceRoot, "scripts/install-org-plan.mjs");
const profileInstaller = join(sourceRoot, "scripts/prepare-agent-profiles.mjs");
const usage = `Usage: node gestalt-setup.mjs [--prepare-only] [--force] [--dry-run]
                              [--extra-skills | --extra-skills-only]

Install and verify context-mode under GESTALT_HOME (default ~/.gestalt), then
install plugins into CODEX_HOME (default ~/.codex-gestalt). Node.js 24+ and npm
are required; full setup also requires the Codex CLI. No Bash is required.

  --prepare-only       Prepare the runtime and commands without changing Codex.
  --force              Reinstall dependencies and rebuild runtime artifacts.
  --dry-run            Print planned mutations without running them.
  --extra-skills       Also install the curated optional skill set.
  --extra-skills-only  Install only curated skills; skip runtime/plugin setup.
  -h, --help           Show this help.
`;

const extraSkills = [
  ["https://github.com/openai/skills", "cli-creator", "cloudflare-deploy", "gh-address-comments", "gh-fix-ci", "jupyter-notebook", "screenshot", "security-threat-model", "winui-app"],
  ["mohitmishra786/low-level-dev-skills", "cmake", "gdb", "llvm", "make", "meson", "static-analysis", "conan-vcpkg"],
  ["samber/cc-skills-golang", "golang-code-style", "golang-design-patterns", "golang-error-handling", "golang-performance", "golang-security", "golang-testing"],
  ["wshobson/agents", "modern-javascript-patterns", "nodejs-backend-patterns", "shellcheck-configuration", "typescript-advanced-types"],
  ["membranedev/application-skills", "chrome-extensions", "find-skills"],
  ["anthropics/skills", "docx", "pdf"], ["antfu/skills", "vite", "vitepress"],
  ["trailofbits/skills@crypto-protocol-diagram"], ["alphaonedev/openclaw-graph@smart-contracts"],
  ["bahayonghang/academic-writing-skills@bib-search-citation"], ["googlechrome/modern-web-guidance@modern-web-guidance"],
  ["luwill/research-skills@research-proposal"], ["marimo-team/skills@wasm-compatibility"],
  ["mengbo/mengbo-skills@pandoc-docx"], ["mindrally/skills@htmx"], ["poemswe/co-researcher@academic-writing"],
  ["sickn33/antigravity-awesome-skills", "cpp-pro"], ["sveltejs/ai-tools@svelte-code-writer"],
  ["terrylica/cc-skills@pandoc-pdf-generation"],
];

function parseArgs(args) {
  const options = new Set(args);
  for (const arg of args) if (!["--prepare-only", "--force", "--dry-run", "--extra-skills", "--extra-skills-only", "--help", "-h"].includes(arg)) throw new Error(`unknown option: ${arg}`);
  if (options.has("--extra-skills-only") && ["--prepare-only", "--force", "--extra-skills"].some((arg) => options.has(arg))) throw new Error("--extra-skills-only cannot be combined with --prepare-only, --force, or --extra-skills");
  if (options.has("--prepare-only") && options.has("--extra-skills")) throw new Error("--extra-skills cannot be combined with --prepare-only");
  return options;
}

async function main(args) {
  const flags = parseArgs(args);
  if (flags.has("--help") || flags.has("-h")) { process.stdout.write(usage); return; }
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error(`Node.js 24 or newer is required; found ${process.versions.node}`);
  const userHome = process.env.HOME || process.env.USERPROFILE || homedir();
  const gestaltHome = resolveRoot(process.env.GESTALT_HOME || join(userHome, ".gestalt"), "GESTALT_HOME", userHome);
  const codexHome = flags.has("--prepare-only") ? null : resolveRoot(process.env.CODEX_HOME || join(userHome, ".codex-gestalt"), "CODEX_HOME", userHome);
  const nested = (left, right) => { const path = relative(left, right); return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)); };
  if (codexHome && (nested(codexHome, gestaltHome) || nested(gestaltHome, codexHome))) throw new Error("CODEX_HOME and GESTALT_HOME must be separate, non-nested directories");
  const env = { ...scratchEnvironment(process.env), GESTALT_HOME: gestaltHome, ...(codexHome ? { CODEX_HOME: codexHome } : {}) };
  const dry = flags.has("--dry-run"), only = flags.has("--extra-skills-only");
  const display = (command, argv) => process.stdout.write(`DRY-RUN: ${[command, ...argv].map((arg) => /^[A-Za-z0-9_./:@=-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`).join(" ")}\n`);
  const run = (command, argv, options = {}) => {
    if (dry) { display(command === process.execPath ? "node" : command, argv); return ""; }
    return runCommand(command, argv, { env, ...options });
  };
  if (only || flags.has("--extra-skills")) resolveExecutable("npx", env);
  if (!only) { resolveExecutable("npm", env); if (codexHome) resolveExecutable("codex", env); }

  const installExtraSkills = () => {
    if (dry) { display("install_extra_skills", [join(codexHome, "skills")]); return; }
    process.stdout.write(`gestalt-setup: installing curated extra skills under ${gestaltHome}\n`);
    for (const [repository, ...skills] of extraSkills) run("npx", ["skills", "add", repository, ...skills.flatMap((skill) => ["--skill", skill]), "-a", "codex", "-y"], { cwd: gestaltHome });
    const installed = join(gestaltHome, ".agents/skills");
    const target = join(codexHome, "skills");
    mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const skill of existsSync(installed) ? readdirSync(installed, { withFileTypes: true }) : []) {
      if (!skill.isDirectory()) continue;
      const source = join(installed, skill.name), destination = join(target, skill.name);
      if (optionalStat(destination)) { process.stdout.write(`gestalt-setup: keeping existing Codex skill entry ${destination}\n`); continue; }
      if (process.platform === "win32") cpSync(source, destination, {
        recursive: true, dereference: true,
        filter: (path) => {
          const actual = realpathSync(path), within = relative(realpathSync(source), actual);
          if (isAbsolute(within) || within === ".." || within.startsWith("..\\")) throw new Error(`extra skill link escapes its source: ${path}`);
          return true;
        },
      });
      else symlinkSync(source, destination, "dir");
    }
    process.stdout.write(`gestalt-setup: curated extra skills installed under ${gestaltHome}\n`);
  };

  // Resolve configured checkout before claiming mutation locks or taking snapshots.
  let marketplace, marketplaceConfigured = false;
  if (!only) {
    marketplace = JSON.parse(readFileSync(join(sourceRoot, ".agents/plugins/marketplace.json"), "utf8")).name;
    if (!/^[A-Za-z0-9._+-]+$/.test(marketplace)) throw new Error("invalid marketplace name");
    if (codexHome && !dry && existsSync(codexHome)) {
      const listing = runCommand("codex", ["plugin", "marketplace", "list"], { env, stdio: ["ignore", "pipe", "inherit"] });
      const configured = listing.split(/\r?\n/).map((line) => /^\s*(\S+)\s+(.+?)\s*$/.exec(line)).find((match) => match?.[1] === marketplace)?.[2];
      marketplaceConfigured = Boolean(configured);
      if (configured && realpathSync(configured) !== sourceRoot) {
        const setup = join(realpathSync(configured), "gestalt-setup.mjs");
        if (!existsSync(setup)) throw new Error(`configured marketplace Node setup is missing; update it first: ${setup}`);
        process.stdout.write(`gestalt-setup: continuing from configured marketplace ${realpathSync(configured)}\n`);
        runCommand(process.execPath, [setup, ...args], { env }); return;
      }
    }
  }

  let releases = [], snapshots = [], applied = false;
  const rollback = () => {
    const errors = [];
    for (const snapshot of [...snapshots].reverse()) try { snapshot.rollback(); } catch (error) { errors.push(error.message); }
    if (errors.length) throw new Error(errors.join("; "));
  };
  const signal = (name) => { try { rollback(); } catch (error) { process.stderr.write(`${error.message}\n`); } finally { for (const release of releases.reverse()) release(); } process.exit({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[name]); };
  const handlers = new Map(["SIGINT", "SIGTERM", "SIGHUP"].map((name) => [name, () => signal(name)]));
  try {
    if (!dry) {
      ensureManagedRoot(gestaltHome);
      if (codexHome) ensureManagedRoot(codexHome);
      // Acquire in sorted order so independent installs sharing one profile also serialize.
      for (const root of [gestaltHome, codexHome].filter(Boolean).sort()) {
        const lock = join(root, ".gestalt-setup.lock");
        const release = tryAcquireRuntimeLock(lock);
        if (!release) throw new Error(`setup is already running: ${runtimeLockTimeout(lock)}`);
        releases.push(release);
      }
      const optionalPaths = [".agents", ".codex", "skills-lock.json"];
      snapshots.push(beginSetupSnapshot(gestaltHome, only ? optionalPaths : ["runtime/context-mode", "bin", ...(flags.has("--extra-skills") ? optionalPaths : [])]));
      if (codexHome) snapshots.push(beginSetupSnapshot(codexHome, only ? ["skills"] : ["config.toml", "hooks.json", "plugins", "agents", "bin", "lib", ".tmp/marketplaces", ...(flags.has("--extra-skills") ? ["skills"] : [])]));
      for (const [name, handler] of handlers) process.on(name, handler);
    }
    if (only) {
      installExtraSkills();
      process.stdout.write("gestalt-setup: standalone curated extra-skills operation complete\n");
    } else {
      if (codexHome && !marketplaceConfigured) run("codex", ["plugin", "marketplace", "add", sourceRoot]);
      run(process.execPath, [runtimeInstaller, ...(flags.has("--force") ? ["--force"] : [])]);
      run(process.execPath, [runtimeInstaller, "--check"]);
      if (codexHome) {
        run("codex", ["plugin", "add", `context-mode@${marketplace}`]);
        run("codex", ["plugin", "add", `gestalt@${marketplace}`]);
        if (dry) process.stdout.write(`DRY-RUN: configure context-mode MCP and hooks under ${codexHome}\n`);
        else {
          const plugins = JSON.parse(run("codex", ["plugin", "list", "--marketplace", marketplace, "--json"], { stdio: ["ignore", "pipe", "inherit"] }));
          const version = plugins.installed?.find((item) => item.name === "context-mode" && item.installed)?.version;
          if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("cannot resolve installed context-mode version");
          run(process.execPath, [join(sourceRoot, "plugins/context-mode/scripts/configure-codex.mjs"), "--codex-home", codexHome, "--gestalt-home", gestaltHome, "--plugin-root", join(codexHome, "plugins/cache", marketplace, "context-mode", version), "--plugin-id", `context-mode@${marketplace}`]);
        }
        if (flags.has("--extra-skills")) installExtraSkills();
        run(process.execPath, [join(sourceRoot, "scripts/verify-gestalt-skill-catalog.mjs"), sourceRoot]);
        run(process.execPath, [orgInstaller, sourceRoot, codexHome]);
        if (dry) process.stdout.write(`DRY-RUN: activate a validated Org helper bundle at ${join(codexHome, "bin/org-plan")}\n`);
        run(process.execPath, [commandInstaller, gestaltHome, codexHome]);
        if (dry) display("prepare-supervision", ["--agents-dir", join(codexHome, "agents")]);
        run(process.execPath, [profileInstaller, join(codexHome, "agents")]);
        const retired = join(codexHome, "agents/org-plan-supervisor.toml");
        if (dry) display("remove", [retired]); else rmSync(retired, { force: true });
        process.stdout.write(`gestalt-setup: installed plugins and external runtime from ${marketplace}\ngestalt-setup: installed into Codex home ${codexHome}\n`);
      } else {
        run(process.execPath, [commandInstaller, gestaltHome]);
        process.stdout.write("gestalt-setup: context-mode external runtime is prepared\n");
      }
    }
    applied = true;
    for (const snapshot of snapshots) snapshot.commit();
  } catch (error) {
    if (applied) throw new Error(`setup applied but snapshot cleanup failed: ${error.message}`, { cause: error });
    try { rollback(); } catch (recovery) { throw new Error(`${error.message}; ${recovery.message}`, { cause: error }); }
    throw error;
  } finally {
    for (const [name, handler] of handlers) process.removeListener(name, handler);
    for (const release of releases.reverse()) release();
  }
}

try { await main(process.argv.slice(2)); }
catch (error) { process.stderr.write(`gestalt-setup: ${error.message}\n`); process.exitCode = 1; }
