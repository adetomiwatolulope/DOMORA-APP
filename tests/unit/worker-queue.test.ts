import { JobStatus, NotificationChannel, UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { DEFAULT_WORKER } from "@/lib/worker/config";
import {
  backoffDelayMs,
  claimNextNotificationJob,
  markNotificationJobFailed,
  markNotificationJobSucceeded,
  type ClaimedJob,
} from "@/modules/notifications/queue";
import { makeUser, resetDb } from "../helpers";

// A Notification row is the worker's job. These tests cover the claim race and
// the settle guards, because those are the only places correctness depends on
// two processes touching the same row.

const MINUTE = 60_000;

async function jobRow(overrides: { runAt?: Date; attempts?: number } = {}): Promise<string> {
  const user = await makeUser(UserRole.SEEKER, `q${Math.random().toString(36).slice(2, 10)}@example.com`);
  const row = await prisma.notification.create({
    data: {
      userId: user.userId,
      channel: NotificationChannel.IN_APP,
      template: "verification_approved@v1",
      vars: {},
      ...overrides,
    },
  });
  return row.id;
}

async function jobState(id: string) {
  return prisma.notification.findUniqueOrThrow({
    where: { id },
    select: { status: true, attempts: true, runAt: true, lockedAt: true, lastError: true },
  });
}

async function claimAll(limit: number): Promise<ClaimedJob[]> {
  const claimed: ClaimedJob[] = [];
  for (;;) {
    const job = await claimNextNotificationJob({ config: DEFAULT_WORKER });
    if (!job) break;
    claimed.push(job);
    if (claimed.length >= limit) break;
  }
  return claimed;
}

describe("job claim is atomic", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("two workers racing for one job: exactly one wins", async () => {
    const id = await jobRow();

    const [first, second] = await Promise.all([
      claimNextNotificationJob({ config: DEFAULT_WORKER }),
      claimNextNotificationJob({ config: DEFAULT_WORKER }),
    ]);

    const winners = [first, second].filter((job): job is ClaimedJob => job !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.id).toBe(id);
    expect((await jobState(id)).status).toBe(JobStatus.PROCESSING);
  });

  it("many workers racing over many jobs: no job is handed out twice", async () => {
    const ids = await Promise.all([jobRow(), jobRow(), jobRow(), jobRow(), jobRow()]);

    const claims = await Promise.all(
      Array.from({ length: 10 }, () => claimNextNotificationJob({ config: DEFAULT_WORKER })),
    );

    const claimedIds = claims.filter((job): job is ClaimedJob => job !== null).map((job) => job.id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(claimedIds.sort()).toEqual([...ids].sort());
    // Nothing is left claimable, and nothing was claimed more than once.
    expect(await prisma.notification.count({ where: { status: JobStatus.PENDING } })).toBe(0);
  });

  it("the claim increments attempts and stamps the lease", async () => {
    const id = await jobRow({ attempts: 2 });

    const job = await claimNextNotificationJob({ config: DEFAULT_WORKER });

    expect(job?.attempts).toBe(3);
    const state = await jobState(id);
    expect(state.attempts).toBe(3);
    expect(state.lockedAt).not.toBeNull();
  });

  it("claims the oldest due job first", async () => {
    const older = await jobRow({ runAt: new Date(Date.now() - 2 * MINUTE) });
    const newer = await jobRow({ runAt: new Date(Date.now() - MINUTE) });

    const job = await claimNextNotificationJob({ config: DEFAULT_WORKER });

    expect(job?.id).toBe(older);
    expect((await jobState(newer)).status).toBe(JobStatus.PENDING);
  });
});

describe("job claim refuses what is not claimable", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a job scheduled in the future is not claimed", async () => {
    await jobRow({ runAt: new Date(Date.now() + 10 * MINUTE) });

    expect(await claimNextNotificationJob({ config: DEFAULT_WORKER })).toBeNull();
  });

  it("a SUCCEEDED job is never claimed again", async () => {
    const id = await jobRow();
    const job = await claimNextNotificationJob({ config: DEFAULT_WORKER });
    await markNotificationJobSucceeded(job as ClaimedJob);

    expect((await jobState(id)).status).toBe(JobStatus.SUCCEEDED);
    expect(await claimNextNotificationJob({ config: DEFAULT_WORKER })).toBeNull();
  });

  it("a terminally FAILED job is never claimed again", async () => {
    const id = await jobRow({ attempts: DEFAULT_WORKER.maxAttempts - 1 });
    const job = (await claimNextNotificationJob({ config: DEFAULT_WORKER })) as ClaimedJob;
    await markNotificationJobFailed(job, new Error("provider is down"), { config: DEFAULT_WORKER });

    expect((await jobState(id)).status).toBe(JobStatus.FAILED);
    expect(await claimNextNotificationJob({ config: DEFAULT_WORKER })).toBeNull();
  });

  it("a job another worker still holds (live lease) is not stolen", async () => {
    const id = await jobRow();
    const first = (await claimNextNotificationJob({ config: DEFAULT_WORKER })) as ClaimedJob;

    // A second worker running immediately after: the lease is fresh.
    expect(await claimNextNotificationJob({ config: DEFAULT_WORKER })).toBeNull();
    expect((await jobState(id)).lockedAt).toEqual(first.claimedAt);
  });

  it("a job left PROCESSING by a dead worker is reclaimed once its lease expires", async () => {
    const id = await jobRow();
    await claimNextNotificationJob({ config: DEFAULT_WORKER });
    // The worker holding it died: the lease is older than the configured one.
    await prisma.notification.update({
      where: { id },
      data: { lockedAt: new Date(Date.now() - DEFAULT_WORKER.leaseMs - MINUTE) },
    });

    const reclaimed = await claimNextNotificationJob({ config: DEFAULT_WORKER });

    expect(reclaimed?.id).toBe(id);
    expect(reclaimed?.attempts).toBe(2); // the crashed attempt still counted
  });
});

