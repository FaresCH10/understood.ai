import {createGroqInstructionSpeech,vercelInstructionSpeech as groqOnly} from './groq-instruction-speech.mjs';
import {createAzureInstructionSpeech} from './azure-instruction-speech.mjs';
import {createNemotronAdapter,NEMOTRON_ULTRA_MODEL} from './nemotron.mjs';
import {translationCheck} from './prepared-bundle.mjs';

// Script conversion is independently checked before any Punjabi audio leaves
// the server. Displayed text and its manifest hash remain Shahmukhi.
export function createPunjabiSpeechConversion(adapter){
  return async(text,assertCurrent=async()=>{})=>{
    await assertCurrent();
    const source={title:'پنجابی',text,question:text};
    const result=await adapter.translate(source,'pa-Guru');
    await assertCurrent();
    translationCheck(await adapter.checkTranslation(source,result,'pa-Guru'));
    await assertCurrent();return result.text;
  };
}

export function vercelInstructionSpeech(env={},fetchImpl=fetch){
  if(env.UNDERSTOOD_VERCEL_INSTRUCTION_SPEECH!=='groq-azure')return groqOnly(env,fetchImpl);
  if(env.VERCEL_ENV!=='production'||env.UNDERSTOOD_TIER==='production')throw Error('Invalid Vercel instruction speech configuration');
  const groq=createGroqInstructionSpeech({apiKey:env.GROQ_API_KEY?.trim(),fetchImpl});
  // Adding the mode before the Azure resource exists must not disable en/ar.
  if(!env.AZURE_SPEECH_KEY?.trim()&&!env.AZURE_SPEECH_REGION?.trim())return groq;
  const model=env.NVIDIA_TEXT_MODEL?.trim()||NEMOTRON_ULTRA_MODEL;
  const conversion=env.NVIDIA_API_KEY?.trim()?createPunjabiSpeechConversion(createNemotronAdapter({
    apiKey:env.NVIDIA_API_KEY.trim(),textModel:model,dataClass:'synthetic',fetchImpl,timeoutMs:12000,
    requestJournal:{async beforeRequest(){return null;},async afterRequest(){}},
  })):undefined;
  const azure=createAzureInstructionSpeech({apiKey:env.AZURE_SPEECH_KEY?.trim(),region:env.AZURE_SPEECH_REGION?.trim(),fetchImpl,shahmukhiToGurmukhi:conversion});
  return Object.freeze({languages:Object.freeze([...groq.languages,...azure.languages]),maxCharacters:1000,label:'Groq + Azure Speech',
    provenance:{adapter:'nemotron-multilingual-voice-v1',speechModel:'orpheus/azure-neural',voice:'locale-neural-voices'},
    speech:(text,language,assertCurrent)=>groq.languages.includes(language)?groq.speech(text,language,assertCurrent):azure.speech(text,language,assertCurrent),
  });
}
