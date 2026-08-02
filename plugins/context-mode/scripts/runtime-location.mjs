import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

function safeSegment(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._+-]+$/.test(value)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return value;
}

export function getGestaltHome(env = process.env) {
  const configured = env.GESTALT_HOME;
  if (!configured) return join(homedir(), ".gestalt");
  if (!isAbsolute(configured)) {
    throw new Error(`GESTALT_HOME must be an absolute path: ${configured}`);
  }
  return configured;
}

export function getRuntimeIdentity(pluginRoot) {
  const packageVersion = safeSegment(
    JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8")).version,
    "context-mode version",
  );
  const platform = safeSegment(process.platform, "platform");
  const arch = safeSegment(process.arch, "architecture");
  const modulesAbi = safeSegment(process.versions.modules, "Node modules ABI");
  return { packageVersion, platform, arch, modulesAbi };
}

export function getRuntimeRoot(pluginRoot, env = process.env) {
  const { packageVersion, platform, arch, modulesAbi } = getRuntimeIdentity(pluginRoot);
  return join(
    getGestaltHome(env),
    "runtime",
    "context-mode",
    packageVersion,
    `${platform}-${arch}-node-${modulesAbi}`,
  );
}
