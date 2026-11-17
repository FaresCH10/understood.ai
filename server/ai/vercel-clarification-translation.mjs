import {createDeepLTranslateAdapter} from './deepl-translate.mjs';
import {createNemotronAdapter,NEMOTRON_ULTRA_MODEL} from './nemotron.mjs';

// Match the existing Vercel text-delivery admission. The approved live runtime
// retains its durable worker and provider-budget journal.
export function vercelClarificationTranslation(env={},fetchImpl=fetch){
  if(env.VERCEL_ENV!=='production'||env.UNDERSTOOD_TIER==='production'
    ||env.UNDERSTOOD_INSTRUCTION_TEXT_PROVIDER!=='nemotron'||!env.DEEPL_API_KEY?.trim()||!env.NVIDIA_API_KEY?.trim())return null;
  const textModel=env.NVIDIA_TEXT_MODEL?.trim()||NEMOTRON_ULTRA_MODEL;
  const translator=createDeepLTranslateAdapter({apiKey:env.DEEPL_API_KEY.trim(),fetchImpl,timeoutMs:6000,sourceLanguage:null});
  const checker=createNemotronAdapter({apiKey:env.NVIDIA_API_KEY.trim(),dataClass:'synthetic',textModel,fetchImpl,timeoutMs:12000,
    requestJournal:{async beforeRequest(){return null;},async afterRequest(){}}});
  return Object.freeze({
    provenance:Object.freeze({adapter:'nemotron-deepl-clarification-v1',dataClass:'synthetic',textModel,translationModel:'deepl-v2'}),
    translate:(content,language)=>translator.translate(content,language),
    checkTranslation:(content,translation,language)=>checker.checkTranslation(content,translation,language),
  });
}
