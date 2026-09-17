import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

export interface McpProbeLaunch {
  command: string;
  args: string[];
  label: string;
}

export interface McpHandshakeResult {
  ok: boolean;
  detail: string;
  /** The first child exited cleanly before initialize, but one retry passed. */
  recoveredAfterRetry?: boolean;
}

interface McpHandshakeAttemptResult extends McpHandshakeResult {
  retryableEarlyCleanExit?: boolean;
}

interface JsonRpcResponse {
  id?: number;
  result?: {
    serverInfo?: { name?: string };
    tools?: Array<{ name?: string }>;
  };
  error?: { code?: number; message?: string };
}

const PROTOCOL_VERSION = "2024-11-05";
const STDERR_LIMIT = 400;

/**
 * Resolve the launcher a newly spawned executor would use. In a running Codex
 * MCP process, argv[1] is the configured context-mode bridge, so replay it
 * exactly. Source/package doctors fall back to the package launcher or bundle.
 */
export function resolveMcpProbeLaunch(
  pluginRoot: string,
  argv1 = process.argv[1],
): McpProbeLaunch | null {
  if (
    argv1 &&
    isAbsolute(argv1) &&
    basename(argv1) === "context-mode-mcp.mjs" &&
    existsSync(argv1)
  ) {
    return { command: process.execPath, args: [argv1], label: argv1 };
  }

  for (const candidate of [
    resolve(pluginRoot, "start.mjs"),
    resolve(pluginRoot, "server.bundle.mjs"),
    resolve(pluginRoot, "build", "server.js"),
  ]) {
    if (existsSync(candidate)) {
      return { command: process.execPath, args: [candidate], label: candidate };
    }
  }
  return null;
}

function compactStderr(stderr: string): string {
  return stderr.replace(/\s+/g, " ").trim().slice(0, STDERR_LIMIT);
}

function terminateChild(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill("SIGTERM"); } catch { return; }
  const forceKill = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill("SIGKILL"); } catch { /* best effort */ }
    }
  }, 500);
  forceKill.unref();
}

/**
 * Spawn a fresh MCP server and complete the same initialize -> initialized ->
 * tools/list exchange used by executor sessions. Never calls ctx_doctor in the
 * child, avoiding recursive diagnostics.
 */
function probeMcpHandshakeOnce(
  launch: McpProbeLaunch,
  timeoutMs: number,
): Promise<McpHandshakeAttemptResult> {
  return new Promise((resolveResult) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CONTEXT_MODE_DISABLE_VERSION_CHECK: "1",
      };
      // This process is a top-level diagnostic child, even when ctx_doctor was
      // invoked from a nested bridge. Inheriting bridge-only lifecycle state
      // can make the probe self-reap for reasons unrelated to normal Codex MCP
      // startup.
      delete env.CONTEXT_MODE_BRIDGE_DEPTH;
      delete env.CONTEXT_MODE_BRIDGE_IDLE_MS;
      child = spawn(launch.command, launch.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
    } catch (error) {
      resolveResult({ ok: false, detail: `could not spawn ${launch.label}: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    let settled = false;
    let phase: "initialize" | "tools/list" = "initialize";
    let stdout = "";
    let stderr = "";
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (result: McpHandshakeAttemptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      terminateChild(child);
      resolveResult(result);
    };

    const failureDetail = (reason: string) => {
      const diagnostic = compactStderr(stderr);
      return diagnostic ? `${reason} — ${diagnostic}` : reason;
    };

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_LIMIT * 2) stderr += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      let newline: number;
      while ((newline = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let response: JsonRpcResponse;
        try { response = JSON.parse(line) as JsonRpcResponse; } catch { continue; }

        if (response.id === 1 && phase === "initialize") {
          if (response.error) {
            finish({ ok: false, detail: failureDetail(`initialize error: ${response.error.message ?? response.error.code ?? "unknown"}`) });
            return;
          }
          if (response.result?.serverInfo?.name !== "context-mode") {
            finish({ ok: false, detail: failureDetail("initialize returned unexpected server identity") });
            return;
          }
          phase = "tools/list";
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
          continue;
        }

        if (response.id === 2 && phase === "tools/list") {
          if (response.error) {
            finish({ ok: false, detail: failureDetail(`tools/list error: ${response.error.message ?? response.error.code ?? "unknown"}`) });
            return;
          }
          const names = response.result?.tools?.map((tool) => tool.name) ?? [];
          if (!names.includes("ctx_doctor")) {
            finish({ ok: false, detail: failureDetail("tools/list omitted ctx_doctor") });
            return;
          }
          finish({ ok: true, detail: "initialize + tools/list passed (ctx_doctor available)" });
          return;
        }
      }
    });

    child.on("error", (error) => {
      finish({ ok: false, detail: failureDetail(`spawn error: ${error.message}`) });
    });
    child.stdin.on("error", (error) => {
      finish({ ok: false, detail: failureDetail(`stdin closed during ${phase}: ${error.message}`) });
    });
    child.on("close", (code, signal) => {
      if (!settled) {
        const status = signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`;
        const provenance = `launcher ${launch.label}; pid ${child.pid ?? "unknown"}`;
        finish({
          ok: false,
          detail: failureDetail(`connection closed during ${phase} (${status}); ${provenance}`),
          retryableEarlyCleanExit: phase === "initialize" && signal === null && code === 0,
        });
      }
    });

    timeout = setTimeout(() => {
      finish({ ok: false, detail: failureDetail(`timed out during ${phase} after ${timeoutMs}ms`) });
    }, timeoutMs);

    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "ctx-doctor-spawn-probe", version: "1.0" },
      },
    }) + "\n");
  });
}

/**
 * Spawn a fresh MCP server and complete the same initialize -> initialized ->
 * tools/list exchange used by executor sessions. A clean exit before the first
 * initialize response is retried once: runtime repair/session turnover can
 * briefly close a disposable probe without proving the installed MCP is bad.
 */
export async function probeMcpHandshake(
  launch: McpProbeLaunch,
  timeoutMs = 8_000,
): Promise<McpHandshakeResult> {
  const first = await probeMcpHandshakeOnce(launch, timeoutMs);
  if (!first.retryableEarlyCleanExit) return first;

  const second = await probeMcpHandshakeOnce(launch, timeoutMs);
  if (second.ok) {
    return {
      ok: true,
      recoveredAfterRetry: true,
      detail: `${second.detail}; recovered on retry after transient clean exit`,
    };
  }
  return {
    ok: false,
    detail: `${first.detail}; retry also failed — ${second.detail}`,
  };
}
