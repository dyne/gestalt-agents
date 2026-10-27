import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fail, resolvePlanPath } from "./org-plan-files.mjs";
import { parseModelPolicy, describeModelPolicy } from "./org-plan-model-schema.mjs";

const HEADING = /^(\*{1,2}) (TODO|WIP|DONE|SUSPENDED) \[#([ABC])\] (.+)$/;
const REQUIRED_METADATA = ["TITLE", "SUBTITLE", "DATE", "KEYWORDS"];
const STATES = ["TODO", "WIP", "DONE", "SUSPENDED"];
const REVIEW_STATES = ["REVIEWED", "UNREVIEWED"];

function fingerprint(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function parseHeadings(lines, metadata) {
  const items = [];
  let current;
  let lastL1;

  for (let index = 0; index < lines.length; index += 1) {
    const metadataMatch = /^#\+([A-Z_]+):/.exec(lines[index]);
    if (metadataMatch) {
      const key = metadataMatch[1];
      metadata.set(key, (metadata.get(key) ?? 0) + 1);
    }

    const headingMatch = HEADING.exec(lines[index]);
    if (headingMatch) {
      if (current) current.end = index;
      current = {
        line: index,
        end: lines.length,
        level: headingMatch[1].length,
        state: headingMatch[2],
        priority: headingMatch[3],
        title: headingMatch[4],
        fields: new Map(),
        properties: new Map(),
        parent: null,
      };
      if (current.level === 1) {
        lastL1 = current;
      } else if (lastL1) {
        current.parent = lastL1;
      } else {
        fail(`line ${index + 1}: L2 without L1`);
      }
      items.push(current);
      continue;
    }

    if (/^\*+/.test(lines[index])) {
      fail(`line ${index + 1}: malformed executable heading`);
    }
  }
  return items;
}

function parseItem(lines, item, ids) {
  let drawerStart = -1;
  let drawerEnd = -1;

  for (let index = item.line + 1; index < item.end; index += 1) {
    if (lines[index] === ":PROPERTIES:") {
      if (drawerStart >= 0)
        fail(`line ${index + 1}: malformed property drawer`);
      drawerStart = index;
      continue;
    }
    if (lines[index] === ":END:") {
      if (drawerStart < 0 || drawerEnd >= 0) {
        fail(`line ${index + 1}: malformed property drawer`);
      }
      drawerEnd = index;
      continue;
    }
    if (drawerStart >= 0 && drawerEnd < 0) {
      const property = /^:([A-Z_]+):\s*(.*)$/.exec(lines[index]);
      if (!property) fail(`line ${index + 1}: malformed property drawer`);
      if (item.properties.has(property[1])) {
        fail(`line ${index + 1}: duplicate ${property[1]}`);
      }
      item.properties.set(property[1], property[2]);
    }
  }

  if (drawerStart < 0 || drawerEnd < 0) {
    fail(`line ${item.line + 1}: missing property drawer`);
  }
  item.ds = drawerStart;
  item.de = drawerEnd;

  for (let index = drawerEnd + 1; index < item.end; index += 1) {
    if (/^\s*-\s+Managed MCP\b/i.test(lines[index]) &&
        lines[index] !== "- Managed MCP :: playwright") {
      fail(`line ${index + 1}: Managed MCP must be exactly - Managed MCP :: playwright`);
    }
    const field = /^- ([^:]+) ::\s*(.*)$/.exec(lines[index]);
    if (field) {
      if (field[1] === "Managed MCP" && item.fields.has(field[1]))
        fail(`line ${index + 1}: duplicate Managed MCP`);
      item.fields.set(field[1], field[2]);
    }
  }

  item.id = item.properties.get("ID");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id ?? "")) {
    fail(`line ${item.line + 1}: missing or invalid ID`);
  }
  if (ids.has(item.id)) fail(`line ${item.line + 1}: duplicate ID ${item.id}`);
  ids.add(item.id);

  if (item.level === 1) {
    validateL1(item);
  } else {
    validateL2(item);
  }
}

