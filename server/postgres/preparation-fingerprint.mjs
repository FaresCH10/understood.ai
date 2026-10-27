import {withTransaction} from './db.mjs';
import {schemaName} from './migrate.mjs';
import {readGlossarySnapshot} from './glossary.mjs';
import {readGenerationLanguages} from './settings.mjs';
import {preparationInputHash} from '../ai/preparation-config.mjs';
import {reviewContent} from '../ai/prepared-bundle.mjs';

// Maintenance-only read: output a fingerprint, never the source, edits or glossary.
export function readPreparationFingerprint(pool,{orgId,siteId,briefingId,confirmedSynthetic},{schema='public'}={}) {
  if(confirmedSynthetic!==true || ![orgId,siteId,briefingId].every(value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)))throw Error('Confirm a known synthetic scoped draft');
  schemaName(schema);
  return withTransaction(pool,async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await client.query("SELECT set_config('search_path',quote_ident($1)||',pg_catalog',true),set_config('lock_timeout','5s',true),set_config('statement_timeout','10s',true)",[schema]);
    const draft=(await client.query(`SELECT source,title,revision FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3
      AND NOT EXISTS(SELECT 1 FROM briefing_archives a WHERE a.briefing_id=briefings.id)`,[briefingId,orgId,siteId])).rows[0];
    if(!draft || typeof draft.source!=='string' || !draft.source.trim() || draft.source.length>4000)throw Error('Synthetic draft unavailable');
    const review=(await client.query('SELECT content_json FROM draft_reviews WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[briefingId,orgId,siteId])).rows[0]?.content_json ?? null;
    reviewContent(review,draft.revision);
    const regeneration=(await client.query(`SELECT b.manifest_json FROM briefing_regeneration_requests r JOIN generated_bundles b ON b.id=r.baseline_bundle_id AND b.org_id=r.org_id AND b.site_id=r.site_id
      WHERE r.briefing_id=$1 AND r.org_id=$2 AND r.site_id=$3 AND r.accepted_revision=$4`,[briefingId,orgId,siteId,draft.revision])).rows[0];
    const languages=regeneration?.manifest_json.dependencies.languages ?? await readGenerationLanguages(client,orgId,siteId,['en','ar','ur'],briefingId);
    const glossary=await readGlossarySnapshot(client,orgId,siteId);
    return {revision:draft.revision,languages,fingerprint:preparationInputHash({source:draft.source,title:draft.title,revision:draft.revision,languages,review,glossary})};
  });
}
