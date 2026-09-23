import { Prisma, UserRole, VerificationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { storage, type StorageService } from "@/lib/storage";
import { writeAuditLog, AUDIT_ACTIONS } from "@/modules/audit";
import { notify } from "@/modules/notifications";
import { assertAllowed } from "@/modules/identity/permissions";

export const VERIFIABLE_ROLES: readonly UserRole[] = [
  UserRole.AGENT,
  UserRole.AGENCY_ADMIN,
  UserRole.LANDLORD,
];

export interface Actor {
  userId: string;
  role: UserRole;
}

export interface AuditMeta {
  ipAddress?: string;
}

export interface SafeVerificationRequest {
  id: string;
  userId: string;
  status: VerificationStatus;
  reviewNote: string | null;
  reviewedById: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

// SEC-6 / UP-6: documentKey is an opaque storage key and is never returned.
function toSafe(
  request: {
    id: string;
    userId: string;
    status: VerificationStatus;
    reviewNote: string | null;
    reviewedById: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
    documentKey: string;
  },
): SafeVerificationRequest {
  const { documentKey: _documentKey, ...safe } = request;
  return safe;
}

export async function submitVerificationRequest(
  actor: Actor,
  input: { documentKey: string },
  deps: { storage?: StorageService; ipAddress?: string } = {},
): Promise<SafeVerificationRequest> {
  if (!VERIFIABLE_ROLES.includes(actor.role)) {
    throw ApiError.forbidden(
      "Only agents, agency admins, and landlords may request verification",
    );
  }
  const storageService = deps.storage ?? storage;
  if (!input.documentKey || !input.documentKey.startsWith("docs/")) {
    throw ApiError.validation("documentKey is required and must be under docs/");
  }
  // UP-9: the document must already exist in storage before a request can be filed.
  await storageService.assertObjectExists(input.documentKey);

  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.verificationRequest.create({
      data: { userId: actor.userId, documentKey: input.documentKey },
    });
    await writeAuditLog(tx, {
      userId: actor.userId,
      action: AUDIT_ACTIONS.VERIFICATION_SUBMITTED,
      targetId: request.id,
      ipAddress: deps.ipAddress ?? "internal",
    });
    return request;
  });
  return toSafe(created);
}

async function setProfileVerified(
  tx: Prisma.TransactionClient,
  user: { id: string; role: UserRole },
): Promise<void> {
  switch (user.role) {
    case UserRole.AGENT:
      await tx.agentProfile.updateMany({
        where: { userId: user.id },
        data: { verificationStatus: VerificationStatus.APPROVED },
      });
      break;
    case UserRole.AGENCY_ADMIN:
      await tx.agencyProfile.updateMany({
        where: { userId: user.id },
        data: { verificationStatus: VerificationStatus.APPROVED },
      });
      break;
    case UserRole.LANDLORD:
      await tx.landlordProfile.updateMany({
        where: { userId: user.id },
        data: { verificationStatus: VerificationStatus.APPROVED },
      });
      break;
    default:
      // Seekers, reviewers and admins have no verifiable profile.
      break;
  }
}

// PR-VER-002: APPROVED is only ever produced by this PLATFORM_REVIEWER action.
export async function approveVerification(
  requestId: string,
  reviewer: Actor,
  meta: AuditMeta = {},
): Promise<SafeVerificationRequest> {
  assertAllowed(reviewer.role, "REVIEW_VERIFICATION_AND_REPORTS");
  const now = new Date();

  const request = await prisma.$transaction(async (tx) => {
    // CS-4: guarded write — only a still-PENDING request can be decided.
    const updated = await tx.verificationRequest.updateMany({
      where: { id: requestId, status: VerificationStatus.PENDING },
      data: {
        status: VerificationStatus.APPROVED,
        reviewedById: reviewer.userId,
        reviewedAt: now,
      },
    });
    if (updated.count !== 1) {
      const existing = await tx.verificationRequest.findUnique({
        where: { id: requestId },
      });
      if (!existing) throw ApiError.notFound("Verification request not found");
      throw ApiError.conflict(
        "Verification request is already decided and cannot be edited (PR-VER-002, DB-6)",
      );
    }
    const decided = await tx.verificationRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    const owner = await tx.user.findUniqueOrThrow({ where: { id: decided.userId } });
    await setProfileVerified(tx, owner);
    await writeAuditLog(tx, {
      userId: reviewer.userId,
      action: AUDIT_ACTIONS.VERIFICATION_APPROVED,
      targetId: requestId,
      ipAddress: meta.ipAddress ?? "internal",
    });
    await notify(tx, { userId: owner.id, templateId: "VERIFICATION_APPROVED", vars: {} });
    return decided;
  });
  return toSafe(request);
}

