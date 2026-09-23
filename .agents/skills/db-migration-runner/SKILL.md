---
name: db-migration-runner
description: Run this skill for any schema change, Prisma change, or task mentioning migration, schema, or a new thing to store.
---

# DB Migration Runner

## Trigger
Load this skill whenever the task involves:
- a Prisma schema change;
- a database migration;
- a new field, model, relation, enum, or other thing that must be stored;
- a query-pattern change that may require an index.

## Purpose
Teach the safe migration sequence that protects the locked schema, applies the kobo money pattern, and preserves the deletion-cascade behavior.

## Required workflow

1. **Trace the storage change to the PRD.**
   - Identify the requirement ID or explicitly named data-model rule the change implements.
   - Do not invent a model, field, enum value, role, or scope.
   - Treat `Domora_PRD_v2.md` as the feature source of truth and `AGENTS.md` as the process source of truth.

2. **Protect the locked schema.**
   - Use the Prisma schema in PRD Section 10 as the baseline.
   - Extend the schema when a migration is genuinely required; do not restructure locked models without explicit instruction.
   - Keep PostgreSQL access through Prisma; raw SQL is only permitted through parameterized `$queryRaw` when Prisma genuinely cannot express the query.

3. **Apply the money rule.**
   - Any money field uses the smallest currency unit as a whole integer.
   - Never introduce float/decimal money storage.
   - Client-supplied prices/fees/amounts are never authoritative.

4. **Account for deletion behavior.**
   - Before changing relations, verify that the resulting relation behavior preserves the product's required row/object cleanup and ownership invariants.
   - Do not silently alter deletion semantics while changing the schema.

5. **Add indexes with query patterns.**
   - Every new query pattern ships with its matching index in the same migration.
   - Check the existing Prisma indexes before adding redundant ones.

6. **Generate and apply the migration.**
   - Keep the migration explicit and reviewable.
   - Regenerate Prisma client when required by the project workflow.
   - Verify the database is at the expected migration state.

7. **Verify business rules.**
   - Add or update tests for the rule the schema change enables.
   - Include denied/forbidden behavior where the change affects authorization or protected data.

## Hard stops
- Do not restructure the locked schema for convenience.
- Do not add multi-tenant isolation.
- Do not introduce a second payment provider.
- Do not store money as decimals/floats.
- Do not ship a new query pattern without its index in the same migration.
- Do not build a later-phase feature merely because its schema would be convenient to add now.

## Source trace
This workflow follows AGENTS.md rules for the locked Prisma schema, Prisma-only database access, indexes, money representation, and phase discipline, plus PRD Section 10 and its performance/data-model requirements.