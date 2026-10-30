export type RegistrationReceipt={requestId:string;email:string;createdAt:string;state:'pending'|'accepted';verification?:'link'|'neon-code'};
export type VerificationResult={completed:true;signInRequired:true;duplicate:boolean};
const RECEIPT_KEY='understood:registration-receipt';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RegistrationError extends Error {
  readonly status:number|null;
  readonly uncertain:boolean;
  constructor(message:string,status:number|null=null,uncertain=false){super(message);this.status=status;this.uncertain=uncertain;}
}

export function verificationToken(hash:string) {
  return hash.match(/^#verify-registration\/([A-Za-z0-9_-]{43})$/)?.[1] ?? '';
}
export function readRegistrationReceipt(storage:Storage):RegistrationReceipt|null {
  const raw=storage.getItem(RECEIPT_KEY);
  if(!raw)return null;
  let value:unknown;try{value=JSON.parse(raw);}catch{return null;}
  const row=value as RegistrationReceipt;
  if(!row || typeof row.requestId!=='string' || !uuid.test(row.requestId) || typeof row.email!=='string'
    || row.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || typeof row.createdAt!=='string'
    || !Number.isFinite(Date.parse(row.createdAt)) || !['pending','accepted'].includes(row.state))return null;
  if(row.verification!==undefined&&!['link','neon-code'].includes(row.verification))return null;
  return {requestId:row.requestId,email:row.email,createdAt:row.createdAt,state:row.state,...(row.verification?{verification:row.verification}:{})};
}
export function saveRegistrationReceipt(storage:Storage,receipt:RegistrationReceipt) {
  storage.setItem(RECEIPT_KEY,JSON.stringify(receipt));
}
export function clearRegistrationReceipt(storage:Storage) {
  storage.removeItem(RECEIPT_KEY);
}
export function acceptedRegistrationReceipt(receipt:RegistrationReceipt,result:Record<string,unknown>):RegistrationReceipt {
  if(result.requestId!==undefined && (typeof result.requestId!=='string' || !uuid.test(result.requestId)))
    throw new RegistrationError('Registration receipt could not be confirmed.',null,true);
  return {...receipt,requestId:typeof result.requestId==='string'?result.requestId:receipt.requestId,
    state:'accepted',verification:result.verification==='neon-code'?'neon-code':'link'};
}
export function checkedVerification(value:unknown):VerificationResult {
  const row=value as VerificationResult;
  if(!row || typeof row!=='object' || row.completed!==true || row.signInRequired!==true || typeof row.duplicate!=='boolean')
    throw new RegistrationError('Verification could not be confirmed. Check your email before retrying.');
  return {completed:true,signInRequired:true,duplicate:row.duplicate};
}
async function post(path:string,body:unknown) {
  let response:Response,value:Record<string,unknown>;
  try {
    response=await fetch(`/api${path}`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    value=await response.json();
  } catch {throw new RegistrationError('The result could not be confirmed. Retry the same request before starting over.',null,true);}
  if(!response.ok) {
    if(response.status===404) throw new RegistrationError('Online account creation is not available in this environment.',404);
    if(response.status===400) throw new RegistrationError('Check the account details and try again.',400);
    if(response.status>=500) throw new RegistrationError('Account creation is temporarily unavailable. Your details remain in this tab.',response.status,true);
    if(typeof value.error==='string' && value.error) throw new RegistrationError(value.error,response.status);
    throw new RegistrationError('Account creation is unavailable. Check the service before retrying.',response.status);
  }
  return value;
}
export function requestAccount(body:{requestId:string;ownerName:string;email:string;password:string;companyName:string;country:string;phone?:string;acceptTerms:boolean;acceptPrivacy:boolean}) {
  return post('/auth/registrations',body);
}
export function resendAccount(body:{requestId:string;email:string}) {
  return post('/auth/registrations/resend',body);
}
export function verifyAccount(token:string) {
  return post('/auth/registrations/verify',{token});
}
export function verifyAccountCode(receipt:RegistrationReceipt,code:string){
  return post('/auth/registrations/verify-code',{requestId:receipt.requestId,email:receipt.email,code});
}
export function normalizeVerificationCode(value:string){
  return value.replace(/[٠-٩]/g,char=>String(char.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,char=>String(char.charCodeAt(0)-0x6f0)).replace(/\D/g,'').slice(0,6);
}
export async function registrationOptions(signal:AbortSignal){
  const response=await fetch('/api/auth/registrations/options',{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),credentials:'include',cache:'no-store'});
  if(!response.ok)throw new RegistrationError('Registration options unavailable.');
  const value=await response.json();
  if(typeof value?.available!=='boolean'||!['link','neon-code'].includes(value.verification))throw new RegistrationError('Registration options unavailable.');
  return value as {available:boolean;verification:'link'|'neon-code'};
}