// PR-VER-004: rejection cannot persist without a non-null reviewNote.
export async function rejectVerification(
  requestId: string,
  reviewer: Actor,
  input: { reviewNote: string },
  meta: AuditMeta = {},
): Promise<SafeVerificationRequest> {
  assertAllowed(reviewer.role, "REVIEW_VERIFICATION_AND_REPORTS");
  const reviewNote = input.reviewNote?.trim();
  if (!reviewNote) {
    throw ApiError.validation("reviewNote is required when rejecting (PR-VER-004)");
  }
  const now = new Date();

  const request = await prisma.$transaction(async (tx) => {
    const updated = await tx.verificationRequest.updateMany({
      where: { id: requestId, status: VerificationStatus.PENDING },
      data: {
        status: VerificationStatus.REJECTED,
        reviewNote,
        reviewedById: reviewer.userId,
        reviewedAt: now,
      },
    });
    if (updated.count !== 1) {
      const existing = await tx.verificationRequest.findUnique({
        where: { id: requestId },
      });
      if (!existing) throw ApiError.notFound("Verification request not found");
      throw ApiError.conflict(
        "Verification request is already decided and cannot be edited (PR-VER-002, DB-6)",
      );
    }
    await writeAuditLog(tx, {
      userId: reviewer.userId,
      action: AUDIT_ACTIONS.VERIFICATION_REJECTED,
      targetId: requestId,
      ipAddress: meta.ipAddress ?? "internal",
    });
    const decided = await tx.verificationRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    await notify(tx, {
      userId: decided.userId,
      templateId: "VERIFICATION_REJECTED",
      vars: { reviewNote },
    });
    return decided;
  });
  return toSafe(request);
}

const VERIFICATION_LIST_SORTS = ["createdAt", "reviewedAt"] as const;
export type VerificationSortField = (typeof VERIFICATION_LIST_SORTS)[number];

export interface VerificationListQuery {
  limit: number;
  offset: number;
  sort: VerificationSortField;
  order: "asc" | "desc";
  status?: VerificationStatus;
  userId?: string;
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

// Step 3 list: reviewer/super-admin sees all submissions (PR-ADM-001);
// a verifiable applicant sees only their own. A status or (for reviewers)
// applicant filter narrows the queue; sort is createdAt or reviewedAt.
export async function listVerificationRequests(
  actor: Actor,
  query: VerificationListQuery,
): Promise<ListResult<SafeVerificationRequest>> {
  const isReviewer =
    actor.role === UserRole.PLATFORM_REVIEWER || actor.role === UserRole.SUPER_ADMIN;
  const isApplicant = VERIFIABLE_ROLES.includes(actor.role);
  if (!isReviewer && !isApplicant) {
    throw ApiError.forbidden("Only reviewers and applicants can list verification requests");
  }

  const where: Prisma.VerificationRequestWhereInput = {};
  if (query.status) where.status = query.status;
  if (isReviewer) {
    if (query.userId) where.userId = query.userId;
  } else {
    if (query.userId && query.userId !== actor.userId) {
      throw ApiError.forbidden("You may only list your own verification requests");
    }
    where.userId = actor.userId;
  }

  const select = {
    id: true,
    userId: true,
    status: true,
    reviewNote: true,
    reviewedById: true,
    createdAt: true,
    reviewedAt: true,
  } as const;
  const orderBy = { [query.sort]: query.order } as const;

  const [items, total] = await Promise.all([
    prisma.verificationRequest.findMany({
      where,
      orderBy,
      skip: query.offset,
      take: query.limit,
      select,
    }),
    prisma.verificationRequest.count({ where }),
  ]);
  return { items, total };
}

// Step 3 item: reviewers may read any request; an applicant only their own.
export async function getVerificationRequestById(
  requestId: string,
  actor: Actor,
): Promise<SafeVerificationRequest> {
  const request = await prisma.verificationRequest.findUnique({ where: { id: requestId } });
  if (!request) throw ApiError.notFound("Verification request not found");
  const isReviewer =
    actor.role === UserRole.PLATFORM_REVIEWER || actor.role === UserRole.SUPER_ADMIN;
  if (request.userId !== actor.userId && !isReviewer) {
    throw ApiError.forbidden("You are not allowed to view this verification request");
  }
  return toSafe(request);
}

// UP-4: the applicant may fetch their own document URL; reviewers may fetch any.
export async function verificationDocumentUrl(
  requestId: string,
  actor: Actor,
  deps: { storage?: StorageService } = {},
): Promise<string> {
  const request = await prisma.verificationRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) throw ApiError.notFound("Verification request not found");
  const isReviewer =
    actor.role === UserRole.PLATFORM_REVIEWER || actor.role === UserRole.SUPER_ADMIN;
  if (actor.userId !== request.userId && !isReviewer) {
    throw ApiError.forbidden(
      "You are not allowed to access this verification document (UP-4)",
    );
  }
  const storageService = deps.storage ?? storage;
  return storageService.issueDocumentUrl(request.documentKey);
}