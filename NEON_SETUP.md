# Neon setup

Project: `lucky-surf-24349943`, organization `org-bitter-cherry-71090908`, branch `production`.

## Provisioned and verified

- PostgreSQL: application schema `understood`, all 114 existing migrations applied and verified. Existing `neon_auth` tables preserved.
- Auth: CLI-provided Auth URL is consumed by registration verification. The explicit application URL was updated to the supplied `ep-square-glitter` endpoint. Local origins `http://127.0.0.1:3020` and `http://localhost:3020` were added with user approval. A live OTP dispatch was accepted; inbox receipt and code submission need the email recipient.
- Object Storage: private `assets` bucket. Live authenticated upload/download and anonymous-denial checks passed; synthetic test objects were removed.
- Functions: `hello` now implements Understood readiness with an injected PostgreSQL connection. `/api/neon/status` calls it from the application backend.
- Realtime: live snapshot and subsequent SQL-update delivery passed. The PostgreSQL API can seal tenant-scoped notification invalidation queries; the notification bell subscribes when supported and retains polling on SQLite deployments. Query secrets never enter the browser bundle.
- AI: existing Gemini retained at the user's request. Neon AI Gateway is disabled unless `UNDERSTOOD_NEON_ENABLE_AI_GATEWAY=true` after a paid-plan upgrade.

## Reproduce checks

```powershell
npm run build
node --test tests/neon-environment.test.mjs tests/neon-verification.test.mjs tests/registration.test.mjs
npm run neon:check
npm run dev
```

Observed: build succeeded; 20 focused tests passed, 0 failed; live service check returned `passed: true`. The restarted application returned HTTP 200 on port 3020, healthy API on 3021, Neon Functions/PostgreSQL connected on `/api/neon/status`, and Neon-code registration available.

## Important deployment boundary

### Vercel registration fix (30 October 2026)

The Vercel gateway now selects the persistent Neon PostgreSQL handler when
`DATABASE_URL` is present. It verifies the existing migrations in schema
`understood` (override with `UNDERSTOOD_POSTGRES_SCHEMA`) and does not migrate,
seed, or import data during requests. Accounts and sessions share this backend.
The application remains in its existing synthetic AI mode; this does not claim
production admission or replace the background worker needed for other jobs.

Set these **server-only Production variables** in the `understood-ai` Vercel project:

- `DATABASE_URL`: the existing pooled Neon connection string.
- `NEON_AUTH_BASE_URL`: the Auth URL for the same project/branch.
- `UNDERSTOOD_AUTH_MAIL_KEY`: the existing 64-character hexadecimal encryption key;
  preserve it across deployments so pending registrations remain readable.
- `UNDERSTOOD_REGISTRATION_PROVIDER=neon`: explicit selection is recommended.
  A configured Neon Auth URL also selects Neon by default when this is absent.
- `VERCEL_PROJECT_PRODUCTION_URL`: Vercel normally supplies this automatically.
  The canonical origin must be `https://understood-ai.vercel.app`.

The existing Neon AWS storage variables configure private attachments/audio when
present. Resend credentials are not required for Neon registration. Password
recovery and invitation emails are separate mail flows.

The hosted origin was added to Neon Auth's trusted domains; the two previously
approved local origins remain. Registration and resend await dispatch of only
that registration's queued email before the serverless request ends. Provider
failure returns HTTP 503 and retains the queue's bounded retry handling. The
in-memory demo fallback now refuses online registration rather than accepting a
registration it cannot persist or deliver.

Validation: build passed; 32 focused tests passed, including failed dispatch,
resend, handler replacement, expired-registration receipts, code verification
and subsequent staff sign-in. The browser now retains the server's canonical
registration ID when an expired registration is restarted.

Deployed and promoted `dpl_GqV3mxHm7kHW4smPx37nQnHCkoMM` to
`https://understood-ai.vercel.app` on 30 October 2026. The public health endpoint
returned HTTP 200 with backend `postgres-vercel-synthetic`; registration options
returned `available:true, verification:neon-code`. A real public signup returned
HTTP 202 and persisted a `sent` dispatch receipt with `attempts:1` and a provider
receipt. The user confirmed the email arrived. A restarted expired test
registration also returned the correct canonical receipt and dispatched on its
first attempt. Synthetic pending registrations were expired without activating
accounts. Entering a live inbox code remains untested; code verification and
subsequent sign-in passed integration tests.

Existing Production variables were preserved. Vercel linking created ignored
`.vercel/project.json` and `.env.local`; configuration inspection wrote the
ignored `artifacts/vercel-production.env` (protected values remain placeholders).
Vercel CLI generated an automation protection-bypass token when checking the
protected deployment URL. Uploads initially failed with transient network
errors; archive upload retries succeeded. No source commit or push was made.

`npm run dev` intentionally still uses the existing SQLite application database. No local accounts, instruction data, or recordings were migrated. The hosted PostgreSQL backend now accepts CLI database variables and existing private storage adapters accept mapped AWS variables, but a complete runtime/data cutover has **not** been performed. Realtime notification integration is used by PostgreSQL deployments, not the local SQLite backend.

