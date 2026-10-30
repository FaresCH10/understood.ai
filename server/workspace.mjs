import {randomUUID} from 'node:crypto';
import {responseColumns,isCurrentRecording} from './recordings.mjs';
import {WORKER_LANGUAGE_CODES} from './languages.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const iso=value=>value instanceof Date?value.toISOString():value;
export function compositionInput(c){
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(key=>!['title','source','audience','responseMode','deliveryMode'].includes(key))||typeof c.title!=='string'||c.title.length>120||typeof c.source!=='string'||c.source.length>4000||!['question','acknowledge'].includes(c.responseMode)||!['text','voice','both'].includes(c.deliveryMode))throw Error('Invalid draft');
 const a=c.audience;
 if(!a||typeof a!=='object'||Array.isArray(a)||!['all','crew','members'].includes(a.type)||Object.keys(a).some(key=>!['type','crewId','workerIds'].includes(key))||a.type==='crew'&&(typeof a.crewId!=='string'||a.crewId.length>100)||a.type==='members'&&(!Array.isArray(a.workerIds)||a.workerIds.length>5000||a.workerIds.some(id=>typeof id!=='string'||!id||id.length>100)||new Set(a.workerIds).size!==a.workerIds.length))throw Error('Invalid draft audience');
 return {title:c.title,source:c.source,audience:a.type==='all'?{type:'all'}:a.type==='crew'?{type:'crew',crewId:a.crewId}:{type:'members',workerIds:[...a.workerIds].sort()},responseMode:c.responseMode,deliveryMode:c.deliveryMode};
}
export function assignmentWorkStatus(row){
 if(row.open_case || row.outcome==='clarification' || row.outcome==='unassessable')return 'follow-up';
 if(row.completed_at)return 'done';
 if(row.acknowledged_at || !isCurrentRecording(row)&&row.outcome==='matched')return 'in-progress';
 return 'sent';
}
const workColumns=`${responseColumns},ac.completed_at,
 EXISTS(SELECT 1 FROM clarifications c WHERE c.assignment_id=a.id AND c.org_id=a.org_id AND c.status='open') AS open_case`;
