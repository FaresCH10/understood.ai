import {CaseTime} from './CaseTime';
import {useEffect,useRef,useState} from 'react';
import {CalendarClock,ChevronLeft,ChevronRight,MessageSquareWarning,RefreshCw} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {CaseWorkflowError,checkedReviewPage,checkedReviewReceipt,type ReviewPage,type ReviewRow} from './case-workflow-contract';
import {CaseRecoveryError,canonicalCaseReview,caseReviewRecoveryHash,readCaseReview,retainCaseReview,clearCaseReview,mayReleaseFreshCaseRejection,type PendingReview,type ReviewContent} from './case-workflow-recovery';
import {civilTimeInstant} from './civil-time';
import {CaseDeadlineInput,type CaseDeadlineDraft} from './CaseDeadlineInput';
import {CaseWorkflowClear} from './CaseWorkflowClear';
import {caseText,caseMessage,type CaseLocale,type CaseTextKey} from './clarification-locale';

const empty:CaseDeadlineDraft={value:'',occurrence:''};
const blockedCopy={read_only:'Your role cannot record a supervisor review.',workspace_archived:'This workspace is archived.',worker_unavailable:'Worker access is unavailable.',content_expired:'Private case content is no longer retained.'};
export function CaseReviews({caseId,authority,available,canWrite,closed,timezone='UTC',onDirtyChange,onDeadlineChange,onAttentionChange,language:locale='en'}:{caseId:string;authority:StaffRequestAuthority;available:boolean;canWrite:boolean;closed:boolean;timezone?:string;onDirtyChange:(dirty:boolean)=>void;onDeadlineChange:(dueAt:string)=>void;onAttentionChange?:(attention:boolean)=>void;language?:CaseLocale}){
  const t=(key:CaseTextKey)=>caseText(locale,key);
  const api=useStaffRequest(authority),[page,setPage]=useState(1),[tick,setTick]=useState(0),[draft,setDraft]=useState(empty),[expectedDueAt,setExpectedDueAt]=useState<string|null>(null),[reason,setReason]=useState(''),[pending,setPending]=useState<PendingReview|null>(null),[receipt,setReceipt]=useState<ReviewRow|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recoveryFailed,setRecoveryFailed]=useState(false);
  const [read,setRead]=useState<{key:string;data:ReviewPage|null;loading:boolean;error:string}>({key:'',data:null,loading:true,error:''});
  const needsAttention=!!pending||!!error||!!read.error||recoveryFailed;
  useEffect(()=>{onAttentionChange?.(needsAttention);},[needsAttention,onAttentionChange]);
  const live=useRef(false),inFlight=useRef(false),command=useRef<AbortController|null>(null),refreshButton=useRef<HTMLButtonElement>(null),forms=useRef<HTMLDivElement>(null),latest=useRef({draft,expectedDueAt,reason,available,canWrite,authority,onDirtyChange,onDeadlineChange});latest.current={draft,expectedDueAt,reason,available,canWrite,authority,onDirtyChange,onDeadlineChange};
  const path=`/api/clarifications/${encodeURIComponent(caseId)}/reviews`,key=JSON.stringify([page,tick,available]);
  const data=read.key===key&&api.current()?read.data:null,loading=read.key!==key||read.loading,writeRole=['owner','supervisor'].includes(authority.session.staffRole||'');
  const current=()=>live.current&&api.current(),writable=()=>current()&&latest.current.available&&latest.current.canWrite&&latest.current.authority.canMutate();
  const dirty=!!draft.value||!!reason||busy;
  useEffect(()=>{live.current=true;try{setPending(readCaseReview(sessionStorage,authority.session,caseId));}catch{setRecoveryFailed(true);setError('Local review recovery could not be verified. No new review will be sent.');}return()=>{live.current=false;command.current?.abort();latest.current.onDirtyChange(false);};},[]);
  useEffect(()=>{latest.current.onDirtyChange(dirty);if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  useEffect(()=>{if(data&&!latest.current.draft.value)setExpectedDueAt(data.effectiveDueAt);},[data]);
  useEffect(()=>{
    let alive=true;const controller=new AbortController();setRead({key,data:null,loading:available,error:''});if(!available)return()=>controller.abort();
    api.request<unknown>(`${path}?page=${page}&pageSize=10`,undefined,controller.signal).then(value=>{if(!alive||!current())return;const checked=checkedReviewPage(value,caseId,page,10,authority.session.clientContext!);setRead({key,data:checked,loading:false,error:''});}).catch(reason=>{
      if(!alive||!current())return;if(reason instanceof CaseWorkflowError&&reason.code==='session'){authority.onSessionLost();return;}setRead({key,data:null,loading:false,error:'Review history could not be verified. Refresh to try again.'});
    });return()=>{alive=false;controller.abort();};
  },[key,api]);
  function content(kind:'deadline'|'disagree',value=latest.current):ReviewContent{
    return canonicalCaseReview(kind==='disagree'?{kind,reason:value.reason}:{kind,dueAt:civilTimeInstant(value.draft.value,timezone,value.draft.occurrence),expectedDueAt:value.expectedDueAt});
  }
  async function act(kind:'deadline'|'disagree'|'check'){
    if(inFlight.current||!current()||kind!=='check'&&(recoveryFailed||!writable()||!data||kind==='deadline'&&(!data.canChangeDeadline||closed)||kind==='disagree'&&!data.canDisagree))return;
    inFlight.current=true;setBusy(true);setError('');if(kind!=='check')setReceipt(null);const controller=new AbortController();command.current=controller;
    let retained:PendingReview|null=null,fresh=false;
    try{
      const old=readCaseReview(sessionStorage,authority.session,caseId),captured=kind==='check'?null:content(kind);
      if(kind==='check')retained=old;else{retained=await retainCaseReview(sessionStorage,authority.session,caseId,captured!,writable);fresh=!old;}
      if(!retained)throw new CaseRecoveryError('input');if(!current())return;setPending(retained);
      const value=await api.request<unknown>(kind==='check'?`${path}/${retained.id}`:path,captured?{requestId:retained.id,...captured}:undefined,controller.signal);
      if(!current()||kind!=='check'&&!writable())return;const confirmed=await checkedReviewReceipt(value,caseId,retained,authority.session.clientContext!);
      const candidate=latest.current;let matching=false;try{matching=await caseReviewRecoveryHash(content(retained.kind,candidate),retained.legacy)===retained.hash;}catch{/* Incomplete or different drafts must not be erased by receipt recovery. */}
      if(!current()||kind!=='check'&&!writable())return;setReceipt(confirmed);
      try{clearCaseReview(sessionStorage,authority.session,caseId,retained);setPending(null);setRecoveryFailed(false);}catch{setRecoveryFailed(true);setError('The receipt is verified, but local recovery could not be cleared. No new review will be sent.');}
      if(matching&&latest.current.draft===candidate.draft&&latest.current.reason===candidate.reason&&latest.current.expectedDueAt===candidate.expectedDueAt){if(retained.kind==='deadline'){setDraft(empty);setExpectedDueAt(confirmed.dueAt);}else setReason('');}
      if(confirmed.dueAt)latest.current.onDeadlineChange(confirmed.dueAt);setTick(n=>n+1);
    }catch(reason){
      if(!current())return;if(reason instanceof CaseWorkflowError&&reason.code==='session'){authority.onSessionLost();return;}
      if(retained&&mayReleaseFreshCaseRejection(fresh,reason)){
        try{clearCaseReview(sessionStorage,authority.session,caseId,retained);setPending(null);setError('The review was not accepted. Your drafts are retained. Refresh and check the current deadline before trying again.');setTick(n=>n+1);}catch{setRecoveryFailed(true);setError('Local recovery could not be cleared after the rejected review. No new review will be sent.');}
      }else setError(reason instanceof CaseWorkflowError&&reason.code==='retired'?'The original private reason is no longer retained. This older recovery record cannot verify its original content; it has not been removed.':reason instanceof CaseRecoveryError&&reason.code==='conflict'?'This draft differs from the pending review. Check its receipt, or restore the exact original review.':retained?'The review outcome is not confirmed. Check its receipt before retrying.':'Choose a valid deadline or enter a disagreement reason of at least five characters. Nothing new was sent.');
    }finally{inFlight.current=false;if(current())setBusy(false);}
  }
  const editable=writable()&&!busy&&!recoveryFailed,canDeadline=editable&&!!data?.canChangeDeadline&&!closed,canDisagree=editable&&!!data?.canDisagree,pages=Math.max(1,Math.ceil((data?.total||0)/10));
  return <section className="panel case-workflow"><div className="worker-card-head"><h2>{t("Supervisor review")}</h2><button ref={refreshButton} className="icon-button" title={t("Refresh case reviews")} aria-label={t("Refresh case reviews")} disabled={busy} onClick={()=>setTick(n=>n+1)}><RefreshCw size={18}/></button></div>
    {error&&<p role="alert" className="record-error">{caseMessage(locale,error)}</p>}{read.key===key&&read.error&&<p role="alert" className="record-error">{caseMessage(locale,read.error)}</p>}
    {receipt&&<p role="status">{receipt.kind==='deadline'?t("Case deadline receipt verified."):t("Disagreement receipt verified. Original assessment unchanged.")}</p>}
    {loading?<p data-page-loading role="status">{t("Loading review history...")}</p>:data?.items.map(row=><article className="case-attempt" key={row.id}><strong>{row.kind==='deadline'?t("Deadline changed"):t("Assessment disagreement")}</strong><CaseTime value={row.createdAt} language={locale} timezone={timezone}/>{row.reason&&<p dir="auto">{row.reason}</p>}{row.dueAt&&<p>{t("Due")}{' '}<CaseTime value={row.dueAt} language={locale} timezone={timezone}/></p>}</article>)}
    {data&&!data.items.length&&page<=pages&&<p>{t("No supervisor reviews yet.")}</p>}{data&&page>pages&&<p>{t("This history page is no longer available.")}{' '}<button className="back-link" disabled={dirty} onClick={()=>setPage(1)}>{t("Return to first page")}</button></p>}
    {data&&pages>1&&page<=pages&&<div className="audit-pagination"><span>{caseText(locale,'Page {page} of {pages}',{page,pages})}</span><div className="actions"><button className="icon-button" title={t('Newer reviews')} aria-label={t('Newer reviews')} disabled={page<=1||dirty} onClick={()=>setPage(n=>n-1)}>{locale==='en'?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}</button><button className="icon-button" title={t('Older reviews')} aria-label={t('Older reviews')} disabled={page>=pages||dirty} onClick={()=>setPage(n=>n+1)}>{locale==='en'?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></div></div>}
    {data?.blockedReason&&<p role="status">{caseMessage(locale,blockedCopy[data.blockedReason])}</p>}
    {pending&&<div className="notice notice-amber"><p>{receipt?t("Server receipt verified; local recovery still needs attention."):t("A review has no verified receipt on this screen. Only the exact original review can be resent.")}</p><button className="button outline" disabled={busy||!api.current()} onClick={()=>void act('check')}><RefreshCw size={18}/>{t("Check review receipt")}</button></div>}
    <div ref={forms}>
      {writeRole&&(!closed||!!draft.value)&&<form onSubmit={event=>{event.preventDefault();void act('deadline');}}><CaseDeadlineInput language={locale} label={t("Case follow-up deadline")} timezone={timezone} draft={draft} readOnly={!canDeadline} onChange={value=>{if(!draft.value)setExpectedDueAt(data?.effectiveDueAt??null);setDraft(value);}}/>
        {data&&draft.value&&expectedDueAt!==data.effectiveDueAt&&<div className="notice notice-amber"><p>{t("The current case deadline changed. Your draft is retained.")}</p><button className="button outline" disabled={!canDeadline||!!pending} onClick={()=>setExpectedDueAt(data.effectiveDueAt)}>{t("Use current deadline as starting point")}</button></div>}
        <button className="button outline" disabled={!canDeadline||!draft.value||!!pending&&pending.kind!=='deadline'}><CalendarClock size={18}/>{pending?.kind==='deadline'?t("Retry exact deadline"):t("Save case deadline")}</button></form>}
      {writeRole&&(data?.hasAssessment||!!reason)&&<form onSubmit={event=>{event.preventDefault();void act('disagree');}}><label className="field">{t("Disagreement reason (supervisor only)")}<textarea dir="auto" value={reason} maxLength={1000} rows={3} readOnly={!canDisagree} onChange={event=>setReason(event.target.value)}/></label><button className="button outline" disabled={!canDisagree||reason.trim().length<5||!!pending&&pending.kind!=='disagree'}><MessageSquareWarning size={18}/>{pending?.kind==='disagree'?t("Retry exact disagreement"):t("Record disagreement")}</button></form>}
    </div>
    {!available&&(draft.value||reason)&&<p role="status">{t("Your review drafts are still here. Saving is unavailable until the case is verified again.")}</p>}
    <CaseWorkflowClear language={locale} label="review" token={JSON.stringify([draft,expectedDueAt,reason])} visible={!!draft.value||!!reason} disabled={busy} current={current} onClear={()=>{setDraft(empty);setReason('');setExpectedDueAt(data?.effectiveDueAt??null);if(!recoveryFailed&&!pending)setError('');}} focusFallback={()=>{const field=forms.current?.querySelector<HTMLInputElement|HTMLTextAreaElement>('input,textarea');if(field)field.focus();else refreshButton.current?.focus();}}/>
  </section>;
}
