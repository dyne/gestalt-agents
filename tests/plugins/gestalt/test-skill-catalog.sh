#!/usr/bin/env bash
set -Eeuo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd -P)
node --input-type=module - "$root" <<'JS'
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const { verifyGestaltSkillCatalog } = await import(pathToFileURL(join(root,
  'plugins/gestalt/scripts/verify-skill-catalog.mjs')));
const temporary = mkdtempSync(join(tmpdir(), 'gestalt-skill-catalog-'));
const pluginRoot = join(root, 'plugins/gestalt');
const catalog = readdirSync(join(pluginRoot, 'skills')).map(name => ({
  name: `gestalt:${name}`, enabled: true, path: join(pluginRoot, 'skills', name, 'SKILL.md'),
}));
assert.equal(catalog.length, 15);
const executable = join(temporary, 'codex');
writeFileSync(executable, `#!/usr/bin/env node
const { createInterface } = require('node:readline');
const { readFileSync } = require('node:fs');
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (!message.id) return;
  const result = message.method === 'skills/list'
    ? { data: [{ cwd: message.params.cwds[0], errors: [], skills: JSON.parse(readFileSync(process.env.CATALOG_FIXTURE)) }] }
    : {};
  process.stdout.write(JSON.stringify({ id: message.id, result }) + '\\n');
});
`);
chmodSync(executable, 0o755);
const fixture = join(temporary, 'catalog.json');
const verify = async skills => {
  writeFileSync(fixture, JSON.stringify(skills));
  return verifyGestaltSkillCatalog({ pluginRoot, workspace: temporary,
    environment: { ...process.env, PATH: `${temporary}:${process.env.PATH}`, CATALOG_FIXTURE: fixture } });
};
try {
  assert.match(await verify(catalog), /14 enabled fixed Gestalt skills and 1 conditional skill/);
  const disabled = catalog.map(skill => ({ ...skill, enabled: skill.name !== 'gestalt:xerj' }));
  assert.match(await verify(disabled), /1 conditional skill/);
  await assert.rejects(verify(catalog.filter(skill => skill.name !== 'gestalt:xerj')), /catalog mismatch/);
  await assert.rejects(verify([...catalog, catalog.find(skill => skill.name === 'gestalt:xerj')]), /duplicate/);
  await assert.rejects(verify(catalog.map(skill => ({ ...skill,
    enabled: skill.name !== 'gestalt:org-plan' }))), /disabled: gestalt:org-plan/);
  await assert.rejects(verify([...catalog, { name: 'gestalt:unknown', enabled: true }]), /catalog mismatch/);
  await assert.rejects(verify(catalog.map(skill => ({ ...skill,
    path: skill.name === 'gestalt:xerj' ? join(temporary, 'SKILL.md') : skill.path }))), /path mismatch/);
  console.log('7 capability-aware catalog cases passed');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
JS
