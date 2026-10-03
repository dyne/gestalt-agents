#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';

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
  const child = spawn('codex', ['app-server', '--stdio'], {
    cwd: canonicalWorkspace,
    env: environment,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = createInterface({ input: child.stdout });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  let timer;
  try {
    const result = await new Promise((accept, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      timer = setTimeout(
        () => finish(reject, new Error('Codex skills/list timed out')),
        timeoutMs,
      );
      child.once('error', (error) => finish(reject, error));
      child.once('exit', (code, signal) =>
        finish(reject, new Error(`Codex app-server exited before skills/list (${code ?? signal})`)),
      );
      lines.on('line', (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.id === 1) {
          send({ method: 'initialized', params: {} });
          send({
            method: 'skills/list',
            id: 2,
            params: { cwds: [canonicalWorkspace], forceReload: true },
          });
        }
        if (message.id === 2) finish(accept, message.result);
      });
      send({
        method: 'initialize',
        id: 1,
        params: {
          clientInfo: { name: 'gestalt-skill-catalog-check', version: '1.0.0' },
          capabilities: null,
        },
      });
    });
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
      if (skill.enabled !== true) throw new Error(`Gestalt skill is disabled: ${name}`);
      if (typeof skill.path !== 'string' || skill.path.length === 0)
        throw new Error(`Gestalt skill path is missing for ${name}`);
      if (resolve(skill.path) !== expectedPath)
        throw new Error(
          `Gestalt skill path mismatch for ${name}; expected ${expectedPath}; found ${skill.path}`,
        );
    }
    return `verified ${expected.size} enabled Gestalt skills in skills/list at ${canonicalRoot}`;
  } finally {
    if (timer) clearTimeout(timer);
    lines.close();
    child.kill('SIGTERM');
  }
}
