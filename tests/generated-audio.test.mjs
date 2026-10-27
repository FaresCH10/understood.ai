import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {stagePreparedBundle,expireGeneratedBundle,attachPreparedBundle,getAssignmentSpeech,getStaffArtifactSpeech} from '../server/postgres/generated-audio.mjs';
import {publish} from '../server/postgres/domain.mjs';
import {createDraft,editDraft,processOnePreparation,queuePreparation} from '../server/postgres/preparation.mjs';
import {saveDraftReview,draftReviewReceipt} from '../server/postgres/draft-review.mjs';
import {regenerateDraftTarget,regenerationReceipt} from '../server/postgres/regeneration.mjs';
import {regenerationInput} from '../server/regeneration-input.mjs';
import {workerBriefing,getBriefing} from '../server/postgres/read-models.mjs';
import {rehearsalTasks} from '../server/postgres/runtime.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {issueWorkerGrant,redeemWorkerGrant,provisionStaffCredential,authenticateStaff} from '../server/postgres/auth.mjs';
import {prepareLanguageBundle,preparedAudioReferences,checkedPreparedBundle,bundleHash} from '../server/ai/prepared-bundle.mjs';
import {localAudioStore} from '../server/private-storage.mjs';
import {encodeWav} from '../src/audio.ts';
import {getSettings,updateSettings} from '../server/postgres/settings.mjs';
import {getGeneratedRetention,saveGeneratedRetention,generatedRetentionReceipt,retireOneGeneratedBundle} from '../server/postgres/generated-retention.mjs';

const options={schema:'understood_test_generated'};
const source='Finished items go on blue. Unfinished items go on yellow.';
const facts=['Finished items go on blue.','Unfinished items go on yellow.'];
function syntheticAdapter() {
  const adapter={provenance:{adapter:'synthetic-test-only',dataClass:'synthetic',textModel:'fixture',speechModel:'fixture',voice:'fixture',promptVersion:'v1',schemaVersion:'v1'},
    capabilities:{textLanguages:['en'],speechLanguages:['en']},
    async prepare(){return {title:'Shelves',facts,question:'Where do both items go?',askedFacts:facts};},
    async checkPreparation(){return {sourceGrounded:true,questionAligned:true,ambiguous:false,factEvidence:facts.map((quote,factIndex)=>({factIndex,quote})),askedFactIndexes:[0,1],reasons:[]};},
    async translate(){assert.fail('No translation requested');},async checkTranslation(){assert.fail('No translation requested');},
    async speech(){return Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(0.2)}));}};
  return adapter;
}
async function bundle() {
  return prepareLanguageBundle({source,title:'Shelves',revision:1,languages:['en'],dataClass:'synthetic',adapter:syntheticAdapter(),assertCurrent:async()=>true});
}
async function fixture() {
  const db=new PGlite();let fail='',loseCommit=false;
  const client={async query(sql,values){
    if(fail && sql.includes(fail)) throw Error('secret injected database failure');
    const result=values?.length ? await db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};
    if(loseCommit && sql==='COMMIT') {loseCommit=false;throw Error('Commit acknowledgement lost');}
    return result;
  },release(){}};
  const pool={async connect(){return client;}};
  await db.exec(`CREATE SCHEMA ${options.schema};SET search_path TO ${options.schema},pg_catalog`);
  await runMigrations(pool,options);
  await db.exec("INSERT INTO organizations(id,name) VALUES('a','A'),('b','B');INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','A','UTC'),('b','b','B','UTC')");
  await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('brief','a','a','Shelves',$1,'processing')",[source]);
  const job={id:'job',org_id:'a',site_id:'a',briefing_id:'brief',revision:1,token:randomUUID()};
  await db.query("INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at,lease_token,lease_until) VALUES('job','a','a','brief',1,'prepare','processing',clock_timestamp(),$1,clock_timestamp()+interval '90 seconds')",[job.token]);
  return {db,pool,job,setFail(value){fail=value;},loseNextCommit(){loseCommit=true;},async close(){await db.close();}};
}
function memoryStore() {
  const objects=new Map();let saveHook,readHook,removeHook,saves=0,removes=0;
  return {objects,get saves(){return saves;},get removes(){return removes;},onSave(fn){saveHook=fn;},onRead(fn){readHook=fn;},onRemove(fn){removeHook=fn;},
    async save(row,bytes){saves++;if(objects.has(row.id)) throw Error('Existing private object');objects.set(row.id,Buffer.from(bytes));await saveHook?.(row);},
    async read(row){await readHook?.(row);if(!objects.has(row.id)) throw Error('Missing private object');return objects.get(row.id);},
    async exists(row){return objects.has(row.id);},
    async remove(row){removes++;await removeHook?.(row);objects.delete(row.id);}};
}

const owner={org_id:'a',site_id:'a',principal_type:'staff',principal_id:'owner',role:'owner'};
const worker={org_id:'a',site_id:'a',principal_type:'worker',principal_id:'worker'};
async function audience(f) {
  await f.db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner')");
  await f.db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','a','a','001','en'),('other','a','a','002','en'),('foreign','b','b','001','en')");
}
async function ready(f,storage) {
  const value=await bundle(),id=randomUUID();
  await stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id});
  await attachPreparedBundle(f.pool,f.job,id,storage,options);
  return {value,id};
}

function multilingualAdapter(calls=[]) {
  const adapter=syntheticAdapter();adapter.capabilities={textLanguages:['en','ar','ur'],speechLanguages:['en','ar','ur']};
  for(const method of ['prepare','checkPreparation','speech']) {
    const original=adapter[method];adapter[method]=async(...args)=>{calls.push([method,...args]);return original(...args);};
  }
  adapter.translate=async(...args)=>{calls.push(['translate',...args]);return {title:'تعليمات الرفوف',text:`${args[1]} الرف الأزرق والأصفر`,question:'أين ستضع كل نوع؟'};};
  adapter.checkTranslation=async(...args)=>{calls.push(['checkTranslation',...args]);return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};};
  return adapter;
}
async function readyMultilingual(f,storage,adapter,review=null) {
  if(review) await f.db.query('INSERT INTO draft_reviews VALUES($1,$2,$3,$4)',['brief','a','a',JSON.stringify(review)]);
  const value=await prepareLanguageBundle({source,title:'Shelves',revision:1,languages:['en','ar','ur'],review,dataClass:'synthetic',adapter,assertCurrent:async()=>true});
  const id=randomUUID();await stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id});await attachPreparedBundle(f.pool,f.job,id,storage,options);
  return value;
}

test('site generation defaults select real synthetic-adapter bundles while active runs, publications and target regeneration retain their languages',async()=>{
  const f=await fixture(),storage=memoryStore(),calls=[],adapter=multilingualAdapter(calls);
  try {
    await audience(f);
    const change=async(revision,languages)=>updateSettings(f.pool,owner,'site',{requestId:randomUUID(),revision,name:'Site A',timezone:'UTC',generationLanguages:languages,confirmed:true},options);
    await change(0,['en']);await f.db.exec("UPDATE jobs SET status='queued',lease_token=NULL,lease_until=NULL WHERE id='job'");
    const prepare=adapter.prepare;let changed=false;
    adapter.prepare=async(...args)=>{
      // The claim must outlive a bounded 120-second provider request plus pacing.
      const lease=(await f.db.query("SELECT EXTRACT(EPOCH FROM (lease_until-clock_timestamp())) AS seconds FROM jobs WHERE status='processing' AND kind='prepare'")).rows[0];
      assert.ok(Number(lease.seconds)>150);
      if(!changed){changed=true;await change(1,['en','ar']);}return prepare(...args);
    };
    await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter,storage});
    let current=(await f.db.query("SELECT prepared_json,state FROM briefings WHERE id='brief'")).rows[0];assert.equal(current.state,'ready');assert.deepEqual(current.prepared_json.dependencies.languages,['en']);
    assert.equal(calls.filter(call=>call[0]==='translate').length,0);assert.deepEqual((await getSettings(f.pool,owner,options)).site.generationLanguages,['en','ar']);
    await f.db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('urdu-worker','a','a','003','ur')");
    await assert.rejects(publish(f.pool,owner,'brief',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['urdu-worker']},{...options,integrationMode:'synthetic',storage}),/language/i);
    assert.equal((await f.db.query('SELECT count(*)::integer AS n FROM publications')).rows[0].n,0);assert.equal((await f.db.query('SELECT count(*)::integer AS n FROM assignments')).rows[0].n,0);
    const publication=await publish(f.pool,owner,'brief',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker']},{...options,integrationMode:'synthetic',storage});
    await editDraft(f.pool,owner,'brief',{revision:1,title:'New generation run',source},options);await queuePreparation(f.pool,owner,'brief',2,options);
    await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter,storage});
    current=(await f.db.query("SELECT prepared_json,state FROM briefings WHERE id='brief'")).rows[0];assert.equal(current.state,'ready');assert.deepEqual(current.prepared_json.dependencies.languages,['en','ar']);
    await change(2,['en']);
    await regenerateDraftTarget(f.pool,owner,'brief',{requestId:randomUUID(),revision:2,language:'ar',kind:'translation',confirmed:true},options);
    await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter,storage});
    current=(await f.db.query("SELECT prepared_json,state FROM briefings WHERE id='brief'")).rows[0];assert.equal(current.state,'ready');assert.deepEqual(current.prepared_json.dependencies.languages,['en','ar']);
    assert.deepEqual((await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[publication.id])).rows[0].snapshot_json.dependencies.languages,['en']);
    assert.ok(calls.every(call=>call[0]!=='translate' || call[2]!=='ur'));
    const custom=await createDraft(f.pool,owner,{requestId:randomUUID(),title:'Urdu audience',source,generationLanguages:['en','ur']},options);
    await queuePreparation(f.pool,owner,custom.id,1,options);await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter,storage});
    const customDetail=await getBriefing(f.pool,owner,custom.id,options);assert.equal(customDetail.state,'ready');assert.deepEqual(customDetail.generationLanguages,['en','ur']);assert.deepEqual(customDetail.prepared.dependencies.languages,['en','ur']);
    assert.deepEqual((await getSettings(f.pool,owner,options)).site.generationLanguages,['en']);assert.ok(calls.some(call=>call[0]==='translate' && call[2]==='ur'));
  }finally {await f.close();}
});

