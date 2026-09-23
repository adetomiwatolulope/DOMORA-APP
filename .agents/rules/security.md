---
trigger: always_on
---

# security.md — Build Rules: Application Security

Scope: authentication, authorization, input/output handling, secrets, logging, headers.
Precedence: PRD (features) > AGENTS.md (process) > this file. If this file conflicts with either, follow them and flag the conflict.
Every rule here is a failure condition. Cite SEC-n in the Question 6 checklist when touched.
Related: upload-and-storage.md (files), money-billing.md (webhooks and payment secrets).

## Rules

**SEC-1 Sessions.** The role is read only from the server-side session, never from client-controlled data. Session cookies are HttpOnly, Secure, and SameSite=Lax or Strict, and the session identifier is regenerated on login. Never hand-roll tokens or cryptography. The PRD names no auth mechanism, so record whichever you choose as an open item.

**SEC-2 Passwords.** Hash with Argon2id (bcrypt only if Argon2id is not viable), with the library's per-hash salt. Never SHA/MD5, never reversible encryption. `passwordHash` is never selected into a response, log, or error.

**SEC-3 No self-promotion.** Public signup can create only SEEKER, AGENT, AGENCY_ADMIN, or LANDLORD accounts. No public or API path can create PLATFORM_REVIEWER or SUPER_ADMIN, or change any user's role. How reviewer accounts are created is an open item; do not invent a path.

**SEC-4 Authorization is role plus ownership** (PR-ADM-001). After the role-matrix check, every resource fetched by ID also passes an ownership or relationship check:
- Own listing, or a managed agent's listing (agent with an ACCEPTED affiliation to that agency).
- Own booking (seeker), or a booking on the caller's own listing.
- Own VerificationRequest.
- Own agency's subscription.
A missing check is a 403. Test the wrong-owner case, not just the wrong-role case.

**SEC-5 Mass assignment is closed.** Never pass or spread a request body into a Prisma create/update. Pick each accepted field explicitly after validation. These are never client-writable: role, any status, verificationStatus, hasOpenReports, autoCompleted, activeListingCap, agencyId, reviewNote (outside the reviewer action), reviewedById, resolvedById, resolution, owner/user IDs, tier, endsAt, and any amount.

**SEC-6 Output is allowlisted.** Responses use explicit `select` or DTOs. Never return raw User rows or anything containing passwordHash, documentKey, or storageKey. Another user's email or contact details are never returned unless a PRD requirement says so. (Trimming response fields is fine. Turning an authorization denial into a trimmed result is not — a denial is a 403.)

**SEC-7 Injection and XSS.** No string-built SQL (see DB-12). No `dangerouslySetInnerHTML` with user content. Listing titles, report reasons, review notes, and every notification-template variable are rendered escaped.

**SEC-8 Server-only boundary.** Modules and /lib code that touches the database, storage, or secrets import `server-only`, so a client import fails the build. Secrets never use a `NEXT_PUBLIC_` name and never appear in client components. .env.example lists names only.

**SEC-9 CSRF and GET.** No state change on GET. Mutating route handlers that use cookie auth verify the request Origin (Server Actions do this by default; route handlers do not). Webhook routes are exempt and authenticated by signature instead (MB-5).

**SEC-10 Abuse limits.** Rate-limit login, signup, document upload, report submission, and booking creation. If the stack has no shared counter store, stop and flag it rather than shipping per-instance in-memory limits. Limit values are configuration; state your defaults as assumptions.

**SEC-11 Login does not enumerate.** Failed login returns one generic message whether the email exists or not.

**SEC-12 Logging and errors.** Never log passwordHash, session tokens, signed URLs, storage keys, document content, ID numbers, secrets, full webhook bodies, or full auth/upload request bodies. Log IDs, not personal data. Clients receive generic error bodies — no stack traces, no Prisma error text.

**SEC-13 Audit integrity.** AuditLog.ipAddress comes from the platform's configured trusted-proxy handling, never from a client-settable header taken at face value. The AuditLog write shares the transaction of the action it records (CS-3); if it fails, the action fails.

**SEC-14 Transport and headers.** HTTPS only outside local dev, with HSTS. Send `X-Content-Type-Options: nosniff`. Deny framing (`frame-ancestors 'none'`).

**SEC-15 Third parties never receive identity data.** Verification documents, ID numbers, and password data go to no third-party service — not email providers, analytics, error trackers, or any AI provider (AGENTS-Q3#18). Notifications reference status only, never document contents.