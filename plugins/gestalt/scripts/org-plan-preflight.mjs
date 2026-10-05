const lifecycleTools = [
  "org_plan_signal",
  "org_plan_l1_transition",
  "org_plan_l2_transition",
  "org_plan_review_transition",
  "org_plan_measure",
];
const pluginId = "gestalt@dyne-gestalt-agents";
const serverName = "gestalt-org-plan";

/** Inspect only permission metadata; never return config or environment values. */
export function assessOrgPlanStartup({
  config,
  manifest,
  approvalPolicy,
  environment = {},
}) {
  const policy = approvalPolicy ?? config.approval_policy;
  const issues = [];
  const warnings = [];
  const issue = (code, tool) =>
    issues.push({ code, ...(tool ? { tool } : {}) });
  const bundled = manifest?.mcpServers?.[serverName];
  const plugin = config.plugins?.[pluginId];
  const override = plugin?.mcp_servers?.[serverName] ?? {};
  const native = config.mcp_servers?.[serverName];
  // A same-name native server may shadow the plugin; do not certify its identity.
  if (native) issue("ORG_PLAN_SERVER_SHADOWED");
  if (!bundled) issue("ORG_PLAN_SERVER_MISSING");
  const server = {
    ...bundled,
    ...override,
    tools: { ...bundled?.tools, ...override.tools },
  };
  if (plugin?.enabled === false || server.enabled === false)
    issue("ORG_PLAN_SERVER_DISABLED");
  if (policy !== "never") warnings.push({ code: "APPROVAL_POLICY_MAY_PROMPT" });
  for (const tool of lifecycleTools) {
    if (
      server.disabled_tools?.includes(tool) ||
      (server.enabled_tools && !server.enabled_tools.includes(tool)) ||
      server.tools[tool]?.enabled === false
    )
      issue("ORG_PLAN_TOOL_DISABLED", tool);
    const mode =
      server.tools[tool]?.approval_mode ??
      server.default_tools_approval_mode ??
      "auto";
    if (policy === "never" && mode !== "approve")
      issue("ORG_PLAN_APPROVAL_CONFLICT", tool);
  }
  for (const variable of [
    "GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY",
    "GESTALT_MOBILE_ORG_PLAN_STATUS_FILE",
  ]) {
    if (!environment[variable]) continue;
    if (
      !server.env_vars?.includes(variable) &&
      server.env?.[variable] !== environment[variable]
    )
      issue("ORG_PLAN_STATUS_NOT_FORWARDED");
  }
  if (override.env || override.env_vars)
    warnings.push({
      code: "PLUGIN_ENV_OVERRIDE_REQUIRES_RUNTIME_VERIFICATION",
    });
  return {
    ready: issues.length === 0,
    approvalPolicy: typeof policy === "string" ? policy : "configured",
    issues,
    warnings,
  };
}
