# Personal PC-backed Vercel demo

Deployed 2026-10-25 at https://understood-pc-demo.vercel.app for the user's confirmed personal, non-commercial demonstration with synthetic data only.

## What runs where

- Vercel Hobby: built public frontend assets and a same-origin external API rewrite. No Vercel API function, database, credentials, or private recordings were uploaded.
- This Windows PC: Node API on `127.0.0.1:3045`, durable worker, PostgreSQL 18 using the existing loopback TLS cluster, and isolated private file storage.
- Official Cloudflare `cloudflared` 2026.10.3: temporary outbound HTTPS tunnel to this API only. Binary verified against the official release SHA-256.
- New database `understood_pc_demo`, schema `understood_stage_pc_demo`. Separate unprivileged application and worker logins. Existing databases and saved demo data were not replaced.

Vercel's deployment target is called `production`; the application remains **synthetic staging**. This does not pass or bypass the production release gates.

## Sign in

The generated synthetic owner login is in `artifacts/pc-demo/LOGIN.private.txt`. Open it locally; never commit or share it. The account email is reserved for synthetic use and does not receive email.

Private connection details are in `artifacts/pc-demo/runtime.json`. The entire directory is Git-ignored and has Windows access limited to the current Windows account and SYSTEM. Vercel CLI credentials remain in the official CLI credential store.

## Start, stop and restart

For everyday use, double-click **Start Understood** on the Windows desktop. It opens the site immediately if the demo is healthy; otherwise it starts or repairs the local services, refreshes the Vercel connection, and opens sign-in. A separate **Stop Understood** desktop shortcut stops only the demo services and preserves saved data. The same launchers are available as `Start Understood.cmd` and `Stop Understood.cmd` in the repository.

The desktop project's `.codex/environments/environment.toml` also defines Start Understood and Stop Understood actions for Codex's action menu. The installed app's action menu could not be visually verified while its window was minimized. The desktop launcher was executed successfully against the running demo.

The launcher serializes repeated clicks, keeps a visible error window if startup fails, and records fresh startup details in `artifacts/pc-demo/launcher-last-run.log`. Keep the repository, the `artifacts/pc-demo` directory and the PostgreSQL directory in place; the shortcuts depend on them.

Restart repair on 2026-10-25: Windows PowerShell startup now captures PostgreSQL/Vercel stderr without treating ordinary progress or stale-PID warnings as fatal errors. PostgreSQL control waits for its own process rather than inherited server pipes, retains the process handle for reliable exit-code inspection, and the tunnel parser tolerates an initially empty log. Deployment uses the installed pinned Vercel CLI when available. Public credential smoke checks and the already-running launcher path passed after reconnecting the demo.

Run these from the repository in PowerShell:

```powershell
powershell -NoProfile -File scripts/pc-demo-control.ps1 status
powershell -NoProfile -File scripts/pc-demo-control.ps1 stop
powershell -NoProfile -File scripts/pc-demo-control.ps1 start
```

`stop` stops only the recorded demo API, worker and tunnel after checking process identity. It leaves the shared PostgreSQL cluster and all data intact. `start` starts PostgreSQL if necessary, creates a fresh tunnel, updates the API's exact allowed tunnel hostname, rebuilds the Vercel output from the existing `dist`, redeploys the API rewrite, and runs the public smoke check. Vercel CLI sign-in and Internet access must remain available.

After source changes, run `npm run build` before restarting. Startup does not silently rebuild or change application source. No automatic Windows startup, sleep policy, firewall rules or router forwarding were configured.

The frontend remains online when this PC stops, but login and all other API actions need the PC awake, connected, and running PostgreSQL/API/worker/tunnel. The temporary tunnel hostname changes on restart, which is why `start` redeploys the rewrite. Quick Tunnels provide no uptime guarantee.

## Features deliberately unavailable

