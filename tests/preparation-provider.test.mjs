import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createDraft,queuePreparation,editDraft} from '../server/postgres/preparation.mjs';
import {readGlossarySnapshot} from '../server/postgres/glossary.mjs';
import {rehearsalTasks} from '../server/postgres/runtime.mjs';
import {publish,submitAnswer} from '../server/postgres/domain.mjs';
import {getAssignmentSpeech} from '../server/postgres/generated-audio.mjs';
import {resolvePreparationAdapter,preparationInputHash} from '../server/ai/preparation-config.mjs';
import {GEMINI_MODELS} from '../server/ai/gemini.mjs';
import {encodeWav} from '../src/audio.ts';
import {readPreparationFingerprint} from '../server/postgres/preparation-fingerprint.mjs';
import {resolveAssessmentAdapter,assessmentInputHash} from '../server/ai/assessment-config.mjs';
import {bundleHash} from '../server/ai/prepared-bundle.mjs';
import {regenerateDraftTarget} from '../server/postgres/regeneration.mjs';
import {getProcessingProvenance} from '../server/postgres/processing-provenance.mjs';
import {checkedProviderHistory} from '../src/processing-provenance.ts';

const env={UNDERSTOOD_PREPARATION_ADAPTER:'gemini-free',UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_DATA_CLASS:'synthetic',GEMINI_API_KEY:'test-only'};
const source='Finished items go on blue. Unfinished items go on yellow.',facts=['Finished items go on blue.','Unfinished items go on yellow.'];
const owner={org_id:'a',site_id:'a',principal_type:'staff',principal_id:'owner',role:'owner'};
const audio=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(0.2)}));
async function fixture(languages=['en','ar'],sourceText=source) {
  const db=new PGlite(),pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  await runMigrations(pool);
  await db.exec(`INSERT INTO organizations VALUES('a','Synthetic');INSERT INTO sites VALUES('a','a','Synthetic','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w','a','a','001','ar');
    INSERT INTO provider_policies(scope_key,org_id,revision,enabled,max_daily_requests) VALUES('global',NULL,1,true,30),('tenant:a','a',1,true,30);`);
  const objects=new Map(),storage={async save(row,bytes){objects.set(row.id,Buffer.from(bytes));},async read(row){if(!objects.has(row.id))throw Error('No object');return objects.get(row.id);},async remove(row){objects.delete(row.id);}};
  const draft=await createDraft(pool,owner,{requestId:randomUUID(),title:'Synthetic instructions',source:sourceText,generationLanguages:languages});
  const glossary=await readGlossarySnapshot({query:(sql,args)=>db.query(sql,args)},'a','a');
  const input={source:sourceText,title:'Synthetic instructions',revision:1,languages,review:null,glossary};
  const queued=await queuePreparation(pool,owner,draft.id,1);
  return {db,pool,storage,objects,draft,queued,input,close:()=>db.close()};
}
function adapterFor(input,calls,onCall=async()=>{},content={title:'Shelves',facts,question:'Where do both items go?',askedFacts:facts,
  translation:{title:'تعليمات الرفوف',text:'ضع العناصر المكتملة على الرف الأزرق وغير المكتملة على الرف الأصفر.',question:'أين ستضع العناصر المكتملة وغير المكتملة؟'}}) {
  return resolvePreparationAdapter({...env,UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([preparationInputHash(input)])},{fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body});await onCall(calls.length);
    if(body.model===GEMINI_MODELS.speech)return Response.json({status:'completed',model:GEMINI_MODELS.speech,steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:audio.toString('base64')}]}]});
    const fields=body.generationConfig.responseFormat.text.schema.properties;
    const result=fields.askedFacts?{title:content.title,facts:content.facts,question:content.question,askedFacts:content.askedFacts}
      :fields.factEvidence?{sourceGrounded:true,questionAligned:true,ambiguous:false,factEvidence:content.facts.map((quote,factIndex)=>({factIndex,quote})),askedFactIndexes:content.askedFacts.map(fact=>content.facts.indexOf(fact)),reasons:[]}
      :fields.faithful?{faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]}
      :content.translation;
    if(fields.choices)result.choices=[content.askedFacts.join(' '),'Put finished items on yellow and unfinished items on blue.','Keep the walkway blocked.','Put finished items on red and unfinished items on green.'];
    if(fields.choicesAligned)result.choicesAligned=true;
    if(fields.answerChoices)result.answerChoices=[content.translation.text,'ضع العناصر المكتملة على الرف الأصفر وغير المكتملة على الرف الأزرق.','أبق الممر مغلقاً.','ضع العناصر المكتملة على الرف الأحمر وغير المكتملة على الرف الأخضر.'];
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}]});
  }});
}
const stage=(f,adapter)=>rehearsalTasks(f.pool,f.storage,{schema:'public',preparationAdapter:adapter}).preparation();

