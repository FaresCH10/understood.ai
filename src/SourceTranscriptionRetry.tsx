import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useRef,useState} from 'react';
import {RefreshCw,X} from 'lucide-react';
import {keepDialogFocus} from './dialog-focus';
import type {SourceUploadSession} from './source-audio-upload';
import {readSourceRetry,saveSourceRetry,clearSourceRetry,checkSourceRetry,sendSourceRetry,type PendingSourceRetry,type SourceRetryReceipt} from './source-audio-retry';

export default function SourceTranscriptionRetry({session,sourceId,sourceHash,retryable,onChanged,canAct=()=>true}:{session:SourceUploadSession;sourceId:string;sourceHash:string;retryable:boolean;onChanged:()=>void;canAct?:()=>boolean}) {
  const staffT=useStaffStaticText();
  const [saved,setSaved]=useState<{pending:PendingSourceRetry|null;error:string}>(()=>{
    try{return {pending:readSourceRetry(sessionStorage,session,sourceId,sourceHash),error:''};}catch(reason){return {pending:null,error:(reason as Error).message};}
  });
  const [receipt,setReceipt]=useState<SourceRetryReceipt|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),controller=useRef<AbortController|null>(null),inFlight=useRef(false),trigger=useRef<HTMLButtonElement>(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
  async function operate(pending:PendingSourceRetry,send:boolean) {
    if(inFlight.current || !canAct())return;inFlight.current=true;setBusy(true);setError('');setReceipt(null);
    const current=new AbortController();controller.current=current;const timeout=setTimeout(()=>current.abort(),30000);
    try {const result=await (send?sendSourceRetry:checkSourceRetry)(pending,undefined,current.signal);if(!current.signal.aborted && canAct()){setReceipt(result);if(send && result.found)onChanged();}}
    catch(reason){if(controller.current===current && canAct())setError(current.signal.aborted?'Retry outcome is not confirmed. Check the retry receipt.':(reason as Error).message);}
    finally {clearTimeout(timeout);inFlight.current=false;if(controller.current===current){controller.current=null;if(mounted.current)setBusy(false);}}
  }
  useEffect(()=>{if(saved.pending)void operate(saved.pending,false);},[saved.pending]);
  function close(){dialog.current?.close();setConfirmed(false);trigger.current?.focus();}
  async function send() {
    if(!confirmed || busy || !retryable || !canAct())return;
    let pending=saved.pending;
    try {
      if(!pending){pending={...session,sourceRequestId:sourceId,sourceHash,requestId:crypto.randomUUID()};saveSourceRetry(sessionStorage,pending);setSaved({pending,error:''});}
      close();await operate(pending,true);
    }catch(reason){setError((reason as Error).message);}
  }
  if(!retryable && !saved.pending && !saved.error)return null;
  return <div className="source-retry-control">
    {(saved.error || error) && <p role="alert" className="record-error">{((saved.error?staffT.error(saved.error):staffT.error(error)))}</p>}
    {saved.pending && <p className="staff-recovery-request">{staffT("Retry")} {saved.pending.requestId}</p>}
    {busy && <p role="status">{staffT("Checking retry outcome...")}</p>}
    {receipt && <p role="status">{receipt.found?staffT("Retry accepted at {p0}. This receipt confirms queueing only.",{p0:new Date(receipt.acceptedAt!).toISOString()}):staffT("No retry receipt was found. Nothing has been confirmed as queued.")}</p>}
    <div className="actions">
      {saved.pending && <button className="button outline" disabled={busy} onClick={()=>void operate(saved.pending!,false)}><RefreshCw size={18}/>{staffT("Check retry receipt")}</button>}
      {receipt?.found && <button className="button outline" disabled={busy} onClick={()=>{if(!canAct())return;try{clearSourceRetry(sessionStorage,saved.pending!);setSaved({pending:null,error:''});setReceipt(null);onChanged();}catch(reason){setError((reason as Error).message);}}}><X size={18}/>{staffT("Close retry receipt")}</button>}
      {retryable && !saved.error && (!saved.pending || receipt?.found===false) && <button ref={trigger} className="button outline" disabled={busy} onClick={()=>{if(!canAct())return;setConfirmed(false);dialog.current?.showModal();}}><RefreshCw size={18}/>{saved.pending?staffT("Resend exact retry"):staffT("Retry transcription")}</button>}
    </div>
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby={`source-retry-${sourceId}`} onKeyDown={keepDialogFocus} onCancel={event=>{event.preventDefault();close();}}>
      <h2 id={`source-retry-${sourceId}`}>{staffT("Retry source transcription?")}</h2><p>{staffT("The same saved audio will be queued again. No duplicate upload or published version is created. A permitted provider must be available; this does not enable live processing.")}</p>
      <label className="recipient-row publish-confirm"><input autoFocus type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>{staffT("Queue another transcription attempt for this source")}</span></label>
      <div className="actions"><button className="button outline" onClick={close}>{staffT("Cancel")}</button><button className="button primary" disabled={!confirmed || busy} onClick={()=>void send()}><RefreshCw size={18}/>{staffT("Queue retry")}</button></div>
    </dialog>
  </div>;
}
