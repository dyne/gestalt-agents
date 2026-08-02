import { resolve, sep } from "node:path";

export function inferCodexHomeFromPluginRoot(pluginRoot) {
  const absolute = resolve(pluginRoot);
  const marker = `${sep}plugins${sep}cache${sep}`;
  const markerIndex = absolute.lastIndexOf(marker);
  return markerIndex > 0 ? absolute.slice(0, markerIndex) : null;
}

export function ensureCodexHome(pluginRoot, env = process.env) {
  if (env.CODEX_HOME) return env.CODEX_HOME;
  const inferred = inferCodexHomeFromPluginRoot(pluginRoot);
  if (inferred) env.CODEX_HOME = inferred;
  return inferred;
}