describe("settling a job is guarded on the worker still holding it", () => {
  beforeEach(async () => {
    await resetDb();
  });

  // A stale worker: its claim was taken over after its lease expired, so the
  // row has moved on to a later attempt than the one it claimed.
  function staleWorker(job: ClaimedJob): ClaimedJob {
    return { id: job.id, attempts: job.attempts + 1, claimedAt: job.claimedAt };
  }

  it("succeeding a job this worker no longer holds is rejected", async () => {
    const id = await jobRow();
    const job = (await claimNextNotificationJob({ config: DEFAULT_WORKER })) as ClaimedJob;

    await expect(markNotificationJobSucceeded(staleWorker(job))).rejects.toThrow(
      /not held by this worker/,
    );

    // The current holder is unaffected.
    expect((await jobState(id)).status).toBe(JobStatus.PROCESSING);
  });

  it("failing a job this worker no longer holds is rejected", async () => {
    const id = await jobRow();
    const job = (await claimNextNotificationJob({ config: DEFAULT_WORKER })) as ClaimedJob;

    await expect(markNotificationJobFailed(staleWorker(job), new Error("boom"))).rejects.toThrow(
      /not held by this worker/,
    );

    expect((await jobState(id)).status).toBe(JobStatus.PROCESSING);
  });

  it("a reclaimed job cannot be settled by the worker that lost it", async () => {
    const id = await jobRow();
    const abandoned = (await claimNextNotificationJob({ config: DEFAULT_WORKER })) as ClaimedJob;
    // Its lease expires and another worker takes the job over.
    await prisma.notification.update({
      where: { id },
      data: { lockedAt: new Date(Date.now() - DEFAULT_WORKER.leaseMs - MINUTE) },
    });
    const reclaimed = (await claimNextNotificationJob({ config: DEFAULT_WORKER })) as ClaimedJob;
    expect(reclaimed.attempts).toBe(abandoned.attempts + 1);

    await expect(markNotificationJobSucceeded(abandoned)).rejects.toThrow(/not held by this worker/);
    await markNotificationJobSucceeded(reclaimed);
    expect((await jobState(id)).status).toBe(JobStatus.SUCCEEDED);
  });

  it("succeeding then failing the same claimed job: the second is rejected", async () => {
    const id = await jobRow();
    const job = (await claimNextNotificationJob({ config: DEFAULT_WORKER })) as ClaimedJob;

    await markNotificationJobSucceeded(job);
    await expect(markNotificationJobFailed(job, new Error("too late"))).rejects.toThrow(
      /not held by this worker/,
    );
    expect((await jobState(id)).status).toBe(JobStatus.SUCCEEDED);
  });
});

