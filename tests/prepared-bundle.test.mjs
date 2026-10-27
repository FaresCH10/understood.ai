import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeWav} from '../src/audio.ts';
import {prepareLanguageBundle,preparationContent,preparedAudioReferences,reviewContent,PreparedBundleError,bundleHash} from '../server/ai/prepared-bundle.mjs';
import {createGeminiAdapter} from '../server/ai/gemini.mjs';

const hash=value=>createHash('sha256').update(typeof value==='string' ? value : JSON.stringify(value)).digest('hex');
const source='Finished items go on blue. Unfinished items go on yellow. Leave the walkway clear.';
const content={title:'Shelves',facts:['Finished items go on blue.','Unfinished items go on yellow.','Leave the walkway clear.'],
  question:'Where do finished and unfinished items go?',askedFacts:['Finished items go on blue.','Unfinished items go on yellow.']};
const wav=(duration=1)=>Buffer.from(encodeWav({duration,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(duration*16000).fill(0.2)}));
const tinyWav=()=>{const bytes=wav().subarray(0,3244);bytes.writeUInt32LE(bytes.length-8,4);bytes.writeUInt32LE(bytes.length-44,40);return bytes;};
const check=(value=content)=>({sourceGrounded:true,questionAligned:true,ambiguous:false,
  factEvidence:value.facts.map((quote,factIndex)=>({factIndex,quote})),askedFactIndexes:value.askedFacts.map(fact=>value.facts.indexOf(fact)),reasons:[]});
const faithful=()=>({faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]});
function fixture(overrides={}) {
  const calls=[];
  const adapter={provenance:{adapter:'synthetic-test-v1',dataClass:'synthetic',textModel:'fixture-text',speechModel:'fixture-audio',voice:'fixture',promptVersion:'v1',schemaVersion:'v1'},
    capabilities:{textLanguages:['en','ar','ur'],speechLanguages:['en','ar','ur']},
    async prepare(...args){calls.push(['prepare',...args]);return structuredClone(content);},
    async checkPreparation(...args){calls.push(['checkPreparation',...args]);return check(args[1]);},
    async translate(...args){calls.push(['translate',...args]);return {title:'الرفوف',text:`${args[1]} الرف الأزرق والأصفر`,question:'أين المنتجات؟'};},
    async checkTranslation(...args){calls.push(['checkTranslation',...args]);return faithful();},
    async speech(...args){calls.push(['speech',...args]);return wav();},...overrides};
  const input={source,revision:1,languages:['en','ar','ur'],dataClass:'synthetic',adapter,assertCurrent:async()=>true};
  return {calls,adapter,input};
}
const rejectsCode=(promise,code)=>assert.rejects(promise,error=>error instanceof PreparedBundleError && error.code===code && !error.message.includes('secret'));

test('prepared bundle freezes exact-text speech dependencies and only the asked rubric facts',async()=>{
  const {input,calls}=fixture(),guards=[],stages=[];
  input.assertCurrent=async dependency=>{guards.push(dependency);return true;};input.onStage=async stage=>{stages.push(stage);};
  const {manifest,audio}=await prepareLanguageBundle(input);
  assert.equal(audio.length,6);assert.equal(calls.length,12);
  assert.deepEqual(manifest.rubric.askedFacts,content.askedFacts);
  assert.equal(manifest.rubric.askedFacts.includes(content.facts[2]),false);
  assert.equal(manifest.dependencies.sourceHash,hash(source));
  assert.equal(manifest.dependencyHash,bundleHash(manifest.dependencies));
  assert.equal(guards.length,49);assert.equal(stages.length,24);
  assert.equal(stages.filter(value=>value.state==='started').length,12);
  assert.equal(stages.filter(value=>value.state==='completed').length,12);
  assert.ok(stages.every(value=>value.errorCode===null));
  assert.ok(guards.every(value=>value.revision===1 && value.dependencyHash===manifest.dependencyHash));
  for(const [language,localized] of Object.entries(manifest.languages)) for(const kind of ['body','question']) {
    const ref=localized.speech[kind],artifact=audio.find(item=>item.id===ref.id),text=kind==='body' ? localized.text : localized.question;
    assert.equal(ref.textHash,hash(text));assert.equal(ref.sha256,hashBytes(artifact.bytes));
    assert.equal(ref.bytes,artifact.bytes.length);assert.equal(ref.durationSeconds,1);assert.equal(artifact.language,language);
    assert.ok(calls.some(call=>call[0]==='speech' && call[1]===text && call[2]===language));
  }
  assert.equal(JSON.stringify(manifest).includes('device-synthesis'),false);
  assert.equal(JSON.stringify(manifest).includes('"bytes":{"type":"Buffer"'),false);
});
const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');

