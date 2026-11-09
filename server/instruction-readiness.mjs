import {isWorkerLanguage} from './languages.mjs';
import {hostedInstructionLanguages} from './instruction-coverage.mjs';
export function instructionReadiness(config,source){
 if(typeof source!=='string'||source.length>4000)throw Error('Invalid instruction request');
 const adapter=config.preparationAdapter;
 if(adapter){
  const languages=adapter.capabilities?.textLanguages?.filter(isWorkerLanguage)||[];
  const speech=adapter.capabilities?.speechLanguages?.filter(isWorkerLanguage)||[];
  return {mode:config.integrationMode==='live'?'live':'verification',textLanguages:languages,speechLanguages:speech};
 }
 return {mode:config.instructionTextAdapter?'gemma4-text':'synthetic',...hostedInstructionLanguages(source,config.instructionTextAdapter)};
}
