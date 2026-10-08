#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { withCodexRpc } from './codex-rpc.mjs';

const conditionalSkills = new Set(['gestalt:xerj', 'gestalt:serena']);

/** Verify that Codex advertises this exact installed Gestalt release. */
export async function verifyGestaltSkillCatalog({
  pluginRoot,
  workspace = process.cwd(),
  environment = process.env,
  timeoutMs = 15_000,
} = {}) {
  const canonicalRoot = resolve(pluginRoot);
  const skillsRoot = join(canonicalRoot, 'skills');
  const expected = new Map(
    (await readdir(skillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => [`gestalt:${entry.name}`, join(skillsRoot, entry.name, 'SKILL.md')]),
  );
  if (expected.size === 0) throw new Error(`no Gestalt skills found under ${skillsRoot}`);
  for (const path of expected.values()) {
    if (!existsSync(path)) throw new Error(`installed Gestalt skill is missing: ${path}`);
  }

  const canonicalWorkspace = resolve(workspace);
  const result = await withCodexRpc(
    (request) => request('skills/list', { cwds: [canonicalWorkspace], forceReload: true }),
    { workspace: canonicalWorkspace, environment, timeoutMs },
  );
  const entry = result?.data?.find((candidate) => candidate.cwd === canonicalWorkspace);
  if (!entry) throw new Error(`skills/list omitted workspace ${canonicalWorkspace}`);
  if (entry.errors?.length)
    throw new Error(`skills/list reported discovery errors: ${JSON.stringify(entry.errors)}`);
  const gestaltSkills = entry.skills.filter((skill) => skill.name.startsWith('gestalt:'));
  const byName = new Map();
  for (const skill of gestaltSkills) {
    if (byName.has(skill.name)) throw new Error(`duplicate Gestalt skill: ${skill.name}`);
    byName.set(skill.name, skill);
  }
  const expectedNames = [...expected.keys()].sort();
  const actualNames = [...byName.keys()].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames))
    throw new Error(
      `Gestalt skill catalog mismatch; expected ${expectedNames.join(', ')}; found ${actualNames.join(', ')}`,
    );
  for (const [name, expectedPath] of expected) {
    const skill = byName.get(name);
    // Conditional capabilities are discoverable, but effective session state is
    // decided alongside MCP readiness by the runtime launcher.
    if (!conditionalSkills.has(name) && skill.enabled !== true)
      throw new Error(`Gestalt skill is disabled: ${name}`);
    if (typeof skill.path !== 'string' || skill.path.length === 0)
      throw new Error(`Gestalt skill path is missing for ${name}`);
    if (resolve(skill.path) !== expectedPath)
      throw new Error(
        `Gestalt skill path mismatch for ${name}; expected ${expectedPath}; found ${skill.path}`,
      );
  }
  const conditional = [...conditionalSkills].filter((name) => expected.has(name)).length;
  return `verified ${expected.size - conditional} enabled fixed Gestalt skills and ${conditional} conditional skills in skills/list at ${canonicalRoot}`;
}
