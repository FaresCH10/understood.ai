import {createGeminiAdapter,GEMINI_MODELS,GEMINI_ASSESSMENT_VERSION} from './gemini.mjs';
import {createOpenRouterAdapter,OPENROUTER_FREE_MODEL,OPENROUTER_ASSESSMENT_VERSION} from './openrouter.mjs';
import {bundleHash} from './prepared-bundle.mjs';

export const assessmentInputHash=({answer,question,askedFacts,language,publicationId,version})=>bundleHash({answer,question,askedFacts,language,publicationId,version});

export function resolveAssessmentAdapter(env=process.env,{fetchImpl=fetch}={}) {
  const mode=env.UNDERSTOOD_ASSESSMENT_ADAPTER ?? 'disabled';
  if(mode==='disabled')return undefined;
  if(!['gemini-free','openrouter-free'].includes(mode) || env.UNDERSTOOD_TIER!=='local' || env.UNDERSTOOD_AI_MODE!=='synthetic'
    || env.UNDERSTOOD_DATA_CLASS!=='synthetic' || env.UNDERSTOOD_ACCESS_MODE!=='credential')throw Error('Assessment provider requires an isolated synthetic credential runtime');
  let hashes;
  try {
    const raw=env.UNDERSTOOD_SYNTHETIC_ASSESSMENT_HASHES;
    if(typeof raw!=='string' || raw.length>7000)throw Error();hashes=JSON.parse(raw);
    if(!Array.isArray(hashes) || !hashes.length || hashes.length>100 || new Set(hashes).size!==hashes.length
      || !hashes.every(hash=>typeof hash==='string' && /^[a-f0-9]{64}$/.test(hash)))throw Error();
  }catch {throw Error('Set exact synthetic assessment input hashes before enabling evaluation');}
  const permitted=new Set(hashes);
  if(mode==='gemini-free') {
    const options={apiKey:env.GEMINI_API_KEY,dataClass:'synthetic',fetchImpl};
    const adapter=createGeminiAdapter(options);
    return Object.freeze({provenance:Object.freeze({adapter:'gemini-typed-assessment-v1',dataClass:'synthetic',
      model:GEMINI_MODELS.text,promptVersion:GEMINI_ASSESSMENT_VERSION,schemaVersion:GEMINI_ASSESSMENT_VERSION}),
      assessmentModel:GEMINI_MODELS.text,assess:adapter.assess,
      permitsAssessment:input=>permitted.has(assessmentInputHash(input)),
      withJournal:requestJournal=>Object.freeze({assess:createGeminiAdapter({...options,requestJournal}).assess})});
  }
  const model=env.OPENROUTER_MODEL || OPENROUTER_FREE_MODEL;
  const options={apiKey:env.OPENROUTER_API_KEY,dataClass:'synthetic',textModel:model,fetchImpl};
  const adapter=createOpenRouterAdapter(options);
  return Object.freeze({provenance:Object.freeze({adapter:'openrouter-typed-assessment-v1',dataClass:'synthetic',
    model,promptVersion:OPENROUTER_ASSESSMENT_VERSION,schemaVersion:OPENROUTER_ASSESSMENT_VERSION}),
    assessmentModel:model,assess:adapter.assess,
    permitsAssessment:input=>permitted.has(assessmentInputHash(input)),
    withJournal:requestJournal=>Object.freeze({assess:createOpenRouterAdapter({...options,requestJournal}).assess})});
}
