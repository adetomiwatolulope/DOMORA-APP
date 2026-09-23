**Domora — Product Requirements Document**

*Version 2.0 (Build-Ready — Post-Review)*

Stack: Next.js (App Router), TypeScript (strict), PostgreSQL, Prisma

Status: Ready for engineering. Nine items remain open — see Section 14.

*Change log from v1.0: this version applies all 13 corrections from the structured PRD review (Skeptic / Author / Engineer / Product Lead / Judge session). Each change is marked with a shaded REVIEW FIX note where it lands.*

**1. Product Summary**

Domora connects people looking for property with agents, agencies, and landlords who have been verified before they are allowed to list anything. Every account that wants to post a listing goes through a document-and-human-review verification path first. Once verified, agents, agencies, and landlords can create listings and offer real, bookable inspection time slots, so a prospective renter or buyer can schedule an actual visit instead of arranging one informally through an unverified contact. Every listing and every profile carries a visible report mechanism so users can flag suspected scams, routed to a human review queue.

Each individual listing also requires a separate review before it goes live, even from an already-verified account — verification at the account level and approval at the listing level are two distinct gates.

*REVIEW FIX — \#10 — added the sentence above so the summary no longer implies verification happens once, at the account level only.*

**2. Problem Statement**

- Property scams commonly work by impersonating an agent or agency that doesn't exist, or listing a property the "agent" has no connection to, then collecting a fee or deposit before disappearing.

- There is currently no standard way for a prospective renter or buyer to check whether the person or company listing a property is who they claim to be before money or personal information changes hands.

- Property inspection visits are typically arranged informally — a phone call, a text, a walk-up — with no record that the visit was ever scheduled, no trace if the agent doesn't show, and no accountability if the listing turns out to be fake.

- Reporting a suspicious listing today usually means leaving a bad review somewhere unrelated to the platform that hosted the scam, if a report mechanism exists at all — there's rarely a consequence that follows the same agent to their next listing.

Scam-reduction impact is not directly measurable pre-launch; Section 11's metrics track process health (review speed, resolution speed) as a proxy, not confirmed scam reduction.

*REVIEW FIX — \#8 — added the caveat above so the process-speed metrics in Section 11 are not mistaken for proof that scams actually went down.*

**3. Goals and Non-Goals**

|                                                                                                                                  |                                                                 |
|----------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
| **Goals (MVP)**                                                                                                                  | **Non-Goals (MVP)**                                             |
| Document-and-human-review verification before any account can list property                                                      | Automated third-party KYC/business-verification API integration |
| Real, time-slotted inspection booking with a record on both sides                                                                | Live in-app messaging/chat between seeker and agent             |
| Report mechanism on every listing and profile, routed to a review queue, with threshold-triggered review cases live from Phase 1 | Multi-tenant, org-isolated agency workspaces                    |
| Independent listing-level review, separate from agent/agency verification                                                        | Public verification-document access of any kind                 |
| Single shared platform, agencies as an account type                                                                              |                                                                 |
| Verification documents stored privately, access via short-lived signed URLs                                                      |                                                                 |

Two items previously listed here as Non-Goals — in-platform payment processing and AI-based fraud/photo detection — are not confirmed exclusions. They are working assumptions pending an open decision. See Section 14, Q3/Q4 (payments) and Q8 (AI).

*REVIEW FIX — \#7 — removed the two open-question items from the Non-Goals table (they read as settled decisions there) and replaced with this pointer note.*

**4. User Personas**

|              |                       |                                                                                                                                                                                                                                   |                                                                            |
|--------------|-----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------|
| **Persona**  | **Role**              | **Primary Goal**                                                                                                                                                                                                                  | **Key Pain Point Solved**                                                  |
| Ifeoma       | Seeker (buyer/renter) | Find a real listing from a real agent and book a safe inspection                                                                                                                                                                  | No way to check if a listing or agent is legitimate before engaging        |
| Tobi         | Individual Agent      | Get verified and list property to reach seekers directly. Represents an independent agent; a separate, agency-affiliated agent experiences a faster verification path (PR-VER-003) and listings co-managed by their agency admin. | No standard way to prove legitimacy to a stranger online                   |
| Prime Realty | Agency                | Manage multiple agents and listings under one verified organization                                                                                                                                                               | No shared verified identity across an agency's agent roster                |
| Wale         | Landlord              | List a property directly without going through an agency                                                                                                                                                                          | No verification path exists for a landlord listing solo                    |
| Chiamaka     | Platform Reviewer     | Review verification documents and resolve reports fairly                                                                                                                                                                          | No structured queue or record trail to adjudicate reports and applications |
| Super Admin  | Super Admin           | Manage platform-wide configuration and system health                                                                                                                                                                              | No single administrative view across the platform                          |

