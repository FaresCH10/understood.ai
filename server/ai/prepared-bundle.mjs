import {providerDataClass} from './provider-policy.mjs';
import {WORKER_LANGUAGE_CODES,isWorkerLanguage,languageTextMatches} from '../languages.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {inspectWav} from '../audio.mjs';
import {translationEdits} from '../translation-input.mjs';
import {withMultipleChoice} from '../multiple-choice.mjs';
import {validateMultipleChoice} from '../multiple-choice-input.mjs';
import {questionChoices} from './question-choices.mjs';

export const PREPARED_BUNDLE_SCHEMA='prepared-bundle-v1';
const hash=value=>createHash('sha256').update(typeof value==='string' ? value : JSON.stringify(value)).digest('hex');
const canonical=value=>Array.isArray(value) ? value.map(canonical) : value && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
// PostgreSQL jsonb does not retain object-key order.
export const bundleHash=value=>hash(JSON.stringify(canonical(value)));
const nonempty=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max;
const object=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(key=>keys.includes(key));
const list=(value,max)=>Array.isArray(value) && value.length>0 && value.length<=max && value.every(item=>nonempty(item,500)) && new Set(value).size===value.length;
const reasons=['ungrounded_fact','question_alignment','ambiguous_source','incomplete_translation','wrong_language','terminology_mismatch','unsupported_content','omitted_pairing'];
const safeReasons=value=>Array.isArray(value) && value.length<=7 && value.every(reason=>reasons.includes(reason));
export class PreparedBundleError extends Error {
  constructor(code) {super('Briefing preparation could not be completed');this.name='PreparedBundleError';this.code=code;}
}
const fail=code=>{throw new PreparedBundleError(code);};

export function preparationContent(value) {
  if(!object(value,['title','facts','question','askedFacts','choices']) || !nonempty(value.title,120) || !nonempty(value.question,500)
    || !list(value.facts,12) || !list(value.askedFacts,6) || !value.askedFacts.every(fact=>value.facts.includes(fact))) fail('invalid_preparation');
  const result={title:value.title.trim(),facts:value.facts.map(fact=>fact.trim()),question:value.question.trim(),askedFacts:value.askedFacts.map(fact=>fact.trim())};
  if(!list(result.facts,12) || !list(result.askedFacts,6)) fail('invalid_preparation');
  if(value.choices!==undefined){try{result.choices=questionChoices(value.choices);}catch{fail('invalid_preparation');}}
  return result;
}

export function preparationCheck(source,content,value) {
  if(!object(value,['sourceGrounded','questionAligned','ambiguous','factEvidence','askedFactIndexes','reasons','choicesAligned'])
    || !['sourceGrounded','questionAligned','ambiguous'].every(key=>typeof value[key]==='boolean') || !safeReasons(value.reasons)
    || !Array.isArray(value.factEvidence) || value.factEvidence.length!==content.facts.length
    || !Array.isArray(value.askedFactIndexes) || value.askedFactIndexes.length!==content.askedFacts.length) fail('invalid_preparation_check');
  const covered=new Set();
  for(const item of value.factEvidence) {
    if(!object(item,['factIndex','quote']) || !Number.isInteger(item.factIndex) || item.factIndex<0 || item.factIndex>=content.facts.length
      || covered.has(item.factIndex) || !nonempty(item.quote,1000) || !source.includes(item.quote)) fail('invalid_grounding_evidence');
    covered.add(item.factIndex);
  }
  const expected=content.askedFacts.map(fact=>content.facts.indexOf(fact)).sort((a,b)=>a-b);
  if(value.askedFactIndexes.some(index=>!Number.isInteger(index)) || JSON.stringify([...value.askedFactIndexes].sort((a,b)=>a-b))!==JSON.stringify(expected)) fail('invalid_question_evidence');
  if(value.ambiguous) fail('ambiguous_source');
  if(!value.sourceGrounded) fail('ungrounded_preparation');
  if(content.choices && typeof value.choicesAligned!=='boolean')fail('invalid_preparation_check');
  if(content.choices && !value.choicesAligned)return false;
  if(!value.questionAligned) {
    if(value.reasons.some(reason=>reason!=='question_alignment')) fail('preparation_check_failed');
    return false;
  }
  if(value.reasons.length) fail('preparation_check_failed');
  return true;
}

