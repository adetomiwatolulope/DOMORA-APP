---
name: api-route-scaffolder
description: Run this skill for any new or edited route, endpoint, or Server Action.
---

# API Route Scaffolder

## Trigger
Load this skill for:
- a new API route;
- an edited route handler;
- a new or edited Server Action;
- any server entry point that receives client-controlled input.

## Purpose
Teach the opening ritual in exact order — session, input, ownership, limits — and keep handlers thin, using the R31 blocked-message pattern where required by the project rules.

## Required opening ritual

1. **Session**
   - Establish the authenticated session first.
   - Derive the role from the trusted server-side session.
   - Never trust a client-supplied role.

2. **Input**
   - Validate mutation input on the server.
   - Never trust client-provided status, role, ownership identifiers, or amount fields as authoritative.
   - Use Prisma enum types rather than magic strings.

3. **Ownership**
   - Before touching protected data, enforce the applicable ownership/permission boundary in the module that owns the business rule.
   - Do not fetch broadly and then filter in the route.
   - A denial is a denial: return 403 where the role-permission matrix requires it.

4. **Limits**
   - Enforce caps, thresholds, status transitions, and other business decisions through `/modules/*`.
   - Route handlers are thin callers; they do not contain business rules.

5. **Blocked response**
   - Apply the project's R31 blocked-message pattern exactly where the surrounding rules require it.
   - Do not invent alternate denial wording or silently downgrade a forbidden operation to a filtered response.

## Handler discipline
- Keep `/app` route handlers and Server Components thin.
- Put business logic in the relevant `/modules/<domain>` function.
- Use small, named functions.
- Make every status transition an explicit module function.
- Test the business rule, including at least one denied role for new protected routes/actions.

## Hard stops
- No client-controlled role authorization.
- No business-rule `if` statements in route handlers.
- No filtered/redacted substitute for a required 403.
- No unvalidated mutation.
- No route-level workaround for a module rule.

## Source trace
AGENTS.md requires session-derived role authorization before data access, server validation on every mutation, thin route handlers, module-owned business rules, and denied-role coverage. The exact R31 blocked-message wording is treated as a project rule supplied with this skill and must not be improvised.