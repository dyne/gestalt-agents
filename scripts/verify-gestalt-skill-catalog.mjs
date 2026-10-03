#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyGestaltSkillCatalog } from '../plugins/gestalt/scripts/verify-skill-catalog.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const inputRoot = resolve(process.argv[2] ?? repositoryRoot);
const workspace = resolve(process.argv[3] ?? inputRoot);
let pluginRoot = inputRoot;
if (!existsSync(join(pluginRoot, '.codex-plugin', 'plugin.json'))) {
  const manifest = JSON.parse(
    readFileSync(join(inputRoot, 'plugins', 'gestalt', '.codex-plugin', 'plugin.json'), 'utf8'),
  );
  const marketplace = JSON.parse(
    readFileSync(join(inputRoot, '.agents', 'plugins', 'marketplace.json'), 'utf8'),
  );
  const codexHome = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  pluginRoot = join(
    codexHome,
    'plugins',
    'cache',
    marketplace.name,
    manifest.name,
    manifest.version,
  );
}

try {
  process.stdout.write(`${await verifyGestaltSkillCatalog({ pluginRoot, workspace })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
