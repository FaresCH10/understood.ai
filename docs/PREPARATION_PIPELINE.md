# Preparation Pipeline

The PostgreSQL rehearsal worker can prepare noncanonical synthetic briefings
through the existing Gemini preparation, grounding, translation, consistency
and private speech pipeline. Default is disabled. Migration 064 records the
requester's immutable authority when generation is queued; each provider
reservation/request and final attachment recheck the current actor, draft,
tenant, pause controls and lease. Legacy unattributed jobs cannot dispatch
Gemini; an explicitly authorized retry records new authority, not invented history.

Enable only an isolated LOCAL synthetic credential rehearsal with
`UNDERSTOOD_PREPARATION_ADAPTER` set to `gemini-free`, `openrouter-gemini`
(OpenRouter text with Gemini speech) or `nemotron-gemini` (NVIDIA Nemotron text
with Gemini speech), and `UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES` containing
independently reviewed synthetic input fingerprints. An input includes source, revision, target
languages, optional edits and glossary snapshot. Changing any dependency
requires a new fingerprint. Global and tenant request quotas must also be
explicitly enabled. A key alone does not enable dispatch; hosted activation
is rejected. Never allowlist real content or connect this rehearsal to real records.

To identify a known synthetic draft, keep the provider disabled and set the
scoped `UNDERSTOOD_REHEARSAL_ORG_ID`, `UNDERSTOOD_REHEARSAL_SITE_ID`,
`UNDERSTOOD_REHEARSAL_BRIEFING_ID` and
`UNDERSTOOD_FINGERPRINT_SYNTHETIC=true`, then run:

```powershell
node scripts/postgres-rehearsal.mjs fingerprint
```

This maintenance-only repeatable-read/read-only operation verifies migrations
and prints revision, languages and SHA-256, never the text, edits or terminology.
The confirmation flag is an operator assertion, not a detector of personal data.
Review fixture provenance independently before copying a hash to the private
server configuration. The command makes no provider call or business write.

Each actual generation method reserves one metered request with its model ID.
Since migration 069 it also records exact stage/root/argument/provider hashes and
model/prompt/schema. Current authority and draft dependencies are rechecked before
dispatch; bundle attachment requires immutable accepted-operation links. Failed
claims stay distinct from retries. See PREPARATION_PROVENANCE.md for evidence.
Speech objects are staged privately, read back and validated before atomic
attachment. Failure does not produce demo-ready output. Published snapshots
and audio remain unchanged by later draft edits. Current configured speech
supports English/Arabic; Urdu generation is explicitly unavailable, not silently
dropped. Full enabled-language production support remains a required gate.

## Evidence And Limits

Disposable embedded PostgreSQL/mock-provider tests cover eight English/Arabic
requests, four private WAV objects, exact published playback, immutable snapshots,
read-only fingerprints, absent/revoked authority, changed access revisions,
unallowlisted input, unsupported Urdu and closed quota. Focused regression and
strict optimized build pass. This is not live API, cloud, multi-process PostgreSQL,
native audio or all-reference release evidence. Reticle is unconnected/no verdict.
