import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {requestHelp,resolveClarification} from '../server/postgres/clarifications.mjs';
import {queueCaseFollowup,followupReceipt,processOneCaseFollowup,getCaseFollowupAudio,processOneCaseFollowupPurge} from '../server/postgres/case-followups.mjs';
import {sendCaseMessage,listCaseMessages} from '../server/postgres/case-messages.mjs';
import {requestWorkerDeletion} from '../server/postgres/deletions.mjs';
import {processOneDeletionRedaction} from '../server/postgres/deletion-redactions.mjs';
import {processOneDeletionPseudonym} from '../server/postgres/deletion-pseudonyms.mjs';
import {processOneDeletionCompletion} from '../server/postgres/deletion-completions.mjs';
import {workerBriefings} from '../server/postgres/read-models.mjs';
import {resolveCaseFollowup} from '../server/ai/case-followup-config.mjs';
import {caseFollowupInputHash} from '../server/ai/case-followup-bundle.mjs';
import {GEMINI_MODELS} from '../server/ai/gemini.mjs';
import {encodeWav} from '../src/audio.ts';
import {listCaseTimeline} from '../server/postgres/case-timeline.mjs';

const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-14',org_id:'cedar',site_id:'beirut'};
const wav=()=>Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(0.2)}));
async function fixture() {
  const db=new PGlite(),pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  await runMigrations(pool);
  await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic');INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('other','cedar','beirut','Other','supervisor');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-14','cedar','beirut','Worker 014','ar'),('worker-2','cedar','beirut','Worker 002','en');
    INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('shelf','cedar','beirut','Synthetic','Synthetic','draft');
    INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('shelf-v3','cedar','beirut','shelf',3,'{"languages":{"ar":{"title":"Synthetic Arabic"}}}','published');
    INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment-14','cedar','beirut','shelf-v3','worker-14','ar');`);
  const caseId=randomUUID();await requestHelp(pool,worker,'assignment-14',{requestId:caseId,text:'Synthetic Arabic help'});
  const calls=[],objects=new Map();
  const adapter={provenance:{adapter:'synthetic-test',dataClass:'synthetic',textModel:'fixture-text',speechModel:'fixture-speech',voice:'fixture',promptVersion:'v1',schemaVersion:'v1'},
    capabilities:{textLanguages:['en','ar','ur'],speechLanguages:['en','ar']},prepare(){},checkPreparation(){},
    async translate(){calls.push('translate');return {title:'متابعة',text:'أين ستضع العناصر غير المكتملة؟',question:'يرجى الرد بكلماتك الخاصة.'};},
    async checkTranslation(){calls.push('check');return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};},
    async speech(text,language){calls.push(['speech',text,language]);return wav();}};
  const storage={async save(row,bytes){if(objects.has(row.id))throw Error('Already stored');objects.set(row.id,Buffer.from(bytes));},
    async read(row){const bytes=objects.get(row.id);if(!bytes)throw Error('Unavailable');return Buffer.from(bytes);},
    async remove(row){objects.delete(row.id);},async exists(row){return objects.has(row.id);}};
  const options={adapter,dataClass:'synthetic'},input={requestId:randomUUID(),text:'Please explain where unfinished items go.'};
  return {db,pool,caseId,calls,adapter,storage,objects,options,input,
    queue:()=>queueCaseFollowup(pool,owner,caseId,input,options),
    process:()=>processOneCaseFollowup(pool,adapter,storage,{dataClass:'synthetic'}),close:()=>db.close()};
}

