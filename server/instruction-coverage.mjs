import {CANONICAL_SOURCE} from './domain.mjs';
import {WORKER_LANGUAGE_CODES} from './languages.mjs';

// The local synthetic processor stores demo translations for the seeded example
// in every worker locale and English only for arbitrary supervisor text.
export function syntheticInstructionLanguages(source) {
  return String(source ?? '').trim()===CANONICAL_SOURCE ? [...WORKER_LANGUAGE_CODES] : ['en'];
}

export function hostedInstructionLanguages(source,instructionTextAdapter) {
  const speechLanguages=/\p{Script=Arabic}/u.test(source)?[]:syntheticInstructionLanguages(source);
  return {
    textLanguages:instructionTextAdapter && speechLanguages.length?[...WORKER_LANGUAGE_CODES]:speechLanguages,
    speechLanguages,
  };
}

const stage=(pipeline,id)=>pipeline?.stages?.find((item)=>item?.id===id);

// Mirrors preparation: a configured adapter must declare text for every target and
// generated speech for voice delivery; the synthetic fixture uses device speech.
export function instructionCoverage({workers,source,deliveryMode='both',pipeline=null,instructionTextAdapter=null}={}) {
  if(!Array.isArray(workers) || !workers.length) throw new Error('Instruction audience is empty');
  if(workers.length>5000) throw new Error('Instruction audience exceeds limit');
  const counts=new Map();
  for(const worker of workers) {
    const language=typeof worker?.language==='string' ? worker.language : '';
    counts.set(language,(counts.get(language) || 0)+1);
  }
  const translation=stage(pipeline,'translation'),speech=stage(pipeline,'speech');
  const provider=translation?.configuration==='configured';
  const hosted=hostedInstructionLanguages(source,instructionTextAdapter);
  const translated=new Set(provider
    ? (Array.isArray(translation.declaredLanguages) ? translation.declaredLanguages : [])
    : hosted.textLanguages);
  const voiceReady=(language)=>deliveryMode==='text' || (provider
    ? speech?.configuration==='configured' && Array.isArray(speech.declaredLanguages) && speech.declaredLanguages.includes(language)
    : hosted.speechLanguages.includes(language));
  const languages=[...counts.entries()].map(([language,count])=>{
    const reason=!translated.has(language) ? 'language_unavailable' : !voiceReady(language) ? 'speech_unavailable' : null;
    return {language,workers:count,ready:!reason,reason};
  }).sort((a,b)=>a.language.localeCompare(b.language));
  const missing=languages.filter((item)=>!item.ready);
  return {total:workers.length,ready:workers.length-missing.reduce((sum,item)=>sum+item.workers,0),
    preparation:provider && pipeline?.dataClass==='real'?'provider':provider || instructionTextAdapter?'synthetic-provider':'synthetic-fixture',
    languages,missing};
}
