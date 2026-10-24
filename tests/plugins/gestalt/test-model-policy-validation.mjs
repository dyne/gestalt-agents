import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readPlan, mutate, suspendReopen, resume } from "../../../plugins/gestalt/skills/org-plan/scripts/org-plan-core.mjs";
import { prepareExecutorLaunch } from "../../../plugins/gestalt/skills/org-plan/scripts/org-plan-executor-launch.mjs";
import { requireExecutorSettings, executionPolicyDigest } from "../../../plugins/gestalt/skills/org-plan/scripts/org-plan-effective-settings.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/model-policy-compatibility.json", import.meta.url), "utf8"));
const packageContract = JSON.parse(readFileSync(new URL("../../../plugins/gestalt/gestalt-supervision-capabilities.json", import.meta.url), "utf8"));
const directory = mkdtempSync(join(tmpdir(), "model-policy-flow-")), path = join(directory, "plan.org");
const helper = fileURLToPath(new URL("../../../plugins/gestalt/skills/org-plan/scripts/org-plan", import.meta.url));
const keys = ["GESTALT_MOBILE_ORG_PLAN_STATUS_FILE", "GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY", "GESTALT_MOBILE_ORG_PLAN_CAPABILITIES"];
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
for (const key of keys) delete process.env[key];
const header = (version = 1) => "#+TITLE: Synthetic policy flow\n#+SUBTITLE: Contract only\n#+DATE: 2026-10-21\n#+KEYWORDS: fixture\n" + (version === null ? "" : `#+MODEL_POLICY_VERSION: ${version}\n`);
const l1 = (id = "simple", state = "TODO", review = "UNREVIEWED", model = "gpt-6-luna", version = 1) => `* ${state} [#A] ${id}
:PROPERTIES:
:ID: ${id}
:SKILLS: $make
:REVIEW_STATUS: ${review}
${version === null ? "" : `:MODEL: ${model}
:REASONING_EFFORT: medium
:MODEL_RATIONALE: All scores zero for the simple fixture; coupled consumer uses its own multi-component rationale.
:MODEL_FALLBACKS: none
:MODEL_ESCALATION_TRIGGER: Direct acceptance test exposes a previously unknown invariant.
`}:END:
- Effort :: Existing prose
- Goal :: Synthetic exact contract
- Notes :: No live launch
** ${state} [#A] ${id}-child
:PROPERTIES:
:ID: ${id}-child
:END:
- Why :: Needed
- Change :: Fixture
- Tests :: Direct
- Done when :: Pass
`;
const policy = (id = "simple") => readPlan(path).items.find((item) => item.id === id).modelPolicy;
let passed = 0;
const check = (name, action) => { try { action(); passed += 1; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } };
try {
  check("ordinary authoring template validates and publishes supervision without model attestation", () => {
    const format = readFileSync(new URL("../../../plugins/gestalt/skills/org-plan/references/plan-format.md", import.meta.url), "utf8");
    const blocks = [...format.matchAll(/```org\n([\s\S]*?)```/g)].map((match) => match[1]);
    const metadata = blocks[0].replace(/^(#\+[A-Z_]+:)$/gm, "$1 Ordinary handoff");
    const drawer = blocks[1].replace("unique-l1-id", "simple").replace("$namespace:skill $other-skill", "$make");
    const body = blocks[2].replace(/ ::$/gm, " :: Exact fixture behavior");
    const source = metadata + `* TODO [#A] Ordinary handoff\n:PROPERTIES:\n${drawer}:END:\n${body}`
      + l1("child").slice(l1("child").indexOf("** TODO"));
    writeFileSync(path, source);
    assert.equal(readPlan(path).modelPolicyVersion, null);
    assert.equal(readPlan(path).items[0].modelPolicy, null);
    const status = join(directory, "ordinary-status.json");
    const env = { ...process.env, GESTALT_MOBILE_ORG_PLAN_STATUS_FILE: status };
    for (const args of [["validate", path], ["signal", path, "authoring-start"], ["supervision-start", path]]) {
      const result = spawnSync(helper, args, { env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const publication = JSON.parse(readFileSync(status, "utf8"));
    assert.equal(publication.reason, "supervision-start");
    assert.equal(publication.modelPolicyVersion, undefined);
    assert.equal(publication.requiredCapabilities, undefined);
    assert.equal(readFileSync(path, "utf8"), source);
    mutate(path, "l1", "simple", "WIP", { consumerAttached: true, consumerCapabilities: [] });
    assert.equal(readPlan(path).items[0].state, "WIP");
  });
  check("package exposes schema/local contracts without claiming runtime enforcement", () => {
    assert.ok(packageContract.capabilities.includes("l1-model-policy-v1"));
    assert.deepEqual(packageContract.modelPolicyContract, { version: 1, scope: "schema-and-local-contracts", runtimeEnforcement: false });
  });
  for (const item of fixture.cases) check(item.id, () => {
    const source = header(item.planVersion) + l1("simple", "TODO", "UNREVIEWED", "gpt-6-luna", item.planVersion);
    writeFileSync(path, source);
    const action = () => mutate(path, "l1", "simple", "WIP", { consumerAttached: true, consumerCapabilities: item.consumerCapabilities });
    if (item.allowed) {
      const result = action(); assert.equal(result.after.state, "WIP");
      assert.equal(readFileSync(path, "utf8"), source.replace("* TODO", "* WIP"));
      if (item.planVersion === null) assert.equal(result.after.modelPolicy, undefined);
      else assert.equal(result.after.modelPolicy.reasoningEffort, "medium");
    } else {
      assert.throws(action, /l1-model-policy-v1/);
      assert.equal(readFileSync(path, "utf8"), source);
    }
  });
  check("new authoring assignment launch compaction follow-up and resume retain medium", () => {
    writeFileSync(path, header() + l1());
    const initial = policy(), packet = JSON.parse(JSON.stringify(initial));
    assert.equal(initial.reasoningEffort, "medium");
    const profiles = join(directory, "agents");
    const setup = spawnSync(helper, ["prepare-executor", "--agents-dir", profiles], { encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stderr);
    const parsed = spawnSync("python3", ["-c", "import json,tomllib,sys;print(json.dumps(tomllib.load(open(sys.argv[1],'rb'))))", join(profiles, "org-plan-executor.toml")], { encoding: "utf8" });
    assert.equal(parsed.status, 0, parsed.stderr);
    const profile = JSON.parse(parsed.stdout);
    const launch = prepareExecutorLaunch({ position: 1, policy: packet, profile,
      assignment: `Synthetic complete assignment; policy packet ${JSON.stringify(packet)}`,
      permissions: { sandboxMode: "workspace-write", approvalPolicy: "never" },
      host: { source: "host-tool-schema", revision: "synthetic", forkTurnsNone: true,
        defaultAgent: { modelOverride: true, reasoningEffortOverride: true, inheritsSandbox: true, inheritsApprovalPolicy: true } } });
    assert.equal(launch.spawnArguments.model, "gpt-6-luna"); assert.equal(launch.spawnArguments.reasoning_effort, "medium");
    mutate(path, "l1", "simple", "WIP");
    assert.deepEqual(policy(), packet);
    const binding = { l1Id: "simple", position: 1, threadId: "fixture-child", executionEpoch: "launch-1", settingsRevision: "settings-1" };
    const catalog = { source: "runtime", revision: "fixture-catalog", models: [{ id: "gpt-6-luna", reasoningEfforts: ["medium"] }] };
    const runtime = { ...binding, source: "runtime-thread-metadata", policyDigest: executionPolicyDigest(packet), model: launch.spawnArguments.model,
      reasoningEffort: launch.spawnArguments.reasoning_effort, catalogRevision: catalog.revision, observedAt: "2026-10-21T10:00:00Z" };
    assert.equal(requireExecutorSettings({ binding, catalog, runtime, policy: policy() }).effective.reasoningEffort, "medium");
    binding.executionEpoch = "resume-2";
    assert.throws(() => requireExecutorSettings({ binding, catalog, runtime, policy: policy() }), /BINDING_MISMATCH/);
    runtime.executionEpoch = "resume-2"; runtime.observedAt = "2026-10-21T11:00:00Z";
    assert.equal(requireExecutorSettings({ binding, catalog, runtime, policy: policy() }).requested.reasoningEffort, "medium");
  });
  check("rejected review preserves the same exact policy without automatic high", () => {
    const before = structuredClone(policy());
    mutate(path, "l2", "simple-child", "WIP"); mutate(path, "l2", "simple-child", "DONE"); mutate(path, "l1", "simple", "DONE");
    assert.equal(readPlan(path).items[0].properties.get("REVIEW_STATUS"), "UNREVIEWED");
    assert.deepEqual(policy(), before);
  });
  check("dependency reopen preserves separate model choices and medium defaults", () => {
    const source = header() + l1("dependency", "DONE", "REVIEWED") + l1("dependent", "WIP", "UNREVIEWED", "gpt-6.1-sol");
    writeFileSync(path, source);
    const before = [policy("dependency"), policy("dependent")];
    suspendReopen(path, "dependent", "dependency");
    assert.deepEqual([policy("dependency"), policy("dependent")], before);
    mutate(path, "l1", "dependency", "DONE"); mutate(path, "review", "dependency", "REVIEWED"); resume(path, "dependent");
    assert.deepEqual([policy("dependency"), policy("dependent")], before);
    assert.equal(readFileSync(path, "utf8"), source);
  });
  check("higher effort without necessity and future schema fail before changes", () => {
    for (const source of [header() + l1().replace(":REASONING_EFFORT: medium", ":REASONING_EFFORT: high"), header(2) + l1()]) {
      writeFileSync(path, source); assert.throws(() => mutate(path, "l1", "simple", "WIP"), /necessity|MODEL_POLICY_VERSION/);
      assert.equal(readFileSync(path, "utf8"), source);
    }
  });
  console.log(`Model policy integration: ${passed} passed, 0 failed, 0 skipped, ${passed} total (synthetic peers/receipts; no live enforcement claim)`);
} finally {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(directory, { recursive: true, force: true });
}
