import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {startInstructionSend,processOneInstructionSend,completeInstructionSend} from '../server/postgres/instructions.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {workerBriefing} from '../server/postgres/read-models.mjs';
import {getAssignmentSpeech} from '../server/postgres/generated-audio.mjs';
import {submitAnswer} from '../server/postgres/domain.mjs';
import {processOneAssessment} from '../server/postgres/assessment-worker.mjs';
import {listNotifications} from '../server/postgres/notifications.mjs';
import {getLanguageReadiness} from '../server/postgres/language-readiness.mjs';
import {checkedPreparedBundle} from '../server/ai/prepared-bundle.mjs';
import {encodeWav} from '../src/audio.ts';

const owner={org_id:'a',site_id:'a',principal_type:'staff',principal_id:'owner',role:'owner'};
const source='Put finished items on the blue shelf. Keep the walkway clear.';
const facts=['Put finished items on the blue shelf.','Keep the walkway clear.'];
const samples={en:'Blue shelf',ar:'الرف الأزرق',hi:'नीली शेल्फ',ur:'نیلی شیلف',bn:'নীল তাক',ml:'നീല ഷെൽഫ്',ta:'நீல அலமாரி',te:'నీలం షెల్ఫ్',ne:'नीलो दराज',fil:'Asul na istante',si:'නිල් රාක්කය',ru:'Синяя полка','pa-Guru':'ਨੀਲੀ ਸ਼ੈਲਫ','pa-Arab':'نیلی شیلف',id:'Rak biru'};
const audio=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(.2)}));
async function fixture(){
  const db=new PGlite();
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};}};
  await runMigrations(pool);
  await db.exec("INSERT INTO organizations(id,name) VALUES('a','Synthetic');INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','Synthetic','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner');");
  for(const [index,language] of WORKER_LANGUAGE_CODES.entries())await db.query('INSERT INTO workers(id,org_id,site_id,code,language) VALUES($1,$2,$3,$4,$5)',[`w${index}`,'a','a',`Worker ${index}`,language]);
  const objects=new Map();let onRead;
  const storage={async save(row,bytes){objects.set(row.id,Buffer.from(bytes));},async read(row){await onRead?.(row);if(!objects.has(row.id))throw Error('Missing audio');return Buffer.from(objects.get(row.id));},async remove(row){objects.delete(row.id);}};
  const adapter={provenance:{adapter:'synthetic-language-fixture',dataClass:'synthetic',textModel:'fixture',speechModel:'fixture',voice:'fixture',promptVersion:'v1',schemaVersion:'v1'},
    capabilities:{textLanguages:WORKER_LANGUAGE_CODES,speechLanguages:WORKER_LANGUAGE_CODES},
    async prepare(){return {title:'Shelf handover',question:'Where should finished items go and what must stay clear?',facts,askedFacts:facts};},
    async checkPreparation(){return {sourceGrounded:true,questionAligned:true,ambiguous:false,factEvidence:facts.map((quote,factIndex)=>({factIndex,quote})),askedFactIndexes:[0,1],reasons:[]};},
    async translate(_,language){return {title:samples[language],text:samples[language],question:samples[language]+'?'};},
    async checkTranslation(){return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};},async speech(){return audio;}};
  return {db,pool,storage,objects,adapter,onRead(fn){onRead=fn;},close:()=>db.close()};
}
const sendInput=(extra={})=>({requestId:randomUUID(),title:'Shelf handover',source,audience:{type:'all'},responseMode:'question',deliveryMode:'both',...extra});
async function prepare(f,input){await startInstructionSend(f.pool,owner,input);assert.equal(await processOnePreparation(f.pool,{integrationMode:'synthetic',adapter:f.adapter,storage:f.storage}),true);}

