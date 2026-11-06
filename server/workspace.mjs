import {randomUUID} from 'node:crypto';
import {responseColumns,isCurrentRecording} from './recordings.mjs';
import {WORKER_LANGUAGE_CODES} from './languages.mjs';
import {attachmentPolicy,MAX_ATTACHMENT_BYTES,MAX_ATTACHMENT_TOTAL_BYTES,requireSafeAttachment} from './attachment-policy.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const iso=value=>value instanceof Date?value.toISOString():value;
const photoMime=mime=>mime==='image/png'||mime==='image/jpeg';
function attachmentCaptions(value){
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>WORKER_LANGUAGE_CODES.length)throw Error('Invalid attachment captions');
 const captions={};
 for(const [language,caption] of Object.entries(value)){
  if(!WORKER_LANGUAGE_CODES.includes(language)||typeof caption!=='string'||caption.length>300)throw Error('Invalid attachment captions');
  const text=caption.normalize('NFKC').replace(/\s+/g,' ').trim();
  if(text)captions[language]=text;
 }
 return captions;
}
export function compositionInput(c){
 const evidenceMode=c?.evidenceMode??'none';
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(key=>!['title','source','audience','responseMode','deliveryMode','evidenceMode'].includes(key))||typeof c.title!=='string'||c.title.length>120||typeof c.source!=='string'||c.source.length>4000||!['question','acknowledge'].includes(c.responseMode)||!['text','voice','both'].includes(c.deliveryMode)||!['none','photo'].includes(evidenceMode)||(evidenceMode==='photo'&&c.responseMode!=='acknowledge'))throw Error('Invalid draft');
 const a=c.audience;
 if(!a||typeof a!=='object'||Array.isArray(a)||!['all','crew','members'].includes(a.type)||Object.keys(a).some(key=>!['type','crewId','workerIds'].includes(key))||a.type==='crew'&&(typeof a.crewId!=='string'||a.crewId.length>100)||a.type==='members'&&(!Array.isArray(a.workerIds)||a.workerIds.length>5000||a.workerIds.some(id=>typeof id!=='string'||!id||id.length>100)||new Set(a.workerIds).size!==a.workerIds.length))throw Error('Invalid draft audience');
 return {title:c.title,source:c.source,audience:a.type==='all'?{type:'all'}:a.type==='crew'?{type:'crew',crewId:a.crewId}:{type:'members',workerIds:[...a.workerIds].sort()},responseMode:c.responseMode,deliveryMode:c.deliveryMode,evidenceMode};
}
export function assignmentWorkStatus(row){
 if(row.open_case)return 'follow-up';
 if(row.completed_at)return 'done';
 if(row.acknowledged_at || !isCurrentRecording(row)&&(row.outcome==='matched'||row.resolved_outcome))return 'in-progress';
 if(row.outcome==='clarification' || row.outcome==='unassessable')return 'follow-up';
 return 'sent';
}
const workColumns=`${responseColumns},ac.completed_at,
 EXISTS(SELECT 1 FROM clarifications c WHERE c.assignment_id=a.id AND c.org_id=a.org_id AND (c.status='open' OR (c.notes LIKE '[Understood:blocked]%' OR c.notes LIKE '[Understood:cancelled]%') AND c.id=(SELECT c2.id FROM clarifications c2 WHERE c2.assignment_id=a.id AND c2.org_id=a.org_id ORDER BY c2.created_at DESC,c2.id DESC LIMIT 1))) AS open_case,
 EXISTS(SELECT 1 FROM clarifications c WHERE c.assignment_id=a.id AND c.org_id=a.org_id AND c.status='resolved' AND c.notes LIKE '[Understood:ready]%'
  AND c.attempt_id=(SELECT t.id FROM attempts t JOIN submission_receipts sr ON sr.assignment_id=t.assignment_id AND sr.submission_id=t.submission_id
   WHERE t.assignment_id=a.id ORDER BY sr.sequence DESC LIMIT 1)) AS resolved_outcome`;
const currentRecordingSql=`audio_status IS NOT NULL AND (attempt_submission IS NULL OR audio_submission<>attempt_submission) AND (attempt_order IS NULL OR audio_order>attempt_order)`;
const workStatusSql=`CASE WHEN open_case THEN 'follow-up'
 WHEN completed_at IS NOT NULL THEN 'done'
 WHEN acknowledged_at IS NOT NULL OR (outcome='matched' OR resolved_outcome) AND NOT(${currentRecordingSql}) THEN 'in-progress'
 WHEN outcome IN ('clarification','unassessable') THEN 'follow-up' ELSE 'sent' END`;
