---
name: ui-component-builder
description: Run this skill for anything a user sees: components, screens, styling, or the design system.
---

# UI Component Builder

## Trigger
Load this skill for:
- components;
- screens;
- styling;
- design-system work;
- user-visible states or flags.

## Required workflow

1. **Identify the user-visible requirement.**
   - Trace the screen/component to a PRD behavior.
   - Do not add product behavior merely because it is convenient to represent in the UI.

2. **Use semantic tokens.**
   - Use the project's semantic design tokens rather than hard-coded presentation values when the design system supplies the concept.
   - Keep component styling consistent with the existing design system.

3. **Fill token gaps deliberately.**
   - When a required semantic token does not exist, follow the project's gap-filling procedure rather than inventing one-off values at the component.
   - Keep the new token semantic and reusable.

4. **Render flags visibly and accessibly.**
   - Status/report/verification flags must be visible without relying on color alone.
   - Include text, iconography, or another non-color cue where needed.

5. **Respect the 360px floor.**
   - Components and screens must remain usable at 360px width.
   - Check wrapping, overflow, controls, and readable status information at that floor.

6. **Keep business decisions out of UI code.**
   - The UI can present server results and validation feedback.
   - Authorization, caps, thresholds, and state-transition decisions remain in `/modules`.

## Hard stops
- No color-only status indication.
- No hard-coded one-off token substitute when the token gap procedure applies.
- No layout that requires more than the 360px minimum viewport.
- No client-side bypass of server authorization or business rules.

## Source trace
AGENTS.md establishes App Router/Server Component boundaries and keeps business logic in `/modules`; PRD establishes user-visible states such as verification, listing review, report flags, booking statuses, and notification outcomes. Semantic-token, token-gap, flag-rendering, and 360px rules are project UI rules supplied with this skill.