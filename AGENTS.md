# AGENTS.md — Domora Build Agent Rules

## Question 1 — What is this project?

Domora is a property listing platform that connects seekers (renters/buyers) with agents, agencies, and landlords who must be verified before they can list anything. The core trust mechanism is: account-level verification, independent listing-level review, real bookable inspection slots, and a report queue with a threshold that forces human review.

- **Version being built:** MVP (Phase 1 of the roadmap in PRD Section 13 — Verification & Listings Core), building toward Phase 2 (Booking & Trust Queue) and Phase 3 (Monetization) as explicitly separate, later phases.
- **Who it is for:** Seekers, individual Agents, Agency Admins, Landlords, Platform Reviewers, and a Super Admin — six roles, each with a fixed permission set (PRD Section 5, role-permission matrix).
- **Source of truth:** `Domora_PRD_v2.md` (Build-Ready, Post-Review). If this AGENTS.md and the PRD ever disagree on a *feature* decision, the PRD wins. If they disagree on *process/behavior* (how you work, not what you build), this file wins. If a PRD requirement is marked `[ASSUMPTION]`, treat it as the current working rule, not as optional — assumptions are still binding until Section 14 resolves them.
- **What this file is not:** This is not a feature list and not a summary of the PRD. Do not re-derive scope from this file. Every feature you build must trace to a specific PRD requirement ID (PR-XXX-NNN). This file only tells you how to behave while building those requirements.

---

## Question 2 — What is locked?

These are already decided. Do not change, swap, "improve," or substitute any of them, even if you believe an alternative is technically superior. If you think one of these is wrong, stop and flag it in your output — do not silently work around it.

### Stack
- **Framework:** Next.js, App Router. Do not introduce Pages Router patterns.
- **Language:** TypeScript, strict mode, everywhere. No `any`, no `// @ts-ignore` to bypass a real type error.
- **Database:** PostgreSQL, accessed only through Prisma. No raw SQL except inside a Prisma `$queryRaw` call when a Prisma query genuinely cannot express the needed query — and even then, parameterized, never string-concatenated.
- **ORM/schema:** The Prisma schema in PRD Section 10 is the locked data model. Do not rename models, enums, or fields. Do not remove a field because it looks unused yet — several fields (e.g., `activeListingCap`, `autoCompleted`, `hasOpenReports`, `country`) exist specifically to enforce a PRD rule described in prose elsewhere. If a migration is genuinely required, extend the schema; do not restructure existing models without an explicit instruction to do so.

### Payment provider
- **Flutterwave is the only payment provider.** Do not add Stripe, Paystack, or any other processor, even as a fallback or for testing convenience.
- Flutterwave is used **only** for the Agency `Subscription` billing flow (PRD Section 5.6, PR-BIL-002) — i.e., the `AGENCY_PRO` tier charge. This does not change PR-BIL-001: money for actual rent, sale, or deposit amounts is never processed, held, or touched by Domora, and Flutterwave is never wired into any booking, listing, or inspection flow. If you find yourself connecting Flutterwave to anything other than the `Subscription` model, stop — that is out of scope.
- All Flutterwave webhook events must be signature-verified before any subscription state is changed. A `Subscription.tier` never flips to `AGENCY_PRO` on the strength of a client-side success redirect alone — only a verified webhook event may confirm payment.
- Fee and subscription amounts are computed and stored server-side, per PR-BIL-003. The client never sends a price Domora then trusts.

### Architecture boundaries (already decided, not open for restructuring)
- Single shared platform, no multi-tenant org isolation. Agencies are an account type (`AgencyProfile`), not an isolated tenant with its own schema or database. Do not build tenant isolation "for future-proofing."
- Business logic lives in `/modules/*` by domain. Route handlers and Server Components are thin callers into modules — they do not contain business rules themselves.
- TLS 1.3 in transit, no exceptions outside local dev.
- Verification documents are private by default, served only through short-lived pre-signed URLs generated after a role/ownership check at request time. Never a public or long-lived URL.
- Listings store static latitude/longitude, geocoded once at creation. This is the only live external mapping call in the core flow — search, browse, and proximity filtering run against stored coordinates only. Do not add a live geocoding or maps API call anywhere else without an explicit instruction.

