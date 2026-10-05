#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { withCodexRpc } from "./codex-rpc.mjs";
import { assessOrgPlanStartup } from "./org-plan-preflight.mjs";

const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 2 ||
    args[0] !== "--approval-policy" ||
    !["never", "on-request", "untrusted"].includes(args[1]))
) {
  console.error(
    "usage: node check-org-plan-startup.mjs [--approval-policy never|on-request|untrusted]",
  );
  process.exit(2);
}
try {
  const manifest = JSON.parse(
    readFileSync(new URL("../.mcp.json", import.meta.url), "utf8"),
  );
  const report = await withCodexRpc(async (request) => {
    const response = await request("config/read", {
      includeLayers: false,
      cwd: process.cwd(),
    });
    return assessOrgPlanStartup({
      config: response.config,
      manifest,
      approvalPolicy: args[1],
      environment: process.env,
    });
  });
  console.log(JSON.stringify(report));
  if (!report.ready) process.exitCode = 1;
} catch {
  console.error(
    "Org-plan startup configuration could not be verified; no permissions or plan state were changed.",
  );
  process.exitCode = 1;
}