const workResponseSql=`CASE WHEN audio_status IS NOT NULL AND (attempt_submission IS NULL OR audio_submission<>attempt_submission) AND (attempt_order IS NULL OR audio_order>attempt_order)
 THEN CASE WHEN audio_status IN ('failed','blocked') THEN 'waiting' ELSE 'pending' END
 WHEN outcome IS NOT NULL OR acknowledged_at IS NOT NULL THEN 'received' WHEN attempt_at IS NOT NULL THEN 'pending' ELSE 'waiting' END`;
function workInput(input,staff){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['workerId','assignmentId','complete','page','pageSize','status','search'].includes(key)))throw Error('Invalid work request');
 const page=Number(input.page??1),pageSize=Number(input.pageSize??10),status=input.status??'all',search=input.search??'';
 if(!Number.isSafeInteger(page)||page<1||page>5000||!Number.isInteger(pageSize)||pageSize<1||pageSize>50||!['all','active','sent','in-progress','follow-up','done'].includes(status)||typeof search!=='string'||search.length>80
  ||input.assignmentId!==undefined&&(typeof input.assignmentId!=='string'||!input.assignmentId||input.assignmentId.length>100)
  ||input.complete!==undefined&&(typeof input.complete!=='string'||!input.complete||input.complete.length>100)
  ||input.workerId!==undefined&&input.workerId!==null&&(!staff||typeof input.workerId!=='string'||!input.workerId||input.workerId.length>100))throw Error('Invalid work request');
 return {page,pageSize,status,search:search.trim(),assignmentId:input.complete??input.assignmentId};
}
async function completedEvent(q,session,assignmentId,now){
 const auditId=randomUUID(),scope=[session.org_id,session.site_id];
 await q('INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id,occurred_at) VALUES(?,?,?,?,?,?,?,?)',[auditId,...scope,'worker',session.principal_id,'instruction.completed',assignmentId,now]);
 const recipients=await q("SELECT id FROM staff WHERE org_id=? AND site_id=? AND role IN ('owner','supervisor') AND active=true",scope);
 for(const recipient of recipients){
  const eventId=randomUUID();
  await q(`INSERT INTO notification_events(id,org_id,site_id,audience,recipient_id,kind,object_type,object_id,dedupe_key,created_at)
   VALUES(?,?,?,'staff',?,'instruction.completed','audit',?,?,?) ON CONFLICT(org_id,site_id,audience,recipient_id,dedupe_key) DO NOTHING`,[eventId,...scope,recipient.id,auditId,`completed:${assignmentId}`,now]);
  const subscriptions=await q("SELECT id FROM push_subscriptions WHERE org_id=? AND site_id=? AND principal_type='staff' AND principal_id=? AND revoked_at IS NULL",[...scope,recipient.id]);
  for(const subscription of subscriptions)await q(`INSERT INTO push_deliveries(id,event_id,subscription_id,state,attempts,adapter,next_attempt_at,accepted_at,last_error,created_at,updated_at)
   VALUES(?,?,?,'queued',0,NULL,?,NULL,NULL,?,?) ON CONFLICT(event_id,subscription_id) DO NOTHING`,[randomUUID(),eventId,subscription.id,now,now,now]);
 }
}
// The adapter always binds values; only fixed application SQL is shared between engines.
export async function workspaceOperation(q,session,operation,input={},options={}){
 const scope=[session.org_id,session.site_id],staff=session.principal_type==='staff';
 if(operation==='attachment-policy')return attachmentPolicy(options);
 if(operation==='crew-instructions'){
  if(!staff||!['owner','supervisor'].includes(session.role))throw Error('Forbidden');
  const page=Number(input.page??1),size=10,search=input.search??'',status=input.status??'all';
  if(typeof input.crewId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.crewId)||!Number.isSafeInteger(page)||page<1||page>5000||typeof search!=='string'||search.length>80||!['all','sent','in-progress','follow-up','done'].includes(status))throw Error('Invalid crew history request');
  if(!(await q('SELECT id FROM crews WHERE id=? AND org_id=? AND site_id=?',[input.crewId,...scope])).length)throw Error('Crew unavailable');
  const cte=`WITH assessed AS (
   SELECT a.publication_id,${workColumns} FROM assignments a
   JOIN publication_report_audience pra ON pra.assignment_id=a.id AND pra.org_id=a.org_id AND pra.site_id=a.site_id AND pra.publication_id=a.publication_id
   LEFT JOIN assignment_completions ac ON ac.assignment_id=a.id AND ac.org_id=a.org_id AND ac.site_id=a.site_id
   WHERE a.org_id=? AND a.site_id=? AND pra.crew_id=?
  ), work AS (SELECT publication_id,${workStatusSql} AS status FROM assessed
  ), totals AS (SELECT publication_id,COUNT(*) AS assigned,
   SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
   SUM(CASE WHEN status='in-progress' THEN 1 ELSE 0 END) AS in_progress,
   SUM(CASE WHEN status='follow-up' THEN 1 ELSE 0 END) AS follow_up,
   SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done FROM work GROUP BY publication_id
  ), history AS (SELECT p.id,p.briefing_id,p.version,p.state AS publication_state,COALESCE(p.snapshot_json->>'title','Instruction') AS title,p.published_at AS sent_at,
   t.assigned,t.sent,t.in_progress,t.follow_up,t.done,
   CASE WHEN t.follow_up>0 THEN 'follow-up' WHEN t.done=t.assigned THEN 'done' WHEN t.in_progress+t.done>0 THEN 'in-progress' ELSE 'sent' END AS status
   FROM totals t JOIN publications p ON p.id=t.publication_id WHERE p.org_id=? AND p.site_id=?)`;
  const base=[...scope,input.crewId,...scope],pattern=`%${search.trim().replace(/[!%_]/g,'!$&')}%`;
  const filter="WHERE (?='all' OR status=?) AND LOWER(title) LIKE LOWER(?) ESCAPE '!'",filterArgs=[status,status,pattern];
  const stats=(await q(`${cte} SELECT COUNT(*) AS history_total,
   SUM(CASE WHEN publication_state='published' AND status IN ('sent','in-progress') THEN 1 ELSE 0 END) AS ongoing,
   SUM(CASE WHEN publication_state='published' AND status='follow-up' THEN 1 ELSE 0 END) AS follow_up,
   SUM(CASE WHEN publication_state='published' AND status='done' THEN 1 ELSE 0 END) AS done FROM history`,base))[0];
  const rows=await q(`${cte} SELECT history.*,COUNT(*) OVER() AS filtered_total FROM history ${filter} ORDER BY sent_at DESC,id DESC LIMIT ? OFFSET ?`,[...base,...filterArgs,size,(page-1)*size]);
  const total=rows.length?Number(rows[0].filtered_total):Number((await q(`${cte} SELECT COUNT(*) AS total FROM history ${filter}`,[...base,...filterArgs]))[0].total);
  const languages=rows.length?await q(`SELECT DISTINCT a.publication_id,a.language FROM assignments a JOIN publication_report_audience pra ON pra.assignment_id=a.id AND pra.org_id=a.org_id AND pra.site_id=a.site_id AND pra.publication_id=a.publication_id WHERE a.org_id=? AND a.site_id=? AND pra.crew_id=? AND a.publication_id IN (${rows.map(()=>'?').join(',')})`,[...scope,input.crewId,...rows.map(row=>row.id)]):[];
  const items=rows.map(row=>({id:row.id,briefingId:row.briefing_id,title:row.title,version:row.version,publicationState:row.publication_state,sentAt:iso(row.sent_at),status:row.status,
   counts:{sent:Number(row.sent),inProgress:Number(row.in_progress),followUp:Number(row.follow_up),done:Number(row.done),total:Number(row.assigned)},languages:languages.filter(item=>item.publication_id===row.id).map(item=>item.language).sort()}));
  return {crewId:input.crewId,items,total,historyTotal:Number(stats.history_total),page,pageSize:size,summary:{ongoing:Number(stats.ongoing||0),followUp:Number(stats.follow_up||0),done:Number(stats.done||0)}};
 }
 if(operation==='library'){
  if(!staff)throw Error('Forbidden');
  const page=Number(input.page||1),size=20,search=(input.search||'').trim(),status=input.status||'all',language=input.language||'all',date=input.date||'';
  if(!Number.isInteger(page)||page<1||page>5000||search.length>80||!['all','draft','sent','in-progress','follow-up','done','archived'].includes(status)||!['all',...WORKER_LANGUAGE_CODES].includes(language)||date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid instruction filter');
  const rows=await q(`SELECT b.id,b.title,b.state,b.next_version,b.updated_at,p.id AS publication_id,p.version AS published_version,p.state AS publication_state,p.snapshot_json,ar.occurred_at AS archived_at FROM briefings b
   LEFT JOIN publications p ON p.id=(SELECT p2.id FROM publications p2 WHERE p2.briefing_id=b.id AND p2.org_id=b.org_id AND p2.site_id=b.site_id ORDER BY p2.version DESC LIMIT 1)
   LEFT JOIN briefing_archives ar ON ar.briefing_id=b.id AND ar.org_id=b.org_id AND ar.site_id=b.site_id WHERE b.org_id=? AND b.site_id=?`,scope);
  const assignments=await q(`SELECT a.id,a.publication_id,a.language,${workColumns} FROM assignments a LEFT JOIN assignment_completions ac ON ac.assignment_id=a.id WHERE a.org_id=? AND a.site_id=?`,scope);
  const groups=new Map();for(const row of assignments){const group=groups.get(row.publication_id)||[];group.push(row);groups.set(row.publication_id,group);}
  let items=rows.map(row=>{
   const assigned=groups.get(row.publication_id)||[],states=assigned.map(assignmentWorkStatus),snapshot=row.snapshot_json?parse(row.snapshot_json):null;
   const workflowStatus=row.archived_at?'archived':!row.publication_id?'draft':states.includes('follow-up')?'follow-up':states.length&&states.every(value=>value==='done')?'done':states.some(value=>['in-progress','done'].includes(value))?'in-progress':'sent';
   return {...row,snapshot_json:undefined,workflowStatus,languages:snapshot?Object.keys(snapshot.languages||{}):[],updated_at:iso(row.updated_at),workCounts:{sent:states.filter(v=>v==='sent').length,inProgress:states.filter(v=>v==='in-progress').length,followUp:states.filter(v=>v==='follow-up').length,done:states.filter(v=>v==='done').length,total:assigned.length}};
  });
  if(['owner','supervisor'].includes(session.role)){
   const drafts=await q(`SELECT c.* FROM instruction_compositions c WHERE c.org_id=? AND c.site_id=? AND c.staff_id=? AND NOT EXISTS(SELECT 1 FROM instruction_sends s WHERE s.request_id=c.id)`,[...scope,session.principal_id]);
   items.push(...drafts.map(row=>{const content=parse(row.content_json);return {id:row.id,title:content.title||'Untitled instruction',state:'draft',workflowStatus:'draft',composition:true,languages:[],updated_at:row.updated_at,workCounts:{total:0}};}));
  }
  const counts={};for(const row of items)counts[row.workflowStatus]=(counts[row.workflowStatus]||0)+1;
  items=items.filter(row=>(!search||row.title.toLowerCase().includes(search.toLowerCase()))&&(status==='all'||row.workflowStatus===status)&&(language==='all'||row.languages.includes(language))&&(!date||iso(row.updated_at).slice(0,10)===date)).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))||a.id.localeCompare(b.id));
  return {items:items.slice((page-1)*size,page*size),total:items.length,page,pageSize:size,counts};
 }
 if(operation==='composition'){
  if(!staff||!['owner','supervisor'].includes(session.role)||!uuid(input.id))throw Error('Forbidden');
  const values=[input.id,...scope,session.principal_id];
  if(input.content){
   const c=compositionInput(input.content);
   if((await q('SELECT 1 FROM instruction_sends WHERE request_id=?',[input.id])).length)throw Error('Instruction already sent');
   const old=(await q('SELECT * FROM instruction_compositions WHERE id=?',[input.id]))[0];
   if(old&&(old.org_id!==session.org_id||old.site_id!==session.site_id||old.staff_id!==session.principal_id))throw Error('Forbidden');
   await q(`INSERT INTO instruction_compositions(id,org_id,site_id,staff_id,content_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content_json=excluded.content_json,updated_at=excluded.updated_at`,[...values,JSON.stringify(c),new Date().toISOString()]);
  }
  const row=(await q('SELECT content_json FROM instruction_compositions WHERE id=? AND org_id=? AND site_id=? AND staff_id=?',values))[0];
  return {id:input.id,content:row?parse(row.content_json):null};
 }
 if(operation==='worker-crew'){
  if(staff)throw Error('Forbidden');
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['page','membersPage','status'].includes(key)))throw Error('Invalid crew request');
  const page=Number(input.page??1),membersPage=Number(input.membersPage??1),status=input.status??'active';
  if(!Number.isSafeInteger(page)||page<1||page>5000||!Number.isSafeInteger(membersPage)||membersPage<1||membersPage>5000||!['active','done','all'].includes(status))throw Error('Invalid crew request');
  const crew=(await q(`SELECT c.id,c.name,cm.joined_at FROM crew_memberships cm JOIN crews c ON c.id=cm.crew_id AND c.org_id=cm.org_id AND c.site_id=cm.site_id WHERE cm.worker_id=? AND cm.org_id=? AND cm.site_id=? AND c.active=TRUE`,[session.principal_id,...scope]))[0];
  if(!crew)return {crew:null,members:{items:[],total:0,page:membersPage,pageSize:10},work:null};
  const total=Number((await q(`SELECT COUNT(*) AS total FROM crew_memberships cm JOIN workers w ON w.id=cm.worker_id AND w.org_id=cm.org_id AND w.site_id=cm.site_id WHERE cm.crew_id=? AND cm.org_id=? AND cm.site_id=? AND w.active=TRUE`,[crew.id,...scope]))[0].total);
  const members=await q(`SELECT w.name,w.language,CASE WHEN w.id=? THEN 1 ELSE 0 END AS is_you FROM crew_memberships cm JOIN workers w ON w.id=cm.worker_id AND w.org_id=cm.org_id AND w.site_id=cm.site_id WHERE cm.crew_id=? AND cm.org_id=? AND cm.site_id=? AND w.active=TRUE ORDER BY CASE WHEN w.id=? THEN 0 ELSE 1 END,LOWER(COALESCE(w.name,'')),w.id LIMIT 10 OFFSET ?`,[session.principal_id,crew.id,...scope,session.principal_id,(membersPage-1)*10]);
  const work=await workspaceOperation(q,session,'work',{page,pageSize:10,status},{...options,workerCrewId:crew.id});
  return {crew:{id:crew.id,name:crew.name,joinedAt:iso(crew.joined_at),activeMembers:total},members:{items:members.map(row=>({name:row.name||null,language:row.language,isYou:!!Number(row.is_you)})),total,page:membersPage,pageSize:10},work};
 }
 if(operation==='work'){
  const filter=workInput(input,staff);
  const workerId=staff?input.workerId:session.principal_id;
  if(!workerId||staff&&!['owner','supervisor'].includes(session.role))throw Error('Forbidden');
  if(input.complete){
   if(staff)throw Error('Forbidden');
   await q('SELECT id FROM assignments WHERE id=? AND org_id=? AND site_id=? AND worker_id=? FOR UPDATE',[input.complete,...scope,workerId]);
  }
  // Project only the localized title and immutable summary fields, never the full source/rubric snapshot.
  const cte=`WITH assessed AS (SELECT a.id,a.publication_id,a.language,a.due_at,p.briefing_id,p.version,p.state,p.published_at,
   CASE WHEN EXISTS(SELECT 1 FROM briefing_content_purges bp WHERE bp.briefing_id=p.briefing_id) THEN 1 ELSE 0 END AS content_expired,
   COALESCE((SELECT d.content_json->>'title' FROM instruction_deliveries d WHERE d.assignment_id=a.id AND d.org_id=a.org_id AND d.site_id=a.site_id),p.snapshot_json->'languages'->a.language->>'title',p.snapshot_json->>'title','Instruction') AS title,
   (SELECT st.name FROM instruction_sends s JOIN staff st ON st.id=s.requested_by AND st.org_id=s.org_id AND st.site_id=s.site_id WHERE s.publication_id=p.id AND s.org_id=a.org_id AND s.site_id=a.site_id) AS supervisor_name,
   CASE WHEN EXISTS(SELECT 1 FROM clarifications c JOIN case_messages m ON m.case_id=c.id AND m.org_id=c.org_id AND m.site_id=a.site_id WHERE c.assignment_id=a.id AND c.org_id=a.org_id AND c.status='open' AND m.actor_type='staff' AND NOT EXISTS(SELECT 1 FROM notification_events ne JOIN notification_event_reads nr ON nr.event_id=ne.id AND nr.org_id=ne.org_id AND nr.site_id=ne.site_id WHERE ne.org_id=a.org_id AND ne.site_id=a.site_id AND ne.recipient_id=a.worker_id AND ne.object_type='case_message' AND ne.object_id=m.id AND nr.principal_type='worker' AND nr.principal_id=a.worker_id)) THEN 1 ELSE 0 END AS supervisor_reply,
   ${workColumns} FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
   LEFT JOIN assignment_completions ac ON ac.assignment_id=a.id AND ac.org_id=a.org_id AND ac.site_id=a.site_id
   WHERE a.org_id=? AND a.site_id=? AND a.worker_id=? ${filter.assignmentId?'AND a.id=?':''} ${options.workerCrewId?'AND EXISTS(SELECT 1 FROM publication_report_audience pra WHERE pra.assignment_id=a.id AND pra.publication_id=a.publication_id AND pra.org_id=a.org_id AND pra.site_id=a.site_id AND pra.crew_id=?)':''}),
   work AS (SELECT assessed.*,${workStatusSql} AS status,${workResponseSql} AS response_status FROM assessed)`;
  const base=[...scope,workerId,...(filter.assignmentId?[filter.assignmentId]:[]),...(options.workerCrewId?[options.workerCrewId]:[])],now=new Date().toISOString();
  const map=row=>({id:row.id,publicationId:row.publication_id,briefingId:row.briefing_id,title:Number(row.content_expired)?'Instruction unavailable':row.title,version:row.version,publicationState:row.state,
   status:row.status,language:row.language,dueAt:iso(row.due_at)||null,supervisorName:row.supervisor_name||null,hasSupervisorReply:!!Number(row.supervisor_reply),responseStatus:row.response_status,
   contentExpired:!!Number(row.content_expired),canComplete:row.status==='in-progress'&&row.state==='published'&&!Number(row.content_expired),completedAt:iso(row.completed_at)||null,sentAt:iso(row.published_at)});
  const exact=filter.assignmentId?(await q(`${cte} SELECT * FROM work`,base))[0]:null;
  if(filter.assignmentId&&!exact)throw Error('Assignment unavailable');
  if(input.complete){
   const row=exact;
   if(row.completed_at)return {id:row.id,status:'done',completedAt:iso(row.completed_at)};
   if(!map(row).canComplete)throw Error('Confirm understanding and resolve follow-up before finishing work');
   await q(`INSERT INTO assignment_completions(assignment_id,org_id,site_id,worker_id,completed_at) VALUES(?,?,?,?,?) ON CONFLICT(assignment_id) DO NOTHING`,[row.id,...scope,workerId,now]);
   await completedEvent(q,session,row.id,now);
   return {id:row.id,status:'done',completedAt:now};
  }
  if(exact)return {item:map(exact)};
  const stats=(await q(`${cte} SELECT COUNT(*) AS total,
   SUM(CASE WHEN state='published' AND status<>'done' THEN 1 ELSE 0 END) AS active,
   SUM(CASE WHEN state='published' AND status='sent' THEN 1 ELSE 0 END) AS sent,
   SUM(CASE WHEN state='published' AND status='in-progress' THEN 1 ELSE 0 END) AS in_progress,
   SUM(CASE WHEN state='published' AND status='follow-up' THEN 1 ELSE 0 END) AS follow_up,
   SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done FROM work`,base))[0];
  const pattern=`%${filter.search.replace(/[!%_]/g,'!$&')}%`,where=`WHERE (?='all' OR ?='active' AND state='published' AND status<>'done' OR status=? AND (?='done' OR state='published')) AND LOWER(title) LIKE LOWER(?) ESCAPE '!'`,args=[...base,filter.status,filter.status,filter.status,filter.status,pattern];
  const total=Number((await q(`${cte} SELECT COUNT(*) AS total FROM work ${where}`,args))[0].total);
  const rows=await q(`${cte} SELECT * FROM work ${where} ORDER BY CASE WHEN state='published' AND status='follow-up' AND supervisor_reply=1 THEN 0 WHEN state='published' AND status<>'done' AND due_at IS NOT NULL AND due_at<=? THEN 1 ELSE 2 END,
   CASE WHEN state='published' AND status<>'done' AND due_at IS NOT NULL THEN 0 ELSE 1 END,due_at ASC,published_at DESC,id DESC LIMIT ? OFFSET ?`,[...args,now,filter.pageSize,(filter.page-1)*filter.pageSize]);
  return {items:rows.map(map),total,page:filter.page,pageSize:filter.pageSize,counts:{total:Number(stats.total),active:Number(stats.active||0),sent:Number(stats.sent||0),inProgress:Number(stats.in_progress||0),followUp:Number(stats.follow_up||0),done:Number(stats.done||0)}};
 }
 if(operation==='attachments'){
  const requestId=input.requestId;
  if(!uuid(requestId))throw Error('Invalid instruction');
  if(input.file){
   if(!staff||!['owner','supervisor'].includes(session.role))throw Error('Forbidden');
   const f=input.file;
   await q('SELECT id FROM instruction_compositions WHERE id=? AND org_id=? AND site_id=? FOR UPDATE',[requestId,...scope]);
   if(f.remove){
    if(!uuid(f.remove))throw Error('Invalid attachment');
    if((await q('SELECT 1 FROM instruction_sends WHERE request_id=?',[requestId])).length)throw Error('Sent attachments cannot be changed');
    await q('DELETE FROM instruction_attachments WHERE id=? AND request_id=? AND org_id=? AND site_id=? AND staff_id=?',[f.remove,requestId,...scope,session.principal_id]);
    return workspaceOperation(q,session,'attachments',{requestId},options);
   }
   if(f.captions!==undefined && f.data===undefined){
    if(!uuid(f.id))throw Error('Invalid attachment');
    const captions=attachmentCaptions(f.captions);
    if((await q('SELECT 1 FROM instruction_sends WHERE request_id=?',[requestId])).length)throw Error('Sent attachments cannot be changed');
    const row=(await q('SELECT mime FROM instruction_attachments WHERE id=? AND request_id=? AND org_id=? AND site_id=? AND staff_id=?',[f.id,requestId,...scope,session.principal_id]))[0];
    if(!row)throw Error('Attachment unavailable');
    if(!photoMime(row.mime))throw Error('Captions are only available for photos');
    await q('UPDATE instruction_attachments SET captions_json=? WHERE id=? AND request_id=? AND org_id=? AND site_id=? AND staff_id=?',[JSON.stringify(captions),f.id,requestId,...scope,session.principal_id]);
    return workspaceOperation(q,session,'attachments',{requestId},options);
   }
   if(typeof f.name!=='string'||!f.name.trim()||f.name.length>160||/[\x00-\x1f\/\\]/.test(f.name)||typeof f.data!=='string'||f.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.data))throw Error('Invalid attachment');
   if(!uuid(f.id))throw Error('Invalid attachment');
   const bytes=Buffer.from(f.data,'base64'),mime=f.mime,captions=attachmentCaptions(f.captions);
   if(Object.keys(captions).length && !photoMime(mime))throw Error('Captions are only available for photos');
   const duplicate=(await q('SELECT * FROM instruction_attachments WHERE id=?',[f.id]))[0];
   if(duplicate){if(duplicate.org_id!==session.org_id||duplicate.site_id!==session.site_id||duplicate.staff_id!==session.principal_id||duplicate.request_id!==requestId||duplicate.name!==f.name||duplicate.mime!==mime||duplicate.data_base64!==f.data||duplicate.captions_json!==JSON.stringify(captions))throw Error('Attachment request conflict');return workspaceOperation(q,session,'attachments',{requestId},options);}
   const extensions={'application/pdf':/\.pdf$/i,'image/png':/\.png$/i,'image/jpeg':/\.jpe?g$/i,'text/plain':/\.txt$/i,'text/csv':/\.csv$/i,'application/vnd.openxmlformats-officedocument.wordprocessingml.document':/\.docx$/i,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':/\.xlsx$/i,'application/vnd.openxmlformats-officedocument.presentationml.presentation':/\.pptx$/i};
   const office=mime?.startsWith('application/vnd.openxmlformats-officedocument.'),text=['text/plain','text/csv'].includes(mime);
   const valid=mime==='application/pdf'&&bytes.subarray(0,5).toString()==='%PDF-'||mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255||text&&!bytes.includes(0)||office&&bytes.subarray(0,4).equals(Buffer.from([80,75,3,4]));
   if(!valid||!extensions[mime]?.test(f.name)||!bytes.length||bytes.length>MAX_ATTACHMENT_BYTES)throw Error('Use a photo, PDF, Office document, CSV or text file up to 3 MB');
   if((await q('SELECT 1 FROM instruction_sends WHERE request_id=?',[requestId])).length)throw Error('Sent attachments cannot be changed');
   const composition=(await q('SELECT staff_id FROM instruction_compositions WHERE id=? AND org_id=? AND site_id=?',[requestId,...scope]))[0];
   if(!composition||composition.staff_id!==session.principal_id)throw Error('Save this draft before adding an attachment');
   const existing=await q('SELECT bytes FROM instruction_attachments WHERE request_id=? AND org_id=? AND site_id=?',[requestId,...scope]);
   if(existing.length>=5||existing.reduce((sum,row)=>sum+row.bytes,0)+bytes.length>MAX_ATTACHMENT_TOTAL_BYTES)throw Error('Maximum five attachments and 10 MB per instruction');
   await requireSafeAttachment(bytes,{mime,name:f.name},options);
   await q('INSERT INTO instruction_attachments(id,request_id,org_id,site_id,staff_id,name,mime,bytes,data_base64,created_at,captions_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[f.id,requestId,...scope,session.principal_id,f.name,mime,bytes.length,bytes.toString('base64'),new Date().toISOString(),JSON.stringify(captions)]);
  }
  if(staff){
   if(!['owner','supervisor','auditor'].includes(session.role))throw Error('Forbidden');
   const owned=(await q('SELECT 1 FROM instruction_compositions WHERE id=? AND org_id=? AND site_id=? AND staff_id=?',[requestId,...scope,session.principal_id])).length;
   const sent=(await q('SELECT 1 FROM instruction_sends s JOIN briefings b ON b.id=s.briefing_id WHERE s.request_id=? AND s.org_id=? AND s.site_id=? AND NOT EXISTS(SELECT 1 FROM briefing_content_purges bp WHERE bp.briefing_id=b.id)',[requestId,...scope])).length;
   if(!owned&&!sent)throw Error('Instruction unavailable');
   const purged=(await q('SELECT 1 FROM instruction_sends s WHERE s.request_id=? AND EXISTS(SELECT 1 FROM briefing_content_purges bp WHERE bp.briefing_id=s.briefing_id)',[requestId])).length;if(purged)throw Error('Instruction unavailable');
  }else{
   const allowed=(await q(`SELECT 1 FROM assignments a JOIN publications p ON p.id=a.publication_id JOIN instruction_sends s ON s.publication_id=p.id WHERE s.request_id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=? AND p.state='published' AND NOT EXISTS(SELECT 1 FROM briefing_content_purges bp WHERE bp.briefing_id=p.briefing_id)`,[requestId,...scope,session.principal_id])).length;
   if(!allowed)throw Error('Instruction unavailable');
  }
  const rows=await q('SELECT id,name,mime,bytes,captions_json FROM instruction_attachments WHERE request_id=? AND org_id=? AND site_id=? ORDER BY created_at,id',[requestId,...scope]);
  if(input.download){
   if(!rows.some(row=>row.id===input.download))throw Error('Attachment unavailable');
   const file=(await q('SELECT name,mime,data_base64 FROM instruction_attachments WHERE id=? AND org_id=? AND site_id=?',[input.download,...scope]))[0];
   const bytes=Buffer.from(file.data_base64,'base64');
   if(bytes.length>MAX_ATTACHMENT_BYTES)throw Error('This attachment exceeds the current download limit. Ask your supervisor to attach a smaller file');
   // Recheck before release, including legacy uploads that predate scanner setup.
   await requireSafeAttachment(bytes,file,options);return file;
  }
  return {items:rows.map(row=>({id:row.id,name:row.name,mime:row.mime,bytes:row.bytes,captions:parse(row.captions_json||'{}')})),policy:attachmentPolicy(options)};
 }
 if(operation==='assignment-files'){
  if(staff)throw Error('Forbidden');
  const row=(await q(`SELECT s.request_id FROM assignments a JOIN instruction_sends s ON s.publication_id=a.publication_id WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`,[input.id,...scope,session.principal_id]))[0];
  if(!row)return {items:[]};
  return {...await workspaceOperation(q,session,'attachments',{requestId:row.request_id},options),requestId:row.request_id};
 }
 if(operation==='briefing-files'){
  if(!staff)throw Error('Forbidden');
  const row=(await q('SELECT request_id FROM instruction_sends WHERE briefing_id=? AND org_id=? AND site_id=?',[input.id,...scope]))[0];
  if(!row)return {items:[]};
  return {...await workspaceOperation(q,session,'attachments',{requestId:row.request_id},options),requestId:row.request_id};
 }
 throw Error('Unknown workspace operation');
}
