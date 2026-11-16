import {useEffect,useRef,useState} from 'react';
import {checkedClarificationFlow,clarificationFlowCopy,clarificationMessageCopy,readClarificationCommand,type ClarificationFlow} from './clarification-flow';
import {validWorkerSession,type PageSession} from './session-state';
import type {WorkerUiLanguage} from './worker-ui-language';
import {ClarificationMessages} from './ClarificationMessages';
import {RefreshCw} from 'lucide-react';
import './simple-clarifications.css';
import {workerClarificationCopy} from './worker-clarification-copy';

export function WorkerClarificationFlow({assignmentId,session,language,current,onSessionLost,onReturn,onDirtyChange}:{assignmentId:string;session:PageSession;language:WorkerUiLanguage;current:()=>boolean;onSessionLost:()=>void;onReturn?:()=>void;onDirtyChange?:(dirty:boolean)=>void}){
  const t={...clarificationFlowCopy(language),...workerClarificationCopy(language)},copy=clarificationMessageCopy(language),[data,setData]=useState<ClarificationFlow|null>(null),[text,setText]=useState(''),[error,setError]=useState(false),[busy,setBusy]=useState(false),[tick,setTick]=useState(0);
  const pending=useRef<{requestId:string;text:string}|null>(null),callbacks=useRef({current,onSessionLost,onDirtyChange});callbacks.current={current,onSessionLost,onDirtyChange};
  const path=`/api/worker/briefings/${encodeURIComponent(assignmentId)}/clarification-flow`,live=useRef(true),inFlight=useRef(false);
  const recoveryKey=`u:clarification-flow:${session.clientContext}:${path}`;
  useEffect(()=>{try{const retained=readClarificationCommand(recoveryKey);if(retained){pending.current=retained;setText(retained.text);}}catch{setError(true);}},[recoveryKey]);
  useEffect(()=>{live.current=true;return()=>{live.current=false;callbacks.current.onDirtyChange?.(false);};},[]);
  useEffect(()=>{callbacks.current.onDirtyChange?.(!!text.trim()||busy);},[text,busy]);
  async function request(body?:{requestId:string;text:string},signal?:AbortSignal){
    if(!callbacks.current.current()||!validWorkerSession(session))throw Error('Session changed');
    const timeout=AbortSignal.timeout(15000);
    const response=await fetch(path,{method:body?'POST':'GET',credentials:'include',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout,headers:{'x-client-session-context':session.clientContext!,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!callbacks.current.current()||!live.current)return null;
    if(response.status===401){callbacks.current.onSessionLost();return null;}
    if(!response.ok)throw Error('Clarification unavailable');
    const value=await response.json();if(!callbacks.current.current()||!live.current||!validWorkerSession(session))return null;if(value.clientContext!==session.clientContext){callbacks.current.onSessionLost();return null;}return value;
  }
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    request(undefined,controller.signal).then(value=>{if(active&&value){const checked=checkedClarificationFlow(value,session.clientContext!);setData(checked);setError(false);if(pending.current&&checked.items.some(item=>item.id===pending.current?.requestId)){sessionStorage.removeItem(recoveryKey);pending.current=null;setText('');}}}).catch(()=>{if(active)setError(true);});
    const timer=window.setTimeout(()=>{if(document.visibilityState==='visible')setTick(n=>n+1);},5000);
    return()=>{active=false;controller.abort();window.clearTimeout(timer);};
  },[path,session.clientContext,tick]);
  async function send(){
    if(inFlight.current||!data?.canMessage||text.trim().length<3)return;
    const command=pending.current??{requestId:crypto.randomUUID(),text:text.trim()};pending.current=command;
    inFlight.current=true;setBusy(true);setError(false);
    try{sessionStorage.setItem(recoveryKey,JSON.stringify(command));const result=await request(command);if(result){if(result.id!==command.requestId)throw Error('Unverified receipt');sessionStorage.removeItem(recoveryKey);pending.current=null;setText('');setTick(n=>n+1);}}catch{if(live.current)setError(true);}finally{inFlight.current=false;if(live.current)setBusy(false);}
  }
  const items=data?.items??[];
  if(data&&!data.canMessage&&!items.length)return null;
  return <section className="worker-card clarification-flow" aria-label={copy.messages}>
    <div className="worker-card-head"><h2>{copy.messages}</h2><button type="button" className="icon-button" title={t.retry} aria-label={t.retry} disabled={busy} onClick={()=>setTick(n=>n+1)}><RefreshCw size={18}/></button></div>
    {error&&<p role="alert">{t.error}</p>}{!data&&!error&&<p role="status">{t.preparing}</p>}
    {items.length>0&&<ClarificationMessages items={items} language={language} worker timezone={session.timezone} disabled={busy} onRetry={async item=>{
      if(inFlight.current||!item.originalText)return;inFlight.current=true;setBusy(true);
      try{await request({requestId:item.id,text:item.originalText});setTick(n=>n+1);}catch{setError(true);}finally{inFlight.current=false;if(live.current)setBusy(false);}
    }}/>}
    {data?.canMessage&&<form onSubmit={event=>{event.preventDefault();void send();}}>
      {data.needsArea&&<p role="alert">{t.required}</p>}
      <label className="field">{t.area}<textarea required minLength={3} maxLength={500} rows={3} value={text} readOnly={busy||!!pending.current} onChange={event=>setText(event.target.value)} dir="auto"/></label>
      <button className="button primary full" disabled={busy||text.trim().length<3}>{t.send}</button>
    </form>}
    {onReturn&&data&&!data.needsArea&&<button type="button" className="button outline full" onClick={onReturn}>{t.back}</button>}
  </section>;
}
