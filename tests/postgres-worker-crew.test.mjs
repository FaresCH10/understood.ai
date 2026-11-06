import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {postgresWorkspace} from '../server/postgres/workspace.mjs';
import {startInstructionSend,completeInstructionSend} from '../server/postgres/instructions.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';

test('PostgreSQL crew tab limits member identity and instruction history to the authenticated worker',async()=>{
 const db=new PGlite(),client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}},pool={async connect(){return client;}},options={schema:'crew_qa',integrationMode:'synthetic'};
 const staff={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'},worker={principal_type:'worker',principal_id:'w1',org_id:'a',site_id:'a'};
 try{
  await db.exec('CREATE SCHEMA crew_qa');await runMigrations(pool,options);
  await db.exec(`SET search_path TO crew_qa,pg_catalog;INSERT INTO organizations(id,name) VALUES('a','A');INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','A','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner');INSERT INTO workers(id,org_id,site_id,code,name,language) VALUES('w1','a','a','001','First','en'),('w2','a','a','002','Second','ar'),('w3','a','a','003','Outside','en');INSERT INTO crews(id,org_id,site_id,name,active) VALUES('crew-one','a','a','Morning',true),('crew-two','a','a','Evening',true);INSERT INTO crew_memberships(worker_id,org_id,site_id,crew_id,joined_at) VALUES('w1','a','a','crew-one',clock_timestamp()),('w2','a','a','crew-one',clock_timestamp()),('w3','a','a','crew-two',clock_timestamp());`);
  let value=await postgresWorkspace(pool,worker,'worker-crew',{},options);assert.equal(value.crew.name,'Morning');assert.equal(value.members.total,2);assert.equal(value.members.items[0].isYou,true);assert.deepEqual(Object.keys(value.members.items[0]).sort(),['isYou','language','name']);
  const requestId=randomUUID();await startInstructionSend(pool,staff,{requestId,title:'Crew shelf instruction',source:CANONICAL_SOURCE,audience:{type:'crew',crewId:'crew-one'},responseMode:'acknowledge',deliveryMode:'text'},options);await processOnePreparation(pool,options);await completeInstructionSend(pool,staff,requestId,options);
  value=await postgresWorkspace(pool,worker,'worker-crew',{},options);assert.equal(value.work.total,1);assert.equal(value.work.items.length,1);
  assert.equal((await postgresWorkspace(pool,{...worker,principal_id:'w3'},'worker-crew',{},options)).work.total,0);
  await db.query("UPDATE crew_memberships SET crew_id='crew-two' WHERE worker_id='w1'");assert.equal((await postgresWorkspace(pool,worker,'worker-crew',{},options)).work.total,0);
  await assert.rejects(postgresWorkspace(pool,staff,'worker-crew',{},options),/Forbidden/);
 }finally{await db.close();}
});
