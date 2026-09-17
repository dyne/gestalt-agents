import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  probeMcpHandshake,
  resolveMcpProbeLaunch,
  type McpProbeLaunch,
} from "../../src/util/mcp-handshake.js";

function nodeScript(source: string): McpProbeLaunch {
  return { command: process.execPath, args: ["-e", source], label: "test fixture" };
}

const successfulServer = String.raw`
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,result:{protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"context-mode",version:"test"}}}) + "\n");
    }
    if (request.method === "tools/list") {
      process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,result:{tools:[{name:"ctx_doctor"}]}}) + "\n");
    }
  }
});
`;

describe("spawned MCP handshake probe", () => {
  test("completes initialize and tools/list", async () => {
    const result = await probeMcpHandshake(nodeScript(successfulServer), 2_000);

    expect(result).toEqual({
      ok: true,
      detail: "initialize + tools/list passed (ctx_doctor available)",
    });
  });

  test("reports a child that closes during initialize with bounded stderr", async () => {
    const result = await probeMcpHandshake(nodeScript(`
      process.stdin.once("data", () => {
        process.stderr.write("fixture initialization failed\\n");
        process.exit(23);
      });
    `), 2_000);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("connection closed during initialize (exit 23)");
    expect(result.detail).toContain("fixture initialization failed");
    expect(result.detail).toContain("launcher test fixture; pid ");
  });

  test("retries one clean exit before initialize and reports recovery", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "ctx-handshake-retry-"));
    const marker = join(fixtureRoot, "first-attempt");
    const script = String.raw`
      const { existsSync, writeFileSync } = require("node:fs");
      const marker = process.argv[1];
      if (!existsSync(marker)) { writeFileSync(marker, "1"); process.exit(0); }
      ${successfulServer}
    `;

    try {
      const result = await probeMcpHandshake({
        command: process.execPath,
        args: ["-e", script, marker],
        label: "retry fixture",
      }, 2_000);

      expect(result).toEqual({
        ok: true,
        recoveredAfterRetry: true,
        detail: "initialize + tools/list passed (ctx_doctor available); recovered on retry after transient clean exit",
      });
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("bounds clean-exit recovery to one retry and preserves both failures", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "ctx-handshake-retry-limit-"));
    const attempts = join(fixtureRoot, "attempts");
    const script = String.raw`
      const { appendFileSync } = require("node:fs");
      appendFileSync(process.argv[1], "attempt\n");
      process.exit(0);
    `;

    try {
      const result = await probeMcpHandshake({
        command: process.execPath,
        args: ["-e", script, attempts],
        label: "retry-limit fixture",
      }, 2_000);

      expect(result.ok).toBe(false);
      expect(result.detail).toContain("retry also failed");
      expect(result.detail.match(/launcher retry-limit fixture; pid/g)).toHaveLength(2);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("scrubs inherited bridge-only lifecycle variables", async () => {
    const previousDepth = process.env.CONTEXT_MODE_BRIDGE_DEPTH;
    const previousIdle = process.env.CONTEXT_MODE_BRIDGE_IDLE_MS;
    process.env.CONTEXT_MODE_BRIDGE_DEPTH = "3";
    process.env.CONTEXT_MODE_BRIDGE_IDLE_MS = "1";
    try {
      const result = await probeMcpHandshake(nodeScript(String.raw`
        if (process.env.CONTEXT_MODE_BRIDGE_DEPTH || process.env.CONTEXT_MODE_BRIDGE_IDLE_MS) process.exit(31);
        ${successfulServer}
      `), 2_000);
      expect(result.ok).toBe(true);
    } finally {
      if (previousDepth === undefined) delete process.env.CONTEXT_MODE_BRIDGE_DEPTH;
      else process.env.CONTEXT_MODE_BRIDGE_DEPTH = previousDepth;
      if (previousIdle === undefined) delete process.env.CONTEXT_MODE_BRIDGE_IDLE_MS;
      else process.env.CONTEXT_MODE_BRIDGE_IDLE_MS = previousIdle;
    }
  });

  test("reports the handshake phase on timeout", async () => {
    const result = await probeMcpHandshake(nodeScript(`
      process.stdin.resume();
      setInterval(() => {}, 1000);
    `), 100);

    expect(result).toEqual({
      ok: false,
      detail: "timed out during initialize after 100ms",
    });
  });

  test("prefers the configured Codex bridge over package fallbacks", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "ctx-handshake-resolver-"));
    const bridge = join(fixtureRoot, "context-mode-mcp.mjs");
    writeFileSync(bridge, "// fixture\n");

    try {
      const launch = resolveMcpProbeLaunch(resolve(import.meta.dirname, "..", ".."), bridge);

      expect(launch).toEqual({ command: process.execPath, args: [bridge], label: bridge });
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
