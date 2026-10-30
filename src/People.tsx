import {generateWorkerPassword} from './worker-password';
import React, { createContext,lazy,Suspense,useContext,useEffect,useMemo, useRef, useState } from 'react';
import { Archive,ArchiveRestore, Check, ChevronLeft, ChevronRight, Languages, Pencil, Plus, Search, Upload, UserRound,UserCheck, UserX, Users, X } from 'lucide-react';
import {WorkerWorkHistory} from './WorkProgress';
import { WorkerAccess } from './WorkerAccess';
const WorkerDeletion=lazy(()=>import('./WorkerDeletion').then(module=>({default:module.WorkerDeletion})));
import { keepDialogFocus } from './dialog-focus';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {completeStaffRequest,type StaffRequestMethod} from './staff-request';
import {readCrewChange} from './crew-overview';
import {peopleText,peopleLanguageNames,peoplePageText,peopleCountText,peopleShowingText,peopleDisableText,peopleMessageText,peopleErrorText,type PeopleLocale} from './people-locale';
import {WORKER_LOCALES,type WorkerLocaleCode} from '../server/languages.mjs';

type WorkerLanguage = WorkerLocaleCode;
type PendingLanguageRequest = {
  id: string; currentLanguage: WorkerLanguage; requestedLanguage: WorkerLanguage; reason: string; requestedAt: string;
};
type Worker = {
  id: string; code: string; name: string | null; language: WorkerLanguage; active: boolean;
  language_selection_required: boolean; language_selected: boolean;
  language_selected_at: string | null; language_selected_by: 'worker' | 'staff' | 'migration' | null;
  pending_language_request: PendingLanguageRequest | null;
  crew_id: string | null; crew_name: string | null;
};
type LanguageRequest = {
  id: string; workerId: string; workerCode: string | null; workerName: string | null;
  currentLanguage: WorkerLanguage; requestedLanguage: WorkerLanguage; reason: string;
  state: 'pending' | 'approved' | 'rejected'; requestedAt: string; decidedAt: string | null;
  decidedBy: string | null; decisionNote: string | null; workerActive?: boolean;
};
type LanguageRequestPage = { items: LanguageRequest[]; total: number; page: number; pageSize: number };
type Crew = { id: string; name: string; active: boolean; member_count: number };
type CrewPage = {items:Crew[];total:number;page:number;pageSize:number};
type WorkerPage = { items: Worker[]; total: number; page: number; pageSize: number };
type Props = { refresh?: number; onImport: () => void;canManage:boolean;canDelete:boolean;credentialAccess:boolean;navigate:(path:string)=>void;initialWorkerId?:string;initialCrewId?:string;initialAdd?:boolean;authority:StaffRequestAuthority;locale?:PeopleLocale;onLocaleChange?:(locale:PeopleLocale)=>void };

const PeopleLocaleContext=createContext<PeopleLocale>('en');

function usePeopleApi(authority:StaffRequestAuthority) {
  const scoped=useStaffRequest(authority);
  const peopleApi=useMemo(()=><T,>(path:string,method:StaffRequestMethod='GET',body?:object,signal?:AbortSignal)=>scoped.request<T>(`/api/people${path}`,body,signal,method),[scoped.request]);
  return {...scoped,peopleApi};
}