function validateL1(item) {
  const skills = item.properties.get("SKILLS");
  const review = item.properties.get("REVIEW_STATUS");
  if (
    !/^\$[A-Za-z0-9][A-Za-z0-9._:-]*( \$[A-Za-z0-9][A-Za-z0-9._:-]*)*$/.test(
      skills ?? "",
    )
  ) {
    fail(`line ${item.line + 1} (${item.id}): missing or invalid SKILLS`);
  }
  const declaredSkills = skills.split(" ");
  if (new Set(declaredSkills).size !== declaredSkills.length) {
    fail(`line ${item.line + 1} (${item.id}): duplicate skill reference`);
  }
  if (!REVIEW_STATES.includes(review)) {
    fail(
      `line ${item.line + 1} (${item.id}): missing or invalid REVIEW_STATUS`,
    );
  }
  for (const field of ["Effort", "Goal", "Notes"]) {
    if (!item.fields.has(field)) {
      fail(`line ${item.line + 1} (${item.id}): missing field ${field}`);
    }
  }
}

function validateL2(item) {
  if (item.fields.has("Managed MCP"))
    fail(`line ${item.line + 1} (${item.id}): Managed MCP is L1-only`);
  for (const field of ["Why", "Change", "Tests", "Done when"]) {
    if (!item.fields.has(field)) {
      fail(`line ${item.line + 1} (${item.id}): missing field ${field}`);
    }
  }
}

function validateLifecycle(items) {
  const milestones = items.filter((item) => item.level === 1);
  const suspended = milestones.filter((item) => item.state === "SUSPENDED");
  for (const item of items) {
    const dependency = item.properties.get("SUSPENDED_FOR");
    if (item.level === 1 && item.state === "SUSPENDED") {
      const dependencyIndex = milestones.findIndex((entry) => entry.id === dependency);
      if (dependencyIndex < 0 || dependencyIndex >= milestones.indexOf(item))
        fail("suspension requires an earlier L1 dependency");
      if (item.properties.get("REVIEW_STATUS") !== "UNREVIEWED")
        fail("suspended L1 must be UNREVIEWED");
    } else if (dependency !== undefined) {
      fail("SUSPENDED_FOR is only valid on a suspended L1");
    }
    if (item.level === 2 && item.state === "SUSPENDED" && item.parent.state !== "SUSPENDED")
      fail("suspended child outside suspended L1");
    if (item.parent?.state === "SUSPENDED" && item.state === "WIP")
      fail("WIP child inside suspended L1");
  }
  // Ordered earlier-only edges exclude cycles. Requiring every outer frame to
  // target the immediately inner suspended frame excludes forks/disconnected
  // stacks while allowing the innermost dependency to finish review before resume.
  for (let index = 1; index < suspended.length; index += 1) {
    if (suspended[index].properties.get("SUSPENDED_FOR") !== suspended[index - 1].id)
      fail("suspended L1s must form one nested dependency chain");
  }
  for (const parent of suspended) {
    if (items.filter((item) => item.parent === parent && item.state === "SUSPENDED").length > 1)
      fail("multiple suspended L2s inside one L1");
  }
  if (suspended.length && milestones.some((item) =>
    item.state === "WIP" && milestones.indexOf(item) >= milestones.indexOf(suspended[0])))
    fail("active work must precede suspended L1");
  if (
    items.filter((item) => item.level === 1 && item.state === "WIP").length > 1
  ) {
    fail("multiple WIP L1s");
  }
  if (
    items.filter((item) => item.level === 2 && item.state === "WIP").length > 1
  ) {
    fail("multiple WIP L2s");
  }
  for (const item of items.filter((candidate) => candidate.level === 2)) {
    if (!item.parent) fail(`line ${item.line + 1}: L2 without L1`);
    if (item.parent.state === "TODO" && item.state !== "TODO") {
      fail(`line ${item.line + 1} (${item.id}): active child outside WIP L1`);
    }
    if (item.parent.state === "DONE" && item.state !== "DONE") {
      fail(
        `line ${item.line + 1} (${item.id}): unfinished child of DONE parent`,
      );
    }
  }
}

