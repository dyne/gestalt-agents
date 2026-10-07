// Synthetic runner contract: controlled gates always settle, even on failure.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';

const scenario = process.env.EXECUTION_SCENARIO;

async function bounded(promise, timeout, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('selected concurrency regression', { skip: scenario === 'all-skipped' }, async () => {
  const pending = new Set();
  const released = [];
  const preconditions = [];
  let completed = 0;
  const gates = ['first', 'second'].map((name) => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    pending.add(name);
    return {
      name, promise,
      release() {
        if (pending.delete(name)) {
          released.push(name);
          resolve();
        }
      },
    };
  });
  const operations = gates.map(async (gate, index) => {
    preconditions.push(gate.name);
    await gate.promise;
    completed += 1;
    return index === 1 && ['expected-regression', 'product-failure'].includes(scenario) ? 0 : 1;
  });
  const settled = Promise.all(operations);
  let pendingAtFailure = null;
  let productResult = null;
  try {
    assert.deepEqual(preconditions, ['first', 'second']);
    assert.equal(pending.size, 2);
    if (scenario === 'harness-only-hang') {
      await bounded(settled, 50, 'harness still holds both injected prerequisites');
    }
    gates.forEach((gate) => gate.release());
    productResult = (await bounded(settled, 500, 'released product operations did not settle'))
      .reduce((sum, value) => sum + value, 0);
    assert.equal(productResult, 2, 'observable product result violates the regression contract');
  } catch (error) {
    pendingAtFailure = pending.size;
    throw error;
  } finally {
    gates.forEach((gate) => gate.release());
    await bounded(settled, 500, 'fixture cleanup did not settle');
    writeFileSync(process.env.EXECUTION_EVIDENCE, JSON.stringify({
      identity: 'selected concurrency regression', preconditions, released,
      completed, pendingAtFailure, pendingAfterCleanup: pending.size, productResult,
    }));
    assert.equal(pending.size, 0);
    assert.equal(completed, 2);
  }
});

test('unrelated smoke', { skip: scenario === 'all-skipped' }, () => {
  assert.equal(1 + 1, 2);
});