export function CrewActions({crew,disabled,onChanged,authority,locale:localeOverride}:{crew:Crew;disabled:boolean;onChanged:(message:string,updated:Crew)=>void;authority:StaffRequestAuthority;locale?:PeopleLocale}) {
  const inheritedLocale=useContext(PeopleLocaleContext),locale=localeOverride || inheritedLocale,t=peopleText[locale];
  const {peopleApi,current}=usePeopleApi(authority);
  const dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false),requestId=useRef('');
  const [mode,setMode]=useState<'rename'|'archive'|'restore'>('rename'),[crewName,setCrewName]=useState(crew.name);
  const [expectedName,setExpectedName]=useState(crew.name),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  function open(nextMode:'rename'|'archive'|'restore') {
    requestId.current=crypto.randomUUID();setMode(nextMode);setCrewName(crew.name);setExpectedName(crew.name);setConfirmed(false);setError('');
    dialog.current?.showModal();
  }
  async function save(event:React.FormEvent) {
    event.preventDefault();if(inFlight.current || (mode!=='rename' && !confirmed) || !current()) return;
    inFlight.current=true;setBusy(true);setError('');
    try {
      const updated=await peopleApi<Crew>(`/crews/${encodeURIComponent(crew.id)}${mode==='rename' ? '' : `/${mode}`}`,
        mode==='rename' ? 'PATCH' : 'POST',mode==='rename' ? {expectedName,name:crewName} : {expectedName,confirmed:true,...(mode==='restore' ? {requestId:requestId.current} : {})});
      await completeStaffRequest(updated,value=>readCrewChange(value,authority.session.staffScope || '',crew.id),value=>{dialog.current?.close();onChanged(mode==='restore' ? value.active ? t.crewRestored : t.restoreRecorded : mode==='archive' ? t.crewArchived : t.crewRenamed,value);},current,authority.canMutate);
    } catch(reason) {if(current())setError((reason as Error).message);} finally {inFlight.current=false;if(current())setBusy(false);}
  }
  return <div className="crew-controls">
    {crew.active && <><button type="button" className="icon-button" disabled={disabled} title={`${t.rename} ${crew.name}`} aria-label={`${t.rename} ${crew.name}`} onClick={() => open('rename')}><Pencil size={18}/></button>
    <button type="button" className="icon-button" disabled={disabled} title={`${t.archive} ${crew.name}`} aria-label={`${t.archive} ${crew.name}`} onClick={() => open('archive')}><Archive size={18}/></button></>}
    {!crew.active && <button type="button" className="icon-button" disabled={disabled} title={`${t.restore} ${crew.name}`} aria-label={`${t.restore} ${crew.name}`} onClick={() => open('restore')}><ArchiveRestore size={18}/></button>}
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby={`crew-title-${crew.id}`} aria-describedby={`crew-impact-${crew.id}`} onKeyDown={keepDialogFocus} onCancel={(event) => {if(inFlight.current) event.preventDefault();}} onClose={() => setConfirmed(false)}>
      <form onSubmit={(event) => void save(event)}>
        <div className="withdraw-heading"><h2 id={`crew-title-${crew.id}`}>{mode==='restore' ? t.restoreTitle : mode==='archive' ? t.archiveTitle : t.renameTitle}</h2><button autoFocus type="button" className="icon-button" title={t.closeCrew} aria-label={t.closeCrew} disabled={busy} onClick={() => dialog.current?.close()}><X size={20}/></button></div>
        <p id={`crew-impact-${crew.id}`} className="crew-impact"><strong><bdi>{expectedName}</bdi></strong> {mode==='restore' ? t.restoreImpact : mode==='archive' ? t.archiveImpact : t.renameImpact}</p>
        {mode==='rename' ? <label className="field">{t.crewName}<input dir="auto" value={crewName} disabled={busy} minLength={2} maxLength={80} required onChange={(event) => setCrewName(event.target.value)}/></label> : <label className="recipient-row publish-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)}/><span>{mode==='restore' ? t.restoreConfirm : t.archiveConfirm}: <bdi>{expectedName}</bdi></span></label>}
        {error && <p role="alert" className="record-error">{peopleErrorText(locale,new Error(error))}</p>}
        <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={() => dialog.current?.close()}>{t.cancel}</button><button type="submit" className={`button ${mode==='archive' ? 'danger' : 'primary'}`} disabled={busy || (mode!=='rename' ? !confirmed : crewName.trim()===expectedName || crewName.trim().length<2)}>{mode==='restore' ? <ArchiveRestore size={18}/> : mode==='archive' ? <Archive size={18}/> : <Check size={18}/>} {busy ? t.saving : mode==='restore' ? t.restoreCrew : mode==='archive' ? t.archiveCrew : t.saveName}</button></div>
      </form>
    </dialog>
  </div>;
}

function WorkerReenable({worker,onChanged,authority}:{worker:Worker;onChanged:(updated:Worker)=>void;authority:StaffRequestAuthority}) {
  const locale=useContext(PeopleLocaleContext),t=peopleText[locale];
  const {peopleApi,current}=usePeopleApi(authority);
  const dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false),requestId=useRef('');
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[expectedCode,setExpectedCode]=useState(worker.code);
  return <><button className="button outline full" onClick={() => {requestId.current=crypto.randomUUID();setExpectedCode(worker.code);setConfirmed(false);setError('');dialog.current?.showModal();}}><UserCheck size={18}/>{t.reenable}</button>
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby="reenable-title" aria-describedby="reenable-impact" onKeyDown={keepDialogFocus} onCancel={(event) => {if(inFlight.current) event.preventDefault();}} onClose={() => setConfirmed(false)}>
      <form onSubmit={async (event) => {
        event.preventDefault();if(!confirmed || inFlight.current || !current()) return;
        inFlight.current=true;setBusy(true);setError('');
        try {const updated=await peopleApi<Worker>(`/workers/${encodeURIComponent(worker.id)}/reenable`,'POST',{requestId:requestId.current,expectedCode,confirmed:true});await completeStaffRequest(updated,()=>updated,value=>{dialog.current?.close();onChanged(value);},current,authority.canMutate);}
        catch(reason) {if(current())setError((reason as Error).message);} finally {inFlight.current=false;if(current())setBusy(false);}
      }}>
        <div className="withdraw-heading"><h2 id="reenable-title">{t.reenableTitle}</h2><button autoFocus type="button" className="icon-button" title={t.closeReenable} aria-label={t.closeReenable} disabled={busy} onClick={() => dialog.current?.close()}><X size={20}/></button></div>
        <p id="reenable-impact" className="crew-impact"><strong><bdi>{expectedCode}</bdi></strong> {t.reenableImpact}</p>
        <label className="recipient-row publish-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)}/><span>{t.reenableConfirm}: <bdi>{expectedCode}</bdi></span></label>
        {error && <p role="alert" className="record-error">{peopleErrorText(locale,new Error(error))}</p>}
        <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={() => dialog.current?.close()}>{t.cancel}</button><button className="button primary" disabled={busy || !confirmed}><UserCheck size={18}/>{busy ? t.saving : t.reenable}</button></div>
      </form>
    </dialog>
  </>;
}

