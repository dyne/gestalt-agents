/** Installer-owned portable profile transaction; defaults retain the Org contract. */
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const defaults = JSON.parse(readFileSync(new URL("../plugins/gestalt/skills/org-plan/assets/agent-profiles.json", import.meta.url), "utf8"));
function stat(path) {
  try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export function prepareAgentProfiles(agentsDir) {
  const profiles = Object.entries(defaults).map(([name, value]) => {
    const path = join(agentsDir, `${name}.toml`);
    const info = stat(path);
    if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) throw new Error(`profile destination is not a regular file: ${path}`);
    return { path, mode: info ? info.mode & 0o777 : 0o600, before: info ? readFileSync(path) : null,
      text: Object.entries(value).map(([key, field]) => `${key} = ${JSON.stringify(field)}\n`).join("") };
  });
  mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
  const stage = join(agentsDir, `.org-plan-stage.${process.pid}.${randomUUID()}`);
  mkdirSync(stage, { mode: 0o700 });
  const installed = [];
  try {
    for (const [index, profile] of profiles.entries()) {
      const temporary = join(stage, String(index));
      writeFileSync(temporary, profile.text, { mode: profile.mode, flag: "wx" });
      chmodSync(temporary, profile.mode);
      profile.temporary = temporary;
    }
    for (const profile of profiles) { renameSync(profile.temporary, profile.path); installed.push(profile); }
  } catch (error) {
    for (const profile of installed.reverse()) {
      if (profile.before === null) rmSync(profile.path, { force: true });
      else {
        const temporary = join(stage, `rollback-${randomUUID()}`);
        writeFileSync(temporary, profile.before, { mode: profile.mode, flag: "wx" });
        chmodSync(temporary, profile.mode);
        renameSync(temporary, profile.path);
      }
    }
    throw error;
  } finally { rmSync(stage, { recursive: true, force: true }); }
  return profiles.map(({ path }) => path);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 3) throw new Error("usage: prepare-agent-profiles.mjs AGENTS_DIR");
  prepareAgentProfiles(process.argv[2]);
}
