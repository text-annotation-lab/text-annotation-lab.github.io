export const DEFAULT_ANNOTATION_CONCURRENCY = 1;
export const ANNOTATION_CONCURRENCY = [1, 2, 4] as const;
// Research mode offers more requests at once. A study that uses them runs one at a time in the standard mode.
export const RESEARCH_ANNOTATION_CONCURRENCY = [1, 2, 4, 8, 16, 32, 64, 128] as const;
export const concurrencyChoices = (research = false): readonly number[] => research ? RESEARCH_ANNOTATION_CONCURRENCY : ANNOTATION_CONCURRENCY;

export function annotationConcurrency(value: unknown, research = false): number {
  return concurrencyChoices(research).some(n => n === value) ? value as number : 1;
}

// Pacing (research mode). When the provider refuses a request for a rate limit, every request of the run
// waits, and the run goes on with half as many at a time, rising again by one as requests get through.
export const MAX_SENDS = 8; // per text, counting the first
const FIRST_WAIT_MS = 2000, LONGEST_WAIT_MS = 60000, MARGIN_MS = 250, LOOK_MS = 250;
export type Limited = {at: number; waitMs: number; atOnce: number};
export type Place = {
  /** The provider refused the request for a rate limit: wait (`waitMs`, or 0 when it names no time), then take a place again. False: the run stopped meanwhile. */
  again: (waitMs: number) => Promise<boolean>;
  /** The provider took the request. */
  passed: () => void;
  leave: () => void;
};
export type Pace = {onLimited?: (limited: Limited) => void; now?: () => number; sleep?: (ms: number) => Promise<void>};

export function createPacer({limit, shouldStop, onLimited, now = Date.now, sleep = ms => new Promise<void>(resolve => setTimeout(resolve, ms))}: Pace & {limit: number; shouldStop: () => boolean}) {
  let allowed = limit, active = 0, until = 0, loweredAt = -Infinity, streak = 0;
  let waiting: (() => void)[] = [];
  const wake = () => { const resolvers = waiting; waiting = []; for (const resolve of resolvers) resolve(); };
  // Wait until sending may go on and a place is free. A stop is noticed within a quarter of a second.
  async function acquire(): Promise<boolean> {
    for (;;) {
      if (shouldStop()) return false;
      const time = now();
      if (time < until) { await sleep(Math.min(until - time, LOOK_MS)); continue; }
      if (active < Math.floor(allowed)) { active++; return true; }
      await new Promise<void>(resolve => waiting.push(resolve));
    }
  }
  return {
    atOnce: () => Math.floor(allowed),
    async enter(): Promise<Place | undefined> {
      if (!(await acquire())) return undefined;
      let held = true, sentAt = now();
      const leave = () => { if (held) { held = false; active--; wake(); } };
      return {
        leave,
        passed() {
          // A request of the burst that was refused says nothing about the lowered number.
          if (sentAt <= loweredAt) return;
          streak = 0;
          if (allowed < limit) { allowed = Math.min(limit, allowed + 1 / Math.floor(allowed)); wake(); }
        },
        async again(waitMs) {
          const time = now();
          // The refusals of one burst lower the number once: only a request sent after the last lowering lowers it again.
          const lowered = sentAt > loweredAt;
          if (lowered) { allowed = Math.max(1, Math.floor(Math.min(allowed, active) / 2)); loweredAt = time; streak++; }
          const wait = waitMs > 0 ? waitMs + MARGIN_MS : Math.min(LONGEST_WAIT_MS, FIRST_WAIT_MS * 2 ** (streak - 1));
          until = Math.max(until, time + wait);
          if (lowered) onLimited?.({at: time, waitMs: until - time, atOnce: Math.floor(allowed)});
          leave();
          if (!(await acquire())) return false;
          held = true; sentAt = now();
          return true;
        },
      };
    },
  };
}

// Send one annotation request. In a paced run, a reply that carries `retryAfterMs` (the provider refused the
// request for a rate limit or because it is overloaded, so nothing was processed) is sent again after the wait.
// Undefined: the run stopped during a wait, and the text was not annotated.
export async function sendAnnotation(send: () => Promise<Response>, place?: Place): Promise<{response: Response; out: any} | undefined> {
  for (let sends = 1; ; sends++) {
    const response = await send(), out = await response.json().catch(() => null);
    const wait = response.ok ? undefined : out?.retryAfterMs;
    if (!place) return {response, out};
    if (typeof wait !== 'number') { place.passed(); return {response, out}; }
    // A web search already made for this subject would be made, and charged, a second time.
    if (out.research || sends >= MAX_SENDS) return {response, out};
    if (!(await place.again(wait))) return undefined;
  }
}

// Claim each item synchronously before awaiting its request. Once stopped, drain
// requests already in flight so callers can safely unlock the workspace.
export async function runAnnotationQueue<T>({concurrency, take, perform, shouldStop, pace}: {
  concurrency: number;
  take: () => T | undefined;
  perform: (item: T, place?: Place) => Promise<void>;
  shouldStop: () => boolean;
  pace?: Pace;
}): Promise<void> {
  let failed = false, failure: unknown;
  const workers = annotationConcurrency(concurrency, true);
  const pacer = pace ? createPacer({...pace, limit: workers, shouldStop: () => failed || shouldStop()}) : undefined;
  async function worker() {
    while (!failed && !shouldStop()) {
      let place: Place | undefined;
      try {
        if (pacer && !(place = await pacer.enter())) return;
        const item = take();
        if (item === undefined) return;
        await perform(item, place);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      } finally {
        place?.leave();
      }
    }
  }
  await Promise.all(Array.from({length: workers}, worker));
  if (failed) throw failure;
}
