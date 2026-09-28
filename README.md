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
| `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS` | optional overrides for the per-IP rate limiter (Step 5 defaults: 100 / 60s) |
| `WORKER_CONCURRENCY` / `WORKER_POLL_INTERVAL_MS` / `WORKER_LEASE_MS` / `WORKER_MAX_ATTEMPTS` / `WORKER_RETRY_BASE_MS` / `WORKER_RETRY_MAX_MS` | optional overrides for the delivery worker (Step 3 defaults: 5 / 2000 / 60000 / 5 / 1000 / 300000) — see §The delivery worker |

Then:

```sh
npx prisma migrate dev    # create/migrate the dev DB
npx prisma db seed        # deterministic Phase 1 seed rows
npm run dev
npm run worker            # the delivery worker, a separate process
```

Run all gates: `npm run typecheck`, `npm run test`, `npm run build`.

## Layout

- `/app` — routes + Server Components only (route handlers call `/modules`)
  - `/app/api/v1/*` — thin, versioned handlers (no business rules here)
  - `/app/(seeker)`, `/(provider)`, `/(reviewer)`, `/(admin)` — route groups
- `/modules` — ALL business logic, by domain (identity, verification,
  affiliations, listings, reports, audit, notifications [delivery + job queue],
  billing[empty at MVP])
- `/lib` — cross-cutting utilities only (db, storage, geocoding, auth, http,
  errors, schemas, worker config + concurrency pool). `/lib` never imports
  `/modules`.
- `/worker` — the delivery worker process: the tick (`pump.ts`) and the loop
  (`index.ts`). Scheduling only; every decision it makes is a `/modules` call
- `/prisma/schema.prisma` — locked schema, ported verbatim from PRD Section 10
- `/tests` — per-module business-rule tests (`unit`) and cross-module route
  tests (`integration`, every endpoint over real handlers)

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

## API reference

The public API is versioned and served from `/api/v1` (default base URL
`http://localhost:3000/api/v1`). It has **19 endpoints** across four resources
plus the reviewer queue. Every endpoint is exercised end-to-end in
`tests/integration/api.test.ts`.

Signed-off session cookie: **`Authentication`** is a signed session cookie.

### Authentication

Every endpoint requires a valid session. No public signup/login route exists at
Phase 1 (the PRD names no auth mechanism — see Open items); sessions are the
same cookie all mutation endpoints check.

| Attribute | Value |
| --- | --- |
| Cookie name | `domora_session` |
| Value | HS256 JWT signed with `SESSION_SECRET`, payload `{ userId, role, jti }` |
| Liveness | 7 days from issue (`SESSION_MAX_AGE_SECONDS` = 7 days) |
| Flags | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production |

Send it like any cookie: `-b "domora_session=<token>"`. A missing, expired, or
tampered token is a `401 UNAUTHORIZED`.

For local development, mint a token for a seeded user with `createSession()` in
`lib/auth.ts` (the exact call the integration tests use):

```ts
import { createSession } from "@/lib/auth";
const token = await createSession({ userId: "<uuid>", role: "PLATFORM_REVIEWER" }, tokenId);
// set the cookie: domora_session=<token>
```

**Origin / CSRF header:** every non-`GET`/`HEAD` request must also send an
`Origin` header equal to `APP_ORIGIN` (default `http://localhost:3000`). A
missing or mismatched origin is `403 FORBIDDEN "Untrusted request origin"`
(SEC-9). All curl examples below include it.

### Response & error envelopes

Every successful response is **HTTP 200** — creates, actions, and approvals
included — with the result resource under `data`; there is no 201/204 special
casing so a client handles one status for success.

```json
{ "data": { "id": "a3f1c2d4-9b8e-4a7f-8c3d-5e6f7a8b9c0d", "status": "APPROVED" } }
```

Every **list** response adds `meta` with exactly four keys:

```json
{
  "data": [],
  "meta": { "total": 340, "limit": 20, "offset": 0, "hasMore": true }
}
```

- `total` — number of rows matching the filter (not the page size)
- `limit` / `offset` — the page actually applied (`limit` reflects clamping)
- `hasMore` — `offset + items.length < total`

