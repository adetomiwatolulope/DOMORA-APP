import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/worker/pool";
import { getWorkerConfig, DEFAULT_WORKER } from "@/lib/worker/config";

// The concurrency cap is what keeps the worker inside a downstream provider's
// rate limit, so it is proven here without a database: N in flight, ever.

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("mapWithConcurrency caps work in flight", () => {
  it("never runs more than the limit at once", async () => {
    const limit = 3;
    const items = Array.from({ length: 12 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    const gates = items.map(() => deferred<void>());

    const run = mapWithConcurrency(items, limit, async (item, index) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gates[index]?.promise;
      inFlight -= 1;
      return item;
    });

    // Let the first `limit` tasks start, then confirm the rest are waiting.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(inFlight).toBe(limit);

    for (const gate of gates) gate.resolve();
    const results = await run;

    expect(peak).toBe(limit);
    expect(inFlight).toBe(0);
    expect(results).toEqual(items); // order preserved
  });

  it("processes every item, and a limit above the item count is harmless", async () => {
    const seen: number[] = [];
    const results = await mapWithConcurrency([1, 2, 3], 10, async (item) => {
      seen.push(item);
      return item * 2;
    });
    expect(seen.sort()).toEqual([1, 2, 3]);
    expect(results).toEqual([2, 4, 6]);
  });

  it("an empty list does no work", async () => {
    const results = await mapWithConcurrency([], 4, async () => {
      throw new Error("must not run");
    });
    expect(results).toEqual([]);
  });

  it("a failing task propagates instead of looking like success", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("task failed");
        return item;
      }),
    ).rejects.toThrow("task failed");
  });

  it("rejects a limit that cannot mean anything", async () => {
    await expect(mapWithConcurrency([1], 0, async (i) => i)).rejects.toThrow(RangeError);
    await expect(mapWithConcurrency([1], 1.5, async (i) => i)).rejects.toThrow(RangeError);
  });
});

describe("worker config", () => {
  it("defaults the concurrency cap to a small number", () => {
    expect(DEFAULT_WORKER.concurrency).toBe(5);
  });

  it("reads the cap from the environment and ignores a nonsense value", () => {
    const previous = process.env.WORKER_CONCURRENCY;
    try {
      process.env.WORKER_CONCURRENCY = "12";
      expect(getWorkerConfig().concurrency).toBe(12);

      process.env.WORKER_CONCURRENCY = "not-a-number";
      expect(getWorkerConfig().concurrency).toBe(DEFAULT_WORKER.concurrency);
    } finally {
      if (previous === undefined) delete process.env.WORKER_CONCURRENCY;
      else process.env.WORKER_CONCURRENCY = previous;
    }
  });
});
