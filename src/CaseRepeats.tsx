import {CaseTime} from './CaseTime';
import type {ClarificationDetail} from './clarification-contract';
import {useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,ChevronLeft,ChevronRight,Clock3,History,RefreshCw,Repeat2,Send,TriangleAlert} from 'lucide-react';
import {keepDialogFocus} from './dialog-focus';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {CaseWorkflowError,checkedRepeatPage,checkedRepeatReceipt,type RepeatPage,type RepeatRow} from './case-workflow-contract';
import {CaseRecoveryError,readCaseRepeat,retainCaseRepeat,clearCaseRepeat,mayReleaseFreshCaseRejection,type PendingRepeat} from './case-workflow-recovery';
import {civilTimeInstant} from './civil-time';
import {CaseDeadlineInput,type CaseDeadlineDraft} from './CaseDeadlineInput';
import {CaseWorkflowClear} from './CaseWorkflowClear';
import {caseText,caseMessage,caseState,caseLanguage,type CaseLocale,type CaseTextKey} from './clarification-locale';

const empty:CaseDeadlineDraft={value:'',occurrence:''};
const blockedCopy={read_only:'Your role cannot request another answer.',workspace_archived:'This workspace is archived.',worker_unavailable:'Worker access is unavailable.',content_expired:'The instruction content is no longer available.',case_resolved:'This case is resolved.',publication_unavailable:'The publication is no longer available.',no_answer:'An earlier submitted answer is required before requesting a repeat.',active_repeat:'Another answer is already requested for this assignment.'};
export function CaseRepeats({caseId,worker,workerLanguage,authority,available,canWrite,closed,checkBack=false,timezone='UTC',caseDueAt=null,onDirtyChange,onResolve,onDeadline,language:locale='en'}:{caseId:string;worker:string;workerLanguage:ClarificationDetail['language'];authority:StaffRequestAuthority;available:boolean;canWrite:boolean;closed:boolean;checkBack?:boolean;timezone?:string;caseDueAt?:string|null;onDirtyChange:(dirty:boolean)=>void;onResolve?:()=>void;onDeadline?:()=>void;language?:CaseLocale}){
  const t=(key:CaseTextKey)=>caseText(locale,key);
  const api=useStaffRequest(authority),[page,setPage]=useState(1),[tick,setTick]=useState(0),[draft,setDraft]=useState(empty),[pending,setPending]=useState<PendingRepeat|null>(null),[receipt,setReceipt]=useState<RepeatRow|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recoveryFailed,setRecoveryFailed]=useState(false),[questionBusy,setQuestionBusy]=useState(false),[questionSent,setQuestionSent]=useState(false),[confirmDue,setConfirmDue]=useState<string|null>(null),[confirmExpired,setConfirmExpired]=useState(false),[confirmKind,setConfirmKind]=useState<'question'|'repeat'>('question'),[customOpen,setCustomOpen]=useState(false);
  const [read,setRead]=useState<{key:string;data:RepeatPage|null;loading:boolean;error:string}>({key:'',data:null,loading:true,error:''});
  const live=useRef(false),inFlight=useRef(false),command=useRef<AbortController|null>(null),refreshButton=useRef<HTMLButtonElement>(null),form=useRef<HTMLFormElement>(null),claim=useRef(false),hero=useRef<HTMLElement>(null),confirmDialog=useRef<HTMLDialogElement>(null),confirmCancel=useRef<HTMLButtonElement>(null),confirmSendButton=useRef<HTMLButtonElement>(null),dialogTrigger=useRef<HTMLElement|null>(null),latest=useRef({draft,available,canWrite,authority,onDirtyChange});latest.current={draft,available,canWrite,authority,onDirtyChange};
  const path=`/api/clarifications/${encodeURIComponent(caseId)}/repeats`,questionPath=`/api/clarifications/${encodeURIComponent(caseId)}/question-repeat`,key=JSON.stringify([page,tick,available]);
  const data=read.key===key&&api.current()?read.data:null,loading=read.key!==key||read.loading,writeRole=['owner','supervisor'].includes(authority.session.staffRole||'');
  const current=()=>live.current&&api.current(),writable=()=>current()&&latest.current.available&&latest.current.canWrite&&latest.current.authority.canMutate();
  const dirty=!!draft.value||busy||!!confirmDue;
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
  const confirming=!!confirmDue;
  useEffect(()=>{if(confirming){confirmDialog.current?.showModal();confirmCancel.current?.focus();}},[confirming]);
  function askSend(trigger:HTMLElement|null,dueAt=new Date(Date.now()+24*60*60*1000).toISOString(),kind:'question'|'repeat'='question'){
    if(!data?.canRequest||!writeRole||!writable()||busy||questionBusy||recoveryFailed||pending||closed)return;
    dialogTrigger.current=trigger;setConfirmKind(kind);setConfirmExpired(false);setConfirmDue(dueAt);
  }
  function customDeadline(){
    setCustomOpen(true);const section=form.current?.closest('details');if(section)section.open=true;
    dialogTrigger.current=form.current?.querySelector('input')??null;
    confirmDialog.current?.close();requestAnimationFrame(()=>{form.current?.scrollIntoView({block:'center'});dialogTrigger.current?.focus();});
  }
  function confirmSend(allowLate=false){
    if(!confirmDue)return;
    if(Date.parse(confirmDue)<=Date.now()){setConfirmExpired(true);return;}
    if(caseDueAt&&Date.parse(confirmDue)>Date.parse(caseDueAt)&&!allowLate)return;
    const dueAt=confirmDue;
    confirmDialog.current?.close();
    if(confirmKind==='question')void sendQuestion(dueAt);else void act(false,dueAt);
  }
  async function sendQuestion(dueAt:string){
    if(inFlight.current||!current()||recoveryFailed||pending||!writable()||!data?.canRequest||closed||Date.parse(dueAt)<=Date.now())return;
    inFlight.current=true;setBusy(true);setQuestionBusy(true);setError('');setReceipt(null);const controller=new AbortController();command.current=controller;
    let retained:PendingRepeat|null=null;const submittedDraft=latest.current.draft;
    try{
      const old=readCaseRepeat(sessionStorage,authority.session,caseId);
      if(old){setPending(old);setError('The check-back question was not confirmed. Refresh the case before retrying.');return;}
      retained=retainCaseRepeat(sessionStorage,authority.session,caseId,dueAt,writable);
      if(!current())return;setPending(retained);
      const value=await api.request<unknown>(questionPath,{requestId:retained.id,dueAt:retained.dueAt},controller.signal);
      if(!current())return;const confirmed=checkedRepeatReceipt(value,caseId,retained,authority.session.clientContext!);
      if(!current())return;setReceipt(confirmed);claim.current=true;setQuestionSent(true);if(latest.current.draft===submittedDraft){setDraft(empty);setCustomOpen(false);}
      try{clearCaseRepeat(sessionStorage,authority.session,caseId,retained);setPending(null);setRecoveryFailed(false);}catch{setRecoveryFailed(true);setError('The check-back question was not confirmed. Refresh the case before retrying.');}
      setTick(n=>n+1);
    }catch(reason){
      if(!current())return;if(reason instanceof CaseWorkflowError&&reason.code==='session'){authority.onSessionLost();return;}
      if(retained&&mayReleaseFreshCaseRejection(true,reason)){
        try{clearCaseRepeat(sessionStorage,authority.session,caseId,retained);setPending(null);setError('The check-back question was not accepted. Refresh the case before trying again.');setTick(n=>n+1);}catch{setRecoveryFailed(true);setError('The check-back question was not confirmed. Refresh the case before retrying.');}
      }else setError(retained?'The check-back question was not confirmed. Refresh the case before retrying.':'The check-back question was not accepted. Refresh the case before trying again.');
    }finally{inFlight.current=false;if(current()){setBusy(false);setQuestionBusy(false);}}
  }
  async function act(check=false,confirmedDue?:string){
    if(inFlight.current||!current()||!check&&(recoveryFailed||!writable()||!data?.canRequest||closed))return;
    inFlight.current=true;setBusy(true);setError('');if(!check)setReceipt(null);const controller=new AbortController();command.current=controller;
    let retained:PendingRepeat|null=null,fresh=false;const submittedDraft=latest.current.draft;
    try{
      const old=readCaseRepeat(sessionStorage,authority.session,caseId);
      if(check)retained=old;
      else{const dueAt=confirmedDue??old?.dueAt;if(!dueAt)throw new CaseRecoveryError('input');retained=retainCaseRepeat(sessionStorage,authority.session,caseId,dueAt,writable);fresh=!old;}
      if(!retained)throw new CaseRecoveryError('input');if(!current())return;setPending(retained);
      const value=await api.request<unknown>(check?`${path}/${retained.id}`:path,check?undefined:{requestId:retained.id,dueAt:retained.dueAt},controller.signal);
      if(!current()||!check&&!writable())return;const confirmed=checkedRepeatReceipt(value,caseId,retained,authority.session.clientContext!);
      const candidate=latest.current.draft;let matching=false;try{matching=!!candidate.value&&civilTimeInstant(candidate.value,timezone,candidate.occurrence)===retained.dueAt;}catch{/* A different incomplete draft is not part of this receipt. */}
      if(!current())return;setReceipt(confirmed);
      try{clearCaseRepeat(sessionStorage,authority.session,caseId,retained);setPending(null);setRecoveryFailed(false);}catch{setRecoveryFailed(true);setError('The receipt is verified, but local recovery could not be cleared. No new request will be sent.');}
      if((matching||!!confirmedDue&&candidate===submittedDraft)&&latest.current.draft===candidate){setDraft(empty);setCustomOpen(false);}setTick(n=>n+1);
    }catch(reason){
      if(!current())return;if(reason instanceof CaseWorkflowError&&reason.code==='session'){authority.onSessionLost();return;}
      if(retained&&mayReleaseFreshCaseRejection(fresh,reason)){
        try{clearCaseRepeat(sessionStorage,authority.session,caseId,retained);setPending(null);setError('The request was not accepted. Your deadline draft is retained. Refresh the case before trying again.');setTick(n=>n+1);}catch{setRecoveryFailed(true);setError('Local recovery could not be cleared after the rejected request. No new request will be sent.');}
      }else setError(reason instanceof CaseRecoveryError&&reason.code==='conflict'?'The draft deadline differs from the pending request. Check its receipt, or restore the original deadline.':retained?'The outcome is not confirmed. Check the repeat receipt before retrying.':'Choose a valid deadline in the next 30 days. The draft is retained; nothing new was sent.');
    }finally{inFlight.current=false;if(current())setBusy(false);}
  }
  const editable=writable()&&!busy&&!recoveryFailed&&!!data?.canRequest&&!closed,pages=Math.max(1,Math.ceil((data?.total||0)/10));
  const pendingRow=data?.items.find(row=>row.status==='pending'),waiting=!closed&&(questionSent||data?.blockedReason==='active_repeat'||!!pendingRow||!!pending);
  const repeatDue=pending?.dueAt??pendingRow?.dueAt??receipt?.dueAt??null;
  const canCheckBack=checkBack&&!closed&&!waiting&&!!data?.canRequest,canManual=!closed&&!waiting&&!!data?.canRequest;
  const blocked=!closed&&!waiting&&!data?.canRequest&&!!data?.blockedReason;
  const state=closed?'is-resolved':waiting?'is-waiting':'is-action';
  const title=closed?t('Resolved'):waiting?t('Waiting for the worker'):t('Follow-up needed');
  const description=closed?t('No further follow-up is needed.'):waiting?t('The case stays open until you resolve it.'):blocked?caseMessage(locale,blockedCopy[data!.blockedReason!]):t('Check the answer, then choose how to follow up.');
  let draftDue:string|null=null;
  if(draft.value)try{draftDue=civilTimeInstant(draft.value,timezone,draft.occurrence);}catch{}
  const validDraft=!!draftDue&&Date.parse(draftDue)>Date.now()&&Date.parse(draftDue)<=Date.now()+30*24*60*60*1000;
  const conflict=!!confirmDue&&!!caseDueAt&&Date.parse(confirmDue)>Date.parse(caseDueAt);
  const lateMinutes=conflict?Math.ceil((Date.parse(confirmDue!)-Date.parse(caseDueAt!))/60000):0;
  const sendDisabled=!editable||!confirmDue||confirmExpired||Date.parse(confirmDue)<=Date.now()||!!pending;
  const manualForm=<form ref={form} onSubmit={event=>{event.preventDefault();if(validDraft&&draftDue)askSend(event.currentTarget.querySelector('button'),draftDue,checkBack?'question':'repeat');}}><CaseDeadlineInput required language={locale} label={t("Answer deadline")} timezone={timezone} draft={draft} readOnly={!editable} onChange={setDraft}/><button className="button outline" aria-describedby="cd-custom-hint" disabled={!editable||!validDraft||!!pending}><Repeat2 size={18}/>{t('Review answer request')}</button><p id="cd-custom-hint">{draftDue&&caseDueAt&&Date.parse(draftDue)>Date.parse(caseDueAt)?t('The answer deadline is after the case deadline.'):!validDraft?t('Choose a future deadline within 30 days.'):t('You will review the deadline before sending.')}</p></form>;
  const rowStatus=(row:RepeatRow)=>row.status==='pending'&&(closed||data?.caseStatus==='resolved')?t('Pending record; case resolved'):row.status==='pending'&&Date.parse(row.dueAt)<=Date.now()?t('Pending record; deadline passed'):caseState(locale,row.status);
  return <div className="cd-next-step-stack">
    {error&&<p role="alert" className="record-error">{caseMessage(locale,error)}</p>}{read.key===key&&read.error&&<p role="alert" className="record-error">{caseMessage(locale,read.error)}</p>}
    {receipt&&!questionSent&&<p role="status" className="cd-next-step-receipt">{caseText(locale,'Repeat receipt verified: {status}. Earlier answers and assessments are unchanged.',{status:caseState(locale,receipt.status)})}</p>}
    {pending&&!busy&&<div className="notice notice-amber"><p>{receipt?t("Server receipt verified; local recovery still needs attention."):t("A repeat request has no verified receipt on this screen.")}</p><p>{t("Original deadline:")}{' '}<CaseTime value={pending.dueAt} language={locale} timezone={timezone}/></p><button className="button outline" disabled={busy||!api.current()} onClick={()=>void act(true)}><RefreshCw size={18}/>{t("Check repeat receipt")}</button></div>}

    <section ref={hero} className={`cd-next-step ${state}`} aria-labelledby="cd-next-step-title" aria-busy={loading||undefined}>
      <div className="cd-next-step-row">
        <div className="cd-next-step-main">
          <span className="cd-next-step-icon" aria-hidden="true">{closed?<Check size={22}/>:waiting?<Clock3 size={22}/>:<Repeat2 size={22}/>}</span>
          <div className="cd-next-step-copy">
            <h2 id="cd-next-step-title">{title}</h2>
            <p>{description}</p>
            {waiting&&repeatDue&&<div className="cd-next-step-deadline"><span>{t('Answer by')}</span><CaseTime value={repeatDue} language={locale} timezone={timezone}/></div>}
            {loading&&!data&&<p className="cd-next-step-loading" data-page-loading role="status">{t('Loading repeat history...')}</p>}
          </div>
        </div>
        <div className="cd-next-step-actions">
          {canCheckBack&&writeRole&&<div className="cd-next-step-primary"><button type="button" className="button primary" aria-describedby="cd-checkback-hint" aria-haspopup="dialog" disabled={!canWrite||busy||questionBusy||!api.current()||recoveryFailed||!!pending} onClick={event=>askSend(event.currentTarget)}><Send size={18}/>{questionBusy?t('Sending check-back question...'):t('Ask again')}</button><p id="cd-checkback-hint" className="sr-only">{t('Review the answer deadline before sending.')}</p></div>}
          {!closed&&onResolve&&<button className="button outline cd-hero-resolve" onClick={onResolve}>{t('Resolve case')}</button>}
          {waiting&&onDeadline&&<button className="button outline" onClick={onDeadline}>{t('Change case deadline')}</button>}
          {!checkBack&&writeRole&&(canManual||!!draft.value||!!pending)&&<div className="cd-next-step-form"><p>{t('Give the worker another opportunity to respond.')}</p>{manualForm}</div>}
        </div>
      </div>
      {waiting&&caseDueAt&&(Date.parse(caseDueAt)<=Date.now()||repeatDue&&Date.parse(repeatDue)>Date.parse(caseDueAt))&&<p role="status" className="cd-next-step-note">{t(Date.parse(caseDueAt)<=Date.now()?'The case is overdue and stays open until resolved.':'The answer deadline is after the case deadline.')}</p>}
      {questionSent&&<p role="status" className="sr-only">{t('Answer requested')}</p>}
      {!available&&!!draft.value&&<p role="status" className="cd-next-step-note">{t("Your deadline draft is still here. Requesting an answer is unavailable until the case is verified again.")}</p>}
      {checkBack&&writeRole&&(canManual||!!draft.value||!!pending)&&<details className="cd-next-step-secondary" hidden={!customOpen&&!draft.value}><summary><Repeat2 size={16} aria-hidden="true"/><span>{t('Set a custom deadline')}</span><ChevronDown size={16} aria-hidden="true"/></summary><div className="cd-next-step-form"><p>{t('Set a new deadline for the worker to answer again.')}</p>{manualForm}</div></details>}
      {data&&data.total>0&&<details className="cd-next-step-history"><summary><History size={16} aria-hidden="true"/><span>{t('Repeat history')}</span><span className="cd-next-step-count">{data.total}</span><ChevronDown size={16} aria-hidden="true"/></summary><div className="cd-next-step-history-body">
        <div className="cd-next-step-history-tools"><p>{t('Check-back and repeat requests for this case.')}</p><button ref={refreshButton} className="icon-button" title={t("Refresh repeat requests")} aria-label={t("Refresh repeat requests")} disabled={busy} onClick={()=>setTick(n=>n+1)}><RefreshCw size={18}/></button></div>
        {loading?<p data-page-loading role="status">{t('Loading repeat history...')}</p>:data.items.map(row=><article className="case-attempt cd-history-row" key={row.id}><div className="cd-history-head"><span className="cd-kind cd-kind--answer">{t('Repeat request')}</span><strong>{rowStatus(row)}</strong><CaseTime value={row.createdAt} language={locale} timezone={timezone}/></div><p>{t('Due')} <CaseTime value={row.dueAt} language={locale} timezone={timezone}/></p>{row.submittedAt&&<p>{t('Received')} <CaseTime value={row.submittedAt} language={locale} timezone={timezone}/></p>}</article>)}
        {data&&!data.items.length&&page<=pages&&<p>{t("No repeat requests yet.")}</p>}{data&&page>pages&&<p>{t("This history page is no longer available.")}{' '}<button className="back-link" disabled={dirty} onClick={()=>setPage(1)}>{t("Return to first page")}</button></p>}
        {data&&pages>1&&page<=pages&&<div className="audit-pagination"><span>{caseText(locale,'Page {page} of {pages}',{page,pages})}</span><div className="actions"><button className="icon-button" title={t('Newer repeat requests')} aria-label={t('Newer repeat requests')} disabled={page<=1||dirty} onClick={()=>setPage(n=>n-1)}>{locale==='en'?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}</button><button className="icon-button" title={t('Older repeat requests')} aria-label={t('Older repeat requests')} disabled={page>=pages||dirty} onClick={()=>setPage(n=>n+1)}>{locale==='en'?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></div></div>}
      </div></details>}
    </section>

    <dialog ref={confirmDialog} className="withdraw-dialog cd-confirm-dialog" aria-labelledby="cd-confirm-title" aria-describedby="cd-confirm-copy cd-confirm-due" onKeyDown={keepDialogFocus} onClose={()=>{setConfirmDue(null);const trigger=dialogTrigger.current;(trigger?.isConnected?trigger:refreshButton.current)?.focus();}}>
      <h2 id="cd-confirm-title">{t(confirmKind==='question'?'Send a check-back question?':'Request another answer?')}</h2>
      <p className="cd-confirm-worker"><strong><bdi>{worker}</bdi></strong> · {caseLanguage(locale,workerLanguage)}</p>
      <p id="cd-confirm-copy">{t(confirmKind==='question'?'The worker receives the saved question in their language. Its exact text is not available to preview here.':'The worker can answer the original question again. No new question is sent.')}</p>
      {confirmDue&&<p id="cd-confirm-due" className="cd-confirm-due"><span>{t('Answer by')}</span> <CaseTime value={confirmDue} language={locale} timezone={timezone}/></p>}
      {conflict&&<div className="cd-confirm-warning" role="status"><p>{caseText(locale,'{hours}h {minutes}m after the case deadline.',{hours:Math.floor(lateMinutes/60),minutes:lateMinutes%60})}</p><p>{t('Case deadline')}: <CaseTime value={caseDueAt!} language={locale} timezone={timezone}/></p></div>}
      {confirmDue&&(confirmExpired||Date.parse(confirmDue)<=Date.now())&&<p role="alert">{t('This deadline has passed. Choose a future deadline.')}</p>}
      {conflict&&<div className="cd-deadline-choices"><button className="button outline" disabled={!editable||!caseDueAt||Date.parse(caseDueAt)<=Date.now()} onClick={()=>{setConfirmExpired(false);setConfirmDue(caseDueAt);requestAnimationFrame(()=>confirmSendButton.current?.focus());}}>{t('Use case deadline')}</button><button className="button outline" onClick={customDeadline}>{t('Cancel and choose a custom deadline')}</button></div>}
      {!conflict&&<button className="back-link cd-custom-choice" onClick={customDeadline}>{t('Set a custom deadline')}</button>}
      <div className="actions"><button ref={confirmCancel} className="button outline" autoFocus onClick={()=>confirmDialog.current?.close()}>{t('Cancel')}</button>{conflict?<button className="button outline cd-send-late" disabled={sendDisabled} onClick={()=>confirmSend(true)}><TriangleAlert size={18} aria-hidden="true"/>{t('Send anyway; the case may become overdue')}</button>:<button ref={confirmSendButton} className="button primary" disabled={sendDisabled} onClick={()=>confirmSend()}><Send size={18}/>{t(confirmKind==='question'?'Send question':'Request another answer')}</button>}</div>
    </dialog>
    <CaseWorkflowClear language={locale} label="repeat" token={JSON.stringify(draft)} visible={!!draft.value} disabled={busy} current={current} onClear={()=>{setDraft(empty);if(!recoveryFailed&&!pending)setError('');}} focusFallback={()=>{const field=form.current?.querySelector('input');if(field)field.focus();else refreshButton.current?.focus();}}/>
  </div>;
}
