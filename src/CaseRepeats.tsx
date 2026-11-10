import {CaseTime} from './CaseTime';
import {useEffect,useRef,useState} from 'react';
import {CalendarClock,Check,ChevronLeft,ChevronRight,Clock3,History,RefreshCw,Repeat2,Send,TriangleAlert} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {CaseWorkflowError,checkedRepeatPage,checkedRepeatReceipt,type RepeatPage,type RepeatRow} from './case-workflow-contract';
import {CaseRecoveryError,readCaseRepeat,retainCaseRepeat,clearCaseRepeat,mayReleaseFreshCaseRejection,type PendingRepeat} from './case-workflow-recovery';
import {civilTimeInstant} from './civil-time';
import {CaseDeadlineInput,type CaseDeadlineDraft} from './CaseDeadlineInput';
import {CaseWorkflowClear} from './CaseWorkflowClear';
import {caseText,caseMessage,caseState,type CaseLocale,type CaseTextKey} from './clarification-locale';

const empty:CaseDeadlineDraft={value:'',occurrence:''};
const blockedCopy={read_only:'Your role cannot request another answer.',workspace_archived:'This workspace is archived.',worker_unavailable:'Worker access is unavailable.',content_expired:'The instruction content is no longer available.',case_resolved:'This case is resolved.',publication_unavailable:'The publication is no longer available.',no_answer:'An earlier submitted answer is required before requesting a repeat.',active_repeat:'Another answer is already requested for this assignment.'};
export function CaseRepeats({caseId,authority,available,canWrite,closed,checkBack=false,timezone='UTC',onDirtyChange,language:locale='en'}:{caseId:string;authority:StaffRequestAuthority;available:boolean;canWrite:boolean;closed:boolean;checkBack?:boolean;timezone?:string;onDirtyChange:(dirty:boolean)=>void;language?:CaseLocale}){
  const t=(key:CaseTextKey)=>caseText(locale,key);
  const api=useStaffRequest(authority),[page,setPage]=useState(1),[tick,setTick]=useState(0),[draft,setDraft]=useState(empty),[pending,setPending]=useState<PendingRepeat|null>(null),[receipt,setReceipt]=useState<RepeatRow|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recoveryFailed,setRecoveryFailed]=useState(false),[questionBusy,setQuestionBusy]=useState(false),[questionSent,setQuestionSent]=useState(false);
  const [read,setRead]=useState<{key:string;data:RepeatPage|null;loading:boolean;error:string}>({key:'',data:null,loading:true,error:''});
  const live=useRef(false),inFlight=useRef(false),command=useRef<AbortController|null>(null),refreshButton=useRef<HTMLButtonElement>(null),form=useRef<HTMLFormElement>(null),claim=useRef(false),latest=useRef({draft,available,canWrite,authority,onDirtyChange});latest.current={draft,available,canWrite,authority,onDirtyChange};
  const path=`/api/clarifications/${encodeURIComponent(caseId)}/repeats`,questionPath=`/api/clarifications/${encodeURIComponent(caseId)}/question-repeat`,key=JSON.stringify([page,tick,available]);
  const data=read.key===key&&api.current()?read.data:null,loading=read.key!==key||read.loading,writeRole=['owner','supervisor'].includes(authority.session.staffRole||'');
  const current=()=>live.current&&api.current(),writable=()=>current()&&latest.current.available&&latest.current.canWrite&&latest.current.authority.canMutate();
  const dirty=!!draft.value||busy;
  useEffect(()=>{live.current=true;try{setPending(readCaseRepeat(sessionStorage,authority.session,caseId));}catch{setRecoveryFailed(true);setError('Local repeat recovery could not be verified. No new request will be sent.');}return()=>{live.current=false;command.current?.abort();latest.current.onDirtyChange(false);};},[]);
  useEffect(()=>{latest.current.onDirtyChange(dirty);if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  useEffect(()=>{
    let alive=true;const controller=new AbortController();setRead({key,data:null,loading:available,error:''});if(!available)return()=>controller.abort();
    api.request<unknown>(`${path}?page=${page}&pageSize=10`,undefined,controller.signal).then(value=>{if(!alive||!current())return;const checked=checkedRepeatPage(value,caseId,page,10,authority.session.clientContext!);setRead({key,data:checked,loading:false,error:''});}).catch(reason=>{
      if(!alive||!current())return;if(reason instanceof CaseWorkflowError&&reason.code==='session'){authority.onSessionLost();return;}setRead({key,data:null,loading:false,error:'Repeat history could not be verified. Refresh to try again.'});
    });return()=>{alive=false;controller.abort();};
  },[key,api]);
  useEffect(()=>{
    if(questionSent&&claim.current&&data?.canRequest)setQuestionSent(false);
  },[data,questionSent]);
  async function sendQuestion(){
    if(inFlight.current||!current()||recoveryFailed||pending||!writable()||!data?.canRequest||closed)return;
    inFlight.current=true;setBusy(true);setQuestionBusy(true);setError('');setReceipt(null);const controller=new AbortController();command.current=controller;
    let retained:PendingRepeat|null=null;
    try{
      const old=readCaseRepeat(sessionStorage,authority.session,caseId);
      if(old){setPending(old);setError('The check-back question was not confirmed. Refresh the case before retrying.');return;}
      retained=retainCaseRepeat(sessionStorage,authority.session,caseId,new Date(Date.now()+24*60*60*1000).toISOString(),writable);
      if(!current())return;setPending(retained);
      const value=await api.request<unknown>(questionPath,{requestId:retained.id,dueAt:retained.dueAt},controller.signal);
      if(!current())return;const confirmed=checkedRepeatReceipt(value,caseId,retained,authority.session.clientContext!);
      if(!current())return;setReceipt(confirmed);claim.current=true;setQuestionSent(true);
      try{clearCaseRepeat(sessionStorage,authority.session,caseId,retained);setPending(null);setRecoveryFailed(false);}catch{setRecoveryFailed(true);setError('The check-back question was not confirmed. Refresh the case before retrying.');}
      setTick(n=>n+1);
    }catch(reason){
      if(!current())return;if(reason instanceof CaseWorkflowError&&reason.code==='session'){authority.onSessionLost();return;}
      if(retained&&mayReleaseFreshCaseRejection(true,reason)){
        try{clearCaseRepeat(sessionStorage,authority.session,caseId,retained);setPending(null);setError('The check-back question was not accepted. Refresh the case before trying again.');setTick(n=>n+1);}catch{setRecoveryFailed(true);setError('The check-back question was not confirmed. Refresh the case before retrying.');}
      }else setError(retained?'The check-back question was not confirmed. Refresh the case before retrying.':'The check-back question was not accepted. Refresh the case before trying again.');
    }finally{inFlight.current=false;if(current()){setBusy(false);setQuestionBusy(false);}}
  }
  async function act(check=false){
    if(inFlight.current||!current()||!check&&(recoveryFailed||!writable()||!data?.canRequest||closed))return;
    inFlight.current=true;setBusy(true);setError('');if(!check)setReceipt(null);const controller=new AbortController();command.current=controller;
    let retained:PendingRepeat|null=null,fresh=false;
    try{
      const old=readCaseRepeat(sessionStorage,authority.session,caseId);
      if(check)retained=old;
      else{const captured=latest.current.draft,dueAt=captured.value?civilTimeInstant(captured.value,timezone,captured.occurrence):old?.dueAt;if(!dueAt)throw new CaseRecoveryError('input');retained=retainCaseRepeat(sessionStorage,authority.session,caseId,dueAt,writable);fresh=!old;}
      if(!retained)throw new CaseRecoveryError('input');if(!current())return;setPending(retained);
      const value=await api.request<unknown>(check?`${path}/${retained.id}`:path,check?undefined:{requestId:retained.id,dueAt:retained.dueAt},controller.signal);
      if(!current()||!check&&!writable())return;const confirmed=checkedRepeatReceipt(value,caseId,retained,authority.session.clientContext!);
      const candidate=latest.current.draft;let matching=false;try{matching=!!candidate.value&&civilTimeInstant(candidate.value,timezone,candidate.occurrence)===retained.dueAt;}catch{/* A different incomplete draft is not part of this receipt. */}
      if(!current())return;setReceipt(confirmed);
      try{clearCaseRepeat(sessionStorage,authority.session,caseId,retained);setPending(null);setRecoveryFailed(false);}catch{setRecoveryFailed(true);setError('The receipt is verified, but local recovery could not be cleared. No new request will be sent.');}
      if(matching&&latest.current.draft===candidate)setDraft(empty);setTick(n=>n+1);
    }catch(reason){
      if(!current())return;if(reason instanceof CaseWorkflowError&&reason.code==='session'){authority.onSessionLost();return;}
      if(retained&&mayReleaseFreshCaseRejection(fresh,reason)){
        try{clearCaseRepeat(sessionStorage,authority.session,caseId,retained);setPending(null);setError('The request was not accepted. Your deadline draft is retained. Refresh the case before trying again.');setTick(n=>n+1);}catch{setRecoveryFailed(true);setError('Local recovery could not be cleared after the rejected request. No new request will be sent.');}
      }else setError(reason instanceof CaseRecoveryError&&reason.code==='conflict'?'The draft deadline differs from the pending request. Check its receipt, or restore the original deadline.':retained?'The outcome is not confirmed. Check the repeat receipt before retrying.':'Choose a valid deadline in the next 30 days. The draft is retained; nothing new was sent.');
    }finally{inFlight.current=false;if(current())setBusy(false);}
  }
  const editable=writable()&&!busy&&!recoveryFailed&&!!data?.canRequest&&!closed,pages=Math.max(1,Math.ceil((data?.total||0)/10));
  const checkBackAvailable=checkBack&&!closed&&!!data?.canRequest,checkBackWaiting=questionSent||data?.blockedReason==='active_repeat';
  const showManualBlocked=!!data?.blockedReason&&(!checkBack||!['active_repeat','case_resolved'].includes(data.blockedReason));
  const rowStatus=(row:RepeatRow)=>row.status==='pending'&&(closed||data?.caseStatus==='resolved')?t('Pending record; case resolved'):row.status==='pending'&&Date.parse(row.dueAt)<=Date.now()?t('Pending record; deadline passed'):caseState(locale,row.status);
  return <div className="cd-action-stack">
    {error&&<p role="alert" className="record-error">{caseMessage(locale,error)}</p>}{read.key===key&&read.error&&<p role="alert" className="record-error">{caseMessage(locale,read.error)}</p>}
    {receipt&&!questionSent&&<p role="status" className="cd-action-receipt">{caseText(locale,'Repeat receipt verified: {status}. Earlier answers and assessments are unchanged.',{status:caseState(locale,receipt.status)})}</p>}
    {pending&&!busy&&<div className="notice notice-amber"><p>{receipt?t("Server receipt verified; local recovery still needs attention."):t("A repeat request has no verified receipt on this screen.")}</p><p>{t("Original deadline:")}{' '}<CaseTime value={pending.dueAt} language={locale} timezone={timezone}/></p><button className="button outline" disabled={busy||!api.current()} onClick={()=>void act(true)}><RefreshCw size={18}/>{t("Check repeat receipt")}</button></div>}

    {checkBack&&<section className="cd-action-card cd-action-card--checkback" aria-labelledby="cd-checkback-title">
      <header className="cd-action-head"><span className="cd-action-icon" aria-hidden="true"><Repeat2 size={19}/></span><div className="cd-action-copy"><h2 id="cd-checkback-title">{t('Check-back question')}</h2><p>{t("Send a generated question in the worker's language. The worker has 24 hours to answer again.")}</p></div>
        {closed?<span className="cd-action-state"><Check size={13} aria-hidden="true"/>{t('Resolved')}</span>:checkBackWaiting?<span className="cd-action-state is-waiting"><Clock3 size={13} aria-hidden="true"/>{t('Waiting for the worker')}</span>:checkBackAvailable?<span className="cd-action-state is-attention"><TriangleAlert size={13} aria-hidden="true"/>{t('Answer not correct')}</span>:null}
      </header>
      <div className="cd-action-body">
        {checkBackAvailable&&writeRole&&<button type="button" className="button primary" disabled={!canWrite||busy||questionBusy||!api.current()||recoveryFailed||!!pending} onClick={()=>void sendQuestion()}><Send size={18}/>{questionBusy?t('Sending check-back question...'):t('Send check-back question')}</button>}
        {questionSent&&<p role="status">{t('Check-back question sent. The worker has 24 hours to answer again.')}</p>}
        {!questionSent&&checkBackWaiting&&<p role="status">{caseMessage(locale,blockedCopy.active_repeat)}</p>}
        {closed&&<p role="status">{caseMessage(locale,blockedCopy.case_resolved)}</p>}
        {!closed&&!checkBackWaiting&&!checkBackAvailable&&data?.blockedReason&&<p role="status">{caseMessage(locale,blockedCopy[data.blockedReason])}</p>}
      </div>
    </section>}

    <section className="cd-action-card" aria-labelledby="cd-repeat-title">
      <header className="cd-action-head"><span className="cd-action-icon" aria-hidden="true"><CalendarClock size={19}/></span><div className="cd-action-copy"><h2 id="cd-repeat-title">{t('Request another answer')}</h2><p>{t('Give the worker another opportunity to respond.')}</p></div></header>
      <div className="cd-action-body">
        {writeRole&&(data?.canRequest||!!draft.value||!!pending)&&<form ref={form} onSubmit={event=>{event.preventDefault();void act();}}><CaseDeadlineInput required language={locale} label={t("Answer deadline")} timezone={timezone} draft={draft} readOnly={!editable} onChange={setDraft}/><button className="button outline" disabled={!editable||!draft.value&&!pending}><Repeat2 size={18}/>{pending?t("Retry exact repeat request"):t("Request another answer")}</button></form>}
        {showManualBlocked&&data?.blockedReason&&<p role="status">{caseMessage(locale,blockedCopy[data.blockedReason])}</p>}
        {!available&&draft.value&&<p role="status">{t("Your deadline draft is still here. Requesting an answer is unavailable until the case is verified again.")}</p>}
      </div>
    </section>

    <section className="cd-action-card cd-action-card--history" aria-labelledby="cd-repeat-history-title">
      <header className="cd-action-head"><span className="cd-action-icon" aria-hidden="true"><History size={19}/></span><div className="cd-action-copy"><h2 id="cd-repeat-history-title">{t('Repeat history')}</h2><p>{t('Check-back and repeat requests for this case.')}</p></div><button ref={refreshButton} className="icon-button" title={t("Refresh repeat requests")} aria-label={t("Refresh repeat requests")} disabled={busy} onClick={()=>setTick(n=>n+1)}><RefreshCw size={18}/></button></header>
      {loading?<p data-page-loading role="status">{t('Loading repeat history...')}</p>:data?.items.map(row=><article className="case-attempt cd-history-row" key={row.id}><div className="cd-history-head"><span className="cd-kind cd-kind--answer">{t('Repeat request')}</span><strong>{rowStatus(row)}</strong><CaseTime value={row.createdAt} language={locale} timezone={timezone}/></div><p>{t('Due')} <CaseTime value={row.dueAt} language={locale} timezone={timezone}/></p>{row.submittedAt&&<p>{t('Received')} <CaseTime value={row.submittedAt} language={locale} timezone={timezone}/></p>}</article>)}
      {data&&!data.items.length&&page<=pages&&<p>{t("No repeat requests yet.")}</p>}{data&&page>pages&&<p>{t("This history page is no longer available.")}{' '}<button className="back-link" disabled={dirty} onClick={()=>setPage(1)}>{t("Return to first page")}</button></p>}
      {data&&pages>1&&page<=pages&&<div className="audit-pagination"><span>{caseText(locale,'Page {page} of {pages}',{page,pages})}</span><div className="actions"><button className="icon-button" title={t('Newer repeat requests')} aria-label={t('Newer repeat requests')} disabled={page<=1||dirty} onClick={()=>setPage(n=>n-1)}>{locale==='en'?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}</button><button className="icon-button" title={t('Older repeat requests')} aria-label={t('Older repeat requests')} disabled={page>=pages||dirty} onClick={()=>setPage(n=>n+1)}>{locale==='en'?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></div></div>}
    </section>

    <CaseWorkflowClear language={locale} label="repeat" token={JSON.stringify(draft)} visible={!!draft.value} disabled={busy} current={current} onClear={()=>{setDraft(empty);if(!recoveryFailed&&!pending)setError('');}} focusFallback={()=>{const field=form.current?.querySelector('input');if(field)field.focus();else refreshButton.current?.focus();}}/>
  </div>;
}
