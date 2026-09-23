import { ListingStatus, Prisma, PropertyType, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { geocoder, type Geocoder } from "@/lib/geocoding";
import { storage, type StorageService } from "@/lib/storage";
import { writeAuditLog, AUDIT_ACTIONS } from "@/modules/audit";
import { assertAllowed } from "@/modules/identity/permissions";
import type { Actor, AuditMeta } from "@/modules/verification";

export interface ListingImageInfo {
  id: string;
  uploadedAt: Date;
}

export interface SafeListing {
  id: string;
  title: string;
  price: number;
  address: string;
  latitude: number;
  longitude: number;
  country: string | null;
  propertyType: PropertyType;
  status: ListingStatus;
  hasOpenReports: boolean;
  createdAt: Date;
  images: ListingImageInfo[];
}

interface ListingRow {
  id: string;
  title: string;
  price: number;
  address: string;
  latitude: number;
  longitude: number;
  country: string | null;
  propertyType: PropertyType;
  status: ListingStatus;
  hasOpenReports: boolean;
  createdAt: Date;
  agentId: string | null;
  agencyId: string | null;
  landlordId: string | null;
  storageKey?: string;
  images?: { id: string; storageKey: string; uploadedAt: Date }[];
}

function toSafe(row: ListingRow): SafeListing {
  const { agentId: _a, agencyId: _b, landlordId: _c, storageKey: _d, ...safe } = row;
  return {
    ...safe,
    images: (row.images ?? []).map(({ storageKey: _s, ...image }) => image),
  };
}

// DB-11 is a property of the locked schema (exactly one owner column non-null
// per listing). The single writer lives here: the owner column is derived from
// the actor's own profile and never taken from client input.
async function ownerColumnsFor(tx: Prisma.TransactionClient, actor: Actor) {
  switch (actor.role) {
    case UserRole.AGENT: {
      const profile = await tx.agentProfile.findUnique({ where: { userId: actor.userId } });
      if (!profile) throw ApiError.forbidden("Agent profile not found");
      return { agentId: profile.id, agencyId: null as string | null, landlordId: null as string | null };
    }
    case UserRole.AGENCY_ADMIN: {
      const profile = await tx.agencyProfile.findUnique({ where: { userId: actor.userId } });
      if (!profile) throw ApiError.forbidden("Agency profile not found");
      return { agentId: null, agencyId: profile.id, landlordId: null };
    }
    case UserRole.LANDLORD: {
      const profile = await tx.landlordProfile.findUnique({ where: { userId: actor.userId } });
      if (!profile) throw ApiError.forbidden("Landlord profile not found");
      return { agentId: null, agencyId: null, landlordId: profile.id };
    }
    default:
      throw ApiError.forbidden("This role cannot create listings");
  }
}

async function requireApprovedProfile(tx: Prisma.TransactionClient, actor: Actor) {
  const status = await (async () => {
    switch (actor.role) {
      case UserRole.AGENT:
        return (await tx.agentProfile.findUnique({ where: { userId: actor.userId } }))
          ?.verificationStatus;
      case UserRole.AGENCY_ADMIN:
        return (await tx.agencyProfile.findUnique({ where: { userId: actor.userId } }))
          ?.verificationStatus;
      case UserRole.LANDLORD:
        return (await tx.landlordProfile.findUnique({ where: { userId: actor.userId } }))
          ?.verificationStatus;
      default:
        return undefined;
    }
  })();
  if (status !== "APPROVED") {
    throw ApiError.forbidden(
      "An approved verification is required before creating listings (PR-VER-001)",
    );
  }
}

export interface CreateListingInput {
  title: string;
  price: number;
  address: string;
  country?: string | null;
  propertyType: PropertyType;
  images: string[];
  latitude?: number;
  longitude?: number;
}

export interface CreateListingDeps {
  storage?: StorageService;
  geocoder?: Geocoder;
  ipAddress?: string;
}

export async function createListing(
  actor: Actor,
  input: CreateListingInput,
  deps: CreateListingDeps = {},
): Promise<SafeListing> {
  assertAllowed(actor.role, "CREATE_LISTING");

  const title = input.title?.trim();
  if (!title || title.length < 3 || title.length > 200) {
    throw ApiError.badRequest("title is required (3-200 characters)");
  }
  if (!Number.isInteger(input.price) || input.price <= 0) {
    throw ApiError.badRequest("price must be a positive integer in the smallest currency unit");
  }
  const address = input.address?.trim();
  if (!address) throw ApiError.badRequest("address is required");
  if (!Object.values(PropertyType).includes(input.propertyType)) {
    throw ApiError.badRequest("propertyType is invalid");
  }

  const storageService = deps.storage ?? storage;
  for (const imageKey of input.images) {
    if (!imageKey.startsWith("images/")) {
      throw ApiError.badRequest("image keys must be stored under images/");
    }
    await storageService.assertObjectExists(imageKey); // UP-9
  }

  // Geocoded exactly once, at creation (PRD Technical Requirements). This is
  // the only live external mapping call in the core flow.
  const geocodeService = deps.geocoder ?? geocoder;
  const point =
    input.latitude !== undefined && input.longitude !== undefined
      ? { latitude: input.latitude, longitude: input.longitude }
      : await geocodeService(address);

  const listing = await prisma.$transaction(async (tx) => {
    await requireApprovedProfile(tx, actor); // PR-VER-001 gate at data layer
    const owner = await ownerColumnsFor(tx, actor);

    const created = await tx.listing.create({
      data: {
        title,
        price: input.price,
        address,
        latitude: point.latitude,
        longitude: point.longitude,
        country: input.country ?? null,
        propertyType: input.propertyType,
        // PR-LST-002: a listing is never created ACTIVE. Approval is the
        // reviewer's separate gate from account verification.
        status: ListingStatus.PENDING_REVIEW,
        ...owner,
        images: {
          create: input.images.map((storageKey) => ({ storageKey })),
        },
      },
      include: { images: { select: { id: true, storageKey: true, uploadedAt: true } } },
    });
    await writeAuditLog(tx, {
      userId: actor.userId,
      action: AUDIT_ACTIONS.LISTING_CREATED,
      targetId: created.id,
      ipAddress: deps.ipAddress ?? "internal",
    });
    return created;
  });
  return toSafe(listing);
}

// PR-LST-002: the reviewer-only gate. Nothing else may set ACTIVE (DB-8).
export async function approveListing(
  listingId: string,
  reviewer: Actor,
  meta: AuditMeta = {},
): Promise<SafeListing> {
  assertAllowed(reviewer.role, "REVIEW_VERIFICATION_AND_REPORTS");
  const now = new Date();

  const listing = await prisma.$transaction(async (tx) => {
    const updated = await tx.listing.updateMany({
      where: { id: listingId, status: ListingStatus.PENDING_REVIEW },
      data: { status: ListingStatus.ACTIVE },
    });
    if (updated.count !== 1) {
      const existing = await tx.listing.findUnique({
        where: { id: listingId },
        include: { images: { select: { id: true, storageKey: true, uploadedAt: true } } },
      });
      if (!existing) throw ApiError.notFound("Listing not found");
      throw ApiError.conflict(
        "Listing cannot move to ACTIVE from its current status (PR-LST-002)",
      );
    }
    const activated = await tx.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: { images: { select: { id: true, storageKey: true, uploadedAt: true } } },
    });
    await writeAuditLog(tx, {
      userId: reviewer.userId,
      action: AUDIT_ACTIONS.LISTING_APPROVED,
      targetId: listingId,
      ipAddress: meta.ipAddress ?? "internal",
    });
    return activated;
  });
  return toSafe(listing);
}

