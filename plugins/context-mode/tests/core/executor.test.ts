import { describe, expect, test } from "vitest";
import {
  buildPowerShellScriptContent,
  PolyglotExecutor,
} from "../../src/executor.js";
import { detectRuntimes, type RuntimeMap } from "../../src/runtime.js";

describe("PowerShell script encoding", () => {
  test("prefixes a UTF-8 BOM ahead of the UTF-8 encoding prelude", () => {
    const script = buildPowerShellScriptContent("Write-Output 'ok'");

    // Windows PowerShell 5.1 only reliably detects a script as UTF-8 when the
    // file opens with a BOM; without it the body is read as the ANSI code page.
    expect(script.charCodeAt(0)).toBe(0xfeff);
    expect(script).toContain("[Console]::InputEncoding = [System.Text.UTF8Encoding]::new()");
    expect(script).toContain("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()");
    expect(script).toContain("$OutputEncoding = [System.Text.UTF8Encoding]::new()");
    expect(script.endsWith("Write-Output 'ok'")).toBe(true);
  });

  test.skipIf(process.platform !== "win32")(
    "preserves non-ASCII stdout and cwd through Windows PowerShell",
    async () => {
      const text = "日本語 café 한글 عربي עבריت Ελληνικά हिन्दी ไทย";
      const cwd = process.cwd();
      const runtimes: RuntimeMap = { ...detectRuntimes(), shell: "powershell.exe" };
      const executor = new PolyglotExecutor({ runtimes });

      const result = await executor.execute({
        language: "shell",
        code: `$text = '${text}'\nWrite-Output $text\n(Get-Location).Path`,
        cwd,
        timeout: 10_000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(text);
      expect(result.stdout).toContain(cwd);
    },
  );
});

// Downstream Live temp storage contract; process permissions remain external.
describe("Live executor temporary storage", () => {
  test("executes inside the configured app temp root without changing cwd", async () => {
    const { mkdtempSync, realpathSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const root = realpathSync(mkdtempSync(join(tmpdir(), "live-executor-")));
    const saved = [process.env.CONTEXT_MODE_LIVE_TEMP_DIR, process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS];
    try {
      process.env.CONTEXT_MODE_LIVE_TEMP_DIR = root;
      process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "1";
      const { vi } = await import("vitest");
      vi.resetModules();
      const { PolyglotExecutor: LiveExecutor } = await import("../../src/executor.js");
      const result = await new LiveExecutor({ projectRoot: root }).execute({ language: "javascript", code: "console.log(process.env.TMPDIR);console.log(process.cwd())", timeout: 10000 });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.split("\n")[0].startsWith(join(root, ".ctx-mode-"))).toBe(true);
      expect(result.stdout.trim().split("\n")[1]).toBe(root);
    } finally {
      for (const [index, key] of ["CONTEXT_MODE_LIVE_TEMP_DIR", "CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS"].entries()) {
        if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index];
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses a relative Live temp root instead of using ambient /tmp", async () => {
    const { vi } = await import("vitest");
    const saved = [process.env.CONTEXT_MODE_LIVE_TEMP_DIR, process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS];
    try {
      process.env.CONTEXT_MODE_LIVE_TEMP_DIR = "relative";
      process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "1";
      vi.resetModules();
      await expect(import("../../src/executor.js")).rejects.toThrow("Invalid Live executor temporary directory");
    } finally {
      for (const [index, key] of ["CONTEXT_MODE_LIVE_TEMP_DIR", "CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS"].entries()) {
        if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index];
      }
    }
  });
});
