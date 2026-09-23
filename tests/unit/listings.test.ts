import { ListingStatus, PropertyType, UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { approveListing, createListing, searchActiveListings } from "@/modules/listings";
import {
  fakeStorage,
  makeReviewer,
  makeUser,
  makeVerifiedAgent,
  resetDb,
} from "../helpers";

describe("listings", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const input = {
    title: "Spacious 3-bedroom apartment",
    price: 15_000_000,
    address: "15 Bourdillon Road, Ikoyi, Lagos",
    country: "NG",
    propertyType: PropertyType.APARTMENT,
    images: ["images/listings/flat-1.jpg"],
    latitude: 6.4522,
    longitude: 3.4355,
  };

  it("cannot be created by an unverified agent (PR-VER-001)", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    await expect(
      createListing(agent, input, { storage: fakeStorage }),
    ).rejects.toMatchObject({ status: 403, message: expect.stringContaining("verification") });
  });

  it("cannot be created by a seeker (PR-ADM-001 role matrix)", async () => {
    const seeker = await makeUser(UserRole.SEEKER, "seeker@example.com");
    await expect(createListing(seeker, input, { storage: fakeStorage })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("is created as PENDING_REVIEW, never ACTIVE (PR-LST-002)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listing = await createListing(agent, input, { storage: fakeStorage });
    expect(listing.status).toBe(ListingStatus.PENDING_REVIEW);
    expect(listing.price).toBe(15_000_000);
    const audit = await prisma.auditLog.findMany({ where: { userId: agent.userId } });
    expect(audit.some((row) => row.action === "listing.created")).toBe(true);
  });

  it("only a reviewer can approve a listing (PR-LST-002)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listing = await createListing(agent, input, { storage: fakeStorage });
    const seeker = await makeUser(UserRole.SEEKER, "seeker@example.com");
    await expect(approveListing(listing.id, seeker)).rejects.toMatchObject({ status: 403 });
  });

  it("reviewer approval moves it to ACTIVE with an audit row", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listing = await createListing(agent, input, { storage: fakeStorage });
    const reviewer = await makeReviewer("reviewer@example.com");

    const active = await approveListing(listing.id, reviewer);
    expect(active.status).toBe(ListingStatus.ACTIVE);
    const audit = await prisma.auditLog.findMany({ where: { targetId: listing.id } });
    expect(audit.some((row) => row.action === "listing.approved")).toBe(true);
  });

  it("a listing already approved cannot be approved again (DB-6)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listing = await createListing(agent, input, { storage: fakeStorage });
    const reviewer = await makeReviewer("reviewer@example.com");
    await approveListing(listing.id, reviewer);
    await expect(approveListing(listing.id, reviewer)).rejects.toMatchObject({ status: 409 });
  });

  it("search returns only ACTIVE listings", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const pending = await createListing(agent, input, { storage: fakeStorage });
    const reviewer = await makeReviewer("reviewer@example.com");
    await approveListing(pending.id, reviewer);

    const results = await searchActiveListings({ latitude: 6.45, longitude: 3.44, radiusKm: 10 });
    expect(results.map((l) => l.id)).toContain(pending.id);
    expect(results.every((l) => l.status === ListingStatus.ACTIVE)).toBe(true);
  });

  it("search ignores listings outside the radius", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const listing = await createListing(
      agent,
      { ...input, title: "Far away home", images: ["images/listings/far-1.jpg"], latitude: 9.0579, longitude: 7.4951 },
      { storage: fakeStorage },
    );
    const reviewer = await makeReviewer("reviewer@example.com");
    await approveListing(listing.id, reviewer);

    const nearLagos = await searchActiveListings({ latitude: 6.45, longitude: 3.44, radiusKm: 10 });
    expect(nearLagos.find((l) => l.id === listing.id)).toBeUndefined();
  });
});