---

## Question 3 — What must never happen

Every rule below is a direct order. **Breaking any rule on this list means the task failed, even if the code runs, even if the feature appears to work in a demo.** Each rule points to its PRD requirement where one exists.

1. **Never let an unverified account create a listing.** An `AGENT`, `AGENCY_ADMIN`, or `LANDLORD` account may not create a `Listing` unless its linked `VerificationRequest.status = APPROVED`. (PR-VER-001)

2. **Never auto-approve a verification.** Every `VerificationRequest` is resolved only by an explicit `PLATFORM_REVIEWER` action setting `APPROVED` or `REJECTED`. Do not build, stub, or leave a code path that can set `APPROVED` any other way — not a cron job, not a default, not a "trusted" bypass. (PR-VER-002)

3. **Never let an agent self-attach to an agency's roster.** An `AgentProfile.agencyId` may only be set as the result of an `AgencyAffiliation` row reaching `status = ACCEPTED`, and that acceptance must come from the agency side. An agent setting their own `agencyId` directly is forbidden at the data-access layer, not just hidden in the UI. (PR-VER-003)

4. **Never leave a rejection silent.** A `REJECTED` `VerificationRequest` must have a non-null `reviewNote` before the rejection is persisted. Do not allow a reject action to complete without one. (PR-VER-004)

5. **Never let a listing go live without its own independent review.** A `Listing` starts at `DRAFT`/`PENDING_REVIEW` and can only reach `ACTIVE` through a `PLATFORM_REVIEWER` action — never automatically, and never as a side effect of the creator's account being verified. Account verification and listing approval are two separate gates; do not collapse them into one check anywhere in the code. (PR-LST-002)

6. **Never auto-hide a listing on a single report.** A `Listing` with one or more open `Report` rows gets `hasOpenReports = true` and stays visible in search results. Do not write logic that removes or filters out a listing from search on report count alone — only a resolved `ReviewCase` action can move a listing to `SUSPENDED`. (PR-LST-003, PR-REP-003)

7. **Never allow a double-booking.** Setting `InspectionSlot.status = BOOKED` and creating the `InspectionBooking` must happen as a single atomic database operation. A second booking attempt on an already-booked slot must be rejected outright — never silently overwritten, never queued, never "last write wins." (PR-BOK-002)

8. **Never leave a booking's outcome ownerless.** Only the seeker who booked the inspection may mark it `COMPLETED`, `AGENT_NO_SHOW`, or `LISTING_MISREPRESENTED`, and only after `startTime` has passed. If no update happens within 7 days of `startTime`, the system — not a person — auto-marks it `COMPLETED` with `autoCompleted = true`. Never mark a booking `COMPLETED` any other way, and never let an auto-completion look identical to a seeker-confirmed one in the data (the `autoCompleted` flag must be set correctly every time). (PR-BOK-005)

9. **Never treat a no-show or misrepresentation claim as a private matter between two users.** Marking a booking `AGENT_NO_SHOW` or `LISTING_MISREPRESENTED` must automatically create a `Report` against the listing and the owning account, entering the same review queue as any other report. Do not build a separate, quieter resolution path for this case. (PR-BOK-003)

10. **Never auto-suspend on report volume alone.** Reaching 3 or more open `Report` rows against the same target within a rolling 30-day window must create a `ReviewCase` in the reviewer queue. It must never, by itself, suspend a `Listing` or an account. Suspension only happens after a `PLATFORM_REVIEWER` resolves the case. (PR-REP-002, PR-REP-003)

11. **Never apply a suspension without a resolution record existing first.** Write the `ReviewCase.resolution` and `resolvedById` fields *before* (or in the same transaction as) any resulting `Listing.status = SUSPENDED` or account-level suspension. The resolution record is not paperwork filed after the fact — it is the thing that authorizes the suspension. (PR-REP-003)

12. **Never let the client determine a price or fee.** Every fee and subscription amount is computed and stored server-side. Do not accept a price, fee, or amount field from a client request body and persist it as authoritative. (PR-BIL-003)