test('preparation provider is default-off and requires exact bounded synthetic input fingerprints',()=>{
  const fetchImpl=()=>assert.fail('Unexpected call'),hash='a'.repeat(64);
  assert.equal(resolvePreparationAdapter({GEMINI_API_KEY:'present'},{fetchImpl}),undefined);
  for(const patch of [{UNDERSTOOD_TIER:'staging'},{UNDERSTOOD_TIER:'production'},{UNDERSTOOD_DATA_CLASS:'real'},{UNDERSTOOD_ACCESS_MODE:'demo'},
    {UNDERSTOOD_AI_MODE:'live'},{UNDERSTOOD_PREPARATION_ADAPTER:'other'},{UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:'[]'},
    {UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:'['},{UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:'["*"]'},
    {UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([hash,hash])},{GEMINI_API_KEY:''}])
    assert.throws(()=>resolvePreparationAdapter({...env,UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([hash]),...patch},{fetchImpl}));
  const input={source,revision:1,languages:['en','ar'],review:null,glossary:{revision:0,hash:'empty',terms:[]}},adapter=adapterFor(input,[]);
  assert.ok(Object.isFrozen(adapter));assert.equal(adapter.assess,undefined);assert.equal(adapter.transcribe,undefined);
  assert.equal(adapter.permitsPreparation(input),true);
  for(const patch of [{source:'Real private text'},{revision:2},{languages:['en','ar','ur']},{review:{question:'Private edit'}},{glossary:{terms:['Private terminology']}}])
    assert.equal(adapter.permitsPreparation({...input,...patch}),false);
  assert.equal(adapter.permitsPreparation({...input,glossary:{terms:[],hash:'empty',revision:0}}),true);
  assert.doesNotMatch(JSON.stringify(adapter),/test-only/);
});

test('noncanonical preparation, private Arabic speech, publication and multiple-choice assessment use one exact frozen rubric',async()=>{
  const facts=['Put 12 cartons at bay 4.','Keep the exit clear.'];
  const content={title:'Carton handover',facts,question:'How many cartons go to which bay, and what must stay clear?',askedFacts:facts,
    translation:{title:'تسليم الصناديق',text:'ضع 12 صندوقاً في المنطقة 4. أبق المخرج خالياً.',question:'كم صندوقاً ستضع وفي أي منطقة، وما الذي يجب أن يبقى خالياً؟'}};
  const f=await fixture(['en','ar'],facts.join(' ')),preparationCalls=[],assessmentCalls=[];
  try {
    await stage(f,adapterFor(f.input,preparationCalls,async()=>{},content));assert.equal(preparationCalls.length,8);
    assert.equal((await f.db.query('SELECT state FROM briefings')).rows[0].state,'ready');
    const pub=await publish(f.pool,owner,f.draft.id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['w']},{integrationMode:'synthetic',storage:f.storage});
    const assignment=(await f.db.query('SELECT id FROM assignments')).rows[0].id,worker={org_id:'a',site_id:'a',principal_type:'worker',principal_id:'w'};
    assert.deepEqual(await getAssignmentSpeech(f.pool,worker,assignment,'question',f.storage),audio);
    const frozen=(await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json;
    assert.equal(frozen.languages.en.title,'Synthetic instructions');assert.equal(frozen.rubric.mode,'multiple-choice');
    const answer=frozen.rubric.correctChoiceId,submissionId=randomUUID();
    const receipt=await submitAnswer(f.pool,worker,assignment,submissionId,answer);assert.equal(receipt.assessmentStatus,'pending');
    const assessmentInput={answer,question:content.translation.question,askedFacts:facts,language:'ar',publicationId:pub.id,version:1};
    const adapter=resolveAssessmentAdapter({...env,UNDERSTOOD_ASSESSMENT_ADAPTER:'gemini-free',
      UNDERSTOOD_SYNTHETIC_ASSESSMENT_HASHES:JSON.stringify([assessmentInputHash(assessmentInput)])},{fetchImpl:async(url,options)=>{
      const body=JSON.parse(options.body);assessmentCalls.push(body);
      assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),{answer,question:content.translation.question,askedFacts:facts});
      return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({outcome:'matched',reasons:['asked_facts_present'],
        evidence:facts.map((_,factIndex)=>({factIndex,quote:answer}))})}]}}]});
    }});
    await editDraft(f.pool,owner,f.draft.id,{revision:1,title:'Different draft',source:'Put 5 cartons at bay 7.'});
    assert.equal(await rehearsalTasks(f.pool,f.storage,{schema:'public',assessmentAdapter:adapter}).assessment(),true);assert.equal(assessmentCalls.length,0);
    assert.equal((await f.db.query('SELECT outcome FROM attempts WHERE id=$1',[receipt.id])).rows[0].outcome,'matched');
    const snapshot=(await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json;
    assert.deepEqual(snapshot.rubric.askedFacts,facts);assert.equal(snapshot.languages.ar.question,content.translation.question);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM provider_requests')).rows[0].n,8);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM clarifications')).rows[0].n,0);
    assert.equal((await submitAnswer(f.pool,worker,assignment,submissionId,answer)).duplicate,true);
  }finally{await f.close();}
});

