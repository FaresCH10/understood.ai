# 11 — Exhaustive UI audit

Audit date: 2026-11-12. Candidate: `main` at `3874ad7` plus the UI fixes below. This is a synthetic, headless-browser audit. It is not physical-device, assistive-technology, native-speaker, or production acceptance.

## Scope

| Surface | Coverage |
|---|---|
| Staff routes | 37 routes × desktop 1280×900 and phone 390×844 |
| Public routes | 20 routes at desktop 1280×900 |
| Arabic staff | 37 routes at phone 390×844, RTL |
| Worker locales | 15 locales × inbox, instruction detail, device, help (60 checks) at 390×844 |
| Operator console | 10 tabs at desktop 1280×900 |
| Total page checks | 201 |

Routes included: Today, instructions, instruction detail, new instruction, send, calendar, people, new worker, crews, new crew, import, worker detail, clarifications, new clarification, clarification detail, reports, notifications, search, settings (organization/site, staff, invitations, invoices, new invoice, usage, retention, pilot setup), language readiness, AI processing, source audio, glossary, new term, templates, translation feedback, first-run, operations, unknown route, unknown settings tab; public home, platform, how it works, languages, companies, plans, pricing, contact, walkthrough, pilot, support, support guide, sign-in, register, register/pro, account recovery, reset password, accept invitation, verify registration, worker access; operator command center, support desk, processing jobs, workspaces, entitlements, translation feedback, AI & quotas, dispatch controls, audit trail, troubleshooting.

## Method

- Playwright with installed Microsoft Edge, headless.
- Isolated synthetic fixtures: staff SQLite fixture (3220), worker/offline fixture (3194), operator PGlite fixture (3195).
- Per page: document title, visible `h1`, horizontal overflow, visible controls without an accessible name, duplicate IDs, images without `alt`, heading presence, English UI strings in Arabic/non-English worker locales, page/console/HTTP errors.
- Screenshots saved under `docs/audit/evidence/ui-audit/`.
- Raw results: `docs/audit/evidence/ui-audit/ui-audit.json`.

## Results

- **No horizontal overflow** at any audited route/width.
- **No duplicate IDs** and **no images without `alt`** in the audited surfaces.
- **No page/console/HTTP errors** after the fixes. The earlier public `hero/journey-paper.svg` 404 and worker fixture `/server/languages.mjs` 500 are resolved.
- **Staff titles and `h1`s** are present and localized for the audited routes, including translation feedback, first-run, unknown routes, and unknown settings tabs.
- **Arabic staff** routes render `lang=ar dir=rtl`; first-run is now Arabic; translation feedback has a localized heading and title.
- **Worker titles** are now meaningful and localized (inbox, instruction, device, help, notifications, crew) instead of every page being “Understood”.
- **Operator** tabs all have a title, `h1`, no overflow, and no unnamed controls.
- **Filipino** Help/Device copy no longer contains the untranslated “voice help”/“Help request” phrases.

## Fixes made from this audit

| Fix | Files |
|---|---|
| Serve the landing paper texture from the Node static server | `server/public-build.mjs` |
| Staff route titles for translation feedback, first-run, unknown routes, operations | `src/main.tsx`, `src/staff-static-ar.ts` |
| Translation-feedback page heading | `src/main.tsx` |
| First-run page follows the current staff interface language | `src/FirstRunOnboarding.tsx` |
| Worker document titles per view/locale | `src/main.tsx` |
| Filipino Help/Device/audio copy | `src/worker-help-device-copy.ts`, `src/worker-followup-text.ts`, `src/worker-audio-draft.ts` |
| Worker fixture serves the shared language registry | `scripts/offline-browser-fixture.mjs` |

## Remaining UI findings

1. **Public footer brand link has no accessible name.** The footer `<a class="landing-brand">` contains only the logo SVG. This is a real accessibility issue, but `PublicProduct.tsx` is a protected landing-page file and was not changed. Recommended fix when landing-page changes are authorized: add `aria-label` (e.g. the localized home label) to the footer brand link.
2. **Staff sidebar backdrop is intentionally unnamed.** It is `aria-hidden="true"` and `tabIndex={-1}`; it is not exposed to assistive technology. The audit’s generic “unnamed control” check flags it, but it is not an accessibility defect.
3. **Arabic `Work`/`Help` matches are false positives or user content.** “Work” matches “Workspace”; “Help” in the clarification detail is the worker’s own answer text (“Please help with the second shelf.”). They are not untranslated UI labels.
4. **Operator console is English by design.** The Arabic staff sweep shows the operator page in English; operator access is a separate English-only platform surface.
5. **Filipino loanwords.** “Device”, “Naka-save”, and “Mag-sign out” are accepted Filipino usage/loanwords, not missing translations.
6. **No physical-device, microphone, shared-device, or assistive-technology acceptance.** Headless viewport checks do not replace those.
7. **No native-speaker review** of the 15 worker locales or Arabic staff copy.

## Reproduce

```bash
npm install --no-save playwright-core@1.49.1
node scripts/staff-session-browser-fixture.mjs
node scripts/offline-browser-fixture.mjs
UNDERSTOOD_QA_OPERATOR_PORT=3195 node scripts/operator-browser-fixture.mjs --confirm-local-operator-ui
node docs/audit/evidence/ui-audit/run.mjs
```

The script expects the staff fixture on 3220, the worker fixture on 3194, and the operator fixture on 3195. It writes `ui-audit.json` and screenshots into the same evidence directory.

## Evidence

- `docs/audit/evidence/ui-audit/ui-audit.json` — raw per-page results.
- `docs/audit/evidence/ui-audit/staff-*.png` — staff desktop/phone screenshots.
- `docs/audit/evidence/ui-audit/arabic-*.png` — Arabic staff phone screenshots.
- `docs/audit/evidence/ui-audit/public-*.png` — public route screenshots.
- `docs/audit/evidence/ui-audit/worker-*-inbox.png` — all 15 worker locale inbox screenshots.
- `docs/audit/evidence/ui-audit/operator-*.png` — operator tab screenshots.

## Verdict

The signed-in and public UI is now audited across every route in the current app, all 15 worker locales for the core worker surfaces, and all operator tabs. The remaining UI issues are one protected-file accessibility gap, intentional hidden controls, false-positive string matches, and the external device/AT/native-language acceptance gaps. This is not a WCAG certification or a physical-device acceptance claim.
