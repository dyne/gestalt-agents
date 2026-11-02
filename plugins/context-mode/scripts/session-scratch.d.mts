export interface SessionScratchContext {
  schemaVersion: 1;
  workspacePath: string;
  ownerId: string;
  directory: string;
  markerPath: string;
}
export const SESSION_TMP_CONTEXT: string;
export const SESSION_SCRATCH_GUIDANCE: string;
export function resolveSessionScratch(environment?: NodeJS.ProcessEnv): SessionScratchContext | null;
export function resolveScratchDirectory(fallback?: () => string): string;
export function scratchEnvironment(environment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