function LanguageDecision({request,disabled,onDecided,authority}:{request:LanguageRequest;disabled:boolean;onDecided:(message:string,updated:LanguageRequest)=>void;authority:StaffRequestAuthority}) {
  const locale=useContext(PeopleLocaleContext),t=peopleText[locale];
  const {peopleApi,current}=usePeopleApi(authority);
  const [note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const inFlight=useRef(false);
  async function decide(action:'approve'|'reject') {
    if(inFlight.current || !current() || (action==='approve' && request.workerActive===false)) return;
    inFlight.current=true;setBusy(true);setError('');
    try {
      const updated=await peopleApi<LanguageRequest>(`/language-requests/${encodeURIComponent(request.id)}/decision`,'POST',
        {action,expectedRequestedLanguage:request.requestedLanguage,note});
      await completeStaffRequest<LanguageRequest>(updated,value=>value as LanguageRequest,value=>onDecided(action==='approve'?t.languageApproved:t.languageRejected,value),current,authority.canMutate);
    } catch(reason) {if(current())setError((reason as Error).message);}
    finally {inFlight.current=false;if(current())setBusy(false);}
  }
  return <div className="language-decision">
    <label className="field">{t.decisionNote}<input dir="auto" value={note} maxLength={500} disabled={busy || disabled} onChange={(event)=>setNote(event.target.value)}/></label>
    {error && <p role="alert" className="record-error">{peopleErrorText(locale,new Error(error))}</p>}
    <div className="actions"><button type="button" className="button outline" disabled={busy || disabled} onClick={()=>void decide('reject')}>{t.rejectLanguage}</button><button type="button" className="button primary" disabled={busy || disabled || request.workerActive===false} onClick={()=>void decide('approve')}><Check size={18}/>{t.approveLanguage}</button></div>
  </div>;
}

function LanguageRequestsPanel({refresh,disabled,onChanged,authority}:{refresh:number;disabled:boolean;onChanged:(message:string)=>void;authority:StaffRequestAuthority}) {
  const locale=useContext(PeopleLocaleContext),t=peopleText[locale],languages=peopleLanguageNames(locale);
  const {peopleApi,current}=usePeopleApi(authority);
  const [page,setPage]=useState(1);
  const [data,setData]=useState<LanguageRequestPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(() => {
    const controller=new AbortController();setLoading(true);
    peopleApi<LanguageRequestPage>(`/language-requests?status=pending&page=${page}&pageSize=10`,'GET',undefined,controller.signal)
      .then((result)=>{if(!controller.signal.aborted && current()){setData(result);setError('');if(page>1&&result.items.length===0)setPage(n=>Math.max(1,n-1));}})
      .catch((reason:Error)=>{if(!controller.signal.aborted && current())setError(reason.message);})
      .finally(()=>{if(!controller.signal.aborted && current())setLoading(false);});
    return () => controller.abort();
  },[refresh,page,peopleApi,current]);
  return <section className="panel people-language-requests" aria-label={t.languageRequests}>
    <h2><Languages size={19}/> {t.languageRequests}{data && data.total ? ` (${data.total})` : ''}</h2>
    {loading ? <p role="status">{t.loadingLanguageRequests}</p> : error ? <p role="alert" className="record-error">{peopleErrorText(locale,new Error(error))}</p> : data?.items.length ? <ul className="language-request-list">{data.items.map((request)=><li key={request.id}>
      <div className="language-request-head"><strong><bdi>{request.workerName || request.workerCode || request.workerId}</bdi></strong>{request.workerName && <small><bdi>{request.workerCode}</bdi></small>}{request.workerActive===false && <span className="status status-amber"><span className="status-dot"/>{t.disabled}</span>}</div>
      <p>{t.languageRequestFrom} <bdi>{languages[request.currentLanguage]}</bdi> {t.to} <bdi>{languages[request.requestedLanguage]}</bdi></p>
      <p className="muted">{t.languageRequestReason}: {request.reason ? <bdi>{request.reason}</bdi> : t.noReasonGiven}</p>
      <LanguageDecision authority={authority} request={request} disabled={disabled} onDecided={(message)=>onChanged(message)}/>
    </li>)}</ul> : <p className="empty-state">{t.noLanguageRequests}</p>}
    {data&&data.total>10&&<div className="people-pagination"><span>{peoplePageText(locale,page,Math.max(1,Math.ceil(data.total/10)))}</span><div className="actions"><button className="icon-button" aria-label={t.previousPage} disabled={loading||page<=1} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label={t.nextPage} disabled={loading||page>=Math.ceil(data.total/10)} onClick={()=>setPage(n=>n+1)}><ChevronRight size={18}/></button></div></div>}
  </section>;
}

function CrewMembership({worker,refresh,disabled,onSave,authority}:{worker:Worker;refresh:number;disabled:boolean;onSave:(crewId:string|null)=>Promise<Worker|null>;authority:StaffRequestAuthority}) {
  const locale=useContext(PeopleLocaleContext),t=peopleText[locale];
  const {peopleApi,current}=usePeopleApi(authority);
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[data,setData]=useState<CrewPage|null>(null);
  const [choice,setChoice]=useState({id:worker.crew_id || '',name:worker.crew_name || ''});
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const inFlight=useRef(false),searchInput=useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller=new AbortController();setLoading(true);setData(null);
    const query=new URLSearchParams({search,status:'active',page:String(page),pageSize:'5'});
    peopleApi<CrewPage>(`/crews?${query}`,'GET',undefined,controller.signal).then((result) => {if(!controller.signal.aborted && current()) {setData(result);setError('');}})
      .catch((reason:Error) => {if(!controller.signal.aborted && current()) setError(reason.message);}).finally(() => {if(!controller.signal.aborted && current()) setLoading(false);});
    return () => controller.abort();
  },[search,page,refresh,peopleApi,current]);
  const pages=Math.max(1,Math.ceil((data?.total || 0)/5));
  return <div className="crew-membership">
    <label className="field">{t.findCrew}<input dir="auto" ref={searchInput} value={search} maxLength={80} disabled={disabled || saving} onChange={(event) => {setSearch(event.target.value);setPage(1);}} type="search"/></label>
    <label className="field">{t.moveTo}<select value={choice.id} disabled={disabled || saving || loading || !!error} onChange={(event) => {
      const next=data?.items.find((crew) => crew.id===event.target.value);setChoice(next ? {id:next.id,name:next.name} : {id:'',name:''});
    }}><option value="">{t.noCrew}</option>{choice.id && !data?.items.some((crew) => crew.id===choice.id) && <option value={choice.id}>{choice.name} ({t.selected})</option>}{data?.items.map((crew) => <option dir="auto" key={crew.id} value={crew.id}>{crew.name}</option>)}</select></label>
    {error && !loading && <p role="alert" className="record-error">{peopleErrorText(locale,new Error(error))}</p>}
    <div className="crew-pagination"><span role="status">{loading ? t.loadingDestinations : `${peoplePageText(locale,page,pages)} · ${peopleCountText(locale,data?.total || 0,'activeCrews')}`}</span><div className="actions"><button className="icon-button direction-arrow" title={t.previousDestinations} aria-label={t.previousDestinations} aria-disabled={disabled || saving || loading || !!error || page<=1} onClick={() => {if(!disabled && !saving && !loading && !error && page>1) setPage(page-1);}}><ChevronLeft size={18}/></button><button className="icon-button direction-arrow" title={t.nextDestinations} aria-label={t.nextDestinations} aria-disabled={disabled || saving || loading || !!error || page>=pages} onClick={() => {if(!disabled && !saving && !loading && !error && page<pages) setPage(page+1);}}><ChevronRight size={18}/></button>{!loading && !error && page>pages && <button className="button subtle" disabled={disabled || saving} onClick={() => setPage(1)}>{t.firstPage}</button>}</div></div>
    <button className="button outline full" disabled={disabled || saving || loading || !!error || choice.id===(worker.crew_id || '')} onClick={async () => {
      if(inFlight.current || !current()) return;inFlight.current=true;setSaving(true);
      try {await onSave(choice.id || null);} finally {inFlight.current=false;if(current())setSaving(false);}
    }}><Users size={18}/>{saving ? t.saving : t.saveCrew}</button>
    {choice.id!==(worker.crew_id || '') && <button className="button subtle full" disabled={disabled || saving} onClick={() => {setChoice({id:worker.crew_id || '',name:worker.crew_name || ''});searchInput.current?.focus();}}>{t.cancelCrew}</button>}
  </div>;
}

