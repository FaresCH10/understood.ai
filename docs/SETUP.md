# Local setup

The default preview instructions below remain SQLite/synthetic and do not activate
live providers. A separate authoritative PostgreSQL credential rehearsal and
synthetic hosted staging runtime now exist; neither is permission for real data.
See POSTGRES_RUNTIME.md and DEPLOYMENT_TARGET.md for infrastructure setup, and
PREPARATION_PIPELINE.md, ASSESSMENT_PIPELINE.md and RECORDING_PIPELINE.md for the
independent default-off synthetic worker/provider switches and fingerprint commands.
Environment example files contain no keys and are not automatically loaded.

The default launcher is loopback-only and synthetic. It is not safe for a public
network or real worker data. Node.js 24.5.0 or newer is required; `node:sqlite`
remains experimental. Separate credential-mode PostgreSQL and hosted synthetic
launchers exist. Metered synthetic Gemini adapters have partial live evidence,
but the complete voice/quality and real-worker privacy gates are not complete.
Nothing in these default setup commands enables live providers or real email.

From `D:\understod`:

```powershell
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' ci
node server/seed.mjs
node scripts/dev.mjs
```

The web app listens at `http://127.0.0.1:3020`; the API at `http://127.0.0.1:3021`. The dev script selects local/synthetic/credential modes and starts the synthetic job worker. To launch the API or worker directly, set `UNDERSTOOD_TIER=local`, `UNDERSTOOD_AI_MODE=synthetic`, and `UNDERSTOOD_ACCESS_MODE=credential`. The app persists to `data/understood.sqlite`; uploaded WAV files are private under `data/private-audio`. Seeding is idempotent and does not reset existing attempts, cases, or sessions. Preserve both paths during recovery.

Sign in with a work email and password, or a worker company ID and password. There is no profile picker. Staff credentials must be provisioned; workers need an assigned password or grant. The synthetic adapter only prepares the exact seeded shelf-colour source and is deliberately labeled as such. Audio receipt does not produce an AI outcome in this mode.

Build before running the complete tests: hosted-runtime tests serve the built
public files. Do not rebuild `dist` while that suite is running. These checks do
not require seeding or changing the original preview database:

```powershell
npm run build
npm test
npm run evaluate:contract
npm run evaluate:rehearsal
```

For an isolated new source copy and locked dependency installation, use
`node scripts/clean-verify.mjs --confirm-local-clean`; see
[CLEAN_VERIFICATION.md](CLEAN_VERIFICATION.md) for the explicit cache-download
option, retained evidence and native-test limits. It excludes original data,
dependencies, build output and cloud/provider configuration.

Maya's People view supports worker/crew changes and staged, explicitly confirmed CSV import. Reports supports language breakdown, a publication selector and queued exports with scoped history/download/expiry. These use the local database and synthetic worker; see `REPORTS_IMPORTS.md`. Local backup/isolated restore commands and sensitive-data limitations are in `LOCAL_BACKUP.md`. The default app uses SQLite/local files; the separate PostgreSQL application runtime and private R2 adapter are implemented. Native isolated Neon tests are recorded in `NEON_LOGIN_REHEARSAL.md`, not evidence of a hosted deployment or private R2 activation.

`UNDERSTOOD_MODE` is obsolete. Production tier and live AI mode intentionally refuse startup until the missing database, private storage, metering and provider gates are complete. Access is credential-only; staff credentials must be explicitly provisioned and worker grants issued by an authorized staff account. The Gemini free-tier adapter is only for synthetic evaluation and is not called by `scripts/dev.mjs` unless `--credential-test`; do not add a real worker's data to that evaluation or put an API key in the frontend.

## Neon company-registration verification

Set `UNDERSTOOD_REGISTRATION_PROVIDER=neon`, `UNDERSTOOD_NEON_AUTH_URL` to the
branch's HTTPS Auth URL ending in `/neondb/auth`, and preserve the existing
64-character hexadecimal `UNDERSTOOD_AUTH_MAIL_KEY`. The key seals pending
registration records; changing it makes existing pending records unreadable.
Set `UNDERSTOOD_PUBLIC_ORIGIN` to the exact browser origin. Restart both the API
and worker after changing `.env` (`npm run dev` loads it for both processes).
Hosted deployments must supply these settings to both services.

Neon Auth must have Email signup/signin enabled. Enable Verify at Sign-up with
Verification code and configure the app's origin in Neon. See
[Neon's Email OTP guide](https://neon.com/docs/auth/guides/plugins/email-otp).
The local setup was checked against the supplied Auth endpoint on 2026-10-28:
an invalid code returned 400/INVALID_OTP, and the authorized test email request
returned 200/success. Provider acceptance does not confirm inbox delivery.

New registrations request a six-digit Neon code. Entering a valid code activates
one Understood workspace and its 14-day/25-worker trial. Staff then sign in with
their Understood email/password. Worker IDs, credentials and sessions remain
managed by Understood. Arabic and Persian digits are accepted by the code field.
No Resend fallback occurs for this verification flow.

The integration uses Neon's `sign-in` OTP issuance and **check-only** endpoint;
it does not create a Neon user/session or change a Neon password. The local
registration is consumed once; the check-only endpoint does not consume the
provider's code. Provider expiry and attempt limits apply alongside the app's
registration expiry and per-registration/IP verification budgets. An expired
registration must be restarted; requesting another code does not extend it.
Old Understood verification links retain their existing expiry checks.

Invitation, password recovery and other mail still use their existing mail
adapter. This change does not migrate those flows. Neon's shared SMTP is intended
for development/testing; configure custom SMTP before production. See the
[Neon production checklist](https://neon.com/docs/auth/production-checklist).
