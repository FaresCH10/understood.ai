import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {startInstructionSend,completeInstructionSend,instructionSendPreflight} from '../server/postgres/instructions.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {workerBriefing} from '../server/postgres/read-models.mjs';
import {getAssignmentSpeech} from '../server/postgres/generated-audio.mjs';
import {syntheticInstructionPrepare} from '../server/instruction-prep.mjs';
import {instructionReadiness} from '../server/instruction-readiness.mjs';
import {questionWithChoices} from '../server/ai/prepared-bundle.mjs';
const source='Put finished items on the blue shelf. Keep the walkway clear.';
const speechBytes=()=>{const b=Buffer.alloc(32044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);b.writeInt16LE(1000,44);return b;};
for(const [responseMode,deliveryMode,verifyOkay=true] of [['question','both'],['acknowledge','both'],['question','voice'],['question','both',false]])test(`Groq ${responseMode}/${deliveryMode} verified=${verifyOkay} delivery stores private English/Arabic tracks and exposes scoped playback`,async()=>{
 const db=new PGlite(),schema='understood_test_groq_voice';let queue=Promise.resolve();const pool={async connect(){const previous=queue;let release;queue=new Promise(done=>{release=done;});await previous;return {release,query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]}};}};
 const objects=new Map(),storage={save:async(row,bytes)=>{objects.set(row.id,Buffer.from(bytes));},read:async row=>{if(!objects.has(row.id))throw Error('Missing');return Buffer.from(objects.get(row.id));},remove:async row=>{objects.delete(row.id);}};
 const calls=[],speech={languages:['en','ar'],maxCharacters:1000,label:'Groq Orpheus',async speech(text,language){calls.push({text,language});return speechBytes();}};
 let verified=0;
 const text={async verifySpeech(){verified++;return verifyOkay;},textLanguages:['en','ar'],speechLanguages:['en','ar'],speechMaxCharacters:1000,speechProviderLabel:'Groq Orpheus',normalizesSource:true,provenanceAdapter:'nemotron-ultra-instruction-v1',model:'fixture-text',async prepare(briefing,instruction){return syntheticInstructionPrepare(briefing,instruction);},async translate(language,content){return {title:'تعليمات الرف',text:'ضع العناصر المكتملة على الرف الأزرق. أبق الممر خالياً.',...(responseMode==='question'?{question:'أين يجب وضع العناصر المكتملة؟',questionType:'multiple-choice',choices:content.choices.map((c,i)=>({id:c.id,text:['على الرف الأزرق','على الرف الأصفر','على الرف الأحمر','على الرف الأخضر'][i]}))}:{})};}};
 const owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'};
 try{
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
  await db.exec("INSERT INTO organizations VALUES('org','Synthetic');INSERT INTO sites VALUES('site','org','Synthetic','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','Owner','owner');INSERT INTO workers(id,org_id,site_id,code,language) VALUES('english','org','site','001','en'),('arabic','org','site','002','ar'),('russian','org','site','003','ru');");
  assert.deepEqual(instructionReadiness({instructionTextAdapter:text},source).speechLanguages,['en','ar']);assert.deepEqual(instructionReadiness({instructionTextAdapter:text},'x'.repeat(1001)).speechLanguages,[]);
  const input={requestId:randomUUID(),title:'Shelf instruction',source,audience:{type:'all'},responseMode,deliveryMode},options={schema,integrationMode:'synthetic',storage};
  const preflight=await instructionSendPreflight(pool,owner,input,{schema,instructionTextAdapter:text});assert.equal(preflight.ready,2);
  const started=await startInstructionSend(pool,owner,input,{schema});
  await processOnePreparation(pool,{...options,briefingId:started.briefingId,instructionTextAdapter:text,instructionSpeechAdapter:speech});
  const draft=(await db.query('SELECT state,prepared_json FROM briefings WHERE id=$1',[input.requestId])).rows[0];if(!verifyOkay){assert.equal(draft.state,'failed');assert.equal(objects.size,0);assert.equal(calls.length,0);return;}assert.equal(draft.state,'ready');assert.equal(verified,1);assert.equal(objects.size,4);
  const result=await completeInstructionSend(pool,owner,input.requestId,options);assert.equal(result.state,'published');assert.equal(result.delivered,2);assert.equal(result.undelivered,1);
  for(const workerId of ['english','arabic']){
   const assignment=(await db.query('SELECT id FROM assignments WHERE worker_id=$1',[workerId])).rows[0].id,worker={principal_type:'worker',principal_id:workerId,org_id:'org',site_id:'site'};
   const detail=await workerBriefing(pool,worker,assignment,{schema});assert.match(detail.speechUrls.body,/\/speech\/body$/);assert.equal(detail.content.speech,null);assert.equal(detail.responseMode,responseMode);
   const bytes=await getAssignmentSpeech(pool,worker,assignment,'body',storage,{schema});assert.deepEqual(bytes,speechBytes());
   await assert.rejects(getAssignmentSpeech(pool,{...worker,principal_id:'russian'},assignment,'body',storage,{schema}),/unavailable/);
   if(responseMode==='question'){assert.equal(detail.speechUrls.includesChoices,true);assert.ok(calls.some(c=>c.language===detail.language&&c.text===questionWithChoices(draft.prepared_json.languages[detail.language])));}
   else assert.equal(detail.content.question,undefined);
  }
 }finally{await db.close();}
});