export function CreateCrewPage({authority,canManage,locale,navigate}:{authority:StaffRequestAuthority;canManage:boolean;locale:PeopleLocale;navigate:(path:string)=>void}){
  const t=peopleText[locale],{peopleApi,current}=usePeopleApi(authority);
  const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const inFlight=useRef(false);
  async function submit(event:React.FormEvent){
    event.preventDefault();if(inFlight.current||!current()||!authority.canMutate()||!canManage)return;
    inFlight.current=true;setBusy(true);setError('');
    try{await peopleApi<Crew>('/crews','POST',{name:name.trim()});if(current())navigate('people/crews');}
    catch(reason){if(current())setError(peopleErrorText(locale,reason instanceof Error?reason:Error('Request unavailable')));}
    finally{inFlight.current=false;if(current())setBusy(false);}
  }
  if(!canManage)return <p role="status">{t.limited}</p>;
  return <section className="crew-create-page" lang={locale} dir={locale==='ar'?'rtl':'ltr'}><button className="back-link" onClick={()=>navigate('people/crews')}><ChevronLeft size={18}/>{t.crews}</button><div className="page-header"><div><h1>{t.createCrew}</h1><p>{locale==='ar'?'أنشئ فريقاً، ثم أضف العمال من دليل العمال.':'Give your crew a name, then assign workers from the worker directory.'}</p></div></div><form className="panel crew-create-form" onSubmit={submit}><label className="field">{t.crewName}<input autoFocus required dir="auto" minLength={2} maxLength={80} value={name} onChange={event=>setName(event.target.value)} placeholder={t.crewPlaceholder} disabled={busy}/></label>{error&&<p role="alert" className="record-error">{error}</p>}<div className="actions"><button className="button outline" type="button" disabled={busy} onClick={()=>navigate('people/crews')}>{t.cancel}</button><button className="button primary" type="submit" disabled={busy||name.trim().length<2}><Plus size={18}/>{busy?t.saving:t.createCrew}</button></div></form></section>;
}

