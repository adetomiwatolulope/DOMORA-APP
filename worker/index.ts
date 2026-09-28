// The delivery worker: a separate process from the Next.js app, looping over
// the notification queue. Run it with `npm run worker` (add `-- --once` for a
// single tick, which is what a cron-based deployment wants).
//
//   dotenv/config must be imported first: /lib/db builds the Prisma client at
//   import time and reads DATABASE_URL from the environment as it does.
import "dotenv/config";
import { prisma } from "@/lib/db";
import { getWorkerConfig } from "@/lib/worker/config";
import { runWorkerTick, type WorkerTickSummary } from "./pump";

const config = getWorkerConfig();
const runOnce = process.argv.includes("--once");

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A failed tick is not a lost job: the lease on anything it still held expires
// and a later tick reclaims it. The error is logged, never reported as a tick
// that did nothing useful (CS-8).
async function tick(): Promise<WorkerTickSummary> {
  const idle: WorkerTickSummary = { claimed: 0, succeeded: 0, retried: 0, failed: 0 };
  try {
    return await runWorkerTick({ config });
  } catch (error) {
    console.error("[worker] tick failed", error);
    return idle;
  }
}

async function main(): Promise<void> {
  console.log(
    `[worker] started concurrency=${config.concurrency} leaseMs=${config.leaseMs} maxAttempts=${config.maxAttempts}`,
  );

  for (;;) {
    const summary = await tick();
    if (summary.claimed > 0) console.log(`[worker] tick ${JSON.stringify(summary)}`);
    if (runOnce || stopping) break;
    // Nothing was claimed: back off instead of spinning on the claim statement.
    if (summary.claimed === 0) await sleep(config.pollIntervalMs);
  }

  await prisma.$disconnect();
  console.log("[worker] stopped");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("[worker] fatal", error);
    process.exit(1);
  },
);
