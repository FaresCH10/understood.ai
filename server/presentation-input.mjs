import {createHash} from 'node:crypto';
import {isWorkerLanguage,languageCapability} from './languages.mjs';

const requestUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sourceIdentifier=/^[^\u0000-\u0020\u007f]{8,100}$/;
const exact=(value,keys)=>!!value && typeof value==='object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const text=(value,max)=>{
  if(typeof value!=='string' || !value.trim() || value.length>max)throw new Error('Invalid presentation content');
  return value;
};
const optionalText=(value,max)=>{
  if(value===undefined || value===null)return null;
  return text(value,max);
};

export const PRESENTATION_SOURCE_KINDS=Object.freeze(['instruction','answer']);
const scriptByLanguage=Object.freeze({
  ar:/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u,
  ur:/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u,
  'pa-Arab':/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u,
  hi:/[\u0900-\u097f]/u,ne:/[\u0900-\u097f]/u,
  bn:/[\u0980-\u09ff]/u,'pa-Guru':/[\u0a00-\u0a7f]/u,
  ta:/[\u0b80-\u0bff]/u,te:/[\u0c00-\u0c7f]/u,
  ml:/[\u0d00-\u0d7f]/u,si:/[\u0d80-\u0dff]/u,ru:/[\u0400-\u04ff]/u,
});
const hasLetters=/\p{L}/u;

export function presentationLanguage(value,capability='ui') {
  if(typeof value!=='string' || !isWorkerLanguage(value) || !languageCapability(value,capability))return false;
  return true;
}

export function presentationRequest(value) {
  if(!exact(value,['requestId','sourceKind']) && !exact(value,['requestId','sourceKind','sourceId']))
    throw new Error('Invalid presentation request');
  if(typeof value.requestId!=='string' || !requestUuid.test(value.requestId)
    || !PRESENTATION_SOURCE_KINDS.includes(value.sourceKind))throw new Error('Invalid presentation request');
  if(value.sourceKind==='instruction'){
    if(Object.hasOwn(value,'sourceId'))throw new Error('Invalid presentation request');
    return Object.freeze({requestId:value.requestId,sourceKind:'instruction',sourceId:''});
  }
  if(typeof value.sourceId!=='string' || !sourceIdentifier.test(value.sourceId))throw new Error('Invalid presentation request');
  return Object.freeze({requestId:value.requestId,sourceKind:'answer',sourceId:value.sourceId});
}

export function presentationInstructionContent(value) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid presentation content');
  return Object.freeze({title:text(value.title,120),text:text(value.text,5000),question:optionalText(value.question,500)});
}

export function presentationAnswerContent(value) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid presentation content');
  return Object.freeze({text:text(value.text,2000)});
}

export function translatedPresentationContent(kind,value,targetLanguage) {
  if(!presentationLanguage(targetLanguage,'translation'))throw new Error('Presentation language unavailable');
  const content=kind==='instruction'
    ? presentationInstructionContent(value)
    : presentationAnswerContent(value);
  const pattern=scriptByLanguage[targetLanguage];
  if(pattern){
    for(const part of Object.values(content)){
      if(part && hasLetters.test(part) && !pattern.test(part))throw new Error('Presentation translation language mismatch');
    }
  }
  return content;
}

export function presentationSourceHash(kind,originalLanguage,content) {
  if(!PRESENTATION_SOURCE_KINDS.includes(kind) || !isWorkerLanguage(originalLanguage))throw new Error('Invalid presentation source');
  const normalized=kind==='instruction'
    ? {title:content.title,text:content.text,question:content.question??null}
    : {text:content.text};
  return createHash('sha256').update('understood:presentation-source:v1\0')
    .update(JSON.stringify([kind,originalLanguage,normalized])).digest('hex');
}

export function presentationArtifact(row) {
  if(!row)throw new Error('Presentation unavailable');
  const ready=row.status==='ready';
  const content=ready
    ? row.source_kind==='instruction'
      ? {title:row.title,text:row.text,question:row.question??null}
      : {text:row.text}
    : null;
  return Object.freeze({
    id:row.id,sourceKind:row.source_kind,sourceId:row.source_id,publicationId:row.publication_id,
    publicationVersion:Number(row.publication_version),originalLanguage:row.original_language,
    targetLanguage:row.target_language,status:row.status,content,
    provider:row.provider??null,live:row.live===null||row.live===undefined?null:row.live===true||row.live===1,
    errorCode:row.error_code??null,sourceHash:row.source_hash,
    createdAt:row.created_at instanceof Date?row.created_at.toISOString():row.created_at,
    readyAt:row.ready_at?(row.ready_at instanceof Date?row.ready_at.toISOString():row.ready_at):null,
  });
}

// The API deliberately uses one stable wrapper for cached, generated and honest non-artifact states.
export function presentationResult(status,{presentation=null,reason=null,originalLanguage,targetLanguage,sourceKind,sourceId=''}={}) {
  if(!['ready','pending','failed','not_required','unavailable','deferred'].includes(status))throw new Error('Invalid presentation state');
  return Object.freeze({status,presentation:presentation?presentationArtifact(presentation):null,reason,
    originalLanguage,targetLanguage,sourceKind,sourceId});
}
