import {useEffect,useRef,useState} from 'react';
import {RefreshCw,Send,ChevronRight,ChevronLeft} from 'lucide-react';
import {CaseConversation} from './CaseConversation';
import {InstructionChat} from './InstructionChat';
import {validWorkerSession,type PageSession} from './session-state';
import {readWorkerHelpHistory,WorkerHelpHistoryError,type HelpHistoryScope,type WorkerHelpPage} from './worker-help-history';
import {workerUiDirection,type WorkerUiLanguage} from './worker-ui-language';
import {workerInstructionChatText} from './worker-instruction-chat-text';

export function WorkerInstructionChat({requestedCaseId,assignmentId,version,contentLanguage,language,session,refresh,current,disabled,canWrite,onSendHelp,onDirtyChange,onSessionLost,timezone}:{
  requestedCaseId?:string;assignmentId:string;version:number;contentLanguage:HelpHistoryScope['language'];language:WorkerUiLanguage;
  session:PageSession;refresh:number;current:()=>boolean;disabled:boolean;canWrite:boolean;
  onSendHelp:(text:string)=>Promise<string|null>;onDirtyChange:(value:boolean)=>void;onSessionLost:()=>void;timezone?:string;
}){
  const copy=workerInstructionChatText(language),rtl=workerUiDirection(language)==='rtl';
  const [retry,setRetry]=useState(0),[open,setOpen]=useState(false),[selected,setSelected]=useState<string|null>(null);
  const [draft,setDraft]=useState(''),[sending,setSending]=useState(false),[sendFailed,setSendFailed]=useState(false),[sent,setSent]=useState(false),[conversationDirty,setConversationDirty]=useState(false);
  const scopeKey=JSON.stringify([session.clientContext,session.expiresAt,assignmentId,version,contentLanguage]);
  const key=JSON.stringify([scopeKey,retry]);
  const readKey=useRef(key);readKey.current=key;
  const callbacks=useRef({current,onSessionLost,onDirtyChange,onSendHelp});callbacks.current={current,onSessionLost,onDirtyChange,onSendHelp};
  const [read,setRead]=useState<{key:string;data:WorkerHelpPage|null;failed:boolean}>({key:'',data:null,failed:false});
  const data=read.key===key?read.data:null,failed=read.key===key&&read.failed;
  const live=current()&&validWorkerSession(session);
  const openCases=data?data.cases.filter(item=>item.status==='open'):[],openCount=openCases.length;
  const selectedCase=data?.cases.find(item=>item.id===selected)||null;
  const dirty=!!draft.trim()||conversationDirty||sending;
  const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  const markerKey=`u:instruction-chat:${session.clientContext}:${assignmentId}`;
  const readMarker=()=>{try{return sessionStorage.getItem(markerKey);}catch{return null;}};
  const writeMarker=(id:string)=>{try{sessionStorage.setItem(markerKey,id);}catch{/* storage may be unavailable */}};
  const requestedUsed=useRef(false),seenOpen=useRef<string|null>(null);

  useEffect(()=>{
    const controller=new AbortController();let alive=true,timedOut=false;
    const isCurrent=()=>alive&&readKey.current===key&&callbacks.current.current()&&validWorkerSession(session);
    setRead(old=>({key,data:old.key===key?old.data:null,failed:false}));
    const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},15000);
    readWorkerHelpHistory(fetch,session,{assignmentId,version,language:contentLanguage},1,controller.signal,isCurrent)
      .then(value=>{if(isCurrent())setRead({key,data:value,failed:false});}).catch(error=>{
        if(!alive||readKey.current!==key||controller.signal.aborted&&!timedOut)return;
        setRead({key,data:null,failed:true});
        if(error instanceof WorkerHelpHistoryError&&error.code==='session')callbacks.current.onSessionLost();
      }).finally(()=>window.clearTimeout(timeout));
    return()=>{alive=false;controller.abort();window.clearTimeout(timeout);};
  },[key,refresh]);

  useEffect(()=>{
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible'&&callbacks.current.current())setRetry(value=>value+1);},30000);
    return()=>window.clearInterval(timer);
  },[]);

  useEffect(()=>{
    if(!data)return;
    const newest=data.cases.find(item=>item.status==='open');
    if(requestedCaseId&&!requestedUsed.current&&data.cases.some(item=>item.id===requestedCaseId)){
      requestedUsed.current=true;writeMarker(requestedCaseId);setOpen(true);setSelected(requestedCaseId);seenOpen.current=newest?.id??null;return;
    }
    if(!newest||sending||dirtyRef.current)return;
    if(seenOpen.current===newest.id)return;
    seenOpen.current=newest.id;
    if(readMarker()===newest.id)return;
    writeMarker(newest.id);setOpen(true);setSelected(newest.id);
  },[data,requestedCaseId,sending]);

  useEffect(()=>{callbacks.current.onDirtyChange(dirty);},[dirty]);
  useEffect(()=>()=>{callbacks.current.onDirtyChange(false);},[]);

  function close(){
    setOpen(false);setDraft('');setSent(false);setSendFailed(false);setConversationDirty(false);
    const newest=data?.cases.find(item=>item.status==='open');if(newest)writeMarker(newest.id);
    callbacks.current.onDirtyChange(false);
  }
  function choose(id:string){if(sending||dirtyRef.current)return;setSelected(id);setSent(false);setSendFailed(false);writeMarker(id);}
  async function submit(){
    const text=draft.trim();
    if(text.length<3||sending||disabled||!live)return;
    setSending(true);setSendFailed(false);setSent(false);
    try{
      const caseId=await callbacks.current.onSendHelp(text);
      if(caseId){setDraft('');setSent(true);setSelected(caseId);seenOpen.current=caseId;writeMarker(caseId);setRetry(value=>value+1);}
      else setSendFailed(true);
    }catch{setSendFailed(true);}finally{setSending(false);}
  }

  return <InstructionChat variant="worker" title={copy.title} launcher={copy.launcher} count={openCount} countLabel={copy.openRequests} open={open} onOpen={()=>{setOpen(true);setSent(false);setSendFailed(false);setRetry(value=>value+1);}} onClose={close} dirty={dirty} dir={rtl?'rtl':'ltr'} lang={language} copy={{close:copy.close,closeTitle:copy.closeTitle,closeBody:copy.closeBody,keepWriting:copy.keepWriting,closeConfirm:copy.closeConfirm}}>
    {open&&<>
      <div className="instruction-chat-toolbar">
        <span className="instruction-chat-count" role="status">{copy.openRequests.replace('{count}',new Intl.NumberFormat(language).format(openCount))}</span>
        <button type="button" className="icon-button" title={copy.retry} aria-label={copy.retry} disabled={sending} onClick={()=>setRetry(value=>value+1)}><RefreshCw size={16} aria-hidden="true"/></button>
      </div>
      {failed?<div role="alert" className="instruction-chat-notice"><p>{copy.failed}</p><button type="button" className="button outline" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={16} aria-hidden="true"/>{copy.retry}</button></div>
        :data===null?<p role="status" className="instruction-chat-notice">{copy.loading}</p>
        :!data.total?<p className="instruction-chat-notice">{copy.empty}</p>
        :<div className="instruction-chat-cases" role="group" aria-label={copy.conversation}>
          {data.cases.map(item=><button type="button" key={item.id} className={`instruction-chat-case${item.id===selected?' is-active':''}`} aria-pressed={item.id===selected} disabled={sending||dirty} onClick={()=>choose(item.id)}>
            <span className={`instruction-chat-state is-${item.status}`}>{item.status==='open'?copy.openCase:copy.resolvedCase}</span>
            <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(language,{timeZone:timezone,dateStyle:'short',timeStyle:'short'})}</time>
            {rtl?<ChevronLeft size={14} aria-hidden="true"/>:<ChevronRight size={14} aria-hidden="true"/>}
          </button>)}
        </div>}
      {data&&data.total>0&&selectedCase&&selectedCase.status!=='open'&&<p className="instruction-chat-notice">{copy.resolved}</p>}
      {sent&&<p role="status" className="instruction-chat-notice">{copy.sent}</p>}
      {data&&data.total>0&&selected&&<CaseConversation key={`${selected}:${scopeKey}`} embedded caseId={selected} assignmentId={assignmentId} session={{clientContext:session.clientContext!,expiresAt:session.expiresAt!}} language={language} timezone={timezone} current={()=>callbacks.current.current()&&validWorkerSession(session)} worker canWrite={canWrite&&selectedCase?.status==='open'} onDirtyChange={setConversationDirty} onSessionLost={onSessionLost}/>}
      {data&&openCount===0&&canWrite&&!disabled&&<form className="instruction-chat-composer" onSubmit={event=>{event.preventDefault();void submit();}}>
        <label className="field"><span>{copy.ask}</span><textarea dir="auto" rows={3} maxLength={500} value={draft} placeholder={copy.prompt} disabled={sending||!live} onChange={event=>{setDraft(event.target.value);setSendFailed(false);setSent(false);}}/></label>
        {sendFailed&&<p role="alert" className="record-error">{copy.sendFailed}</p>}
        <div className="actions"><button type="submit" className="button primary" disabled={sending||disabled||!live||draft.trim().length<3}><Send size={16} aria-hidden="true"/>{sending?copy.sending:copy.send}</button></div>
      </form>}
      <button type="button" className="back-link instruction-chat-older" onClick={()=>document.getElementById('worker-followup-history')?.scrollIntoView({block:'center'})}>{copy.older}</button>
    </>}
  </InstructionChat>;
}
