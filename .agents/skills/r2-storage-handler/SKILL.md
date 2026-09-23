---
name: r2-storage-handler
description: Run this skill for anything where files move or die: uploads, signed URLs, storage keys, or deleting a book or account.
---

# R2 Storage Handler

## Trigger
Load this skill for:
- uploads;
- signed URLs;
- storage keys;
- object deletion;
- deletion of a book/account and its associated files;
- any task where a database row and an object in storage must remain consistent.

## Required workflow

1. **Encode ownership in the key.**
   - Storage keys must carry the ownership boundary required by the project.
   - Do not use guessable public URLs as authorization.

2. **Keep rows and objects paired.**
   - Every persisted storage reference must have a corresponding storage object.
   - Every deletion path must account for both the database row and the object.

3. **Keep originals immutable.**
   - Treat uploaded originals as immutable source objects.
   - Transformations or derivatives must not silently overwrite the original.

4. **Authorize before issuing URLs.**
   - Verification documents are private by default.
   - Generate short-lived pre-signed URLs only after the role/ownership check at request time.
   - Never store or expose a public or long-lived verification-document URL.

5. **Run the full deletion-parity procedure.**
   - Identify every database row and object belonging to the entity.
   - Authorize the deletion.
   - Remove the database/object pair according to the project's required ordering and transaction/error handling.
   - Verify there are no orphaned objects or rows after the operation.
   - Preserve append-only audit requirements for auditable business actions.

6. **Keep storage mechanics out of business modules where the architecture requires utilities.**
   - `/lib/storage` owns storage mechanics.
   - Domain modules decide the business rule for whether deletion/access is allowed.

## Hard stops
- No public verification-document URLs.
- No long-lived signed URLs.
- No object deletion without considering its database row.
- No database deletion that silently leaves storage objects behind.
- No unauthorized signed URL generation.
- No alteration of immutable originals.

## Source trace
AGENTS.md explicitly requires private verification documents, short-lived pre-signed URLs after role/ownership checks, `/lib/storage` for storage utilities, and module-owned business decisions. The ownership-encoded key, immutable-original, row/object pairing, and full deletion-parity mechanics are project rules supplied with this skill.