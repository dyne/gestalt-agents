import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SOURCE = readFileSync(resolve(REPO_ROOT, "scripts", "ensure-source-build.mjs"), "utf8");

describe("ensure-source-build Bun selection", () => {
  it("uses Bun only after its executable responds successfully", () => {
    expect(SOURCE).toContain('execFileSync(candidate, ["--version"]');
    expect(SOURCE).toContain('return candidates.find((candidate) => {');
    expect(SOURCE).toContain('}) ?? null;');
  });
});
