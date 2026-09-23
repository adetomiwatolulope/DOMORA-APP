import { NotificationChannel, UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  databaseMessenger,
  deliverNotification,
  flushPendingNotifications,
  renderNotificationBody,
  type Messenger,
} from "@/modules/notifications/deliver";
import { makeUser, resetDb } from "../helpers";

// Step 5: the delivery worker must tolerate a second run. The output (the
// deliverable message) is keyed by the job id (notificationId); a re-run
// checks that keyed output exists before producing anything, and only then
// finishes the job (sentAt). These tests exercise exactly the
// crash-after-work-before-ack case.

async function notificationRow(overrides: { channel?: NotificationChannel; template?: string } = {}) {
  const user = await makeUser(UserRole.SEEKER, `n${Date.now()}@example.com`);
  return prisma.notification.create({
    data: {
      userId: user.userId,
      channel: overrides.channel ?? NotificationChannel.EMAIL,
      template: overrides.template ?? "verification_approved@v1",
      vars: {},
    },
  });
}

describe("notification delivery is idempotent (Step 5)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("first run delivers and records ONE artifact keyed by the job id", async () => {
    const row = await notificationRow();

    const first = await deliverNotification(row.id);
    expect(first.outcome).toBe("DELIVERED");

    const artifact = await prisma.notificationDelivery.findUnique({
      where: { notificationId: row.id },
    });
    expect(artifact).not.toBeNull();
    expect(artifact?.notificationId).toBe(row.id); // job id is the output key
    const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
    expect(artifact?.to).toBe(user.email); // recipient is the seeker's email
  });

  it("a second run after success is a no-op: no duplicate artifact, job stays done", async () => {
    const row = await notificationRow();
    await deliverNotification(row.id);

    const second = await deliverNotification(row.id);
    expect(second.outcome).toBe("SKIPPED_ALREADY_DELIVERED");

    const artifacts = await prisma.notificationDelivery.count({ where: { notificationId: row.id } });
    expect(artifacts).toBe(1);
    const done = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(done.sentAt).not.toBeNull();
  });

  it("crash after the send but before marking succeeds is safe on re-run", async () => {
    const row = await notificationRow({ channel: NotificationChannel.EMAIL });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
    const body = renderNotificationBody(row);

    // The worker doing the first pass: the messenger produced the output
    // (recorded keyed by job id) but the process died before stamping sentAt.
    const produced = await databaseMessenger.send({
      notificationId: row.id,
      channel: NotificationChannel.EMAIL,
      to: user.email,
      body,
    });
    expect(produced.newlyProduced).toBe(true);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).sentAt).toBeNull();

    // The retry must NOT produce the output again; it must finish the job.
    const retry = await deliverNotification(row.id);
    expect(retry.outcome).toBe("SKIPPED_ALREADY_DELIVERED");

    const artifacts = await prisma.notificationDelivery.count({ where: { notificationId: row.id } });
    expect(artifacts).toBe(1); // still exactly one — nothing was reproduced
    const done = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(done.sentAt).not.toBeNull();
  });

  it("a counting messenger proves the output is produced at most once per job id", async () => {
    const row = await notificationRow();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });

    const produced = new Map<string, number>();
    const countingMessenger: Messenger = {
      async send(message) {
        const prior = produced.get(message.notificationId) ?? 0;
        if (prior > 0) return { ref: `fake:${message.notificationId}`, newlyProduced: false };
        produced.set(message.notificationId, prior + 1);
        return { ref: `fake:${message.notificationId}`, newlyProduced: true };
      },
    };

    // First pass: side effect happens, "worker crashes" before the ack.
    const first = await countingMessenger.send({
      notificationId: row.id,
      channel: NotificationChannel.EMAIL,
      to: user.email,
      body: "body",
    });
    expect(first.newlyProduced).toBe(true);

    // Retry with the same messenger: the earlier output already exists
    // under the job id, so no second side effect is produced.
    const retry = await deliverNotification(row.id, { messenger: countingMessenger });
    expect(retry.outcome).toBe("SKIPPED_ALREADY_DELIVERED");
    expect(produced.get(row.id)).toBe(1);
  });

  it("unknown notification id is NOT_FOUND with no side effects", async () => {
    const result = await deliverNotification("00000000-0000-4000-8000-000000000000");
    expect(result.outcome).toBe("NOT_FOUND");
    expect(await prisma.notificationDelivery.count()).toBe(0);
  });

  it("concurrent double-run produces exactly one artifact", async () => {
    const row = await notificationRow();

    const results = await Promise.all([
      deliverNotification(row.id),
      deliverNotification(row.id),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["DELIVERED", "SKIPPED_ALREADY_DELIVERED"]);

    const artifacts = await prisma.notificationDelivery.count({ where: { notificationId: row.id } });
    expect(artifacts).toBe(1);
  });

  it("the pump processes only undelivered rows and never re-sends on re-runs", async () => {
    const first = await notificationRow();
    const second = await notificationRow();

    const runOne = await flushPendingNotifications();
    expect(runOne.delivered).toBe(2);
    expect(runOne.skipped).toBe(0);

    const after = await prisma.notification.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { sentAt: true },
    });
    expect(after.every((n) => n.sentAt !== null)).toBe(true);

    // A row that finished a prior flush is no longer pending: a re-run is a
    // no-op rather than a re-send.
    const reRun = await flushPendingNotifications();
    expect(reRun).toEqual({ delivered: 0, skipped: 0, notFound: 0 });

    // Crash-window row: output already exists under the job id, job never
    // acked. The pump skips producing and just finishes the job.
    const crashed = await notificationRow();
    const crashedUser = await prisma.user.findUniqueOrThrow({ where: { id: crashed.userId } });
    await databaseMessenger.send({
      notificationId: crashed.id,
      channel: NotificationChannel.EMAIL,
      to: crashedUser.email,
      body: "body",
    });
    const crashRun = await flushPendingNotifications();
    expect(crashRun.skipped).toBe(1);
    expect(crashRun.delivered).toBe(0);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: crashed.id } })).sentAt,
    ).not.toBeNull();

    // A genuinely new row is picked up and delivered.
    const third = await notificationRow();
    const runTwo = await flushPendingNotifications();
    expect(runTwo.delivered).toBe(1);
    expect(runTwo.skipped).toBe(0);

    const thirdArtifact = await prisma.notificationDelivery.count({
      where: { notificationId: third.id },
    });
    expect(thirdArtifact).toBe(1);
    const thirdRow = await prisma.notification.findUniqueOrThrow({ where: { id: third.id } });
    expect(thirdRow.sentAt).not.toBeNull();
  });

  it("records the EMAIL recipient (user email) vs IN_APP recipient (user id)", async () => {
    const email = await notificationRow({ channel: NotificationChannel.EMAIL });
    const inApp = await notificationRow({ channel: NotificationChannel.IN_APP, template: "affiliation_accepted@v1" });
    const emailUser = await prisma.user.findUniqueOrThrow({ where: { id: email.userId } });

    await deliverNotification(email.id);
    await deliverNotification(inApp.id);

    const emailArtifact = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { notificationId: email.id },
    });
    const inAppArtifact = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { notificationId: inApp.id },
    });
    expect(emailArtifact.to).toBe(emailUser.email);
    expect(inAppArtifact.to).toBe(inApp.userId);
  });
});