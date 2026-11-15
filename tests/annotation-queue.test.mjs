import test from 'node:test';
import assert from 'node:assert/strict';
import {annotationConcurrency, concurrencyChoices, createPacer, runAnnotationQueue, sendAnnotation, MAX_SENDS} from '../lib/annotation-queue.ts';

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

// Research mode: more annotations at once, and a run that paces itself on rate limits.
test('research mode offers up to 128 at once; the standard mode keeps 1, 2, and 4', async () => {
  assert.deepEqual([...concurrencyChoices()], [1, 2, 4]);
  assert.deepEqual([...concurrencyChoices(true)], [1, 2, 4, 8, 16, 32, 64, 128]);
  for (const n of concurrencyChoices(true)) assert.equal(annotationConcurrency(n, true), n);
  for (const value of [undefined, null, '128', 0, 3, 100, 129, 256, NaN]) assert.equal(annotationConcurrency(value, true), 1);
  // A study set to more than the standard mode offers runs one at a time there.
  for (const n of [8, 16, 32, 64, 128]) assert.equal(annotationConcurrency(n), 1);
  const q = queue(128, 300);
  assert.equal(q.started.length, 128);
  for (let round = 0; q.completed.length < 300; round++) {
    for (const id of [...q.started].filter(id => !q.completed.includes(id))) q.releases.get(id).resolve();
    await tick();assert(q.active() <= 128);
  }
  await q.running;assert.equal(q.maximum(), 128);assert.equal(new Set(q.started).size, 300);
});

const limitedReply = (wait = 0, extra = {}) => Response.json({error: 'Rate limit.', retryAfterMs: wait, ...extra}, {status: 429});
const ok = () => Response.json({score: '1', explanation: 'Fine'});
// A clock that moves only when something sleeps.
function clock() {
  let time = 1000;
  return {now: () => time, sleep: async ms => {time += ms;await tick();}, at: () => time};
}

test('a request sent without a place is sent once, whatever the reply', async () => {
  let sends = 0;
  const sent = await sendAnnotation(async () => {sends++;return limitedReply(10);});
  assert.equal(sends, 1);assert.equal(sent.response.status, 429);assert.equal(sent.out.retryAfterMs, 10);
});

test('a paced run waits out a rate limit, halves once per burst, and rises again', async () => {
  const time = clock(), limits = [], sendsOf = new Map(), done = [];
  const pending = Array.from({length: 40}, (_, i) => i);
  // A provider that takes three requests at a time and refuses the rest.
  let taken = 0, open = 0, most = 0, mostAfterLimit = 0;
  const send = async id => {
    sendsOf.set(id, (sendsOf.get(id) || 0) + 1);
    open++;most = Math.max(most, open);if (limits.length) mostAfterLimit = Math.max(mostAfterLimit, open);
    const take = taken < 3;if (take) taken++;
    await tick();
    open--;if (take) taken--;
    return take ? ok() : limitedReply(1000);
  };
  await runAnnotationQueue({
    concurrency: 8, shouldStop: () => false, take: () => pending.shift(),
    pace: {now: time.now, sleep: time.sleep, onLimited: limited => limits.push(limited)},
    perform: async (id, place) => {
      const sent = await sendAnnotation(() => send(id), place);
      assert(sent.response.ok, 'every text gets through');done.push(id);
    },
  });
  assert.deepEqual([...done].sort((a, b) => a - b), Array.from({length: 40}, (_, i) => i));
  assert.equal(most, 8);
  // Five of the first eight were refused together: one lowering, to half of the eight in flight.
  assert.equal(limits[0].atOnce, 4);assert.equal(limits[0].at, 1000);assert.equal(limits[0].waitMs, 1250);
  assert(mostAfterLimit <= 4, `at most four at a time after the limit, saw ${mostAfterLimit}`);
  // Later limits: four at a time meets the provider's three again, so half of four; the repeat shows the rise from two back to four.
  assert.deepEqual(limits.slice(1, 3).map(limited => limited.atOnce), [2, 2]);
  assert([...sendsOf.values()].every(n => n <= MAX_SENDS));
  assert(time.at() >= 2250);
});

