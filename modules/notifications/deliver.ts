import { NotificationChannel, Prisma, type Notification } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { NOTIFICATION_TEMPLATES, renderTemplate, type NotificationTemplateId } from "@/modules/notifications";

// Step 5 — idempotent delivery work.
//
// Hazard: a worker can crash after doing the work (the send) but before
// marking the job succeeded (Notification.sentAt). The retry would then send
// the same message twice. The contract here makes a second run safe:
//
//   1. The output (the deliverable message) is stored keyed BY THE JOB ID —
//      NotificationDelivery.notificationId is its primary key.
//   2. Before producing anything, the worker checks whether that keyed output
//      already exists; if it does, it skips the send and only finishes the
//      job ("check whether the output already exists before producing it").
//   3. The job is only marked succeeded (sentAt) after the output is durable.

type Vars = Record<string, string | number>;

export interface DeliveryMessage {
  notificationId: string; // the job id — the key of the output
  channel: NotificationChannel;
  to: string;
  body: string;
}

export interface DeliveryResult {
  ref: string;
  newlyProduced: boolean;
}

// A messenger producing the external side effect (an email, an in-app push).
// It MUST be idempotent per job id: given the same notificationId a retry
// returns the existing artifact instead of producing a second one. Real
// providers implement this with their idempotency-key feature; the bundled
// implementation keys artifacts on the job id in this database.
export interface Messenger {
  send(message: DeliveryMessage): Promise<DeliveryResult>;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// Default messenger at MVP claims no external provider. The artifact row IS
// the output, and its notificationId key is what makes a retry a no-op:
// a re-run finds the existing row and produces nothing new.
export const databaseMessenger: Messenger = {
  async send(message) {
    const existing = await prisma.notificationDelivery.findUnique({
      where: { notificationId: message.notificationId },
    });
    if (existing) return { ref: existing.providerRef, newlyProduced: false };
    const ref = `em://${message.notificationId}`;
    try {
      await prisma.notificationDelivery.create({
        data: {
          notificationId: message.notificationId,
          channel: message.channel,
          to: message.to,
          body: message.body,
          providerRef: ref,
        },
      });
      return { ref, newlyProduced: true };
    } catch (error) {
      // A concurrent retry wrote the keyed output first — reuse it.
      if (isUniqueViolation(error)) {
        const winner = await prisma.notificationDelivery.findUniqueOrThrow({
          where: { notificationId: message.notificationId },
        });
        return { ref: winner.providerRef, newlyProduced: false };
      }
      throw error;
    }
  },
};

// "verification_approved@v1" -> "VERIFICATION_APPROVED", so the stored,
// versioned template key can be rendered against its persisted vars.
const TEMPLATE_BY_ID: Record<string, NotificationTemplateId> = Object.fromEntries(
  Object.entries(NOTIFICATION_TEMPLATES).map(([key, definition]) => [
    definition.id,
    key as NotificationTemplateId,
  ]),
);

function templateKeyFor(stored: string): NotificationTemplateId {
  const id = stored.split("@v")[0];
  const key = TEMPLATE_BY_ID[id];
  if (!key) throw ApiError.config(`Notification template ${stored} is not registered`);
  return key;
}

export type DeliverOutcome = "DELIVERED" | "SKIPPED_ALREADY_DELIVERED" | "NOT_FOUND";

export interface DeliverResult {
  outcome: DeliverOutcome;
  ref: string | null;
}

export interface DeliverDeps {
  messenger?: Messenger;
}

// Delivers ONE notification. Safe to run twice (Step 5): the second run finds
// the already-produced output under the job id and only finishes the job.
export async function deliverNotification(
  notificationId: string,
  deps: DeliverDeps = {},
): Promise<DeliverResult> {
  const messenger = deps.messenger ?? databaseMessenger;

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: { user: { select: { email: true } } },
  });
  if (!notification) return { outcome: "NOT_FOUND", ref: null };

  // Output-exists check: the job is already marked done — nothing to do.
  // (The post-send crash/mark gap is covered by the keyed artifact below.)
  if (notification.sentAt) return { outcome: "SKIPPED_ALREADY_DELIVERED", ref: null };

  const body = renderNotificationBody(notification);
  const { ref, newlyProduced } = await messenger.send({
    notificationId,
    channel: notification.channel,
    to: recipientFor(notification),
    body,
  });

  // Finish the job. Guarded on sentAt IS NULL so a concurrent or prior run
  // that already finished is tolerated; the point of the keyed output is that
  // it was produced at most once regardless of which run finished it.
  await prisma.notification.updateMany({
    where: { id: notificationId, sentAt: null },
    data: { sentAt: new Date() },
  });

  return {
    outcome: newlyProduced ? "DELIVERED" : "SKIPPED_ALREADY_DELIVERED",
    ref,
  };
}

function recipientFor(
  notification: Notification & { user: { email: string } },
): string {
  return notification.channel === NotificationChannel.EMAIL
    ? notification.user.email
    : notification.userId;
}

export function renderNotificationBody(
  notification: Pick<Notification, "template" | "vars">,
): string {
  return renderTemplate(templateKeyFor(notification.template), (notification.vars ?? {}) as Vars);
}

export interface FlushSummary {
  delivered: number;
  skipped: number;
  notFound: number;
}

// The queue-pump entry point a scheduler/worker calls. It claims no global
// lock; deliverNotification's per-job output key makes concurrent pumps safe.
export async function flushPendingNotifications(deps: { messenger?: Messenger; limit?: number } = {}): Promise<FlushSummary> {
  const pending = await prisma.notification.findMany({
    where: { sentAt: null },
    orderBy: { createdAt: "asc" },
    take: deps.limit ?? 10,
    select: { id: true },
  });

  const summary: FlushSummary = { delivered: 0, skipped: 0, notFound: 0 };
  for (const notification of pending) {
    const { outcome } = await deliverNotification(notification.id, deps);
    if (outcome === "DELIVERED") summary.delivered += 1;
    else if (outcome === "SKIPPED_ALREADY_DELIVERED") summary.skipped += 1;
    else summary.notFound += 1;
  }
  return summary;
}