test('regeneration boundary rejects forged metadata, unconfirmed inputs and unsupported selection',()=>{
  const input={requestId:randomUUID(),revision:1,language:'ar',kind:'translation',confirmed:true};
  assert.deepEqual(regenerationInput(input),{revision:1,language:'ar',kind:'translation'});
  for(const value of [null,[],{...input,confirmed:false},{...input,revision:0},{...input,revision:2147483647},
    {...input,revision:'1'},{...input,requestId:'bad'},{...input,language:'xx'},{...input,language:'en'},
    {...input,kind:'speech'},{...input,baseline:{trusted:true}},{...input,audio:'forged'},{...input,review:{}}]) {
    assert.throws(()=>regenerationInput(value),/Invalid regeneration request/);
  }
});

test('durable selected regeneration reuses verified other-language bytes, preserves edits and publications, and replays exactly',async()=>{
  const f=await fixture(),storage=memoryStore(),calls=[],adapter=multilingualAdapter(calls);
  try {
    await audience(f);
    const edited={title:'الرفوف الجديدة',text:'ضع المكتمل على الأزرق وغير المكتمل على الأصفر.',question:'أين الرفان؟'};
    const review={revision:1,question:'',facts:[],askedFacts:[],translations:{ar:edited,ur:{...edited,question:'کہاں رکھیں؟'}}};
    const original=await readyMultilingual(f,storage,adapter,review);
    const readyDetail=await getBriefing(f.pool,owner,'brief',options);
    assert.deepEqual(readyDetail.regenerationLanguages,['en','ar','ur']);assert.equal(readyDetail.targetRegeneration,null);
    const pub=await publish(f.pool,owner,'brief',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker']},{...options,integrationMode:'synthetic',storage});
    const publication=(await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json;
    const retained=await getBriefing(f.pool,owner,'brief',options);
    assert.equal(retained.state,'draft');assert.equal(retained.artifactAudio,null);
    assert.deepEqual(retained.regenerationLanguages,['en','ar','ur']);
    let previous=original.manifest,revision=1;
    for(const [kind,language] of [['audio','ar'],['translation','ar'],['audio','en']]) {
      const request={requestId:randomUUID(),revision,language,kind,confirmed:true};calls.length=0;
      const accepted=await regenerateDraftTarget(f.pool,owner,'brief',request,options);assert.equal(accepted.revision,++revision);
      const pending=await getBriefing(f.pool,owner,'brief',options);
      assert.equal(pending.artifactAudio,null);assert.deepEqual(pending.regenerationLanguages,[]);
      assert.deepEqual(pending.targetRegeneration,{jobId:(await f.db.query('SELECT job_id FROM briefing_regeneration_requests WHERE request_id=$1',[request.requestId])).rows[0].job_id,status:'queued',language,kind});
      assert.deepEqual(await regenerationReceipt(f.pool,owner,request.requestId,options),{found:true,id:'brief',revision,request:{revision:revision-1,language,kind}});
      await assert.rejects(regenerateDraftTarget(f.pool,owner,'brief',{...request,kind:kind==='audio' ? 'translation' : 'audio'},options),/Regeneration request conflict|Invalid regeneration request/);
      assert.equal((await regenerateDraftTarget(f.pool,owner,'brief',request,options)).duplicate,true);
      const counts=(await f.db.query('SELECT COUNT(*)::int n FROM briefing_regeneration_requests')).rows[0].n;
      await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter,storage,languages:['en','ar','ur']});
      const after=await getBriefing(f.pool,owner,'brief',options);assert.equal(after.state,'ready');assert.equal(after.prepared.dependencies.revision,revision);
      assert.deepEqual(after.regenerationLanguages,['en','ar','ur']);assert.equal(after.targetRegeneration.status,'ready');
      assert.deepEqual(calls.map(call=>call[0]),kind==='audio' ? ['speech','speech'] : ['translate','checkTranslation','speech','speech']);
      for(const other of ['en','ar','ur'].filter(value=>value!==language)) {
        for(const key of ['title','text','question']) assert.equal(after.prepared.languages[other][key],previous.languages[other][key]);
        for(const track of ['body','question']) {
          const old=previous.languages[other].speech[track],next=after.prepared.languages[other].speech[track];
          assert.notEqual(next.id,old.id);assert.equal(next.sha256,old.sha256);
          assert.deepEqual(storage.objects.get(next.id),storage.objects.get(old.id));
        }
      }
      assert.equal(after.prepared.languages.ur.question,review.translations.ur.question);
      if(kind==='audio' && language==='ar') assert.equal(after.prepared.languages.ar.question,edited.question);
      if(kind==='translation') {
        const current=(await f.db.query('SELECT content_json FROM draft_reviews')).rows[0].content_json;
        assert.equal(current.translations.ar,undefined);assert.deepEqual(current.translations.ur,review.translations.ur);
      }
      assert.deepEqual((await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json,publication);
      assert.deepEqual(await getStaffArtifactSpeech(f.pool,owner,'brief','publication',pub.id,'en','body',storage,options),original.audio.find(item=>item.id===original.manifest.languages.en.speech.body.id).bytes);
      assert.equal((await regenerateDraftTarget(f.pool,owner,'brief',request,options)).duplicate,true);
      assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM briefing_regeneration_requests')).rows[0].n,counts);
      previous=after.prepared;
    }
    await assert.rejects(f.db.query("UPDATE briefing_regeneration_requests SET request_json='{}'"),/immutable/);
    await assert.rejects(f.db.query('DELETE FROM briefing_regeneration_requests'),/immutable/);
    await assert.rejects(f.db.query("UPDATE briefing_regeneration_requests SET site_id='b'"),/immutable/);
    await f.db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('foreign-owner','b','b','Foreign owner','owner')");
    await f.db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state,revision) VALUES('foreign-brief','b','b','Foreign',$1,'processing',2)",[source]);
    await f.db.query("INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at) VALUES('foreign-job','b','b','foreign-brief',2,'prepare','queued',clock_timestamp())");
    const baseline=(await f.db.query('SELECT baseline_bundle_id FROM briefing_regeneration_requests ORDER BY accepted_revision LIMIT 1')).rows[0].baseline_bundle_id;
    await assert.rejects(f.db.query(`INSERT INTO briefing_regeneration_requests(request_id,org_id,site_id,briefing_id,accepted_revision,baseline_revision,baseline_bundle_id,job_id,request_json,requested_by,requested_role)
      VALUES($1,'b','b','foreign-brief',2,1,$2,'foreign-job',$3,'foreign-owner','owner')`,[randomUUID(),baseline,JSON.stringify({revision:1,language:'en',kind:'audio'})]),error=>error.code==='23503');
  }finally {await f.close();}
});

