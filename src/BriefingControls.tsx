import { useEffect,useMemo,useRef,useState } from 'react';
import {Pencil,Save,X,ArchiveX,TriangleAlert,Copy,Archive} from 'lucide-react';
import {keepDialogFocus} from './dialog-focus';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {StaffRequestError,completeStaffRequest,type StaffRequestMethod} from './staff-request';

export class BriefingRequestError extends Error {constructor(message:string,public uncertain=false,public status?:number,public fenced=false){super(message);}}
export function useBriefingRequest(authority:StaffRequestAuthority) {
  const scoped=useStaffRequest(authority),latest=useRef(authority);latest.current=authority;
  return useMemo(()=>({...scoped,
    request:async<T,>(path:string,method:StaffRequestMethod='GET',body?:unknown,signal?:AbortSignal):Promise<T>=>{
      try{return await scoped.request<T>('/api'+path,body,signal,method);}catch(error){if(error instanceof StaffRequestError)throw new BriefingRequestError(error.message,error.uncertain,error.status??undefined,error.fenced);throw error;}
    },
    complete:<T,>(value:unknown,validate:(value:unknown)=>T|Promise<T>,done:(result:T)=>void)=>completeStaffRequest(value,validate,done,scoped.current,()=>latest.current.canMutate()),
    ensureCompletion:()=>{if(!scoped.current() || !latest.current.canMutate())throw new BriefingRequestError('Session verification changed or is pending. Saved recovery is unchanged.',true,undefined,true);},
    sourceFetch:async(input:RequestInfo|URL,options:RequestInit={})=>{
      if(typeof input!=='string' || !/^\/api\/source-audio(?:\/[A-Za-z0-9_-]{1,100})?$/.test(input))throw new BriefingRequestError('Invalid source request.',false,undefined,true);
      if(!scoped.current() || options.method && options.method!=='GET' && !latest.current.canMutate())throw new BriefingRequestError('Session verification changed or is pending. No upload was started.',false,undefined,true);
      if(new Headers(options.headers).get('x-client-session-context')!==authority.session.clientContext)throw new BriefingRequestError('Source request identity changed.',false,undefined,true);
      const response=await fetch(input,{...options,credentials:'include',cache:'no-store',redirect:'error'});
      if(!scoped.current() || options.method && options.method!=='GET' && !latest.current.canMutate())throw new BriefingRequestError('Source outcome is not confirmed. Saved recovery is unchanged.',options.method==='POST',undefined,true);
      if(response.status===401)latest.current.onSessionLost();
      return response;
    },
  }),[scoped]);
}

export function DraftEditor({id,revision,title,source,onChanged,onEditingChange,authority,disabled=false}:{id:string;revision:number;title:string;source:string;onChanged:()=>void;onEditingChange:(editing:boolean)=>void;authority:StaffRequestAuthority;disabled?:boolean}) {
  const {request,current,complete}=useBriefingRequest(authority),inFlight=useRef(false);
  const [editing,setEditing]=useState(false),[draftTitle,setTitle]=useState(title),[draftSource,setSource]=useState(source);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(event:React.FormEvent) {
    event.preventDefault();if(inFlight.current || !current())return;inFlight.current=true;setBusy(true);setError('');
    try {const result=await request(`/briefings/${encodeURIComponent(id)}`,'PATCH',{revision,title:draftTitle,source:draftSource});await complete(result,value=>value,()=>{setEditing(false);onEditingChange(false);onChanged();});}
    catch(err) {if(current())setError((err as Error).message);} finally {inFlight.current=false;if(current())setBusy(false);}
  }
  if (!editing) return <><p className="source-text">{source}</p><button className="button outline" disabled={disabled} onClick={() => {setTitle(title);setSource(source);setError('');setEditing(true);onEditingChange(true);}}><Pencil size={18} />Edit draft</button></>;
  return <form onSubmit={(event) => void save(event)}>
    <label className="field">Draft title<input value={draftTitle} disabled={busy} minLength={3} maxLength={120} required onChange={(event) => setTitle(event.target.value)} /></label>
    <label className="field">Draft text<textarea value={draftSource} disabled={busy} rows={6} minLength={10} maxLength={4000} required onChange={(event) => setSource(event.target.value)} /></label>
    <p>Saving source edits resets optional review inputs and dependent readiness. Published versions stay unchanged.</p>
    {error && <p role="alert" className="record-error">{error}</p>}
    <div className="actions"><button type="submit" className="button primary" disabled={busy || (draftTitle===title && draftSource===source)}><Save size={18} />Save draft</button><button type="button" className="button outline" disabled={busy} onClick={() => {setEditing(false);onEditingChange(false);}}><X size={18} />Cancel</button></div>
  </form>;
}

