export interface SessionScratchContext {
  schemaVersion: 1 | 2;
  workspacePath: string;
  ownerId: string;
  directory: string;
  markerPath: string;
  runtime?: {
    directory: string;
    token: string;
    identity: string;
  };
}
export const SESSION_TMP_CONTEXT: string;
export const SESSION_SCRATCH_GUIDANCE: string;
export function resolveSessionScratch(environment?: NodeJS.ProcessEnv): SessionScratchContext | null;
export function createTaskDirectory(workspace?: string, environment?: NodeJS.ProcessEnv): string;
export function resolveScratchDirectory(fallback?: () => string): string;
export function scratchEnvironment(environment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function borrowSessionScratch(environment?: NodeJS.ProcessEnv): { release(): void } | null;
