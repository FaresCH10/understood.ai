import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,RefreshCw,Upload} from 'lucide-react';
import SourceAudio from './SourceAudio';
import SourceTranscriptionRetry from './SourceTranscriptionRetry';
import type {PreparedSourceAudio} from './source-audio';
import {checkSourceUpload,sendSourceUpload,type PendingSourceUpload,type SourceUploadReceipt} from './source-audio-upload';
import {useBriefingRequest} from './BriefingControls';
import type {StaffRequestAuthority} from './useStaffRequest';

export default function SourceUploadRecovery({pending,audio,onAudio,onActivity,onAccepted,onResolved,onContinue,navigate,authority}:{
  pending:PendingSourceUpload;audio:PreparedSourceAudio|null;onAudio:(value:PreparedSourceAudio|null)=>void;onActivity:(active:boolean)=>void;
  onAccepted:(accepted:boolean)=>void;onResolved:(id:string)=>void;onContinue:()=>void;navigate:(path:string)=>void;authority:StaffRequestAuthority;
}) {
  const {current,ensureCompletion,sourceFetch}=useBriefingRequest(authority);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<SourceUploadReceipt|null>(null),[refresh,setRefresh]=useState(0),[url,setUrl]=useState('');
  const sending=useRef(false),controller=useRef<AbortController|null>(null),heading=useRef<HTMLHeadingElement>(null),callbacks=useRef({onAccepted,onResolved});
  callbacks.current={onAccepted,onResolved};
  useEffect(()=>{heading.current?.focus();return()=>controller.current?.abort();},[]);
  useEffect(()=>{
    if(!audio){setUrl('');return;}
    let current=true,objectUrl='';
    audio.recording.bytes().then(bytes=>{if(current){objectUrl=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));setUrl(objectUrl);}}).catch(()=>{});
    return()=>{current=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[audio]);
  function applyReceipt(next:SourceUploadReceipt) {
    ensureCompletion();
    setReceipt(next);callbacks.current.onAccepted(Boolean(next.found && next.receivedAt));
    if(next.status==='transcribed' && next.briefingId)callbacks.current.onResolved(next.briefingId);
  }
  useEffect(()=>{
    const check=new AbortController();controller.current=check;setBusy(true);setReceipt(null);setError('');
    const timeout=setTimeout(()=>check.abort(),30000);
    checkSourceUpload(pending,sourceFetch,check.signal).then(next=>{if(!check.signal.aborted && current())applyReceipt(next);})
      .catch(reason=>{if(!current())return;if(!check.signal.aborted)setError((reason as Error).message);else if(controller.current===check)setError('Receipt check timed out. Check again before retrying.');})
      .finally(()=>{clearTimeout(timeout);if(controller.current===check){controller.current=null;if(current())setBusy(false);}});
    return()=>{controller.current=null;check.abort();clearTimeout(timeout);};
  },[pending,refresh,sourceFetch,current]);
  async function retry() {
    if(sending.current || busy || !audio || !receipt || (receipt.found && receipt.status!=='storing') || !current())return;
    sending.current=true;setBusy(true);setError('');setReceipt(null);
    const upload=new AbortController();controller.current=upload;const timeout=setTimeout(()=>upload.abort(),45000);
    try {const next=await sendSourceUpload(pending,audio,sourceFetch,upload.signal);if(!upload.signal.aborted && current())applyReceipt(next);}
    catch(reason){if(controller.current===upload && current())setError(upload.signal.aborted?'Upload outcome is not confirmed. Check the receipt before retrying.':(reason as Error).message);}
    finally {clearTimeout(timeout);sending.current=false;if(controller.current===upload){controller.current=null;if(current())setBusy(false);}}
  }
  const retryable=receipt && !receipt.audioStatus && (!receipt.found || receipt.status==='storing');
  return <section className="panel draft-creation-recovery"><h1 ref={heading} tabIndex={-1}>Source audio receipt</h1><p>{pending.title}</p>
    <p className="staff-recovery-request">Request {pending.requestId}</p><p>Preparation languages: {pending.generationLanguages?.map(code=>code==='en'?'English':code==='ar'?'Arabic':'Urdu').join(', ') || 'Site generation defaults'}</p>
    {busy && <p role="status">Checking upload outcome...</p>}{error && <p role="alert" className="record-error">{error}</p>}
    {receipt?.audioStatus && <p role="status">{receipt.audioStatus==='removed'?'Server source audio has been removed.':'Server source audio cleanup is pending.'} The saved receipt is preserved.</p>}
    {receipt && <p role="status">{!receipt.found?'No accepted receipt was found. The upload outcome is not confirmed.':receipt.audioStatus && receipt.status!=='transcribed'?'Source processing has stopped. No draft has been created.':receipt.status==='storing'?'The upload has not been accepted yet.':receipt.status==='blocked'?'Audio received. Transcription is blocked because a permitted provider is unavailable. No draft has been created.':receipt.status==='failed'?'Audio received. Transcription failed. No draft has been created.':receipt.status==='transcribed'?'Transcription complete. Opening the draft...':'Audio received. Transcription is pending; no draft has been created yet.'}</p>}
    {receipt?.found && <SourceTranscriptionRetry key={pending.requestId} session={pending} sourceId={pending.requestId} sourceHash={pending.requestHash} retryable={!receipt.audioStatus && ['blocked','failed'].includes(receipt.status || '')} onChanged={()=>setRefresh(n=>n+1)}/>}
    {url && retryable && <label className="field">Retained source preview<audio controls src={url}/></label>}
    {retryable && <><p className="notice amber">Audio bytes are not saved in this tab's receipt reference. After a reload, select the exact original file to retry.</p>
      <SourceAudio disabled={busy} onChange={onAudio} onActivityChange={onActivity}/></>}
    <div className="actions"><button className="button outline" disabled={busy} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={18}/>Check receipt</button>
      {retryable && <button className="button primary" disabled={busy || !audio} onClick={()=>void retry()}><Upload size={18}/>Retry exact upload</button>}
      {(receipt?.receivedAt || receipt?.audioStatus) && receipt.status!=='transcribed' && <button className="button primary" disabled={busy} onClick={()=>{try {onContinue();}catch(reason){setError((reason as Error).message);}}}><Upload size={18}/>Continue with a new instruction</button>}
      <button className="button outline" disabled={busy} onClick={()=>navigate('briefings')}><ArrowLeft size={18}/>Instruction library</button>
    </div></section>;
}
