import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {publish} from '../server/postgres/domain.mjs';
import {receiveRecording} from '../server/postgres/recordings.mjs';
import {processOneRecording} from '../server/postgres/recording-worker.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {encodeWav} from '../src/audio.ts';

test('recorded-answer processing uses the late-delivered language question',async()=>{
  const db=new PGlite();
  const client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  const schema='understood_test_recording_late';
  const options={schema,integrationMode:'synthetic'};
  const owner={principal_type:'staff',principal_id:'s',org_id:'a',site_id:'a',role:'owner'};
  const worker={principal_type:'worker',principal_id:'w-hi',org_id:'a',site_id:'a'};
  const objects=new Map();
  const storage={
    async save(row,bytes){objects.set(row.id,Buffer.from(bytes));},
    async read(row){return objects.get(row.id);},
    async remove(row){objects.delete(row.id);},
    async exists(row){return objects.has(row.id);},
  };
  try{
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);
    await runMigrations(pool,{schema});
    await db.exec(`INSERT INTO organizations VALUES('a','Synthetic audit');INSERT INTO sites VALUES('a','a','Test','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('s','a','a','Owner','owner');INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w-en','a','a','001','en'),('w-hi','a','a','002','hi');`);
    const prepared={title:'Shelf handover',source:CANONICAL_SOURCE,facts:['Finished items go on the blue shelf.','Unfinished items go on the yellow shelf.'],question:'Where will you put finished and unfinished items?',rubric:{askedFacts:['finished -> blue shelf','unfinished -> yellow shelf']},languages:{en:{title:'Shelf handover',text:CANONICAL_SOURCE,question:'Where will you put finished and unfinished items?'}},provenance:{adapter:'synthetic-local-v1',live:false}};
    await db.query(`INSERT INTO briefings(id,org_id,site_id,title,source,revision,next_version,state,prepared_json,created_at,updated_at)
      VALUES('b','a','a','Shelf handover',$1,1,1,'ready',$2::jsonb,clock_timestamp(),clock_timestamp())`,[CANONICAL_SOURCE,JSON.stringify(prepared)]);
    const sendId=randomUUID();
    await db.query(`INSERT INTO instruction_sends(request_id,org_id,site_id,briefing_id,publication_request_id,audience_json,response_mode,delivery_mode,state,audience_count,delivered,undelivered,undelivered_json,request_json,requested_by,created_at,updated_at)
      VALUES($1,'a','a','b',$2,'{"type":"members","workerIds":["w-hi"]}'::jsonb,'question','text','preparing',1,0,1,'[]'::jsonb,'{}'::jsonb,'s',clock_timestamp(),clock_timestamp())`,[sendId,randomUUID()]);
    const published=await publish(pool,owner,'b',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['w-en']},options);
    const hiAssignment=randomUUID();
    await db.query(`INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,created_at,language)
      VALUES($1,'a','a',$2,'w-hi',clock_timestamp(),'hi')`,[hiAssignment,published.id]);
    await db.query(`UPDATE instruction_sends SET state='published',publication_id=$2,delivered=1,undelivered=0,undelivered_json='[]'::jsonb,updated_at=clock_timestamp() WHERE request_id=$1`,[sendId,published.id]);
    const hiContent={title:'Shelf handover',text:'مکمل اشیا نیلی شیلف پر رکھیں۔',question:'آپ مکمل اشیا کہاں رکھیں گے؟'};
    await db.query(`INSERT INTO instruction_deliveries(request_id,org_id,site_id,worker_id,language,state,attempts,assignment_id,content_json,content_hash,updated_at)
      VALUES($1,'a','a','w-hi','hi','available',0,$2,$3::jsonb,$4,clock_timestamp())`,[sendId,hiAssignment,JSON.stringify(hiContent),'a'.repeat(64)]);
    const bytes=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(0.2)}));
    await receiveRecording(pool,worker,hiAssignment,randomUUID(),bytes,storage,options);
    let asked=null;
    const adapter={transcribe:async()=>({text:'I am not sure where the finished items go.'}),assess:async(_answer,question)=>{asked=question;return {outcome:'clarification',reasons:['missing_asked_fact'],evidence:[]};}};
    assert.equal(await processOneRecording(pool,adapter,storage,options),true);
    assert.equal(asked,hiContent.question);
    const attempt=(await db.query('SELECT answer_text,outcome FROM attempts WHERE assignment_id=$1',[hiAssignment])).rows[0];
    assert.equal(attempt.outcome,'clarification');
    assert.match(attempt.answer_text,/not sure/);
  }finally{await db.close();}
});
