#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const [operation, plan, id, snapshotText] = process.argv.slice(2);
if (!['start', 'checkpoint', 'finish'].includes(operation) || !plan || !id || !snapshotText) {
  throw new Error('usage: measure-plan.mjs {start|checkpoint|finish} PLAN ID SNAPSHOT_JSON');
}

let snapshot;
try { snapshot = JSON.parse(snapshotText); } catch { throw new Error('snapshot must be valid JSON'); }
const keys = Object.keys(snapshot).sort();
if (!keys.every((key) => ['observedAt', 'weeklyRemaining', 'tokensUsed'].includes(key)) ||
    typeof snapshot.observedAt !== 'string' || Number.isNaN(Date.parse(snapshot.observedAt))) {
  throw new Error('snapshot requires an ISO-8601 observedAt');
}
for (const key of ['weeklyRemaining', 'tokensUsed']) {
  if (snapshot[key] !== undefined && (!Number.isInteger(snapshot[key]) || snapshot[key] < 0 || (key === 'weeklyRemaining' && snapshot[key] > 100))) {
    throw new Error(`snapshot ${key} must be a non-negative integer${key === 'weeklyRemaining' ? ' no greater than 100' : ''}`);
  }
}

const lines = readFileSync(plan, 'utf8').split(/\n/);
const headings = [];
for (let index = 0; index < lines.length; index += 1) {
  const match = /^(\*+) (?:TODO|WIP|DONE) \[#.[^\n]*$/.exec(lines[index]);
  if (!match) continue;
  let end = lines.length;
  for (let next = index + 1; next < lines.length; next += 1) {
    const later = /^(\*+) /.exec(lines[next]);
    if (later && later[1].length <= match[1].length) { end = next; break; }
  }
  const drawerEnd = lines.slice(index + 1, end).findIndex((line) => line === ':END:');
  const drawer = drawerEnd < 0 ? null : { start: index + 1, end: index + 1 + drawerEnd };
  const idLine = drawer && lines.slice(drawer.start, drawer.end + 1).find((line) => /^:ID: /.test(line));
  if (idLine) headings.push({ start: index, end, level: match[1].length, id: idLine.slice(5), drawer });
}
const target = headings.find((heading) => heading.id === id);
if (!target || !target.drawer) throw new Error(`unknown ID or missing property drawer: ${id}`);
const targets = [target];
let ancestorLevel = target.level - 1;
for (let index = headings.indexOf(target) - 1; index >= 0 && ancestorLevel > 0; index -= 1) {
  if (headings[index].level === ancestorLevel) { targets.push(headings[index]); ancestorLevel -= 1; }
}

function properties(heading) {
  const values = new Map();
  for (let index = heading.drawer.start + 1; index < heading.drawer.end; index += 1) {
    const match = /^:([A-Z_]+): (.*)$/.exec(lines[index]);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}
function number(value, name) {
  if (!/^\d+$/.test(value ?? '')) throw new Error(`${name} is missing or invalid`);
  return Number(value);
}
const updates = new Map();
const measuredKeys = ['STARTED_AT', 'UPDATED_AT', 'COMPLETED_AT', 'ELAPSED_SECONDS', 'WEEKLY_REMAINING_START', 'WEEKLY_REMAINING_CURRENT', 'WEEKLY_REMAINING_END', 'WEEKLY_PERCENT_USED', 'TOKENS_START', 'TOKENS_CURRENT', 'TOKENS_END', 'TOKENS_USED'];
for (const heading of targets) {
  const current = properties(heading);
  const isNewStart = operation === 'start' && !current.has('STARTED_AT');
  if (operation === 'start' && current.has('STARTED_AT') && heading === target) throw new Error(`${heading.id} already started`);
  if (operation !== 'start' && !current.has('STARTED_AT')) throw new Error(`${heading.id} has not started`);
  const startAt = isNewStart ? snapshot.observedAt : current.get('STARTED_AT');
  const elapsed = Math.max(0, Math.floor((Date.parse(snapshot.observedAt) - Date.parse(startAt)) / 1000));
  const next = new Map(current);
  next.set('STARTED_AT', startAt);
  next.set('UPDATED_AT', snapshot.observedAt);
  next.set('ELAPSED_SECONDS', String(elapsed));
  if (snapshot.weeklyRemaining !== undefined) {
    const weeklyStart = isNewStart ? snapshot.weeklyRemaining : number(current.get('WEEKLY_REMAINING_START'), 'WEEKLY_REMAINING_START');
    next.set('WEEKLY_REMAINING_START', String(weeklyStart));
    next.set('WEEKLY_REMAINING_CURRENT', String(snapshot.weeklyRemaining));
    next.set('WEEKLY_PERCENT_USED', String(Math.max(0, weeklyStart - snapshot.weeklyRemaining)));
    if (operation === 'finish') next.set('WEEKLY_REMAINING_END', String(snapshot.weeklyRemaining));
  }
  if (snapshot.tokensUsed !== undefined) {
    const tokensStart = isNewStart ? snapshot.tokensUsed : number(current.get('TOKENS_START'), 'TOKENS_START');
    next.set('TOKENS_START', String(tokensStart));
    next.set('TOKENS_CURRENT', String(snapshot.tokensUsed));
    next.set('TOKENS_USED', String(Math.max(0, snapshot.tokensUsed - tokensStart)));
    if (operation === 'finish') next.set('TOKENS_END', String(snapshot.tokensUsed));
  }
  if (operation === 'finish') next.set('COMPLETED_AT', snapshot.observedAt);
  updates.set(heading, next);
}
for (const [heading, next] of [...updates.entries()].sort((a, b) => b[0].start - a[0].start)) {
  const body = [];
  for (let index = heading.drawer.start + 1; index < heading.drawer.end; index += 1) {
    const match = /^:([A-Z_]+): /.exec(lines[index]);
    if (match && measuredKeys.includes(match[1])) continue;
    body.push(lines[index]);
  }
  for (const key of measuredKeys) {
    if (next.has(key)) body.push(`:${key}: ${next.get(key)}`);
  }
  lines.splice(heading.drawer.start + 1, heading.drawer.end - heading.drawer.start - 1, ...body);
}
process.stdout.write(lines.join('\n'));
