import {domainTransaction,requirePrincipal,requireActiveBriefing,domainAudit} from './domain.mjs';
import {responseRead} from './responses.mjs';
import {getDraftLanguageSelection} from './settings.mjs';
import {draftLanguagesInput,sameDraftLanguages} from '../draft-languages-input.mjs';
import {reviewRequestId} from '../briefing-input.mjs';
import {randomUUID} from 'node:crypto';
import {bindPreparationAuthority} from './preparation-authority.mjs';

export function saveDraftLanguages(pool,session,id,input,{schema='public'}={}) {
  const content=draftLanguagesInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`draft-languages:${schema}:${session.org_id}:${session.site_id}:${input.requestId}`]);
    const row=(await client.query('SELECT revision FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[id,session.org_id,session.site_id])).rows[0];
    if(!row)throw Error('Briefing unavailable');
    const old=(await client.query('SELECT * FROM briefing_language_requests WHERE request_id=$1 AND org_id=$2 AND site_id=$3',[input.requestId,session.org_id,session.site_id])).rows[0];
    if(old){if(old.briefing_id!==id || old.requested_by!==session.principal_id || !sameDraftLanguages(old.request_json,content))throw Error('Draft languages request conflict');return {id,revision:old.accepted_revision,duplicate:true};}
    await requireActiveBriefing(client,session,id);
    if(row.revision!==content.revision)throw Error('Draft revision changed');
    if(JSON.stringify(await getDraftLanguageSelection(client,session.org_id,session.site_id,id))===JSON.stringify(content.generationLanguages))throw Error('Draft languages unchanged');
    const revision=row.revision+1;
    await client.query("UPDATE jobs SET status='failed',lease_token=NULL,lease_until=NULL,error='Obsolete draft revision' WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3 AND kind='prepare' AND status IN ('queued','processing')",[id,session.org_id,session.site_id]);
    await client.query("UPDATE briefings SET revision=$4,state='processing',prepared_json=NULL,updated_at=clock_timestamp() WHERE id=$1 AND org_id=$2 AND site_id=$3",[id,session.org_id,session.site_id,revision]);
    await client.query("UPDATE draft_reviews SET content_json=jsonb_set(content_json,'{revision}',$4::jsonb) WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3",[id,session.org_id,session.site_id,JSON.stringify(revision)]);
    const jobId=randomUUID();
    await client.query("INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at) VALUES($1,$2,$3,$4,$5,'prepare','queued',clock_timestamp())",[jobId,session.org_id,session.site_id,id,revision]);
    await bindPreparationAuthority(client,session,jobId);
    try{await client.query('INSERT INTO briefing_language_requests(request_id,org_id,site_id,briefing_id,accepted_revision,request_json,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.requestId,session.org_id,session.site_id,id,revision,JSON.stringify(content),session.principal_id]);}
    catch(error){if(error?.code==='23514')throw Error('Invalid generation languages');throw error;}
    await domainAudit(client,session,'briefing.languages_updated',id);
    return {id,revision,duplicate:false};
  });
}
export function draftLanguagesReceipt(pool,session,requestId,{schema='public'}={}) {
  reviewRequestId(requestId);
  return responseRead(pool,schema,async client=>{await requirePrincipal(client,session,'staff');
    const row=(await client.query('SELECT briefing_id AS id,accepted_revision AS revision,request_json AS request FROM briefing_language_requests WHERE request_id=$1 AND org_id=$2 AND site_id=$3 AND requested_by=$4',[requestId,session.org_id,session.site_id,session.principal_id])).rows[0];
    return row ? {found:true,...row} : {found:false};});
}
