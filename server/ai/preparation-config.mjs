import {createGeminiAdapter,GEMINI_MODELS} from './gemini.mjs';
import {createOpenRouterAdapter,OPENROUTER_FREE_MODEL} from './openrouter.mjs';
import {bundleHash} from './prepared-bundle.mjs';

export const preparationInputHash=({source,revision,languages,review=null,glossary})=>bundleHash({source,revision,languages,review,glossary});

const hybridProvenance=Object.freeze({adapter:'openrouter-gemini-bundle-v1',dataClass:'synthetic',
  textModel:OPENROUTER_FREE_MODEL,speechModel:GEMINI_MODELS.speech,voice:'Kore',
  promptVersion:'openrouter-gemini-bundle-v1',schemaVersion:'openrouter-gemini-v1'});

export function resolvePreparationAdapter(env=process.env,{fetchImpl=fetch}={}) {
  const mode=env.UNDERSTOOD_PREPARATION_ADAPTER ?? 'disabled';
  if(mode==='disabled')return undefined;
  if(!['gemini-free','openrouter-gemini'].includes(mode) || env.UNDERSTOOD_TIER!=='local' || env.UNDERSTOOD_AI_MODE!=='synthetic'
    || env.UNDERSTOOD_DATA_CLASS!=='synthetic' || env.UNDERSTOOD_ACCESS_MODE!=='credential')throw Error('Preparation provider requires an isolated synthetic credential runtime');
  let hashes;
  try {
    const raw=env.UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES;
    if(typeof raw!=='string' || raw.length>7000)throw Error();hashes=JSON.parse(raw);
    if(!Array.isArray(hashes) || !hashes.length || hashes.length>100 || new Set(hashes).size!==hashes.length
      || !hashes.every(hash=>typeof hash==='string' && /^[a-f0-9]{64}$/.test(hash)))throw Error();
  }catch {throw Error('Set exact synthetic preparation input hashes before enabling generation');}
  const permitted=new Set(hashes);
  if(mode==='gemini-free') {
    const options={apiKey:env.GEMINI_API_KEY,dataClass:'synthetic',fetchImpl};
    const select=adapter=>Object.freeze(Object.fromEntries(['provenance','capabilities','prepare','checkPreparation','translate','checkTranslation','speech'].map(key=>[key,adapter[key]])));
    return Object.freeze({...select(createGeminiAdapter(options)),permitsPreparation:input=>permitted.has(preparationInputHash(input)),
      withJournal:requestJournal=>select(createGeminiAdapter({...options,requestJournal}))});
  }
  const textModel=env.OPENROUTER_MODEL || OPENROUTER_FREE_MODEL;
  const textOptions={apiKey:env.OPENROUTER_API_KEY,dataClass:'synthetic',textModel,fetchImpl};
  const audioOptions={apiKey:env.GEMINI_API_KEY,dataClass:'synthetic',fetchImpl};
  const provenance=Object.freeze({...hybridProvenance,textModel});
  const select=(text,audio)=>Object.freeze({provenance,capabilities:Object.freeze({textLanguages:Object.freeze(['en','ar','ur']),
    speechLanguages:Object.freeze(['en','ar'])}),prepare:text.prepare,checkPreparation:text.checkPreparation,translate:text.translate,
    checkTranslation:text.checkTranslation,speech:audio.speech});
  return Object.freeze({...select(createOpenRouterAdapter(textOptions),createGeminiAdapter(audioOptions)),
    permitsPreparation:input=>permitted.has(preparationInputHash(input)),
    withJournal:requestJournal=>select(createOpenRouterAdapter({...textOptions,requestJournal}),createGeminiAdapter({...audioOptions,requestJournal}))});
}