*REVIEW FIX — \#11 — added the agency-affiliated-agent line to Tobi's persona so that distinct experience has an explicit owner.*

**5. Functional Requirements**

**Role-permission matrix:**

|                   |                                            |                             |                         |                     |                                 |                   |
|-------------------|--------------------------------------------|-----------------------------|-------------------------|---------------------|---------------------------------|-------------------|
| **Role**          | **Create Listing**                         | **Edit Own Listing**        | **View Any Listing**    | **Book Inspection** | **Review Verification/Reports** | **System Config** |
| SEEKER            | No                                         | N/A                         | Yes                     | Yes                 | No                              | No                |
| AGENT             | Yes (once verified)                        | Yes (own)                   | Yes                     | No                  | No                              | No                |
| AGENCY_ADMIN      | Yes (once verified, own + managed agents') | Yes (own + managed agents') | Yes                     | No                  | No                              | No                |
| LANDLORD          | Yes (once verified)                        | Yes (own)                   | Yes                     | No                  | No                              | No                |
| PLATFORM_REVIEWER | No                                         | No                          | Yes                     | No                  | Yes                             | No                |
| SUPER_ADMIN       | No                                         | No                          | No (system config only) | No                  | No                              | Yes               |

**5.1 Verification (VER)**

|            |                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|------------|-------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ID**     | **Requirement**                                                         | **Acceptance Criteria**                                                                                                                                                                                                                                                                                                                                                                                                                          |
| PR-VER-001 | Document-based verification gate                                        | An AGENT, AGENCY_ADMIN, or LANDLORD account cannot create a listing until its linked VerificationRequest reaches APPROVED status                                                                                                                                                                                                                                                                                                                 |
| PR-VER-002 | Human review only for MVP                                               | Every VerificationRequest is resolved by a PLATFORM_REVIEWER action (APPROVED or REJECTED); no automated approval path exists at MVP                                                                                                                                                                                                                                                                                                             |
| PR-VER-003 | Agent verification via accepted agency affiliation or standalone review | An AGENT submits either a request that becomes a linked, ACCEPTED AgencyAffiliation to a VERIFIED agency, or a standalone VerificationRequest with ID and any available business documentation. The agency-linked path requires the agency to explicitly accept the affiliation — an agent cannot self-attach to an agency's roster by setting an agency reference alone. The solo path is not auto-approved faster than the agency-linked path. |
| PR-VER-004 | Rejection is not silent                                                 | A REJECTED VerificationRequest stores a reviewNote explaining the rejection, visible to the applicant, so a resubmission can address the actual gap                                                                                                                                                                                                                                                                                              |

*REVIEW FIX — \#2 — PR-VER-003 rewritten to require an explicit agency-side acceptance step (new AgencyAffiliation model, Section 10), closing the gap where an agent could self-attach to any agency's roster.*

**5.2 Listings (LST)**

|                           |                                           |                                                                                                                                                                                                                                                                |
|---------------------------|-------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ID**                    | **Requirement**                           | **Acceptance Criteria**                                                                                                                                                                                                                                        |
| PR-LST-001                | Listing metadata capture                  | Every Listing requires title, price, location (address plus latitude/longitude), property type, at least one photo, and a link to the verified AGENT, AGENCY_ADMIN, or LANDLORD account that created it                                                        |
| PR-LST-002 \[ASSUMPTION\] | Independent listing-level review          | A newly created Listing starts in PENDING_REVIEW status and requires a PLATFORM_REVIEWER action to reach ACTIVE, separate from the creator's own account-level verification — flagged because Section 14 treats listing-level verification as an open question |
| PR-LST-003                | Reported listings are flagged, not hidden | A Listing with one or more open Report rows carries a visible hasOpenReports flag to any viewer; it is not automatically removed from search results on a single report                                                                                        |
| PR-LST-004                | Listing status lifecycle                  | Listing.status moves through DRAFT to PENDING_REVIEW to ACTIVE, and can move to SUSPENDED from any state via PLATFORM_REVIEWER action following a resolved report                                                                                              |

