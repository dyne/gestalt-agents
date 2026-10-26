/** Offline contract composition; synthetic routing does not prove model adherence. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { digest } from '../../src/evidence/github.js';
import { evidenceFollowup, ingestEvidence, type IngestOptions } from '../../src/evidence/extract.js';
import { ContentStore } from '../../src/store.js';

const repository = resolve(import.meta.dirname, '../../../..');
export const harmonyFixture = JSON.parse(readFileSync(join(repository, 'tests/plugins/gestalt/fixtures/context-evidence-workflows.json'), 'utf8')).composedHarmony;

export function runComposedHarmony() {
  const routing = JSON.parse(execFileSync('python3', [join(repository, 'tests/plugins/gestalt/composed-harmony.py')], { encoding: 'utf8' }));
  assert.equal(harmonyFixture.version, 1);
  assert.deepEqual(routing.map((r:any) => r.id), harmonyFixture.cases.map((c:any) => c.id));
  const results = [];
  for (const c of harmonyFixture.cases) {
    const route = routing.find((r:any) => r.id === c.id);
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'composed-evidence-')));
    const events = [...route.events];
    const store = new ContentStore(join(root, 'index.db'));
    try {
      for (const [path, source] of Object.entries(route.provenance) as [string, any][]) {
        assert.equal(source.repository, path.split('/')[0]);
        assert.equal(source.sha256, digest(source.current));
      }
      if (c.id === 'happy-aliases') assert.deepEqual(route.aliases, ['alpha/src/cart.py', 'fork/src/cart.py']);
      if (c.id === 'oversized-overview') assert.ok(events.indexOf('narrow') < events.indexOf('references'));
      const path = join(root, 'tests.json');
      const tests = [{id:'synthetic.checkout.rejects-empty-cart',status:'failed',cause:'Expected 422; received 200'},
        {id:'synthetic.payment.retries-timeout',status:'failed',cause:'Synthetic gateway timeout'},
        {id:'synthetic.checkout.accepts-valid-cart',status:'passed'}];
      writeFileSync(path, JSON.stringify({version:1,exitCode:1,tests}));
      const candidate = {sha:'a'.repeat(40),branch:'synthetic/harmony',dirtySha256:digest('candidate'),
        dependencyConfigSha256:digest('config'),environmentSha256:digest('environment')};
      let indexes = 0;
      const options:IngestOptions = {storageRoot:join(root,'evidence'),authorizeRead:p=>resolve(p).startsWith(root+'/'),
        index:(text,source)=>{indexes++;return store.indexPlainText(text,source);},indexExists:s=>store.getSourceMeta(s)!==null,
        indexScope:'composed',source:{kind:'local',repository:'synthetic/alpha'},candidate,milestone:'L7.1',observedAt:'2026-10-26T00:00:00.000Z'};
      const input = [{path,exit:1,command:'synthetic-test --all',cwd:root,completeness:'complete' as const}];
      if (c.contextMode === false) {
        // Required capability failure halts the affected workflow before ingestion/review.
        events.push('context-mode-required-failure');
        assert.equal(indexes,0);
        results.push({id:c.id,events,decision:'blocked',failures:[],indexes});
        continue;
      }
      events.push('context-mode-ingest');
      const ingested = ingestEvidence(input, options);
      assert.equal(ingested.report.decision,'failed');
      const check = ingested.report.checks[0];
      assert.deepEqual(check.counts,{passed:1,failed:2,skipped:0,total:3});
      assert.deepEqual(check.failures.map((f:any)=>f.id),tests.slice(0,2).map(t=>t.id));
      for (const [i,f] of check.failures.entries()) {
        assert.equal(f.locator,`JSON:tests[${i}]`);assert.equal(f.cause,tests[i].cause);
      }
      assert.ok(check.resultIdentity.key);
      events.push('reviewer-authorize');
      const reference = check.references[0];
      assert.ok(options.authorizeRead(reference.path));
      assert.equal(digest(readFileSync(reference.path)),reference.sha256);
      let offset:number|null=0, reportText='';
      while(offset!==null) {
        const page=evidenceFollowup(options.storageRoot,ingested.id,offset,2048);
        assert.ok(Buffer.byteLength(page)<=2048);
        const parsed=JSON.parse(page);reportText+=parsed.data;offset=parsed.nextOffset;
      }
      assert.deepEqual(JSON.parse(reportText).checks[0].failures,check.failures);
      const reused=ingestEvidence(input,options).report;
      assert.equal(reused.checks[0].reuse.parse,'reused');assert.equal(indexes,1);
      assert.equal(reused.checks[0].observedAt,check.observedAt);
      events.push('reviewer-reuse');
      const denied=ingestEvidence(input,{...options,authorizeRead:()=>false}).report;
      assert.equal(denied.decision,'needs-evidence');assert.equal(denied.checks[0].exit,null);
      if(c.editAfterEvidence) {
        writeFileSync(join(root,'untracked.py'),'# candidate changed\n');
        const changed=ingestEvidence(input,{...options,candidate:{...candidate,dirtySha256:digest('changed')}}).report;
        assert.notEqual(changed.checks[0].resultIdentity.key,check.resultIdentity.key);
        assert.match(changed.checks[0].reuse.context,/changed/);
        assert.equal(changed.verification.staleContextChecks,1);
        assert.equal(changed.decision,'failed'); // stale context must never hide existing failures
        const passingPath=join(root,'passing.json');
        writeFileSync(passingPath,JSON.stringify({version:1,exitCode:0,tests:[tests[2]]}));
        const passingInput=[{...input[0],path:passingPath,exit:0}];
        assert.equal(ingestEvidence(passingInput,options).report.decision,'supported');
        const stale=ingestEvidence(passingInput,{...options,candidate:{...candidate,dirtySha256:digest('changed')}}).report;
        assert.equal(stale.decision,'needs-evidence','old passing log cannot certify edited candidate');
        events.push('stale-evidence-rejected');
      }
      assert.ok(events.indexOf('semantic-probe')<events.indexOf('context-mode-ingest'));
      assert.ok(events.indexOf('context-mode-ingest')<events.indexOf('reviewer-authorize'));
      assert.ok(events.indexOf('reviewer-authorize')<events.indexOf('reviewer-reuse'));
      results.push({id:c.id,events,decision:ingested.report.decision,failures:check.failures.map((f:any)=>f.id),indexes});
    } finally {store.close();rmSync(root,{recursive:true,force:true});assert.equal(existsSync(root),false);}
  }
  return {version:1,limitation:harmonyFixture.limitation,cases:results};
}