// The adapter always binds values; only fixed application SQL is shared between engines.
export async function workspaceOperation(q,session,operation,input={}){
 const scope=[session.org_id,session.site_id],staff=session.principal_type==='staff';
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
 if(operation==='work'){
  const workerId=staff?input.workerId:session.principal_id;
  if(!workerId||staff&&!['owner','supervisor'].includes(session.role))throw Error('Forbidden');
  if(input.complete){
   if(staff)throw Error('Forbidden');
   await q('SELECT id FROM assignments WHERE id=? AND org_id=? AND site_id=? AND worker_id=? FOR UPDATE',[input.complete,...scope,workerId]);
  }
  const rows=await q(`SELECT a.id,a.publication_id,a.language,p.briefing_id,p.version,p.state,p.snapshot_json,p.published_at,${workColumns} FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id LEFT JOIN assignment_completions ac ON ac.assignment_id=a.id WHERE a.org_id=? AND a.site_id=? AND a.worker_id=? ORDER BY p.published_at DESC,a.id`,[...scope,workerId]);
  const items=rows.map(row=>({id:row.id,briefingId:row.briefing_id,title:parse(row.snapshot_json).title||'Instruction',version:row.version,publicationState:row.state,status:assignmentWorkStatus(row),completedAt:iso(row.completed_at),sentAt:iso(row.published_at)}));
  if(input.complete){
   if(staff)throw Error('Forbidden');
   const row=rows.find(row=>row.id===input.complete);if(!row)throw Error('Assignment unavailable');
   if(row.completed_at)return {id:row.id,status:'done',completedAt:iso(row.completed_at)};
   if(row.state!=='published'||assignmentWorkStatus(row)!=='in-progress')throw Error('Confirm understanding and resolve follow-up before finishing work');
   const now=new Date().toISOString();
   await q(`INSERT INTO assignment_completions(assignment_id,org_id,site_id,worker_id,completed_at) VALUES(?,?,?,?,?) ON CONFLICT(assignment_id) DO NOTHING`,[row.id,...scope,workerId,now]);
   return {id:row.id,status:'done',completedAt:now};
  }
  return {items};
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
    return workspaceOperation(q,session,'attachments',{requestId});
   }
   if(typeof f.name!=='string'||!f.name.trim()||f.name.length>160||/[\x00-\x1f\/\\]/.test(f.name)||typeof f.data!=='string'||f.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.data))throw Error('Invalid attachment');
   if(!uuid(f.id))throw Error('Invalid attachment');
   const bytes=Buffer.from(f.data,'base64'),mime=f.mime;
   const duplicate=(await q('SELECT * FROM instruction_attachments WHERE id=?',[f.id]))[0];
   if(duplicate){if(duplicate.org_id!==session.org_id||duplicate.site_id!==session.site_id||duplicate.staff_id!==session.principal_id||duplicate.request_id!==requestId||duplicate.name!==f.name||duplicate.mime!==mime||duplicate.data_base64!==f.data)throw Error('Attachment request conflict');return workspaceOperation(q,session,'attachments',{requestId});}
   const extensions={'application/pdf':/\.pdf$/i,'image/png':/\.png$/i,'image/jpeg':/\.jpe?g$/i,'text/plain':/\.txt$/i,'text/csv':/\.csv$/i,'application/vnd.openxmlformats-officedocument.wordprocessingml.document':/\.docx$/i,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':/\.xlsx$/i,'application/vnd.openxmlformats-officedocument.presentationml.presentation':/\.pptx$/i};
   const office=mime?.startsWith('application/vnd.openxmlformats-officedocument.'),text=['text/plain','text/csv'].includes(mime);
   const valid=mime==='application/pdf'&&bytes.subarray(0,5).toString()==='%PDF-'||mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255||text&&!bytes.includes(0)||office&&bytes.subarray(0,4).equals(Buffer.from([80,75,3,4]));
   if(!valid||!extensions[mime]?.test(f.name)||!bytes.length||bytes.length>5*1024*1024)throw Error('Use a photo, PDF, Office document, CSV or text file up to 5 MB');
   if((await q('SELECT 1 FROM instruction_sends WHERE request_id=?',[requestId])).length)throw Error('Sent attachments cannot be changed');
   const composition=(await q('SELECT staff_id FROM instruction_compositions WHERE id=? AND org_id=? AND site_id=?',[requestId,...scope]))[0];
   if(!composition||composition.staff_id!==session.principal_id)throw Error('Save this draft before adding an attachment');
   const existing=await q('SELECT bytes FROM instruction_attachments WHERE request_id=? AND org_id=? AND site_id=?',[requestId,...scope]);
   if(existing.length>=5||existing.reduce((sum,row)=>sum+row.bytes,0)+bytes.length>10*1024*1024)throw Error('Maximum five attachments and 10 MB per instruction');
   await q('INSERT INTO instruction_attachments(id,request_id,org_id,site_id,staff_id,name,mime,bytes,data_base64,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[f.id,requestId,...scope,session.principal_id,f.name,mime,bytes.length,bytes.toString('base64'),new Date().toISOString()]);
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
  const rows=await q('SELECT id,name,mime,bytes FROM instruction_attachments WHERE request_id=? AND org_id=? AND site_id=? ORDER BY created_at,id',[requestId,...scope]);
  if(input.download){if(!rows.some(row=>row.id===input.download))throw Error('Attachment unavailable');return (await q('SELECT name,mime,data_base64 FROM instruction_attachments WHERE id=? AND org_id=? AND site_id=?',[input.download,...scope]))[0];}
  return {items:rows};
 }
 if(operation==='assignment-files'){
  if(staff)throw Error('Forbidden');
  const row=(await q(`SELECT s.request_id FROM assignments a JOIN instruction_sends s ON s.publication_id=a.publication_id WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`,[input.id,...scope,session.principal_id]))[0];
  if(!row)return {items:[]};
  return {...await workspaceOperation(q,session,'attachments',{requestId:row.request_id}),requestId:row.request_id};
 }
 if(operation==='briefing-files'){
  if(!staff)throw Error('Forbidden');
  const row=(await q('SELECT request_id FROM instruction_sends WHERE briefing_id=? AND org_id=? AND site_id=?',[input.id,...scope]))[0];
  if(!row)return {items:[]};
  return {...await workspaceOperation(q,session,'attachments',{requestId:row.request_id}),requestId:row.request_id};
 }
 throw Error('Unknown workspace operation');
}
