export const DEFAULT_ANNOTATION_CONCURRENCY = 1;
export const ANNOTATION_CONCURRENCY = [1, 2, 4] as const;

export function annotationConcurrency(value: unknown): number {
  return ANNOTATION_CONCURRENCY.some(n => n === value) ? value as number : 1;
}

// Claim each item synchronously before awaiting its request. Once stopped, drain
// requests already in flight so callers can safely unlock the workspace.
export async function runAnnotationQueue<T>({concurrency, take, perform, shouldStop}: {
  concurrency: number;
  take: () => T | undefined;
  perform: (item: T) => Promise<void>;
  shouldStop: () => boolean;
}): Promise<void> {
  let failed = false, failure: unknown;
  async function worker() {
    while (!failed && !shouldStop()) {
      try {
        const item = take();
        if (item === undefined) return;
        await perform(item);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  }
  await Promise.all(Array.from({length: annotationConcurrency(concurrency)}, worker));
  if (failed) throw failure;
}
