/** Codex is the only packaged host. */
const PLATFORM_ENV_VARS_MIRROR = [
  ["codex", ["CODEX_THREAD_ID", "CODEX_CI"]],
];

export function detectPlatformFromEnv(_env = process.env) {
  return "codex";
}

export { PLATFORM_ENV_VARS_MIRROR };
