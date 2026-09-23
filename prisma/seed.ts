import { faker } from "@faker-js/faker";
import { hash } from "@node-rs/argon2";
import {
  ListingStatus,
  PropertyType,
  ReportTargetType,
  UserRole,
  VerificationStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { createReport } from "@/modules/reports";

// Step 2 seed: realistic, repeatable, volume-matched to the Task 1 resource
// design. Deterministic (faker.seed) and idempotent: every run wipes and
// rebuilds the same shape, so re-running never creates duplicates.
//
// Volumes (a few hundred per first-class resource from README Step 1):
//   User              454  (150 seekers + 100 agents + 100 agency admins
//                           + 100 landlords + 3 reviewers + 1 super admin)
//   VerificationRequest 300 (one per verifiable account)
//   Listing               2
//   ListingImage          4 (sub-resource, 2 per listing)
//   Report               10 (6 listing-targeted + 4 profile-targeted)
//   ReviewCase            2 (auto-opened by the report module per threshold)
//
// Rule compliance:
//   DB-13: no APPROVED VerificationRequest and no ACTIVE Listing is created.
//   DB-8:  hasOpenReports and ReviewCase creation go through the real
//          /modules/reports createReport transition — the single writer.
//   DB-10: LISTING reports set listingId, PROFILE reports set targetUserId.
//   DB-11: every listing has exactly one of agentId/agencyId/landlordId.
//   DB-13: all names/emails/content are synthetic (faker, `.invalid` TLD).

const SEEKERS = 150;
const AGENTS = 100;
const AGENCY_ADMINS = 100;
const LANDLORDS = 100;
const REVIEWERS = 3;
const SUPER_ADMINS = 1;
const LISTINGS = 2;
const IMAGES_PER_LISTING = 2;
const REPORTS_PER_LISTING = 3;
const PROFILE_REPORTS = 4;

const SEED_PASSWORD = "domora-seed-pass";

async function wipe(): Promise<void> {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.reviewCase.deleteMany(),
    prisma.report.deleteMany(),
    prisma.inspectionBooking.deleteMany(),
    prisma.inspectionSlot.deleteMany(),
    prisma.listingImage.deleteMany(),
    prisma.listing.deleteMany(),
    prisma.verificationRequest.deleteMany(),
    prisma.agencyAffiliation.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.agentProfile.deleteMany(),
    prisma.agencyProfile.deleteMany(),
    prisma.landlordProfile.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

function emailFor(role: string, index: number): string {
  return `${role}-${index}@seed.domora.invalid`;
}

async function seedUsers(): Promise<{ providerUserIds: string[]; seekerIds: string[] }> {
  const passwordHash = await hash(SEED_PASSWORD);
  const providerUserIds: string[] = [];
  const seekerIds: string[] = [];

  const createdSeekers = await Promise.all(
    Array.from({ length: SEEKERS }, (_, i) =>
      prisma.user.create({
        data: {
          email: emailFor("seeker", i),
          passwordHash,
          role: UserRole.SEEKER,
          country: faker.location.countryCode(),
        },
      }),
    ),
  );
  seekerIds.push(...createdSeekers.map((u) => u.id));

  const [agents, admins, landlords] = await Promise.all([
    Promise.all(
      Array.from({ length: AGENTS }, (_, i) =>
        prisma.user.create({
          data: {
            email: emailFor("agent", i),
            passwordHash,
            role: UserRole.AGENT,
            country: faker.location.countryCode(),
          },
        }),
      ),
    ),
    Promise.all(
      Array.from({ length: AGENCY_ADMINS }, (_, i) =>
        prisma.user.create({
          data: {
            email: emailFor("agency-admin", i),
            passwordHash,
            role: UserRole.AGENCY_ADMIN,
            country: faker.location.countryCode(),
          },
        }),
      ),
    ),
    Promise.all(
      Array.from({ length: LANDLORDS }, (_, i) =>
        prisma.user.create({
          data: {
            email: emailFor("landlord", i),
            passwordHash,
            role: UserRole.LANDLORD,
            country: faker.location.countryCode(),
          },
        }),
      ),
    ),
  ]);

  const reviewerUsers = await Promise.all(
    Array.from({ length: REVIEWERS }, (_, i) =>
      prisma.user.create({
        data: {
          email: emailFor("reviewer", i),
          passwordHash,
          role: UserRole.PLATFORM_REVIEWER,
          country: null,
        },
      }),
    ),
  );
  await prisma.user.create({
    data: {
      email: emailFor("super-admin", 0),
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      country: null,
    },
  });

  for (const agent of agents) {
    await prisma.agentProfile.create({
      data: { userId: agent.id, verificationStatus: VerificationStatus.PENDING },
    });
    providerUserIds.push(agent.id);
  }
  for (const admin of admins) {
    await prisma.agencyProfile.create({
      data: {
        userId: admin.id,
        name: faker.company.name(),
        verificationStatus: VerificationStatus.PENDING,
      },
    });
    providerUserIds.push(admin.id);
  }
  for (const landlord of landlords) {
    await prisma.landlordProfile.create({
      data: { userId: landlord.id, verificationStatus: VerificationStatus.PENDING },
    });
    providerUserIds.push(landlord.id);
  }

  void reviewerUsers;
  return { providerUserIds, seekerIds };
}

async function seedVerificationRequests(): Promise<void> {
  // Direct creation (not the submit module): the module asserts the document
  // already exists in R2 (UP-9), which a synthetic seed must not depend on.
  // Status stays PENDING — DB-13 forbids APPROVED outside /tests.
  const verifiableUsers = await prisma.user.findMany({
    where: { role: { in: [UserRole.AGENT, UserRole.AGENCY_ADMIN, UserRole.LANDLORD] } },
  });
  await Promise.all(
    verifiableUsers.map((user, i) =>
      prisma.verificationRequest.create({
        data: {
          userId: user.id,
          documentKey: `docs/seed/verification-request-${i}.pdf`,
          status: VerificationStatus.PENDING,
        },
      }),
    ),
  );
}

async function seedListings(providerUserIds: string[]): Promise<string[]> {
  const agentProfiles = await prisma.agentProfile.findMany({ select: { id: true } });
  const agencyProfiles = await prisma.agencyProfile.findMany({ select: { id: true } });
  const landlordProfiles = await prisma.landlordProfile.findMany({ select: { id: true } });
  if (agentProfiles.length === 0 || providerUserIds.length === 0) {
    throw new Error("seed: expected provider profiles to exist");
  }

  const propertyTypes = Object.values(PropertyType) as PropertyType[];
  const listingIds: string[] = [];

  for (let i = 0; i < LISTINGS; i += 1) {
    // DB-11: exactly one owner column, cycled across owner kinds.
    const ownerKind = i % 3;
    const ownerColumn =
      ownerKind === 0
        ? { agentId: agentProfiles[i % agentProfiles.length].id }
        : ownerKind === 1
          ? { agencyId: agencyProfiles[i % agencyProfiles.length].id }
          : { landlordId: landlordProfiles[i % landlordProfiles.length].id };

    const title = faker.lorem.words({ min: 3, max: 8 });
    const created = await prisma.listing.create({
      data: {
        title: title.charAt(0).toUpperCase() + title.slice(1),
        price: faker.number.int({ min: 8_000_000, max: 800_000_000 }), // smallest unit
        address: `${faker.location.streetAddress()}, ${faker.location.city()}`,
        latitude: faker.location.latitude({ min: 4, max: 14 }),
        longitude: faker.location.longitude({ min: 2, max: 15 }),
        country: "NG",
        propertyType: propertyTypes[i % propertyTypes.length],
        // DB-13 / PR-LST-002: listings are seeded PENDING_REVIEW, never ACTIVE.
        status: ListingStatus.PENDING_REVIEW,
        ...ownerColumn,
        images: {
          create: Array.from({ length: IMAGES_PER_LISTING }, (_, j) => ({
            storageKey: `images/seed/listing-${i}-${j}.jpg`,
          })),
        },
      },
    });
    listingIds.push(created.id);
  }
  return listingIds;
}

async function seedReports(
  seekerIds: string[],
  listingIds: string[],
  providerUserIds: string[],
): Promise<void> {
  if (seekerIds.length < REPORTS_PER_LISTING) {
    throw new Error("seed: not enough seekers to file reports");
  }

  // Listing-targeted reports: 3 per listing. The third report on each target
  // crosses the PR-REP-002 threshold inside the module, which opens exactly
  // one ReviewCase per listing and maintains hasOpenReports (DB-8/DB-9).
  for (let i = 0; i < listingIds.length; i += 1) {
    const listingId = listingIds[i];
    for (let r = 0; r < REPORTS_PER_LISTING; r += 1) {
      const seeker = seekerIds[(i + r) % seekerIds.length];
      await createReport(
        { userId: seeker, role: UserRole.SEEKER },
        {
          targetType: ReportTargetType.LISTING,
          listingId,
          reason: faker.lorem.sentence({ min: 8, max: 16 }),
        },
      );
    }
  }

  // Profile-targeted reports: 1 per target, so no ReviewCase is expected.
  for (let p = 0; p < Math.min(PROFILE_REPORTS, providerUserIds.length); p += 1) {
    const seeker = seekerIds[(p + 17) % seekerIds.length];
    await createReport(
      { userId: seeker, role: UserRole.SEEKER },
      {
        targetType: ReportTargetType.PROFILE,
        targetUserId: providerUserIds[p],
        reason: faker.lorem.sentence({ min: 8, max: 16 }),
      },
    );
  }
}

async function validate(): Promise<void> {
  const [users, verifications, listings, listingImages, reports, reviewCases, affiliations] =
    await Promise.all([
      prisma.user.count(),
      prisma.verificationRequest.count(),
      prisma.listing.count(),
      prisma.listingImage.count(),
      prisma.report.count(),
      prisma.reviewCase.count(),
      prisma.agencyAffiliation.count(),
    ]);

  const approvedVerifications = await prisma.verificationRequest.count({
    where: { status: VerificationStatus.APPROVED },
  });
  const activeListings = await prisma.listing.count({
    where: { status: ListingStatus.ACTIVE },
  });

  const ownerRows = await prisma.listing.findMany({
    select: { agentId: true, agencyId: true, landlordId: true },
  });
  const invalidOwners = ownerRows.filter((row) => {
    const owners = [row.agentId, row.agencyId, row.landlordId].filter((v) => v !== null);
    return owners.length !== 1;
  });

  const reportRows = await prisma.report.findMany({
    select: { targetType: true, listingId: true, targetUserId: true },
  });
  const invalidTargets = reportRows.filter((row) => {
    if (row.targetType === ReportTargetType.LISTING) {
      return row.listingId === null || row.targetUserId !== null;
    }
    return row.targetUserId === null || row.listingId !== null;
  });

  const cases = await prisma.reviewCase.findMany({
    select: { report: { select: { listingId: true, targetUserId: true } } },
  });
  const listingIds = await prisma.listing.findMany({ select: { id: true } });
  const listingSet = new Set(listingIds.map((l) => l.id));
  const invalidCases = cases.filter((c) =>
    c.report.listingId !== null ? !listingSet.has(c.report.listingId) : false,
  );

  const problems: string[] = [];
  const expectedUsers = SEEKERS + AGENTS + AGENCY_ADMINS + LANDLORDS + REVIEWERS + SUPER_ADMINS;
  const expectedVerifications = AGENTS + AGENCY_ADMINS + LANDLORDS;
  const expectedReports = LISTINGS * REPORTS_PER_LISTING + Math.min(PROFILE_REPORTS, expectedVerifications);
  if (users !== expectedUsers) problems.push(`users=${users} (expected ${expectedUsers})`);
  if (verifications !== expectedVerifications) {
    problems.push(`verificationRequests=${verifications} (expected ${expectedVerifications})`);
  }
  if (approvedVerifications !== 0) problems.push("seeded an APPROVED VerificationRequest (DB-13)");
  if (listings !== LISTINGS) problems.push(`listings=${listings} (expected ${LISTINGS})`);
  if (activeListings !== 0) problems.push("seeded an ACTIVE Listing (DB-13)");
  if (listingImages !== LISTINGS * IMAGES_PER_LISTING) {
    problems.push(`listingImages=${listingImages} (expected ${LISTINGS * IMAGES_PER_LISTING})`);
  }
  if (reports !== expectedReports) {
    problems.push(`reports=${reports} (expected ${expectedReports})`);
  }
  if (reviewCases !== LISTINGS) {
    problems.push(`reviewCases=${reviewCases} (expected ${LISTINGS})`);
  }
  if (affiliations !== 0) problems.push("seeded affiliations are out of scope for Step 2");
  if (invalidOwners.length > 0) problems.push(`${invalidOwners.length} listings with != 1 owner (DB-11)`);
  if (invalidTargets.length > 0) problems.push(`${invalidTargets.length} reports with mismatched targets (DB-10)`);
  if (invalidCases.length > 0) problems.push(`${invalidCases.length} cases whose report targets a missing listing`);

  console.log(`users=${users} verificationRequests=${verifications} listings=${listings}`);
  console.log(`listingImages=${listingImages} reports=${reports} reviewCases=${reviewCases}`);
  console.log(`approvedVerifications=${approvedVerifications} activeListings=${activeListings} affiliations=${affiliations}`);

  if (problems.length > 0) {
    throw new Error(`Seed validation FAILED:\n- ${problems.join("\n- ")}`);
  }
  console.log("Seed validation PASSED: relationships valid, no duplicates, DB-13 gates respected.");
}

async function main(): Promise<void> {
  faker.seed(20260922);

  console.log("Seeding Domora (Step 2)...");
  await wipe();

  const { providerUserIds, seekerIds } = await seedUsers();
  await seedVerificationRequests();
  const listingIds = await seedListings(providerUserIds);
  await seedReports(seekerIds, listingIds, providerUserIds);

  await validate();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());