test('Arabic source is translated and independently checked before English speech and delivery',async()=>{
  const original='أبق الممر خالياً.',english={title:'Clear walkway',text:'Keep the walkway clear.',question:'What must remain clear?'};
  const {input,calls}=fixture({
    async prepare(){return {title:english.title,facts:['Keep the walkway clear.'],question:english.question,askedFacts:['Keep the walkway clear.']};},
    async checkPreparation(){return {sourceGrounded:true,questionAligned:true,ambiguous:false,factEvidence:[{factIndex:0,quote:original}],askedFactIndexes:[0],reasons:[]};},
    async translate(value,language){calls.push(['translate',value,language]);assert.equal(value.text,original);assert.equal(language,'en');return english;},
    async checkTranslation(value,translated,language){calls.push(['checkTranslation',value,translated,language]);assert.equal(value.text,original);assert.deepEqual(translated,english);assert.equal(language,'en');return faithful();},
  });
  input.source=original;input.languages=['en'];input.multipleChoice=true;
  const bundle=await prepareLanguageBundle(input);
  assert.equal(bundle.manifest.source,original);assert.equal(bundle.manifest.languages.en.text,english.text);
  assert.equal(bundle.manifest.checks.translations.en,'passed');
  assert.ok(calls.some(call=>call[0]==='speech'&&call[1]===english.text&&call[2]==='en'));
  assert.equal(preparedAudioReferences(bundle.manifest).length,2);
  const retained=await prepareLanguageBundle({...input,revision:2,regeneration:{kind:'audio',language:'en',bundle,review:null}});
  assert.equal(retained.manifest.languages.en.text,english.text);
  assert.equal(calls.filter(call=>call[0]==='translate').length,1);
  input.adapter.checkTranslation=async()=>({...faithful(),languageCorrect:false});
  await rejectsCode(prepareLanguageBundle(input),'translation_check_failed');
  input.adapter.translate=async()=>({...english,text:original});
  await rejectsCode(prepareLanguageBundle(input),'invalid_translation');
});

test('incompatible languages and real data are rejected before any provider call',async()=>{
  for(const change of [input=>{input.adapter.capabilities.speechLanguages=['en','ar'];},input=>{input.dataClass='privacy-approved';}]) {
    const {input,calls}=fixture();change(input);
    await rejectsCode(prepareLanguageBundle(input),input.dataClass==='synthetic' ? 'language_capability_unavailable' : 'invalid_provider');assert.equal(calls.length,0);
  }
  let called=false;const adapter=createGeminiAdapter({apiKey:'test-only',dataClass:'synthetic',fetchImpl:async()=>{called=true;throw Error('No network allowed');}});
  await rejectsCode(prepareLanguageBundle({...fixture().input,adapter}),'preparation_failed');assert.equal(called,true);
});

test('revision/access fencing stops generation before calls, after callbacks and after provider results',async()=>{
  for(const rejectedGuard of [1,2,3,8]) {
    const {input,calls}=fixture();let guards=0;
    input.assertCurrent=async()=>{if(++guards===rejectedGuard) return false;return true;};
    await rejectsCode(prepareLanguageBundle(input),'obsolete_or_unauthorized');
    assert.equal(calls.length,Math.floor(rejectedGuard/3));
  }
  const {input,calls}=fixture();let authorized=true;
  input.assertCurrent=async()=>{if(!authorized) throw Error('secret revoked scope');};input.onStage=async()=>{authorized=false;};
  await rejectsCode(prepareLanguageBundle(input),'obsolete_or_unauthorized');assert.equal(calls.length,0);
});

test('misaligned question regenerates at most once and never produces speech on repeated failure',async()=>{
  for(const recover of [true,false]) {
    let checks=0;const {input,calls}=fixture({async checkPreparation(...args){checks++;return {...check(args[1]),questionAligned:recover && checks===2,reasons:recover && checks===2 ? [] : ['question_alignment']};}});
    if(recover) {await prepareLanguageBundle(input);assert.equal(checks,2);assert.equal(calls.filter(call=>call[0]==='prepare').length,2);}
    else {await rejectsCode(prepareLanguageBundle(input),'question_alignment_failed');assert.equal(checks,2);assert.equal(calls.some(call=>call[0]==='speech'),false);}
  }
});