test('failed targeted preparation retries the same durable intent and does not rebuild unrelated languages',async()=>{
  const f=await fixture(),storage=memoryStore(),calls=[],adapter=multilingualAdapter(calls);
  try {
    await audience(f);await readyMultilingual(f,storage,adapter);calls.length=0;
    const request={requestId:randomUUID(),revision:1,language:'ur',kind:'audio',confirmed:true};
    await regenerateDraftTarget(f.pool,owner,'brief',request,options);
    const voice=adapter.provenance.voice;adapter.provenance.voice='changed';
    await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter,storage,languages:['en','ar','ur']});
    const failed=await getBriefing(f.pool,owner,'brief',options);
    assert.equal(failed.state,'failed');assert.deepEqual(failed.regenerationLanguages,[]);
    assert.equal(failed.targetRegeneration.status,'failed');assert.equal(failed.targetRegeneration.language,'ur');assert.equal(calls.length,0);
    adapter.provenance.voice=voice;await queuePreparation(f.pool,owner,'brief',2,options);
    await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter,storage,languages:['en','ar','ur']});
    assert.equal((await getBriefing(f.pool,owner,'brief',options)).state,'ready');
    assert.deepEqual(calls.map(call=>[call[0],call[2]]),[['speech','ur'],['speech','ur']]);
    assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM briefing_regeneration_requests')).rows[0].n,1);
    assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM jobs')).rows[0].n,2);
    assert.equal((await regenerateDraftTarget(f.pool,owner,'brief',request,options)).duplicate,true);
  }finally {await f.close();}
});

test('regeneration acceptance is scoped, audit-atomic and recoverable after a lost commit acknowledgement',async()=>{
  const f=await fixture(),storage=memoryStore();
  try {
    await audience(f);await ready(f,storage);
    const request={requestId:randomUUID(),revision:1,language:'en',kind:'audio',confirmed:true};
    for(const actor of [worker,{...owner,role:'auditor'},{...owner,role:'administrator'},{...owner,site_id:'b',org_id:'b'}]) await assert.rejects(regenerateDraftTarget(f.pool,actor,'brief',request,options),/Forbidden/);
    await assert.rejects(regenerateDraftTarget(f.pool,owner,'brief',{...request,revision:2},options),/Draft revision changed/);
    await assert.rejects(regenerateDraftTarget(f.pool,owner,'brief',{...request,language:'ur'},options),/Draft regeneration unavailable/);
    f.setFail('INSERT INTO audit');await assert.rejects(regenerateDraftTarget(f.pool,owner,'brief',request,options),/injected database failure/);
    assert.equal((await f.db.query('SELECT revision,state FROM briefings')).rows[0].revision,1);
    assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM jobs')).rows[0].n,1);
    assert.deepEqual(await regenerationReceipt(f.pool,owner,request.requestId,options),{found:false});
    f.setFail('');f.loseNextCommit();await assert.rejects(regenerateDraftTarget(f.pool,owner,'brief',request,options),/acknowledgement lost/);
    assert.equal((await regenerationReceipt(f.pool,owner,request.requestId,options)).revision,2);
    assert.equal((await regenerateDraftTarget(f.pool,owner,'brief',request,options)).duplicate,true);
    assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM jobs')).rows[0].n,2);
    assert.equal((await f.db.query("SELECT COUNT(*)::int n FROM audit WHERE action='briefing.target_regeneration_requested'")).rows[0].n,1);
  }finally {await f.close();}
});

test('target worker refuses corrupt bytes, changed dependencies, revoked requester and missing adapter without provider calls',async()=>{
  for(const failure of ['corrupt','provider','languages','glossary','role','no-adapter','stale-read']) {
    const f=await fixture(),storage=memoryStore(),calls=[],adapter=multilingualAdapter(calls);let changed=false;
    try {
      await audience(f);const original=await readyMultilingual(f,storage,adapter);calls.length=0;
      await regenerateDraftTarget(f.pool,owner,'brief',{requestId:randomUUID(),revision:1,language:'ar',kind:'translation',confirmed:true},options);
      if(failure==='corrupt') storage.objects.get(original.audio[0].id).writeInt16LE(123,44);
      if(failure==='provider') adapter.provenance.voice='different';
      if(failure==='role') await f.db.query("UPDATE staff SET role='auditor' WHERE id='owner'");
      if(failure==='glossary') {
        await f.db.query("INSERT INTO glossary_terms(id,org_id,site_id,term,term_key,source_lang,target_lang,revision,status) VALUES('term','a','a','blue','blue','en','ar',1,'active')");
        await f.db.query("INSERT INTO glossary_versions(term_id,org_id,site_id,revision,status,content_json,created_by) VALUES('term','a','a',1,'active',$1,'owner')",[JSON.stringify({override:'أزرق',suggestion:null,provenance:null})]);
      }
      if(failure==='stale-read') storage.onRead(async()=>{if(!changed) {await editDraft(f.pool,owner,'brief',{revision:2,title:'Changed source',source},options);changed=true;}});
      await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter:failure==='no-adapter' ? undefined : adapter,storage,languages:failure==='languages' ? ['en','ar'] : ['en','ar','ur']});
      assert.equal(calls.length,0,failure);
      assert.equal((await f.db.query('SELECT state FROM briefings')).rows[0].state,failure==='stale-read' ? 'draft' : 'failed',failure);
      assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM generated_bundles')).rows[0].n,1);
      assert.equal(storage.removes,0);
      if(failure==='stale-read') assert.equal(changed,true);
    }finally {await f.close();}
  }
});

test('target regeneration HTTP has credential/origin/scope checks and private exact receipts',async()=>{
  const f=await fixture(),storage=memoryStore();let server;
  try {
    await audience(f);await ready(f,storage);
    await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'Synthetic-only-Staff-123!'},options);
    const signed=await authenticateStaff(f.pool,'owner@example.test','Synthetic-only-Staff-123!','127.0.0.1',options);
    const grant=await issueWorkerGrant(f.pool,owner,'worker',30,options),workerSigned=await redeemWorkerGrant(f.pool,grant.token,options);
    server=createPostgresRehearsalServer(f.pool,{...options,storage,tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020'});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/api`,input={requestId:randomUUID(),revision:1,language:'en',kind:'audio',confirmed:true};
    const call=(path,token,body,origin='http://127.0.0.1:3020')=>fetch(`${base}${path}`,{method:body ? 'POST' : 'GET',headers:{...(token ? {cookie:`understood_pg_rehearsal=${token}`} : {}),...(body ? {'content-type':'application/json',origin} : {})},...(body ? {body:JSON.stringify(body)} : {})});
    assert.equal((await call('/briefings/brief/regenerate',null,input)).status,401);
    assert.equal((await call('/briefings/brief/regenerate',workerSigned.token,input)).status,403);
    assert.equal((await call('/briefings/brief/regenerate',signed.session.token,input,'https://foreign.example')).status,403);
    assert.equal((await call('/briefings/brief/regenerate?baseline=foreign',signed.session.token,input)).status,400);
    assert.equal((await call('/briefings/brief/regenerate',signed.session.token,{...input,speech:'forged'})).status,400);
    const accepted=await call('/briefings/brief/regenerate',signed.session.token,input);assert.equal(accepted.status,200);assert.equal((await accepted.json()).revision,2);
    const receipt=await call(`/briefing-regeneration/receipts/${input.requestId}`,signed.session.token);assert.equal(receipt.status,200);assert.equal(receipt.headers.get('cache-control'),'no-store');
    assert.deepEqual(await receipt.json(),{found:true,id:'brief',revision:2,request:{revision:1,language:'en',kind:'audio'}});
    assert.equal((await call(`/briefing-regeneration/receipts/${input.requestId}`,workerSigned.token)).status,403);
    const saved=(await f.db.query('SELECT requested_session_hash FROM briefing_regeneration_requests')).rows[0].requested_session_hash;
    assert.ok(saved);assert.equal(saved.length,64);
    await f.db.query('UPDATE sessions SET revoked_at=clock_timestamp()');
    const calls=[],adapter=multilingualAdapter(calls);
    await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter,storage,languages:['en']});
    assert.equal(calls.length,0);assert.equal((await f.db.query('SELECT state FROM briefings')).rows[0].state,'failed');
  }finally {if(server) await new Promise(resolve=>server.close(resolve));await f.close();}
});

