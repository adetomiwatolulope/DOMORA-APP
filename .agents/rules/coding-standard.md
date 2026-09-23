---
trigger: always_on
---

# coding-standard.md — Build Rules: Code

Scope: all TypeScript in /app, /modules, /lib, /tests.
Precedence: PRD (features) > AGENTS.md (process) > this file. If this file conflicts with either, follow them and flag the conflict.
Every rule here is a failure condition, not a preference. When a task touches a rule, cite its ID (CS-n) in the Question 6 checklist.

## Rules

**CS-1 Types are never bypassed.** No `any`, no `@ts-ignore`/`@ts-expect-error` to silence a real error, and no `as` assertion on request, webhook, or storage data. External data is parsed into a type; an assertion is not validation.

**CS-2 Enums are exhaustive.** Every switch or mapping over a Prisma enum ends in a `never` exhaustiveness check, so a new value is a compile error. No string literal stands in for an enum value.

**CS-3 One writer per status field.** Each transition of VerificationRequest.status, Listing.status, InspectionBooking.status, ReviewCase.status, AffiliationStatus, and Subscription.tier is written by exactly one named function in /modules. That function: (a) checks the actor's role and ownership, (b) checks the current status is a legal from-state, (c) writes the change, (d) writes the AuditLog row wherever PR-ADM-002 requires one. Steps (c) and (d) share one `prisma.$transaction`. Only transitions the PRD defines exist; an undefined transition is denied, not improvised (the PRD defines no path out of SUSPENDED — do not invent one).

**CS-4 Guarded writes are conditional, not read-then-write.** When correctness depends on current state (slot AVAILABLE, booking SCHEDULED, case unresolved, listing under cap), the state check is part of the write: `updateMany` with the state in `where` and an assertion that exactly one row changed, or a transaction that enforces it. A `findUnique` followed by `update` is a race and fails review. A unique-constraint violation (Prisma P2002, e.g. InspectionBooking.slotId) is returned as a normal rejection — never a 500, never retried until it succeeds.

**CS-5 Linked consequences are atomic.** If a rule says B happens when A happens, both share one transaction:
- Booking creation + slot set to BOOKED (PR-BOK-002).
- Booking marked AGENT_NO_SHOW/LISTING_MISREPRESENTED + Report creation (PR-BOK-003).
- Report creation + hasOpenReports update + threshold ReviewCase check (PR-REP-002).
- ReviewCase resolution + resulting suspension (PR-REP-003).
No follow-up job or "eventual" fix-up for these.

**CS-6 Identity and authority come from the server.** userId, role, ownership, reviewedById, resolvedById, and every status value come from the session or module logic — never from a request body, query string, or hidden form field.

**CS-7 The server clock decides time.** "startTime has passed", the 7-day auto-completion, the 30-day report window, subscription expiry, and URL expiry are all evaluated server-side in UTC. A client-supplied timestamp is never used in a decision.

**CS-8 Errors are not swallowed.** No empty `catch`, and no `catch` that returns a default or empty result from a guarded function. Permission failure → typed error → 403. Validation failure → 4xx with field errors. Unexpected failure → generic 500 body (details to server log only, per SEC-12).

**CS-9 Handlers are thin.** Code in /app parses the request, calls exactly one module function, and maps the result to a response. Any `if` in /app that decides allowed/not-allowed (role, status, threshold, cap, ownership) is a defect and moves to /modules.

**CS-10 Every mutation validates on the server,** even if the UI already validated. Use one validation approach across the codebase.

**CS-11 Dependencies are decisions.** Do not add, replace, or major-upgrade a package as a side effect of a task — especially auth, validation, storage, payment, date, or money libraries. If a task needs one, list it as an open item with the reason. Only /modules/billing may import a Flutterwave client.

**CS-12 Guards are proven by failing tests.** For every guard a task adds or touches, at least one test attempts the forbidden action and asserts the rejection (wrong role → 403, unverified account → no listing, second booking → rejected, undefined transition → denied). A suite of happy-path tests alone means the task is not done.