import { Prisma, ReportTargetType, ReviewCaseStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { writeAuditLog, AUDIT_ACTIONS } from "@/modules/audit";
import { suspendListing } from "@/modules/listings";
import { assertAllowed } from "@/modules/identity/permissions";
import type { Actor, AuditMeta } from "@/modules/verification";

const REPORT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // rolling 30-day window (PR-REP-002)

// DB-9: an "open" report is one whose ReviewCase (if any) is not RESOLVED.
// A report with an OPEN/UNDER_REVIEW case is still open.
function openReportWhere(
  target: { listingId?: string; targetUserId?: string },
  since?: Date,
): Prisma.ReportWhereInput {
  return {
    listingId: target.listingId,
    targetUserId: target.targetUserId,
    createdAt: since ? { gte: since } : undefined,
    OR: [
      { reviewCase: { is: null } },
      { reviewCase: { is: { status: { not: ReviewCaseStatus.RESOLVED } } } },
    ],
  };
}

async function countOpenForTarget(
  tx: Prisma.TransactionClient,
  target: { listingId?: string; targetUserId?: string },
  since?: Date,
): Promise<number> {
  return tx.report.count({ where: openReportWhere(target, since) });
}

export interface CreateReportInput {
  targetType: ReportTargetType;
  listingId?: string | null;
  targetUserId?: string | null;
  reason: string;
}

export interface SafeReport {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  listingId: string | null;
  targetUserId: string | null;
  reason: string;
  createdAt: Date;
}

// PR-REP-001 / PR-BOK-003: only authenticated seekers can report; every
// report enters the same queue (no private side-channel).
export async function createReport(
  actor: Actor,
  input: CreateReportInput,
  meta: AuditMeta = {},
): Promise<{ report: SafeReport; reviewCaseId: string | null }> {
  if (actor.role !== UserRole.SEEKER) {
    throw ApiError.forbidden("Only seekers can submit reports (PR-REP-001)");
  }
  const reason = input.reason?.trim();
  if (!reason || reason.length < 10 || reason.length > 2000) {
    throw ApiError.badRequest("reason is required (10-2000 characters)");
  }
  if (input.targetType !== ReportTargetType.LISTING && input.targetType !== ReportTargetType.PROFILE) {
    throw ApiError.badRequest("targetType is invalid");
  }
  if (input.targetType === ReportTargetType.LISTING && !input.listingId) {
    throw ApiError.badRequest("listingId is required for a LISTING report");
  }
  if (input.targetType === ReportTargetType.PROFILE && !input.targetUserId) {
    throw ApiError.badRequest("targetUserId is required for a PROFILE report");
  }

  const { report, reviewCaseId } = await prisma.$transaction(async (tx) => {
    if (input.targetType === ReportTargetType.LISTING) {
      const listing = await tx.listing.findUnique({ where: { id: input.listingId! } });
      if (!listing) throw ApiError.notFound("Listing not found");
    }
    if (input.targetType === ReportTargetType.PROFILE) {
      const target = await tx.user.findUnique({ where: { id: input.targetUserId! } });
      if (!target) throw ApiError.notFound("Target account not found");
    }

    const report = await tx.report.create({
      data: {
        reporterId: actor.userId,
        targetType: input.targetType,
        listingId: input.targetType === ReportTargetType.LISTING ? input.listingId : null,
        targetUserId: input.targetType === ReportTargetType.PROFILE ? input.targetUserId : null,
        reason,
      },
    });

    // PR-LST-003: hasOpenReports is maintained by this single writer and only
    // recomputed here (DB-8). A listing with an open report stays VISIBLE in
    // search — nothing below filters listings out.
    if (report.listingId) {
      const openCount = await countOpenForTarget(tx, { listingId: report.listingId });
      await tx.listing.updateMany({
        where: { id: report.listingId },
        data: { hasOpenReports: openCount > 0 },
      });
    }

    // PR-REP-002: 3+ open reports within the rolling window creates a
    // ReviewCase. It never suspends anything on its own.
    const windowStart = new Date(Date.now() - REPORT_WINDOW_MS);
    const target =
      input.targetType === ReportTargetType.LISTING
        ? { listingId: report.listingId! }
        : { targetUserId: report.targetUserId! };
    const openInWindow = await countOpenForTarget(tx, target, windowStart);

    let caseId: string | null = null;
    if (openInWindow >= 3) {
      const existingCase = await tx.reviewCase.findFirst({
        where: {
          report: {
            listingId: report.listingId,
            targetUserId: report.targetUserId,
          },
          status: { not: ReviewCaseStatus.RESOLVED },
        },
      });
      if (!existingCase) {
        const createdCase = await tx.reviewCase.create({ data: { reportId: report.id } });
        caseId = createdCase.id;
      }
    }
    return { report, reviewCaseId: caseId };
  });

  return {
    report: {
      id: report.id,
      reporterId: report.reporterId,
      targetType: report.targetType,
      listingId: report.listingId,
      targetUserId: report.targetUserId,
      reason: report.reason,
      createdAt: report.createdAt,
    },
    reviewCaseId,
  };
}

export interface SafeReviewCase {
  id: string;
  reportId: string;
  status: ReviewCaseStatus;
  resolution: string | null;
  resolvedById: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

function toSafeCase(row: {
  id: string;
  reportId: string;
  status: ReviewCaseStatus;
  resolution: string | null;
  resolvedById: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}): SafeReviewCase {
  return row;
}

export interface ReviewerCaseInfo extends SafeReviewCase {
  targetType: ReportTargetType;
  listingId: string | null;
  targetUserId: string | null;
  reason: string;
}

export async function listReviewQueue(reviewer: Actor): Promise<ReviewerCaseInfo[]> {
  assertAllowed(reviewer.role, "REVIEW_VERIFICATION_AND_REPORTS");
  const cases = await prisma.reviewCase.findMany({
    where: { status: { in: [ReviewCaseStatus.OPEN, ReviewCaseStatus.UNDER_REVIEW] } },
    orderBy: { createdAt: "asc" },
    include: {
      report: {
        select: { targetType: true, listingId: true, targetUserId: true, reason: true },
      },
    },
  });
  return cases.map((c) => ({ ...toSafeCase(c), ...c.report }));
}

export type ResolutionAction = "NONE" | "SUSPEND_LISTING";

export interface ResolveCaseInput {
  resolution: string;
  action?: ResolutionAction;
}

export async function resolveReviewCase(
  caseId: string,
  reviewer: Actor,
  input: ResolveCaseInput,
  meta: AuditMeta = {},
): Promise<SafeReviewCase> {
  assertAllowed(reviewer.role, "REVIEW_VERIFICATION_AND_REPORTS");
  const resolution = input.resolution?.trim();
  if (!resolution) {
    throw ApiError.badRequest("resolution is required");
  }
  const action = input.action ?? "NONE";
  if (action !== "NONE" && action !== "SUSPEND_LISTING") {
    throw ApiError.badRequest("action is invalid");
  }
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.reviewCase.findUnique({
      where: { id: caseId },
      include: { report: true },
    });
    if (!existing) throw ApiError.notFound("Review case not found");

    // CS-4 guarded write: only OPEN/UNDER_REVIEW cases can be resolved.
    const updated = await tx.reviewCase.updateMany({
      where: {
        id: caseId,
        status: { in: [ReviewCaseStatus.OPEN, ReviewCaseStatus.UNDER_REVIEW] },
      },
      data: { status: ReviewCaseStatus.RESOLVED, resolution, resolvedById: reviewer.userId, resolvedAt: now },
    });
    if (updated.count !== 1) {
      throw ApiError.conflict(
        "Review case is already resolved and cannot be edited (DB-6)",
      );
    }

    if (action === "SUSPEND_LISTING") {
      // Q3#11: the resolution record above is written in the same
      // transaction that authorizes the suspension.
      if (existing.report.targetType !== ReportTargetType.LISTING || !existing.report.listingId) {
        throw ApiError.badRequest(
          "SUSPEND_LISTING requires a case whose report targets a listing; account suspension is out of scope until the PRD defines it",
        );
      }
      await suspendListing(tx, existing.report.listingId, {
        resolvedById: reviewer.userId,
        ipAddress: meta.ipAddress,
      });
    }

    await writeAuditLog(tx, {
      userId: reviewer.userId,
      action: AUDIT_ACTIONS.REVIEW_CASE_RESOLVED,
      targetId: caseId,
      ipAddress: meta.ipAddress ?? "internal",
    });

    return existing;
  });

  return toSafeCase({
    id: result.id,
    reportId: result.reportId,
    status: ReviewCaseStatus.RESOLVED,
    resolution,
    resolvedById: reviewer.userId,
    createdAt: result.createdAt,
    resolvedAt: now,
  });
}