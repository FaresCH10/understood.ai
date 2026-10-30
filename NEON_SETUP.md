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

`npm run dev` intentionally still uses the existing SQLite application database. No local accounts, instruction data, or recordings were migrated. The hosted PostgreSQL backend now accepts CLI database variables and existing private storage adapters accept mapped AWS variables, but a complete runtime/data cutover has **not** been performed. Realtime notification integration is used by PostgreSQL deployments, not the local SQLite backend.

Full hosting still requires selecting the frontend/API/worker hosting targets, setting the real HTTPS application origin and trusted proxy configuration, performing the existing backup/import and runtime-role setup, and satisfying the repository's production runtime admission checks. Applying the schema or a successful service probe is not evidence that the full app has been deployed.

## Agent tooling and failures

- Official requested skill was downloaded into `artifacts/neon-setup/neon-SKILL.md` and read. Seven relevant Neon skills are installed under `.agents/skills`.
- `.codex/config.toml` adds OAuth MCP at `https://mcp.neon.tech/mcp?readonly=true&projectId=lucky-surf-24349943`. No account-wide API key was minted. Restart/reopen the Codex project to load newly installed tools if they are not visible.
- Global CLI installation failed with npm DNS resolution; `npx --yes neon@latest` succeeded.
- Initial init installed the Codex plugin but exited unsuccessfully because the unrelated GitHub Copilot CLI plugin failed. Project-specific Codex skills and MCP were subsequently installed successfully.
- First deployment rejected AI Gateway on the Free plan. The other five services deployed after Gateway became opt-in.
- Realtime initially lacked `ws`; it passed after installing that optional peer dependency.
- Production dependency audit: 0 vulnerabilities. Full install audit: 8 high-severity development/tooling findings remain; no forced dependency upgrades were applied.
- Existing secrets stay in ignored `.env`. CLI-managed values were pulled there; they must never be copied into public Vite variables.