export function translatedContent(value,language) {
  if(!object(value,['title','text','question','answerChoices']) || !nonempty(value.title,120) || !nonempty(value.text,5000) || !nonempty(value.question,500)
    || (!isWorkerLanguage(language) || ![value.title,value.text,value.question].every(text=>languageTextMatches(language,text)))) fail('invalid_translation');
  let choices;try{if(value.answerChoices!==undefined)choices=questionChoices(value.answerChoices);}catch{fail('invalid_translation');}
  return {title:value.title.trim(),text:value.text.trim(),question:value.question.trim(),...(choices?{answerChoices:choices}:{})};
}
export function translationCheck(value) {
  if(!object(value,['faithful','complete','languageCorrect','terminologyApplied','reasons'])
    || !['faithful','complete','languageCorrect','terminologyApplied'].every(key=>typeof value[key]==='boolean') || !safeReasons(value.reasons)) fail('invalid_translation_check');
  if(!value.faithful || !value.complete || !value.languageCorrect || !value.terminologyApplied || value.reasons.length) fail('translation_check_failed');
}

export function reviewContent(value,revision) {
  if(value===null) return null;
  if(!object(value,['revision','question','facts','askedFacts','translations']) || value.revision!==revision || typeof value.question!=='string' || value.question.length>500
    || !Array.isArray(value.facts) || value.facts.length>12 || !value.facts.every(fact=>nonempty(fact,500))
    || !Array.isArray(value.askedFacts) || value.askedFacts.length>6 || !value.askedFacts.every(fact=>nonempty(fact,500))) fail('invalid_review');
  let translations;try {translations=translationEdits(value.translations);}catch {fail('invalid_review');}
  return {revision,question:value.question.trim(),facts:value.facts.map(fact=>fact.trim()),askedFacts:value.askedFacts.map(fact=>fact.trim()),
    ...(Object.keys(translations).length ? {translations} : {})};
}

export function glossaryContent(value) {
  if(value===null) return {revision:0,hash:hash([]),terms:[]};
  if(!object(value,['revision','hash','terms']) || !Number.isSafeInteger(value.revision) || value.revision<0
    || !Array.isArray(value.terms) || value.terms.length>1000 || value.hash!==hash(value.terms)) fail('invalid_glossary');
  for(const term of value.terms) {
    if(!term || typeof term!=='object' || !nonempty(term.id,100) || !Number.isSafeInteger(term.revision) || term.revision<1 || !nonempty(term.term,200)
      || !['en','ar','ur'].includes(term.sourceLanguage) || !['en','ar','ur'].includes(term.targetLanguage) || term.sourceLanguage===term.targetLanguage
      || typeof term.override!=='string' || term.override.length>500 || term.suggestion!==null && (typeof term.suggestion!=='string' || term.suggestion.length>500)
      || !(term.override.trim() || term.suggestion?.trim())) fail('invalid_glossary');
  }
  return structuredClone(value);
}

export function providerContent(adapter,dataClass) {
  const value=adapter?.provenance;
  if(!object(value,['adapter','dataClass','textModel','speechModel','voice','promptVersion','schemaVersion'])
    || !['adapter','textModel','speechModel','voice','promptVersion','schemaVersion'].every(key=>nonempty(value[key],100))
    || !['synthetic','privacy-approved','real'].includes(dataClass) || value.dataClass!==dataClass || dataClass==='real'&&!providerDataClass(value)
    || !['prepare','checkPreparation','translate','checkTranslation','speech'].every(key=>typeof adapter?.[key]==='function')
    || !['textLanguages','speechLanguages'].every(key=>Array.isArray(adapter.capabilities?.[key]) && adapter.capabilities[key].length<=WORKER_LANGUAGE_CODES.length
      && adapter.capabilities[key].every(isWorkerLanguage))) fail('invalid_provider');
  return {...value};
}

