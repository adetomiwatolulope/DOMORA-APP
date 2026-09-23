# Domora

Property listing platform connecting seekers with verified agents, agencies, and
landlords. This repository is the **MVP / Phase 1** build: verification and
listings core only (PRD Section 13 Phase 1). Booking (Phase 2), billing /
Flutterwave (Phase 3), and AI features are intentionally not built.

Source of truth: `docx/Domora_PRD_v2.md`. Behavior rules: `AGENTS.md`.

## Resource design (Task 1 — Step 1)

Five first-class resources back the Phase 1 REST API. Support models from the
locked PRD schema that are not first-class API resources (role profiles, listing
images, audit log, notifications, agency affiliations) are represented through
relations. The affiliation flow (PR-VER-003) is expressed on `User` as the
`agencyId` owner pointer; it becomes first-class when the agency console lands
in a later phase.

| Resource | Field | Type | Req | Notes |
| --- | --- | --- | --- | --- |
| **User** | `id` | UUID v4 | ✓ | generated, server-side |
| | `email` | string | ✓ | unique, lowercased |
| | `role` | enum | ✓ | SEEKER · AGENT · AGENCY_ADMIN · LANDLORD · PLATFORM_REVIEWER · SUPER_ADMIN |
| | `country` | string | ✗ | nullable; launch region undecided (PRD Q6) |
| | `createdAt` | datetime | ✓ | server-set |
| **VerificationRequest** | `id` | UUID v4 | ✓ | generated, server-side |
| | `userId` | ref User | ✓ | applicant — AGENT / AGENCY_ADMIN / LANDLORD only |
| | `documentKey` | string | ✓ | opaque storage key, never returned |
| | `status` | enum | ✓ | PENDING · APPROVED · REJECTED — only a reviewer action sets APPROVED/REJECTED |
| | `reviewNote` | string | ✗ | required when status = REJECTED |
| | `reviewedById` | ref User | ✗ | set when decided (reviewer) |
| | `createdAt` / `reviewedAt` | datetime | ✓ / ✗ | / |
| **Listing** | `id` | UUID v4 | ✓ | generated, server-side |
| | `title` | string | ✓ | 3–200 characters |
| | `price` | integer | ✓ | smallest currency unit, whole number |
| | `address` | string | ✓ | |
| | `latitude` / `longitude` | float | ✓ | stored once at creation |
| | `country` | string | ✗ | nullable |
| | `propertyType` | enum | ✓ | APARTMENT · HOUSE · DUPLEX · LAND · COMMERCIAL · OTHER |
| | `status` | enum | ✓ | DRAFT · PENDING_REVIEW · ACTIVE · SUSPENDED — created PENDING_REVIEW |
| | `hasOpenReports` | boolean | ✓ | maintained by the report module |
| | `agentId` / `agencyId` / `landlordId` | ref | ✓ | exactly one non-null owner per listing |
| | `images` | ref ListingImage[] | ✓ | ≥ 1 image sub-resource |
| | `createdAt` | datetime | ✓ | server-set |
| **Report** | `id` | UUID v4 | ✓ | generated, server-side |
| | `reporterId` | ref User | ✓ | must be a SEEKER |
| | `targetType` | enum | ✓ | LISTING · PROFILE |
| | `listingId` | ref Listing | ✗ | required when targetType = LISTING |
| | `targetUserId` | ref User | ✗ | required when targetType = PROFILE |
| | `reason` | string | ✓ | 10–2000 characters |
| | `createdAt` | datetime | ✓ | server-set |
| **ReviewCase** | `id` | UUID v4 | ✓ | generated, server-side |
| | `reportId` | ref Report | ✓ | unique — one case per report |
| | `status` | enum | ✓ | OPEN · UNDER_REVIEW · RESOLVED |
| | `resolution` | string | ✗ | required when resolved |
| | `resolvedById` | ref User | ✗ | reviewer who decided |
| | `createdAt` / `resolvedAt` | datetime | ✓ / ✗ | / |

**Identifier strategy:** every primary key is `String @id @default(uuid())` —
a server-generated UUID v4 (random 128-bit), never a sequential integer, never
client-supplied, not enumerable. Foreign relations point at the target resource's
`id`; there is no separate numbering.

**Relationships (one page):**
- `User` (applicant) **1—N** `VerificationRequest`; a reviewer `User` **1—N**
  decided requests via `reviewedById`.
- `User` (owner profile) **1—N** `Listing` through exactly one of
  `agentId` / `agencyId` / `landlordId`.
- `User` (seeker, reporter) **1—N** `Report`.
- `Listing` **1—N** `ListingImage`; `Listing` **1—N** `Report`.
- `Report` **1—0..1** `ReviewCase`; a resolved `ReviewCase` may move the target
  listing to `SUSPENDED`.

This structure is sufficient for the later REST API requirements: verification
submit/approve/reject, listing create/approve/search/detail, report filing, and
the review queue/resolve flow each map to one resource's explicit transition.

## Stack

- Next.js 16 (App Router) — no Pages Router, no `src/` layout re-export accidents
- TypeScript strict, no `any`
- PostgreSQL 16 through Prisma 6.19 (pinned: the PRD Section 10 schema uses the
  `prisma-client-js` generator, which Prisma 7 removed)
- Vitest for unit/integration tests
- Argon2id password hashing (`@node-rs/argon2`), HS256 JWT session cookies (`jose`)