**5.3 Inspection Booking (BOK)**

|                           |                                               |                                                                                                                                                                                                                                                                                                                                                                                            |
|---------------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ID**                    | **Requirement**                               | **Acceptance Criteria**                                                                                                                                                                                                                                                                                                                                                                    |
| PR-BOK-001                | Real time-slot booking                        | A seeker books a specific InspectionSlot tied to a Listing; the booking is a persisted InspectionBooking row, not a contact-form message with no record                                                                                                                                                                                                                                    |
| PR-BOK-002                | No double-booking a slot                      | Booking a slot atomically sets InspectionSlot.status = BOOKED in a single database operation; a second booking attempt on the same slot is rejected, not silently allowed to overwrite the first                                                                                                                                                                                           |
| PR-BOK-003 \[ASSUMPTION\] | No-show and post-booking scam flow            | If a seeker marks a booked inspection as AGENT_NO_SHOW or LISTING_MISREPRESENTED, the system automatically creates a Report against the listing and the associated agent/agency/landlord account, entering the standard report review queue (PR-REP-001)                                                                                                                                   |
| PR-BOK-004                | Booking visibility on both sides              | Both the seeker and the listing's owning account can see the booking's current status (SCHEDULED, COMPLETED, CANCELLED, AGENT_NO_SHOW, LISTING_MISREPRESENTED)                                                                                                                                                                                                                             |
| PR-BOK-005 \[NEW\]        | Booking outcome ownership and auto-completion | The seeker who booked the inspection marks it COMPLETED, AGENT_NO_SHOW, or LISTING_MISREPRESENTED after the scheduled startTime has passed. If no status update occurs within 7 days of startTime, the system auto-marks it COMPLETED as the default assumption, logged distinctly (autoCompleted = true) so auto-completions can be tracked separately from seeker-confirmed completions. |

*REVIEW FIX — \#5 — added PR-BOK-005. Previously nothing defined who transitions a booking out of SCHEDULED, which made the Section 11 completion-rate metric unenforceable.*

**5.4 Reports & Trust Queue (REP)**

|                           |                                                       |                                                                                                                                                                                                                                                                                |
|---------------------------|-------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ID**                    | **Requirement**                                       | **Acceptance Criteria**                                                                                                                                                                                                                                                        |
| PR-REP-001                | Report action on every listing and profile            | Any authenticated SEEKER can submit a Report against a Listing or against an AGENT/AGENCY_ADMIN/LANDLORD profile, with a required reason field                                                                                                                                 |
| PR-REP-002 \[ASSUMPTION\] | Report threshold triggers review, not auto-suspension | 3 or more open Report rows against the same target within a rolling 30-day window automatically creates a ReviewCase in the PLATFORM_REVIEWER queue; no automatic suspension occurs without a reviewer action. Ships in Phase 1, alongside report submission — see Section 13. |
| PR-REP-003                | Reviewer decision is recorded, not silently applied   | A resolved ReviewCase writes a resolution field and a resolvedById reviewer ID; any resulting suspension of a Listing or account only happens after this resolution record exists                                                                                              |

*REVIEW FIX — \#1 — PR-REP-002's acceptance criteria now states explicitly that it ships in Phase 1 with report submission, not Phase 2 (see the Phase 13 roadmap fix).*

**5.5 AI Processing (AI)**

|                          |                       |                                                                                                                                                                                                                                                                        |
|--------------------------|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ID**                   | **Requirement**       | **Acceptance Criteria**                                                                                                                                                                                                                                                |
| PR-AI-001 \[ASSUMPTION\] | No AI features in MVP | No AI/LLM integration exists in this version. This is a working default, not a confirmed decision — Section 14 leaves AI scope as fully open. If AI is confirmed later, it is advisory only, routed to a PLATFORM_REVIEWER, never an automatic suspension or approval. |

**5.6 Billing (BIL)**

