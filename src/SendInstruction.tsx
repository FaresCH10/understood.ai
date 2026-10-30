import {useStaffText} from './staff-language';
import RecipientMembers from './RecipientMembers';
import VoiceTranscript from './VoiceTranscript';
import {AttachmentComposer} from './InstructionFiles';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {AlertTriangle,ArrowLeft,CheckCircle2,ChevronRight,FileText,Mic,RefreshCw,Send,Users} from 'lucide-react';
import type {StaffRequestAuthority} from './useStaffRequest';
import {useStaffRequest} from './useStaffRequest';
import {StaffRequestError} from './staff-request';

type Mode='question'|'acknowledge';
type Delivery='text'|'voice'|'both';
type AudienceChoice={type:'all'}|{type:'crew';crewId:string}|{type:'members';workerIds:string[]};
type AudienceOverview={members:{id:string;code:string;name:string|null;language:string;language_selection_required:boolean|number}[];workers:{total:number;byLanguage:Record<string,number>;notSelected?:number};crews:{id:string;name:string;members:number;byLanguage:Record<string,number>;notSelected:number}[]};
type UndeliveredReason={reason:string;language?:string;count:number};
type DeliveryStates={preparing:number;available:number;blocked:number;failed:number;withdrawn:number};
type SendResult={requestId:string;briefingId:string;state:'preparing'|'published'|'failed';responseMode:Mode;deliveryMode:Delivery;
  audience:{type:string;count:number;crewId?:string};delivered:number;undelivered:number;undeliveredReasons:UndeliveredReason[];
  deliveryStates?:DeliveryStates|null;retryable?:boolean;retryRequestId?:string;retried?:number;released?:number;
  publicationId:string|null;error:string|null;duplicate:boolean};
type PendingSend={requestId:string;title:string;source:string;audience:AudienceChoice;responseMode:Mode;deliveryMode:Delivery;savedAt:number};

const sourceMin=10,sourceMax=4000,titleMax=120;
const pendingKey=(scope:string)=>`understood:send-instruction:${scope}`;
const validAudience=(value:unknown):value is AudienceChoice=>{
  if(!value || typeof value!=='object')return false;
  const raw=value as Record<string,unknown>;
  if(raw.type==='members')return Array.isArray(raw.workerIds)&&raw.workerIds.length>0&&raw.workerIds.every(id=>typeof id==='string');
  return raw.type==='all' ? Object.keys(raw).every(key=>key==='type') : raw.type==='crew' && typeof raw.crewId==='string' && raw.crewId.length>0;
};
function readPending(scope:string|null):PendingSend|null {
  if(!scope)return null;
  try {
    const raw=sessionStorage.getItem(pendingKey(scope));
    if(!raw)return null;
    if(raw.length>12000)throw Error();
    const value=JSON.parse(raw);
    if(typeof value?.requestId!=='string' || !/^[0-9a-f-]{36}$/i.test(value.requestId)
      || typeof value.source!=='string' || value.source.length>sourceMax || typeof value.title!=='string'
      || !['question','acknowledge'].includes(value.responseMode) || !['text','voice','both'].includes(value.deliveryMode)
      || !validAudience(value.audience))throw Error();
    return {requestId:value.requestId,title:value.title.slice(0,titleMax),source:value.source,audience:value.audience,
      responseMode:value.responseMode,deliveryMode:value.deliveryMode,savedAt:Number(value.savedAt)||0};
  }catch{throw Error('Send recovery could not be read. Reload after restoring browser storage before sending.');}
}
function savePending(scope:string|null,value:PendingSend){
  if(!scope)throw Error('Send recovery is unavailable. No instruction was sent.');
  const key=pendingKey(scope),raw=JSON.stringify(value);
  try{sessionStorage.setItem(key,raw);if(sessionStorage.getItem(key)!==raw)throw Error();}
  catch{throw Error('Send recovery could not be saved. No instruction was sent.');}
}
function clearPending(scope:string|null){
  if(!scope)return;
  try{sessionStorage.removeItem(pendingKey(scope));}catch{/* Storage may be unavailable. */}
}
export function derivedInstructionTitle(source:string){
  const clean=source.normalize('NFKC').replace(/\s+/g,' ').trim();
  if(clean.length<3)return '';
  const sentence=clean.split(/(?<=[.!?])\s/)[0] || clean;
  return (sentence.length>120 ? `${sentence.slice(0,117).trimEnd()}…` : sentence).slice(0,titleMax);
}
function reasonText(reason:UndeliveredReason){
  const language=reason.language==='ar'?'Arabic':reason.language==='ur'?'Urdu':reason.language?reason.language.toUpperCase():'';
  if(reason.reason==='language_unavailable')return `${language || 'Language'} version not ready`;
  if(reason.reason==='content_unavailable')return `${language || 'Language'} text not ready`;
  if(reason.reason==='question_unavailable')return `${language || 'Language'} question not ready`;
  if(reason.reason==='speech_unavailable')return `${language || 'Language'} voice not ready`;
  if(reason.reason==='worker_inactive')return `${language ? `${language} ` : ''}worker no longer active`;
  return `${reason.reason.replaceAll('_',' ')}${language?` · ${language}`:''}`;
}

