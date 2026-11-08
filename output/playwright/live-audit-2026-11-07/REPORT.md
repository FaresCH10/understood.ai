# Live workflow audit — 7 November 2026

Target: https://understood-ai.vercel.app/
Status: Audit pass finished with the blocked/unverified cases below explicitly retained. Browser UI tests against live production. No source changes made for this audit.
Account role observed: Owner, Nexus organization/site. Supervisor-role permissions have not been verified.

## Read this first

**The English acknowledgement → work completion flow passed. The multilingual comprehension workflow did not pass in this deployed environment.** All 15 worker language/script interfaces were exercised; this is not a native-speaker certification of their wording. Eleven non-English target languages had explicit unavailable/no-prepared-content outcomes; the final Punjabi/Indonesian send also displayed no prepared content and then draft-save failures. No successful non-English instruction acceptance is claimed.

The supplied account is an **Owner**, so the tested supervisor-facing workflows are owner-authorized workflows. A separately provisioned Supervisor role and its permissions were not tested.

Priority order for remediation:

1. **Restore preparation/assessment/background processing and explain readiness before sending** (F03, F07, F10). Browser evidence establishes missing delivery, pending assessment, 503 responses and queued CSV; server logs are needed to determine the cause.
2. **Fix question/choice alignment and contradictory progress labels** (F04, F05).
3. **Show actionable failure feedback and an escape from failed autosave** (F01, F02, F06, F09).
4. **Finish supervisor localization** (F08).

All proposed fixes below are recommendations, not changes made to production. Screenshots and exact steps support each finding; intermediate Saving/Sending images are identified as intermediate and are not counted as success.

## Finding index

| ID | Priority | Observed issue | Evidence |
|---|---|---|---|
| F01 | Medium | Wrong password rejected without visible feedback | [Screenshot](D:/understood/understood/output/playwright/live-audit-2026-11-07/02b-invalid-login-final.png) |
| F02 | Medium | Recipient language stays stale until composer reload | [Screenshot](D:/understood/understood/output/playwright/live-audit-2026-11-07/05-send-blocked.png) |
| F03 | High: deployment blocker | Non-English instruction content unavailable | [Screenshot](D:/understood/understood/output/playwright/live-audit-2026-11-07/07-check-receipt.png) |
| F04 | High | Question and choices check different facts | [Screenshot](D:/understood/understood/output/playwright/live-audit-2026-11-07/09-question-choice-mismatch.png) |
| F05 | Medium | Received answer still says waiting for response | [Screenshot](D:/understood/understood/output/playwright/live-audit-2026-11-07/11-answer-pending-progress.png) |
| F06 | Medium | Normal in-flight actions appear as unknown/recovery failures | [Screenshot](D:/understood/understood/output/playwright/live-audit-2026-11-07/12-help-request.png) |
| F07 | High | 503 on repeat answer and worker creation | [Screenshot](D:/understood/understood/output/playwright/live-audit-2026-11-07/15-repeat-answer-503.png) |
| F08 | Medium | Arabic/Urdu supervisor localization gaps | [Screenshot](D:/understood/understood/output/playwright/live-audit-2026-11-07/30-supervisor-urdu-mobile.png) |
| F09 | High | Autosave failure blocks navigation without discard alternative | [Screenshot](D:/understood/understood/output/playwright/live-audit-2026-11-07/31-draft-failure-blocks-navigation.png) |
| F10 | Blocked/unverified completion | CSV remains queued after approximately 11 minutes | [Screenshot](D:/understood/understood/output/playwright/live-audit-2026-11-07/32-report-photo-and-queued-export.png) |
| F11 | High | Crew detail unavailable after member disable despite HTTP 200 | [Screenshot](D:/understood/understood/output/playwright/live-audit-2026-11-07/36-crew-unavailable-after-disable.png) |

## Evidence rules
A passed interface does not prove translation accuracy or audible speech quality. UI observations, network observations, hypotheses and untested cases are reported separately. Existing user workers/instructions are not modified. Test records begin QA1107.

## Confirmed findings so far