test('invalid private preparation, grounding evidence and ambiguity cannot become ready',async()=>{
  for(const value of [{...content,unexpected:true},{...content,askedFacts:['Not in facts']},{...content,facts:['Same',' Same ']},{...content,askedFacts:[]}]) {
    assert.throws(()=>preparationContent(value),error=>error.code==='invalid_preparation');
  }
  const cases=[
    [{...check(),ambiguous:true,reasons:['ambiguous_source']},'ambiguous_source'],
    [{...check(),sourceGrounded:false,reasons:['ungrounded_fact']},'ungrounded_preparation'],
    [{...check(),factEvidence:[{factIndex:0,quote:'Invented'},{factIndex:1,quote:content.facts[1]},{factIndex:2,quote:content.facts[2]}]},'invalid_grounding_evidence'],
    [{...check(),askedFactIndexes:[0,2]},'invalid_question_evidence'],
    [{...check(),reasons:['invented_code']},'invalid_preparation_check'],
    [{...check(),questionAligned:false,reasons:['unsupported_content']},'preparation_check_failed'],
    [{...check(),reasons:['omitted_pairing']},'preparation_check_failed'],
  ];
  for(const [result,code] of cases) {
    const {input,calls}=fixture({async checkPreparation(){return result;}});await rejectsCode(prepareLanguageBundle(input),code);
    assert.equal(calls.some(call=>['translate','speech'].includes(call[0])),false);
  }
});

test('translation checks must pass independently before any generated speech',async()=>{
  for(const result of [{...faithful(),complete:false,reasons:['incomplete_translation']},{...faithful(),languageCorrect:false,reasons:['wrong_language']},
    {...faithful(),terminologyApplied:false,reasons:['terminology_mismatch']},{...faithful(),faithful:'true'}, {...faithful(),extra:true}]) {
    const {input,calls}=fixture({async checkTranslation(){return result;}});
    await assert.rejects(prepareLanguageBundle(input),PreparedBundleError);assert.equal(calls.some(call=>call[0]==='speech'),false);
  }
  const {input,calls}=fixture({async translate(){return {title:'Wrong',text:'أين',question:'Wrong'};}});
  await rejectsCode(prepareLanguageBundle(input),'invalid_translation');assert.equal(calls.some(call=>call[0]==='speech'),false);
});

test('one rejected generated translation can be repaired, but failures and authored overrides never become ready',async()=>{
  let checks=0,translations=0;
  const {input}=fixture({async translate(){translations++;return {title:'الرفوف',text:'ضع المنتجات على الرف الأزرق.',question:'أين المنتجات؟'};},
    async checkTranslation(){return ++checks===1?{...faithful(),faithful:false,reasons:['unsupported_content']}:faithful();}});
  const events=[];input.onStage=event=>events.push(event);
  const bundle=await prepareLanguageBundle(input);
  assert.equal(translations,3);assert.equal(checks,3);
  assert.equal(events.filter(event=>event.state==='failed').length,1);
  assert.equal(events.filter(event=>event.state==='started').length,14);
  assert.equal(preparedAudioReferences(bundle.manifest).length,6);
  let failedChecks=0,spoken=0;
  const failed=fixture({async checkTranslation(){failedChecks++;return {...faithful(),faithful:false,reasons:['unsupported_content']};},async speech(){spoken++;return wav();}});
  await rejectsCode(prepareLanguageBundle(failed.input),'translation_check_failed');
  assert.equal(failedChecks,2);assert.equal(spoken,0);
});

