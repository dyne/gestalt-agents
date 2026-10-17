import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { measure, mutate, next, parsePlan, projection, readPlan, resume, suspendReopen } from "../../../plugins/gestalt/skills/org-plan/scripts/org-plan-core.mjs";

const directory = mkdtempSync(join(tmpdir(), "org-nested-suspension-"));
const path = join(directory, "plan.org");
const status = join(directory, "status.json");
const cli = fileURLToPath(new URL("../../../plugins/gestalt/skills/org-plan/scripts/org-plan-cli.mjs", import.meta.url));
const keys = ["GESTALT_MOBILE_ORG_PLAN_STATUS_FILE", "GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY", "GESTALT_MOBILE_ORG_PLAN_CAPABILITIES"];
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
for (const key of keys) delete process.env[key];
const ids = new Map([[9, "live-host-policy"], [11, "live-production-integration"], [13, "mobile-live-controls"]]);
const id = (position) => ids.get(position) ?? `l${position}`;
const child = (name, state) => `\n** ${state} [#B] ${name}\n:PROPERTIES:\n:ID: ${name}\n:END:\n- Why :: Needed.\n- Change :: Implement.\n- Tests :: Verify.\n- Done when :: Pass.\n`;
const source = "#+TITLE: Nested suspension\n#+SUBTITLE: Test\n#+DATE: 2026-10-16\n#+KEYWORDS: test\n" + Array.from({ length: 14 }, (_, index) => {
  const position = index + 1;
  const state = position === 13 ? "WIP" : position === 14 ? "TODO" : "DONE";
  return `\n* ${state} [#A] ${id(position)}\n:PROPERTIES:\n:ID: ${id(position)}\n:SKILLS: $make\n:REVIEW_STATUS: ${position < 13 ? "REVIEWED" : "UNREVIEWED"}\n:STARTED_AT: 2026-10-16T10:00:00Z\n:ELAPSED_SECONDS: 300\n:END:\n- Effort :: Small\n- Goal :: Test.\n- Notes :: Preserve IDs, history, telemetry.\n` + child(`${id(position)}-child`, state) + (position === 13 ? child("finished", "DONE") + child("future", "TODO") : "");
}).join("");
const get = (name) => readPlan(path).items.find((item) => item.id === name);
const unchangedOnFailure = (action, pattern) => {
  const before = readFileSync(path, "utf8");
  const beforeStatus = existsSync(status) ? readFileSync(status, "utf8") : null;
  assert.throws(action, pattern);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(existsSync(status) ? readFileSync(status, "utf8") : null, beforeStatus);
};
try {
  writeFileSync(path, source);
  process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE = status;
  process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES = "suspension-v1";
  suspendReopen(path, id(13), id(11));
  mutate(path, "l2", `${id(11)}-child`, "WIP");
  const single = readFileSync(path, "utf8");
  // A single-frame consumer must never receive a nested plan/status.
  unchangedOnFailure(() => suspendReopen(path, id(11), id(9)), /nested-suspension-v1/);
  process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES = "suspension-v1,nested-suspension-v1";
  const result = suspendReopen(path, id(11), id(9));
  assert.equal(result.publication.published, true);
  const nested = readFileSync(path, "utf8");
  assert.equal(get(id(13)).properties.get("SUSPENDED_FOR"), id(11));
  assert.equal(get(id(11)).properties.get("SUSPENDED_FOR"), id(9));
  assert.equal(get(id(9)).state, "WIP");
  assert.equal(get(id(9)).properties.get("REVIEW_STATUS"), "UNREVIEWED");
  assert.equal(get(`${id(11)}-child`).state, "SUSPENDED");
  assert.equal(get(`${id(13)}-child`).state, "SUSPENDED");
  assert.equal(get("finished").state, "DONE");
  assert.equal(get("future").state, "TODO");
  assert.deepEqual(readPlan(path).items.map((item) => [item.id, item.title, item.priority]), parsePlan(source).items.map((item) => [item.id, item.title, item.priority]));
  for (const item of readPlan(path).items.filter((entry) => entry.level === 1))
    assert.equal(item.properties.get("ELAPSED_SECONDS"), "300");
  assert.deepEqual(result.projection.plan.map((item) => item.status).filter((value) => value === "in_progress"), ["in_progress"]);
  assert.match(result.projection.plan[10].step, /SUSPENDED/);
  assert.match(result.projection.plan[12].step, /SUSPENDED/);
  assert.equal(next(readPlan(path), "l1").id, id(9));
  assert.equal(next(readPlan(path), "l2"), null); // historical completion is not reopened implicitly
  unchangedOnFailure(() => resume(path, id(13)), /DONE \+ REVIEWED/);
  unchangedOnFailure(() => resume(path, id(11)), /DONE \+ REVIEWED/);
  unchangedOnFailure(() => mutate(path, "set", id(13), "WIP", { force: true }), /requires resume/);
  unchangedOnFailure(() => mutate(path, "l2", `${id(11)}-child`, "DONE", { force: true }), /requires resume/);
  unchangedOnFailure(() => measure(path, "checkpoint", id(11), { observedAt: "2026-10-16T11:00:00Z" }), /cannot be measured/);
  unchangedOnFailure(() => mutate(path, "set", id(14), "WIP", { force: true }), /earlier dependencies/);
  unchangedOnFailure(() => mutate(path, "review", id(10), "UNREVIEWED"), /multiple in_progress/);
  const invalid = [
    [nested.replace(`:SUSPENDED_FOR: ${id(11)}`, `:SUSPENDED_FOR: ${id(9)}`), /one nested dependency chain/], // fork
    [nested.replace(`:SUSPENDED_FOR: ${id(11)}`, `:SUSPENDED_FOR: ${id(10)}`), /one nested dependency chain/], // disconnected
    [nested.replace(`:SUSPENDED_FOR: ${id(9)}`, `:SUSPENDED_FOR: ${id(13)}`), /earlier L1/], // cycle/forward
    [nested.replace(`:SUSPENDED_FOR: ${id(9)}`, `:SUSPENDED_FOR: ${id(11)}`), /earlier L1/], // self-cycle
    [nested.replace(`:SUSPENDED_FOR: ${id(9)}`, ":SUSPENDED_FOR: missing"), /earlier L1/],
    [nested.replace("** TODO [#B] future", "** SUSPENDED [#B] future"), /multiple suspended L2s/],
    [nested.replace("* TODO [#A] l14", "* WIP [#A] l14"), /active work must precede|multiple WIP/],
    [nested.replace("* DONE [#A] l1\n", "* WIP [#A] l1\n"), /multiple WIP L1s/],
    [nested.replace("** SUSPENDED", "** WIP"), /WIP child inside/],
  ];
  for (const [text, pattern] of invalid) assert.throws(() => parsePlan(text), pattern);
  assert.equal(readFileSync(path, "utf8"), nested);
  // Actual CLI projection accepts the same chain, without changing bytes.
  const command = spawnSync(process.execPath, [cli, "projection", path], { encoding: "utf8" });
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(JSON.parse(command.stdout).plan, projection(readPlan(path)).plan);
  assert.equal(readFileSync(path, "utf8"), nested);
  mutate(path, "l2", `${id(9)}-child`, "WIP");
  mutate(path, "l2", `${id(9)}-child`, "DONE");
  mutate(path, "set", id(9), "DONE");
  assert.equal(next(readPlan(path), "review").id, id(9));
  assert.equal(next(readPlan(path), "l1"), null);
  unchangedOnFailure(() => resume(path, id(11)), /DONE \+ REVIEWED/);
  mutate(path, "review", id(9), "REVIEWED");
  // Intervening accepted work may be corrected in order, but not skipped.
  mutate(path, "set", id(10), "WIP");
  unchangedOnFailure(() => resume(path, id(11)), /DONE \+ REVIEWED/);
  mutate(path, "set", id(10), "DONE");
  mutate(path, "review", id(10), "REVIEWED");
  resume(path, id(11));
  assert.equal(readFileSync(path, "utf8"), single);
  assert.equal(next(readPlan(path), "l2").id, `${id(11)}-child`);
  unchangedOnFailure(() => resume(path, id(13)), /DONE \+ REVIEWED/);
  mutate(path, "l2", `${id(11)}-child`, "DONE");
  mutate(path, "set", id(11), "DONE");
  unchangedOnFailure(() => resume(path, id(13)), /DONE \+ REVIEWED/);
  mutate(path, "review", id(11), "REVIEWED");
  resume(path, id(13));
  assert.equal(readFileSync(path, "utf8"), source); // exact complete unwind
  assert.equal(next(readPlan(path), "l2").id, `${id(13)}-child`);
  console.log("Nested suspension: L13->L11->L9, ordered reviewed unwind, CLI projection, consumer isolation, malformed-chain denial and atomic rollback passed");
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(directory, { recursive: true, force: true });
}
