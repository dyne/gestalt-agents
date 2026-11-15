/** Installer adapter for the canonical portable Org profile transaction. */
import { prepareProfiles } from "../plugins/gestalt/skills/org-plan/scripts/org-plan-profiles.mjs";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
export const prepareAgentProfiles = (agentsDir) => prepareProfiles("prepare-supervision", ["--agents-dir", agentsDir]);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (process.argv.length !== 3) throw new Error("usage: prepare-agent-profiles.mjs AGENTS_DIR");
  await prepareAgentProfiles(process.argv[2]);
}
