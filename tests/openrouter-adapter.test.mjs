import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenRouterAdapter,OPENROUTER_FREE_MODEL} from '../server/ai/openrouter.mjs';
import {resolvePreparationAdapter,preparationInputHash} from '../server/ai/preparation-config.mjs';
import {resolveAssessmentAdapter,assessmentInputHash} from '../server/ai/assessment-config.mjs';
import {resolveRecordingAdapter} from '../server/ai/recording-config.mjs';
import {GEMINI_MODELS} from '../server/ai/gemini.mjs';

const hash='a'.repeat(64),apiKey='test-only-openrouter-key';
const journal=()=>{const calls=[];return {calls,async beforeRequest(){calls.push('request');return String(calls.length);},async afterRequest(){}}};
const answer='Put finished items on the blue shelf. Put unfinished items on the yellow shelf. Leave the walkway clear.';
const facts=['Put finished items on the blue shelf.','Put unfinished items on the yellow shelf.','Leave the walkway clear.'];
const question='Are finished items on the blue shelf, unfinished items on the yellow shelf, and the walkway clear?';
const reply=(value,{finish='stop'}={})=>Response.json({choices:[{finish_reason:finish,message:{content:typeof value==='string'?value:JSON.stringify(value)}}]});
const preparation={title:'Shelf routing',facts,question,askedFacts:facts};
const grounding={sourceGrounded:true,questionAligned:true,ambiguous:false,
  factEvidence:facts.map((quote,factIndex)=>({factIndex,quote})),askedFactIndexes:[0,1,2],reasons:[]};

test('OpenRouter adapter is synthetic-only and validates model, key and journal contracts',async()=>{
  assert.throws(()=>createOpenRouterAdapter({dataClass:'synthetic'}),/credentials/i);
  assert.throws(()=>createOpenRouterAdapter({apiKey,dataClass:'real'}),/synthetic/);
  assert.throws(()=>createOpenRouterAdapter({apiKey:'bad key',dataClass:'synthetic'}),/credentials/);
  assert.throws(()=>createOpenRouterAdapter({apiKey,dataClass:'synthetic',textModel:'Bad Model'}),/model/i);
  assert.throws(()=>createOpenRouterAdapter({apiKey,dataClass:'synthetic',requestJournal:{}}),/journal/i);
  const adapter=createOpenRouterAdapter({apiKey,dataClass:'synthetic',textModel:OPENROUTER_FREE_MODEL,fetchImpl:async()=>reply(preparation)});
  assert.ok(Object.isFrozen(adapter.provenance));
  assert.equal(adapter.provenance.textModel,OPENROUTER_FREE_MODEL);
  assert.equal(adapter.transcribe,undefined);assert.equal(adapter.speech,undefined);
  assert.doesNotMatch(JSON.stringify(adapter),/test-only/);
});

test('OpenRouter preparation, grounding and assessment enforce local evidence rules',async()=>{
  const calls=[],requests=journal();
  const adapter=createOpenRouterAdapter({apiKey,dataClass:'synthetic',requestJournal:requests,fetchImpl:async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    if(calls.length===1)return reply(preparation);
    if(calls.length===2)return reply(grounding);
    return reply({outcome:'match',reasons:['facts confirmed'],evidence:facts.map((quote,factIndex)=>({factIndex,quote}))});
  }});
  assert.deepEqual(await adapter.prepare('Put finished items on the blue shelf. Put unfinished items on the yellow shelf. Leave the walkway clear.'),preparation);
  assert.deepEqual(await adapter.checkPreparation('Put finished items on the blue shelf. Put unfinished items on the yellow shelf. Leave the walkway clear.',preparation),grounding);
  assert.deepEqual(await adapter.assess(answer,question,facts),{outcome:'matched',reasons:['facts confirmed'],evidence:facts.map((quote,factIndex)=>({factIndex,quote}))});
  assert.equal(calls.length,3);assert.ok(calls.every(call=>call.url==='https://openrouter.ai/api/v1/chat/completions'));
  assert.equal(calls[0].body.model,OPENROUTER_FREE_MODEL);assert.equal(calls[0].body.response_format,undefined);
  assert.equal(requests.calls.length,3);
  const bad=createOpenRouterAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),fetchImpl:async()=>reply({outcome:'matched',reasons:['ok'],
    evidence:[{factIndex:0,quote:'not in the answer'}]})});
  assert.deepEqual(await bad.assess(answer,question,facts),{outcome:'unassessable',reasons:['invalid_evidence'],evidence:[]});
  const incomplete=createOpenRouterAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),fetchImpl:async()=>reply({outcome:'matched',reasons:['ok'],
    evidence:[{factIndex:0,quote:facts[0]}]})});
  assert.deepEqual(await incomplete.assess(answer,question,facts),{outcome:'unassessable',reasons:['missing_evidence'],evidence:[]});
  const malformed=createOpenRouterAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),fetchImpl:async()=>reply('not json')});
  await assert.rejects(()=>malformed.assess(answer,question,facts),/malformed/);
  const truncated=createOpenRouterAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),fetchImpl:async()=>reply(preparation,{finish:'length'})});
  await assert.rejects(()=>truncated.prepare(answer),/incomplete/);
});