export function LanguageRequestsPage({authority,refresh,canManage,locale}:{authority:StaffRequestAuthority;refresh:number;canManage:boolean;locale:PeopleLocale}){
  const [revision,setRevision]=useState(0),[message,setMessage]=useState('');const t=peopleText[locale];
  if(!canManage)return <p role="status">{t.limited}</p>;
  return <PeopleLocaleContext.Provider value={locale}><section className="language-requests-page" lang={locale} dir={locale==='ar'?'rtl':'ltr'}><div className="page-header"><div><h1>{t.languageRequests}</h1><p>{locale==='ar'?'راجع طلبات العمال ووافق على اللغة المناسبة لتعليماتهم.':'Review workers’ requested languages and approve or decline each change.'}</p></div></div>{message&&<p className="notice notice-green" role="status">{peopleMessageText(locale,message)}</p>}<LanguageRequestsPanel authority={authority} refresh={refresh+revision} disabled={false} onChanged={value=>{setMessage(value);setRevision(n=>n+1);}}/></section></PeopleLocaleContext.Provider>;
}

export function PeoplePage({ refresh = 0, onImport,canManage,canDelete,credentialAccess,navigate,initialWorkerId,initialCrewId,initialAdd=false,authority,locale='en' }: Props) {
  const t=peopleText[locale],languages=peopleLanguageNames(locale);
  const {peopleApi,current}=usePeopleApi(authority);
  const changing=useRef(false);
  const [workers, setWorkers] = useState<WorkerPage | null>(null);
  const [crewChoices,setCrewChoices]=useState<CrewPage|null>(null);
  const [selected, setSelected] = useState<Worker | null>(null);
  const selectedRef=useRef(selected);selectedRef.current=selected;
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('all');
  const [status, setStatus] = useState(initialWorkerId || initialCrewId?'all':'active');
  const [workerCrew,setWorkerCrew]=useState({id:initialCrewId || 'all',name:''});
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<'add' | 'edit' | null>(initialAdd?'add':null);
  const workerDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(form && !workerDialog.current?.open){workerDialog.current?.showModal();workerDialog.current?.querySelector('input')?.focus();}else if(!form)workerDialog.current?.close();},[form]);
  const formRef=useRef(form);formRef.current=form;
  const [code, setCode] = useState('');
  const [newPassword,setNewPassword]=useState('');
  const [showNewPassword,setShowNewPassword]=useState(false);
  const [workerName,setWorkerName]=useState('');
  const [workerLanguage, setWorkerLanguage] = useState<'' | WorkerLanguage>('');
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [deletionLocked,setDeletionLocked]=useState(true);
  const workerSearchInput=useRef<HTMLInputElement>(null);

  useEffect(() => {
    if(!canManage) return;
    const controller=new AbortController();
    const query = new URLSearchParams({ search, language, status,crewId:workerCrew.id, page: String(page), pageSize: '10' });
    if(initialWorkerId)query.set('workerId',initialWorkerId);
    setLoading(true);setWorkers(null);
    peopleApi<WorkerPage>(`/workers?${query}`,'GET',undefined,controller.signal).then((nextWorkers) => {
      if (controller.signal.aborted || !current()) return;
      setWorkers(nextWorkers);
      setSelected(initialWorkerId ? nextWorkers.items.find(worker=>worker.id===initialWorkerId) || null : null);
      setError('');
    }).catch((reason) => { if (!controller.signal.aborted && current()) setError((reason as Error).message); })
      .finally(() => { if (!controller.signal.aborted && current()) setLoading(false); });
    return () => controller.abort();
  }, [refresh, revision, search, language, status,workerCrew.id,page,canManage,initialWorkerId,peopleApi,current]);

  useEffect(()=>{
    if(!initialCrewId||!canManage)return;
    const controller=new AbortController();
    peopleApi<Crew>(`/crews/${encodeURIComponent(initialCrewId)}`,'GET',undefined,controller.signal).then(crew=>{if(!controller.signal.aborted&&current())setWorkerCrew(old=>old.id===crew.id?{id:crew.id,name:crew.name}:old);}).catch(()=>{});
    return()=>controller.abort();
  },[initialCrewId,canManage,peopleApi,current]);

  useEffect(() => {
    if(!canManage) return;
    const controller=new AbortController();
    (async()=>{
      const items:CrewPage['items']=[];
      let page=1,total=0;
      do {
        const result=await peopleApi<CrewPage>(`/crews?status=active&page=${page}&pageSize=100`,'GET',undefined,controller.signal);
        if(controller.signal.aborted || !current())return;
        items.push(...result.items);total=result.total;page+=1;
      } while(items.length<total && page<=50); // ponytail: 50 pages is 5,000 crews. A larger page is refused by the API.
      if(!controller.signal.aborted && current())setCrewChoices({items,total,page:1,pageSize:Math.max(items.length,1)});
    })().catch(()=>{if(!controller.signal.aborted && current())setCrewChoices({items:[],total:0,page:1,pageSize:100});});
    return ()=>controller.abort();
  },[refresh,revision,canManage,peopleApi,current]);

  useEffect(() => { setConfirmDisable(false);setDeletionLocked(true); }, [selected?.id]);
  useEffect(() => { setConfirmDisable(false); }, [selected?.crew_id]);

  async function change<T>(action: () => Promise<T>, success: string): Promise<T | null> {
    if(changing.current || !current())return null;changing.current=true;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await action();
      await completeStaffRequest(result,value=>value,()=>{setMessage(success);setRevision((n) => n + 1);},current,authority.canMutate);
      return result;
    } catch (reason) { if(current())setError((reason as Error).message); return null; }
    finally { changing.current=false;if(current())setBusy(false); }
  }

  function startAdd() { setNewPassword('');setShowNewPassword(false);setCode(''); setWorkerName(''); setWorkerLanguage(''); setForm('add'); setConfirmDisable(false); }
  function startEdit() {
    if (!selected) return;
    setCode(selected.code); setWorkerName(selected.name || ''); setWorkerLanguage(selected.language_selection_required ? '' : selected.language); setForm('edit'); setConfirmDisable(false);
  }

  async function saveWorker(event: React.FormEvent) {
    event.preventDefault();
    const payload={code,...(form==='add'?{password:newPassword}:{}),name:workerName.trim() || null,...(workerLanguage ? {language:workerLanguage} : {})};
    const worker = form === 'add'
      ? await change(() => peopleApi<Worker>('/workers', 'POST', payload), t.workerAdded)
      : selected && await change(() => peopleApi<Worker>(`/workers/${encodeURIComponent(selected.id)}`, 'PATCH', payload), t.workerUpdated);
    if (worker && current() && authority.canMutate() && selectedRef.current?.id===selected?.id && formRef.current===form) {
      setSelected(worker);
      setForm(null);setNewPassword('');
      setSearch(worker.name || worker.code); setLanguage('all'); setPage(1);
      if(form==='add'){navigate(`people/worker/${encodeURIComponent(worker.id)}`);return;}
      if (status === 'inactive') setStatus('all');
    }
  }

  async function moveCrew(crewId:string|null) {
    if (!selected) return null;
    const worker = await change(() => peopleApi<Worker>(`/workers/${encodeURIComponent(selected.id)}/crew`, 'POST', { crewId }), t.membershipUpdated);
    if (worker && current() && authority.canMutate() && selectedRef.current?.id===selected.id) setSelected(worker);
    return worker;
  }

  async function disable() {
    if (!selected) return;
    const worker = await change(() => peopleApi<Worker>(`/workers/${encodeURIComponent(selected.id)}/disable`, 'POST'), t.workerDisabled);
    if (worker && current() && authority.canMutate() && selectedRef.current?.id===selected.id) { setSelected(worker); setStatus('all'); setConfirmDisable(false); }
  }

  function languageDecided(message:string){if(current()){setMessage(message);setRevision(n=>n+1);}}
  const pages = workers ? Math.max(1, Math.ceil(workers.total / workers.pageSize)) : 1;
  if(!canManage) return <p className="notice notice-blue" role="status" lang={locale} dir={locale==='ar'?'rtl':'ltr'}>{t.limited}</p>;
  return <PeopleLocaleContext.Provider value={locale}><div className="people-localized" lang={locale} dir={locale==='ar'?'rtl':'ltr'}>
    {initialWorkerId && <button className="back-link" onClick={()=>navigate('people')}><ChevronLeft size={18}/>{t.workers}</button>}
    <div className="page-header"><div><h1>{initialWorkerId ? selected?.name || selected?.code || t.workerDetails : t.workers}</h1><p>{initialWorkerId ? selected?.code : t.intro}</p></div>
      {!initialWorkerId && <div className="actions people-header-actions"><button className="button outline" onClick={onImport}><Upload size={19}/>{t.importCsv}</button><button className="button primary" onClick={startAdd}><Plus size={19}/>{t.addWorker}</button></div>}
    </div>
    {!initialWorkerId && <>
    <div className="filters people-filters">
      {(initialWorkerId || initialCrewId) && <button className="button outline" onClick={()=>navigate('people')}><X size={18}/>{t.clearFilter}</button>}
      <label className="search-box"><Search size={18} /><span className="sr-only">{t.searchWorkers}</span><input dir="auto" ref={workerSearchInput} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t.searchPlaceholder} /></label>
      <label className="select-label">{t.language}<select value={language} onChange={(event) => { setLanguage(event.target.value); setPage(1); }}><option value="all">{t.allLanguages}</option><option value="unset">{t.notSelected}</option>{WORKER_LOCALES.map(item=><option key={item.code} value={item.code}>{languages[item.code]}</option>)}</select></label>
      <label className="select-label">{t.access}<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="active">{t.active}</option><option value="inactive">{t.disabled}</option><option value="all">{t.allStatuses}</option></select></label>
      <label className="select-label">{t.membership}<select value={workerCrew.id} onChange={(event) => {const crew=crewChoices?.items.find(item=>item.id===event.target.value);setWorkerCrew({id:event.target.value,name:crew?.name || ''});setPage(1);}}><option value="all">{t.allCrews}</option><option value="none">{t.noCrew}</option>{crewChoices?.items.map(crew=><option key={crew.id} dir="auto" value={crew.id}>{crew.name}</option>)}{!['all','none'].includes(workerCrew.id) && !crewChoices?.items.some(crew=>crew.id===workerCrew.id) && <option dir="auto" value={workerCrew.id}>{workerCrew.name || t.selectedCrew}</option>}</select></label>
    </div>
    </>}
    {error && <p className="notice" role="alert">{peopleErrorText(locale,new Error(error))}</p>}
    {message && <p className="notice notice-green" role="status">{peopleMessageText(locale,message)}</p>}
    <div className={initialWorkerId?"worker-profile-layout":"worker-directory-layout"}>
      {!initialWorkerId && <section className="panel people-directory" aria-label={t.directory}>
        <h2>{t.workers} ({workers?.total ?? 0})</h2>
        {loading && !workers ? <p role="status">{t.loadingWorkers}</p> : workers?.items.length ? <div className="table-wrap" role="region" aria-label={t.directory} tabIndex={0}><table className="people-table">
          <thead><tr><th>{t.workerId}</th><th>{t.language}</th><th>{t.accessStatus}</th><th>{t.crew}</th><th><span className="sr-only">{t.details}</span></th></tr></thead>
          <tbody>{workers.items.map((worker) => <tr key={worker.id} className="worker-profile-row" onClick={()=>navigate(`people/worker/${encodeURIComponent(worker.id)}`)}>
            <td><button className="people-row-button" onClick={event => {event.stopPropagation();navigate(`people/worker/${encodeURIComponent(worker.id)}`);}}><UserRound size={18} /> <span className="people-worker-identity"><strong><bdi>{worker.name || worker.code}</bdi></strong>{worker.name && <small><bdi>{worker.code}</bdi></small>}</span></button></td>
            <td>{worker.language_selected ? <>{languages[worker.language]}{worker.pending_language_request && <small className="language-pending">{t.pendingChangeTo} {languages[worker.pending_language_request.requestedLanguage]}</small>}</> : <span className="status status-amber"><span className="status-dot" />{t.notSelected}</span>}</td><td><span className={`status ${worker.active ? 'status-green' : 'status-amber'}`}><span className="status-dot" />{worker.active ? t.active : t.disabled}</span></td>
            <td><bdi>{worker.crew_name || '—'}</bdi></td><td><button className="icon-button direction-arrow" aria-label={`${t.details}: ${worker.code}`} onClick={event => {event.stopPropagation();navigate(`people/worker/${encodeURIComponent(worker.id)}`);}}><ChevronRight size={19} /></button></td>
          </tr>)}</tbody>
        </table></div> : <p className="empty-state">{t.noWorkers}</p>}
        <div className="people-pagination"><span>{peopleShowingText(locale,workers?.items.length || 0,workers?.total || 0)}</span><div>
          <button className="icon-button direction-arrow" aria-label={t.previousPage} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={19} /></button>
          <span>{peoplePageText(locale,page,pages)}</span>
          <button className="icon-button direction-arrow" aria-label={t.nextPage} disabled={page >= pages || loading} onClick={() => setPage(page + 1)}><ChevronRight size={19} /></button>
        </div></div>
      </section>}
      <div className="worker-profile-content">
        {<dialog ref={workerDialog} className="worker-form-dialog" aria-label={form==='add'?t.addWorker:t.editWorker} onCancel={event=>{if(busy)event.preventDefault();else setForm(null);}}><section className="panel people-form"><div className="people-panel-heading"><h2>{form === 'add' ? t.addWorker : t.editWorker}</h2><button className="icon-button" aria-label={t.closeForm} disabled={busy} onClick={() => setForm(null)}><X size={19} /></button></div>
          <form onSubmit={saveWorker}>{error&&<p role="alert" className="notice">{peopleErrorText(locale,new Error(error))}</p>}<label className="field">{t.workerId}<input autoFocus disabled={busy} dir="auto" value={code} onChange={(event) => setCode(event.target.value)} minLength={2} maxLength={80} required /></label>
            {form==='add'&&<><label className="field">{locale==='ar'?'كلمة مرور العامل':'Worker password'}<input type={showNewPassword?'text':'password'} autoComplete="new-password" required minLength={8} maxLength={128} value={newPassword} disabled={busy} onChange={event=>setNewPassword(event.target.value)}/></label><div className="actions"><button type="button" className="button outline" disabled={busy} onClick={()=>{setNewPassword(generateWorkerPassword());setShowNewPassword(true);}}>{locale==='ar'?'إنشاء كلمة مرور':'Generate password'}</button><button type="button" className="button subtle" disabled={busy} onClick={()=>setShowNewPassword(value=>!value)}>{showNewPassword?(locale==='ar'?'إخفاء':'Hide'):(locale==='ar'?'إظهار':'Show')}</button></div><p className="muted">{locale==='ar'?'احفظ كلمة المرور وشاركها مع العامل بشكل خاص.':'Save this password and share it privately with the worker.'}</p></>}
            <label className="field">{t.workerName}<input disabled={busy} dir="auto" value={workerName} onChange={(event) => setWorkerName(event.target.value)} minLength={2} maxLength={80} placeholder={t.namePlaceholder} /></label>
            <label className="field">{t.preferred}<select disabled={busy} value={workerLanguage} onChange={(event) => setWorkerLanguage(event.target.value as '' | WorkerLanguage)}>{(form==='add' || selected?.language_selection_required) && <option value="">{t.chooseLater}</option>}{WORKER_LOCALES.map(item=><option key={item.code} value={item.code}>{languages[item.code]}</option>)}</select></label>
            <p className="muted">{t.workerLanguageHint}{form==='edit' && ` ${t.directCorrection}`}</p>
            <button className="button primary full" type="submit" disabled={busy}><Check size={18} />{t.saveWorker}</button></form>
        </section></dialog>}
        {initialWorkerId && selected ? <section className="panel people-detail"><div className="people-panel-heading"><div className="people-detail-title"><span className="small-avatar"><UserRound size={23} /></span><div><h2><bdi>{selected.name || selected.code}</bdi></h2><p><bdi>{selected.code}</bdi> · {selected.active ? t.active : t.disabled} · {selected.language_selected ? languages[selected.language] : t.notSelected}</p></div></div><button className="icon-button" aria-label={t.closeDetails} onClick={() => navigate('people')}><X size={19} /></button></div>
          <dl className="people-facts"><dt>{t.workerName}</dt><dd><bdi>{selected.name || '—'}</bdi></dd><dt>{t.workerId}</dt><dd><bdi>{selected.code}</bdi></dd><dt>{t.preferred}</dt><dd>{selected.language_selected ? <>{languages[selected.language]}{selected.language_selected_by==='worker' ? <small className="language-source">{t.chosenByWorker}</small> : selected.language_selected_by==='staff' ? <small className="language-source">{t.setByStaff}</small> : null}</> : <>{t.firstUse}<small className="language-source">{t.noLanguage}</small></>}</dd><dt>{t.crew}</dt><dd><bdi>{selected.crew_name || t.noCrew}</bdi></dd><dt>{t.access}</dt><dd>{selected.active ? t.active : t.disabled}</dd></dl>
          {selected.pending_language_request && <div className="language-pending-request"><p><strong>{t.pendingLanguage}</strong>: <bdi>{languages[selected.pending_language_request.currentLanguage]}</bdi> → <bdi>{languages[selected.pending_language_request.requestedLanguage]}</bdi></p>{selected.pending_language_request.reason && <p className="muted">{t.languageRequestReason}: <bdi>{selected.pending_language_request.reason}</bdi></p>}<LanguageDecision authority={authority} request={{...selected.pending_language_request,workerId:selected.id,workerCode:selected.code,workerName:selected.name,state:'pending',decidedAt:null,decidedBy:null,decisionNote:null,workerActive:selected.active}} disabled={busy || (canDelete && deletionLocked)} onDecided={(success)=>languageDecided(success)}/></div>}
          {selected.active && <><CrewMembership authority={authority} key={`${selected.id}:${selected.crew_id}`} worker={selected} refresh={refresh+revision} disabled={busy || (canDelete && deletionLocked)} onSave={moveCrew}/>
            <div className="people-actions"><button className="button outline" disabled={canDelete && deletionLocked} onClick={startEdit}><Pencil size={18} />{t.edit}</button><button className="button subtle" disabled={canDelete && deletionLocked} onClick={() => setConfirmDisable(true)}><UserX size={18} />{t.disable}</button></div>
            {confirmDisable && <div className="notice people-confirm" role="alert"><p>{t.disableWorker}: <bdi>{selected.name || selected.code}</bdi>? {peopleDisableText(locale)}</p><div className="actions"><button className="button outline" onClick={() => setConfirmDisable(false)}>{t.cancel}</button><button className="button primary" disabled={busy} onClick={disable}>{t.disableWorker}</button></div></div>}</>}
          {!selected.active && (!canDelete || !deletionLocked) && <WorkerReenable authority={authority} key={selected.id} worker={selected} onChanged={(updated) => {if(!current())return;setSelected(updated);setStatus('all');setSearch(updated.code);setPage(1);setRevision((n) => n+1);setMessage(updated.active ? t.workerReenabled : t.reenableRecorded);workerSearchInput.current?.focus();}}/>}
        </section> : initialWorkerId && !loading ? <p role="status">Worker unavailable.</p> : null}
        {initialWorkerId && selected && !form && <div lang="en" dir="ltr"><WorkerAccess authority={authority} key={selected.id} workerId={selected.id} code={selected.code} active={selected.active} credentialAccess={credentialAccess} canManage={canManage}/></div>}
        {initialWorkerId && selected && !form && canDelete && <div lang="en" dir="ltr"><Suspense fallback={<p role="status">{t.loadingData}</p>}><WorkerDeletion authority={authority} key={selected.id} workerId={selected.id} code={selected.code} onLocked={setDeletionLocked} onQueued={(status)=>{if(!current() || selectedRef.current?.id!==selected.id)return;setSelected({...selected,active:false});setStatus('all');setMessage(status==='complete'?t.cleanupComplete:t.cleanupQueued);}}/></Suspense></div>}

      </div>
    </div>

    {initialWorkerId && selected && !form && <div><WorkerWorkHistory authority={authority} key={selected.id} workerId={selected.id} refresh={refresh+revision} navigate={navigate} /></div>}
  </div></PeopleLocaleContext.Provider>;
}
