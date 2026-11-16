# Authenticated UI migration

The authenticated supervisor and worker surfaces use the visual system from
[`FaresCH10/understood.dev`](https://github.com/FaresCH10/understood.dev/tree/d1a86bea8206541c6e548ef64faf6447e4fc093a).
The destination is the existing understood.ai application. The reference checkout
is kept locally in `references/understood-dev/` and excluded from Git.

## Project inspection and integration

understood.dev is a monorepo with separate supervisor and worker Vite applications.
Its current entry points render `WorkspaceApp` and `WorkerPortal`. Their API calls
use `/api/v1/operations`, `/api/v1/access`, and `/api/v1/portal`. Older supervisor
`views/` components also exist, but are not its current authenticated entry point.

understood.ai uses one role-aware React application, its own `/api/` contracts,
session context, permissions, receipt recovery, and SQLite/PostgreSQL backends.
Replacing its controllers with the reference application's API clients would
change those contracts. Instead, `src/workspace-ui.css` maps the current reference
workspace and portal surfaces onto the existing functional components.

| Reference surface | understood.ai integration |
| --- | --- |
| Light sidebar, organization card, navigation | `DashboardSidebar`, existing session organization/site and role-filtered destinations |
| Site toolbar and language selector | Existing site switcher, search, interface language picker and notification bell |
| Summary cards, panels and instruction rows | Existing overview, metrics, instruction library and live API reads |
| Composer, forms, tables and status badges | Existing instruction sending, crew/people, follow-up, calendar, reports and settings workflows |
| Worker portal cards, reading surfaces and green controls | Existing worker inbox, instruction details, answers, receipts and work progress |

Reports, notifications and settings are available directly in the sidebar.
understood.ai-specific tools, accessibility behavior, sidebar resizing, account
actions, route guards, recovery states and permissions remain available. UI copy
and metric meanings retain understood.ai's existing behavior.

Every migration style is scoped to `.dev-workspace` or `.dev-worker`, mounted
only inside the authenticated application branches. Landing pages, sign-in,
registration, worker entry and other public/authentication pages retain their
existing components and styles. No backend, API client, database schema,
authentication implementation or dependency was replaced.

## Verification

- TypeScript checking and production Vite build passed.
- 84 selected regression tests passed, including public/auth routes, session and
  role policies, instruction delivery, people management, workspace state,
  service-worker behavior and PostgreSQL instruction/workspace workflows.
- In-browser sign-in and navigation exercised the dashboard, instructions,
  calendar, people, crews, clarifications, reports, notifications and settings.
- At 390px, English and Arabic dashboard layouts and the instruction composer
  fit the viewport without document overflow. Desktop review used 1440px.
- The mobile recent-instruction table now stacks its fields and wraps language
  chips without squeezing them into a narrow table column.
- Disabling all migration CSS rules left computed colors, backgrounds,
  typography, spacing, borders, display and maximum widths unchanged throughout
  the main content of landing, sign-in, registration and worker-entry pages.
- A synthetic instruction was created and sent through the existing backend;
  the partial-delivery confirmation and receipt remained accurate. The worker
  signed in, opened the delivered instruction, submitted the correct answer,
  received the saved receipt, and reached the existing In progress state.

Browser verification used `node scripts/workspace-ui-browser-fixture.mjs`, which
starts an in-memory synthetic backend on 3037 and Vite on 3036. It does not read
`.env`, open a persistent database, or call external providers. The local
synthetic adapter supports arbitrary English instructions; the test therefore
correctly reported the unavailable Arabic/Urdu versions instead of claiming full
delivery. Live provider configuration remains the existing application's job.

Screenshots are in `output/playwright/migration-*.png`. Development Reticle bridge
connection errors were present because its local daemon was unavailable;
Playwright supplied browser verification. Production builds do not include that
development overlay. No production deployment or remote Git update was made.
