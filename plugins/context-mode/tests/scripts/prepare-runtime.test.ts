import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const source = readFileSync(resolve(ROOT, "scripts", "prepare-runtime.mjs"), "utf8");
const preflight = readFileSync(
  resolve(ROOT, "scripts", "runtime-preflight.mjs"),
  "utf8",
);
const installer = readFileSync(resolve(ROOT, "scripts", "install-runtime.mjs"), "utf8");

describe("explicit runtime preparation", () => {
  it("owns dependency installation and bundle production outside start.mjs", () => {
    expect(source).toContain("installBuildDependencies");
    expect(source).toContain("buildRuntimeArtifacts");
    expect(preflight).toContain("server.bundle.mjs");
    expect(source).toContain("prepareRuntime");
  });

  it("awaits the external Bun probe before using that executable for install", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "context-mode-bun-probe-"));
    const executable = resolve(root, "bun", "bin", process.platform === "win32" ? "bun.exe" : "bun");
    mkdirSync(resolve(root, "bun", "bin"), { recursive: true });
    writeFileSync(executable, "controlled command capability fixture");
    const calls: { command: string; argv: string[] }[] = [];
    const { prepareRuntime } = await import("../../scripts/prepare-runtime.mjs");
    // No process is launched: this unit observes selection through the explicit
    // async seam. Native ownership proof belongs to the hosted integration.
    const context = {
      check() {}, canCleanup: () => true,
      protectLock: (_path: string, release: () => void) => release,
      async run(command: string, argv: string[]) {
        calls.push({ command, argv });
        if (argv[0] === "--version") { await Promise.resolve(); return "1.3"; }
        throw new Error("controlled install boundary");
      },
    };
    try {
      await expect(prepareRuntime(root, { commandContext: context, env: { ...process.env, BUN_INSTALL: resolve(root, "bun"), CONTEXT_MODE_PACKAGE_MANAGER: "bun" } })).rejects.toThrow("controlled install boundary");
      expect(calls).toEqual([
        { command: executable, argv: ["--version"] },
        { command: executable, argv: ["install", "--frozen-lockfile", "--ignore-scripts"] },
      ]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("uses the committed lockfile for deterministic npm preparation", () => {
    const lock = JSON.parse(readFileSync(resolve(ROOT, "package-lock.json"), "utf8"));
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages[""]?.name).toBe("context-mode");
    expect(source).toContain('["ci", "--no-audit", "--no-fund", "--ignore-scripts=true", "--include=optional"]');
  });

  it("permits only required native and bundler install scripts under npm", () => {
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(packageJson.allowScripts).toEqual({ "better-sqlite3": true, esbuild: true });
    expect(preflight).toContain("better_sqlite3.node");
  });

  it("stages and atomically publishes an external runtime", () => {
    expect(installer).toContain("getRuntimeRoot");
    expect(installer).toContain("publishRuntime");
    expect(installer).toContain("renameSync(stage, target)");
  });

  it("runs its CLI body when invoked through a symlinked plugin path", () => {
    const fixture = mkdtempSync(resolve(tmpdir(), "context-mode-symlink-"));
    try {
      const linkedPlugin = resolve(fixture, "context-mode");
      symlinkSync(ROOT, linkedPlugin, "dir");
      const result = spawnSync(
        process.execPath,
        [resolve(linkedPlugin, "scripts", "install-runtime.mjs"), "--check"],
        {
          encoding: "utf8",
          env: { ...process.env, GESTALT_HOME: resolve(fixture, "missing-runtime") },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("external runtime is not prepared");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