export function CopyDraftControl({id,revision,title,disabled,onCopied,authority}:{id:string;revision:number;title:string;disabled:boolean;onCopied:(id:string)=>void;authority:StaffRequestAuthority}) {
  const {request,current,complete}=useBriefingRequest(authority);
  const dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false),retry=useRef<{key:string;requestId:string}|null>(null);
  const [copyTitle,setCopyTitle]=useState(''),[sourceRevision,setSourceRevision]=useState(revision),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  function open() {
    retry.current=null;setCopyTitle(`${title.slice(0,113)} (copy)`);setSourceRevision(revision);setConfirmed(false);setError('');dialog.current?.showModal();
  }
  async function copy(event:React.FormEvent) {
    event.preventDefault();if(inFlight.current || !confirmed || copyTitle.trim().length<3 || !current()) return;
    inFlight.current=true;setBusy(true);setError('');
    try {
      const normalized=copyTitle.trim(),key=JSON.stringify({id,revision:sourceRevision,title:normalized});
      if(retry.current?.key!==key) retry.current={key,requestId:crypto.randomUUID()};
      const result=await request<{id:string}>(`/briefings/${encodeURIComponent(id)}/copy`,'POST',{requestId:retry.current.requestId,revision:sourceRevision,title:normalized,confirmed:true});
      await complete(result,value=>{const id=(value as {id?:unknown})?.id;if(typeof id!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('Draft copy could not be verified.');return id;},id=>{dialog.current?.close();onCopied(id);});
    } catch(reason) {if(current())setError((reason as Error).message);} finally {inFlight.current=false;if(current())setBusy(false);}
  }
  return <><button className="button outline" disabled={disabled || busy} onClick={open}><Copy size={18}/>Copy as draft</button>
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby={`copy-title-${id}`} aria-describedby={`copy-impact-${id}`} onKeyDown={keepDialogFocus} onCancel={event=>{if(inFlight.current) event.preventDefault();}} onClose={()=>setConfirmed(false)}>
      <form onSubmit={event=>void copy(event)}>
        <div className="withdraw-heading"><h2 id={`copy-title-${id}`}>Copy as draft</h2><button autoFocus type="button" className="icon-button" title="Close draft copy" aria-label="Close draft copy" disabled={busy} onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
        <p id={`copy-impact-${id}`} className="crew-impact">A separate draft will use the saved source at revision {sourceRevision}. Generated translations, audio, readiness, recipients and responses are not copied. Existing published versions stay unchanged.</p>
        <label className="field">New draft title<input value={copyTitle} disabled={busy} minLength={3} maxLength={120} required onChange={event=>{setCopyTitle(event.target.value);setConfirmed(false);}}/></label>
        <label className="recipient-row publish-confirm"><input type="checkbox" checked={confirmed} disabled={busy || copyTitle.trim().length<3} onChange={event=>setConfirmed(event.target.checked)}/><span>Create a separate draft without assigning workers</span></label>
        {error && <p role="alert" className="record-error">{error}</p>}
        <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={()=>dialog.current?.close()}>Cancel</button><button className="button primary" disabled={busy || !confirmed || copyTitle.trim().length<3}><Copy size={18}/>{busy ? 'Copying...' : 'Create draft copy'}</button></div>
      </form>
    </dialog></>;
}

