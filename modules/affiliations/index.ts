import { AffiliationStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { writeAuditLog, AUDIT_ACTIONS } from "@/modules/audit";
import { notify } from "@/modules/notifications";
import type { Actor, AuditMeta } from "@/modules/verification";

// PR-VER-003: roster membership requires an AgencyAffiliation row accepted by
// the agency side. This module is the ONLY writer of AgentProfile.agencyId
// (DB-8). An agent can never set their own agencyId.
export interface SafeAffiliation {
  id: string;
  agentId: string;
  agencyId: string;
  status: AffiliationStatus;
  createdAt: Date;
  resolvedAt: Date | null;
}

function toSafe(row: {
  id: string;
  agentId: string;
  agencyId: string;
  status: AffiliationStatus;
  createdAt: Date;
  resolvedAt: Date | null;
}): SafeAffiliation {
  return row;
}

async function requireAgencyName(
  tx: Prisma.TransactionClient,
  agencyId: string,
): Promise<string> {
  const agency = await tx.agencyProfile.findUnique({ where: { id: agencyId } });
  if (!agency) throw ApiError.notFound("Agency not found");
  return agency.name;
}

export async function requestAffiliation(
  agent: Actor,
  input: { agentId: string; agencyId: string },
  meta: AuditMeta = {},
): Promise<SafeAffiliation> {
  if (agent.role !== UserRole.AGENT) {
    throw ApiError.forbidden("Only agents can request an affiliation");
  }
  const affiliation = await prisma.$transaction(async (tx) => {
    const profile = await tx.agentProfile.findFirst({
      where: { userId: agent.userId },
    });
    if (!profile) throw ApiError.forbidden("Agent profile not found");
    if (profile.id !== input.agentId) {
      throw ApiError.forbidden("You can only request an affiliation for your own agent profile (SEC-4)");
    }
    const existing = await tx.agencyAffiliation.findFirst({
      where: {
        agentId: profile.id,
        agencyId: input.agencyId,
        status: { in: [AffiliationStatus.PENDING, AffiliationStatus.ACCEPTED] },
      },
    });
    if (existing) {
      throw ApiError.conflict(
        "An affiliation between this agent and this agency is already pending or accepted",
      );
    }
    await requireAgencyName(tx, input.agencyId);
    const created = await tx.agencyAffiliation.create({
      data: { agentId: profile.id, agencyId: input.agencyId },
    });
    await writeAuditLog(tx, {
      userId: agent.userId,
      action: AUDIT_ACTIONS.AFFILIATION_REQUESTED,
      targetId: created.id,
      ipAddress: meta.ipAddress ?? "internal",
    });
    return created;
  });
  return toSafe(affiliation);
}

async function assertAgencyOwnership(
  actor: Actor,
  tx: Prisma.TransactionClient,
  agencyId: string,
): Promise<void> {
  if (actor.role !== UserRole.AGENCY_ADMIN) {
    throw ApiError.forbidden("Only an agency admin can accept or reject affiliations");
  }
  const agency = await tx.agencyProfile.findUnique({ where: { id: agencyId } });
  if (!agency) throw ApiError.notFound("Agency not found");
  if (agency.userId !== actor.userId) {
    throw ApiError.forbidden("You do not administer this agency (SEC-4)");
  }
}

export async function acceptAffiliation(
  affiliationId: string,
  admin: Actor,
  meta: AuditMeta = {},
): Promise<SafeAffiliation> {
  const now = new Date();
  const accepted = await prisma.$transaction(async (tx) => {
    const existing = await tx.agencyAffiliation.findUnique({
      where: { id: affiliationId },
      include: { agency: true, agent: { include: { user: true } } },
    });
    if (!existing) throw ApiError.notFound("Affiliation not found");
    await assertAgencyOwnership(admin, tx, existing.agencyId);

    // CS-4: guarded — only a PENDING affiliation can flip to ACCEPTED (DB-6).
    const updated = await tx.agencyAffiliation.updateMany({
      where: { id: affiliationId, status: AffiliationStatus.PENDING },
      data: { status: AffiliationStatus.ACCEPTED, resolvedAt: now },
    });
    if (updated.count !== 1) {
      throw ApiError.conflict("Affiliation is already decided and cannot be edited");
    }

    // DB-8: single writer for AgentProfile.agencyId — this accept is it.
    await tx.agentProfile.updateMany({
      where: { id: existing.agentId },
      data: { agencyId: existing.agencyId },
    });

    await writeAuditLog(tx, {
      userId: admin.userId,
      action: AUDIT_ACTIONS.AFFILIATION_ACCEPTED,
      targetId: affiliationId,
      ipAddress: meta.ipAddress ?? "internal",
    });
    await notify(tx, {
      userId: existing.agent.userId,
      templateId: "AFFILIATION_ACCEPTED",
      vars: { agencyName: existing.agency.name },
    });
    return { ...existing, status: AffiliationStatus.ACCEPTED, resolvedAt: now };
  });
  return toSafe(accepted);
}

export async function rejectAffiliation(
  affiliationId: string,
  admin: Actor,
  meta: AuditMeta = {},
): Promise<SafeAffiliation> {
  const now = new Date();
  const rejected = await prisma.$transaction(async (tx) => {
    const existing = await tx.agencyAffiliation.findUnique({
      where: { id: affiliationId },
      include: { agency: true, agent: { include: { user: true } } },
    });
    if (!existing) throw ApiError.notFound("Affiliation not found");
    await assertAgencyOwnership(admin, tx, existing.agencyId);

    const updated = await tx.agencyAffiliation.updateMany({
      where: { id: affiliationId, status: AffiliationStatus.PENDING },
      data: { status: AffiliationStatus.REJECTED, resolvedAt: now },
    });
    if (updated.count !== 1) {
      throw ApiError.conflict("Affiliation is already decided and cannot be edited");
    }

    await writeAuditLog(tx, {
      userId: admin.userId,
      action: AUDIT_ACTIONS.AFFILIATION_REJECTED,
      targetId: affiliationId,
      ipAddress: meta.ipAddress ?? "internal",
    });
    await notify(tx, {
      userId: existing.agent.userId,
      templateId: "AFFILIATION_REJECTED",
      vars: { agencyName: existing.agency.name },
    });
    return { ...existing, status: AffiliationStatus.REJECTED, resolvedAt: now };
  });
  return toSafe(rejected);
}