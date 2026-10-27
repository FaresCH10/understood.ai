import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {encodeWav} from '../src/audio.ts';
import {generateCaseFollowup,checkedCaseFollowupBundle,caseFollowupInputHash,checkedFollowupProvenance,CaseFollowupError} from '../server/ai/case-followup-bundle.mjs';
import {createGeminiAdapter} from '../server/ai/gemini.mjs';

const hash=value=>createHash('sha256').update(typeof value==='string' || Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const wav=()=>Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(0.2)}));
const faithful=()=>({faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]});
function fixture(language='ar',overrides={}) {
  const calls=[],guards=[];
  const adapter={provenance:{adapter:'synthetic-test',dataClass:'synthetic',textModel:'fixture-text',speechModel:'fixture-speech',voice:'fixture',promptVersion:'v1',schemaVersion:'v1'},
    capabilities:{textLanguages:['en','ar','ur'],speechLanguages:['en','ar','ur']},prepare(){},checkPreparation(){},
    async translate(...args){calls.push(['translate',...args]);return {title:'متابعة',text:'أين ستضع العناصر غير المكتملة؟',question:'يرجى الرد بكلماتك الخاصة.'};},
    async checkTranslation(...args){calls.push(['checkTranslation',...args]);return faithful();},
    async speech(...args){calls.push(['speech',...args]);return wav();},...overrides};
  const input={identity:{orgId:'cedar',siteId:'beirut',caseId:randomUUID(),assignmentId:'assignment-14',publicationId:'shelf-v3',requestId:randomUUID(),language},
    source:'Please explain where unfinished items go.',dataClass:'synthetic',adapter,assertCurrent:async value=>{guards.push(value);return true;}};
  return {input,calls,guards};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error instanceof CaseFollowupError && error.code===code && !error.message.includes('private'));

test('follow-up input evidence binds source, scope, actor, terminology and both generation models without credentials',()=>{
  const f=fixture(),provider=f.input.adapter.provenance;
  const row={id:f.input.identity.requestId,org_id:'cedar',site_id:'beirut',case_id:f.input.identity.caseId,assignment_id:'assignment-14',
    publication_id:'shelf-v3',language:'ar',actor_id:'maya',actor_role:'owner',source_text:f.input.source,glossary_json:null,request_hash:hash('request')};
  const original=caseFollowupInputHash(row,provider);assert.match(original,/^[a-f0-9]{64}$/);
  for(const key of ['id','org_id','site_id','case_id','assignment_id','publication_id','actor_id','actor_role','language','source_text','request_hash']) {
    const changed={...row,[key]:key==='id'?randomUUID():key==='language'?'en':key==='actor_role'?'supervisor':`${row[key]}changed`};
    assert.notEqual(caseFollowupInputHash(changed,provider),original,key);
  }
  assert.notEqual(caseFollowupInputHash({...row,glossary_json:{revision:1,terms:[],hash:hash([])}},provider),original);
  for(const key of ['textModel','speechModel','voice','promptVersion','schemaVersion'])assert.notEqual(caseFollowupInputHash(row,{...provider,[key]:`${provider[key]}changed`}),original,key);
  assert.ok(Object.isFrozen(checkedFollowupProvenance(provider,'fixture-text','ar')));
  assert.equal(checkedFollowupProvenance(provider,'fixture-speech','en').speechModel,'fixture-speech');
  for(const changed of [{...provider,apiKey:'secret'},{...provider,dataClass:'real'},{...provider,voice:'unsafe content'}])assert.throws(()=>checkedFollowupProvenance(changed,'fixture-text','ar'),CaseFollowupError);
  assert.throws(()=>checkedFollowupProvenance(provider,'fixture-text','en'),CaseFollowupError);
});

