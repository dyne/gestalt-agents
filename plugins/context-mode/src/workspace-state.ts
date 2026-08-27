/**
 * Canonical location for mutable context-mode state in a Codex session.
 *
 * The prepared runtime, plugin cache, CODEX_HOME, and GESTALT_HOME are shared
 * installation concerns.  They must never become a source of project data.
 */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export const WORKSPACE_ENV = "CONTEXT_MODE_WORKSPACE" as const;
export const WORKSPACE_STATE_RELATIVE = join(".gestalt", "context-mode");

function isRoot(path: string): boolean {
  return resolve(path) === resolve(path, "..");
}

function inside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Resolve an existing session workspace without consulting cwd, git, home, or
 * any installation directory.  Realpath makes aliases deterministic and lets
 * us reject a pre-existing `.gestalt` symlink before writing through it.
 */
export function resolveWorkspaceStateRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[WORKSPACE_ENV];
  if (!raw || raw.trim() === "") return null;
  if (!isAbsolute(raw)) throw new Error(`${WORKSPACE_ENV} must be an absolute workspace path.`);

  const workspace = realpathSync.native(resolve(raw));
  if (isRoot(workspace)) throw new Error(`${WORKSPACE_ENV} must not be a filesystem root.`);
  const gestalt = join(workspace, ".gestalt");
  if (existsSync(gestalt) && lstatSync(gestalt).isSymbolicLink()) {
    throw new Error(`refusing context-mode state through symlinked workspace .gestalt: ${gestalt}`);
  }
  const root = join(gestalt, "context-mode");
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) {
    throw new Error(`refusing context-mode state through symlinked workspace root: ${root}`);
  }
  if (!inside(workspace, root)) throw new Error(`context-mode state escapes workspace: ${root}`);
  return root;
}

/** Parent data directory used by adapters that append `context-mode`. */
export function resolveWorkspaceDataRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const root = resolveWorkspaceStateRoot(env);
  return root ? resolve(root, "..") : null;
}
