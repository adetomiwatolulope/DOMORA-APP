---
name: ai-provider-adapter
description: Run this skill for anything inside src/services/ai: adapters, prompts, confidence mapping, or provider switching.
---

# AI Provider Adapter

## Trigger
Load this skill for:
- changes under `src/services/ai`;
- provider adapters;
- prompt changes;
- confidence mapping;
- provider switching.

## Purpose
Teach the AiService contract, the two dated human sign-offs, response validation, normalization, and the fabrication net that enforces R11.

## Required workflow

1. **Respect the current AI boundary.**
   - The supplied Domora PRD says the MVP working default is no AI/LLM integration.
   - Do not introduce an AI feature into the MVP merely because an adapter location exists.
   - If AI scope has not been explicitly confirmed, stop and flag the scope conflict.

2. **Implement behind the AiService contract.**
   - Provider-specific code belongs behind the common service contract.
   - Callers must not depend directly on provider-specific response shapes.

3. **Record the two dated human sign-offs.**
   - Preserve the project's two required dated human approvals before an AI/provider change is treated as accepted.
   - Do not fabricate dates or approvals.

4. **Validate provider responses.**
   - Treat provider output as untrusted external input.
   - Validate the response shape before normalization or business use.

5. **Normalize outputs.**
   - Convert provider-specific fields into the canonical application representation.
   - Keep confidence mapping deterministic and documented.

6. **Apply the fabrication net.**
   - Enforce the project's R11 anti-fabrication rule at the adapter/service boundary.
   - Invalid, unsupported, or fabricated output must not be promoted into trusted product data.

## Hard stops
- No AI call in the MVP without an explicit scope decision.
- No direct provider coupling in business modules.
- No unchecked provider response.
- No invented confidence or result when the provider did not return one.
- No fabricated human sign-off.

## Source trace
The PRD explicitly states that no AI/LLM integration ships in MVP and that any future AI must be advisory, reviewer-routed, and redaction-aware. The AiService, dated sign-offs, R11 fabrication net, and exact adapter contract are project rules supplied with this skill and must be preserved rather than inferred.