Every error is `{ "error": { "code", "message" } }` with an honest HTTP status:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | malformed JSON, invalid query parameter, or malformed path id (not a UUID) |
| 401 | `UNAUTHORIZED` | missing/invalid session |
| 403 | `FORBIDDEN` | role/ownership denial — never a filtered result (PR-ADM-001) |
| 404 | `NOT_FOUND` | unknown resource id |
| 409 | `CONFLICT` | illegal state transition (e.g. already-decided record, DB-6) |
| 422 | `VALIDATION_ERROR` | body failed server-side schema validation |
| 429 | `RATE_LIMITED` | per-IP rate limit spent (Step 5); carries `Retry-After` |
| 500 | `INTERNAL_ERROR` | fail-closed seam (storage/geocoding) or unexpected fault |

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "An approved verification is required before creating listings (PR-VER-001)"
  }
}
```

Request bodies and responses are `application/json`.

### Rate limiting (Step 5)

Every `/api/v1` request is counted against a per-IP fixed window **before**
authentication is resolved, so unauthenticated abuse is throttled too. The
numbers live in `lib/rate-limit/config.ts` — never in a handler or route file:

| Setting | Env override | Default |
| --- | --- | --- |
| Max requests per window | `RATE_LIMIT_MAX_REQUESTS` | `100` |
| Window length (seconds) | `RATE_LIMIT_WINDOW_SECONDS` | `60` |

Once a client's budget is spent, requests return `429 RATE_LIMITED` with a
`Retry-After` header naming the seconds until the window rolls over. The client
address is the left-most value of `X-Forwarded-For` (requests with no such
header share one `unknown` bucket). Different IPs get independent budgets. The
store is in-memory — per serverless instance — which is fine at MVP volume
(hundreds to low thousands of rows/week); a shared distributed counter is an
open item for a later phase.

### Validation (single source, Step 4)

Every request body, query parameter, and path identifier is validated by a zod
schema in `lib/schemas.ts` — routes call `parseBody` / `parseQuery` /
`parseId` and never hand-roll checks. Modules keep their business-rule asserts
as defense in depth.

| Input | Result |
| --- | --- |
| `limit` larger than the configured max (100) | **clamped** to 100 (a `limit=5000` is never honoured) |
| `limit` of 0 / negative / non-numeric | 400 |
| negative `offset` | 400, message names `offset` |
| unknown `sort` value | 400, message names the allowed values (never silently ignored) |
| malformed path id (not a UUID) | 400 (ids are `String @default(uuid())` in the locked schema) |
| well-formed but unknown id | 404 |
| missing/invalid required body field | 422, message names the field (e.g. `Field "price" is required`) |
| malformed JSON | 400 |

### Common list parameters

Applies to `GET` collection endpoints (`/verification-requests`,
`/listings`, `/reports`, `/review-queue`). Endpoint-specific filters are listed
on each endpoint. Unknown query parameters are ignored.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `limit` | integer | `20` | ≥ 1; anything above 100 is clamped to `100`; 0/negative/non-integer → 400 |
| `offset` | integer | `0` | ≥ 0; negative → 400 |
| `sort` | string enum | per endpoint | invalid value → 400 naming the allowed values |
| `order` | `asc` \| `desc` | `desc` (`asc` on `/review-queue`) | |

### Endpoint index

| # | Method | Path | Access summary |
| --- | --- | --- | --- |
| 1 | `POST` | `/verification-requests` | AGENT · AGENCY_ADMIN · LANDLORD |
| 2 | `GET` | `/verification-requests` | reviewers (all) · applicants (own) |
| 3 | `GET` | `/verification-requests/{id}` | applicant owner · reviewer |
| 4 | `POST` | `/verification-requests/{id}/approve` | PLATFORM_REVIEWER |
| 5 | `POST` | `/verification-requests/{id}/reject` | PLATFORM_REVIEWER |
| 6 | `GET` | `/verification-requests/{id}/document-url` | applicant owner · reviewer |
| 7 | `POST` | `/agency-affiliations` | AGENT |
| 8 | `POST` | `/agency-affiliations/{id}/accept` | AGENCY_ADMIN (own agency) |
| 9 | `POST` | `/agency-affiliations/{id}/reject` | AGENCY_ADMIN (own agency) |
| 10 | `POST` | `/listings` | AGENT · AGENCY_ADMIN · LANDLORD (verified) |
| 11 | `GET` | `/listings` | VIEW_ANY_LISTING roles (see §11) |
| 12 | `GET` | `/listings/{id}` | public (ACTIVE) / owner / reviewer |
| 13 | `POST` | `/listings/{id}/approve` | PLATFORM_REVIEWER |
| 14 | `POST` | `/reports` | SEEKER |
| 15 | `GET` | `/reports` | seeker (own) · reviewer (all) |
| 16 | `GET` | `/reports/{id}` | reporter · reviewer |
| 17 | `GET` | `/review-queue` | PLATFORM_REVIEWER |
| 18 | `GET` | `/review-cases/{id}` | PLATFORM_REVIEWER |
| 19 | `POST` | `/review-cases/{id}/resolve` | PLATFORM_REVIEWER |

---

### 1. `POST /api/v1/verification-requests`

Submit a verification request. The account role cannot change here — only
`AGENT`, `AGENCY_ADMIN`, or `LANDLORD` may apply (PR-VER-001); the request
starts `PENDING`.

**Query parameters:** none.

**Request body:**

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `documentKey` | string | ✓ | must start with `docs/` and the object must already exist in storage (UP-9); it is never returned |

**Example:**

```bash
curl -sS -X POST http://localhost:3000/api/v1/verification-requests \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -b "domora_session=$SESSION" \
  -d '{"documentKey": "docs/licenses/agent-57e1c9.pdf"}'
```

**Response `200`:** the new request (`documentKey` is never exposed, SEC-6).

```json
{
  "data": {
    "id": "a3f1c2d4-9b8e-4a7f-8c3d-5e6f7a8b9c0d",
    "userId": "cafe1234-abcd-4ef0-8123-456789abcdef",
    "status": "PENDING",
    "reviewNote": null,
    "reviewedById": null,
    "createdAt": "2026-09-23T09:00:00.000Z",
    "reviewedAt": null
  }
}
```

**Errors:** `401`; `403` (role); `422` (missing documentKey); `500` (storage seam).

---

### 2. `GET /api/v1/verification-requests`

List verification requests. Reviewers (`PLATFORM_REVIEWER`, `SUPER_ADMIN`) see
every submission; an applicant sees only their own. Any other role → `403`.

**Query parameters** (plus the common four):

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `sort` | `createdAt` \| `reviewedAt` | `createdAt` | |
| `status` | `PENDING` \| `APPROVED` \| `REJECTED` | — | |
| `userId` | UUID | — | reviewer-only filter; an applicant passing someone else's id → `403` |

**Example:**

```bash
curl -sS "http://localhost:3000/api/v1/verification-requests?status=PENDING&limit=5&offset=0&order=desc" \
  -b "domora_session=$SESSION"
