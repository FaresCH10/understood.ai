# Connected crew workflows

Updated 4 November 2026, based on upstream commit `a37499b`.

The updated repository already implements scoped, persisted crew membership in SQLite and PostgreSQL, recipient resolution, frozen publication audiences, crew lifecycle auditing, CSV import and report/export filtering. This change connects those services through a dedicated crew workspace instead of adding another membership model or sample-only data.

## User journeys

- Create a crew: the successful response is validated and opens the saved crew directly.
- Open a crew from the crew list, site search, or a worker's current-crew field.
- View named members and worker IDs, search, paginate, and filter active or disabled workers. The headline count explicitly means active workers; the member list can include disabled workers.
- Add an existing active worker using the shared picker. Adding someone from another crew moves that membership using the existing API. Disabled workers cannot be admitted through the picker.
- Open a member's full worker profile, change or remove membership there, and return through the current-crew link.
- Open the existing filtered worker directory for further worker management.
- Send an instruction with this crew already selected. The send form retains its normal draft recovery and delivery choices. Actual recipients are resolved by the existing server service, not by a client-only list.
- Open a crew-filtered response report and export using the same scope. Initial applied and editable filters match; switching publication history retains the crew scope when entering from a crew.
- Rename, archive and restore through the shared lifecycle controls. Archived crews retain members and history; the detail page disables new admissions and sending until restored.

## Routes

| Route | Purpose |
|---|---|
| `#people/crews` | Search and select crews |
| `#people/new-crew` | Create a persisted crew |
| `#people/crew/:id` | Crew detail and connected actions |
| `#people/crew/:id/workers` | Existing worker directory filtered to a crew |
| `#people/worker/:id` | Worker profile with current-crew backlink |
| `#send/crew/:id` | Existing send workflow initialized for a crew |
| `#reports/crew/:id` | Existing report/export workflow initialized for a crew |

Search destinations already use the crew detail route, so they now reach the same workspace. Navigation highlights the appropriate Crews or Reports section for these routes.

## Data and access rules

The existing backend remains the authority. A worker has one current crew or no crew. Organization/site scope, staff authority, active destination status and mutation validation continue to be enforced by the existing services. This change does not expand role permissions or introduce migrations.

Current membership and historical publication membership are different facts. Moving, unassigning, disabling or archiving does not rewrite accepted assignments, answers or the frozen crew audience used by reports. A report can therefore include a former member while the current member list excludes them. Reports without historical crew evidence retain their existing unavailable state; no synthetic totals are invented.

The member response validator now accepts inactive workers only when the detail page explicitly requests `inactive` or `all`. Existing crew overviews and admission pickers retain active-only validation. Picker focus is contained within its dialog, and Escape cancels safely.

## Verification

Focused checks include crew overview/state, crew recipients, people APIs, membership lifecycle, instruction sending in both database implementations, report snapshots and CSV import. A regression test verifies that disabled members remain readable in explicit detail filters while being rejected by admission-picker validation and foreign-site checks.

Browser verification uses a separate in-memory synthetic database with the real API and built application. It exercises creation, persisted membership and reload, disabled-member filters, bidirectional profile links, crew-targeted sending, a report containing exactly the two active recipients, rename, archive/restore, moving and unassigning a member, unchanged historical report counts, keyboard containment and Escape. English and Arabic layouts are checked at 320, 390, 768 and 1440 pixels, including automated accessibility and document overflow checks.

Evidence and browser helper scripts are under `artifacts/crew-completion/`. Test summaries are in `crew-tests.log`, `crew-state-tests.log`, `crew-integrations.log`; build output is in `crew-build.log`. These local artifacts are ignored by Git.

This is local implementation and verification. Native PostgreSQL concurrency, physical-device testing and public deployment are outside this change. No cloud resources, paid providers, real worker data or production accounts were used.
