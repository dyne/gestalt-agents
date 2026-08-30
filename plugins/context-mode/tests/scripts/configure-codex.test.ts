import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureCodexIntegration,
  reconcileCodexHooks,
  reconcileCodexToml,
} from "../../scripts/configure-codex.mjs";

const temporaryDirectories: string[] = [];
const pluginId = "context-mode@dyne-gestalt-agents";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "context mode configure "));
  temporaryDirectories.push(root);
  const codexHome = join(root, "Codex home");
  const gestaltHome = join(root, "Gestalt home");
  const pluginRoot = join(root, "plugin cache", "context-mode", "2.5.1");
  mkdirSync(join(pluginRoot, "hooks"), { recursive: true });
  mkdirSync(gestaltHome, { recursive: true });
  writeFileSync(join(pluginRoot, "package.json"), JSON.stringify({ version: "2.5.1" }));
  writeFileSync(join(pluginRoot, "start.mjs"), "// MCP server\n");
  writeFileSync(join(pluginRoot, "hooks", "runtime-hook.mjs"), "// hook\n");
  return { codexHome, gestaltHome, pluginRoot };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("Codex context-mode integration configurator", () => {
  it("refuses a non-versioned cache fixture before it can replace the live launcher", async () => {
    const paths = await fixture();
    const invalidRoot = join(paths.pluginRoot, "..", "test");
    mkdirSync(join(invalidRoot, "hooks"), { recursive: true });
    writeFileSync(join(invalidRoot, "package.json"), JSON.stringify({ version: "test" }));
    writeFileSync(join(invalidRoot, "start.mjs"), "// test\n");
    writeFileSync(join(invalidRoot, "hooks", "runtime-hook.mjs"), "// test\n");

    expect(() => configureCodexIntegration({ ...paths, pluginRoot: invalidRoot, pluginId })).toThrow(
      "context-mode plugin root must end with its package version",
    );
    expect(existsSync(join(paths.codexHome, "bin", "context-mode-mcp.mjs"))).toBe(false);
  });

  it("creates a fresh registration, hooks, and space-safe launchers", async () => {
    const paths = await fixture();
    const result = configureCodexIntegration({ ...paths, pluginId });

    const config = readFileSync(result.configPath, "utf8");
    expect(config).toContain("[features]\nhooks = true");
    expect(config).toContain("[mcp_servers.context-mode]");
    expect(config).toContain(`args = [${JSON.stringify(result.launcherPath)}]`);
    expect(config).toContain("required = true");
    expect(config).toContain(`[plugins.${JSON.stringify(pluginId)}]\nenabled = false`);
    expect(readFileSync(result.launcherPath, "utf8")).toContain(
      `process.env.CONTEXT_MODE_WORKSPACE ||= process.cwd()`,
    );
    expect(readFileSync(result.hookLauncherPath, "utf8")).toContain(paths.pluginRoot);
    expect(statSync(result.launcherPath).mode & 0o111).not.toBe(0);

    const hooks = JSON.parse(readFileSync(result.hooksPath, "utf8"));
    expect(Object.keys(hooks.hooks)).toEqual([
      "PreToolUse",
      "PostToolUse",
      "SessionStart",
      "PreCompact",
      "UserPromptSubmit",
      "Stop",
    ]);
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toBe(
      `: 'context-mode hook codex sessionstart'; node '${result.hookLauncherPath}' sessionstart`,
    );
  });

  it("upgrades a config with no MCP section while preserving unrelated TOML", () => {
    const output = reconcileCodexToml(
      'approval_policy = "never"\n\n[features]\nexperimental = true\n',
      { launcherPath: "/tmp/context mode/mcp.mjs", pluginId },
    );
    expect(output).toContain('approval_policy = "never"');
    expect(output).toContain("experimental = true");
    expect(output).toContain("hooks = true");
    expect(output.match(/\[mcp_servers\.context-mode]/g)).toHaveLength(1);
  });

  it("upgrades missing hook configuration and preserves unrelated hook entries", () => {
    const source = JSON.stringify({
      custom: { preserved: true },
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "node unrelated.mjs" }] }],
      },
    });
    const output = JSON.parse(reconcileCodexHooks(source, "/tmp/context mode/hook.mjs"));
    expect(output.custom).toEqual({ preserved: true });
    expect(output.hooks.SessionStart).toHaveLength(2);
    expect(output.hooks.SessionStart[0].hooks[0].command).toBe("node unrelated.mjs");
  });

  it("repairs partial and legacy registrations without duplicating managed entries", () => {
    const source = `
[features]
hooks = false

[mcp_servers]
context-mode = { command = "context-mode" }

[mcp_servers."context-mode"]
command = "old"

[plugins."${pluginId}".mcp_servers.context-mode]
enabled = true
`;
    const output = reconcileCodexToml(source, { launcherPath: "/new/mcp.mjs", pluginId });
    expect(output.match(/^hooks = true$/gm)).toHaveLength(1);
    expect(output.match(/\[mcp_servers\.context-mode]/g)).toHaveLength(1);
    expect(output).not.toContain('command = "old"');
    expect(output).not.toContain('context-mode = { command = "context-mode" }');
    expect(output.match(/mcp_servers\.context-mode]/g)).toHaveLength(1);
    expect(output).toContain(`[plugins."${pluginId}"]\nenabled = false`);
  });

  it("replaces legacy context-mode hooks but keeps hooks owned by others", () => {
    const source = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "context-mode hook codex stop" }] },
          { hooks: [{ type: "command", command: "node keep-this.mjs" }] },
        ],
      },
      preserved: 42,
    });
    const output = JSON.parse(reconcileCodexHooks(source, "/new/context-mode-hook.mjs"));
    expect(output.preserved).toBe(42);
    expect(output.hooks.Stop).toHaveLength(2);
    expect(output.hooks.Stop[0].hooks[0].command).toBe("node keep-this.mjs");
    expect(output.hooks.Stop[1].hooks[0].command).toContain("/new/context-mode-hook.mjs");
  });

  it("is byte-idempotent after upgrading a partially configured installation", async () => {
    const paths = await fixture();
    mkdirSync(paths.codexHome, { recursive: true });
    writeFileSync(join(paths.codexHome, "config.toml"), 'model = "gpt-5.5"\n');
    writeFileSync(join(paths.codexHome, "hooks.json"), '{"unrelated":true}\n');
    const first = configureCodexIntegration({ ...paths, pluginId });
    const snapshot = first.changed.map((path) => [path, readFileSync(path, "utf8")] as const);

    const second = configureCodexIntegration({ ...paths, pluginId });
    expect(second.changed).toEqual([]);
    for (const [path, contents] of snapshot) expect(readFileSync(path, "utf8")).toBe(contents);
  });
});
