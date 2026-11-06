import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { composeStartup, readStartupContract } from '../../../plugins/gestalt/scripts/startup-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const plugin = resolve(root, 'plugins/gestalt');
const contract = await readStartupContract(plugin);
const hash = text => createHash('sha256').update(text).digest('hex');
const begin = '<!-- gestalt:startup:v1 -->';
const end = '<!-- /gestalt:startup -->';
const canonical = `${begin}\n${contract.text}${end}`;
const user = 'USER_SENTINEL_α\nKeep my custom instructions.\n';
const project = 'REPOSITORY_SENTINEL_β\n';

test('canonical golden text stays concise with exact resolvable core skill references', async () => {
  assert.equal(contract.status, 'ready');
  assert.equal(hash(contract.text), '160d98edd064e6a6fcc26f370ab58998c2cb967d1a653875871993ca396d6686');
  assert.equal(contract.text.trim().split(/\s+/u).length, 284);
  assert.ok(contract.text.trim().split(/\s+/u).length <= contract.descriptor.maxWords);
  const names = ['coding', 'development-testing', 'systematic-debugging',
    'verification-before-completion', 'org-plan', 'xerj', 'serena'];
  const links = [...contract.text.matchAll(/\[\$gestalt:([^\]]+)\]\(([^)]+)\)/gu)];
  assert.deepEqual(links.map(match => match[1]), names);
  for (const [, name, path] of links) {
    assert.equal(path, `../skills/${name}/SKILL.md`);
    assert.match(await readFile(resolve(plugin, 'startup', path), 'utf8'), new RegExp(`name: ${name}\\n`));
  }
  assert.doesNotMatch(contract.text, /model_instructions_file|baseInstructions|personality|You are Codex|tool schemas:|ctx-doctor|ctx-index/u);
  assert.match(contract.text, /mandatory governing reads and role startup order still apply/u);
  assert.match(contract.text, /catalog is not loaded/u);
  assert.match(contract.text, /source test, installed\s+delivery and observed model adoption are separate claims/u);
  const documentation = await readFile(resolve(plugin, 'startup/README.md'), 'utf8');
  for (const [, target] of documentation.matchAll(/\]\(([^)]+)\)/gu)) {
    if (!target.startsWith('https:')) await readFile(resolve(plugin, 'startup', target));
  }
  assert.equal(contract.descriptor.composer, 'scripts/startup-contract.mjs');
});

test('instruction routing preserves native reads and authorized semantic edits; reversed rules fail', () => {
  function assertEditRouting(text) {
    const normalized = text.replace(/\s+/gu, ' ');
    assert.match(normalized, /Keep exact known-file lookup, governing and pre-edit reads, Git and ordinary filesystem writes native\./u);
    assert.match(normalized, /Prefer verified, authorized Serena structured edits when its skill and permissions support them\./u);
    assert.doesNotMatch(normalized, /(?:Git and|all) mutations native/u);
  }
  assertEditRouting(contract.text);
  const reversed = contract.text.replace(/Git and ordinary\s+filesystem writes native\./u, 'Git and mutations native.');
  assert.notEqual(reversed, contract.text);
  assert.throws(() => assertEditRouting(reversed), assert.AssertionError);
  const bypass = contract.text.replace('when its skill and permissions support them.', 'regardless of permissions.');
  assert.notEqual(bypass, contract.text);
  assert.throws(() => assertEditRouting(bypass), assert.AssertionError);
});

test('one additive block preserves effective user bytes and separate repository instructions', () => {
  const config = { developer_instructions: user, model_instructions_file: 'USER_CUSTOM_BASE', personality: 'USER_SETTING' };
  const repository = project;
  const composed = { ...config, developer_instructions: composeStartup(config.developer_instructions, contract) };
  assert.equal(composed.developer_instructions, `${user}\n\n${canonical}`);
  assert.equal(composed.model_instructions_file, config.model_instructions_file);
  assert.equal(composed.personality, config.personality);
  assert.equal(repository, project);
  assert.equal(composeStartup(composed.developer_instructions, contract), composed.developer_instructions);
  assert.equal(composeStartup('', contract), canonical);
});

