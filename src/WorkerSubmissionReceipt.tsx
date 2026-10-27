import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,CheckCircle2,Clock3,MessageCircle,RefreshCw,TriangleAlert} from 'lucide-react';
import {WorkerAudioPlayer} from './WorkerAudioPlayer';
import {readWorkerReceiptSnapshot,workerReceiptText,workerReceiptUnknownText,type ReceiptSelection,type WorkerReceiptSnapshot} from './worker-submission-receipt';
import {playbackTime} from './worker-playback';
import {workerSubmissionState,WorkerSubmissionsError} from './worker-submissions';
import {validWorkerSession,type PageSession} from './session-state';
import {type WorkerUiLanguage,workerUiDirection} from './worker-ui-language';

type Props={choices?:{id:string;text:string}[];session:PageSession;selection:ReceiptSelection;acknowledgedContext:string;language:WorkerUiLanguage;timezone?:string;disabled:boolean;canHelp:boolean;current:()=>boolean;onSessionLost:()=>void;onBack:()=>void;onHelp:()=>void;onChecked?:()=>void};
export function WorkerSubmissionReceipt({choices,session,selection,acknowledgedContext,language,timezone,disabled,canHelp,current,onSessionLost,onBack,onHelp,onChecked}:Props){
  const t=workerReceiptText[language],key=JSON.stringify([session.clientContext,session.expiresAt,selection.assignmentId,selection.version,selection.language,selection.requestId,selection.kind]);
  const selected=useRef(key);selected.current=key;
  const [retry,setRetry]=useState(0),[read,setRead]=useState<{key:string;data:WorkerReceiptSnapshot|null;failed:boolean;loading:boolean}>({key:'',data:null,failed:false,loading:true});
  const acknowledged=acknowledgedContext===session.clientContext&&validWorkerSession(session)&&current();
  const data=read.key===key?read.data:null,failed=read.key===key&&read.failed;
  useEffect(()=>{
    if(!acknowledged){onSessionLost();return;}
    let alive=true,timedOut=false;const controller=new AbortController();
    const isCurrent=()=>alive&&selected.current===key&&current()&&validWorkerSession(session);
    setRead(previous=>({key,data:previous.key===key?previous.data:null,failed:false,loading:true}));
    const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},15000);
    readWorkerReceiptSnapshot(fetch,session,selection,controller.signal,isCurrent).then(value=>{if(isCurrent())setRead({key,data:value,failed:false,loading:false});}).catch(error=>{
      if(!alive||selected.current!==key||controller.signal.aborted&&!timedOut)return;
      setRead({key,data:null,failed:true,loading:false});
      if(error instanceof WorkerSubmissionsError&&error.code==='session')onSessionLost();
    }).finally(()=>window.clearTimeout(timeout));
    return()=>{alive=false;controller.abort();window.clearTimeout(timeout);};
  },[key,retry,acknowledged]);
  useEffect(()=>{
    if(!data||workerSubmissionState(data.receipt)!=='pending')return;
    const refresh=()=>{if(document.visibilityState==='visible'&&current())setRetry(value=>value+1);};
    const timer=window.setTimeout(refresh,10000);document.addEventListener('visibilitychange',refresh);
    return()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',refresh);};
  },[data,key]);
  const state=data?workerSubmissionState(data.receipt):null;
  const notified=useRef<string|null>(null),notify=useRef(onChecked);notify.current=onChecked;
  useEffect(()=>{
    if(!state||state==='pending'||state==='paused')return;
    const marker=`${key}:${state}`;
    if(notified.current===marker)return;
    notified.current=marker;notify.current?.();
  },[key,state]);
  if(!acknowledged)return null;
  return <section className="worker-receipt" aria-labelledby="worker-receipt-title">
    <div className="receipt-mark" aria-hidden="true"><Check size={44}/></div>
    <h1 id="worker-receipt-title" className="receipt-title">{t.title}</h1><p className="receipt-copy">{t.followup}</p>
    <ol className="worker-card worker-receipt-steps">
      <li><CheckCircle2 size={32} aria-hidden="true"/><div><strong>{t.received}</strong><span>{t.complete}</span></div></li>
      <li data-state={state??'unknown'}>{state==='matched'?<CheckCircle2 size={32} aria-hidden="true"/>:state==='pending'||state==='paused'||!state?<Clock3 size={32} aria-hidden="true"/>:<TriangleAlert size={32} aria-hidden="true"/>}<div><strong>{state?t[state]:failed?workerReceiptUnknownText[language]:t.loading}</strong>{state==='pending'&&<span>{t.checking}</span>}</div></li>
    </ol>
    {failed&&<p role="alert" className="notice notice-amber">{t.failed}</p>}
    {!data&&!failed&&<p role="status">{t.loading}</p>}
    <button type="button" className="icon-button" aria-label={t.refresh} title={t.refresh} disabled={disabled||read.key!==key||read.loading} onClick={()=>setRetry(value=>value+1)}><RefreshCw size={20}/></button>
    {data&&<section className="worker-card worker-receipt-answer" aria-label={t.answer}>
      <div className="worker-card-head"><h2>{t.answer}</h2>{data.receipt.durationSeconds!==null&&<span dir="ltr">{playbackTime(data.receipt.durationSeconds)}</span>}</div>{!data.receipt.isLatest&&<p className="notice notice-amber">{t.earlier}</p>}
      {data.receipt.recordingId&&<WorkerAudioPlayer key={data.receipt.recordingId} src={`/api/recordings/${encodeURIComponent(data.receipt.recordingId)}/audio`} label={t.answer} language={language}/>}
      {data.receipt.answerText!==null&&<p className="briefing-text" dir="auto">{choices?.find(choice=>choice.id===data.receipt.answerText)?.text || data.receipt.answerText}</p>}
      <dl className="worker-receipt-meta"><div><dt>{t.submitted}</dt><dd><time dateTime={data.receipt.receivedAt}>{new Date(data.receipt.receivedAt).toLocaleString(language,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'})}</time></dd></div><div><dt>{t.version}</dt><dd>v{data.assignment.version} · <bdi>{data.assignment.language.toUpperCase()}</bdi></dd></div></dl>
    </section>}
    {session.mode?.startsWith('synthetic-')&&<p className="muted">{t.synthetic}</p>}
    <p className="muted">{t.limits}</p>
    <div className="worker-receipt-actions"><button type="button" className="button primary full" disabled={disabled} onClick={onBack}>{workerUiDirection(language)==='rtl'?<ArrowRight size={20} aria-hidden="true"/>:<ArrowLeft size={20} aria-hidden="true"/>}{t.back}</button><button type="button" className="button outline full" disabled={disabled||!canHelp} onClick={onHelp}><MessageCircle size={20} aria-hidden="true"/>{t.help}</button></div>
  </section>;
}
