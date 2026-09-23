import { ListingStatus, ReportTargetType, ReviewCaseStatus, UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createReport, listReviewQueue, resolveReviewCase } from "@/modules/reports";
import { listListings } from "@/modules/listings";
import {
  activeListingFixture,
  makeReviewer,
  makeUser,
  makeVerifiedAgent,
  makeVerifiedAgencyAdmin,
  resetDb,
} from "../helpers";

describe("reports (PR-REP-001, PR-REP-002, PR-REP-003)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const reason =
    "The listing showed a fully furnished flat but the property is empty and the agent refused a refund.";

  it("only seekers can report (PR-REP-001)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listingId = await activeListingFixture(agent);
    const agentActor = agent;
    await expect(
      createReport(agentActor, {
        targetType: ReportTargetType.LISTING,
        listingId,
        reason,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("a listing with one open report keeps hasOpenReports and stays visible (PR-LST-003)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listingId = await activeListingFixture(agent);
    const seeker = await makeUser(UserRole.SEEKER, "seeker@example.com");

    await createReport(seeker, { targetType: ReportTargetType.LISTING, listingId, reason });

    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    expect(listing?.hasOpenReports).toBe(true);

    // PR-LST-003: the listing remains in search — never filtered on report count.
    const results = (await listListings(
      seeker,
      {
        limit: 20,
        offset: 0,
        sort: "createdAt",
        order: "desc",
        latitude: 6.5,
        longitude: 3.4,
        radiusKm: 20,
      },
    )).items;
    expect(results.find((l) => l.id === listingId)).toBeDefined();
  });

  it("the report lands in the review queue for reviewers", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listingId = await activeListingFixture(agent);
    const seekers = await Promise.all([
      makeUser(UserRole.SEEKER, "s1@example.com"),
      makeUser(UserRole.SEEKER, "s2@example.com"),
      makeUser(UserRole.SEEKER, "s3@example.com"),
    ]);
    for (const seeker of seekers) {
      await createReport(seeker, { targetType: ReportTargetType.LISTING, listingId, reason });
    }
    const adminActor = await makeVerifiedAgencyAdmin("admin@example.com");

    // non-reviewers get 403 on the queue (PR-ADM-001)
    await expect(
      listReviewQueue(adminActor, { limit: 20, offset: 0, sort: "createdAt", order: "asc" }),
    ).rejects.toMatchObject({ status: 403 });

    const reviewer = await makeReviewer("reviewer@example.com");
    const queue = await listReviewQueue(reviewer, {
      limit: 20,
      offset: 0,
      sort: "createdAt",
      order: "asc",
    });
    expect(queue.items.some((c) => c.listingId === listingId)).toBe(true);
  });

  it("three open reports in the window create a ReviewCase, never a suspension (PR-REP-002)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listingId = await activeListingFixture(agent);
    const seekers = await Promise.all([
      makeUser(UserRole.SEEKER, "s1@example.com"),
      makeUser(UserRole.SEEKER, "s2@example.com"),
      makeUser(UserRole.SEEKER, "s3@example.com"),
    ]);

    for (const seeker of seekers) {
      await createReport(seeker, { targetType: ReportTargetType.LISTING, listingId, reason });
    }

    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    expect(listing?.status).toBe(ListingStatus.ACTIVE); // no auto-suspension

    const cases = await prisma.reviewCase.findMany({ where: { report: { listingId } } });
    expect(cases.length).toBe(1);
    expect(cases[0].status).toBe(ReviewCaseStatus.OPEN);

    // an 4th report does not spawn a second case for the same open target
    const fourth = await makeUser(UserRole.SEEKER, "s4@example.com");
    await createReport(fourth, { targetType: ReportTargetType.LISTING, listingId, reason });
    const casesAfter = await prisma.reviewCase.findMany({ where: { report: { listingId } } });
    expect(casesAfter.length).toBe(1);
  });

  it("resolving a case with SUSPEND_LISTING writes resolution and suspends atomically (PR-REP-003, Q3#11)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listingId = await activeListingFixture(agent);
    const seekers = await Promise.all([
      makeUser(UserRole.SEEKER, "s1@example.com"),
      makeUser(UserRole.SEEKER, "s2@example.com"),
      makeUser(UserRole.SEEKER, "s3@example.com"),
    ]);
    for (const seeker of seekers) {
      await createReport(seeker, { targetType: ReportTargetType.LISTING, listingId, reason });
    }
    const reviewer = await makeReviewer("reviewer@example.com");

    // only a reviewer can resolve
    await expect(
      resolveReviewCase(
        (await prisma.reviewCase.findFirstOrThrow({ where: { report: { listingId } } })).id,
        seekers[0],
        { resolution: "no action", action: "NONE" },
      ),
    ).rejects.toMatchObject({ status: 403 });

    const caseRow = await prisma.reviewCase.findFirstOrThrow({ where: { report: { listingId } } });
    const resolved = await resolveReviewCase(
      caseRow.id,
      reviewer,
      { resolution: "Listing verified as misrepresented; suspending.", action: "SUSPEND_LISTING" },
      { ipAddress: "127.0.0.1" },
    );
    expect(resolved.status).toBe(ReviewCaseStatus.RESOLVED);
    expect(resolved.resolvedById).toBe(reviewer.userId);

    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    expect(listing?.status).toBe(ListingStatus.SUSPENDED);
    const audit = await prisma.auditLog.findMany({ where: { targetId: listingId } });
    expect(audit.some((row) => row.action === "listing.suspended")).toBe(true);
  });

  it("resolution without a note is rejected (422)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listingId = await activeListingFixture(agent);
    const seekers = await Promise.all([
      makeUser(UserRole.SEEKER, "s1@example.com"),
      makeUser(UserRole.SEEKER, "s2@example.com"),
      makeUser(UserRole.SEEKER, "s3@example.com"),
    ]);
    for (const seeker of seekers) {
      await createReport(seeker, { targetType: ReportTargetType.LISTING, listingId, reason });
    }
    const reviewer = await makeReviewer("reviewer@example.com");
    const caseRow = await prisma.reviewCase.findFirstOrThrow({ where: { report: { listingId } } });
    await expect(
      resolveReviewCase(caseRow.id, reviewer, { resolution: "  " }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("a resolved case cannot be re-resolved (DB-6)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listingId = await activeListingFixture(agent);
    const seekers = await Promise.all([
      makeUser(UserRole.SEEKER, "s1@example.com"),
      makeUser(UserRole.SEEKER, "s2@example.com"),
      makeUser(UserRole.SEEKER, "s3@example.com"),
    ]);
    for (const seeker of seekers) {
      await createReport(seeker, { targetType: ReportTargetType.LISTING, listingId, reason });
    }
    const reviewer = await makeReviewer("reviewer@example.com");
    const caseRow = await prisma.reviewCase.findFirstOrThrow({ where: { report: { listingId } } });
    await resolveReviewCase(caseRow.id, reviewer, { resolution: "No further action" });

    await expect(
      resolveReviewCase(caseRow.id, reviewer, { resolution: "Changed my mind" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});