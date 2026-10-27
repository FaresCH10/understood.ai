# Worker Interface Language

## Current behavior — 26 October 2026

The approved server session language now controls the worker interface in all 15 supported locales. Device settings submit a supervisor-approval request; the interface stays in its approved language while the request is pending. Tab preferences cannot override the approved session language. First-use identity language selection remains a separate flow. See [requested fixes](REQUESTED_BUG_FIXES.md) for current checks and service limitations.

## Historical checkpoint (superseded language-selection policy)

2026-10-08 18:31 UTC checkpoint. Local synthetic evidence, not production acceptance.

Device settings now select English, Arabic or Urdu for worker controls. This is a tab/session-scoped interface preference, not an update to worker identity or assignment language. The original server session is never mutated: request context, frozen content, answer/audio language, draft scope and stored site notice remain unchanged. Content and site notice carry their own language/direction attributes inside the localized interface.

The bounded `understood:worker-ui-language` tab record contains only interface code, non-credential client context and exact expiry. It restores only for the current valid session. Expired, malformed, oversized, denied or foreign-context records fall back to the server's language. Saving requires exact storage readback; failure leaves the displayed language unchanged and reports a localized error. Existing shared-device cleanup removes the preference. No API, provider or translation request is made for this setting.

Saved text/audio controls and their lazy-load error states use the selected interface language without changing storage identity. Recorder controls use the interface language while independently validating and displaying the original server-supplied notice language. Switching is only available in device settings; existing unsent-work navigation and session fencing remain in force.

## Verification

- Full suite 95834: 483 tests, 480 passed, zero failures, three external PostgreSQL skips, 105.467 seconds. An earlier sandbox-restricted attempt was stopped after localhost HTTP failures and is not counted as a passing run.
- Final notice-language and content-direction adjustment follows the full suite. Strict rebuild passes; focused session/language/notice/text/audio checks afterward: 21 passed, zero failures. Entry `index-C_KgIfss.js` 481.51 kB / 130.30 kB gzip. All 38 public-shell hashes match.
- Final built credential-scoped memory-only fixture 97390 verifies actual 320px Arabic/Urdu device controls, reload retention, Urdu inbox with frozen English assignment, English question/title/notice inside Urdu controls, and an enabled localized record button after validated notice without requesting microphone permission. Fresh same-worker session returns to English rather than inheriting prior Arabic choice. Desktop Arabic screenshot inspected.
- Screenshots: `artifacts/generation-languages/worker-ar-device-mobile.jpg`, `worker-ur-device-mobile.jpg`, `worker-ur-notice-mobile.jpg`, `worker-ar-device-desktop.jpg`. Fixture stopped, temporary tab closed, viewport reset. Main synthetic/email-disabled preview 43805 remains at 3020/3021, restored and browser-verified at original 30/25/22/3/5 counts. Eight selected business-table hashes, integrity and foreign-key checks remain unchanged.

Pre-access localized language selection, language administration, independent native-language evaluation, hardware recording, real PostgreSQL and cloud release gates remain. Tab storage is not cross-device preference storage or a secure vault. Approximately 70% planned implementation, not readiness. Gemini free-tier content remains synthetic-only; Neon Free remains the chosen database target, with no account provisioning or deployment.