- Real AI transcription, translation, speech and assessment providers are not configured. Existing deterministic synthetic processing remains limited to its supported fixtures; this is not a general-purpose local AI installation.
- Real web-push delivery remains disabled. Email is now explicitly configurable through a private file on the PC; see the email setup below. Do not interpret queued mail as confirmed delivery.
- No real worker/customer data, paid provider calls, payment processing, production operator endpoint or real-data release was enabled.

The local API retains normal credential authentication, exact-origin mutation checks, secure HttpOnly SameSite cookies and runtime database permission checks. Private audio remains outside the web build. Only API paths are routed to the PC. Rate limiting sees the proxy address for Vercel-originated requests, so users can share an IP allowance in this demo.

## Verification and evidence

- `npm run build`: passed, with the existing large-chunk/dynamic-import warnings.
- `node --test tests/pc-demo-config.test.mjs`: 3 passed. Covers synthetic-only isolation, trusted loopback transport and no-cache API routes.
- `node scripts/pc-demo-smoke.mjs`: passed against the local API.
- `node scripts/pc-demo-smoke.mjs --public`: passed through the Vercel address, including PostgreSQL owner login, authenticated session, secure cookie flags, rejected cross-origin login and disabled predictable demo login.
- Browser verification: owner sign-in reached the Today dashboard through the public Vercel address. Stop/start commands were exercised successfully, creating a new tunnel and redeploying the API rewrite; public smoke checks passed afterward.
- Evidence: `artifacts/pc-demo/smoke-local.json`, `smoke-public.json`, `vercel-project.json`, and per-service logs. These contain no printed passwords or connection URLs.
- Full application suite was not rerun for this isolated deployment; existing production readiness remains NO-GO.

Official references: [Vercel Build Output API](https://vercel.com/docs/build-output-api/configuration), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Real verification email

The PC runtime can now load email settings from the absolute `mailSecretPath` reference in its private runtime JSON. The API and durable worker use the same stable encryption key. Email secrets are never included in the Vercel output.

The user chose an initial test to their own Resend account inbox. The `onboarding@resend.dev` sender can deliver only to that account's email. Sending verification links to other recipients requires a domain owned by the user, verified in Resend, and a matching sender address. The free Vercel subdomain is not a sender domain owned by the user.

Private settings: `artifacts/pc-demo/.env.email.local`. After changing the provider key or sender, run:

```powershell
node scripts/pc-demo-mail.mjs check
node scripts/pc-demo-mail.mjs enable
powershell -NoProfile -File scripts/pc-demo-control.ps1 restart-services
node scripts/pc-demo-registration-status.mjs
```

Do not change `UNDERSTOOD_AUTH_MAIL_KEY` while pending registration, invitation or password recovery envelopes exist. Provider API keys can be replaced in the file without changing this encryption key. Never paste credentials into chat.

Registration keeps its existing one-use, 24-hour verification tokens, sealed outbox payloads, durable retries, origin checks, and atomic trial creation. The same verification link can be retried safely after an uncertain response without creating a duplicate workspace. Resend acceptance is evidence of sending; inbox arrival and clicking the link must be checked separately.

Relevant tests after the mail wiring change: 23 passed across PC configuration, SQLite registration and PostgreSQL registration. Coverage includes link expiry, resend rotation, duplicate prevention, transaction rollback and runtime permission boundaries.

End-to-end confirmation on 2026-10-25: the user registered through the public Vercel app, Resend accepted the verification email on its first attempt, the user confirmed inbox arrival and completed verification, and the local PostgreSQL record changed to `verified` with the token marked used. Redacted evidence is in `artifacts/pc-demo/registration-status.json`. No real email addresses, keys, passwords or verification tokens are included in that evidence.

The provider key was supplied in chat during setup. It should be revoked and replaced through Resend, updating only `UNDERSTOOD_RESEND_KEY` in the private file and restarting the API/worker. Keep the separate mail encryption key unchanged.

Official email references: [Verified domains](https://resend.com/docs/dashboard/domains/introduction), [Resend test sender restrictions](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).
