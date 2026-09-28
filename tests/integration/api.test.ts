import { ListingStatus, PropertyType, ReportTargetType, UserRole } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// External seams fail closed or are absent in tests, so the HTTP layer is
// exercised against fakes — the same DI pattern the unit suites use, here at
// the route boundary. The storage/geocoding rules stay covered by the module
// tests in ../unit.
vi.mock("@/lib/storage", () => ({
  storage: {
    assertObjectExists: async () => undefined,
    issueDocumentUrl: async (key: string) => `signed://${key}`,
    issueImageUrl: async (key: string) => `signed://${key}`,
  },
}));
vi.mock("@/lib/geocoding", () => ({
  geocoder: async () => ({ latitude: 6.5244, longitude: 3.3792 }),
}));

const state = vi.hoisted(() => ({ sessionToken: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "domora_session" && state.sessionToken
        ? { value: state.sessionToken }
        : undefined,
  }),
}));

import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resetRateLimitStore } from "@/lib/rate-limit";
import { createReport } from "@/modules/reports";
import { createListing } from "@/modules/listings";
import { submitVerificationRequest } from "@/modules/verification";
import {
  activeListingFixture,
  fakeStorage,
  makeReviewer,
  makeUser,
  makeVerifiedAgent,
  noOpGeocoder,
  resetDb,
} from "../helpers";
import type { Actor } from "@/modules/verification";

import { POST as postAffiliations } from "@/app/api/v1/agency-affiliations/route";
import { POST as postAcceptAffiliation } from "@/app/api/v1/agency-affiliations/[id]/accept/route";
import { POST as postListingsCreate, GET as getListings } from "@/app/api/v1/listings/route";
import { GET as getListing } from "@/app/api/v1/listings/[id]/route";
import { POST as postListingApprove } from "@/app/api/v1/listings/[id]/approve/route";
import { POST as postReportsCreate, GET as getReports } from "@/app/api/v1/reports/route";
import { GET as getReport } from "@/app/api/v1/reports/[id]/route";
import {
  POST as postVerificationCreate,
  GET as getVerifications,
} from "@/app/api/v1/verification-requests/route";
import { GET as getVerification } from "@/app/api/v1/verification-requests/[id]/route";
import { POST as postVerificationApprove } from "@/app/api/v1/verification-requests/[id]/approve/route";
import { POST as postVerificationReject } from "@/app/api/v1/verification-requests/[id]/reject/route";
import { GET as getVerificationDocumentUrl } from "@/app/api/v1/verification-requests/[id]/document-url/route";
import { GET as getReviewQueue } from "@/app/api/v1/review-queue/route";
import { GET as getReviewCase } from "@/app/api/v1/review-cases/[id]/route";
import { POST as postReviewCaseResolve } from "@/app/api/v1/review-cases/[id]/resolve/route";

interface ListEnvelope<T> {
  data: T[];
  meta?: { total: number; limit: number; offset: number; hasMore: boolean };
}
interface ErrorEnvelope {
  error: { code: string; message: string };
}

const ORIGIN = { origin: "http://localhost:3000" };

async function sessionToken(actor: Actor): Promise<string> {
  return createSession({ userId: actor.userId, role: actor.role }, "test-jti");
}