test('translated draft edits regenerate checked exact-text audio, fence old URLs and preserve published audio',async()=>{
  const f=await fixture(),storage=memoryStore();
  try {
    await audience(f);await ready(f,storage);
    const publication=await publish(f.pool,owner,'brief',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker']},{...options,integrationMode:'synthetic',storage});
    const original=(await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[publication.id])).rows[0].snapshot_json;
    const originalAudio=Buffer.from(await getStaffArtifactSpeech(f.pool,owner,'brief','publication',publication.id,'en','body',storage,options));
    const edited={title:'تعليمات الرفوف',text:'ضع المكتمل على الرف الأزرق وغير المكتمل على الرف الأصفر.',question:'أين ستضع كل نوع؟'};
    const change={requestId:randomUUID(),revision:1,question:'',facts:[],askedFacts:[],translations:{ar:edited},confirmed:true};
    const result=await saveDraftReview(f.pool,owner,'brief',change,options);assert.equal(result.revision,2);
    const draft=await getBriefing(f.pool,owner,'brief',options);assert.equal(draft.state,'processing');assert.equal(draft.prepared,null);assert.equal(draft.artifactAudio,null);
    await assert.rejects(getStaffArtifactSpeech(f.pool,owner,'brief','draft','1','en','body',storage,options),/Artifact audio unavailable/);
    assert.equal((await saveDraftReview(f.pool,owner,'brief',change,options)).duplicate,true);
    assert.deepEqual((await draftReviewReceipt(f.pool,owner,change.requestId,options)).request.translations,{ar:edited});
    const adapter=syntheticAdapter(),spoken=[],checked=[];
    adapter.capabilities={textLanguages:['en','ar'],speechLanguages:['en','ar']};
    adapter.checkTranslation=async(source,target,language)=>{checked.push({source,target,language});return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};};
    const speech=adapter.speech;adapter.speech=async(text,language)=>{spoken.push({text,language});return speech();};
    await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter,storage,languages:['en','ar']});
    const after=await getBriefing(f.pool,owner,'brief',options);assert.equal(after.state,'ready');assert.equal(after.prepared.dependencies.revision,2);
    assert.deepEqual(checked,[{source:{title:'Shelves',text:source,question:'Where do both items go?'},target:edited,language:'ar'}]);
    assert.ok(spoken.some(value=>value.language==='ar' && value.text===edited.text));assert.ok(spoken.some(value=>value.language==='ar' && value.text===edited.question));
    assert.match(after.artifactAudio.ar.body,/\/draft\/2\/ar\/body$/);
    assert.deepEqual(await getStaffArtifactSpeech(f.pool,owner,'brief','draft','2','ar','body',storage,options),await speech());
    assert.deepEqual((await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[publication.id])).rows[0].snapshot_json,original);
    assert.deepEqual(await getStaffArtifactSpeech(f.pool,owner,'brief','publication',publication.id,'en','body',storage,options),originalAudio);
    const newer={...change,requestId:randomUUID(),revision:2,translations:{ar:{...edited,question:'أين الأصفر؟'}}};
    await saveDraftReview(f.pool,owner,'brief',newer,options);assert.equal((await getBriefing(f.pool,owner,'brief',options)).prepared,null);
    await assert.rejects(getStaffArtifactSpeech(f.pool,owner,'brief','draft','2','ar','body',storage,options),/Artifact audio unavailable/);
    let changed=false;adapter.checkTranslation=async()=>{await editDraft(f.pool,owner,'brief',{revision:3,title:'Newer source',source},options);changed=true;return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};};
    const beforeSpeech=spoken.length;
    await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter,storage,languages:['en','ar']});
    assert.equal(changed,true);assert.equal(spoken.length,beforeSpeech);assert.equal((await getBriefing(f.pool,owner,'brief',options)).state,'draft');
    assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM generated_bundles')).rows[0].n,2);
  }finally {await f.close();}
});

test('stored bundle attachment atomically commits readiness/job/audit and reconciles lost acknowledgement',async()=>{
  const f=await fixture(),storage=memoryStore(),value=await bundle(),id=randomUUID();
  try {
    await stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id});
    f.setFail('INSERT INTO audit');
    await assert.rejects(attachPreparedBundle(f.pool,f.job,id,storage,options),/not durably accepted/);
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'stored');
    assert.equal((await f.db.query('SELECT state,prepared_json FROM briefings')).rows[0].prepared_json,null);
    assert.equal((await f.db.query('SELECT status FROM jobs')).rows[0].status,'processing');
    f.setFail('');storage.onRead(async row=>{if(row.id===value.audio[1].id) f.loseNextCommit();});
    assert.equal((await attachPreparedBundle(f.pool,f.job,id,storage,options)).duplicate,true);
    const draft=(await f.db.query('SELECT state,prepared_json FROM briefings')).rows[0];
    assert.equal(draft.state,'ready');assert.deepEqual(draft.prepared_json.artifactBundle,{id,manifestHash:bundleHash(value.manifest)});
    assert.deepEqual((await f.db.query('SELECT status,lease_token,lease_until FROM jobs')).rows[0],{status:'ready',lease_token:null,lease_until:null});
    assert.equal((await f.db.query("SELECT COUNT(*)::int n FROM audit WHERE action='briefing.prepared'")).rows[0].n,1);
    assert.equal((await attachPreparedBundle(f.pool,f.job,id,storage,options)).duplicate,true);assert.equal(storage.removes,0);
    await assert.rejects(attachPreparedBundle(f.pool,{...f.job,token:randomUUID()},id,storage,options),/not durably accepted/);
  }finally {await f.close();}
});

test('attachment denies corrupt storage and dependency changes during readback without making draft ready',async()=>{
  const f=await fixture(),storage=memoryStore(),value=await bundle(),id=randomUUID();
  try {
    await stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id});
    const row=value.audio[0],saved=Buffer.from(storage.objects.get(row.id));storage.objects.get(row.id).writeInt16LE(123,44);
    await assert.rejects(attachPreparedBundle(f.pool,f.job,id,storage,options),/not durably accepted/);
    storage.objects.set(row.id,saved);
    storage.onRead(async()=>{await f.db.query("UPDATE briefings SET revision=2,state='draft',prepared_json=NULL WHERE id='brief'");});
    await assert.rejects(attachPreparedBundle(f.pool,f.job,id,storage,options),/not durably accepted/);
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'stored');
    assert.equal((await f.db.query('SELECT prepared_json FROM briefings')).rows[0].prepared_json,null);assert.equal(storage.removes,0);
  }finally {await f.close();}
});

