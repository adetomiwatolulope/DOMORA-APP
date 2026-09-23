import type { Prisma } from "@prisma/client";

// Append-only audit log (PR-ADM-002, AGENTS-Q3#14). The only export that
// touches AuditLog is an append. There is deliberately no update, upsert,
// or delete on AuditLog anywhere in the codebase (DB-6).

export const AUDIT_ACTIONS = {
  VERIFICATION_SUBMITTED: "verification.submitted",
  VERIFICATION_APPROVED: "verification.approved",
  VERIFICATION_REJECTED: "verification.rejected",
  AFFILIATION_REQUESTED: "affiliation.requested",
  AFFILIATION_ACCEPTED: "affiliation.accepted",
  AFFILIATION_REJECTED: "affiliation.rejected",
  LISTING_CREATED: "listing.created",
  LISTING_APPROVED: "listing.approved",
  LISTING_SUSPENDED: "listing.suspended",
  REVIEW_CASE_RESOLVED: "review_case.resolved",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  userId: string;
  action: AuditAction;
  targetId: string;
  ipAddress: string;
}

export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditLog.create({ data: entry });
}