import test from 'node:test';
import assert from 'node:assert/strict';
import {vercelClarificationTranslation} from '../server/ai/vercel-clarification-translation.mjs';
const env={VERCEL_ENV:'production',UNDERSTOOD_INSTRUCTION_TEXT_PROVIDER:'nemotron',DEEPL_API_KEY:'fixture:fx',NVIDIA_API_KEY:'fixture'};
const content={title:'Instruction clarification',text:'Какую дверь?',question:'Clarification message'};
test('Vercel clarification translation detects worker source language and validates DeepL output without generating questions',async()=>{
 const calls=[];
 const adapter=vercelClarificationTranslation(env,async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,body});
  return url.includes('deepl')?Response.json({translations:['Clarification','Which door?','Clarification message'].map(text=>({text}))}):Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]})}}]});
 });
 const translation=await adapter.translate(content,'en');assert.equal(translation.text,'Which door?');
 assert.equal(Object.hasOwn(calls[0].body,'source_lang'),false);assert.equal(calls[0].body.target_lang,'EN-GB');
 const checked=await adapter.checkTranslation(content,translation,'en');assert.equal(checked.faithful,true);
 assert.equal(calls.length,2);assert.match(calls[1].body.messages[0].content,/Independently compare/i);
 assert.doesNotMatch(JSON.stringify(adapter),/fixture/);
 for(const patch of [{VERCEL_ENV:'preview'},{UNDERSTOOD_TIER:'production'},{DEEPL_API_KEY:''},{NVIDIA_API_KEY:''},{UNDERSTOOD_INSTRUCTION_TEXT_PROVIDER:'disabled'}])assert.equal(vercelClarificationTranslation({...env,...patch}),null);
});
