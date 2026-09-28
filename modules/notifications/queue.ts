import { JobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { getWorkerConfig, type WorkerConfig } from "@/lib/worker/config";

// The delivery worker claims Notification rows as its jobs: a Notification is
// the MVP's only unit of background work, and its deliverable is already keyed
// by its own id (NotificationDelivery.notificationId, PR-NOT-001/002). This
// module owns the queue state machine — PENDING -> PROCESSING -> SUCCEEDED or
// FAILED — and nothing else writes those columns.
//
// There is no actor and no AuditLog row on these transitions (CS-3): they are
// system transitions, not a user's action, and PR-ADM-002 scopes the audit log
// to verification, listing, and report decisions.
//
// Two rules make a claim safe with any number of worker processes running:
//
//   1. The claim is ONE statement that flips PENDING -> PROCESSING and returns
//      the row. `FOR UPDATE SKIP LOCKED` makes a concurrent worker skip the row
//      this one holds instead of blocking behind it, and the outer status
//      predicate is re-checked against the latest committed row, so a job that
//      was already claimed is never handed out twice. The database resolves
//      the race — no in-process lock, no read-then-write (CS-4).
//   2. Every terminal write is guarded on status = PROCESSING, so a worker
//      whose lease expired cannot settle a job another worker has since taken.

export interface ClaimedJob {
  id: string; // the job id, which is also the key of the delivery output
  attempts: number; // incremented by the claim; decides retry vs terminal
  claimedAt: Date; // the lease stamp this worker now owns
}

export interface QueueDeps {
  config?: WorkerConfig;
}

interface ClaimedRow {
  id: string;
  attempts: number;
  lockedAt: Date;
}

// The backoff before the next claim of a failed job: base * 2^(attempts-1),
// clamped to the ceiling so a long-failing job stops hammering the provider.
export function backoffDelayMs(attempts: number, config: WorkerConfig): number {
  const uncapped = config.retryBaseMs * 2 ** Math.max(0, attempts - 1);
  return Math.min(uncapped, config.retryMaxMs);
}

// Claims the oldest due job, or null when there is nothing to do. A job is due
// when it is PENDING and its runAt has passed, or when it is PROCESSING with an
// expired lease (the worker that held it died mid-job — a crash must not lose
// the job).
//
// Time is compared as an explicit UTC wall clock. The columns are
// `timestamp without time zone` and hold UTC (Prisma writes a JS Date as UTC
// and CURRENT_TIMESTAMP defaults store UTC), so a bare `now()` — a
// timestamptz — would be reinterpreted in the session TimeZone and shift every
// comparison by the server's UTC offset. `now() AT TIME ZONE 'UTC'` is the same
// instant expressed in the convention the columns actually store (CS-7: the
// server's clock decides, and it decides in UTC).
export async function claimNextNotificationJob(
  deps: QueueDeps = {},
): Promise<ClaimedJob | null> {
  const { leaseMs } = deps.config ?? getWorkerConfig();

  const rows = await prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
    UPDATE "Notification" AS job
    SET "status" = 'PROCESSING'::"JobStatus",
        "attempts" = job."attempts" + 1,
        "lockedAt" = (now() AT TIME ZONE 'UTC')
    WHERE (
            (job."status" = 'PENDING'::"JobStatus" AND job."runAt" <= (now() AT TIME ZONE 'UTC'))
         OR (job."status" = 'PROCESSING'::"JobStatus"
             AND job."lockedAt" <= (now() AT TIME ZONE 'UTC') - (${leaseMs}::double precision * interval '1 millisecond'))
          )
      AND job."id" = (
        SELECT due."id"
        FROM "Notification" AS due
        WHERE (due."status" = 'PENDING'::"JobStatus" AND due."runAt" <= (now() AT TIME ZONE 'UTC'))
           OR (due."status" = 'PROCESSING'::"JobStatus"
               AND due."lockedAt" <= (now() AT TIME ZONE 'UTC') - (${leaseMs}::double precision * interval '1 millisecond'))
        ORDER BY due."runAt" ASC, due."createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
    RETURNING job."id", job."attempts", job."lockedAt"
  `);

  const claimed = rows[0];
  if (!claimed) return null;
  return { id: claimed.id, attempts: claimed.attempts, claimedAt: claimed.lockedAt };
}

// Settles a job that did its work. Guarded on this worker still holding it —
// the claim incremented `attempts`, so a worker whose lease expired and whose
// job was taken over no longer matches and cannot settle the new holder's work
// (CS-4). The durable delivery marker (sentAt) stays owned by
// deliverNotification (PR-NOT-001).
export async function markNotificationJobSucceeded(job: ClaimedJob): Promise<void> {
  const updated = await prisma.notification.updateMany({
    where: heldBy(job),
    data: { status: JobStatus.SUCCEEDED, lockedAt: null, lastError: null },
  });
  if (updated.count !== 1) throw leaseLost(job.id);
}

// Settles a job whose work threw. While attempts remain the job goes back to
// PENDING with runAt pushed out by the backoff, which keeps it out of every
// other worker's claim until then; once the attempt budget is spent it becomes
// terminally FAILED and is never claimed again.
export async function markNotificationJobFailed(
  job: ClaimedJob,
  error: unknown,
  deps: QueueDeps = {},
): Promise<JobStatus> {
  const config = deps.config ?? getWorkerConfig();
  const exhausted = job.attempts >= config.maxAttempts;
  const retryAt = new Date(Date.now() + backoffDelayMs(job.attempts, config));

  const updated = await prisma.notification.updateMany({
    where: heldBy(job),
    data: {
      status: exhausted ? JobStatus.FAILED : JobStatus.PENDING,
      runAt: exhausted ? undefined : retryAt,
      lockedAt: null,
      lastError: describeFailure(error),
    },
  });
  if (updated.count !== 1) throw leaseLost(job.id);
  return exhausted ? JobStatus.FAILED : JobStatus.PENDING;
}

// The ownership predicate for a settle: the row is still PROCESSING and still
// at the attempt count this worker's claim produced. Integer equality, so the
// guard does not depend on timestamp round-tripping.
function heldBy(job: ClaimedJob): { id: string; status: JobStatus; attempts: number } {
  return { id: job.id, status: JobStatus.PROCESSING, attempts: job.attempts };
}

// A dead-letter reason is worth keeping, but an unbounded error string is not:
// the column is TEXT and a stack trace would grow it without limit.
const MAX_ERROR_LENGTH = 2_000;

function describeFailure(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

function leaseLost(jobId: string): ApiError {
  return ApiError.conflict(
    `Job ${jobId} is not held by this worker: its lease expired, another worker took it, or it was already settled`,
  );
}
