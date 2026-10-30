import {useStaffText} from './staff-language';
import {useEffect,useRef,useState} from 'react';
import SourceAudio from './SourceAudio';
import {useBriefingRequest} from './BriefingControls';
import type {StaffRequestAuthority} from './useStaffRequest';
import type {PreparedSourceAudio} from './source-audio';
import {prepareSourceUpload,sendSourceUpload,checkSourceUpload,readPendingSourceUpload,savePendingSourceUpload,clearPendingSourceUpload,type PendingSourceUpload} from './source-audio-upload';
export default function VoiceTranscript({authority,title,onApproved,onClose,replacing=false}:{replacing?:boolean;authority:StaffRequestAuthority;title:string;onApproved:(text:string)=>void;onClose:()=>void}){
 const tr=useStaffText();
 const {request,sourceFetch,current}=useBriefingRequest(authority),session={clientContext:authority.session.clientContext!,expiresAt:authority.session.expiresAt!};
 const [recovery]=useState(()=>{try{return {pending:readPendingSourceUpload(sessionStorage,session),error:''};}catch(error){return {pending:null,error:(error as Error).message};}});
 const [pending,setPending]=useState<PendingSourceUpload|null>(recovery.pending),[audio,setAudio]=useState<PreparedSourceAudio|null>(null),[transcript,setTranscript]=useState<string|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(recovery.error),[tick,setTick]=useState(0),[canRestart,setCanRestart]=useState(false);
 const inFlight=useRef(false);
 useEffect(()=>{
  if(!pending||transcript!==null)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  checkSourceUpload(pending,sourceFetch,controller.signal).then(async receipt=>{
   if(!current()||controller.signal.aborted)return;
   setCanRestart(!receipt.found||['failed','blocked'].includes(receipt.status||''));
   if(receipt.status==='transcribed'&&receipt.briefingId){const draft=await request<{source:string}>(`/briefings/${receipt.briefingId}`,'GET',undefined,controller.signal);if(current()&&!controller.signal.aborted){setTranscript(draft.source);setStatus('Review the transcript. Nothing has been added to your instruction.');}}
   else if(['failed','blocked'].includes(receipt.status||''))setError('Transcription is unavailable. Open Audio uploads to retry, or write the instruction.');
   else{setStatus(receipt.found?'Transcribing your recording…':'Upload receipt not confirmed. Check again before recording another source.');if(receipt.found)timer=setTimeout(()=>setTick(value=>value+1),2000);}
  }).catch(reason=>{if(current()&&!controller.signal.aborted)setError(reason.message);});
  return()=>{controller.abort();clearTimeout(timer);};
 },[pending,transcript,tick,sourceFetch,current,request]);
 async function transcribe(){
  if(!audio||inFlight.current||pending||!current())return;inFlight.current=true;setBusy(true);setError('');
  try{const value=await prepareSourceUpload(audio,{requestId:crypto.randomUUID(),title:title.trim().length>=3?title.trim():'Voice instruction'},session);savePendingSourceUpload(sessionStorage,session,value);setPending(value);await sendSourceUpload(value,audio,sourceFetch);if(current())setTick(value=>value+1);}catch(reason){if(current())setError((reason as Error).message);}finally{inFlight.current=false;if(current())setBusy(false);}
 }
 return <><h2>{tr("Record instruction")}</h2><p>{tr("Your recording is transcribed for review. Approve the text before adding it to the instruction.")}</p><p className="muted">{tr("Recording is sent to Gemini for transcription.")}</p>{replacing&&<p className="notice">{tr("Approving this transcript replaces the current instruction text.")}</p>}{transcript===null&&!pending&&<SourceAudio disabled={busy||!!recovery.error} onChange={setAudio} onActivityChange={()=>{}}/>}{transcript!==null&&<label className="field">{tr("Review transcript")}<textarea rows={7} maxLength={4000} value={transcript} onChange={event=>setTranscript(event.target.value)}/></label>}{status&&<p role="status">{status}</p>}{error&&<p role="alert">{error}</p>}<div className="actions"><button className="button outline" disabled={busy} onClick={onClose}>{tr("Close")}</button>{!pending&&<button className="button primary" disabled={!audio||busy||!!recovery.error} onClick={()=>void transcribe()}>{busy?'Uploading…':tr("Transcribe recording")}</button>}{pending&&canRestart&&<button className="button outline" disabled={busy} onClick={()=>{try{clearPendingSourceUpload(sessionStorage,session,pending);setPending(null);setAudio(null);setStatus('');setError('');setCanRestart(false);}catch(reason){setError((reason as Error).message);}}}>Start a new recording</button>}{pending&&transcript===null&&<button className="button outline" disabled={busy} onClick={()=>setTick(value=>value+1)}>{tr("Check transcription")}</button>}{pending&&transcript!==null&&<button className="button primary" disabled={transcript.trim().length<10||transcript.length>4000} onClick={()=>{try{clearPendingSourceUpload(sessionStorage,session,pending);onApproved(transcript.trim());}catch(reason){setError((reason as Error).message);}}}>{tr("Approve and use transcript")}</button>}</div></>;
}
