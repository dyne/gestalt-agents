import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { commandTarget, resolveExecutable } from "./native-command.mjs";

/** A bounded, read-only diagnostic connection; no thread or turn is started. */
export async function withCodexRpc(
  operation,
  {
    workspace = process.cwd(),
    environment = process.env,
    timeoutMs = 15000,
  } = {},
) {
  const target = commandTarget(resolveExecutable("codex", environment));
  const child = spawn(target.executable, [...target.prefix, "app-server", "--stdio"], {
    cwd: workspace,
    env: environment,
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  const fail = () => {
    for (const waiter of pending.values())
      waiter.reject(new Error("Codex diagnostic connection failed"));
    pending.clear();
  };
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("exit", fail);
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error)
      waiter.reject(new Error("Codex diagnostic request failed"));
    else waiter.resolve(message.result);
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  const timeout = setTimeout(() => {
    fail();
    child.kill();
  }, timeoutMs);
  try {
    await request("initialize", {
      clientInfo: { name: "gestalt-org-plan-preflight", version: "1" },
      capabilities: {},
    });
    child.stdin.write(
      `${JSON.stringify({ method: "initialized", params: {} })}\n`,
    );
    return await operation(request);
  } finally {
    clearTimeout(timeout);
    lines.close();
    child.stdin.end();
    child.kill();
  }
}
