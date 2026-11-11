import {DatabaseSync} from 'node:sqlite';
import {ensureInstructionSchema} from '../../../server/instruction-schema.mjs';
import {nemotronInstructionDelivery} from '../../../server/ai/nemotron-instruction-delivery.mjs';
import {entitlementSummary} from '../../../server/entitlement-model.mjs';
import {improvementSampleQuery} from '../../../server/self-healing-input.mjs';
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY); CREATE TABLE sites(id TEXT PRIMARY KEY); CREATE TABLE staff(id TEXT PRIMARY KEY); CREATE TABLE workers(id TEXT PRIMARY KEY,org_id TEXT,site_id TEXT,UNIQUE(id,org_id,site_id)); CREATE TABLE briefings(id TEXT PRIMARY KEY); CREATE TABLE publications(id TEXT PRIMARY KEY,snapshot_json TEXT); CREATE TABLE assignments(id TEXT PRIMARY KEY,publication_id TEXT,language TEXT); CREATE TABLE instruction_deliveries(request_id TEXT,worker_id TEXT,org_id TEXT,site_id TEXT,FOREIGN KEY(worker_id,org_id,site_id) REFERENCES workers(id,org_id,site_id)); INSERT INTO workers VALUES('worker','org','site'); INSERT INTO instruction_deliveries VALUES('send','worker','org','site');`);
const before=db.prepare('SELECT COUNT(*) n FROM instruction_deliveries').get().n;
ensureInstructionSchema(db);
const after=db.prepare('SELECT COUNT(*) n FROM instruction_deliveries').get().n;
console.log(JSON.stringify({case:'valid_composite_fk_delivery_ledger',before,after,foreignKeyCheck:db.prepare('PRAGMA foreign_key_check').all()}));
db.close();
const realNow=Date.now;let now=100000;Date.now=()=>now;let calls=0;
try{
 const adapter=nemotronInstructionDelivery({UNDERSTOOD_INSTRUCTION_TEXT_PROVIDER:'nemotron',VERCEL_ENV:'production',NVIDIA_API_KEY:'test-key',DEEPL_API_KEY:'test-key:fx'},async()=>{calls++;return Response.json({translations:[{text:'Test title'},{text:'Keep the blue walkway clear.'}]});});
 await adapter.prepare({title:'First',source:'Keep the blue walkway clear.'},{response_mode:'acknowledge'});
 now+=24000;await adapter.prepare({title:'Second',source:'Keep the green walkway clear.'},{response_mode:'acknowledge'});
 now+=2000;
 const result=await adapter.translate('en',{title:'Test title',text:'Keep the blue walkway clear.'});
 console.log(JSON.stringify({case:'adapter_budget_cross_talk',elapsedSinceFirst:26000,expectedFirstBudgetExpired:true,translationStillSucceeded:!!result,calls}));
}finally{Date.now=realNow;}
console.log(JSON.stringify({case:'missing_entitlement',summary:entitlementSummary(null)}));
const orderDb=new DatabaseSync(':memory:');
try{
 orderDb.exec(`CREATE TABLE assignments(id TEXT,worker_id TEXT,publication_id TEXT,org_id TEXT,site_id TEXT,language TEXT);CREATE TABLE workers(id TEXT,org_id TEXT,site_id TEXT,active INTEGER);CREATE TABLE attempts(id TEXT,assignment_id TEXT,org_id TEXT,submission_id TEXT,received_at TEXT,outcome TEXT);CREATE TABLE worker_deletion_requests(worker_id TEXT,org_id TEXT,site_id TEXT);CREATE TABLE submission_receipts(sequence INTEGER,assignment_id TEXT,submission_id TEXT);INSERT INTO assignments VALUES('a','w','p','o','s','en');INSERT INTO workers VALUES('w','o','s',1);INSERT INTO attempts VALUES('zz-old','a','o','old','2026-11-11T00:00:00.000Z','clarification'),('aa-new','a','o','new','2026-11-11T00:00:00.000Z','matched');INSERT INTO submission_receipts VALUES(1,'a','old'),(2,'a','new');`);
 const selected=orderDb.prepare(improvementSampleQuery).all('p','o','s');
 const authoritative=orderDb.prepare('SELECT t.outcome FROM attempts t JOIN submission_receipts r ON r.assignment_id=t.assignment_id AND r.submission_id=t.submission_id ORDER BY r.sequence DESC LIMIT 1').get();
 console.log(JSON.stringify({case:'improvement_latest_receipt',selected:selected[0].outcome,authoritative:authoritative.outcome}));
}finally{orderDb.close();}
