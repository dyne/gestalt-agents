import { createInterface } from "node:readline";

/** Newline framing and bounded, event-driven request waits for stdio fixtures. */
export function createMcpTestClient(child, { timeoutMs = 3000 } = {}) {
  const pending = new Map();
  const messages = [];
  let failure;
  const fail = (error) => {
    failure ??= error;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(failure);
    }
    pending.clear();
  };
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      messages.push(message);
      const waiter = pending.get(message.id);
      if (!waiter) throw new Error("Unexpected MCP response ID");
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } catch (error) {
      fail(error);
    }
  });
  lines.on("close", () => fail(new Error("MCP stdout closed")));
  child.on("error", fail);
  child.on("exit", (code, signal) =>
    fail(new Error(`MCP process exited (${code ?? signal})`)),
  );
  child.stdout.on("error", fail);
  child.stdin.on("error", fail);

  const send = (line, id) => {
    if (failure) return Promise.reject(failure);
    if (pending.has(id))
      return Promise.reject(new Error("Duplicate pending MCP request ID"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request ${id} timed out`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${line}\n`, (error) => {
        if (error) fail(error);
      });
    });
  };
  return {
    messages,
    send,
    request: (id, method, params = {}) =>
      send(JSON.stringify({ jsonrpc: "2.0", id, method, params }), id),
    notify: (method, params = {}) =>
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
      ),
  };
}