```

**Response `200`:**

```json
{
  "data": [
    {
      "id": "a3f1c2d4-9b8e-4a7f-8c3d-5e6f7a8b9c0d",
      "userId": "cafe1234-abcd-4ef0-8123-456789abcdef",
      "status": "PENDING",
      "reviewNote": null,
      "reviewedById": null,
      "createdAt": "2026-09-23T09:00:00.000Z",
      "reviewedAt": null
    }
  ],
  "meta": { "total": 1, "limit": 5, "offset": 0, "hasMore": false }
}
```

**Errors:** `401`; `403`; `400` (bad query parameter).

---

### 3. `GET /api/v1/verification-requests/{id}`

Detail of one request. Accessible to the applicant who owns it or to
`PLATFORM_REVIEWER` / `SUPER_ADMIN`.

**Query parameters:** none. **Path parameter:** `id` (UUID).

**Example:**

```bash
curl -sS http://localhost:3000/api/v1/verification-requests/a3f1c2d4-9b8e-4a7f-8c3d-5e6f7a8b9c0d \
  -b "domora_session=$SESSION"
```

**Response `200`:** same shape as §2 items.

```json
{
  "data": {
    "id": "a3f1c2d4-9b8e-4a7f-8c3d-5e6f7a8b9c0d",
    "userId": "cafe1234-abcd-4ef0-8123-456789abcdef",
    "status": "APPROVED",
    "reviewNote": null,
    "reviewedById": "36363636-2222-4222-8222-111122223333",
    "createdAt": "2026-09-23T09:00:00.000Z",
    "reviewedAt": "2026-09-23T09:10:00.000Z"
  }
}
```

**Errors:** `400` (malformed id); `401`; `403` (not the owner, not a reviewer); `404`.

---

### 4. `POST /api/v1/verification-requests/{id}/approve`

Reviewer approves a request (PR-VER-002 — no other code path can set
`APPROVED`). Flips the applicant's profile `verificationStatus` to `APPROVED`,
writes the audit log, and queues a notification.

**Query parameters:** none. **Body:** none.

**Access:** `PLATFORM_REVIEWER` only.

**Example:**

```bash
curl -sS -X POST http://localhost:3000/api/v1/verification-requests/a3f1c2d4-9b8e-4a7f-8c3d-5e6f7a8b9c0d/approve \
  -H 'Origin: http://localhost:3000' \
  -b "domora_session=$SESSION"
```

**Response `200`:** the decided request (status `APPROVED`, `reviewedById` and
`reviewedAt` set).

**Errors:** `401`; `403` (non-reviewer); `400` (malformed id); `404`;
`409 CONFLICT` — already decided (DB-6, no in-place edits).

---

### 5. `POST /api/v1/verification-requests/{id}/reject`

Reviewer rejects a request (PR-VER-004 — a rejection can never be silent).

**Query parameters:** none.

**Request body:**

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `reviewNote` | string | ✓ | persisted reason; missing/blank → `422` |

**Access:** `PLATFORM_REVIEWER` only.

**Example:**

```bash
curl -sS -X POST http://localhost:3000/api/v1/verification-requests/a3f1c2d4-9b8e-4a7f-8c3d-5e6f7a8b9c0d/reject \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -b "domora_session=$SESSION" \
  -d '{"reviewNote": "Identity document is expired."}'
```

**Response `200`:** the decided request (status `REJECTED`, `reviewNote` filled).

**Errors:** `401`; `403`; `400`; `404`; `409` (already decided); `422` (missing reviewNote).

---

### 6. `GET /api/v1/verification-requests/{id}/document-url`

Short-lived, pre-signed URL for the applicant's verification document (SEC-6 /
Technical Requirements). Only the owning applicant or a reviewer can fetch it;
the expiry is short and the URL is never stored or cached.

**Query parameters:** none. **Path parameter:** `id` (UUID).

**Example:**

```bash
curl -sS http://localhost:3000/api/v1/verification-requests/a3f1c2d4-9b8e-4a7f-8c3d-5e6f7a8b9c0d/document-url \
  -b "domora_session=$SESSION"
```

**Response `200`:**

```json
{
  "data": {
    "url": "https://storage.example/domora-docs/licenses/agent-57e1c9.pdf?X-Amz-Expires=300&X-Amz-Signature=..."
  }
}
```

**Errors:** `400`; `401`; `403` (not owner/reviewer); `404`.

---

### 7. `POST /api/v1/agency-affiliations`

An agent requests to join an agency's roster (PR-VER-003 — only the agency side
can ever set `AgentProfile.agencyId`).

**Query parameters:** none.

**Request body:**

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `agentId` | UUID | ✓ | must equal the caller's own `AgentProfile.id`, else `403` |
| `agencyId` | UUID | ✓ | must exist, else `404` |

**Access:** `AGENT` only.

**Example:**

```bash
curl -sS -X POST http://localhost:3000/api/v1/agency-affiliations \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -b "domora_session=$SESSION" \
  -d '{"agentId": "5555cccc-4444-4333-8222-111100009999", "agencyId": "6666dddd-5555-4444-8333-222211110000"}'