test('follow-up generation binds exact target speech, frozen case/publication/language, provider and matching terminology',async()=>{
  const f=fixture();
  const terms=[{id:'unfinished',revision:2,term:'unfinished items',sourceLanguage:'en',targetLanguage:'ar',override:'العناصر غير المكتملة',suggestion:''},
    {id:'unused',revision:1,term:'absent',sourceLanguage:'en',targetLanguage:'ar',override:'غائب',suggestion:''}];
  f.input.glossary={revision:3,hash:hash(terms),terms};
  const before=JSON.stringify({identity:f.input.identity,glossary:f.input.glossary});
  const bundle=await generateCaseFollowup(f.input),{manifest,audio}=bundle;
  assert.deepEqual(f.calls.map(call=>call[0]),['translate','checkTranslation','speech']);
  assert.deepEqual(f.calls[0][3].terms,[{term:'unfinished items',translation:'العناصر غير المكتملة'}]);
  assert.deepEqual(f.calls[2].slice(1),[manifest.target.text,'ar']);
  assert.equal(manifest.audio.textHash,hash(manifest.target.text));assert.equal(manifest.audio.sha256,hash(audio.bytes));
  assert.equal(manifest.dependencies.sourceHash,hash(f.input.source));assert.deepEqual(manifest.dependencies.identity,f.input.identity);
  assert.equal(manifest.dependencies.glossaryHash,hash(terms));assert.equal(manifest.checks.translation,'passed');
  assert.equal(before,JSON.stringify({identity:f.input.identity,glossary:f.input.glossary}));
  assert.ok(f.guards.every(value=>value.dependencyHash===manifest.dependencyHash));
  assert.deepEqual(checkedCaseFollowupBundle(bundle,manifest.dependencyHash),bundle);
  for(const mutate of [value=>{value.manifest.target.text+=' changed';},value=>{value.manifest.dependencies.identity.language='ur';},value=>{value.audio.bytes[44]^=1;},value=>{value.manifest.audio.id=randomUUID();}]) {
    const changed={manifest:structuredClone(manifest),audio:{...audio,bytes:Buffer.from(audio.bytes)}};mutate(changed);
    assert.throws(()=>checkedCaseFollowupBundle(changed,manifest.dependencyHash),CaseFollowupError);
  }
});
test('English follow-up speaks the exact source without inventing a translation check',async()=>{
  const f=fixture('en'),bundle=await generateCaseFollowup(f.input);
  assert.deepEqual(f.calls.map(call=>call[0]),['speech']);assert.equal(bundle.manifest.target.text,f.input.source);
  assert.equal(bundle.manifest.checks.translation,'not_required');assert.equal(bundle.manifest.audio.durationSeconds,1);
});
test('real data, unsupported capabilities and malformed scope fail before provider calls',async()=>{
  for(const mutate of [value=>{value.dataClass='privacy-approved';},value=>{value.identity.orgId='../foreign';},value=>{value.identity.extra='forged';},
    value=>{value.source='';},value=>{value.source='x'.repeat(1001);},value=>{value.adapter.capabilities.speechLanguages=['en'];}]) {
    const f=fixture();mutate(f.input);await assert.rejects(generateCaseFollowup(f.input),CaseFollowupError);assert.equal(f.calls.length,0);
  }
  let network=0;const f=fixture('ur');f.input.adapter={...createGeminiAdapter({apiKey:'synthetic-test-only',dataClass:'synthetic',fetchImpl:async()=>{network++;throw Error('No network');}}),capabilities:{textLanguages:['en'],speechLanguages:['en']}};
  await rejects(generateCaseFollowup(f.input),'language_unavailable');assert.equal(network,0);
});
test('failed translation validation/check never reaches speech and provider errors stay redacted',async()=>{
  for(const override of [{async translate(){return {title:'Wrong',text:'Wrong language',question:'Wrong'};}},
    {async checkTranslation(){return {...faithful(),complete:false,reasons:['incomplete_translation']};}},
    {async translate(){throw Error('private provider diagnostic');}}]) {
    const f=fixture('ar',override);await assert.rejects(generateCaseFollowup(f.input),error=>error instanceof CaseFollowupError && !error.message.includes('private'));
    assert.equal(f.calls.some(call=>call[0]==='speech'),false);
  }
  const f=fixture('ar',{async speech(){return Buffer.alloc(100);}});await rejects(generateCaseFollowup(f.input),'invalid_audio');
});
test('authority/dependency fences before and after every provider operation prevent stale generated delivery',async()=>{
  for(const rejected of [1,2,3,4,5,6,7]) {
    const f=fixture();let guards=0;f.input.assertCurrent=async()=>++guards!==rejected;
    await rejects(generateCaseFollowup(f.input),'obsolete_or_unauthorized');assert.equal(f.calls.length,Math.min(3,Math.floor(rejected/2)));
  }
});
test('provider mutation cannot rewrite captured source, identity, terminology or target used for speech',async()=>{
  const f=fixture('ar',{async translate(content){content.text='Forged source';f.input.identity.siteId='foreign';return {title:'متابعة',text:'النص الصحيح',question:'يرجى الرد.'};},
    async checkTranslation(content,target){content.text='Forged';target.text='Forged target';return faithful();}});
  const bundle=await generateCaseFollowup(f.input);
  assert.equal(bundle.manifest.source,'Please explain where unfinished items go.');assert.equal(bundle.manifest.dependencies.identity.siteId,'beirut');
  assert.equal(f.calls.at(-1)[1],'النص الصحيح');
});

test('follow-up identity and provenance accept all configured translation and speech locales',async()=>{
  const {WORKER_LANGUAGE_CODES}=await import('../server/languages.mjs');
  const samples={en:'Follow up',ar:'متابعة',ur:'متابعة',hi:'अनुवर्ती',bn:'অনুসরণ',ml:'തുടരുക',ta:'தொடரவும்',te:'కొనసాగించు',ne:'जारी',fil:'Sundin',si:'ඉදිරියට',ru:'Продолжить','pa-Guru':'ਜਾਰੀ','pa-Arab':'متابعة',id:'Lanjutkan'};
  for(const language of WORKER_LANGUAGE_CODES){
    const sample=samples[language],f=fixture(language,{capabilities:{textLanguages:WORKER_LANGUAGE_CODES,speechLanguages:WORKER_LANGUAGE_CODES},
      async translate(){return {title:sample,text:sample,question:sample+'?'};}});
    const result=await generateCaseFollowup(f.input);assert.equal(result.manifest.dependencies.identity.language,language);
    assert.equal(checkedCaseFollowupBundle(result,result.manifest.dependencyHash).manifest.dependencies.identity.language,language);
  }
});