test('scheduled English/Arabic generation meters all stages and publishes exact private speech without altering snapshots',async()=>{
  const f=await fixture(),calls=[];
  try {
    const scope={orgId:'a',siteId:'a',briefingId:f.draft.id,confirmedSynthetic:true};
    const authorityBefore=(await f.db.query('SELECT * FROM preparation_authorities')).rows;
    assert.deepEqual(await readPreparationFingerprint(f.pool,scope),{revision:1,languages:['en','ar'],fingerprint:preparationInputHash(f.input)});
    assert.throws(()=>readPreparationFingerprint(f.pool,{...scope,confirmedSynthetic:false}),/Confirm/);
    await assert.rejects(readPreparationFingerprint(f.pool,{...scope,siteId:'foreign'}),/unavailable/);
    assert.deepEqual((await f.db.query('SELECT * FROM preparation_authorities')).rows,authorityBefore);
    assert.equal(await stage(f,adapterFor(f.input,calls)),true);assert.equal(calls.length,8);assert.equal(f.objects.size,4);
    const draft=(await f.db.query('SELECT state,prepared_json FROM briefings WHERE id=$1',[f.draft.id])).rows[0];
    assert.equal(draft.state,'ready');assert.deepEqual(Object.keys(draft.prepared_json.languages).sort(),['ar','en']);
    const operations=(await f.db.query('SELECT * FROM provider_operations ORDER BY created_at,id')).rows;
    assert.equal(operations.length,8);assert.ok(operations.every(row=>row.kind==='preparation'&&row.reserved_requests===1));
    assert.equal(operations.filter(row=>row.model===GEMINI_MODELS.speech).length,4);
    assert.ok(operations.every(row=>row.input_hash===bundleHash(row.preparation_context_json) && row.provenance_json.model===row.model));
    assert.ok(operations.every(row=>row.preparation_context_json.rootHash===preparationInputHash(f.input)));
    assert.deepEqual(operations.map(row=>row.preparation_context_json.stage),['preparation','grounding_check','translation','translation_check','speech','speech','speech','speech']);
    assert.equal(operations[0].preparation_context_json.argumentsHash,bundleHash([f.input.source,{review:null,multipleChoice:true}]));
    assert.deepEqual(operations.slice(4).map(row=>[row.preparation_context_json.language,row.preparation_context_json.track]),[['en','body'],['en','question'],['ar','body'],['ar','question']]);
    const bundle=(await f.db.query('SELECT * FROM generated_bundles')).rows[0];assert.equal(bundle.provider_operation_count,8);
    const links=(await f.db.query('SELECT operation_id FROM generated_bundle_operations WHERE bundle_id=$1',[bundle.id])).rows;
    assert.deepEqual(links.map(row=>row.operation_id).sort(),operations.map(row=>row.id).sort());
    const history=await getProcessingProvenance(f.pool,owner,f.queued.id);assert.equal(history.total,8);assert.equal(new Set(history.items.map(row=>row.runId)).size,1);
    assert.ok(history.items.every(row=>row.resultReference==='bundle' && row.provenance && row.stage && row.requests.length===1));
    checkedProviderHistory(history,{id:f.queued.id,kind:'prepare',publication_id:null,publication_version:null,assignment_id:null},1);
    assert.doesNotMatch(JSON.stringify(history),/rootHash|argumentsHash|providerHash|input_hash|claim_token|Finished items|askedFacts/);
    await assert.rejects(f.db.query('UPDATE generated_bundles SET provider_operation_count=NULL WHERE id=$1',[bundle.id]),/immutable/);
    await assert.rejects(f.db.exec('DELETE FROM generated_bundle_operations'),/append-only/);
    await assert.rejects(f.db.query('UPDATE provider_operations SET preparation_context_json=$2 WHERE id=$1',[operations[0].id,'{}']),/append-only|immutable/);
    assert.equal((await f.db.query("SELECT count(*)::int n FROM provider_requests WHERE state='accepted'")).rows[0].n,8);
    const pub=await publish(f.pool,owner,f.draft.id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['w']},{integrationMode:'synthetic',storage:f.storage});
    const assignment=(await f.db.query('SELECT id FROM assignments WHERE publication_id=$1',[pub.id])).rows[0].id;
    for(const kind of ['body','question'])assert.deepEqual(await getAssignmentSpeech(f.pool,{org_id:'a',site_id:'a',principal_type:'worker',principal_id:'w'},assignment,kind,f.storage),audio);
    const before=(await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json;
    await editDraft(f.pool,owner,f.draft.id,{revision:1,title:'Next version',source});
    assert.deepEqual((await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json,before);
    assert.deepEqual(await getAssignmentSpeech(f.pool,{org_id:'a',site_id:'a',principal_type:'worker',principal_id:'w'},assignment,'question',f.storage),audio);
    await assert.rejects(f.db.exec('DELETE FROM preparation_authorities'),/append-only/);
  }finally{await f.close();}
});

test('failed metered preparation keeps real request evidence and retry links only its new accepted claim',async()=>{
  const f=await fixture(),failedCalls=[],retryCalls=[];try{
    await stage(f,adapterFor(f.input,failedCalls,async count=>{if(count===2)throw Error('Synthetic transport failure');}));
    assert.equal(failedCalls.length,2);assert.equal((await f.db.query('SELECT state FROM briefings')).rows[0].state,'failed');
    assert.equal((await f.db.query('SELECT count(*)::int n FROM generated_bundles')).rows[0].n,0);
    const failed=(await f.db.query('SELECT * FROM provider_operations ORDER BY created_at,id')).rows;
    assert.equal(failed.length,2);assert.ok(failed.every(row=>row.input_hash && row.preparation_context_json));
    assert.deepEqual((await f.db.query('SELECT state FROM provider_requests ORDER BY created_at')).rows.map(row=>row.state),['accepted','uncertain']);
    await queuePreparation(f.pool,owner,f.draft.id,1);await stage(f,adapterFor(f.input,retryCalls));assert.equal(retryCalls.length,8);
    const bundle=(await f.db.query("SELECT * FROM generated_bundles WHERE state='attached'")).rows[0];assert.equal(bundle.provider_operation_count,8);
    const linked=(await f.db.query('SELECT operation_id FROM generated_bundle_operations WHERE bundle_id=$1',[bundle.id])).rows;
    assert.ok(linked.every(row=>!failed.some(operation=>operation.id===row.operation_id)));
    assert.deepEqual((await f.db.query('SELECT * FROM provider_operations WHERE id=ANY($1::text[]) ORDER BY created_at,id',[failed.map(row=>row.id)])).rows,failed);
    assert.notEqual(bundle.job_lease,failed[0].claim_token);
  }finally{await f.close();}
});

test('provider dispatch rechecks the full preparation root after reservation and refuses changed draft text before network',async()=>{
  const f=await fixture(),calls=[];try{
    const adapter=adapterFor(f.input,calls),fenced={...adapter,withJournal:journal=>adapter.withJournal({...journal,
      async beforeRequest(input){await f.db.query('UPDATE briefings SET source=$2 WHERE id=$1',[f.draft.id,'Changed synthetic source']);return journal.beforeRequest(input);}})};
    await stage(f,fenced);assert.equal(calls.length,0);assert.equal(f.objects.size,0);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM provider_operations')).rows[0].n,1);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM provider_requests')).rows[0].n,0);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM generated_bundle_operations')).rows[0].n,0);
    assert.equal((await f.db.query('SELECT state FROM briefings')).rows[0].state,'failed');
  }finally{await f.close();}
});

