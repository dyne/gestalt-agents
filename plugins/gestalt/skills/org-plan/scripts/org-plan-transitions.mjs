import { lstatSync, unlinkSync, writeFileSync } from "node:fs";
import {
  chmodThroughPath,
  fail,
  renameThroughPath,
  resolvePlanPath,
  temporarySibling,
} from "./org-plan-files.mjs";
import {
  findItem,
  observable,
  parsePlan,
  projection,
  readPlan,
} from "./org-plan-parser.mjs";
import { publishStatus, requireConsumerCapabilities } from "./org-plan-publication.mjs";

const MEASURED_PROPERTIES = [
  "STARTED_AT",
  "UPDATED_AT",
  "COMPLETED_AT",
  "ELAPSED_SECONDS",
  "WEEKLY_REMAINING_START",
  "WEEKLY_REMAINING_CURRENT",
  "WEEKLY_REMAINING_END",
  "WEEKLY_PERCENT_USED",
  "TOKENS_START",
  "TOKENS_CURRENT",
  "TOKENS_END",
  "TOKENS_USED",
];

function writePlan(path, plan, reason, options = {}) {
  const text = plan.lines.join("\n");
  const candidate = parsePlan(text);
  projection(candidate);
  requireConsumerCapabilities(candidate, options);
  const canonicalPath = resolvePlanPath(path);
  const status = lstatSync(canonicalPath);
  const temporary = temporarySibling(canonicalPath);
  try {
    writeFileSync(temporary, text, { mode: status.mode & 0o777 });
    chmodThroughPath(temporary, status.mode & 0o777);
    renameThroughPath(temporary, canonicalPath);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {}
    throw error;
  }
  const updatedPlan = readPlan(canonicalPath);
  return {
    plan: updatedPlan,
    publication: publishStatus(canonicalPath, reason, options),
  };
}

function transitionHeading(plan, item, state, force) {
  if (!["TODO", "WIP", "DONE"].includes(state)) {
    fail(`invalid transition ${item.state} -> ${state}`);
  }
  const isAllowedTransition =
    (item.state === "TODO" && state === "WIP") ||
    (item.state === "WIP" && state === "DONE") ||
    (item.state === "DONE" && state === "WIP");
  const isForbiddenTodoRollback =
    state === "TODO" && (item.state === "WIP" || item.state === "DONE");
  if (isForbiddenTodoRollback || (!force && !isAllowedTransition)) {
    fail(`invalid transition ${item.state} -> ${state}`);
  }
  if (
    item.level === 1 &&
    state === "DONE" &&
    plan.items.some(
      (candidate) => candidate.parent === item && candidate.state !== "DONE",
    )
  ) {
    fail("unfinished child of DONE parent");
  }
  plan.lines[item.line] = plan.lines[item.line].replace(
    /^(\*{1,2}) (TODO|WIP|DONE)/,
    `$1 ${state}`,
  );
  if (
    item.level === 1 &&
    state === "WIP" &&
    item.properties.get("REVIEW_STATUS") === "REVIEWED"
  ) {
    const reviewLine = plan.lines.findIndex(
      (line, index) =>
        index > item.ds && index < item.de && /^:REVIEW_STATUS:/.test(line),
    );
    plan.lines[reviewLine] = ":REVIEW_STATUS: UNREVIEWED";
  }
}

function transitionReview(plan, item, id, state) {
  if (item.level !== 1) fail(`ID ${id} is not an L1`);
  if (!["REVIEWED", "UNREVIEWED"].includes(state))
    fail(`invalid transition ${state}`);
  if (state === "REVIEWED" && item.state !== "DONE") {
    fail(`cannot review unfinished L1 ${id}`);
  }
  const reviewLine = plan.lines.findIndex(
    (line, index) =>
      index > item.ds && index < item.de && /^:REVIEW_STATUS:/.test(line),
  );
  plan.lines[reviewLine] = `:REVIEW_STATUS: ${state}`;
}