```

**Response `200`:**

```json
{
  "data": {
    "id": "7777bbbb-6666-4555-8444-333322221111",
    "agentId": "5555cccc-4444-4333-8222-111100009999",
    "agencyId": "6666dddd-5555-4444-8333-222211110000",
    "status": "PENDING",
    "createdAt": "2026-09-23T09:05:00.000Z",
    "resolvedAt": null
  }
}
```

**Errors:** `401`; `403` (role, or a `agentId` that is not the caller's own
profile); `404` (agency); `409` (a `PENDING`/`ACCEPTED` affiliation already
exists between the two); `422` (missing/invalid body).

---

### 8. `POST /api/v1/agency-affiliations/{id}/accept`

Agency admin accepts a pending request. This is the **only** writer of
`AgentProfile.agencyId` (DB-8): accepting makes the agent part of the roster.

**Query parameters:** none. **Body:** none.

**Access:** `AGENCY_ADMIN` who administers the affiliation's agency (else `403`).

**Example:**

```bash
curl -sS -X POST http://localhost:3000/api/v1/agency-affiliations/7777bbbb-6666-4555-8444-333322221111/accept \
  -H 'Origin: http://localhost:3000' \
  -b "domora_session=$SESSION"
```

**Response `200`:** the affiliation (status `ACCEPTED`, `resolvedAt` set).

**Errors:** `401`; `403` (non-admin, or not this agency's admin); `400`;
`404`; `409` (already decided).

---

### 9. `POST /api/v1/agency-affiliations/{id}/reject`

Agency admin rejects a pending request. Same access and guards as `accept`;
the agent is not added to the roster.

**Query parameters:** none. **Body:** none.

**Example:**

```bash
curl -sS -X POST http://localhost:3000/api/v1/agency-affiliations/7777bbbb-6666-4555-8444-333322221111/reject \
  -H 'Origin: http://localhost:3000' \
  -b "domora_session=$SESSION"
```

**Response `200`:** the affiliation (status `REJECTED`, `resolvedAt` set).

**Errors:** same as §8.

---

### 10. `POST /api/v1/listings`

Create a listing. Two gates, intentionally separate: the account must be a
verifiable role **and** its verification must be `APPROVED` (PR-VER-001, checked
at the data layer). A listing is **never** created `ACTIVE` — it enters
`PENDING_REVIEW` and waits for a reviewer (PR-LST-002).

**Query parameters:** none.

**Request body:**

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `title` | string | ✓ | 3–200 characters |
| `price` | integer | ✓ | positive whole number in the smallest currency unit (never a decimal/float) |
| `address` | string | ✓ | geo-coded from here when lat/lng are omitted |
| `propertyType` | `APARTMENT` \| `HOUSE` \| `DUPLEX` \| `LAND` \| `COMMERCIAL` \| `OTHER` | ✓ | |
| `images` | string[] | ✓ | ≥ 1 opaque key; each must start with `images/` and exist in storage (UP-9) |
| `country` | string | ✗ | stored as-is; used by the search filter |
| `latitude` | number | ✗ | −90..90; stored verbatim if both lat+lng given |
| `longitude` | number | ✗ | −180..180; the only live maps call (geocoding) runs at creation |

**Example:**

```bash
curl -sS -X POST http://localhost:3000/api/v1/listings \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -b "domora_session=$SESSION" \
  -d '{
        "title": "2-bed flat in Ikoyi",
        "price": 1500000,
        "address": "12 Bourdillon Road, Ikoyi",
        "country": "NG",
        "propertyType": "APARTMENT",
        "images": ["images/listings/58f1a9ab-11ed-4d33-9a21-1c2d3e4f5a6b.jpeg"],
        "latitude": 6.4482,
        "longitude": 3.4355
      }'
```

**Response `200`:** the listing, created `PENDING_REVIEW`. `images` returns
id/uploadedAt only — storage keys are never exposed.

```json
{
  "data": {
    "id": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80",
    "title": "2-bed flat in Ikoyi",
    "price": 1500000,
    "address": "12 Bourdillon Road, Ikoyi",
    "latitude": 6.4482,
    "longitude": 3.4355,
    "country": "NG",
    "propertyType": "APARTMENT",
    "status": "PENDING_REVIEW",
    "hasOpenReports": false,
    "createdAt": "2026-09-23T10:00:00.000Z",
    "images": [
      { "id": "58f1a9ab-11ed-4d33-9a21-1c2d3e4f5a6b", "uploadedAt": "2026-09-23T09:59:00.000Z" }
    ]
  }
}
```

**Errors:** `401`; `403` (role, or "An approved verification is required before
creating listings"); `422`; `500` (geocoding/storage seam blocks).

---

### 11. `GET /api/v1/listings`

Search and page listings. Default is a public search over **`ACTIVE`** listings
only; a listing with open reports **stays visible** (PR-LST-003) — nothing
filters on report count.

**Query parameters** (plus the common four):

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `sort` | `createdAt` \| `price` \| `title` | `createdAt` | |
| `propertyType` | enum (as §10) | — | exact match |
| `status` | `DRAFT` \| `PENDING_REVIEW` \| `ACTIVE` \| `SUSPENDED` | `ACTIVE` | absent or `ACTIVE` → public search; any **other** status requires `PLATFORM_REVIEWER`/`SUPER_ADMIN` or the owning profile, else `403` (never a silent downgrade) |
| `country` | string | — | exact match on stored value |
| `minPrice` | integer ≥ 0 | — | price filter (smallest currency unit) |
| `maxPrice` | integer ≥ 0 | — | |
| `latitude` | number (−90..90) | — | proximity needs **both** lat+lng |
| `longitude` | number (−180..180) | — | |
| `radiusKm` | number ≥ 0.1 | `5`, capped at `50` | applies only when lat+lng are both present; range scan on stored coordinates, no live maps call |

**Access:** `VIEW_ANY_LISTING` = SEEKER · AGENT · AGENCY_ADMIN · LANDLORD ·
PLATFORM_REVIEWER. Note: `SUPER_ADMIN` is **not** in that permission — a super
admin gets `403` here (PR-ADM-001 matrix, never a filtered result).

**Example:**

```bash
curl -sS "http://localhost:3000/api/v1/listings?propertyType=APARTMENT&country=NG&minPrice=1000000&maxPrice=3000000&sort=price&order=asc&limit=10&offset=0" \
  -b "domora_session=$SESSION"