// No storage side effects: the job owner must durably stage, verify and commit this bundle.
export async function prepareLanguageBundle({source,title=null,revision,languages,review=null,glossary=null,dataClass,adapter,assertCurrent,onStage=()=>{},regeneration=null,multipleChoice=false}) {
  if((title!==null && !nonempty(title,120)) || !nonempty(source,4000) || !Number.isSafeInteger(revision) || revision<1 || !Array.isArray(languages)
    || !languages.length || languages.length>WORKER_LANGUAGE_CODES.length || !languages.every(isWorkerLanguage)
    || new Set(languages).size!==languages.length || typeof assertCurrent!=='function' || typeof onStage!=='function' || typeof multipleChoice!=='boolean') fail('invalid_bundle_input');
  const targets=['en',...WORKER_LANGUAGE_CODES.filter(language=>language!=='en' && languages.includes(language))];
  if(dataClass==='real'&&multipleChoice&&adapter.supportsMultipleChoice!==true)fail('multiple_choice_provider_unavailable');
  const overrides=reviewContent(review,revision),terms=glossaryContent(glossary),provider=providerContent(adapter,dataClass);
  if(Object.keys(overrides?.translations || {}).some(language=>!targets.includes(language))) fail('translation_language_unavailable');
  if(!targets.every(language=>adapter.capabilities.textLanguages.includes(language) && adapter.capabilities.speechLanguages.includes(language))) fail('language_capability_unavailable');
  const dependencies={revision,...(title!==null?{titleHash:hash(title.trim())}:{}),sourceHash:hash(source),reviewHash:hash(overrides),glossaryHash:terms.hash,glossaryRevision:terms.revision,
    languages:targets,provider,schemaVersion:PREPARED_BUNDLE_SCHEMA};
  const dependencyHash=bundleHash(dependencies);
  let previous=null;
  if(regeneration!==null) {
    if(!object(regeneration,['kind','language','bundle','review']) || !['translation','audio'].includes(regeneration.kind)
      || !targets.includes(regeneration.language) || (regeneration.kind==='translation' && regeneration.language==='en')) fail('invalid_regeneration');
    previous=checkedPreparedBundle(regeneration.bundle);
    const old=previous.manifest.dependencies;
    const oldReview=reviewContent(regeneration.review,old.revision);
    const expected=oldReview===null ? null : {...structuredClone(oldReview),revision};
    if(expected?.translations && regeneration.kind==='translation') {
      delete expected.translations[regeneration.language];
      if(!Object.keys(expected.translations).length) delete expected.translations;
    }
    if(old.titleHash!==dependencies.titleHash || old.revision!==revision-1 || old.sourceHash!==dependencies.sourceHash || previous.manifest.source!==source
      || old.reviewHash!==hash(oldReview) || bundleHash(expected)!==bundleHash(overrides)
      || old.glossaryHash!==dependencies.glossaryHash || old.glossaryRevision!==dependencies.glossaryRevision
      || bundleHash(old.languages)!==bundleHash(targets) || bundleHash(old.provider)!==bundleHash(provider)
      || old.schemaVersion!==PREPARED_BUNDLE_SCHEMA) fail('regeneration_dependencies_changed');
  }
  let stage='preparation',language='en',track=null,step=0;
  const current=async()=>{try {if(await assertCurrent({revision,dependencyHash})===false) fail('obsolete_or_unauthorized');}catch {fail('obsolete_or_unauthorized');}};
  const event=(state,origin='generated',errorCode=null)=>({step,stage,language,track,state,origin,errorCode});
  const reuse=async origin=>{step++;await current();await onStage(event('reused',origin));await current();};
  const call=async(fn,validate=value=>value)=>{
    step++;await current();await onStage(event('started'));await current();
    let result;
    try {
      result=validate(await fn());await current();
    }catch(error) {
      // A completed provider request is not a completed stage until its result validates.
      const code=error instanceof PreparedBundleError ? error.code : `${stage}_failed`;
      try {await current();await onStage(event('failed','generated',code));}catch { /* A stale claim cannot add stage evidence. */ }
      if(error instanceof PreparedBundleError) throw error;
      fail(code);
    }
    await onStage(event('completed'));await current();return result;
  };
  try {
    let content,checked=false;
    if(previous) {
      await current();
      const saved=previous.manifest;
      // Older synthetic bundles created preview choices after translation. Their
      // fixture adapters cannot translate options; rebuild those preview choices
      // after regeneration, while provider-checked choices remain frozen input.
      const retained=saved.checks.choices==='passed'||adapter.supportsMultipleChoice===true?saved.languages.en.choices:null;
      const choices=retained?[retained.find(choice=>choice.id===saved.rubric.correctChoiceId),...retained.filter(choice=>choice.id!==saved.rubric.correctChoiceId)].map(choice=>choice.text):null;
      content=preparationContent({title:saved.title,facts:saved.facts,question:saved.question,askedFacts:saved.rubric.askedFacts,...(choices?{choices}:{})});
      await reuse('retained');
      stage='grounding_check';await reuse('retained');
      checked=true;
    }
    for(let attempt=0;!checked && attempt<2;attempt++) {
      stage='preparation';
      const generatedChoices=multipleChoice && adapter.supportsMultipleChoice===true;
      content=await call(()=>adapter.prepare(source,{review:structuredClone(overrides),...(generatedChoices?{multipleChoice:true}:{})}),generated=>{
        const value=preparationContent(generated);
        if(generatedChoices&&!value.choices)fail('invalid_preparation');
        return overrides ? preparationContent({...value,...(overrides.question ? {question:overrides.question} : {}),
          ...(overrides.facts.length ? {facts:overrides.facts} : {}),...(overrides.askedFacts.length ? {askedFacts:overrides.askedFacts} : {})}) : value;
      });
      stage='grounding_check';
      try {
        checked=await call(()=>adapter.checkPreparation(source,structuredClone(content)),check=>{
          if(!preparationCheck(source,content,check)) fail('question_alignment_failed');
          return true;
        });
      }catch(error) {if(error.code!=='question_alignment_failed') throw error;}
      if(checked) break;
    }
    if(!checked) fail('question_alignment_failed');
    if(title!==null)content={...content,title:title.trim()};
    const localized={en:{title:content.title,text:source,question:content.question,...(content.choices?{answerChoices:content.choices}:{})}},checks={preparation:'passed',translations:{},...(content.choices&&(!previous||previous.manifest.checks.choices==='passed')?{choices:'passed'}:{})};
    if(previous && previous.manifest.checks.translations.en==='passed'){
      const saved=previous.manifest.languages.en;
      localized.en={title:saved.title,text:saved.text,question:saved.question,...(content.choices?{answerChoices:content.choices}:{})};
      checks.translations.en='passed';
    }else if(/\p{Script=Arabic}/u.test(source) || /\p{Script=Arabic}/u.test(content.title)){
      const original=structuredClone(localized.en);
      language='en';stage='translation';
      localized.en=await call(()=>adapter.translate(original,'en'),value=>{
        const translated=translatedContent(value,'en');
        if(original.answerChoices&&!translated.answerChoices)fail('invalid_translation');
        return translated;
      });
      stage='translation_check';
      await call(()=>adapter.checkTranslation(original,structuredClone(localized.en),'en'),translationCheck);
      checks.translations.en='passed';
    }
    // At most one generated translation is repaired per run. This keeps the
    // largest bundle within 68 metered operations, including source normalization and grounding repair.
    let translationRepairs=0;
    for(language of targets.filter(target=>target!=='en')) {
      if(previous && !(regeneration.kind==='translation' && regeneration.language===language)) {
        const saved=previous.manifest.languages[language];
        const retained=content.choices?saved.choices:null;
        const choices=retained?[retained.find(choice=>choice.id===previous.manifest.rubric.correctChoiceId),...retained.filter(choice=>choice.id!==previous.manifest.rubric.correctChoiceId)].map(choice=>choice.text):null;
        localized[language]={title:saved.title,text:saved.text,question:saved.question,...(choices?{answerChoices:choices}:{})};
        checks.translations[language]='passed';
        stage='translation';await reuse('retained');stage='translation_check';await reuse('retained');
        continue;
      }
      const relevant=terms.terms.filter(term=>term.sourceLanguage==='en' && term.targetLanguage===language && localized.en.text.toLocaleLowerCase('en').includes(term.term.toLocaleLowerCase('en')))
        .map(term=>({term:term.term,translation:term.override.trim() || term.suggestion}));
      if(relevant.length>100) fail('terminology_exceeds_limit');
      let repair=null;
      for(;;){
        try{
          stage='translation';
          if(overrides?.translations?.[language] && !localized.en.answerChoices) {
            localized[language]=translatedContent(overrides.translations[language],language);await reuse('override');
          }else localized[language]=await call(()=>adapter.translate(structuredClone(localized.en),language,{terms:structuredClone(relevant),...(repair?{repair:structuredClone(repair)}:{})}),value=>{
            const translated=translatedContent(value,language);
            if(localized.en.answerChoices&&!translated.answerChoices)fail('invalid_translation');
            return overrides?.translations?.[language]?{...translated,...translatedContent(overrides.translations[language],language)}:translated;
          });
          stage='translation_check';
          await call(()=>adapter.checkTranslation(structuredClone(localized.en),structuredClone(localized[language]),language,{terms:structuredClone(relevant)}),translationCheck);
          break;
        }catch(error){
          if(overrides?.translations?.[language] || translationRepairs>=1
            || !['invalid_translation','translation_check_failed'].includes(error.code))throw error;
          translationRepairs++;
          if(localized[language])repair={previous:localized[language],reason:error.code};
        }
      }
      checks.translations[language]='passed';
    }
    const audio=[],cache=new Map();let totalBytes=0;
    for(language of targets) {
      const item=localized[language];item.speech={};
      for(const kind of ['body','question']) {
        stage='speech';track=kind;
        const text=kind==='body' ? item.text : item.question,textHash=hash(text),key=`${language}:${textHash}`;
        let artifact=cache.get(key);
        if(!artifact) {
          let bytes,info;
          const validate=value=>{
            const inspected=inspectWav(value);if(inspected.durationSeconds<0.25) fail('invalid_speech');
            if(totalBytes+inspected.bytes>12_000_000*Math.ceil(targets.length/3)) fail('speech_bundle_exceeds_limit');
            return {bytes:Buffer.from(value),info:inspected};
          };
          if(previous && language!==regeneration.language) {
            await current();
            const ref=previous.manifest.languages[language].speech[kind];
            ({bytes,info}=validate(previous.audio.find(item=>item.id===ref.id).bytes));await reuse('retained');
          }else ({bytes,info}=await call(()=>adapter.speech(text,language),validate));
          totalBytes+=info.bytes;
          artifact={id:randomUUID(),language,textHash,bytes:Buffer.from(bytes),info};cache.set(key,artifact);audio.push(artifact);
        }else await reuse('cache');
        item.speech[kind]={id:artifact.id,textHash,sha256:artifact.info.sha256,bytes:artifact.info.bytes,durationSeconds:artifact.info.durationSeconds,
          mimeType:'audio/wav',sampleRate:16000};
      }
    }
    await current();
    const manifest={title:content.title,source,question:content.question,facts:content.facts,rubric:{askedFacts:content.askedFacts},languages:localized,
      dependencies,dependencyHash,checks,provenance:provider};
    if(Buffer.byteLength(JSON.stringify(manifest))>100000*Math.ceil(Object.keys(manifest.languages || {}).length/3)) fail('manifest_exceeds_limit');
    return {manifest:multipleChoice?withMultipleChoice(manifest,{preserveQuestions:true,preserveAskedFacts:true}):manifest,audio};
  }catch(error) {
    if(error instanceof PreparedBundleError) throw error;
    fail(`${stage}_failed`);
  }
}

