#!/usr/bin/env node
import readline from "node:readline";
import { dirname } from "node:path";
import {
  handleLine,
  ProtocolError,
  resolveMcpPlanPath,
  validate,
} from "./org-plan-mcp-support.mjs";
import { fileURLToPath } from "node:url";
import {
  describe,
  measure,
  mutate,
  next,
  projection,
  publishStatus,
  readPlan,
  summary,
} from "./skills/org-plan/scripts/org-plan-core.mjs";

const plan = {
  type: "string",
  minLength: 1,
  description: "Absolute or workspace-relative Org Plan path.",
};
const id = { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" };
const lifecycleState = { type: "string", enum: ["TODO", "WIP", "DONE"] };
const tool = (
  name,
  description,
  inputSchema,
  readOnlyHint,
  destructiveHint = false,
) => ({
  name,
  description,
  inputSchema: { type: "object", additionalProperties: false, ...inputSchema },
  annotations: { readOnlyHint, destructiveHint, idempotentHint: readOnlyHint },
});
const tools = [
  tool(
    "org_plan_validate",
    "Validate an Org Plan without changing it.",
    { properties: { plan }, required: ["plan"] },
    true,
  ),
  tool(
    "org_plan_describe",
    "Describe one Org Plan milestone.",
    { properties: { plan, id }, required: ["plan", "id"] },
    true,
  ),
  tool(
    "org_plan_next",
    "Select the next L1, L2, or review milestone.",
    {
      properties: {
        plan,
        kind: { type: "string", enum: ["l1", "l2", "review"] },
      },
      required: ["plan", "kind"],
    },
    true,
  ),
  tool(
    "org_plan_summary",
    "Summarize Org Plan lifecycle and review state.",
    { properties: { plan }, required: ["plan"] },
    true,
  ),
  tool(
    "org_plan_projection",
    "Return the root-owned native plan projection.",
    { properties: { plan }, required: ["plan"] },
    true,
  ),
  tool(
    "org_plan_l1_transition",
    "Transition one L1 milestone.",
    {
      properties: {
        plan,
        id,
        state: lifecycleState,
        force: { type: "boolean" },
      },
      required: ["plan", "id", "state"],
    },
    false,
    true,
  ),
  tool(
    "org_plan_l2_transition",
    "Transition one L2 milestone.",
    {
      properties: {
        plan,
        id,
        state: { type: "string", enum: ["WIP", "DONE"] },
      },
      required: ["plan", "id", "state"],
    },
    false,
  ),
  tool(
    "org_plan_review_transition",
    "Record an L1 review state.",
    {
      properties: {
        plan,
        id,
        state: { type: "string", enum: ["REVIEWED", "UNREVIEWED"] },
      },
      required: ["plan", "id", "state"],
    },
    false,
  ),
  tool(
    "org_plan_measure",
    "Record a derived Org Plan measurement.",
    {
      properties: {
        plan,
        id,
        operation: { type: "string", enum: ["start", "checkpoint", "finish"] },
        snapshot: {
          type: "object",
          additionalProperties: false,
          properties: {
            observedAt: { type: "string", format: "date-time" },
            weeklyRemaining: { type: "integer", minimum: 0, maximum: 100 },
            tokensUsed: { type: "integer", minimum: 0 },
          },
          required: ["observedAt"],
        },
      },
      required: ["plan", "id", "operation", "snapshot"],
    },
    false,
  ),
  tool(
    "org_plan_signal",
    "Publish a non-mutating Org Plan lifecycle signal.",
    {
      properties: {
        plan,
        reason: { type: "string", minLength: 1, maxLength: 256 },
      },
      required: ["plan"],
    },
    false,
  ),
];
const envelope = (current, value) => ({
  plan: { path: current.path, fingerprint: current.fingerprint },
  ...value,
});
const result = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});
const launchContext = {
  cwd: process.cwd(),
  pluginDirectory: dirname(fileURLToPath(import.meta.url)),
  statusDirectory: process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY,
};
function call(name, args) {
  const definition = tools.find((entry) => entry.name === name);
  if (!definition) throw new ProtocolError(-32602, `Unknown tool: ${name}`);
  validate(args, definition.inputSchema);
  try {
    return executeTool(name, args);
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            error instanceof Error ? error.message : "Tool execution failed",
        },
      ],
    };
  }
}
function executeTool(name, args) {
  const planPath = resolveMcpPlanPath(args.plan, launchContext);
  const current = readPlan(planPath);
  if (name === "org_plan_validate")
    return result(envelope(current, { valid: true }));
  if (name === "org_plan_describe")
    return result(envelope(current, { item: describe(current, args.id) }));
  if (name === "org_plan_next")
    return result(envelope(current, { item: next(current, args.kind) }));
  if (name === "org_plan_summary")
    return result(envelope(current, { summary: summary(current) }));
  if (name === "org_plan_projection")
    return result(envelope(current, { projection: projection(current) }));
  if (name === "org_plan_l1_transition")
    return result(
      mutate(planPath, "l1", args.id, args.state, {
        force: args.force === true,
      }),
    );
  if (name === "org_plan_l2_transition")
    return result(mutate(planPath, "l2", args.id, args.state));
  if (name === "org_plan_review_transition")
    return result(mutate(planPath, "review", args.id, args.state));
  if (name === "org_plan_measure")
    return result(measure(planPath, args.operation, args.id, args.snapshot));
  if (name === "org_plan_signal") {
    const before = summary(current);
    return result(
      envelope(current, {
        before,
        after: summary(current),
        projection: projection(current),
        publication: publishStatus(planPath, args.reason ?? "signal", {
          preserveExisting: args.reason === "supervision-start",
        }),
      }),
    );
  }
  throw new Error(`unknown tool ${name}`);
}
function dispatch(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "gestalt-org-plan", version: "1.0.0" },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools };
    case "tools/call":
      return call(params.name, params.arguments ?? {});
    default:
      throw new ProtocolError(-32601, `Method not found: ${method}`);
  }
}
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const response = handleLine(line, dispatch);
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
});
