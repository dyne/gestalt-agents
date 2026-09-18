#!/usr/bin/env node
import {
  describe,
  measure,
  mutate,
  next,
  projection,
  publishStatus,
  readPlan,
  summary,
} from "./org-plan-core.mjs";

const COMMANDS = [
  "validate",
  "next",
  "summary",
  "status",
  "describe",
  "projection",
  "review",
  "l2",
  "measure",
  "set",
  "signal",
  "supervision-start",
  "prepare-executor",
  "prepare-supervision",
];
const HELP = {
  validate: "usage: org-plan validate PLAN",
  next: "usage: org-plan next PLAN {l1|l2|review}",
  summary: "usage: org-plan summary PLAN",
  status: "usage: org-plan status PLAN",
  describe: "usage: org-plan describe PLAN ID",
  projection: "usage: org-plan projection PLAN",
  review: "usage: org-plan review PLAN L1_ID {REVIEWED|UNREVIEWED}",
  l2: "usage: org-plan l2 PLAN L2_ID {WIP|DONE}",
  measure:
    "usage: org-plan measure {start|checkpoint|finish} PLAN ID SNAPSHOT_JSON",
  set: "usage: org-plan set PLAN L1_ID {TODO|WIP|DONE} [--force]",
  signal: "usage: org-plan signal PLAN [REASON]",
  "supervision-start": "usage: org-plan supervision-start PLAN",
};

function usage() {
  console.error(
    `usage: org-plan COMMAND [args]\ncommands: ${COMMANDS.join("|")}`,
  );
  process.exit(2);
}

function warnOnPublicationFailure(result) {
  if (result.publication.attempted && !result.publication.published) {
    console.error(
      `warning: plan status not published: ${result.publication.warning}`,
    );
  }
}

function runMutation(...args) {
  const result = mutate(...args);
  warnOnPublicationFailure(result);
  return result;
}

function runMeasurement(...args) {
  const result = measure(...args);
  warnOnPublicationFailure(result);
  return result;
}

function printSummary(plan) {
  const planSummary = summary(plan);
  for (const state of ["TODO", "WIP", "DONE"]) {
    console.log(`L1 ${state}=${planSummary.l1[state]}`);
  }
  for (const state of ["TODO", "WIP", "DONE"]) {
    console.log(`L2 ${state}=${planSummary.l2[state]}`);
  }
  const current = next(plan, "l1");
  if (current)
    console.log(`current  ${current.id} [#${current.state}] ${current.title}`);
  for (const state of ["REVIEWED", "UNREVIEWED"]) {
    console.log(`L1 ${state}=${planSummary.review[state]}`);
  }
}

function describeItem(path, id) {
  const item = describe(readPlan(path), id);
  console.log(
    item.skills
      ? `${item.position} ${item.title}\nGoal: ${item.goal}\nSkills: ${item.skills}`
      : `L2 ${item.title}\nWhy: ${item.goal}`,
  );
}

function findL2(path, pattern) {
  const plan = readPlan(path);
  const expression = new RegExp(pattern);
  const blocks = plan.items.filter(
    (item) =>
      item.level === 2 &&
      expression.test(plan.lines.slice(item.line, item.end).join("\n")),
  );
  if (!blocks.length) throw new Error("no matching L2 blocks");
  console.log(
    blocks
      .map((item) => plan.lines.slice(item.line, item.end).join("\n"))
      .join("\n"),
  );
}

function publishSignal(command, args) {
  if (!args[0] || args.length > 2) usage();
  readPlan(args[0]);
  const reason =
    command === "supervision-start"
      ? "supervision-start"
      : (args[1] ?? "signal");
  const publication = publishStatus(args[0], reason, {
    preserveExisting: reason === "supervision-start",
  });
  if (publication.attempted && !publication.published)
    throw new Error(publication.warning);
  const outcome = publication.changed === false ? "retained" : "published";
  console.log(`signal=${outcome} plan=${readPlan(args[0]).path} reason=${reason}`);
}

function run(command, args) {
  if (command === "validate") {
    if (args.length !== 1) usage();
    readPlan(args[0]);
  } else if (command === "next") {
    if (args.length !== 2) usage();
    const item = next(readPlan(args[0]), args[1]);
    if (!item) process.exit(1);
    console.log(` ${item.id} [#${item.state}] ${item.title}`);
  } else if (command === "summary" || command === "status") {
    if (args.length !== 1) usage();
    printSummary(readPlan(args[0]));
  } else if (command === "describe") {
    if (args.length !== 2) usage();
    describeItem(args[0], args[1]);
  } else if (command === "projection") {
    if (args.length !== 1) usage();
    console.log(JSON.stringify(projection(readPlan(args[0]))));
  } else if (command === "review") {
    if (args.length !== 3 || !["REVIEWED", "UNREVIEWED"].includes(args[2]))
      usage();
    runMutation(args[0], "review", args[1], args[2]);
  } else if (command === "l2") {
    if (args.length === 2) findL2(args[0], args[1]);
    else if (args.length === 3) runMutation(args[0], "l2", args[1], args[2]);
    else usage();
  } else if (command === "set") {
    if (args.length < 3 || args.length > 4) usage();
    runMutation(args[0], "set", args[1], args[2], {
      force: args[3] === "--force",
    });
  } else if (command === "measure") {
    if (args.length !== 4) usage();
    runMeasurement(args[1], args[0], args[2], JSON.parse(args[3]));
  } else if (command === "signal" || command === "supervision-start") {
    publishSignal(command, args);
  } else {
    usage();
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) usage();
if (command === "--help" || command === "-h") {
  console.log(
    `usage: org-plan COMMAND [args]\ncommands: ${COMMANDS.join("|")}`,
  );
  process.exit(0);
}
if (args.length === 1 && /^--?help$/.test(args[0])) {
  if (!HELP[command]) usage();
  console.log(HELP[command]);
  process.exit(0);
}

try {
  run(command, args);
} catch (error) {
  console.error(
    `${args[0] ?? "org-plan"}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
