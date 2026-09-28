import { JobStatus, NotificationChannel, UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { DEFAULT_WORKER, type WorkerConfig } from "@/lib/worker/config";
import type { DeliveryMessage, DeliveryResult, Messenger } from "@/modules/notifications/deliver";
import { runWorkerTick } from "../../worker/pump";
import { makeUser, resetDb } from "../helpers";

// The worker end to end against the real database: claim, deliver, settle, and
// respect the concurrency cap while it does it.

function config(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return { ...DEFAULT_WORKER, pollIntervalMs: 1, ...overrides };
}

async function seedJobs(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const user = await makeUser(UserRole.SEEKER, `t${i}${Math.random().toString(36).slice(2, 8)}@example.com`);
    const row = await prisma.notification.create({
      data: {
        userId: user.userId,
        channel: NotificationChannel.IN_APP,
        template: "verification_approved@v1",
        vars: {},
      },
    });
    ids.push(row.id);
  }
  return ids;
}

// A messenger that records how many sends overlap, so the cap is observable.
function countingMessenger(delayMs = 5): Messenger & { peak: number; sent: string[] } {
  const state = { inFlight: 0, peak: 0, sent: [] as string[] };
  return {
    get peak() {
      return state.peak;
    },
    get sent() {
      return state.sent;
    },
    async send(message: DeliveryMessage): Promise<DeliveryResult> {
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      state.sent.push(message.notificationId);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      state.inFlight -= 1;
      return { ref: `test:${message.notificationId}`, newlyProduced: true };
    },
  };
}

describe("worker tick", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("does nothing when the queue is empty", async () => {
    expect(await runWorkerTick({ config: config() })).toEqual({
      claimed: 0,
      succeeded: 0,
      retried: 0,
      failed: 0,
    });
  });

  it("claims, delivers, and settles the due jobs", async () => {
    const ids = await seedJobs(3);

    // The real messenger, so the delivery output is the durable artifact row
    // PR-NOT keys by job id.
    const summary = await runWorkerTick({ config: config() });

    expect(summary).toEqual({ claimed: 3, succeeded: 3, retried: 0, failed: 0 });
    const rows = await prisma.notification.findMany({
      where: { id: { in: ids } },
      select: { status: true, sentAt: true, lockedAt: true },
    });
    expect(rows.every((row) => row.status === JobStatus.SUCCEEDED)).toBe(true);
    expect(rows.every((row) => row.sentAt !== null)).toBe(true);
    expect(rows.every((row) => row.lockedAt === null)).toBe(true);
    // Idempotency still holds through the worker: one output per job id.
    expect(await prisma.notificationDelivery.count({ where: { notificationId: { in: ids } } })).toBe(3);
  });

  it("never exceeds the configured concurrency cap", async () => {
    await seedJobs(6);
    const messenger = countingMessenger(10);

    const first = await runWorkerTick({ config: config({ concurrency: 2 }), messenger });
    const second = await runWorkerTick({ config: config({ concurrency: 2 }), messenger });

    expect(first.claimed).toBe(2); // the cap bounds claims per tick too
    expect(first.succeeded).toBe(2);
    expect(second.claimed).toBe(2);
    expect(messenger.peak).toBeLessThanOrEqual(2);
    expect(messenger.sent).toHaveLength(4);
    expect(await prisma.notification.count({ where: { status: JobStatus.PENDING } })).toBe(2);
  });

  it("a job that throws is queued for retry, not lost, and the others still settle", async () => {
    const ids = await seedJobs(3);
    const failingId = ids[1] as string;
    const flaky: Messenger = {
      async send(message) {
        if (message.notificationId === failingId) throw new Error("provider rejected the message");
        return { ref: `test:${message.notificationId}`, newlyProduced: true };
      },
    };

    const summary = await runWorkerTick({ config: config(), messenger: flaky });

    expect(summary).toEqual({ claimed: 3, succeeded: 2, retried: 1, failed: 0 });
    const failedJob = await prisma.notification.findUniqueOrThrow({ where: { id: failingId } });
    expect(failedJob.status).toBe(JobStatus.PENDING); // waiting out its backoff
    expect(failedJob.lastError).toContain("provider rejected the message");
    expect(failedJob.attempts).toBe(1);
  });

  it("a job past its attempt budget is failed for good", async () => {
    const [id] = await seedJobs(1);
    const exhausted = config({ maxAttempts: 1 });
    const alwaysFails: Messenger = {
      async send() {
        throw new Error("permanently broken");
      },
    };

    const summary = await runWorkerTick({ config: exhausted, messenger: alwaysFails });

    expect(summary).toEqual({ claimed: 1, succeeded: 0, retried: 0, failed: 1 });
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: id as string } });
    expect(row.status).toBe(JobStatus.FAILED);
    expect(row.lastError).toContain("permanently broken");
    // A terminal failure is not picked up again by the next tick.
    expect((await runWorkerTick({ config: exhausted, messenger: alwaysFails })).claimed).toBe(0);
  });

  it("a job scheduled in the future is left alone until it is due", async () => {
    const [id] = await seedJobs(1);
    await prisma.notification.update({
      where: { id: id as string },
      data: { runAt: new Date(Date.now() + 60 * 60_000) },
    });

    expect((await runWorkerTick({ config: config() })).claimed).toBe(0);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: id as string } })).status,
    ).toBe(JobStatus.PENDING);
  });
});