### F01 — Incorrect worker password has no visible failure explanation
Steps: worker sign-in; correct Company ID; QA worker NE-006; deliberately wrong password; Sign in.
Observed: browser console reports HTTP 401 from `/api/auth/worker/login`; Opening… returns to Sign in, with no visible error or alert. No worker session created.
Expected: translated invalid-credentials message and accessible alert while preserving useful fields.
Evidence: `02b-invalid-login-final.png`; browser console inspection. The earlier `02-worker-invalid-password.png` captures a pending state, not the final outcome.

### F02 — Open composer retains outdated worker language
Steps: create NE-006 with Worker chooses on first use; open send form; worker logs in separately and confirms English; choose all eight QA1107 workers in the existing composer.
Observed: English worker still labelled Language not selected; Send instruction disabled; requires selecting a language in Team. Reload restores the draft, refreshes the worker language and enables Send instruction.
Impact: supervisor can be blocked even after worker has completed onboarding, with no refresh-recipient action shown.
Solution: refresh audience on window focus/recipient opening, or provide Refresh recipients; preserve draft and selected worker IDs.
Evidence: `05-send-blocked.png`; before/after browser state. Draft 517de33f-bbfb-428f-9bcb-66811f2f8199.

## Passed checks so far
- Owner sign-in succeeded using supplied credentials.
- Empty worker creation blocked; browser required validation identifies worker password and name (`01-worker-required-fields.png`).
- Eight QA workers created: NE-006 English (first-use), NE-007 Arabic, NE-008 Hindi, NE-009 Urdu, NE-010 Bengali, NE-011 Malayalam, NE-012 Tamil, NE-013 Telugu.
- First-use language screen offers all 15 language/script options; English selection opens inbox.
- Active-worker limit enforced at 25 with an actionable message; no extra worker created (`03-worker-creation-error.png`). This is a plan constraint, not a bug.
- Saved draft reload preserved title, source, selected eight QA workers, question mode and text-only delivery.

## Observations requiring care
- Initial landing load remained on Loading Understood…; reloading eventually loaded normally. A request to `/api/session` was aborted during reload. This alone does not prove an application defect.
- Existing workspace had 17 workers and existing instructions. They are outside the audit test audience.
- QA1107 test workers use a dedicated audit password, omitted from this report. No account passwords/tokens are included in this report.

### F03 — Non-English delivery fails in a text-only multilingual send
Observed receipt for audit instruction A: state published, delivered 1, undelivered 7, each failed with `language_unavailable` (ar, hi, ur, bn, ml, ta, te). English reached NE-006's inbox. Arabic language review shows Title/Instruction: Not available.
Evidence: `07-check-receipt.png`, `08-language-preparation.png`; GET `/api/instructions/sends/517de33f-bbfb-428f-9bcb-66811f2f8199` HTTP 200, publication 1cf584e8-ef71-41c6-bf1b-19b5645de150. The pending-state image `06-send-receipt.png` is not a final receipt.
Impact: multilingual core workflow cannot complete for these seven languages in this deployment. Root cause is not yet established; do not claim the translations are inaccurate when none were delivered.
Solution: readiness checks before sending; expose preparation failure reason/action and configured-provider status; verify each target-language output before publication.

### F04 — Generated question and answer choices test different facts
Question: What must you keep clear?
All four choices repeat the full instruction and keep Keep the walkway clear unchanged; only the finished-item shelf changes (red/yellow/blue/green).
Impact: all choices answer the literal question correctly, although only one repeats the complete instruction correctly.
Evidence: `09-question-choice-mismatch.png`; English worker instruction 8343871a-29c1-4da2-a086-20bf0de102b0.
Solution: validate question/choice alignment; ask Which shelf is for finished items? with short colour choices, or ask about the walkway with genuinely different answers. Allow supervisor preview before sending.

### F05 — Received answer still described as Waiting for your response
Observed: answer submitted and shown as Received/Check pending, while progress says Waiting for your response. Refresh did not reconcile it. Help request later changed progress to Follow-up needed.
Evidence: `11-answer-pending-progress.png`. Assessment page explicitly states Synthetic local check; this is not live AI evidence.
Solution: distinguish awaiting response, received/pending assessment, needs follow-up, and ready for work; derive all visible labels from the same authoritative state.

