import {activationRequestInput,sameActivationRequest} from '../server/activation-request-input.mjs';
export type ActivationSession={clientContext:string;expiresAt:string};
export type PendingActivationRequest=ActivationSession & {requestId:string;body:{note:string|null;confirmed:true}};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const key=(session:ActivationSession)=>`understood:activation-request:${session.clientContext}`;
const isIso=(value:unknown):value is string=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const uuid=(value:unknown):value is string=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function checked(value:PendingActivationRequest,session:ActivationSession) {
  if(!session || !/^[a-f0-9]{64}$/.test(session.clientContext) || !Number.isFinite(Date.parse(session.expiresAt))
    || new Date(session.expiresAt).toISOString()!==session.expiresAt || Date.parse(session.expiresAt)<=Date.now())throw Error('The activation request session has ended.');
  if(!value || Object.keys(value).sort().join(',')!=='body,clientContext,expiresAt,requestId'
    || value.clientContext!==session.clientContext || value.expiresAt!==session.expiresAt || !value.body || 'requestId' in value.body)throw Error('Saved activation request cannot be verified.');
  activationRequestInput({...value.body,requestId:value.requestId});return value;
}
export function readActivationRequest(storage:Store,session:ActivationSession):PendingActivationRequest|null {
  const raw=storage.getItem(key(session));if(raw===null)return null;
  try{if(raw.length>8000)throw Error();return checked(JSON.parse(raw),session);}catch{throw Error('Saved activation request cannot be verified. No request was sent.');}
}
export function storeActivationRequest(storage:Store,value:PendingActivationRequest) {
  checked(value,value);const old=readActivationRequest(storage,value),raw=JSON.stringify(value);
  if(old && JSON.stringify(old)!==raw)throw Error('Resolve the saved activation request first.');
  storage.setItem(key(value),raw);if(storage.getItem(key(value))!==raw)throw Error('This tab cannot retain the request. No request was sent.');
}
export function clearActivationRequest(storage:Store,value:PendingActivationRequest) {
  const old=readActivationRequest(storage,value);if(!old || JSON.stringify(old)!==JSON.stringify(value))throw Error('Saved activation request changed.');
  storage.removeItem(key(value));if(storage.getItem(key(value))!==null)throw Error('Activation receipt could not be cleared.');
}
export type ActivationRecord={requestId:string;request:{note:string|null;confirmed:true};createdAt:string;state:'pending'|'accepted'|'declined';decidedAt:string|null;decisionRef:string|null;delivery:'platform_operations';changesApplied:false};
const keys=(row:unknown,list:string)=>!!row && typeof row==='object' && !Array.isArray(row) && Object.keys(row).sort().join(',')===list;
export function checkedActivationRecord(raw:unknown):ActivationRecord {
  const row=raw as ActivationRecord;
  if(!keys(row,'changesApplied,createdAt,decidedAt,decisionRef,delivery,request,requestId,state')
    || row.delivery!=='platform_operations' || row.changesApplied!==false || !isIso(row.createdAt)
    || !['pending','accepted','declined'].includes(row.state) || !keys(row.request,'confirmed,note'))throw Error('Activation receipt cannot be verified.');
  const request=activationRequestInput({...row.request,requestId:row.requestId});
  if(row.state==='pending') {if(row.decidedAt!==null || row.decisionRef!==null)throw Error('Activation receipt cannot be verified.');}
  else if(!isIso(row.decidedAt) || !uuid(row.decisionRef))throw Error('Activation receipt cannot be verified.');
  return {requestId:row.requestId,request,createdAt:row.createdAt,state:row.state,decidedAt:row.decidedAt,decisionRef:row.decisionRef,delivery:row.delivery,changesApplied:row.changesApplied};
}
function exactActivationRecord(raw:unknown,expected:PendingActivationRequest) {
  checked(expected,expected);const row=checkedActivationRecord(raw);
  if(row.requestId!==expected.requestId || !sameActivationRequest(row.request,expected.body))throw Error('Activation receipt does not match the saved request.');return row;
}
export function checkedActivationResult(raw:unknown,expected:PendingActivationRequest):ActivationRecord {
  const row=raw as ActivationRecord & {duplicate:boolean};
  if(!keys(row,'changesApplied,createdAt,decidedAt,decisionRef,delivery,duplicate,request,requestId,state') || typeof row.duplicate!=='boolean')throw Error('Activation acknowledgement cannot be verified.');
  const {duplicate,...record}=row;return exactActivationRecord(record,expected);
}
export function checkedActivationReceipt(raw:unknown,expected:PendingActivationRequest):ActivationRecord|null {
  checked(expected,expected);const row=raw as ActivationRecord & {found:boolean};
  if(keys(row,'found') && row.found===false)return null;
  if(!keys(row,'changesApplied,createdAt,decidedAt,decisionRef,delivery,found,request,requestId,state') || row.found!==true)throw Error('Activation receipt cannot be verified.');
  const {found,...record}=row;return exactActivationRecord(record,expected);
}