test('metered target regeneration links only new Arabic speech while retaining old publication operations and audio',async()=>{
  const f=await fixture(),initialCalls=[],laterCalls=[];try{
    await stage(f,adapterFor(f.input,initialCalls));assert.equal(initialCalls.length,8);
    const original=(await f.db.query('SELECT * FROM generated_bundles')).rows[0],oldLinks=(await f.db.query('SELECT * FROM generated_bundle_operations ORDER BY operation_id')).rows;
    const pub=await publish(f.pool,owner,f.draft.id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['w']},{integrationMode:'synthetic',storage:f.storage});
    await regenerateDraftTarget(f.pool,owner,f.draft.id,{requestId:randomUUID(),revision:1,language:'ar',kind:'audio',confirmed:true});
    const root={...f.input,revision:2};await stage(f,adapterFor(root,laterCalls));assert.equal(laterCalls.length,2);
    const current=(await f.db.query("SELECT * FROM generated_bundles WHERE revision=2 AND state='attached'")).rows[0];assert.equal(current.provider_operation_count,2);
    const operations=(await f.db.query('SELECT o.* FROM generated_bundle_operations link JOIN provider_operations o ON o.id=link.operation_id WHERE link.bundle_id=$1 ORDER BY o.created_at,o.id',[current.id])).rows;
    assert.ok(operations.every(row=>row.model===GEMINI_MODELS.speech && row.preparation_context_json.stage==='speech' && row.preparation_context_json.language==='ar'));
    assert.ok(operations.every(row=>row.preparation_context_json.rootHash===preparationInputHash(root)));
    assert.deepEqual((await f.db.query('SELECT * FROM generated_bundle_operations WHERE bundle_id=$1 ORDER BY operation_id',[original.id])).rows,oldLinks);
    const reused=(await f.db.query("SELECT stage,language,track FROM preparation_stage_events WHERE job_id=$1 AND run_id=$2 AND state='reused' ORDER BY step",[current.job_id,current.job_lease])).rows;
    assert.equal(reused.length,6);
    assert.equal((await f.db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json.artifactBundle.id,original.id);
    const assignment=(await f.db.query('SELECT id FROM assignments WHERE publication_id=$1',[pub.id])).rows[0].id;
    assert.deepEqual(await getAssignmentSpeech(f.pool,{org_id:'a',site_id:'a',principal_type:'worker',principal_id:'w'},assignment,'body',f.storage),audio);
  }finally{await f.close();}
});

