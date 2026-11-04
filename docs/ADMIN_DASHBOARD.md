# Understood administration

The dedicated operator entry is the platform team's dashboard. It is separate
from the customer owner and supervisor interface. Customer credentials, including
the local demo owner, do not grant platform access.

## Available sections

| Section | Purpose |
| --- | --- |
| Command center | Server observations, processing queues, recent worker heartbeats and dispatch admission |
| Support desk | Workspace-scoped staff and worker access metadata, account session counts, targeted session revocation and worker access diagnostics |
| Processing jobs | Filter all supported queues; review eligible preparation, assessment and export retries |
| Workspaces | Inspect sites and worker totals, diagnose worker access, suspend or resume workspace admission |
| Plans & activation | Review requests; record plan, end date, worker limit, terms and decisions |
| AI & quotas | Inspect provider stages, usage, configured synthetic tests and global/workspace request policies |
| Dispatch controls | Pause or resume new operational and AI provider dispatch |
| Audit trail | Read the immutable history of operator actions |
| Troubleshooting | Follow symptom-specific response steps and open the relevant control |

Unverified health remains unverified. Queue counts come from the server; no
uptime, revenue or other uncollected metrics are invented. Background processing
workers and the people receiving instructions are labelled separately.

## Support actions

Select a workspace, then filter staff or workers by account reference and site.
Staff references are account IDs; the operator role does not read staff names,
email addresses, passwords, recordings, responses or instruction content.

Ending sessions requires a specific workspace, site, principal type and account,
an explicit reason, confirmation, and the observed active session count. A changed
count returns a conflict and requires a new review. Customer sign-in and this
command serialize through the operations admission gate. The immutable receipt
stores the exact original target and count, and retrying that request does not
repeat the mutation. Ending sessions does not reset credentials, disable accounts
or erase cached device data.

The console persists a metadata-only command before sending it. After a reload it
checks the receipt without resending. If the receipt is verified missing, the
operator may explicitly retry that exact command. An unresolved or corrupt
command locks further mutations.

## Access and local review

Build with `npm run build`. The dedicated service serves its own entry at `/`
(also `/operator.html`) and only the operator asset dependency graph. In the Vite
preview, `/operator.html` opens the entry, but the customer SQLite backend reports
operator access unavailable by design.

For a disposable browser review, run:

```powershell
npm run build
node scripts/operator-browser-fixture.mjs --confirm-local-operator-ui
```

Open `http://127.0.0.1:3194/` and use the disposable synthetic login printed by
the fixture. Its database lives only in memory; stopping the process discards it.
It does not contact a cloud database, AI provider, mail service or customer data.
It is local UI evidence, not hosted TLS or deployment acceptance.

For an actual operator environment, follow [the service boundary](OPERATOR_SERVICE_BOUNDARY.md),
[the standalone entry](OPERATOR_ENTRY.md), and the existing separate-origin
configuration in `.env.operator.example` or `.env.production.operator.example`.
Apply migrations and the verified column permissions through the maintenance
workflow before starting `npm run hosted:operator`. This change includes migration
124 for genuine future session creation timestamps and narrow worker credential
metadata observations; legacy session timestamps remain unknown.

No real operator was provisioned or deployment changed by this UI implementation.
The existing operator maintenance command takes credentials from bounded standard
input, never command arguments. Keep provisioning within the environment and data
class supported by that command.

## Deliberate authority limits

This dashboard manages platform operational controls. Site lifecycle, staff
permissions, worker credentials, customer content edits and privacy deletion keep
their existing scoped customer workflows. The console does not impersonate users,
read credential secrets, directly edit arbitrary database records, retry source
audio/publication jobs, or provide an unrestricted SQL tool.

GSAP provides scoped navigation feedback and troubleshooting disclosure motion,
with cleanup and reduced-motion support. It does not delay access to controls.

## Design and local verification

The design uses the framed-sheet direction (seed 1994204615), without redraws.
Understood's green-grey frame and mark carry the identity; the white work surface
and neutral controls keep account and health evidence readable. The signature
workflow runs from a reported symptom to the affected workspace, account, reviewed
action and immutable receipt. All dashboard figures use API data.

The optimized build and TypeScript check pass. Focused operator, receipt,
permission, migration, worker-password and customer authentication/recovery/import
regressions pass. Browser checks covered 1440px, 768px and 390px widths, workspace
selection, worker and staff session actions, audit rendering, disabled provider
tests, troubleshooting disclosures and mobile navigation, with no page overflow.

In the disposable fixture, an injected lost acknowledgement plus receipt outage
followed by a browser reload produced exactly one session-revocation POST, one
immutable receipt and one audit entry. Only the selected worker's session ended;
the owner, supervisor and second workspace sessions remained active. After receipt
recovery, the console cleared its pending command through a read-only check.
A second review against the final build confirmed a scoped staff session action
and its readable audit target.

Reticle could not attach its bridge because the actual operator build keeps
`connect-src 'self'`. No Reticle verdict is claimed; browser checks used CUA and
database/API evidence while retaining the policy. Hosted rollout, native
PostgreSQL concurrency and real deployment acceptance remain separate checks.

### Follow-up inspection — 3 November 2026

Rechecked the running disposable operator service through the browser. Sign-in,
sign-out and signing in again worked. Confirmed dispatch pause/resume, workspace
suspension/resumption, a persisted plan revision, a disabled-provider quota
update, account diagnostics and targeted worker session revocation. The audit
trail retained each action after a new sign-in. Job filters and empty results,
troubleshooting disclosures and 390px navigation also worked without page overflow.

Repeated the lost-acknowledgement/receipt-outage/reload scenario: exactly one
session-revocation POST, one receipt and one audit event. The selected Cedar Works
worker session ended; its owner and supervisor sessions remained active. Atlas
sessions had already been revoked by the separate workspace-suspension test,
as expected; resuming that workspace did not reopen those sessions.

The build and 38 focused operator tests passed. The additional entitlement and
synthetic-provider suites verify plan transitions, quotas, stage results and
worker command recovery independently of the UI. No functional regression was
found, and no production data or configuration was changed. Real provider calls,
storage credentials and hosted deployment remain outside this local inspection.
