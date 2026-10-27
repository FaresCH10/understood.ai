import {randomUUID} from 'node:crypto';
import {inspectWav} from '../audio.mjs';
import {caseMessageId} from '../case-message-input.mjs';
import {domainTransaction,requirePrincipal,domainAudit} from './domain.mjs';
import {scopedCase} from './case-messages.mjs';
import {routeNewCase} from './case-routing.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';

const labels={en:'Voice message',ar:'رسالة صوتية',ur:'صوتی پیغام',hi:'आवाज़ संदेश',bn:'ভয়েস বার্তা',ml:'ശബ്ദ സന്ദേശം',ta:'குரல் செய்தி',te:'వాయిస్ సందేశం',ne:'आवाज सन्देश',fil:'Mensahe ng boses',si:'හඬ පණිවිඩය',ru:'Голосовое сообщение','pa-Guru':'ਆਵਾਜ਼ ਸੁਨੇਹਾ','pa-Arab':'آواز دا پیغام',id:'Pesan suara'};
const receipt=row=>({id:row.request_id,caseId:row.requested_case_id,assignmentId:row.assignment_id,kind:row.kind,sha256:row.sha256,status:row.status,createdAt:new Date(row.created_at).toISOString(),receivedAt:row.received_at?new Date(row.received_at).toISOString():null});
async function assignment(client,session,id) {
  await requirePrincipal(client,session,'worker');
  const row=(await client.query(`SELECT a.id,a.publication_id,a.language FROM assignments a WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3 AND a.worker_id=$4 FOR UPDATE`,[id,session.org_id,session.site_id,session.principal_id])).rows[0];
  if(!row)throw Error('Assignment unavailable');return row;
}
async function accepting(client,session,row,kind,caseId) {
  await requireSiteOperational(client,session.org_id,session.site_id);
  if((await client.query('SELECT 1 FROM worker_deletion_requests WHERE worker_id=$1',[session.principal_id])).rows.length)throw Error('Assignment unavailable');
  const publication=(await client.query('SELECT state,publication_content_available(id) AS content_available FROM publications WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR SHARE',[row.publication_id,session.org_id,session.site_id])).rows[0];
  if(publication?.state!=='published' || !publication.content_available)throw Error('Assignment unavailable');
  if(kind==='reply') {
    const thread=await scopedCase(client,session,caseId,true);
    if(thread.assignment_id!==row.id || thread.status!=='open')throw Error('Conversation is closed');
  }
}
function exact(row,session,assignmentId,kind,caseId) {
  if(!row || row.actor_type!=='worker' || row.org_id!==session.org_id || row.site_id!==session.site_id || row.worker_id!==session.principal_id
    || row.assignment_id!==assignmentId || row.kind!==kind || row.requested_case_id!==caseId)throw Error('Voice receipt unavailable');return row;
}
function verify(row,bytes) {
  const info=inspectWav(bytes);if(info.sha256!==row.sha256 || info.bytes!==row.bytes)throw Error('Voice audio unavailable');
}
export async function caseVoiceReceipt(pool,session,assignmentId,kind,caseId,requestId,{schema='public'}={}) {
  caseMessageId(requestId);caseMessageId(caseId);
  if(!['help','reply'].includes(kind) || (kind==='help' && caseId!==requestId))throw Error('Invalid voice request');
  return domainTransaction(pool,schema,async client=>{
    await assignment(client,session,assignmentId);
    return receipt(exact((await client.query('SELECT * FROM case_voice WHERE request_id=$1',[requestId])).rows[0],session,assignmentId,kind,caseId));
  });
}
export async function receiveCaseVoice(pool,session,assignmentId,kind,caseId,requestId,bytes,storage,{schema='public'}={}) {
  caseMessageId(requestId);caseMessageId(caseId);
  if(!['help','reply'].includes(kind) || (kind==='help' && caseId!==requestId))throw Error('Invalid voice request');
  if(!storage || !['save','read','remove','exists'].every(key=>typeof storage[key]==='function'))throw Error('Private storage unavailable');
  const info=inspectWav(bytes);
  const staged=await domainTransaction(pool,schema,async client=>{
    const a=await assignment(client,session,assignmentId);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`case-voice:${requestId}`]);
    const old=(await client.query('SELECT * FROM case_voice WHERE request_id=$1',[requestId])).rows[0];
    if(old) {
      exact(old,session,assignmentId,kind,caseId);if(old.sha256!==info.sha256 || old.bytes!==info.bytes)throw Error('Voice request conflict');
      if(old.received_at)return {receipt:receipt(old)};
      throw Error(old.status==='storing'?'Voice storage in progress':'Voice recording was not received');
    }
    await accepting(client,session,a,kind,caseId);
    if((await client.query(`SELECT id FROM case_messages WHERE id=$1 UNION ALL SELECT id FROM case_followups WHERE id=$1
      UNION ALL SELECT id FROM clarifications WHERE id=$1 AND $2='help'`,[requestId,kind])).rows.length)throw Error('Voice request conflict');
    const row=(await client.query(`INSERT INTO case_voice(id,request_id,org_id,site_id,assignment_id,worker_id,kind,requested_case_id,language,sha256,bytes,duration_seconds,status,lease_token,lease_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'storing',$13,clock_timestamp()+interval '120 seconds') RETURNING *`,
    [randomUUID(),requestId,session.org_id,session.site_id,assignmentId,session.principal_id,kind,caseId,a.language,info.sha256,info.bytes,info.durationSeconds,randomUUID()])).rows[0];return row;
  });
  if(staged.receipt)return staged.receipt;
  try {
    try{await storage.save(staged,bytes);}catch{/* Exact readback can recover a lost conditional-save acknowledgement. */}
    verify(staged,await storage.read(staged));
    return await domainTransaction(pool,schema,async client=>{
      const a=await assignment(client,session,assignmentId);await accepting(client,session,a,kind,caseId);
      const current=(await client.query(`SELECT id FROM case_voice WHERE id=$1 AND status='storing' AND cleanup_state='active'
        AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE`,[staged.id,staged.lease_token])).rows[0];
      if(!current)throw Error('Voice recording was not received');
      if(kind==='help') {
        await client.query(`INSERT INTO clarifications(id,org_id,site_id,assignment_id,reason,status) VALUES($1,$2,$3,$4,'Voice help requested','open')`,[caseId,session.org_id,session.site_id,assignmentId]);
        await client.query('INSERT INTO help_requests(case_id,org_id,site_id,assignment_id,text) VALUES($1,$2,$3,$4,$5)',[caseId,session.org_id,session.site_id,assignmentId,labels[a.language]]);
        await routeNewCase(client,session.org_id,session.site_id,caseId);
      }
      await client.query(`INSERT INTO case_messages(id,org_id,site_id,case_id,assignment_id,actor_type,actor_id,language,text,request_hash,created_at)
        VALUES($1,$2,$3,$4,$5,'worker',$6,$7,$8,$9,clock_timestamp())`,[requestId,session.org_id,session.site_id,caseId,assignmentId,session.principal_id,a.language,labels[a.language],info.sha256]);
      const accepted=(await client.query(`UPDATE case_voice SET status='received',case_id=requested_case_id,received_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE id=$1 RETURNING *`,[staged.id])).rows[0];
      await domainAudit(client,session,kind==='help'?'help.voice_received':'clarification.voice_received',requestId);
      await domainAudit(client,session,kind==='help'?'help.requested':'clarification.message',requestId);return receipt(accepted);
    });
  }catch {
    // An uncertain acceptance commit must be checked before its private object is retired.
    const accepted=await domainTransaction(pool,schema,async client=>{
      const row=(await client.query('SELECT * FROM case_voice WHERE id=$1 FOR UPDATE',[staged.id])).rows[0];
      if(row?.received_at)return receipt(row);
      await client.query("UPDATE case_voice SET status='failed',lease_token=NULL,lease_until=NULL WHERE id=$1 AND status='storing'",[staged.id]);return null;
    });
    if(accepted)return accepted;
    throw Error('Voice recording was not received');
  }
}
export async function getCaseVoiceAudio(pool,session,caseId,messageId,storage,{schema='public'}={}) {
  caseMessageId(messageId);if(session?.principal_type==='staff' && !['owner','supervisor'].includes(session.role))throw Error('Forbidden');
  const load=()=>domainTransaction(pool,schema,async client=>{
    await scopedCase(client,session,caseId);
    const row=(await client.query(`SELECT v.* FROM case_voice v LEFT JOIN retention_policies p ON p.org_id=v.org_id AND p.site_id=v.site_id
      WHERE v.request_id=$1 AND v.case_id=$2 AND v.org_id=$3 AND v.site_id=$4 AND v.actor_type='worker' AND v.status='received' AND v.cleanup_state='active'
      AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests WHERE worker_id=v.worker_id)
      AND NOT EXISTS(SELECT 1 FROM case_content_purges WHERE case_id=v.requested_case_id)
      AND (p.audio_days IS NULL OR v.received_at>clock_timestamp()-p.audio_days*interval '1 day')`,[messageId,caseId,session.org_id,session.site_id])).rows[0];
    if(!row)throw Error('Voice audio unavailable');return row;
  });
  const row=await load();if(typeof storage?.read!=='function')throw Error('Voice audio unavailable');
  let bytes;try{bytes=Buffer.from(await storage.read(row));verify(row,bytes);}catch{throw Error('Voice audio unavailable');}
  const after=await load();if(after.id!==row.id || after.sha256!==row.sha256)throw Error('Voice audio unavailable');return bytes;
}
export async function processOneCaseVoicePurge(pool,storage,{schema='public'}={}) {
  const job=await domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`SELECT v.* FROM case_voice v LEFT JOIN retention_policies p ON p.org_id=v.org_id AND p.site_id=v.site_id
      WHERE (v.cleanup_state='active' AND (v.status='failed' OR (v.status='storing' AND v.lease_until<=clock_timestamp())
        OR EXISTS(SELECT 1 FROM worker_deletion_requests WHERE worker_id=v.worker_id)
        OR EXISTS(SELECT 1 FROM case_content_purges WHERE case_id=v.requested_case_id)
        OR v.received_at<=clock_timestamp()-p.audio_days*interval '1 day'))
        OR (v.cleanup_state='cleaning' AND v.cleanup_until<=clock_timestamp())
        OR (v.cleanup_state='cleaned' AND v.cleanup_checked_at<=clock_timestamp()-interval '1 hour')
      ORDER BY v.created_at,v.id LIMIT 1 FOR UPDATE OF v SKIP LOCKED`)).rows[0];
    if(!row)return null;const token=randomUUID();
    if(row.cleanup_state!=='cleaned')await client.query(`UPDATE case_voice SET cleanup_state='cleaning',cleanup_token=$2,cleanup_until=clock_timestamp()+interval '90 seconds',
      status=CASE WHEN status='storing' THEN 'failed' ELSE status END,lease_token=NULL,lease_until=NULL WHERE id=$1`,[row.id,token]);
    else await client.query("UPDATE case_voice SET cleanup_checked_at=clock_timestamp() WHERE id=$1",[row.id]);
    return {...row,token};
  });
  if(!job)return false;
  try {
    await storage.remove(job);if(await storage.exists(job)!==false)throw Error('Voice cleanup incomplete');
    await domainTransaction(pool,schema,async client=>{
      const row=(await client.query(`UPDATE case_voice SET cleanup_state='cleaned',cleanup_token=NULL,cleanup_until=NULL,cleanup_checked_at=clock_timestamp()
        WHERE id=$1 AND cleanup_state='cleaning' AND cleanup_token=$2 AND cleanup_until>clock_timestamp() RETURNING id`,[job.id,job.token])).rows[0];
      if(row)await domainAudit(client,{...job,principal_type:'system',principal_id:'case-voice-retention'},'clarification.voice_purged',job.id);
    });
  }catch{/* Cleanup leases retry; no absent-object or deletion-completion claim on failure. */}
  return true;
}
