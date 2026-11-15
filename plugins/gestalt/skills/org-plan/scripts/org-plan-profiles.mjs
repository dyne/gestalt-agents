/** Setup-only profile transaction; never called by supervision recovery. */
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setImmediate } from "node:timers/promises";
import { PROFILE_DEFAULTS } from "./org-plan-profile-defaults.mjs";
import { ensureManagedRoot, optionalStat, resolveRoot, writePrivateFile } from "./org-plan-storage.mjs";

export const PROFILE_HELP = {
  "prepare-executor": "usage: org-plan prepare-executor [--model MODEL] [--reasoning-effort EFFORT] [--agents-dir DIR] [--profile-name NAME]\nsetup-only: installs or refreshes the executor role profile",
  "prepare-supervision": "usage: org-plan prepare-supervision [--executor-model MODEL] [--reviewer-model MODEL] [--executor-reasoning-effort EFFORT] [--reviewer-reasoning-effort EFFORT] [--agents-dir DIR] [--executor-profile-name NAME] [--reviewer-profile-name NAME]\nsetup-only: installs or refreshes supervised role profiles",
};

function invalid(message) { throw Object.assign(new Error(message), { exitCode: 2 }); }
const encoded = (value) => [...Buffer.from(value)].map((byte) => /[A-Za-z0-9._~/-]/.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
const toml = (profile) => Object.entries(profile).map(([key, value]) => `${key} = ${JSON.stringify(value)}\n`).join("");

export async function prepareProfiles(command, args = []) {
  const supervision = command === "prepare-supervision";
  if (!PROFILE_HELP[command]) invalid("unknown profile command");
  const options = { "agents-dir": join(process.env.CODEX_HOME || join(homedir(), ".codex"), "agents") };
  const keys = supervision
    ? ["executor-model", "reviewer-model", "executor-reasoning-effort", "reviewer-reasoning-effort", "executor-profile-name", "reviewer-profile-name"]
    : ["model", "reasoning-effort", "profile-name"];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].slice(2);
    if (!args[index].startsWith("--") || ![...keys, "agents-dir"].includes(key) || args[index + 1] === undefined) invalid(PROFILE_HELP[command]);
    options[key] = args[index + 1];
  }
  const roles = supervision ? ["reviewer", "executor"] : ["executor"];
  const selected = roles.map((role) => {
    const profile = { ...PROFILE_DEFAULTS[supervision ? `org-plan-${role}` : "standalone-executor"] };
    const prefix = supervision ? `${role}-` : "";
    profile.name = options[`${prefix}profile-name`] ?? profile.name;
    profile.model = options[`${prefix}model`] ?? profile.model;
    profile.model_reasoning_effort = options[`${prefix}reasoning-effort`] ?? profile.model_reasoning_effort;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(profile.name)) invalid(`invalid profile name: ${profile.name}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile.model)) invalid(`invalid model: ${profile.model}`);
    if (!["medium", "high", "xhigh"].includes(profile.model_reasoning_effort)) invalid(`invalid reasoning effort: ${profile.model_reasoning_effort}`);
    return profile;
  });
  if (new Set(selected.map((profile) => profile.name)).size !== selected.length) invalid("profile names must be distinct");
  const displayDir = options["agents-dir"];
  const agentsDir = resolveRoot(resolve(displayDir), "agents directory", homedir(), { allowControlCharacters: process.platform !== "win32" });
  ensureManagedRoot(agentsDir, { privateMode: false });
  const records = selected.map((profile) => {
    const path = join(agentsDir, `${profile.name}.toml`);
    const info = optionalStat(path);
    if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) throw new Error(`profile destination is not a regular file: ${path}`);
    return { path, profile, mode: info ? info.mode & 0o777 : 0o600, before: info ? readFileSync(path) : null };
  });
  const stage = join(agentsDir, `.org-plan-stage.${process.pid}.${randomUUID()}`);
  let ownsStage = false, signal;
  const handlers = new Map([ ["SIGHUP",129], ["SIGINT",130], ["SIGTERM",143] ].map(([name, status]) => [name, () => { signal = { name, status }; }]));
  const checkpoint = async () => { await setImmediate(); if (signal) throw Object.assign(new Error(`profile preparation interrupted: ${signal.name}`), { exitCode: signal.status }); };
  for (const [name, handler] of handlers) process.on(name, handler);
  const installed = [];
  try {
    mkdirSync(stage, { mode: 0o700 }); ownsStage = true;
    await checkpoint();
    ensureManagedRoot(stage);
    for (const [index, record] of records.entries()) {
      record.temporary = join(stage, String(index));
      writePrivateFile(record.temporary, toml(record.profile), record.mode);
      chmodSync(record.temporary, record.mode);
      await checkpoint();
    }
    for (const record of records) {
      renameSync(record.temporary, record.path); installed.push(record);
      await checkpoint();
    }
  } catch (error) {
    for (const record of installed.reverse()) {
      if (record.before === null) rmSync(record.path, { force: true });
      else {
        const temporary = join(stage, `rollback-${randomUUID()}`);
        writePrivateFile(temporary, record.before, record.mode);
        chmodSync(temporary, record.mode);
        renameSync(temporary, record.path);
      }
    }
    throw error;
  } finally {
    for (const [name, handler] of handlers) process.removeListener(name, handler);
    if (ownsStage) rmSync(stage, { recursive: true, force: true });
  }
  // Records describe the caller's exact spelling, including repeated
  // separators and explicit aliases. Writes use the validated physical root.
  const field = (index) => encoded(`${displayDir}${sep}${selected[index].name}.toml`);
  return supervision
    ? `root_reviewer=${selected[0].name} root_reviewer_model=${selected[0].model} root_reviewer_profile=${field(0)} executor=${selected[1].name} executor_model=${selected[1].model} executor_profile=${field(1)}`
    : `executor=${selected[0].name} model=${selected[0].model} profile=${field(0)}`;
}