test('review and glossary snapshots bind dependencies and pass only matching tenant terminology',async()=>{
  const {input,calls}=fixture();input.review={revision:1,question:'Where should both types go?',facts:[],askedFacts:[]};
  const terms=[{id:'blue',revision:1,term:'blue',sourceLanguage:'en',targetLanguage:'ar',override:'أزرق',suggestion:'الأزرق'},
    {id:'unused',revision:2,term:'Absent word',sourceLanguage:'en',targetLanguage:'ar',override:'كلمة',suggestion:''}];
  input.glossary={revision:3,hash:hash(terms),terms};const before=JSON.stringify(input.glossary);
  const {manifest}=await prepareLanguageBundle(input);
  assert.equal(manifest.question,input.review.question);assert.equal(manifest.dependencies.reviewHash,hash(input.review));
  assert.equal(manifest.dependencies.glossaryHash,hash(terms));assert.equal(JSON.stringify(input.glossary),before);
  assert.deepEqual(calls.find(call=>call[0]==='translate' && call[2]==='ar')[3].terms,[{term:'blue',translation:'أزرق'}]);
  assert.deepEqual(calls.find(call=>call[0]==='translate' && call[2]==='ur')[3].terms,[]);
  for(const change of [value=>{value.review.revision=2;},value=>{value.glossary.hash='wrong';},value=>{value.glossary.terms=[null];value.glossary.hash=hash([null]);}]) {
    const value={...fixture().input,review:structuredClone(input.review),glossary:structuredClone(input.glossary)};change(value);
    await assert.rejects(prepareLanguageBundle(value),PreparedBundleError);
  }
  const different={...fixture().input,review:{...input.review,question:'Where do both go?'}};
  assert.notEqual((await prepareLanguageBundle(different)).manifest.dependencyHash,manifest.dependencyHash);
});

test('company override without an AI suggestion remains valid and hash-bound, while empty or malformed terminology blocks preparation',async()=>{
  const {input,calls}=fixture(),term={id:'blue',revision:1,term:'blue',sourceLanguage:'en',targetLanguage:'ar',override:'أزرق',suggestion:null};
  const terms=[term];input.glossary={revision:1,hash:hash(terms),terms};
  const before=JSON.stringify(input.glossary),{manifest}=await prepareLanguageBundle(input);
  assert.equal(manifest.dependencies.glossaryHash,hash(terms));assert.equal(JSON.stringify(input.glossary),before);
  assert.deepEqual(calls.find(call=>call[0]==='translate' && call[2]==='ar')[3].terms,[{term:'blue',translation:'أزرق'}]);
  for(const change of [{override:'',suggestion:null},{override:' ',suggestion:' '},{override:'أزرق',suggestion:7},{override:'أزرق',suggestion:'x'.repeat(501)}]){
    const next=fixture(),rows=[{...term,...change}];next.input.glossary={revision:1,hash:hash(rows),terms:rows};
    await rejectsCode(prepareLanguageBundle(next.input),'invalid_glossary');assert.equal(next.calls.length,0);
  }
});

test('exact same language/text can reuse audio but different languages cannot',async()=>{
  const {input,calls}=fixture({async translate(){return {title:'الرفوف',text:'نفس النص',question:'نفس النص'};}});
  const {manifest,audio}=await prepareLanguageBundle(input);
  assert.equal(audio.length,4);assert.equal(calls.filter(call=>call[0]==='speech').length,4);
  assert.equal(manifest.languages.ar.speech.body.id,manifest.languages.ar.speech.question.id);
  assert.notEqual(manifest.languages.ar.speech.body.id,manifest.languages.ur.speech.body.id);
});

