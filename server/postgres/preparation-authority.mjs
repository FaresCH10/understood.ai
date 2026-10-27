import {randomUUID} from 'node:crypto';
import {scheduleAuthority} from './schedules.mjs';
import {bundleHash} from '../ai/prepared-bundle.mjs';
import {requireActiveBriefing} from './domain.mjs';
import {readGlossarySnapshot} from './glossary.mjs';
import {readGenerationLanguages} from './settings.mjs';
import {preparationInputHash} from '../ai/preparation-config.mjs';
import {checkedPreparationOperation} from '../ai/preparation-provenance.mjs';

export async function bindPreparationAuthority(client,session,jobId) {
  const authority=await scheduleAuthority(client,session),id=randomUUID();
  await client.query(`INSERT INTO preparation_authorities(id,job_id,org_id,site_id,requested_by,authority_json,session_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,jobId,session.org_id,session.site_id,session.principal_id,JSON.stringify(authority),session.token_hash ?? null]);
  await client.query('UPDATE jobs SET preparation_authority_id=$2 WHERE id=$1 AND org_id=$3 AND site_id=$4',[jobId,id,session.org_id,session.site_id]);
}

export async function checkPreparationAuthority(client,job,{required=false}={}) {
  const row=(await client.query(`SELECT p.* FROM jobs j JOIN preparation_authorities p ON p.id=j.preparation_authority_id AND p.job_id=j.id
    AND p.org_id=j.org_id AND p.site_id=j.site_id WHERE j.id=$1 AND j.org_id=$2 AND j.site_id=$3`,[job.id,job.org_id,job.site_id])).rows[0];
  if(!row){if(required)throw Error('Preparation requester unavailable');return;}
  const session={org_id:job.org_id,site_id:job.site_id,principal_type:'staff',principal_id:row.requested_by,role:row.authority_json.role,
    ...(row.session_hash===null?{}:{token_hash:row.session_hash})};
  if(bundleHash(await scheduleAuthority(client,session))!==bundleHash(row.authority_json))throw Error('Preparation authority changed');
}

export async function currentPreparationProviderClaim(client,referenceId,claimToken,orgId) {
  const row=(await client.query(`SELECT j.* FROM jobs j JOIN briefings b ON b.id=j.briefing_id AND b.org_id=j.org_id AND b.site_id=j.site_id
    WHERE j.id=$1 AND j.org_id=$2 AND j.kind='prepare' AND j.status='processing' AND j.lease_token=$3 AND j.lease_until>clock_timestamp()
    AND b.state='processing' AND b.revision=j.revision`,[referenceId,orgId,claimToken])).rows[0];
  if(!row)throw Error('Provider preparation claim changed');
  await checkPreparationAuthority(client,row,{required:true});
  await requireActiveBriefing(client,row,row.briefing_id);
  return row;
}

export async function currentPreparationOperation(client,referenceId,claimToken,orgId,context,provenance,model,inputHash) {
  checkedPreparationOperation(context,provenance,{orgId,referenceId,claimToken,model,inputHash});
  const job=await currentPreparationProviderClaim(client,referenceId,claimToken,orgId);
  if(job.site_id!==context.siteId || job.briefing_id!==context.briefingId || job.revision!==context.revision)throw Error('Provider preparation scope changed');
  const draft=(await client.query('SELECT source,title FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3',[job.briefing_id,orgId,job.site_id])).rows[0];
  const review=(await client.query('SELECT content_json FROM draft_reviews WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[job.briefing_id,orgId,job.site_id])).rows[0]?.content_json ?? null;
  const glossary=await readGlossarySnapshot(client,orgId,job.site_id);
  const regeneration=(await client.query(`SELECT b.manifest_json FROM briefing_regeneration_requests r JOIN generated_bundles b ON b.id=r.baseline_bundle_id AND b.org_id=r.org_id AND b.site_id=r.site_id
    WHERE r.briefing_id=$1 AND r.org_id=$2 AND r.site_id=$3 AND r.accepted_revision=$4`,[job.briefing_id,orgId,job.site_id,job.revision])).rows[0];
  const languages=regeneration?.manifest_json.dependencies.languages ?? await readGenerationLanguages(client,orgId,job.site_id,context.languages,job.briefing_id);
  if(!draft || preparationInputHash({source:draft.source,title:draft.title,revision:job.revision,languages,review,glossary})!==context.rootHash)throw Error('Provider preparation input changed');
  const active=(await client.query(`SELECT 1 FROM preparation_stage_events e WHERE job_id=$1 AND run_id=$2 AND step=$3 AND state='started'
    AND stage=$4 AND language=$5 AND track IS NOT DISTINCT FROM $6 AND origin='generated'
    AND NOT EXISTS(SELECT 1 FROM preparation_stage_events done WHERE done.job_id=e.job_id AND done.run_id=e.run_id AND done.step=e.step AND done.state IN ('completed','failed'))`,
    [referenceId,claimToken,context.step,context.stage,context.language,context.track])).rows.length;
  if(!active)throw Error('Provider preparation stage changed');
}