### F06 — Recovery controls appear during normal in-flight requests
During send: An earlier send was not confirmed appears while current action says Sending…. During help request: Receipt is not confirmed; checking its receipt recovered the actual saved help request.
Impact: current in-flight work can look like a previous failure. Receipt recovery does work; duplicate delivery has not been demonstrated.
Evidence: `06-send-receipt.png`, `12-help-request.png`, `07-check-receipt.png`.
Solution: show a single Sending/Preparing state while pending; use timeout/recovery copy after a real uncertain outcome, preserve request IDs and receipt checking.

## Further verified scenarios
- Worker submitted a help request; it appeared in the owner clarification queue, with owner and follow-up deadline.
- Supervisor sent a clarification message; worker read it and replied. Both messages appeared in the supervisor conversation. `14-worker-received-supervisor-reply.png`.
- Repeat-answer request with future deadline was saved; worker could see the repeat question and original answer retained. A second pending repeat was prevented with Another answer is already requested for this assignment.
- Repeat submission of the corrected blue-shelf choice returned HTTP 503 from `/api/worker/briefings/8343871a-29c1-4da2-a086-20bf0de102b0/answers`; checking receipt did not confirm acceptance. `15-repeat-answer-503.png`. Assessment remains unverified, not passed.
- Leaving the uncertain repeat draft triggers Leave unsent work?; explicitly discarding the test draft allowed navigation. No real worker draft was touched.
- Acknowledgement-only instruction B (f26f70c8-7594-4383-9eb5-50b1d697f170) reached NE-006. Worker acknowledged it, progressed to In progress, then confirmed Mark work as done. Final page shows Work completed and a completion time. `17b-work-completed-final.png`. `16-worker-acknowledgement.png` and `17-work-done.png` are intermediate saving states.
- Seven non-English test workers signed in successfully and displayed localized empty inboxes at 390px; Arabic and Urdu used RTL, no page-wide horizontal overflow was detected. Screenshots worker-ar/hi/ur/bn/ml/ta/te.png. This verifies UI availability and absence of delivery, not native-speaker translation quality.
- QA workers NE-007 through NE-013 were disabled after testing to free active-worker capacity. Existing user workers were not disabled.

### F07 — Service-unavailable errors interrupt repeat answers and worker creation
Observed: corrected repeat answer returned HTTP 503 and could not be confirmed. Creation of QA1107 Punjabi (Gurmukhi) also returned HTTP 503 from `/api/people/workers`; the dialog remained open with no error text visible. Searching QA1107 Punjabi before retry did not show a created worker. Required-field validation had already passed.
Evidence: `15-repeat-answer-503.png`, `18-worker-create-503-no-error.png`, browser console endpoint/status observations.
Solution: investigate availability/request processing using server logs; show actionable errors in the form and preserve submitted fields; avoid marking requests delivered until receipt verification. Root cause is not established by browser evidence alone.

## Language coverage (observed UI, not a translation-quality certification)

| Language/script | Audit account | Localized mobile UI | Text instruction outcome |
|---|---|---|---|
| English | NE-006 before language change | Passed | A delivered; acknowledgement-only B completed |
| Arabic | NE-007 | Passed, RTL | A not delivered, language unavailable |
| Hindi | NE-008 | Passed | A not delivered, language unavailable |
| Urdu | NE-009 | Passed, RTL | A not delivered, language unavailable |
| Bengali | NE-010 | Passed | A not delivered, language unavailable |
| Malayalam | NE-011 | Passed | A not delivered, language unavailable |
| Tamil | NE-012 | Passed | A not delivered, language unavailable |
| Telugu | NE-013 | Passed | A not delivered, language unavailable |
| Nepali | NE-014 before correction | Passed | C: no recipient had prepared content |
| Filipino | NE-015 before correction | Passed | C: no recipient had prepared content |
| Sinhala | NE-016 | Passed | C: no recipient had prepared content |
| Russian | NE-017 before correction | Passed | C: no recipient had prepared content |
| Punjabi (Gurmukhi) | NE-006 after approved request | Passed | D displayed no prepared content; draft save also failed |
| Punjabi (Shahmukhi) | NE-014 after correction | Passed, RTL | D displayed no prepared content; draft save also failed |
| Indonesian | NE-015 after correction | Passed | D displayed no prepared content; draft save also failed |

Screenshots: `worker-<language-code>.png`. Codes: ar, hi, ur, bn, ml, ta, te, ne, fil, si, ru, pa-guru, pa-arab, id. English workflow evidence is in 09–19.