|                           |                                                                             |                                                                                                                                                                                                                                                                                                                                                                                           |
|---------------------------|-----------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ID**                    | **Requirement**                                                             | **Acceptance Criteria**                                                                                                                                                                                                                                                                                                                                                                   |
| PR-BIL-001 \[ASSUMPTION\] | No in-platform payment processing for deposits or rent/sale amounts         | All money related to renting, buying, or booking a specific property changes hands directly between the seeker and the agent/agency/landlord, off-platform. Domora does not process, hold, or become a counterparty to that transaction at MVP.                                                                                                                                           |
| PR-BIL-002 \[ASSUMPTION\] | Agency subscription billing, plus enforced individual/landlord listing caps | The only recurring paid product at MVP is a Subscription tier for AGENCY_ADMIN accounts (unlimited listings, featured placement). Individual agents and landlords use a free tier capped at activeListingCap (default 5, unconfirmed exact number — Section 14). Agency-affiliated agents inherit their agency's uncapped status once the agency holds an active AGENCY_PRO subscription. |
| PR-BIL-003                | Server-side computation only                                                | Any fee or subscription amount is computed and stored server-side; the client never computes or transmits an authoritative price                                                                                                                                                                                                                                                          |

*REVIEW FIX — \#4 — PR-BIL-002 now names the actual schema field (activeListingCap) that enforces the cap described in Section 8; previously the rule existed in prose with nothing in the data model to check it.*

**5.7 Admin & Access Control (ADM)**

|            |                                    |                                                                                                                                                                                               |
|------------|------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ID**     | **Requirement**                    | **Acceptance Criteria**                                                                                                                                                                       |
| PR-ADM-001 | Role-permission matrix enforcement | Every server action/API route checks session-derived role against the Section 5 matrix before touching data; denial returns 403, never a filtered result                                      |
| PR-ADM-002 | Append-only audit logging          | Every verification decision, listing status change, and report resolution logs user ID, timestamp, target ID, and IP address; no UPDATE/DELETE path exists to the audit table from any module |

**5.8 Notifications (NOT)**

|            |                                              |                                                                                                                                               |
|------------|----------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| **ID**     | **Requirement**                              | **Acceptance Criteria**                                                                                                                       |
| PR-NOT-001 | Booking and verification event notifications | Both parties in an InspectionBooking are notified on each status change; a VerificationRequest applicant is notified on approval or rejection |
| PR-NOT-002 | Template-based messaging                     | Every notification is generated from a versioned template with variable substitution, not a hand-built string per call site                   |

**6. AI Processing Pipeline**

AI scope for Domora is an open question (Section 14), not a confirmed feature set. The working default for MVP is: no AI/LLM integration ships in this version.

Why this default, not a guessed feature set: the product idea and confirmed assumptions never named a specific AI capability, and inventing one (duplicate-photo detection, suspicious-listing scoring, seeker-to-listing matching) risks building the wrong thing before the actual intended use is confirmed. This section exists to state the boundary clearly rather than leave it implicit.

**If AI scope is confirmed in a later phase, it must follow this pattern:**

- AI output is advisory only, routed to a PLATFORM_REVIEWER.

- AI never auto-approves a verification, auto-publishes a listing, or auto-suspends an account.

- Any AI call involving user-submitted identity documents or business-registration content passes through a dedicated redaction step, built and reviewed at the time AI scope is actually confirmed — raw document content is never sent to a third-party model without it.

*REVIEW FIX — \#12 — removed the reference to "PII-handling discipline used elsewhere in comparable regulated products," since no other module in this PRD has such a layer to point to. Replaced with a self-contained rule.*

**7. Technical Requirements**

**Architecture**

- Next.js App Router, TypeScript strict mode throughout.

- Business logic lives in /modules/\* by domain (identity, verification, listings, bookings, reports, billing, notifications). Route handlers and Server Components stay thin and call into modules only.

- PostgreSQL via Prisma. Single shared platform, no org-based multi-tenancy — agencies are an account type, not an isolated tenant.

**Security & Data Integrity**

- TLS 1.3 in transit, no exceptions beyond local dev.

- Verification documents (ID, business registration) stored privately by default; access only through short-lived, pre-signed URLs generated after a role/ownership check at request time.

- Resolved ReviewCase and completed VerificationRequest decisions are not editable in place; a correction is a new, linked record, not an UPDATE on the original decision.

**Location Data**

- \[ASSUMPTION\] Listings store static latitude/longitude, resolved once at creation time via a geocoding API call. This is the only live mapping dependency in the core flow — search, browse, and proximity filtering afterward run entirely against the stored coordinates with no repeated live API calls.