test('replace and deduplicate only complete owned blocks while retaining surrounding bytes', () => {
  const old = `${begin}\nold owned text\n${end}`;
  const unrelated = '<!-- other-owner -->leave unchanged<!-- /other-owner -->';
  assert.equal(composeStartup(`${user}${old}\n${unrelated}\n${old}${project}`, contract),
    `${user}${canonical}\n${unrelated}\n${project}`);
});

test('ambiguous, nested and newer owned blocks fail without changing input', () => {
  for (const value of [`${user}${begin}unterminated`, `${user}${end}`,
    `${user}<!-- gestalt:startup:v2 -->newer${end}`,
    `${begin}${begin}nested${end}${end}`]) {
    const before = hash(value);
    assert.throws(() => composeStartup(value, contract), /Unsupported or malformed/u);
    assert.equal(hash(value), before);
  }
});

test('selected installed package bytes work without the source checkout and older packages preserve input', async () => {
  const installed = await mkdtemp(resolve(tmpdir(), 'gestalt-startup-package-'));
  try {
    const absent = await readStartupContract(installed);
    assert.deepEqual(absent, { status: 'unavailable', reason: 'missing-contract' });
    assert.equal(composeStartup(user, absent), user);
    await cp(resolve(plugin, 'startup'), resolve(installed, 'startup'), { recursive: true });
    await cp(resolve(plugin, 'scripts/startup-contract.mjs'), resolve(installed, 'composer.mjs'));
    await cp(resolve(plugin, 'gestalt-startup-contract.json'), resolve(installed, 'gestalt-startup-contract.json'));
    const installedLibrary = await import(pathToFileURL(resolve(installed, 'composer.mjs')).href);
    const delivered = await installedLibrary.readStartupContract(installed);
    assert.equal(delivered.text, contract.text);
    assert.equal(installedLibrary.composeStartup(user, delivered), composeStartup(user, contract));
    await writeFile(resolve(installed, 'gestalt-startup-contract.json'), JSON.stringify({ schemaVersion: 1 }));
    const older = await readStartupContract(installed);
    assert.deepEqual(older, { status: 'unavailable', reason: 'unsupported-contract' });
    assert.equal(composeStartup(user, older), user);
    await writeFile(resolve(installed, 'gestalt-startup-contract.json'), JSON.stringify({ schemaVersion: 2 }));
    assert.deepEqual(await readStartupContract(installed), { status: 'unavailable', reason: 'unsupported-contract' });
    await writeFile(resolve(installed, 'gestalt-startup-contract.json'), JSON.stringify({ ...contract.descriptor, source: '../outside' }));
    await assert.rejects(readStartupContract(installed), /Invalid Gestalt startup descriptor/u);
    await writeFile(resolve(installed, 'gestalt-startup-contract.json'), JSON.stringify(contract.descriptor));
    await rm(resolve(installed, 'startup/bootstrap.md'));
    await assert.rejects(readStartupContract(installed), { code: 'ENOENT' });
  } finally {
    await rm(installed, { recursive: true, force: true });
  }
});

test('delivery accounting keeps synthetic capture separate from repository inventory and live host receipt', () => {
  const effective = composeStartup(user, contract);
  const capture = { kind: 'synthetic-composition', textBytes: Buffer.byteLength(contract.text),
    blockBytes: Buffer.byteLength(canonical), effectiveBytes: Buffer.byteLength(effective),
    effectiveSha256: hash(effective), hostDeliveredBytes: null, modelAdherence: 'unobserved' };
  assert.equal(capture.textBytes, 2463);
  assert.equal(capture.blockBytes, 2516);
  assert.equal(capture.effectiveBytes, Buffer.byteLength(user) + 2 + capture.blockBytes);
  assert.match(capture.effectiveSha256, /^[a-f0-9]{64}$/u);
  assert.equal(capture.hostDeliveredBytes, null);
  assert.equal(capture.modelAdherence, 'unobserved');
});