test('optional translated edits are checked against source/terminology before exact edited-text speech',async()=>{
  const {input,calls}=fixture();
  const edited={title:'الرفوف الجديدة',text:'ضع المكتمل على الأزرق وغير المكتمل على الأصفر.',question:'أين ستضع كل نوع؟'};
  input.review={revision:1,question:'',facts:[],askedFacts:[],translations:{ar:edited}};
  const terms=[{id:'blue',revision:1,term:'blue',sourceLanguage:'en',targetLanguage:'ar',override:'أزرق',suggestion:''}];
  input.glossary={revision:1,hash:hash(terms),terms};
  const before=JSON.stringify(input.review),{manifest,audio}=await prepareLanguageBundle(input);
  assert.equal(JSON.stringify(input.review),before);
  assert.equal(calls.filter(call=>call[0]==='translate' && call[2]==='ar').length,0);
  assert.equal(calls.filter(call=>call[0]==='translate' && call[2]==='ur').length,1);
  const checked=calls.find(call=>call[0]==='checkTranslation' && call[3]==='ar');
  assert.deepEqual(checked.slice(1),[{title:manifest.title,text:source,question:manifest.question},edited,'ar',{terms:[{term:'blue',translation:'أزرق'}]}]);
  assert.equal(manifest.dependencies.reviewHash,hash(input.review));
  assert.equal(manifest.checks.translations.ar,'passed');
  assert.deepEqual(Object.fromEntries(Object.entries(manifest.languages.ar).filter(([key])=>key!=='speech')),edited);
  assert.ok(calls.findIndex(call=>call[0]==='checkTranslation' && call[3]==='ar')<calls.findIndex(call=>call[0]==='speech'));
  for(const kind of ['body','question']) {
    const text=kind==='body' ? edited.text : edited.question,ref=manifest.languages.ar.speech[kind];
    assert.equal(ref.textHash,hash(text));assert.ok(audio.some(item=>item.id===ref.id));
    assert.ok(calls.some(call=>call[0]==='speech' && call[1]===text && call[2]==='ar'));
  }
  assert.equal(preparedAudioReferences(manifest).length,6);
  const changed={...fixture().input,review:{...input.review,translations:{ar:{...edited,question:'أين الرفان؟'}}}};
  assert.notEqual((await prepareLanguageBundle(changed)).manifest.dependencies.reviewHash,manifest.dependencies.reviewHash);
  const reversed={...input.review,translations:{ar:Object.fromEntries(Object.entries(edited).reverse())}};
  assert.equal(hash(reviewContent(reversed,1)),manifest.dependencies.reviewHash);
});

test('edited translations cannot bypass capability, structure, semantic checks or revision fencing',async()=>{
  const edited={title:'الرفوف',text:'المنتجات المكتملة وغير المكتملة',question:'أين المنتجات؟'};
  const review=translations=>({revision:1,question:'',facts:[],askedFacts:[],translations});
  for(const translations of [null,[],{en:edited},{xx:edited},{ar:null},{ar:{...edited,question:''}},
    {ar:{...edited,text:'not Arabic'}},{ar:{...edited,title:'ع'.repeat(121)}},{ar:{...edited,speech:{id:'forged'}}},{ar:{text:edited.text}}]) {
    const {input,calls}=fixture();input.review=review(translations);
    await rejectsCode(prepareLanguageBundle(input),'invalid_review');assert.equal(calls.length,0);
  }
  const absent=fixture();absent.input.languages=['en'];absent.input.review=review({ar:edited});
  await rejectsCode(prepareLanguageBundle(absent.input),'translation_language_unavailable');assert.equal(absent.calls.length,0);
  const rejected=fixture({async checkTranslation(){return {...faithful(),complete:false,reasons:['incomplete_translation']};}});
  rejected.input.review=review({ar:edited});await rejectsCode(prepareLanguageBundle(rejected.input),'translation_check_failed');
  assert.equal(rejected.calls.some(call=>call[0]==='speech'),false);
  let current=true;const stale=fixture({async checkTranslation(){current=false;return faithful();}});
  stale.input.assertCurrent=async()=>current;stale.input.review=review({ar:edited});
  await rejectsCode(prepareLanguageBundle(stale.input),'obsolete_or_unauthorized');assert.equal(stale.calls.some(call=>call[0]==='speech'),false);
});

test('speech must be bounded, audible canonical WAV and provider errors stay private',async()=>{
  const silent=wav();silent.fill(0,44);const wrongRate=wav();wrongRate.writeUInt32LE(24000,24);
  for(const bytes of [Buffer.alloc(100),silent,wrongRate,tinyWav()]) {
    const {input}=fixture({async speech(){return bytes;}});await assert.rejects(prepareLanguageBundle(input),PreparedBundleError);
  }
  const {input}=fixture({async speech(){return wav(90);}});
  await rejectsCode(prepareLanguageBundle(input),'speech_bundle_exceeds_limit');
  const failed=fixture({async translate(){throw Error('secret provider key and worker text');}});
  await rejectsCode(prepareLanguageBundle(failed.input),'translation_failed');
});