## Setup

```sh
npm install
```

Copy `.env.example` to `.env` and set:

| Var | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres URL for local dev (`postgresql://user:pass@host:port/domora_dev`) |
| `DATABASE_URL_TEST` | Postgres URL for tests (use a throwaway DB, e.g. `/domora_test`) |
| `SESSION_SECRET` | >= 32 random bytes of hex |
| `PSQL_BIN` | full path to `psql.exe` if it isn't on PATH |
| `STORAGE_BUCKET`, `STORAGE_BUCKET_DOCUMENTS` | storage provider keys (unset = fail closed) |
| `GEOCODING_PROVIDER` | geocoding provider key (unset = fail closed) |
| `APP_ORIGIN` | allowed origin for state-changing requests (default `http://localhost:3000`) |

Then:

```sh
npx prisma migrate dev    # create/migrate the dev DB
npx prisma db seed        # deterministic Phase 1 seed rows
npm run dev
```

Run all gates: `npm run typecheck`, `npm run test`, `npm run build`.

## Layout

- `/app` — routes + Server Components only (route handlers call `/modules`)
  - `/app/api/v1/*` — thin, versioned handlers (no business rules here)
  - `/app/(seeker)`, `/(provider)`, `/(reviewer)`, `/(admin)` — route groups
- `/modules` — ALL business logic, by domain (identity, verification,
  affiliations, listings, reports, audit, notifications, billing[empty at MVP])
- `/lib` — cross-cutting utilities only (db, storage, geocoding, auth, http,
  errors, validate). `/lib` never imports `/modules`.
- `/prisma/schema.prisma` — locked schema, ported verbatim from PRD Section 10
- `/tests` — per-module business-rule tests

Every state transition is an explicit, audited, transaction-guarded function
(e.g. `approveVerification`, `approveListing`, `resolveReviewCase`). Route
handlers never decide what is allowed; they call `/modules` and return results.

Non-negotiable rules enforced in code (full list in `AGENTS.md`): no listing
without approved verification, no auto-approval, no self-attach to an agency,
no silent rejection, separate account-verification and listing-approval gates,
listings with open reports stay visible, no auto-suspension, resolutions are
written before/with a suspension, no editing of decided records, append-only
audit log, server-side prices only, 403 (never a filtered result) for role
denials, money stored as integers, no AI, no Flutterwave until Phase 3.

Seed is idempotent (re-runs wipe and rebuild identical data) and DB-13
compliant. `prisma/seed.ts` (Faker-11, deterministic) creates the Step-1
resource volumes: 454 users (150 seekers, 100 agents, 100 agency admins, 100
landlords, 3 reviewers, 1 super admin), 300 PENDING verification requests,
400 PENDING_REVIEW listings with 800 images, 1250 reports, and 400 review
cases. No APPROVED verification and no ACTIVE listing is ever seeded;
`hasOpenReports` and ReviewCase creation run through the real report module
so thresholds and derived fields stay single-writer. All names, emails
(`*.seed.domora.invalid`), and content are synthetic; document/image keys are
opaque paths, never real objects.

## API (Phase 1)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/verification-requests` | submit verification (agent/agency/landlord) |
| `GET /api/v1/verification-requests` | reviewer: pending queue |
| `POST /api/v1/verification-requests/:id/approve` | reviewer gates account |
| `POST /api/v1/verification-requests/:id/reject` | reviewer rejects (note required) |
| `GET /api/v1/verification-requests/:id/document-url` | short-lived pre-signed doc URL |
| `POST /api/v1/agency-affiliations` | agent requests roster membership |
| `POST /api/v1/agency-affiliations/:id/accept` | agency admin accepts |
| `POST /api/v1/agency-affiliations/:id/reject` | agency admin rejects |
| `POST /api/v1/listings` | create listing (PENDING_REVIEW) |
| `GET /api/v1/listings` | search active listings |
| `GET /api/v1/listings/:id` | listing detail (visibility-gated) |
| `POST /api/v1/listings/:id` | reviewer approves listing |
| `POST /api/v1/reports` | seeker files a report |
| `GET /api/v1/review-queue` | reviewer: open cases |
| `POST /api/v1/review-cases/:id/resolve` | reviewer resolves (may suspend listing) |

All state-changing requests require an allowed `Origin` header (SEC-9) and a
session cookie. There is intentionally no public signup/login endpoint and no
way for a public path to create `PLATFORM_REVIEWER` or `SUPER_ADMIN` accounts.

## Open items (recorded, not silently decided)

- **Auth mechanism**: PRD names none and `country`/login flows are unaddressed.
  We use HttpOnly SameSite=Lax HS256 session cookies with a regenerated session
  id per login; that is a working assumption until Section 14 resolves it.
- **Storage provider** and **geocoding provider** are unnamed in the PRD; both
  seams fail closed until named. Tests inject fakes.
- **Prisma 6.19 pinned** because PRD Section 10 locks `prisma-client-js`;
  TypeScript 5.9 pinned over 7.x (native compiler) for ecosystem stability.
- **Launch country** (PRD Open Question 6) is unset; fields are nullable.
- Profile rows are created with the account; `ipAddress` on audit defaults to
  "internal" until a trusted-proxy config lands (SEC-13).
- The dev machine needs a reachable PostgreSQL for migrate/seed/tests; the
  bundled `.env` points at a local scratch cluster.