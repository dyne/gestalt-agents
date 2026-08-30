#!/usr/bin/env node
import readline from "node:readline";
import { describe, measure, mutate, next, projection, publishStatus, readPlan, summary } from "./skills/org-plan/scripts/org-plan-core.mjs";

const plan = { type: "string", minLength: 1, description: "Absolute or workspace-relative Org Plan path." };
const id = { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" };
const lifecycleState = { type: "string", enum: ["TODO", "WIP", "DONE"] };
const tool = (name, description, inputSchema, readOnlyHint) => ({ name, description, inputSchema: { type: "object", additionalProperties: false, ...inputSchema }, annotations: { readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint } });
const tools = [
  tool("org_plan_validate", "Validate an Org Plan without changing it.", { properties: { plan }, required: ["plan"] }, true),
  tool("org_plan_describe", "Describe one Org Plan milestone.", { properties: { plan, id }, required: ["plan", "id"] }, true),
  tool("org_plan_next", "Select the next L1, L2, or review milestone.", { properties: { plan, kind: { type: "string", enum: ["l1", "l2", "review"] } }, required: ["plan", "kind"] }, true),
  tool("org_plan_summary", "Summarize Org Plan lifecycle and review state.", { properties: { plan }, required: ["plan"] }, true),
  tool("org_plan_projection", "Return the root-owned native plan projection.", { properties: { plan }, required: ["plan"] }, true),
  tool("org_plan_l1_transition", "Transition one L1 milestone.", { properties: { plan, id, state: lifecycleState, force: { type: "boolean" } }, required: ["plan", "id", "state"] }, false),
  tool("org_plan_l2_transition", "Transition one L2 milestone.", { properties: { plan, id, state: { type: "string", enum: ["WIP", "DONE"] } }, required: ["plan", "id", "state"] }, false),
  tool("org_plan_review_transition", "Record an L1 review state.", { properties: { plan, id, state: { type: "string", enum: ["REVIEWED", "UNREVIEWED"] } }, required: ["plan", "id", "state"] }, false),
  tool("org_plan_measure", "Record a derived Org Plan measurement.", { properties: { plan, id, operation: { type: "string", enum: ["start", "checkpoint", "finish"] }, snapshot: { type: "object", additionalProperties: false, properties: { observedAt: { type: "string", format: "date-time" }, weeklyRemaining: { type: "integer", minimum: 0, maximum: 100 }, tokensUsed: { type: "integer", minimum: 0 } }, required: ["observedAt"] } }, required: ["plan", "id", "operation", "snapshot"] }, false),
  tool("org_plan_signal", "Publish a non-mutating Org Plan lifecycle signal.", { properties: { plan, reason: { type: "string", minLength: 1, maxLength: 256 } }, required: ["plan"] }, false),
];
const envelope = (current, value) => ({ plan: { path: current.path, fingerprint: current.fingerprint }, ...value });
const result = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
function call(name, args) { const current = readPlan(args.plan); if (name === "org_plan_validate") return result(envelope(current, { valid: true })); if (name === "org_plan_describe") return result(envelope(current, { item: describe(current, args.id) })); if (name === "org_plan_next") return result(envelope(current, { item: next(current, args.kind) })); if (name === "org_plan_summary") return result(envelope(current, { summary: summary(current) })); if (name === "org_plan_projection") return result(envelope(current, { projection: projection(current) })); if (name === "org_plan_l1_transition") return result(mutate(args.plan, "l1", args.id, args.state, { force: args.force === true })); if (name === "org_plan_l2_transition") return result(mutate(args.plan, "l2", args.id, args.state)); if (name === "org_plan_review_transition") return result(mutate(args.plan, "review", args.id, args.state)); if (name === "org_plan_measure") return result(measure(args.plan, args.operation, args.id, args.snapshot)); if (name === "org_plan_signal"){const before=summary(current);return result(envelope(current,{before,after:summary(current),projection:projection(current),publication:publishStatus(args.plan,args.reason??"signal")}));}throw new Error(`unknown tool ${name}`); }
const reply = (id, payload) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...payload })}\n`);
readline.createInterface({ input: process.stdin }).on("line", (line) => { let request; try { request = JSON.parse(line); let response; if (request.method === "initialize") response = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "gestalt-org-plan", version: "1.0.0" } }; else if (request.method === "tools/list") response = { tools }; else if (request.method === "tools/call") response = call(request.params?.name, request.params?.arguments ?? {}); else return; reply(request.id, { result: response }); } catch (error) { reply(request?.id ?? null, { error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }); } });
