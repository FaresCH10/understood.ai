import {createHash} from 'node:crypto';
export function clarificationFlowSection(value){
  if(value===null||value===undefined)return null;
  if(!['unread','done'].includes(value))throw Error('Invalid clarification filter');
  return value;
}
export function clarificationFlowInput(value){
  if(!value||Object.keys(value).sort().join(',')!=='requestId,text'||typeof value.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.requestId)
    ||typeof value.text!=='string'||value.text.trim().length<3||value.text.length>500)throw Error('Describe the part of the instruction that needs clarification');
  return {id:value.requestId,text:value.text.trim(),hash:createHash('sha256').update(value.text.trim()).digest('hex')};
}
export const clarificationTranslationHash=row=>createHash('sha256').update([row.id,row.source_language,row.target_language,row.attempt_id,row.kind,row.source_text].join('\u001f')).digest('hex');
