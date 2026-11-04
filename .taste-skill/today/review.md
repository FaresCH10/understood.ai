# Today dashboard review

Direction: Editorial greeting, seed 479636258; existing Understood typography,
forest green primary action and application shell retained. No redraws or new assets.
The screen answers: which open work needs the supervisor's next action?
Its distinctive element is the current published instruction, with its actual response
figures kept apart from the cross-publication attention queue.

## Before

- Three simultaneous queue columns squeeze names, titles and failure reasons.
- Latest-instruction metrics lack the instruction title and published version.
- The long queue pushes response evidence and recent work far down the page.
- A second pending-reply count under Team can be mistaken for the team's headcount.

## After

- The publication summary shows its title, version and four original metrics.
- Accessible queue tabs separate clarifications, outstanding replies and delivery
  problems. Counts remain visible across all tabs, including zero counts.
- Keyboard controls support Home, End and directional arrows, including RTL.
- Existing expansion and pagination load outstanding work. Collapsing restores
  focus to the corresponding tab. The loaded local demo has 12 waiting rows.
- Independent main and evidence columns keep recent instructions beside response
  progress, team access and preparation tools without stretching shorter panels.
- Team is an access shortcut; the duplicate pending-reply count was removed.
- GSAP moves the selected-tab surface and reveals the user-selected panel. No
  count-up animation, perpetual animation or full-page entrance was added.
  Reduced-motion preferences skip the tweens. A single scoped resize observer
  tracks the tabs and is disconnected on unmount.
- A stable loading skeleton and scoped overview retry cover slow or failed reads.

## Verification

- Production build and type checking pass. Design lint reports zero failures
  and zero warnings. The existing attention-queue data regression passes with
  loopback access; its first sandboxed run was blocked by localhost EACCES.
- Inspected the authenticated app at desktop and at 320, 390 and 768 CSS pixels.
  Document widths were 305, 375 and 753 pixels respectively, including scrollbars;
  no horizontal page overflow was measured.
- At 390px all dashboard panels occupy the full 343px content column.
- Verified all three queue selections, 12-row expansion, collapsing and keyboard
  focus. Verified Arabic RTL and reversed arrow-key behavior, then restored English.
- Reticle directly proved visible queue changes, expansion, clarification and
  publication opening, and navigation to the instruction library. Send instruction
  and Team also reached their expected routes in the browser.
- Authenticated screenshots were inspected through CUA rather than running the
  design inspector against an unauthenticated session.
- No fixtures, customer claims or invented activity were introduced into the UI.

Before and after images are saved in the chat's visualization directory.
