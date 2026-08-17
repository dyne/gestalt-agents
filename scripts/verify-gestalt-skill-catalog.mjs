#!/usr/bin/env node

import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const marketplaceRoot = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
const workspace = resolve(process.argv[3] ?? marketplaceRoot);
const skillsRoot = join(marketplaceRoot, 'plugins', 'gestalt', 'skills');
const expected = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => `gestalt:${entry.name}`)
  .sort();

if (expected.length === 0) throw new Error(`no Gestalt skills found under ${skillsRoot}`);

const child = spawn('codex', ['app-server', '--stdio'], {
  cwd: workspace,
  env: process.env,
  stdio: ['pipe', 'pipe', 'inherit'],
});
const lines = createInterface({ input: child.stdout });
const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
const timeout = setTimeout(() => {
  child.kill('SIGKILL');
}, 15_000);

try {
  const result = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      reject(new Error(`Codex app-server exited before skills/list (${code ?? signal})`));
    });
    lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        send({ method: 'initialized', params: {} });
        send({ method: 'skills/list', id: 2, params: { cwds: [workspace], forceReload: true } });
      }
      if (message.id === 2) accept(message.result);
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
  const entry = result?.data?.find((candidate) => candidate.cwd === workspace);
  if (!entry) throw new Error(`skills/list omitted workspace ${workspace}`);
  if (entry.errors?.length) {
    throw new Error(`skills/list reported discovery errors: ${JSON.stringify(entry.errors)}`);
  }
  const gestaltSkills = entry.skills.filter((skill) => skill.name.startsWith('gestalt:'));
  const actual = gestaltSkills.map((skill) => skill.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Gestalt skill catalog mismatch\nexpected: ${expected.join(', ')}\nactual:   ${actual.join(', ')}`,
    );
  }
  const disabled = gestaltSkills.filter((skill) => !skill.enabled).map((skill) => skill.name);
  if (disabled.length) throw new Error(`Gestalt skills are disabled: ${disabled.join(', ')}`);
  process.stdout.write(`verified ${actual.length} enabled Gestalt skills in skills/list\n`);
} finally {
  clearTimeout(timeout);
  lines.close();
  child.kill('SIGTERM');
}