export default function SendInstruction({authority,scope,navigate,onSent,draftId,navigationGuard}:{draftId?:string;navigationGuard:RefObject<((next:string,resume?:()=>void)=>boolean)|null>;authority:StaffRequestAuthority;scope:string|null;navigate:(path:string)=>void;onSent:()=>void}){
 const tr=useStaffText();
  const {request,current}=useStaffRequest(authority);
  const [recovery]=useState(()=>{try{return {pending:readPending(scope),error:''};}catch(error){return {pending:null,error:(error as Error).message};}});
  const restoredPending=recovery.pending;
  const [pending,setPending]=useState<PendingSend|null>(restoredPending);
  const [source,setSource]=useState(restoredPending?.source || '');
  const [title,setTitle]=useState(restoredPending?.title || '');
  const [audienceType,setAudienceType]=useState<'all'|'crew'|'members'>(restoredPending?.audience.type || 'all');
  const [crewId,setCrewId]=useState(restoredPending?.audience.type==='crew'?restoredPending.audience.crewId:'');
  const [workerIds,setWorkerIds]=useState<string[]>(restoredPending?.audience.type==='members'?restoredPending.audience.workerIds:[]);
  const [responseMode,setResponseMode]=useState<Mode>(restoredPending?.responseMode || 'question');
  const [deliveryMode,setDeliveryMode]=useState<Delivery>(restoredPending?.deliveryMode || 'both');
  const [audience,setAudience]=useState<AudienceOverview|null>(null);
  const [audienceError,setAudienceError]=useState('');
  const [result,setResult]=useState<SendResult|null>(null);
  const [retryReceipt,setRetryReceipt]=useState<{requestId:string;retried:number;released:number}|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false),[attachmentBusy,setAttachmentBusy]=useState(false);
  const requestId=useRef(restoredPending?.requestId || draftId || crypto.randomUUID());
  const sending=useRef(false);
  const sentNotice=useRef(false);
  const trimmedSource=source.trim();
  const effectiveTitle=title.trim().slice(0,titleMax);
  const audienceChoice:AudienceChoice=audienceType==='crew'?{type:'crew',crewId}:audienceType==='members'?{type:'members',workerIds:[...workerIds].sort()}:{type:'all'};
  const selectedCrew=audienceType==='crew'?audience?.crews.find(crew=>crew.id===crewId):null;
  const selectedMembers=audience?.members?.filter(member=>workerIds.includes(member.id))||[];
  const selectedAudience=audienceType==='members'?{total:selectedMembers.filter(member=>!member.language_selection_required).length,notSelected:selectedMembers.filter(member=>member.language_selection_required).length,byLanguage:selectedMembers.reduce<Record<string,number>>((counts,member)=>{counts[member.language]=(counts[member.language]||0)+1;return counts;},{})}:audienceType==='all'?audience?.workers:selectedCrew?{total:selectedCrew.members,byLanguage:selectedCrew.byLanguage,notSelected:selectedCrew.notSelected}:null;
  const titleValid=effectiveTitle.length>=3;
  const canSubmit=trimmedSource.length>=sourceMin && trimmedSource.length<=sourceMax && titleValid
    && !!selectedAudience && selectedAudience.total>0 && !selectedAudience.notSelected && !busy && !attachmentBusy && !pending && !recovery.error;

  const voiceDialog=useRef<HTMLDialogElement>(null),[voiceOpen,setVoiceOpen]=useState(false);
  const [draftLoaded,setDraftLoaded]=useState(!draftId),[draftNotice,setDraftNotice]=useState('');
  const saveQueue=useRef(Promise.resolve()),approvedNext=useRef<string|null>(null),hasSavedDraft=useRef(false);
  const contentRef=useRef({title,source,audience:audienceChoice,responseMode,deliveryMode});contentRef.current={title,source,audience:audienceChoice,responseMode,deliveryMode};
  const localKey=`understood:composition:${scope}:${requestId.current}`;
  useEffect(()=>{
    if(restoredPending){setDraftLoaded(true);return;}
    let active=true;
    if(draftId){request<{content:typeof contentRef.current|null}>(`/api/workspace/drafts/${draftId}`).then(value=>{if(active&&current()&&value.content){const c=value.content;hasSavedDraft.current=true;setTitle(c.title);setSource(c.source);setResponseMode(c.responseMode);setDeliveryMode(c.deliveryMode);setAudienceType(c.audience.type);if(c.audience.type==='crew')setCrewId(c.audience.crewId);if(c.audience.type==='members')setWorkerIds(c.audience.workerIds);}}).catch(reason=>{if(active&&current()){try{const raw=sessionStorage.getItem(localKey),saved=raw?JSON.parse(raw):null;if(saved?.id===draftId&&saved.content){setTitle(saved.content.title||'');setSource(saved.content.source||'');setResponseMode(saved.content.responseMode||'question');setDeliveryMode(saved.content.deliveryMode||'both');if(validAudience(saved.content.audience)){setAudienceType(saved.content.audience.type);if(saved.content.audience.type==='crew')setCrewId(saved.content.audience.crewId);if(saved.content.audience.type==='members')setWorkerIds(saved.content.audience.workerIds);}}}catch{}setError(reason.message);}}).finally(()=>{if(active)setDraftLoaded(true);});}

    return()=>{active=false;};
  },[]);
  async function saveDraft(){
    if(!current()||pending||result)return;
    const content={...contentRef.current},id=requestId.current;
    if(!content.source&&!content.title&&!hasSavedDraft.current)return;
    const task=saveQueue.current.catch(()=>{}).then(async()=>{await request(`/api/workspace/drafts/${id}`,content,undefined,'POST');if(current()){hasSavedDraft.current=true;setDraftNotice('Draft saved');setError(previous=>previous.startsWith('Save draft before leaving:')?'':previous);}});saveQueue.current=task;await task;
  }
  useEffect(()=>{
    if(!draftLoaded||pending||result)return;
    try{sessionStorage.setItem(localKey,JSON.stringify({id:requestId.current,content:contentRef.current}));}catch{setDraftNotice('Browser draft storage unavailable.');}
    if((source||title)&&location.hash==='#send')history.replaceState(null,'',`${location.pathname}${location.search}#send/${requestId.current}`);
    const timer=setTimeout(()=>{void saveDraft().catch(reason=>{if(current())setDraftNotice(`Draft could not be saved: ${reason.message}`);});},600);
    return()=>clearTimeout(timer);
  },[title,source,audienceType,crewId,workerIds,responseMode,deliveryMode,draftLoaded,pending,result]);
  useEffect(()=>{
    const guard=(next:string,resume?:()=>void)=>{if(attachmentBusy){setError('Wait for the attachment to finish uploading.');return false;}if(approvedNext.current===next){approvedNext.current=null;return true;}if(pending||result||!contentRef.current.source&&!contentRef.current.title)return true;void saveDraft().then(()=>{approvedNext.current=next;if(resume)resume();else navigate(next);}).catch(reason=>{if(current())setError(`Save draft before leaving: ${reason.message}`);});return false;};
    navigationGuard.current=guard;return()=>{if(navigationGuard.current===guard)navigationGuard.current=null;};
  },[pending,result,current,request,attachmentBusy]);
  useEffect(()=>{if(voiceOpen)voiceDialog.current?.showModal();},[voiceOpen]);
  function closeVoice(){voiceDialog.current?.close();setVoiceOpen(false);}

  useEffect(()=>{
    const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;
    request<AudienceOverview>('/api/instructions/audience',undefined,controller.signal)
      .then(value=>{if(live()){setAudience(value);setAudienceError('');}})
      .catch(reason=>{if(live() && !(reason instanceof StaffRequestError && reason.fenced))setAudienceError(reason instanceof Error?reason.message:'Audience unavailable');});
    return()=>controller.abort();
  },[request,current]);

  useEffect(()=>{
    const waiting=result && (result.state==='preparing' || (result.deliveryStates?.preparing ?? 0)>0);
    if(!waiting || sending.current)return;
    let cancelled=false;
    let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      await checkStatus(result.requestId);
      if(!cancelled && current())timer=setTimeout(()=>void poll(),3000);
    };
    timer=setTimeout(()=>void poll(),3000);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[result?.requestId,result?.state,result?.deliveryStates?.preparing]);

  useEffect(()=>{
    if(result?.state==='published' && !sentNotice.current){sentNotice.current=true;onSent();}
  },[result?.state,onSent]);

  function reset(){
    requestId.current=crypto.randomUUID();hasSavedDraft.current=false;setWorkerIds([]);setDraftNotice('');setDraftLoaded(true);history.replaceState(null,'',`${location.pathname}${location.search}#send/${requestId.current}`);
    clearPending(scope);setPending(null);setResult(null);setRetryReceipt(null);setError('');
    setSource('');setTitle('');setAudienceType('all');setCrewId('');setResponseMode('question');setDeliveryMode('both');
    sentNotice.current=false;
  }

  async function checkStatus(id=requestId.current){
    if(sending.current || !current())return;
    sending.current=true;setBusy(true);setError('');
    try {
      const value=await request<SendResult>(`/api/instructions/sends/${encodeURIComponent(id)}`);
      if(!current())return;
      setResult(value);
      if(value.state==='published' || value.state==='failed'){
        if(pending?.requestId===id || pending===null)clearPending(scope);
        setPending(null);
      }
      if(value.state==='failed')setError(value.error || 'The instruction could not be sent.');
    }catch(reason){
      if(!current())return;
      if(reason instanceof StaffRequestError && reason.status===404){
        clearPending(scope);setPending(null);setResult(null);setError('');
        setError('No send was recorded. Review the instruction and send again.');
      }else setError(reason instanceof Error?reason.message:'Send status unavailable.');
    }finally{sending.current=false;setBusy(false);}
  }

  async function submit(){
    if(!canSubmit || sending.current || !current())return;
    const value:PendingSend={requestId:requestId.current,title:effectiveTitle,source:trimmedSource,audience:audienceChoice,responseMode,deliveryMode,savedAt:Date.now()};
    try{savePending(scope,value);}catch(reason){setError((reason as Error).message);return;}
    sending.current=true;setBusy(true);setError('');setPending(value);
    try {
      const sent=await request<SendResult>('/api/instructions/send',{
        requestId:value.requestId,title:value.title,source:value.source,audience:value.audience,responseMode:value.responseMode,deliveryMode:value.deliveryMode,
      });
      if(!current())return;
      setResult(sent);
      try{sessionStorage.removeItem(localKey);}catch{}
      if(sent.state==='published' || sent.state==='failed'){clearPending(scope);setPending(null);}
      if(sent.state==='failed')setError(sent.error || 'The instruction could not be sent.');
    }catch(reason){
      if(!current())return;
      const uncertain=reason instanceof StaffRequestError && reason.uncertain;
      if(!uncertain){clearPending(scope);setPending(null);}
      setError(reason instanceof Error?reason.message:'The send outcome is not confirmed.');
    }finally{sending.current=false;setBusy(false);}
  }

  async function retryUndelivered(){
    if(!result || sending.current || !current())return;
    sending.current=true;setBusy(true);setError('');
    try {
      const retried=await request<SendResult>(`/api/instructions/sends/${encodeURIComponent(result.requestId)}/retry`,{requestId:crypto.randomUUID()});
      if(!current())return;
      setResult(retried);
      setRetryReceipt({requestId:retried.retryRequestId || '',retried:retried.retried ?? 0,released:retried.released ?? 0});
    }catch(reason){
      if(!current())return;
      setError(reason instanceof Error?reason.message:'The retry could not be recorded.');
    }finally{sending.current=false;setBusy(false);}
  }

  if(result) {
    const partial=result.state==='published' && result.undelivered>0;
    return <><div className="page-header"><div><h1>{result.state==='failed'?'Instruction not sent':partial?'Instruction partly sent':'Instruction sent'}</h1><p>{result.state==='preparing'?'Preparation is still running. This page checks again automatically.':partial?'The ready language versions were delivered. Not every selected worker could receive this instruction.':'The send is recorded. Recipient status is available in the instruction.'}</p></div><button className="button outline" onClick={()=>navigate('briefings')}><ArrowLeft size={19}/>{tr("Instructions")}</button></div>
      {error && <div className="notice notice-amber" role="alert">{error}</div>}
      {result.state==='published' && <section className="panel send-result" aria-labelledby="send-result-title">
        <div className={`receipt-mark${partial?' receipt-mark-partial':''}`} aria-hidden="true">{partial?<AlertTriangle size={42}/>:<CheckCircle2 size={42}/>}</div>
        <h2 id="send-result-title">{partial?'Partly sent':result.duplicate?'Send already recorded':'Send recorded'}</h2>
        <dl className="worker-receipt-meta">
          <div><dt>Delivery</dt><dd>{result.responseMode==='acknowledge'?'Acknowledge receipt':'Question and answer'}</dd></div>
          <div><dt>Format</dt><dd>{result.deliveryMode==='both'?'Text and voice':result.deliveryMode==='voice'?'Voice':'Text'}</dd></div>
          <div><dt>Delivered</dt><dd>{result.delivered} {tr("of")} {result.audience.count}</dd></div>
          {result.undelivered>0 && <div><dt>Not delivered</dt><dd>{result.undelivered}</dd></div>}
          {!!result.deliveryStates?.preparing && <div><dt>Still preparing</dt><dd>{result.deliveryStates.preparing}</dd></div>}
        </dl>
        {retryReceipt && <div className="notice" role="status"><strong>Retry recorded.</strong> {retryReceipt.retried} unfinished {retryReceipt.retried===1?'delivery was':'deliveries were'} rechecked{retryReceipt.released>0?` and ${retryReceipt.released} ${retryReceipt.released===1?'recipient now has':'recipients now have'} this instruction`:''}.</div>}
        {result.undelivered>0 && <div className="notice notice-amber" role="status"><strong>Partly sent.</strong> {result.undelivered} {tr("of")} {result.audience.count} selected workers did not receive this instruction.<ul className="send-reasons">{result.undeliveredReasons.map((reason,index)=><li key={`${reason.reason}:${reason.language}:${index}`}>{reasonText(reason)} · {reason.count}</li>)}</ul>
          {result.retryable && <div className="actions"><button className="button primary" disabled={busy} onClick={()=>void retryUndelivered()}><RefreshCw size={19}/>{busy?'Retrying...':'Retry undelivered'}</button></div>}
        </div>}
        <div className="actions"><button className="button primary" onClick={()=>navigate(`briefings/${result.briefingId}`)}>Open instruction<ChevronRight size={19}/></button><button className="button outline" disabled={busy} onClick={reset}><Send size={19}/>Send another</button></div>
      </section>}
      {result.state==='preparing' && <section className="panel send-result" aria-live="polite"><h2>Preparing instruction</h2><p>Content and language versions are being prepared. This does not block the screen; the status will refresh automatically.</p><div className="actions"><button className="button primary" disabled={busy} onClick={()=>void checkStatus(result.requestId)}><RefreshCw size={19}/>{busy?'Checking...':'Check status'}</button><button className="button outline" disabled={busy} onClick={()=>navigate('briefings')}>View instructions</button></div></section>}
      {result.state==='failed' && <section className="panel send-result"><p>No instruction was delivered. {result.error || 'Review the source and try again.'}</p><div className="actions"><button className="button primary" disabled={busy} onClick={reset}><Send size={19}/>Start again</button><button className="button outline" onClick={()=>navigate('briefings')}>{tr("Instructions")}</button></div></section>}
    </>;
  }

  return <>
    <div className="page-header"><div><h1>{tr("Send an instruction")}</h1><p>{tr("Write or record your instruction, choose recipients, and send.")}</p></div><button className="button outline" onClick={()=>navigate('briefings')}><ArrowLeft size={19}/>{tr("Instructions")}</button></div>
    <dialog ref={voiceDialog} className="worker-form-dialog" aria-label={tr("Record instruction")} onCancel={event=>{event.preventDefault();closeVoice();}}>{voiceOpen&&<VoiceTranscript authority={authority} title={title} onClose={closeVoice} replacing={!!source.trim()} onApproved={text=>{setSource(text);closeVoice();}}/>}</dialog>

    {recovery.error&&<div className="notice notice-amber" role="alert">{recovery.error}</div>}
    {pending && !error && <div className="notice notice-amber" role="status"><strong>An earlier send was not confirmed.</strong> Check its receipt before sending again. <button className="button outline" disabled={busy} onClick={()=>void checkStatus(pending.requestId)}><RefreshCw size={18}/>Check receipt</button></div>}
    {pending && error && <div className="notice notice-amber" role="status"><strong>Send outcome not confirmed.</strong> The original request is retained. Check its receipt rather than repeating it. <div className="actions"><button className="button outline" disabled={busy} onClick={()=>void checkStatus(pending.requestId)}><RefreshCw size={18}/>Check receipt</button><button className="button outline" disabled={busy} onClick={reset}>Discard request</button></div></div>}
    {error && !pending && <div className="notice notice-amber" role="alert">{error}</div>}
    <section className="panel send-composer" aria-labelledby="send-source-title">
      <label className="field" htmlFor="send-title"><span>{tr("Title")} <span aria-hidden="true">*</span></span>
        <input id="send-title" name="title" type="text" required minLength={3} maxLength={titleMax}
          value={title} disabled={busy || !!pending || !draftLoaded} onChange={event=>setTitle(event.target.value)} placeholder="Give this instruction a clear title" />
      </label>
      <label className="field send-source-field" htmlFor="send-source"><span id="send-source-title">{tr("Instruction")}</span>
        <textarea id="send-source" aria-describedby="send-source-count" rows={7} maxLength={sourceMax} value={source} disabled={busy || !!pending || !draftLoaded} onChange={event=>setSource(event.target.value)} placeholder="Example: Move the red ladder to the north bay before the night shift. Keep the walkway clear." />
      </label>
      <div className="send-source-toolbar">
        <div className="send-record-actions"><button type="button" className="button outline" disabled={busy||!!pending||!draftLoaded} onClick={()=>setVoiceOpen(true)}><Mic size={18}/>{tr("Record")}</button>{draftNotice&&<span className="muted send-draft-status" role="status">{draftNotice}</span>}</div>
        <p id="send-source-count" className="muted send-counter">{trimmedSource.length < sourceMin ? tr('At least 10 characters.') : <><bdi>{trimmedSource.length} / {sourceMax}</bdi> {tr('characters')}</>}</p>
      </div>
      <label className="field">{tr("Who should receive it?")}
        <select value={audienceType} disabled={busy || !!pending || !draftLoaded} onChange={event=>setAudienceType(event.target.value as 'all'|'crew'|'members')}>
          <option value="all">{tr("All active workers")}</option><option value="crew">{tr("Crews")}</option><option value="members">{tr("Members")}</option>
        </select>
      </label>
      {audienceType==='crew'&&<label className="field">{tr("Choose crew")}<select value={crewId} disabled={busy||!!pending} onChange={event=>setCrewId(event.target.value)}><option value="">{tr("Select crew")}</option>{audience?.crews.map(crew=><option key={crew.id} value={crew.id}>{crew.name} ({crew.members})</option>)}</select></label>}
      {audienceType==='members'&&<RecipientMembers members={audience?.members||[]} selected={workerIds} onChange={setWorkerIds} disabled={busy||!!pending}/>}

      {selectedAudience && <div className="language-chips send-audience-languages" aria-label="Worker languages">{Object.entries(selectedAudience.byLanguage || {}).filter(([,count])=>count>0).map(([code,count])=><i key={code}>{code.toUpperCase()} {count}</i>)}</div>}
      {!!selectedAudience?.notSelected && <p className="notice notice-amber" role="status">{selectedAudience.notSelected} active workers in this audience still need a language selected in Team before sending.</p>}
      {audienceError && <p className="notice notice-amber" role="alert">{audienceError}</p>}
      {selectedAudience && selectedAudience.total===0 && <p className="notice notice-amber" role="status">There are no workers with a selected language in this audience.</p>}

      <AttachmentComposer key={requestId.current} authority={authority} requestId={requestId.current} disabled={busy||!!pending||!draftLoaded} saveDraft={saveDraft} onBusy={setAttachmentBusy}/>

      <div className="send-option-grid">
        <label className="send-toggle">
          <input type="checkbox" checked={responseMode==='question'} disabled={busy || !!pending || !draftLoaded} onChange={event=>setResponseMode(event.target.checked?'question':'acknowledge')}/>
          <span><strong>{tr("Include a question")}</strong><small>{responseMode==='question'?'Workers select one instruction-specific answer. Correct answers and answers needing clarification appear in your response report.':'Workers confirm receipt only. No answer or comprehension result is created.'}</small></span>
        </label>
        <fieldset className="send-delivery" disabled={busy || !!pending || !draftLoaded}>
          <legend>{tr("Delivery format")}</legend>
          <div className="segmented send-delivery-options">
            {(['text','voice','both'] as Delivery[]).map(mode=><button type="button" key={mode} className={deliveryMode===mode?'selected':''} aria-pressed={deliveryMode===mode} onClick={()=>setDeliveryMode(mode)}>{mode==='text'?tr("Text only"):mode==='voice'?tr("Voice only"):tr("Both")}</button>)}
          </div>
        </fieldset>
      </div>



      <div className="send-submit">
        <span className="muted"><Users size={17}/> {audience?"Recipients are resolved when you send; later joiners are not added automatically.":'Loading recipients...'}</span>
        <button className="button primary" disabled={!canSubmit||!draftLoaded} onClick={()=>void submit()}>{busy?'Sending...':<><Send size={20}/>{tr("Send instruction")}</>}</button>
      </div>
      {!titleValid && trimmedSource.length>=sourceMin && <p className="notice notice-amber" role="status">Add a title of at least 3 characters.</p>}
      {trimmedSource.length>sourceMax && <p className="notice notice-amber" role="status">The instruction must be {sourceMax} characters or fewer.</p>}
    </section>
  </>;
}
