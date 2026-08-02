import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MANIFEST = ".context-mode-prepared.json";

export const REQUIRED_FILES = [
  "start.mjs",
  join("scripts", "runtime-preflight.mjs"),
  "server.bundle.mjs",
  "cli.bundle.mjs",
  join("hooks", "security.bundle.mjs"),
  join("hooks", "session-db.bundle.mjs"),
  join("hooks", "session-extract.bundle.mjs"),
  join("hooks", "session-attribution.bundle.mjs"),
  join("hooks", "session-snapshot.bundle.mjs"),
  join("hooks", "codex-usage.bundle.mjs"),
  join("node_modules", "better-sqlite3", "package.json"),
  join("node_modules", "turndown", "package.json"),
  join("node_modules", "turndown-plugin-gfm", "package.json"),
  join("node_modules", "@mixmark-io", "domino", "package.json"),
];

const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

export function verifyPreparedRuntime(pluginRoot) {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(pluginRoot, MANIFEST), "utf8"));
  } catch {
    return { ok: false, problems: [MANIFEST] };
  }
  if (manifest.schemaVersion !== 1) problems.push(`${MANIFEST}:schema`);

  let packageVersion = "unknown";
  try {
    packageVersion = JSON.parse(
      readFileSync(join(pluginRoot, "package.json"), "utf8"),
    ).version;
  } catch {
    problems.push("package.json");
  }
  if (manifest.packageVersion !== packageVersion) {
    problems.push(`${MANIFEST}:version`);
  }

  for (const relative of REQUIRED_FILES) {
    const absolute = join(pluginRoot, relative);
    if (!existsSync(absolute)) {
      problems.push(relative);
    } else {
      try {
        if (manifest.files?.[relative] !== sha256(absolute)) {
          problems.push(`${relative}:hash`);
        }
      } catch {
        problems.push(`${relative}:unreadable`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}
