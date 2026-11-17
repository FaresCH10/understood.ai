import {inspectWav} from '../audio.mjs';
import {languageTextMatches} from '../languages.mjs';
import {normalizeGroqSpeech} from './groq-instruction-speech.mjs';

// Standard neural voices, not region-specific HD previews.
export const AZURE_INSTRUCTION_VOICES=Object.freeze({
  hi:'hi-IN-SwaraNeural',ur:'ur-PK-UzmaNeural',bn:'bn-BD-NabanitaNeural',
  ml:'ml-IN-SobhanaNeural',ta:'ta-IN-PallaviNeural',te:'te-IN-ShrutiNeural',
  ne:'ne-NP-HemkalaNeural',fil:'fil-PH-AngeloNeural',si:'si-LK-ThiliniNeural',
  ru:'ru-RU-SvetlanaNeural','pa-Guru':'pa-IN-VaaniNeural',id:'id-ID-GadisNeural',
});
const xml=text=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));

export function createAzureInstructionSpeech({apiKey,region,fetchImpl=fetch,timeoutMs=15000,shahmukhiToGurmukhi}={}){
  if(typeof apiKey!=='string'||!apiKey||apiKey.length>300||/[\s\x00-\x1f\x7f]/.test(apiKey))throw Error('Azure speech credentials are required');
  if(typeof region!=='string'||!/^[a-z][a-z0-9]{1,40}$/.test(region))throw Error('Invalid Azure speech region');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>20000)throw Error('Invalid speech timeout');
  const languages=Object.freeze([...Object.keys(AZURE_INSTRUCTION_VOICES),...(typeof shahmukhiToGurmukhi==='function'?['pa-Arab']:[])]);
  let active=0;const waiting=[];
  const acquire=()=>active<4?(active++,Promise.resolve()):new Promise(resolve=>waiting.push(resolve));
  const release=()=>{const next=waiting.shift();if(next)next();else active--;};
  return Object.freeze({languages,maxCharacters:1000,label:'Azure Speech',
    async speech(text,language,assertCurrent=async()=>{}){
      if(!languages.includes(language))throw Error('Azure instruction voice language unavailable');
      if(typeof text!=='string'||!text.trim()||text.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw Error('Invalid voice text');
      await acquire();
      try{
        await assertCurrent();
        if(language==='pa-Arab'){
          text=await shahmukhiToGurmukhi(text,assertCurrent);
          await assertCurrent();
          if(typeof text!=='string'||text.length>1500||!languageTextMatches('pa-Guru',text)||/\p{Script=Arabic}/u.test(text))throw Error('Invalid Punjabi speech conversion');
        }
        const voice=AZURE_INSTRUCTION_VOICES[language==='pa-Arab'?'pa-Guru':language];
        const locale=voice.split('-').slice(0,2).join('-');
        await assertCurrent();
        const response=await fetchImpl(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
          headers:{'Ocp-Apim-Subscription-Key':apiKey,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':'riff-16khz-16bit-mono-pcm'},
          body:`<speak version="1.0" xml:lang="${locale}"><voice name="${voice}">${xml(text)}</voice></speak>`,
        });
        if(!response.ok){await response.body?.cancel();throw Error(`Azure speech request failed (${response.status})`);}
        const max=2880044+65536,parts=[];let size=0;
        if(response.body?.getReader){
          const reader=response.body.getReader();
          try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('Speech response too large');parts.push(Buffer.from(value));}}
          catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
        }else{const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>max)throw Error('Speech response too large');parts.push(bytes);}
        // Azure can include RIFF metadata before data, just like Groq.
        const bytes=normalizeGroqSpeech(Buffer.concat(parts));inspectWav(bytes);
        await assertCurrent();return bytes;
      }finally{release();}
    },
  });
}
