/**
 * Execution provenance regressions for the audit requirements from #717/#736.
 * Routine responses expose source digests and authorized audit references;
 * executable source is recovered explicitly rather than echoed by default.
 */

import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  runBatchCommands,
  type BatchCommand,
} from "../../src/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpEntry = resolve(__dirname, "..", "..", "server.bundle.mjs");

interface MockResult { stdout: string; stderr?: string; timedOut?: boolean; }

function mkMockExecutor(
  handler: (code: string, timeout: number | undefined) => Promise<MockResult> | MockResult,
): { execute: (input: { language: "shell"; code: string; timeout: number | undefined }) => Promise<MockResult> } {
  return {
    execute: async ({ code, timeout }) => Promise.resolve(handler(code, timeout)),
  };
}

const NOOP_PREFIX = "";

// ════════════════════════════════════════════════════════════════════════════
// Behaviour 1 — runBatchCommands retains a source digest in each section
// ════════════════════════════════════════════════════════════════════════════
describe("issue #736 — ctx_batch_execute retains source identity per section", () => {
  test("serial path: each section carries source digest without executable text", async () => {
    const cmds: BatchCommand[] = [
      { label: "git commits mentioning niri in messages", command: "git log --all --grep='niri' --regexp-ignore-case" },
      { label: "git pickaxe niri content changes", command: "git log --all -i -S'niri' --date=short" },
      { label: "git changed paths containing niri", command: "git log --all -- '**/*niri*'" },
    ];
    const exec = mkMockExecutor(() => ({ stdout: "ok\n" }));
    const { outputs } = await runBatchCommands(
      cmds,
      { timeout: 5000, concurrency: 1, nodeOptsPrefix: NOOP_PREFIX },
      exec,
    );

    expect(outputs).toHaveLength(3);
    for (let i = 0; i < cmds.length; i++) {
      expect(outputs[i]).toContain(`# ${cmds[i].label}`);
      expect(outputs[i]).toContain(`Source sha256=${createHash("sha256").update(cmds[i].command).digest("hex")}`);
      expect(outputs[i]).not.toContain(cmds[i].command);
    }
  });

  test("parallel path: each section carries source digest without executable text", async () => {
    const cmds: BatchCommand[] = [
      { label: "alpha", command: "echo alpha" },
      { label: "bravo", command: "echo bravo" },
      { label: "charlie", command: "echo charlie" },
    ];
    const exec = mkMockExecutor(() => ({ stdout: "ok\n" }));
    const { outputs } = await runBatchCommands(
      cmds,
      { timeout: 5000, concurrency: 3, nodeOptsPrefix: NOOP_PREFIX },
      exec,
    );
    for (let i = 0; i < cmds.length; i++) {
      expect(outputs[i]).toContain(`# ${cmds[i].label}`);
      expect(outputs[i]).toContain(`Source sha256=${createHash("sha256").update(cmds[i].command).digest("hex")}`);
      expect(outputs[i]).not.toContain(cmds[i].command);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Behaviour 3 — Long commands retain only a digest
// ════════════════════════════════════════════════════════════════════════════
describe("issue #736 — pathological heredoc commands truncate cleanly", () => {
  test("long heredocs retain identity without exposing source", async () => {
    const payload = "x".repeat(2000);
    const heredoc = `node - <<'NODE'\n${payload}\nNODE`;
    const exec = mkMockExecutor(() => ({ stdout: "ok\n" }));
    const { outputs } = await runBatchCommands(
      [{ label: "heredoc", command: heredoc }],
      { timeout: 5000, concurrency: 1, nodeOptsPrefix: NOOP_PREFIX },
      exec,
    );
    const section = outputs[0];
    expect(section).toContain(`Source sha256=${createHash("sha256").update(heredoc).digest("hex")}`);
    expect(section).not.toContain(payload);
    expect(section).not.toContain("$ ");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// JSON-RPC harness for live-server behaviours (Behaviours 4/5)
// ════════════════════════════════════════════════════════════════════════════

interface RpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
  error?: { code: number; message: string };
}

function spawnServer(extraEnv: Record<string, string> = {}): ChildProcess {
  return spawn("node", [mcpEntry], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CONTEXT_MODE_DISABLE_VERSION_CHECK: "1", ...extraEnv,
      CONTEXT_MODE_PLATFORM: "codex", CONTEXT_MODE_WORKSPACE: extraEnv.CLAUDE_PROJECT_DIR,
      CONTEXT_MODE_PROJECT_DIR: extraEnv.CLAUDE_PROJECT_DIR,
      CONTEXT_MODE_DIR: extraEnv.CLAUDE_PROJECT_DIR ? join(extraEnv.CLAUDE_PROJECT_DIR, ".gestalt", "context-mode") : undefined,
      CODEX_THREAD_ID: "compact-provenance-rpc",
    },
  });
}

function sendRpc(proc: ChildProcess, msg: Record<string, unknown>): void {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}

async function stopServer(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const closed = once(proc, "close");
  const timeout = setTimeout(() => proc.kill("SIGKILL"), 5000);
  try {
    proc.kill("SIGTERM");
    await closed;
  } finally {
    clearTimeout(timeout);
  }
}

async function awaitRpc(
  proc: ChildProcess,
  id: number,
  request: Record<string, unknown>,
  timeoutMs = 20_000,
): Promise<RpcResponse | undefined> {
  return new Promise((res) => {
    let buffer = "";
    const onData = (d: Buffer) => {
      buffer += d.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as RpcResponse;
          if (parsed.id === id) {
            proc.stdout!.off("data", onData);
            clearTimeout(timer);
            res(parsed);
            return;
          }
        } catch { /* ignore non-JSON output */ }
      }
    };
    const timer = setTimeout(() => {
      proc.stdout!.off("data", onData);
      res(undefined);
    }, timeoutMs);
    proc.stdout!.on("data", onData);
    sendRpc(proc, request);
  });
}

async function initServer(proc: ChildProcess): Promise<void> {
  await awaitRpc(proc, 1, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "echo-commands-test", version: "1.0" } },
  });
  sendRpc(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
}

// ════════════════════════════════════════════════════════════════════════════
// Behaviour 4 — ctx_execute carries compact provenance before stdout
// ════════════════════════════════════════════════════════════════════════════
describe("issue #717 — ctx_execute retains language and source identity", () => {
  let projectDir: string;
  beforeAll(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), "echo-exec-")));
  });
  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("success path: response carries source identity and audit reference without code", async () => {
    const proc = spawnServer({ CLAUDE_PROJECT_DIR: projectDir });
    try {
      await initServer(proc);
      const marker = `EXEC-MARKER-${Math.random().toString(36).slice(2)}`;
      const code = `console.log("${marker}");`;
      const resp = await awaitRpc(proc, 100, {
        jsonrpc: "2.0", id: 100, method: "tools/call",
        params: { name: "ctx_execute", arguments: { language: "javascript", code } },
      });
      expect(resp?.error).toBeUndefined();
      expect(resp?.result?.isError ?? false).toBe(false);
      const text = resp?.result?.content?.[0]?.text ?? "";
      expect(text).toContain('"language":"javascript"');
      expect(text).toContain('"sourceDigest":"' + createHash("sha256").update(code).digest("hex") + '"');
      expect(text).toContain('"operationId"');
      expect(text).toContain('"report":"report-');
      expect(text).not.toContain(code);
      expect(resp?.result?.content?.map(part => part.text).join("\n")).toContain(marker);
    } finally {
      await stopServer(proc);
    }
  }, 30_000);
});