13. **Never bypass the role-permission matrix.** Every server action and API route checks the session-derived role against the Section 5 permission matrix before touching data. A denial returns 403. Never return a filtered or redacted result instead of a 403 — a denial is a denial, not a smaller version of the data. (PR-ADM-001)

14. **Never allow an audit log entry to be updated or deleted.** `AuditLog` is append-only. Do not add an UPDATE or DELETE code path to it from any module, migration, or admin tool. Every verification decision, listing status change, and report resolution must write one. (PR-ADM-002)

15. **Never edit a resolved decision in place.** A resolved `ReviewCase` or a completed `VerificationRequest` decision is never updated after the fact. A correction is a new, linked record. Do not write an UPDATE statement against a `resolvedAt`-stamped `ReviewCase` or a decided `VerificationRequest`. (Technical Requirements, Security & Data Integrity)

16. **Never store or expose a verification document insecurely.** Documents are private by default. Every access goes through a short-lived, pre-signed URL generated only after a role/ownership check at the time of the request — never a stored public URL, never a URL with no expiry. (Technical Requirements, Security & Data Integrity)

17. **Never let real money move through the platform outside the one confirmed exception.** No code path processes, holds, or becomes a counterparty for rent, sale, or deposit amounts. The only real payment flow in this system is the Flutterwave-backed Agency `Subscription` charge. If a task seems to require handling deposit or rent money on-platform, stop and flag it — that is explicitly out of scope at MVP. (PR-BIL-001)

18. **Never invent an AI feature.** No AI/LLM call exists anywhere in this MVP. If a task description implies AI (matching, scoring, detection, summarization), do not build it — flag it as out of scope and stop. If AI is confirmed later, it is advisory-only, routed to a `PLATFORM_REVIEWER`, and document content must pass through a redaction step before any third-party model call — but none of that is built now. (Section 6, PR-AI-001)

19. **Never hand-build a notification string per call site.** Every notification is generated from a versioned template with variable substitution. (PR-NOT-001, PR-NOT-002)

20. **Never build multi-tenant isolation.** Agencies are an account type sharing the single platform database, not an isolated tenant. Do not add tenant-scoping infrastructure "just in case."

21. **Never treat money fields as decimals.** Store every amount (`price`, subscription charges, any future fee) in the smallest currency unit, as a whole integer number. Never use a float or decimal type for money, anywhere, ever.

22. **Never ship a new query pattern without its index.** Any new query added against a table must ship with a matching index in the same migration, not a follow-up one. (Technical Requirements, Performance)

---

## Question 4 — How is the work arranged?

```
/domora
├── /app                          # Next.js App Router — routes + Server Components only
│   ├── /(seeker)                 # seeker-facing routes
│   ├── /(provider)               # agent / agency / landlord dashboards
│   ├── /(reviewer)               # platform reviewer console
│   ├── /(admin)                  # super admin console
│   └── /api                      # route handlers — thin, call into /modules only
│       └── /webhooks/flutterwave # Flutterwave webhook receiver (signature-verified)
│
├── /modules                      # ALL business logic lives here, by domain
│   ├── /identity                 # User, roles, session/auth logic
│   ├── /verification             # VerificationRequest, AgencyAffiliation, review actions
│   ├── /listings                 # Listing, ListingImage, listing review lifecycle
│   ├── /bookings                 # InspectionSlot, InspectionBooking, outcome ownership
│   ├── /reports                  # Report, ReviewCase, threshold logic
│   ├── /billing                  # Subscription, activeListingCap enforcement, Flutterwave integration
│   ├── /notifications            # Notification, template rendering
│   └── /admin                    # AuditLog writers, role-permission matrix enforcement
│
├── /lib                          # Cross-cutting technical utilities only (no business rules)
│   ├── /db                       # Prisma client singleton
│   ├── /storage                  # pre-signed URL generation for documents/images
│   ├── /geocoding                # one-time geocode-at-creation call
│   └── /auth                     # session/role helpers used by /modules
│
├── /prisma
│   └── schema.prisma              # locked schema from PRD Section 10 — extend, don't restructure
│
├── /tests
│   ├── /unit                      # per-module business rule tests
│   └── /integration               # cross-module flows (e.g., booking → report creation)
│
└── AGENTS.md                      # this file
```

