import { JobStatus } from "@prisma/client";
import { mapWithConcurrency } from "@/lib/worker/pool";
import { getWorkerConfig, type WorkerConfig } from "@/lib/worker/config";
import { deliverNotification, type Messenger } from "@/modules/notifications/deliver";
import {
  claimNextNotificationJob,
  markNotificationJobFailed,
  markNotificationJobSucceeded,
  type ClaimedJob,
} from "@/modules/notifications/queue";

// One tick of the worker: claim what is due, do the work, settle each job.
// The decisions (who may be claimed, what a failure means) live in
// /modules/notifications/queue; this is only the scheduling around them.

export interface WorkerTickSummary {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
}

export interface WorkerDeps {
  config?: WorkerConfig;
  messenger?: Messenger;
}

type JobOutcome = "SUCCEEDED" | "RETRY" | "FAILED";

export async function runWorkerTick(deps: WorkerDeps = {}): Promise<WorkerTickSummary> {
  const config = deps.config ?? getWorkerConfig();
  const jobs = await claimDueJobs(config);

  if (jobs.length === 0) return { claimed: 0, succeeded: 0, retried: 0, failed: 0 };

  const outcomes = await mapWithConcurrency(jobs, config.concurrency, (job) => processJob(job, config, deps));

  const summary: WorkerTickSummary = { claimed: jobs.length, succeeded: 0, retried: 0, failed: 0 };
  for (const outcome of outcomes) {
    if (outcome === "SUCCEEDED") summary.succeeded += 1;
    else if (outcome === "RETRY") summary.retried += 1;
    else summary.failed += 1;
  }
  return summary;
}

// Claims at most `concurrency` jobs: the cap bounds the claims taken in one
// tick as well as the jobs running at once, so the worker never marks a job
// PROCESSING while having no capacity to run it. Each claim is one statement,
// so a tick is a sequence of independent atomic claims.
async function claimDueJobs(config: WorkerConfig): Promise<ClaimedJob[]> {
  const jobs: ClaimedJob[] = [];
  while (jobs.length < config.concurrency) {
    const job = await claimNextNotificationJob({ config });
    if (!job) break;
    jobs.push(job);
  }
  return jobs;
}

async function processJob(job: ClaimedJob, config: WorkerConfig, deps: WorkerDeps): Promise<JobOutcome> {
  try {
    await deliverNotification(job.id, { messenger: deps.messenger });
    await markNotificationJobSucceeded(job);
    return "SUCCEEDED";
  } catch (error) {
    const status = await markNotificationJobFailed(job, error, { config });
    return status === JobStatus.FAILED ? "FAILED" : "RETRY";
  }
}
