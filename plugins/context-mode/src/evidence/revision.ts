/** Revision keys identify bytes and declared execution inputs, never freshness or approval. */
import { createHash } from 'node:crypto';
import { z } from 'zod';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sha = z.string().regex(/^[a-fA-F0-9]{40}$/);
export const candidateRevisionSchema = z.object({
  sha: sha.optional(), branch: z.string().min(1).max(200).optional(), base: sha.optional(),
  dirtySha256: sha256.optional(), dependencyConfigSha256: sha256.optional(), environmentSha256: sha256.optional(),
}).strict();

export const revisionDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Caller enumerates the complete relevant scope, including untracked files and deletions.
 * Null means deleted, not unreadable. Authorization/read failures must abort collection.
 * Environment records should contain digests of relevant values, never credentials.
 */
export function revisionEntriesDigest(repository: string, entries: readonly {path: string; sha256: string | null}[]): string {
  if (!repository || entries.some(e => !e.path || e.sha256 !== null && !sha256.safeParse(e.sha256).success)
    || new Set(entries.map(e => e.path)).size !== entries.length) throw new Error('invalid revision entries');
  return revisionDigest(['revision-entries-v1', repository, [...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    .map(e => [e.path, e.sha256])]);
}

export function sourceRevision(repository: string, path: string, contentSha256: string): {key: string; repository: string; path: string; sha256: string} {
  if (!repository || !path || !sha256.safeParse(contentSha256).success) throw new Error('invalid source revision');
  return {key: revisionDigest(['source-v1', repository, path, contentSha256]), repository, path, sha256: contentSha256};
}

/** Null keys fail closed when any required identity is missing. No age-based validity. */
export function resultRevision(input: {
  candidate?: Record<string, unknown>; source: Record<string, unknown>; sourceKey: string;
  command?: string; cwd?: string; exit: number | null;
}): {key: string | null; reason: string; authority: string} {
  const parsed = candidateRevisionSchema.safeParse(input.candidate);
  const c = parsed.success ? parsed.data : undefined;
  const local = input.source.kind === 'local';
  const remote = input.source.kind === 'github' && typeof input.source.host === 'string'
    && ['run', 'attempt'].every(k => Number.isSafeInteger(input.source[k]) && Number(input.source[k]) > 0)
    && Number.isSafeInteger(input.source.job) && Number(input.source.job) > 0
    && typeof input.source.headSha === 'string' && input.source.headSha.toLowerCase() === c?.sha?.toLowerCase();
  const complete = c?.sha && c.branch && c.dirtySha256 && c.dependencyConfigSha256 && c.environmentSha256
    && input.command && input.cwd && typeof input.source.repository === 'string' && input.source.repository
    && input.exit !== null && Number.isSafeInteger(input.exit)
    && (local || remote) && sha256.safeParse(input.sourceKey).success;
  const authority = 'declared candidate inputs; independently verify scope and references; key does not establish remote freshness';
  if (!complete) return {key: null, reason: 'incomplete candidate, execution or source identity', authority};
  return {key: revisionDigest(['result-v1', input.sourceKey, c.sha!.toLowerCase(), c.branch,
    c.dirtySha256, c.dependencyConfigSha256, input.command, input.cwd, input.exit, c.environmentSha256,
    input.source.kind, input.source.repository, local ? null : [input.source.host, input.source.run, input.source.attempt, input.source.job]]),
    reason: 'identity only; reauthorize and verify current bytes before reuse', authority};
}