*REVIEW FIX — \#3 — corrected a direct contradiction: the previous wording claimed geocoding at creation and "no live mapping API dependency" in the same breath. Now it's explicit that the one-time geocoding call is the only live dependency, and search/browse afterward have none.*

**Performance**

- Listing search and browse target sub-300ms response for a result set under 1,000 active listings in a given city/region filter.

- Any new query pattern ships with a matching index in the same migration.

**8. Business Model**

\[ASSUMPTION\] The exact monetization model is an open question (Section 14). The working model below unblocks schema and billing-module design, not a locked business decision:

- Individual agents and landlords: free tier, capped by activeListingCap (default 5, unconfirmed exact number).

- Agencies: optional paid Subscription for unlimited listings and featured placement in search results. Agency-affiliated agents inherit the agency's uncapped status while the agency's AGENCY_PRO subscription is active.

- No commission or transaction fee on the actual rent, sale, or deposit amount — that money never touches the platform at MVP (PR-BIL-001).

This model is assumed because it avoids Domora becoming a financial counterparty before a payment model is confirmed, while still giving agencies a reason to pay. Exact pricing, listing caps, and whether individual agents/landlords ever get a paid tier are unconfirmed.

**9. Risks**

|                                                                                                                   |                  |                                                                                                                                        |
|-------------------------------------------------------------------------------------------------------------------|------------------|----------------------------------------------------------------------------------------------------------------------------------------|
| **Risk**                                                                                                          | **Category**     | **Mitigation / Metric**                                                                                                                |
| A verified agent posts a listing for a property they have no real connection to                                   | Product/Trust    | Independent listing-level review (PR-LST-002), separate from account verification                                                      |
| Report mechanism has no real teeth, so bad actors continue operating between reports                              | Product          | Automatic ReviewCase creation at a report threshold (PR-REP-002), live from Phase 1                                                    |
| Agent no-shows or misrepresented listings go unaddressed after a booking                                          | Product/Trust    | No-show and misrepresentation flagging automatically opens a Report (PR-BOK-003), with an explicit outcome-ownership rule (PR-BOK-005) |
| \[SPLIT\] Verification backlog: reviewer team cannot keep pace with account applications                          | Operational      | Tracked via the verification approval-time metric (Section 11); no staffing mitigation defined, flagged deliberately                   |
| \[SPLIT\] Listing-review backlog: reviewer team cannot keep pace with new listings awaiting approval              | Operational      | Tracked via the listing review-time metric (Section 11); no staffing mitigation defined, flagged deliberately                          |
| \[SPLIT\] Report-review backlog: reviewer team cannot keep pace with threshold-triggered review cases             | Operational      | Tracked via the report resolution-time metric (Section 11); no staffing mitigation defined, flagged deliberately                       |
| Region-specific property verification (title deeds, land registries) differs from the MVP's document-upload model | Legal/Regulatory | Section 14's open question on launch region must be resolved before regional verification requirements are finalized                   |
| Fake or stock photos used on listings go undetected without AI or media-authenticity checks                       | Product/Trust    | Flagged as an open question (Section 14); MVP relies on human review and the report queue, not automated detection                     |

*REVIEW FIX — \#9 — the single "reviewer team cannot keep pace" risk was split into three named rows (verification, listing review, report review), each mapped to its own Section 11 metric, so a capacity problem surfaces in the specific queue it's happening in.*

**10. Prisma Data Model**

generator client {

provider = "prisma-client-js"

}

datasource db {

provider = "postgresql"

url = env("DATABASE_URL")

}

enum UserRole {

SEEKER

AGENT

AGENCY_ADMIN

LANDLORD

PLATFORM_REVIEWER

SUPER_ADMIN

}

enum VerificationStatus {

PENDING

APPROVED

REJECTED

}

enum AffiliationStatus {

PENDING

ACCEPTED

REJECTED

}

enum ListingStatus {

DRAFT

PENDING_REVIEW

ACTIVE

SUSPENDED

}

enum PropertyType {

APARTMENT

HOUSE

DUPLEX

LAND

COMMERCIAL

OTHER

}

enum InspectionSlotStatus {

AVAILABLE

BOOKED

CANCELLED

}

enum BookingStatus {

SCHEDULED

COMPLETED

CANCELLED

AGENT_NO_SHOW

LISTING_MISREPRESENTED

}

