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
import { publishStatus } from "./org-plan-publication.mjs";

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

function writePlan(path, plan, reason) {
  const text = plan.lines.join("\n");
  parsePlan(text);
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
    publication: publishStatus(canonicalPath, reason),
  };
}

function transitionHeading(plan, item, state, force) {
  if (!["TODO", "WIP", "DONE"].includes(state)) {
    fail(`invalid transition ${item.state} -> ${state}`);
  }
  const isForwardTransition =
    (item.state === "TODO" && state === "WIP") ||
    (item.state === "WIP" && state === "DONE");
  if (!force && !isForwardTransition) {
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

export function mutate(path, operation, id, state, { force = false } = {}) {
  const plan = readPlan(path);
  const item = findItem(plan, id);
  const before = observable(plan, id);
  if (operation === "review") {
    transitionReview(plan, item, id, state);
  } else {
    const expectedLevel =
      operation === "l1" ? 1 : operation === "l2" ? 2 : null;
    if (expectedLevel !== null && item.level !== expectedLevel) {
      fail(`ID ${id} is not an L${expectedLevel}`);
    }
    transitionHeading(plan, item, state, force);
  }
  const reason = `${operation === "l1" ? "set" : operation}:${id}:${state}`;
  const result = writePlan(path, plan, reason);
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

export function measure(path, operation, id, snapshot) {
  validateSnapshot(operation, snapshot);
  const plan = readPlan(path);
  const item = findItem(plan, id);
  const before = observable(plan, id);
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

  const result = writePlan(path, plan, `measure:${operation}:${id}`);
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
