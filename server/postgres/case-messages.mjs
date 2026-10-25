import {domainTransaction,requirePrincipal,domainAudit} from './domain.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';
import {caseMessageId,caseMessageInput,caseMessageFilters,caseMessageReceipt,caseMessageRow} from '../case-message-input.mjs';
import {responseRead} from './responses.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {recordWorkerEvent} from './notification-events.mjs';

export async function scopedCase(client,session,id,write=false) {
  caseMessageId(id);const type=session?.principal_type;
  await requirePrincipal(client,session,type,write?['owner','supervisor']:['owner','supervisor','auditor']);
  if(write)await requireSiteOperational(client,session.org_id,session.site_id);
  const row=(await client.query(`SELECT c.id,c.status,a.id AS assignment_id,a.language,a.publication_id,w.active,p.state AS publication_state,publication_content_available(p.id) AS content_available
    FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id AND a.site_id=c.site_id
    JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
    WHERE c.id=$1 AND c.org_id=$2 AND c.site_id=$3 ${type==='worker'?'AND a.worker_id=$4':''} ${write?'FOR SHARE OF w,p FOR UPDATE OF c':''}`,
    [id,session.org_id,session.site_id,...(type==='worker'?[session.principal_id]:[])])).rows[0];
  if(!row)throw Error('Clarification unavailable');return row;
}
async function exactReceipt(client,session,caseId,id) {
  const row=(await client.query('SELECT * FROM case_messages WHERE id=$1 AND case_id=$2 AND org_id=$3 AND site_id=$4 AND actor_type=$5 AND actor_id=$6',
    [id,caseId,session.org_id,session.site_id,session.principal_type,session.principal_id])).rows[0];
  if(!row)throw Error('Conversation receipt unavailable');return row;
}
export function caseMessageReceiptLookup(pool,session,caseId,id,{schema='public'}={}) {
  caseMessageId(id);return domainTransaction(pool,schema,async client=>{await scopedCase(client,session,caseId);return caseMessageReceipt(await exactReceipt(client,session,caseId,id));});
}
export function listCaseMessages(pool,session,caseId,filters={}, {schema='public'}={}) {
  const {page,pageSize}=caseMessageFilters(filters);
  return responseRead(pool,schema,async client=>{
    const thread=await scopedCase(client,session,caseId);
    const total=(await client.query('SELECT count(*)::int n FROM case_messages WHERE case_id=$1 AND org_id=$2 AND site_id=$3',[caseId,session.org_id,session.site_id])).rows[0].n;
    const rows=(await client.query(`SELECT m.*,s.name AS author_name FROM case_messages m LEFT JOIN staff s ON s.id=m.actor_id AND m.actor_type='staff'
      AND s.org_id=m.org_id AND s.site_id=m.site_id WHERE m.case_id=$1 AND m.org_id=$2 AND m.site_id=$3 ORDER BY m.created_at DESC,m.id DESC LIMIT $4 OFFSET $5`,
      [caseId,session.org_id,session.site_id,pageSize,(page-1)*pageSize])).rows;
    const audio=(await client.query(`SELECT f.id FROM case_followups f JOIN case_followup_audio a ON a.request_id=f.id AND a.state='attached'
      WHERE f.id=ANY($1::text[]) AND f.status='delivered'`,[rows.map(row=>row.id)])).rows;
    const voices=(await client.query(`SELECT v.request_id FROM case_voice v LEFT JOIN retention_policies p ON p.org_id=v.org_id AND p.site_id=v.site_id
      WHERE v.request_id=ANY($1::text[]) AND v.case_id=$2 AND v.org_id=$3 AND v.site_id=$4 AND v.actor_type='worker' AND v.status='received' AND v.cleanup_state='active'
      AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests WHERE worker_id=v.worker_id)
      AND NOT EXISTS(SELECT 1 FROM case_content_purges WHERE case_id=v.requested_case_id)
      AND (p.audio_days IS NULL OR v.received_at>clock_timestamp()-p.audio_days*interval '1 day')`,[rows.map(row=>row.id),caseId,session.org_id,session.site_id])).rows;
    return {items:rows.map(row=>({...caseMessageRow(row),...(audio.some(item=>item.id===row.id)?{audioUrl:`/api/clarifications/${encodeURIComponent(caseId)}/messages/${encodeURIComponent(row.id)}/audio`}:{}),
      ...(voices.some(item=>item.request_id===row.id)?{kind:'voice',audioUrl:`/api/clarifications/${encodeURIComponent(caseId)}/messages/${encodeURIComponent(row.id)}/voice`}:{})})),total,page,pageSize,status:thread.status,language:thread.language,canReply:thread.status==='open' && thread.active && thread.publication_state==='published' && thread.content_available};
  });
}
export function sendCaseMessage(pool,session,caseId,input,{schema='public'}={}) {
  const message=caseMessageInput(input);
  return domainTransaction(pool,schema,async client=>{
    const thread=await scopedCase(client,session,caseId,true);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`case-message:${message.id}`]);
    if((await client.query('SELECT 1 FROM case_messages WHERE id=$1',[message.id])).rows.length) {
      const exact=await exactReceipt(client,session,caseId,message.id);
      if(exact.request_hash!==message.hash)throw Error('Conversation request conflict');return caseMessageReceipt(exact);
    }
    if((await client.query('SELECT 1 FROM case_followups WHERE id=$1',[message.id])).rows.length)throw Error('Conversation request conflict');
    await requireWritableEntitlement(client,session.org_id);
    if(thread.status!=='open' || !thread.active || thread.publication_state!=='published' || !thread.content_available)throw Error('Conversation is closed');
    if(session.principal_type==='staff' && thread.language!=='en')throw Error('Follow-up translation unavailable');
    const row=(await client.query(`INSERT INTO case_messages(id,org_id,site_id,case_id,assignment_id,actor_type,actor_id,language,text,request_hash,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp()) RETURNING *`,
      [message.id,session.org_id,session.site_id,caseId,thread.assignment_id,session.principal_type,session.principal_id,thread.language,message.text,message.hash])).rows[0];
    await domainAudit(client,session,'clarification.message',message.id);
    if(session.principal_type==='staff') {
      const worker=(await client.query('SELECT worker_id FROM assignments WHERE id=$1 AND org_id=$2 AND site_id=$3',
        [thread.assignment_id,session.org_id,session.site_id])).rows[0];
      if(worker) await recordWorkerEvent(client,{orgId:session.org_id,siteId:session.site_id,workerId:worker.worker_id,
        kind:'clarification.followup',objectType:'case_message',objectId:message.id,dedupeKey:`clarification.followup:${message.id}`});
    }
    return caseMessageReceipt(row);
  });
}
