import {createProviderPacer} from './provider-pacing.mjs';
import {createProductionGeminiAdapter} from './gemini.mjs';
import {APPROVED_GEMINI_ADAPTER} from './provider-policy.mjs';
import {WORKER_LANGUAGE_CODES} from '../languages.mjs';
import {assertProductionAdmission} from '../postgres/production-admission.mjs';

export function productionGeminiSettings(env,scope){
  if(env.UNDERSTOOD_GEMINI_PAID_ACCOUNT!=='true')throw Error('An approved paid Gemini account is required');
  const settings={textModel:env.UNDERSTOOD_GEMINI_TEXT_MODEL,transcriptionModel:env.UNDERSTOOD_GEMINI_TRANSCRIPTION_MODEL,speechModel:env.UNDERSTOOD_GEMINI_SPEECH_MODEL,voice:env.UNDERSTOOD_GEMINI_VOICE};
  if(!['textModel','transcriptionModel','speechModel'].every(key=>typeof settings[key]==='string'&&/^gemini-[a-z0-9][a-z0-9.-]{1,72}$/.test(settings[key]))||typeof settings.voice!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(settings.voice))throw Error('Set explicit production Gemini models and voice');
  for(const [key,setting] of [['textLanguages','UNDERSTOOD_GEMINI_TEXT_LANGUAGES'],['speechLanguages','UNDERSTOOD_GEMINI_SPEECH_LANGUAGES']]){
    let languages;try{languages=JSON.parse(env[setting]);}catch{throw Error('Set reviewed Gemini language capabilities');}
    if(!Array.isArray(languages)||!languages.includes('en')||new Set(languages).size!==languages.length||!languages.every(code=>WORKER_LANGUAGE_CODES.includes(code))||!scope?.languages?.every(code=>languages.includes(code)))throw Error('Gemini language capabilities do not cover release scope');
    settings[key]=Object.freeze([...languages]);
  }
  return Object.freeze(settings);
}

export function productionGeminiAdapters(env,config,{fetchImpl=fetch}={}){
  assertProductionAdmission(config);
  if(config.service!=='worker'||!env.GEMINI_API_KEY)throw Error('Gemini credentials belong to the production worker');
  const settings=productionGeminiSettings(env,config.releaseScope),assertApproved=()=>assertProductionAdmission(config);
  const paceRequest=createProviderPacer({intervalMs:fetchImpl===fetch?6000:0,intervals:{[settings.speechModel]:fetchImpl===fetch?20000:0}});
  const textLanguages=settings.textLanguages.filter(code=>code==='en'||config.releaseScope.languages.includes(code)),speechLanguages=settings.speechLanguages.filter(code=>code==='en'||config.releaseScope.languages.includes(code));
  const options={...settings,textLanguages,speechLanguages,paceRequest,apiKey:env.GEMINI_API_KEY,dataClass:'real',paidAccount:true,assertApproved,fetchImpl};
  const raw=createProductionGeminiAdapter(options),withJournal=requestJournal=>createProductionGeminiAdapter({...options,requestJournal});
  const provenance=Object.freeze({adapter:APPROVED_GEMINI_ADAPTER,dataClass:'real'});
  const assessmentProvenance=Object.freeze({...provenance,model:settings.textModel,promptVersion:'gemini-assessment-v2',schemaVersion:'gemini-assessment-v2'});
  const transcriptionProvenance=Object.freeze({...provenance,model:settings.transcriptionModel,promptVersion:'gemini-verbatim-v1',schemaVersion:'gemini-inline-transcription-v1'});
  const permits=()=>{assertApproved();return true;};
  return Object.freeze({
    preparationAdapter:Object.freeze({...raw,withJournal,permitsPreparation:input=>{assertApproved();return input.languages.every(code=>textLanguages.includes(code)&&speechLanguages.includes(code));}}),
    assessmentAdapter:Object.freeze({provenance:assessmentProvenance,assessmentModel:settings.textModel,assess:raw.assess,withJournal,permitsAssessment:input=>{assertApproved();return config.releaseScope.languages.includes(input.language);}}),
    sourceAdapter:Object.freeze({provenance,transcriptionProvenance,model:settings.transcriptionModel,transcribe:raw.transcribe,permitsSourceAudio:permits,withJournal}),
    recordingAdapter:Object.freeze({provenance,transcriptionProvenance,assessmentProvenance,transcriptionModel:settings.transcriptionModel,assessmentModel:settings.textModel,transcribe:raw.transcribe,assess:raw.assess,permitsRecording:permits,withJournal}),
    caseFollowupAdapter:Object.freeze({...raw,withJournal}),
  });
}
