import React,{useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle2,Clock3,RefreshCw,Trash2,TriangleAlert,X} from 'lucide-react';
import {keepDialogFocus} from './dialog-focus';
import {readDeletionReceipt,verifyDeletionAcceptance,type DeletionReceipt as Receipt} from './deletion-state';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {completeStaffRequest} from './staff-request';

type Props={workerId:string;code:string;refresh?:number;onQueued:(status:Receipt['status'])=>void;onLocked:(locked:boolean)=>void;authority:StaffRequestAuthority};

export function WorkerDeletion({workerId,code,refresh=0,onQueued,onLocked,authority}:Props){
  const {request,current}=useStaffRequest(authority);
  const dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false),requestId=useRef('');
  const pendingIntent=useRef<{requestId:string;reason:string}|null>(null);
  const readController=useRef<AbortController|null>(null),latest=useRef({onQueued,authority});
  const readVersion=useRef(0);
  const [receipt,setReceipt]=useState<Receipt|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[confirmed,setConfirmed]=useState(false);
  const [reason,setReason]=useState('worker_request'),[expectedCode,setExpectedCode]=useState(code);
  latest.current={onQueued,authority};
  const [retryReady,setRetryReady]=useState(false);
  const endpoint=`/api/people/workers/${encodeURIComponent(workerId)}/deletion`;
  const read=useCallback(async()=>{
    if(!current())return;readController.current?.abort();const controller=new AbortController();readController.current=controller;
    const version=++readVersion.current;
    const pending=pendingIntent.current;
    setLoading(true);setError('');
    try{
      const data=await request(endpoint,undefined,controller.signal);
      await completeStaffRequest(data,value=>readDeletionReceipt(value,workerId,pending || undefined),verified=>{
        if(controller.signal.aborted || version!==readVersion.current || pendingIntent.current!==pending)return;
        setReceipt(verified);setRetryReady(!verified && !!pending);
        if(verified){dialog.current?.close();setUncertain(false);requestId.current='';pendingIntent.current=null;if(pending)latest.current.onQueued(verified.status);}
      },current,()=>latest.current.authority.canMutate());
    }catch(reason){if(!controller.signal.aborted && current() && version===readVersion.current){setRetryReady(false);setError((reason as Error).message);}}
    finally{if(!controller.signal.aborted && current() && version===readVersion.current)setLoading(false);}
  },[endpoint,workerId,request,current]);
  useEffect(()=>{void read();return()=>{readController.current?.abort();readVersion.current++;};},[read,refresh]);
  useEffect(()=>{if(current())onLocked(loading || busy || !!error || uncertain || !!receipt);},[loading,busy,error,uncertain,receipt,onLocked,current]);
  async function submit(event:React.FormEvent){
    event.preventDefault();if(inFlight.current || !confirmed || (uncertain && !retryReady) || !current() || !authority.canMutate())return;
    const submittedId=requestId.current;
    inFlight.current=true;setBusy(true);setError('');
    try{
      pendingIntent.current={requestId:submittedId,reason};
      const data=await request(endpoint,{requestId:submittedId,expectedCode,reason,confirmed:true});
      await completeStaffRequest(data,value=>verifyDeletionAcceptance(value,submittedId),()=>{dialog.current?.close();setUncertain(true);setRetryReady(false);},current,authority.canMutate);
      await read();
    }catch(reason){
      if(current()){setError(`Check the request status before taking another action. ${(reason as Error).message}`);setUncertain(true);setRetryReady(false);setConfirmed(false);}
    }finally{inFlight.current=false;if(current())setBusy(false);}
  }
  const stages=[['Request accepted',receipt?.createdAt],['Content redacted',receipt?.contentRedactedAt],['Identity pseudonymized',receipt?.identityPseudonymizedAt],['Application cleanup verified',receipt?.completedAt]];
  return <section className="panel worker-deletion" aria-label="Worker data request">
    <div className="people-panel-heading"><h2>Worker data</h2><button type="button" className="icon-button" title="Refresh deletion status" aria-label="Refresh deletion status" disabled={busy || loading} onClick={()=>void read()}><RefreshCw size={18}/></button></div>
    {loading ? <p data-page-loading role="status">Checking deletion status...</p> : receipt ? <>
      <p className={`status ${receipt.status==='complete'?'status-green':'status-amber'}`} role="status">{receipt.status==='complete'?<CheckCircle2 size={17}/>:<Clock3 size={17}/>} {receipt.status==='complete'?'Application cleanup complete':'Application cleanup queued'}</p>
      <dl className="people-facts">{stages.map(([label,date])=><React.Fragment key={label}><dt>{label}</dt><dd>{date?<time dateTime={date}>{new Date(date).toLocaleString()}</time>:'Pending'}</dd></React.Fragment>)}</dl>
      <p className="muted">Request: <bdi>{receipt.id}</bdi></p>
      <dl className="people-facts"><dt>Provider history</dt><dd>Not verified</dd><dt>Backups</dt><dd>Not verified</dd><dt>Device caches</dt><dd>Not verified</dd><dt>Permanent erasure</dt><dd>Not verified</dd></dl>
      <p className="notice notice-blue">This receipt covers the current application view only. Provider history, backups and device caches have not been verified as erased. Required pseudonymous audit and response records remain.</p>
    </> : <>
      {uncertain && <p className="notice" role="status">{retryReady?'No server receipt was found. The original request can be explicitly retried.':'The request outcome is not yet confirmed. Refresh status before taking another action.'}</p>}
      <button type="button" className="button danger full" disabled={!!error || (uncertain && !retryReady) || loading} onClick={()=>{
        if(!uncertain){requestId.current=crypto.randomUUID();setExpectedCode(code);setReason('worker_request');}
        setConfirmed(false);setError('');dialog.current?.showModal();
      }}><Trash2 size={18}/>{uncertain?'Review original request':'Request worker deletion'}</button>
    </>}
    {error && <p className="record-error" role="alert">{error}</p>}
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby="worker-deletion-title" aria-describedby="worker-deletion-impact" onKeyDown={keepDialogFocus}
      onCancel={event=>{if(inFlight.current)event.preventDefault();}} onClose={()=>setConfirmed(false)}>
      <form onSubmit={event=>void submit(event)}>
        <div className="withdraw-heading"><h2 id="worker-deletion-title">Delete worker data?</h2><button autoFocus type="button" className="icon-button" title="Close deletion dialog" aria-label="Close deletion dialog" disabled={busy} onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
        <p id="worker-deletion-impact" className="crew-impact"><strong><bdi>{expectedCode}</bdi></strong> loses server access immediately. Application cleanup removes audio from its current storage view, redacts responses and replaces the worker label. This cannot be undone.</p>
        <p className="notice"><TriangleAlert size={20}/>Provider history, older backups and device caches are outside this cleanup receipt. Permanent erasure is not verified. Required pseudonymous history remains.</p>
        <label className="field">Reason<select value={reason} disabled={busy || uncertain} onChange={event=>setReason(event.target.value)}><option value="worker_request">Worker request</option><option value="customer_policy">Organization policy</option></select></label>
        <label className="recipient-row publish-confirm"><input type="checkbox" checked={confirmed} disabled={busy || (uncertain && !retryReady)} onChange={event=>setConfirmed(event.target.checked)}/><span>I am authorized to delete this worker's data and understand the limits.</span></label>
        {error && <p className="record-error" role="alert">{error}</p>}
        {uncertain && <button type="button" className="button outline full" disabled={busy || loading} onClick={()=>void read()}><RefreshCw size={18}/>Check request status</button>}
        <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={()=>dialog.current?.close()}>Cancel</button><button type="submit" className="button danger" disabled={busy || loading || (uncertain && !retryReady) || !confirmed}><Trash2 size={18}/>{busy?'Submitting...':uncertain?'Retry same request':'Confirm deletion'}</button></div>
      </form>
    </dialog>
  </section>;
}
