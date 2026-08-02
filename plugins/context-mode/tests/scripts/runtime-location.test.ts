import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getRuntimeRoot } from "../../scripts/runtime-location.mjs";

describe("external runtime location", () => {
  it("is deterministic for the package version and current Node ABI", () => {
    const fixture = mkdtempSync(join(tmpdir(), "context-mode-location-"));
    try {
      const plugin = join(fixture, "plugin");
      const gestaltHome = join(fixture, "gestalt-home");
      mkdirSync(plugin);
      writeFileSync(join(plugin, "package.json"), '{"version":"1.2.3-test.1"}\n');

      expect(getRuntimeRoot(plugin, { GESTALT_HOME: gestaltHome })).toBe(
        join(
          gestaltHome,
          "runtime",
          "context-mode",
          "1.2.3-test.1",
          `${process.platform}-${process.arch}-node-${process.versions.modules}`,
        ),
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a relative GESTALT_HOME", () => {
    const plugin = resolve(__dirname, "..", "..");
    expect(() => getRuntimeRoot(plugin, { GESTALT_HOME: "relative/path" })).toThrow(
      "GESTALT_HOME must be an absolute path",
    );
  });
});
