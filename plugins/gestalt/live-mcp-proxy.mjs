#!/usr/bin/env node
/** Host bridge: fixed manager dispatch or typed Org snapshot operations only. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { AdmissionError, executionAuthority, executionInputsCurrent, LIVE_SERVERS, managerEnvironment, nativeExitVerified } from "./live-admission.mjs";
import { orgLifecycle } from "./live-org-lifecycle.mjs";
import { handleLine } from "./org-plan-mcp-support.mjs";

const MAX_REQUEST = 262144, MAX_RESULT = 8 * 1024 * 1024;
const fail = (reason) => { throw new AdmissionError(reason); };
export function runContext(authority, request, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new AdmissionError("context-call-cancelled")); return; }
    const launchId = randomUUID();
    const child = spawn(authority.manager.path, ["live-policy", "run", "--manifest", authority.input.manifestPath, "--command", "context-mode-call", "--launch-id", launchId], {
      cwd: dirname(authority.input.manifestPath),
      env: managerEnvironment(authority.input.node, authority.manifest.runtimeHome),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = Buffer.alloc(0), revoked = false, closed = false;
    // The manager owns process groups/reaping. Killing only its owned caller
    // closes the private lifetime pipe; it never signals a borrowed project PID.
    const cancel = () => { revoked = true; child.kill("SIGTERM"); };
    signal?.addEventListener("abort", cancel, { once: true });
    const monitor = setInterval(() => { if (!executionInputsCurrent(authority)) cancel(); }, 500);
    const timeout = setTimeout(cancel, 125000);
    child.stdout.on("data", (bytes) => {
      if (output.length + bytes.length > MAX_RESULT) cancel();
      else output = Buffer.concat([output, bytes]);
    });
    child.stderr.resume(); // Never relay manager/host diagnostics to MCP clients.
    child.stdin.on("error", cancel);
    child.on("error", cancel);
    child.on("close", (code) => {
      closed = true; clearInterval(monitor); clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      try {
        if (revoked || code !== 0 || !nativeExitVerified(authority, launchId) || !executionInputsCurrent(authority)) fail("context-call-unavailable");
        const lines = output.toString("utf8").trim().split("\n");
        if (lines.length !== 1) fail("invalid-native-response");
        const result = JSON.parse(lines[0]);
        if (result.jsonrpc !== "2.0" || result.id !== request.id || (!Object.hasOwn(result, "result") && !Object.hasOwn(result, "error"))) fail("invalid-native-response");
        resolve(result);
      } catch (error) { reject(error instanceof AdmissionError ? error : new AdmissionError("invalid-native-response")); }
    });
    child.stdin.end(JSON.stringify(request));
    // Ensure cancellation remains effective even if the caller's stream closes.
    if (signal?.aborted && !closed) cancel();
  });
}
export async function liveRequest(bootstrapPath, server, line, options = {}) {
  const parsed = handleLine(line, (method, params) => ({ method, params }));
  if (!parsed || parsed.error) return parsed;
  try {
    if (!LIVE_SERVERS.includes(server)) fail("unknown-live-server");
    if (Buffer.byteLength(line) > MAX_REQUEST) fail("oversized-live-request");
    // Full controller/native authentication is renewed BEFORE each dispatch.
    const authority = executionAuthority(bootstrapPath);
    const { method, params } = parsed.result;
    if (server === "gestalt-org-plan") return { jsonrpc: "2.0", id: parsed.id, result: orgLifecycle(authority, method, params) };
    if (method === "ping") return { jsonrpc: "2.0", id: parsed.id, result: {} };
    if (!["initialize", "tools/list", "tools/call"].includes(method)) fail("unsupported-live-method");
    if (params.arguments?.background === true) fail("persistent-workers-unavailable");
    return await runContext(authority, { jsonrpc: "2.0", id: parsed.id, method, params }, options);
  } catch (error) {
    return { jsonrpc: "2.0", id: parsed.id, error: { code: -32000, message: error instanceof AdmissionError ? error.reason : "live-tool-unavailable" } };
  }
}
async function main() {
  const [bootstrapFlag, bootstrap, serverFlag, server, ...extra] = process.argv.slice(2);
  if (bootstrapFlag !== "--bootstrap" || serverFlag !== "--server" || extra.length || !LIVE_SERVERS.includes(server)) fail("invalid-live-proxy-command");
  // The controller launches this process with a reconstructed minimal env.
  if (Object.keys(process.env).some((key) => !["PATH", "HOME", "LANG"].includes(key))
    || process.env.PATH !== "/usr/bin:/bin") fail("unsafe-live-proxy-environment");
  executionAuthority(bootstrap);
  const cancellation = new AbortController();
  process.stdin.once("end", () => cancellation.abort());
  process.stdin.once("error", () => cancellation.abort());
  process.once("SIGTERM", () => cancellation.abort());
  process.once("SIGINT", () => cancellation.abort());
  let buffer = ""; const decoder = new StringDecoder("utf8");
  for await (const bytes of process.stdin) {
    buffer += decoder.write(bytes);
    if (Buffer.byteLength(buffer) > MAX_REQUEST) { cancellation.abort(); fail("oversized-live-request"); }
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n"), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      const response = await liveRequest(bootstrap, server, line, { signal: cancellation.signal });
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      if (cancellation.signal.aborted) return;
    }
  }
  cancellation.abort();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write("live-mcp-unavailable\n"); process.exitCode = 78; });
}
