# Audit fixes — 8 November 2026

These changes address the findings in [the live audit](../output/playwright/live-audit-2026-11-07/REPORT.md). They are local source changes. They have not been deployed or verified on the hosted application.

| Finding | Change | Evidence |
| --- | --- | --- |
| F01: worker sign-in failure disappears | Keep authentication errors visible until the next action. | Local browser: `login-error-persistent.png`, checked after 4.2 seconds. |
| F02: composer keeps stale recipient languages | Refresh recipients on focus and visibility changes. Add a manual refresh button. Block sending while a refresh is pending or fails. | Local browser: `readiness-mobile.png`; audience and readiness checks. |
| F03: unsupported translation and audio | Check preparation capabilities before sending. Show unavailable languages and block unsupported delivery formats. Synthetic mode supports arbitrary English text and the existing fixed multilingual example. | `instruction-readiness.test.mjs`; local supported English send and unsupported audience checks. This does not add live translation services. |
| F04: question and choices test different facts | Build a fact-specific synthetic question only when the choices vary that fact. Use short location answers for supported patterns. Otherwise use the whole-instruction synthetic check. | Instruction and choice-quality regression tests. Live-provider preparation is unchanged. |
| F05: submitted answer still says waiting | Show received or pending assessment status from the receipt. | Worker receipt and submission-client regression tests. |
| F06: recovery warning appears during normal writes | Show recovery actions after an unresolved request, rather than during an active request. | Local browser: `sending-without-false-recovery.png`; actual send then confirms in `local-send-confirmed.png`. |
| F07: repeated service failures after connection loss | Retire a poisoned cached PostgreSQL runtime before the next request. Share one replacement initialization. Never replay a write. Preserve worker form mutation errors when directory refresh succeeds. | Runtime-cache regression tests; local fault injection in `worker-error-retained.png`. |
| F08: mixed staff language and direction | Translate Arabic mobile Today navigation. Limit the staff workspace picker to English and Arabic. Explain the fallback for an existing Urdu workspace preference. Keep worker language options and translated auth routes. | Staff locale checks; local browser: `arabic-navigation.png`. |
| F09: failed draft save traps navigation | Offer Keep working or Discard and leave after save failure. Discard removes local unsaved changes; it retains the saved server draft. | Local fault-injected save failure: `discard-after-save-failure.png`, followed by successful navigation. |
| F10: synthetic assessment and export jobs stay queued | In the explicitly enabled synthetic Vercel runtime, process a bounded assessment and export job on authenticated status reads. Scope claims to the current organization and site. | PostgreSQL HTTP regression covers completed assessment/export and rejects foreign-scope claims. Live mode still requires a durable worker. |
| F11: crew detail fails strict validation | Normalize worker language and pending-request timestamps to canonical ISO strings in PostgreSQL DTOs. | PostgreSQL crew regression exercises actual JSONB timestamps and a disabled member through the strict client reader. |

The repeat deadline field now shows its required state. Report recovery metadata is under Support details.

## Validation

- Production frontend build passed. Existing bundle-size and dynamic-import warnings remain.
- Targeted regressions passed for instructions, readiness, choices, runtime recovery, PostgreSQL instructions and worker IDs, production-mode configuration, scoped job processing, worker receipts, submission clients, clarification creation/actions, conversation, reviews, session fencing, report views, leases, crew state and staff locale.
- Final conversation coverage exposed an existing SQLite seed case in the test fixture. The test now closes that case before creating its isolated case. SQLite and PostgreSQL conversation checks pass with the translation boundary intact.
- `git diff --check` passed.
- Browser evidence uses a local seeded SQLite app and local fault injection. It is not evidence of a production deployment. Screenshots are in `output/playwright/audit-fixes-2026-11-07/`. Reticle had no connected session; browser checks used Playwright.

## Deployment requirements

Deploy the reviewed application changes to make them available on the hosted site. The audit found that deployment running in synthetic mode. Arbitrary translations, generated audio and live assessments require the approved provider configuration and durable worker described by the repository's production configuration templates and runbooks. No provider credentials, database settings or deployment settings were changed here. No production writes were replayed.

After deployment, repeat the affected worker creation, language selection, send, worker response, crew detail and report-export journeys. Check live language output with the configured providers; these local checks do not certify translation quality across all worker languages.
