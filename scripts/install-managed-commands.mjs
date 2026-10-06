#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const header = "#!/bin/sh\n# Managed by Gestalt command installer.\n";
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

/** Explicit registrations keep future commands out of installer-specific shell code. */
export function installManagedCommands(gestaltHome, commands) {
  if (!isAbsolute(gestaltHome))
    throw new Error("GESTALT_HOME must be absolute");
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
      (!existing.isFile() || !readFileSync(path, "utf8").startsWith(header))
    ) {
      throw new Error(`Refusing to replace unmanaged command: ${path}`);
    }
    const defaults = Object.entries(env)
      .map(([key, value]) => {
        if (
          !/^[A-Z][A-Z0-9_]*$/.test(key) ||
          typeof value !== "string" ||
          value.includes("\0")
        )
          throw new Error("Invalid managed environment default");
        return `if [ -z "\${${key}:-}" ]; then export ${key}=${quote(value)}; fi\n`;
      })
      .join("");
    return {
      path,
      text: `${header}${defaults}exec ${command.map(quote).join(" ")} "$@"\n`,
    };
  });
  mkdirSync(bin, { recursive: true, mode: 0o755 });
  for (const { path, text } of pending) {
    const temporary = `${path}.tmp-${randomUUID()}`;
    try {
      writeFileSync(temporary, text, { mode: 0o755, flag: "wx" });
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
    commands.push({ name: "org-plan", command: [orgPlan], env });
  }
  installManagedCommands(gestaltHome, commands);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const gestaltHome = process.argv[2] ?? join(homedir(), ".gestalt");
  const codexHome = process.argv[3];
  if (codexHome && !isAbsolute(codexHome))
    throw new Error("CODEX_HOME must be absolute");
  installGestaltCommands(gestaltHome, codexHome);
  process.stdout.write(
    `Gestalt commands installed in ${join(gestaltHome, "bin")}\n`,
  );
}