C draft: 2a030170-0b6c-4d77-9a67-b4123e255d1f; result `20-second-language-send.png` shows Instruction not sent / No recipient has prepared content in their language yet.
D draft: 531fd866-dcd1-4022-baf6-321ca55f3882; prepared audience `23-verified-punjabi-indonesian-audience.png` shows PA-GURU 1, PA-ARAB 1, ID 1.

Language-change approval worked. The old worker session locked on the next load with clear explanatory text; the app's Reload action recovered the session in Gurmukhi. No password re-entry was required. Earlier English assignments remained in historical English content; changing interface language does not retroactively demonstrate a translated publication.

Report check: acknowledgement-only B shows 100% response completion (1/1), Acknowledged 1, Match key facts 0, Matched/assessed 0/0 and understanding —. This is correct separation of acknowledgement from comprehension.

Automatic approval review blocked one attempted D send because test-account display names reflected their original languages. Read-only profile checks then proved current languages; screenshots `current-language-English.png`, `current-language-Nepali.png`, `current-language-Filipino.png`. The next prepared audience confirmed the intended language chips, and the test send was allowed. No action executed in the rejected call.

### F08 — Supervisor localization is incomplete
Arabic receipt screen is translated, but the bottom navigation still labels its first action Today. Selecting Urdu gives RTL layout while the receipt heading/body/actions remain in English (Instruction sent, Send already recorded, Acknowledge receipt, Photo required).
Evidence: `28b-arabic-mobile-unobstructed.png`, `30-supervisor-urdu-mobile.png`. Other supervisor screens and every individual string were not exhaustively evaluated in Urdu.
Solution: use the same translated navigation labels as the sidebar; either fully localize supported supervisor languages or make fallback language explicit. Avoid applying RTL to an English fallback without appropriate content direction.

### F09 — Failed autosave traps the supervisor on an unsaved draft
Steps: reopen audit D draft; draft save reports Operation unavailable. Click Today.
Observed: URL remains `/send/531fd866-dcd1-4022-baf6-321ca55f3882`; draft-error text remains. No discard-and-leave alternative is offered for this supervisor form. Repeating navigation did not leave. Clearing only the QA draft's title/source allowed navigation.
Evidence: `31-draft-failure-blocks-navigation.png`, before/after URL comparison. This is different from the worker guard, which did offer Keep working / Discard and leave.
Solution: retain safe local recovery but offer explicit Retry save, Copy unsaved text, and Discard and leave. A save outage must not block access to the rest of the dashboard.

### F10 — Audit CSV export remained queued, with no downloadable result
Export request 8fde7f3a-8336-41cc-834a-e2c7d140bf7c was created for acknowledgement-only B at 18:28 Asia/Beirut. At 18:39 the report still shows its CSV Queued, Ready to download 0. No second export was requested. A pre-existing older export also remained queued, but was not retried or changed.
Evidence: `32-report-photo-and-queued-export.png`, `25-mobile-report-export.png` (the latter is an intermediate recovery state).
Interpretation: export completion could not be verified during the audit; this does not establish that the queue will never finish or identify its server-side cause. Background processing availability needs investigation alongside the pending answer assessment.
Solution: verify export-worker/queue processing in server logs, show queue age/progress and delayed-job guidance, and make retry/cancel behavior clear and duplicate-safe.

## Attachment, crew and photo checks
- Created QA1107 Audit Crew (9eeedd63-23db-46ce-a10b-7dfa87358fb4). Empty crew had 0 active workers and Send instruction to crew disabled.
- Assigned only audit worker NE-017 (then corrected from Russian to English for media testing). Crew audience showed EN 1.
- An inert text attachment of 3 MB + 1 byte was rejected with Choose a file up to 3 MB (`26-attachment-size-validation.png`). Small audit-note.txt saved and displayed as 1 KB (`27b-attachment-saved.png`).
- E (bb7b9d23-5d15-40cc-b3e8-ff82c15fae59) was delivered to that crew member with acknowledgement-only, text, and photo required. Worker saw audit-note.txt. The attachment link's existence is verified; byte-for-byte download integrity is not yet verified.
- Worker could not acknowledge before selecting a photo. Selected an existing screenshot containing only QA test data; after saving, UI showed Photo Received, Acknowledged, In progress (`29b-photo-ack-final.png`). Report shows 1/1 photos received, 1 acknowledged, comprehension — (`32-report-photo-and-queued-export.png`).
- Voice-entry dialog was inspected: explains transcription/review, says recording is sent to Gemini, and has Record source / Choose a file instead / Transcribe recording. No actual microphone audio or transcription-quality claim was made. Further voice-only/Both delivery tests were blocked by the draft-save service failures/navigation trap; they are NOT passed.