enum ReportTargetType {

LISTING

PROFILE

}

enum ReviewCaseStatus {

OPEN

UNDER_REVIEW

RESOLVED

}

enum SubscriptionTier {

FREE

AGENCY_PRO

}

enum NotificationChannel {

EMAIL

IN_APP

}

model User {

id String @id @default(uuid())

role UserRole

email String @unique

passwordHash String

// REVIEW FIX \#13: nullable region field so Open Question 6 can resolve

// later without a restructuring migration.

country String?

createdAt DateTime @default(now())

agentProfile AgentProfile?

agencyProfile AgencyProfile?

landlordProfile LandlordProfile?

verificationRequests VerificationRequest\[\]

bookingsAsSeeker InspectionBooking\[\] @relation("SeekerBookings")

reportsSubmitted Report\[\] @relation("Reporter")

reportsAgainstMe Report\[\] @relation("ReportedUser")

auditLogs AuditLog\[\]

notifications Notification\[\]

@@index(\[role\])

}

model AgencyProfile {

id String @id @default(uuid())

userId String @unique

user User @relation(fields: \[userId\], references: \[id\])

name String

verificationStatus VerificationStatus @default(PENDING)

createdAt DateTime @default(now())

agents AgentProfile\[\]

affiliations AgencyAffiliation\[\]

listings Listing\[\]

subscription Subscription?

@@index(\[verificationStatus\])

}

// REVIEW FIX \#2: new model backing the corrected PR-VER-003 flow. An agent

// cannot self-attach to an agency by setting agencyId alone — a matching

// ACCEPTED row here is required first.

model AgencyAffiliation {

id String @id @default(uuid())

agentId String

agent AgentProfile @relation(fields: \[agentId\], references: \[id\])

agencyId String

agency AgencyProfile @relation(fields: \[agencyId\], references: \[id\])

status AffiliationStatus @default(PENDING)

createdAt DateTime @default(now())

resolvedAt DateTime?

@@index(\[agentId\])

@@index(\[agencyId, status\])

}

model AgentProfile {

id String @id @default(uuid())

userId String @unique

user User @relation(fields: \[userId\], references: \[id\])

agencyId String?

agency AgencyProfile? @relation(fields: \[agencyId\], references: \[id\])

verificationStatus VerificationStatus @default(PENDING)

// REVIEW FIX \#4: enforces the individual-agent listing cap named in

// Section 8. Ignored while agencyId points at an agency with an active

// AGENCY_PRO subscription.

activeListingCap Int @default(5)

createdAt DateTime @default(now())

affiliations AgencyAffiliation\[\]

listings Listing\[\]

@@index(\[agencyId\])

@@index(\[verificationStatus\])

}

model LandlordProfile {

id String @id @default(uuid())

userId String @unique

user User @relation(fields: \[userId\], references: \[id\])

verificationStatus VerificationStatus @default(PENDING)

activeListingCap Int @default(5)

createdAt DateTime @default(now())

listings Listing\[\]

@@index(\[verificationStatus\])

}

model VerificationRequest {

id String @id @default(uuid())

userId String

user User @relation(fields: \[userId\], references: \[id\])

documentKey String // opaque storage key, never a public URL

status VerificationStatus @default(PENDING)

reviewNote String?

reviewedById String?

createdAt DateTime @default(now())

reviewedAt DateTime?

@@index(\[userId\])

@@index(\[status\])

}

model Listing {

id String @id @default(uuid())

title String

price Int // stored in smallest currency unit

address String

latitude Float

longitude Float

// REVIEW FIX \#13: nullable region field, same rationale as User.country.

country String?

propertyType PropertyType

status ListingStatus @default(DRAFT)

hasOpenReports Boolean @default(false)

agentId String?

agent AgentProfile? @relation(fields: \[agentId\], references: \[id\])

agencyId String?

agency AgencyProfile? @relation(fields: \[agencyId\], references: \[id\])

landlordId String?

landlord LandlordProfile? @relation(fields: \[landlordId\], references: \[id\])

createdAt DateTime @default(now())

images ListingImage\[\]

inspectionSlots InspectionSlot\[\]

reports Report\[\]

@@index(\[status\])

@@index(\[latitude, longitude\])

@@index(\[agentId\])

@@index(\[agencyId\])

@@index(\[landlordId\])

}

