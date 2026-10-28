import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareExecutorLaunch } from "../../../plugins/gestalt/skills/org-plan/scripts/org-plan-executor-launch.mjs";

// Invented normalized host contract, not a launch or live availability claim.
const host = {
  source: "host-tool-schema", revision: "synthetic-spawn-v1", forkTurnsNone: true,
  defaultAgent: { modelOverride: true, reasoningEffortOverride: true, inheritsSandbox: true, inheritsApprovalPolicy: true },
  executorRole: { agentType: "org-plan-executor", fixed: true, model: "gpt-6.1-sol", reasoningEffort: "medium", inheritsSandbox: true, inheritsApprovalPolicy: true },
};
const permissions = { sandboxMode: "workspace-write", approvalPolicy: "never", writableRoots: ["/fixture/workspace", "/tmp"] };
const assignment = "Assignment: L1; sole writer; exact plan/skill/repository paths and criteria supplied by root; no live side effects in this fixture.";
const helper = fileURLToPath(new URL("../../../plugins/gestalt/skills/org-plan/scripts/org-plan", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "executor-launch-"));
const profiles = join(directory, "agents");
let passed = 0;
const check = (name, action) => { try { action(); passed += 1; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } };
const setup = (...args) => spawnSync(helper, [...args, "--agents-dir", profiles], { encoding: "utf8" });
function readProfile(role) {
  const result = spawnSync("python3", ["-c", "import json,sys,tomllib;print(json.dumps(tomllib.load(open(sys.argv[1],'rb'))))", join(profiles, `org-plan-${role}.toml`)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
try {
  let profile;
  check("generated TOML defaults medium and preserves permissions", () => {
    const result = setup("prepare-supervision");
    assert.equal(result.status, 0, result.stderr);
    profile = readProfile("executor");
    const reviewer = readProfile("reviewer");
    for (const value of [profile, reviewer]) {
      assert.equal(value.model, "gpt-6.1-sol");
      assert.equal(value.model_reasoning_effort, "medium");
      assert.equal(value.approval_policy, undefined);
    }
    assert.equal(profile.sandbox_mode, undefined);
    assert.equal(reviewer.sandbox_mode, "read-only");
    assert.equal(statSync(join(profiles, "org-plan-executor.toml")).mode & 0o777, 0o600);
  });
  const recipe = (patch = {}) => prepareExecutorLaunch({ position: 1, policy: { version: 1, model: "gpt-6-luna", reasoningEffort: "medium", necessity: null }, host, permissions, profile, assignment, ...patch });
  check("default recipe carries exact generated duties and explicit task settings", () => {
    const result = recipe();
    assert.equal(result.ok, true);
    assert.deepEqual(result.spawnArguments, { agent_type: "default", task_name: "l1", fork_turns: "none", model: "gpt-6-luna", reasoning_effort: "medium", message: profile.developer_instructions + "\n\n" + assignment });
    assert.deepEqual(result.permissionRequirements, permissions);
    assert.equal(result.effectiveSettings, null);
    assert.equal(result.assurance, "configured");
    assert.equal(result.runtimeEnforcement, false);
    assert.equal(result.requiresEffectiveSettingsCheck, false);
    assert.equal(recipe({ assurance: "runtime-attested" }).requiresEffectiveSettingsCheck, true);
    assert.equal(recipe({ assurance: "invented" }).code, "EXECUTOR_ASSURANCE_INVALID");
  });
  check("all model tiers explicitly preserve medium", () => {
    for (const model of ["gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"]) {
      assert.equal(recipe({ policy: { version: 1, model, reasoningEffort: "medium" } }).spawnArguments.reasoning_effort, "medium");
    }
  });
  check("canonical position and fork never inherited from caller history", () => {
    assert.equal(recipe({ position: 6 }).spawnArguments.task_name, "l6");
    for (const position of [0, -1, "l6", 1.5]) assert.equal(recipe({ position }).code, "EXECUTOR_POSITION_INVALID");
  });
  check("fixed-role matching pins omit ineffective override arguments", () => {
    const result = recipe({ route: "fixed-role", policy: { version: 1, model: "gpt-6.1-sol", reasoningEffort: "medium" } });
    assert.equal(result.ok, true);
    assert.equal(result.spawnArguments.agent_type, "org-plan-executor");
    assert.equal(result.spawnArguments.model, undefined);
    assert.equal(result.spawnArguments.reasoning_effort, undefined);
    assert.equal(result.spawnArguments.fork_turns, "none");
  });
  check("supervisor choice wins over a conflicting fixed role via the supported default route", () => {
    assert.equal(recipe({ route: "fixed-role" }).spawnArguments.agent_type, "default");
    const pinnedHigh = structuredClone(host); pinnedHigh.executorRole.reasoningEffort = "high";
    assert.equal(recipe({ route: "fixed-role", policy: { version: 1, model: "gpt-6.1-sol", reasoningEffort: "medium" }, host: pinnedHigh }).spawnArguments.reasoning_effort, "medium");
    const terra = recipe({ route: "fixed-role", policy: { version: 1, model: "gpt-6.1-terra", reasoningEffort: "high" } });
    assert.equal(terra.spawnArguments.agent_type, "default");
    assert.equal(terra.spawnArguments.model, "gpt-6.1-terra");
    assert.equal(terra.spawnArguments.reasoning_effort, "high");
  });
  check("unknown pins or unproven override support block", () => {
    assert.equal(recipe({ host: {} }).code, "EXECUTOR_HOST_CONTRACT_UNKNOWN");
    assert.equal(recipe({ host: { ...host, forkTurnsNone: false } }).code, "EXECUTOR_HOST_CONTRACT_UNKNOWN");
    assert.equal(recipe({ route: "default", host: { ...host, defaultAgent: { ...host.defaultAgent, reasoningEffortOverride: false } } }).code, "EXECUTOR_EXPLICIT_OVERRIDES_UNAVAILABLE");
    assert.equal(recipe({ route: "fixed-role", host: { ...host, defaultAgent: {}, executorRole: {} } }).code, "EXECUTOR_ROLE_CONTRACT_UNKNOWN");
    const fallbackHost = { ...host, defaultAgent: {} };
    assert.equal(recipe({ host: fallbackHost }).code, "EXECUTOR_FIXED_ROLE_MISMATCH");
    assert.equal(recipe({ host: fallbackHost, policy: { version: 1, model: "gpt-6.1-sol", reasoningEffort: "medium" } }).spawnArguments.agent_type, "org-plan-executor");
  });
  check("permission policies and roots pass through without spawn overrides", () => {
    for (const approvalPolicy of ["never", "on-request", "on-failure", "untrusted"]) {
      const result = recipe({ permissions: { ...permissions, approvalPolicy } });
      assert.equal(result.permissionRequirements.approvalPolicy, approvalPolicy);
      for (const key of ["sandbox_mode", "sandbox_permissions", "approval_policy", "writable_roots"]) assert.equal(result.spawnArguments[key], undefined);
    }
    for (const sandboxMode of ["read-only", "danger-full-access", "unknown"]) assert.equal(recipe({ permissions: { ...permissions, sandboxMode } }).code, "EXECUTOR_PERMISSION_CONTEXT_UNSUPPORTED");
    assert.equal(recipe({ permissions: { ...permissions, approvalPolicy: "always" } }).code, "EXECUTOR_PERMISSION_CONTEXT_UNSUPPORTED");
  });
  check("unknown inheritance never broadens permissions", () => {
    for (const key of ["inheritsSandbox", "inheritsApprovalPolicy"]) {
      const changed = structuredClone(host); delete changed.defaultAgent[key];
      assert.equal(recipe({ host: changed }).code, "EXECUTOR_PERMISSION_INHERITANCE_UNKNOWN");
      const fixed = structuredClone(host); fixed.executorRole[key] = false;
      assert.equal(recipe({ route: "fixed-role", policy: { version: 1, model: "gpt-6.1-sol", reasoningEffort: "medium" }, host: fixed }).code, "EXECUTOR_PERMISSION_INHERITANCE_UNKNOWN");
    }
  });
  check("profile cannot alter sandbox or approval policy", () => {
    assert.equal(recipe({ profile: { ...profile, sandbox_mode: "danger-full-access" } }).code, "EXECUTOR_PROFILE_PERMISSION_CONFLICT");
    assert.equal(recipe({ profile: { ...profile, approval_policy: "on-request" } }).code, "EXECUTOR_PROFILE_PERMISSION_CONFLICT");
  });
  check("bootstrap/assignment are mandatory", () => {
    assert.equal(recipe({ profile: {} }).code, "EXECUTOR_DUTIES_REQUIRED");
    assert.equal(recipe({ assignment: "" }).code, "EXECUTOR_DUTIES_REQUIRED");
  });
  check("malformed identifiers fail; supervisor high does not require an exception", () => {
    for (const model of ["invalid model", "", "x".repeat(65)]) assert.equal(recipe({ policy: { version: 1, model, reasoningEffort: "medium" } }).code, "EXECUTOR_POLICY_INVALID");
    assert.equal(recipe({ policy: { version: 1, model: "gpt-6-sol", reasoningEffort: "high" } }).ok, true);
  });
  check("recipe is pure and does not change source setup", () => {
    const before = readFileSync(join(profiles, "org-plan-executor.toml"));
    const state = JSON.stringify({ host, permissions, profile });
    recipe(); recipe({ route: "fixed-role" });
    assert.equal(JSON.stringify({ host, permissions, profile }), state);
    assert.deepEqual(readFileSync(join(profiles, "org-plan-executor.toml")), before);
  });
  check("explicit setup choices are separate and preserve file modes", () => {
    chmodSync(join(profiles, "org-plan-executor.toml"), 0o640);
    const result = setup("prepare-supervision", "--executor-model", "gpt-6-luna", "--executor-reasoning-effort", "high", "--reviewer-reasoning-effort", "xhigh");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readProfile("executor").model, "gpt-6-luna");
    assert.equal(readProfile("executor").model_reasoning_effort, "high");
    assert.equal(readProfile("reviewer").model_reasoning_effort, "xhigh");
    assert.equal(readProfile("reviewer").sandbox_mode, "read-only");
    assert.equal(statSync(join(profiles, "org-plan-executor.toml")).mode & 0o777, 0o640);
    assert.equal(setup("prepare-executor", "--model", "gpt-6-sol", "--reasoning-effort", "medium").status, 0);
    assert.equal(readProfile("executor").model, "gpt-6-sol");
    assert.equal(readProfile("executor").model_reasoning_effort, "medium");
  });
  check("invalid effort flags fail before setup writes", () => {
    const before = readdirSync(profiles).map((name) => [name, readFileSync(join(profiles, name), "utf8")]);
    for (const args of [["prepare-executor", "--reasoning-effort", "ultra"], ["prepare-supervision", "--executor-reasoning-effort", "max"], ["prepare-supervision", "--reviewer-reasoning-effort", "HIGH"]]) assert.equal(setup(...args).status, 2);
    assert.deepEqual(readdirSync(profiles).map((name) => [name, readFileSync(join(profiles, name), "utf8")]), before);
  });
  console.log(`Executor launch: ${passed} passed, 0 failed, 0 skipped, ${passed} total (synthetic host; no runtime launch)`);
} finally { rmSync(directory, { recursive: true, force: true }); }
