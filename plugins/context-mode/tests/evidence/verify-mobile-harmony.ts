/** Explicit read-only compatibility check: bun run this-file.ts MOBILE_REPOSITORY.
 * The fixture pins public contract bytes; no checkout path is persisted in it.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from '../../src/evidence/github.js';
import { harmonyFixture } from './composed-harmony.js';

const mobile = process.argv[2];
assert.ok(mobile,'Supply the read-only accepted Mobile repository');
const contract = harmonyFixture.mobile;
assert.equal(execFileSync('git',['-C',mobile,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),contract.commit);
for(const [path,sha] of Object.entries(contract.contracts)) {
  assert.equal(digest(readFileSync(resolve(mobile,path))),sha,path);
  assert.equal(digest(execFileSync('git',['-C',mobile,'show',`${contract.commit}:${path}`])),sha,path);
}
const load = (name:string) => import(pathToFileURL(resolve(mobile,`src/shared/contracts/${name}.ts`)).href);
const readiness = await load('retrieval-readiness');
const startup = await load('mcp-startup-failure');
const efficiency = await load('tool-efficiency');
assert.equal(readiness.semanticState(readiness.unknownReadiness()),'unknown');
const observed = {state:'ready',observedAt:'2026-10-26T00:00:00.000Z',generation:'synthetic-1'};
const state = {...readiness.unknownReadiness(),connection:observed,symbols:observed};
assert.equal(readiness.semanticState(state),'unknown','connection and symbols alone are insufficient');
assert.equal(readiness.semanticState({...state,references:observed}),'ready');
assert.equal(readiness.semanticState({...state,references:{...observed,state:'stale'}}),'stale');
const failure = {schemaVersion:1,failureId:'synthetic-context-mode-required-failure',attemptId:'synthetic-1',
  occurredAt:observed.observedAt,threadId:'synthetic-child',serverName:'context-mode',phase:'initialize',code:'timeout',
  runtimeId:'synthetic-runtime',artifactDigest:null,exitCode:null,signal:null};
assert.deepEqual(startup.parseMcpStartupFailure(failure),failure);
const failed = {schemaVersion:1,runtimeId:failure.runtimeId,attemptId:failure.attemptId,threadId:failure.threadId,
  serverName:failure.serverName,observedAt:failure.occurredAt,status:'failed',failure};
assert.deepEqual(startup.parseMcpStartupStatus(failed),failed);
assert.equal(startup.parseMcpStartupStatus({...failed,status:'ready'}),undefined);
assert.match(startup.startupRecoveryGuidance('context-mode'),/Required tool unavailable/);
for(const server of ['gestalt-serena','gestalt-xerj']) assert.match(startup.startupRecoveryGuidance(server),/Optional/);
const unknown = {value:null,measuredCalls:0,coverage:'unknown'};
const quality = {complete:0,partial:0,unknown:1,missing:0};
const group = {runtimeId:'synthetic-runtime',threadId:'synthetic-child',actor:'child',family:'contextMode',layer:'tool',
  calls:1,completedCalls:1,failedCalls:0,durationMs:unknown,deliveredBytes:unknown,deliveredScope:null,
  rawBytes:unknown,processedBytes:unknown,retries:unknown,reusedCalls:unknown,truncatedCalls:unknown,
  completeness:{capture:quality,display:quality,evidence:quality}};
const snapshot = {sessionId:'synthetic-harmony',revision:1,observedAt:observed.observedAt,scope:'observedCallsOnly',
  coverage:'unknown',missingCorrelation:true,retentionLimited:false,groups:[group]};
assert.deepEqual(efficiency.parseToolEfficiencySnapshot(snapshot,snapshot.sessionId),snapshot);
assert.equal(efficiency.parseToolEfficiencySnapshot({...snapshot,groups:[{...group,rawBytes:{...unknown,value:0}}]},snapshot.sessionId),null);
assert.equal(efficiency.parseToolEfficiencySnapshot(undefined,snapshot.sessionId),null);
console.log('Mobile compatibility: 3 pinned contracts; readiness, startup failure/status and metrics assertions passed; synthetic DTOs only');
