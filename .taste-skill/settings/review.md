# Settings design review

Direction: Achromatic ledger, seed 1814704144. Existing Understood typography,
forest green primary actions and main application shell are retained. The settings
workspace uses a quiet sage ground, neutral navigation and clear ledger-style rows.
No sample data or asset substitutions were added.

The screen answers: which workspace settings need my attention, and where can I edit them?
The seven sections keep their existing role checks, routes, request handlers and confirmations.

## Before

- Seven tabs compete with the page heading; navigation is hard to scan on narrow screens.
- Staff uses an empty second grid column and its table scrolls inside a narrow first column.
- Organization metadata, invitations, billing, setup and privacy use different panel and form spacing.
- Privacy policies form a long, undifferentiated stack.

## After

- A 176px settings rail and 28px gutter frame a flexible content sheet at desktop width.
  Under 1280px the local navigation becomes a horizontally scrollable row and keeps
  the selected destination visible. The main application sidebar remains unchanged.
- Staff tables use the full content width. Mobile rows decreased from 208.6px to
  122.5px while preserving name, role, site, status and the detail action.
- Shared headings, 40–44px controls, consistent spacing, readable confirmation blocks,
  empty states and form dialogs cover all seven settings sections.
- Privacy policy disclosures retain mounted form state. Pending requests and errors
  open their disclosure so a receipt check or error remains discoverable.
- GSAP supplies the active-navigation marker and short reveals for user-opened
  forms, staff details, invitation dialogs, policies and pilot stages. Reduced-motion
  preferences skip these tweens. No full-page entrance animation was added.

## Verification

- Inspected the running app at desktop, 768px tablet and 390px phone widths.
- All seven destinations fit the 390px viewport. Measured document width was at
  most 390px; local navigation scrolls in its own frame.
- Inspected Arabic RTL on the phone and restored English afterward.
- Opened and cancelled site editing, staff role editing and the invitation dialog;
  inspected the new invoice form, recording notice disclosure, usage and pilot setup.
- Reticle proved navigation to organization, staff, invitations, invoices, usage and
  privacy, plus the invoice form, invitation dialog and staff detail opening.
- Production build and type checking pass. 39 focused regression tests pass.
  Four HTTP tests initially hit the sandbox's localhost EACCES restriction and
  passed when rerun with local loopback access.
- Design lint: zero failures; one allowed shadow warning on a native floating dialog.
  Screenshots were inspected through the authenticated browser rather than a fresh
  unauthenticated inspector session. Advanced retention categories are not enabled
  in this local demo; their shared disclosure and policy logic were type checked.
