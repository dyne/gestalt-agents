import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { commandTarget, resolveExecutable } from "./native-command.mjs";

// Setup supplies its owned command context. Keep this plugin independently
// distributable: the ordinary diagnostic path has no context-mode dependency.
async function withOwnedCodexRpc(operation, { workspace, environment, timeoutMs, commandContext }) {
  const target = commandTarget(resolveExecutable("codex", environment));
  const pending = new Map(), queued = [];
  let wake, ended = false, failure, nextId = 0, buffered = "";
  const decoder = new StringDecoder("utf8");
  const fail = (error = new Error("Codex diagnostic connection failed")) => {
    failure ??= error;
    for (const waiter of pending.values()) waiter.reject(failure);
    pending.clear();
  };
  const input = {
    async *[Symbol.asyncIterator]() {
      while (!ended || queued.length) {
        if (queued.length) yield queued.shift();
        else await new Promise((done) => { wake = done; });
      }
    },
  };
  const send = (message) => { queued.push(Buffer.from(`${JSON.stringify(message)}\n`)); wake?.(); wake = undefined; };
  const lease = await commandContext.launch(target.executable, {
    argv: [...target.prefix, "app-server", "--stdio"], cwd: workspace, environment,
  }, {
    stdin: input,
    stdout: async (bytes) => {
      buffered += decoder.write(bytes);
      if (Buffer.byteLength(buffered) > 1024 * 1024) throw new Error("Codex diagnostic response exceeds1MiB");
      let index;
      while ((index = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, index); buffered = buffered.slice(index + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error("Codex diagnostic request failed"));
        else waiter.resolve(message.result);
      }
    },
    stderr: async () => {},
  }, { graceMs: 1000, deadlineMs: 10_000 });
  void Promise.resolve(lease.result).then(() => fail(), (error) => fail(error));
  void lease.completed.then(() => fail(), (error) => fail(error));
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const id = ++nextId; pending.set(id, { resolve, reject }); send({ id, method, params });
  });
  const timeout = setTimeout(() => { fail(new Error("Codex diagnostic connection timed out")); void lease.stop(); }, timeoutMs);
  let successful = false;
  try {
    await request("initialize", { clientInfo: { name: "gestalt-org-plan-preflight", version: "1" }, capabilities: {} });
    send({ method: "initialized", params: {} });
    const result = await operation(request);
    successful = true;
    return result;
  } finally {
    clearTimeout(timeout); ended = true; wake?.();
    // Normal diagnostics finish by delivering target stdin EOF. Give that
    // orderly shutdown a bounded chance before requesting owned stop; command
    // result and complete-tree release remain separate in the supplied port.
    if (successful && !commandContext.signal?.aborted) {
      let timer;
      try { await Promise.race([lease.completed, new Promise((done) => { timer = setTimeout(done, 2000); })]); }
      finally { clearTimeout(timer); }
    }
    await lease.stop();
    commandContext.check();
  }
}

/** A bounded, read-only diagnostic connection; no thread or turn is started. */
export async function withCodexRpc(
  operation,
  {
    workspace = process.cwd(),
    environment = process.env,
    timeoutMs = 15000,
    commandContext,
  } = {},
) {
  if (commandContext) return withOwnedCodexRpc(operation, { workspace, environment, timeoutMs, commandContext });
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
