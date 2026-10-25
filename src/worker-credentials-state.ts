export type WorkerCredentialState='none'|'setup'|'active';
export type WorkerCredentialStatus={workerId:string;workerCode:string;workerName:string|null;workerActive:boolean;companyId:string;
  state:WorkerCredentialState;loginId:string|null;credentialRevision:number;setupExpiresAt:string|null;setupAvailable:boolean;
  passwordChangedAt:string|null;updatedAt:string|null};
export type IssuedWorkerCredentialSetup={workerId:string;companyId:string;loginId:string;state:'setup';setupCode:string;
  setupExpiresAt:string;expiresInMinutes:number;credentialRevision:number};

const object=(value:unknown,fields:string[]):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value)
  && Object.keys(value).length===fields.length && Object.keys(value).every(key=>fields.includes(key));
const date=(value:unknown):value is string=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const identifier=(value:unknown,min:number,max:number)=>typeof value==='string' && value.length>=min && value.length<=max;
const setupCode=(value:unknown)=>typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export function checkedWorkerCredentialStatus(value:unknown,workerId:string):WorkerCredentialStatus {
  const invalid=()=>Error('Worker sign-in status cannot be verified.');
  if(!object(value,['workerId','workerCode','workerName','workerActive','companyId','state','loginId','credentialRevision','setupExpiresAt','setupAvailable','passwordChangedAt','updatedAt'])
    || value.workerId!==workerId || !identifier(value.workerCode,2,80) || !identifier(value.companyId,2,100)
    || (value.workerName!==null && !identifier(value.workerName,1,100)) || typeof value.workerActive!=='boolean'
    || !['none','setup','active'].includes(String(value.state)) || (value.loginId!==null && !identifier(value.loginId,2,80))
    || !Number.isSafeInteger(value.credentialRevision) || Number(value.credentialRevision)<0 || typeof value.setupAvailable!=='boolean'
    || [value.setupExpiresAt,value.passwordChangedAt,value.updatedAt].some(item=>item!==null && !date(item)))throw invalid();
  if(value.state==='none' && Number(value.credentialRevision)!==0)throw invalid();
  if(value.state==='active' && !value.passwordChangedAt)throw invalid();
  if(value.setupAvailable && (value.state!=='setup' || typeof value.setupExpiresAt!=='string' || Date.parse(value.setupExpiresAt)<=Date.now()))throw invalid();
  return value as WorkerCredentialStatus;
}

export function checkedWorkerCredentialSetup(value:unknown,expected:{workerId:string;companyId:string;loginId:string}):IssuedWorkerCredentialSetup {
  const invalid=()=>Error('Setup code cannot be verified.');
  if(!object(value,['workerId','companyId','loginId','state','setupCode','setupExpiresAt','expiresInMinutes','credentialRevision'])
    || value.workerId!==expected.workerId || value.companyId!==expected.companyId || value.loginId!==expected.loginId
    || value.state!=='setup' || !setupCode(value.setupCode) || !date(value.setupExpiresAt) || Date.parse(value.setupExpiresAt)<=Date.now()
    || !Number.isSafeInteger(value.expiresInMinutes) || Number(value.expiresInMinutes)<5 || Number(value.expiresInMinutes)>1440
    || !Number.isSafeInteger(value.credentialRevision) || Number(value.credentialRevision)<1)throw invalid();
  return value as IssuedWorkerCredentialSetup;
}

export function workerSetupHandout(issued:IssuedWorkerCredentialSetup,origin:string){
  return `Understood worker sign-in
Company ID: ${issued.companyId}
Worker ID: ${issued.loginId}
One-time setup code: ${issued.setupCode}
Setup code expires: ${new Date(issued.setupExpiresAt).toLocaleString()}
Open: ${origin}/#worker-access
Use this code once to create a password. Do not forward it.`;
}