export function ArchiveBriefingControl({id,revision,nextVersion,disabled,onChanged,authority}:{id:string;revision:number;nextVersion:number;disabled:boolean;onChanged:()=>void;authority:StaffRequestAuthority}) {
  const {request,current,complete}=useBriefingRequest(authority);
  const dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false),retry=useRef<{key:string;requestId:string}|null>(null);
  const [expected,setExpected]=useState({revision,nextVersion}),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  function open() {retry.current=null;setExpected({revision,nextVersion});setReason('');setConfirmed(false);setError('');dialog.current?.showModal();}
  async function archive(event:React.FormEvent) {
    event.preventDefault();if(inFlight.current || !confirmed || reason.trim().length<3 || !current()) return;
    inFlight.current=true;setBusy(true);setError('');
    try {
      const change={...expected,reason:reason.trim()},key=JSON.stringify({id,...change});
      if(retry.current?.key!==key) retry.current={key,requestId:crypto.randomUUID()};
      const result=await request(`/briefings/${encodeURIComponent(id)}/archive`,'POST',{requestId:retry.current.requestId,...change,confirmed:true});
      await complete(result,value=>value,()=>{dialog.current?.close();onChanged();});
    } catch(reason) {if(current())setError((reason as Error).message);} finally {inFlight.current=false;if(current())setBusy(false);}
  }
  return <><button className="button outline" disabled={disabled || busy} onClick={open}><Archive size={18}/>Archive instruction</button>
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby={`archive-title-${id}`} aria-describedby={`archive-impact-${id}`} onKeyDown={keepDialogFocus} onCancel={event=>{if(inFlight.current) event.preventDefault();}} onClose={()=>setConfirmed(false)}>
      <form onSubmit={event=>void archive(event)}>
        <div className="withdraw-heading"><h2 id={`archive-title-${id}`}>Archive this instruction?</h2><button autoFocus type="button" className="icon-button" title="Close instruction archive" aria-label="Close instruction archive" disabled={busy} onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
        <p id={`archive-impact-${id}`} className="withdraw-impact"><TriangleAlert size={24}/>New edits, processing, publication, answers and help requests will close. Published content, accepted answers and existing clarifications stay in history. Pending checks can finish. This instruction cannot be restored; a separate draft copy can be created.</p>
        <label className="field">Reason for archiving<textarea value={reason} disabled={busy} minLength={3} maxLength={500} required rows={3} onChange={event=>{setReason(event.target.value);setConfirmed(false);}}/></label>
        <label className="recipient-row publish-confirm"><input type="checkbox" checked={confirmed} disabled={busy || reason.trim().length<3} onChange={event=>setConfirmed(event.target.checked)}/><span>Archive the instruction and close new responses for its live versions</span></label>
        {error && <p role="alert" className="record-error">{error}</p>}
        <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={()=>dialog.current?.close()}>Cancel</button><button className="button danger" disabled={busy || !confirmed || reason.trim().length<3}><Archive size={18}/>{busy ? 'Archiving...' : 'Confirm archive'}</button></div>
      </form>
    </dialog></>;
}

export function WithdrawControl({briefingId,publicationId,version,onChanged,authority}:{briefingId:string;publicationId:string;version:number;onChanged:()=>void;authority:StaffRequestAuthority}) {
  const {request,current,complete}=useBriefingRequest(authority);
  const dialog=useRef<HTMLDialogElement>(null),retry=useRef<{reason:string;requestId:string}|null>(null),inFlight=useRef(false);
  const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  function open() {setError('');setConfirmed(false);dialog.current?.showModal();}
  async function withdraw(event:React.FormEvent) {
    event.preventDefault();if(inFlight.current || !confirmed || reason.trim().length<3 || !current()) return;
    inFlight.current=true;setBusy(true);setError('');
    try {
      const normalized=reason.trim();
      if(retry.current?.reason!==normalized) retry.current={reason:normalized,requestId:crypto.randomUUID()};
      const result=await request(`/briefings/${encodeURIComponent(briefingId)}/withdraw`,'POST',{requestId:retry.current.requestId,publicationId,version,reason:normalized});
      await complete(result,value=>value,()=>{dialog.current?.close();onChanged();});
    } catch(err) {if(current())setError((err as Error).message);} finally {inFlight.current=false;if(current())setBusy(false);}
  }
  return <><button className="button outline" onClick={open}><ArchiveX size={18} />Withdraw v{version}</button>
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby={`withdraw-title-${publicationId}`} aria-describedby={`withdraw-impact-${publicationId}`} onCancel={(event) => {if(inFlight.current) event.preventDefault();}}>
      <form onSubmit={(event) => void withdraw(event)}>
        <div className="withdraw-heading"><h2 id={`withdraw-title-${publicationId}`}>Withdraw v{version}?</h2><button autoFocus type="button" className="icon-button" aria-label="Close withdrawal" title="Close withdrawal" disabled={busy} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
        <p id={`withdraw-impact-${publicationId}`} className="withdraw-impact"><TriangleAlert size={24} />New answers and help requests for this version will close. Published content, accepted answers, and existing clarifications remain in history. Already received answers can still finish assessment.</p>
        <label className="field">Reason for withdrawal<textarea value={reason} disabled={busy} minLength={3} maxLength={500} required rows={3} onChange={(event) => {setReason(event.target.value);setConfirmed(false);}} /></label>
        <label className="recipient-row publish-confirm"><input type="checkbox" checked={confirmed} disabled={busy || reason.trim().length<3} onChange={(event) => setConfirmed(event.target.checked)} /><span>Close new responses for v{version}</span></label>
        {error && <p role="alert" className="record-error">{error}</p>}
        <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button><button type="submit" className="button danger" disabled={busy || !confirmed || reason.trim().length<3}><ArchiveX size={18} />{busy ? 'Withdrawing...' : `Withdraw version ${version}`}</button></div>
      </form>
    </dialog></>;
}
