import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Pause,Play,RefreshCw,Clock3,ShieldAlert,Archive,ArchiveRestore} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {completeStaffRequest,retainStaffRequest,StaffRequestError} from './staff-request';

export type AccessSite={id:string;name:string;workerAccess:'active'|'paused';accessRevision:number;lifecycle:'active'|'archived';lifecycleRevision:number};
type Session={clientContext:string;expiresAt:string};
type Body={requestId:string;siteId:string;revision:number;state:'active'|'paused'|'archived';reason:string;confirmed:true};
type Pending={expiresAt:string;body:Body};
function valid(value:unknown,session:Session,lifecycle:boolean):value is Pending {
  const p=value as Pending,b=p?.body;
  return !!p && Object.keys(p).length===2 && p.expiresAt===session.expiresAt && Date.parse(p.expiresAt)>Date.now() && !!b && Object.keys(b).length===6
    && typeof b.requestId==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.requestId)
    && typeof b.siteId==='string' && b.siteId.length>0 && b.siteId.length<=100 && !/[\x00-\x1f\x7f]/.test(b.siteId)
    && Number.isSafeInteger(b.revision) && b.revision>=0 && ['active',lifecycle?'archived':'paused'].includes(b.state)
    && ['pilot_review','operational','security'].includes(b.reason) && b.confirmed===true;
}
export function SiteWorkerAccess({authority,session,target,disabled,onLocked,onClose,onSaved,lifecycle=false}:{authority:StaffRequestAuthority;session:Session;target:AccessSite|null;disabled:boolean;onLocked:(v:boolean)=>void;onClose:()=>void;onSaved:()=>void;lifecycle?:boolean}) {
  const staffT=useStaffStaticText();
  const {request:staffRequest,current}=useStaffRequest(authority);
  const key=`understood:site-${lifecycle?'lifecycle':'access'}:${session.clientContext}`;
  const [dependencies,setDependencies]=useState<{label:string;count:number}[]|null>(null),[dependencyRefresh,setDependencyRefresh]=useState(0),[dependencyError,setDependencyError]=useState('');
  const [pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[missing,setMissing]=useState(false),[corrupt,setCorrupt]=useState(false),[rejected,setRejected]=useState(false);
  const [reason,setReason]=useState('pilot_review'),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const mounted=useRef(true),generation=useRef(0),uncertain=useRef(false),sending=useRef(false),selected=useRef(target),callbacks=useRef({onLocked,onClose,onSaved});callbacks.current={onLocked,onClose,onSaved};selected.current=target;
  const locked=!!target || !!pending || busy || corrupt;
  useEffect(()=>{if(current())callbacks.current.onLocked(locked);},[locked,current]);
  useEffect(()=>{if(target){setConfirmed(false);setReason('pilot_review');setMessage('');setError('');}},[target]);
  useEffect(()=>{const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;setDependencies(null);setDependencyError('');if(!lifecycle || !target)return;
    staffRequest<any>(`/api/settings/sites/${encodeURIComponent(target.id)}/lifecycle`,undefined,controller.signal)
      .then(value=>completeStaffRequest(value,row=>{const result=row as typeof value;if(!result || result.siteId!==target.id || result.revision!==target.lifecycleRevision || result.state!==target.lifecycle || !Array.isArray(result.dependencies) || result.dependencies.some((item:{label:unknown;count:unknown})=>typeof item.label!=='string' || !Number.isSafeInteger(item.count) || Number(item.count)<1))throw Error('Site changed. Close this form and refresh sites.');return result.dependencies;},value=>setDependencies(value),live))
      .catch(e=>{if(live())setDependencyError(e.message);});return()=>controller.abort();
  },[target,lifecycle,dependencyRefresh,current,staffRequest]);
  async function request(path:string,body?:Body) {
    return staffRequest<any>(`/api/settings/sites/${lifecycle?'lifecycle':'access'}${path}`,body);
  }
  function remove(value:Pending) {
    if(!current() || !authority.canMutate())throw Error('Session context changed. Saved access recovery is unchanged.');
    if(sessionStorage.getItem(key)!==JSON.stringify(value))throw Error('The saved access request changed. Reload before continuing.');
    sessionStorage.removeItem(key);if(sessionStorage.getItem(key)!==null)throw Error('Access recovery storage could not be cleared.');setPending(null);setMissing(false);setRejected(false);uncertain.current=false;
  }
  async function check(value:Pending) {
    if(sending.current)return;sending.current=true;setBusy(true);setError('');
    const epoch=generation.current,chosen=selected.current,live=()=>current() && mounted.current && epoch===generation.current;
    try{const result=await request(`/receipts/${value.body.requestId}`);
      await completeStaffRequest(result,row=>{
      const result=row as {found?:boolean;revision?:number;request?:Body};
      if(result?.found===false && Object.keys(result).length===1)return null;
      const b=value.body,r=result.request;
      if(!result || Object.keys(result).sort().join(',')!=='found,request,revision' || result.found!==true || result.revision!==b.revision+1 || !r || Object.keys(r).length!==5 || r.siteId!==b.siteId || r.revision!==b.revision || r.state!==b.state || r.reason!==b.reason || r.confirmed!==true)throw Error('Access receipt could not be verified.');return result;
      },receipt=>{if(receipt===null){setMissing(true);return;}const b=value.body;
      remove(value);setMessage(lifecycle?(b.state==='archived'?'Site archived.':'Site restored. Worker access remains paused.'):(b.state==='paused'?'Worker access paused.':'Worker access resumed.'));callbacks.current.onClose();callbacks.current.onSaved();
      },live,()=>live() && selected.current===chosen && authority.canMutate());
    }catch(e){if(live() && selected.current===chosen)setError((e as Error).message);}finally{if(live()){sending.current=false;setBusy(false);}}
  }
  async function send(value:Pending) {
    if(sending.current)return;sending.current=true;setBusy(true);setMissing(false);setRejected(false);setError('');
    const epoch=generation.current,chosen=selected.current,live=()=>current() && mounted.current && epoch===generation.current,previous=uncertain.current;
    try{if(sessionStorage.getItem(key)!==JSON.stringify(value))throw Error('The saved access request changed. Reload before continuing.');await request('',value.body);if(live())uncertain.current=true;}
    catch(e){if(live() && selected.current===chosen){uncertain.current=retainStaffRequest(previous,true,e instanceof StaffRequestError?e:null);setRejected(!uncertain.current && e instanceof StaffRequestError && [400,403,409].includes(e.status || 0));setError((e as Error).message);}}
    finally{if(live()){sending.current=false;setBusy(false);if(selected.current===chosen)void check(value);}}
  }
  function submit(event:FormEvent) {
    event.preventDefault();if(!current() || !authority.canMutate() || !target || disabled || !confirmed || pending || corrupt || sending.current || lifecycle && (!dependencies || target.lifecycle==='active' && dependencies.length>0))return;
    const value:Pending={expiresAt:session.expiresAt,body:{requestId:crypto.randomUUID(),siteId:target.id,revision:lifecycle?target.lifecycleRevision:target.accessRevision,state:lifecycle?(target.lifecycle==='active'?'archived':'active'):(target.workerAccess==='active'?'paused':'active'),reason,confirmed:true}};
    try{if(sessionStorage.getItem(key))throw Error('An earlier access request needs checking.');sessionStorage.setItem(key,JSON.stringify(value));if(sessionStorage.getItem(key)!==JSON.stringify(value))throw Error('Access request could not be saved.');setPending(value);void send(value);}catch(e){setError((e as Error).message);}
  }
  useEffect(()=>{mounted.current=true;generation.current++;try{if(!current())return;const raw=sessionStorage.getItem(key);if(raw){if(raw.length>2048)throw Error();const value:unknown=JSON.parse(raw);if(!valid(value,session,lifecycle))throw Error();uncertain.current=true;setPending(value);void check(value);}}catch{if(current()){setCorrupt(true);setError('Saved access request unavailable. Sign in again before changing access.');}}return()=>{mounted.current=false;generation.current++;sending.current=false;};},[key,current]);
  const frozen=disabled || busy;
  return <div className="site-access-editor">{message && <p role="status">{staffT.message(message)}</p>}{error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
    {pending && <div className="notice notice-amber"><Clock3 size={20}/><div><strong>{lifecycle?staffT("Site lifecycle"):staffT("Worker access")} {staffT("request awaiting confirmation")}</strong><p dir="auto">{pending.body.siteId}</p><div className="actions"><button className="button outline" disabled={frozen} onClick={()=>void check(pending)}><RefreshCw size={18}/>{staffT("Check")} {lifecycle?staffT("site"):staffT("access")} {staffT("receipt")}</button>{missing && <button className="button primary" disabled={frozen} onClick={()=>void send(pending)}><RefreshCw size={18}/>{staffT("Retry unchanged")} {lifecycle?staffT("site"):staffT("access")} {staffT("request")}</button>}{missing && rejected && <button className="button outline" disabled={frozen} onClick={()=>{try{remove(pending);callbacks.current.onClose();callbacks.current.onSaved();}catch(e){setError((e as Error).message);}}}>{staffT("Dismiss rejected request")}</button>}</div></div></div>}
    {target && !pending && !corrupt && <form className="site-create-form" onSubmit={submit}><fieldset disabled={frozen}><legend>{lifecycle?target.lifecycle==='active'?staffT("Archive site"):staffT("Restore site"):target.workerAccess==='active'?staffT("Pause worker access"):staffT("Resume worker access")}: {target.name}</legend>
      <div className="notice notice-amber"><ShieldAlert size={22}/><p>{lifecycle?target.lifecycle==='active'?staffT("New operational work will be blocked and worker sessions and links revoked. Staff can read saved history, and privacy cleanup continues. Already cached device data is not erased."):staffT("Operational work can resume. Worker access stays paused until explicitly resumed with newly issued links. Saved history is unchanged."):target.workerAccess==='active'?staffT("Current worker sessions and links will be revoked. Already cached device data is not erased. Staff access, saved responses and processing history are preserved."):staffT("Workers will need newly issued access links. Previously revoked links and sessions will not be restored.")}</p></div>
      {lifecycle && <div>{dependencyError?<p role="alert">{dependencyError}</p>:dependencies===null?<p role="status">{staffT("Checking site dependencies...")}</p>:dependencies.length>0?<><p>{staffT("Close these dependencies before archiving:")}</p><ul>{dependencies.map(item=><li key={item.label}>{item.label}: {item.count}</li>)}</ul></>:<p>{staffT("No active dependencies.")}</p>}<button type="button" className="button outline" onClick={()=>{setConfirmed(false);setDependencyRefresh(n=>n+1);}}><RefreshCw size={18}/>{staffT("Refresh dependencies")}</button></div>}
      <label className="field">{staffT("Reason")}<select value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}><option value="pilot_review">{staffT("Pilot review")}</option><option value="operational">{staffT("Operational change")}</option><option value="security">{staffT("Security review")}</option></select></label>
      <label className="billing-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{staffT("I understand the")} {lifecycle?staffT("site lifecycle"):staffT("worker access")} {staffT("impact.")}</span></label><div className="actions"><button type="button" className="button outline" onClick={()=>callbacks.current.onClose()}>{staffT("Cancel")} {lifecycle?staffT("site"):staffT("access")} {staffT("change")}</button><button className="button primary" disabled={!confirmed || lifecycle && (!dependencies || target.lifecycle==='active' && dependencies.length>0)}>{lifecycle?(target.lifecycle==='active'?<Archive size={18}/>:<ArchiveRestore size={18}/>):(target.workerAccess==='active'?<Pause size={18}/>:<Play size={18}/>)}{staffT("Confirm")} {lifecycle?target.lifecycle==='active'?staffT("archive"):staffT("restore"):target.workerAccess==='active'?staffT("pause"):staffT("resume")}</button></div>
    </fieldset></form>}
  </div>;
}
