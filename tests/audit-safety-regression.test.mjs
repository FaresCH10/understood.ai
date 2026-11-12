import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {ensureInstructionSchema} from '../server/instruction-schema.mjs';
import {CONTENT_SECURITY_POLICY} from '../server/content-security-policy.mjs';
import {nemotronInstructionDelivery} from '../server/ai/nemotron-instruction-delivery.mjs';
import {improvementSampleQuery} from '../server/self-healing-input.mjs';
import {createDeepLTranslateAdapter} from '../server/ai/deepl-translate.mjs';

test('Vercel and Node apply the same CSP',async()=>{
  const cfg=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(cfg.headers[0].headers.find(h=>h.key==='Content-Security-Policy')?.value,CONTENT_SECURITY_POLICY);
});

test('unknown valid composite ledger schema is never dropped during startup',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`CREATE TABLE workers(id TEXT,org_id TEXT,site_id TEXT,UNIQUE(id,org_id,site_id));CREATE TABLE instruction_deliveries(request_id TEXT,worker_id TEXT,org_id TEXT,site_id TEXT,FOREIGN KEY(worker_id,org_id,site_id) REFERENCES workers(id,org_id,site_id));INSERT INTO workers VALUES('w','o','s');INSERT INTO instruction_deliveries VALUES('r','w','o','s');`);
    for(let i=0;i<2;i++){try{ensureInstructionSchema(db);}catch{}assert.equal(db.prepare('SELECT count(*) n FROM instruction_deliveries').get().n,1);}
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});

test('complete populated composite-key ledger survives repeated schema startup',()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY);CREATE TABLE sites(id TEXT PRIMARY KEY);CREATE TABLE staff(id TEXT PRIMARY KEY);CREATE TABLE briefings(id TEXT PRIMARY KEY);CREATE TABLE publications(id TEXT PRIMARY KEY);CREATE TABLE assignments(id TEXT PRIMARY KEY);CREATE TABLE workers(id TEXT,org_id TEXT,site_id TEXT,UNIQUE(id,org_id,site_id));
    CREATE TABLE instruction_deliveries(request_id TEXT,org_id TEXT,site_id TEXT,worker_id TEXT,language TEXT,state TEXT,reason TEXT,attempts INTEGER,assignment_id TEXT,content_json TEXT,content_hash TEXT,updated_at TEXT,PRIMARY KEY(request_id,worker_id),FOREIGN KEY(worker_id,org_id,site_id) REFERENCES workers(id,org_id,site_id));
    INSERT INTO workers VALUES('w','o','s');INSERT INTO instruction_deliveries VALUES('r','o','s','w','en','preparing',NULL,0,NULL,NULL,NULL,'2026-11-11T00:00:00.000Z');`);
    const before=db.prepare('SELECT * FROM instruction_deliveries').all();
    ensureInstructionSchema(db);ensureInstructionSchema(db);
    assert.deepEqual(db.prepare('SELECT * FROM instruction_deliveries').all(),before);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});

test('overlapping cached adapter requests cannot extend each other deadlines',async()=>{
  let now=100000,calls=0;const realNow=Date.now;Date.now=()=>now;
  try{
    const root=nemotronInstructionDelivery({UNDERSTOOD_INSTRUCTION_TEXT_PROVIDER:'nemotron',VERCEL_ENV:'production',NVIDIA_API_KEY:'test-key',DEEPL_API_KEY:'test-key:fx'},async()=>{calls++;return Response.json({translations:[{text:'Title'},{text:'Keep the blue walkway clear.'}]});});
    const a=root.forRequest(),b=root.forRequest();
    await a.prepare({title:'A',source:'Keep clear.'},{response_mode:'acknowledge'});
    now+=24000;await b.prepare({title:'B',source:'Keep clear.'},{response_mode:'acknowledge'});now+=2000;
    await assert.rejects(a.translate('en',{title:'Title',text:'Keep clear.'}),/budget exhausted/);assert.equal(calls,0);
    assert.ok(await b.translate('en',{title:'Title',text:'Keep clear.'}));assert.equal(calls,1);
  }finally{Date.now=realNow;}
});

test('improvement analysis follows latest receipt even when timestamps tie and audio is pending',()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec(`CREATE TABLE assignments(id TEXT,worker_id TEXT,publication_id TEXT,org_id TEXT,site_id TEXT,language TEXT);CREATE TABLE workers(id TEXT,org_id TEXT,site_id TEXT,active INTEGER);CREATE TABLE attempts(id TEXT,assignment_id TEXT,org_id TEXT,submission_id TEXT,received_at TEXT,outcome TEXT);CREATE TABLE worker_deletion_requests(worker_id TEXT,org_id TEXT,site_id TEXT);CREATE TABLE submission_receipts(sequence INTEGER,assignment_id TEXT,org_id TEXT,submission_id TEXT);INSERT INTO assignments VALUES('a','w','p','o','s','en');INSERT INTO workers VALUES('w','o','s',1);INSERT INTO attempts VALUES('zz-old','a','o','old','2026-11-11T00:00:00.000Z','clarification'),('aa-new','a','o','new','2026-11-11T00:00:00.000Z','matched');INSERT INTO submission_receipts VALUES(1,'a','o','old'),(2,'a','o','new');`);
    assert.equal(db.prepare(improvementSampleQuery).all('p','o','s')[0].outcome,'matched');
    db.exec("INSERT INTO submission_receipts VALUES(3,'a','o','pending-audio')");
    assert.deepEqual(db.prepare(improvementSampleQuery).all('p','o','s'),[]);
  }finally{db.close();}
});

test('DeepL cancels oversized streamed responses before parsing or retaining them',async()=>{
  let cancelled=false;
  const adapter=createDeepLTranslateAdapter({apiKey:'test-only',fetchImpl:async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(129*1024));},cancel(){cancelled=true;}}))});
  await assert.rejects(adapter.translate({title:'Title',text:'Keep clear.'},'en'),/too large/);assert.equal(cancelled,true);
});

test('DeepL preserves ordered choices when an optional question is absent',async()=>{
  const adapter=createDeepLTranslateAdapter({apiKey:'test-only',fetchImpl:async()=>Response.json({translations:['Title','Keep clear.','A','B','C','D'].map(text=>({text}))})});
  const value=await adapter.translate({title:'Title',text:'Keep clear.',answerChoices:['A','B','C','D']},'en');assert.deepEqual(value.answerChoices,['A','B','C','D']);
});
