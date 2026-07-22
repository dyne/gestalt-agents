import { describe, expect, it } from "vitest";
import {
  createCodexInvocationContext,
  inheritCodexInvocationContext,
  type CodexInvocationContext,
} from "../../src/adapters/codex/invocation-context.js";
import { codexHookContextFixture, codexMcpMetadataFixture } from "../fixtures/codex-invocation-context.js";

const canonicalize = (root: string) => root.replace("/symlink-project", "/project").replace(/\/+$/, "") || "/";

function context(overrides: Partial<CodexInvocationContext> = {}): CodexInvocationContext {
  return {
    sessionId: "session-1",
    activeRoot: "/project",
    workspaceRoots: ["/project"],
    source: "mcp-metadata",
    ...overrides,
  };
}

describe("Codex invocation context", () => {
  it("keeps current hook and future MCP metadata fixtures explicit", () => {
    expect(codexHookContextFixture).toMatchObject({
      session_id: "codex-session-1",
      cwd: "/workspace/project",
      turn_id: "turn-1",
    });
    expect(codexMcpMetadataFixture).toEqual({
      sessionId: "codex-session-1",
      activeRoot: "/workspace/project",
      workspaceRoots: ["/workspace/project"],
    });
  });

  it("canonicalizes one active root and keeps its provenance", () => {
    const result = createCodexInvocationContext(context(), canonicalize, 100);
    expect(result).toEqual({ ok: true, value: context() });
  });

  it("keeps multi-root workspaces separate while authorizing the active member", () => {
    const result = createCodexInvocationContext(context({
      activeRoot: "/workspace/b",
      workspaceRoots: ["/workspace/a", "/workspace/b"],
    }), canonicalize, 100);
    expect(result).toEqual({
      ok: true,
      value: context({
        activeRoot: "/workspace/b",
        workspaceRoots: ["/workspace/a", "/workspace/b"],
      }),
    });
  });

  it("canonicalizes a symlinked root before matching authorization", () => {
    const result = createCodexInvocationContext(context({
      activeRoot: "/symlink-project",
      workspaceRoots: ["/project"],
    }), canonicalize, 100);
    expect(result).toEqual({ ok: true, value: context() });
  });

  it("rejects a root that is not an exact authorized workspace member", () => {
    const result = createCodexInvocationContext(context({
      activeRoot: "/workspace/project-child",
      workspaceRoots: ["/workspace/project"],
    }), canonicalize, 100);
    expect(result).toEqual({ ok: false, reason: "active-root-not-authorized" });
  });

  it("never accepts a plugin cache root because it was the process cwd", () => {
    const pluginRoot = "/home/user/.codex/plugins/cache/context-mode/context-mode/1.0.169";
    const result = createCodexInvocationContext(context({
      activeRoot: pluginRoot,
      workspaceRoots: [pluginRoot],
    }), canonicalize, 100);
    expect(result).toEqual({ ok: false, reason: "plugin-root" });
  });

  it("requires a single-use correlation and expiry for hook rendezvous", () => {
    expect(createCodexInvocationContext(context({ source: "hook-rendezvous" }), canonicalize, 100))
      .toEqual({ ok: false, reason: "correlation-required" });
    expect(createCodexInvocationContext(context({
      source: "hook-rendezvous", correlationId: "opaque", expiresAtMs: 100,
    }), canonicalize, 100)).toEqual({ ok: false, reason: "expired" });
    expect(createCodexInvocationContext(context({
      source: "hook-rendezvous", correlationId: "opaque", expiresAtMs: 101,
    }), canonicalize, 100)).toEqual({
      ok: true,
      value: context({ source: "hook-rendezvous", correlationId: "opaque", expiresAtMs: 101 }),
    });
  });

  it("gives sibling subagents distinct sessions without broadening their roots", () => {
    const parent = context({ workspaceRoots: ["/workspace/a", "/workspace/b"] });
    const first = inheritCodexInvocationContext(parent, "child-one");
    const second = inheritCodexInvocationContext(parent, "child-two");

    (first.workspaceRoots as string[]).pop();
    expect(second).toEqual(context({ sessionId: "child-two", workspaceRoots: ["/workspace/a", "/workspace/b"] }));
  });
});
