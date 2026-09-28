// Every number the delivery worker runs on lives here, never inside the worker
// loop or the queue module. Env overrides let a deployment tune the concurrency
// cap and the retry policy without a code change.

import { positiveIntFromEnv } from "@/lib/env";

export interface WorkerConfig {
  // The cap: at most this many jobs are in flight in one worker process. It
  // bounds both the claims taken per tick and the jobs running at once, which
  // is what keeps the worker inside a downstream provider's rate limit — N
  // concurrent jobs means at most N concurrent external calls.
  concurrency: number;
  // How long the loop waits after a tick that found nothing to claim.
  pollIntervalMs: number;
  // A PROCESSING job whose lease is older than this is reclaimable: the worker
  // that held it died mid-job. Must exceed the slowest single job.
  leaseMs: number;
  // Attempts allowed per job (the first claim plus its retries) before the job
  // is terminally FAILED.
  maxAttempts: number;
  // Exponential backoff base and ceiling between a failed attempt and the next
  // claim (delay = base * 2^(attempts-1), clamped to the ceiling).
  retryBaseMs: number;
  retryMaxMs: number;
}

export const DEFAULT_WORKER: WorkerConfig = {
  concurrency: 5,
  pollIntervalMs: 2_000,
  leaseMs: 60_000,
  maxAttempts: 5,
  retryBaseMs: 1_000,
  retryMaxMs: 300_000,
};

export function getWorkerConfig(): WorkerConfig {
  return {
    concurrency: positiveIntFromEnv("WORKER_CONCURRENCY", DEFAULT_WORKER.concurrency),
    pollIntervalMs: positiveIntFromEnv("WORKER_POLL_INTERVAL_MS", DEFAULT_WORKER.pollIntervalMs),
    leaseMs: positiveIntFromEnv("WORKER_LEASE_MS", DEFAULT_WORKER.leaseMs),
    maxAttempts: positiveIntFromEnv("WORKER_MAX_ATTEMPTS", DEFAULT_WORKER.maxAttempts),
    retryBaseMs: positiveIntFromEnv("WORKER_RETRY_BASE_MS", DEFAULT_WORKER.retryBaseMs),
    retryMaxMs: positiveIntFromEnv("WORKER_RETRY_MAX_MS", DEFAULT_WORKER.retryMaxMs),
  };
}
