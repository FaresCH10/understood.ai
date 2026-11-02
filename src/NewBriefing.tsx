import {useStaffText as useStaffStaticText} from './staff-language';
import {GENERATION_LANGUAGE_CODES,workerLocale} from '../server/languages.mjs';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {ArrowLeft,CheckCircle2,ChevronRight,Clock3,FileText,Languages,MapPin,Mic,RefreshCw,Save,Upload} from 'lucide-react';
import {useBriefingRequest,BriefingRequestError} from './BriefingControls';
import type {StaffRequestAuthority} from './useStaffRequest';
import {readPendingDraftCreation,savePendingDraftCreation,clearPendingDraftCreation,checkedDraftCreationResult,checkedDraftCreationReceipt,type PendingDraftCreation} from './draft-creation-recovery';
import SourceAudio from './SourceAudio';
import type {PreparedSourceAudio} from './source-audio';
import SourceUploadRecovery from './SourceUploadRecovery';
import DraftSteps from './DraftSteps';
import {prepareSourceUpload,readPendingSourceUpload,savePendingSourceUpload,clearPendingSourceUpload,sendSourceUpload,type PendingSourceUpload,type SourceUploadSession} from './source-audio-upload';

type LocalDraft={title:string;source:string;sourceMode:'record'|'type'|'upload';savedAt:number};
function localDraftKey(scope?:string|null){return scope?`understood:new-briefing:${scope}`:'';}
function readLocalDraft(scope?:string|null):LocalDraft|null {
  const key=localDraftKey(scope);if(!key)return null;
  try {const raw=sessionStorage.getItem(key);if(!raw || raw.length>12000)return null;const value=JSON.parse(raw);
    if(typeof value?.title!=='string' || typeof value.source!=='string' || !['record','type','upload'].includes(value.sourceMode))return null;
    return {title:value.title.slice(0,120),source:value.source.slice(0,4000),sourceMode:value.sourceMode,savedAt:Number(value.savedAt)||0};
  }catch{return null;}
}
type ComposeJob={id:string;title:string;kind:string;status:string;created_at:string;updated_at?:string};
type ComposeMetrics={assigned:number;responses:number;matches:number;clarifications:number;pending:number;publication?:{briefingId:string;title:string;version:number}|null};
export default function NewBriefing({scope,uploadSession,navigate,navigationGuard,authority,site,audioCapture=true}:{scope?:string|null;uploadSession:SourceUploadSession;navigate:(path:string)=>void;navigationGuard:RefObject<((next:string,resume?:()=>void)=>boolean)|null>;authority:StaffRequestAuthority;site?:string;audioCapture?:boolean}) {
  const staffT=useStaffStaticText();
  const {request,current,complete,ensureCompletion,sourceFetch}=useBriefingRequest(authority);
  const [restoredDraft]=useState(()=>readLocalDraft(scope));
  const [autosave,setAutosave]=useState<'idle'|'saving'|'saved'|'error'>(restoredDraft?'saved':'idle'),[autosavedAt,setAutosavedAt]=useState(restoredDraft?.savedAt || 0);
  const [jobs,setJobs]=useState<ComposeJob[]>([]),[metrics,setMetrics]=useState<ComposeMetrics|null>(null);
  const [recovery,setRecovery]=useState<{pending:PendingDraftCreation|null;error:string}>(()=>{
    try {return {pending:scope?readPendingDraftCreation(sessionStorage,scope):null,error:''};}catch(reason){return {pending:null,error:(reason as Error).message};}
  });
  const [uploadRecovery,setUploadRecovery]=useState<{pending:PendingSourceUpload|null;error:string}>(()=>{
    try {return {pending:readPendingSourceUpload(sessionStorage,uploadSession),error:''};}catch(reason){return {pending:null,error:(reason as Error).message};}
  });
  const [audioAccepted,setAudioAccepted]=useState(false);
  const [title,setTitle]=useState(restoredDraft?.title || ''),[source,setSource]=useState(restoredDraft?.source || '');
  const [siteDefaults,setSiteDefaults]=useState(true),[languages,setLanguages]=useState(['en','ar','ur']);
  const [sourceMode,setSourceMode]=useState<'record'|'type'|'upload'>(!audioCapture || restoredDraft?.sourceMode==='type'?'type':'record'),[sourceAudio,setSourceAudio]=useState<PreparedSourceAudio|null>(null);
  const [audioActive,setAudioActive]=useState(false),approvedRoute=useRef<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;
    void Promise.allSettled([
      request<{items:ComposeJob[]}>('/processing?page=1&pageSize=5&sort=newest',undefined,undefined,controller.signal),
      request<ComposeMetrics>('/overview',undefined,undefined,controller.signal),
    ]).then(([jobList,overview])=>{
      if(!live())return;
      if(jobList.status==='fulfilled' && Array.isArray(jobList.value?.items))setJobs(jobList.value.items);
      if(overview.status==='fulfilled')setMetrics(overview.value);
    });
    return()=>controller.abort();
  },[request,current]);
  useEffect(()=>{
    const key=localDraftKey(scope);if(!key)return;
    setAutosave('saving');
    const timer=window.setTimeout(()=>{
      try {sessionStorage.setItem(key,JSON.stringify({title,source,sourceMode,savedAt:Date.now()}));setAutosavedAt(Date.now());setAutosave('saved');}
      catch{setAutosave('error');}
    },700);
    return()=>window.clearTimeout(timer);
  },[scope,title,source,sourceMode]);
  const clearLocalDraft=()=>{const key=localDraftKey(scope);if(key)try{sessionStorage.removeItem(key);}catch{/* Storage may be unavailable. */}};
  const leaveDialog=useRef<HTMLDialogElement>(null),leaveAction=useRef<(()=>void)|null>(null),leaveTrigger=useRef<HTMLElement|null>(null);
  function askLeave(action:()=>void) {
    leaveAction.current=action;leaveTrigger.current=document.activeElement as HTMLElement;leaveDialog.current?.showModal();
  }
  function cancelLeave(){leaveAction.current=null;leaveDialog.current?.close();leaveTrigger.current?.focus();}
  const unsavedAudio=!audioAccepted && (audioActive || Boolean(sourceAudio));
  useEffect(()=>{
    const guard=(next:string,resume?:()=>void)=>{
      if(next==='briefings/new' || approvedRoute.current===next)return true;
      if(sending.current){setError('Wait for the save outcome before leaving.');return false;}
      if(!unsavedAudio)return true;
      if(location.hash!=='#briefings/new')history.replaceState(null,'',`${location.pathname}${location.search}#briefings/new`);
      askLeave(()=>{approvedRoute.current=next;if(resume)resume();else navigate(next);});
      return false;
    };
    navigationGuard.current=guard;return()=>{if(navigationGuard.current===guard)navigationGuard.current=null;};
  },[unsavedAudio,navigationGuard]);
  useEffect(()=>{
    if(!unsavedAudio)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[unsavedAudio]);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const sending=useRef(false),requestId=useRef(crypto.randomUUID());
  const leavePrompt=<dialog ref={leaveDialog} className="withdraw-dialog" aria-labelledby="source-audio-leave-title" onCancel={event=>{event.preventDefault();cancelLeave();}}><h2 id="source-audio-leave-title">{staffT("Discard source audio from this tab?")}</h2><p>{staffT("Audio bytes retained in memory will be lost. Any saved upload receipt reference will remain in this tab.")}</p><div className="actions"><button className="button outline" onClick={cancelLeave}>{staffT("Keep audio")}</button><button className="button danger" onClick={()=>{const action=leaveAction.current;leaveAction.current=null;leaveDialog.current?.close();action?.();}}>{staffT("Discard and continue")}</button></div></dialog>;
  if(uploadRecovery.error)return <section role="alert"><h1>{staffT("Source audio recovery")}</h1><p>{staffT.error(uploadRecovery.error)}</p></section>;
  if(uploadRecovery.pending)return <><SourceUploadRecovery authority={authority} pending={uploadRecovery.pending} audio={sourceAudio} onAudio={setSourceAudio} onActivity={setAudioActive} onAccepted={setAudioAccepted} navigate={navigate} onResolved={id=>{
    ensureCompletion();
    clearPendingSourceUpload(sessionStorage,uploadSession,uploadRecovery.pending!);setAudioAccepted(true);clearLocalDraft();approvedRoute.current=`briefings/${id}`;navigate(`briefings/${id}`);
  }} onContinue={()=>{
    ensureCompletion();
    clearPendingSourceUpload(sessionStorage,uploadSession,uploadRecovery.pending!);setSourceAudio(null);setAudioActive(false);setAudioAccepted(false);setUploadRecovery({pending:null,error:''});setSourceMode('type');setError('');requestId.current=crypto.randomUUID();
  }}/>{leavePrompt}</>;
  if(recovery.error)return <section role="alert"><h1>{staffT("Draft recovery")}</h1><p>{staffT.error(recovery.error)}</p></section>;
  if(recovery.pending && scope)return <CreationRecovery authority={authority} pending={recovery.pending} scope={scope} onResolved={id=>{ensureCompletion();clearLocalDraft();setRecovery({pending:null,error:''});navigate(`briefings/${id}`);}} onRejected={()=>{ensureCompletion();const old=recovery.pending!;clearPendingDraftCreation(sessionStorage,scope,old);setTitle(old.title);setSource(old.source);setSiteDefaults(!old.generationLanguages);setLanguages(old.generationLanguages || ['en','ar','ur']);requestId.current=crypto.randomUUID();setRecovery({pending:null,error:''});}}/>;
  async function save() {
    if(sending.current || !current())return;sending.current=true;setBusy(true);setError('');
    if(audioCapture && sourceMode!=='type') {
      let pending:PendingSourceUpload|null=null;
      try {
        if(!sourceAudio)throw Error('Choose or record source audio first.');
        pending=await prepareSourceUpload(sourceAudio,{requestId:requestId.current,title,...(!siteDefaults?{generationLanguages:languages}:{})},uploadSession);
        ensureCompletion();
        savePendingSourceUpload(sessionStorage,uploadSession,pending);
        try {await sendSourceUpload(pending,sourceAudio,sourceFetch,AbortSignal.timeout(45000));}finally {if(current())setUploadRecovery({pending,error:''});}
      }catch(reason){if(current())setError((reason as Error).message);}
      finally {sending.current=false;if(current())setBusy(false);}
      return;
    }
    const pending={requestId:requestId.current,title,source,...(!siteDefaults?{generationLanguages:languages}:{})};let retained=false;
    try {
      if(!scope)throw Error('Draft recovery identity is unavailable. No request was sent.');
      savePendingDraftCreation(sessionStorage,scope,pending);retained=true;
      const result=await request('/briefings','POST',pending);
      await complete(result,value=>checkedDraftCreationResult(value,pending),id=>{clearPendingDraftCreation(sessionStorage,scope,pending);clearLocalDraft();approvedRoute.current=`briefings/${id}`;navigate(`briefings/${id}`);});
    }catch(reason) {
      if(!current())return;
      if(retained && scope) {
        if(reason instanceof BriefingRequestError && !reason.fenced && [400,409,413,422].includes(reason.status || 0)) {
          try {clearPendingDraftCreation(sessionStorage,scope,pending);setError(reason.message);}catch(failure){setRecovery({pending,error:''});setError((failure as Error).message);}
        }else setRecovery({pending,error:''});
      }else setError((reason as Error).message);
    }finally {sending.current=false;if(current())setBusy(false);}
  }
  const switchMode=(next:'record'|'type'|'upload')=>{
    if(!audioCapture && next!=='type')return;
    if(next===sourceMode)return;
    const change=()=>{if(next==='type'){setSourceAudio(null);setAudioActive(false);}setSourceMode(next);};
    if(next==='type' && (audioActive || sourceAudio))askLeave(change);else change();
  };
  const ago=(value:string)=>{const stamp=Date.parse(value);if(!Number.isFinite(stamp))return '';const minutes=Math.max(0,Math.round((Date.now()-stamp)/60000));return minutes<1?'Just now':minutes<60?`${minutes}m ago`:minutes<1440?`${Math.round(minutes/60)}h ago`:`${Math.round(minutes/1440)}d ago`;};
  const needsAudio=audioCapture && sourceMode!=='type' && !sourceAudio;
  const typed=!audioCapture || sourceMode==='type';
  return <><button className="back-link" onClick={()=>navigate('briefings')}><ArrowLeft size={18}/>{staffT("Back to instructions")}</button><div className="page-header"><div><h1>{audioCapture?staffT("Record an instruction"):staffT("Write an instruction")}</h1><p>{audioCapture?staffT("Record your voice, review the transcript, then publish it to your workers."):staffT("Type the instruction, then save the draft. Voice capture needs a transcription provider.")}</p></div></div><DraftSteps draft={null} active="source"/>
    <form className="briefing-compose" onSubmit={event=>{event.preventDefault();void save();}}>
      <div className="briefing-compose-main">
        <section className="panel"><h2>{staffT("Title")}</h2>
          <label className="field sr-only" htmlFor="new-briefing-title">{staffT("Title")}</label><input id="new-briefing-title" className="compose-title" value={title} disabled={busy} onChange={event=>{requestId.current=crypto.randomUUID();setTitle(event.target.value);}} required minLength={3} maxLength={120}/>
          <h2>{staffT("Source")}</h2>
          <div role="group" aria-label={staffT("Source format")} className="source-tabs">
            <button type="button" aria-pressed={sourceMode==='record'} className={sourceMode==='record'?'selected':''} disabled={busy || !audioCapture} onClick={()=>switchMode('record')}><Mic size={20}/>{staffT("Record")}</button>
            <button type="button" aria-pressed={sourceMode==='type'} className={sourceMode==='type'?'selected':''} disabled={busy} onClick={()=>switchMode('type')}><FileText size={20}/>{staffT("Type")}</button>
            <button type="button" aria-pressed={sourceMode==='upload'} className={sourceMode==='upload'?'selected':''} disabled={busy || !audioCapture} onClick={()=>switchMode('upload')}><Upload size={20}/>{staffT("Upload")}</button>
          </div>
          {typed?<label className="field">{staffT("Instruction text")}<textarea value={source} disabled={busy} onChange={event=>{requestId.current=crypto.randomUUID();setSource(event.target.value);}} required minLength={10} maxLength={4000} rows={7}/><span className="muted">{source.length} {staffT("/ 4000 characters")}</span></label>:<><SourceAudio mode={sourceMode==='upload'?'upload':'record'} disabled={busy} onChange={setSourceAudio} onActivityChange={setAudioActive}/><p role="status" className="compose-audio-state">{sourceAudio?staffT("Source audio is retained in memory until uploaded."):staffT("No source audio has been sent.")} {staffT("Transcription requires a permitted provider. Without one, the recording is kept and then stopped, and no draft is created.")}</p></>}
          <fieldset className="generation-language-options"><legend>{staffT("Preparation languages")}</legend><label className="billing-confirm"><input type="checkbox" disabled={busy} checked={siteDefaults} onChange={event=>{requestId.current=crypto.randomUUID();setSiteDefaults(event.target.checked);}}/><span>{staffT("Use site generation defaults")}</span></label>
            {!siteDefaults && GENERATION_LANGUAGE_CODES.map(code=><label className="billing-confirm" key={code}><input type="checkbox" disabled={busy || code==='en'} checked={languages.includes(code)} onChange={event=>{requestId.current=crypto.randomUUID();setLanguages(old=>GENERATION_LANGUAGE_CODES.filter(language=>language===code?event.target.checked:old.includes(language)));}}/><span>{code==='en'?staffT("English (source)"):staffT.language(code)}</span></label>)}
          </fieldset>
          {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
        </section>
        {metrics && <section className="panel briefing-assignment-strip" aria-label={staffT("Latest publication assignment overview")}>
          <div className="people-panel-heading"><div><h2>{staffT("Assignment overview")}</h2><p className="muted">{staffT("Latest publication at this site")}</p></div>{metrics.publication && <button type="button" className="text-link" disabled={busy} onClick={()=>navigate(`briefings/${metrics.publication!.briefingId}`)}>{staffT("Open")} <ChevronRight size={16}/></button>}</div>
          <dl className="assignment-stats"><div><dt>{staffT("Assigned")}</dt><dd>{staffT.number(metrics.assigned)}</dd></div><div><dt>{staffT("Responses")}</dt><dd>{staffT.number(metrics.responses)}</dd></div><div><dt>{staffT("Matches")}</dt><dd>{staffT.number(metrics.matches)}</dd></div><div className="warn"><dt>{staffT("Clarifications")}</dt><dd>{staffT.number(metrics.clarifications)}</dd></div><div><dt>{staffT("Pending")}</dt><dd>{staffT.number(metrics.pending)}</dd></div></dl>
        </section>}
      </div>
      <aside className="briefing-compose-rail" aria-label={staffT("Instruction settings and processing")}>
        <section className="panel"><div className="people-panel-heading"><h2>{staffT("AI processing (")}{jobs.length})</h2><button type="button" className="icon-button" title={staffT("Open AI processing")} aria-label={staffT("Open AI processing")} disabled={busy} onClick={()=>navigate('processing')}><ChevronRight size={18}/></button></div>
          {jobs.length?<div className="compose-jobs">{jobs.map(job=><button type="button" className="compose-job" key={job.id} disabled={busy} onClick={()=>navigate(`processing/${job.id}`)}><span className={`compose-job-icon ${job.status}`}>{/complete|ready/.test(job.status)?<CheckCircle2 size={18}/>:<Clock3 size={18}/>}</span><span><strong>{job.title}</strong><small>{job.status.replaceAll('_',' ')}{job.kind==='prepare'?staffT(" · preparation"):job.kind==='answer_check'?staffT(" · answer check"):job.kind==='source_transcription'?staffT(" · transcription"):staffT(" · audio")}</small></span><time dateTime={job.updated_at || job.created_at}>{ago(job.updated_at || job.created_at)}</time></button>)}</div>:<p className="muted">{staffT("No AI processing activity yet.")}</p>}
        </section>
        <section className="panel"><h2>{staffT("Instruction settings")}</h2>
          <label className="compose-setting"><Languages size={20}/><span>{staffT("Source language")}</span><select value="en" disabled><option value="en">{staffT("English")}</option></select></label>
          <label className="compose-setting"><MapPin size={20}/><span>{staffT("Site")}</span><select value={site || ''} disabled><option value={site || ''}>{(site||staffT("Current site"))}</option></select></label>
          <p className="compose-autosave" role="status">{autosave==='saved'?<><CheckCircle2 size={16}/>{staffT("Draft autosaved ·")} {(autosavedAt?new Date(autosavedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):staffT("Just now"))}</>:autosave==='saving'?staffT("Saving draft locally..."):autosave==='error'?staffT("Local autosave unavailable. Save the draft before leaving."):staffT("Draft is not saved yet.")}</p>
          <div className="compose-actions"><button type="submit" className="button outline" disabled={busy || needsAudio}><Save size={18}/>{busy?staffT("Saving..."):staffT("Save draft")}</button><button type="submit" className="button primary" disabled={busy || needsAudio}>{busy?staffT("Saving..."):sourceMode==='type'?staffT("Continue"):staffT("Continue")} <ChevronRight size={18}/></button></div>
          {needsAudio && <p className="muted">{staffT("Record or choose source audio to continue.")}</p>}
        </section>
      </aside>
    </form>{leavePrompt}</>;
}