test('target regeneration preserves other languages and only calls the selected provider operations',async()=>{
  const initial=fixture(),previous=await prepareLanguageBundle(initial.input),before=bundleHash(previous.manifest);
  for(const kind of ['audio','translation']) {
    const {input,calls}=fixture();input.revision=2;
    input.regeneration={kind,language:'ar',bundle:previous,review:null};
    const next=await prepareLanguageBundle(input);
    assert.equal(bundleHash(previous.manifest),before);
    assert.deepEqual(calls.map(call=>call[0]),kind==='audio' ? ['speech','speech'] : ['translate','checkTranslation','speech','speech']);
    assert.ok(calls.every(call=>call[0]==='speech' ? call[2]==='ar' : call[0]==='translate' ? call[2]==='ar' : call[3]==='ar'));
    assert.equal(next.manifest.dependencies.revision,2);
    assert.deepEqual(next.manifest.facts,previous.manifest.facts);
    assert.deepEqual(next.manifest.rubric,previous.manifest.rubric);
    for(const language of ['en','ur']) {
      const old=previous.manifest.languages[language],saved=next.manifest.languages[language];
      for(const key of ['title','text','question']) assert.equal(saved[key],old[key]);
      for(const track of ['body','question']) {
        assert.notEqual(saved.speech[track].id,old.speech[track].id);
        assert.equal(saved.speech[track].sha256,old.speech[track].sha256);
        assert.deepEqual(next.audio.find(item=>item.id===saved.speech[track].id).bytes,previous.audio.find(item=>item.id===old.speech[track].id).bytes);
      }
    }
    assert.equal(preparedAudioReferences(next.manifest).length,6);
  }
});

test('translation regeneration removes only the selected override and audio regeneration retains exact edited text',async()=>{
  const edited={title:'الرفوف الجديدة',text:'ضع المكتمل على الأزرق وغير المكتمل على الأصفر.',question:'أين ستضع كل نوع؟'};
  const oldReview={revision:1,question:'',facts:[],askedFacts:[],translations:{ar:edited,ur:{...edited,question:'کہاں رکھیں؟'}}};
  const initial=fixture();initial.input.review=oldReview;
  const previous=await prepareLanguageBundle(initial.input),before=JSON.stringify(oldReview);
  for(const kind of ['translation','audio']) {
    const {input,calls}=fixture();input.revision=2;input.review=structuredClone({...oldReview,revision:2});
    if(kind==='translation') delete input.review.translations.ar;
    input.regeneration={kind,language:'ar',bundle:previous,review:oldReview};
    const result=await prepareLanguageBundle(input);
    assert.equal(JSON.stringify(oldReview),before);
    assert.equal(result.manifest.languages.ur.question,oldReview.translations.ur.question);
    if(kind==='audio') {
      assert.deepEqual(calls.map(call=>[call[0],call[1],call[2]]),[['speech',edited.text,'ar'],['speech',edited.question,'ar']]);
      assert.equal(result.manifest.languages.ar.question,edited.question);
    }else assert.equal(calls.filter(call=>call[0]==='translate').length,1);
  }
});

test('incompatible or corrupt regeneration baselines fail before any provider call',async()=>{
  const previous=await prepareLanguageBundle(fixture().input);
  const mutations=[input=>{input.source+=' Changed';},input=>{input.languages=['en','ar'];},input=>{input.revision=3;},
    input=>{input.adapter.provenance.voice='changed';},input=>{input.review={revision:2,question:'Different question?',facts:[],askedFacts:[]};},
    input=>{input.regeneration.review={revision:1,question:'',facts:[],askedFacts:[]};},input=>{input.regeneration.kind='invalid';},
    input=>{input.regeneration.language='en';},input=>{input.regeneration.bundle.audio[0].bytes[44]^=1;},
    input=>{input.glossary={revision:1,hash:hash([]),terms:[]};}];
  for(const mutate of mutations) {
    const {input,calls}=fixture();input.revision=2;input.regeneration={kind:'translation',language:'ar',bundle:structuredClone(previous),review:null};
    mutate(input);await assert.rejects(prepareLanguageBundle(input),PreparedBundleError);assert.equal(calls.length,0);
  }
  const {input,calls}=fixture();input.revision=2;input.regeneration={kind:'audio',language:'ur',bundle:previous,review:null};input.assertCurrent=async()=>false;
  await rejectsCode(prepareLanguageBundle(input),'obsolete_or_unauthorized');assert.equal(calls.length,0);
  const failed=fixture({async checkTranslation(){return {...faithful(),faithful:false,reasons:['unsupported_content']};}});
  failed.input.revision=2;failed.input.regeneration={kind:'translation',language:'ar',bundle:previous,review:null};
  await rejectsCode(prepareLanguageBundle(failed.input),'translation_check_failed');assert.equal(failed.calls.some(call=>call[0]==='speech'),false);
});
