#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandTarget, resolveExecutable } from "../plugins/context-mode/scripts/native-command.mjs";
import { checkCmdShim, installCmdShim } from "./native-command-shims.mjs";
import { ensureManagedRoot, resolveRoot } from "./setup-storage.mjs";

const header = "#!/usr/bin/env node\n// Managed by Gestalt command installer.\n";
const legacyHeader = "#!/bin/sh\n# Managed by Gestalt command installer.\n";

/** Explicit registrations keep future commands out of installer-specific shell code. */
export function installManagedCommands(gestaltHome, commands) {
  if (!isAbsolute(gestaltHome))
    throw new Error("GESTALT_HOME must be absolute");
  // Public callers may use macOS /var or an explicit directory alias. Resolve
  // the selected destination before checking its actual namespace and ACLs.
  gestaltHome = resolveRoot(gestaltHome, "GESTALT_HOME", homedir());
  const bin = join(gestaltHome, "bin");
  const names = new Set();
  const pending = commands.map(({ name, command, env = {} }) => {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || names.has(name))
      throw new Error("Invalid or duplicate managed command name");
    names.add(name);
    if (
      !Array.isArray(command) ||
      command.length === 0 ||
      command.some((value) => typeof value !== "string" || value.includes("\0"))
    )
      throw new Error("Invalid managed command");
    const path = join(bin, name);
    let existing;
    try {
      existing = lstatSync(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      existing &&
      (!existing.isFile() || existing.isSymbolicLink() || ![header, legacyHeader].some((marker) => readFileSync(path, "utf8").startsWith(marker)))
    ) {
      throw new Error(`Refusing to replace unmanaged command: ${path}`);
    }
    if (process.platform === "win32") checkCmdShim(`${path}.cmd`, name);
    for (const [key, value] of Object.entries(env)) {
        if (
          !/^[A-Z][A-Z0-9_]*$/.test(key) ||
          typeof value !== "string" ||
          value.includes("\0")
        )
          throw new Error("Invalid managed environment default");
    }
    const target = command[0] === "node" ? { executable: null, prefix: [] } : commandTarget(resolveExecutable(command[0]));
    const argv = [...target.prefix, ...command.slice(1)];
    return {
      path,
      name,
      text: `${header}(async () => {\nconst { spawn } = await import('node:child_process');\nconst defaults = ${JSON.stringify(env)};\nfor (const [key,value] of Object.entries(defaults)) if (!process.env[key]) process.env[key] = value;\nconst child = spawn(${JSON.stringify(target.executable)} || process.execPath, [...${JSON.stringify(argv)}, ...process.argv.slice(2)], { shell: false, stdio: 'inherit', windowsHide: true });\nconst signals = ['SIGHUP','SIGINT','SIGTERM'];\nconst handlers = new Map(signals.map(signal => [signal, () => { if (!child.killed) child.kill(signal); }]));\nfor (const [signal,handler] of handlers) process.on(signal,handler);\nchild.once('error', error => { console.error(error.message); process.exitCode = 1; });\nchild.once('exit', (code,signal) => {\n for (const [name,handler] of handlers) process.removeListener(name,handler);\n if (signal && process.platform !== 'win32') process.kill(process.pid,signal);\n else process.exitCode = code ?? ({SIGHUP:129,SIGINT:130,SIGTERM:143}[signal] || 1);\n});\n})().catch(error => { console.error(error.message); process.exitCode = 1; });\n`,
    };
  });
  ensureManagedRoot(gestaltHome);
  mkdirSync(bin, { recursive: true, mode: 0o755 });
  for (const { path, text, name } of pending) {
    const temporary = `${path}.tmp-${randomUUID()}`;
    try {
      writeFileSync(temporary, text, { mode: 0o755, flag: "wx" });
      if (process.platform === "win32") installCmdShim(`${path}.cmd`, name);
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}

export function installGestaltCommands(gestaltHome, codexHome) {
  const cli = join(gestaltHome, "runtime", "context-mode", "cli.bundle.mjs");
  if (!existsSync(cli))
    throw new Error(`Prepared context-mode CLI missing: ${cli}`);
  const env = {
    GESTALT_HOME: gestaltHome,
    ...(codexHome ? { CODEX_HOME: codexHome } : {}),
  };
  const commands = [{ name: "context-mode", command: ["node", cli], env }];
  if (codexHome) {
    const orgPlan = join(codexHome, "bin", "org-plan");
    if (!existsSync(orgPlan))
      throw new Error(`Installed Org-plan CLI missing: ${orgPlan}`);
    commands.push({ name: "org-plan", command: ["node", orgPlan], env });
  }
  installManagedCommands(gestaltHome, commands);
}

function isDirectInvocation() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (isDirectInvocation()) {
  const gestaltHome = process.argv[2] ?? join(homedir(), ".gestalt");
  const codexHome = process.argv[3];
  if (codexHome && !isAbsolute(codexHome))
    throw new Error("CODEX_HOME must be absolute");
  installGestaltCommands(gestaltHome, codexHome);
  process.stdout.write(
    `Gestalt commands installed in ${join(gestaltHome, "bin")}\n`,
  );
}
