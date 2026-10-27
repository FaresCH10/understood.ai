import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {receiveCaseVoice,caseVoiceReceipt,getCaseVoiceAudio,processOneCaseVoicePurge} from '../server/postgres/case-voice.mjs';
import {listCaseMessages} from '../server/postgres/case-messages.mjs';
import {resolveClarification} from '../server/postgres/clarifications.mjs';
import {requestWorkerDeletion} from '../server/postgres/deletions.mjs';
import {processOneDeletionRedaction} from '../server/postgres/deletion-redactions.mjs';
import {processOneDeletionPseudonym} from '../server/postgres/deletion-pseudonyms.mjs';
import {processOneDeletionCompletion} from '../server/postgres/deletion-completions.mjs';
import {encodeWav} from '../src/audio.ts';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {issueWorkerGrant,redeemWorkerGrant,provisionStaffCredential} from '../server/postgres/auth.mjs';
import {createHash} from 'node:crypto';
import {checkedVoiceHttpReceipt,requestCaseVoice} from '../src/case-voice-request.ts';

const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-14',org_id:'cedar',site_id:'beirut'};
const wav=(value=0.2)=>Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(value)}));
async function fixture(schema='public') {
  const db=new PGlite(),pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  if(schema!=='public')await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);
  await runMigrations(pool,{schema});
  await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic');INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('audit','cedar','beirut','Audit','auditor');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-14','cedar','beirut','Worker 014','ar'),('worker-2','cedar','beirut','Worker 002','en');
    INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('shelf','cedar','beirut','Synthetic','Synthetic','draft');
    INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('shelf-v3','cedar','beirut','shelf',3,'{"languages":{"ar":{"title":"Synthetic Arabic"}}}','published');
    INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language,due_at) VALUES('assignment-14','cedar','beirut','shelf-v3','worker-14','ar',clock_timestamp()-interval '1 day');`);
  const objects=new Map(),storage={async save(row,bytes){objects.set(row.id,Buffer.from(bytes));},async read(row){if(!objects.has(row.id))throw Error('Unavailable');return Buffer.from(objects.get(row.id));},
    async remove(row){objects.delete(row.id);},async exists(row){return objects.has(row.id);}};
  const requestId=randomUUID(),help=()=>receiveCaseVoice(pool,worker,'assignment-14','help',requestId,requestId,wav(),storage);
  return {db,pool,storage,objects,requestId,help,close:()=>db.close()};
}

test('voice help accepts after answer deadline, is exact and private, and creates no answer or assessment',async()=>{
  const f=await fixture();try {
    const accepted=await f.help();assert.equal(accepted.status,'received');assert.equal(accepted.caseId,f.requestId);assert.deepEqual(await f.help(),accepted);
    assert.deepEqual(await caseVoiceReceipt(f.pool,worker,'assignment-14','help',f.requestId,f.requestId),accepted);
    const thread=await listCaseMessages(f.pool,worker,f.requestId);assert.equal(thread.total,1);assert.equal(thread.items[0].kind,'voice');assert.equal(thread.items[0].text,'رسالة صوتية');assert.match(thread.items[0].audioUrl,/\/voice$/);
    assert.deepEqual(await getCaseVoiceAudio(f.pool,owner,f.requestId,f.requestId,f.storage),wav());assert.deepEqual(await getCaseVoiceAudio(f.pool,worker,f.requestId,f.requestId,f.storage),wav());
    for(const table of ['attempts','submission_receipts','recordings','assessment_jobs'])assert.equal((await f.db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM clarifications')).rows[0].n,1);assert.equal(f.objects.size,1);
    await assert.rejects(receiveCaseVoice(f.pool,worker,'assignment-14','help',f.requestId,f.requestId,wav(0.3),f.storage),/conflict/);
    await assert.rejects(f.db.exec("UPDATE case_voice SET sha256=repeat('a',64)"),/immutable/);await assert.rejects(f.db.exec('DELETE FROM case_voice'),/immutable/);
    for(const principal of [{...worker,principal_id:'worker-2'},{...worker,site_id:'foreign'},{...owner,principal_id:'audit',role:'auditor'}])await assert.rejects(getCaseVoiceAudio(f.pool,principal,f.requestId,f.requestId,f.storage),/Forbidden|unavailable/);
    await assert.rejects(receiveCaseVoice(f.pool,owner,'assignment-14','help',randomUUID(),randomUUID(),wav(),f.storage),/Invalid|Forbidden/);
  }finally{await f.close();}
});

test('voice HTTP requires the page context, accepts WAV only and serves private scoped audio and recoverable receipts',async()=>{
  const schema='understood_test_voice_http',f=await fixture(schema),options={schema},origin='http://127.0.0.1:3020';let server;
  try {
    await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'voice@example.test',password:'Synthetic-voice-password-123'},options);
    const grant=await issueWorkerGrant(f.pool,owner,'worker-14',30,options),session=await redeemWorkerGrant(f.pool,grant.token,options);
    const cookie=`understood_pg_rehearsal=${session.token}`;
    server=createPostgresRehearsalServer(f.pool,{schema,storage:f.storage,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    const identity=await (await fetch(`${base}/session`,{headers:{cookie}})).json(),context=identity.clientContext;
    const request=(path,bytes,headers={})=>fetch(base+path,{method:bytes?'POST':'GET',headers:{origin,cookie,...(bytes?{'content-type':'audio/wav','x-client-session-context':context}:{}),...headers},...(bytes?{body:bytes}:{})});
    const path=`/worker/briefings/assignment-14/help-audio/${f.requestId}`;
    assert.equal((await request(path,wav(),{'x-client-session-context':''})).status,409);
    assert.equal((await request(path,wav(),{'content-type':'audio/webm'})).status,400);
    const first=await request(path,wav());assert.equal(first.status,200);const receipt=await first.json();assert.equal(receipt.status,'received');
    const pending={id:f.requestId,hash:createHash('sha256').update(wav()).digest('hex')};
    assert.equal(checkedVoiceHttpReceipt(receipt,{kind:'help',id:'assignment-14'},pending,context).status,'received');
    assert.deepEqual(await (await request(path)).json(),receipt);assert.deepEqual(await (await request(path,wav())).json(),receipt);
    const thread=await (await request(`/clarifications/${f.requestId}/messages`)).json();assert.equal(thread.canVoice,true);
    const audio=await request(thread.items[0].audioUrl.replace(/^\/api/,''));assert.equal(audio.status,200);assert.equal(audio.headers.get('content-type'),'audio/wav');assert.match(audio.headers.get('cache-control'),/private, no-store/);assert.deepEqual(Buffer.from(await audio.arrayBuffer()),wav());
    const id=randomUUID(),replyPath=`/clarifications/${f.requestId}/voice/${id}`;assert.equal((await request(replyPath,wav(),{'x-client-session-context':''})).status,409);
    const voiceTransport=(path,init)=>fetch(base.replace(/\/api$/,'')+path,{...init,headers:{...init.headers,origin,cookie}});
    const scope={kind:'reply',id:f.requestId,assignmentId:'assignment-14'},retained={...pending,id};
    const accepted=await requestCaseVoice(voiceTransport,identity,scope,retained,{kind:'send',bytes:wav()},new AbortController().signal,()=>true);
    assert.equal(accepted.status,'received');assert.deepEqual(await requestCaseVoice(voiceTransport,identity,scope,retained,{kind:'receipt'},new AbortController().signal,()=>true),accepted);
    assert.equal((await request(`${path}?unexpected=1`)).status,400);
    const anonymous=await fetch(`${base}/clarifications/${f.requestId}/messages/${f.requestId}/voice`);assert.equal(anonymous.status,401);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM submission_receipts')).rows[0].n,0);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close();}
});

test('voice reply stays in the same conversation, cannot send after resolution, and exact historical receipt survives closure',async()=>{
  const f=await fixture();try {
    await f.help();const id=randomUUID();const reply=()=>receiveCaseVoice(f.pool,worker,'assignment-14','reply',f.requestId,id,wav(),f.storage);
    const accepted=await reply();assert.equal((await listCaseMessages(f.pool,worker,f.requestId)).total,2);
    await resolveClarification(f.pool,owner,f.requestId,{notes:'Synthetic human resolution'});assert.deepEqual(await reply(),accepted);
    await assert.rejects(receiveCaseVoice(f.pool,worker,'assignment-14','reply',f.requestId,randomUUID(),wav(),f.storage),/closed/);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM clarifications')).rows[0].n,1);assert.equal((await f.db.query('SELECT count(*)::int n FROM attempts')).rows[0].n,0);
  }finally{await f.close();}
});

test('failed readback or acceptance audit never produces a receipt; failed private objects are purged',async()=>{
  const f=await fixture();try {
    f.storage.read=async()=>wav(0.3);await assert.rejects(f.help(),/not received/);
    assert.equal((await caseVoiceReceipt(f.pool,worker,'assignment-14','help',f.requestId,f.requestId)).status,'failed');
    assert.equal((await f.db.query('SELECT count(*)::int n FROM case_messages')).rows[0].n,0);assert.equal(await processOneCaseVoicePurge(f.pool,f.storage),true);assert.equal(f.objects.size,0);
    f.storage.read=async row=>Buffer.from(f.objects.get(row.id));
    await f.db.exec("CREATE FUNCTION deny_voice_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='help.voice_received' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER deny_voice_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION deny_voice_audit()");
    const id=randomUUID();await assert.rejects(receiveCaseVoice(f.pool,worker,'assignment-14','help',id,id,wav(),f.storage),/not received/);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM clarifications')).rows[0].n,0);assert.equal(await processOneCaseVoicePurge(f.pool,f.storage),true);assert.equal(f.objects.size,0);
  }finally{await f.close();}
});

test('revocation during storage fences acceptance and cleanup checks absence instead of trusting delete acknowledgement',async()=>{
  const f=await fixture();try {
    const save=f.storage.save;f.storage.save=async(row,bytes)=>{await save(row,bytes);await f.db.exec("UPDATE workers SET active=false WHERE id='worker-14'");};
    await assert.rejects(f.help(),/not received/);assert.equal((await f.db.query('SELECT count(*)::int n FROM case_messages')).rows[0].n,0);
    f.storage.remove=async()=>{};await processOneCaseVoicePurge(f.pool,f.storage);assert.equal((await f.db.query('SELECT cleanup_state FROM case_voice')).rows[0].cleanup_state,'cleaning');
    f.storage.remove=async row=>f.objects.delete(row.id);await f.db.exec("UPDATE case_voice SET cleanup_until=clock_timestamp()-interval '1 second'");
    assert.equal(await processOneCaseVoicePurge(f.pool,f.storage),true);assert.equal(f.objects.size,0);
  }finally{await f.close();}
});

test('deletion waits for voice purge and proves object absence, while cleaned journals recheck late objects',async()=>{
  const f=await fixture();try {
    await f.help();await requestWorkerDeletion(f.pool,owner,'worker-14',{requestId:randomUUID(),expectedCode:'Worker 014',reason:'worker_request',confirmed:true});
    assert.equal(await processOneDeletionRedaction(f.pool),false);await assert.rejects(getCaseVoiceAudio(f.pool,owner,f.requestId,f.requestId,f.storage),/unavailable/);
    await processOneCaseVoicePurge(f.pool,f.storage);assert.equal(await processOneDeletionRedaction(f.pool),true);await processOneDeletionPseudonym(f.pool);
    const row=(await f.db.query('SELECT * FROM case_voice')).rows[0];f.objects.set(row.id,wav());assert.equal(await processOneDeletionCompletion(f.pool,f.storage),false);
    await f.db.exec("UPDATE case_voice SET cleanup_checked_at=clock_timestamp()-interval '2 hours'");await processOneCaseVoicePurge(f.pool,f.storage);
    assert.equal(f.objects.size,0);assert.equal(await processOneDeletionCompletion(f.pool,f.storage),true);
    assert.equal((await f.db.query('SELECT text FROM case_messages')).rows[0].text,'[Deleted]');
  }finally{await f.close();}
});

test('voice help and replies accept every registered worker locale without null labels',async()=>{
  const f=await fixture();try{
    const {WORKER_LANGUAGE_CODES}=await import('../server/languages.mjs');
    for(const language of WORKER_LANGUAGE_CODES){
      const id=`locale-${language}`,assignment=`assignment-${language}`;
      await f.db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES($1,'cedar','beirut',$1,$2)",[id,language]);
      await f.db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES($1,'cedar','beirut','shelf-v3',$2,$3)",[assignment,id,language]);
      const session={...worker,principal_id:id},request=randomUUID();
      const help=await receiveCaseVoice(f.pool,session,assignment,'help',request,request,wav(),f.storage);
      assert.equal(help.status,'received',language);
      await receiveCaseVoice(f.pool,session,assignment,'reply',help.caseId,randomUUID(),wav(),f.storage);
      const messages=await listCaseMessages(f.pool,session,help.caseId);
      assert.equal(messages.total,2);assert.ok(messages.items.every(message=>message.text?.trim()&&message.language===language),language);
    }
  }finally{await f.close();}
});