test('generated publication freezes audio and assignment language; private playback survives new drafts without leaking rubric',async()=>{
  const f=await fixture(),storage=memoryStore();
  try {
    await audience(f);const {value,id}=await ready(f,storage);
    const request={requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker']},publishOptions={...options,integrationMode:'synthetic',storage};
    await assert.rejects(publish(f.pool,owner,'brief',request,{...publishOptions,integrationMode:'live'}),/Publication data class|Live publication/);
    await assert.rejects(publish(f.pool,owner,'brief',{...request,workerIds:['foreign']},publishOptions),/Recipient unavailable/);
    await f.db.query("UPDATE workers SET language='ar' WHERE id='worker'");
    await assert.rejects(publish(f.pool,owner,'brief',request,publishOptions),/Recipient language/);
    await f.db.query("UPDATE workers SET language='en' WHERE id='worker'");
    const pub=await publish(f.pool,owner,'brief',request,publishOptions);assert.equal(pub.assigned,1);
    const assignment=(await f.db.query('SELECT id FROM assignments')).rows[0].id;
    const dto=await workerBriefing(f.pool,worker,assignment,options);
    assert.deepEqual(dto.speechUrls,{body:`/api/worker/briefings/${assignment}/speech/body`,question:`/api/worker/briefings/${assignment}/speech/question`});
    assert.equal(dto.content.speech,null);assert.equal(dto.speechAvailable,null);
    for(const secret of ['rubric','askedFacts','textHash','sha256','artifactBundle',id,...value.audio.map(row=>row.id)]) assert.ok(!JSON.stringify(dto).includes(secret));
    for(const kind of ['body','question']) assert.deepEqual(await getAssignmentSpeech(f.pool,worker,assignment,kind,storage,options),value.audio.find(row=>row.id===value.manifest.languages.en.speech[kind].id).bytes);
    await f.db.query("UPDATE workers SET language='ar' WHERE id='worker'");
    assert.deepEqual(await getAssignmentSpeech(f.pool,worker,assignment,'body',storage,options),value.audio[0].bytes);
    await editDraft(f.pool,owner,'brief',{revision:1,title:'Changed shelves',source:'A genuinely different source.'},options);
    storage.onRead(async()=>{throw Error('storage currently unavailable');});
    assert.equal((await publish(f.pool,owner,'brief',request,publishOptions)).duplicate,true);
    assert.equal((await attachPreparedBundle(f.pool,f.job,id,storage,options)).duplicate,true);
    await assert.rejects(publish(f.pool,owner,'brief',{...request,workerIds:['other']},publishOptions),/Publication request conflict/);
    storage.onRead(null);assert.deepEqual(await getAssignmentSpeech(f.pool,worker,assignment,'body',storage,options),value.audio[0].bytes);
    const frozen=(await f.db.query('SELECT snapshot_json FROM publications')).rows[0].snapshot_json;
    assert.equal(frozen.source,source);assert.equal(frozen.artifactBundle.id,id);
    assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM publications')).rows[0].n,1);
  }finally {await f.close();}
});

test('publication rechecks corrupt storage, forged journal tags and changes during readback',async()=>{
  const f=await fixture(),storage=memoryStore();
  try {
    await audience(f);const {value}=await ready(f,storage);
    const request={requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker']},config={...options,integrationMode:'synthetic',storage};
    const original=Buffer.from(storage.objects.get(value.audio[0].id));storage.objects.get(value.audio[0].id).writeInt16LE(12,44);
    await assert.rejects(publish(f.pool,owner,'brief',request,config),/integrity/);
    storage.objects.set(value.audio[0].id,original);
    const snapshot=(await f.db.query('SELECT prepared_json FROM briefings')).rows[0].prepared_json;
    await f.db.query('UPDATE briefings SET prepared_json=$1',[JSON.stringify({...snapshot,artifactBundle:{...snapshot.artifactBundle,id:randomUUID()}})]);
    await assert.rejects(publish(f.pool,owner,'brief',request,config),/bundle unavailable/);
    await f.db.query('UPDATE briefings SET prepared_json=$1',[JSON.stringify(snapshot)]);
    storage.onRead(async()=>{await f.db.query('UPDATE briefings SET next_version=2');});
    await assert.rejects(publish(f.pool,owner,'brief',request,config),/Draft version changed/);
    assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM publications')).rows[0].n,0);
    await f.db.query('UPDATE briefings SET next_version=1');
    storage.onRead(async()=>{await f.db.query("UPDATE briefings SET state='draft',revision=2,prepared_json=NULL");});
    await assert.rejects(publish(f.pool,owner,'brief',request,config),/Draft revision changed/);
    assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM publications')).rows[0].n,0);
  }finally {await f.close();}
});

test('private assignment speech denies other workers/sites/roles, revoked grants and revocation during object read',async()=>{
  const f=await fixture(),storage=memoryStore();
  try {
    await audience(f);const {value}=await ready(f,storage);
    await publish(f.pool,owner,'brief',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker']},{...options,integrationMode:'synthetic',storage});
    const assignment=(await f.db.query('SELECT id FROM assignments')).rows[0].id;
    let reads=0;storage.onRead(async()=>{reads++;});
    for(const session of [{...worker,principal_id:'other'},{...worker,principal_id:'foreign',org_id:'b',site_id:'b'},owner,{...worker,site_id:'b'}])
      await assert.rejects(getAssignmentSpeech(f.pool,session,assignment,'body',storage,options),/unavailable|Forbidden/);
    assert.equal(reads,0);
    await assert.rejects(getAssignmentSpeech(f.pool,worker,assignment,'rubric',storage,options),/Assignment unavailable/);
    await f.db.query("INSERT INTO worker_grants(id,org_id,site_id,worker_id,token_hash,expires_at,redeemed_at) VALUES('grant','a','a','worker',repeat('a',64),clock_timestamp()+interval '1 hour',clock_timestamp())");
    const credential={...worker,access_mode:'credential',grant_id:'grant'};
    storage.onRead(async()=>{await f.db.query("UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE id='grant'");});
    await assert.rejects(getAssignmentSpeech(f.pool,credential,assignment,'body',storage,options),/Sign in required/);
    storage.onRead(null);
    await assert.rejects(getAssignmentSpeech(f.pool,credential,assignment,'body',storage,options),/Sign in required/);
    await f.db.query("UPDATE worker_grants SET revoked_at=NULL WHERE id='grant'");
    await f.db.query("INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,grant_id,access_mode) VALUES(repeat('b',64),'a','a','worker','worker',clock_timestamp()+interval '1 hour','grant','credential')");
    const session={...credential,token_hash:'b'.repeat(64)};
    storage.onRead(async()=>{await f.db.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=repeat('b',64)");});
    await assert.rejects(getAssignmentSpeech(f.pool,session,assignment,'body',storage,options),/Sign in required/);
    storage.onRead(null);
    storage.objects.get(value.audio[0].id).writeInt16LE(200,44);
    await assert.rejects(getAssignmentSpeech(f.pool,worker,assignment,'body',storage,options),/Generated audio unavailable/);
  }finally {await f.close();}
});

test('automatic preparation can generate, durably attach and publish without a human readiness step',async()=>{
  const f=await fixture(),storage=memoryStore();
  try {
    await audience(f);
    await f.db.query("UPDATE jobs SET status='queued',lease_token=NULL,lease_until=NULL");
    const config={...options,integrationMode:'synthetic',adapter:syntheticAdapter(),storage,languages:['en']};
    assert.equal(await rehearsalTasks(f.pool,storage,{...options,preparationAdapter:config.adapter,preparationLanguages:['en']}).preparation(),true);
    assert.equal((await f.db.query('SELECT state FROM briefings')).rows[0].state,'ready');
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'attached');
    assert.equal((await f.db.query('SELECT status,attempts FROM jobs')).rows[0].status,'ready');
    assert.equal(await processOnePreparation(f.pool,config),false);
    const pub=await publish(f.pool,owner,'brief',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker']},config);
    assert.equal(pub.assigned,1);assert.equal(storage.saves,2);
  }finally {await f.close();}
});

test('staff audio reads are bound to current ready drafts and immutable publication history',async()=>{
  const f=await fixture(),storage=memoryStore();
  try {
    await audience(f);const {value}=await ready(f,storage);
    const draft=await getBriefing(f.pool,owner,'brief',options);
    assert.deepEqual(draft.artifactAudio.en,{body:'/api/briefings/brief/artifacts/draft/1/en/body',question:'/api/briefings/brief/artifacts/draft/1/en/question'});
    for(const kind of ['body','question']) assert.deepEqual(await getStaffArtifactSpeech(f.pool,owner,'brief','draft','1','en',kind,storage,options),value.audio.find(row=>row.id===value.manifest.languages.en.speech[kind].id).bytes);
    const pub=await publish(f.pool,owner,'brief',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker']},{...options,integrationMode:'synthetic',storage});
    const detail=await getBriefing(f.pool,owner,'brief',options);
    assert.equal(detail.artifactAudio,null);assert.equal(detail.publications[0].artifactAudio.en.body,`/api/briefings/brief/artifacts/publication/${pub.id}/en/body`);
    await assert.rejects(getStaffArtifactSpeech(f.pool,owner,'brief','draft','1','en','body',storage,options),/unavailable/);
    await editDraft(f.pool,owner,'brief',{revision:1,title:'A newer draft',source:'New source.'},options);
    await f.db.query("UPDATE publications SET state='withdrawn'");
    assert.deepEqual(await getStaffArtifactSpeech(f.pool,owner,'brief','publication',pub.id,'en','body',storage,options),value.audio[0].bytes);
    assert.equal((await f.db.query('SELECT snapshot_json FROM publications')).rows[0].snapshot_json.source,source);
  }finally {await f.close();}
});

test('staff artifact speech rejects unauthorized roles, foreign versions and stale or corrupt artifacts',async()=>{
  const f=await fixture(),storage=memoryStore();
  try {
    await audience(f);const {value}=await ready(f,storage);
    await f.db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('auditor','a','a','Auditor','auditor'),('supervisor','a','a','Supervisor','supervisor'),('foreign-owner','b','b','Foreign','owner')");
    const auditor={...owner,principal_id:'auditor',role:'auditor'},supervisor={...owner,principal_id:'supervisor',role:'supervisor'};
    assert.equal((await getBriefing(f.pool,auditor,'brief',options)).artifactAudio,null);
    let reads=0;storage.onRead(async()=>{reads++;});
    for(const actor of [auditor,worker,{...owner,principal_id:'foreign-owner',org_id:'b',site_id:'b'}])
      await assert.rejects(getStaffArtifactSpeech(f.pool,actor,'brief','draft','1','en','body',storage,options),/Forbidden|unavailable/);
    for(const [type,version,language,kind] of [['draft','2','en','body'],['draft','01','en','body'],['publication',randomUUID(),'en','body'],['draft','1','ar','body'],['draft','1','en','rubric'],['draft','1','xyz','body']])
      await assert.rejects(getStaffArtifactSpeech(f.pool,owner,'brief',type,version,language,kind,storage,options),/unavailable/);
    assert.equal(reads,0);
    assert.deepEqual(await getStaffArtifactSpeech(f.pool,supervisor,'brief','draft','1','en','question',storage,options),value.audio[1].bytes);
    storage.objects.get(value.audio[0].id).writeInt16LE(10,44);
    await assert.rejects(getStaffArtifactSpeech(f.pool,owner,'brief','draft','1','en','body',storage,options),/Generated audio unavailable/);
    await f.db.query("UPDATE briefings SET source='Changed without revision'");
    assert.equal((await getBriefing(f.pool,owner,'brief',options)).artifactAudio,null);
    await assert.rejects(getStaffArtifactSpeech(f.pool,owner,'brief','draft','1','en','question',storage,options),/unavailable/);
  }finally {await f.close();}
});

test('staff audio rechecks revision, review, glossary, role and session after object reads',async()=>{
  for(const change of ['revision','review','glossary','role','session']) {
    const f=await fixture(),storage=memoryStore();
    try {
      await audience(f);await ready(f,storage);
      await f.db.query("INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,access_mode) VALUES(repeat('c',64),'a','a','staff','owner',clock_timestamp()+interval '1 hour','credential')");
      const actor={...owner,token_hash:'c'.repeat(64)};
      let changed=false;
      storage.onRead(async()=>{
        if(change==='revision') await f.db.query("UPDATE briefings SET revision=2");
        if(change==='review') await f.db.query("INSERT INTO draft_reviews(briefing_id,org_id,site_id,content_json) VALUES('brief','a','a',$1)",[JSON.stringify({revision:1,facts,question:'Changed question?',askedFacts:facts})]);
        if(change==='glossary') {
          await f.db.query("INSERT INTO glossary_terms(id,org_id,site_id,term,term_key,source_lang,target_lang,revision,status) VALUES('term','a','a','blue shelf','blue shelf','en','ar',1,'active')");
          await f.db.query("INSERT INTO glossary_versions(term_id,org_id,site_id,revision,status,content_json,created_by) VALUES('term','a','a',1,'active',$1,'owner')",[JSON.stringify({override:'changed',suggestion:null,provenance:null})]);
        }
        if(change==='role') await f.db.query("UPDATE staff SET role='auditor' WHERE id='owner'");
        if(change==='session') await f.db.query("UPDATE sessions SET revoked_at=clock_timestamp()");
        changed=true;
      });
      await assert.rejects(getStaffArtifactSpeech(f.pool,actor,'brief','draft','1','en','body',storage,options),/Artifact audio unavailable|Forbidden|Sign in required/,change);
      assert.equal(changed,true,`${change} hook must actually commit`);
    }finally {await f.close();}
  }
});

test('staff speech HTTP requires credentials and rejects query overrides and cross-briefing playback',async()=>{
  const f=await fixture(),storage=memoryStore();let server;
  try {
    await audience(f);const {value}=await ready(f,storage);
    await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'Synthetic-only-Staff-123!'},options);
    const signed=await authenticateStaff(f.pool,'owner@example.test','Synthetic-only-Staff-123!','127.0.0.1',options);
    const grant=await issueWorkerGrant(f.pool,owner,'worker',30,options),workerSigned=await redeemWorkerGrant(f.pool,grant.token,options);
    server=createPostgresRehearsalServer(f.pool,{...options,storage,tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020'});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/api/briefings`,call=(path,token)=>fetch(`${base}${path}`,{headers:token ? {cookie:`understood_pg_rehearsal=${token}`} : {}});
    assert.equal((await call('/brief/artifacts/draft/1/en/body')).status,401);
    assert.equal((await call('/brief/artifacts/draft/1/en/body',workerSigned.token)).status,403);
    for(const path of ['/brief/artifacts/draft/1/en/body?object=other','/other/artifacts/draft/1/en/body','/brief/artifacts/draft/2/en/body']) assert.equal((await call(path,signed.session.token)).status,404);
    const dto=await (await call('/brief',signed.session.token)).json();assert.ok(dto.artifactAudio.en.body);
    const response=await call('/brief/artifacts/draft/1/en/body',signed.session.token);
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),value.audio[0].bytes);
    storage.objects.get(value.audio[0].id).writeInt16LE(123,44);
    const corrupt=await call('/brief/artifacts/draft/1/en/body',signed.session.token);assert.equal(corrupt.status,404);assert.deepEqual(await corrupt.json(),{error:'Generated audio unavailable'});
  }finally {if(server) await new Promise(resolve=>server.close(resolve));await f.close();}
});

test('private speech HTTP streams verified WAV with no-store headers, credential scope and no identity bypass',async()=>{
  const f=await fixture(),storage=memoryStore();let server;
  try {
    await audience(f);const {value}=await ready(f,storage);
    await publish(f.pool,owner,'brief',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker']},{...options,integrationMode:'synthetic',storage});
    const assignment=(await f.db.query('SELECT id FROM assignments')).rows[0].id;
    const grant=await issueWorkerGrant(f.pool,owner,'worker',30,options),signed=await redeemWorkerGrant(f.pool,grant.token,options);
    const otherGrant=await issueWorkerGrant(f.pool,owner,'other',30,options),other=await redeemWorkerGrant(f.pool,otherGrant.token,options);
    server=createPostgresRehearsalServer(f.pool,{...options,storage,tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020'});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/api/worker/briefings/${assignment}`;
    const call=(path,token,headers={})=>fetch(`${base}${path}`,{headers:{...headers,...(token ? {cookie:`understood_pg_rehearsal=${token}`} : {})}});
    assert.equal((await call('/speech/body')).status,401);
    assert.equal((await call('/speech/body',other.token)).status,404);
    assert.equal((await call('/speech/body?worker=other',signed.token)).status,404);
    for(const kind of ['body','question']) {
      const response=await call(`/speech/${kind}`,signed.token);
      assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');
      assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      assert.equal(response.headers.get('referrer-policy'),'no-referrer');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),value.audio.find(row=>row.id===value.manifest.languages.en.speech[kind].id).bytes);
      const bytes=value.audio.find(row=>row.id===value.manifest.languages.en.speech[kind].id).bytes;
      assert.equal(response.headers.get('accept-ranges'),'bytes');
      for(const [range,start,end] of [['bytes=0-43',0,43],['bytes=44-',44,bytes.length-1],['bytes=-12',bytes.length-12,bytes.length-1]]){
        const partial=await call(`/speech/${kind}`,signed.token,{range});assert.equal(partial.status,206);
        assert.equal(partial.headers.get('content-range'),`bytes ${start}-${end}/${bytes.length}`);assert.equal(partial.headers.get('cache-control'),'no-store');
        assert.deepEqual(Buffer.from(await partial.arrayBuffer()),bytes.subarray(start,end+1));
      }
      const invalid=await call(`/speech/${kind}`,signed.token,{range:`bytes=${bytes.length}-`});assert.equal(invalid.status,416);
      assert.equal(invalid.headers.get('content-range'),`bytes */${bytes.length}`);assert.equal((await invalid.arrayBuffer()).byteLength,0);
    }
    for(const [token,status] of [[undefined,401],[other.token,404]]){
      const denied=await call('/speech/body',token,{range:'bytes=0-43'});assert.equal(denied.status,status);assert.equal(denied.headers.get('content-range'),null);
    }
    const dto=await (await call('',signed.token)).json();assert.ok(dto.speechUrls.body);
    storage.objects.get(value.audio[0].id).writeInt16LE(10,44);
    const corrupt=await call('/speech/body',signed.token);assert.equal(corrupt.status,404);
    assert.deepEqual(await corrupt.json(),{error:'Generated audio unavailable'});
    assert.equal((await call('/speech/body',signed.token,{range:'bytes=0-43'})).status,404);
  }finally {if(server) await new Promise(resolve=>server.close(resolve));await f.close();}
});

test('generated preparation fails truthfully on unsupported speech or provider failure, without demo fallback',async()=>{
  for(const failure of ['speech','unsupported']) {
    const f=await fixture(),storage=memoryStore(),adapter=syntheticAdapter();
    try {
      await f.db.query("UPDATE jobs SET status='queued',lease_token=NULL,lease_until=NULL");
      if(failure==='speech') adapter.speech=async()=>{throw Error('provider failed with secret body');};
      assert.equal(await processOnePreparation(f.pool,{...options,integrationMode:'synthetic',adapter,storage,languages:failure==='unsupported' ? ['en','ur'] : ['en']}),true);
      const draft=(await f.db.query('SELECT state,prepared_json FROM briefings')).rows[0];
      assert.equal(draft.state,'failed');assert.equal(draft.prepared_json,null);
      assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM generated_bundles')).rows[0].n,0);
      assert.equal(storage.saves,0);assert.equal((await f.db.query('SELECT status FROM jobs')).rows[0].status,'failed');
    }finally {await f.close();}
  }
});

test('manifest validation binds exact text, hashes, language, audio and jsonb-independent dependencies',async()=>{
  const original=await bundle(),roundtrip=JSON.parse(JSON.stringify(original.manifest));
  roundtrip.dependencies=Object.fromEntries(Object.entries(roundtrip.dependencies).reverse());
  assert.equal(bundleHash(roundtrip),bundleHash(original.manifest));assert.equal(preparedAudioReferences(roundtrip).length,2);
  const checked=checkedPreparedBundle(original);original.audio[0].bytes.fill(0);
  assert.notDeepEqual(checked.audio[0].bytes,original.audio[0].bytes);
  for(const mutate of [m=>{m.languages.en.speech.body.textHash='bad';},m=>{m.languages.en.text='Changed';},m=>{m.dependencies.revision=2;},
    m=>{m.languages.en.speech.question.id=m.languages.en.speech.body.id;},m=>{m.rubric.askedFacts=['Invented'];},m=>{delete m.languages.en.speech.question;},
    m=>{m.checks.translations.ar='passed';},m=>{m.languages.en.speech.body.durationSeconds=0;}]) {
    const manifest=structuredClone(roundtrip);mutate(manifest);assert.throws(()=>preparedAudioReferences(manifest));
  }
  assert.throws(()=>checkedPreparedBundle(original),/preparation/);
});

test('PostgreSQL generated audio journals immutable scoped refs, persists real private files and replays without rewrites',async()=>{
  const f=await fixture(),root=await mkdtemp(join(tmpdir(),'understood-generated-'));
  try {
    const value=await bundle(),id=randomUUID(),storage=localAudioStore(root);
    const receipt=await stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id});
    assert.equal(receipt.state,'stored');assert.equal(receipt.manifestHash,bundleHash(value.manifest));assert.equal(receipt.duplicate,false);
    assert.equal((await readdir(root)).length,2);
    for(const row of (await f.db.query('SELECT * FROM generated_audio')).rows) assert.deepEqual(await storage.read(row),value.audio.find(item=>item.id===row.id).bytes);
    assert.equal((await f.db.query("SELECT state,prepared_json FROM briefings WHERE id='brief'")).rows[0].state,'processing');
    assert.equal((await f.db.query("SELECT state,prepared_json FROM briefings WHERE id='brief'")).rows[0].prepared_json,null);
    assert.equal((await stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id})).duplicate,true);
    assert.equal((await f.db.query("SELECT COUNT(*)::int n FROM audit WHERE action='briefing.audio_staged'")).rows[0].n,1);
    await assert.rejects(f.db.query("UPDATE generated_audio SET text_hash=repeat('0',64)"),/immutable/);
    await assert.rejects(f.db.query("UPDATE generated_bundles SET manifest_json='{}'"),/immutable/);
    await assert.rejects(f.db.query("UPDATE generated_bundles SET state='storing'"),/transition/);
    await assert.rejects(f.db.query("UPDATE generated_bundles SET site_id='b'"),/immutable/);
    await assert.rejects(f.db.query('DELETE FROM generated_audio'),/immutable/);
    await assert.rejects(f.db.query('DELETE FROM generated_bundles'),/immutable/);
    await assert.rejects(f.db.query("UPDATE generated_bundles SET stored_at=clock_timestamp()"),/immutable/);
    await assert.rejects(f.db.query(`INSERT INTO generated_audio(id,bundle_id,org_id,site_id,language,text_hash,sha256,bytes,duration_seconds)
      SELECT $1,bundle_id,'b','b',language,repeat('0',64),sha256,bytes,duration_seconds FROM generated_audio LIMIT 1`,[randomUUID()]),error=>error.code==='23503');
    await assert.rejects(f.db.query(`INSERT INTO generated_bundles(id,org_id,site_id,briefing_id,revision,job_id,job_lease,manifest_json,manifest_hash,dependency_hash,state,stored_at)
      SELECT $1,'b','b',briefing_id,revision,job_id,$2,manifest_json,manifest_hash,dependency_hash,state,stored_at FROM generated_bundles LIMIT 1`,[randomUUID(),randomUUID()]),error=>error.code==='23503');
  }finally {await f.close();await rm(root,{recursive:true,force:true});}
});

test('stale, forged-scope and changed dependency claims cannot reserve or write audio',async()=>{
  const f=await fixture(),value=await bundle(),storage=memoryStore();
  try {
    for(const patch of [{token:randomUUID()},{revision:2},{org_id:'b',site_id:'b'},{briefing_id:'missing'}])
      await assert.rejects(stagePreparedBundle(f.pool,{...f.job,...patch},value,storage,{...options,bundleId:randomUUID()}),/not durably accepted/);
    await f.db.query("INSERT INTO draft_reviews(briefing_id,org_id,site_id,content_json) VALUES('brief','a','a',$1)",[JSON.stringify({revision:1,question:'Changed?',facts:[],askedFacts:[]})]);
    await assert.rejects(stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:randomUUID()}),/not durably accepted/);
    assert.equal(storage.saves,0);assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM generated_bundles')).rows[0].n,0);
  }finally {await f.close();}
});