// PR-LST-004: suspension is reachable from any status and is authorized by an
// existing resolution record. This function is called inside the resolver's
// transaction (see reports module) so the ReviewCase resolution is written
// before/with the status change (Q3#11).
export async function suspendListing(
  tx: Prisma.TransactionClient,
  listingId: string,
  meta: { resolvedById: string; ipAddress?: string },
): Promise<void> {
  const updated = await tx.listing.updateMany({
    where: { id: listingId, status: { not: ListingStatus.SUSPENDED } },
    // CS-3: SUSPENDED is a terminal state; there is no path out of it.
    data: { status: ListingStatus.SUSPENDED },
  });
  if (updated.count !== 1) {
    const existing = await tx.listing.findUnique({ where: { id: listingId } });
    if (!existing) throw ApiError.notFound("Listing not found");
    throw ApiError.conflict("Listing is already suspended");
  }
  await writeAuditLog(tx, {
    userId: meta.resolvedById,
    action: AUDIT_ACTIONS.LISTING_SUSPENDED,
    targetId: listingId,
    ipAddress: meta.ipAddress ?? "internal",
  });
}

export interface ListingSearchQuery {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  limit?: number;
}

// Search is a coordinate range scan against the stored lat/lng pair — no live
// maps call (indexes @@index([status]) and @@index([latitude, longitude])).
export async function searchActiveListings(query: ListingSearchQuery): Promise<SafeListing[]> {
  const limit = Math.min(Math.max(query.limit ?? 24, 1), 100);
  const where: Prisma.ListingWhereInput = { status: ListingStatus.ACTIVE };

  if (query.latitude !== undefined && query.longitude !== undefined) {
    const radiusKm = Math.min(Math.max(query.radiusKm ?? 5, 0.1), 50);
    const kmPerDeg = 111.32;
    const latMin = query.latitude - radiusKm / kmPerDeg;
    const latMax = query.latitude + radiusKm / kmPerDeg;
    const lngSpread = (radiusKm / kmPerDeg) / Math.max(Math.cos((query.latitude * Math.PI) / 180), 0.2);
    const lngMin = query.longitude - lngSpread;
    const lngMax = query.longitude + lngSpread;
    where.latitude = { gte: latMin, lte: latMax };
    where.longitude = { gte: lngMin, lte: lngMax };
  }

  const rows = await prisma.listing.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      price: true,
      address: true,
      latitude: true,
      longitude: true,
      country: true,
      propertyType: true,
      status: true,
      hasOpenReports: true,
      createdAt: true,
      images: { select: { id: true, uploadedAt: true } },
    },
  });
  return rows;
}

