// Runs `task` over `items` with at most `limit` of them in flight at any
// moment. This is the mechanism behind the worker's concurrency cap: the cap is
// a configuration number, and this is the only place it is enforced.
//
// Results keep the order of `items`. The first rejection propagates — a
// swallowed error would be indistinguishable from a job that succeeded, and
// the caller decides what a failed batch means.
export async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  task: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`mapWithConcurrency requires a limit of at least 1, received ${String(limit)}`);
  }
  if (items.length === 0) return [];

  const results = new Array<Result>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
