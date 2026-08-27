#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  readFileSync(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'),
);
const version = manifest.version;
const gestaltHome = process.env.GESTALT_HOME || join(homedir(), '.gestalt');

if (!isAbsolute(gestaltHome)) {
  process.stderr.write(`[FAIL] GESTALT_HOME must be absolute: ${gestaltHome}\n`);
  process.exit(1);
}

const runtimeIdentity = `${process.platform}-${process.arch}-node-${process.versions.modules}`;
const runtimeRoot = join(gestaltHome, 'runtime', 'context-mode', version, runtimeIdentity);
const cli = join(runtimeRoot, 'cli.bundle.mjs');

if (!existsSync(cli)) {
  process.stderr.write(
    `[FAIL] context-mode ${version} runtime CLI is missing: ${cli}\n` +
      "Run 'gestalt update', restart that Codex profile, and retry ctx-doctor.\n",
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [cli, 'doctor'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CONTEXT_MODE_WORKSPACE: process.env.CONTEXT_MODE_WORKSPACE || process.cwd(),
  },
});

if (result.error) {
  process.stderr.write(`[FAIL] could not start context-mode doctor: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