// ════════════════════════════════════════════════════════════════════════════
// Behaviour 6 — ctx_batch_execute summary carries a "## Commands" inventory
//               so the response itself (not just per-section echoes) lists
//               every command the agent ran. Placed before "## Indexed
//               Sections" per the issue templates.
// ════════════════════════════════════════════════════════════════════════════
describe("issue #736 — ctx_batch_execute summary includes a Commands inventory", () => {
  let projectDir: string;
  beforeAll(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), "echo-batch-")));
  });
  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("response carries command identities before Indexed Sections without executable text", async () => {
    const proc = spawnServer({ CLAUDE_PROJECT_DIR: projectDir });
    try {
      await initServer(proc);
      const resp = await awaitRpc(proc, 102, {
        jsonrpc: "2.0", id: 102, method: "tools/call",
        params: {
          name: "ctx_batch_execute",
          arguments: {
            commands: [
              { label: "alpha", command: "echo alpha-output" },
              { label: "bravo", command: "echo bravo-output" },
              { label: "charlie", command: "echo charlie-output" },
            ],
            queries: ["alpha"], response_bytes: 4096,
          },
        },
      });
      expect(resp?.error).toBeUndefined();
      const text = resp?.result?.content?.map(part => part.text).join("\n") ?? "";

      // Commands inventory present
      expect(text).toContain("## Commands");
      expect(resp?.result?.content?.map(part => part.text).join("\n")).not.toContain("echo alpha-output");
      expect(resp?.result?.content?.map(part => part.text).join("\n")).not.toContain("echo bravo-output");
      // Ordering: Commands BEFORE Indexed Sections
      const cmdIdx = text.indexOf("## Commands");
      const secIdx = text.indexOf("## Indexed Sections");
      expect(cmdIdx).toBeGreaterThan(-1);
      expect(secIdx).toBeGreaterThan(-1);
      expect(cmdIdx).toBeLessThan(secIdx);
    } finally {
      await stopServer(proc);
    }
  }, 30_000);
});

// ════════════════════════════════════════════════════════════════════════════
// Behaviour 5 — ctx_execute_file retains source identity
// ════════════════════════════════════════════════════════════════════════════
describe("issue #717 — ctx_execute_file retains source identity and audit access", () => {
  let projectDir: string;
  let dataFile: string;
  beforeAll(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), "echo-execfile-")));
    dataFile = join(projectDir, "sample.txt");
    writeFileSync(dataFile, "line1\nline2\nline3\n", "utf-8");
  });
  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("success path: response carries source digest and authorized audit reference", async () => {
    const proc = spawnServer({ CLAUDE_PROJECT_DIR: projectDir });
    try {
      await initServer(proc);
      const marker = `FILE-MARKER-${Math.random().toString(36).slice(2)}`;
      const code = `console.log("${marker}", FILE_CONTENT.split("\\n").length);`;
      const resp = await awaitRpc(proc, 101, {
        jsonrpc: "2.0", id: 101, method: "tools/call",
        params: { name: "ctx_execute_file", arguments: { path: "sample.txt", language: "javascript", code } },
      });
      expect(resp?.error).toBeUndefined();
      expect(resp?.result?.isError ?? false).toBe(false);
      const text = resp?.result?.content?.[0]?.text ?? "";
      expect(text).toContain('"language":"javascript"');
      expect(text).toContain('"sourceDigest":"' + createHash("sha256").update(code).digest("hex") + '"');
      expect(text).toContain('"report":"report-');
      expect(text).not.toContain(code);
      expect(resp?.result?.content?.map(part => part.text).join("\n")).toContain(marker);
    } finally {
      await stopServer(proc);
    }
  }, 30_000);
});
