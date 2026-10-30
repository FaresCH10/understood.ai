import {CaseTime} from './CaseTime';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {ArrowLeft,ChevronLeft,ChevronRight,Plus,RefreshCw,Search,Trash2} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {canonicalCreation,checkedCreationReceipt,checkedCreationSubject,checkedCreationSubjects,clearCreation,creationHash,CreationError,readCreation,retainCreation,type CreationContent,type CreationReceipt,type CreationSubjectDetail,type CreationSubjects,type PendingCreation} from './clarification-create';
import {mayReleaseFreshCaseRejection} from './case-workflow-recovery';
import {keepDialogFocus} from './dialog-focus';
import {caseLocale,caseText,caseMessage,caseState,caseLanguage,type CaseLocale,type CaseTextKey} from './clarification-locale';
import {CaseLocalePicker} from './CaseLocalePicker';

type Draft={reason:string;link:boolean};
export default function ClarificationCreate({authority,canWrite,navigate,navigationGuard,timezone='UTC',language='en',onLanguageChange}:{authority:StaffRequestAuthority;canWrite:boolean;navigate:(path:string)=>void;navigationGuard:RefObject<((next:string,resume?:()=>void)=>boolean)|null>;timezone?:string;language?:CaseLocale;onLanguageChange?:(language:CaseLocale)=>void}){
  const locale=caseLocale(language),t=(key:CaseTextKey)=>caseText(locale,key);
  const api=useStaffRequest(authority),[search,setSearch]=useState(''),[page,setPage]=useState(1),[reload,setReload]=useState(0),[selected,setSelected]=useState('');
  const [list,setList]=useState<{key:string;data:CreationSubjects|null;error:string}>({key:'',data:null,error:''});
  const [detail,setDetail]=useState<{key:string;data:CreationSubjectDetail|null;error:string}>({key:'',data:null,error:''});
  const [draft,setDraft]=useState<Draft>({reason:'',link:false}),[pending,setPending]=useState<PendingCreation|null>(null),[receipt,setReceipt]=useState<CreationReceipt|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[recoveryFailed,setRecoveryFailed]=useState(false);
  const live=useRef(false),inFlight=useRef(false),command=useRef<AbortController|null>(null),dialog=useRef<HTMLDialogElement>(null),clearButton=useRef<HTMLButtonElement>(null),reasonInput=useRef<HTMLTextAreaElement>(null),clearIntent=useRef<Draft|null>(null);
  const listKey=JSON.stringify([search,page,reload]),detailKey=JSON.stringify([selected,reload]);
  const subject=detail.key===detailKey?detail.data:null,available=!!subject&&api.current();
  const latest=useRef({draft,subject,canWrite,authority});latest.current={draft,subject,canWrite,authority};
  const current=()=>live.current&&api.current(),writable=()=>current()&&latest.current.canWrite&&latest.current.authority.canMutate()&&!!latest.current.subject;
  const dirty=!!draft.reason||draft.link||busy;
  useEffect(()=>{live.current=true;try{setPending(readCreation(sessionStorage,authority.session));}catch{setRecoveryFailed(true);setError('Local request recovery could not be verified. No new case will be sent.');}return()=>{live.current=false;command.current?.abort();};},[]);
  useEffect(()=>{
    const guard=(next:string)=>{if(!dirty||next==='clarifications/new')return true;history.replaceState(null,'',`${location.pathname}${location.search}#clarifications/new`);setError('Finish or clear this draft before leaving. Pending request receipts are retained.');return false;};
    navigationGuard.current=guard;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};if(dirty)window.addEventListener('beforeunload',warn);
    return()=>{if(navigationGuard.current===guard)navigationGuard.current=null;window.removeEventListener('beforeunload',warn);};
  },[dirty,navigationGuard]);
  useEffect(()=>{
    let alive=true;const controller=new AbortController();setList({key:listKey,data:null,error:''});
    const query=new URLSearchParams({search:search.trim(),page:String(page),pageSize:'10'});
    api.request<unknown>(`/api/clarification-creations/subjects?${query}`,undefined,controller.signal).then(value=>{
      if(!alive||!api.current())return;const data=checkedCreationSubjects(value,page,search,authority.session.clientContext!);setList({key:listKey,data,error:''});
    }).catch(reason=>{if(!alive||!api.current())return;if(reason instanceof CreationError&&reason.code==='session'){authority.onSessionLost();return;}setList({key:listKey,data:null,error:'Assignments could not be verified. Refresh to try again.'});});
    return()=>{alive=false;controller.abort();};
  },[listKey,api]);
  useEffect(()=>{
    let alive=true;const controller=new AbortController();setDetail({key:detailKey,data:null,error:''});if(!selected)return()=>controller.abort();
    api.request<unknown>(`/api/clarification-creations/subjects/${encodeURIComponent(selected)}`,undefined,controller.signal).then(value=>{
      if(!alive||!api.current())return;const data=checkedCreationSubject(value,selected,authority.session.clientContext!);setDetail({key:detailKey,data,error:''});
    }).catch(reason=>{if(!alive||!api.current())return;if(reason instanceof CreationError&&reason.code==='session'){authority.onSessionLost();return;}setDetail({key:detailKey,data:null,error:'The selected assignment could not be verified. Your draft is retained.'});});
    return()=>{alive=false;controller.abort();};
  },[detailKey,api]);
  function content():CreationContent{
    const value=latest.current.subject;if(!value)throw Error('Assignment unavailable');
    if(latest.current.draft.link&&(!value.latestAttempt?.complete||value.latestAttempt.existingCaseId))throw Error('Response unavailable');
    return canonicalCreation({assignmentId:value.assignmentId,publicationId:value.publicationId,version:value.version,attemptId:latest.current.draft.link?value.latestAttempt?.id??null:null,reason:latest.current.draft.reason});
  }
  async function accept(value:unknown,retained:PendingCreation){
    const result=await checkedCreationReceipt(value,retained,authority.session);if(!current())return;
    const candidate=latest.current.draft;let matches=false;try{matches=await creationHash(content())===retained.hash;}catch{/* A newer or empty draft is not part of this receipt. */}
    if(!current())return;setReceipt(result);
    try{clearCreation(sessionStorage,authority.session,retained);setPending(null);setRecoveryFailed(false);}catch{setRecoveryFailed(true);setError('Server receipt verified, but local recovery could not be cleared. No new case will be sent.');}
    if(matches&&latest.current.draft===candidate)setDraft({reason:'',link:false});
  }
  async function act(check=false){
    if(inFlight.current||!current()||!check&&(!writable()||recoveryFailed))return;
    inFlight.current=true;setBusy(true);setError('');const controller=new AbortController();command.current=controller;
    let retained:PendingCreation|null=null,fresh=false;
    try{
      const before=readCreation(sessionStorage,authority.session),captured=check?null:content();fresh=!before&&!check;
      retained=check?before:await retainCreation(sessionStorage,authority.session,captured!,writable);
      if(!retained)throw Error('No pending request');if(!current())return;setPending(retained);
      const value=await api.request<unknown>(check?`/api/clarification-creations/${retained.id}`:'/api/clarification-creations',check?undefined:{requestId:retained.id,...captured},controller.signal);
      if(!current()||!check&&!writable())return;await accept(value,retained);
    }catch(reason){
      if(!current())return;if(reason instanceof CreationError&&reason.code==='session'){authority.onSessionLost();return;}
      if(retained&&mayReleaseFreshCaseRejection(fresh,reason)){
        try{clearCreation(sessionStorage,authority.session,retained);setPending(null);setError('No case was created by this request. Refresh the assignment and check your selection before trying again.');}
        catch{setRecoveryFailed(true);setError('The request was rejected, but local recovery could not be cleared. No new case will be sent.');}
      }else setError(retained?'The outcome is not confirmed. Check the receipt before retrying. Only the exact original selection and reason can be resent.':'The request could not be prepared. Check the selected assignment, reason and local recovery.');
    }finally{inFlight.current=false;if(current())setBusy(false);}
  }
  const data=list.key===listKey&&api.current()?list.data:null,pages=Math.max(1,Math.ceil((data?.total||0)/10));
  const editable=canWrite&&authority.canMutate()&&!busy,attempt=subject?.latestAttempt,canLink=!!attempt?.complete&&!attempt.existingCaseId;
  return <div className="clarification-create case-workflow">
    <button className="back-link direction-arrow" onClick={()=>navigate('clarifications')}><ArrowLeft size={18}/>{t('Back to clarifications')}</button>
    <div className="page-header"><div><h1>{t('New clarification')}</h1><p>{t('Staff follow-up')}</p></div><div className="actions">{onLanguageChange&&<CaseLocalePicker locale={locale} onChange={onLanguageChange}/>}<button className="icon-button" title={t('Refresh assignments')} aria-label={t('Refresh assignments')} disabled={busy} onClick={()=>setReload(n=>n+1)}><RefreshCw size={18}/></button></div></div>
    {error&&<p className="record-error" role="alert">{caseMessage(locale,error)}</p>}
    {receipt&&<div className="notice notice-green" role="status"><p>{t("Case created. Receipt verified.")}</p><CaseTime value={receipt.createdAt} language={locale} timezone={timezone}/><button className="button outline" onClick={()=>navigate(`clarifications/${receipt.caseId}`)}>{t("Open created case")}</button></div>}
    {pending&&<div className="notice notice-amber"><p>{t("A creation request has no cleared receipt on this screen. Its reason is not saved on this device.")}</p><button className="button outline" disabled={busy||!api.current()} onClick={()=>void act(true)}><RefreshCw size={18}/>{t("Check creation receipt")}</button></div>}
    <div className="detail-grid">
      <section className="panel"><h2>{t('Worker and instruction')}</h2><label className="search-box"><Search size={18}/><span className="sr-only">{t('Search assignments')}</span><input dir="auto" value={search} maxLength={80} disabled={busy} placeholder={t('Search worker or instruction')} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label>
        {list.key===listKey&&list.error&&<p role="alert" className="record-error">{caseMessage(locale,list.error)}</p>}
        {!data&&!list.error?<p role="status">{t('Loading assignments...')}</p>:data?.items.length?<div className="row-list">{data.items.map(row=><label className="item-row" key={row.assignmentId}><input type="radio" name="clarification-assignment" checked={selected===row.assignmentId} disabled={!editable} onChange={()=>{setSelected(row.assignmentId);setDraft(old=>({...old,link:false}));}}/><span className="item-main"><strong><bdi>{row.worker}</bdi></strong><small><bdi>{row.title||t('Untitled instruction')}</bdi> · {caseText(locale,'instruction v{version}',{version:row.version})} · {caseLanguage(locale,row.language)}</small></span></label>)}</div>:data&&<p>{t('No eligible assignments in this filter.')}</p>}
        {data&&<div className="audit-pagination"><span>{caseText(locale,'Page {page} of {pages}',{page,pages})}</span><div className="actions"><button className="icon-button" aria-label={t('Previous assignments')} title={t('Previous assignments')} disabled={busy||page<=1} onClick={()=>setPage(n=>n-1)}>{locale==='en'?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}</button><button className="icon-button" aria-label={t('Next assignments')} title={t('Next assignments')} disabled={busy||page>=pages} onClick={()=>setPage(n=>n+1)}>{locale==='en'?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></div></div>}
      </section>
      <section className="panel"><h2>{t("Follow-up details")}</h2>
        {selected&&!subject&&!detail.error&&<p role="status">{t("Loading selected assignment...")}</p>}{detail.key===detailKey&&detail.error&&<p role="alert" className="record-error">{caseMessage(locale,detail.error)}</p>}
        {subject?<><h3><bdi>{subject.worker}</bdi> · <bdi>{subject.title||t('Untitled instruction')}</bdi></h3><p>{caseText(locale,'Published v{version}',{version:subject.version})} · {caseLanguage(locale,subject.language)}</p>{attempt?<><h3>{t('Latest response')}</h3><p className="source-text" dir="auto">{attempt.text}</p><p>{caseState(locale,attempt.outcome)} · <CaseTime value={attempt.receivedAt} language={locale} timezone={timezone}/></p>{attempt.existingCaseId&&<button className="button outline" onClick={()=>navigate(`clarifications/${attempt.existingCaseId}`)}>{t('Open existing response case')}</button>}</>:<p>{t('No submitted response.')}</p>}
          <label className="field">{t("Response link")}<select value={draft.link?'latest':'none'} disabled={!editable} onChange={event=>setDraft(old=>({...old,link:event.target.value==='latest'}))}><option value="none">{t("Independent follow-up")}</option>{(canLink||draft.link)&&<option value="latest" disabled={!canLink}>{t("Latest completed response")}</option>}</select></label>{draft.link&&!canLink&&<p role="alert" className="record-error">{t("The selected response is no longer available to link. Select independent follow-up or refresh.")}</p>}
        </>:!selected&&<p>{t("Select a worker assignment.")}</p>}
        <label className="field">{t('Private staff reason')}<textarea dir="auto" ref={reasonInput} value={draft.reason} rows={5} maxLength={500} readOnly={!editable} onChange={event=>setDraft(old=>({...old,reason:event.target.value}))}/></label>
        <div className="actions"><button className="button primary" disabled={!editable||!available||recoveryFailed||draft.reason.trim().length<5||draft.link&&!canLink} onClick={()=>void act()}><Plus size={18}/>{pending?t("Retry exact creation"):t("Create clarification")}</button><button ref={clearButton} className="icon-button" title={t("Clear local draft")} aria-label={t("Clear local draft")} disabled={busy||!draft.reason&&!draft.link} onClick={()=>{clearIntent.current=latest.current.draft;dialog.current?.showModal();}}><Trash2 size={18}/></button></div>
      </section>
    </div>
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby="clarification-create-clear-title" onKeyDown={keepDialogFocus} onClose={()=>{clearIntent.current=null;(clearButton.current?.isConnected&&!clearButton.current.disabled?clearButton.current:reasonInput.current)?.focus();}}><h2 id="clarification-create-clear-title">{t("Clear this local draft?")}</h2><p>{t("This clears the unsent reason and response link. It does not cancel a pending request, delete a case or clear its recovery receipt.")}</p><div className="actions"><button className="button outline" autoFocus onClick={()=>dialog.current?.close()}>{t("Cancel")}</button><button className="button danger" onClick={()=>{if(current()&&!inFlight.current&&latest.current.draft===clearIntent.current)setDraft({reason:'',link:false});dialog.current?.close();}}>{t("Clear draft")}</button></div></dialog>
  </div>;
}
