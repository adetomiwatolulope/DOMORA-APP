import { AffiliationStatus, UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  acceptAffiliation,
  rejectAffiliation,
  requestAffiliation,
} from "@/modules/affiliations";
import {
  makeAgencyForAdmin,
  makeUser,
  makeVerifiedAgencyAdmin,
  resetDb,
} from "../helpers";

describe("affiliations (PR-VER-003)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function agentProfileId(agent: { userId: string }): Promise<string> {
    const profile = await prisma.agentProfile.findUnique({ where: { userId: agent.userId } });
    if (!profile) throw new Error("agent profile missing");
    return profile.id;
  }

  it("an agent can request affiliation with an agency (PENDING)", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const admin = await makeVerifiedAgencyAdmin("admin@example.com");
    const agencyId = await makeAgencyForAdmin(admin, "Prime Estates");

    const affiliation = await requestAffiliation(agent, {
      agentId: await agentProfileId(agent),
      agencyId,
    });
    expect(affiliation.status).toBe(AffiliationStatus.PENDING);
    const audit = await prisma.auditLog.findMany({ where: { userId: agent.userId } });
    expect(audit[0].action).toBe("affiliation.requested");
  });

  it("an agent cannot request on behalf of another profile (SEC-4)", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const other = await makeUser(UserRole.AGENT, "other@example.com");
    const admin = await makeVerifiedAgencyAdmin("admin@example.com");
    const agencyId = await makeAgencyForAdmin(admin, "Prime Estates");

    await expect(
      requestAffiliation(agent, { agentId: await agentProfileId(other), agencyId }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("only the owning agency admin can accept (SEC-4)", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const admin = await makeVerifiedAgencyAdmin("admin@example.com");
    const agencyId = await makeAgencyForAdmin(admin, "Prime Estates");
    const affiliation = await requestAffiliation(agent, {
      agentId: await agentProfileId(agent),
      agencyId,
    });

    const strangerAdmin = await makeVerifiedAgencyAdmin("stranger@example.com");
    await expect(acceptAffiliation(affiliation.id, strangerAdmin)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("acceptance is the single writer of AgentProfile.agencyId (DB-8)", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const admin = await makeVerifiedAgencyAdmin("admin@example.com");
    const agencyId = await makeAgencyForAdmin(admin, "Prime Estates");
    const affiliation = await requestAffiliation(agent, {
      agentId: await agentProfileId(agent),
      agencyId,
    });

    const accepted = await acceptAffiliation(affiliation.id, admin);
    expect(accepted.status).toBe(AffiliationStatus.ACCEPTED);

    const profile = await prisma.agentProfile.findUnique({
      where: { userId: agent.userId },
    });
    expect(profile?.agencyId).toBe(agencyId);

    const notifications = await prisma.notification.findMany({ where: { userId: agent.userId } });
    expect(notifications[0].template).toBe("affiliation_accepted@v1");
  });

  it("a decided affiliation cannot be re-decided (DB-6)", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const admin = await makeVerifiedAgencyAdmin("admin@example.com");
    const agencyId = await makeAgencyForAdmin(admin, "Prime Estates");
    const affiliation = await requestAffiliation(agent, {
      agentId: await agentProfileId(agent),
      agencyId,
    });
    await acceptAffiliation(affiliation.id, admin);

    await expect(acceptAffiliation(affiliation.id, admin)).rejects.toMatchObject({ status: 409 });
    await expect(rejectAffiliation(affiliation.id, admin)).rejects.toMatchObject({ status: 409 });
  });

  it("a rejection leaves the agent unaffiliated with the agency", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const admin = await makeVerifiedAgencyAdmin("admin@example.com");
    const agencyId = await makeAgencyForAdmin(admin, "Prime Estates");
    const affiliation = await requestAffiliation(agent, {
      agentId: await agentProfileId(agent),
      agencyId,
    });

    const rejected = await rejectAffiliation(affiliation.id, admin);
    expect(rejected.status).toBe(AffiliationStatus.REJECTED);
    const profile = await prisma.agentProfile.findUnique({ where: { userId: agent.userId } });
    expect(profile?.agencyId).toBeNull();
  });
});