test('normal Send delivers checked content, private speech and frozen choices for all 15 worker locales',async()=>{
  const f=await fixture(),input=sendInput();try{
    await prepare(f,input);
    const draft=(await f.db.query('SELECT prepared_json,state FROM briefings WHERE id=$1',[input.requestId])).rows[0];
    assert.equal(draft.state,'ready');assert.deepEqual(draft.prepared_json.dependencies.languages,WORKER_LANGUAGE_CODES);
    assert.equal(draft.prepared_json.rubric.mode,'multiple-choice');
    const {artifactBundle,...manifest}=draft.prepared_json;
    checkedPreparedBundle({manifest,audio:[...f.objects].map(([id,bytes])=>{
      const ref=Object.entries(manifest.languages).flatMap(([language,item])=>Object.values(item.speech).map(ref=>({...ref,language}))).find(ref=>ref.id===id);
      return {id,bytes,language:ref.language,textHash:ref.textHash};
    })});
    assert.equal(await processOneInstructionSend(f.pool,{storage:f.storage}),true);
    const result=await completeInstructionSend(f.pool,owner,input.requestId,{storage:f.storage});
    assert.equal(result.state,'published');assert.equal(result.delivered,15);assert.equal(result.undelivered,0);
    const snapshot=(await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[result.publicationId])).rows[0].snapshot_json;
    assert.equal(snapshot.artifactBundle.id,artifactBundle.id);assert.equal(snapshot.responseMode,'question');assert.equal(snapshot.deliveryMode,'both');
    const readiness=await getLanguageReadiness(f.pool,owner,{storage:f.storage});
    assert.ok(readiness.languages.every(language=>[language.ui,language.content,language.translation,language.speech].every(stage=>stage.state==='ready')));
    assert.equal(readiness.tests.speech.state,'not_tested');
    assert.ok((await getLanguageReadiness(f.pool,owner)).languages.some(language=>language.speech.state!=='ready'));
    const assignments=(await f.db.query('SELECT id,worker_id,language FROM assignments WHERE publication_id=$1 ORDER BY worker_id',[result.publicationId])).rows;
    for(const assignment of assignments){
      const worker={...owner,role:undefined,principal_type:'worker',principal_id:assignment.worker_id};
      const detail=await workerBriefing(f.pool,worker,assignment.id);
      assert.equal(detail.content.questionType,'multiple-choice');assert.equal(detail.content.choices.length,4);
      assert.ok(!JSON.stringify(detail).includes('correctChoiceId'));assert.ok(detail.speechUrls.body);assert.ok(detail.speechUrls.question);
      assert.deepEqual(await getAssignmentSpeech(f.pool,worker,assignment.id,'body',f.storage),audio);
      const id=assignment.worker_id==='w0'?detail.content.choices.find(choice=>choice.id!==snapshot.rubric.correctChoiceId).id:snapshot.rubric.correctChoiceId;
      await submitAnswer(f.pool,worker,assignment.id,randomUUID(),id);
    }
    for(let count=0;count<15;count++)assert.equal(await processOneAssessment(f.pool,{async assess(){assert.fail('Frozen choices must be graded without a provider guess');}}),true);
    assert.deepEqual((await f.db.query('SELECT outcome,count(*)::int AS n FROM attempts GROUP BY outcome ORDER BY outcome')).rows,[{outcome:'clarification',n:1},{outcome:'matched',n:14}]);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM clarifications')).rows[0].n,1);
    const notifications=await listNotifications(f.pool,owner,{status:'unread'});
    assert.ok(notifications.unread>0);assert.ok(notifications.items.some(item=>item.kind==='answer.needs_attention'));
  }finally{await f.close();}
});

test('generated sends do not publish corrupt audio or a revoked supervisor after private readback',async()=>{
  for(const failure of ['bytes','authority']){
    const f=await fixture(),input=sendInput();try{
      await prepare(f,input);
      if(failure==='bytes')f.objects.set(f.objects.keys().next().value,Buffer.from('corrupt'));
      else {let changed=false;f.onRead(async()=>{if(!changed){changed=true;await f.db.exec("UPDATE staff SET active=false WHERE id='owner'");}});}
      await assert.rejects(completeInstructionSend(f.pool,owner,input.requestId,{storage:f.storage}));
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM publications')).rows[0].n,0);
      assert.equal((await f.db.query('SELECT state FROM instruction_sends')).rows[0].state,'preparing');
    }finally{await f.close();}
  }
});

test('generated acknowledgment sends preserve modes and do not expose response questions',async()=>{
  const f=await fixture(),input=sendInput({responseMode:'acknowledge',deliveryMode:'voice'});try{
    await prepare(f,input);
    const result=await completeInstructionSend(f.pool,owner,input.requestId,{storage:f.storage});
    assert.equal(result.delivered,15);
    const assignment=(await f.db.query("SELECT id FROM assignments WHERE worker_id='w0'")).rows[0];
    const detail=await workerBriefing(f.pool,{...owner,principal_type:'worker',principal_id:'w0'},assignment.id);
    assert.equal(detail.responseMode,'acknowledge');assert.equal(detail.deliveryMode,'voice');assert.equal(detail.content.question,undefined);assert.equal(detail.content.choices,undefined);
  }finally{await f.close();}
});
