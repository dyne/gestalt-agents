import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  handleLine,
  isDateTime,
  ProtocolError,
  resolveMcpPlanPath,
  validate,
} from "../../../plugins/gestalt/org-plan-mcp-support.mjs";
import { createMcpTestClient } from "./mcp-test-client.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const pluginDirectory = join(root, "plugins/gestalt");
const server = join(pluginDirectory, "org-plan-mcp.mjs");

test("request envelopes reject invalid IDs and malformed JSON before dispatch", () => {
  let calls = 0;
  const dispatch = () => {
    calls++;
    return {};
  };
  assert.equal(handleLine("{", dispatch).error.code, -32700);
  for (const request of [
    null,
    [],
    42,
    {},
    { jsonrpc: "1.0", id: 1, method: "ping" },
    ...[null, true, {}, [], 1.5, Number.MAX_SAFE_INTEGER + 1].map((id) => ({
      jsonrpc: "2.0",
      id,
      method: "ping",
    })),
  ]) {
    assert.deepEqual(handleLine(JSON.stringify(request), dispatch), {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  }
  for (const params of [null, [], "bad", 1]) {
    const response = handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params }),
      dispatch,
    );
    assert.equal(response.id, 4);
    assert.equal(response.error.code, -32602);
  }
  assert.equal(calls, 0);
  for (const id of [0, "", "request-1", 42]) {
    assert.deepEqual(
      handleLine(
        JSON.stringify({ jsonrpc: "2.0", id, method: "ping" }),
        dispatch,
      ),
      { jsonrpc: "2.0", id, result: {} },
    );
  }
  assert.equal(calls, 4);
});

test("notifications do not execute tools or reply; internal errors are bounded", () => {
  for (const method of [
    "notifications/initialized",
    "notifications/cancelled",
    "tools/list",
    "tools/call",
    "unknown",
  ]) {
    assert.equal(
      handleLine(JSON.stringify({ jsonrpc: "2.0", method }), () =>
        assert.fail("notification dispatched"),
      ),
      null,
    );
  }
  const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "unknown" });
  assert.equal(
    handleLine(request, () => {
      throw new ProtocolError(-32601, "Method not found");
    }).error.code,
    -32601,
  );
  assert.deepEqual(
    handleLine(request, () => {
      throw new Error("private implementation detail");
    }).error,
    { code: -32603, message: "Internal error" },
  );
});

test("date-time validation covers calendar boundaries and offsets without Date.UTC's year remapping", () => {
  for (const value of [
    "2024-02-29T00:00:00Z",
    "2000-02-29T23:59:59.123Z",
    "0000-02-29T00:00:00Z",
    "0096-02-29T00:00:00Z",
    "2026-10-06T12:34:56+02:00",
    "2026-10-06T12:34:56-05:30",
  ]) {
    assert.equal(isDateTime(value), true, value);
  }
  for (const value of [
    null,
    5,
    "1900-02-29T00:00:00Z",
    "2025-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-00T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00-00:60",
    "2026-01-01",
    "2026-01-01T00:00:00Z\n",
    "2026-01-01T00:00:00",
  ]) {
    assert.equal(isDateTime(value), false, String(value));
  }
});

test("schema validation rejects wrong types, unknown properties and out-of-range values", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["count"],
    properties: {
      count: { type: "integer", minimum: 0, maximum: 100 },
      force: { type: "boolean" },
      title: { type: "string", minLength: 1, maxLength: 2 },
      state: { type: "string", enum: ["WIP", "DONE"] },
      id: { type: "string", pattern: "^[a-z]+$" },
      time: { type: "string", format: "date-time" },
    },
  };
  for (const value of [
    { count: 0 },
    {
      count: 100,
      force: false,
      title: "😀😀",
      state: "DONE",
      id: "abc",
      time: "2024-02-29T00:00:00Z",
    },
  ])
    validate(value, schema);
  for (const value of [
    null,
    [],
    {},
    { count: "1" },
    { count: -1 },
    { count: 101 },
    { count: 1.5 },
    { count: Infinity },
    { count: Number.MAX_SAFE_INTEGER + 1 },
    { count: 0, extra: true },
    { count: 0, force: "true" },
    { count: 0, title: 1 },
    { count: 0, title: "" },
    { count: 0, title: "😀😀😀" },
    { count: 0, state: "TODO" },
    { count: 0, id: "ABC" },
    { count: 0, time: "2025-02-29T00:00:00Z" },
  ]) {
    assert.throws(
      () => validate(value, schema),
      (error) => error instanceof ProtocolError && error.code === -32602,
    );
  }
});