**Placement rule:** if you are about to write an `if` statement that decides whether something is *allowed* (a role check, a status transition, a threshold, a cap), that logic belongs in `/modules`, never in `/app`. Route handlers call a module function and return its result — they do not contain the decision themselves.

**Separation rule:** `/lib` never imports from `/modules`. `/modules` never imports directly from `/app`. Payment logic in `/modules/billing` is the only module allowed to import a Flutterwave SDK/client — no other module talks to Flutterwave directly.

---

## Question 5 — How should the code look?

- **TypeScript strict mode, no exceptions.** No `any`. No suppressed type errors.
- **Node.js and all dependencies on their current LTS versions** at the time of setup. Do not pin to an old version for convenience; do not jump to a bleeding-edge non-LTS release either.
- **Small, named functions over clever one-liners.** A reviewer should be able to read a function name and know what it checks or does without reading its body.
- **Every status transition is an explicit function**, not an inline `.update({ status: X })` scattered across call sites. E.g., `approveVerification()`, `rejectVerification()`, `activateListing()`, `suspendListing()` — one clear place per transition, so the rules in Question 3 have exactly one place to live and be tested.
- **No magic strings for enums.** Use the Prisma-generated enum types (`UserRole`, `ListingStatus`, etc.) everywhere — never a raw string literal standing in for one.
- **Server-side validation on every mutation**, even when the UI already validates. The server never trusts client input, especially for role, status, and amount fields.
- **Comments explain why, not what**, and only where a rule from Question 3 is being enforced and isn't obvious from the function name alone.
- **No commented-out code, no TODO-and-abandon.** If something is unfinished, it either isn't merged, or it's tracked as an explicit open item in your task output.

---

## Question 6 — What counts as done?

For every task, before reporting it complete, produce a checklist covering:

- [ ] The code builds with zero errors and zero TypeScript strict-mode warnings.
- [ ] Every requirement ID this task touches is listed, with a one-line note on how it's satisfied (e.g., "PR-BOK-002: booking + slot status update wrapped in one Prisma transaction").
- [ ] Every "must never happen" rule from Question 3 that is relevant to this task has been checked against the actual code, not assumed.
- [ ] Any new Prisma model/field change includes the migration, and any new query includes its index in the same migration.
- [ ] Role-permission checks are in place on every new route/server action, with a 403 test for at least one denied role.
- [ ] No money/amount field uses a float or decimal type.
- [ ] If this task touches billing: the Flutterwave webhook signature is verified before any state change, and no non-subscription payment flow was introduced.
- [ ] Tests exist for the specific business rule(s) this task implements, not just a happy-path smoke test.
- [ ] Nothing from a later phase (Phase 2, 3, or 4 per PRD Section 13) was built early.
- [ ] Anything you were unsure about is listed explicitly at the end of your output (see Question 7) rather than silently resolved by guessing.

---

## Question 7 — What does the agent do when unsure?

- **Never invent a feature, field, role, or scope that isn't in the PRD.** If a task seems to need something the PRD doesn't define — a new status value, a new role, a new capability — stop and ask, or clearly flag it as an open item in your output. Do not guess and ship.
- **Never build ahead of the current phase.** If implementing a task cleanly seems to require a Phase 2/3/4 feature (e.g., real payments for rent, AI scoring, multi-tenant isolation), do not build it "since you're already in there." Flag the dependency and stop at the MVP boundary.
- **Never fill an ambiguity with the most convenient guess and move on silently.** If a PRD requirement is genuinely ambiguous, pick the interpretation that most restricts behavior (the safer, more conservative reading — e.g., deny by default, require explicit approval), implement that, and say plainly what you assumed and why.
- **Never paper over uncertainty with more code.** If you don't know how a rule should behave, do not write speculative branching logic to "cover all the cases." Write the smallest correct implementation for the case you're sure about, and name the uncertain case as an open question instead of guessing at it in code.
- **When two rules seem to conflict**, stop and surface the conflict explicitly rather than picking one silently. Point to both requirement IDs.
- **The PRD's nine open questions (Section 14) are not yours to resolve.** Build against the stated working assumption for each one, and never treat an assumption as a green light to go further than the assumption itself states.