test('hybrid preparation uses MiniMax for text and Gemini for speech with exact allowlisting',()=>{
  const env={UNDERSTOOD_PREPARATION_ADAPTER:'openrouter-gemini',UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',
    UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_DATA_CLASS:'synthetic',GEMINI_API_KEY:'test-only-gemini',
    OPENROUTER_API_KEY:apiKey,OPENROUTER_MODEL:OPENROUTER_FREE_MODEL,UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([hash])};
  const input={source:answer,revision:1,languages:['en'],review:null,glossary:{revision:0,hash:'empty',terms:[]}};
  const adapter=resolvePreparationAdapter({...env,UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([preparationInputHash(input)])},{fetchImpl:async()=>assert.fail('No dispatch')});
  assert.equal(adapter.provenance.adapter,'openrouter-gemini-bundle-v1');assert.equal(adapter.provenance.textModel,OPENROUTER_FREE_MODEL);
  assert.equal(adapter.provenance.speechModel,GEMINI_MODELS.speech);assert.deepEqual(adapter.capabilities.speechLanguages,['en','ar']);
  assert.equal(adapter.permitsPreparation(input),true);assert.equal(adapter.permitsPreparation({...input,revision:2}),false);
  for(const key of ['prepare','checkPreparation','translate','checkTranslation','speech'])assert.equal(typeof adapter[key],'function');
  assert.equal(JSON.stringify(adapter).includes('test-only'),false);
  for(const patch of [{UNDERSTOOD_PREPARATION_ADAPTER:'other'},{OPENROUTER_API_KEY:''},{GEMINI_API_KEY:''},{UNDERSTOOD_DATA_CLASS:'real'}])
    assert.throws(()=>resolvePreparationAdapter({...env,UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([preparationInputHash(input)]),...patch},{fetchImpl:async()=>assert.fail('No dispatch')}));
});

test('OpenRouter typed and recorded assessment expose only metered read-only handles',()=>{
  const input={answer,question,askedFacts:facts,language:'en',publicationId:'pub',version:1};
  const env={UNDERSTOOD_ASSESSMENT_ADAPTER:'openrouter-free',UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',
    UNDERSTOOD_DATA_CLASS:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',OPENROUTER_API_KEY:apiKey,
    UNDERSTOOD_SYNTHETIC_ASSESSMENT_HASHES:JSON.stringify([assessmentInputHash(input)])};
  const typed=resolveAssessmentAdapter(env,{fetchImpl:async()=>assert.fail('No dispatch')});
  assert.equal(typed.provenance.adapter,'openrouter-typed-assessment-v1');assert.equal(typed.assessmentModel,OPENROUTER_FREE_MODEL);
  assert.equal(typed.permitsAssessment(input),true);assert.equal(typed.permitsAssessment({...input,version:2}),false);
  assert.equal(typed.prepare,undefined);assert.equal(JSON.stringify(typed).includes(apiKey),false);
  const recording=resolveRecordingAdapter({...env,UNDERSTOOD_RECORDING_ADAPTER:'openrouter-gemini',GEMINI_API_KEY:'test-only-gemini',
    UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:JSON.stringify([hash])},{fetchImpl:async()=>assert.fail('No dispatch')});
  assert.equal(recording.provenance.adapter,'openrouter-gemini-recording-v1');
  assert.equal(recording.transcriptionModel,GEMINI_MODELS.transcription);assert.equal(recording.assessmentModel,OPENROUTER_FREE_MODEL);
  assert.equal(recording.assessmentProvenance.adapter,'openrouter-recording-assessment-v1');
  assert.equal(recording.permitsRecording({sha256:hash}),true);assert.equal(recording.prepare,undefined);
  assert.equal(JSON.stringify(recording).includes(apiKey),false);
});
