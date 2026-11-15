/** One setup transaction owner for native Windows, macOS and Linux. */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveExecutable } from "../plugins/context-mode/scripts/native-command.mjs";
import { runtimeLockTimeout, tryAcquireRuntimeLock } from "../plugins/context-mode/scripts/runtime-lock.mjs";
import { scratchEnvironment } from "../plugins/context-mode/scripts/session-scratch.mjs";
import { SetupCommandContext } from "../plugins/context-mode/scripts/setup-command-context.mjs";
import { installRuntime, verifyInstalledRuntime } from "../plugins/context-mode/scripts/install-runtime.mjs";
import { getRuntimeRoot } from "../plugins/context-mode/scripts/runtime-location.mjs";
import { configureCodexIntegration } from "../plugins/context-mode/scripts/configure-codex.mjs";
import { installOrgPlan } from "./install-org-plan.mjs";
import { installGestaltCommands } from "./install-managed-commands.mjs";
import { prepareAgentProfiles } from "./prepare-agent-profiles.mjs";
import { verifySetupCatalog } from "./verify-gestalt-skill-catalog.mjs";
import { beginSetupSnapshot, ensureManagedRoot, optionalStat, resolveRoot } from "./setup-storage.mjs";

export const SETUP_API_VERSION = 1;
export const SETUP_API_CAPABILITIES = Object.freeze(["async-owned-commands-v1", "host-filesystem-v1", "shared-context-v1"]);
const sourceRoot = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
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

