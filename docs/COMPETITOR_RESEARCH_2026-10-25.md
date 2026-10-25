# Understood: competitive research and product recommendations

Research date: 25 October 2026.

## Scope and method

This review covers 12 relevant products across frontline communication, operations, visual work instructions, training, team coordination, and voice translation. It is a selected comparison of established products, not a verified worldwide market-share ranking. Findings come from official product pages and help documentation available on the research date. Vendor claims about business outcomes, accuracy, and customer adoption are not independently validated here. Subscription availability and language support vary by product and feature.

Recommendations are product judgments, separate from the documented competitor capabilities. Understood's local acceptance matrix and current PC demo documentation were consulted to distinguish existing foundations from possible additions. This is not a fresh implementation or readiness audit. No application code, live data, or deployment was changed for this research.

## Main recommendation

Position Understood around a short, complete operational conversation:

**Supervisor sends an instruction → worker receives it in their language → worker answers or requests help → supervisor handles anything unclear.**

For instructions that ask someone to perform work, add a separate optional step for reporting completion. Receiving, acknowledging, answering a question, and completing a job are different events. A matched AI answer must never be presented as proof of safe execution or certified understanding.

Translation, chat, and quizzes already appear across this market. Understood should differentiate through how quickly a multilingual team can complete this whole interaction, including low-literacy support, shared devices, and human follow-up. This is a proposed position, not a claim that competitors cannot offer similar combinations.

## Products to study