test("path resolution uses an explicit workspace and rejects broken handoffs", () => {
  const cwd = "/work/project";
  const context = { cwd, pluginDirectory: "/installed/plugin" };
  assert.equal(
    resolveMcpPlanPath(".gestalt/plan.org", context),
    "/work/project/.gestalt/plan.org",
  );
  const mobile = {
    ...context,
    cwd: context.pluginDirectory,
    statusDirectory: `/work/space with spaces/.gestalt/status/${"a".repeat(64)}`,
  };
  assert.equal(
    resolveMcpPlanPath(".gestalt/plan.org", mobile),
    "/work/space with spaces/.gestalt/plan.org",
  );
  assert.throws(
    () =>
      resolveMcpPlanPath("plan.org", {
        ...context,
        cwd: context.pluginDirectory,
      }),
    /absolute plan path/,
  );
  for (const statusDirectory of [
    "",
    "relative/status",
    "/wrong/status",
    `/work/status/${"a".repeat(64)}`,
    `/work/.gestalt/status/${"z".repeat(64)}`,
    `/work/.gestalt/status/${"a".repeat(63)}`,
  ]) {
    assert.throws(
      () => resolveMcpPlanPath("plan.org", { ...context, statusDirectory }),
      /Invalid session workspace handoff/,
    );
    assert.equal(
      resolveMcpPlanPath("/absolute/plan.org", { ...context, statusDirectory }),
      "/absolute/plan.org",
    );
  }
});

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stdin: new PassThrough(),
  });
}
test("test client frames fragmented and coalesced lines and correlates out-of-order replies", async () => {
  const child = fakeChild();
  const client = createMcpTestClient(child);
  const replies = Promise.all([
    client.request(1, "ping"),
    client.request(2, "ping"),
    client.request(3, "ping"),
  ]);
  child.stdout.write('{"jsonrpc":"2.0","id":2,"res');
  child.stdout.write(
    'ult":{}}\n{"jsonrpc":"2.0","id":1,"result":{}}\n{"jsonrpc":"2.0","id":3,',
  );
  child.stdout.end('"result":{}}\n');
  assert.deepEqual(
    (await replies).map((reply) => reply.id),
    [1, 2, 3],
  );
});

test("test client rejects pending calls on process exit, spawn failure, malformed output and timeout", async () => {
  for (const terminate of [
    (child) => child.emit("exit", 1, null),
    (child) => child.emit("error", new Error("spawn failed")),
    (child) => child.stdout.end(),
    (child) => child.stdout.write("not JSON\n"),
  ]) {
    const child = fakeChild();
    const client = createMcpTestClient(child);
    const rejected = assert.rejects(client.request(1, "ping"));
    terminate(child);
    await rejected;
    await assert.rejects(client.request(2, "ping"));
    child.stdout.end();
  }
  const child = fakeChild();
  await assert.rejects(
    createMcpTestClient(child, { timeoutMs: 10 }).request(1, "ping"),
    /timed out/,
  );
  child.stdout.end();
});

test("stdio protocol recovers after errors and rejected calls leave the plan unchanged", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "org-plan-mcp-boundaries-"));
  const plan = join(temporary, "plan.org");
  copyFileSync(
    join(root, "tests/plugins/gestalt/fixtures/valid-minimal.org"),
    plan,
  );
  const before = readFileSync(plan, "utf8");
  const env = { ...process.env };
  delete env.GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY;
  delete env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE;
  const child = spawn(process.execPath, [server], {
    cwd: temporary,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const client = createMcpTestClient(child);
  try {
    await client.request(1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
    });
    client.notify("notifications/initialized");
    client.notify("tools/call", {
      name: "org_plan_l1_transition",
      arguments: { plan, id: "first-outcome", state: "WIP" },
    });
    assert.deepEqual((await client.request(0, "ping")).result, {});
    assert.equal((await client.request(2, "not-a-method")).error.code, -32601);
    assert.equal((await client.send("{", null)).error.code, -32700);
    assert.equal(
      (
        await client.send(
          JSON.stringify({ jsonrpc: "2.0", id: null, method: "tools/call" }),
          null,
        )
      ).error.code,
      -32600,
    );
    assert.equal(
      (
        await client.request(3, "tools/call", {
          name: "not-a-tool",
          arguments: {},
        })
      ).error.code,
      -32602,
    );
    const invalidArguments = await client.request(4, "tools/call", {
      name: "org_plan_l1_transition",
      arguments: { plan, id: "first-outcome", state: "WIP", force: "yes" },
    });
    assert.equal(invalidArguments.error.code, -32602);
    const rejectedTransition = await client.request(5, "tools/call", {
      name: "org_plan_l1_transition",
      arguments: { plan, id: "first-outcome", state: "DONE" },
    });
    assert.equal(rejectedTransition.error, undefined);
    assert.equal(rejectedTransition.result.isError, true);
    assert.match(
      rejectedTransition.result.content[0].text,
      /invalid transition/,
    );
    const missingFile = await client.request(6, "tools/call", {
      name: "org_plan_validate",
      arguments: { plan: join(temporary, "missing.org") },
    });
    assert.equal(missingFile.result.isError, true);
    assert.match(missingFile.result.content[0].text, /ENOENT/);
    const valid = await client.request("valid", "tools/call", {
      name: "org_plan_validate",
      arguments: { plan: "plan.org" },
    });
    assert.equal(valid.result.structuredContent.valid, true);
    assert.equal(readFileSync(plan, "utf8"), before);
  } finally {
    child.stdin.end();
    child.kill();
    rmSync(temporary, { recursive: true, force: true });
  }
});
