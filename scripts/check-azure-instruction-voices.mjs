import {AZURE_INSTRUCTION_VOICES} from '../server/ai/azure-instruction-speech.mjs';

const key=process.env.AZURE_SPEECH_KEY?.trim(),region=process.env.AZURE_SPEECH_REGION?.trim();
try{
  if(!key||key.length>300||/[\s\x00-\x1f\x7f]/.test(key)||!region||!/^[a-z][a-z0-9]{1,40}$/.test(region))throw Error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in your private environment file.');
  const response=await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,{
    headers:{'Ocp-Apim-Subscription-Key':key},redirect:'error',signal:AbortSignal.timeout(15000),
  });
  if(!response.ok){await response.body?.cancel();throw Error(`Azure voice-list check failed (${response.status}). Check the resource key and region.`);}
  const voices=await response.json();
  if(!Array.isArray(voices))throw Error('Azure returned an invalid voice list.');
  const available=new Set(voices.map(voice=>voice.ShortName)),missing=Object.values(AZURE_INSTRUCTION_VOICES).filter(voice=>!available.has(voice));
  console.log(JSON.stringify({region,configuredVoices:Object.keys(AZURE_INSTRUCTION_VOICES).length,missing,ready:missing.length===0},null,2));
  if(missing.length)process.exitCode=1;
}catch(error){
  // Provider bodies and exception details can contain sensitive request data.
  console.error(error.message.startsWith('Set ')||error.message.startsWith('Azure ')?error.message:'Azure voice-list check could not complete. Check connectivity and configuration.');
  process.exitCode=1;
}
