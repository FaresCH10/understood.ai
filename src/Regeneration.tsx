import {WORKER_LOCALES,type WorkerLocaleCode} from '../server/languages.mjs';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {RefreshCw,X} from 'lucide-react';
import {readPendingReview} from './review-recovery';
import {clearPendingRegeneration,savePendingRegeneration,checkedRegenerationResult,checkedRegenerationReceipt,type PendingRegeneration} from './regeneration-recovery';
import {useBriefingRequest,BriefingRequestError} from './BriefingControls';
import type {StaffRequestAuthority} from './useStaffRequest';
import {retainStaffRequest} from './staff-request';

class RegenerationError extends Error {constructor(message:string,public uncertain=false){super(message);}}
const names=Object.fromEntries(WORKER_LOCALES.map(locale=>[locale.code,locale.englishName]));

export function RegenerationRecovery({pending,scope,onResolved,authority}:{pending:PendingRegeneration;scope:string;onResolved:(id:string)=>void;authority:StaffRequestAuthority}) {
  const {request,current:sessionCurrent,complete}=useBriefingRequest(authority);
  const [busy,setBusy]=useState(true),[checked,setChecked]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const sending=useRef(false),heading=useRef<HTMLHeadingElement>(null),resolved=useRef(onResolved);resolved.current=onResolved;
  useEffect(()=>{heading.current?.focus();},[]);
  const finish=(id:string)=>{clearPendingRegeneration(sessionStorage,scope,pending.requestId);resolved.current(id);};
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setChecked(false);setError('');
    request(`/briefing-regeneration/receipts/${pending.requestId}`,'GET',undefined,controller.signal).then(value=>complete(value,received=>checkedRegenerationReceipt(received,pending),accepted=>{if(controller.signal.aborted)return;if(accepted)finish(accepted.id);else setChecked(true);} ))
      .catch(reason=>{if(!controller.signal.aborted && sessionCurrent())setError(reason.message);}).finally(()=>{if(!controller.signal.aborted && sessionCurrent())setBusy(false);});
    return ()=>controller.abort();
  },[pending,scope,refresh,request,sessionCurrent,complete]);
  async function retry() {
    if(sending.current || busy || !checked || !sessionCurrent()) return;sending.current=true;setBusy(true);setError('');
    try {savePendingRegeneration(sessionStorage,scope,pending);const value=await request(`/briefings/${encodeURIComponent(pending.briefingId)}/regenerate`,'POST',{...pending.body,requestId:pending.requestId});await complete(value,value=>checkedRegenerationResult(value,pending),result=>finish(result.id));}
    catch(reason) {if(sessionCurrent()){setChecked(false);setError((reason as Error).message);}}
    finally {sending.current=false;if(sessionCurrent())setBusy(false);}
  }
  return <><h1 ref={heading} tabIndex={-1}>Recover regeneration</h1><section className="panel"><h2>{names[pending.body.language]} {pending.body.kind} · source revision {pending.body.revision}</h2><p role="status">{busy ? 'Checking saved regeneration...' : checked ? 'No saved receipt was found. You can retry the original confirmed request.' : 'The pending request has not been resolved.'}</p>{error && <p role="alert" className="record-error">{error}</p>}<div className="actions"><button className="button outline" disabled={busy} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={18}/>Check saved request</button>{checked && <button className="button primary" disabled={busy} onClick={()=>void retry()}><RefreshCw size={18}/>Retry original request</button>}</div></section></>;
}

