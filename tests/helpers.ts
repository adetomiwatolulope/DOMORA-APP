import { ListingStatus, PropertyType, UserRole, VerificationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createUser, type SignupRole } from "@/modules/identity/users";
import type { Geocoder } from "@/lib/geocoding";
import type { StorageService } from "@/lib/storage";
import type { Actor } from "@/modules/verification";

// Deletes every row in dependency-safe order so each test starts clean.
export async function resetDb(): Promise<void> {
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

export async function makeUser(role: SignupRole, email: string): Promise<Actor> {
  const user = await createUser({
    email,
    password: "password123",
    role,
    agencyName: role === UserRole.AGENCY_ADMIN ? "Test Agency" : undefined,
  });
  return { userId: user.id, role: user.role };
}

// PLATFORM_REVIEWER / SUPER_ADMIN cannot be created through the public path
// (SEC-3); tests create them as raw fixture rows, which DB-13 permits.
export async function makeReviewer(email: string): Promise<Actor> {
  const user = await prisma.user.create({
    data: { role: UserRole.PLATFORM_REVIEWER, email, passwordHash: "unused-hash" },
  });
  return { userId: user.id, role: user.role };
}

export async function approveAsAgentFixture(userId: string): Promise<void> {
  await prisma.agentProfile.updateMany({
    where: { userId },
    data: { verificationStatus: VerificationStatus.APPROVED },
  });
}

export async function approveAsAgencyFixture(userId: string): Promise<void> {
  await prisma.agencyProfile.updateMany({
    where: { userId },
    data: { verificationStatus: VerificationStatus.APPROVED },
  });
}

export async function makeVerifiedAgent(email: string): Promise<Actor> {
  const actor = await makeUser(UserRole.AGENT, email);
  await approveAsAgentFixture(actor.userId);
  return actor;
}

export async function makeVerifiedAgencyAdmin(email: string): Promise<Actor> {
  const actor = await makeUser(UserRole.AGENCY_ADMIN, email);
  await approveAsAgencyFixture(actor.userId);
  return actor;
}

export async function makeAgencyForAdmin(admin: Actor, name: string): Promise<string> {
  // Decided by affiliation module via input; agency could be created by admin.
  const agency = await prisma.agencyProfile.findUnique({ where: { userId: admin.userId } });
  if (!agency) throw new Error("agency admin profile missing");
  await prisma.agencyProfile.update({ where: { id: agency.id }, data: { name } });
  return agency.id;
}

export const fakeStorage: StorageService = {
  assertObjectExists: async () => undefined,
  issueDocumentUrl: async (key) => `signed://${key}`,
  issueImageUrl: async (key) => `signed://${key}`,
};

export const noOpGeocoder: Geocoder = async () => ({ latitude: 6.5244, longitude: 3.3792 });

export async function activeListingFixture(actor: Actor): Promise<string> {
  const profile = await prisma.agentProfile.findUnique({ where: { userId: actor.userId } });
  if (!profile) throw new Error("activeListingFixture requires a verified agent (test fixture)");
  const created = await prisma.listing.create({
    data: {
      title: "Fixture flat",
      price: 15_000_000,
      address: "12 Marina Road, Lagos",
      latitude: 6.5244,
      longitude: 3.3792,
      propertyType: PropertyType.APARTMENT,
      status: ListingStatus.ACTIVE,
      agentId: profile.id,
    },
  });
  return created.id;
}