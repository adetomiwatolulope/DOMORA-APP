---
name: flutterwave-billing
description: Run this skill for anything where kobo moves: payments, webhooks, subscriptions, credits, refunds, or the watermark gate.
---

# Flutterwave Billing

## Trigger
Load this skill for:
- payments;
- Flutterwave webhooks;
- subscriptions;
- credits;
- refunds;
- the watermark gate;
- any change where a monetary balance moves.

## Required workflow

1. **Confirm the allowed money boundary.**
   - Flutterwave is the only payment provider.
   - The product's confirmed/working billing boundary is Agency subscription billing.
   - Rent, sale, and deposit money does not become platform money under the MVP working rule.

2. **Compute money server-side.**
   - Store money in the smallest currency unit as an integer.
   - Never trust a client-provided price, fee, or amount.

3. **Verify webhook before state change.**
   - Verify the Flutterwave webhook signature first.
   - Do not change subscription state based only on a client-side success redirect.

4. **Use reference-based idempotency.**
   - Process a payment reference once.
   - Repeated delivery of the same verified webhook must not duplicate the financial effect.

5. **Pair balance changes atomically.**
   - When the project flow changes a balance/ledger state, perform the ledger entry and paired balance mutation atomically.
   - Never leave one side committed while the other fails.

6. **Apply the watermark gate.**
   - Preserve the project's watermark gate before allowing a gated financial or export action.
   - Do not bypass the gate for convenience.

## Hard stops
- No Stripe, Paystack, or alternate processor.
- No client-authoritative amounts.
- No subscription-state change before webhook verification.
- No rent/sale/deposit payment flow.
- No float/decimal money representation.
- No non-idempotent webhook handler.

## Source trace
AGENTS.md locks Flutterwave as the only provider, restricts it to the Agency Subscription flow, requires signature verification before subscription changes, requires server-side amounts, and requires integer smallest-unit money. The reference-idempotency, atomic ledger-pairing, credits/refunds, and watermark-gate mechanics are project rules supplied with this skill.