```

**Response `200`:**

```json
{
  "data": [
    {
      "id": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80",
      "title": "2-bed flat in Ikoyi",
      "price": 1500000,
      "address": "12 Bourdillon Road, Ikoyi",
      "latitude": 6.4482,
      "longitude": 3.4355,
      "country": "NG",
      "propertyType": "APARTMENT",
      "status": "ACTIVE",
      "hasOpenReports": false,
      "createdAt": "2026-09-23T10:00:00.000Z",
      "images": [{ "id": "58f1a9ab-11ed-4d33-9a21-1c2d3e4f5a6b", "uploadedAt": "2026-09-23T09:59:00.000Z" }]
    }
  ],
  "meta": { "total": 1, "limit": 10, "offset": 0, "hasMore": false }
}
```

**Errors:** `401`; `403` (role, or a non-active status filter without reviewer
scope/ownership); `400` (bad parameter, e.g. `radiusKm` < 0.1).

---

### 12. `GET /api/v1/listings/{id}`

Single listing detail. An `ACTIVE` listing is public; any other status is
visible only to reviewers or the listing's own owner side — otherwise `403`
(UP-4). `SUPER_ADMIN` is not in `VIEW_ANY_LISTING` → 403.

**Query parameters:** none. **Path parameter:** `id` (UUID).

**Example:**

```bash
curl -sS http://localhost:3000/api/v1/listings/d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80 \
  -b "domora_session=$SESSION"
```

**Response `200`:** same shape as §11 items.

**Errors:** `400`; `401`; `403`; `404`.

---

### 13. `POST /api/v1/listings/{id}/approve`

Platform reviewer moves a `PENDING_REVIEW` listing to `ACTIVE` (PR-LST-002).
This is a **separate gate** from account verification — account approval alone
never activates a listing.

**Query parameters:** none. **Body:** none.

**Access:** `PLATFORM_REVIEWER` only.

**Example:**

```bash
curl -sS -X POST http://localhost:3000/api/v1/listings/d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80/approve \
  -H 'Origin: http://localhost:3000' \
  -b "domora_session=$SESSION"
```

**Response `200`:** the listing with `status: "ACTIVE"`.

**Errors:** `401`; `403`; `400`; `404`; `409` (cannot reach `ACTIVE` from its
current status — e.g. already approved or suspended).

---

### 14. `POST /api/v1/reports`

A seeker files a report against a listing or an account (PR-REP-001 / PR-BOK-003:
every report enters the same review queue — there is no private resolution
path). Reaching 3+ open reports on the same target inside the rolling 30-day
window creates a `ReviewCase` in the queue (PR-REP-002) — it never
auto-suspends anything.

**Query parameters:** none.

**Request body:**

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `targetType` | `LISTING` \| `PROFILE` | ✓ | |
| `listingId` | UUID | when `LISTING` | required iff `targetType=LISTING` |
| `targetUserId` | UUID | when `PROFILE` | required iff `targetType=PROFILE` |
| `reason` | string | ✓ | 10–2000 characters |

**Access:** `SEEKER` only.

**Example:**

```bash
curl -sS -X POST http://localhost:3000/api/v1/reports \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -b "domora_session=$SESSION" \
  -d '{
        "targetType": "LISTING",
        "listingId": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80",
        "reason": "The listing photos do not match the unit shown at inspection."
      }'
```

**Response `200`:**

```json
{
  "data": {
    "report": {
      "id": "1111aaaa-2222-4333-8444-555566667777",
      "reporterId": "cafe1234-abcd-4ef0-8123-456789abcdef",
      "targetType": "LISTING",
      "listingId": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80",
      "targetUserId": null,
      "reason": "The listing photos do not match the unit shown at inspection.",
      "createdAt": "2026-09-23T11:00:00.000Z"
    },
    "reviewCaseId": null
  }
}
```

`reviewCaseId` is non-null when this report pushed the target over the
threshold and a case was opened.

**Errors:** `401`; `403` (non-seeker); `404` (target not found); `422` (missing
field, short reason, `listingId` on a `PROFILE` report etc.).

---

### 15. `GET /api/v1/reports`

List reports: a reviewer sees everything; a seeker sees only their own.

**Query parameters** (plus the common four):

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `sort` | `createdAt` | `createdAt` | the only sortable field |
| `targetType` | `LISTING` \| `PROFILE` | — | |
| `reporterId` | UUID | — | reviewer-only filter; a seeker passing someone else's id → `403` |
| `resolved` | `true` \| `false` (string) | — | `true` = the report's case is `RESOLVED`; `false` = open (no case, or case not resolved) |

**Example:**

```bash
curl -sS "http://localhost:3000/api/v1/reports?resolved=false&targetType=LISTING&limit=20&offset=0" \
  -b "domora_session=$SESSION"