async function request(
  actor: Actor | null,
  method: string,
  pathAndQuery: string,
  body?: unknown,
): Promise<Request> {
  state.sessionToken = actor ? await sessionToken(actor) : undefined;
  const headers: Record<string, string> = {};
  if (state.sessionToken) headers.cookie = `domora_session=${state.sessionToken}`;
  if (method !== "GET") Object.assign(headers, ORIGIN);
  return new Request(`http://localhost:3000${pathAndQuery}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function read<T>(res: Response, status: number): Promise<T> {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
}

const listingInput = {
  title: "Serene 2-bedroom flat",
  price: 25_000_000,
  address: "22 Akin Adesola, Victoria Island, Lagos",
  country: "NG",
  propertyType: PropertyType.APARTMENT,
  images: ["images/fixtures/a.jpg"],
  latitude: 6.4281,
  longitude: 3.4219,
};

async function seedVerifiedListingPair(): Promise<{ agent: Actor; listingId: string }> {
  const agent = await makeVerifiedAgent("agent@example.com");
  const listingId = await activeListingFixture(agent);
  return { agent, listingId };
}

// Creates a listing through the real module (so the create path is exercised,
// status lands PENDING_REVIEW per PR-LST-002) then fixture-flips to ACTIVE so
// the public list/detail default visibility filter can see it.
async function createActiveListing(
  agent: Actor,
  overrides: Partial<typeof listingInput> = {},
): Promise<{ id: string }> {
  const pending = await createListing(
    agent,
    { ...listingInput, ...overrides, images: overrides.images ?? [imageKey(0)] },
    { storage: fakeStorage, geocoder: noOpGeocoder },
  );
  return prisma.listing.update({ where: { id: pending.id }, data: { status: ListingStatus.ACTIVE } });
}

describe("API endpoints (Step 3): envelope, list semantics, errors", () => {
  beforeEach(async () => {
    await resetDb();
    resetRateLimitStore();
  });

  it("every list endpoint returns the offset/limit envelope with hasMore", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    for (let i = 0; i < 3; i += 1) {
      // created through the module (starts PENDING_REVIEW, PR-LST-002), then
      // fixture-flipped to ACTIVE so the default list filter sees it
      await createActiveListing(agent, { title: `Flat number ${i}`, price: 20_000_000 + i });
    }

    const page1 = await read<ListEnvelope<{ id: string }>>(
      await getListings(await request(agent, "GET", "/api/v1/listings?limit=2&offset=0")),
      200,
    );
    expect(page1.data.length).toBe(2);
    expect(page1.meta).toEqual({
      total: 3,
      limit: 2,
      offset: 0,
      hasMore: true,
    });

    const page2 = await read<ListEnvelope<{ id: string }>>(
      await getListings(await request(agent, "GET", "/api/v1/listings?limit=2&offset=2")),
      200,
    );
    expect(page2.data.length).toBe(1);
    expect(page2.meta).toEqual({ total: 3, limit: 2, offset: 2, hasMore: false });
  });

  it("defaults limit to 20 and rejects invalid limit/offset/sort/order (400)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    await activeListingFixture(agent);

    const ok = await read<ListEnvelope<unknown>>(
      await getListings(await request(agent, "GET", "/api/v1/listings")),
      200,
    );
    expect(ok.meta?.limit).toBe(20);

    const bads = ["limit=0", "limit=-1", "limit=abc", "offset=-5", "sort=madeUp", "order=sideways"];
    for (const bad of bads) {
      const err = await read<ErrorEnvelope>(
        await getListings(await request(agent, "GET", `/api/v1/listings?${bad}`)),
        400,
      );
      expect(err.error.code).toBe("BAD_REQUEST");
    }
  });

  it("filters on propertyType/country/price and sorts by price", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    await createActiveListing(agent, { title: "Cheap flat", price: 10_000_000 });
    await createActiveListing(agent, {
      title: "Duper chele",
      address: "Cape Town",
      country: "ZA",
      price: 30_000_000,
    });

    const filtered = await read<ListEnvelope<{ price: number }>>(
      await getListings(
        await request(agent, "GET", "/api/v1/listings?propertyType=APARTMENT&country=NG&maxPrice=25000000"),
      ),
      200,
    );
    expect(filtered.data.map((l) => l.price)).toEqual([10_000_000]);
    expect(filtered.meta?.total).toBe(1);

    const sortedAsc = await read<ListEnvelope<{ price: number }>>(
      await getListings(await request(agent, "GET", "/api/v1/listings?sort=price&order=asc")),
      200,
    );
    expect(sortedAsc.data.map((l) => l.price)).toEqual([10_000_000, 30_000_000]);

    const sortedDesc = await read<ListEnvelope<{ price: number }>>(
      await getListings(await request(agent, "GET", "/api/v1/listings?sort=price&order=desc")),
      200,
    );
    expect(sortedDesc.data.map((l) => l.price)).toEqual([30_000_000, 10_000_000]);
  });

  it("guest can browse ACTIVE listings; non-active status is a 403, not a downgrade (UP-4)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    await createActiveListing(agent, { title: "Public flat", price: 20_000_000 });
    const pending = await createListing(
      agent,
      { ...listingInput, title: "Hidden pending flat", images: [imageKey(1)] },
      { storage: fakeStorage, geocoder: noOpGeocoder },
    );

    const guestBrowse = await read<ListEnvelope<{ id: string; status: string }>>(
      await getListings(await request(null, "GET", "/api/v1/listings?limit=20")),
      200,
    );
    expect(guestBrowse.data.map((l) => l.status)).toEqual(["ACTIVE"]);
    expect(guestBrowse.data.map((l) => l.id)).not.toContain(pending.id);

    const err = await read<ErrorEnvelope>(
      await getListings(await request(null, "GET", "/api/v1/listings?status=PENDING_REVIEW")),
      403,
    );
    expect(err.error.code).toBe("FORBIDDEN");
  });

  it("403 (never a filtered body) for non-owners asking for a non-active status", async () => {
    const { agent } = await seedVerifiedListingPair();
    const seeker = await makeUser(UserRole.SEEKER, "seeker@example.com");
    await createListing(
      agent,
      { ...listingInput, title: "Pending flat", images: [imageKey(0)] },
      { storage: fakeStorage, geocoder: noOpGeocoder },
    );

    const err = await read<ErrorEnvelope>(
      await getListings(await request(seeker, "GET", "/api/v1/listings?status=PENDING_REVIEW")),
      403,
    );
    expect(err.error.code).toBe("FORBIDDEN");
  });

  it("item GET: active listing visible, unknown id is 404, hidden status is 403", async () => {
    const { agent, listingId } = await seedVerifiedListingPair();
    const seeker = await makeUser(UserRole.SEEKER, "seeker@example.com");

    const detail = await read<{ data: { id: string } }>(
      await getListing(await request(seeker, "GET", "/"), {
        params: Promise.resolve({ id: listingId }),
      }),
      200,
    );
    expect(detail.data.id).toBe(listingId);

    const missing = await read<ErrorEnvelope>(
      await getListing(await request(seeker, "GET", "/"), {
        params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
      }),
      404,
    );
    expect(missing.error.code).toBe("NOT_FOUND");

    const pending = await createListing(
      agent,
      { ...listingInput, title: "Pending flat", images: [imageKey(0)] },
      { storage: fakeStorage, geocoder: noOpGeocoder },
    );
    const hidden = await read<ErrorEnvelope>(
      await getListing(await request(seeker, "GET", "/"), {
        params: Promise.resolve({ id: pending.id }),
      }),
      403,
    );
    expect(hidden.error.code).toBe("FORBIDDEN");
  });

  it("POST /listings creates PENDING_REVIEW; body validation failures are 422", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const created = await read<{ data: { status: ListingStatus } }>(
      await postListingsCreate(
        await request(agent, "POST", "/api/v1/listings", {
          title: "New apartment",
          price: 5_000_000,
          address: "5 Admiralty Way, Lekki",
          propertyType: "APARTMENT",
          images: ["images/fixtures/a.jpg"],
        }),
      ),
      200,
    );
    expect(created.data.status).toBe(ListingStatus.PENDING_REVIEW);

    const rejected = await read<ErrorEnvelope>(
      await postListingsCreate(
        await request(agent, "POST", "/api/v1/listings", { title: "X" }),
      ),
      422,
    );
    expect(rejected.error.code).toBe("VALIDATION_ERROR");
  });

  it("POST /listings/:id/approve is reviewer-only and 404s unknown ids", async () => {
    // created via the module so it is PENDING_REVIEW (PR-LST-002); the fixture
    // flip to ACTIVE elsewhere would make the approve conflict (DB-6)
    const agent = await makeVerifiedAgent("agent@example.com");
    const pending = await createListing(
      agent,
      { ...listingInput, title: "Pending flat" },
      { storage: fakeStorage, geocoder: noOpGeocoder },
    );
    const seeker = await makeUser(UserRole.SEEKER, "seeker@example.com");

    const denied = await read<ErrorEnvelope>(
      await postListingApprove(await request(seeker, "POST", "/"), {
        params: Promise.resolve({ id: pending.id }),
      }),
      403,
    );
    expect(denied.error.code).toBe("FORBIDDEN");

    const reviewer = await makeReviewer("reviewer@example.com");
    const approved = await read<{ data: { status: ListingStatus } }>(
      await postListingApprove(await request(reviewer, "POST", "/"), {
        params: Promise.resolve({ id: pending.id }),
      }),
      200,
    );
    expect(approved.data.status).toBe(ListingStatus.ACTIVE);

    const missing = await read<ErrorEnvelope>(
      await postListingApprove(await request(reviewer, "POST", "/"), {
        params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
      }),
      404,
    );
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("verification: submit, list scoping, item, decide, document url", async () => {
    const agent = await makeUser(UserRole.AGENT, "agent@example.com");
    const seeker = await makeUser(UserRole.SEEKER, "seeker@example.com");
    const reviewer = await makeReviewer("reviewer@example.com");

    const submitted = await read<{ data: { id: string; status: string } }>(
      await postVerificationCreate(
        await request(agent, "POST", "/api/v1/verification-requests", {
          documentKey: "docs/agent.pdf",
        }),
      ),
      200,
    );
    expect(submitted.data.status).toBe("PENDING");

    // applicant sees only their own; a seeker is denied outright (PR-ADM-001)
    const mine = await read<ListEnvelope<{ userId: string; status: string }>>(
      await getVerifications(await request(agent, "GET", "/api/v1/verification-requests")),
      200,
    );
    expect(mine.data.length).toBe(1);
    expect(mine.data[0].userId).toBe(agent.userId);
    expect(mine.data[0].status).toBe("PENDING");

    const seekerDenied = await read<ErrorEnvelope>(
      await getVerifications(await request(seeker, "GET", "/api/v1/verification-requests")),
      403,
    );
    expect(seekerDenied.error.code).toBe("FORBIDDEN");

    // reviewer list with status filter
    const queue = await read<ListEnvelope<{ id: string }>>(
      await getVerifications(await request(reviewer, "GET", "/api/v1/verification-requests?status=PENDING")),
      200,
    );
    expect(queue.data.map((r) => r.id)).toContain(submitted.data.id);

    // item: owner sees it, foreign seeker is denied, unknown id 404
    const item = await read<{ data: { id: string } }>(
      await getVerification(await request(agent, "GET", "/"), {
        params: Promise.resolve({ id: submitted.data.id }),
      }),
      200,
    );
    expect(item.data.id).toBe(submitted.data.id);

    const foreignDenied = await read<ErrorEnvelope>(
      await getVerification(await request(seeker, "GET", "/"), {
        params: Promise.resolve({ id: submitted.data.id }),
      }),
      403,
    );
    expect(foreignDenied.error.code).toBe("FORBIDDEN");

    // reject without a note is 422; approve by non-reviewer is 403
    const noNote = await read<ErrorEnvelope>(
      await postVerificationReject(
        await request(reviewer, "POST", "/", { reviewNote: "   " }),
        { params: Promise.resolve({ id: submitted.data.id }) },
      ),
      422,
    );
    expect(noNote.error.code).toBe("VALIDATION_ERROR");

    const approveDenied = await read<ErrorEnvelope>(
      await postVerificationApprove(
        await request(seeker, "POST", "/"),
        { params: Promise.resolve({ id: submitted.data.id }) },
      ),
      403,
    );
    expect(approveDenied.error.code).toBe("FORBIDDEN");

    const decided = await read<{ data: { status: string } }>(
      await postVerificationApprove(
        await request(reviewer, "POST", "/"),
        { params: Promise.resolve({ id: submitted.data.id }) },
      ),
      200,
    );
    expect(decided.data.status).toBe("APPROVED");

    // document url: owner ok, foreign seeker denied
    const ownerUrl = await read<{ data: { url: string } }>(
      await getVerificationDocumentUrl(await request(agent, "GET", "/"), {
        params: Promise.resolve({ id: submitted.data.id }),
      }),
      200,
    );
    expect(ownerUrl.data.url).toContain("signed://");
    const foreignDoc = await read<ErrorEnvelope>(
      await getVerificationDocumentUrl(await request(seeker, "GET", "/"), {
        params: Promise.resolve({ id: submitted.data.id }),
      }),
      403,
    );
    expect(foreignDoc.error.code).toBe("FORBIDDEN");
  });

  it("reports: seeker files, list scoping, item access, resolved filter", async () => {
    const { agent, listingId } = await seedVerifiedListingPair();
    const seeker = await makeUser(UserRole.SEEKER, "seeker@example.com");
    const otherSeeker = await makeUser(UserRole.SEEKER, "other@example.com");
    const reviewer = await makeReviewer("reviewer@example.com");

    const filed = await read<{
      data: { report: { id: string; listingId: string; reason: string }; reviewCaseId: string | null };
    }>(
      await postReportsCreate(
        await request(seeker, "POST", "/api/v1/reports", {
          targetType: "LISTING",
          listingId,
          reason: "The photos do not match the apartment that was shown at inspection.",
        }),
      ),
      200,
    );
    expect(filed.data.report.listingId).toBe(listingId);
    expect(filed.data.reviewCaseId).toBeNull();

    // non-seekers cannot file (403) and body failures are 422
    const denied = await read<ErrorEnvelope>(
      await postReportsCreate(
        await request(agent, "POST", "/api/v1/reports", {
          targetType: "LISTING",
          listingId,
          reason: "Some reason for reporting this listing without a doubt.",
        }),
      ),
      403,
    );
    expect(denied.error.code).toBe("FORBIDDEN");

    const badBody = await read<ErrorEnvelope>(
      await postReportsCreate(
        await request(seeker, "POST", "/api/v1/reports", { targetType: "LISTING", listingId, reason: "short" }),
      ),
      422,
    );
    expect(badBody.error.code).toBe("VALIDATION_ERROR");

    // seekers see only their own reports; reviewers see all
    const mine = await read<ListEnvelope<{ reporterId: string }>>(
      await getReports(await request(seeker, "GET", "/api/v1/reports")),
      200,
    );
    expect(mine.data.every((r) => r.reporterId === seeker.userId)).toBe(true);

    const all = await read<ListEnvelope<{ reporterId: string }>>(
      await getReports(await request(reviewer, "GET", "/api/v1/reports?resolved=false")),
      200,
    );
    expect(all.data.map((r) => r.reporterId)).toContain(seeker.userId);

    // item: reporter can read, a different seeker cannot (404 for unknown)
    const mineDetail = await read<{ data: { reasoning: string; id: string } }>(
      await getReport(await request(seeker, "GET", "/"), {
        params: Promise.resolve({ id: filed.data.report.id }),
      }),
      200,
    );
    expect(mineDetail.data.id).toBe(filed.data.report.id);

    const foreign = await read<ErrorEnvelope>(
      await getReport(await request(otherSeeker, "GET", "/"), {
        params: Promise.resolve({ id: filed.data.report.id }),
      }),
      403,
    );
    expect(foreign.error.code).toBe("FORBIDDEN");
  });

  it("review queue + case item + resolve", async () => {
    const { agent, listingId } = await seedVerifiedListingPair();
    const seekers = await Promise.all([
      makeUser(UserRole.SEEKER, "s1@example.com"),
      makeUser(UserRole.SEEKER, "s2@example.com"),
      makeUser(UserRole.SEEKER, "s3@example.com"),
    ]);
    for (const seeker of seekers) {
      await createReport(seeker, {
        targetType: ReportTargetType.LISTING,
        listingId,
        reason: "The property differs materially from the description in the listing.",
      });
    }
    const reviewer = await makeReviewer("reviewer@example.com");

    const queue = await read<ListEnvelope<{ id: string; status: string }>>(
      await getReviewQueue(await request(reviewer, "GET", "/api/v1/review-queue")),
      200,
    );
    expect(queue.data.length).toBe(1);
    expect(queue.meta?.total).toBe(1);
    expect(queue.data[0].status).toBe("OPEN");

    // non-reviewers are denied on the queue (403)
    const denied = await read<ErrorEnvelope>(
      await getReviewQueue(await request(seekers[0], "GET", "/api/v1/review-queue")),
      403,
    );
    expect(denied.error.code).toBe("FORBIDDEN");

    const caseId = queue.data[0].id;
    const item = await read<{ data: { id: string } }>(
      await getReviewCase(await request(reviewer, "GET", "/"), {
        params: Promise.resolve({ id: caseId }),
      }),
      200,
    );
    expect(item.data.id).toBe(caseId);

    const resolved = await read<{ data: { status: string } }>(
      await postReviewCaseResolve(
        await request(
          reviewer,
          "POST",
          "/",
          { action: "NONE", resolution: "Reviewed; no action taken." },
        ),
        { params: Promise.resolve({ id: caseId }) },
      ),
      200,
    );
    expect(resolved.data.status).toBe("RESOLVED");
  });

  it("agency affiliation: request, accept, reject (support flow stays envelope-shaped)", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const admin = await makeUser(UserRole.AGENCY_ADMIN, "admin@example.com");
    const agency = await prisma.agencyProfile.findUniqueOrThrow({
      where: { userId: admin.userId },
    });
    const agentProfile = await prisma.agentProfile.findUniqueOrThrow({
      where: { userId: agent.userId },
    });

    const created = await read<{ data: { id: string; status: string } }>(
      await postAffiliations(
        await request(agent, "POST", "/api/v1/agency-affiliations", {
          agentId: agentProfile.id,
          agencyId: agency.id,
        }),
      ),
      200,
    );
    expect(created.data.status).toBe("PENDING");

    // accept from the owning agency admin flips it (PR-VER-003 / DB-8)
    const accepted = await read<{ data: { status: string } }>(
      await postAcceptAffiliation(
        await request(admin, "POST", "/"),
        { params: Promise.resolve({ id: created.data.id }) },
      ),
      200,
    );
    expect(accepted.data.status).toBe("ACCEPTED");

    const nowAgent = await prisma.agentProfile.findUniqueOrThrow({
      where: { userId: agent.userId },
    });
    expect(nowAgent.agencyId).toBe(agency.id);

    // second request for the same pair is a conflict; unknown id is 404
    const conflict = await read<ErrorEnvelope>(
      await postAffiliations(
        await request(agent, "POST", "/api/v1/agency-affiliations", {
          agentId: agentProfile.id,
          agencyId: agency.id,
        }),
      ),
      409,
    );
    expect(conflict.error.code).toBe("CONFLICT");

    const missing = await read<ErrorEnvelope>(
      await getReviewCase(await request(admin, "GET", "/"), {
        params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
      }),
      403, // agency admin is not a reviewer; the role check fires before lookup
    );
    expect(missing.error.code).toBe("FORBIDDEN");
  });
});

describe("API endpoints (Step 4): ugly inputs", () => {
  beforeEach(async () => {
    await resetDb();
    resetRateLimitStore();
  });

  it("clamps an oversized limit to the configured maximum instead of honouring it", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    await activeListingFixture(agent);

    const clamped = await read<ListEnvelope<unknown>>(
      await getListings(await request(agent, "GET", "/api/v1/listings?limit=5000")),
      200,
    );
    expect(clamped.meta?.limit).toBe(100);
    expect(clamped.meta?.hasMore).toBe(false);
  });

  it("negative offset returns 400 with a clear error message", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const err = await read<ErrorEnvelope>(
      await getListings(await request(agent, "GET", "/api/v1/listings?offset=-1")),
      400,
    );
    expect(err.error.code).toBe("BAD_REQUEST");
    expect(err.error.message).toContain("offset");
  });

  it("unknown sort field returns 400 and is not silently ignored", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const err = await read<ErrorEnvelope>(
      await getListings(await request(agent, "GET", "/api/v1/listings?sort=madeUp")),
      400,
    );
    expect(err.error.code).toBe("BAD_REQUEST");
    expect(err.error.message).toContain("sort");
    expect(err.error.message).toContain("must be one of");
  });

  it("malformed path identifier returns 400, never 500", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    for (const lookup of [
      { handler: getListing, path: "/api/v1/listings" },
      { handler: getReport, path: "/api/v1/reports" },
    ]) {
      const err = await read<ErrorEnvelope>(
        await lookup.handler(await request(agent, "GET", lookup.path), {
          params: Promise.resolve({ id: "not-a-real-id" }),
        }),
        400,
      );
      expect(err.error.code).toBe("BAD_REQUEST");
      expect(err.error.message).toContain("UUID");
    }
  });

  it("POST with a missing required field returns 422 and names the field", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");

    const listingErr = await read<ErrorEnvelope>(
      await postListingsCreate(
        await request(agent, "POST", "/api/v1/listings", {}),
      ),
      422,
    );
    expect(listingErr.error.code).toBe("VALIDATION_ERROR");
    expect(listingErr.error.message).toContain("title"); // first required field is named

    const seeker = await makeUser(UserRole.SEEKER, "seeker@example.com");
    const reportErr = await read<ErrorEnvelope>(
      await postReportsCreate(
        await request(seeker, "POST", "/api/v1/reports", {
          targetType: "LISTING",
          listingId: "00000000-0000-4000-8000-000000000000",
        }),
      ),
      422,
    );
    expect(reportErr.error.code).toBe("VALIDATION_ERROR");
    expect(reportErr.error.message).toContain("reason");
  });

  it("every ugly-input response uses the same error envelope", async () => {
    const agent = await makeVerifiedAgent("agent@example.com");
    const cases: Array<Promise<Response>> = [
      getListings(await request(agent, "GET", "/api/v1/listings?offset=-5")),
      getListings(await request(agent, "GET", "/api/v1/listings?sort=madeUp")),
      postListingsCreate(await request(agent, "POST", "/api/v1/listings", {})),
    ];
    for (const promise of cases) {
      const res = await promise;
      expect(res.status).toBeGreaterThanOrEqual(400);
      const body = (await res.json()) as ErrorEnvelope;
      expect(typeof body.error.code).toBe("string");
      expect(typeof body.error.message).toBe("string");
      expect(body.error.code).not.toBe("INTERNAL_ERROR");
    }
  });
});

describe("API endpoints (Step 5): rate limiting", () => {
  const savedMax = process.env.RATE_LIMIT_MAX_REQUESTS;
  const savedWindow = process.env.RATE_LIMIT_WINDOW_SECONDS;

  beforeEach(async () => {
    await resetDb();
    resetRateLimitStore();
    // A tight budget and a long window make the 429 deterministic: a full
    // suite run never accidentally crosses the 3600s window boundary.
    process.env.RATE_LIMIT_MAX_REQUESTS = "5";
    process.env.RATE_LIMIT_WINDOW_SECONDS = "3600";
  });

  afterEach(() => {
    resetRateLimitStore();
    restoreEnv(savedMax, "RATE_LIMIT_MAX_REQUESTS");
    restoreEnv(savedWindow, "RATE_LIMIT_WINDOW_SECONDS");
  });

  it("spends the per-IP budget, returns 429 with Retry-After, then tolerates a different IP", async () => {
    const seeker = await makeUser(UserRole.SEEKER, "ratelimit@example.com");
    const agent = await makeVerifiedAgent("rlagent@example.com");
    await activeListingFixture(agent);

    const call = async (ip: string) =>
      getListings(
        new Request("http://localhost:3000/api/v1/listings", {
          headers: {
            cookie: `domora_session=${await sessionToken(seeker)}`,
            "x-forwarded-for": ip,
          },
        }),
      );

    const ip = "203.0.113.77";
    for (let i = 0; i < 5; i += 1) {
      expect((await call(ip)).status).toBe(200);
    }

    const limited = await call(ip);
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as ErrorEnvelope;
    expect(body.error.code).toBe("RATE_LIMITED");
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);

    expect((await call("198.51.100.42")).status).toBe(200);
  });
});

function imageKey(index: number): string {
  return `images/fixtures/${index}.jpg`;
}

function restoreEnv(saved: string | undefined, name: string): void {
  if (saved === undefined) delete process.env[name];
  else process.env[name] = saved;
}