## Final three-language delivery observation
D's later UI displayed No recipient has prepared content in their language yet, along with Draft could not be saved: Operation unavailable (`31-draft-failure-blocks-navigation.png`). Its earlier screenshot `24-punjabi-indonesian-result.png` is an intermediate Sending state, not a final receipt. Do not infer successful delivery for either Punjabi script or Indonesian.
A separate direct read of the D receipt without the app's required context header returned 409 Session context changed. That diagnostic request is not an application defect and is not used as evidence of a failed end-user workflow.


## Supervisor UX changes supported by this audit

- **Make readiness visible before sending.** Audience chips list language counts, but no per-language ready/blocked state is shown before sending. A/C/D then fail or partly send. Explain exactly which language lacks content and the next action. Evidence: 04, 07, 20, 23, 31.
- **Use full language names in failure messages.** The partial receipt says TE/TA/ML/BN/HI version not ready for several targets, while Arabic/Urdu have human-readable names. Use Telugu/Tamil/Malayalam/Bengali/Hindi with optional codes. Evidence: 07.
- **Keep operational recovery readable.** The CSV recovery card exposes request and publication UUIDs before a useful progress explanation. Keep technical IDs in expandable support details and lead with what is saved, what is pending, and what the supervisor should do. Evidence: 25 and 32.
- **Explain disabled actions.** Repeat-answer submission stayed disabled with an empty deadline; entering a future deadline enabled it. Mark the deadline requirement visibly and explain the disabled state. Evidence: 13 and the tested repeat-request flow. A required attribute was not present on the observed datetime input.
- **Preserve the good distinctions.** Acknowledged is separate from comprehension and work completed; done requires confirmation; photo evidence is separate from CSV; shared-device saving is blocked. These were observed working and should remain explicit. Evidence: 17b, 19, 29b, 32, 33.

## Scenario coverage and limits

| Scenario | Result |
|---|---|
| Owner login | Passed |
| Invalid worker password | Access rejected (401), but no visible error: F01 |
| Empty worker fields | Correctly blocked |
| Active worker cap | Correctly enforced at 25 |
| First-use language choice | Passed |
| Creation across language choices | 12 audit accounts created; later 3 script options covered by audit-account language changes; creation intermittently returned 503 |
| All 15 worker mobile interfaces | Exercised; screenshots retained; no broad horizontal overflow in checked inboxes |
| Worker language request, owner approval | Passed; old session locks and Reload recovers the new language |
| Direct language correction | Passed on audit accounts |
| Saved draft recovery | Passed for A; stale recipient snapshot requires reload |
| Individual-member delivery | English passed; non-English content blocked/unavailable |
| Empty crew and crew assignment | Correctly blocked empty crew; audit assignment passed |
| Crew-only delivery | Passed to one audit crew member |
| English comprehension question | Delivered, but question/choice mismatch: F04 |
| Incorrect answer persistence | Received and retained; assessment pending, not a verified failure classification |
| Supervisor/worker two-way clarification | Passed; both messages observed on both sides |
| Repeat request | Passed; prior answer retained and pending duplicate repeat prevented |
| Corrected repeat answer | HTTP 503; acceptance unverified |
| Resolve case | Passed; audit case resolved as Work cancelled with factual test notes |
| Acknowledge-only delivery/receipt | Passed |
| Work completion confirmation and Done list | Passed |
| Required photo enforcement | Passed: cannot acknowledge without selecting photo |
| Photo upload and private supervisor review | Passed; image actually loaded |
| Small TXT attachment | Saved and visible to worker; download integrity not independently checked |
| Attachment over 3 MB | Correctly rejected |
| CSV export | Queued at least ~11 minutes; download not verified |
| Shared-device saving restrictions | Observed correctly described and restricted; browser-data forensic erasure not tested |
| Leave unsent worker draft | Guard offered Keep working / Discard and leave; tested |
| Leave failed supervisor autosave | Blocked until QA text cleared: F09 |
| Arabic supervisor mobile receipt | Exercised; Today label remains English |
| Urdu supervisor mobile receipt | Exercised; English fallback text in RTL layout |
| Actual microphone transcription and voice-only/Both delivery | Not completed; draft-save errors blocked further send testing; voice dialog inspected only |
| Offline submission/reconnect, camera capture, native-device audio quality | Not verified in this desktop browser audit |
| Every attachment type/count/total-size combination | Not exhaustively tested; small TXT and per-file size rejection tested |
| Private access-link expiry/revocation, password reset, CSV import, real invitation mail | Not tested in this pass; do not infer a pass from password sign-in |
| Cross-role/site authorization, payment/pilot lifecycle, security penetration testing | Outside this workflow pass; Owner account only, existing real records left intact |

