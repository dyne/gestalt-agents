#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyGestaltSkillCatalog } from '../plugins/gestalt/scripts/verify-skill-catalog.mjs';
import { withCodexRpc } from '../plugins/gestalt/scripts/codex-rpc.mjs';
import { assessOrgPlanStartup } from '../plugins/gestalt/scripts/org-plan-preflight.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export async function verifySetupCatalog({ inputRoot = repositoryRoot, workspace = inputRoot, environment = process.env, commandContext, output = (text) => process.stdout.write(text) } = {}) {
inputRoot = resolve(inputRoot);
workspace = resolve(workspace);
let pluginRoot = inputRoot;
if (!existsSync(join(pluginRoot, '.codex-plugin', 'plugin.json'))) {
  const manifest = JSON.parse(
    readFileSync(join(inputRoot, 'plugins', 'gestalt', '.codex-plugin', 'plugin.json'), 'utf8'),
  );
  const marketplace = JSON.parse(
    readFileSync(join(inputRoot, '.agents', 'plugins', 'marketplace.json'), 'utf8'),
  );
  const codexHome = resolve(environment.CODEX_HOME || join(environment.HOME || environment.USERPROFILE || homedir(), '.codex'));
  pluginRoot = join(
    codexHome,
    'plugins',
    'cache',
    marketplace.name,
    manifest.name,
    manifest.version,
  );
}

  await output(`${await verifyGestaltSkillCatalog({ pluginRoot, workspace, environment, commandContext })}\n`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(pluginRoot, '.mcp.json'), 'utf8'));
  } catch {
    throw new Error('Org-plan MCP manifest could not be read');
  }
  const startup = await withCodexRpc(async (request) => {
    const response = await request('config/read', { includeLayers: false, cwd: workspace });
    return assessOrgPlanStartup({ config: response.config, manifest, environment });
  }, { workspace, environment, commandContext });
  if (!startup.ready) throw new Error(`Org-plan startup configuration conflict: ${startup.issues.map((issue) => `${issue.code}${issue.tool ? ` (${issue.tool})` : ''}`).join(', ')}`);
  await output('verified Org-plan MCP startup configuration\n');
}
function isDirectInvocation() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isDirectInvocation()) {
  try { await verifySetupCatalog({ inputRoot: process.argv[2] ?? repositoryRoot, workspace: process.argv[3] ?? process.argv[2] ?? repositoryRoot }); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