test('unknown object/database acknowledgements reconcile exact bytes without deleting accepted audio',async()=>{
  const f=await fixture(),value=await bundle(),storage=memoryStore(),id=randomUUID();
  try {
    storage.onSave(async()=>{throw Error('secret storage acknowledgement lost');});
    const receipt=await stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id});
    assert.equal(receipt.state,'stored');assert.equal(storage.saves,2);assert.equal(storage.removes,0);
    await assert.rejects(stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:randomUUID()}),/not durably accepted/);
  }finally {await f.close();}
  const g=await fixture(),next=await bundle(),store=memoryStore();
  try {
    store.onRead(async row=>{if(store.objects.size===2 && row.id===next.audio[1].id) g.loseNextCommit();});
    const receipt=await stagePreparedBundle(g.pool,g.job,next,store,{...options,bundleId:randomUUID()});
    assert.equal(receipt.state,'stored');assert.equal(receipt.duplicate,true);assert.equal(store.removes,0);
    assert.equal((await g.db.query("SELECT COUNT(*)::int n FROM audit WHERE action='briefing.audio_staged'")).rows[0].n,1);
  }finally {await g.close();}
});

test('failed readback and audit leave durable staging for exact retry, never technical readiness',async()=>{
  const f=await fixture(),value=await bundle(),storage=memoryStore(),id=randomUUID();
  try {
    let unavailable=true;storage.onRead(async()=>{if(unavailable) throw Error('secret readback unavailable');});
    await assert.rejects(stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id}),/not durably accepted/);
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'storing');assert.equal(storage.objects.size,1);
    unavailable=false;f.setFail('INSERT INTO audit');
    await assert.rejects(stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id}),/not durably accepted/);
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'storing');assert.equal(storage.objects.size,2);
    f.setFail('');assert.equal((await stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id})).state,'stored');
    assert.equal(storage.saves,2);assert.equal(storage.removes,0);
  }finally {await f.close();}
});