```

**Response `200`:** `data` of report items (§14 shape, without the
`reviewCaseId` wrapper) plus `meta`.

**Errors:** `401`; `403`; `400`.

---

### 16. `GET /api/v1/reports/{id}`

Single report. Accessible to the reporting seeker or a reviewer.

**Query parameters:** none. **Path parameter:** `id` (UUID).

**Example:**

```bash
curl -sS http://localhost:3000/api/v1/reports/1111aaaa-2222-4333-8444-555566667777 \
  -b "domora_session=$SESSION"
```

**Response `200`:** the report item (§14 `report` shape).

**Errors:** `400`; `401`; `403`; `404`.

---

### 17. `GET /api/v1/review-queue`

The reviewer's queue. Defaults to unresolved cases (`OPEN` + `UNDER_REVIEW`)
in FIFO order (oldest first). Includes the underlying report's context.

**Query parameters** (plus the common four):

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `sort` | `createdAt` | `createdAt` | the only sortable field |
| `order` | `asc` \| `desc` | `asc` | FIFO — the queue is oldest-first |
| `status` | `OPEN` \| `UNDER_REVIEW` \| `RESOLVED` | open cases | absent → only non-resolved cases |
| `targetType` | `LISTING` \| `PROFILE` | — | |

**Access:** `PLATFORM_REVIEWER` only (`SUPER_ADMIN` → `403`).

**Example:**

```bash
curl -sS "http://localhost:3000/api/v1/review-queue?status=OPEN&targetType=LISTING&limit=10&offset=0" \
  -b "domora_session=$SESSION"
```

**Response `200`:**

```json
{
  "data": [
    {
      "id": "9999eeee-8888-4777-8666-555544443333",
      "reportId": "1111aaaa-2222-4333-8444-555566667777",
      "status": "OPEN",
      "resolution": null,
      "resolvedById": null,
      "createdAt": "2026-09-23T11:00:00.000Z",
      "resolvedAt": null,
      "targetType": "LISTING",
      "listingId": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80",
      "targetUserId": null,
      "reason": "The listing photos do not match the unit shown at inspection."
    }
  ],
  "meta": { "total": 1, "limit": 10, "offset": 0, "hasMore": false }
}
```

**Errors:** `401`; `403`; `400`.

---

### 18. `GET /api/v1/review-cases/{id}`

One review case (same expanded shape as §17 items).

**Query parameters:** none. **Path parameter:** `id` (UUID).

**Access:** `PLATFORM_REVIEWER` only.

**Example:**

```bash
curl -sS http://localhost:3000/api/v1/review-cases/9999eeee-8888-4777-8666-555544443333 \
  -b "domora_session=$SESSION"
```

**Response `200`:** the case item (§17 shape).

**Errors:** `400`; `401`; `403`; `404`.

---

### 19. `POST /api/v1/review-cases/{id}/resolve`

Resolve a review case (PR-REP-003). The resolution record is authoritative and
is never edited afterwards (DB-6) — a correction is a new case. When
`action=SUSPEND_LISTING`, the suspension is applied **in the same transaction**
as the resolution record (Q3#11).

**Query parameters:** none.

**Request body:**

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `resolution` | string | ✓ | the reviewer's decision; missing/blank → `422` |
| `action` | `NONE` \| `SUSPEND_LISTING` | optional (default `NONE`) | `SUSPEND_LISTING` requires the case report to target a listing, else `422`; account suspension is out of scope until the PRD defines it |

**Access:** `PLATFORM_REVIEWER` only.

**Example:**

```bash
curl -sS -X POST http://localhost:3000/api/v1/review-cases/9999eeee-8888-4777-8666-555544443333/resolve \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -b "domora_session=$SESSION" \
  -d '{"resolution": "Misrepresentation confirmed; listing suspended.", "action": "SUSPEND_LISTING"}'
