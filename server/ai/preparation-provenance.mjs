import {bundleHash} from './prepared-bundle.mjs';
import {preparationInputHash} from './preparation-config.mjs';

const stages={prepare:'preparation',checkPreparation:'grounding_check',translate:'translation',checkTranslation:'translation_check',speech:'speech'};
const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const keys=(value,names)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===[...names].sort().join(',');

export function preparationStageProvenance(provider,stage) {
  if(!keys(provider,['adapter','dataClass','textModel','speechModel','voice','promptVersion','schemaVersion']) || provider.dataClass!=='synthetic'
    || !Object.values(stages).includes(stage)
    || !['adapter','textModel','speechModel','voice','promptVersion','schemaVersion'].every(key=>typeof provider[key]==='string' && /^[A-Za-z0-9._:/-]{1,100}$/.test(provider[key])))throw Error('Preparation provenance unavailable');
  return Object.freeze({adapter:provider.adapter,dataClass:'synthetic',model:provider[stage==='speech'?'speechModel':'textModel'],
    promptVersion:`${provider.promptVersion}-${stage.replaceAll('_','-')}`,schemaVersion:provider.schemaVersion});
}

export function preparationOperationEvidence(job,input,method,args,event,provider) {
  if(stages[method]!==event?.stage || event?.state!=='started' || event?.origin!=='generated' || !Array.isArray(args))throw Error('Preparation stage unavailable');
  if((['prepare','checkPreparation'].includes(method) && args[0]!==input.source)
    || (['translate','speech'].includes(method) && args[1]!==event.language) || (method==='checkTranslation' && args[2]!==event.language))throw Error('Preparation arguments changed');
  const provenance=preparationStageProvenance(provider,event.stage);
  const context={schema:'preparation-stage-input-v1',orgId:job.org_id,siteId:job.site_id,briefingId:job.briefing_id,jobId:job.id,
    revision:job.revision,runId:job.token,rootHash:preparationInputHash(input),argumentsHash:bundleHash(args),providerHash:bundleHash(provider),
    languages:[...input.languages],step:event.step,stage:event.stage,language:event.language,track:event.track};
  const inputHash=bundleHash(context);
  checkedPreparationOperation(context,provenance,{orgId:job.org_id,referenceId:job.id,claimToken:job.token,model:provenance.model,inputHash});
  Object.freeze(context.languages);
  return {inputHash,provenance,preparationContext:Object.freeze(context)};
}

export function checkedPreparationOperation(context,provenance,{orgId,referenceId,claimToken,model,inputHash}) {
  if(!keys(context,['schema','orgId','siteId','briefingId','jobId','revision','runId','rootHash','argumentsHash','providerHash','languages','step','stage','language','track'])
    || context.schema!=='preparation-stage-input-v1' || !['orgId','siteId','briefingId','jobId'].every(key=>id(context[key]))
    || context.orgId!==orgId || context.jobId!==referenceId || context.runId!==claimToken
    || !Number.isSafeInteger(context.revision) || context.revision<1 || !Number.isInteger(context.step) || context.step<1 || context.step>64
    || !Object.values(stages).includes(context.stage) || !['en','ar','ur'].includes(context.language)
    || (context.stage==='speech'?!['body','question'].includes(context.track):context.track!==null)
    || !['rootHash','argumentsHash','providerHash'].every(key=>hash(context[key]))
    || !Array.isArray(context.languages) || context.languages.length<1 || context.languages.length>3 || context.languages[0]!=='en'
    || new Set(context.languages).size!==context.languages.length || !context.languages.every(language=>['en','ar','ur'].includes(language))
    || !context.languages.includes(context.language) || !hash(inputHash) || bundleHash(context)!==inputHash
    || !keys(provenance,['adapter','dataClass','model','promptVersion','schemaVersion']) || provenance.dataClass!=='synthetic' || provenance.model!==model
    || !['adapter','promptVersion','schemaVersion'].every(key=>typeof provenance[key]==='string' && /^[a-z0-9-]{1,80}$/.test(provenance[key])))throw Error('Invalid preparation input evidence');
  return context;
}
