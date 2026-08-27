import { describe, expect, it } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const ROOT = resolve(__dirname, "..", "..");
const source = readFileSync(resolve(ROOT, "start.mjs"), "utf8");
const preflight = readFileSync(
  resolve(ROOT, "scripts", "runtime-preflight.mjs"),
  "utf8",
);

describe("prepared MCP launcher", () => {
  it("contains no install, build, repair, or detached child-process path", () => {
    expect(source).not.toMatch(/ensure-source-build|ensure-deps\.mjs/);
    expect(source).not.toMatch(/\bexec(?:File)?Sync\b|\bspawn\s*\(/);
    expect(source).not.toMatch(/npm\s+(?:install|rebuild|run)|npx\s+tsc/);
    expect(source).not.toMatch(/writeFileSync|mkdirSync|rmSync|unlinkSync|symlinkSync/);
    expect(source).not.toContain("prepare-runtime.mjs");
    expect(preflight).not.toMatch(/node:child_process|writeFileSync|mkdirSync|rmSync/);
  });

  it("fails fast when required prepared files are absent", () => {
    expect(source).toContain("CONTEXT_MODE_NOT_PREPARED");
    expect(source).toContain("gestalt-setup.sh");
    expect(source).toContain("server.bundle.mjs");
    expect(source).toContain("getRuntimeRoot");
  });

  it("requires the authoritative session workspace instead of inferring cwd", () => {
    const result = spawnSync(process.execPath, [resolve(ROOT, "start.mjs")], {
      cwd: ROOT,
      env: { ...process.env, CONTEXT_MODE_WORKSPACE: "", CONTEXT_MODE_PROJECT_DIR: ROOT, CODEX_HOME: "", CODEX_THREAD_ID: "" },
      encoding: "utf8",
      timeout: 2_000,
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain("CONTEXT_MODE_WORKSPACE_REQUIRED");
    expect(result.stderr).toContain("refusing to infer state from cwd");
  });

  it("recovers the workspace only from the matching bounded Codex session transcript", () => {
    const fixture = mkdtempSync(resolve(tmpdir(), "context-mode-codex-session-"));
    const codexHome = resolve(fixture, "codex-home");
    const workspace = resolve(fixture, "workspace");
    mkdirSync(resolve(codexHome, "sessions"), { recursive: true });
    mkdirSync(workspace);
    writeFileSync(resolve(codexHome, "sessions", "thread-1.jsonl"), JSON.stringify({ meta: { cwd: workspace } }) + "\n");
    try {
      const result = spawnSync(process.execPath, [resolve(ROOT, "start.mjs")], {
        cwd: ROOT,
        env: { ...process.env, CONTEXT_MODE_WORKSPACE: "", CODEX_HOME: codexHome, CODEX_THREAD_ID: "thread-1", GESTALT_HOME: resolve(fixture, "gestalt-home") },
        encoding: "utf8",
        timeout: 2_000,
      });
      expect(result.status).toBe(78);
      expect(result.stderr).toContain("CONTEXT_MODE_NOT_PREPARED");
      expect(result.stderr).not.toContain("CONTEXT_MODE_WORKSPACE_REQUIRED");
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });

  it("imports the prepared bundle only after preflight", () => {
    const check = source.indexOf("CONTEXT_MODE_NOT_PREPARED");
    const serverImport = source.indexOf('pathToFileURL(join(runtimeRoot, "server.bundle.mjs"))');
    expect(check).toBeGreaterThan(0);
    expect(serverImport).toBeGreaterThan(check);
  });

  it("exits quickly and predictably when the prepared manifest is absent", () => {
    const fixture = mkdtempSync(resolve(tmpdir(), "context-mode-preflight-"));
    try {
      mkdirSync(resolve(fixture, "scripts"));
      copyFileSync(resolve(ROOT, "start.mjs"), resolve(fixture, "start.mjs"));
      copyFileSync(
        resolve(ROOT, "scripts", "runtime-preflight.mjs"),
        resolve(fixture, "scripts", "runtime-preflight.mjs"),
      );
      copyFileSync(
        resolve(ROOT, "scripts", "runtime-location.mjs"),
        resolve(fixture, "scripts", "runtime-location.mjs"),
      );
      copyFileSync(
        resolve(ROOT, "scripts", "codex-profile.mjs"),
        resolve(fixture, "scripts", "codex-profile.mjs"),
      );
      writeFileSync(resolve(fixture, "package.json"), '{"version":"test"}\n');

      const started = Date.now();
      const result = spawnSync(process.execPath, [resolve(fixture, "start.mjs")], {
        cwd: fixture,
        env: { ...process.env, GESTALT_HOME: resolve(fixture, "gestalt-home"), CONTEXT_MODE_WORKSPACE: fixture },
        encoding: "utf8",
        timeout: 2_000,
      });

      expect(result.status).toBe(78);
      expect(result.stderr).toContain("CONTEXT_MODE_NOT_PREPARED");
      expect(result.stderr).toContain("gestalt-setup.sh");
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
