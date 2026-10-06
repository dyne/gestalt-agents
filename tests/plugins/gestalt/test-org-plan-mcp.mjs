#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createMcpTestClient } from "./mcp-test-client.mjs";
import {
  mutate,
  projection,
  publishStatus,
  readPlan,
} from "../../../plugins/gestalt/skills/org-plan/scripts/org-plan-core.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(root, "plugins/gestalt/.mcp.json"), "utf8"),
);
assert.equal(
  manifest.mcpServers["gestalt-org-plan"].default_tools_approval_mode,
  "approve",
);
assert.deepEqual(manifest.mcpServers["gestalt-org-plan"].env_vars, [
  "GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY",
  "GESTALT_MOBILE_ORG_PLAN_STATUS_FILE",
]);
const temporary = mkdtempSync(join(tmpdir(), "org-plan-mcp-test-"));
try {
  const planPath = join(temporary, "plan.org");
  copyFileSync(
    join(root, "tests/plugins/gestalt/fixtures/valid-minimal.org"),
    planPath,
  );
  const canonicalPlanPath = readPlan(planPath).path;
  assert.equal(readPlan(planPath).fingerprint.startsWith("sha256:"), true);
  assert.equal(projection(readPlan(planPath)).plan[0].status, "pending");
  const mutation = mutate(planPath, "l1", "first-outcome", "WIP");
  assert.equal(mutation.before.state, "TODO");
  assert.equal(mutation.after.state, "WIP");
  assert.throws(
    () => mutate(planPath, "l1", "first-outcome", "TODO", { force: true }),
    /invalid transition WIP -> TODO/,
  );
  mutate(planPath, "l2", "first-task", "WIP");
  mutate(planPath, "l2", "first-task", "DONE");
  mutate(planPath, "l2", "first-task", "WIP");
  mutate(planPath, "l2", "first-task", "DONE");
  mutate(planPath, "l1", "first-outcome", "DONE");
  assert.throws(
    () => mutate(planPath, "l1", "first-outcome", "TODO", { force: true }),
    /invalid transition DONE -> TODO/,
  );
  mutate(planPath, "l1", "first-outcome", "WIP");
  mutate(planPath, "l1", "first-outcome", "DONE");
  assert.throws(
    () => mutate(planPath, "l1", "first-task", "WIP"),
    /is not an L1/,
  );
  assert.equal(
    readPlan(planPath).items.find((item) => item.id === "first-task").state,
    "DONE",
  );
  const statusDirectory = join(temporary, "status");
  mkdirSync(statusDirectory, { mode: 0o700 });
  const old = process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY;
  process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY = statusDirectory;
  const publication = publishStatus(planPath, "mcp-test");
  if (old === undefined)
    delete process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY;
  else process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY = old;
  assert.equal(publication.published, true);
  const status = JSON.parse(readFileSync(publication.path, "utf8"));
  assert.equal(status.schemaVersion, 1);
  assert.equal(status.planPath, canonicalPlanPath);
  assert.equal(status.reason, "mcp-test");
  process.stdout.write("org-plan MCP core/status contract passed\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const integration = mkdtempSync(join(tmpdir(), "org-plan-mcp-server-"));
let integrationChild;
try {
  const planPath = join(integration, "plan.org");
  const statusDirectory = join(
    integration,
    ".gestalt",
    "status",
    "a".repeat(64),
  );
  copyFileSync(
    join(root, "tests/plugins/gestalt/fixtures/valid-minimal.org"),
    planPath,
  );
  const canonicalPlanPath = readPlan(planPath).path;
  mkdirSync(statusDirectory, { mode: 0o700, recursive: true });
  const childEnv = {
    ...process.env,
    GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY: statusDirectory,
  };
  delete childEnv.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE;
  const child = spawn(
    process.execPath,
    [join(root, "plugins/gestalt/org-plan-mcp.mjs")],
    {
      cwd: join(root, "plugins/gestalt"),
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  integrationChild = child;
  const client = createMcpTestClient(child);
  const { messages } = client;
  const pending = [];
  const request = (...args) => {
    pending.push(client.request(...args));
  };
  request(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {} });
  request(2, "tools/list");
  request(3, "tools/call", {
    name: "org_plan_l1_transition",
    arguments: { plan: "plan.org", id: "first-outcome", state: "WIP" },
  });
  request(4, "tools/call", {
    name: "org_plan_measure",
    arguments: {
      plan: planPath,
      id: "first-outcome",
      operation: "start",
      snapshot: { observedAt: "2026-08-31T12:00:00Z", tokensUsed: 10 },
    },
  });
  request(5, "tools/call", {
    name: "org_plan_signal",
    arguments: { plan: planPath, reason: "mcp-integration" },
  });
  const invalidCalls = [
    { name: "org_plan_validate", arguments: {} },
    { name: "org_plan_validate", arguments: { plan: planPath, extra: true } },
    {
      name: "org_plan_l1_transition",
      arguments: {
        plan: planPath,
        id: "first-outcome",
        state: "DONE",
        force: "yes",
      },
    },
    { name: "org_plan_next", arguments: { plan: planPath, kind: "later" } },
    { name: "org_plan_describe", arguments: { plan: planPath, id: "INVALID" } },
    { name: "org_plan_validate", arguments: { plan: "" } },
    {
      name: "org_plan_signal",
      arguments: { plan: planPath, reason: "x".repeat(257) },
    },
    {
      name: "org_plan_measure",
      arguments: {
        plan: planPath,
        id: "first-outcome",
        operation: "checkpoint",
        snapshot: { observedAt: "2026-02-30T12:00:00Z" },
      },
    },
    {
      name: "org_plan_measure",
      arguments: {
        plan: planPath,
        id: "first-outcome",
        operation: "checkpoint",
        snapshot: { observedAt: "2026-08-31T12:00:00Z", weeklyRemaining: -1 },
      },
    },
    {
      name: "org_plan_measure",
      arguments: {
        plan: planPath,
        id: "first-outcome",
        operation: "checkpoint",
        snapshot: { observedAt: "2026-08-31T12:00:00Z", weeklyRemaining: 101 },
      },
    },
    {
      name: "org_plan_measure",
      arguments: {
        plan: planPath,
        id: "first-outcome",
        operation: "checkpoint",
        snapshot: { observedAt: "2026-08-31T12:00:00Z", tokensUsed: 1.5 },
      },
    },
    {
      name: "org_plan_measure",
      arguments: {
        plan: planPath,
        id: "first-outcome",
        operation: "checkpoint",
        snapshot: "invalid",
      },
    },
  ];
  invalidCalls.forEach((params, index) =>
    request(6 + index, "tools/call", params),
  );
  await Promise.all(pending.splice(0));
  const list = messages.find((message) => message.id === 2).result.tools;
  assert.equal(list.length, 10);
  assert.equal(
    list.find((entry) => entry.name === "org_plan_projection").annotations
      .readOnlyHint,
    true,
  );
  assert.equal(
    list.find((entry) => entry.name === "org_plan_l1_transition").annotations
      .readOnlyHint,
    false,
  );
  assert.equal(
    list.find((entry) => entry.name === "org_plan_l1_transition").annotations
      .destructiveHint,
    true,
  );
  assert.equal(
    list.find((entry) => entry.name === "org_plan_l2_transition").annotations
      .destructiveHint,
    false,
  );
  const mutation = messages.find((message) => message.id === 3).result
    .structuredContent;
  assert.equal(mutation.before.state, "TODO");
  assert.equal(mutation.after.state, "WIP");
  assert.equal(mutation.projection.plan[0].status, "in_progress");
  assert.equal(mutation.plan.path, canonicalPlanPath);
  const measurement = messages.find((message) => message.id === 4).result
    .structuredContent;
  assert.equal(measurement.plan.path, canonicalPlanPath);
  assert.equal(measurement.before.properties.STARTED_AT, undefined);
  assert.equal(measurement.after.properties.STARTED_AT, "2026-08-31T12:00:00Z");
  assert.equal(measurement.projection.plan[0].status, "in_progress");
  const signal = messages.find((message) => message.id === 5).result
    .structuredContent;
  assert.equal(signal.plan.path, canonicalPlanPath);
  assert.deepEqual(signal.before, signal.after);
  assert.equal(signal.projection.plan[0].status, "in_progress");
  assert.equal(
    JSON.parse(readFileSync(signal.publication.path, "utf8")).reason,
    "mcp-integration",
  );
  for (let id = 6; id < 6 + invalidCalls.length; id += 1)
    assert.equal(
      messages.find((message) => message.id === id).error.code,
      -32602,
    );
  const wrongLevel = await client.request(99, "tools/call", {
    name: "org_plan_l1_transition",
    arguments: { plan: planPath, id: "first-task", state: "WIP" },
  });
  assert.equal(wrongLevel.result.isError, true);
  assert.match(wrongLevel.result.content[0].text, /is not an L1/);
  assert.equal(
    readPlan(planPath).items.find((item) => item.id === "first-task").state,
    "TODO",
  );
  request(1000, "tools/call", {
    name: "org_plan_signal",
    arguments: { plan: planPath, reason: "supervision-start" },
  });
  request(1001, "tools/call", {
    name: "org_plan_signal",
    arguments: { plan: planPath, reason: "resync" },
  });
  request(1002, "tools/call", {
    name: "org_plan_signal",
    arguments: { plan: planPath, reason: "supervision-start" },
  });
  request(1003, "tools/call", {
    name: "org_plan_validate",
    arguments: { plan: "plan.org" },
  });
  await Promise.all(pending.splice(0));
  assert.deepEqual(
    messages.find((message) => message.id === 1003).result.structuredContent
      .plan.path,
    canonicalPlanPath,
  );
  const firstStartup = messages.find((message) => message.id === 1000).result
    .structuredContent.publication;
  const retainedStartup = messages.find((message) => message.id === 1002).result
    .structuredContent.publication;
  assert.equal(firstStartup.changed, true);
  assert.equal(retainedStartup.changed, false);
  assert.equal(retainedStartup.published, true);
  assert.equal(
    JSON.parse(readFileSync(retainedStartup.path, "utf8")).reason,
    "resync",
  );
  child.stdin.end();
  child.kill();
  process.stdout.write("org-plan MCP server contract passed\n");
} finally {
  integrationChild?.stdin.end();
  integrationChild?.kill();
  rmSync(integration, { recursive: true, force: true });
}
