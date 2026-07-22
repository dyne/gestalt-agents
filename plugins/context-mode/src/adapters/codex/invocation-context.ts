import { isPluginInstallPath } from "../../util/project-dir.js";

/**
 * The sole authorization input for a Codex MCP request. Adapters construct it
 * from host-owned metadata; tool handlers consume it without consulting cwd or
 * a process-global "latest session" fallback.
 */
export interface CodexInvocationContext {
  sessionId: string;
  activeRoot: string;
  workspaceRoots: readonly string[];
  source: "mcp-metadata" | "hook-rendezvous" | "legacy";
  correlationId?: string;
  expiresAtMs?: number;
}

export type CodexInvocationContextFailure =
  | "invalid-session-id"
  | "invalid-active-root"
  | "invalid-workspace-root"
  | "plugin-root"
  | "active-root-not-authorized"
  | "correlation-required"
  | "expiry-required"
  | "expired";

export type CodexInvocationContextResult =
  | { ok: true; value: CodexInvocationContext }
  | { ok: false; reason: CodexInvocationContextFailure };

type CanonicalizeRoot = (root: string) => string;

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Canonicalizes and validates the authorization boundary before any MCP tool
 * handler runs. Legacy contexts deliberately cannot grant an external root;
 * later request-boundary work can still use them for non-file operations.
 */
export function createCodexInvocationContext(
  input: CodexInvocationContext,
  canonicalize: CanonicalizeRoot,
  nowMs = Date.now(),
): CodexInvocationContextResult {
  if (!hasText(input.sessionId)) return { ok: false, reason: "invalid-session-id" };
  if (!hasText(input.activeRoot)) return { ok: false, reason: "invalid-active-root" };
  if (input.workspaceRoots.length === 0) return { ok: false, reason: "invalid-workspace-root" };

  const activeRoot = canonicalize(input.activeRoot);
  if (isPluginInstallPath(activeRoot)) return { ok: false, reason: "plugin-root" };

  const workspaceRoots: string[] = [];
  for (const root of input.workspaceRoots) {
    if (!hasText(root)) return { ok: false, reason: "invalid-workspace-root" };
    const canonicalRoot = canonicalize(root);
    if (isPluginInstallPath(canonicalRoot)) return { ok: false, reason: "plugin-root" };
    if (!workspaceRoots.includes(canonicalRoot)) workspaceRoots.push(canonicalRoot);
  }
  if (!workspaceRoots.includes(activeRoot)) return { ok: false, reason: "active-root-not-authorized" };

  const usesRendezvous = input.source === "hook-rendezvous";
  if (usesRendezvous && !hasText(input.correlationId)) return { ok: false, reason: "correlation-required" };
  if (usesRendezvous && input.expiresAtMs === undefined) return { ok: false, reason: "expiry-required" };
  if (input.expiresAtMs !== undefined && input.expiresAtMs <= nowMs) return { ok: false, reason: "expired" };

  return {
    ok: true,
    value: {
      sessionId: input.sessionId,
      activeRoot,
      workspaceRoots,
      source: input.source,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.expiresAtMs !== undefined ? { expiresAtMs: input.expiresAtMs } : {}),
    },
  };
}

/** A child may receive a new session identity but never a broader root set. */
export function inheritCodexInvocationContext(
  parent: CodexInvocationContext,
  sessionId: string,
): CodexInvocationContext {
  return {
    ...parent,
    sessionId,
    workspaceRoots: [...parent.workspaceRoots],
  };
}