async function isListingOwnerSide(
  actor: Actor,
  listing: { agentId: string | null; agencyId: string | null; landlordId: string | null },
): Promise<boolean> {
  switch (actor.role) {
    case UserRole.AGENT:
      return (
        (await prisma.agentProfile.findUnique({ where: { userId: actor.userId } }))?.id ===
        listing.agentId
      );
    case UserRole.AGENCY_ADMIN:
      return (
        (await prisma.agencyProfile.findUnique({ where: { userId: actor.userId } }))?.id ===
        listing.agencyId
      );
    case UserRole.LANDLORD:
      return (
        (await prisma.landlordProfile.findUnique({ where: { userId: actor.userId } }))?.id ===
        listing.landlordId
      );
    default:
      return false;
  }
}

// UP-4: active listings are public; non-active listings are only visible to
// their owner side and to reviewers.
export async function getListingById(actor: Actor, listingId: string): Promise<SafeListing> {
  assertAllowed(actor.role, "VIEW_ANY_LISTING");
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { images: { select: { id: true, storageKey: true, uploadedAt: true } } },
  });
  if (!listing) throw ApiError.notFound("Listing not found");
  const isReviewer =
    actor.role === UserRole.PLATFORM_REVIEWER || actor.role === UserRole.SUPER_ADMIN;
  if (listing.status !== ListingStatus.ACTIVE && !isReviewer && !(await isListingOwnerSide(actor, listing))) {
    throw ApiError.forbidden("You are not allowed to view this listing (UP-4)");
  }
  return toSafe(listing);
}