export function preparedAudioReferences(manifest) {
  if(!object(manifest,['title','source','question','facts','rubric','languages','dependencies','dependencyHash','checks','provenance'])
    || !nonempty(manifest.source,4000) || !object(manifest.rubric,['askedFacts','mode','correctChoiceId']) || !object(manifest.languages,WORKER_LANGUAGE_CODES)
    || !object(manifest.dependencies,['revision','titleHash','sourceHash','reviewHash','glossaryHash','glossaryRevision','languages','provider','schemaVersion'])
    || !object(manifest.checks,['preparation','translations','choices']) || manifest.checks.preparation!=='passed'
    || manifest.checks.choices!==undefined&&manifest.checks.choices!=='passed'
    || !object(manifest.checks.translations,WORKER_LANGUAGE_CODES) || Buffer.byteLength(JSON.stringify(manifest))>100000*Math.ceil(Object.keys(manifest.languages || {}).length/3)) fail('invalid_manifest');
  preparationContent({title:manifest.title,question:manifest.question,facts:manifest.facts,askedFacts:manifest.rubric.askedFacts});
  const choiceMode=manifest.rubric.mode==='multiple-choice';
  if(choiceMode){
    if(!validateMultipleChoice(manifest))fail('invalid_manifest');
    const ids=manifest.languages.en.choices.map(choice=>choice.id).sort();
    if(Object.values(manifest.languages).some(item=>JSON.stringify(item.choices.map(choice=>choice.id).sort())!==JSON.stringify(ids)
      || manifest.checks.choices!=='passed'&&item.choices.find(choice=>choice.id===manifest.rubric.correctChoiceId)?.text!==item.text))fail('invalid_manifest');
  }else if(manifest.rubric.mode!==undefined || manifest.rubric.correctChoiceId!==undefined)fail('invalid_manifest');
  const dependencies=manifest.dependencies,provider=manifest.provenance;
  if(dependencies.titleHash!==undefined && !/^[a-f0-9]{64}$/.test(dependencies.titleHash))fail('invalid_dependencies');
  if(!Number.isSafeInteger(dependencies.revision) || dependencies.revision<1 || dependencies.schemaVersion!==PREPARED_BUNDLE_SCHEMA
    || !['sourceHash','reviewHash','glossaryHash'].every(key=>/^[a-f0-9]{64}$/.test(dependencies[key]))
    || dependencies.sourceHash!==hash(manifest.source) || !Number.isSafeInteger(dependencies.glossaryRevision) || dependencies.glossaryRevision<0
    || !Array.isArray(dependencies.languages) || JSON.stringify(dependencies.languages)!==JSON.stringify(['en',...WORKER_LANGUAGE_CODES.filter(language=>language!=='en' && language in manifest.languages)])
    || !object(provider,['adapter','dataClass','textModel','speechModel','voice','promptVersion','schemaVersion'])
    || !['adapter','textModel','speechModel','voice','promptVersion','schemaVersion'].every(key=>nonempty(provider[key],100))
    || !['synthetic','privacy-approved','real'].includes(provider.dataClass) || provider.dataClass==='real'&&!providerDataClass(provider) || bundleHash(provider)!==bundleHash(dependencies.provider)
    || manifest.dependencyHash!==bundleHash(dependencies)) fail('invalid_dependencies');
  const refs=new Map();let bytes=0;
  for(const language of dependencies.languages) {
    const localized=manifest.languages[language];
    if(!object(localized,choiceMode?['title','text','question','speech','questionType','choices']:['title','text','question','speech']) || !object(localized.speech,['body','question'])) fail('invalid_manifest');
    translatedContent({title:localized.title,text:localized.text,question:localized.question},language);
    if(language==='en' && manifest.checks.translations.en!=='passed' && (localized.title!==manifest.title || localized.text!==manifest.source || localized.question!==manifest.question)) fail('invalid_manifest');
    if(language!=='en' && manifest.checks.translations[language]!=='passed') fail('invalid_manifest');
    for(const kind of ['body','question']) {
      const ref=localized.speech[kind],text=kind==='body' ? localized.text : localized.question;
      if(!object(ref,['id','textHash','sha256','bytes','durationSeconds','mimeType','sampleRate'])
        || typeof ref.id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(ref.id)
        || ref.textHash!==hash(text) || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isInteger(ref.bytes)
        || ref.bytes<8044 || ref.bytes>2_880_044 || ref.bytes%2!==0 || ref.durationSeconds!==(ref.bytes-44)/32000
        || ref.mimeType!=='audio/wav' || ref.sampleRate!==16000) fail('invalid_speech_reference');
      const item={...ref,language};
      if(refs.has(ref.id) && bundleHash(refs.get(ref.id))!==bundleHash(item)) fail('invalid_speech_reference');
      if(!refs.has(ref.id)) {refs.set(ref.id,item);bytes+=ref.bytes;}
    }
  }
  if(Object.keys(manifest.checks.translations).some(language=>!dependencies.languages.includes(language)) || bytes>12_000_000*Math.ceil(dependencies.languages.length/3)) fail('invalid_manifest');
  return [...refs.values()];
}

export function checkedPreparedBundle(bundle) {
  if(!object(bundle,['manifest','audio']) || !Array.isArray(bundle.audio)) fail('invalid_bundle');
  const refs=preparedAudioReferences(bundle.manifest);
  if(bundle.audio.length!==refs.length || new Set(bundle.audio.map(item=>item?.id)).size!==refs.length) fail('invalid_bundle_audio');
  const audio=refs.map(ref=>{
    const item=bundle.audio.find(item=>item?.id===ref.id);
    if(!item || item.language!==ref.language || item.textHash!==ref.textHash) fail('invalid_bundle_audio');
    let info;try {info=inspectWav(item.bytes);}catch {fail('invalid_bundle_audio');}
    if(info.sha256!==ref.sha256 || info.bytes!==ref.bytes || info.durationSeconds!==ref.durationSeconds) fail('invalid_bundle_audio');
    return {...ref,bytes:Buffer.from(item.bytes)};
  });
  return {manifest:structuredClone(bundle.manifest),audio};
}
