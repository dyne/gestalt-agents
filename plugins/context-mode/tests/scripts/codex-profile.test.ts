import { describe, expect, it } from "vitest";
import { join, sep } from "node:path";
import {
  ensureCodexHome,
  inferCodexHomeFromPluginRoot,
} from "../../scripts/codex-profile.mjs";

describe("Codex profile resolution", () => {
  it("derives CODEX_HOME from an installed plugin cache root", () => {
    const codexHome = join(sep, "home", "gestalt", ".codex-gestalt");
    const pluginRoot = join(
      codexHome,
      "plugins",
      "cache",
      "dyne-gestalt-agents",
      "context-mode",
      "1.0.169-dyne.4",
    );

    expect(inferCodexHomeFromPluginRoot(pluginRoot)).toBe(codexHome);
  });

  it("does not infer a profile from a development checkout", () => {
    expect(inferCodexHomeFromPluginRoot("/work/gestalt-agents/plugins/context-mode")).toBeNull();
  });

  it("preserves an explicit CODEX_HOME", () => {
    const env = { CODEX_HOME: "/explicit/profile" };

    expect(ensureCodexHome("/other/plugins/cache/vendor/context-mode/1", env)).toBe("/explicit/profile");
    expect(env.CODEX_HOME).toBe("/explicit/profile");
  });
});
