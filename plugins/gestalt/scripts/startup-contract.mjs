import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// packageRoot comes from the consumer's selected installed plugin discovery.
// This library does not discover packages, write config, or deliver instructions.
export async function readStartupContract(packageRoot) {
  let descriptor;
  try {
    descriptor = JSON.parse(await readFile(resolve(packageRoot, 'gestalt-startup-contract.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'unavailable', reason: 'missing-contract' };
    throw error;
  }
  if (descriptor.schemaVersion !== 1 || descriptor.blockVersion !== 1) {
    return { status: 'unavailable', reason: 'unsupported-contract' };
  }
  if (descriptor.owner !== 'gestalt-agents' || descriptor.blockId !== 'gestalt:startup' ||
      descriptor.source !== 'startup/bootstrap.md' || descriptor.maxWords !== 350) {
    throw new Error('Invalid Gestalt startup descriptor');
  }
  const text = await readFile(resolve(packageRoot, descriptor.source), 'utf8');
  if (!text.trim() || text.trim().split(/\s+/u).length > descriptor.maxWords ||
      text.includes('<!--')) throw new Error('Invalid Gestalt startup text');
  return { status: 'ready', descriptor, text };
}

// Call only with the one effective scalar selected by native configuration.
// Never concatenate competing user/project/profile values here.
export function composeStartup(effectiveInstructions, contract) {
  if (typeof effectiveInstructions !== 'string') throw new TypeError('Expected effective instruction string');
  if (contract.status !== 'ready') return effectiveInstructions;
  const block = `<!-- gestalt:startup:v1 -->\n${contract.text}<!-- /gestalt:startup -->`;
  const managed = /<!-- gestalt:startup:v(\d+) -->[\s\S]*?<!-- \/gestalt:startup -->/gu;
  const matches = [...effectiveInstructions.matchAll(managed)];
  // Reject ambiguous ownership without changing any user bytes.
  const outside = effectiveInstructions.replace(managed, '');
  if ((effectiveInstructions.match(/<!-- gestalt:startup/gu) ?? []).length !== matches.length ||
      (effectiveInstructions.match(/<!-- \/gestalt:startup/gu) ?? []).length !== matches.length ||
      matches.some(match => match[1] !== '1') || outside.includes('<!-- gestalt:startup') ||
      outside.includes('<!-- /gestalt:startup')) throw new Error('Unsupported or malformed Gestalt startup block');
  if (!matches.length) return effectiveInstructions + (effectiveInstructions ? '\n\n' : '') + block;
  let first = true;
  return effectiveInstructions.replace(managed, () => {
    if (!first) return '';
    first = false;
    return block;
  });
}