export function mutate(path, operation, id, state, options = {}) {
  const { force = false } = options;
  const plan = readPlan(path);
  const item = findItem(plan, id);
  const before = observable(plan, id);
  requireConsumerCapabilities(plan, options);
  if (item.state === "SUSPENDED" || item.parent?.state === "SUSPENDED")
    fail("suspended work requires resume before mutation");
  if (operation === "review") {
    transitionReview(plan, item, id, state);
  } else {
    const expectedLevel =
      operation === "l1" ? 1 : operation === "l2" ? 2 : null;
    if (expectedLevel !== null && item.level !== expectedLevel) {
      fail(`ID ${id} is not an L${expectedLevel}`);
    }
    if (item.level === 1 && state === "WIP" && plan.items.some((entry) => entry.state === "SUSPENDED") &&
        plan.items.some((entry) => entry.level === 1 && entry.line < item.line &&
          (entry.state !== "DONE" || entry.properties.get("REVIEW_STATUS") !== "REVIEWED")))
      fail("earlier dependencies must be DONE + REVIEWED");
    transitionHeading(plan, item, state, force);
  }
  const reason = `${operation === "l1" ? "set" : operation}:${id}:${state}`;
  const result = writePlan(path, plan, reason, options);
  return {
    plan: { path: result.plan.path, fingerprint: result.plan.fingerprint },
    before,
    after: observable(result.plan, id),
    projection: projection(result.plan),
    fingerprint: result.plan.fingerprint,
    publication: result.publication,
  };
}

function validateSnapshot(operation, snapshot) {
  if (
    !["start", "checkpoint", "finish"].includes(operation) ||
    !snapshot ||
    typeof snapshot.observedAt !== "string" ||
    Number.isNaN(Date.parse(snapshot.observedAt))
  ) {
    fail("snapshot requires an ISO-8601 observedAt");
  }
  for (const key of Object.keys(snapshot)) {
    if (!["observedAt", "weeklyRemaining", "tokensUsed"].includes(key)) {
      fail("snapshot requires an ISO-8601 observedAt");
    }
  }
  for (const key of ["weeklyRemaining", "tokensUsed"]) {
    const value = snapshot[key];
    if (
      value !== undefined &&
      (!Number.isInteger(value) ||
        value < 0 ||
        (key === "weeklyRemaining" && value > 100))
    ) {
      fail(
        `snapshot ${key} must be a non-negative integer${key === "weeklyRemaining" ? " no greater than 100" : ""}`,
      );
    }
  }
  return {
    ...snapshot,
    observedAt: new Date(snapshot.observedAt).toISOString().replace(".000Z", "Z"),
  };
}

function measurementUpdates(operation, properties, snapshot) {
  const start = properties.get("STARTED_AT") ?? snapshot.observedAt;
  const updates = new Map([
    ["STARTED_AT", start],
    ["UPDATED_AT", snapshot.observedAt],
    [
      "ELAPSED_SECONDS",
      String(
        Math.max(
          0,
          Math.floor(
            (Date.parse(snapshot.observedAt) - Date.parse(start)) / 1000,
          ),
        ),
      ),
    ],
  ]);
  const measurements = [
    {
      input: "weeklyRemaining",
      value: snapshot.weeklyRemaining,
      start: "WEEKLY_REMAINING_START",
      current: "WEEKLY_REMAINING_CURRENT",
      used: "WEEKLY_PERCENT_USED",
      end: "WEEKLY_REMAINING_END",
    },
    {
      input: "tokensUsed",
      value: snapshot.tokensUsed,
      start: "TOKENS_START",
      current: "TOKENS_CURRENT",
      used: "TOKENS_USED",
      end: "TOKENS_END",
    },
  ];
  for (const measurement of measurements) {
    if (measurement.value === undefined) continue;
    const initial = properties.has(measurement.start)
      ? Number(properties.get(measurement.start))
      : measurement.value;
    const used =
      measurement.input === "tokensUsed"
        ? measurement.value - initial
        : initial - measurement.value;
    updates.set(measurement.start, String(initial));
    updates.set(measurement.current, String(measurement.value));
    updates.set(measurement.used, String(Math.max(0, used)));
    if (operation === "finish")
      updates.set(measurement.end, String(measurement.value));
  }
  if (operation === "finish") updates.set("COMPLETED_AT", snapshot.observedAt);
  return updates;
}

