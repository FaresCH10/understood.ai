import {isWorkerLanguage} from './languages.mjs';
import {reviewRequestId,expectedRevision} from './briefing-input.mjs';

export function regenerationInput(input) {
  const invalid=()=>{throw Error('Invalid regeneration request');};
  if(!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['requestId','revision','language','kind','confirmed'].includes(key))
    || input.confirmed!==true || input.revision>2147483646 || !isWorkerLanguage(input.language)
    || !['translation','audio'].includes(input.kind) || (input.kind==='translation' && input.language==='en')) invalid();
  try {reviewRequestId(input.requestId);expectedRevision(input.revision);}catch {invalid();}
  return {revision:input.revision,language:input.language,kind:input.kind};
}
