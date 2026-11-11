# 09 — Production readiness assessment

> Subsequent authorized stabilization: all 11 code findings have local corrections. See [delivery record](IMPLEMENTATION.md) for current changes, exact full-run/rerun accounting and remaining release gates. This report below records the original audit baseline.

Baseline `270788d`; 2026-11-11. Intended scope: controlled real-worker pilot with all required languages. **Verdict: NOT READY.** This verdict concerns the audited candidate and stated scope; it is not a claim that the application has no useful or working functionality.

## Reasons

1. Approved 30-day pilot cannot be granted under the 14-day server policy (A-01).
2. Production translation does not implement required DeepL-primary/approved-fallback routing (A-02).
3. Late delivered languages break new-language presentation and check-back, and staff evidence can show the wrong language (A-03/A-04).
4. A conditional SQLite compatibility path can destroy populated delivery evidence (A-06).
5. Development/build tooling has unremediated high-severity advisory entries requiring applicability review (A-12); no exploit is established.
6. Required all-locale/live-device and native infrastructure/recovery acceptance are not established (A-10 and operational gates).

Green build/tests do not override confirmed defects or supply missing external acceptance. Synthetic/demo use must remain clearly separated from any real-worker admission.

## Evidence matrix

| Requirement | Current evidence | Readiness |
|---|---|---|
| Core product implementation | Real repositories, UI, receipts, queues and extensive tests; 53 module groups audited | Substantial implementation, known defects |
| Pilot entitlement | Pending/expired mechanisms; wrong duration; unmanaged legacy policy needs decision | Blocked A-01/D-04 |
| Authentication/authorization | Source review, local negative tests; application session/credential/tenant checks | Local evidence only; independent/native checks outstanding |
| Tenant/data integrity | Scoped core paths and constraints; A-06/A-07 reproduced | Not sufficient |
| Translation/provider policy | Live Gemini admission; required DeepL route absent | Blocked A-02 |
| All worker languages | 15 selectable locale codes, synthetic fixtures; no all-stage live/native acceptance | Blocked A-10 |
| Voice and notifications | Implemented storage/push/recording queues; no current physical-device real delivery acceptance | Unverified externally |
| Billing | Manual invoices/payments/activation; gateway deliberately deferred | Acceptable model only after explicit operating procedure/renewal ownership |
| Build and dependencies | Build/typecheck passed; production advisory scan clean; all-dependency scan reports 8 high affected development/build packages | A-12 triage/remediation open |
| Full automated suite | 1,766 passed, 0 failed, 4 native skips; exit 0 | Local modified timeout/concurrency; cannot substitute for native/external gates |
| Native DB/roles/TLS/concurrency | Docker daemon unavailable; native tools/test URLs absent | Blocked, not replaced by PGlite |
| Backups/restore/RPO/RTO | Significant implementation; no current native off-site recovery drill | Unverified |
| Monitoring/alerts | Worker heartbeat/storage/provider controls implemented; no deployment/SLO/drill evidence | Unverified |
| Performance | Build warns about large chunks; library query unbounded by page size; no realistic load acceptance | A-08 plus unverified targets |
| Privacy/security/accessibility | No independent current-candidate sign-offs provided | Open release gates |
| Deployment/rollback | Config/runbooks/admission exist; no audit deployment performed | Unverified for actual host |

## Minimum evidence to change verdict

- Verify A-01/A-02/A-03/A-04/A-06 fixes against regression scenarios and review A-07–A-09/A-11/A-12 mitigation within the chosen pilot scope.
- Resolve or explicitly accept the documented business decisions without silently changing requirements.
- Re-run the supported CI/native checks and synthetic end-to-end acceptance against the exact candidate/configuration.
- Complete all-language provider/native review, physical-device audio/push, controlled email, independent security/accessibility, load/monitoring and isolated backup/restore acceptance.
- Record current privacy/provider approvals, operational ownership and release/rollback authorization. Keep secrets out of reports and approvals tied to candidate/configuration fingerprints.

A later verdict may be CONDITIONALLY READY only if remaining limitations are explicit, acceptable for the approved scope and not concealed critical failures. This audit does not grant permission to deploy or process real worker data.
