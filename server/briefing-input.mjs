import {validateMultipleChoice} from './multiple-choice-input.mjs';
import {translationEdits} from './translation-input.mjs';
import {generationLanguages} from './settings-input.mjs';
const uuid=(value) => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const id=(value) => typeof value==='string' && value.length>0 && value.length<=100;
const nonempty=(value,max) => typeof value==='string' && value.trim().length>0 && value.length<=max;
export function unavailableRecipientLanguage(languages){
  const shown=[...new Set(languages)].filter(code=>typeof code==='string' && /^[a-z]{2}(?:-[A-Za-z]+)?$/.test(code)).map(code=>code.toUpperCase()).sort();
  return `Recipient language is unavailable: ${shown.join(', ') || 'unknown'}`;
}
export function reviewRequestId(value) {if(!uuid(value)) throw new Error('Invalid draft review request');return value;}

export function briefingFilters(filters={}) {
  if (!filters || typeof filters!=='object' || Array.isArray(filters)
    || Object.keys(filters).some((key) => !['search','status','publicationStatus','scheduleStatus','archiveStatus','sort','page','pageSize'].includes(key))) throw new Error('Invalid briefing filter');
  const {search='',status='all',publicationStatus='all',scheduleStatus='all',archiveStatus='active',sort='updated'}=filters;
  const page=Number(filters.page ?? 1),pageSize=Number(filters.pageSize ?? 20);
  if(typeof search!=='string' || search.length>80 || !['all','draft','processing','ready','failed'].includes(status)
    || !['all','unpublished','published','withdrawn','superseded','archived'].includes(publicationStatus) || !['all','none','queued','published','cancelled','failed'].includes(scheduleStatus) || !['active','archived','all'].includes(archiveStatus)
    || !['updated','oldest','title'].includes(sort) || !Number.isSafeInteger(page) || page<1 || page>5000
    || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw new Error('Invalid briefing filter');
  return {search:search.trim(),status,publicationStatus,scheduleStatus,archiveStatus,sort,page,pageSize};
}

export function withdrawalInput(input) {
  if (!uuid(input?.requestId) || !id(input.publicationId) || !Number.isSafeInteger(input.version) || input.version<1
    || !nonempty(input.reason,500) || input.reason.trim().length<3
    || Object.keys(input).some((key) => !['requestId','publicationId','version','reason'].includes(key))) throw new Error('Invalid withdrawal request');
  return {publicationId:input.publicationId,version:input.version,reason:input.reason.trim()};
}

export function validDeadline(value) {
  if (typeof value!=='string') return false;
  const parts=value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!parts || Number(parts[2])>23 || Number(parts[3])>59 || Number(parts[4])>59 || !Number.isFinite(Date.parse(value))) return false;
  const day=new Date(`${parts[1]}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0,10)===parts[1];
}

export function publicationInput(input) {
  if (!uuid(input?.requestId) || !Number.isSafeInteger(input.revision) || input.revision<1
    || !Array.isArray(input.workerIds) || !input.workerIds.length || input.workerIds.length>5000
    || !input.workerIds.every(id) || new Set(input.workerIds).size!==input.workerIds.length
    || (input.nextVersion!==undefined && (!Number.isSafeInteger(input.nextVersion) || input.nextVersion<1))
    || Object.keys(input).some((key) => !['requestId','revision','nextVersion','workerIds','dueAt','reminderMinutes'].includes(key))) throw new Error('Invalid publication request');
  const dueAt=input.dueAt ?? null;
  if (dueAt!==null && !validDeadline(dueAt)) throw new Error('Invalid deadline');
  const reminderMinutes=input.reminderMinutes ?? 0;
  if(![0,60,1440].includes(reminderMinutes) || (reminderMinutes && dueAt===null))throw Error('Invalid deadline reminder');
  // Missing version is retained only to match immutable receipts from older clients.
  return {revision:input.revision,workerIds:[...input.workerIds].sort(),dueAt:dueAt===null ? null : new Date(dueAt).toISOString(),...(reminderMinutes?{reminderMinutes}:{}),...(input.nextVersion!==undefined?{nextVersion:input.nextVersion}:{})};
}

export function schedulePublicationInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['requestId','revision','nextVersion','workerIds','dueAt','publishAt','reminderMinutes'].includes(key))
    || !Number.isSafeInteger(input.nextVersion) || input.nextVersion<1 || !validDeadline(input.publishAt)) throw Error('Invalid publication schedule');
  const request=publicationInput({requestId:input.requestId,revision:input.revision,workerIds:input.workerIds,dueAt:input.dueAt,reminderMinutes:input.reminderMinutes});
  const publishAt=new Date(input.publishAt).toISOString();
  if(request.dueAt!==null && request.dueAt<=publishAt) throw Error('Deadline must follow scheduled publication');
  return {...request,nextVersion:input.nextVersion,publishAt};
}

export function publicationReceiptReference(briefingId,kind,requestId) {
  if(!id(briefingId) || !['publish','schedule'].includes(kind) || !uuid(requestId)) throw Error('Invalid publication receipt request');
}

export function readySnapshot(briefing,workers,integrationMode,modes={}) {
  const responseMode=modes?.responseMode ?? 'question',deliveryMode=modes?.deliveryMode ?? 'both';
  if(!['question','acknowledge'].includes(responseMode) || !['text','voice','both'].includes(deliveryMode))
    throw new Error('Briefing response mode is unavailable');
  const value=briefing.prepared_json;
  const questionMode=responseMode==='question';
  if (briefing.state!=='ready' || !value || value.source!==briefing.source || !nonempty(value.title,120)
    || (questionMode && (!nonempty(value.question,500) || !Array.isArray(value.facts) || !value.facts.length || value.facts.length>12
      || !value.facts.every((fact) => nonempty(fact,500)) || !Array.isArray(value.rubric?.askedFacts)
      || !value.rubric.askedFacts.length || value.rubric.askedFacts.length>6 || !value.rubric.askedFacts.every((fact) => nonempty(fact,500)))))
    throw new Error('Briefing is not technically ready');
  // A device-speech demo marker is not a verified live private audio artifact.
  if (integrationMode!=='synthetic' || !['synthetic-local-v1','synthetic-instruction-v1'].includes(value.provenance?.adapter) || value.provenance.live!==false)
    throw new Error('Live publication artifact verification is unavailable');
  if(value.provenance.adapter==='synthetic-instruction-v1' && questionMode && value.rubric?.mode!=='multiple-choice') {
    const groups=value.rubric?.keywordGroups;
    if(value.rubric.mode!=='keywords' || !Array.isArray(groups) || !groups.length || groups.length>6
      || groups.some((group)=>!Array.isArray(group) || !group.length || group.length>3 || !group.every((word)=>nonempty(word,60))))
      throw new Error('Briefing is not technically ready');
  }
  const missingLanguages=workers.filter((worker) => {
    const language=value.languages?.[worker.language];
    return !language || !nonempty(language.title,120) || !nonempty(language.text,5000)
      || (questionMode && !nonempty(language.question,500))
      || (deliveryMode!=='text' && language.speech!=='device-synthesis-demo');
  }).map(worker=>worker.language);
  if(missingLanguages.length) throw new Error(unavailableRecipientLanguage(missingLanguages));
  if (Buffer.byteLength(JSON.stringify(value))>100000) throw new Error('Prepared content exceeds limit');
  if(value.rubric?.mode==='multiple-choice' && !validateMultipleChoice({...value,languages:Object.fromEntries(workers.map(worker=>[worker.language,value.languages?.[worker.language]]))}))throw new Error('Briefing is not technically ready');
  return {...value,responseMode,deliveryMode};
}

export function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value<1) throw new Error('Invalid draft revision');
}

export function copyDraftInput(input) {
  if (!input || typeof input!=='object' || Array.isArray(input) || !uuid(input.requestId) || input.confirmed!==true
    || !Number.isSafeInteger(input.revision) || input.revision<1 || typeof input.title!=='string'
    || input.title.trim().length<3 || input.title.length>120
    || Object.keys(input).some((key) => !['requestId','revision','title','confirmed'].includes(key))) throw new Error('Invalid draft copy request');
  return {requestId:input.requestId,revision:input.revision,title:input.title.trim()};
}

export function checkDraftCopyReplay(old,id,input) {
  if (old.source_briefing_id!==id || old.source_revision!==input.revision || old.title!==input.title) throw new Error('Draft copy request conflict');
}

export function archiveBriefingInput(input) {
  if (!input || typeof input!=='object' || Array.isArray(input) || !uuid(input.requestId) || input.confirmed!==true
    || !Number.isSafeInteger(input.revision) || input.revision<1 || !Number.isSafeInteger(input.nextVersion) || input.nextVersion<1
    || !nonempty(input.reason,500) || input.reason.trim().length<3
    || Object.keys(input).some(key=>!['requestId','revision','nextVersion','reason','confirmed'].includes(key))) throw new Error('Invalid briefing archive request');
  return {revision:input.revision,nextVersion:input.nextVersion,reason:input.reason.trim()};
}

export function draftInput(input,kind) {
  if (typeof input?.title!=='string' || input.title.trim().length<3 || input.title.length>120
    || typeof input.source!=='string' || input.source.trim().length<10 || input.source.length>4000) throw new Error('Title or source is invalid');
  if (Object.keys(input).some((key) => !['title','source',kind==='create' ? 'requestId' : 'revision',...(kind==='create'?['generationLanguages']:[])].includes(key))) throw new Error('Invalid draft request');
  if (kind==='create' && !uuid(input.requestId)) throw new Error('Invalid draft request');
  if (kind==='edit') expectedRevision(input.revision);
  return {title:input.title.trim(),source:input.source.trim(),...(kind==='create' && input.generationLanguages!==undefined?{generationLanguages:generationLanguages(input.generationLanguages)}:{})};
}

export function sourceAudioMetadata(input) {
  if(!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['requestId','title','generationLanguages','originalType'].includes(key))
    || !uuid(input.requestId) || typeof input.title!=='string' || input.title.trim().length<3 || input.title.length>120
    || typeof input.originalType!=='string' || input.originalType.length>100
    || !(input.originalType==='application/octet-stream' || /^audio\/[a-z0-9.+-]+(?:;[a-z0-9=.+ -]+)?$/i.test(input.originalType)))
    throw Error('Invalid source audio request');
  return {requestId:input.requestId,title:input.title.trim(),originalType:input.originalType.toLowerCase(),
    ...(input.generationLanguages!==undefined?{generationLanguages:generationLanguages(input.generationLanguages)}:{})};
}

export function reviewInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || !uuid(input.requestId) || input.confirmed!==true
    || Object.keys(input).some(key=>!['requestId','revision','question','facts','askedFacts','translations','confirmed'].includes(key))) throw new Error('Invalid draft review request');
  expectedRevision(input.revision);
  const question=input.question,facts=input.facts,askedFacts=input.askedFacts;
  if(typeof question!=='string' || question.length>500 || !Array.isArray(facts) || facts.length>12
    || !facts.every(fact=>nonempty(fact,500)) || !Array.isArray(askedFacts) || askedFacts.length>6
    || !askedFacts.every(fact=>nonempty(fact,500))) throw new Error('Invalid draft review request');
  const value={revision:input.revision,question:question.trim(),facts:facts.map(fact=>fact.trim()),askedFacts:askedFacts.map(fact=>fact.trim())};
  let translations;try {translations=translationEdits(input.translations);}catch {throw new Error('Invalid draft review request');}
  if(Object.keys(translations).length) value.translations=translations;
  if(new Set(value.facts).size!==value.facts.length || new Set(value.askedFacts).size!==value.askedFacts.length) throw new Error('Invalid draft review request');
  return value;
}

export function sameReview(a,b) {
  return a.revision===b.revision && a.question===b.question && JSON.stringify(a.facts)===JSON.stringify(b.facts) && JSON.stringify(a.askedFacts)===JSON.stringify(b.askedFacts)
    && JSON.stringify(translationEdits(a.translations))===JSON.stringify(translationEdits(b.translations));
}

export function checkedSyntheticReview(prepared,review) {
  if(!review) return prepared;
  if(Object.keys(translationEdits(review.translations)).length) throw new Error('Draft review requires unsupported synthetic preparation');
  if((review.question && review.question!==prepared.question) || (review.facts.length && JSON.stringify(review.facts)!==JSON.stringify(prepared.facts))
    || (review.askedFacts.length && JSON.stringify(review.askedFacts)!==JSON.stringify(prepared.rubric.askedFacts))) throw new Error('Draft review requires unsupported synthetic preparation');
  return {...prepared,provenance:{...prepared.provenance,reviewRevision:review.revision}};
}