export function RegenerationControl({id,revision,language,scope,disabled,onChanged,onEditingChange,authority}:{id:string;revision:number;language:WorkerLocaleCode;scope?:string|null;disabled:boolean;onChanged:()=>void;onEditingChange:(value:boolean)=>void;authority:StaffRequestAuthority}) {
  const {request,current,complete,ensureCompletion}=useBriefingRequest(authority);
  const [kind,setKind]=useState<'translation'|'audio'|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
  const pending=useRef<PendingRegeneration|null>(null),sending=useRef(false),consent=useRef<HTMLInputElement>(null),trigger=useRef<'translation'|'audio'|null>(null),commands=useRef<Partial<Record<'translation'|'audio',HTMLButtonElement|null>>>({}),focusBack=useRef(false);
  const locked=busy || uncertain;
  useEffect(()=>{if(kind) consent.current?.focus();else if(focusBack.current) {focusBack.current=false;if(trigger.current) commands.current[trigger.current]?.focus();}},[kind]);
  const close=()=>{if(locked) return;focusBack.current=true;setKind(null);onEditingChange(false);};
  const finish=(acceptedId:string)=>{ensureCompletion();if(acceptedId!==id) throw Error('Regeneration instruction changed.');clearPendingRegeneration(sessionStorage,scope!,pending.current!.requestId);pending.current=null;setUncertain(false);setKind(null);onEditingChange(false);onChanged();};
  async function submit(event:FormEvent) {
    event.preventDefault();if(sending.current || !confirmed || !kind || !current()) return;
    pending.current ||= {requestId:crypto.randomUUID(),briefingId:id,body:{revision,language,kind,confirmed:true}};
    sending.current=true;setBusy(true);setError('');let sent=false;
    try {
      if(!scope) throw new RegenerationError('Regeneration recovery scope is unavailable. Sign in again.');
      if(readPendingReview(sessionStorage,scope)) throw new RegenerationError('Recover the pending draft review first.');
      savePendingRegeneration(sessionStorage,scope,pending.current);sent=true;
      const submitted=pending.current,value=await request(`/briefings/${encodeURIComponent(submitted.briefingId)}/regenerate`,'POST',{...submitted.body,requestId:submitted.requestId});
      await complete(value,value=>checkedRegenerationResult(value,submitted),accepted=>finish(accepted.id));
    }catch(reason) {
      if(!current())return;
      let unknown=retainStaffRequest(uncertain,sent,reason instanceof BriefingRequestError?reason:null);
      if(sent && !unknown && scope) {try {clearPendingRegeneration(sessionStorage,scope,pending.current!.requestId);}catch {unknown=true;}}
      if(!unknown) pending.current=null;
      setUncertain(unknown);setError((reason as Error).message);
    }finally {sending.current=false;if(current())setBusy(false);}
  }
  async function check() {
    if(sending.current || !pending.current || !scope || !current()) return;sending.current=true;setBusy(true);setError('');
    try {const submitted=pending.current,value=await request(`/briefing-regeneration/receipts/${submitted.requestId}`);await complete(value,value=>checkedRegenerationReceipt(value,submitted),accepted=>{if(accepted)finish(accepted.id);else setError('No saved receipt was found. Retry the unchanged confirmed request.');});}
    catch(reason) {if(current())setError((reason as Error).message);}
    finally {sending.current=false;if(current())setBusy(false);}
  }
  return <div className="draft-review">{kind ? <form aria-label={`${names[language]} regeneration`} onSubmit={event=>void submit(event)} onKeyDown={event=>{if(event.key==='Escape' && !locked) {event.preventDefault();close();}}}>
    <h3>Regenerate {names[language]} {kind}</h3><p>{kind==='translation' ? 'Replace the selected translation override with automatic translation and new audio. Other languages and published versions stay unchanged.' : 'Generate new instruction and question audio from the exact selected text. Text, other languages and published versions stay unchanged.'}</p>
    <label className="recipient-row publish-confirm"><input ref={consent} type="checkbox" checked={confirmed} disabled={locked} onChange={event=>setConfirmed(event.target.checked)}/><span>Regenerate {names[language]} {kind} for this draft</span></label>
    {error && <p role="alert" className="record-error">{error}</p>}<div className="actions"><button className="button primary" disabled={busy || !confirmed}><RefreshCw size={18}/>{busy ? 'Submitting...' : uncertain ? 'Retry unchanged request' : 'Confirm regeneration'}</button>{uncertain && <button type="button" className="button outline" disabled={busy} onClick={()=>void check()}><RefreshCw size={18}/>Check saved request</button>}<button type="button" className="button outline" disabled={locked} onClick={close}><X size={18}/>Cancel</button></div>
  </form> : <div className="actions">{(['translation','audio'] as const).filter(value=>value==='audio' || language!=='en').map(value=><button key={value} ref={element=>{commands.current[value]=element;}} className="button outline" disabled={disabled} onClick={()=>{trigger.current=value;setKind(value);setConfirmed(false);setError('');onEditingChange(true);}}><RefreshCw size={18}/>Regenerate {value}</button>)}</div>}</div>;
}
