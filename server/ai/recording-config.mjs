import {createGeminiAdapter,GEMINI_MODELS,GEMINI_ASSESSMENT_VERSION} from './gemini.mjs';
import {createOpenRouterAdapter,OPENROUTER_FREE_MODEL,OPENROUTER_ASSESSMENT_VERSION} from './openrouter.mjs';
import {transcriptionProvenance} from './audio-provenance.mjs';

export function resolveRecordingAdapter(env=process.env,{fetchImpl=fetch}={}) {
  const mode=env.UNDERSTOOD_RECORDING_ADAPTER ?? 'disabled';
  if(mode==='disabled')return undefined;
  if(!['gemini-free','openrouter-gemini'].includes(mode) || env.UNDERSTOOD_TIER!=='local' || env.UNDERSTOOD_AI_MODE!=='synthetic'
    || env.UNDERSTOOD_DATA_CLASS!=='synthetic' || env.UNDERSTOOD_ACCESS_MODE!=='credential')throw Error('Recording provider requires an isolated synthetic credential runtime');
  let hashes;
  try {
    const raw=env.UNDERSTOOD_SYNTHETIC_AUDIO_HASHES;
    if(typeof raw!=='string' || raw.length>7000)throw Error();hashes=JSON.parse(raw);
    if(!Array.isArray(hashes) || !hashes.length)throw Error();
  }catch {throw Error('Set explicit synthetic audio fixture hashes before enabling recording processing');}
  const audioOptions={apiKey:env.GEMINI_API_KEY,dataClass:'synthetic',syntheticAudioHashes:hashes,fetchImpl};
  const audio=createGeminiAdapter(audioOptions);
  if(mode==='gemini-free') {
    // This handle cannot prepare, translate or synthesize arbitrary content.
    return Object.freeze({provenance:Object.freeze({dataClass:'synthetic',adapter:'gemini-recording-allowlist-v1'}),
      transcriptionProvenance:transcriptionProvenance('gemini-recording-allowlist-v1',GEMINI_MODELS.transcription),
      assessmentProvenance:Object.freeze({adapter:'gemini-recording-assessment-v1',dataClass:'synthetic',model:GEMINI_MODELS.text,
        promptVersion:GEMINI_ASSESSMENT_VERSION,schemaVersion:GEMINI_ASSESSMENT_VERSION}),
      transcriptionModel:GEMINI_MODELS.transcription,assessmentModel:GEMINI_MODELS.text,
      permitsRecording:audio.permitsSourceAudio,transcribe:audio.transcribe,assess:audio.assess,
      withJournal:requestJournal=>{
        const metered=createGeminiAdapter({...audioOptions,requestJournal});
        return Object.freeze({transcribe:metered.transcribe,assess:metered.assess});
      }});
  }
  const model=env.OPENROUTER_MODEL || OPENROUTER_FREE_MODEL;
  const textOptions={apiKey:env.OPENROUTER_API_KEY,dataClass:'synthetic',textModel:model,fetchImpl};
  const text=createOpenRouterAdapter(textOptions);
  return Object.freeze({provenance:Object.freeze({dataClass:'synthetic',adapter:'openrouter-gemini-recording-v1'}),
    transcriptionProvenance:transcriptionProvenance('openrouter-gemini-recording-v1',GEMINI_MODELS.transcription),
    assessmentProvenance:Object.freeze({adapter:'openrouter-recording-assessment-v1',dataClass:'synthetic',model,
      promptVersion:OPENROUTER_ASSESSMENT_VERSION,schemaVersion:OPENROUTER_ASSESSMENT_VERSION}),
    transcriptionModel:GEMINI_MODELS.transcription,assessmentModel:model,
    permitsRecording:audio.permitsSourceAudio,transcribe:audio.transcribe,assess:text.assess,
    withJournal:requestJournal=>{
      const meteredAudio=createGeminiAdapter({...audioOptions,requestJournal}),meteredText=createOpenRouterAdapter({...textOptions,requestJournal});
      return Object.freeze({transcribe:meteredAudio.transcribe,assess:meteredText.assess});
    }});
}
