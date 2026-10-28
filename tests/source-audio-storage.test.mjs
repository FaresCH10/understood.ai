import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {receiveSourceAudio,getSourceAudioReceipt,getSourceAudio,listSourceAudio,sourceAudioJournal,receiveSourceAudioWithJournal} from '../server/source-audio.mjs';
import {receiveSourceAudio as pgReceive,getSourceAudioReceipt as pgReceipt,getSourceAudio as pgAudio,listSourceAudio as pgList,sourceAudioJournal as pgJournal} from '../server/postgres/source-audio.mjs';
import {sourceAudioInput} from '../server/source-audio-input.mjs';
import {localAudioStore,r2AudioStore} from '../server/private-storage.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {backupLocal,verifyLocalBackup,restoreLocal} from '../scripts/local-backup.mjs';
import {importSqliteBackup} from '../server/postgres/import-sqlite.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {processOneSourceAudio,sourceAudioProcessingJournal,processSourceAudioWithJournal} from '../server/source-audio-worker.mjs';
import {processOneSourceAudio as pgProcess,sourceAudioProcessingJournal as pgProcessingJournal} from '../server/postgres/source-audio-worker.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {sourceAudioCleanupJournal,processSourceAudioCleanup} from '../server/source-audio-cleanup.mjs';
import {sourceAudioCleanupJournal as pgCleanupJournal} from '../server/postgres/source-audio-cleanup.mjs';
import {saveRetention} from '../server/retention.mjs';
import {saveRetention as pgRetention} from '../server/postgres/retention.mjs';
import {retrySourceAudio,getSourceRetryReceipt} from '../server/source-audio-retry.mjs';
import {getSourceRetryReceipt as pgSourceRetryReceipt} from '../server/postgres/source-audio-retry.mjs';
import {createGeminiAdapter} from '../server/ai/gemini.mjs';
import {inspectWav} from '../server/audio.mjs';
import {principalLoginBody,seedCredentials} from './helpers/sqlite-app.mjs';


