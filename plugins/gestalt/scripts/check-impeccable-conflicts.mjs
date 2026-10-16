#!/usr/bin/env node
// Read-only preflight: never disable another plugin or remove a user's skill.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function impeccableConflicts({ home, codexHome, gestaltHome, cwd }) {
  const roots = new Set([
    join(home, '.agents/skills'), join(home, '.codex/skills'),
    join(codexHome, 'skills'), join(gestaltHome, '.agents/skills'),
  ]);
  for (let current = resolve(cwd); ; current = dirname(current)) {
    roots.add(join(current, '.agents/skills'));
    roots.add(join(current, '.codex/skills'));
    // Project discovery stops at the repository; user skills use HOME above.
    if (existsSync(join(current, '.git')) || dirname(current) === current) break;
  }
  const conflicts = new Set();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const skill = join(root, entry, 'SKILL.md');
      if (!existsSync(skill)) continue;
      const text = readFileSync(skill, 'utf8');
      const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
      if (/^name:\s*["']?(?:impeccable|impeccable:impeccable)["']?\s*$/m.test(frontmatter))
        conflicts.add(skill);
    }
  }
  const config = join(codexHome, 'config.toml');
  if (existsSync(config)) {
    // Codex plugin tables are [plugins."name@marketplace"]. Conservative for
    // unfamiliar TOML spellings: report a potential conflict instead of editing.
    const sections = readFileSync(config, 'utf8').split(/(?=^\s*\[)/m);
    for (const section of sections) {
      const active = section.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
      if (/\bimpeccable@/.test(active) && !/^\s*enabled\s*=\s*false\s*(?:#.*)?$/m.test(active))
        conflicts.add(`${config}: standalone Impeccable plugin configuration`);
    }
  }
  return [...conflicts].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [home, codexHome, gestaltHome, cwd] = process.argv.slice(2);
    if (![home, codexHome, gestaltHome, cwd].every((value) => value?.startsWith('/')))
      throw new Error('absolute profile and workspace paths are required');
    const conflicts = impeccableConflicts({ home, codexHome, gestaltHome, cwd });
    if (conflicts.length) {
      console.error('gestalt-setup: standalone Impeccable conflicts with bundled gestalt:impeccable:');
      for (const conflict of conflicts) console.error(`  ${conflict}`);
      console.error('Choose one provider and explicitly remove/disable the conflicting provider, then rerun setup. No skills or plugins were changed by this check.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`gestalt-setup: cannot verify Impeccable conflicts: ${error.message}`);
    process.exitCode = 1;
  }
}