test('the number at once rises by one after that many requests got through', async () => {
  const time = clock(), pacer = createPacer({limit: 8, shouldStop: () => false, now: time.now, sleep: time.sleep});
  const places = [];for (let i = 0; i < 8; i++) places.push(await pacer.enter());
  assert.equal(pacer.atOnce(), 8);
  const again = places[0].again(0);                     // no time named: two seconds
  assert.equal(pacer.atOnce(), 4);
  const second = places[1].again(0);                    // the same burst
  assert.equal(pacer.atOnce(), 4);
  // Requests of the refused burst that got through do not raise the number.
  for (const place of places.slice(2)) {place.passed();place.leave();}
  assert.equal(pacer.atOnce(), 4);
  assert.equal(await again, true);assert.equal(await second, true);
  assert(time.at() >= 3000);
  // Four that got through at four at a time raise it by one.
  places[0].passed();places[1].passed();
  const more = [await pacer.enter(), await pacer.enter()];
  more[0].passed();assert.equal(pacer.atOnce(), 4);
  more[1].passed();assert.equal(pacer.atOnce(), 5);
  // A refusal of a request sent after the lowering lowers again: half of the four in flight.
  let before = time.at();const third = places[0].again(0);
  assert.equal(pacer.atOnce(), 2);
  for (const place of [places[1], ...more]) place.leave();
  assert.equal(await third, true);assert(time.at() - before >= 2000);
  // Refused again with nothing through in between: never below one at a time, and the unnamed wait doubles.
  before = time.at();const fourth = places[0].again(0);
  assert.equal(pacer.atOnce(), 1);
  assert.equal(await fourth, true);assert(time.at() - before >= 4000);
  // Leaving twice does not free a second place.
  places[1].leave();places[1].leave();
  const waiting = pacer.enter();let entered = false;waiting.then(() => {entered = true;});
  await tick();assert.equal(entered, false);
  places[0].leave();await tick();assert.equal(entered, true);
});

test('a text waiting out a rate limit is given back when the run stops', async () => {
  const time = clock();let stopped = false, sends = 0;
  const pending = ['limited', 'fine'], outcome = {};
  const sleep = async ms => {stopped = true;await time.sleep(ms);};   // the person pauses during the wait
  await runAnnotationQueue({
    concurrency: 2, shouldStop: () => stopped, take: () => pending.shift(), pace: {now: time.now, sleep},
    perform: async (id, place) => {
      const sent = await sendAnnotation(async () => {sends++;await tick();return id === 'limited' ? limitedReply(5000) : ok();}, place);
      outcome[id] = sent ? sent.response.status : 'given back';
    },
  });
  assert.deepEqual(outcome, {limited: 'given back', fine: 200});assert.equal(sends, 2);
});

test('a text is sent at most eight times, and a subject whose web search was made is not sent again', async () => {
  const time = clock();let sends = 0;
  const pending = ['always limited'], replies = [];
  await runAnnotationQueue({
    concurrency: 1, shouldStop: () => false, take: () => pending.shift(), pace: {now: time.now, sleep: time.sleep},
    perform: async (id, place) => {replies.push(await sendAnnotation(async () => {sends++;return limitedReply(0);}, place));},
  });
  assert.equal(sends, MAX_SENDS);assert.equal(MAX_SENDS, 8);assert.equal(replies[0].response.status, 429);
  // Unnamed waits double from two seconds up to a minute: 2 + 4 + 8 + 16 + 32 + 60 + 60.
  assert(time.at() - 1000 >= 182000 && time.at() - 1000 < 190000, String(time.at()));
  const searched = clock();sends = 0;pending.push('searched');
  await runAnnotationQueue({
    concurrency: 1, shouldStop: () => false, take: () => pending.shift(), pace: {now: searched.now, sleep: searched.sleep},
    perform: async (id, place) => {replies.push(await sendAnnotation(async () => {sends++;return limitedReply(0, {research: {text: 'Notes'}});}, place));},
  });
  assert.equal(sends, 1);assert.equal(searched.at(), 1000);
  // Failures that are not rate limits are not sent again either.
  sends = 0;pending.push('rejected');
  await runAnnotationQueue({
    concurrency: 1, shouldStop: () => false, take: () => pending.shift(), pace: {now: searched.now, sleep: searched.sleep},
    perform: async (id, place) => {replies.push(await sendAnnotation(async () => {sends++;return Response.json({error: 'Key rejected.'}, {status: 401});}, place));},
  });
  assert.equal(sends, 1);assert.equal(replies.at(-1).response.status, 401);
});

test('an error in a paced run stops new texts and still drains', async () => {
  const time = clock(), pending = [0, 1, 2, 3, 4, 5], started = [];
  await assert.rejects(runAnnotationQueue({
    concurrency: 2, shouldStop: () => false, take: () => pending.shift(), pace: {now: time.now, sleep: time.sleep},
    perform: async id => {started.push(id);await tick();if (id === 0) throw new Error('lost');await tick();},
  }), /lost/);
  assert.deepEqual(started, [0, 1]);
});
