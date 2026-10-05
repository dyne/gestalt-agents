import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessOrgPlanStartup } from "../../../plugins/gestalt/scripts/org-plan-preflight.mjs";

const manifest = JSON.parse(
  readFileSync(
    new URL("../../../plugins/gestalt/.mcp.json", import.meta.url),
    "utf8",
  ),
);
const evaluate = (config = {}, options = {}) =>
  assessOrgPlanStartup({
    manifest,
    config: { approval_policy: "never", ...config },
    ...options,
  });
const withOverride = (server) => ({
  plugins: {
    "gestalt@dyne-gestalt-agents": {
      mcp_servers: { "gestalt-org-plan": server },
    },
  },
});
assert.equal(evaluate().ready, true);
const old = structuredClone(manifest);
delete old.mcpServers["gestalt-org-plan"].default_tools_approval_mode;
assert.equal(
  evaluate({}, { manifest: old }).issues.filter(
    (issue) => issue.code === "ORG_PLAN_APPROVAL_CONFLICT",
  ).length,
  5,
);
assert.equal(
  evaluate(
    { approval_policy: "on-request" },
    { approvalPolicy: "never", manifest: old },
  ).ready,
  false,
);
assert.equal(
  evaluate({ approval_policy: "on-request" }, { manifest: old }).ready,
  true,
);
assert.equal(
  evaluate(
    withOverride({ tools: { org_plan_signal: { approval_mode: "prompt" } } }),
  ).issues[0].tool,
  "org_plan_signal",
);
assert.equal(
  evaluate(withOverride({ default_tools_approval_mode: "prompt" })).ready,
  false,
);
assert.equal(
  evaluate(withOverride({ enabled: false })).issues[0].code,
  "ORG_PLAN_SERVER_DISABLED",
);
assert.equal(
  evaluate(withOverride({ disabled_tools: ["org_plan_signal"] })).issues[0]
    .code,
  "ORG_PLAN_TOOL_DISABLED",
);
assert.equal(
  evaluate(withOverride({ enabled_tools: ["org_plan_signal"] })).ready,
  false,
);
assert.equal(
  evaluate({ mcp_servers: { "gestalt-org-plan": {} } }).issues[0].code,
  "ORG_PLAN_SERVER_SHADOWED",
);
const privateValue = "/private/do-not-print";
const environment = { GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY: privateValue };
assert.equal(evaluate({}, { environment }).ready, true);
const missingEnvironment = structuredClone(manifest);
delete missingEnvironment.mcpServers["gestalt-org-plan"].env_vars;
const report = evaluate({}, { environment, manifest: missingEnvironment });
assert.equal(report.issues[0].code, "ORG_PLAN_STATUS_NOT_FORWARDED");
assert.equal(JSON.stringify(report).includes(privateValue), false);
assert.equal(evaluate({}, { manifest: {} }).ready, false);
console.log(
  "Org-plan preflight detects approval, tool availability and publication conflicts without exposing private state",
);

const temporary = mkdtempSync(join(tmpdir(), "org-plan-preflight-cli-"));
try {
  const bin = join(temporary, "bin");
  const methods = join(temporary, "methods.jsonl");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "codex"),
    `#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
createInterface({input:process.stdin}).on('line', line => {
 const message=JSON.parse(line); if(message.id===undefined)return;
 appendFileSync(process.env.DIAGNOSTIC_METHODS_FILE, JSON.stringify(message.method)+'\\n');
 if(!['initialize','config/read'].includes(message.method))process.exit(3);
 const config={approval_policy:'on-request',developer_instructions:'private-config-sentinel'};
 if(process.env.PROMPT_OVERRIDE)config.plugins={'gestalt@dyne-gestalt-agents':{mcp_servers:{'gestalt-org-plan':{tools:{org_plan_signal:{approval_mode:'prompt'}}}}}};
 console.log(JSON.stringify({id:message.id,result:message.method==='initialize'?{}:{config}}));
});
`,
    { mode: 0o700 },
  );
  const cli = fileURLToPath(
    new URL(
      "../../../plugins/gestalt/scripts/check-org-plan-startup.mjs",
      import.meta.url,
    ),
  );
  for (const override of [false, true]) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, "--approval-policy", "never"],
        {
          cwd: temporary,
          env: {
            PATH: `${bin}:${process.env.PATH}`,
            HOME: temporary,
            CODEX_HOME: temporary,
            DIAGNOSTIC_METHODS_FILE: methods,
            ...(override ? { PROMPT_OVERRIDE: "1" } : {}),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.resume();
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    });
    assert.equal(result.code, override ? 1 : 0);
    const report = JSON.parse(result.output);
    assert.equal(report.ready, !override);
    assert.equal(report.approvalPolicy, "never");
    assert.equal(result.output.includes("private-config-sentinel"), false);
    if (override) assert.equal(report.issues[0].tool, "org_plan_signal");
  }
  assert.deepEqual(
    readFileSync(methods, "utf8").trim().split("\n").map(JSON.parse),
    ["initialize", "config/read", "initialize", "config/read"],
  );
  console.log(
    "startup CLI checks effective policy overrides using read-only RPC only",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