model ListingImage {

id String @id @default(uuid())

listingId String

listing Listing @relation(fields: \[listingId\], references: \[id\])

storageKey String

uploadedAt DateTime @default(now())

@@index(\[listingId\])

}

model InspectionSlot {

id String @id @default(uuid())

listingId String

listing Listing @relation(fields: \[listingId\], references: \[id\])

startTime DateTime

status InspectionSlotStatus @default(AVAILABLE)

booking InspectionBooking?

@@index(\[listingId, status\])

}

model InspectionBooking {

id String @id @default(uuid())

slotId String @unique

slot InspectionSlot @relation(fields: \[slotId\], references: \[id\])

seekerId String

seeker User @relation("SeekerBookings", fields: \[seekerId\], references: \[id\])

status BookingStatus @default(SCHEDULED)

// REVIEW FIX \#5: backs PR-BOK-005's auto-completion rule so it is

// distinguishable from a seeker-confirmed completion.

autoCompleted Boolean @default(false)

createdAt DateTime @default(now())

@@index(\[seekerId\])

@@index(\[status\])

}

model Report {

id String @id @default(uuid())

reporterId String

reporter User @relation("Reporter", fields: \[reporterId\], references: \[id\])

targetType ReportTargetType

listingId String?

listing Listing? @relation(fields: \[listingId\], references: \[id\])

// REVIEW FIX \#6: was a bare String with no relation. Now a proper

// relation so the database enforces the target exists and a reviewer

// can traverse directly to the reported profile.

targetUserId String?

targetUser User? @relation("ReportedUser", fields: \[targetUserId\], references: \[id\])

reason String

createdAt DateTime @default(now())

reviewCase ReviewCase?

@@index(\[listingId\])

@@index(\[targetUserId\])

}

model ReviewCase {

id String @id @default(uuid())

reportId String @unique

report Report @relation(fields: \[reportId\], references: \[id\])

status ReviewCaseStatus @default(OPEN)

resolution String?

resolvedById String?

createdAt DateTime @default(now())

resolvedAt DateTime?

@@index(\[status\])

}

model Subscription {

id String @id @default(uuid())

agencyId String @unique

agency AgencyProfile @relation(fields: \[agencyId\], references: \[id\])

tier SubscriptionTier @default(FREE)

startedAt DateTime @default(now())

endsAt DateTime?

@@index(\[tier\])

}

model Notification {

id String @id @default(uuid())

userId String

user User @relation(fields: \[userId\], references: \[id\])

channel NotificationChannel

template String

sentAt DateTime?

createdAt DateTime @default(now())

@@index(\[userId\])

}

model AuditLog {

id String @id @default(uuid())

userId String

user User @relation(fields: \[userId\], references: \[id\])

action String

targetId String

ipAddress String

createdAt DateTime @default(now())

@@index(\[userId\])

@@index(\[targetId\])

}

**11. Success Metrics**

- Verification approval time: median time from VerificationRequest submission to APPROVED/REJECTED status.

- Listing review time: median time from Listing creation (PENDING_REVIEW) to ACTIVE status.

- Report resolution time: median time from Report creation to ReviewCase resolution.

- Completed inspection rate: percentage of InspectionBooking rows reaching COMPLETED versus AGENT_NO_SHOW/LISTING_MISREPRESENTED, with auto-completed bookings (autoCompleted = true, per PR-BOK-005) tracked and reported separately from seeker-confirmed completions.

- \[ASSUMPTION\] Year 1 targets: 1,000 verified agents/agencies/landlords, 5,000 active listings, 2,000 completed inspections, 95% of reports resolved within 7 days. Flagged as placeholder planning figures because exact Year 1 numeric targets are an open question (Section 14).

*REVIEW FIX — \#5 (continued) — the completion-rate metric now explicitly separates auto-completed bookings from seeker-confirmed ones, so the metric can't be silently inflated by bookings nobody ever followed up on.*

**12. Assumptions**

All items below are working defaults chosen to keep engineering unblocked. None are final decisions — each traces to an open question in Section 14.

- \[ASSUMPTION\] Listing-level verification is independent from agent/agency/landlord account verification; every new listing requires its own PLATFORM_REVIEWER approval (PR-LST-002).

- \[ASSUMPTION\] No-show and post-booking misrepresentation are handled by automatically opening a Report, not a separate penalty system (PR-BOK-003), with explicit outcome ownership and a 7-day auto-completion fallback (PR-BOK-005).

