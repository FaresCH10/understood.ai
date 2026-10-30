import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {postgresWorkspace} from '../server/postgres/workspace.mjs';
import {startInstructionSend,completeInstructionSend} from '../server/postgres/instructions.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {acknowledgeAssignment} from '../server/postgres/acknowledgments.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
const scope={schema:'test_workspace',integrationMode:'synthetic'},staff={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'},worker={principal_type:'worker',principal_id:'w1',org_id:'a',site_id:'a'};
test('PostgreSQL supports persisted drafts, selected members, attachments and explicit work completion',async()=>{
 const db=new PGlite(),client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}},pool={async connect(){return client;}};
 try{
  await db.exec('CREATE SCHEMA test_workspace');
  await runMigrations(pool,scope);
  await db.exec(`SET search_path TO test_workspace,pg_catalog;INSERT INTO organizations(id,name) VALUES('a','A');INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','A','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner');INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w1','a','a','001','en'),('w2','a','a','002','en');`);
  const id=randomUUID(),content={title:'Shelf handover',source:CANONICAL_SOURCE,audience:{type:'members',workerIds:['w1']},responseMode:'acknowledge',deliveryMode:'text'};
  await postgresWorkspace(pool,staff,'composition',{id,content},scope);
  assert.equal((await postgresWorkspace(pool,staff,'composition',{id},scope)).content.source,CANONICAL_SOURCE);
  const file={id:randomUUID(),name:'Safety.txt',mime:'text/plain',data:Buffer.from('Synthetic safety attachment').toString('base64')};
  await postgresWorkspace(pool,staff,'attachments',{requestId:id,file},scope);
  const library=await postgresWorkspace(pool,staff,'library',{status:'draft'},scope);assert.ok(library.items.some(row=>row.id===id));
  await startInstructionSend(pool,staff,{requestId:id,...content},scope);await processOnePreparation(pool,scope);const sent=await completeInstructionSend(pool,staff,id,scope);assert.equal(sent.delivered,1);
  const assignment=(await db.query('SELECT id FROM assignments WHERE publication_id=$1',[sent.publicationId])).rows[0];
  await assert.rejects(postgresWorkspace(pool,worker,'work',{complete:assignment.id},scope),/Confirm understanding/);
  await acknowledgeAssignment(pool,worker,assignment.id,randomUUID(),scope);
  assert.equal((await postgresWorkspace(pool,worker,'work',{complete:assignment.id},scope)).status,'done');
  const doneLibrary=await postgresWorkspace(pool,staff,'library',{status:'done'},scope);assert.equal(doneLibrary.items[0].workCounts.done,1);
  const files=await postgresWorkspace(pool,worker,'assignment-files',{id:assignment.id},scope);assert.equal(files.items[0].name,file.name);
  await assert.rejects(postgresWorkspace(pool,{...worker,principal_id:'w2'},'attachments',{requestId:id},scope),/unavailable/);
  assert.equal((await postgresWorkspace(pool,staff,'work',{workerId:'w1'},scope)).items[0].status,'done');
 }finally{await db.close();}
});