test('queued follow-up freezes scope and exact command, delivers checked translation and private speech once without reassessment',async()=>{
  const f=await fixture();try{
    const before=JSON.stringify((await f.db.query('SELECT * FROM attempts')).rows);
    const queued=await f.queue();assert.equal(queued.status,'queued');assert.deepEqual(await f.queue(),queued);
    assert.equal((await listCaseMessages(f.pool,worker,f.caseId)).total,0);
    assert.equal((await workerBriefings(f.pool,worker,{schema:'public'},{view:'followup'})).total,0);
    await assert.rejects(queueCaseFollowup(f.pool,owner,f.caseId,{...f.input,text:'Changed'},f.options),/conflict/);
    await assert.rejects(sendCaseMessage(f.pool,owner,f.caseId,f.input),/conflict/);
    await assert.rejects(followupReceipt(f.pool,{...owner,principal_id:'other',role:'supervisor'},f.caseId,f.input.requestId),/unavailable/);
    assert.equal(await f.process(),true);assert.equal(await f.process(),false);
    const receipt=await followupReceipt(f.pool,owner,f.caseId,f.input.requestId);assert.equal(receipt.status,'delivered');assert.ok(receipt.deliveredAt);
    const timeline=await listCaseTimeline(f.pool,owner,f.caseId);
    assert.equal(timeline.items.filter(row=>row.kind==='followup_queued').length,1);assert.equal(timeline.items.filter(row=>row.kind==='followup_delivered').length,1);
    assert.equal(timeline.items.filter(row=>row.kind==='message_received').length,0);
    assert.equal(timeline.items.find(row=>row.kind==='followup_delivered').occurredAt,receipt.deliveredAt);
    assert.equal(JSON.stringify(timeline).includes(f.input.text),false);
    assert.deepEqual(await f.queue(),receipt);
    const thread=await listCaseMessages(f.pool,worker,f.caseId);assert.equal(thread.total,1);assert.match(thread.items[0].text,/العناصر/);assert.match(thread.items[0].audioUrl,/\/audio$/);
    assert.deepEqual(f.calls,['translate','check',['speech',thread.items[0].text,'ar']]);
    assert.deepEqual(await getCaseFollowupAudio(f.pool,worker,f.caseId,f.input.requestId,f.storage),wav());
    await assert.rejects(getCaseFollowupAudio(f.pool,{...worker,principal_id:'worker-2'},f.caseId,f.input.requestId,f.storage),/unavailable/);
    assert.equal((await workerBriefings(f.pool,worker,{schema:'public'},{view:'followup'})).total,1);
    assert.equal(JSON.stringify((await f.db.query('SELECT * FROM attempts')).rows),before);
    assert.equal((await f.db.query("SELECT count(*)::int n FROM audit WHERE action='clarification.message'")).rows[0].n,1);
    await assert.rejects(f.db.exec("UPDATE case_followups SET source_text='Changed'"),/immutable/);
    await assert.rejects(f.db.exec('DELETE FROM case_followups'),/immutable/);
    await assert.rejects(f.db.exec("UPDATE case_followups SET manifest_json='{}'"),/immutable/);
    await assert.rejects(f.db.exec("UPDATE case_followup_audio SET state='storing'"),/immutable/);
    await resolveClarification(f.pool,owner,f.caseId,{notes:'Synthetic resolution'});
    assert.deepEqual(await f.queue(),receipt);assert.equal((await workerBriefings(f.pool,worker,{schema:'public'},{view:'followup'})).total,0);
    assert.deepEqual(await getCaseFollowupAudio(f.pool,worker,f.caseId,f.input.requestId,f.storage),wav());
  }finally{await f.close();}
});
test('real data, unsupported language, foreign scope and worker requests cannot queue generation',async()=>{
  const f=await fixture();try{
    await assert.rejects(queueCaseFollowup(f.pool,owner,f.caseId,f.input,{...f.options,dataClass:'real'}),/unavailable/);
    await assert.rejects(queueCaseFollowup(f.pool,worker,f.caseId,f.input,f.options),/Forbidden/);
    await assert.rejects(queueCaseFollowup(f.pool,{...owner,site_id:'foreign'},f.caseId,f.input,f.options),/Forbidden|unavailable/);
    f.adapter.capabilities.speechLanguages=['en'];await assert.rejects(f.queue(),/language unavailable/);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM case_followups')).rows[0].n,0);assert.deepEqual(f.calls,[]);
  }finally{await f.close();}
});
test('lost private-save acknowledgement is read back, but revoked authority during storage prevents delivery',async()=>{
  const f=await fixture();try{
    const save=f.storage.save;f.storage.save=async(...args)=>{await save(...args);throw Error('Synthetic lost acknowledgement');};
    await f.queue();await f.process();assert.equal((await followupReceipt(f.pool,owner,f.caseId,f.input.requestId)).status,'delivered');
    const read=f.storage.read;f.storage.read=async(...args)=>{const bytes=await read(...args);await f.db.exec("UPDATE workers SET active=false WHERE id='worker-14'");return bytes;};
    await assert.rejects(getCaseFollowupAudio(f.pool,worker,f.caseId,f.input.requestId,f.storage),/Forbidden/);
  }finally{await f.close();}
  const g=await fixture();try{
    const read=g.storage.read;g.storage.read=async(...args)=>{const bytes=await read(...args);await g.db.exec("UPDATE staff SET active=false WHERE id='maya'");return bytes;};
    await g.queue();await g.process();assert.equal((await g.db.query('SELECT status FROM case_followups')).rows[0].status,'failed');
    assert.equal((await g.db.query('SELECT count(*)::int n FROM case_messages')).rows[0].n,0);
    assert.equal(await processOneCaseFollowupPurge(g.pool,g.storage),true);assert.equal(g.objects.size,0);
  }finally{await g.close();}
});
test('translation check failure never synthesizes speech and audit failure never exposes a partially delivered message',async()=>{
  const f=await fixture();try{
    f.adapter.checkTranslation=async()=>({faithful:false,complete:true,languageCorrect:true,terminologyApplied:true,reasons:['incomplete_translation']});
    await f.queue();await f.process();assert.equal((await followupReceipt(f.pool,owner,f.caseId,f.input.requestId)).errorCode,'translation_check_failed');
    assert.deepEqual(f.calls,['translate']);assert.equal(f.objects.size,0);
  }finally{await f.close();}
  const g=await fixture();try{
    await g.db.exec("CREATE FUNCTION deny_followup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='clarification.message' THEN RAISE EXCEPTION 'private diagnostic'; END IF; RETURN NEW; END $$;CREATE TRIGGER deny_followup_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION deny_followup_audit()");
    await g.queue();await g.process();const receipt=await followupReceipt(g.pool,owner,g.caseId,g.input.requestId);assert.equal(receipt.status,'failed');assert.equal(JSON.stringify(receipt).includes('private diagnostic'),false);
    assert.equal((await listCaseMessages(g.pool,worker,g.caseId)).total,0);assert.equal(await processOneCaseFollowupPurge(g.pool,g.storage),true);assert.equal(g.objects.size,0);
  }finally{await g.close();}
});
test('worker deletion waits for private follow-up cleanup then redacts generation source, manifests and conversation',async()=>{
  const f=await fixture();try{
    await f.queue();await f.process();assert.equal(f.objects.size,1);
    await requestWorkerDeletion(f.pool,owner,'worker-14',{requestId:randomUUID(),expectedCode:'Worker 014',reason:'worker_request',confirmed:true});
    assert.equal(await processOneDeletionRedaction(f.pool),false);
    await assert.rejects(getCaseFollowupAudio(f.pool,owner,f.caseId,f.input.requestId,f.storage),/unavailable/);
    assert.equal(await processOneCaseFollowupPurge(f.pool,f.storage),true);assert.equal(f.objects.size,0);
    assert.equal(await processOneDeletionRedaction(f.pool),true);
    const row=(await f.db.query('SELECT * FROM case_followups')).rows[0];assert.equal(row.source_text,'[Deleted]');assert.deepEqual(row.glossary_json,{});assert.equal(row.manifest_json,null);assert.equal(row.lease_token,null);
    assert.equal((await f.db.query('SELECT text FROM case_messages')).rows[0].text,'[Deleted]');
    await assert.rejects(f.db.exec("UPDATE case_followups SET source_text='Restored'"),/immutable/);
    assert.equal(await processOneCaseFollowupPurge(f.pool,f.storage),false);
    assert.equal(await processOneDeletionPseudonym(f.pool),true);
    const id=(await f.db.query('SELECT id FROM case_followup_audio')).rows[0].id;
    f.objects.set(id,wav());assert.equal(await processOneDeletionCompletion(f.pool,f.storage),false);
    f.objects.delete(id);assert.equal(await processOneDeletionCompletion(f.pool,f.storage),true);
  }finally{await f.close();}
});
test('operator pause fences provider calls and stale leases cannot deliver',async()=>{
  const f=await fixture();try{
    await f.queue();await f.db.exec("INSERT INTO system_controls(id,jobs_paused,provider_paused,revision) VALUES('global',false,true,1)");
    assert.equal(await f.process(),false);assert.deepEqual(f.calls,[]);
    await f.db.exec("UPDATE system_controls SET provider_paused=false WHERE id='global'");
    const translate=f.adapter.translate;f.adapter.translate=async(...args)=>{const value=await translate(...args);await f.db.exec("UPDATE case_followups SET lease_until=clock_timestamp()-interval '1 second'");return value;};
    await f.process();assert.deepEqual(f.calls,['translate']);assert.equal((await f.db.query('SELECT count(*)::int n FROM case_messages')).rows[0].n,0);
    assert.equal(f.objects.size,0);
  }finally{await f.close();}
});
test('follow-up configuration is explicit, disabled by default and synthetic-only',async()=>{
  assert.equal(resolveCaseFollowup({}),null);
  for(const env of [{UNDERSTOOD_CASE_FOLLOWUP_ADAPTER:'other'}, {UNDERSTOOD_CASE_FOLLOWUP_ADAPTER:'gemini',UNDERSTOOD_DATA_CLASS:'real',GEMINI_API_KEY:'synthetic-key'}])assert.throws(()=>resolveCaseFollowup(env),/Invalid/);
  const adapter=resolveCaseFollowup({UNDERSTOOD_CASE_FOLLOWUP_ADAPTER:'gemini',UNDERSTOOD_DATA_CLASS:'synthetic',GEMINI_API_KEY:'synthetic-key'},{fetchImpl:async()=>{throw Error('Never called');}});
  assert.equal(typeof adapter.withJournal,'function');assert.deepEqual(adapter.capabilities.speechLanguages,(await import('../server/languages.mjs')).WORKER_LANGUAGE_CODES);
});
test('Gemini follow-up dispatch requires persisted quotas and journals exactly three mocked requests',async()=>{
  const f=await fixture();let calls=0;try{
    const outputs=[{title:'متابعة',text:'أين ستضع العناصر غير المكتملة؟',question:'يرجى الرد بكلماتك الخاصة.'},
      {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]}];
    const live=resolveCaseFollowup({UNDERSTOOD_CASE_FOLLOWUP_ADAPTER:'gemini',UNDERSTOOD_DATA_CLASS:'synthetic',GEMINI_API_KEY:'synthetic-key'},
      {fetchImpl:async(_url,options)=>{
        assert.equal(options.headers['x-goog-api-key'],'synthetic-key');
        const index=calls++;
        if(index===2)return Response.json({status:'completed',model:GEMINI_MODELS.speech,steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:wav().toString('base64')}]}]});
        const part={text:JSON.stringify(outputs[index])};
        return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[part]}}]}),{status:200});
      }});
    Object.assign(f.adapter,live);await f.queue();await f.process();assert.equal(calls,0);
    assert.equal((await followupReceipt(f.pool,owner,f.caseId,f.input.requestId)).status,'failed');
    await f.db.exec("INSERT INTO provider_policies(scope_key,org_id,revision,enabled,max_daily_requests) VALUES('global',NULL,1,true,3),('tenant:cedar','cedar',1,true,3)");
    f.input.requestId=randomUUID();await f.queue();await f.process();assert.equal(calls,3);
    assert.equal((await followupReceipt(f.pool,owner,f.caseId,f.input.requestId)).status,'delivered');
    assert.equal((await f.db.query("SELECT count(*)::int n FROM provider_requests WHERE state='accepted'")).rows[0].n,3);
    const operation=(await f.db.query('SELECT * FROM provider_operations')).rows[0];assert.equal(operation.kind,'case-followup');assert.equal(operation.reserved_requests,3);
    const completed=(await f.db.query('SELECT * FROM case_followups WHERE id=$1',[f.input.requestId])).rows[0];
    assert.equal(completed.provider_operation_id,operation.id);assert.equal(completed.provider_input_hash,operation.input_hash);
    assert.equal(operation.input_hash,caseFollowupInputHash(completed,live.provenance));
    assert.deepEqual(operation.provenance_json,live.provenance);assert.equal(operation.model,GEMINI_MODELS.text);
    await assert.rejects(f.db.query('UPDATE case_followups SET provider_operation_id=NULL,provider_input_hash=NULL WHERE id=$1',[completed.id]),/immutable/);
    await assert.rejects(f.db.query('UPDATE case_followups SET provider_input_hash=$2 WHERE id=$1',[completed.id,'0'.repeat(64)]),/immutable/);
    await assert.rejects(f.db.query('UPDATE provider_operations SET input_hash=$2 WHERE id=$1',[operation.id,'0'.repeat(64)]),/immutable/);
    f.input.requestId=randomUUID();await f.queue();await f.process();assert.equal(calls,3);
    assert.equal((await followupReceipt(f.pool,owner,f.caseId,f.input.requestId)).status,'failed');
    await requestWorkerDeletion(f.pool,owner,'worker-14',{requestId:randomUUID(),expectedCode:'Worker 014',reason:'worker_request',confirmed:true});
    assert.equal(await processOneCaseFollowupPurge(f.pool,f.storage),true);assert.equal(await processOneDeletionRedaction(f.pool),true);
    const redacted=(await f.db.query('SELECT * FROM case_followups WHERE id=$1',[completed.id])).rows[0];
    assert.equal(redacted.manifest_json,null);assert.equal(redacted.source_text,'[Deleted]');
    assert.equal(redacted.provider_operation_id,operation.id);assert.equal(redacted.provider_input_hash,operation.input_hash);
  }finally{await f.close();}
});

