import {normalizeSpeechWav} from './speech-wav.mjs';
import {inspectWav} from '../audio.mjs';

export const GROQ_SPEECH_LANGUAGES=Object.freeze(['en','ar']);
export const GROQ_SPEECH_MAX_CHARACTERS=1000;
const voices={en:{model:'canopylabs/orpheus-v1-english',voice:'austin'},ar:{model:'canopylabs/orpheus-arabic-saudi',voice:'fahad'}};

export function normalizeGroqSpeech(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<44||bytes.length>44+90*24000*2+65536||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('Unsupported Groq speech WAV');
  const streamed=bytes.readUInt32LE(4)===0xffffffff;
  if(!streamed&&bytes.readUInt32LE(4)!==bytes.length-8)throw Error('Incomplete Groq speech WAV');
  let offset=12,format=null,samples=null,metadata=0,count=0;
  while(offset<bytes.length){
    if(++count>10||offset+8>bytes.length)throw Error('Unsupported Groq speech WAV');
    const kind=bytes.toString('ascii',offset,offset+4),declared=bytes.readUInt32LE(offset+4);offset+=8;
    const size=declared===0xffffffff&&kind==='data'&&streamed?bytes.length-offset:declared;
    if(size>bytes.length-offset)throw Error('Incomplete Groq speech WAV');
    if(kind==='fmt '){if(format||size!==16)throw Error('Unsupported Groq speech WAV');format=bytes.subarray(offset,offset+size);}
    else if(kind==='data'){if(samples||!format||size%2)throw Error('Unsupported Groq speech WAV');samples=bytes.subarray(offset,offset+size);}
    else if(['LIST','JUNK','fact'].includes(kind)){metadata+=size;if(metadata>65536)throw Error('Groq speech metadata too large');}
    else throw Error('Unsupported Groq speech WAV');
    offset+=size+(size%2);
  }
  if(offset!==bytes.length||!format||!samples)throw Error('Incomplete Groq speech WAV');
  const canonical=Buffer.alloc(44+samples.length);canonical.write('RIFF');canonical.writeUInt32LE(canonical.length-8,4);canonical.write('WAVEfmt ',8);canonical.writeUInt32LE(16,16);format.copy(canonical,20);canonical.write('data',36);canonical.writeUInt32LE(samples.length,40);samples.copy(canonical,44);
  return normalizeSpeechWav(canonical);
}

export function groqSpeechChunks(text){
  if(typeof text!=='string'||!text.trim()||text.length>GROQ_SPEECH_MAX_CHARACTERS)throw Error('Voice text must be between 1 and 1000 characters');
  const chunks=[];let rest=text.trim();
  while(rest.length>200){
    let end=200;
    while(end>0&&!/\s/.test(rest[end]))end--;
    if(!end)throw Error('Voice text contains a word longer than the speech limit');
    chunks.push(rest.slice(0,end).trim());rest=rest.slice(end).trim();
  }
  if(rest)chunks.push(rest);return chunks;
}

export function createGroqInstructionSpeech({apiKey,fetchImpl=fetch,timeoutMs=12000}={}){
  if(typeof apiKey!=='string'||!apiKey||apiKey.length>300||/[\s\x00-\x1f\x7f]/.test(apiKey))throw Error('Groq speech credentials are required');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>20000)throw Error('Invalid speech timeout');
  let active=0;const waiting=[];
  const acquire=()=>active<2?(active++,Promise.resolve()):new Promise(resolve=>waiting.push(resolve));
  const release=()=>{const next=waiting.shift();if(next)next();else active--;};
  async function clip(text,language,assertCurrent){
    await acquire();
    try{
      await assertCurrent();
      const response=await fetchImpl('https://api.groq.com/openai/v1/audio/speech',{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
        headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify({...voices[language],input:text,response_format:'wav'})});
      if(!response.ok){await response.body?.cancel();throw Error(`Groq speech request failed (${response.status})`);}
      const chunks=[];let size=0;const max=44+90*24000*2+65536;
      if(response.body?.getReader){const reader=response.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max)throw Error('Speech response too large');chunks.push(Buffer.from(part.value));}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}}
      else{const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>max)throw Error('Speech response too large');chunks.push(bytes);}
      return normalizeGroqSpeech(Buffer.concat(chunks));
    }finally{release();}
  }
  return Object.freeze({languages:GROQ_SPEECH_LANGUAGES,maxCharacters:GROQ_SPEECH_MAX_CHARACTERS,label:'Groq Orpheus',
    async speech(text,language,assertCurrent=async()=>{}){
      if(!voices[language])throw Error('Groq speech supports English and Arabic only');
      const parts=[];let size=0;
      for(const chunk of groqSpeechChunks(text)){
        await assertCurrent();const bytes=await clip(chunk,language,assertCurrent);await assertCurrent();const samples=bytes.subarray(44);size+=samples.length;
        if(size>2880000)throw Error('Generated voice exceeds 90 seconds. Shorten the instruction.');parts.push(samples);
      }
      const bytes=Buffer.alloc(44+size);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(size,40);
      let offset=44;for(const samples of parts){samples.copy(bytes,offset);offset+=samples.length;}inspectWav(bytes);return bytes;
    },
  });
}

export function vercelInstructionSpeech(env={},fetchImpl=fetch){
  const mode=env.UNDERSTOOD_VERCEL_INSTRUCTION_SPEECH??'disabled';
  if(mode==='disabled')return undefined;
  if(mode!=='groq'||env.VERCEL_ENV!=='production'||env.UNDERSTOOD_TIER==='production')throw Error('Invalid Vercel instruction speech configuration');
  return createGroqInstructionSpeech({apiKey:env.GROQ_API_KEY?.trim(),fetchImpl});
}
