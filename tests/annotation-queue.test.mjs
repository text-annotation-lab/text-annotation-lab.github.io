import test from 'node:test';
import assert from 'node:assert/strict';
import {annotationConcurrency, runAnnotationQueue} from '../lib/annotation-queue.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
function queue(concurrency, count = 7, onFinish = () => {}) {
  const pending = Array.from({length: count}, (_, i) => i);
  const started = [], completed = [], releases = new Map();
  let stopped = false, active = 0, maximum = 0;
  const running = runAnnotationQueue({
    concurrency, shouldStop: () => stopped,
    take: () => pending.shift(),
    perform: async id => {
      started.push(id);maximum = Math.max(maximum, ++active);
      try {
        await new Promise((resolve, reject) => releases.set(id, {resolve, reject}));
        completed.push(id);onFinish(id);
      } finally { active--; }
    },
  });
  return {running, pending, started, completed, releases,
    stop: () => {stopped = true;}, active: () => active, maximum: () => maximum};
}

for (const concurrency of [1, 2, 4]) {
  test(`${concurrency} workers refill as requests finish and claim every text once`, async () => {
    const q = queue(concurrency);
    assert.equal(q.started.length, concurrency);
    while (q.completed.length < 7) {
      // Complete the newest request first to exercise out-of-order results.
      const id = q.started.findLast(id => !q.completed.includes(id));
      q.releases.get(id).resolve();await tick();
      assert(q.active() <= concurrency);
    }
    await q.running;
    assert.equal(q.maximum(), concurrency);
    assert.deepEqual([...q.started].sort(), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(q.active(), 0);
  });
}

test('pause leaves waiting texts untouched and drains every active request', async () => {
  const q = queue(4);let finished = false;
  q.running.then(() => {finished = true;});q.stop();
  q.releases.get(0).resolve();await tick();
  assert.equal(finished, false);assert.equal(q.started.length, 4);
  for (const id of [3, 1, 2]) q.releases.get(id).resolve();
  await q.running;
  assert.deepEqual(q.pending, [4, 5, 6]);assert.equal(q.completed.length, 4);
});

test('an error stops new work while active requests drain before rejection', async () => {
  const q = queue(4), error = new Error('Rate limit');
  const result = assert.rejects(q.running, e => e === error);
  q.releases.get(1).reject(error);await tick();
  assert.equal(q.started.length, 4);assert.equal(q.active(), 3);
  for (const id of [3, 0, 2]) q.releases.get(id).resolve();
  await result;assert.equal(q.active(), 0);assert.deepEqual(q.pending, [4, 5, 6]);
});

test('a stop raised by an annotation callback prevents queue refill', async () => {
  const q = queue(4, 7, () => q.stop());
  q.releases.get(2).resolve();await tick();
  for (const id of [0, 1, 3]) q.releases.get(id).resolve();
  await q.running;assert.equal(q.started.length, 4);
});

test('old or invalid saved settings use one request at a time', () => {
  for (const value of [undefined, null, '4', 0, -1, 3, 8, Infinity, NaN]) {
    assert.equal(annotationConcurrency(value), 1);
  }
  assert.equal(annotationConcurrency(4), 4);
});

test('empty or already paused queues do not send requests', async () => {
  let performed = 0;
  await runAnnotationQueue({concurrency:4, take:() => undefined, shouldStop:() => false, perform:async () => {performed++;}});
  await runAnnotationQueue({concurrency:4, take:() => 0, shouldStop:() => true, perform:async () => {performed++;}});
  assert.equal(performed, 0);
});