export function measure(path, operation, id, snapshot, options = {}) {
  snapshot = validateSnapshot(operation, snapshot);
  const plan = readPlan(path);
  const item = findItem(plan, id);
  const before = observable(plan, id);
  requireConsumerCapabilities(plan, options);
  if (item.state === "SUSPENDED" || item.parent?.state === "SUSPENDED")
    fail("suspended work cannot be measured");
  const properties = item.properties;
  if (operation === "start" && properties.has("STARTED_AT"))
    fail(`${id} already started`);
  if (operation !== "start" && !properties.has("STARTED_AT"))
    fail(`${id} has not started`);

  const updates = measurementUpdates(operation, properties, snapshot);
  const body = plan.lines
    .slice(item.ds + 1, item.de)
    .filter(
      (line) =>
        !MEASURED_PROPERTIES.includes((/^:([A-Z_]+):/.exec(line) ?? [])[1]),
    );
  for (const key of MEASURED_PROPERTIES) {
    if (updates.has(key)) body.push(`:${key}: ${updates.get(key)}`);
  }
  plan.lines.splice(item.ds + 1, item.de - item.ds - 1, ...body);

  const result = writePlan(path, plan, `measure:${operation}:${id}`, options);
  return {
    plan: { path: result.plan.path, fingerprint: result.plan.fingerprint },
    id,
    operation,
    before,
    after: observable(result.plan, id),
    projection: projection(result.plan),
    fingerprint: result.plan.fingerprint,
    publication: result.publication,
  };
}

// One atomic candidate preserves completed children and all telemetry. Dedicated
// commands are the only way into/out of SUSPENDED; --force cannot bypass them.
export function suspendReopen(path, dependentId, dependencyId, options = {}) {
  const plan = readPlan(path);
  const dependent = findItem(plan, dependentId);
  const dependency = findItem(plan, dependencyId);
  if (dependent.level !== 1 || dependent.state !== "WIP" ||
      dependency.level !== 1 || dependency.state !== "DONE" ||
      dependency.line >= dependent.line)
    fail("suspend-reopen requires a WIP L1 and an earlier DONE dependency");
  const preceding = plan.items.filter((item) => item.level === 1 && item.line < dependency.line);
  if (preceding.some((item) => item.state !== "DONE" || item.properties.get("REVIEW_STATUS") !== "REVIEWED"))
    fail("earlier dependencies must be DONE + REVIEWED");
  const before = [observable(plan, dependentId), observable(plan, dependencyId)];
  // Insert after heading replacements so original line positions remain valid.
  for (const item of plan.items.filter((item) => item === dependent || item.parent === dependent)) {
    if (item.state === "WIP")
      plan.lines[item.line] = plan.lines[item.line].replace(" WIP ", " SUSPENDED ");
  }
  transitionHeading(plan, dependency, "WIP", false);
  plan.lines.splice(dependent.de, 0, `:SUSPENDED_FOR: ${dependencyId}`);
  const result = writePlan(path, plan, "update", options);
  return suspensionResult(result, before, [dependentId, dependencyId]);
}

export function resume(path, id, options = {}) {
  const plan = readPlan(path);
  requireConsumerCapabilities(plan, options);
  const item = findItem(plan, id);
  if (item.level !== 1 || item.state !== "SUSPENDED") fail("resume requires a suspended L1");
  if (plan.items.some((entry) => entry.level === 1 && entry.line < item.line &&
      (entry.state !== "DONE" || entry.properties.get("REVIEW_STATUS") !== "REVIEWED")))
    fail("resume requires every earlier L1 DONE + REVIEWED");
  const before = [observable(plan, id)];
  for (const entry of plan.items.filter((entry) => entry === item || entry.parent === item)) {
    if (entry.state === "SUSPENDED")
      plan.lines[entry.line] = plan.lines[entry.line].replace(" SUSPENDED ", " WIP ");
  }
  const propertyLine = plan.lines.findIndex((line, index) => index > item.ds && index < item.de && line.startsWith(":SUSPENDED_FOR:"));
  plan.lines.splice(propertyLine, 1);
  const result = writePlan(path, plan, "update", options);
  return suspensionResult(result, before, [id]);
}

function suspensionResult(result, before, ids) {
  return {
    plan: { path: result.plan.path, fingerprint: result.plan.fingerprint },
    before,
    after: ids.map((id) => observable(result.plan, id)),
    projection: projection(result.plan),
    fingerprint: result.plan.fingerprint,
    publication: result.publication,
  };
}
