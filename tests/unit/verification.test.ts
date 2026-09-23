import { UserRole, VerificationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  approveVerification,
  rejectVerification,
  submitVerificationRequest,
  verificationDocumentUrl,
} from "@/modules/verification";
import { makeReviewer, makeUser, fakeStorage, resetDb } from "../helpers";

describe("verification", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("requires a valid role to submit (PR-VER-001 gate)", async () => {
    const seeker = await makeUser(UserRole.SEEKER, "seeker@example.com");
    await expect(
      submitVerificationRequest(
        seeker,
        { documentKey: "docs/verification/req.pdf" },
        { storage: fakeStorage },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("creates a PENDING request and audit row and never returns the documentKey", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const request = await submitVerificationRequest(
      agent,
      { documentKey: "docs/verification/req.pdf" },
      { storage: fakeStorage },
    );
    expect(request.status).toBe(VerificationStatus.PENDING);
    expect(request).not.toHaveProperty("documentKey");

    const audit = await prisma.auditLog.findMany({ where: { userId: agent.userId } });
    expect(audit.length).toBe(1);
    expect(audit[0].action).toContain("verification.submitted");
  });

  it("only a reviewer can approve (403 otherwise)", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const request = await submitVerificationRequest(
      agent,
      { documentKey: "docs/verification/req.pdf" },
      { storage: fakeStorage },
    );
    await expect(approveVerification(request.id, agent)).rejects.toMatchObject({ status: 403 });

    const seeker = await makeUser(UserRole.SEEKER, "seeker2@example.com");
    await expect(approveVerification(request.id, seeker)).rejects.toMatchObject({ status: 403 });
  });

  it("approval sets APPROVED, mirrors onto the profile, writes audit + notification", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const request = await submitVerificationRequest(
      agent,
      { documentKey: "docs/verification/req.pdf" },
      { storage: fakeStorage },
    );
    const reviewer = await makeReviewer("reviewer@example.com");

    const decided = await approveVerification(request.id, reviewer);
    expect(decided.status).toBe(VerificationStatus.APPROVED);
    expect(decided.reviewedById).toBe(reviewer.userId);

    const profile = await prisma.agentProfile.findUnique({ where: { userId: agent.userId } });
    expect(profile?.verificationStatus).toBe(VerificationStatus.APPROVED);

    const audit = await prisma.auditLog.findMany({ where: { userId: reviewer.userId } });
    expect(audit.some((row) => row.action === "verification.approved")).toBe(true);
    const notifications = await prisma.notification.findMany({ where: { userId: agent.userId } });
    expect(notifications.length).toBe(1);
    expect(notifications[0].template).toBe("verification_approved@v1");
  });

  it("rejects require a reviewNote (PR-VER-004)", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const request = await submitVerificationRequest(
      agent,
      { documentKey: "docs/verification/req.pdf" },
      { storage: fakeStorage },
    );
    const reviewer = await makeReviewer("reviewer@example.com");
    await expect(
      rejectVerification(request.id, reviewer, { reviewNote: "  " }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("a decided request cannot be re-decided (DB-6)", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const request = await submitVerificationRequest(
      agent,
      { documentKey: "docs/verification/req.pdf" },
      { storage: fakeStorage },
    );
    const reviewer = await makeReviewer("reviewer@example.com");
    await rejectVerification(request.id, reviewer, { reviewNote: "Documents unclear" });

    await expect(rejectVerification(request.id, reviewer, { reviewNote: "Again" })).rejects.toMatchObject({ status: 409 });
    await expect(approveVerification(request.id, reviewer)).rejects.toMatchObject({ status: 409 });
    expect((await prisma.verificationRequest.findUnique({ where: { id: request.id } }))?.reviewNote).toBe("Documents unclear");
  });

  it("document URLs require ownership or a reviewer role (UP-4)", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const request = await submitVerificationRequest(
      agent,
      { documentKey: "docs/verification/req.pdf" },
      { storage: fakeStorage },
    );
    const outsider = await makeUser(UserRole.SEEKER, "outsider@example.com");
    await expect(
      verificationDocumentUrl(request.id, outsider, { storage: fakeStorage }),
    ).rejects.toMatchObject({ status: 403 });

    const reviewer = await makeReviewer("reviewer@example.com");
    const url = await verificationDocumentUrl(request.id, reviewer, { storage: fakeStorage });
    expect(url).toContain("signed://");
  });
});