// Executable consumer acceptance fixtures, not implementations of either host.
// Native resolution is an input: never flatten synthetic lower-priority scalars.
const deliveryFixture = JSON.parse(await readFile(resolve(plugin, 'startup/delivery-scenarios.json'), 'utf8'));
assert.equal(deliveryFixture.schemaVersion, 1);
assert.equal(deliveryFixture.evidenceKind, 'synthetic-delivery-contract');
const roles = await (async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'startup-role-fixture-'));
  try {
    execFileSync('bash', [resolve(plugin, 'skills/org-plan/scripts/org-plan'),
      'prepare-supervision', '--agents-dir', directory], { stdio: 'pipe' });
    return JSON.parse(execFileSync('python3', ['-c',
      'import json,pathlib,sys,tomllib; p=pathlib.Path(sys.argv[1]); print(json.dumps({r:tomllib.loads((p/("org-plan-"+r+".toml")).read_text())["developer_instructions"] for r in ["executor","reviewer"]}))',
      directory], { encoding: 'utf8' }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
})();
const captures = [];
const blockCount = value => (JSON.stringify(value).match(/<!-- gestalt:startup:v\d+ -->/gu) ?? []).length;

// Assemble current package inputs using the real composer/generated profiles.
// Capability availability is synthetic; this is not either host's adapter or a
// claim that a connected provider has current repository/semantic coverage.
const routingSources = Object.fromEntries(await Promise.all(['xerj', 'serena', 'context-mode'].map(async name =>
  [name, await readFile(resolve(plugin, `skills/${name}/SKILL.md`), 'utf8')])));
const routingCaptures = [];
function sourceRoutingCapture(context, xerj, serena) {
  const role = context === 'root' ? roles.reviewer : context === 'executor' ? roles.executor : '';
  return {
    context, role,
    developerInstructions: composeStartup(user + (role ? `\n\n${role}` : ''), contract),
    implicitRouting: routingSources['context-mode'],
    capabilities: Object.fromEntries(Object.entries({ xerj, serena }).map(([name, available]) => [name, {
      available, loadedPath: available ? `skills/${name}/SKILL.md` : null,
      guidance: available ? routingSources[name] : '',
      notice: available ? '' : `${name} unavailable; earlier capability guidance inactive; use native tools.`,
      repositoryCoverage: null, symbolReadiness: null, referenceReadiness: null,
    }])),
  };
}

function assertSourceRoutingCapture(capture, expected) {
  const role = expected.context === 'root' ? roles.reviewer : expected.context === 'executor' ? roles.executor : '';
  assert.equal(capture.context, expected.context);
  assert.equal(capture.role, role);
  assert.equal(capture.developerInstructions, composeStartup(user + (role ? `\n\n${role}` : ''), contract));
  assert.equal(blockCount(capture.developerInstructions), 1);
  assert.equal(capture.implicitRouting, routingSources['context-mode']);
  assert.match(capture.implicitRouting, /prefer lexical XERJ.*fresh index coverage/u);
  assert.doesNotMatch(capture.developerInstructions, /Use native tools for instructions, bounded reads, edits, mutations/u);
  if (role) assert.match(role, /Follow the context-mode routing contract for source discovery, native reads\/writes and evidence analysis/u);
  for (const name of ['xerj', 'serena']) {
    const capability = capture.capabilities[name];
    assert.equal(capability.available, expected[name]);
    assert.equal(capability.loadedPath, expected[name] ? `skills/${name}/SKILL.md` : null);
    assert.equal(capability.guidance, expected[name] ? routingSources[name] : '');
    for (const field of ['repositoryCoverage', 'symbolReadiness', 'referenceReadiness']) assert.equal(capability[field], null);
    assert.ok(capture.developerInstructions.includes(`[$gestalt:${name}](../skills/${name}/SKILL.md)`));
    if (!expected[name]) {
      assert.match(capability.notice, /unavailable; earlier capability guidance inactive; use native tools/u);
      continue;
    }
    assert.equal(capability.notice, '');
    assert.ok(Buffer.byteLength(capability.guidance) < 16_384, 'host guidance size limit');
    const description = /^description: (.+)$/mu.exec(capability.guidance)?.[1];
    if (name === 'xerj') {
      assert.match(description, /bounded lexical queries.*broad or repeated source discovery.*fresh covered repositories/u);
      assert.match(capability.guidance.replace(/\s+/gu, ' '), /perform `xerj_search`.*task-specific lexical query/u);
      assert.match(capability.guidance, /Mapping is preparation, not the retrieval result/u);
    } else {
      assert.match(description, /Navigate symbols, trace references.*structured code edits/u);
      assert.match(capability.guidance, /Local extraction suffices; unrelated callers are not a prerequisite/u);
      assert.match(capability.guidance, /Interface changes also require verified references/u);
      assert.match(capability.guidance, /A denied tool call is not permission to retry through another transport/u);
    }
  }
}

for (const context of ['root', 'executor', 'solo']) {
  for (const xerj of [true, false]) for (const serena of [true, false]) {
    test(`source routing delivery: ${context}/xerj-${xerj}/serena-${serena}`, () => {
      const expected = { context, xerj, serena };
      const capture = sourceRoutingCapture(context, xerj, serena);
      assertSourceRoutingCapture(capture, expected);
      // Provider state never changes the stable scalar or appends workflow text
      // to it. On-demand/capability bytes are disclosed separately.
      const unavailable = sourceRoutingCapture(context, false, false);
      assert.equal(capture.developerInstructions, unavailable.developerInstructions);
      routingCaptures.push({ id: `${context}/${xerj}/${serena}`, context,
        evidenceKind: 'synthetic-source-routing-delivery',
        scalarBytes: Buffer.byteLength(capture.developerInstructions),
        scalarWords: capture.developerInstructions.trim().split(/\s+/u).length,
        scalarSha256: hash(capture.developerInstructions),
        implicitBytes: Buffer.byteLength(capture.implicitRouting),
        capabilities: Object.fromEntries(Object.entries(capture.capabilities).map(([name, value]) => [name, {
          available: value.available, loadedPath: value.loadedPath, guidanceBytes: Buffer.byteLength(value.guidance),
          guidanceSha256: value.guidance ? hash(value.guidance) : null,
          repositoryCoverage: value.repositoryCoverage, symbolReadiness: value.symbolReadiness,
          referenceReadiness: value.referenceReadiness,
        }])), liveHostDelivery: false, modelAdherence: 'unobserved' });
    });
  }
}

test('source routing delivery rejects stale guidance, probes-only text, caller gates and coverage promotion', () => {
  const expected = { context: 'root', xerj: true, serena: true };
  const ready = sourceRoutingCapture('root', true, true);
  assertSourceRoutingCapture(ready, expected);
  const damaged = [
    value => { value.capabilities.xerj.guidance = value.capabilities.xerj.guidance.replace('perform `xerj_search`', 'stop after `xerj_map`'); },
    value => { value.capabilities.serena.guidance = value.capabilities.serena.guidance.replace('Local extraction suffices; unrelated callers are not a prerequisite', 'Verify callers before every body lookup'); },
    value => { value.capabilities.serena.referenceReadiness = 'ready'; },
    value => { value.implicitRouting = ''; },
    value => { value.developerInstructions += `\n${canonical}`; },
    value => { value.capabilities.xerj.loadedPath = 'other-checkout/skills/xerj/SKILL.md'; },
  ];
  for (const mutate of damaged) {
    const capture = structuredClone(ready);
    mutate(capture);
    assert.throws(() => assertSourceRoutingCapture(capture, expected), assert.AssertionError);
  }
  const unavailable = sourceRoutingCapture('solo', false, false);
  assertSourceRoutingCapture(unavailable, { context: 'solo', xerj: false, serena: false });
  unavailable.capabilities.serena.guidance = routingSources.serena;
  assert.throws(() => assertSourceRoutingCapture(unavailable, { context: 'solo', xerj: false, serena: false }), assert.AssertionError);
});

function composeDeliveryFixture(input, nativeResolved, before) {
  const after = structuredClone(before);
  let diagnostic = null;
  const fresh = input.boundary === 'fresh';
  const refresh = input.boundary === 'explicit-refresh';
  if (refresh && (!input.idle || !input.refreshSupported)) diagnostic = 'refresh-not-admitted';
  else if (fresh || refresh) {
    if (input.skillsIncluded === false || (input.channel === 'hook' && input.hooksEnabled === false)) {
      diagnostic = 'delivery-disabled';
    } else if (input.channel === 'hook' && blockCount(after.developerInstructions)) {
      // Another effective channel already owns the block. Never stack a hook
      // copy over it or silently rewrite the native scalar to migrate it.
      if (!after.developerInstructions.includes(canonical) || blockCount(after.developerInstructions) !== 1) {
        diagnostic = 'migration-required';
      }
    } else {
      const selected = input.package === 'missing' ? { status: 'unavailable', reason: 'missing-contract' } : contract;
      if (selected.status !== 'ready') diagnostic = selected.reason;
      else {
        try {
          if (input.channel === 'hook') {
            after.hookOutputs = [{ event: input.hookEvent ?? 'SessionStart',
              text: composeStartup(after.hookOutputs.map(output => output.text).join(''), selected) }];
          } else after.developerInstructions = composeStartup(after.developerInstructions, selected);
        } catch {
          diagnostic = 'composition-error';
        }
      }
    }
  } else if (blockCount(before) > 1) diagnostic = 'migration-required';
  // Dynamic hints are a separate capture, never a statement of source readiness.
  const capability = { generation: 'SYNTHETIC_CURRENT_RUNTIME',
    connectionAvailable: input.provider !== 'unavailable', repositoryCoverage: null,
    symbolReadiness: null, inheritedToolBindings: false };
  return { nativeResolved, after, capability, diagnostic };
}

for (const input of deliveryFixture.cases) {
  test(`synthetic delivery: ${input.id}`, () => {
    const layers = { system: 'SYSTEM_SENTINEL', user, profile: 'PROFILE_SENTINEL',
      project: 'PROJECT_CONFIG_SENTINEL', cli: 'CLI_OVERRIDE_SENTINEL' };
    const nativeResolved = { selectedLayer: input.effectiveLayer,
      developerInstructions: layers[input.effectiveLayer], layers,
      repositoryInstructions: project, baseInstructions: 'NATIVE_FOUNDATION_SENTINEL',
      userOverrides: { model_instructions_file: 'USER_CUSTOM_BASE', personality: 'USER_CHOICE' } };
    const nativeBeforeHash = hash(JSON.stringify(nativeResolved));
    const role = roles[input.role] ?? '';
    const scalar = nativeResolved.developerInstructions + (role ? `\n\n${role}` : '');
    const earlier = `${begin}\nSYNTHETIC_EARLIER_TEXT\n${end}`;
    const retained = { current: canonical, earlier, duplicate: `${canonical}\n${canonical}`,
      newer: '<!-- gestalt:startup:v2 -->\nSYNTHETIC_NEWER_TEXT\n<!-- /gestalt:startup -->', none: '' }[input.retained ?? 'none'];
    const scalarBlock = input.existingScalar === 'current' ? canonical : input.existingScalar === 'earlier' ? earlier : '';
    const before = { developerInstructions: scalar + (scalarBlock ? `\n\n${scalarBlock}` :
      input.channel === 'developer' && retained ? `\n\n${retained}` : ''),
      hookOutputs: input.channel === 'hook' && retained ? [{ event: 'SessionStart', text: retained }] : [],
      repositoryInstructions: nativeResolved.repositoryInstructions,
      baseInstructions: nativeResolved.baseInstructions,
      userOverrides: structuredClone(nativeResolved.userOverrides), userPrompt: 'TASK_SENTINEL' };
    const beforeBytes = JSON.stringify(before);
    const result = composeDeliveryFixture(input, nativeResolved, before);
    const delivered = JSON.stringify(result.after);
    assert.equal(blockCount(result.after), input.expectedBlocks);
    assert.equal(result.diagnostic, input.diagnostic ?? null);
    assert.equal(hash(JSON.stringify(nativeResolved)), nativeBeforeHash);
    assert.equal(JSON.stringify(before), beforeBytes, 'parent/durable input changed');
    assert.equal(result.after.repositoryInstructions, project);
    assert.equal(result.after.baseInstructions, 'NATIVE_FOUNDATION_SENTINEL');
    assert.deepEqual(result.after.userOverrides, before.userOverrides);
    assert.equal(result.after.userPrompt, 'TASK_SENTINEL', 'bootstrap appended to recurring prompt');
    if (result.after.hookOutputs.length && !input.unchanged) {
      assert.equal(result.after.hookOutputs[0].event, input.hookEvent ?? 'SessionStart');
    }
    assert.ok(result.after.developerInstructions.startsWith(scalar));
    for (const [layer, value] of Object.entries(layers)) {
      if (layer !== input.effectiveLayer) assert.ok(!result.after.developerInstructions.includes(value), layer);
    }
    if (input.unchanged) assert.equal(delivered, beforeBytes);
    else if (input.expectedBlocks === 1) assert.ok(delivered.includes(JSON.stringify(contract.text).slice(1, -1)));
    if (role) {
      assert.ok(result.after.developerInstructions.includes(role), 'generated role addition lost');
      assert.match(role, /First tool call: read the org-plan skill completely and do nothing else/u);
      assert.match(role, /supervised-execution reference and governing AGENTS.md/u);
      if (input.role === 'reviewer') assert.match(role, /checkpoint/iu);
      else assert.match(role, /At each DONE L2.*remain assigned/u);
      assert.equal((result.after.developerInstructions.match(/First tool call:/gu) ?? []).length, 1);
    }
    assert.equal(result.capability.connectionAvailable, input.provider !== 'unavailable');
    assert.equal(result.capability.repositoryCoverage, null);
    assert.equal(result.capability.symbolReadiness, null);
    assert.equal(result.capability.inheritedToolBindings, false);
    captures.push({ id: input.id, evidenceKind: deliveryFixture.evidenceKind,
      selectedLayer: input.effectiveLayer, boundary: input.boundary, channel: input.channel,
      beforeSha256: hash(beforeBytes), afterSha256: hash(delivered),
      nativeResolvedSha256: nativeBeforeHash, roleSha256: role ? hash(role) : null,
      deliveredBytes: Buffer.byteLength(delivered), bootstrapBlocks: blockCount(result.after),
      capability: result.capability, diagnostic: result.diagnostic,
      liveHostDelivery: false, modelAdherence: 'unobserved' });
  });
}

test('synthetic capture export retains structural hashes only', async () => {
  assert.equal(captures.length, deliveryFixture.cases.length);
  assert.equal(new Set(captures.map(capture => capture.id)).size, captures.length);
  assert.equal(routingCaptures.length, 12);
  assert.equal(new Set(routingCaptures.map(capture => capture.id)).size, routingCaptures.length);
  const report = JSON.stringify({ schemaVersion: 1, cases: captures, routingCases: routingCaptures }, null, 2);
  assert.doesNotMatch(report, /USER_SENTINEL|PROFILE_SENTINEL|TASK_SENTINEL|First tool call:|developerInstructions/u);
  if (process.env.STARTUP_CAPTURE_PATH) await writeFile(process.env.STARTUP_CAPTURE_PATH, report + '\n');
});
