import {isWorkerLanguage} from './languages.mjs';
import {syntheticInstructionLanguages} from './instruction-coverage.mjs';
export function instructionReadiness(config,source){
 if(typeof source!=='string'||source.length>4000)throw Error('Invalid instruction request');
 const adapter=config.preparationAdapter;
 if(adapter){
  const languages=adapter.capabilities?.textLanguages?.filter(isWorkerLanguage)||[];
  const speech=adapter.capabilities?.speechLanguages?.filter(isWorkerLanguage)||[];
  return {mode:config.integrationMode==='live'?'live':'verification',textLanguages:languages,speechLanguages:speech};
 }
 const languages=/\p{Script=Arabic}/u.test(source)?[]:syntheticInstructionLanguages(source);
 return {mode:'synthetic',textLanguages:languages,speechLanguages:languages};
}
