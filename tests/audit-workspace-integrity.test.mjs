import {ensureRecordingSchema} from '../server/recordings.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {workspaceOperation} from '../server/workspace.mjs';
for(const engine of ['sqlite','postgres'])test(engine+' workspace rejects invalid ownership, JSON, dates and attachment sizes; library is bounded',async()=>{
 let db,q;
 if(engine==='sqlite'){db=openDatabase(':memory:');seed(db);ensureRecordingSchema(db);q=async(sql,values=[])=>db.prepare(sql).all(...values);}
 else{db=new PGlite();const client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};await db.exec('CREATE SCHEMA audit_integrity');await runMigrations({async connect(){return client;}},{schema:'audit_integrity'});await db.exec("SET search_path TO audit_integrity,pg_catalog;INSERT INTO organizations VALUES('cedar','Test');INSERT INTO sites VALUES('beirut','cedar','Test','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Test','owner');");q=async(sql,values=[])=>{let n=0;return(await db.query(sql.replace(/\?/g,()=>'$'+(++n)),values)).rows;};}
 try{
 const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
 const values=[randomUUID(),'cedar','beirut','maya','{}','2026-11-11T00:00:00.000Z'];
 const composition='INSERT INTO instruction_compositions VALUES(?,?,?,?,?,?)';
 await q(composition,values);
 for(const [index,value] of [[1,'foreign'],[2,'foreign'],[3,'missing'],[4,'not json'],[4,'[]'],[5,'not date']]){
  const invalid=[...values];invalid[0]=randomUUID();invalid[index]=value;await assert.rejects(q(composition,invalid));
 }
 const attachment=[randomUUID(),values[0],'cedar','beirut','maya','Test.txt','text/plain',1,'eA==','2026-11-11T00:00:00.000Z','{}'];
 const upload='INSERT INTO instruction_attachments(id,request_id,org_id,site_id,staff_id,name,mime,bytes,data_base64,created_at,captions_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)';
 await q(upload,attachment);
 for(const [index,value] of [[1,randomUUID()],[7,-1],[7,2],[8,'not base64'],[10,'[]'],[10,'{"en":99}'],[10,'{"unknown":"bad"}']]){const invalid=[...attachment];invalid[0]=randomUUID();invalid[index]=value;await assert.rejects(q(upload,invalid));}
 for(let i=0;i<45;i++)await workspaceOperation(q,owner,'composition',{id:randomUUID(),content:{title:'History '+String(i).padStart(2,'0'),source:'Keep clear.',audience:{type:'all'},responseMode:'acknowledge',deliveryMode:'text'}},{dialect:engine});
 const queried=[];const measured=async(sql,values)=>{const rows=await q(sql,values);queried.push(rows.length);return rows;};
 const page=await workspaceOperation(measured,owner,'library',{page:2,status:'draft',search:'History'},{dialect:engine});
 assert.equal(page.total,45);assert.equal(page.items.length,20);assert.ok(Math.max(...queried)<=20,'no query returns the entire instruction history');
 assert.equal(new Set(page.items.map(row=>row.id)).size,20);
 await workspaceOperation(q,owner,'composition',{id:randomUUID(),content:{title:'СМЕНА',source:'Keep clear.',audience:{type:'all'},responseMode:'acknowledge',deliveryMode:'text'}},{dialect:engine});
 assert.equal((await workspaceOperation(q,owner,'library',{search:'смена'},{dialect:engine})).total,1,'Unicode search preserves the previous case-insensitive behavior');

 if(engine==='postgres'){
  await q("SET TIME ZONE 'Pacific/Kiritimati'");
  await q("INSERT INTO briefings(id,org_id,site_id,title,source,state,updated_at) VALUES('timezone-brief','cedar','beirut','Timezone briefing','Keep clear.','draft','2026-11-11T10:00:00.000Z')");
  const compositionId=randomUUID();await q(composition,[compositionId,'cedar','beirut','maya','{"title":"Timezone composition"}','2026-11-11T11:00:00.000Z']);
  const ordered=await workspaceOperation(q,owner,'library',{search:'Timezone'},{dialect:engine});
  assert.equal(ordered.items[0].id,compositionId,'mixed saved/composed instructions sort by UTC instant');
  const dated=await workspaceOperation(q,owner,'library',{search:'Timezone',date:'2026-11-11'},{dialect:engine});assert.equal(dated.total,2,'date filter uses the same UTC day as returned timestamps');
 }

 }finally{await db.close();}
});

import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
test('workspace migration refuses anomalous retained rows without deleting them or advancing its ledger',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'understood-integrity-'));
 const db=new PGlite(),client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};
 const pool={async connect(){return client;}},schema='audit_integrity_preflight';
 try{
 const source=fileURLToPath(new URL('../server/postgres/migrations/',import.meta.url));
 for(const name of await readdir(source))if(/^\d{3}_.*\.sql$/.test(name)&&Number(name.slice(0,3))<=126)await copyFile(join(source,name),join(directory,name));
 await db.exec('CREATE SCHEMA '+schema);await runMigrations(pool,{schema,directory});await db.exec('SET search_path TO '+schema+',pg_catalog');
 await db.exec("INSERT INTO instruction_compositions VALUES('retained','missing','missing','missing','not JSON','not date')");
 const before=(await db.query('SELECT * FROM instruction_compositions')).rows;
 await assert.rejects(runMigrations(pool,{schema}),/foreign key|composition_staff_scope|composition_content_valid/i);
 assert.deepEqual((await db.query('SELECT * FROM instruction_compositions')).rows,before);
 assert.equal((await db.query("SELECT count(*)::int n FROM schema_migrations WHERE version LIKE '127%'")).rows[0].n,0);
 }finally{await db.close();assert.equal(dirname(directory),tmpdir());assert.ok(basename(directory).startsWith('understood-integrity-'));await rm(directory,{recursive:true,force:true});}
});