export async function setupAgents(args = [], { environment = process.env, cwd = process.cwd(), streams = {}, signal, mode = "standalone", commands, commandContext, visitedRoots = [] } = {}) {
  environment = { ...environment };
  const output = async (value) => {
    const bytes = Buffer.from(value);
    if (streams.stdout) await streams.stdout(bytes);
    else await new Promise((done, reject) => process.stdout.write(bytes, (error) => error ? reject(error) : done()));
  };
  const checkCancelled = () => {
    if (signal?.aborted) throw Object.assign(new Error("setup interrupted"), { status: signal.reason?.status || 130 });
  };
  checkCancelled();
  const flags = parseArgs(args);
  if (flags.has("--help") || flags.has("-h")) {
    new SetupCommandContext({ mode, commands, environment, cwd, streams, signal });
    await output(usage); return;
  }
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error(`Node.js 24 or newer is required; found ${process.versions.node}`);
  const userHome = environment.HOME || environment.USERPROFILE || homedir();
  const gestaltHome = resolveRoot(environment.GESTALT_HOME || join(userHome, ".gestalt"), "GESTALT_HOME", userHome);
  const codexHome = flags.has("--prepare-only") ? null : resolveRoot(environment.CODEX_HOME || join(userHome, ".codex-gestalt"), "CODEX_HOME", userHome);
  const nested = (left, right) => { const path = relative(left, right); return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)); };
  if (codexHome && (nested(codexHome, gestaltHome) || nested(gestaltHome, codexHome))) throw new Error("CODEX_HOME and GESTALT_HOME must be separate, non-nested directories");
  const env = { ...scratchEnvironment(environment), GESTALT_HOME: gestaltHome, ...(codexHome ? { CODEX_HOME: codexHome } : {}) };
  // The context may be shared only by fixed, capability-checked setup owners.
  const callContext = new SetupCommandContext({ mode, commands, environment: env, cwd, streams, signal });
  const context = commandContext ?? callContext;
  if (context.mode !== mode || context.commands.apiVersion !== 1 || typeof context.run !== "function" || typeof context.protectLock !== "function") throw new Error("incompatible shared setup command context");
  if (mode === "managed" && (!commands || commands !== context.commands)) throw new Error("managed setup requires the explicit owned capability for this call");
  context.check();
  const dry = flags.has("--dry-run"), only = flags.has("--extra-skills-only");
  const display = async (command, argv) => output(`DRY-RUN: ${[command, ...argv].map((arg) => /^[A-Za-z0-9_./:@=-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`).join(" ")}\n`);
  const run = async (command, argv, options = {}) => {
    checkCancelled();
    if (dry) { await display(command === process.execPath ? "node" : command, argv); return ""; }
    const result = await context.run(command, argv, { env, cwd, ...options });
    checkCancelled();
    return result;
  };
  const ownerAction = async (script, argv, action) => {
    context.check();
    if (dry) return display("node", [script, ...argv]);
    const result = await action(); context.check(); return result;
  };
  if (only || flags.has("--extra-skills")) resolveExecutable("npx", env);
  if (!only) { resolveExecutable("npm", env); if (codexHome) resolveExecutable("codex", env); }

  const installExtraSkills = async () => {
    if (dry) { await display("install_extra_skills", [join(codexHome, "skills")]); return; }
    await output(`gestalt-setup: installing curated extra skills under ${gestaltHome}\n`);
    for (const [repository, ...skills] of extraSkills) await run("npx", ["skills", "add", repository, ...skills.flatMap((skill) => ["--skill", skill]), "-a", "codex", "-y"], { cwd: gestaltHome });
    const installed = join(gestaltHome, ".agents/skills");
    const target = join(codexHome, "skills");
    mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const skill of existsSync(installed) ? readdirSync(installed, { withFileTypes: true }) : []) {
      if (!skill.isDirectory()) continue;
      const source = join(installed, skill.name), destination = join(target, skill.name);
      if (optionalStat(destination)) { await output(`gestalt-setup: keeping existing Codex skill entry ${destination}\n`); continue; }
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
    await output(`gestalt-setup: curated extra skills installed under ${gestaltHome}\n`);
  };

  // Resolve configured checkout before claiming mutation locks or taking snapshots.
  let marketplace, marketplaceConfigured = false;
  if (!only) {
    marketplace = JSON.parse(readFileSync(join(sourceRoot, ".agents/plugins/marketplace.json"), "utf8")).name;
    if (!/^[A-Za-z0-9._+-]+$/.test(marketplace)) throw new Error("invalid marketplace name");
    if (codexHome && !dry && existsSync(codexHome)) {
      ensureManagedRoot(codexHome, { create: false });
      const listing = await run("codex", ["plugin", "marketplace", "list"], { capture: true, stdin: "ignore" });
      const configured = listing.split(/\r?\n/).map((line) => /^\s*(\S+)\s+(.+?)\s*$/.exec(line)).find((match) => match?.[1] === marketplace)?.[2];
      marketplaceConfigured = Boolean(configured);
      if (configured && realpathSync(configured) !== sourceRoot) {
        const configuredRoot = realpathSync(configured);
        const setup = join(configuredRoot, "scripts/setup-agents.mjs");
        if (!existsSync(setup)) throw new Error(`configured marketplace setup API v1 is missing; update that checkout first: ${setup}`);
        if (visitedRoots.includes(configuredRoot) || visitedRoots.length >= 8) throw new Error("configured marketplace setup cycle");
        const owner = await import(pathToFileURL(setup).href);
        if (owner.SETUP_API_VERSION !== SETUP_API_VERSION || typeof owner.setupAgents !== "function" || !SETUP_API_CAPABILITIES.every((name) => owner.SETUP_API_CAPABILITIES?.includes(name))) throw new Error(`configured marketplace setup API is incompatible; update that checkout first: ${setup}`);
        await output(`gestalt-setup: continuing from configured marketplace ${configuredRoot}\n`);
        return owner.setupAgents(args, { environment: env, cwd, streams: context.streams, signal, mode, commands, commandContext: context, visitedRoots: [...visitedRoots, sourceRoot] });
      }
    }
  }

  let releases = [], snapshots = [], applied = false;
  const rollback = () => {
    if (!context.canCleanup()) { for (const root of [gestaltHome, codexHome].filter(Boolean)) context.retain(root); return; }
    const errors = [];
    for (const snapshot of [...snapshots].reverse()) try { snapshot.rollback(); } catch (error) { errors.push(error.message); }
    if (errors.length) throw new Error(errors.join("; "));
  };
  try {
    if (!dry) {
      ensureManagedRoot(gestaltHome);
      if (codexHome) ensureManagedRoot(codexHome);
      // Acquire in sorted order so independent installs sharing one profile also serialize.
      for (const root of [gestaltHome, codexHome].filter(Boolean).sort()) {
        const lock = join(root, ".gestalt-setup.lock");
        const release = tryAcquireRuntimeLock(lock);
        if (!release) throw new Error(`setup is already running: ${runtimeLockTimeout(lock)}`);
        releases.push(context.protectLock(lock, release));
      }
      const optionalPaths = [".agents", ".codex", "skills-lock.json"];
      snapshots.push(beginSetupSnapshot(gestaltHome, only ? optionalPaths : ["runtime/context-mode", "bin", ...(flags.has("--extra-skills") ? optionalPaths : [])]));
      if (codexHome) snapshots.push(beginSetupSnapshot(codexHome, only ? ["skills"] : ["config.toml", "hooks.json", "plugins", "agents", "bin", "lib", ".tmp/marketplaces", ...(flags.has("--extra-skills") ? ["skills"] : [])]));
    }
    if (only) {
      await installExtraSkills();
      await output("gestalt-setup: standalone curated extra-skills operation complete\n");
    } else {
      if (codexHome && !marketplaceConfigured) await run("codex", ["plugin", "marketplace", "add", sourceRoot]);
      const runtimeSource = join(sourceRoot, "plugins/context-mode");
      await ownerAction(runtimeInstaller, flags.has("--force") ? ["--force"] : [], () => installRuntime(runtimeSource, { force: flags.has("--force"), env, commandContext: context }));
      await ownerAction(runtimeInstaller, ["--check"], () => {
        const verified = verifyInstalledRuntime(runtimeSource, getRuntimeRoot(runtimeSource, env));
        if (!verified.ok) throw new Error(`context-mode external runtime is not prepared: ${verified.problems.join(", ")}`);
      });
      if (codexHome) {
        await run("codex", ["plugin", "add", `context-mode@${marketplace}`]);
        await run("codex", ["plugin", "add", `gestalt@${marketplace}`]);
        if (dry) await output(`DRY-RUN: configure context-mode MCP and hooks under ${codexHome}\n`);
        else {
          const plugins = JSON.parse(await run("codex", ["plugin", "list", "--marketplace", marketplace, "--json"], { capture: true, stdin: "ignore" }));
          const version = plugins.installed?.find((item) => item.name === "context-mode" && item.installed)?.version;
          if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("cannot resolve installed context-mode version");
          configureCodexIntegration({ codexHome, gestaltHome, pluginRoot: join(codexHome, "plugins/cache", marketplace, "context-mode", version), pluginId: `context-mode@${marketplace}` });
        }
        if (flags.has("--extra-skills")) await installExtraSkills();
        await ownerAction(join(sourceRoot, "scripts/verify-gestalt-skill-catalog.mjs"), [sourceRoot], () => verifySetupCatalog({ inputRoot: sourceRoot, environment: env, commandContext: context, output }));
        await ownerAction(orgInstaller, [sourceRoot, codexHome], () => installOrgPlan(sourceRoot, codexHome, { env, commandContext: context }));
        if (dry) await output(`DRY-RUN: activate a validated Org helper bundle at ${join(codexHome, "bin/org-plan")}\n`);
        await ownerAction(commandInstaller, [gestaltHome, codexHome], () => installGestaltCommands(gestaltHome, codexHome));
        if (dry) await display("prepare-supervision", ["--agents-dir", join(codexHome, "agents")]);
        await ownerAction(profileInstaller, [join(codexHome, "agents")], () => prepareAgentProfiles(join(codexHome, "agents"), { environment: env, signal, canCleanup: () => context.canCleanup(), retain: (path) => context.retain(path), listenForSignals: false }));
        const retired = join(codexHome, "agents/org-plan-supervisor.toml");
        if (dry) await display("remove", [retired]); else rmSync(retired, { force: true });
        await output(`gestalt-setup: installed plugins and external runtime from ${marketplace}\ngestalt-setup: installed into Codex home ${codexHome}\n`);
      } else {
        await ownerAction(commandInstaller, [gestaltHome], () => installGestaltCommands(gestaltHome));
        await output("gestalt-setup: context-mode external runtime is prepared\n");
      }
    }
    applied = true;
    if (context.canCleanup()) for (const snapshot of snapshots) snapshot.commit();
    else for (const root of [gestaltHome, codexHome].filter(Boolean)) context.retain(root);
    const outcome = { apiVersion: SETUP_API_VERSION, ...context.outcome() };
    if (outcome.ownership.kind === "unknown") await output("gestalt-setup: command lifetime remains unknown; transaction snapshots, stages and locks retained\n");
    return outcome;
  } catch (error) {
    await context.stopActive();
    if (signal?.aborted) error.status = context.cancellationStatus();
    if (applied) throw new Error(`setup applied but snapshot cleanup failed: ${error.message}`, { cause: error });
    try { rollback(); } catch (recovery) { throw new Error(`${error.message}; ${recovery.message}`, { cause: error }); }
    error.execution = context.outcome();
    throw error;
  } finally {
    for (const release of releases.reverse()) release();
  }
}
