import { Prisma, ReportTargetType, ReviewCaseStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { writeAuditLog, AUDIT_ACTIONS } from "@/modules/audit";
import { suspendListing } from "@/modules/listings";
import { assertAllowed } from "@/modules/identity/permissions";
import type { Actor, AuditMeta, ListResult } from "@/modules/verification";

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
    throw ApiError.validation("reason is required (10-2000 characters)");
  }
  if (input.targetType !== ReportTargetType.LISTING && input.targetType !== ReportTargetType.PROFILE) {
    throw ApiError.validation("targetType is invalid");
  }
  if (input.targetType === ReportTargetType.LISTING && !input.listingId) {
    throw ApiError.validation("listingId is required for a LISTING report");
  }
  if (input.targetType === ReportTargetType.PROFILE && !input.targetUserId) {
    throw ApiError.validation("targetUserId is required for a PROFILE report");
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

function isReviewerRole(role: UserRole): boolean {
  return role === UserRole.PLATFORM_REVIEWER || role === UserRole.SUPER_ADMIN;
}

const REPORT_LIST_SORTS = ["createdAt"] as const;
export type ReportSortField = (typeof REPORT_LIST_SORTS)[number];

export interface ReportListQuery {
  limit: number;
  offset: number;
  sort: ReportSortField;
  order: "asc" | "desc";
  targetType?: ReportTargetType;
  reporterId?: string;
  resolved?: boolean;
}

// Step 3 list: a reviewer sees every report; a seeker sees only their own.
// Filters: targetType, resolved (via the case state, DB-9), reporterId.
export async function listReports(
  actor: Actor,
  query: ReportListQuery,
): Promise<ListResult<SafeReport>> {
  const isReviewer = isReviewerRole(actor.role);
  if (!isReviewer && actor.role !== UserRole.SEEKER) {
    throw ApiError.forbidden("Only reviewers and seekers can list reports");
  }

  const where: Prisma.ReportWhereInput = {};
  if (isReviewer) {
    if (query.reporterId) where.reporterId = query.reporterId;
  } else {
    if (query.reporterId && query.reporterId !== actor.userId) {
      throw ApiError.forbidden("You may only list your own reports");
    }
    where.reporterId = actor.userId;
  }
  if (query.targetType) where.targetType = query.targetType;
  if (query.resolved === true) {
    where.reviewCase = { is: { status: ReviewCaseStatus.RESOLVED } };
  } else if (query.resolved === false) {
    // DB-9: an open report has no case yet or a case that is not RESOLVED.
    where.OR = [
      { reviewCase: { is: null } },
      { reviewCase: { is: { status: { not: ReviewCaseStatus.RESOLVED } } } },
    ];
  }

  const select = {
    id: true,
    reporterId: true,
    targetType: true,
    listingId: true,
    targetUserId: true,
    reason: true,
    createdAt: true,
  } as const;

  const [items, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { [query.sort]: query.order },
      skip: query.offset,
      take: query.limit,
      select,
    }),
    prisma.report.count({ where }),
  ]);
  return { items, total };
}

export async function getReportById(reportId: string, actor: Actor): Promise<SafeReport> {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) throw ApiError.notFound("Report not found");
  const isReviewer = isReviewerRole(actor.role);
  if (!isReviewer && report.reporterId !== actor.userId) {
    throw ApiError.forbidden("You are not allowed to view this report");
  }
  return {
    id: report.id,
    reporterId: report.reporterId,
    targetType: report.targetType,
    listingId: report.listingId,
    targetUserId: report.targetUserId,
    reason: report.reason,
    createdAt: report.createdAt,
  };
}

const QUEUE_STATUS_FILTER = ["OPEN", "UNDER_REVIEW", "RESOLVED"] as const;
export type QueueStatusFilter = (typeof QUEUE_STATUS_FILTER)[number];

export interface ReviewQueueQuery {
  limit: number;
  offset: number;
  sort: "createdAt";
  order: "asc" | "desc";
  status?: QueueStatusFilter;
  targetType?: ReportTargetType;
}

// Step 3 collection endpoint for ReviewCase. The queue defaults to unresolved
// cases (FIFO by createdAt); a status filter widens or narrows it.
export async function listReviewQueue(
  reviewer: Actor,
  query: ReviewQueueQuery,
): Promise<ListResult<ReviewerCaseInfo>> {
  assertAllowed(reviewer.role, "REVIEW_VERIFICATION_AND_REPORTS");

  const where: Prisma.ReviewCaseWhereInput = {};
  if (query.status) {
    where.status = query.status as ReviewCaseStatus;
  } else {
    where.status = { in: [ReviewCaseStatus.OPEN, ReviewCaseStatus.UNDER_REVIEW] };
  }
  if (query.targetType) where.report = { is: { targetType: query.targetType } };

  const include = {
    report: {
      select: { targetType: true, listingId: true, targetUserId: true, reason: true },
    },
  } as const;

  const [cases, total] = await Promise.all([
    prisma.reviewCase.findMany({
      where,
      orderBy: { [query.sort]: query.order },
      skip: query.offset,
      take: query.limit,
      include,
    }),
    prisma.reviewCase.count({ where }),
  ]);

  return {
    items: cases.map((c) => ({ ...toSafeCase(c), ...c.report })),
    total,
  };
}

// Step 3 item endpoint for ReviewCase (reviewer only).
export async function getReviewCaseById(
  caseId: string,
  actor: Actor,
): Promise<ReviewerCaseInfo> {
  assertAllowed(actor.role, "REVIEW_VERIFICATION_AND_REPORTS");
  const found = await prisma.reviewCase.findUnique({
    where: { id: caseId },
    include: { report: { select: { targetType: true, listingId: true, targetUserId: true, reason: true } } },
  });
  if (!found) throw ApiError.notFound("Review case not found");
  return { ...toSafeCase(found), ...found.report };
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
    throw ApiError.validation("resolution is required");
  }
  const action = input.action ?? "NONE";
  if (action !== "NONE" && action !== "SUSPEND_LISTING") {
    throw ApiError.validation("action is invalid");
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
        throw ApiError.validation(
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