import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { measure, mutate, next, parsePlan, projection, publishStatus, readPlan, resume, suspendReopen } from "../../../plugins/gestalt/skills/org-plan/scripts/org-plan-core.mjs";
import { createMcpTestClient } from "./mcp-test-client.mjs";
import { dispatch } from "../../../plugins/gestalt/org-plan-mcp.mjs";

const directory = mkdtempSync(join(tmpdir(), "org-suspension-"));
const path = join(directory, "plan.org");
const status = join(directory, "status.json");
const cli = fileURLToPath(new URL("../../../plugins/gestalt/skills/org-plan/scripts/org-plan-cli.mjs", import.meta.url));
const saved = Object.fromEntries(["GESTALT_MOBILE_ORG_PLAN_STATUS_FILE", "GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY", "GESTALT_MOBILE_ORG_PLAN_CAPABILITIES"].map((key) => [key, process.env[key]]));
for (const key of Object.keys(saved)) delete process.env[key];
const child = (id, state) => `\n** ${state} [#B] ${id}\n:PROPERTIES:\n:ID: ${id}\n:END:\n- Why :: Needed.\n- Change :: Implement.\n- Tests :: Verify.\n- Done when :: Pass.\n`;
const milestone = (id, state, review, children) => `\n* ${state} [#A] ${id}\n:PROPERTIES:\n:ID: ${id}\n:SKILLS: $make\n:REVIEW_STATUS: ${review}\n:STARTED_AT: 2026-08-01T10:00:00Z\n:ELAPSED_SECONDS: 300\n:END:\n- Effort :: Small\n- Goal :: Test.\n- Notes :: Preserve.\n${children}`;
const source = `#+TITLE: Suspension\n#+SUBTITLE: Test\n#+DATE: 2026-08-01\n#+KEYWORDS: test\n` +
  milestone("dependency", "DONE", "UNREVIEWED", child("dependency-child", "DONE")) +
  milestone("intermediate", "DONE", "REVIEWED", child("intermediate-child", "DONE")) +
  milestone("dependent", "WIP", "UNREVIEWED", child("finished", "DONE") + child("working", "WIP") + child("future", "TODO")) +
  milestone("later", "TODO", "UNREVIEWED", child("later-child", "TODO"));