test('revision changes during storage fence completion and orphan cleanup is leased and retryable',async()=>{
  const f=await fixture(),value=await bundle(),storage=memoryStore(),id=randomUUID();
  try {
    storage.onSave(async()=>{await f.db.query("UPDATE briefings SET revision=2,state='draft' WHERE id='brief'");});
    await assert.rejects(stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id}),/not durably accepted/);
    assert.equal(storage.objects.size,1);assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'storing');
    await f.db.query("UPDATE generated_bundles SET expires_at=clock_timestamp()-interval '1 second'");
    assert.equal(await expireGeneratedBundle(f.pool,storage,options),false);
    await f.db.query("UPDATE jobs SET status='failed',lease_token=NULL,lease_until=NULL");
    let failed=true;storage.onRemove(async()=>{if(failed) throw Error('Private removal failed');});
    assert.equal(await expireGeneratedBundle(f.pool,storage,options),true);assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'cleaning');
    assert.equal(await expireGeneratedBundle(f.pool,storage,options),false);
    failed=false;await f.db.query("UPDATE generated_bundles SET cleanup_until=clock_timestamp()-interval '1 second'");
    assert.equal(await expireGeneratedBundle(f.pool,storage,options),true);assert.equal(storage.objects.size,0);
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'cleaned');
    assert.equal(await expireGeneratedBundle(f.pool,storage,options),false);
    assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM generated_audio')).rows[0].n,2);
  }finally {await f.close();}
});

test('attached audio is protected from orphan expiry and cleanup cannot revive a completed bundle',async()=>{
  const f=await fixture(),value=await bundle(),storage=memoryStore();
  try {
    await stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:randomUUID()});
    await f.db.query("UPDATE generated_bundles SET state='attached',expires_at=clock_timestamp()-interval '1 second'");
    await f.db.query("UPDATE jobs SET status='ready',lease_token=NULL,lease_until=NULL");
    assert.equal(await expireGeneratedBundle(f.pool,storage,options),false);assert.equal(storage.removes,0);
    await assert.rejects(f.db.query("UPDATE generated_bundles SET state='cleaning',cleanup_token='fake',cleanup_until=clock_timestamp()"),/transition/);
  }finally {await f.close();}
});

