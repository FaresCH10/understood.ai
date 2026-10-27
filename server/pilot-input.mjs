import {tokenHash,normalizeEmail} from './auth-crypto.mjs';
import {isWorkerLanguage,WORKER_LANGUAGE_CODES} from './languages.mjs';

export const PILOT_SUBJECT='New Understood pilot request';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const token=/^[a-f0-9]{64}$/;
const clean=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value);
export function pilotInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['requestId','receiptToken','company','email','teamSize','languages','message','consent'].includes(key))
    || !uuid.test(input.requestId || '') || !token.test(input.receiptToken || '') || input.consent!==true
    || !clean(input.company,120) || !clean(input.email,254) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.email.trim())
    || !Number.isInteger(input.teamSize) || input.teamSize<1 || input.teamSize>5000
    || !Array.isArray(input.languages) || !input.languages.length || input.languages.length>WORKER_LANGUAGE_CODES.length
    || new Set(input.languages).size!==input.languages.length || input.languages.some(language=>!isWorkerLanguage(language))
    || typeof input.message!=='string' || input.message.length>2000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(input.message))throw Error('Invalid pilot request');
  const content={company:input.company.trim(),email:normalizeEmail(input.email),teamSize:input.teamSize,
    languages:WORKER_LANGUAGE_CODES.filter(language=>input.languages.includes(language)),message:input.message.trim(),consent:true};
  return {id:input.requestId.toLowerCase(),receiptHash:tokenHash(input.receiptToken),requestHash:tokenHash(JSON.stringify(content)),content};
}
export function pilotReceiptInput(id,secret) {
  if(typeof id!=='string' || !uuid.test(id) || typeof secret!=='string' || !token.test(secret))throw Error('Invalid pilot receipt');
  return {id:id.toLowerCase(),receiptHash:tokenHash(secret)};
}
export function pilotDestination(value=process.env.UNDERSTOOD_PILOT_TO) {
  if(value===undefined || value===null || value==='')return null;
  if(typeof value!=='string' || value.length>254 || value!==normalizeEmail(value) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value))throw Error('Invalid pilot destination');
  return value;
}
export const pilotReceipt=row=>row ? {found:true,id:row.id,delivery:row.state,createdAt:new Date(row.created_at).toISOString(),expiresAt:new Date(row.expires_at).toISOString()} : {found:false};
export const pilotMessage=row=>{const content=typeof row.content_json==='string' ? JSON.parse(row.content_json) : row.content_json;
  return {email:row.destination,subject:PILOT_SUBJECT,text:`Company: ${content.company}\nContact: ${content.email}\nTeam size: ${content.teamSize}\nLanguages: ${content.languages.join(', ')}\n\n${content.message}`};};
export function pilotHttpError(error) {
  const message=error?.message;
  if(['Invalid pilot request','Invalid pilot receipt','Invalid JSON'].includes(message))return {status:400,error:message};
  if(message==='Request too large')return {status:413,error:message};
  if(message==='Pilot request conflict')return {status:409,error:message};
  if(message==='Pilot request limit reached')return {status:429,error:'Too many requests. Try again later.'};
  return {status:503,error:'Pilot requests are temporarily unavailable'};
}
