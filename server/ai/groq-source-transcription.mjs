import {inspectWav} from '../audio.mjs';

export function createGroqSourceTranscriber({apiKey,fetchImpl=fetch,timeoutMs=16000}={}){
  if(typeof apiKey!=='string'||!apiKey||apiKey.length>300||/[\s\x00-\x1f\x7f]/.test(apiKey))throw Error('Groq transcription credentials are required');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>20000)throw Error('Invalid transcription timeout');
  const model='whisper-large-v3';
  return Object.freeze({
    provenance:Object.freeze({adapter:'groq-source-v1',dataClass:'real'}),model,
    async transcribe(bytes,mime,row){
      if(!row?.request_id||!row.org_id||!row.site_id||!row.requested_by||!Number.isInteger(row.attempts)||row.attempts<1||row.attempts>3||mime!=='audio/wav')throw Error('Transcription requires a claimed source recording');
      const audio=Buffer.from(bytes),info=inspectWav(audio);
      if(info.sha256!==row.sha256||info.bytes!==row.bytes)throw Error('Source recording changed');
      const form=new FormData();form.set('file',new Blob([audio],{type:'audio/wav'}),'instruction.wav');
      form.set('model',model);form.set('response_format','json');form.set('temperature','0');
      const response=await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{authorization:`Bearer ${apiKey}`},body:form});
      if(!response.ok){await response.body?.cancel();throw Error(`Groq transcription request failed (${response.status})`);}
      let raw='',size=0;
      if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>128*1024)throw Error('Transcription response too large');raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}}
      else{raw=await response.text();if(Buffer.byteLength(raw)>128*1024)throw Error('Transcription response too large');}
      let result;try{result=JSON.parse(raw);}catch{throw Error('Invalid transcription response');}
      const text=typeof result?.text==='string'?result.text.trim():'';
      if(text.length<10||text.length>4000)throw Error('Recording needs at least ten characters of clear spoken instruction');
      return {text};
    },
  });
}

export function vercelSourceTranscription(env={},fetchImpl=fetch){
  const mode=env.UNDERSTOOD_VERCEL_SOURCE_TRANSCRIPTION??'disabled';
  if(mode==='disabled')return undefined;
  if(mode!=='groq'||env.VERCEL_ENV!=='production'||env.UNDERSTOOD_TIER==='production')throw Error('Invalid Vercel transcription configuration');
  return createGroqSourceTranscriber({apiKey:env.GROQ_API_KEY?.trim(),fetchImpl});
}