const reset = () => writeFileSync(path, source);
const unchangedOnFailure = (action, pattern) => {
  const before = readFileSync(path, "utf8");
  const beforeStatus = existsSync(status) ? readFileSync(status, "utf8") : null;
  assert.throws(action, pattern);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(existsSync(status) ? readFileSync(status, "utf8") : null, beforeStatus);
};
try {
  reset();
  // Incident recovery: source validation passes but original projection fails.
  assert.throws(() => projection(readPlan(path)), /multiple in_progress/);
  unchangedOnFailure(() => mutate(path, "review", "intermediate", "UNREVIEWED"), /multiple in_progress/);
  unchangedOnFailure(() => measure(path, "checkpoint", "dependency", { observedAt: "2026-08-01T11:00:00Z" }), /multiple in_progress/);
  unchangedOnFailure(() => suspendReopen(path, "dependent", "later"), /earlier DONE/);
  process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE = status;
  unchangedOnFailure(() => suspendReopen(path, "dependent", "dependency"), /suspension-v1/);
  assert.equal(existsSync(status), false);
  delete process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE;

  const repaired = suspendReopen(path, "dependent", "dependency");
  assert.equal(repaired.projection.plan.filter((item) => item.status === "in_progress").length, 1);
  assert.match(repaired.projection.plan[2].step, /SUSPENDED/);
  const paused = readPlan(path);
  assert.deepEqual(paused.items.map((item) => item.id), parsePlan(source).items.map((item) => item.id));
  assert.deepEqual(paused.items.map((item) => item.title), parsePlan(source).items.map((item) => item.title));
  assert.deepEqual(paused.items.map((item) => item.state), ["WIP", "DONE", "DONE", "DONE", "SUSPENDED", "DONE", "SUSPENDED", "TODO", "TODO", "TODO"]);
  assert.equal(paused.items.find((item) => item.id === "dependent").properties.get("ELAPSED_SECONDS"), "300");
  assert.equal(next(paused, "l1").id, "dependency");
  assert.equal(next(paused, "l2"), null); // historical DONE child must be explicitly reopened
  unchangedOnFailure(() => resume(path, "dependent"), /DONE \+ REVIEWED/);
  unchangedOnFailure(() => mutate(path, "set", "dependent", "WIP", { force: true }), /requires resume/);
  unchangedOnFailure(() => mutate(path, "l2", "future", "WIP"), /requires resume/);
  unchangedOnFailure(() => measure(path, "checkpoint", "dependent", { observedAt: "2026-08-01T11:00:00Z" }), /cannot be measured/);
  unchangedOnFailure(() => mutate(path, "set", "later", "WIP", { force: true }), /earlier dependencies/);
  const text = readFileSync(path, "utf8");
  assert.throws(() => parsePlan(text.replace(":SUSPENDED_FOR: dependency", ":SUSPENDED_FOR: later")), /earlier L1/);
  assert.throws(() => parsePlan(text.replace("** SUSPENDED", "** WIP")), /WIP child inside/);
  assert.throws(() => parsePlan(text.replace("* SUSPENDED", "* WIP")), /SUSPENDED_FOR|suspended child/);
  process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE = status;
  assert.match(publishStatus(path, "resync").warning, /suspension-v1/);
  assert.equal(existsSync(status), false);
  const beforeSignal = readFileSync(path, "utf8");
  const signal = spawnSync(process.execPath, [cli, "signal", path, "resync"], { encoding: "utf8" });
  assert.equal(signal.status, 1);
  assert.match(signal.stderr, /suspension-v1/);
  assert.equal(readFileSync(path, "utf8"), beforeSignal);
  assert.equal(existsSync(status), false);
  unchangedOnFailure(() => mutate(path, "l2", "dependency-child", "WIP"), /suspension-v1/);
  process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES = "other,suspension-v1";
  mutate(path, "l2", "dependency-child", "WIP");
  mutate(path, "l2", "dependency-child", "DONE");
  mutate(path, "set", "dependency", "DONE");
  assert.equal(next(readPlan(path), "review").id, "dependency");
  unchangedOnFailure(() => mutate(path, "review", "intermediate", "UNREVIEWED"), /multiple in_progress/);
  unchangedOnFailure(() => resume(path, "dependent"), /DONE \+ REVIEWED/);
  assert.equal(next(readPlan(path), "l1"), null); // cannot bypass suspended work to later TODO
  mutate(path, "review", "dependency", "REVIEWED");
  mutate(path, "set", "intermediate", "WIP");
  assert.equal(readPlan(path).items.find((item) => item.id === "intermediate").properties.get("REVIEW_STATUS"), "UNREVIEWED");
  unchangedOnFailure(() => resume(path, "dependent"), /DONE \+ REVIEWED/);
  mutate(path, "l2", "intermediate-child", "WIP");
  mutate(path, "l2", "intermediate-child", "DONE");
  mutate(path, "set", "intermediate", "DONE");
  mutate(path, "review", "intermediate", "REVIEWED");
  const restored = resume(path, "dependent");
  assert.equal(restored.projection.plan.filter((item) => item.status === "in_progress").length, 1);
  assert.equal(next(readPlan(path), "l2").id, "working");
  assert.equal(readFileSync(path, "utf8"), source.replace("dependency\n:SKILLS: $make\n:REVIEW_STATUS: UNREVIEWED", "dependency\n:SKILLS: $make\n:REVIEW_STATUS: REVIEWED"));
  assert.equal(JSON.parse(readFileSync(status, "utf8")).reason, "update");
  delete process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE;
  delete process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;

  reset();
  let command = spawnSync(process.execPath, [cli, "suspend-reopen", path, "dependent", "dependency"], { encoding: "utf8" });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).after[0].state, "SUSPENDED");
  command = spawnSync(process.execPath, [cli, "resume", path, "dependent"], { encoding: "utf8" });
  assert.equal(command.status, 1);
  assert.match(command.stderr, /DONE \+ REVIEWED/);
  reset();
  const response = dispatch("tools/call", { name: "org_plan_suspend_reopen", arguments: { plan: path, dependentId: "dependent", dependencyId: "dependency" } });
  assert.equal(response.structuredContent.after[0].state, "SUSPENDED");
  assert.equal(dispatch("tools/call", { name: "org_plan_resume", arguments: { plan: path, id: "dependent" } }).isError, true);
  // Actual normal stdio MCP process consumes only the declared host assertion.
  // This tests packaged propagation/guard behavior, not installed Codex activation.
  const manifest = JSON.parse(readFileSync(new URL("../../../plugins/gestalt/.mcp.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.mcpServers["gestalt-org-plan"].env_vars, [
    "GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY",
    "GESTALT_MOBILE_ORG_PLAN_STATUS_FILE",
    "GESTALT_MOBILE_ORG_PLAN_CAPABILITIES",
  ]);
  for (const capability of [undefined, "suspension-v1"]) {
    reset();
    rmSync(status, { force: true });
    const child = spawn(process.execPath, [fileURLToPath(new URL("../../../plugins/gestalt/org-plan-mcp.mjs", import.meta.url))], {
      env: {
        PATH: "/usr/bin:/bin", HOME: directory, LANG: "C",
        GESTALT_MOBILE_ORG_PLAN_STATUS_FILE: status,
        ...(capability ? { GESTALT_MOBILE_ORG_PLAN_CAPABILITIES: capability } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.resume();
    const closed = new Promise((resolve) => child.once("close", resolve));
    const client = createMcpTestClient(child);
    try {
      const reply = await client.request(1, "tools/call", {
        name: "org_plan_suspend_reopen",
        arguments: { plan: path, dependentId: "dependent", dependencyId: "dependency" },
      });
      if (capability) {
        assert.equal(reply.result.structuredContent.after[0].state, "SUSPENDED");
        assert.equal(reply.result.structuredContent.publication.published, true);
        assert.equal(JSON.parse(readFileSync(status, "utf8")).planPath, path);
      } else {
        assert.equal(reply.result.isError, true);
        assert.match(reply.result.content[0].text, /suspension-v1/);
        assert.equal(readFileSync(path, "utf8"), source);
        assert.equal(existsSync(status), false);
      }
    } finally {
      child.stdin.end();
      child.kill("SIGTERM");
      let timer;
      try {
        await Promise.race([closed, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("stdio fixture did not close")), 3000);
        })]);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  console.log("Org suspension regression: atomic rollback, consumer guard, exact preservation, dependency review gates, CLI and MCP passed");
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(directory, { recursive: true, force: true });
}