This is a concrete workflow audit, not proof that every possible input, browser, language/media combination, race condition or production integration is correct. The unavailable services prevent a complete acceptance result for multilingual comprehension, repeat assessment, voice delivery and export completion.


### F11 — Crew detail fails after its only active worker is disabled
Steps: create QA1107 Audit Crew, assign NE-017, send E and receive its acknowledgement/photo, disable NE-017, open the crew detail, Try again.
Observed: Crew unavailable / Crew view cannot be verified persists. Both `/api/people/crews/9eeedd63-23db-46ce-a10b-7dfa87358fb4` and its worker-list request return HTTP 200. Crew payload has active true and member_count 0. The crew list still renders the crew with Current active members 0 and Assigned at publication 1.
Evidence: `36-crew-unavailable-after-disable.png`, crew-response.json, request-status observation from browser retry.
Impact: a legitimate disabled-worker lifecycle makes historical crew details unavailable and hides its detail-page actions. The list's archive action still works.
Solution: investigate agreement between crew response validation and active/inactive membership counts. Render the empty-current-members state while retaining historical assignment data. A contract/count mismatch is a hypothesis, not a proven code-level root cause.

## Cleanup and retained records

- 12 audit accounts were created: NE-006 through NE-017. All are now disabled. Final Active + QA1107 directory search returned 0 with No workers match these filters (`37-no-active-audit-workers.png`).
- Clearing the QA filter restored Workers (17), the initial active-worker count. Original user workers were not edited, disabled, reset or deleted.
- Disabling the audit worker locked its active browser session (`35-disabled-worker-session.png`).
- Audit clarification 4fb263dd-d0c4-4dbe-ba94-7d93baa7fc77 is Resolved with Work cancelled and explicit test-only notes (`34-test-case-cleanup.png`). It was not marked as a successful comprehension assessment.
- QA1107 Audit Crew was archived through the list action after the detail view failed. Confirmation states Crew archived. Worker access and past assignments are unchanged (`38-audit-crew-archived.png`).
- Supervisor interface preference was restored to English.
- QA1107 instruction/draft/history records, one queued audit CSV export, clarification messages, test photo and test text attachment are retained for review. No original instructions were changed. The failed D draft's unsaved title/source were cleared to escape its navigation trap; its earlier evidence is retained here.
- No application source was changed or deployed during this audit.

## Audit-created record ledger

| Record | ID / status |
|---|---|
| A, comprehension text check | 517de33f-bbfb-428f-9bcb-66811f2f8199; English delivered, seven language failures |
| A publication | 1cf584e8-ef71-41c6-bf1b-19b5645de150 |
| B, acknowledgement/completion | f26f70c8-7594-4383-9eb5-50b1d697f170; acknowledged, work completed |
| B publication | 48365531-472a-4987-826d-4e1f6a8e4a60 |
| C, Nepali/Filipino/Sinhala/Russian | 2a030170-0b6c-4d77-9a67-b4123e255d1f; no prepared content |
| D, both Punjabi scripts/Indonesian | 531fd866-dcd1-4022-baf6-321ca55f3882; no prepared content displayed; draft-save failures |
| E, crew photo/attachment | bb7b9d23-5d15-40cc-b3e8-ff82c15fae59; delivered, acknowledged, photo received and viewable |
| Crew | 9eeedd63-23db-46ce-a10b-7dfa87358fb4; archived |
| Clarification | 4fb263dd-d0c4-4dbe-ba94-7d93baa7fc77; resolved/test work cancelled |
| CSV export | 8fde7f3a-8336-41cc-834a-e2c7d140bf7c; queued at last check |

