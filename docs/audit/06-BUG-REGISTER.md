# 06 — Bug register

Candidate: `main` at `bd3e1ec` plus the local audit fixes. Severity is within the reviewed scope; it is not a production exploit claim.

## Root-cause clusters

1. **Dual-engine drift** — SQLite and PostgreSQL implement the same workflows separately. Route sets, validation, ordering, and failure behavior can diverge.
2. **Content-authority drift** — publication snapshot vs per-assignment delivery content vs presentation artifacts. Readers must choose the exact assignment delivery when it exists.
3. **Derived-state duplication** — instruction/work/report/worker status is computed in SQL, server JS, and frontend dictionaries.
4. **Per-module idempotency** — receipts, leases, retries, and lost-commit handling are not one cross-domain contract.
5. **Provider-policy split** — synthetic fixtures, inline Nemotron/DeepL, and production Gemini+DeepL have different admission/capability rules.
6. **Localization duplication** — large inline dictionaries; staff UI is EN/AR with Urdu fallback.
7. **Test-suite unevenness** — strong domain/DB/HTTP coverage, but source-scanning/layout guards and no native/live/device acceptance.

## Register

| ID | Severity | Finding | Evidence | Root cause | Fix / status |
|---|---|---|---|---|---|
| R3-01 | P1 | Late-delivered language was not used by presentation, staff response detail, case detail, translation feedback, notification title, or check-back. | `tests/audit-late-delivery-regression.test.mjs`; source readers in `server/postgres/*` | Content-authority drift | Added `server/postgres/delivered-content.mjs`; updated readers. **Fixed.** |
| R3-02 | P1 | Recorded-answer processing used the snapshot question for a late-delivered language. | `tests/audit-recording-late-delivery.test.mjs` | Content-authority drift | Recording worker and provider-budget authority resolve the exact delivery. **Fixed.** |
| R3-03 | P1 | SQLite startup could drop a populated `instruction_deliveries` table on a composite-key heuristic. | `tests/audit-safety-regression.test.mjs` | Destructive compatibility heuristic | Removed destructive repair; unknown/invalid schema refuses and preserves rows. **Fixed.** |
| R3-04 | P2 | Workspace tables accepted invalid ownership, JSON, dates, negative attachment sizes, and invalid base64. | `tests/audit-workspace-integrity.test.mjs` | Missing DB constraints | Migration 127 + SQLite guards; migration refuses anomalous retained rows. **Fixed.** |
| R3-05 | P2 | Library pagination loaded all site briefings/assignments and filtered/sorted in JS. | `tests/audit-workspace-integrity.test.mjs` | UI pagination added after materializing history | SQL filtering/counting/status aggregation/paging. **Fixed.** |
| R3-06 | P2 | Vercel static headers omitted the CSP used by the Node static server. | `tests/audit-safety-regression.test.mjs` | Transport-specific security drift | Shared `server/content-security-policy.mjs`; Vercel header. **Fixed.** |
| R3-07 | P2 | Improvement analytics selected latest answer by timestamp/random ID instead of latest submission receipt. | `tests/audit-safety-regression.test.mjs`; migration 126 | Reimplemented latest-answer selection | Latest receipt sequence is authoritative; pending audio excludes older assessed answers. **Fixed.** |
| R3-08 | P2 | Cached inline provider adapter shared one request deadline across overlapping requests. | `tests/audit-safety-regression.test.mjs` | Mutable request deadline on adapter instance | Request-owned adapters with shared limiter. **Fixed.** |
| R3-09 | P2 | DeepL response parsing was unbounded; optional-question choice ordering could shift. | `tests/audit-safety-regression.test.mjs` | Unbounded response handling | Bounded streaming parser, cancellation, ordered choices. **Fixed.** |
| R3-10 | P1 decision | Pilot constant is 14 days; prior audit documentation says 30. | `server/pilot-policy.mjs`; prior external audit | Requirement/policy drift | **Unresolved.** Current 14-day contract preserved; no silent change. |
| R3-11 | P1 decision | Production admission routes preparation/follow-up through Gemini; prior audit documentation says DeepL-primary. | `server/postgres/production-admission.mjs`, `server/ai/production-gemini.mjs` | Provider-policy drift | **Unresolved.** Current fail-closed routing preserved; no silent change. |
| R3-12 | P1 external | 15 worker locales advertised; current DeepL capability map excludes Sinhala and Shahmukhi Punjabi. | `server/ai/deepl-translate.mjs`; language registry | Capability vs launch-scope mismatch | **Blocked/external.** No silent scope reduction. |
| R3-13 | P3 | Send-result document title remains “New instruction · Understood” while heading says “Instruction sent.” | Prior browser evidence | Route title not updated on result | **Open.** Minor. |
| R3-14 | P2 product | Manual invoices/payments exist; no automated subscription/payment collection. | `server/billing.mjs`, `server/postgres/billing.mjs` | Product scope | **Documented.** No payment integration invented. |
| R3-15 | P2 | Staff UI supports EN/AR; Urdu falls back to English. | `src/staff-language.ts`, `src/main.tsx` | Localization scope | **Documented.** Arabic sweep passed; no native review. |
| R3-16 | P2 | Development/build dependency advisories remain. | `package.json`, prior advisory evidence | Locked dev/build versions | **Partially mitigated.** Reticle disabled outside `serve`; package upgrade deferred because the protected dev server on port 3020 holds the native Rolldown module. |
| R3-17 | P2 systemic | Dual-engine route/behavior drift. | Route comparison; `server/index.mjs` vs `server/postgres/http.mjs` | Parallel implementations | **Partially addressed.** Added parity tests for changed behavior; full parity remains a maintenance task. |
| R3-18 | P2 | Some readers still use snapshot content where delivery content may be authoritative. | `server/postgres/read-models.mjs`, `recording-worker.mjs`, `provider-budget.mjs` | Content-authority drift | Recording/provider-budget fixed; read-model list/detail already prefer delivery content. **Partially fixed; keep auditing new readers.** |
| R3-19 | P2 | Test suite includes source-scanning/layout guards and lacks native/live/device acceptance. | `tests/*` | Test strategy | **Documented.** Added focused behavioral regressions; native/live/device remain external. |
| R3-20 | P2 | No deployed monitoring/alerting, load/SLO, off-site DR, or incident drill. | Deployment/ops docs | Operational readiness | **External/blocked.** |

## Prior audit cross-reference

The external 2026-11-11 audit identified A-01–A-12. The current `main` did not contain the fixes from the `feat/complete-crew-workflows` branch. This audit re-verified the clear code/data-integrity findings and applied them to `main`:

- A-03/A-04 → R3-01/R3-02 (late delivery).
- A-05 → R3-08 (shared deadline).
- A-06 → R3-03 (destructive SQLite repair).
- A-07 → R3-04 (workspace integrity).
- A-08 → R3-05 (unbounded library).
- A-09 → R3-06 (CSP).
- A-11 → R3-07 (improvement ordering).
- A-12 → R3-16 (dependency advisories; partial).
- A-01/A-02 → R3-10/R3-11 (policy decisions; not changed).
- A-10 → R3-12 (all-language acceptance; external).

## Status summary

- **Fixed and regression-tested:** R3-01, R3-02, R3-03, R3-04, R3-05, R3-06, R3-07, R3-08, R3-09.
- **Partially fixed/mitigated:** R3-16, R3-17, R3-18.
- **Open product decisions:** R3-10, R3-11, R3-14, R3-15.
- **Open minor:** R3-13.
- **External/blocked:** R3-12, R3-19, R3-20.