export function parsePlan(text) {
  const lines = text.split("\n");
  const metadata = new Map();
  const items = parseHeadings(lines, metadata);

  for (const key of REQUIRED_METADATA) {
    if (metadata.get(key) !== 1)
      fail(`metadata ${key} must appear exactly once`);
  }
  if (!items.length) fail("no executable headings");

  const versions = lines.map((line, index) => ({ line, index }))
    .filter(({ line }) => /^#\+MODEL_POLICY_VERSION:/i.test(line));
  if (versions.length > 1) fail("metadata MODEL_POLICY_VERSION must appear at most once");
  const modelPolicyVersion = versions.length ? 1 : null;
  if (versions.length && (versions[0].index >= items[0].line ||
      versions[0].line !== "#+MODEL_POLICY_VERSION: 1")) {
    fail("MODEL_POLICY_VERSION must be exactly 1 in document metadata before headings");
  }

  const assurances = lines.map((line, index) => ({ line, index }))
    .filter(({ line }) => /^#\+MODEL_POLICY_ASSURANCE:/i.test(line));
  if (assurances.length > 1 || assurances.some(({ line, index }) =>
      modelPolicyVersion === null || index >= items[0].line ||
      !/^#\+MODEL_POLICY_ASSURANCE: (configured|runtime-attested)$/.test(line))) {
    fail("MODEL_POLICY_ASSURANCE requires version 1 and exactly configured or runtime-attested before headings");
  }
  const modelPolicyAssurance = modelPolicyVersion === null ? null
    : assurances[0]?.line.split(": ")[1] ?? "configured";
  const ids = new Set();
  for (const item of items) {
    parseItem(lines, item, ids);
    item.modelPolicy = parseModelPolicy(item, modelPolicyVersion);
  }
  validateLifecycle(items);
  return { text, lines, items, modelPolicyVersion, modelPolicyAssurance, fingerprint: fingerprint(text) };
}

export function readPlan(path) {
  const canonicalPath = resolvePlanPath(path);
  const plan = parsePlan(readFileSync(canonicalPath, "utf8"));
  for (const item of plan.items) {
    if (
      item.level === 2 &&
      (item.properties.has("SKILLS") || item.properties.has("REVIEW_STATUS"))
    ) {
      fail(`line ${item.line + 1} (${item.id}): L1-only property`);
    }
  }
  return { ...plan, path: canonicalPath };
}

export function findItem(plan, id) {
  const item = plan.items.find((candidate) => candidate.id === id);
  if (!item) fail(`unknown ID ${id}`);
  return item;
}

function l1Items(plan) {
  return plan.items.filter((item) => item.level === 1);
}

export function describe(plan, id) {
  const item = findItem(plan, id);
  const milestones = l1Items(plan);
  return {
    id,
    position:
      item.level === 1
        ? `L1 ${milestones.indexOf(item) + 1}/${milestones.length}`
        : "L2",
    title: item.title,
    state: item.state,
    goal: item.fields.get(item.level === 1 ? "Goal" : "Why") ?? null,
    ...(item.level === 1 ? { skills: item.properties.get("SKILLS") } : {}),
    ...(item.fields.has("Managed MCP") ? { managedMcp: ["playwright"] } : {}),
    ...(item.modelPolicy ? { modelPolicy: describeModelPolicy(item.modelPolicy) } : {}),
  };
}

export function observable(plan, id) {
  const item = findItem(plan, id);
  return {
    ...describe(plan, id),
    properties: Object.fromEntries(item.properties),
  };
}

export function summary(plan) {
  const count = (level, state) =>
    plan.items.filter((item) => item.level === level && item.state === state)
      .length;
  const milestones = l1Items(plan);
  return {
    l1: Object.fromEntries(STATES.map((state) => [state, count(1, state)])),
    l2: Object.fromEntries(STATES.map((state) => [state, count(2, state)])),
    review: Object.fromEntries(
      REVIEW_STATES.map((state) => [
        state,
        milestones.filter(
          (item) => item.properties.get("REVIEW_STATUS") === state,
        ).length,
      ]),
    ),
    fingerprint: plan.fingerprint,
  };
}

export function next(plan, kind) {
  const milestones = l1Items(plan);
  let candidates;
  if (kind === "review") {
    candidates = milestones.filter(
      (item) =>
        item.state === "DONE" &&
        item.properties.get("REVIEW_STATUS") === "UNREVIEWED",
    );
  } else if (kind === "l1") {
    const suspended = milestones.find((item) => item.state === "SUSPENDED");
    candidates = milestones.filter((item) => ["WIP", "TODO"].includes(item.state) && (!suspended || item.line < suspended.line));
  } else if (kind === "l2") {
    const parent =
      milestones.find((item) => item.state === "WIP") ??
      milestones.find((item) => item.state === "TODO" && (!milestones.some((entry) => entry.state === "SUSPENDED" && entry.line < item.line)));
    candidates = parent
      ? plan.items
          .filter((item) => item.parent === parent && item.state !== "DONE")
          .sort((left, right) =>
            left.state === "WIP"
              ? -1
              : right.state === "WIP"
                ? 1
                : left.line - right.line,
          )
      : [];
  } else {
    fail(`invalid next kind ${kind}`);
  }
  return candidates[0] ? describe(plan, candidates[0].id) : null;
}

export function projection(plan) {
  const milestones = l1Items(plan);
  const active = milestones.filter(
    (item) =>
      item.state === "WIP" ||
      (item.state === "DONE" &&
        item.properties.get("REVIEW_STATUS") === "UNREVIEWED"),
  );
  if (active.length > 1) {
    const details = active
      .map(
        (item) =>
          `L1 ${milestones.indexOf(item) + 1} ${item.id} (${item.state === "DONE" ? "DONE + UNREVIEWED" : item.state})`,
      )
      .join("; ");
    fail(
      `native projection has multiple in_progress L1 items: ${details}; review the earlier DONE + UNREVIEWED L1 before continuing the later WIP L1`,
    );
  }

  const current = active[0];
  const children = current
    ? plan.items.filter((item) => item.parent === current)
    : [];
  const currentChild =
    children.find((item) => item.state === "WIP") ??
    children.find((item) => item.state === "TODO");
  const reviewed = milestones.filter(
    (item) =>
      item.state === "DONE" &&
      item.properties.get("REVIEW_STATUS") === "REVIEWED",
  ).length;
  const explanation = current
    ? `${current.state === "DONE" ? "Awaiting review. " : ""}L1 ${milestones.indexOf(current) + 1}/${milestones.length} — ${current.title}. Goal: ${current.fields.get("Goal")}. ${currentChild ? `${currentChild.state === "WIP" ? "Current" : "Next"} L2 ${children.indexOf(currentChild) + 1}/${children.length}: ${currentChild.title} (${currentChild.state})` : "All L2 milestones complete."}`
    : `No L1 is active. ${reviewed}/${milestones.length} L1 milestones are reviewed. Org state remains authoritative.`;

  return {
    explanation,
    ...(current?.state === "WIP" && current.fields.has("Managed MCP")
      ? { managedMcp: ["playwright"] } : {}),
    plan: milestones.map((item, index) => ({
      step: `L1 ${index + 1}/${milestones.length} — ${item.title}${item.state === "SUSPENDED" ? " (SUSPENDED)" : ""}`,
      status:
        ["TODO", "SUSPENDED"].includes(item.state)
          ? "pending"
          : item.state === "DONE" &&
              item.properties.get("REVIEW_STATUS") === "REVIEWED"
            ? "completed"
            : "in_progress",
    })),
    fingerprint: plan.fingerprint,
  };
}
