import {reviewRequestId} from './briefing-input.mjs';

export function activationRequestInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || input.confirmed!==true
    || Object.keys(input).sort().join(',')!=='confirmed,note,requestId'
    || input.note!==null && (typeof input.note!=='string' || input.note!==input.note.trim()
      || input.note.length<1 || input.note.length>500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.note)))
    throw Error('Invalid activation request');
  try {reviewRequestId(input.requestId);} catch {throw Error('Invalid activation request');}
  return {note:input.note,confirmed:true};
}
export const sameActivationRequest=(a,b)=>JSON.stringify(activationRequestInput({...a,requestId:'00000000-0000-4000-8000-000000000000'}))===JSON.stringify(activationRequestInput({...b,requestId:'00000000-0000-4000-8000-000000000000'}));
