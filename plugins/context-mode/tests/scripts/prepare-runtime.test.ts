import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const source = readFileSync(resolve(ROOT, "scripts", "prepare-runtime.mjs"), "utf8");
const preflight = readFileSync(
  resolve(ROOT, "scripts", "runtime-preflight.mjs"),
  "utf8",
);

describe("explicit runtime preparation", () => {
  it("owns dependency installation and bundle production outside start.mjs", () => {
    expect(source).toContain("installBuildDependencies");
    expect(source).toContain("buildRuntimeArtifacts");
    expect(preflight).toContain("server.bundle.mjs");
    expect(source).toContain("prepareRuntime");
  });

  it("probes Bun before selecting it", () => {
    expect(source).toContain('execFileSync(candidate, ["--version"]');
  });
});
