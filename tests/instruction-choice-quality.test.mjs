import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeminiAdapter,GEMINI_MODELS} from '../server/ai/gemini.mjs';
import {prepareLanguageBundle,checkedPreparedBundle} from '../server/ai/prepared-bundle.mjs';
import {encodeWav} from '../src/audio.ts';
import {withMultipleChoice} from '../server/multiple-choice.mjs';
const source='Put finished items on the blue shelf.',question='Which shelf is for finished items?',choices=['Blue shelf','Yellow shelf','Red shelf','Green shelf'];
const audio=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(.2)}));
function fixture({aligned=true,missingChoices=false,missingTranslationChoices=false}={}){
  const requests=[],reply=value=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
  const adapter=createGeminiAdapter({apiKey:'synthetic-fixture-only',dataClass:'synthetic',fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);
    if(body.model===GEMINI_MODELS.speech)return Response.json({status:'completed',model:GEMINI_MODELS.speech,steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:audio.toString('base64')}]}]});
    const fields=body.generationConfig.responseFormat.text.schema.properties;
    if(fields.askedFacts){assert.ok(fields.choices);assert.match(body.systemInstruction.parts[0].text,/plausible answers/);return reply({title:'Shelves',facts:[source],askedFacts:[source],question,...(!missingChoices?{choices}:{})});}
    if(fields.factEvidence)return reply({sourceGrounded:true,questionAligned:true,choicesAligned:aligned,ambiguous:false,factEvidence:[{factIndex:0,quote:source}],askedFactIndexes:[0],reasons:[]});
    if(fields.faithful)return reply({faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]});
    return reply({title:'الرفوف',text:'ضع المنتجات المكتملة على الرف الأزرق.',question:'أي رف مخصص للمنتجات المكتملة؟',...(!missingTranslationChoices?{answerChoices:['الرف الأزرق','الرف الأصفر','الرف الأحمر','الرف الأخضر']}:{})});
  }});
  return {requests,input:{source,title:'Shelves',revision:1,languages:['en','ar'],dataClass:'synthetic',adapter,multipleChoice:true,assertCurrent:async()=>true}};
}
test('model-generated fact-specific answers survive translation, randomization and manifest verification without repeating the instruction',async()=>{
  const {input}=fixture(),bundle=await prepareLanguageBundle(input);checkedPreparedBundle(bundle);
  const {manifest}=bundle,en=manifest.languages.en,ar=manifest.languages.ar;
  assert.equal(manifest.question,question);assert.equal(manifest.checks.choices,'passed');assert.deepEqual(manifest.rubric.askedFacts,[source]);
  assert.equal(en.choices.find(choice=>choice.id===manifest.rubric.correctChoiceId).text,'Blue shelf');assert.notEqual(en.choices.find(choice=>choice.id===manifest.rubric.correctChoiceId).text,en.text);
  assert.equal(ar.choices.find(choice=>choice.id===manifest.rubric.correctChoiceId).text,'الرف الأزرق');assert.deepEqual(en.choices.map(choice=>choice.id),ar.choices.map(choice=>choice.id));
  assert.equal(en.answerChoices,undefined);assert.equal(ar.answerChoices,undefined);
});
test('unverified, omitted or untranslated options fail closed before speech instead of substituting stock distractors',async()=>{
  for(const options of [{aligned:false},{missingChoices:true},{missingTranslationChoices:true}]){
    const {input,requests}=fixture(options);await assert.rejects(prepareLanguageBundle(input));assert.equal(requests.some(body=>body.model===GEMINI_MODELS.speech),false);
  }
  const {input}=fixture();let spoken=false;
  const arabic='ضع المنتجات المكتملة على الرف الأزرق.';
  const adapter={...input.adapter,
    async prepare(){return {title:'Shelves',question,facts:[source],askedFacts:[source],choices};},
    async checkPreparation(){return {sourceGrounded:true,questionAligned:true,choicesAligned:true,ambiguous:false,factEvidence:[{factIndex:0,quote:arabic}],askedFactIndexes:[0],reasons:[]};},
    async translate(){return {title:'Shelves',text:source,question};},
    async checkTranslation(){assert.fail('Missing normalization options must be rejected before checking');},
    async speech(){spoken=true;return audio;}};
  await assert.rejects(prepareLanguageBundle({...input,source:arabic,languages:['en'],adapter}),{code:'invalid_translation'});
  assert.equal(spoken,false);
});

test('synthetic preview changes whole colour words without corrupting words such as required',()=>{
  const preview=text=>withMultipleChoice({question:'Which action is required?',rubric:{askedFacts:[text]},languages:{en:{title:'Labels',text,question:'Which action is required?'}}});
  const source='Keep the required label visible.';
  assert.ok(preview(source).languages.en.choices.every(choice=>!choice.text.includes('requiblue')&&!choice.text.includes('requiyellow')&&!choice.text.includes('requigreen')));
  const coloured='Keep the required blue label visible.';
  assert.deepEqual(new Set(preview(coloured).languages.en.choices.map(choice=>choice.text)),new Set(['blue','yellow','red','green'].map(colour=>`Keep the required ${colour} label visible.`)));
  const plain='Wait at the station.';
  const plainChoices=preview(plain).languages.en.choices;
  assert.equal(plainChoices.filter(choice=>choice.text===plain).length,1);
  assert.ok(plainChoices.filter(choice=>choice.text!==plain).every(choice=>!choice.text.includes(plain)));
});
