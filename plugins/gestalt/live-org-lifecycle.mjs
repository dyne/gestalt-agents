/** Typed controller shim. Mutable plan content is never processed at its host path. */
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { parsePlan } from "./skills/org-plan/scripts/org-plan-core.mjs";
import { requireSuspensionCapability } from "./skills/org-plan/scripts/org-plan-publication.mjs";
import { dispatch, tools } from "./org-plan-mcp.mjs";
import { AdmissionError } from "./live-admission.mjs";
import { validate } from "./org-plan-mcp-support.mjs";

const fail = (reason) => { throw new AdmissionError(reason); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const fdPath = (fd) => `/proc/self/fd/${fd}`;
function scrub(value, snapshot, plan) {
  if (typeof value === "string") return value.replaceAll(snapshot, plan);
  if (Array.isArray(value)) return value.map((item) => scrub(item, snapshot, plan));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item, snapshot, plan)]));
  return value;
}
export function orgLifecycle(authority, method, params) {
  if (method === "initialize") return dispatch(method, params);
  if (method === "tools/list") return { tools };
  if (method === "ping") return {};
  if (method !== "tools/call") fail("unsupported-lifecycle-method");
  if (!params || Object.keys(params).some((key) => !["name", "arguments", "_meta"].includes(key))) fail("invalid-lifecycle-request");
  // Pinned Native adds thread routing and optional W3C trace annotations.
  // None carries authority; validate and discard them before typed dispatch.
  if (Object.hasOwn(params, "_meta")) {
    const meta = params._meta;
    if (!meta || Array.isArray(meta) || Object.keys(meta).some((key) => !["threadId", "traceparent", "tracestate"].includes(key))
      || typeof meta.threadId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(meta.threadId)) fail("invalid-lifecycle-request");
    if (Object.hasOwn(meta, "traceparent") && (typeof meta.traceparent !== "string"
      || !/^00-(?!0{32}-)[a-f0-9]{32}-(?!0{16}-)[a-f0-9]{16}-(?:00|01)$/.test(meta.traceparent))) fail("invalid-lifecycle-request");
    if (Object.hasOwn(meta, "tracestate")) {
      if (!Object.hasOwn(meta, "traceparent") || typeof meta.tracestate !== "string"
        || !meta.tracestate.length || meta.tracestate.length > 512 || /[\x00-\x1f\x7f]/.test(meta.tracestate)) fail("invalid-lifecycle-request");
      const members = meta.tracestate.split(",").map((item) => item.trim());
      const key = "(?:[a-z][a-z0-9_*/-]{0,255}|[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13})";
      if (members.length > 32 || members.some((item) => !new RegExp(`^${key}=[\\x20-\\x2b\\x2d-\\x3c\\x3e-\\x7e]{0,255}[\\x21-\\x2b\\x2d-\\x3c\\x3e-\\x7e]$`).test(item))
        || new Set(members.map((item) => item.split("=")[0])).size !== members.length) fail("invalid-lifecycle-request");
    }
  }
  const definition = tools.find((tool) => tool.name === params.name);
  if (!definition) fail("unsupported-lifecycle-tool");
  const args = params.arguments ?? {};
  validate(args, definition.inputSchema);
  // This controller bridge always serves a retained plan. Capability authority
  // comes exclusively from authenticated bootstrap/Manager v2 admission, never
  // from ambient environment or MCP arguments, and is never exported to children.
  const context = { consumerAttached: true, consumerCapabilities: authority.consumerCapabilities ?? [] };
  if (["org_plan_suspend_reopen", "org_plan_resume"].includes(params.name) &&
      !context.consumerCapabilities.includes("suspension-v1"))
    fail("unsupported-suspension-consumer");
  if (!authority.input.plans.includes(args.plan)) fail("unadmitted-lifecycle-plan");
  // Publication is controller-owned, never derived from MCP arguments or host
  // ambient variables. No destination is configured in contract 1.
  if (process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY || process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE
    || process.env.PATH !== "/usr/bin:/bin") fail("unsafe-lifecycle-environment");
  const privateRoot = dirname(authority.input.manifestPath), lock = join(privateRoot, "org-lifecycle.lock");
  let lockFd, appFd, directoryFd, planFd, currentFd, candidate;
  const operation = join(privateRoot, `org-${randomUUID()}`);
  try {
    lockFd = openSync(lock, "wx", 0o600);
    appFd = openSync(authority.input.workspaceRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const directory = join(fdPath(appFd), ".gestalt");
    directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const plan = join(fdPath(directoryFd), basename(args.plan));
    planFd = openSync(plan, constants.O_RDONLY | constants.O_NOFOLLOW);
    const original = fstatSync(planFd);
    if (!original.isFile() || original.nlink !== 1 || original.uid !== process.getuid() || original.size > 262144) fail("unsafe-lifecycle-plan");
    const bytes = readFileSync(planFd);
    requireSuspensionCapability(parsePlan(bytes.toString("utf8")), context);
    mkdirSync(operation, { mode: 0o700 });
    const snapshot = join(operation, "assigned.org");
    writeFileSync(snapshot, bytes, { mode: 0o600, flag: "wx" });
    // Existing typed Org helper is the only lifecycle state machine. It works
    // on a private snapshot; even a project symlink race cannot reach host data.
    const result = dispatch("tools/call", { name: params.name, arguments: { ...args, plan: snapshot } }, context);
    if (result.isError) fail("lifecycle-operation-refused");
    const updated = readFileSync(snapshot);
    currentFd = openSync(plan, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!same(fstatSync(appFd), lstatSync(authority.input.workspaceRoot))
      || !same(fstatSync(directoryFd), lstatSync(join(authority.input.workspaceRoot, ".gestalt")))
      || !same(original, fstatSync(currentFd)) || !readFileSync(currentFd).equals(bytes)) fail("lifecycle-plan-changed");
    if (!updated.equals(bytes)) {
      candidate = join(fdPath(directoryFd), `.live-org-${randomUUID()}.tmp`);
      writeFileSync(candidate, updated, { mode: original.mode & 0o777, flag: "wx" });
      renameSync(candidate, plan); candidate = undefined;
    }
    const cleaned = scrub(result, snapshot, args.plan);
    // Re-encode from the scrubbed object, not a replacement in encoded JSON:
    // quoted/non-ASCII paths must remain valid JSON and expose no private path.
    if (cleaned.structuredContent) cleaned.content = [{ type: "text", text: JSON.stringify(cleaned.structuredContent) }];
    return cleaned;
  } catch (error) {
    if (error instanceof AdmissionError) throw error;
    fail("lifecycle-operation-refused");
  } finally {
    if (candidate) try { rmSync(candidate); } catch {}
    for (const fd of [currentFd, planFd, directoryFd, appFd, lockFd]) if (fd !== undefined) try { closeSync(fd); } catch {}
    rmSync(operation, { recursive: true, force: true });
    if (lockFd !== undefined) rmSync(lock, { force: true });
  }
}
