/** Current Codex hook payload shape observed by the adapter. */
export const codexHookContextFixture = {
  session_id: "codex-session-1",
  cwd: "/workspace/project",
  turn_id: "turn-1",
  tool_use_id: "tool-1",
  hook_event_name: "PreToolUse",
};

/**
 * Desired request metadata contract. Current Codex MCP calls do not supply
 * this object, so the later rendezvous adapter must produce the equivalent
 * invocation context with a short-lived correlation id instead.
 */
export const codexMcpMetadataFixture = {
  sessionId: "codex-session-1",
  activeRoot: "/workspace/project",
  workspaceRoots: ["/workspace/project"],
};
