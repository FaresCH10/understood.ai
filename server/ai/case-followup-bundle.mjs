import {providerDataClass} from './provider-policy.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {inspectWav} from '../audio.mjs';
import {bundleHash,glossaryContent,providerContent,translatedContent,translationCheck} from './prepared-bundle.mjs';

import {isWorkerLanguage} from '../languages.mjs';

const schema='case-followup-v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const keys=(value,names)=>value && typeof value==='object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',')===[...names].sort().join(',');
const identityKeys=['orgId','siteId','caseId','assignmentId','publicationId','requestId','language'];
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export class CaseFollowupError extends Error {
  constructor(code){super('Follow-up generation unavailable');this.name='CaseFollowupError';this.code=code;}
}
const fail=code=>{throw new CaseFollowupError(code);};
function checkedIdentity(value) {
  if(!keys(value,identityKeys) || !identityKeys.filter(key=>key!=='language').every(key=>typeof value[key]==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value[key]))
    || !uuid(value.requestId) || !isWorkerLanguage(value.language))fail('invalid_followup');return {...value};
}
function sourceContent(source) {
  if(typeof source!=='string' || !source.trim() || source.length>1000)fail('invalid_followup');
  return {title:'Follow-up',text:source.trim(),question:'Please reply in your own words.'};
}

export function caseFollowupDependencies(identity,source,glossary,provider) {
  const scope=checkedIdentity(identity),english=sourceContent(source),terminology=glossaryContent(glossary);
  return {schema,identity:scope,sourceHash:hash(english.text),glossaryHash:terminology.hash,glossaryRevision:terminology.revision,provider:structuredClone(provider)};
}

export function caseFollowupInputHash(row,provider) {
  return bundleHash({schema:'case-followup-input-v1',actorId:row.actor_id,actorRole:row.actor_role,requestHash:row.request_hash,
    dependencies:caseFollowupDependencies({orgId:row.org_id,siteId:row.site_id,caseId:row.case_id,assignmentId:row.assignment_id,
      publicationId:row.publication_id,requestId:row.id,language:row.language},row.source_text,row.glossary_json,provider)});
}

export function checkedFollowupProvenance(value,model,language) {
  if(!keys(value,['adapter','dataClass','textModel','speechModel','voice','promptVersion','schemaVersion']) || !providerDataClass(value)
    || !['adapter','textModel','speechModel','voice','promptVersion','schemaVersion'].every(key=>typeof value[key]==='string' && /^[A-Za-z0-9._-]{1,100}$/.test(value[key]))
    || !isWorkerLanguage(language) || model!==value[language==='en'?'speechModel':'textModel'])fail('invalid_provider');
  return Object.freeze({...value});
}

