# Reports interface

The Reports page answers: how did the selected instruction reach its audience,
and which responses need follow-up? It uses the existing site-scoped API and
preserves export permissions, captured filters and exact receipt recovery.

The layout follows the achromatic-ledger direction, seed 459197100, with the
established Understood type and green on the response data. No redraws or sample
metrics were introduced. Its defining element is the distinction between the
publication's captured delivery audience and the filtered response evidence.

- Publication context carries title, version, response/delivery mode, timestamp,
  timezone and searchable history.
- Applied filters remain separate from edited filters. Mobile scope controls
  collapse and return keyboard focus to their trigger after applying or clearing.
- Response completion includes received acknowledgements and pending assessments.
  Understanding uses matched / assessed, with the denominator visible. Resolutions
  remain a separate overlapping follow-up count.
- Response dates retain the assigned denominator. Delivery totals describe the
  full publication, before crew/date filtering. Missing legacy delivery evidence
  is explicit.
- Language results, export queue/download state, expiry and interpretation notes
  sit beneath the summary. Export history remains site history, independent of
  the currently selected report.
- GSAP animates history/help disclosures and the response bar after a user changes
  the report. Animations are scoped, cleaned up and respect reduced motion.

Mobile inspection caught inherited header flex-basis and fixed filter-label
height rules; the page now overrides those locally. Tablet inspection also caught
the hidden sidebar occupying a full-height block above the page at 761–900px.
The shared navigation now retains its zero-width grid column in that state.
Arabic response fractions explicitly retain numerator/denominator order.

Verification: production build and TypeScript pass; all 38 focused Reports,
scope/publication, comprehension, localization and export recovery tests pass.
Six Reticle assertions passed for publication loading, unapplied filters,
applying/clearing dates, receipt-backed CSV queuing and the interpretation guide.
These assertions observe DOM/network effects; component stores are not instrumented.
CUA verified the actual CSV download and English/Arabic/Urdu layouts at 1440,
768 and 390px, including both sidebar states and no horizontal overflow.
One local CSV export was requested and downloaded during verification.

Reticle's older SDK cannot capture this desktop browser, so screenshots were
captured with CUA. Existing build chunk-size/dynamic-import warnings remain.
No backend schema, report calculation or export format changed.