- \[ASSUMPTION\] No in-platform payment processing for deposits, rent, or sale amounts exists at MVP; all such money moves off-platform (PR-BIL-001).

- \[ASSUMPTION\] The only money moving through the platform is an optional agency subscription tier, plus enforced free-tier listing caps (activeListingCap) for individual agents and landlords; exact pricing and cap number are unconfirmed (Section 8, PR-BIL-002).

- \[ASSUMPTION\] A report threshold of 3 open reports within 30 days triggers a ReviewCase, rather than automatic suspension, live from Phase 1 (PR-REP-002).

- \[ASSUMPTION\] No AI/LLM integration ships in MVP; AI scope is fully unconfirmed (Section 6, PR-AI-001).

- \[ASSUMPTION\] Location data uses static geocoded coordinates captured once at listing creation via a geocoding API call — the only live mapping dependency in the core flow (Section 7).

- \[ASSUMPTION\] Launch country/region and any region-specific property verification standard (title deeds, land registries) are unconfirmed; the schema now holds an optional country field on User and Listing so this can resolve later without a migration (Section 14, Section 10).

- \[ASSUMPTION\] Year 1 numeric targets (1,000 verified accounts / 5,000 listings / 2,000 completed inspections / 95% 7-day report resolution) are placeholder figures for planning only (Section 11).

- \[NEW\] Agent-to-agency affiliation requires an explicit agency-side acceptance (new AgencyAffiliation model); an agent cannot self-attach to an agency's roster (Section 5.1, PR-VER-003).

**13. Phased Roadmap**

**Phase 1 — Verification & Listings Core**

Document-based verification with human review, agent/agency/landlord account types, agency-affiliation acceptance flow, listing creation with independent listing-level review, report action on every listing and profile, and report-threshold-triggered review cases (PR-REP-002) live from day one — not deferred to Phase 2.

*REVIEW FIX — \#1 — PR-REP-002 moved from Phase 2 into Phase 1. Previously, reports could be submitted in Phase 1 with no threshold-review mechanism attached until Phase 2, recreating the exact "reports with no consequence" problem this product exists to solve.*

**Phase 2 — Booking & Trust Queue**

Real time-slot inspection booking, no-show/misrepresentation flagging into the report queue (PR-BOK-003), booking-outcome ownership and auto-completion (PR-BOK-005).

**Phase 3 — Monetization**

Agency subscription tier rollout, enforced listing caps for free-tier accounts, billing infrastructure.

**Phase 4 — Trust & Scale Readiness**

Resolution of payment-model, AI-scope, and launch-region open questions; region-specific verification compliance if a second launch market is confirmed; evaluation of media-authenticity checks for listing photos.

**14. Open Questions**

These remain unresolved. Working assumptions above unblock engineering but should not be read as decisions.

1.  Listing-level verification — Does an individual listing get independently verified, separate from the agent's own verification? (Working assumption: yes, PR-LST-002.)

2.  No-show/scam-after-booking consequence — What happens if an agent doesn't show up, or a listing turns out fake after booking? (Working assumption: routed into the report queue, PR-BOK-003, with explicit outcome ownership per PR-BOK-005.)

3.  Monetization model — Exact model: listing fees, booking fees, agency subscriptions, a commission, or a mix? (Working assumption: Section 8.)

4.  In-platform payments — Does money ever move through the platform (deposits, booking fees), or is it always off-platform? (Working assumption: always off-platform, PR-BIL-001.)

5.  Report threshold/process — What report threshold or process leads to a suspension? (Working assumption: 3 reports in 30 days opens a review case, live from Phase 1, PR-REP-002.)

6.  Launch region — Which country or city launches first, and how does property verification differ there? No working assumption made; flagged as fully open. Schema now holds a nullable country field on User and Listing to avoid a future migration once this is decided.

7.  Media authenticity — Are agent-uploaded photos/videos trusted as-is, or does Domora require geotagged/timestamped media? No working assumption made; flagged as fully open.

8.  AI scope — Is AI used anywhere in this product, and if so, for what? (Working assumption: no AI in MVP, Section 6.)

9.  Year 1 numeric targets — Confirmed targets for verified accounts, active listings, completed inspections, and reports resolved. (Working placeholder: Section 11.)