const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const input=()=>({requestId:randomUUID(),title:'Synthetic audio source',originalType:'audio/webm;codecs=opus',generationLanguages:['en','ar']});
const original=Buffer.from('Synthetic original bytes; never sent to a provider');
function wav() {
  const bytes=Buffer.alloc(32044);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);
  bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);
  bytes.writeUInt32LE(32000,40);bytes.writeInt16LE(1000,44);return bytes;
}
function memoryStore() {
  const objects=new Map();let saves=0;
  const save=async(key,bytes)=>{saves++;if(objects.has(key))throw Error('Exists');objects.set(key,Buffer.from(bytes));};
  const read=async key=>{if(!objects.has(key))throw Error('Missing');return Buffer.from(objects.get(key));};
  return {objects,get saves(){return saves;},save:(r,b)=>save(r.id,b),read:r=>read(r.id),
    saveOriginal:(r,b)=>save(r.id,b),readOriginal:r=>read(r.id),remove:async r=>{objects.delete(r.id);},removeOriginal:async r=>{objects.delete(r.id);},
    exists:async r=>objects.has(r.id),existsOriginal:async r=>objects.has(r.id)};
}
async function fixture(pg,{empty=false}={}) {
  let clock;
  if(!pg) {
    const db=openDatabase(':memory:');seedCredentials(db);
    db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run('rami','cedar','beirut','Rami','supervisor');
    const journal=sourceAudioJournal(db);
    return {db,journal,setClock:value=>{clock=value;},cleanupJournal:()=>sourceAudioCleanupJournal(db,{now:clock}),policy:()=>saveRetention(db,owner,{requestId:randomUUID(),revision:0,audioDays:7,confirmed:true}),list:(s,filters)=>listSourceAudio(db,s,filters),process:(adapter,st)=>processOneSourceAudio(db,adapter,st),processingJournal:()=>sourceAudioProcessingJournal(db),receive:(s,i,o,w,st)=>receiveSourceAudio(db,s,i,o,w,st),receipt:(s,id)=>getSourceAudioReceipt(db,s,id),
      audio:(s,id,st,k)=>getSourceAudio(db,s,id,st,k),raw:async(sql,values=[])=>({rows:db.prepare(sql).all(...values)}),
      fail(){db.exec("CREATE TRIGGER reject_source_audit BEFORE INSERT ON audit WHEN NEW.action='briefing.source_audio_received' BEGIN SELECT RAISE(ABORT,'Injected'); END");},
      reset(){db.exec('DROP TRIGGER reject_source_audit');},close:async()=>db.close()};
  }
  const db=new PGlite(),options={schema:'understood_test_source_audio'};let fail=false;
  const pool={async connect(){return {async query(sql,values){if(fail && sql.includes('INSERT INTO audit'))throw Error('Injected');if(clock)sql=sql.replaceAll('clock_timestamp()',`'${clock}'::timestamptz`);return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};}};
  await db.exec(`CREATE SCHEMA ${options.schema}; SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
  if(!empty)await db.exec("INSERT INTO organizations VALUES('cedar','Cedar Works'),('harbor','Other');INSERT INTO sites VALUES('beirut','cedar','Beirut site','Asia/Beirut'),('harbor-yard','harbor','Other site','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('rami','cedar','beirut','Rami','supervisor'),('harbor-owner','harbor','harbor-yard','Other','owner')");
  return {db,pool,options,journal:pgJournal(pool,options),setClock:value=>{clock=value;},cleanupJournal:()=>pgCleanupJournal(pool,options),policy:()=>pgRetention(pool,owner,{requestId:randomUUID(),revision:0,audioDays:7,confirmed:true},options),list:(s,filters)=>pgList(pool,s,filters,options),process:(adapter,st)=>pgProcess(pool,adapter,st,options),processingJournal:()=>pgProcessingJournal(pool,options),receive:(s,i,o,w,st)=>pgReceive(pool,s,i,o,w,st,options),receipt:(s,id)=>pgReceipt(pool,s,id,options),
    audio:(s,id,st,k)=>pgAudio(pool,s,id,st,k,options),raw:(sql,v)=>db.query(sql,v),fail(){fail=true;},reset(){fail=false;},close:()=>db.close()};
}
test('source audio metadata and bytes are bounded, strict and hash exact',()=>{
  const value=input(),a=sourceAudioInput(value,original,wav());
  assert.equal(a.originalBytes,original.length);assert.equal(a.durationSeconds,1);
  assert.deepEqual(a.generationLanguages,['en','ar']);
  assert.equal(a.requestHash,sourceAudioInput({...value,generationLanguages:['ar','en']},original,wav()).requestHash);
  for(const patch of [{requestId:'bad'},{title:'x'},{originalType:'text/html'},{originalType:'audio/wav\r\nX: y'},{generationLanguages:['ar']},{org_id:'foreign'}])assert.throws(()=>sourceAudioInput({...value,...patch},original,wav()),/Invalid/);
  for(const bytes of [Buffer.alloc(0),Buffer.alloc(10485761),'not bytes'])assert.throws(()=>sourceAudioInput(value,bytes,wav()),/Invalid/);
  assert.throws(()=>sourceAudioInput(value,original,Buffer.alloc(100)),/corrupt/);
});

for(const pg of [false,true]) {
  const name=pg?'PostgreSQL':'SQLite';
  test(`${name} free-tier source privacy gate blocks unknown audio before storage or provider access`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input();let calls=0,reads=0;
    const adapter=createGeminiAdapter({apiKey:'test-only',dataClass:'synthetic',fetchImpl:async()=>{calls++;throw Error('must not send');}});
    try {
      await f.receive(owner,value,original,wav(),st);
      const read=st.read,readOriginal=st.readOriginal;st.read=async(...args)=>{reads++;return read(...args);};st.readOriginal=async(...args)=>{reads++;return readOriginal(...args);};
      assert.equal(await f.process(adapter,st),true);assert.equal((await f.receipt(owner,value.requestId)).status,'blocked');
      assert.equal(calls,0);assert.equal(reads,0);assert.equal((await f.raw('SELECT count(*) n FROM briefings WHERE id='+(pg?'$1':'?'),[value.requestId])).rows[0].n,0);
      const permitted=input(),requests=[];
      await f.receive(owner,permitted,original,wav(),st);
      const allowed=createGeminiAdapter({apiKey:'test-only',dataClass:'synthetic',syntheticAudioHashes:[inspectWav(wav()).sha256],fetchImpl:async(url,options)=>{
        requests.push({url,options});
        if(url.endsWith('/upload/v1beta/files'))return new Response('{}',{headers:{'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/synthetic'}});
        if(url.endsWith('/upload/synthetic')){assert.deepEqual(options.body,wav());return Response.json({file:{name:'files/synthetic',uri:'https://generativelanguage.googleapis.com/v1beta/files/synthetic'}});}
        if(options.method==='DELETE')return new Response(null,{status:204});
        return Response.json({status:'completed',model:'gemini-3.5-transcribe',steps:[{type:'model_output',content:[{type:'text',text:CANONICAL_SOURCE}]}]});
      }});
      assert.equal(await f.process(allowed,st),true);assert.equal((await f.receipt(owner,permitted.requestId)).status,'transcribed');assert.equal(requests.length,4);
      assert.equal((await f.raw('SELECT source FROM briefings WHERE id='+(pg?'$1':'?'),[permitted.requestId])).rows[0].source,CANONICAL_SOURCE);
    }finally {await f.close();}
  });
  test(`${name} abandoned source cleanup fences uploads, retries partial deletion and rechecks late writes`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input(),row=await f.journal.reserve(owner,sourceAudioInput(value,original,wav()));
    const refs={canonical:{id:row.id},original:{id:row.original_id}},future=new Date(Date.now()+25*3600000).toISOString();
    try {
      await st.save(refs.canonical,wav());await st.saveOriginal(refs.original,original);
      assert.equal(await processSourceAudioCleanup(f.cleanupJournal(),st),false);
      f.setClock(future);
      await f.raw(pg?'UPDATE source_audio_requests SET lease_until=$1 WHERE request_id=$2':'UPDATE source_audio_requests SET lease_until=? WHERE request_id=?',[new Date(Date.parse(future)+3600000).toISOString(),value.requestId]);
      assert.equal(await processSourceAudioCleanup(f.cleanupJournal(),st),false);
      await f.journal.release(row);const journal=f.cleanupJournal(),claimed=await journal.claim();assert.ok(claimed);
      await assert.rejects(async()=>f.journal.accept(owner,row),/expired/);
      await assert.rejects(f.receive(owner,value,original,wav(),st),/expired/);
      const remove=st.remove;st.remove=async()=>{throw Error('Private provider detail');};
      await processSourceAudioCleanup({...journal,claim:async()=>claimed},st);assert.equal(st.objects.size,1);
      let purge=(await f.raw('SELECT * FROM source_audio_purges')).rows[0];assert.equal(purge.status,'queued');assert.equal(purge.error,'Private source cleanup failed');assert.equal(purge.completed_at,null);
      st.remove=remove;f.setClock(new Date(Date.parse(future)+31000).toISOString());
      assert.equal(await processSourceAudioCleanup(f.cleanupJournal(),st),true);assert.equal(st.objects.size,0);
      const receipt=await f.receipt(owner,value.requestId);assert.equal(receipt.audioStatus,'removed');assert.equal(receipt.receivedAt,null);assert.equal(receipt.status,'storing');
      assert.equal((await f.list(owner)).total,0);
      purge=(await f.raw('SELECT * FROM source_audio_purges')).rows[0];const completed=String(purge.completed_at);
      await st.save(refs.canonical,wav());await st.saveOriginal(refs.original,original);
      f.setClock(new Date(Date.parse(future)+62*60000).toISOString());assert.equal(await processSourceAudioCleanup(f.cleanupJournal(),st),true);assert.equal(st.objects.size,0);
      assert.equal(String((await f.raw('SELECT completed_at FROM source_audio_purges')).rows[0].completed_at),completed);
      assert.equal((await f.raw("SELECT count(*) n FROM audit WHERE action='briefing.source_audio_purged'")).rows[0].n,1);
      await assert.rejects(f.raw("DELETE FROM source_audio_purges"),/immutable/);
    }finally {await f.close();}
  });
  test(`${name} source retention requires policy and removes only audio while preserving transcript draft and receipt`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input();
    try {
      const accepted=await f.receive(owner,value,original,wav(),st);await f.process({transcribe:async()=>({text:CANONICAL_SOURCE})},st);
      f.setClock(new Date(Date.now()+8*86400000).toISOString());assert.equal(await processSourceAudioCleanup(f.cleanupJournal(),st),false);
      await f.policy();const journal=f.cleanupJournal(),claimed=await journal.claim();assert.ok(claimed);
      assert.equal((await f.receipt(owner,value.requestId)).audioStatus,'cleanup_pending');
      await assert.rejects(f.audio(owner,value.requestId,st),/unavailable/);assert.equal(st.objects.size,2);
      await processSourceAudioCleanup({...journal,claim:async()=>claimed},st);
      const receipt=await f.receipt(owner,value.requestId);assert.equal(receipt.receivedAt,accepted.receivedAt);assert.equal(receipt.briefingId,value.requestId);assert.equal(receipt.status,'transcribed');assert.equal(receipt.audioStatus,'removed');
      assert.equal((await f.raw('SELECT source FROM briefings WHERE id='+ (pg?'$1':'?'),[value.requestId])).rows[0].source,CANONICAL_SOURCE);
      assert.equal((await f.list(owner)).items[0].audioStatus,'removed');assert.equal(st.objects.size,0);
      assert.equal(await f.process({transcribe:async()=>{throw Error('must not call');}},st),false);
    }finally {await f.close();}
  });
  test(`${name} source cleanup fences late transcription and stale cleanup completion`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input();
    try {
      await f.receive(owner,value,original,wav(),st);const transcription=f.processingJournal(),old=await transcription.claim();await f.policy();
      f.setClock(new Date(Date.now()+8*86400000).toISOString());const journal=f.cleanupJournal(),first=await journal.claim();
      await transcription.finish(old,{requestId:value.requestId,title:value.title,source:CANONICAL_SOURCE,generationLanguages:['en','ar']});
      assert.equal((await f.receipt(owner,value.requestId)).briefingId,null);
      await f.raw(pg?'UPDATE source_audio_purges SET lease_until=$1 WHERE request_id=$2':'UPDATE source_audio_purges SET lease_until=? WHERE request_id=?',['2000-01-01T00:00:00.000Z',value.requestId]);
      const second=await journal.claim();assert.notEqual(first.token,second.token);await journal.finish(first);
      assert.equal((await f.raw('SELECT status FROM source_audio_purges')).rows[0].status,'processing');
      await processSourceAudioCleanup({...journal,claim:async()=>second},st);
      assert.equal((await f.raw('SELECT status FROM source_audio_purges')).rows[0].status,'complete');assert.equal(st.objects.size,0);
      assert.equal((await f.raw("SELECT count(*) n FROM audit WHERE action='briefing.source_audio_purged'")).rows[0].n,1);
    }finally {await f.close();}
  });
  test(`${name} source cleanup never reports completion after failed absence verification or audit commit`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input(),future=new Date(Date.now()+8*86400000).toISOString();
    try {
      await f.receive(owner,value,original,wav(),st);await f.policy();f.setClock(future);
      const exists=st.existsOriginal;st.existsOriginal=async()=>true;
      await processSourceAudioCleanup(f.cleanupJournal(),st);assert.equal((await f.receipt(owner,value.requestId)).audioStatus,'cleanup_pending');
      st.existsOriginal=exists;f.setClock(new Date(Date.parse(future)+31000).toISOString());
      if(pg)f.fail();else f.db.exec("CREATE TRIGGER reject_source_purge_audit BEFORE INSERT ON audit WHEN NEW.action='briefing.source_audio_purged' BEGIN SELECT RAISE(ABORT,'Injected'); END");
      await processSourceAudioCleanup(f.cleanupJournal(),st);assert.equal((await f.receipt(owner,value.requestId)).audioStatus,'cleanup_pending');
      if(pg)f.reset();else f.db.exec('DROP TRIGGER reject_source_purge_audit');
      f.setClock(new Date(Date.parse(future)+92000).toISOString());await processSourceAudioCleanup(f.cleanupJournal(),st);
      assert.equal((await f.receipt(owner,value.requestId)).audioStatus,'removed');assert.equal(st.objects.size,0);
      assert.equal((await f.raw("SELECT count(*) n FROM audit WHERE action='briefing.source_audio_purged'")).rows[0].n,1);
    }finally {await f.close();}
  });
  test(`${name} source history is bounded, actor-scoped, accepted-only and contains no private object or transcript`,async()=>{
    const f=await fixture(pg),st=memoryStore(),other={...owner,principal_id:'rami',role:'supervisor'};
    try {
      for(let n=0;n<21;n++)await f.receive(owner,input(),original,wav(),st);
      await f.receive(other,input(),original,wav(),st);
      await f.journal.reserve(owner,sourceAudioInput(input(),original,wav()));
      const first=await f.list(owner),second=await f.list(owner,{page:'2'});
      assert.equal(first.total,21);assert.equal(first.items.length,20);assert.equal(second.items.length,1);
      assert.equal(new Set([...first.items,...second.items].map(row=>row.requestId)).size,21);
      assert.deepEqual(Object.keys(first.items[0]).sort(),['briefingId','receivedAt','requestHash','requestId','status','title']);
      assert.equal((await f.list(other)).total,1);assert.equal((await f.list(owner,{page:3})).items.length,0);
      for(const filters of [{page:0},{page:1.5},{page:100001},{pageSize:100},{requested_by:'rami'}])await assert.rejects(async()=>f.list(owner,filters),/Invalid/);
      await assert.rejects(async()=>f.list({...owner,role:'administrator'}),/Forbidden/);
      await f.raw(pg?"UPDATE staff SET active=false WHERE id='maya'":"UPDATE staff SET active=0 WHERE id='maya'");
      await assert.rejects(async()=>f.list(owner),/Forbidden/);
    }finally {await f.close();}
  });
  test(`${name} source uploads retain exact original and canonical bytes, scoped receipt and one audit`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input();
    try {
      assert.deepEqual(await f.receipt(owner,value.requestId),{found:false,requestId:value.requestId});
      const accepted=await f.receive(owner,value,original,wav(),st);
      assert.equal(accepted.status,'received');assert.ok(accepted.receivedAt);assert.equal(accepted.briefingId,null);
      assert.equal(st.objects.size,2);assert.deepEqual(await f.audio(owner,value.requestId,st,'original'),original);assert.deepEqual(await f.audio(owner,value.requestId,st),wav());
      const duplicate=await f.receive(owner,value,original,wav(),st);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.receivedAt,accepted.receivedAt);assert.equal(st.saves,2);
      const receipt=await f.receipt(owner,value.requestId);assert.equal(receipt.requestHash,accepted.requestHash);
      assert.equal('sha256' in receipt,false);assert.equal('title' in receipt,false);assert.equal('original_id' in receipt,false);
      assert.equal((await f.raw("SELECT count(*) AS n FROM audit WHERE action='briefing.source_audio_received'")).rows[0].n,1);
      for(const patch of [{title:'Changed audio source'},{generationLanguages:['en']}])await assert.rejects(f.receive(owner,{...value,...patch},original,wav(),st),/conflict/);
      await assert.rejects(f.receive(owner,value,Buffer.from('Changed bytes'),wav(),st),/conflict/);
      for(const session of [{...owner,principal_type:'worker'},{...owner,role:'administrator'},{...owner,site_id:'harbor-yard'}])await assert.rejects(async()=>f.receipt(session,value.requestId),/Forbidden/);
      const other={...owner,principal_id:'rami',role:'supervisor'};assert.equal((await f.receipt(other,value.requestId)).found,false);
      await assert.rejects(f.receive(other,value,original,wav(),st),/conflict/);
      await assert.rejects(f.raw("UPDATE source_audio_requests SET original_type='audio/mp4'"),/immutable/);
      assert.equal((await f.raw('SELECT count(*) AS n FROM briefings')).rows[0].n,pg?0:2);
    }finally {await f.close();}
  });
  test(`${name} corrupt storage and failed acceptance do not issue receipts and exact recovery preserves object IDs`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input(),readOriginal=st.readOriginal;
    try {
      st.readOriginal=async()=>Buffer.from('corrupt');
      await assert.rejects(f.receive(owner,value,original,wav(),st),/could not be confirmed/);
      assert.equal((await f.receipt(owner,value.requestId)).receivedAt,null);
      const before=(await f.raw('SELECT id,original_id FROM source_audio_requests')).rows[0];
      st.readOriginal=readOriginal;f.fail();
      await assert.rejects(f.receive(owner,value,original,wav(),st),/could not be confirmed/);
      assert.equal((await f.receipt(owner,value.requestId)).status,'storing');assert.equal(st.objects.size,2);
      f.reset();assert.equal((await f.receive(owner,value,original,wav(),st)).status,'received');
      assert.deepEqual((await f.raw('SELECT id,original_id FROM source_audio_requests')).rows[0],before);
      assert.equal((await f.raw("SELECT count(*) AS n FROM audit WHERE action='briefing.source_audio_received'")).rows[0].n,1);
    }finally {await f.close();}
  });
  test(`${name} lost storage/SQL acknowledgements reconcile without deleting accepted source evidence`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input(),save=st.saveOriginal;
    try {
      st.saveOriginal=async(r,b)=>{await save(r,b);throw Error('Lost storage acknowledgement');};
      const journal={...f.journal,async accept(s,row){await f.journal.accept(s,row);throw Error('Lost SQL acknowledgement');}};
      const result=await receiveSourceAudioWithJournal(journal,owner,value,original,wav(),st);
      assert.equal(result.duplicate,true);assert.ok(result.receivedAt);assert.equal(st.objects.size,2);
      assert.equal((await f.raw("SELECT count(*) AS n FROM audit WHERE action='briefing.source_audio_received'")).rows[0].n,1);
    }finally {await f.close();}
  });
  test(`${name} upload leases and changed/revoked authority fence stale acceptance and protected downloads`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input();
    try {
      const content=sourceAudioInput(value,original,wav()),first=await f.journal.reserve(owner,content);
      await assert.rejects(f.receive(owner,value,original,wav(),st),/in progress/);
      await f.journal.release(first);const second=await f.journal.reserve(owner,content);
      assert.notEqual(first.lease_token,second.lease_token);await assert.rejects(async()=>f.journal.accept(owner,first),/lease expired/);
      await f.journal.release(second);
      const read=st.read;st.read=async r=>{const bytes=await read(r);await f.raw(pg?"UPDATE staff SET active=false WHERE id='maya'":"UPDATE staff SET active=0 WHERE id='maya'");return bytes;};
      await assert.rejects(f.receive(owner,value,original,wav(),st),/could not be confirmed/);
      assert.equal((await f.raw('SELECT received_at FROM source_audio_requests')).rows[0].received_at,null);
      await assert.rejects(async()=>f.receipt(owner,value.requestId),/Forbidden/);
    }finally {await f.close();}
  });
  test(`${name} source HTTP requires the exact staff session, origin and bounded envelope; private playback is no-store`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input();
    const config={tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020',
      ...(pg?{schema:f.options.schema,storage:st}:{audioRoot:st})};
    if(pg)await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'synthetic@example.test',password:'Synthetic-only-password-123'},f.options);
    const server=pg?createPostgresRehearsalServer(f.pool,config):createAppServer(f.db,config);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    try {
      const login=await fetch(base+('/auth/staff/login'),{method:'POST',headers:{origin:config.publicOrigin,'content-type':'application/json'},
        body:JSON.stringify(pg?{email:'synthetic@example.test',password:'Synthetic-only-password-123'}:principalLoginBody('maya'))});
      assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
      const session=await (await fetch(base+'/session',{headers:{cookie}})).json();
      const capturedHeaders={cookie,'x-client-session-context':session.clientContext};
      const metadata=Buffer.from(JSON.stringify(value)),prefix=Buffer.alloc(8);prefix.writeUInt32LE(metadata.length);prefix.writeUInt32LE(wav().length,4);
      const body=Buffer.concat([prefix,metadata,wav(),original]);
      const post=(headers={},payload=body)=>fetch(base+'/source-audio',{method:'POST',headers:{cookie,origin:config.publicOrigin,'content-type':'application/octet-stream',
        'x-client-session-context':session.clientContext,...headers},body:payload});
      assert.equal((await post({'x-client-session-context':''})).status,409);
      assert.equal((await post({'x-client-session-context':'0'.repeat(64)})).status,409);
      assert.equal((await post({origin:'https://foreign.example'})).status,403);
      assert.equal((await post({'content-type':'audio/wav'})).status,400);
      assert.equal((await post({},Buffer.alloc(8))).status,400);
      const accepted=await post();assert.equal(accepted.status,201);assert.match(accepted.headers.get('cache-control'),/no-store/);
      const receipt=await accepted.json();assert.equal(receipt.requestId,value.requestId);
      assert.equal((await post()).status,200);
      const lookup=await fetch(base+'/source-audio/'+value.requestId,{headers:capturedHeaders});assert.equal(lookup.status,200);assert.equal((await lookup.json()).receivedAt,receipt.receivedAt);
      const history=await fetch(base+'/source-audio?page=1',{headers:capturedHeaders});assert.equal(history.status,200);assert.match(history.headers.get('cache-control'),/no-store/);
      assert.deepEqual((await history.json()).items,[{...receipt,title:value.title}].map(({duplicate,...row})=>row));
      for(const query of ['page=1&page=2','page=0','site=foreign'])assert.equal((await fetch(base+'/source-audio?'+query,{headers:capturedHeaders})).status,400);
      assert.equal((await fetch(base+'/source-audio')).status,401);
      await f.process(undefined,st);
      const retryId=randomUUID(),retryUrl=base+`/source-audio/${value.requestId}/retries`,retryBody={requestId:retryId,sourceHash:receipt.requestHash,confirmed:true};
      const retry=(headers={},input=retryBody)=>fetch(retryUrl,{method:'POST',headers:{cookie,origin:config.publicOrigin,'content-type':'application/json',
        'x-client-session-context':session.clientContext,...headers},body:JSON.stringify(input)});
      assert.equal((await retry({'x-client-session-context':''})).status,409);
      assert.equal((await retry({origin:'https://foreign.example'})).status,403);
      assert.equal((await retry({}, {...retryBody,confirmed:false})).status,400);
      const changedLogin=await fetch(base+('/auth/staff/login'),{method:'POST',headers:{origin:config.publicOrigin,'content-type':'application/json'},body:JSON.stringify(pg?{email:'synthetic@example.test',password:'Synthetic-only-password-123'}:principalLoginBody('maya'))});
      assert.equal(changedLogin.status,200);const changedCookie=changedLogin.headers.get('set-cookie').split(';')[0];
      const snapshot=async()=>({sources:(await f.raw('SELECT * FROM source_audio_requests ORDER BY request_id')).rows,
        retries:pg || f.db.prepare("SELECT name FROM sqlite_master WHERE name='source_audio_retries'").get()?(await f.raw('SELECT * FROM source_audio_retries ORDER BY retry_id')).rows:null,
        audit:(await f.raw('SELECT * FROM audit ORDER BY id')).rows});
      const before=await snapshot();
      for(const context of [undefined,'invalid','b'.repeat(64)]) {
        const headers={cookie,...(context===undefined?{}:{'x-client-session-context':context})};
        for(const path of ['/source-audio',`/source-audio/${value.requestId}`,`/source-audio/${value.requestId}/retries/${retryId}`])assert.equal((await fetch(base+path,{headers})).status,409,path);
        assert.equal((await fetch(retryUrl,{method:'POST',headers:{...headers,origin:config.publicOrigin,'content-type':'application/json'},body:JSON.stringify(retryBody)})).status,409);
      }
      assert.equal((await fetch(retryUrl,{method:'POST',headers:{...capturedHeaders,cookie:changedCookie,origin:config.publicOrigin,'content-type':'application/json'},body:JSON.stringify(retryBody)})).status,409);
      assert.equal((await fetch(base+'/source-audio',{headers:{...capturedHeaders,cookie:changedCookie}})).status,409);
      assert.deepEqual(await snapshot(),before);
      const absent=await fetch(retryUrl+'/'+retryId,{headers:capturedHeaders});assert.equal(absent.status,200);assert.equal((await absent.json()).found,false);
      const queued=await retry();assert.equal(queued.status,200);assert.match(queued.headers.get('cache-control'),/no-store/);const retryReceipt=await queued.json();
      assert.equal(retryReceipt.retryId,retryId);assert.equal(retryReceipt.sourceRequestId,value.requestId);
      assert.deepEqual(await (await retry()).json(),retryReceipt);
      assert.deepEqual(await (await fetch(retryUrl+'/'+retryId,{headers:capturedHeaders})).json(),retryReceipt);
      assert.equal((await retry({}, {...retryBody,requestId:randomUUID()})).status,409);
      assert.equal((await fetch(retryUrl+'/'+retryId)).status,401);
      assert.equal((await fetch(retryUrl+'/'+retryId+'?site=foreign',{headers:capturedHeaders})).status,400);
      for(const kind of ['audio','original']) {
        const response=await fetch(base+`/source-audio/${value.requestId}/${kind}`,{headers:{cookie}});
        assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
        assert.deepEqual(Buffer.from(await response.arrayBuffer()),kind==='audio'?wav():original);
      }
      assert.equal((await fetch(base+'/source-audio/'+value.requestId)).status,401);
      assert.equal((await fetch(base+'/source-audio/'+value.requestId+'?site=foreign',{headers:capturedHeaders})).status,400);
      const read=st.read;st.read=async r=>{const bytes=await read(r);await f.raw(pg?"UPDATE staff SET active=false WHERE id='maya'":"UPDATE staff SET active=0 WHERE id='maya'");return bytes;};
      await assert.rejects(f.audio(owner,value.requestId,st),/Forbidden/);
    }finally {await new Promise(resolve=>server.close(resolve));await f.close();}
  });
  test(`${name} valid transcription atomically creates one language-bound draft and retains immutable source evidence`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input();let calls=0;
    try {
      const receipt=await f.receive(owner,value,original,wav(),st);
      const journal=f.processingJournal(),lost={...journal,async finish(row,content){await journal.finish(row,content);throw Error('Lost finish acknowledgement');}};
      const adapter={async transcribe(bytes,type){calls++;assert.deepEqual(bytes,wav());assert.equal(type,'audio/wav');return {text:CANONICAL_SOURCE};}};
      assert.equal(await processSourceAudioWithJournal(lost,adapter,st),true);
      assert.equal(await f.process(adapter,st),false);assert.equal(calls,1);
      const status=await f.receipt(owner,value.requestId);assert.equal(status.status,'transcribed');assert.equal(status.briefingId,value.requestId);assert.equal(status.receivedAt,receipt.receivedAt);
      const sql=pg?'SELECT source,state,revision FROM briefings WHERE id=$1':'SELECT source,state,revision FROM briefings WHERE id=?';
      assert.deepEqual({...((await f.raw(sql,[value.requestId])).rows[0])},{source:CANONICAL_SOURCE,state:'draft',revision:1});
      const creation=(await f.raw(pg?'SELECT generation_languages_json FROM draft_creations WHERE request_id=$1':'SELECT generation_languages_json FROM draft_creations WHERE request_id=?',[value.requestId])).rows[0];
      assert.deepEqual(pg?creation.generation_languages_json:JSON.parse(creation.generation_languages_json),['en','ar']);
      assert.equal((await f.raw("SELECT count(*) AS n FROM audit WHERE action='briefing.source_audio_transcribed'")).rows[0].n,1);
      assert.deepEqual(await f.audio(owner,value.requestId,st,'original'),original);
      assert.equal((await f.receive(owner,value,original,wav(),st)).briefingId,value.requestId);
    }finally {await f.close();}
  });
  test(`${name} missing provider is honestly blocked and invalid transcripts have bounded retries without draft creation`,async()=>{
    const f=await fixture(pg),st=memoryStore(),blocked=input(),invalid=input();
    try {
      await f.receive(owner,blocked,original,wav(),st);assert.equal(await f.process(undefined,st),true);
      assert.equal((await f.receipt(owner,blocked.requestId)).status,'blocked');assert.equal(await f.process(undefined,st),false);
      await f.receive(owner,invalid,original,wav(),st);let calls=0;
      const adapter={async transcribe(){calls++;return {text:'short'};}};
      for(let n=0;n<3;n++) {assert.equal(await f.process(adapter,st),true);await f.raw("UPDATE source_audio_requests SET retry_at='2000-01-01T00:00:00Z' WHERE status='received'");}
      assert.equal(calls,3);assert.equal((await f.receipt(owner,invalid.requestId)).status,'failed');assert.equal(await f.process(adapter,st),false);
      assert.equal((await f.raw('SELECT count(*) AS n FROM draft_creations')).rows[0].n,0);
    }finally {await f.close();}
  });
  test(`${name} transcription revalidates authority before provider use and before saving its result`,async()=>{
    for(const stage of ['before','read','result']) {
      const f=await fixture(pg),st=memoryStore(),value=input();let calls=0;
      try {
        await f.receive(owner,value,original,wav(),st);
        const change=()=>f.raw(pg?"UPDATE staff SET active=false WHERE id='maya'":"UPDATE staff SET active=0 WHERE id='maya'");
        if(stage==='before')await change();
        if(stage==='read'){const read=st.read;st.read=async r=>{const bytes=await read(r);await change();return bytes;};}
        await f.process({async transcribe(){calls++;if(stage==='result')await change();return {text:CANONICAL_SOURCE};}},st);
        assert.equal(calls,stage==='result'?1:0);
        assert.equal((await f.raw('SELECT status FROM source_audio_requests')).rows[0].status,'blocked');
        assert.equal((await f.raw('SELECT count(*) AS n FROM draft_creations')).rows[0].n,0);
      }finally {await f.close();}
    }
  });
  test(`${name} reclaimed transcription leases fence a late provider result`,async()=>{
    const f=await fixture(pg),st=memoryStore(),value=input();let started,release;
    const firstStarted=new Promise(resolve=>{started=resolve;}),firstResult=new Promise(resolve=>{release=resolve;});
    try {
      await f.receive(owner,value,original,wav(),st);
      const first=f.process({async transcribe(){started();return firstResult;}},st);await firstStarted;
      await f.raw("UPDATE source_audio_requests SET lease_until='2000-01-01T00:00:00Z' WHERE status='processing'");
      await f.process({async transcribe(){return {text:CANONICAL_SOURCE};}},st);
      release({text:'A stale different transcript that must not replace the newer source.'});await first;
      assert.equal((await f.receipt(owner,value.requestId)).status,'transcribed');
      assert.equal((await f.raw(pg?'SELECT source FROM briefings WHERE id=$1':'SELECT source FROM briefings WHERE id=?',[value.requestId])).rows[0].source,CANONICAL_SOURCE);
      assert.equal((await f.raw("SELECT count(*) AS n FROM audit WHERE action='briefing.created' AND object_id="+(pg?'$1':'?'),[value.requestId])).rows[0].n,1);
    }finally {release?.({text:CANONICAL_SOURCE});await f.close();}
  });
}

test('local private original storage is exclusive, bounded and does not interpret the original file as WAV',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-source-original-')),st=localAudioStore(root),value=sourceAudioInput(input(),original,wav());
  const reference={id:randomUUID(),org_id:'cedar',site_id:'beirut',sha256:value.originalSha256,bytes:original.length};
  try {
    await st.saveOriginal(reference,original);assert.deepEqual(await st.readOriginal(reference),original);
    await assert.rejects(st.saveOriginal(reference,original),/EEXIST/);assert.equal(await st.existsOriginal(reference),true);
    await assert.rejects(st.readOriginal({...reference,sha256:'0'.repeat(64)}),/integrity/);
    await assert.rejects(st.saveOriginal({...reference,id:'../outside'},original),/reference/);
    await st.removeOriginal(reference);assert.equal(await st.existsOriginal(reference),false);
  }finally {await rm(root,{recursive:true,force:true});}
});
test('R2 original objects use private exclusive octet-stream writes and bounded verified reads',async()=>{
  const commands=[],value=sourceAudioInput(input(),original,wav()),reference={id:randomUUID(),org_id:'cedar',site_id:'beirut',sha256:value.originalSha256,bytes:original.length};
  let response={ContentLength:original.length,Body:(async function*(){yield original;})()};
  const st=r2AudioStore({accountId:'a'.repeat(32),bucket:'test-private',accessKeyId:'synthetic',secretAccessKey:'synthetic'},
    {client:{async send(command){commands.push(command.input);return response;}}});
  await st.saveOriginal(reference,original);assert.equal(commands[0].IfNoneMatch,'*');assert.equal(commands[0].ContentType,'application/octet-stream');
  assert.equal(commands[0].CacheControl,'private, no-store');assert.ok(commands[0].Key.endsWith('.source-original'));
  assert.deepEqual(await st.readOriginal(reference),original);
  response={ContentLength:10485761,Body:(async function*(){yield original;})()};await assert.rejects(st.readOriginal(reference),/integrity/);
});

test('verified backup/restore and PostgreSQL import preserve source receipts and both private files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-source-backup-')),database=join(root,'source.sqlite'),audioRoot=join(root,'audio');
  const db=openDatabase(database);seed(db);ensureRecordingSchema(db);const value=input(),st=localAudioStore(audioRoot);
  let f;
  try {
    const accepted=await receiveSourceAudio(db,owner,value,original,wav(),st);
    const requestId=randomUUID();await sourceAudioJournal(db).reserve(owner,sourceAudioInput({...value,requestId},original,wav()));
    const backup=await backupLocal({database,audioRoot,destination:join(root,'backup')});assert.equal(backup.sourceAudioObjects,2);
    const verified=await verifyLocalBackup(join(root,'backup'));assert.equal(verified.sources.length,2);
    await restoreLocal({source:join(root,'backup'),destination:join(root,'restore')});
    const restored=openDatabase(join(root,'restore','understood.sqlite'));
    try {
      assert.equal(getSourceAudioReceipt(restored,owner,value.requestId).receivedAt,accepted.receivedAt);
      assert.deepEqual(await getSourceAudio(restored,owner,value.requestId,join(root,'restore','private-audio'),'original'),original);
      assert.equal(restored.prepare('SELECT lease_token FROM source_audio_requests WHERE request_id=?').get(requestId).lease_token,null);
    }finally {restored.close();}
    f=await fixture(true,{empty:true});
    await importSqliteBackup(f.pool,{source:join(root,'backup'),schema:f.options.schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false});
    assert.equal((await f.receipt(owner,value.requestId)).receivedAt,accepted.receivedAt);
    assert.equal((await f.receive(owner,value,original,wav(),st)).duplicate,true);
    assert.deepEqual(await f.audio(owner,value.requestId,st,'original'),original);
    await writeFile(join(root,'backup',verified.sources.find(row=>row.kind==='original').file),'corrupt synthetic bytes');
    await assert.rejects(verifyLocalBackup(join(root,'backup')),/integrity/);
  }finally {db.close();if(f)await f.close();await rm(root,{recursive:true,force:true});}
});

test('backup restore and PostgreSQL import preserve source cleanup tombstones without requiring removed files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-source-purge-backup-')),database=join(root,'source.sqlite'),audioRoot=join(root,'audio');
  const db=openDatabase(database);seed(db);const st=localAudioStore(audioRoot),value=input();let f;
  try {
    const accepted=await receiveSourceAudio(db,owner,value,original,wav(),st);
    await processOneSourceAudio(db,undefined,st);
    const retryInput={requestId:randomUUID(),sourceHash:accepted.requestHash,confirmed:true};
    const retryReceipt=retrySourceAudio(db,owner,value.requestId,retryInput);
    saveRetention(db,owner,{requestId:randomUUID(),revision:0,audioDays:7,confirmed:true});
    await processSourceAudioCleanup(sourceAudioCleanupJournal(db,{now:new Date(Date.now()+8*86400000).toISOString()}),st);
    const backup=await backupLocal({database,audioRoot,destination:join(root,'backup')});assert.equal(backup.sourceAudioObjects,0);
    assert.equal((await verifyLocalBackup(join(root,'backup'))).sources.length,0);
    await restoreLocal({source:join(root,'backup'),destination:join(root,'restore')});
    const restored=openDatabase(join(root,'restore','understood.sqlite'));
    try {const receipt=getSourceAudioReceipt(restored,owner,value.requestId);assert.equal(receipt.receivedAt,accepted.receivedAt);assert.equal(receipt.audioStatus,'removed');
      assert.deepEqual(getSourceRetryReceipt(restored,owner,value.requestId,retryInput.requestId),retryReceipt);
      await assert.rejects(getSourceAudio(restored,owner,value.requestId,join(root,'restore','private-audio')),/unavailable/);
    }finally {restored.close();}
    f=await fixture(true,{empty:true});await importSqliteBackup(f.pool,{source:join(root,'backup'),schema:f.options.schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false});
    const receipt=await f.receipt(owner,value.requestId);assert.equal(receipt.receivedAt,accepted.receivedAt);assert.equal(receipt.audioStatus,'removed');
    assert.deepEqual(await pgSourceRetryReceipt(f.pool,owner,value.requestId,retryInput.requestId,f.options),retryReceipt);
    await assert.rejects(f.receive(owner,value,original,wav(),st),/expired/);
    assert.equal((await f.raw("SELECT count(*) n FROM audit WHERE action='briefing.source_audio_purged'")).rows[0].n,1);
  }finally {db.close();if(f)await f.close();await rm(root,{recursive:true,force:true});}
});