No supervisor or worker password, session cookie, access-link secret or authentication token is included in this report.

## Evidence files

- [01-worker-required-fields.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/01-worker-required-fields.png)
- [02-worker-invalid-password.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/02-worker-invalid-password.png)
- [02b-invalid-login-final.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/02b-invalid-login-final.png)
- [03-worker-creation-error.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/03-worker-creation-error.png)
- [04-audit-only-recipients.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/04-audit-only-recipients.png)
- [05-send-blocked.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/05-send-blocked.png)
- [06-send-receipt.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/06-send-receipt.png)
- [07-check-receipt.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/07-check-receipt.png)
- [08-language-preparation.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/08-language-preparation.png)
- [09-question-choice-mismatch.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/09-question-choice-mismatch.png)
- [10-wrong-answer-result.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/10-wrong-answer-result.png)
- [11-answer-pending-progress.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/11-answer-pending-progress.png)
- [12-help-request.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/12-help-request.png)
- [13-supervisor-clarification.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/13-supervisor-clarification.png)
- [14-worker-received-supervisor-reply.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/14-worker-received-supervisor-reply.png)
- [15-repeat-answer-503.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/15-repeat-answer-503.png)
- [16-worker-acknowledgement.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/16-worker-acknowledgement.png)
- [17-work-done.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/17-work-done.png)
- [17b-work-completed-final.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/17b-work-completed-final.png)
- [18-worker-create-503-no-error.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/18-worker-create-503-no-error.png)
- [19-worker-done-list.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/19-worker-done-list.png)
- [20-second-language-send.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/20-second-language-send.png)
- [21-language-change-request.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/21-language-change-request.png)
- [22-language-change-approved.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/22-language-change-approved.png)
- [23-verified-punjabi-indonesian-audience.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/23-verified-punjabi-indonesian-audience.png)
- [24-punjabi-indonesian-result.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/24-punjabi-indonesian-result.png)
- [25-mobile-report-export.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/25-mobile-report-export.png)
- [26-attachment-size-validation.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/26-attachment-size-validation.png)
- [27-valid-attachment.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/27-valid-attachment.png)
- [27b-attachment-saved.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/27b-attachment-saved.png)
- [28-supervisor-arabic-mobile.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/28-supervisor-arabic-mobile.png)
- [28b-arabic-mobile-unobstructed.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/28b-arabic-mobile-unobstructed.png)
- [29-photo-acknowledgement.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/29-photo-acknowledgement.png)
- [29b-photo-ack-final.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/29b-photo-ack-final.png)
- [30-supervisor-urdu-mobile.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/30-supervisor-urdu-mobile.png)
- [31-draft-failure-blocks-navigation.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/31-draft-failure-blocks-navigation.png)
- [32-report-photo-and-queued-export.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/32-report-photo-and-queued-export.png)
- [33-supervisor-photo-evidence.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/33-supervisor-photo-evidence.png)
- [34-test-case-cleanup.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/34-test-case-cleanup.png)
- [35-disabled-worker-session.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/35-disabled-worker-session.png)
- [36-crew-unavailable-after-disable.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/36-crew-unavailable-after-disable.png)
- [37-no-active-audit-workers.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/37-no-active-audit-workers.png)
- [38-audit-crew-archived.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/38-audit-crew-archived.png)
- [current-language-English.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/current-language-English.png)
- [current-language-Filipino.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/current-language-Filipino.png)
- [current-language-Nepali.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/current-language-Nepali.png)
- [worker-ar.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-ar.png)
- [worker-bn.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-bn.png)
- [worker-fil.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-fil.png)
- [worker-hi.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-hi.png)
- [worker-id.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-id.png)
- [worker-ml.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-ml.png)
- [worker-ne.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-ne.png)
- [worker-pa-arab.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-pa-arab.png)
- [worker-pa-guru-320.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-pa-guru-320.png)
- [worker-pa-guru.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-pa-guru.png)
- [worker-ru.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-ru.png)
- [worker-si.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-si.png)
- [worker-ta.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-ta.png)
- [worker-te.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-te.png)
- [worker-ur.png](D:/understood/understood/output/playwright/live-audit-2026-11-07/worker-ur.png)
