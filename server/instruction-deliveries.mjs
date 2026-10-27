import {createHash} from 'node:crypto';

export const INSTRUCTION_DELIVERY_STATES=['preparing','available','blocked','failed','withdrawn'];

const uuid=(value)=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const nonempty=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max;

export function instructionRetryInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || !uuid(input.requestId)
    || Object.keys(input).some((key)=>key!=='requestId'))
    throw new Error('Invalid instruction retry request');
  return {requestId:input.requestId};
}

export function deliveryContent(content) {
  if(!content || typeof content!=='object' || Array.isArray(content)) return null;
  const value={title:content.title,text:content.text};
  if(typeof content.question==='string') value.question=content.question;
  if(content.questionType==='multiple-choice'){value.questionType=content.questionType;value.choices=content.choices;}
  if(typeof content.speech==='string' || (content.speech && typeof content.speech==='object')) value.speech=content.speech;
  return value;
}

export function deliveryContentHash(language,content,{responseMode,deliveryMode}) {
  const value=deliveryContent(content);
  if(!nonempty(language,35) || !value) throw new Error('Instruction delivery content unavailable');
  return createHash('sha256').update(JSON.stringify({language,responseMode,deliveryMode,content:value})).digest('hex');
}

export function deliveryStateCounts(rows) {
  const counts={preparing:0,available:0,blocked:0,failed:0,withdrawn:0};
  for(const row of rows) if(Object.hasOwn(counts,row.state)) counts[row.state]+=Number(row.count ?? row.n ?? 1);
  return counts;
}

export function unresolvedDeliveries(counts) {
  return counts.preparing+counts.blocked+counts.failed;
}