function CreationRecovery({pending,scope,onResolved,onRejected,authority}:{pending:PendingDraftCreation;scope:string;onResolved:(id:string)=>void;onRejected:()=>void;authority:StaffRequestAuthority}) {
  const staffT=useStaffStaticText();
  const {request,current,complete,ensureCompletion}=useBriefingRequest(authority);
  const [busy,setBusy]=useState(false),[absent,setAbsent]=useState(false),[rejected,setRejected]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const sending=useRef(false),heading=useRef<HTMLHeadingElement>(null),callback=useRef(onResolved);callback.current=onResolved;
  useEffect(()=>{heading.current?.focus();},[]);
  const finish=(id:string)=>{ensureCompletion();clearPendingDraftCreation(sessionStorage,scope,pending);callback.current(id);};
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setAbsent(false);setRejected(false);setError('');
    request(`/draft-creation-receipts/${pending.requestId}`,'GET',undefined,controller.signal)
      .then(value=>complete(value,received=>checkedDraftCreationReceipt(received,pending),id=>{if(controller.signal.aborted)return;if(id)finish(id);else setAbsent(true);} ))
      .catch(reason=>{if(!controller.signal.aborted && current())setError((reason as Error).message);})
      .finally(()=>{if(!controller.signal.aborted && current())setBusy(false);});
    return()=>controller.abort();
  },[pending,scope,refresh,request,current,complete]);
  async function retry() {
    if(sending.current || !absent || !current())return;sending.current=true;setBusy(true);setAbsent(false);setError('');
    try {const result=await request('/briefings','POST',pending);await complete(result,value=>checkedDraftCreationResult(value,pending),finish);}
    catch(reason){if(current()){setError((reason as Error).message);if(reason instanceof BriefingRequestError && !reason.fenced && [400,409,413,422].includes(reason.status || 0))setRejected(true);}}
    finally {sending.current=false;if(current())setBusy(false);}
  }
  return <section className="panel draft-creation-recovery"><h1 ref={heading} tabIndex={-1}>{staffT("Draft receipt")}</h1><p>{pending.title}</p><p>{staffT("Preparation languages:")} {(pending.generationLanguages?.map(code=>staffT.language(code)).join(', ')||staffT("Site generation defaults"))}</p><p className="staff-recovery-request">{staffT("Request")} {pending.requestId}</p>
    {busy && <p role="status">{staffT("Checking saved outcome...")}</p>}{error && <p role="alert" className="record-error">{staffT.error(error)}</p>}{absent && <p>{staffT("No accepted receipt was found. The outcome is not confirmed.")}</p>}
    <div className="actions"><button className="button outline" disabled={busy} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={18}/>{staffT("Check receipt")}</button>
      {absent && <button className="button primary" disabled={busy} onClick={()=>void retry()}><FileText size={18}/>{staffT("Retry unchanged request")}</button>}
      {rejected && <button className="button outline" disabled={busy} onClick={()=>{try {onRejected();}catch(reason){setError((reason as Error).message);}}}><RefreshCw size={18}/>{staffT("Return to form")}</button>}
    </div></section>;
}