test('English metered follow-up links one accepted speech operation, with exact replay and no translation requests',async()=>{
  const f=await fixture();let calls=0;try{
    await f.db.exec("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment-2','cedar','beirut','shelf-v3','worker-2','en');INSERT INTO provider_policies(scope_key,org_id,revision,enabled,max_daily_requests) VALUES('global',NULL,1,true,1),('tenant:cedar','cedar',1,true,1)");
    const person={...worker,principal_id:'worker-2'},caseId=randomUUID();
    await requestHelp(f.pool,person,'assignment-2',{requestId:caseId,text:'Synthetic English help'});
    const adapter=resolveCaseFollowup({UNDERSTOOD_CASE_FOLLOWUP_ADAPTER:'gemini',UNDERSTOOD_DATA_CLASS:'synthetic',GEMINI_API_KEY:'synthetic-key'},
      {fetchImpl:async(url,options)=>{
        calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');assert.equal(JSON.parse(options.body).model,GEMINI_MODELS.speech);assert.match(options.body,/Please explain where unfinished items go/);
        return Response.json({status:'completed',model:GEMINI_MODELS.speech,steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:wav().toString('base64')}]}]});
      }});
    const options={adapter,dataClass:'synthetic'},input={requestId:randomUUID(),text:f.input.text};
    await queueCaseFollowup(f.pool,owner,caseId,input,options);
    assert.equal(await processOneCaseFollowup(f.pool,adapter,f.storage,options),true);assert.equal(calls,1);
    const row=(await f.db.query('SELECT * FROM case_followups WHERE id=$1',[input.requestId])).rows[0];
    const operation=(await f.db.query('SELECT * FROM provider_operations WHERE id=$1',[row.provider_operation_id])).rows[0];
    assert.equal(row.status,'delivered');assert.equal(operation.model,GEMINI_MODELS.speech);assert.equal(operation.reserved_requests,1);
    assert.equal(operation.input_hash,caseFollowupInputHash(row,adapter.provenance));assert.equal(row.manifest_json.checks.translation,'not_required');
    assert.equal((await queueCaseFollowup(f.pool,owner,caseId,input,options)).status,'delivered');
    assert.equal(await processOneCaseFollowup(f.pool,adapter,f.storage,options),false);assert.equal(calls,1);
    await f.queue();
    await assert.rejects(f.db.query('UPDATE case_followups SET provider_operation_id=$2,provider_input_hash=$3 WHERE id=$1',[f.input.requestId,operation.id,operation.input_hash]),/unavailable|scope|foreign key/);
  }finally{await f.close();}
});
