---
trigger: always_on
---

# upload-and-storage.md — Build Rules: Uploads & Storage

Scope: verification documents (VerificationRequest.documentKey), listing images (ListingImage.storageKey), and /lib/storage.
Precedence: PRD (features) > AGENTS.md (process) > this file. If this file conflicts with either, follow them and flag the conflict.
The PRD does not name a storage provider. Keep the provider behind /lib/storage; no module imports a provider SDK directly.
Every rule here is a failure condition. Cite UP-n in the Question 6 checklist when touched.

## Rules

**UP-1 Private by default.** All objects live in non-public storage. There is no public bucket, public ACL, or open CDN path to any verification document, ever. If the storage configuration appears public, stop and flag.

**UP-2 Two classes, physically separated.** Verification documents and listing images use separate buckets, or at minimum separate prefixes with separate access policies, so an image URL or credential can never resolve to a document.

**UP-3 Keys are server-generated, opaque, and unguessable.** Never use a client filename or path in a key. Never store client filenames.

**UP-4 Check first, then sign.** The module verifies authorization at request time, then asks /lib/storage for a GET URL scoped to exactly one key. /lib/storage never decides access (and cannot import /modules).
- Verification documents: the applicant (own) and PLATFORM_REVIEWER only. Not SUPER_ADMIN, not AGENCY_ADMIN.
- Listing images: any viewer only while the listing is ACTIVE. In DRAFT, PENDING_REVIEW, or SUSPENDED, only the listing's owner-side accounts and reviewers.

**UP-5 Signed URLs are short-lived and never persisted.** [ASSUMPTION — PRD says "short-lived"] Expiry is at most 300 seconds for documents and at most 900 seconds for images, set as constants in one place. A signed URL is never stored in the database, a cache, static or ISR output, logs, or email. No page or response carrying one is cached beyond its expiry; responses carrying document URLs use `Cache-Control: no-store`.

**UP-6 Keys stay internal.** documentKey and storageKey are never returned to clients or logged. Clients receive only signed URLs.

**UP-7 Upload constraints are enforced server-side.**
- Allowlisted types, determined by content sniffing rather than the extension or client Content-Type. [ASSUMPTION] Documents: PDF, JPEG, PNG. Images: JPEG, PNG, WebP.
- A per-file size cap and a per-listing image-count cap exist as config constants (state your values as assumptions).
- SVG, HTML, and executable types are rejected.

**UP-8 Upload authorization.** Only the account owner uploads a document for their own VerificationRequest. Listing images are uploaded only by the listing's owner side (the creator, or the agency admin for a managed agent's listing), and listing creation already requires a verified account (PR-VER-001). Seekers upload nothing.

**UP-9 No dangling references.** A VerificationRequest.documentKey or ListingImage.storageKey row is created only after the server confirms the object exists and passed UP-7. A row pointing at a missing object is a defect.

**UP-10 Objects are immutable.** Never overwrite an object at an existing key. A resubmission is a new object plus a new VerificationRequest, so the reviewer's evidence cannot change after the fact (AGENTS-Q3#15). A replaced listing photo is a new key.

**UP-11 No deletion of evidence.** No code path deletes or edits a verification object while any VerificationRequest references it. Retention and erasure policy is undefined in the PRD; flag it, don't invent it. Adding or removing images on an ACTIVE listing is also undefined (the PRD has no re-review rule for edits): stop and flag rather than building it.

**UP-12 Safe delivery.** Serve documents with `Content-Disposition: attachment` (or inline only for allowlisted safe types) and the correct stored Content-Type, plus `X-Content-Type-Options: nosniff`. Uploaded content is never rendered as HTML.

**UP-13 Fail closed.** If signing or storage errors, the request fails. Never fall back to a public URL, an unauthenticated proxy stream, or a stale URL.

**UP-14 Media authenticity is out of scope.** Do not build EXIF, geotag, timestamp, reverse-image, or AI checks. These are PRD §14 Q7/Q8, deferred to Phase 4. Do not strip or require metadata either; store what is uploaded.

**UP-15 Documents never leave the platform.** Never attached to emails or notifications, never sent to a third-party service (SEC-15).