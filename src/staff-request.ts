import {validStaffSession,type PageSession} from './session-state.ts';
export type StaffRequestMethod='GET'|'POST'|'PATCH';
export type StaffRequestFormat='json'|'csv';

export function retainStaffRequest(previousUncertain:boolean,retained:boolean,error:{uncertain:boolean;fenced:boolean}|null) {
  return previousUncertain || retained && (!error || error.uncertain || error.fenced);
}

export class StaffRequestError extends Error {
  readonly uncertain:boolean;
  readonly status:number|null;
  readonly fenced:boolean;
  constructor(message:string,uncertain=false,status:number|null=null,fenced=false) {
    super(message);this.uncertain=uncertain;this.status=status;this.fenced=fenced;
  }
}

export function staffRequestBinding(session:PageSession) {
  return JSON.stringify([session.authenticated,session.role,session.clientContext,session.staffScope,session.staffRole,session.siteState,session.mode,session.expiresAt]);
}

export function createStaffRequest(session:PageSession,current:()=>boolean,fetcher:typeof fetch=fetch,now=Date.now,canMutate:()=>boolean=current,onSessionLost:()=>void=()=>{}) {
  const expected=Object.freeze({...session});
  return async function request<T>(path:string,body?:unknown,signal?:AbortSignal,method:StaffRequestMethod=body===undefined?'GET':'POST',format:StaffRequestFormat='json',waitForVerification?:()=>Promise<void>):Promise<T> {
    let url:URL;
    try {url=new URL(path,'http://staff.invalid');}catch {throw new StaffRequestError('Invalid staff request');}
    if(!path.startsWith('/api/') || path.length>8192 || /[\\#\u0000-\u001f\u007f]/.test(path)
      || url.origin!=='http://staff.invalid' || url.pathname!==path.split('?')[0])throw new StaffRequestError('Invalid staff request');
    if(!['GET','POST','PATCH'].includes(method) || method==='GET' && body!==undefined)throw new StaffRequestError('Invalid staff request');
    if(!['json','csv'].includes(format))throw new StaffRequestError('Invalid staff request');
    if(format==='csv' && (method!=='POST' || url.pathname!=='/api/people/imports/preview'
      || !(body instanceof Blob) || body.size<1 || body.size>256*1024
      || [...url.searchParams.keys()].length!==2 || [...url.searchParams.keys()].some(key=>!['requestId','filename'].includes(key))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.searchParams.get('requestId') || '')
      || !/^[^/\\\u0000-\u001f]{1,116}\.csv$/i.test(url.searchParams.get('filename') || '')))throw new StaffRequestError('Invalid staff request');
    const mutation=method!=='GET';
    let sent=false;
    const assertCurrent=(checkMutation=true)=>{
      if(!current() || !validStaffSession(expected,now()) || signal?.aborted || checkMutation && mutation && sent && !canMutate())throw new StaffRequestError('Session context changed or verification is pending. Saved request recovery is unchanged.',mutation && sent,null,true);
    };
    assertCurrent();
    if(mutation && !canMutate())throw new StaffRequestError('Session check in progress. No request was sent.',false,null,true);
    let encoded:string|Blob|undefined;
    try {encoded=format==='csv'?body as Blob:mutation?JSON.stringify(body):undefined;}catch {throw new StaffRequestError('Invalid staff request');}
    assertCurrent();
    const instructionSend=url.pathname==='/api/instructions/send' || /^\/api\/instructions\/sends\/[^/]+(?:\/retry)?$/.test(url.pathname);
    const timeout=AbortSignal.timeout(instructionSend?28000:15000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
    let response:Response,data:any,decoded=true;
    try {
      sent=true;response=await fetcher(path,{method,credentials:'include',cache:'no-store',redirect:'error',signal:requestSignal,
        headers:{'x-client-session-context':expected.clientContext!,...(mutation?{'content-type':format==='csv'?'text/csv':'application/json'}:{})},body:encoded});
      const confirmedCreation=mutation && response.status===201 && waitForVerification;
      assertCurrent(!confirmedCreation);
      if(response.status===401){onSessionLost();throw new StaffRequestError('Session context changed. Saved request recovery is unchanged.',false,401,true);}
      try{data=await response.json();}catch{decoded=false;}
      // The write already succeeded. Keep its response while a foreground check
      // settles, then apply the same identity and mutation fences as usual.
      if(confirmedCreation && !canMutate())await confirmedCreation();
      assertCurrent();
      if(requestSignal.aborted)throw new StaffRequestError('Connection interrupted. The saved outcome is not confirmed.',mutation);
    }catch(error) {
      if(error instanceof StaffRequestError)throw error;
      assertCurrent();throw new StaffRequestError('Connection interrupted. The saved outcome is not confirmed.',mutation);
    }
    if(!decoded) {
      if(response.status===401){onSessionLost();throw new StaffRequestError('Session context changed. Saved request recovery is unchanged.',false,response.status,true);}
      throw new StaffRequestError(`The service returned HTTP ${response.status}.`,mutation && (response.ok || response.status>=500),response.status);
    }
    if(!response.ok) {
      const lost=response.status===401 || response.status===409 && data?.error==='Session context changed';
      if(lost){onSessionLost();throw new StaffRequestError('Session context changed. Saved request recovery is unchanged.',false,response.status,true);}
      const message=typeof data?.error==='string' && data.error.length<=300 && !/[\u0000-\u001f\u007f]/.test(data.error)?data.error:'Staff request failed';
      throw new StaffRequestError(message,mutation && response.status>=500,response.status);
    }
    return data as T;
  };
}

export async function completeStaffRequest<T>(value:unknown,validate:(value:unknown)=>T|Promise<T>,complete:(result:T)=>void,current:()=>boolean,canComplete:()=>boolean=current):Promise<T> {
  const check=()=>{if(!current() || !canComplete())throw new StaffRequestError('Session context changed or verification is pending. Saved request recovery is unchanged.',true,null,true);};
  check();const result=await validate(value);check();complete(result);return result;
}