describe("a failed job retries on a backoff, then fails for good", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a failure under the attempt budget returns the job to PENDING, out of reach until its runAt", async () => {
    const id = await jobRow();
    const before = Date.now();
    const job = (await claimNextNotificationJob({ config: DEFAULT_WORKER })) as ClaimedJob;

    const outcome = await markNotificationJobFailed(job, new Error("provider timeout"), {
      config: DEFAULT_WORKER,
    });

    expect(outcome).toBe(JobStatus.PENDING);
    const state = await jobState(id);
    expect(state.status).toBe(JobStatus.PENDING);
    expect(state.lastError).toContain("provider timeout");
    expect(state.lockedAt).toBeNull();
    // Pushed past now by the backoff, so no other worker claims it yet.
    expect(state.runAt.getTime()).toBeGreaterThanOrEqual(before + backoffDelayMs(1, DEFAULT_WORKER) - 1_000);
    expect(await claimNextNotificationJob({ config: DEFAULT_WORKER })).toBeNull();
  });

  it("each retry waits longer, up to the ceiling", () => {
    expect(backoffDelayMs(1, DEFAULT_WORKER)).toBe(DEFAULT_WORKER.retryBaseMs);
    expect(backoffDelayMs(2, DEFAULT_WORKER)).toBe(DEFAULT_WORKER.retryBaseMs * 2);
    expect(backoffDelayMs(3, DEFAULT_WORKER)).toBe(DEFAULT_WORKER.retryBaseMs * 4);
    expect(backoffDelayMs(20, DEFAULT_WORKER)).toBe(DEFAULT_WORKER.retryMaxMs);
  });

  it("a job that spends its attempt budget ends FAILED and is not retried", async () => {
    const id = await jobRow({ attempts: DEFAULT_WORKER.maxAttempts - 1 });
    const job = (await claimNextNotificationJob({ config: DEFAULT_WORKER })) as ClaimedJob;
    expect(job.attempts).toBe(DEFAULT_WORKER.maxAttempts);

    const outcome = await markNotificationJobFailed(job, new Error("still down"), {
      config: DEFAULT_WORKER,
    });

    expect(outcome).toBe(JobStatus.FAILED);
    const state = await jobState(id);
    expect(state.status).toBe(JobStatus.FAILED);
    expect(state.lastError).toContain("still down");
    expect(await claimNextNotificationJob({ config: DEFAULT_WORKER })).toBeNull();
  });

  it("a full retry budget is walked attempt by attempt, ending FAILED", async () => {
    const id = await jobRow();
    // A backoff long enough that "not due yet" is a fact, not a race; each
    // iteration then pulls runAt forward to stand in for the wait elapsing.
    const config = { ...DEFAULT_WORKER, retryBaseMs: 60_000, retryMaxMs: 60_000 };

    for (let attempt = 1; attempt <= DEFAULT_WORKER.maxAttempts; attempt += 1) {
      const job = (await claimNextNotificationJob({ config })) as ClaimedJob;
      expect(job.attempts).toBe(attempt);

      await markNotificationJobFailed(job, new Error(`failure ${attempt}`), { config });

      // The failure pushed runAt out by the backoff, so no worker may take it.
      expect(await claimNextNotificationJob({ config })).toBeNull();
      if (attempt < DEFAULT_WORKER.maxAttempts) {
        await prisma.notification.update({ where: { id }, data: { runAt: new Date(Date.now() - 1) } });
      }
    }

    const state = await jobState(id);
    expect(state.status).toBe(JobStatus.FAILED);
    expect(state.attempts).toBe(DEFAULT_WORKER.maxAttempts);
    expect(await claimAll(10)).toEqual([]);
  });
});