| Product | Relevant documented capabilities | What Understood can learn |
|---|---|---|
| [Connecteam](https://connecteam.com/employee-communication-app/) | Targeted updates, translation, read tracking, chat, knowledge base, surveys and help desk. | Make the daily experience familiar and mobile-friendly; keep the right audience and a clear next action attached to each instruction. |
| [SafetyCulture / SC Training](https://training.safetyculture.com/notifications/) | Training assignments, deadlines, repeat frequencies, reminders and multimedia Heads Up communications. Its broader operations material also covers inspections, actions and issue reporting. | Bring important work into a daily queue; use visual material and targeted reminders. Keep action completion separate from communication acknowledgment. |
| [Beekeeper, now part of LumApps](https://www.lumapps.com/beekeeper) | A mobile frontline platform, onboarding and bite-sized learning, with connections to workplace systems. | Design for people away from desks and make first-day use practical; introduce integrations after the core experience works. |
| [Blink](https://helpdesk.joinblink.com/en/articles/6979848-mandatory-reads) | Mandatory acknowledgments, acknowledgment tracking, and reminders to people who have not acknowledged. | Show precisely who still needs to respond and remind only those people. An acknowledgment is a receipt, not an assessment. |
| [Speakap](https://www.speakap.com/product/task-management) | Group assignments, recurring tasks, attachments, comments, push notifications, completion analytics and shift-handover use cases. | Keep discussion and relevant evidence inside the instruction; provide simple recurring work and handover support. |
| [Poka](https://www.poka.io/en/connected-worker-platform/) | Digital work instructions, forms, issues, skills management, QR access and operational organization by plant, line, workstation and equipment. | Put guidance at the point of work. Let a worker scan a machine or location and reach authorized instructions quickly. |
| [Dozuki](https://www.dozuki.com/solutions/need/work-instructions) | Visual work instructions, annotated photos, controlled revisions, approvals and worker feedback. | Show the job through clear pictures and short steps; keep workers on the current approved version. |
| [Augmentir](https://www.augmentir.ai/) | Connected digital instructions, checklists, workflows, collaboration, skills management and contextual AI assistance. | Keep help connected to the exact instruction and worker context; avoid making the worker operate an AI tool. |
| [Axonify](https://axonify.com/platform/immersive-microlearning/) | Short learning paths and personalized reinforcement. | Offer optional brief refreshers for recurring topics rather than turning every instruction into a course. |
| [Trainual](https://trainual.com/faqs) | Documented processes, training assignments, quizzes, deadlines and completion reporting. | Reuse proven instructions in small onboarding packs and make responsibilities explicit. |
| [Asana](https://help.asana.com/s/article/all-asana-features?language=en_US) | Clear assignees and deadlines, subtasks, forms, templates, rules and multiple work views. | Borrow ownership, due dates, and predictable task states while preserving Understood's simpler navigation. |
| [DeepL Voice](https://www.deepl.com/en/products/voice) | Voice translation for meetings and in-person conversations, plus terminology customization. | Make audio controls easy to use and terminology consistent. Real-time interpretation is an optional future direction, not a prerequisite for asynchronous instructions. |

This table summarizes product capabilities, not a hands-on usability benchmark. No conclusion about which competitor has the best visual design is implied.

## Recommended features

### 1. A clearer instruction card — first priority

Each worker card should answer: what is this, who sent it, when do I need to respond, and what do I do next?

Show a short title, supervisor, site/crew where relevant, response deadline, delivery mode, and one next-action label. Put listen/read controls directly in the card or detail view. Use labels such as **Answer needed**, **Reply needed**, **Acknowledgment needed**, and **Completed**. Worker-facing copy should be reassuring and specific rather than marking people as failed.

Keep the underlying events separate: available, opened if measured, receipt acknowledged, answer received, follow-up requested/resolved, and work completion if that optional capability is enabled. Do not collapse them into one ambiguous Done percentage. Understood already has instruction and follow-up states; this recommendation starts with clearer presentation and only adds tracking where justified.

### 2. Photos and annotated examples — first priority

Let a supervisor attach a picture and mark the relevant shelf, tool, area, or finished result. Provide a short translated caption and an accessible text description. For example, show the blue shelf rather than relying entirely on its translated name.

This requires private attachment storage, permissions, upload limits, safe file handling, and retention. Public image links should not expose workplace photos. Introduce photos before a full video editor or complex media library. Audio uploads already exist; broad photo annotation should be treated as a proposed extension pending a focused code audit.

### 3. A focused supervisor attention queue — first priority

Organize Today around **needs your attention**, **waiting for replies**, and **delivery problems**. Opening a row should show the source instruction, the worker's original answer, a translation where available, and the existing human follow-up actions.

An AI explanation should identify the missing point, such as “The answer did not mention where unfinished items go.” Uncertain audio or translation should be labeled uncertain rather than treated as a wrong answer. Keep underlying recordings and earlier answers available to authorized staff.

This improves the existing Today/follow-up foundation rather than creating another dashboard.

### 4. Better targeted reminders — first priority

Use the existing reminder foundation to contact only people with an outstanding action. Stop reminders when that action is received. Give the supervisor one **Remind pending workers** action, with a clear recipient count and preview.

Use the site's timezone and configurable working hours, prevent duplicate reminders, and show overdue status without implying an emergency. Reserve urgent treatment for explicitly marked urgent communications. Real push delivery still needs configuration and physical-device verification; an in-app event is not proof that a phone received a notification.

### 5. Favorites and practical reusable instructions — first priority

Improve discovery of existing templates through recent instructions, favorites, and **Use again**. Reuse should create a new editable draft with a fresh audience and deadline, not silently reissue old assignments.

Seed a small set of editable examples relevant to initial Gulf customers: housekeeping handover, stock placement, shift opening/closing, equipment setup, or routine site housekeeping. Templates containing safety requirements must be reviewed by the responsible company; AI must not invent local operating rules.

### 6. Optional short checklists — next priority

For instructions with multiple actions, allow a small checklist such as “collect materials / check quantity / place on shelf.” Keep it optional so a simple message stays simple. If AI proposes steps, the supervisor must review them before dispatch; generation must not add requirements absent from the source.

This is useful execution support, inspired by work-instruction and operations tools. It should not replace the agreed single open question by default.

### 7. Optional work-completion reporting — next priority

Some messages only need acknowledgment or a response; others ask a worker to do a job. Add a per-instruction **Track work completion** option for the latter.

The worker answers the comprehension question first where requested, then separately reports **Work completed** or **Blocked**. A photo can be requested where appropriate, with supervisor review. Clearly distinguish worker-reported completion from independently verified completion. Avoid changing the meaning of existing answer history or calling old assignments incomplete retrospectively.

### 8. Better reasons for needing help — next priority

Extend the existing help action with a few understandable choices: **Instruction unclear**, **Materials missing**, **Equipment problem**, and **Something else**, followed by optional text or voice. Route it into the same instruction's follow-up record.

A supervisor should see what is blocking progress and who is handling the request. Do not turn this into a separate messaging product or a large ticketing system for the pilot.

### 9. QR access at the workplace — next priority

Attach a QR code to a workstation, equipment item, or work area. Scanning should open the relevant current instruction or authorized reference list in the worker's language.

The QR code must identify a resource, not serve as a reusable password or grant company access. After login, enforce organization, site and role permissions. Never embed private recordings, session tokens or personal details in printed QR codes.

### 10. Worker onboarding packs — next priority

Group three to five reusable instructions into a short sequence for a role or crew. Allow an authorized supervisor/HR action to assign the pack when adding a worker. Show actual completed requirements and remaining items.

This extends worker training; it is different from the company owner's existing first-run setup. It should reuse the same worker forms rather than introduce a separate learning portal.

### 11. Translation feedback and terminology — next priority

Add **This translation is unclear** to an instruction. Preserve the exact version and language in the request and route it to an authorized reviewer. A corrected language version should have a recorded history; earlier answers must keep their original context.

Improve access to the existing company glossary so supervisors can define site names, product names, abbreviations and terms that must remain unchanged. Provide **View original** as a secondary option and adjustable audio playback where supported. Evaluate each target language's text and speech quality rather than treating a selector as proof of support.

### 12. Shift handover summary — later

Present unresolved follow-ups, outstanding instructions, delivery failures and blocked work for the incoming supervisor. Each summary item should link back to its source record. Let a supervisor review any generated summary before sharing it.

Respect existing permissions. Do not automatically widen a supervisor's visibility or move private cases between teams merely because a shift changes.

### 13. Optional short refreshers — later

Allow a supervisor to schedule a short refresher for a recurring topic. Base suggestions on the relevant instruction and its follow-up history. Keep learning progress private to authorized staff and avoid public worker rankings.

Do not automatically infer that a worker is unsafe or unskilled from an AI answer score. Language familiarity, transcription errors and the quality of the original instruction affect results.

### 14. Useful team insights — later

Prefer operational questions over decorative dashboards: which instructions attract repeated help requests, which translations need review, what remains unanswered, and how long does human follow-up take?

Label denominators and time windows. **Answers received** is different from **work completed**. Avoid language/nationality leaderboards, misleading understanding percentages and automatic employment decisions.

## Make the experience more attractive without adding complexity

1. **Keep the agreed navigation.** Supervisors retain Today, Instructions and Team; reports and settings remain secondary. Workers retain To do and Done, with the guided form inside an instruction.
2. **Use one consistent card structure.** Title, sender, deadline, short preview, status and one main action should appear in predictable positions. Photo previews can make relevant cards easier to recognize.
3. **Give each screen one main action.** Today emphasizes Send instruction. Worker details emphasize the next outstanding action. Extra controls stay secondary.
4. **Keep recording calm and direct.** Show recording state, elapsed time, stop, playback and re-record controls. Transcription and preparation stay in the background, with truthful progress and a recoverable failure state.
5. **Make the worker form read naturally.** Instruction first, audio beside it where enabled, question second, text answer by default with a clear voice alternative, then submit. Keep Help visible. Follow-up history appears only when relevant.
6. **Use color deliberately.** Preserve Understood's teal identity; use neutral surfaces, readable type and comfortable spacing. Pair status colors with text/icons and retain legibility in Arabic and on small phones. Do not communicate state through color alone.
7. **Support Arabic as a complete interface.** Test navigation, mixed-script names, timestamps, audio controls and forms in RTL. Mirror directional layout where appropriate without mechanically reversing every symbol.
8. **Make empty and error states useful.** An empty team should offer Add workers; an empty instruction list should offer Create instruction or Use template. Delivery failures should show whom they affect and what can be retried.
9. **Simplify the first session.** Guide a new supervisor to add a small team and send one instruction. Avoid a long mandatory product tour or exposing provider settings.
10. **Preserve shared-device confidence.** Make the signed-in identity and Finish and sign out easy to find. Notifications on a shared device should not display private instruction content.

These are design recommendations, not conclusions from direct usability testing of competitor applications. Before a full redesign, test the existing recording-to-send flow and worker answer flow with representative supervisors and multilingual workers using their actual devices.

## Suggested order

| Stage | Deliverables | Purpose |
|---|---|---|
| 1: Strengthen the current product | Reliable real processing and notifications; clearer states; focused Today view; simpler template reuse; text/voice form polish. | Make the central promise dependable before expanding scope. |
| 2: Add visual guidance | Private photos, captions, simple annotation and optional short checklists. | Help workers recognize the right place, tool and result. |
| 3: Connect instruction to execution | Optional completion reporting, help reasons, QR access and onboarding packs. | Add practical team coordination while reusing existing screens. |
| 4: Learn from repeated use | Handover summaries, optional refreshers and carefully labeled team insights. | Improve recurring work based on observed customer needs. |

This ordering is a recommendation, not a time or budget estimate. Upload security, storage, translation quality, offline behavior and notification reliability materially affect the work required.

## Features to postpone

Payroll, attendance surveillance, GPS tracking, complex shift scheduling, a company-wide social feed, public leaderboards, full project-management boards and autonomous operational approvals would expand the product substantially. Add them only if validated customer demand outweighs their complexity. For the pilot, use lightweight integrations later rather than rebuilding entire HR or project-management platforms.

Current demo limitation: the frontend is deployed, API/database/worker run on the user's PC, and email verification was tested for the controlled Resend account inbox. Real general-purpose AI processing and real push delivery remain unconfigured; the current demo is not production-ready. A visual redesign or additional features do not remove those limitations.

## The five changes I would choose first

1. Clearer instruction cards and precise response states.
2. Photos with short translated captions.
3. A concise supervisor follow-up queue.
4. Targeted reminders using existing reminder infrastructure.
5. Favorites and one-action reuse of existing templates.

Together, these make Understood easier to recognize, easier to navigate and more useful while preserving the original idea: speak or type, send, receive an answer, and help where needed.