Full hosting still requires selecting the frontend/API/worker hosting targets, setting the real HTTPS application origin and trusted proxy configuration, performing the existing backup/import and runtime-role setup, and satisfying the repository's production runtime admission checks. Applying the schema or a successful service probe is not evidence that the full app has been deployed.

## Agent tooling and failures

### Worker direct links and assigned credentials (30 October 2026)

Worker link entry now automatically submits the private token and opens the inbox
after verifying the resulting worker session and matching grant digest. The
existing one-time redemption, expiry, tenant/site access, revocation and shared
device cleanup checks remain. No worker ID or password is required on this path;
manual company ID / worker ID / password sign-in remains available.

The supervisor Add worker form and its public API now require an assigned password
and worker ID. Both database backends create the worker and hashed credentials in
one transaction. Internal import/migration helpers retain their existing separate
credential-provisioning path. Generated passwords use browser cryptographic
randomness with rejection sampling and are 18 characters long. Generation and
show/hide controls exist on Add worker and the credential assignment dialog.
Plaintext passwords are not stored in browser storage or sent to a generator API.

Build and 30 focused tests passed. Tests cover atomic PostgreSQL creation,
password authentication, token-only worker entry, one-time redemption, expiry,
revocation and rejected creation without a password. An isolated browser test
confirmed automatic inbox navigation with one token-only request; a clean-browser
check confirmed all normal worker sign-in inputs remain available.
The final worker-access build was deployed to `understood-ai.vercel.app` as
`dpl_9eYMxSLnQEx9ccZoMbL4TGazqHqc`. The live API remains healthy and rejects
invalid token-only links with HTTP 401.

### New-user OTP verification and screen correction (30 October 2026)

Neon accepted and delivered sign-in OTP emails for new addresses, but the old
`/email-otp/check-verification-otp` call returned `USER_NOT_FOUND` before checking
the code. Verification now uses `/sign-in/email-otp` and requires a verified user
whose email exactly matches the registration. Provider tokens/cookies are not
forwarded to the browser or used as an Understood session. The app still activates
the immutable pending registration once and requires a separate staff sign-in.
Expired/incorrect codes, rate limits and provider outages have distinct safe error
codes and translated UI messages.

The verification screen now has a single unboxed form, a prominent numeric input,
adjacent validation errors, quieter resend feedback and simpler secondary actions.
Desktop and 390px mobile screenshots were inspected with Playwright; no mobile
horizontal overflow was found. Reticle's mocked 202 registration checks remained
undecided and were not counted as functional proof.

Build and 28 focused tests passed, including new-user verification through the
HTTP endpoint with Neon's real response shape. Deployment
`dpl_57v2TBUujAe66rVhUfkV2Mt2ssbi` was promoted to the live domain. After explicit
user approval to activate the existing workspace, its fresh inbox code produced
HTTP 200 with `completed:true, signInRequired:true, duplicate:false`. The original
registration password was preserved. Verification codes were not saved to files.

### Vercel session startup correction (30 October 2026)

The Vercel project was recreated as `prj_ZHwxn7wXRYwhO7wyiPOQEcEuN9Xz`.
The local link now targets that existing project. Its Node.js setting was aligned
from 26.x to the application's 24.x requirement.

The database ledger contained 113 checksums generated from CRLF migration files.
A Linux Git checkout used LF, so strict raw-byte verification refused startup.
Migration checks now use canonical LF for new migrations and accept historical
LF/CRLF checksums for the same SQL. SQL edits still fail verification. No database
ledger or schema changes were needed. `.gitattributes` pins migration files to LF;
`vercel.json` explicitly includes them in the gateway function. Startup errors now
log safe error categories without credentials or provider details.

Build passed; migration/registration tests passed, including SQL-change rejection
and an authenticated session validated against the frontend contract. All 114 LF
migrations passed against the existing Neon ledger. Deployment
`dpl_5X8xxnRnHEo6F23xaRxknHTgrdxi` was promoted to the public domain. Public health,
session and registration-options endpoints returned HTTP 200. Reticle confirmed
the public page and supervisor sign-in form load without the session error.
Changes remain local and must be included in the next Git push to preserve this
fix in later Git-triggered deployments.

- Official requested skill was downloaded into `artifacts/neon-setup/neon-SKILL.md` and read. Seven relevant Neon skills are installed under `.agents/skills`.
- `.codex/config.toml` adds OAuth MCP at `https://mcp.neon.tech/mcp?readonly=true&projectId=lucky-surf-24349943`. No account-wide API key was minted. Restart/reopen the Codex project to load newly installed tools if they are not visible.
- Global CLI installation failed with npm DNS resolution; `npx --yes neon@latest` succeeded.
- Initial init installed the Codex plugin but exited unsuccessfully because the unrelated GitHub Copilot CLI plugin failed. Project-specific Codex skills and MCP were subsequently installed successfully.
- First deployment rejected AI Gateway on the Free plan. The other five services deployed after Gateway became opt-in.
- Realtime initially lacked `ws`; it passed after installing that optional peer dependency.
- Production dependency audit: 0 vulnerabilities. Full install audit: 8 high-severity development/tooling findings remain; no forced dependency upgrades were applied.
- Existing secrets stay in ignored `.env`. CLI-managed values were pulled there; they must never be copied into public Vite variables.
