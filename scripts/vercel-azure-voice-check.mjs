import {fileURLToPath} from 'node:url';
import {vercelInstructionSpeech} from '../server/ai/instruction-speech.mjs';
import {AZURE_INSTRUCTION_VOICES} from '../server/ai/azure-instruction-speech.mjs';
import {inspectWav} from '../server/audio.mjs';

// Fixed public test sentences only. Never load recordings or customer data.
const phrases={hi:'रास्ता साफ रखें।',ur:'راستہ صاف رکھیں۔',bn:'পথ পরিষ্কার রাখুন।',
  ml:'വഴി വൃത്തിയായി സൂക്ഷിക്കുക.',ta:'பாதையை சுத்தமாக வைத்திருங்கள்.',te:'దారిని శుభ్రంగా ఉంచండి.',
  ne:'बाटो सफा राख्नुहोस्।',fil:'Panatilihing malinis ang daanan.',si:'මාර්ගය පිරිසිදුව තබන්න.',
  ru:'Держите проход свободным.','pa-Guru':'ਰਸਤਾ ਸਾਫ਼ ਰੱਖੋ।','pa-Arab':'راستہ صاف رکھو۔',id:'Jaga jalan tetap bersih.'};

export async function checkAzureVoices({env=process.env,fetchImpl=fetch,log=console.log}={}){
  if(env.UNDERSTOOD_AZURE_VERIFY_BUILD!=='1')return;
  if(env.UNDERSTOOD_VERCEL_INSTRUCTION_SPEECH!=='groq-azure'||!env.AZURE_SPEECH_KEY||!env.AZURE_SPEECH_REGION)throw Error('Azure voice verification requires the configured groq-azure mode.');
  const speech=vercelInstructionSpeech(env,fetchImpl),region=env.AZURE_SPEECH_REGION.trim();
  const response=await fetchImpl(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,{
    headers:{'Ocp-Apim-Subscription-Key':env.AZURE_SPEECH_KEY.trim()},redirect:'error',signal:AbortSignal.timeout(15000),
  });
  if(!response.ok){await response.body?.cancel();throw Error(`Azure voice-list verification failed (${response.status}).`);}
  const list=await response.json();if(!Array.isArray(list))throw Error('Azure returned an invalid voice list.');
  const names=new Set(list.map(voice=>voice.ShortName));
  if(Object.values(AZURE_INSTRUCTION_VOICES).some(voice=>!names.has(voice)))throw Error('The Azure region is missing a required instruction voice.');
  for(const [language,text] of Object.entries(phrases)){
    try{
      const info=inspectWav(await speech.speech(text,language));
      log(JSON.stringify({azureVoiceVerified:language,durationSeconds:info.durationSeconds}));
    }catch(error){
      const status=/request failed \((\d{3})\)/.exec(error?.message??'')?.[1];
      throw Error(`Azure synthetic voice verification failed for ${language}${status?` (provider HTTP ${status})`:''}.`);
    }
  }
  log('All 13 Azure voice routes verified with synthetic phrases. No customer data used.');
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{await checkAzureVoices();}catch(error){console.error(error.message);process.exitCode=1;}
}
