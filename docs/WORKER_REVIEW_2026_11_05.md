# Worker workflow review — 5 November 2026

## Source and scope

Fast-forwarded the existing clean `understood-crews` checkout from `b98792e` to upstream `90ea21e` (`fixing the worker page`). Preserved the separate older `understood-app` checkout and its local edits.

Reviewed the supplied worker audit against the updated implementation. Much of that audit had already been addressed upstream: explicit live Vercel admission, a durable-worker deployment contract, bounded attachment transport, mandatory live scanning, transactional completion notifications, server-paginated work summaries, worker progress, attachment previews, Help reasons, Device settings, and language-direction helpers.

This follow-up fixes confirmed gaps in those implementations. It does not modify the landing page or sign-in page, migrate production data, configure providers, or deploy cloud services.

## Corrections

### Work state and supervisor resolution

- A resolved case attached to the latest assessment now permits work to progress. The original assessment outcome and answer remain unchanged.
- An older resolved assessment cannot approve a newer failed answer. Any open help case continues to block completion.
- The worker list, exact work detail, staff work history, instruction library, and crew instruction history use the same corrected classification.
- Active status filters exclude withdrawn and superseded publications; unfiltered history retains them.
- Stale completion attempts refresh the actual state and present a retry/error state. A business-level HTTP 409 no longer signs out the worker. Authentication/context failures still invalidate the session.
- Completion actions respect parent activity, detail loading, and read failures. Late responses from an obsolete screen cannot invalidate the current screen's session.

### Attachment safety and concurrency

- SQLite workspace operations are serialized on their shared connection to avoid nested workspace transactions.
- Both database adapters authorize and validate first, roll back before external malware scanning, and repeat authority, entitlement, draft/publication and file checks before persisting or releasing bytes.
- Verdict reuse is limited to one operation and bound to the file digest, MIME type and name. Unknown/infected verdicts and unavailable scanning continue to fail closed.
- SQLite rechecks staff role and session revocation/expiry. Signing out or disabling the account during a scan prevents the subsequent upload.
- Closing an enlarged photo preserves the thumbnail and returns keyboard focus to its trigger. Photo loading/errors are visible outside the dialog; preview dialogs retain keyboard focus.
- Preview labels and feedback cover every selectable worker locale. Worker attachment requests reject redirects.

### Worker usability

- The default “both” delivery mode displays the transcript immediately while retaining playback.
- Acknowledgement-only instructions show an acknowledgement step instead of “Answer check.”
- Help uses the same lightweight, paginated active-work summaries as the inbox, including the sending supervisor and follow-up state.
- Help forms are collapsed until requested, open with keyboard focus, preserve unsent input, and respect reduced-motion preferences. Unavailable Help does not expose an empty form.
- Inbox and Help recover when the last page disappears after a refresh or completion.
- Progress labels meet the automated contrast check. Long translated tabs, Help headings and action labels wrap at 320 px.

## Verification

Evidence is generated locally under the ignored `artifacts/worker-review/` directory. The browser fixture uses only a loopback listener, an isolated in-memory SQLite database, fictional people, synthetic instructions and disabled outbound mail/provider integrations.

- Targeted regression tests cover work completion, latest-assessment resolution, fresh help blocking, pagination, withdrawn filters, transactional notification behavior, scanner failures, transaction release, access revocation, and SQLite/PostgreSQL behavior.
- Browser journeys cover text and audio presentation, Help prefilling/focus, photo/PDF dialogs, resolving follow-up through completion and Done, stale completion without logout, and inbox shrinkage.
- Layout and automated accessibility checks cover Inbox, instruction detail, Help and Device at 320 px for all 15 selectable locale codes, plus English/Arabic inboxes at 768 and 1440 px. These represent 14 languages with Punjabi's two supported scripts.
- TypeScript/build verification and whitespace checks are recorded alongside the test evidence.
- Automated accessibility checks are not a substitute for assistive-technology or native-speaker acceptance.

Final results: the 111-test regression group passed with zero failures/skips in 207.8 seconds (`tests.log`). A subsequent 14-test security/workspace run passed with zero failures/skips, including the additional staff-sign-out-during-scan regression (`security-regressions.log`). These runs overlap; together they cover 112 distinct tests. The final browser run passed all 69 checks with zero recorded JavaScript errors, document overflow or axe violations in the checked screens (`browser-results.json`, `browser.log`). The final TypeScript/Vite build exited successfully (`build.log`); `git diff --check` passed. The complete repository suite was not rerun.

## Remaining external work

The updated upstream deployment contract is configuration and code, not evidence of a live release. Before using real worker data:

1. Run the actual approved hosted API and persistent queue worker with their restricted PostgreSQL roles, private storage, reviewed manifest and provider configuration. Prove the hosted instruction-to-answer-to-supervisor journey and restart/retry recovery.
2. Deploy a genuine malware-scanning service and verify its privacy, retention, capacity and failure behavior. This change does not provision one.
3. Review representative translations, questions and generated speech with native speakers. The existing pipeline correctly continues to report language quality as untested.
4. Validate recording, playback and notifications on consenting physical Android/iPhone/desktop devices and supported browsers, with independent accessibility/security review.
5. Use direct private-object-storage uploads with a durable quarantine lifecycle if larger attachments or higher volume are needed. The current gateway intentionally retains its 3 MiB file limit, five-file limit and 10 MiB aggregate limit; existing records are preserved.

The pre-existing large-bundle and ineffective-dynamic-import build warnings remain. No claim of production readiness or full-suite completion follows from these focused checks.
