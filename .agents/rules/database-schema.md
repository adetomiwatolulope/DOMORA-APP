---
trigger: always_on
---

# database-schema.md — Build Rules: Data Model & Migrations

Scope: prisma/schema.prisma, migrations, seeds, and every Prisma query.
Precedence: PRD (features) > AGENTS.md (process) > this file. If this file conflicts with either, follow them and flag the conflict.
Every rule here is a failure condition. Cite DB-n in the Question 6 checklist when touched.

## Rules

**DB-1 The PRD §10 schema is locked; changes are additive.** No rename, removal, or type change of any model, enum, or field. Extend by adding. A destructive change (drop, rename, type change, adding NOT NULL to a populated column) needs an explicit instruction that names it.

**DB-2 Enums are closed.** A new enum value is a new business state. Stop and ask (AGENTS Q7); never add one "just in case".

**DB-3 Migration discipline.** Every schema change ships as a committed Prisma migration. Never run `prisma db push` or `migrate reset` outside a disposable local database. Never edit a migration that has been applied or merged — fix forward with a new one. Read the generated SQL before committing; any DROP or lossy ALTER stops the task.

**DB-4 An index ships with its query (AGENTS-Q3#22).** For every new query pattern, the same migration adds the matching index, or the PR names the existing `@@index` that serves it. Known cases from §10:
- The 7-day auto-completion scan filters on `InspectionSlot.startTime`, which has no index.
- The 30-day report-threshold query filters Report by target plus `createdAt`.

**DB-5 Money columns are whole integers in the smallest currency unit** (AGENTS-Q3#21). Never Float or Decimal. Prisma `Int` is 32-bit (max 2,147,483,647). Before writing any code that stores an amount, confirm the range holds for the launch currency. If it does not, stop and flag — do not switch to Float/Decimal and do not truncate. (Latitude/longitude as Float is correct; they are not money.)

**DB-6 Decided records are immutable** (AGENTS-Q3#14, #15). Never UPDATE, upsert, or delete:
- A VerificationRequest whose status is APPROVED or REJECTED.
- A ReviewCase with `resolvedAt` set.
- Any AuditLog row.
Corrections and resubmissions are new rows. Expose AuditLog through a create-only module function; no code anywhere calls `auditLog.update/updateMany/upsert/delete/deleteMany`.

**DB-7 No cascading deletes on trust records.** Never add `onDelete: Cascade` or `SetNull` on relations reaching AuditLog, VerificationRequest, Report, ReviewCase, InspectionBooking, or Subscription. Deleting a User or Listing that has such records must fail. Account and listing deletion are not in the PRD — do not build them.

**DB-8 Derived fields have exactly one writer, in the same transaction as the triggering event.**
- `Listing.hasOpenReports` — written only by /modules/reports, recomputed from the actual open-report count (never blind increment/decrement).
- `InspectionBooking.autoCompleted` — true only for system auto-completion, false for every seeker action.
- `AgentProfile.agencyId` — set only inside the function that accepts an AgencyAffiliation as ACCEPTED, on the agency's action (AGENTS-Q3#3). No other code path writes it.

**DB-9 "Open report" has one definition.** The PRD leaves it undefined (Report has no status column). Implement it once, in /modules/reports, and use that single function for `hasOpenReports`, the threshold, and reviewer queues. [ASSUMPTION — most conservative reading] A Report is open until its ReviewCase is RESOLVED. Do not add a Report.status column without approval; list this as an open item.

**DB-10 Report target integrity.** The schema cannot enforce that exactly one target is set. The module must: `targetType = LISTING` → `listingId` set; `PROFILE` → `targetUserId` set. [ASSUMPTION] PR-BOK-003's "listing and the owning account" creates two Report rows, one per target, in one transaction.

**DB-11 Listing ownership is validated in the module.** Every Listing has at least one of agentId / agencyId / landlordId (PR-LST-001), and that creator's verification is APPROVED at creation time (PR-VER-001). The schema cannot enforce either.

**DB-12 Raw SQL.** `$queryRaw` tagged templates only, with parameters. Never `$queryRawUnsafe` or `$executeRawUnsafe`; never string-built SQL.

**DB-13 Seeds and scripts respect the gates.** No seed or script outside /tests creates an APPROVED VerificationRequest or an ACTIVE Listing (AGENTS-Q3#2, #5). Test fixtures may, in test databases only. Seeds use synthetic data only — no real emails, names, or documents.