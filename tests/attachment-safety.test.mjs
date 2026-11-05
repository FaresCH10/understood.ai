import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {sqliteWorkspace} from '../server/workspace-sqlite.mjs';
import {attachmentDigest,attachmentPolicy,resolveAttachmentScanner,MAX_ATTACHMENT_BYTES,MAX_ATTACHMENT_JSON_BYTES} from '../server/attachment-policy.mjs';
import {transaction} from '../server/db.mjs';
import {openPrincipalSession} from './helpers/sqlite-app.mjs';

const staff={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const content={title:'File check',source:'Please read the attached file.',audience:{type:'all'},responseMode:'question',deliveryMode:'text'};
const file=()=>({id:randomUUID(),name:'Notes.txt',mime:'text/plain',data:Buffer.from('Check the shelf count.').toString('base64')});

test('parallel SQLite workspace operations do not nest transactions',async()=>{
 const db=openDatabase(':memory:');seed(db);
 try{const ids=Array.from({length:5},()=>randomUUID());await Promise.all(ids.map(id=>sqliteWorkspace(db,staff,'composition',{id,content})));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM instruction_compositions').get().n,5);}
 finally{db.close();}
});

test('scanning releases SQLite locks and rechecks draft state before persistence',async()=>{
 const db=openDatabase(':memory:');seed(db);let finishScan,started;
 const scanning=new Promise(resolve=>{started=resolve;}),verdict=new Promise(resolve=>{finishScan=resolve;});
 try{
  const id=randomUUID(),original=file();await sqliteWorkspace(db,staff,'composition',{id,content});
  const upload=sqliteWorkspace(db,staff,'attachments',{requestId:id,file:original},{integrationMode:'live',attachmentScanner:{async scan(){started();return verdict;}}});
  await scanning;
  transaction(db,()=>db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM instruction_attachments').get().n,0);
  finishScan('clean');await assert.rejects(upload,/Forbidden/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM instruction_attachments').get().n,0);
 }finally{finishScan?.('clean');db.close();}
});

test('a staff sign-out during scanning revokes the in-flight upload even when the account stays active',async()=>{
 const db=openDatabase(':memory:');seed(db);
 try{
  openPrincipalSession(db,db.prepare("SELECT * FROM staff WHERE id='maya'").get());
  const session={...staff,token_hash:db.prepare("SELECT token_hash FROM sessions WHERE principal_id='maya'").get().token_hash};
  const id=randomUUID();await sqliteWorkspace(db,session,'composition',{id,content});
  await assert.rejects(sqliteWorkspace(db,session,'attachments',{requestId:id,file:file()},{integrationMode:'live',attachmentScanner:{async scan(){
   transaction(db,()=>db.prepare("UPDATE sessions SET revoked_at=? WHERE token_hash=?").run(new Date().toISOString(),session.token_hash));return 'clean';
  }}}),/Sign in required/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM instruction_attachments').get().n,0);
 }finally{db.close();}
});

test('attachment gateway limit includes base64 overhead below Vercel transport cap',()=>{
 assert.equal(MAX_ATTACHMENT_BYTES,3*1024*1024);
 assert.ok(MAX_ATTACHMENT_BYTES*4/3+16384<MAX_ATTACHMENT_JSON_BYTES);
 assert.ok(MAX_ATTACHMENT_JSON_BYTES<4.5*1024*1024);
 assert.equal(attachmentPolicy({integrationMode:'live'}).uploadAllowed,false);
 assert.equal(attachmentPolicy().uploadAllowed,true);
});

test('scanner uses authenticated binary transport and rejects unbound or failed verdicts',async()=>{
 const bytes=Buffer.from('synthetic attachment only'),env={UNDERSTOOD_ATTACHMENT_SCANNER_URL:'https://scanner.understood.co/scan',UNDERSTOOD_ATTACHMENT_SCANNER_KEY:'fixture-scanner-token'};
 let observed;
 const scanner=resolveAttachmentScanner(env,{fetchImpl:async(url,options)=>{observed={url,options};return Response.json({sha256:attachmentDigest(bytes),verdict:'clean'});}});
 assert.equal(await scanner.scan(bytes,{mime:'text/plain',name:'Notes.txt'}),'clean');
 assert.equal(observed.options.redirect,'error');assert.equal(observed.options.headers.authorization,'Bearer fixture-scanner-token');assert.deepEqual(observed.options.body,bytes);
 for(const result of [{sha256:'0'.repeat(64),verdict:'clean'},{sha256:attachmentDigest(bytes),verdict:'unknown'},{sha256:attachmentDigest(bytes),verdict:'clean',extra:true}]){
  const invalid=resolveAttachmentScanner(env,{fetchImpl:async()=>Response.json(result)});await assert.rejects(invalid.scan(bytes),/safety check unavailable/);
 }
 const infected=resolveAttachmentScanner(env,{fetchImpl:async()=>Response.json({sha256:attachmentDigest(bytes),verdict:'infected'})});assert.equal(await infected.scan(bytes),'infected');
 for(const url of ['http://scanner.understood.co/scan','https://127.0.0.1/scan','https://scanner.local/scan'])assert.throws(()=>resolveAttachmentScanner({...env,UNDERSTOOD_ATTACHMENT_SCANNER_URL:url}),/configuration/);
});

test('real file release is blocked until clean and legacy downloads are scanned too',async()=>{
 const db=openDatabase(':memory:');seed(db);
 try{
  const requestId=randomUUID();await sqliteWorkspace(db,staff,'composition',{id:requestId,content});
  const original=file(),live={integrationMode:'live'};
  await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:original},live),/scanning is configured/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM instruction_attachments').get().n,0);
  await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:original},{...live,attachmentScanner:{scan:async()=> 'infected'}}),/failed the safety check/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM instruction_attachments').get().n,0);
  let scans=0;const clean={...live,attachmentScanner:{scan:async()=>{scans++;return 'clean';}}};
  await sqliteWorkspace(db,staff,'attachments',{requestId,file:original},clean);assert.equal(scans,1);
  await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,download:original.id},live),/scanning is configured/);
  await sqliteWorkspace(db,staff,'attachments',{requestId,download:original.id},clean);assert.equal(scans,2);
  const legacy=file();await sqliteWorkspace(db,staff,'attachments',{requestId,file:legacy});
  await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,download:legacy.id},{...live,attachmentScanner:{scan:async()=> 'infected'}}),/failed the safety check/);
  await assert.rejects(sqliteWorkspace(db,staff,'attachments',{requestId,file:{...file(),data:Buffer.alloc(MAX_ATTACHMENT_BYTES+1,65).toString('base64')}}),/up to 3 MB/);
 }finally{db.close();}
});