test('generated retention is independently disabled, confirmed, actor scoped and exact replayable',async()=>{
  const f=await fixture();
  try {
    await audience(f);
    await f.db.exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('admin','a','a','Admin','administrator'),('super','a','a','Supervisor','supervisor'),('foreign-owner','b','b','Foreign','owner')");
    const change={requestId:randomUUID(),revision:0,days:7,confirmed:true};
    assert.equal((await getGeneratedRetention(f.pool,owner,options)).days,null);
    assert.match((await getGeneratedRetention(f.pool,owner,options)).recoveryScope,/^generated:/);
    assert.equal((await getGeneratedRetention(f.pool,{...owner,principal_id:'super',role:'supervisor'},options)).canWrite,false);
    assert.throws(()=>saveGeneratedRetention(f.pool,owner,{...change,confirmed:false},options),/Invalid text retention/);
    await assert.rejects(saveGeneratedRetention(f.pool,worker,change,options),/Forbidden/);
    await assert.rejects(saveGeneratedRetention(f.pool,{...owner,principal_id:'super',role:'supervisor'},change,options),/Forbidden/);
    assert.deepEqual(await saveGeneratedRetention(f.pool,owner,change,options),{revision:1,duplicate:false});
    assert.deepEqual(await saveGeneratedRetention(f.pool,owner,change,options),{revision:1,duplicate:true});
    assert.equal((await generatedRetentionReceipt(f.pool,owner,change.requestId,options)).request.days,7);
    assert.equal(await generatedRetentionReceipt(f.pool,{...owner,principal_id:'admin',role:'administrator'},change.requestId,options),null);
    await assert.rejects(saveGeneratedRetention(f.pool,owner,{...change,days:30},options),/request conflict/);
    await assert.rejects(saveGeneratedRetention(f.pool,{...owner,org_id:'b',site_id:'b',principal_id:'foreign-owner'},change,options),/request conflict/);
    await assert.rejects(saveGeneratedRetention(f.pool,owner,{...change,requestId:randomUUID()},options),/revision changed/);
    await assert.rejects(f.db.exec('DELETE FROM generated_retention_requests'),/immutable/);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM retention_policies')).rows[0].n,0);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM text_retention_policies')).rows[0].n,0);
    f.setFail('INSERT INTO audit');
    await assert.rejects(saveGeneratedRetention(f.pool,owner,{...change,requestId:randomUUID(),revision:1,days:null},options));
    f.setFail('');assert.equal((await getGeneratedRetention(f.pool,owner,options)).revision,1);
  }finally{await f.close();}
});

test('explicit generated retention retires published audio without changing snapshots; absence and audit gate physical completion',async()=>{
  const f=await fixture(),storage=memoryStore();
  try {
    await audience(f);const {id}=await ready(f,storage);
    const request={requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker']};
    const pub=await publish(f.pool,owner,'brief',request,{...options,integrationMode:'synthetic',storage});
    const assignment=(await f.db.query('SELECT id FROM assignments')).rows[0].id;
    const snapshot=(await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json;
    assert.ok((await workerBriefing(f.pool,worker,assignment,options)).speechUrls);
    await saveGeneratedRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:7,confirmed:true},options);
    assert.equal(await retireOneGeneratedBundle(f.pool,options),false);
    // Authored historical storage dates isolate expiry; normal clocks cannot be revised.
    await f.db.exec("ALTER TABLE generated_bundles DISABLE TRIGGER generated_bundle_frozen;UPDATE generated_bundles SET stored_at=clock_timestamp()-interval '8 days';ALTER TABLE generated_bundles ENABLE TRIGGER generated_bundle_frozen");
    await assert.rejects(f.db.exec('UPDATE generated_bundles SET stored_at=clock_timestamp()'),/immutable/);
    f.setFail('INSERT INTO audit');await assert.rejects(retireOneGeneratedBundle(f.pool,options));f.setFail('');
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'attached');
    assert.equal((await getGeneratedRetention(f.pool,owner,options)).completed.retired,0);
    assert.equal(await retireOneGeneratedBundle(f.pool,options),true);
    assert.equal(await retireOneGeneratedBundle(f.pool,options),false);
    assert.equal(storage.removes,0);
    assert.equal((await workerBriefing(f.pool,worker,assignment,options)).speechUrls,undefined);
    await assert.rejects(getAssignmentSpeech(f.pool,worker,assignment,'body',storage,options),/Generated bundle unavailable/);
    const detail=await getBriefing(f.pool,owner,'brief',options);
    assert.equal(detail.publications[0].artifactAudio,null);assert.deepEqual(detail.publications[0].snapshot,snapshot);
    assert.deepEqual((await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json,snapshot);
    assert.equal((await publish(f.pool,owner,'brief',request,{...options,integrationMode:'synthetic',storage})).duplicate,true);
    await assert.rejects(f.db.exec("UPDATE generated_bundles SET state='attached',cleanup_token=NULL,cleanup_until=NULL"),/transition/);
    await assert.rejects(f.db.exec('DELETE FROM generated_audio_retirements'),/immutable/);
    await saveGeneratedRetention(f.pool,owner,{requestId:randomUUID(),revision:1,days:null,confirmed:true},options);
    const remove=storage.remove;storage.remove=async()=>{};
    assert.equal(await expireGeneratedBundle(f.pool,storage,options),true);
    assert.equal((await getGeneratedRetention(f.pool,owner,options)).completed.removed,0);
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'cleaning');
    storage.remove=remove;await f.db.exec("UPDATE generated_bundles SET cleanup_until=clock_timestamp()-interval '1 second'");
    f.setFail('INSERT INTO audit');assert.equal(await expireGeneratedBundle(f.pool,storage,options),true);f.setFail('');
    assert.equal(storage.objects.size,0);assert.equal((await getGeneratedRetention(f.pool,owner,options)).completed.removed,0);
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'cleaning');
    await f.db.exec("UPDATE generated_bundles SET cleanup_until=clock_timestamp()-interval '1 second'");
    assert.equal(await expireGeneratedBundle(f.pool,storage,options),true);
    assert.equal((await getGeneratedRetention(f.pool,owner,options)).completed.removed,1);
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'cleaned');
    assert.equal((await f.db.query('SELECT bundle_id FROM generated_audio_removals')).rows[0].bundle_id,id);
    await assert.rejects(f.db.exec('DELETE FROM generated_audio_removals'),/immutable/);
    assert.deepEqual((await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json,snapshot);
  }finally{await f.close();}
});

test('lost reservation acknowledgement leaves a recoverable journal before any object write',async()=>{
  const f=await fixture(),value=await bundle(),storage=memoryStore(),id=randomUUID();
  try {
    f.loseNextCommit();await assert.rejects(stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id}),/not durably accepted/);
    assert.equal(storage.saves,0);assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'storing');
    assert.equal((await stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id})).state,'stored');assert.equal(storage.saves,2);
  }finally {await f.close();}
});

test('corrupt readback cannot be overwritten and a stale cleanup owner cannot finish',async()=>{
  const f=await fixture(),value=await bundle(),storage=memoryStore(),id=randomUUID();
  try {
    storage.onSave(async row=>{storage.objects.get(row.id).writeInt16LE(1234,44);});
    await assert.rejects(stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id}),/not durably accepted/);
    const original=Buffer.from(storage.objects.get(value.audio[0].id));storage.onSave(null);
    await assert.rejects(stagePreparedBundle(f.pool,f.job,value,storage,{...options,bundleId:id}),/not durably accepted/);
    assert.deepEqual(storage.objects.get(value.audio[0].id),original);assert.equal(storage.removes,0);
    await f.db.query("UPDATE jobs SET status='failed',lease_token=NULL,lease_until=NULL");
    await f.db.query("UPDATE generated_bundles SET expires_at=clock_timestamp()-interval '1 second'");
    storage.onRemove(async()=>{await f.db.query("UPDATE generated_bundles SET cleanup_token='newer-cleanup'");});
    assert.equal(await expireGeneratedBundle(f.pool,storage,options),true);
    assert.equal((await f.db.query('SELECT state,cleanup_token FROM generated_bundles')).rows[0].state,'cleaning');
    assert.equal(storage.removes,1);
    storage.onRemove(null);await f.db.query("UPDATE generated_bundles SET cleanup_until=clock_timestamp()-interval '1 second'");
    assert.equal(await expireGeneratedBundle(f.pool,storage,options),true);
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'cleaned');
  }finally {await f.close();}
});
