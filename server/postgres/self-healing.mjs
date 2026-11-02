import {domainTransaction,domainAudit,requirePrincipal} from './domain.mjs';
import {createDraftInTransaction} from './preparation.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';
import {dispatchAllowed} from './operations-gates.mjs';
import {improvementSampleQuery,improvementCounts,improvementNeeded,improvementDraftInput,improvementView,decodeImprovementSnapshot} from '../self-healing-input.mjs';

const readRoles=['owner','supervisor','auditor'];
const parameterize=sql=>{let n=0;return sql.replaceAll('?',()=>`$${++n}`);};
async function publication(client,session,id,lock=false) {
  const row=(await client.query(`SELECT * FROM publications WHERE id=$1 AND org_id=$2 AND site_id=$3${lock?' FOR SHARE':''}`,
    [id,session.org_id,session.site_id])).rows[0];
  if(!row)throw Error('Publication unavailable');
  return row;
}
async function samples(client,row) {
  return (await client.query(parameterize(improvementSampleQuery),[row.id,row.org_id,row.site_id])).rows;
}
async function currentPublication(client,row) {
  return row.state==='published' && !(await client.query(`SELECT 1 FROM briefing_archives WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3
    UNION ALL SELECT 1 FROM publication_withdrawals WHERE publication_id=$4 AND org_id=$2 AND site_id=$3`,
  [row.briefing_id,row.org_id,row.site_id,row.id])).rows.length;
}
async function detect(client,row) {
  if(!await currentPublication(client,row))return false;
  const counts=improvementCounts(await samples(client,row));
  if(!improvementNeeded(counts))return false;
  const changed=(await client.query(`INSERT INTO instruction_improvements(publication_id,org_id,site_id,briefing_id,assessed,matched,clarification,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()) ON CONFLICT(publication_id) DO NOTHING RETURNING publication_id`,
  [row.id,row.org_id,row.site_id,row.briefing_id,counts.assessed,counts.matched,counts.clarification])).rows.length>0;
  if(changed)await domainAudit(client,{...row,principal_type:'system',principal_id:'instruction-improvement-worker'},'instruction.improvement_suggested',row.id);
  return changed;
}
async function read(client,session,id,integrationMode='synthetic') {
  const row=await publication(client,session,id),signal=(await client.query('SELECT * FROM instruction_improvements WHERE publication_id=$1 AND org_id=$2 AND site_id=$3',
    [id,session.org_id,session.site_id])).rows[0];
  const followup=(await client.query(`SELECT f.*,p.id AS followup_publication_id,p.state AS followup_publication_state FROM instruction_improvement_drafts f
    LEFT JOIN publications p ON p.briefing_id=f.corrective_briefing_id AND p.org_id=f.org_id AND p.site_id=f.site_id
    WHERE f.publication_id=$1 AND f.org_id=$2 AND f.site_id=$3 ORDER BY p.version DESC LIMIT 1`,[id,session.org_id,session.site_id])).rows[0];
  let after=[];
  if(followup?.followup_publication_id){
    const cohort=new Set((await client.query('SELECT worker_id FROM assignments WHERE publication_id=$1 AND org_id=$2 AND site_id=$3',[id,session.org_id,session.site_id])).rows.map(value=>value.worker_id));
    after=(await samples(client,{...row,id:followup.followup_publication_id})).filter(value=>cohort.has(value.worker_id));
  }
  const result=improvementView(row,signal,await samples(client,row),followup,after,{integrationMode});
  if(!await currentPublication(client,row))result.eligible=false;
  return result;
}
async function authority(client,session,write=false) {
  await requirePrincipal(client,session,'staff',write?['owner','supervisor']:readRoles);
  await requireSiteOperational(client,session.org_id,session.site_id);
  if(write)await requireWritableEntitlement(client,session.org_id,{lock:true});
}
export async function readInstructionImprovement(pool,session,id,{schema='public',integrationMode='synthetic'}={}) {
  return domainTransaction(pool,schema,async client=>{await authority(client,session);return read(client,session,id,integrationMode);});
}
export async function analyzeInstructionImprovement(pool,session,id,{schema='public',integrationMode='synthetic'}={}) {
  return domainTransaction(pool,schema,async client=>{
    await authority(client,session,true);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`instruction-improvement:${id}`]);
    await detect(client,await publication(client,session,id,true));return read(client,session,id,integrationMode);
  });
}
export async function createImprovementDraft(pool,session,id,input,{schema='public',integrationMode='synthetic'}={}) {
  const change=improvementDraftInput(input);
  return domainTransaction(pool,schema,async client=>{
    await authority(client,session,true);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`instruction-improvement:${id}`]);
    const row=await publication(client,session,id,true);
    const old=(await client.query('SELECT * FROM instruction_improvement_drafts WHERE publication_id=$1 AND org_id=$2 AND site_id=$3',[id,session.org_id,session.site_id])).rows[0];
    if(old){if(old.request_id!==change.requestId || old.request_hash!==change.hash)throw Error('Improvement request conflict');return {...await read(client,session,id,integrationMode),duplicate:true};}
    const view=await read(client,session,id,integrationMode);
    if(!view.eligible || !view.signal || !view.suggestion)throw Error('Improvement not available');
    const snapshot=decodeImprovementSnapshot(row.snapshot_json);
    const draft=await createDraftInTransaction(client,session,{requestId:change.requestId,title:change.title,source:change.source,generationLanguages:Object.keys(snapshot.languages)},schema);
    if(draft.duplicate)throw Error('Improvement request conflict');
    await client.query(`INSERT INTO instruction_improvement_drafts(publication_id,request_id,org_id,site_id,corrective_briefing_id,request_hash,requested_by,created_at)
      VALUES($1,$2,$3,$4,$2,$5,$6,clock_timestamp())`,[id,change.requestId,session.org_id,session.site_id,change.hash,session.principal_id]);
    await domainAudit(client,session,'instruction.improvement_drafted',id);
    return {...await read(client,session,id,integrationMode),duplicate:false};
  });
}
export async function processOneInstructionImprovement(pool,{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{
    if(!await dispatchAllowed(client,null))return false;
    const rows=(await client.query(`SELECT p.* FROM publications p WHERE p.state='published'
      AND NOT EXISTS(SELECT 1 FROM instruction_improvements i WHERE i.publication_id=p.id)
      AND EXISTS(SELECT 1 FROM attempts t JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id WHERE a.publication_id=p.id)
      ORDER BY p.published_at,p.id FOR SHARE OF p SKIP LOCKED`)).rows;
    for(const row of rows){
      if(!await dispatchAllowed(client,row.org_id))continue;
      try{await requireWritableEntitlement(client,row.org_id);await requireSiteOperational(client,row.org_id,row.site_id);}catch(error){if(['Workspace is read-only','Site archived'].includes(error.message))continue;throw error;}
      if(await detect(client,row))return true;
    }
    return false;
  });
}
