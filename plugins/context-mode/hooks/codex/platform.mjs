process.env.CONTEXT_MODE_PLATFORM = "codex";
try {
  await import("../../scripts/ensure-source-build.mjs");
} catch (error) {
  // Published/hook-only fixtures already ship generated bundles and may omit
  // the source-build helper. Real build failures must still stop the hook.
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