```

**Response `200`:** the resolved case (case fields only).

```json
{
  "data": {
    "id": "9999eeee-8888-4777-8666-555544443333",
    "reportId": "1111aaaa-2222-4333-8444-555566667777",
    "status": "RESOLVED",
    "resolution": "Misrepresentation confirmed; listing suspended.",
    "resolvedById": "36363636-2222-4222-8222-111122223333",
    "createdAt": "2026-09-23T11:00:00.000Z",
    "resolvedAt": "2026-09-23T12:30:00.000Z"
  }
}
```

**Errors:** `401`; `403`; `400`; `404`; `409` (already resolved); `422`
(missing resolution, or `SUSPEND_LISTING` on a non-listing case).

---

### Idempotent notification delivery (PR-NOT)

Background work is idempotent by construction. `modules/notifications/deliver.ts`:

1. **The output is keyed by the job id.** The deliverable (a rendered message
   artifact) is stored in `NotificationDelivery`, whose primary key
   **is `notificationId`** — the `Notification` row (the job) owns its output.
2. **Check-before-produce.** Before touching the messenger, the worker
   re-checks whether that keyed output already exists or the job is already
   finished (`sentAt`); if so it skips production entirely.
3. **Produce-then-ack.** The job is stamped `sentAt` (the durable "succeeded"
   marker) only after the output is recorded, via a guarded
   `UPDATE ... WHERE id = ? AND sentAt IS NULL`.

A crash between send and ack leaves the keyed output behind; the retry finds it,
produces **nothing new**, and only finishes the job. Template variables are
persisted on the `Notification` row (`vars`, PR-NOT-002) so a late delivery
still renders the exact approved message.

## The delivery worker (Step 3)

A `Notification` row is the MVP's only unit of background work, so it is also
the only job. The worker is a **separate process** from the Next.js app
(`worker/`), and it is the production path for background work — the loop
replaces the in-process `flushPendingNotifications` pump, which stays for
scripts and tests.

```sh
npm run worker              # loop until stopped
npm run worker -- --once    # one tick, for a cron-style deployment
```

Each tick is: claim what is due → do the work → settle each job as succeeded or
failed. The loop sleeps `WORKER_POLL_INTERVAL_MS` after a tick that claimed
nothing, and drains on `SIGINT`/`SIGTERM`.

### Claiming is one statement, so two workers never share a job

`claimNextNotificationJob()` in `modules/notifications/queue.ts` is a single
`UPDATE` that flips the job to `PROCESSING` and returns the row:

```sql
UPDATE "Notification" AS job
SET "status" = 'PROCESSING', "attempts" = job."attempts" + 1, "lockedAt" = ...
WHERE (job."status" = 'PENDING' AND job."runAt" <= ...)
   OR (job."status" = 'PROCESSING' AND job."lockedAt" <= ...)
  AND job."id" = (SELECT due."id" FROM "Notification" AS due
                  WHERE ... ORDER BY due."runAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING job."id", job."attempts", job."lockedAt"
```

The database resolves the race, not the process:

- **`FOR UPDATE SKIP LOCKED`** — a second worker skips the row this one is
  holding instead of blocking behind it, so workers never wait on each other.
- **The status predicate is part of the write** (CS-4), so it is re-evaluated
  against the latest committed row: a job someone else already claimed matches
  nothing. There is no read-then-write anywhere in the claim.
- **Settling is guarded on ownership** — `WHERE id = ? AND status = PROCESSING
  AND attempts = ?`. `attempts` was incremented by the claim, so a worker whose
  lease expired while it was working can never settle the job another worker has
  since taken. Both settle functions throw a `409` rather than write.

Verified with 7 worker processes racing over 30 jobs: 30 delivered, **every job
at `attempts = 1`** — no job was claimed twice, and 30 delivery artifacts for 30
distinct job ids. The same race is asserted in-process in
`tests/unit/worker-queue.test.ts` ("two workers racing for one job", "many
workers racing over many jobs").

### The queue state machine

| State | Meaning | Left by |
| --- | --- | --- |
| `PENDING` | claimable once `runAt` has passed | the enqueue, or a failed attempt returning for a retry |
| `PROCESSING` | a worker holds the job and is working on it | the claim, which stamps the lease (`lockedAt`) |
| `SUCCEEDED` | the work is done and durable | the guarded settle, after the delivery output exists |
| `FAILED` | the attempt budget is spent; a dead letter | the guarded settle, on the last permitted attempt |

A job is `PENDING` and due when `runAt` has passed, **or** `PROCESSING` with an
expired lease — a worker that dies mid-job leaves a `PROCESSING` row, and after
`WORKER_LEASE_MS` another worker takes it over. A crash costs a retry, never a
job.

### Retries: backoff, then a dead letter

A job whose work throws goes back to `PENDING` with `runAt` pushed out by
`WORKER_RETRY_BASE_MS * 2^(attempts-1)`, clamped to `WORKER_RETRY_MAX_MS`. While
`runAt` is in the future no other worker can claim it. Once
`WORKER_MAX_ATTEMPTS` is spent the job becomes terminally `FAILED` — it is never
claimed again, and `lastError` (truncated, 2000 chars) is the dead-letter
reason. Re-running a terminal `FAILED` job is a manual, deliberate act.

Retrying is safe because the delivery output is keyed by job id: a retry after a
crash-mid-send produces nothing new and only finishes the job.

### The concurrency cap

A tick claims at most `WORKER_CONCURRENCY` jobs and runs them through
`mapWithConcurrency` (`lib/worker/pool.ts`), so **at most N jobs are in flight in
one process**. That cap is what keeps the worker inside a provider's rate limit:
N concurrent jobs means at most N concurrent external calls. Because the cap
also bounds claims per tick, the worker never marks a job `PROCESSING` while
having no capacity to run it.

Proven in `tests/unit/worker-pool.test.ts` (a gated pool never exceeds the
limit) and `tests/unit/worker-tick.test.ts` (a slow messenger records its own
peak overlap against 6 real jobs and the cap holds).

### Configuration

Every number lives in `lib/worker/config.ts` — never in the loop or the queue
module.

| Setting | Env override | Default | Meaning |
| --- | --- | --- | --- |
| Concurrency cap | `WORKER_CONCURRENCY` | `5` | max jobs in flight per process (N) |
| Poll interval | `WORKER_POLL_INTERVAL_MS` | `2000` | wait after a tick that claimed nothing |
| Lease | `WORKER_LEASE_MS` | `60000` | a `PROCESSING` job is reclaimable after this; must exceed the slowest job |
| Max attempts | `WORKER_MAX_ATTEMPTS` | `5` | attempts before a job is terminally `FAILED` |
| Retry base | `WORKER_RETRY_BASE_MS` | `1000` | first backoff between attempts |
| Retry ceiling | `WORKER_RETRY_MAX_MS` | `300000` | backoff is clamped here |

### Operational notes

- **Run as many worker processes as you like.** Safety comes from the claim, not
  from process count; a second process is pure throughput.
- **A failed tick is not a lost job.** The error is logged and the next tick
  continues; anything the tick still held is reclaimed once its lease expires.
- **Time is compared in UTC explicitly** (`now() AT TIME ZONE 'UTC'`). The
  columns are `timestamp without time zone` holding UTC, and a bare `now()` is a
  `timestamptz` — Postgres would reinterpret stored UTC values in the session
  `TimeZone`, shifting every comparison by the server's UTC offset.
- **There is no supervision story yet** (no restart policy, no metrics, no
  dead-letter UI). A `FAILED` job is currently only visible in the database.


## Design decisions

### Why these resources were chosen

Phase 1 scope (PRD Section 13) is the verification + listings core, and each
PRD flow maps to exactly one resource and one explicit transition:

| Flow | Resource(s) | Explicit transition |
| --- | --- | --- |
| Apply to be verified | `VerificationRequest` | `submit → PENDING` |
| Review a verification | `VerificationRequest` | `approve` / `reject` (PR-VER-002/004) |
| List a property | `Listing` (+ `ListingImage`) | `create → PENDING_REVIEW`, then `approve → ACTIVE` (PR-LST-002) |
| Search/browse | `Listing` | none — status/visibility scoping only |
| Report a problem | `Report` | `create`, threshold opens `ReviewCase` |
| Resolve reports | `ReviewCase` | `resolve`, may `suspended` the listing |

Keeping the five first-class resources means each locked-schema status machine
has a single home — a rule like "listing approval is a separate gate from
account verification" has exactly one place to be enforced and tested.
Supporting models (`AgentProfile`, `AgencyProfile`, `LandlordProfile`,
`ListingImage`, `AuditLog`, `Notification`) are intentionally not first-class:
they are written or read *through* the five. `AgencyAffiliation` is the single
extra surface — `request` / `accept` / `reject` — because PR-VER-003's
two-party acceptance is a guarded transition (only the agency side can write
`AgentProfile.agencyId`), not a browse flow, so Phase 1 deliberately ships no
affiliation list/detail endpoints.

### Why generated identifiers are used

The locked schema mandates `String @default(uuid())`, and the API treats every
path id and cross-reference as a canonical UUID v4: server-generated, never
client-supplied, never sequential. This buys four things: **non-enumerability**
(a leaked id leaks nothing else — there is no "next" id to guess and no
creation-order information), **collision safety** across distributed writers,
**no client squatting** (a caller cannot pre-choose an id), and **one validation
contract** — any non-UUID value is malformed at the edge (`400`) rather than a
guess about intent in the module layer.

### Why offset pagination was chosen

All four list consumers are bounded, dashboard/queue-style pages at current
volume (hundreds to low thousands of rows): the reviewer queue (FIFO cases), a
provider's own listings, a seeker's own reports. Two properties decided it:
offset pagination yields an exact `total` **and** `hasMore`, which the reviewer
console and pagination UI need directly; and it supports arbitrary page
navigation (`offset=40, limit=20` → "page 3") with the same four-key `meta`
shape on every list endpoint — one client component pages every list. A cursor
(keyset) would be the better fit only for unbounded, high-churn, feed-like
streams, which Phase 1 has none of; it would also cost the exact `total` count.
At these volumes a `limit ≤ 100` offset scan over an indexed sort field is
cheap, and if a feed consumer ever appears, a cursor can be introduced
per-resource inside the same envelope without breaking the documented contract.

### Why this envelope shape

Success and failure are structurally distinct, so a client can never guess
whether a payload is a resource, a list, or an error:

- **Success** — `{ "data": ... }`. All state changes (creates, approvals,
  resolutions) return `200` with the resulting resource under `data`; there is
  no 201/204 special-casing to branch on. Fields can be added to `data` over
  time without breaking the envelope.
- **List pagination is quarantined in `meta`** — `{ total, limit, offset,
  hasMore }` — so the `data` payload stays a plain array of the resource type,
  and every list endpoint shares one `meta` contract.
- **Error** — `{ "error": { "code", "message" } }`. `code` is machine-readable
  and switchable; `message` is human-readable for logs and support; the HTTP
  status remains the primary transport signal and `code` mirrors it (403 is
  always a real denial, never a filtered result — PR-ADM-001).

This mirrors the "one envelope, honest status" contract used throughout: a
failing input is never a 500, and a role denial is never a truncated success.

## Open items (recorded, not silently decided)

- **Auth mechanism**: PRD names none and `country`/login flows are unaddressed.
  We use HttpOnly SameSite=Lax HS256 session cookies with a regenerated session
  id per login; that is a working assumption until Section 14 resolves it.
- **Login route**: there is intentionally no `POST /login` at Phase 1 (no PRD
  requirement defines one). The API is exercised with sessions minted server-side
  via `createSession()` in `lib/auth`.
- **Storage provider** and **geocoding provider** are unnamed in the PRD; both
  seams fail closed until named. Tests inject fakes.
- **Prisma 6.19 pinned** because PRD Section 10 locks `prisma-client-js`;
  TypeScript 5.9 pinned over 7.x (native compiler) for ecosystem stability.
- **Launch country** (PRD Open Question 6) is unset; fields are nullable.
- Profile rows are created with the account; `ipAddress` on audit defaults to
  "internal" until a trusted-proxy config lands (SEC-13).
- The dev machine needs a reachable PostgreSQL for migrate/seed/tests; the
  bundled `.env` points at a local scratch cluster.