#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const [workspace, ...expectedTools] = process.argv.slice(2);
if (!workspace || expectedTools.length === 0) {
  throw new Error("usage: assert-codex-mcp-tools.mjs WORKSPACE TOOL...");
}

const child = spawn("codex", ["app-server", "--strict-config", "--stdio"], {
  cwd: workspace,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});
let nextId = 1;
let stderr = "";
const pending = new Map();
const timeout = setTimeout(() => {
  child.kill("SIGTERM");
  throw new Error("timed out waiting for Codex MCP discovery");
}, 45_000);
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  if (stderr.length < 16_384) stderr += chunk;
});
createInterface({ input: child.stdout }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result);
});

function request(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

try {
  await request("initialize", {
    clientInfo: { name: "context-mode-install-smoke", version: "1" },
    capabilities: {},
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
  const started = await request("thread/start", {
    cwd: workspace,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
  });
  const threadId = started.thread.id;
  const inventory = await request("mcpServerStatus/list", {
    threadId,
    detail: "toolsAndAuthOnly",
  });
  const server = inventory.data.find((item) => item.name === "context-mode");
  if (!server) throw new Error(`context-mode missing from callable registry: ${JSON.stringify(inventory)}`);
  const names = Object.keys(server.tools).sort();
  const missing = expectedTools.filter((name) => !names.includes(name));
  if (missing.length > 0) throw new Error(`context-mode tools missing: ${missing.join(", ")}; found: ${names.join(", ")}`);

  const execution = await request("mcpServer/tool/call", {
    threadId,
    server: "context-mode",
    tool: "ctx_execute",
    arguments: {
      language: "javascript",
      code: 'console.log("fresh Codex context-mode call succeeded")',
    },
  });
  if (execution.isError || !JSON.stringify(execution.content).includes("fresh Codex context-mode call succeeded")) {
    throw new Error(`ctx_execute was discovered but not callable: ${JSON.stringify(execution)}`);
  }
  process.stdout.write(`fresh Codex registry exposed ${names.length} context-mode tools; ctx_execute call passed\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  child.stdin.end();
  child.kill("SIGTERM");
}
