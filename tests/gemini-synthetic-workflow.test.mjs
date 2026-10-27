import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runGeminiWorkflow,COMPLETE_ANSWER,INCOMPLETE_ANSWER} from '../scripts/gemini-synthetic-workflow.mjs';
import {scriptedProvider} from '../evaluation/scripted-provider.mjs';
import {CANONICAL_SOURCE,QUESTION,syntheticPrepare} from '../server/domain.mjs';
import {encodeWav} from '../src/audio.ts';

const apiKey='AQ.'+'a'.repeat(50);
const wav=()=>Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>Float32Array.from({length:16000},(_,i)=>Math.sin(i/10)*0.2)}));
function root(t){const path=mkdtempSync(join(tmpdir(),'understood-gemini-workflow-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
function script() {
  const mock=scriptedProvider(),facts=CANONICAL_SOURCE.split(/(?<=\.)\s+/),askedFacts=facts.slice(0,2);
  const choices=[CANONICAL_SOURCE,'Put finished items on yellow and unfinished items on blue. Keep the walkway clear.','Put finished items on blue and unfinished items on yellow. Block the walkway.','Put finished items on red and unfinished items on green. Keep the walkway clear.'];
  const content={title:'Shelves',facts,question:QUESTION,askedFacts,choices},english={title:'Synthetic shelf handover',text:CANONICAL_SOURCE,question:QUESTION,answerChoices:choices};
  const ar=syntheticPrepare(CANONICAL_SOURCE).languages.ar,arabic={title:ar.title,text:ar.text,question:ar.question};
  arabic.answerChoices=[ar.text,'ضع المكتمل على الأصفر وغير المكتمل على الأزرق وأبق الممر خالياً.','ضع المكتمل على الأزرق وغير المكتمل على الأصفر وأغلق الممر.','ضع المكتمل على الأحمر وغير المكتمل على الأخضر وأبق الممر خالياً.'];
  mock.structured('prepare',{source:CANONICAL_SOURCE,review:null},content,'askedFacts');
  mock.structured('grounding',{source:CANONICAL_SOURCE,candidate:content},{sourceGrounded:true,questionAligned:true,choicesAligned:true,ambiguous:false,
    factEvidence:facts.map((quote,factIndex)=>({factIndex,quote})),askedFactIndexes:[0,1],reasons:[]},'factEvidence');
  mock.structured('translate',{content:english,terms:[]},arabic,'title');
  mock.structured('translation-check',{content:english,translation:arabic,language:'ar',terms:[]},{faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]},'faithful');
  for(const [language,item] of [['en',english],['ar',arabic]])for(const kind of ['body','question'])mock.speech('speech.'+language+'.'+kind,kind==='body'?item.text:item.question,wav());
  mock.speech('fixture.voice',COMPLETE_ANSWER,wav());mock.transcription('answer.voice',wav(),COMPLETE_ANSWER);
  mock.structured('voice.assess',{answer:COMPLETE_ANSWER,question:QUESTION,askedFacts},{outcome:'matched',reasons:['asked_facts_present'],evidence:askedFacts.map((_,factIndex)=>({factIndex,quote:COMPLETE_ANSWER}))},'outcome');
  mock.structured('typed.assess',{answer:INCOMPLETE_ANSWER,question:QUESTION,askedFacts},{outcome:'clarification',reasons:['missing_asked_fact'],evidence:[{factIndex:0,quote:INCOMPLETE_ANSWER}]},'outcome');
  return mock;
}
test('live workflow runner rejects invalid configuration before filesystem, database or provider actions',async()=>{
  let calls=0;
  await assert.rejects(runGeminiWorkflow({apiKey:'invalid\r\nheader',root:'unused',fetchImpl:async()=>{calls++;}}));
  await assert.rejects(runGeminiWorkflow({apiKey,fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
});
test('synthetic live workflow uses actual scoped credentials, persistence, private audio and exact published rubric with no fabricated outcomes',async t=>{
  const mock=script(),saved=[];
  const result=await runGeminiWorkflow({apiKey,root:root(t),fetchImpl:mock.fetchImpl,persist:row=>saved.push(row)});
  assert.equal(result.state,'passed',JSON.stringify(result));assert.equal(mock.finish().length,15);
  assert.equal(result.externalRequests,15);assert.equal(result.maxExternalRequests,15);
  assert.equal(result.durableProviderRequests.count,14);assert.equal(result.durableProviderRequests.cleanupAccepted,1);
  assert.equal(result.voiceResult.outcome,'matched');assert.equal(result.incompleteResult.outcome,'clarification');
  assert.equal(result.checks.length,7);assert.equal(result.productionReady,false);assert.equal(result.realDataAllowed,false);
  assert.doesNotMatch(JSON.stringify(saved),new RegExp(apiKey+'|'+COMPLETE_ANSWER+'|'+INCOMPLETE_ANSWER+'|understood_session|password|askedFacts|blue shelf'));
});
test('synthetic live workflow stops after an uncertain dispatch without repeating a request or publishing a failed draft',async t=>{
  let calls=0;
  const result=await runGeminiWorkflow({apiKey,root:root(t),fetchImpl:async()=>{calls++;throw Error('Private transport error '+apiKey);}});
  assert.equal(calls,1);assert.equal(result.externalRequests,1);assert.equal(result.state,'failed');
  assert.equal(result.activeStage,'metered_automatic_preparation_translation_private_speech');
  assert.equal(result.publication,undefined);assert.deepEqual(result.jobStates.preparation,['failed']);
  assert.doesNotMatch(JSON.stringify(result),/Private transport/);
});