test('provider preparation refuses legacy unattributed jobs and changed access revisions before any request',async()=>{
  for(const failure of ['missing','revision']) {
    const f=await fixture(),calls=[];
    try {
      if(failure==='missing')await f.db.exec('UPDATE jobs SET preparation_authority_id=NULL');
      else await f.db.exec("INSERT INTO staff_access_revisions(staff_id,org_id,site_id,revision) VALUES('owner','a','a',2)");
      await stage(f,adapterFor(f.input,calls));assert.equal(calls.length,0);assert.equal(f.objects.size,0);
      assert.equal((await f.db.query('SELECT state FROM briefings WHERE id=$1',[f.draft.id])).rows[0].state,'failed');
    }finally{await f.close();}
  }
});

test('unallowlisted inputs and closed quotas never dispatch or fall back to demo readiness',async()=>{
  for(const failure of ['input','quota']) {
    const f=await fixture(['en','ar']),calls=[];
    try {
      if(failure==='quota')await f.db.exec("UPDATE provider_policies SET enabled=false WHERE scope_key='tenant:a'");
      const input=failure==='input'?{...f.input,source:'Another synthetic source'}:f.input;
      await stage(f,adapterFor(input,calls));assert.equal(calls.length,0);assert.equal(f.objects.size,0);
      const row=(await f.db.query('SELECT state,prepared_json FROM briefings WHERE id=$1',[f.draft.id])).rows[0];
      assert.equal(row.state,'failed');assert.equal(row.prepared_json,null);
    }finally{await f.close();}
  }
});

test('requester revocation before dispatch or during a response rejects generation and preserves immutable authority',async()=>{
  for(const timing of ['before','during']) {
    const f=await fixture(),calls=[];
    try {
      const before=(await f.db.query('SELECT * FROM preparation_authorities')).rows;
      if(timing==='before')await f.db.exec("UPDATE staff SET active=false WHERE id='owner'");
      const adapter=adapterFor(f.input,calls,async count=>{if(timing==='during'&&count===1)await f.db.exec("UPDATE staff SET active=false WHERE id='owner'");});
      await stage(f,adapter);assert.equal(calls.length,timing==='before'?0:1);assert.equal(f.objects.size,0);
      assert.equal((await f.db.query('SELECT prepared_json FROM briefings WHERE id=$1',[f.draft.id])).rows[0].prepared_json,null);
      assert.deepEqual((await f.db.query('SELECT * FROM preparation_authorities')).rows,before);
    }finally{await f.close();}
  }
});