// The job owner must stage private bytes, recheck authority and atomically attach;
// successful generation alone is never a delivered message or an assessment.
export async function generateCaseFollowup({identity,source,glossary=null,dataClass,adapter,assertCurrent}) {
  const scope=checkedIdentity(identity),english=sourceContent(source);
  if(!['synthetic','real'].includes(dataClass) || typeof assertCurrent!=='function')fail('invalid_followup');
  let terminology,provider;
  try {terminology=glossaryContent(glossary);provider=providerContent(adapter,dataClass);}catch{fail('invalid_followup');}
  const language=scope.language;
  if(!adapter.capabilities.textLanguages.includes(language) || !adapter.capabilities.speechLanguages.includes(language))fail('language_unavailable');
  const dependencies=caseFollowupDependencies(scope,english.text,terminology,provider);
  const dependencyHash=bundleHash(dependencies);
  const current=async()=>{try{if(await assertCurrent({dependencyHash,identity:{...scope}})===false)fail('obsolete_or_unauthorized');}catch{fail('obsolete_or_unauthorized');}};
  const call=async(fn)=>{await current();let result;try{result=await fn();}catch{fail('provider_failed');}await current();return result;};
  const terms=terminology.terms.filter(term=>term.sourceLanguage==='en' && term.targetLanguage===language
    && english.text.toLocaleLowerCase().includes(term.term.toLocaleLowerCase()))
    .map(term=>({term:term.term,translation:term.override.trim() || term.suggestion.trim()}));
  if(terms.length>100)fail('terminology_limit');
  let target={...english};
  if(language!=='en') {
    const translated=await call(()=>adapter.translate(structuredClone(english),language,{terms:structuredClone(terms)}));
    try{target=translatedContent(translated,language);if(target.text.length>1000)fail('invalid_translation');}catch{fail('invalid_translation');}
    const result=await call(()=>adapter.checkTranslation(structuredClone(english),structuredClone(target),language,{terms:structuredClone(terms)}));
    try{translationCheck(result);}catch{fail('translation_check_failed');}
  }
  const result=await call(()=>adapter.speech(target.text,language));
  let bytes,info;try{if(!Buffer.isBuffer(result))throw Error();bytes=Buffer.from(result);info=inspectWav(bytes);if(info.durationSeconds<0.25)throw Error();}catch{fail('invalid_audio');}
  const id=randomUUID(),textHash=hash(target.text);
  const manifest={schema,dependencies,dependencyHash,source:english.text,target,
    checks:{translation:language==='en'?'not_required':'passed'},
    audio:{id,language,textHash,sha256:info.sha256,bytes:info.bytes,durationSeconds:info.durationSeconds}};
  await current();
  return checkedCaseFollowupBundle({manifest,audio:{id,language,textHash,bytes}},dependencyHash);
}

export function checkedCaseFollowupBundle(value,expectedDependencyHash) {
  if(!keys(value,['manifest','audio']) || !keys(value.manifest,['schema','dependencies','dependencyHash','source','target','checks','audio']))fail('invalid_bundle');
  const manifest=structuredClone(value.manifest),deps=manifest.dependencies;
  if(manifest.schema!==schema || !keys(deps,['schema','identity','sourceHash','glossaryHash','glossaryRevision','provider']) || deps.schema!==schema
    || !/^[a-f0-9]{64}$/.test(expectedDependencyHash) || manifest.dependencyHash!==expectedDependencyHash || bundleHash(deps)!==expectedDependencyHash)fail('dependencies_changed');
  const scope=checkedIdentity(deps.identity),english=sourceContent(manifest.source);
  if(english.text!==manifest.source || deps.sourceHash!==hash(manifest.source) || !/^[a-f0-9]{64}$/.test(deps.glossaryHash)
    || !Number.isSafeInteger(deps.glossaryRevision) || deps.glossaryRevision<0 || !providerDataClass(deps.provider))fail('invalid_bundle');
  let target;try{target=translatedContent(manifest.target,scope.language);if(target.text.length>1000)fail('invalid_bundle');}catch{fail('invalid_bundle');}
  if(scope.language==='en' && bundleHash(target)!==bundleHash(english))fail('invalid_bundle');
  if(!keys(manifest.checks,['translation']) || manifest.checks.translation!==(scope.language==='en'?'not_required':'passed'))fail('invalid_bundle');
  const ref=manifest.audio,audio=value.audio;
  if(!keys(ref,['id','language','textHash','sha256','bytes','durationSeconds']) || !keys(audio,['id','language','textHash','bytes'])
    || !uuid(ref.id) || audio.id!==ref.id || ref.language!==scope.language || audio.language!==scope.language
    || ref.textHash!==hash(target.text) || audio.textHash!==ref.textHash || !Buffer.isBuffer(audio.bytes))fail('invalid_bundle');
  let info;const bytes=Buffer.from(audio.bytes);try{info=inspectWav(bytes);}catch{fail('invalid_audio');}
  if(info.durationSeconds<0.25 || ref.sha256!==info.sha256 || ref.bytes!==info.bytes || ref.durationSeconds!==info.durationSeconds)fail('invalid_audio');
  return {manifest,audio:{id:ref.id,language:scope.language,textHash:ref.textHash,bytes}};
}
