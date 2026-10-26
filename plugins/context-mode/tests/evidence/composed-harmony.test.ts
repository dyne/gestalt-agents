import { expect, it } from 'vitest';
import { harmonyFixture, runComposedHarmony } from './composed-harmony.js';

it('composes routing, verified references, bounded failures and authorized reviewer reuse',()=>{
  const report=runComposedHarmony();
  expect(report.cases).toHaveLength(9);
  expect(report.limitation).toContain('does not prove real-model adherence');
  for(const c of report.cases) {
    expect(c.decision,c.id).toBe(c.id==='required-context-mode-failed'?'blocked':'failed');
    expect(c.failures,c.id).toHaveLength(c.id==='required-context-mode-failed'?0:2);
    expect(c.events.some(e=>['install','restart','switch-project','permission-bypass'].includes(e))).toBe(false);
  }
  expect(harmonyFixture.mobile.commit).toMatch(/^[a-f0-9]{40}$/);
  expect(JSON.stringify(harmonyFixture)).not.toMatch(/\/home\/|tool-harmony-mobile|credentials/);
});
