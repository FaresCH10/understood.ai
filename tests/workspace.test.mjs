import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureInstructionSchema} from '../server/instruction-schema.mjs';
import {sqliteWorkspace} from '../server/workspace-sqlite.mjs';
import {instructionInput,startInstructionSend,completeInstructionSend} from '../server/instructions.mjs';
import {processOne} from '../server/worker.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {sqliteApp,openPrincipalSession,principalLoginBody} from './helpers/sqlite-app.mjs';
import {listNotifications,readNotification,notificationReceipt} from '../server/notifications.mjs';
import {resolveClarification,requestHelp} from '../server/clarifications.mjs';
const staff={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-1',org_id:'cedar',site_id:'beirut'};
const content={title:'Delivery check',source:'Please check the delivery count.',audience:{type:'all'},responseMode:'question',deliveryMode:'text'};
const fixture=()=>{const db=openDatabase(':memory:');seed(db);ensureInstructionSchema(db);return db;};
test('resolved assessment follow-up releases work without rewriting its assessment, while fresh help still blocks completion',async()=>{
 const db=fixture(),session={...worker,principal_id:'worker-14'},id='assignment-14';
 try{
  const read=async()=> (await sqliteWorkspace(db,session,'work',{assignmentId:id})).item;
  assert.equal((await read()).status,'follow-up');
  resolveClarification(db,staff,'clarification-14',{notes:'Explained the instruction and confirmed understanding in person.'});
  assert.equal((await read()).status,'in-progress');assert.equal((await read()).canComplete,true);
  assert.equal(db.prepare("SELECT outcome FROM attempts WHERE id='attempt-14'").get().outcome,'clarification');
  const help=requestHelp(db,session,id,{requestId:randomUUID(),text:'The equipment is missing.'});
  assert.equal((await read()).status,'follow-up');
  await assert.rejects(sqliteWorkspace(db,session,'work',{complete:id}),/resolve follow-up/);
  resolveClarification(db,staff,help.id,{notes:'Equipment supplied; worker can continue.'});
  assert.equal((await sqliteWorkspace(db,session,'work',{complete:id})).status,'done');
  assert.equal((await read()).status,'done');
 }finally{db.close();}
});

test('an old resolved assessment cannot approve a newer failed answer',async()=>{
 const db=fixture(),session={...worker,principal_id:'worker-14'},id='assignment-14';
 try{
  await sqliteWorkspace(db,session,'work',{});
  resolveClarification(db,staff,'clarification-14',{notes:'First answer discussed in person.'});
  db.prepare('INSERT INTO attempts(id,org_id,assignment_id,submission_id,answer_text,outcome,reasons_json,received_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),'cedar',id,randomUUID(),'New answer','unassessable','[]',new Date().toISOString());
  const row=(await sqliteWorkspace(db,session,'work',{assignmentId:id})).item;
  assert.equal(row.status,'follow-up');assert.equal(row.canComplete,false);
 }finally{db.close();}
});
test('compositions persist incomplete text, appear in drafts and stay private to their author',async()=>{
 const db=fixture();try{const id=randomUUID();await sqliteWorkspace(db,staff,'composition',{id,content:{...content,title:'',source:'unfinished'}});
 const read=await sqliteWorkspace(db,staff,'composition',{id});assert.equal(read.content.source,'unfinished');
 const library=await sqliteWorkspace(db,staff,'library',{status:'draft'});assert.ok(library.items.some(row=>row.id===id&&row.composition&&row.title==='Untitled instruction'));
 await assert.rejects(sqliteWorkspace(db,worker,'composition',{id}),/Forbidden/);
 await assert.rejects(sqliteWorkspace(db,{...staff,principal_id:'harbor-owner',org_id:'harbor'},'composition',{id,content}),/Forbidden/);
 }finally{db.close();}
});
test('explicit member audience is validated and never includes other workers',async()=>{
 const db=fixture();try{const id=randomUUID(),input={requestId:id,title:'Shelf instruction',source:CANONICAL_SOURCE,audience:{type:'members',workerIds:['worker-1']},responseMode:'acknowledge',deliveryMode:'text'};
 assert.equal(instructionInput(input).audience.type,'members');assert.throws(()=>instructionInput({...input,audience:{type:'members',workerIds:['worker-1','worker-1']}}),/audience/);
 startInstructionSend(db,staff,input);await processOne(db);const result=completeInstructionSend(db,staff,id);assert.equal(result.audience.count,1);assert.equal(result.delivered,1);
 assert.deepEqual(db.prepare('SELECT worker_id FROM assignments WHERE publication_id=?').all(result.publicationId).map(row=>row.worker_id),['worker-1']);
 assert.throws(()=>startInstructionSend(db,staff,{...input,requestId:randomUUID(),audience:{type:'members',workerIds:['harbor-worker']}}),/unavailable/);
 }finally{db.close();}
});
test('work completion requires understanding, is idempotent, and appears in worker history and library',async()=>{
 const db=fixture();try{
 const rows=(await sqliteWorkspace(db,worker,'work',{})).items;assert.ok(rows.length);
 const inProgress=rows.find(row=>row.status==='in-progress'),sent=(await sqliteWorkspace(db,{...worker,principal_id:'worker-30'},'work',{})).items.find(row=>row.status==='sent');assert.ok(inProgress);assert.ok(sent);
 await assert.rejects(sqliteWorkspace(db,{...worker,principal_id:'worker-30'},'work',{complete:sent.id}),/Confirm understanding/);
 const done=await sqliteWorkspace(db,worker,'work',{complete:inProgress.id});assert.equal(done.status,'done');
 assert.equal((await sqliteWorkspace(db,worker,'work',{complete:inProgress.id})).completedAt,done.completedAt);
 const events=db.prepare("SELECT id FROM audit WHERE action='instruction.completed' AND object_id=?").all(inProgress.id);assert.equal(events.length,1);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notification_events WHERE kind='instruction.completed'").get().n,1);
 const notice=listNotifications(db,staff).items.find(item=>item.kind==='instruction.completed');assert.ok(notice);assert.equal(notice.target,`briefings/${inProgress.briefingId}`);
 const read=readNotification(db,staff,notice.id);assert.equal(read.target,notice.target);assert.equal(notificationReceipt(db,staff,notice.id).item.target,notice.target);
 const history=(await sqliteWorkspace(db,staff,'work',{workerId:worker.principal_id})).items;assert.equal(history.find(row=>row.id===inProgress.id).status,'done');
 const library=await sqliteWorkspace(db,staff,'library',{});assert.ok(library.items.some(row=>row.workCounts.done===1));
 await assert.rejects(sqliteWorkspace(db,staff,'work',{workerId:worker.principal_id,complete:inProgress.id}),/Forbidden/);
 }finally{db.close();}
});
test('work summaries paginate and filter on the server, preserve localized titles and exact worker scope',async()=>{
 const db=fixture();try{
  const original=db.prepare('SELECT p.* FROM publications p JOIN assignments a ON a.publication_id=p.id WHERE a.worker_id=? LIMIT 1').get(worker.principal_id);
  const next=Number(db.prepare('SELECT MAX(version) AS n FROM publications WHERE briefing_id=?').get(original.briefing_id).n)+1;
  const added=[];
  for(let i=0;i<4;i++){
   const pub=randomUUID(),id=randomUUID(),snapshot=JSON.parse(original.snapshot_json);snapshot.title=`Inventory ${i}`;snapshot.languages.en.title=`Localized inventory ${i}`;
   db.prepare('INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,published_at,state) VALUES(?,?,?,?,?,?,?,?)').run(pub,'cedar','beirut',original.briefing_id,next+i,JSON.stringify(snapshot),new Date(Date.now()+i).toISOString(),'published');
   db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES(?,?,?,?,?,?,?,?)').run(id,'cedar','beirut',pub,worker.principal_id,null,new Date().toISOString(),'en');added.push(id);
  }
  const first=await sqliteWorkspace(db,worker,'work',{pageSize:2,search:'Localized inventory',status:'active'}),second=await sqliteWorkspace(db,worker,'work',{pageSize:2,page:2,search:'Localized inventory',status:'active'});
  assert.equal(first.total,4);assert.equal(first.items.length,2);assert.equal(second.items.length,2);assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,4);
  assert.ok(first.items.every(item=>item.title.startsWith('Localized inventory')&&!('snapshot_json'in item)));assert.equal(first.counts.active,5);
  const exact=await sqliteWorkspace(db,worker,'work',{assignmentId:added[0]});assert.equal(exact.item.id,added[0]);assert.equal(exact.item.responseStatus,'waiting');assert.equal(exact.item.canComplete,false);
  await assert.rejects(sqliteWorkspace(db,{...worker,principal_id:'worker-2'},'work',{assignmentId:added[0]}),/Assignment unavailable/);
  await assert.rejects(sqliteWorkspace(db,worker,'work',{workerId:'worker-2'}),/Invalid work request/);
  for(const filter of [{pageSize:51},{page:0},{status:'invented'},{search:'x'.repeat(81)},{other:true}])await assert.rejects(sqliteWorkspace(db,worker,'work',filter),/Invalid work request/);
  assert.equal((await sqliteWorkspace(db,worker,'work',{search:'%'})).total,0);
  db.prepare("UPDATE publications SET state='withdrawn' WHERE id=(SELECT publication_id FROM assignments WHERE id=?)").run(added[0]);
  assert.equal((await sqliteWorkspace(db,worker,'work',{status:'sent',search:'Localized inventory'})).total,3);
  assert.equal((await sqliteWorkspace(db,worker,'work',{status:'active',search:'Localized inventory'})).total,3);
  assert.equal((await sqliteWorkspace(db,worker,'work',{status:'all',search:'Localized inventory'})).total,4);
 }finally{db.close();}
});
test('attachments validate bytes and become available only to the assigned worker after publication',async()=>{
 const db=fixture();try{const requestId=randomUUID(),file={id:randomUUID(),name:'Instructions.pdf',mime:'application/pdf',data:Buffer.from('%PDF-1.7\nSynthetic test').toString('base64')};
 await sqliteWorkspace(db,staff,'composition',{id:requestId,content});
 await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:{...file,mime:'text/html'}}),/Use a photo/);
 await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:{...file,name:'../escape.pdf'}}),/Invalid attachment/);
 const saved=await sqliteWorkspace(db,staff,'attachments',{requestId,file});assert.equal(saved.items.length,1);assert.deepEqual(saved.items[0].captions,{});
 const photo={id:randomUUID(),name:'Shelf.png',mime:'image/png',data:Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64'),captions:{en:'Items on the blue shelf',ar:'المنتجات على الرف الأزرق'}};
 await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:{...file,captions:{en:'Not a photo'}}}),/only available for photos/);
 await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:{...photo,captions:{zz:'Unknown language'}}}),/Invalid attachment captions/);
 await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:{...photo,captions:{en:'x'.repeat(301)}}}),/Invalid attachment captions/);
 const withPhoto=await sqliteWorkspace(db,staff,'attachments',{requestId,file:photo});assert.equal(withPhoto.items.length,2);assert.equal(withPhoto.items.find(item=>item.id===photo.id).captions.en,photo.captions.en);
 const recaptioned=await sqliteWorkspace(db,staff,'attachments',{requestId,file:{id:photo.id,captions:{ur:'نیلی شیلف پر اشیاء'}}});assert.deepEqual(recaptioned.items.find(item=>item.id===photo.id).captions,{ur:'نیلی شیلف پر اشیاء'});
 await assert.rejects(sqliteWorkspace(db,worker,'attachments',{requestId}),/unavailable/);
 await assert.rejects(sqliteWorkspace(db,worker,'attachments',{requestId,file:{id:photo.id,captions:{en:'Worker edit'}}}),/Forbidden/);
 startInstructionSend(db,staff,{requestId,title:'Attachment test',source:CANONICAL_SOURCE,audience:{type:'members',workerIds:['worker-1']},responseMode:'question',deliveryMode:'text'});await processOne(db);const sent=completeInstructionSend(db,staff,requestId);
 const assignment=db.prepare('SELECT id FROM assignments WHERE publication_id=?').get(sent.publicationId);
 const list=await sqliteWorkspace(db,worker,'assignment-files',{id:assignment.id});assert.equal(list.items.find(item=>item.id===saved.items[0].id).name,'Instructions.pdf');assert.deepEqual(list.items.find(item=>item.id===photo.id).captions,{ur:'نیلی شیلف پر اشیاء'});
 const download=await sqliteWorkspace(db,worker,'attachments',{requestId,download:saved.items[0].id});assert.equal(download.data_base64,file.data);
 await assert.rejects(sqliteWorkspace(db,{...worker,principal_id:'worker-2'},'attachments',{requestId}),/unavailable/);
 await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:{...file,id:randomUUID()}}),/cannot be changed/);
 await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:{id:photo.id,captions:{en:'Too late'}}}),/cannot be changed/);
 }finally{db.close();}
});
test('workspace HTTP requires current session context for staff and workers',async()=>{
 const db=openDatabase(':memory:'),server=sqliteApp(db);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const base=`http://127.0.0.1:${server.address().port}/api`,response=await fetch(base+'/auth/staff/login',{method:'POST',headers:{origin:'http://127.0.0.1:3020','content-type':'application/json'},body:JSON.stringify(principalLoginBody('maya'))}),cookie=response.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(base+'/workspace/instructions',{headers:{cookie}})).status,409);
 const session=await (await fetch(base+'/session',{headers:{cookie}})).json();const read=await fetch(base+'/workspace/instructions',{headers:{cookie,'x-client-session-context':session.clientContext}});assert.equal(read.status,200);assert.ok((await read.json()).items.length);
 const headers={cookie,'x-client-session-context':session.clientContext};
 const workPage=await fetch(base+'/workspace/work?workerId=worker-1&pageSize=1',{headers});assert.equal(workPage.status,200);const work=await workPage.json();assert.equal(work.items.length,1);assert.equal(work.pageSize,1);
 const exact=await fetch(base+`/workspace/work/${work.items[0].id}?workerId=worker-1`,{headers});assert.equal(exact.status,200);assert.equal((await exact.json()).item.id,work.items[0].id);
 for(const query of ['?workerId=worker-1&page=1&page=2','?workerId=worker-1&unknown=true','?workerId=worker-1&pageSize=1000'])assert.equal((await fetch(base+'/workspace/work'+query,{headers})).status,400);
 assert.equal((await fetch(base+`/workspace/work/${work.items[0].id}?workerId=worker-2`,{headers})).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
