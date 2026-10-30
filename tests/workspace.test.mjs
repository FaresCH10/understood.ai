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
const staff={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-1',org_id:'cedar',site_id:'beirut'};
const content={title:'Delivery check',source:'Please check the delivery count.',audience:{type:'all'},responseMode:'question',deliveryMode:'text'};
const fixture=()=>{const db=openDatabase(':memory:');seed(db);ensureInstructionSchema(db);return db;};
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
 const history=(await sqliteWorkspace(db,staff,'work',{workerId:worker.principal_id})).items;assert.equal(history.find(row=>row.id===inProgress.id).status,'done');
 const library=await sqliteWorkspace(db,staff,'library',{});assert.ok(library.items.some(row=>row.workCounts.done===1));
 await assert.rejects(sqliteWorkspace(db,staff,'work',{workerId:worker.principal_id,complete:inProgress.id}),/Forbidden/);
 }finally{db.close();}
});
test('attachments validate bytes and become available only to the assigned worker after publication',async()=>{
 const db=fixture();try{const requestId=randomUUID(),file={id:randomUUID(),name:'Instructions.pdf',mime:'application/pdf',data:Buffer.from('%PDF-1.7\nSynthetic test').toString('base64')};
 await sqliteWorkspace(db,staff,'composition',{id:requestId,content});
 await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:{...file,mime:'text/html'}}),/Use a photo/);
 await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:{...file,name:'../escape.pdf'}}),/Invalid attachment/);
 const saved=await sqliteWorkspace(db,staff,'attachments',{requestId,file});assert.equal(saved.items.length,1);
 await assert.rejects(sqliteWorkspace(db,worker,'attachments',{requestId}),/unavailable/);
 startInstructionSend(db,staff,{requestId,title:'Attachment test',source:CANONICAL_SOURCE,audience:{type:'members',workerIds:['worker-1']},responseMode:'question',deliveryMode:'text'});await processOne(db);const sent=completeInstructionSend(db,staff,requestId);
 const assignment=db.prepare('SELECT id FROM assignments WHERE publication_id=?').get(sent.publicationId);
 const list=await sqliteWorkspace(db,worker,'assignment-files',{id:assignment.id});assert.equal(list.items[0].name,'Instructions.pdf');
 const download=await sqliteWorkspace(db,worker,'attachments',{requestId,download:saved.items[0].id});assert.equal(download.data_base64,file.data);
 await assert.rejects(sqliteWorkspace(db,{...worker,principal_id:'worker-2'},'attachments',{requestId}),/unavailable/);
 await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:{...file,id:randomUUID()}}),/cannot be changed/);
 }finally{db.close();}
});
test('workspace HTTP requires current session context for staff and workers',async()=>{
 const db=openDatabase(':memory:'),server=sqliteApp(db);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const base=`http://127.0.0.1:${server.address().port}/api`,response=await fetch(base+'/auth/staff/login',{method:'POST',headers:{origin:'http://127.0.0.1:3020','content-type':'application/json'},body:JSON.stringify(principalLoginBody('maya'))}),cookie=response.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(base+'/workspace/instructions',{headers:{cookie}})).status,409);
 const session=await (await fetch(base+'/session',{headers:{cookie}})).json();const read=await fetch(base+'/workspace/instructions',{headers:{cookie,'x-client-session-context':session.clientContext}});assert.equal(read.status,200);assert.ok((await read.json()).items.length);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
