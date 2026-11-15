#!/usr/bin/env node
/** Standalone adapter for the canonical import-safe setup owner. */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setupAgents } from "./scripts/setup-agents.mjs";
export { setupAgents, SETUP_API_VERSION, SETUP_API_CAPABILITIES } from "./scripts/setup-agents.mjs";

function isDirectInvocation() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (isDirectInvocation()) {
  const controller = new AbortController();
  const handlers = new Map([["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]].map(([name, status]) => [name, () => controller.abort({ signal: name, status })]));
  for (const [name, handler] of handlers) process.on(name, handler);
  try { await setupAgents(process.argv.slice(2), { signal: controller.signal }); }
  catch (error) { process.stderr.write(`gestalt-setup: ${error.message}\n`); process.exitCode = error.status || 1; }
  finally { for (const [name, handler] of handlers) process.removeListener(name, handler); }
}
