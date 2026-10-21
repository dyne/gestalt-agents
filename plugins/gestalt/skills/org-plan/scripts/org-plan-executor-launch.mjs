import { MODEL_IDS, validEffortNecessity } from "./org-plan-model-policy.mjs";

const text = (value) => typeof value === "string" && value.trim().length > 0;
const fail = (code) => ({ ok: false, code });

// A pure recipe, not a launcher or proof of effective runtime settings. The host
// supplies its actual tool schema/pins and permission inheritance contract.
export function prepareExecutorLaunch({
  position, policy, host, permissions, profile, assignment, route = "default",
}) {
  if (!Number.isSafeInteger(position) || position < 1) return fail("EXECUTOR_POSITION_INVALID");
  if (policy?.version !== 1 || !MODEL_IDS.includes(policy.model) ||
      !["medium", "high", "xhigh"].includes(policy.reasoningEffort) ||
      !validEffortNecessity(policy.reasoningEffort, policy.necessity)) return fail("EXECUTOR_POLICY_INVALID");
  if (host?.source !== "host-tool-schema" || !text(host.revision) ||
      host.forkTurnsNone !== true) return fail("EXECUTOR_HOST_CONTRACT_UNKNOWN");
  if (permissions?.sandboxMode !== "workspace-write" ||
      !["never", "on-request", "on-failure", "untrusted"].includes(permissions.approvalPolicy)) {
    return fail("EXECUTOR_PERMISSION_CONTEXT_UNSUPPORTED");
  }
  if (!text(profile?.developer_instructions) || !text(assignment)) return fail("EXECUTOR_DUTIES_REQUIRED");
  // A duty source must not weaken the parent's permissions. These are not spawn
  // overrides: reject incompatible arrangements rather than changing setup.
  if ((profile.sandbox_mode !== undefined && profile.sandbox_mode !== permissions.sandboxMode) ||
      (profile.approval_policy !== undefined && profile.approval_policy !== permissions.approvalPolicy)) {
    return fail("EXECUTOR_PROFILE_PERMISSION_CONFLICT");
  }
  let spawnArguments;
  if (route === "default") {
    const capability = host.defaultAgent;
    if (capability?.modelOverride !== true || capability.reasoningEffortOverride !== true) {
      return fail("EXECUTOR_EXPLICIT_OVERRIDES_UNAVAILABLE");
    }
    if (capability.inheritsSandbox !== true || capability.inheritsApprovalPolicy !== true) {
      return fail("EXECUTOR_PERMISSION_INHERITANCE_UNKNOWN");
    }
    spawnArguments = { agent_type: "default", model: policy.model, reasoning_effort: policy.reasoningEffort };
  } else if (route === "fixed-role") {
    const role = host.executorRole;
    if (role?.agentType !== "org-plan-executor" || role.fixed !== true) return fail("EXECUTOR_ROLE_CONTRACT_UNKNOWN");
    if (role.model !== policy.model || role.reasoningEffort !== policy.reasoningEffort) {
      return fail("EXECUTOR_FIXED_ROLE_MISMATCH");
    }
    if (role.inheritsSandbox !== true || role.inheritsApprovalPolicy !== true) {
      return fail("EXECUTOR_PERMISSION_INHERITANCE_UNKNOWN");
    }
    spawnArguments = { agent_type: "org-plan-executor" };
  } else return fail("EXECUTOR_ROUTE_INVALID");
  return {
    ok: true,
    spawnArguments: { ...spawnArguments, task_name: `l${position}`, fork_turns: "none",
      message: `${profile.developer_instructions}\n\n${assignment}` },
    requested: { model: policy.model, reasoningEffort: policy.reasoningEffort },
    permissionRequirements: { ...permissions },
    hostRevision: host.revision,
    effectiveSettings: null,
    requiresEffectiveSettingsCheck: true,
  };
}
