# Move the existing Vercel workspace to production

Source: `understood-ai.vercel.app`, currently running `postgres-vercel-synthetic`. Target: a separate Neon database and private storage namespace, with the Vercel API and a durable worker on the same production schema. Use the current workspace as the source and keep it available during the rehearsal. No migration or cutover has been run.

## Rehearse the record migration

1. Identify the workspace and sites to move. Produce a scoped inventory of staff and roles, worker IDs and languages, crews and membership, instructions and drafts, and any response, case, audit or private media history to retain. Flag duplicate workers and audit/demo records for review. Keep approved historical synthetic results labeled as such.
2. Prepare the target `understood_prod_*` schema with current migrations. Use separate restricted application and worker database logins. Prepare private storage in the target. Keep outbound jobs, notifications and customer access paused during the copy and validation.
3. Take an encrypted source backup and rehearse its restore into isolation. The existing backup utility restores the original schema name and the whole application schema. Its CLI supports local or R2 storage. If the source has private Neon media, verify the object inventory and use a reviewed Neon-compatible copy path. Treat the restore as a recovery copy. For the production target, rehearse a scoped import into the new schema with explicit table mappings, preserved public worker IDs, and validation for dependent records and objects. The existing worker CSV only covers worker ID, language and optional crew, so it cannot migrate full history.
4. Compare source and target counts by site and status. Check a sample of worker codes, crew relationships, language selections, instruction versions, assignments, responses, and private file hashes. Review deletions and retention rules before activating the copy. Reissue worker access where needed and require a fresh sign-in. Expire old sessions, temporary grants and pending mail, and review pending drafts and jobs before any are resumed.

## Prepare the live instruction pipeline

Keep the existing free Gemini key for synthetic prompts only. The production pipeline requires a paid, reviewed Gemini project, evaluated models for text, transcription and speech, and a release approval matching the selected languages. Use English and Arabic for the first acceptance run if they cover the intended initial recipients, then expand the approved scope after language review. Put the provider key in the worker's secret store. The Vercel API queues the work and uses its own database and storage credentials.

Set up the Vercel and worker environments using [the production runtime runbook](WORKER_PRODUCTION_RUNTIME.md). Check both with `npm run production:admission`. Verify that the API readiness route sees a healthy worker and that a controlled instruction completes the full flow from preparation and delivery through worker response and supervisor result. Use the same region for Vercel and Neon where available.

## Cut over after review

Agree on a short write freeze and a rollback owner. Take the final source snapshot, repeat the verified import, compare the final counts and records, then switch the production deployment to the target. Reopen writes after the health and smoke checks pass. If the smoke check fails before reopening writes, restore routing to the source. If production has already accepted writes, reconcile those writes before switching back so they are not lost.

Before scheduling the migration, confirm which historical records to bring forward, whether the release can use a paid provider, and which private storage and worker host to use. Add credentials directly to the corresponding service settings.
