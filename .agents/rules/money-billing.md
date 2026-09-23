---
trigger: glob
---

# money-billing.md — Build Rules: Money & Billing

Scope: /modules/billing, the Flutterwave webhook route, Subscription, activeListingCap, and any amount anywhere in the system.
Precedence: PRD (features) > AGENTS.md (process) > this file. If this file conflicts with either, follow them and flag the conflict.
Every rule here is a failure condition. Cite MB-n in the Question 6 checklist when touched.

## Rules

**MB-1 Phase gate.** Billing is Phase 3. Until Phase 3 work is explicitly started there is no Flutterwave SDK, key, checkout, webhook handler, or cap-enforcement logic in the codebase. The /api/webhooks/flutterwave folder stays empty.

**MB-2 Rent, sale, and deposit money never touches Domora** (PR-BIL-001, AGENTS-Q3#17). No fields, endpoints, statuses, fees, escrow, "booking fee", deposit tracking, or payment links between users. `Listing.price` is display information only.

**MB-3 Flutterwave scope.** Flutterwave is used only for the AGENCY_PRO Subscription charge, only inside /modules/billing, and only through its hosted checkout. Domora never receives, stores, or logs card or bank details.

**MB-4 The server owns the price** (PR-BIL-003). The plan-to-amount mapping lives server-side. The client sends only a plan identifier — never an amount, currency, or reference. The server generates a unique `tx_ref` and persists the expected amount, currency, and agencyId before redirecting to Flutterwave.

**MB-5 The webhook is verified first.** Read the raw body as text before parsing. Verify the signature or secret using the mechanism in Flutterwave's documentation for the API version in use, with a constant-time comparison. On failure, reject with a 4xx and no database write. Query parameters or redirect success never change state (AGENTS Q2).

**MB-6 Confirm before flipping.** After the signature check, confirm the transaction server-to-server through Flutterwave's transaction verification. Set tier to AGENCY_PRO only if the status is successful AND amount equals the stored expected amount AND currency equals the stored expected currency AND `tx_ref` matches a pending checkout the server created for that agency. Any mismatch → no state change, and log for review.

**MB-7 Processing is idempotent.** A duplicate or replayed event must have no second effect. This needs a durable record of processed transaction IDs with a unique constraint. The schema has none: get that extension approved before building Phase 3. In-memory dedupe is forbidden.

**MB-8 Integer money, one conversion point.** Internally, amounts are integers in minor units (AGENTS-Q3#21). Flutterwave uses major-unit decimals. Convert in exactly one function in /modules/billing using integer or string arithmetic — never `parseFloat(x) * 100`, never float equality. The currency's exponent comes from the currency, not a literal `100` scattered through code. Tests include amounts like 1, 99, 100, and 12345.

**MB-9 Currency is explicit.** An amount always travels with its currency. The schema has no currency field. Never hard-code a currency; stop and flag before building.

**MB-10 Who can pay.** Only the AGENCY_ADMIN who owns the AgencyProfile can start checkout for or view its Subscription. Everyone else gets a 403.

**MB-11 Subscription state is computed on the server clock.** [ASSUMPTION — most restrictive] AGENCY_PRO is active only when tier is AGENCY_PRO and `endsAt` is set and in the future. Expiry is evaluated at read time, with no dependency on a cron job.

**MB-12 Billing never makes trust decisions.**
- No billing event (payment, failure, expiry, downgrade) changes Listing.status or verification status, or suspends anything (AGENTS-Q3#5, #10, #11).
- Paying never shortens or skips review, and never grants "verified" status.
- Featured placement affects search ranking only.
- Losing PRO must not delete or suspend existing listings. What happens to over-cap listings is undefined in the PRD, so flag it — do not build it.

**MB-13 Caps are enforced atomically.** The cap check and the listing creation or activation share one transaction (CS-4). [ASSUMPTION — most restrictive] The count includes ACTIVE and PENDING_REVIEW listings. An affiliated agent is uncapped only while the agency's PRO is active and the agent's AgencyAffiliation is ACCEPTED. A FREE-tier AgencyProfile has no cap field — do not invent one; flag it.

**MB-14 Failure states change nothing.** A failed, abandoned, or pending payment leaves the tier unchanged. Refunds, chargebacks, proration, retries, and invoices are not in the PRD and are not built. If a task implies them, flag it and stop.

**MB-15 Secrets and modes.** Flutterwave keys and the webhook secret come from server-only env vars. Test keys never run in production and live keys never run in dev or CI. Never log secrets; log webhook events by ID and status only.