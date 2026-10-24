import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parsePlan, readPlan, describe, mutate, measure, suspendReopen, resume, publishStatus } from "../../../plugins/gestalt/skills/org-plan/scripts/org-plan-core.mjs";
import { dispatch } from "../../../plugins/gestalt/org-plan-mcp.mjs";
import { createMcpTestClient } from "./mcp-test-client.mjs";

const directory = realpathSync(mkdtempSync(join(tmpdir(), "org-model-schema-")));
const path = join(directory, "plan.org"), status = join(directory, "status.json");
const cli = fileURLToPath(new URL("../../../plugins/gestalt/skills/org-plan/scripts/org-plan-cli.mjs", import.meta.url));
const server = fileURLToPath(new URL("../../../plugins/gestalt/org-plan-mcp.mjs", import.meta.url));
const keys = ["GESTALT_MOBILE_ORG_PLAN_STATUS_FILE", "GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY", "GESTALT_MOBILE_ORG_PLAN_CAPABILITIES"];
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
for (const key of keys) delete process.env[key];
const properties = `:MODEL: gpt-6-luna
:REASONING_EFFORT: medium
:MODEL_RATIONALE: All five scores zero: exact local replacement, no interfaces, reversible and directly tested.
:MODEL_FALLBACKS: gpt-6-sol gpt-6.1-sol
:MODEL_ESCALATION_TRIGGER: Direct check reveals an additional behavioral invariant.
`;
const exception = `:EFFORT_NECESSITY_KIND: unresolved-correctness
:EFFORT_NECESSITY: Focused medium investigation cannot resolve two competing ownership orderings.
:EFFORT_EVIDENCE: Synthetic ownership-17 trace and invariant-3 failure.
:EFFORT_SCOPE: Bounded ownership proof.
:RETURN_TO_MEDIUM: Ordering proven and invariant-3 regression passes.
`;
const header = `#+TITLE: Schema
#+SUBTITLE: Disposable test
#+DATE: 2026-10-21
#+KEYWORDS: test
`;
const child = (id, state = "TODO", extra = "") => `** ${state} [#A] ${id}
:PROPERTIES:
:ID: ${id}
${extra}:END:
- Why :: Needed
- Change :: Edit
- Tests :: Direct
- Done when :: Pass
`;
const milestone = (id, state = "TODO", review = "UNREVIEWED", policy = properties, children = child(`${id}-child`)) => `* ${state} [#A] ${id}
:PROPERTIES:
:ID: ${id}
:SKILLS: $make
:REVIEW_STATUS: ${review}
${policy}:END:
- Effort :: Existing prose retained
- Goal :: Test
- Notes :: Preserve
${children}`;
const source = header + "#+MODEL_POLICY_VERSION: 1\n" + milestone("first");
const legacy = header + milestone("first", "TODO", "UNREVIEWED", "");
const write = (text = source) => writeFileSync(path, text);
const cliRun = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
let passed = 0;
async function check(name, action) {
  try { await action(); passed += 1; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
const unchangedOnFailure = (action, pattern) => {
  const before = readFileSync(path), previousStatus = existsSync(status) ? readFileSync(status) : null;
  const files = readdirSync(directory).sort();
  assert.throws(action, pattern);
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(existsSync(status) ? readFileSync(status) : null, previousStatus);
  assert.deepEqual(readdirSync(directory).sort(), files);
};
try {
  await check("assurance migration retains v1 bytes and explicit strict selection", () => {
    write();
    assert.equal(readPlan(path).modelPolicyAssurance, "configured");
    assert.equal(readFileSync(path, "utf8"), source);
    for (const assurance of ["configured", "runtime-attested"]) {
      assert.equal(parsePlan(`#+MODEL_POLICY_ASSURANCE: ${assurance}\n` + source).modelPolicyAssurance, assurance);
    }
    for (const text of [
      "#+MODEL_POLICY_ASSURANCE: invalid\n" + source,
      "#+MODEL_POLICY_ASSURANCE: configured\n#+MODEL_POLICY_ASSURANCE: runtime-attested\n" + source,
      "#+MODEL_POLICY_ASSURANCE: configured\n" + legacy,
      source + "#+MODEL_POLICY_ASSURANCE: configured\n",
      source.replace(":ID: first", ":ID: first\n:MODEL_POLICY_ASSURANCE: configured"),
    ]) assert.throws(() => parsePlan(text), /MODEL_POLICY_ASSURANCE/);
  });
  await check("legacy no silent default or rewrite", () => {
    write(legacy);
    assert.equal(readPlan(path).modelPolicyVersion, null);
    assert.equal(describe(readPlan(path), "first").modelPolicy, undefined);
    assert.equal(cliRun("validate", path).status, 0);
    assert.equal(readFileSync(path, "utf8"), legacy);
    mutate(path, "l1", "first", "WIP");
    assert.equal(readFileSync(path, "utf8"), legacy.replace("* TODO", "* WIP"));
  });
  await check("new version explicit choices roundtrip", () => {
    write();
    const policy = describe(readPlan(path), "first").modelPolicy;
    assert.equal(policy.version, 1);
    assert.equal(policy.model, "gpt-6-luna");
    assert.equal(policy.reasoningEffort, "medium");
    assert.deepEqual(policy.allowedFallbacks, ["gpt-6-sol", "gpt-6.1-sol"]);
    assert.equal(cliRun("validate", path).status, 0);
    const command = cliRun("describe", path, "first");
    assert.equal(command.status, 0);
    assert.match(command.stdout, /Model policy:.*gpt-6-luna.*medium/);
    assert.equal(cliRun("set", path, "first", "WIP").status, 0);
    assert.equal(readPlan(path).items[0].properties.get("MODEL"), "gpt-6-luna");
    assert.equal(readFileSync(path, "utf8"), source.replace("* TODO", "* WIP"));
  });
  await check("every new-version required field enforced before writes", () => {
    for (const key of ["MODEL", "REASONING_EFFORT", "MODEL_RATIONALE", "MODEL_FALLBACKS", "MODEL_ESCALATION_TRIGGER"]) {
      write(source.replace(new RegExp(`^:${key}:.*\\n`, "m"), ""));
      unchangedOnFailure(() => mutate(path, "l1", "first", "WIP"), new RegExp(`missing ${key}`));
    }
  });
  await check("unversioned policy cannot be silently ignored", () => {
    assert.throws(() => parsePlan(source.replace("#+MODEL_POLICY_VERSION: 1\n", "")), /require MODEL_POLICY_VERSION/);
  });
  await check("version negotiation is exact and document-only", () => {
    for (const value of ["0", "2", "01", "1.0", "", "1 "]) {
      assert.throws(() => parsePlan(source.replace("#+MODEL_POLICY_VERSION: 1", `#+MODEL_POLICY_VERSION: ${value}`)), /MODEL_POLICY_VERSION/);
    }
    assert.throws(() => parsePlan(source + "#+MODEL_POLICY_VERSION: 1\n"), /at most once/);
    assert.throws(() => parsePlan(source.replace("#+MODEL_POLICY_VERSION: 1\n", "") + "#+MODEL_POLICY_VERSION: 1\n"), /before headings/);
    assert.throws(() => parsePlan(source.replace(":MODEL: ", ":MODEL_POLICY_VERSION: 1\n:MODEL: ")), /document metadata/);
  });
  await check("duplicate properties rejected", () => {
    for (const key of ["MODEL", "REASONING_EFFORT", "MODEL_RATIONALE", "MODEL_FALLBACKS", "MODEL_ESCALATION_TRIGGER", "EFFORT_NECESSITY"]) {
      assert.throws(() => parsePlan(source.replace(":MODEL: ", `:${key}: duplicate\n:${key}: duplicate\n:MODEL: `)), new RegExp(`duplicate ${key}`));
    }
  });
  await check("all L2 model overrides rejected in parse and read", () => {
    for (const key of ["MODEL", "REASONING_EFFORT", "MODEL_RATIONALE", "MODEL_FALLBACKS", "MODEL_ESCALATION_TRIGGER", "EFFORT_NECESSITY", "RETURN_TO_MEDIUM"]) {
      const invalid = source.replace(":ID: first-child\n", `:ID: first-child\n:${key}: forbidden\n`);
      assert.throws(() => parsePlan(invalid), /L1-only model/);
      write(invalid);
      assert.throws(() => readPlan(path), /L1-only model/);
    }
  });
  await check("exact IDs and effort values reject Astra/aliases", () => {
    for (const model of ["gpt-6-astra", "gpt-6", "gpt-6.1", "luna", "kimi"]) {
      assert.throws(() => parsePlan(source.replace(":MODEL: gpt-6-luna", `:MODEL: ${model}`)), /invalid MODEL/);
    }
    for (const effort of ["low", "max", "ultra", "HIGH"]) assert.throws(() => parsePlan(source.replace(":REASONING_EFFORT: medium", `:REASONING_EFFORT: ${effort}`)), /invalid REASONING_EFFORT/);
  });
  await check("fallback list exact, distinct and explicit", () => {
    for (const fallback of ["gpt-6-astra", "gpt-6-sol  gpt-6.1-sol", "gpt-6-sol gpt-6-sol", "gpt-6-luna", "none gpt-6-sol"]) {
      assert.throws(() => parsePlan(source.replace(":MODEL_FALLBACKS: gpt-6-sol gpt-6.1-sol", `:MODEL_FALLBACKS: ${fallback}`)), /invalid MODEL_FALLBACKS/);
    }
    assert.deepEqual(parsePlan(source.replace(":MODEL_FALLBACKS: gpt-6-sol gpt-6.1-sol", ":MODEL_FALLBACKS: none")).items[0].modelPolicy.allowedFallbacks, []);
  });
  await check("high requires concrete additional necessity", () => {
    const high = source.replace(":REASONING_EFFORT: medium", ":REASONING_EFFORT: high");
    assert.throws(() => parsePlan(high), /concrete necessity/);
    const valid = high.replace(":MODEL: ", exception + ":MODEL: ");
    assert.equal(parsePlan(valid).items[0].modelPolicy.necessity.returnToMedium, "Ordering proven and invariant-3 regression passes.");
    for (const key of ["EFFORT_NECESSITY_KIND", "EFFORT_NECESSITY", "EFFORT_EVIDENCE", "EFFORT_SCOPE", "RETURN_TO_MEDIUM"]) {
      assert.throws(() => parsePlan(valid.replace(new RegExp(`^:${key}:.*\\n`, "m"), "")), /concrete necessity/);
    }
    assert.throws(() => parsePlan(valid.replace("unresolved-correctness", "complexity")), /concrete necessity/);
    assert.throws(() => parsePlan(valid.replace(":REASONING_EFFORT: high", ":REASONING_EFFORT: xhigh")), /concrete necessity/);
    assert.equal(parsePlan(valid.replace(":REASONING_EFFORT: high", ":REASONING_EFFORT: xhigh").replace(":MODEL: ", ":SCOPE_REASSESSMENT: Invariant cannot be independently split.\n:MODEL: ")).items[0].modelPolicy.reasoningEffort, "xhigh");
    assert.throws(() => parsePlan(source.replace(":MODEL: ", exception + ":MODEL: ")), /medium must not carry/);
  });
  await check("property sizes use UTF8 bytes and describe is bounded", () => {
    const long = source.replace(/:MODEL_RATIONALE:.*\n/, `:MODEL_RATIONALE: ${"界".repeat(341)}\n`).replace(/:MODEL_ESCALATION_TRIGGER:.*\n/, `:MODEL_ESCALATION_TRIGGER: ${"界".repeat(341)}\n`);
    const item = describe(parsePlan(long), "first");
    assert.ok(Buffer.byteLength(JSON.stringify(item.modelPolicy)) < 800);
    assert.ok(Buffer.byteLength(item.modelPolicy.rationale) <= 160);
    assert.ok(Buffer.byteLength(item.modelPolicy.escalationTrigger) <= 128);
    assert.ok(!JSON.stringify(item).includes("�"));
    assert.match(item.modelPolicy.details, /Full policy/);
    assert.throws(() => parsePlan(long.replace("界".repeat(341), "界".repeat(342))), /1..1024 UTF-8 bytes/);
  });
  await check("all L1s require policy", () => {
    assert.throws(() => parsePlan(source + milestone("second", "TODO", "UNREVIEWED", "")), /second.*missing MODEL/);
  });
  await check("attached legacy consumer cannot mutate any policy plan", () => {
    write(); writeFileSync(status, "existing-status\n");
    process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE = status;
    for (const capabilities of [undefined, "other", "not-l1-model-policy-v1", "suspension-v1"]) {
      if (capabilities === undefined) delete process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;
      else process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES = capabilities;
      unchangedOnFailure(() => mutate(path, "l1", "first", "WIP"), /l1-model-policy-v1/);
      unchangedOnFailure(() => measure(path, "start", "first", { observedAt: "2026-10-21T13:00:00Z" }), /l1-model-policy-v1/);
      assert.match(publishStatus(path, "signal").warning, /l1-model-policy-v1/);
      assert.equal(readFileSync(status, "utf8"), "existing-status\n");
      const command = cliRun("set", path, "first", "WIP");
      assert.equal(command.status, 1);
      assert.equal(readFileSync(path, "utf8"), source);
    }
  });
  await check("compatible publication retains required version", () => {
    process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES = "other,l1-model-policy-v1";
    const result = mutate(path, "l1", "first", "WIP");
    assert.equal(result.publication.published, true);
    const publication = JSON.parse(readFileSync(status, "utf8"));
    assert.equal(publication.schemaVersion, 1);
    assert.equal(publication.modelPolicyVersion, 1);
    assert.deepEqual(publication.requiredCapabilities, ["l1-model-policy-v1"]);
    assert.equal(result.after.modelPolicy.model, "gpt-6-luna");
    assert.equal(readPlan(path).items[0].properties.get("REASONING_EFFORT"), "medium");
  });
  await check("explicit host context replaces ambient assertion", () => {
    write();
    unchangedOnFailure(() => mutate(path, "l1", "first", "WIP", { consumerAttached: true, consumerCapabilities: [] }), /l1-model-policy-v1/);
    unchangedOnFailure(() => mutate(path, "l1", "first", "WIP", { consumerCapabilities: "l1-model-policy-v1" }), /explicit capability array/);
    delete process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE;
    unchangedOnFailure(() => mutate(path, "l1", "first", "WIP", { consumerAttached: true, consumerCapabilities: [] }), /l1-model-policy-v1/);
    assert.equal(mutate(path, "l1", "first", "WIP", { consumerAttached: true, consumerCapabilities: ["l1-model-policy-v1"] }).after.state, "WIP");
  });
  await check("invalid schema leaves existing plan/status unchanged", () => {
    process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE = status;
    write(source.replace(":MODEL: gpt-6-luna", ":MODEL: gpt-6-astra"));
    unchangedOnFailure(() => mutate(path, "l1", "first", "WIP"), /invalid MODEL/);
    assert.equal(cliRun("signal", path).status, 1);
    delete process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE;
  });
  await check("legacy publications preserve shape without asserting policy", () => {
    write(legacy);
    process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE = status;
    delete process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;
    assert.equal(publishStatus(path, "legacy").published, true);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(status, "utf8"))).sort(), ["planPath", "reason", "schemaVersion", "updatedAt"]);
    delete process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE;
  });
  await check("suspend/reopen/resume preserves every policy property and measurement", () => {
    const two = header + "#+MODEL_POLICY_VERSION: 1\n" + milestone("dependency", "DONE", "REVIEWED", properties, child("dependency-child", "DONE")) + milestone("dependent", "WIP", "UNREVIEWED", properties, child("dependent-child", "WIP"));
    write(two);
    const baseline = readPlan(path).items.filter((item) => item.level === 1).map((item) => item.modelPolicy);
    process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE = status;
    process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES = "l1-model-policy-v1";
    unchangedOnFailure(() => suspendReopen(path, "dependent", "dependency"), /suspension-v1/);
    process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES = "l1-model-policy-v1,suspension-v1";
    suspendReopen(path, "dependent", "dependency");
    mutate(path, "l1", "dependency", "DONE"); mutate(path, "review", "dependency", "REVIEWED");
    resume(path, "dependent");
    assert.deepEqual(readPlan(path).items.filter((item) => item.level === 1).map((item) => item.modelPolicy), baseline);
    assert.equal(readFileSync(path, "utf8"), two);
    delete process.env.GESTALT_MOBILE_ORG_PLAN_STATUS_FILE;
    delete process.env.GESTALT_MOBILE_ORG_PLAN_CAPABILITIES;
    measure(path, "start", "dependent", { observedAt: "2026-10-21T13:00:00Z" });
    assert.deepEqual(readPlan(path).items.filter((item) => item.level === 1).map((item) => item.modelPolicy), baseline);
  });
  await check("MCP embedded describe/mutation and capability input boundary", () => {
    write();
    const call = (name, args, context) => dispatch("tools/call", { name, arguments: { plan: path, ...args } }, context);
    const described = call("org_plan_describe", { id: "first" });
    assert.equal(described.structuredContent.item.modelPolicy.reasoningEffort, "medium");
    assert.equal(call("org_plan_l1_transition", { id: "first", state: "WIP" }, { consumerAttached: true, consumerCapabilities: [] }).isError, true);
    assert.equal(readFileSync(path, "utf8"), source);
    assert.equal(call("org_plan_l1_transition", { id: "first", state: "WIP" }, { consumerAttached: true, consumerCapabilities: ["l1-model-policy-v1"] }).structuredContent.after.modelPolicy.model, "gpt-6-luna");
    assert.throws(() => call("org_plan_describe", { id: "first", consumerCapabilities: ["l1-model-policy-v1"] }), /does not allow/);
  });
  await check("packaged stdio MCP roundtrip uses trusted capability channel", async () => {
    for (const capability of [undefined, "l1-model-policy-v1"]) {
      write();
      const child = spawn(process.execPath, [server], { env: { PATH: process.env.PATH, HOME: directory, GESTALT_MOBILE_ORG_PLAN_STATUS_FILE: status, ...(capability ? { GESTALT_MOBILE_ORG_PLAN_CAPABILITIES: capability } : {}) }, stdio: ["pipe", "pipe", "pipe"] });
      child.stderr.resume();
      const closed = new Promise((resolve) => child.once("close", resolve));
      const client = createMcpTestClient(child);
      try {
        const reply = await client.request(1, "tools/call", { name: "org_plan_describe", arguments: { plan: path, id: "first" } });
        assert.equal(reply.result.structuredContent.item.modelPolicy.model, "gpt-6-luna");
        const mutation = await client.request(2, "tools/call", { name: "org_plan_l1_transition", arguments: { plan: path, id: "first", state: "WIP" } });
        assert.equal(mutation.result.isError === true, !capability);
        assert.equal(readFileSync(path, "utf8"), capability ? source.replace("* TODO", "* WIP") : source);
      } finally { child.stdin.end(); child.kill("SIGTERM"); await closed; }
    }
  });
  console.log(`Model schema: ${passed} passed, 0 failed, 0 skipped, ${passed} total (CLI, embedded/stdio MCP, atomic compatibility and preservation)`);
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(directory, { recursive: true, force: true });
}
