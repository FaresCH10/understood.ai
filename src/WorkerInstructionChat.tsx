import {useEffect,useId,useRef,useState} from 'react';
import {RefreshCw,Send,ChevronRight,ChevronLeft} from 'lucide-react';
import {CaseConversation} from './CaseConversation';
import {CaseVoiceRecorder} from './CaseVoiceRecorder';
import {InstructionChat} from './InstructionChat';
import {chatEnterToSend,resizeChatComposer} from './chat-composer';
import {validWorkerSession,type PageSession} from './session-state';
import {readWorkerHelpHistory,WorkerHelpHistoryError,type HelpHistoryScope,type WorkerHelpPage} from './worker-help-history';
import {workerUiDirection,type WorkerUiLanguage} from './worker-ui-language';
import {workerInstructionChatText} from './worker-instruction-chat-text';

export function WorkerInstructionChat({requestedCaseId,assignmentId,version,contentLanguage,language,session,refresh,current,disabled,canWrite,onSendHelp,onDirtyChange,onSessionLost,timezone,openSignal,focusSignal,seedText,canVoiceHelp}:{
  requestedCaseId?:string;assignmentId:string;version:number;contentLanguage:HelpHistoryScope['language'];language:WorkerUiLanguage;
  session:PageSession;refresh:number;current:()=>boolean;disabled:boolean;canWrite:boolean;
  onSendHelp:(text:string)=>Promise<string|null>;onDirtyChange:(value:boolean)=>void;onSessionLost:()=>void;timezone?:string;
  openSignal:number;focusSignal:number;seedText:string;canVoiceHelp:boolean;
}){
  const copy=workerInstructionChatText(language),rtl=workerUiDirection(language)==='rtl';
  const newComposerId=useId();
  const [retry,setRetry]=useState(0),[open,setOpen]=useState(false),[selected,setSelected]=useState<string|null>(null);
  const [draft,setDraft]=useState(''),[sending,setSending]=useState(false),[sendFailed,setSendFailed]=useState(false),[sent,setSent]=useState(false);
  const [conversationDirty,setConversationDirty]=useState(false),[voiceDirty,setVoiceDirty]=useState(false);
  const [seed,setSeed]=useState(''),[conversationRefresh,setConversationRefresh]=useState(0);
  const scopeKey=JSON.stringify([session.clientContext,session.expiresAt,assignmentId,version,contentLanguage]);
  const key=JSON.stringify([scopeKey,retry]);
  const readKey=useRef(key);readKey.current=key;
  const callbacks=useRef({current,onSessionLost,onDirtyChange,onSendHelp});callbacks.current={current,onSessionLost,onDirtyChange,onSendHelp};
  const [read,setRead]=useState<{key:string;data:WorkerHelpPage|null;failed:boolean}>({key:'',data:null,failed:false});
  const data=read.key===key?read.data:null,failed=read.key===key&&read.failed;
  const live=current()&&validWorkerSession(session);
  const openCases=data?data.cases.filter(item=>item.status==='open'):[],openCount=openCases.length;
  const selectedCase=data?.cases.find(item=>item.id===selected)||null;
  const dirty=!!draft.trim()||conversationDirty||voiceDirty||sending;
  const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  const markerKey=`u:instruction-chat:${session.clientContext}:${assignmentId}`;
  const readMarker=()=>{try{return sessionStorage.getItem(markerKey);}catch{return null;}};
  const writeMarker=(id:string)=>{try{sessionStorage.setItem(markerKey,id);}catch{/* storage may be unavailable */}};
  const requestedUsed=useRef(false),seenOpen=useRef<string|null>(null);
  const newComposer=useRef<HTMLTextAreaElement>(null),newFocusPending=useRef(false);

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

  const seenSignal=useRef(openSignal);
  useEffect(()=>{
    if(openSignal===seenSignal.current)return;
    const grew=openSignal>seenSignal.current;seenSignal.current=openSignal;
    if(!grew)return;
    setOpen(true);setSent(false);setSendFailed(false);setSeed(seedText);
    setRetry(value=>value+1);setConversationRefresh(value=>value+1);
  },[openSignal,seedText]);

  const seenFocus=useRef(focusSignal);
  useEffect(()=>{
    if(focusSignal===seenFocus.current)return;
    const grew=focusSignal>seenFocus.current;seenFocus.current=focusSignal;
    if(!grew)return;
    newFocusPending.current=true;
    newComposer.current?.focus();
  },[focusSignal]);
  useEffect(()=>{
    if(!newFocusPending.current||!newComposer.current)return;
    newFocusPending.current=false;newComposer.current.focus();
  },[data,open,openCount]);

  useEffect(()=>{resizeChatComposer(newComposer.current);},[draft,data]);

  useEffect(()=>{
    if(!data)return;
    const newest=data.cases.find(item=>item.status==='open');
    if(requestedCaseId&&!requestedUsed.current&&data.cases.some(item=>item.id===requestedCaseId)){
      requestedUsed.current=true;writeMarker(requestedCaseId);setOpen(true);setSelected(requestedCaseId);seenOpen.current=newest?.id??null;return;
    }
    setSelected(value=>value&&data.cases.some(item=>item.id===value)?value:(newest?.id??data.cases[0]?.id??null));
    if(!newest||sending||dirtyRef.current)return;
    if(seenOpen.current===newest.id)return;
    seenOpen.current=newest.id;
    if(readMarker()===newest.id)return;
    writeMarker(newest.id);setOpen(true);setSelected(newest.id);
  },[data,requestedCaseId,sending]);

  useEffect(()=>{callbacks.current.onDirtyChange(dirty);},[dirty]);
  useEffect(()=>()=>{callbacks.current.onDirtyChange(false);},[]);

  function close(){
    setOpen(false);setDraft('');setSeed('');setSent(false);setSendFailed(false);setConversationDirty(false);setVoiceDirty(false);
    const newest=data?.cases.find(item=>item.status==='open');if(newest)writeMarker(newest.id);
    callbacks.current.onDirtyChange(false);
  }
  function choose(id:string){if(sending||dirtyRef.current)return;setSelected(id);setSeed('');setSent(false);setSendFailed(false);writeMarker(id);}
  async function submit(){
    const text=draft.trim();
    if(text.length<3||sending||voiceDirty||disabled||!live)return;
    setSending(true);setSendFailed(false);setSent(false);
    try{
      const caseId=await callbacks.current.onSendHelp(text);
      if(caseId){setDraft('');setSeed('');setSent(true);setSelected(caseId);seenOpen.current=caseId;writeMarker(caseId);setRetry(value=>value+1);setConversationRefresh(value=>value+1);}
      else setSendFailed(true);
    }catch{setSendFailed(true);}finally{setSending(false);}
  }
  const refreshChat=()=>{setRetry(value=>value+1);setConversationRefresh(value=>value+1);};
  const openRequests=copy.openRequests.replace('{count}',new Intl.NumberFormat(language).format(openCount));

  return <InstructionChat variant="worker" title={copy.title} subtitle={openRequests} launcher={copy.launcher} count={openCount} countLabel={copy.openRequests} open={open} onOpen={()=>{setOpen(true);setSent(false);setSendFailed(false);refreshChat();}} onClose={close} dirty={dirty} dir={rtl?'rtl':'ltr'} lang={language} copy={{close:copy.close,closeTitle:copy.closeTitle,closeBody:copy.closeBody,keepWriting:copy.keepWriting,closeConfirm:copy.closeConfirm}} actions={<button type="button" className="icon-button" aria-label={copy.retry} title={copy.retry} disabled={sending} onClick={refreshChat}><RefreshCw size={18} aria-hidden="true"/></button>}>
    {open&&<div className="chat-stack">
      {failed?<div className="chat-center" role="alert"><p>{copy.failed}</p><button type="button" className="button outline" onClick={refreshChat}><RefreshCw size={16} aria-hidden="true"/>{copy.retry}</button></div>
        :data===null?<p className="chat-center" role="status">{copy.loading}</p>
        :<>
          {data.cases.length>1&&<nav className="chat-cases" aria-label={copy.conversation}>
            {data.cases.map(item=><button type="button" key={item.id} className={`chat-case${item.id===selected?' is-active':''}`} aria-pressed={item.id===selected} disabled={sending||dirty} onClick={()=>choose(item.id)}>
              <span className={`chat-case-state is-${item.status}`}>{item.status==='open'?copy.openCase:copy.resolvedCase}</span>
              <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(language,{timeZone:timezone,dateStyle:'short',timeStyle:'short'})}</time>
              {rtl?<ChevronLeft size={14} aria-hidden="true"/>:<ChevronRight size={14} aria-hidden="true"/>}
            </button>)}
          </nav>}
          {sent&&<p className="chat-notice" role="status">{copy.sent}</p>}
          {selectedCase
            ?<CaseConversation key={`${selected}:${scopeKey}`} embedded caseId={selected!} assignmentId={assignmentId} session={{clientContext:session.clientContext!,expiresAt:session.expiresAt!}} language={language} timezone={timezone} current={()=>callbacks.current.current()&&validWorkerSession(session)} worker canWrite={canWrite&&selectedCase.status==='open'} initialText={seed} leadingMessage={selectedCase.helpText?{text:selectedCase.helpText,createdAt:selectedCase.createdAt}:null} focusSignal={focusSignal} refreshSignal={conversationRefresh} onDirtyChange={setConversationDirty} onSessionLost={onSessionLost}/>
            :<div className="chat-center"><p>{copy.empty}</p></div>}
          {openCount===0&&canWrite&&!disabled&&<div className="chat-composer-area">
            <CaseVoiceRecorder inline scope={{kind:'help',id:assignmentId}} session={{clientContext:session.clientContext!,expiresAt:session.expiresAt!}} language={language} noticeLanguage={contentLanguage} available={canVoiceHelp} disabled={sending||!live||!!draft.trim()} current={()=>callbacks.current.current()&&validWorkerSession(session)} onDirtyChange={setVoiceDirty} onReceived={refreshChat} onSessionLost={onSessionLost}>
              <form className="chat-composer" onSubmit={event=>{event.preventDefault();void submit();}}>
                {sendFailed&&<p role="alert" className="record-error">{copy.sendFailed}</p>}
                <div className="chat-pill">
                  <label className="sr-only" htmlFor={newComposerId}>{copy.ask}</label>
                  <textarea ref={newComposer} id={newComposerId} className="chat-input" dir="auto" rows={1} maxLength={500} value={draft} placeholder={copy.prompt} disabled={sending||!live||voiceDirty} onChange={event=>{setDraft(event.target.value);setSendFailed(false);setSent(false);}} onKeyDown={chatEnterToSend}/>
                  <button type="submit" className="chat-send" aria-label={sending?copy.sending:copy.send} title={sending?copy.sending:copy.send} disabled={sending||disabled||!live||voiceDirty||draft.trim().length<3}><Send size={20} aria-hidden="true"/></button>
                </div>
              </form>
            </CaseVoiceRecorder>
          </div>}
        </>}
    </div>}
  </InstructionChat>;
}
