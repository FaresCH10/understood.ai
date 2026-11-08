import {keepDialogFocus} from './dialog-focus';
import {MobileDisclosure} from './MobileDisclosure';
import {useStaffText as useStaffStaticText} from './staff-language';
import {useStaffText} from './staff-language';
import RecipientMembers from './RecipientMembers';
import VoiceTranscript from './VoiceTranscript';
import {AttachmentComposer} from './InstructionFiles';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {AlertTriangle,ArrowLeft,CheckCircle2,ChevronRight,Circle,FileText,Mic,RefreshCw,Send,Users} from 'lucide-react';
import type {StaffRequestAuthority} from './useStaffRequest';
import {useStaffRequest} from './useStaffRequest';
import {StaffRequestError} from './staff-request';

type Mode='question'|'acknowledge';
type Delivery='text'|'voice'|'both';
type EvidenceMode='none'|'photo';
type AudienceChoice={type:'all'}|{type:'crew';crewId:string}|{type:'members';workerIds:string[]};
type AudienceOverview={members:{id:string;code:string;name:string|null;language:string;language_selection_required:boolean|number}[];workers:{total:number;byLanguage:Record<string,number>;notSelected?:number};crews:{id:string;name:string;members:number;byLanguage:Record<string,number>;notSelected:number}[]};
type UndeliveredReason={reason:string;language?:string;count:number};
type DeliveryStates={preparing:number;available:number;blocked:number;failed:number;withdrawn:number};
type SendResult={requestId:string;briefingId:string;state:'preparing'|'published'|'failed';responseMode:Mode;deliveryMode:Delivery;evidenceMode?:EvidenceMode;
  audience:{type:string;count:number;crewId?:string};delivered:number;undelivered:number;undeliveredReasons:UndeliveredReason[];
  deliveryStates?:DeliveryStates|null;retryable?:boolean;retryRequestId?:string;retried?:number;released?:number;
  publicationId:string|null;error:string|null;duplicate:boolean};
type PendingSend={requestId:string;title:string;source:string;audience:AudienceChoice;responseMode:Mode;deliveryMode:Delivery;evidenceMode:EvidenceMode;savedAt:number};
const evidenceFor=(mode:Mode,evidence:unknown):EvidenceMode=>mode==='acknowledge'&&evidence==='photo'?'photo':'none';

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
      || !['none','photo'].includes(value.evidenceMode ?? 'none') || !validAudience(value.audience))throw Error();
    return {requestId:value.requestId,title:value.title.slice(0,titleMax),source:value.source,audience:value.audience,
      responseMode:value.responseMode,deliveryMode:value.deliveryMode,evidenceMode:evidenceFor(value.responseMode,value.evidenceMode),savedAt:Number(value.savedAt)||0};
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
function sameSend(a:PendingSend,b:PendingSend){
  return a.title===b.title && a.source===b.source && a.responseMode===b.responseMode
    && a.deliveryMode===b.deliveryMode && a.evidenceMode===b.evidenceMode
    && JSON.stringify(a.audience)===JSON.stringify(b.audience);
}
export function derivedInstructionTitle(source:string){
  const clean=source.normalize('NFKC').replace(/\s+/g,' ').trim();
  if(clean.length<3)return '';
  const sentence=clean.split(/(?<=[.!?])\s/)[0] || clean;
  return (sentence.length>120 ? `${sentence.slice(0,117).trimEnd()}…` : sentence).slice(0,titleMax);
}
function reasonText(reason:UndeliveredReason){
  const language=reason.language?new Intl.DisplayNames(['en'],{type:'language'}).of(reason.language)||reason.language:'';
  if(reason.reason==='language_unavailable')return `${language || 'Language'} version not ready`;
  if(reason.reason==='content_unavailable')return `${language || 'Language'} text not ready`;
  if(reason.reason==='question_unavailable')return `${language || 'Language'} question not ready`;
  if(reason.reason==='speech_unavailable')return `${language || 'Language'} voice not ready`;
  if(reason.reason==='worker_inactive')return `${language ? `${language} ` : ''}worker no longer active`;
  return `${reason.reason.replaceAll('_',' ')}${language?` · ${language}`:''}`;
}

export default function SendInstruction({authority,scope,navigate,onSent,draftId,initialCrewId,navigationGuard}:{initialCrewId?:string;draftId?:string;navigationGuard:RefObject<((next:string,resume?:()=>void)=>boolean)|null>;authority:StaffRequestAuthority;scope:string|null;navigate:(path:string)=>void;onSent:()=>void}){
  const staffT=useStaffStaticText();
 const tr=useStaffText();
  const {request,current}=useStaffRequest(authority);
  const [mobileStep,setMobileStep]=useState(0);
  const [recovery]=useState(()=>{try{return {pending:readPending(scope),error:''};}catch(error){return {pending:null,error:(error as Error).message};}});
  const restoredPending=recovery.pending;
  const [pending,setPending]=useState<PendingSend|null>(restoredPending);
  const [source,setSource]=useState(restoredPending?.source || '');
  const [title,setTitle]=useState(restoredPending?.title || '');
  const [audienceType,setAudienceType]=useState<'all'|'crew'|'members'>(restoredPending?.audience.type || (initialCrewId?'crew':'all'));
  const [crewId,setCrewId]=useState(restoredPending?.audience.type==='crew'?restoredPending.audience.crewId:(initialCrewId || ''));
  const [workerIds,setWorkerIds]=useState<string[]>(restoredPending?.audience.type==='members'?restoredPending.audience.workerIds:[]);
  const [responseMode,setResponseMode]=useState<Mode>(restoredPending?.responseMode || 'question');
  const [deliveryMode,setDeliveryMode]=useState<Delivery>(restoredPending?.deliveryMode || 'both');
  const [evidenceMode,setEvidenceMode]=useState<EvidenceMode>(restoredPending?.evidenceMode || 'none');
  const [audience,setAudience]=useState<AudienceOverview|null>(null);
  const [audienceError,setAudienceError]=useState('');
  const [readiness,setReadiness]=useState<{mode:string;textLanguages:string[];speechLanguages:string[]}|null>(null);
  const [readinessError,setReadinessError]=useState('');

  const [audienceLoading,setAudienceLoading]=useState(false),[audienceRevision,setAudienceRevision]=useState(0);
  const leaveDialog=useRef<HTMLDialogElement>(null),leaveRequest=useRef<{next:string;resume?:()=>void}|null>(null);
  const [leaveOpen,setLeaveOpen]=useState(false);
  useEffect(()=>{if(leaveOpen)leaveDialog.current?.showModal();else leaveDialog.current?.close();},[leaveOpen]);
  const [result,setResult]=useState<SendResult|null>(null);
  const [retryReceipt,setRetryReceipt]=useState<{requestId:string;retried:number;released:number}|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false),[attachmentBusy,setAttachmentBusy]=useState(false);
  const requestId=useRef(restoredPending?.requestId || draftId || crypto.randomUUID());
  const discarded=useRef<PendingSend|null>(null);
  const sending=useRef(false);
  const sentNotice=useRef(false);
  useEffect(()=>{const controller=new AbortController();setReadiness(null);setReadinessError('');const timer=setTimeout(()=>{request<{mode:string;textLanguages:string[];speechLanguages:string[]}>('/api/instructions/readiness',{source},controller.signal).then(value=>{if(!controller.signal.aborted&&current())setReadiness(value);}).catch(()=>{if(!controller.signal.aborted&&current())setReadinessError('Preparation readiness could not be checked. Refresh recipients to retry.');});},400);return()=>{clearTimeout(timer);controller.abort();};},[source,audienceRevision,request,current]);
  const trimmedSource=source.trim();
  const effectiveTitle=title.trim().slice(0,titleMax);
  const audienceChoice:AudienceChoice=audienceType==='crew'?{type:'crew',crewId}:audienceType==='members'?{type:'members',workerIds:[...workerIds].sort()}:{type:'all'};
  const selectedCrew=audienceType==='crew'?audience?.crews.find(crew=>crew.id===crewId):null;
  const selectedMembers=audience?.members?.filter(member=>workerIds.includes(member.id))||[];
  const selectedAudience=audienceType==='members'?{total:selectedMembers.filter(member=>!member.language_selection_required).length,notSelected:selectedMembers.filter(member=>member.language_selection_required).length,byLanguage:selectedMembers.reduce<Record<string,number>>((counts,member)=>{counts[member.language]=(counts[member.language]||0)+1;return counts;},{})}:audienceType==='all'?audience?.workers:selectedCrew?{total:selectedCrew.members,byLanguage:selectedCrew.byLanguage,notSelected:selectedCrew.notSelected}:null;
  const unavailableLanguages=selectedAudience?Object.keys(selectedAudience.byLanguage||{}).filter(code=>(selectedAudience.byLanguage[code]||0)>0&&(!readiness?.textLanguages.includes(code)||(deliveryMode!=='text'&&!readiness?.speechLanguages.includes(code)))):[];
  const titleValid=effectiveTitle.length>=3;
  const canSubmit=trimmedSource.length>=sourceMin && trimmedSource.length<=sourceMax && titleValid
    && !!selectedAudience && selectedAudience.total>0 && !selectedAudience.notSelected && !!readiness && !readinessError && !unavailableLanguages.length && !audienceLoading && !audienceError && !busy && !attachmentBusy && !pending && !recovery.error;
  const sourceIssue=trimmedSource.length<sourceMin?'short':trimmedSource.length>sourceMax?'long':'';
  const audienceReady=!!selectedAudience && selectedAudience.total>0 && !selectedAudience.notSelected;
  const audienceHint=audienceType==='crew'&&!selectedCrew?staffT("Select a crew to continue."):selectedAudience?.notSelected?staffT("Select a language for every worker in this audience."):selectedAudience?staffT("Choose at least one worker with a selected language."):staffT("Loading recipients...");

  const voiceDialog=useRef<HTMLDialogElement>(null),[voiceOpen,setVoiceOpen]=useState(false);
  const [draftLoaded,setDraftLoaded]=useState(!draftId),[draftReady,setDraftReady]=useState(!!restoredPending),[draftNotice,setDraftNotice]=useState('');
  const showRequirements=!canSubmit && draftLoaded && !busy && !pending && !recovery.error;
  const saveQueue=useRef(Promise.resolve()),approvedNext=useRef<string|null>(null),hasSavedDraft=useRef(false);
  const contentRef=useRef({title,source,audience:audienceChoice,responseMode,deliveryMode,evidenceMode});contentRef.current={title,source,audience:audienceChoice,responseMode,deliveryMode,evidenceMode};
  const localKey=`understood:composition:${scope}:${requestId.current}`;
  useEffect(()=>{
    if(restoredPending){setDraftLoaded(true);return;}
    let active=true;
    if(draftId){request<{content:typeof contentRef.current|null}>(`/api/workspace/drafts/${draftId}`).then(value=>{if(active&&current()&&value.content){const c=value.content;hasSavedDraft.current=true;setDraftReady(true);setTitle(c.title);setSource(c.source);setResponseMode(c.responseMode);setDeliveryMode(c.deliveryMode);setEvidenceMode(evidenceFor(c.responseMode,c.evidenceMode));setAudienceType(c.audience.type);if(c.audience.type==='crew')setCrewId(c.audience.crewId);if(c.audience.type==='members')setWorkerIds(c.audience.workerIds);}}).catch(reason=>{if(active&&current()){try{const raw=sessionStorage.getItem(localKey),saved=raw?JSON.parse(raw):null;if(saved?.id===draftId&&saved.content){setTitle(saved.content.title||'');setSource(saved.content.source||'');setResponseMode(saved.content.responseMode||'question');setDeliveryMode(saved.content.deliveryMode||'both');setEvidenceMode(evidenceFor(saved.content.responseMode,saved.content.evidenceMode));if(validAudience(saved.content.audience)){setAudienceType(saved.content.audience.type);if(saved.content.audience.type==='crew')setCrewId(saved.content.audience.crewId);if(saved.content.audience.type==='members')setWorkerIds(saved.content.audience.workerIds);}}}catch{}setError(reason.message);}}).finally(()=>{if(active)setDraftLoaded(true);});}

    return()=>{active=false;};
  },[]);
  async function saveDraft(){
    if(!current()||pending||result)return;
    const content={...contentRef.current},id=requestId.current;
    if(!content.source&&!content.title&&!hasSavedDraft.current)return;
    const task=saveQueue.current.catch(()=>{}).then(async()=>{await request(`/api/workspace/drafts/${id}`,content,undefined,'POST');if(current()){hasSavedDraft.current=true;setDraftReady(true);setDraftNotice('Draft saved');setError(previous=>previous.startsWith('Save draft before leaving:')?'':previous);}});saveQueue.current=task;await task;
  }
  useEffect(()=>{
    if(!draftLoaded||pending||result)return;
    try{sessionStorage.setItem(localKey,JSON.stringify({id:requestId.current,content:contentRef.current}));}catch{setDraftNotice('Browser draft storage unavailable.');}
    if((source||title)&&location.hash==='#send')history.replaceState(null,'',`${location.pathname}${location.search}#send/${requestId.current}`);
    const timer=setTimeout(()=>{void saveDraft().catch(reason=>{if(current())setDraftNotice(`Draft could not be saved: ${reason.message}`);});},600);
    return()=>clearTimeout(timer);
  },[title,source,audienceType,crewId,workerIds,responseMode,deliveryMode,evidenceMode,draftLoaded,pending,result]);
  useEffect(()=>{
    const guard=(next:string,resume?:()=>void)=>{if(attachmentBusy){setError('Wait for the attachment to finish uploading.');return false;}if(approvedNext.current===next){approvedNext.current=null;return true;}if(pending||result||!contentRef.current.source&&!contentRef.current.title)return true;void saveDraft().then(()=>{approvedNext.current=next;if(resume)resume();else navigate(next);}).catch(reason=>{if(current()){setError(`Save draft before leaving: ${reason.message}`);leaveRequest.current={next,resume};setLeaveOpen(true);}});return false;};
    navigationGuard.current=guard;return()=>{if(navigationGuard.current===guard)navigationGuard.current=null;};
  },[pending,result,current,request,attachmentBusy]);
  useEffect(()=>{if(voiceOpen)voiceDialog.current?.showModal();},[voiceOpen]);
  function closeVoice(){voiceDialog.current?.close();setVoiceOpen(false);}

  useEffect(()=>{
    const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;
    setAudienceLoading(true);
    request<AudienceOverview>('/api/instructions/audience',undefined,controller.signal)
      .then(value=>{if(live()){setAudience(value);setAudienceError('');}})
      .catch(reason=>{if(live() && !(reason instanceof StaffRequestError && reason.fenced))setAudienceError(reason instanceof Error?reason.message:'Audience unavailable');}).finally(()=>{if(live())setAudienceLoading(false);});
    return()=>controller.abort();
  },[request,current,audienceRevision]);

  useEffect(()=>{const update=()=>{if(document.visibilityState==='visible')setAudienceRevision(value=>value+1);};window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);return()=>{window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};},[]);

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
    requestId.current=crypto.randomUUID();discarded.current=null;hasSavedDraft.current=false;setDraftReady(false);setWorkerIds([]);setDraftNotice('');setDraftLoaded(true);history.replaceState(null,'',`${location.pathname}${location.search}#send/${requestId.current}`);
    clearPending(scope);setPending(null);setResult(null);setRetryReceipt(null);setError('');
    setSource('');setTitle('');setAudienceType('all');setCrewId('');setResponseMode('question');setDeliveryMode('both');setEvidenceMode('none');
    sentNotice.current=false;
  }
  function discardPending(){
    if(pending)discarded.current=pending;
    clearPending(scope);setPending(null);setError('');
  }
  function currentValue(id=requestId.current):PendingSend{
    return {requestId:id,title:effectiveTitle,source:trimmedSource,audience:audienceChoice,responseMode,deliveryMode,evidenceMode,savedAt:Date.now()};
  }

  async function checkStatus(id=requestId.current){
    if(sending.current || !current())return;
    sending.current=true;setBusy(true);setError('');
    try {
      const value=await request<SendResult>(`/api/instructions/sends/${encodeURIComponent(id)}`);
      if(!current())return;
      setResult(value);
      if(!pending || pending.requestId===id){clearPending(scope);setPending(null);}
      if(value.state==='failed')setError(value.error || 'The instruction could not be sent.');
    }catch(reason){
      if(!current())return;
      if(reason instanceof StaffRequestError && reason.status===404){
        if(pending?.requestId===id)discarded.current=pending;
        clearPending(scope);setPending(null);setResult(null);setError('');
        setError('No send was recorded. Review the instruction and send again.');
      }else setError(reason instanceof Error?reason.message:'Send status unavailable.');
    }finally{sending.current=false;setBusy(false);}
  }

  async function sendValue(value:PendingSend){
    sending.current=true;setBusy(true);setError('');setPending(value);
    try {
      const sent=await request<SendResult>('/api/instructions/send',{
        requestId:value.requestId,title:value.title,source:value.source,audience:value.audience,responseMode:value.responseMode,deliveryMode:value.deliveryMode,evidenceMode:value.evidenceMode,
      });
      if(!current())return;
      setResult(sent);
      try{sessionStorage.removeItem(localKey);}catch{}
      clearPending(scope);setPending(null);
      if(sent.state==='failed')setError(sent.error || 'The instruction could not be sent.');
    }catch(reason){
      if(!current())return;
      const uncertain=reason instanceof StaffRequestError && reason.uncertain;
      if(!uncertain){clearPending(scope);setPending(null);}
      setError(reason instanceof Error?reason.message:'The send outcome is not confirmed.');
    }finally{sending.current=false;setBusy(false);}
  }

  async function retryPending(){
    if(!pending || sending.current || !current())return;
    discarded.current=null;
    await sendValue(pending);
  }

  async function submit(){
    if(!canSubmit || sending.current || !current())return;
    let value=currentValue();
    if(discarded.current && !sameSend(discarded.current,value)){
      requestId.current=crypto.randomUUID();
      history.replaceState(null,'',`${location.pathname}${location.search}#send/${requestId.current}`);
      value=currentValue();
    }
    discarded.current=null;
    try{savePending(scope,value);}catch(reason){setError((reason as Error).message);return;}
    await sendValue(value);
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
    return <><div className="page-header"><div><h1>{result.state==='failed'?staffT("Instruction not sent"):partial?staffT("Instruction partly sent"):staffT("Instruction sent")}</h1><p>{result.state==='preparing'?staffT("Preparation is still running. This page checks again automatically."):partial?staffT("The ready language versions were delivered. Not every selected worker could receive this instruction."):staffT("The send is recorded. Recipient status is available in the instruction.")}</p></div><button className="button outline" onClick={()=>navigate('briefings')}><ArrowLeft size={19}/>{tr("Instructions")}</button></div>
      {error && <div className="notice notice-amber" role="alert">{staffT.error(error)}</div>}
      {result.state==='published' && <section className="panel send-result" aria-labelledby="send-result-title">
        <div className={`receipt-mark${partial?' receipt-mark-partial':''}`} aria-hidden="true">{partial?<AlertTriangle size={42}/>:<CheckCircle2 size={42}/>}</div>
        <h2 id="send-result-title">{partial?staffT("Partly sent"):result.duplicate?staffT("Send already recorded"):staffT("Send recorded")}</h2>
        <dl className="worker-receipt-meta">
          <div><dt>{staffT("Delivery")}</dt><dd>{result.responseMode==='acknowledge'?staffT("Acknowledge receipt"):staffT("Question and answer")}</dd></div>
          <div><dt>{staffT("Format")}</dt><dd>{result.deliveryMode==='both'?staffT("Text and voice"):result.deliveryMode==='voice'?staffT("Voice"):staffT("Text")}</dd></div>
          {result.evidenceMode==='photo' && <div><dt>{staffT("Evidence")}</dt><dd>{staffT("Photo required")}</dd></div>}
          <div><dt>{staffT("Delivered")}</dt><dd>{result.delivered} {tr("of")} {result.audience.count}</dd></div>
          {result.undelivered>0 && <div><dt>{staffT("Not delivered")}</dt><dd>{result.undelivered}</dd></div>}
          {!!result.deliveryStates?.preparing && <div><dt>{staffT("Still preparing")}</dt><dd>{result.deliveryStates.preparing}</dd></div>}
        </dl>
        {retryReceipt && <div className="notice" role="status"><strong>{staffT("Retry recorded.")}</strong> {retryReceipt.retried} {staffT("unfinished")} {retryReceipt.retried===1?staffT("delivery was"):staffT("deliveries were")} {staffT("rechecked")}{retryReceipt.released>0?staffT(" and {p0} {p1} this instruction",{p0:retryReceipt.released,p1:retryReceipt.released===1?'recipient now has':'recipients now have'}):''}.</div>}
        {result.undelivered>0 && <div className="notice notice-amber" role="status"><strong>{staffT("Partly sent.")}</strong> {result.undelivered} {tr("of")} {result.audience.count} {staffT("selected workers did not receive this instruction.")}<ul className="send-reasons">{result.undeliveredReasons.map((reason,index)=><li key={`${reason.reason}:${reason.language}:${index}`}>{reasonText(reason)} · {reason.count}</li>)}</ul>
          {result.retryable && <div className="actions"><button className="button primary" disabled={busy} onClick={()=>void retryUndelivered()}><RefreshCw size={19}/>{busy?staffT("Retrying..."):staffT("Retry undelivered")}</button></div>}
        </div>}
        <div className="actions"><button className="button primary" onClick={()=>navigate(`briefings/${result.briefingId}`)}>{staffT("Open instruction")}<ChevronRight size={19}/></button><button className="button outline" disabled={busy} onClick={reset}><Send size={19}/>{staffT("Send another")}</button></div>
      </section>}
      {result.state==='preparing' && <section className="panel send-result" aria-live="polite"><h2>{staffT("Preparing instruction")}</h2><p>{staffT("Content and language versions are being prepared. This does not block the screen; the status will refresh automatically.")}</p><div className="actions"><button className="button primary" disabled={busy} onClick={()=>void checkStatus(result.requestId)}><RefreshCw size={19}/>{busy?staffT("Checking..."):staffT("Check status")}</button><button className="button outline" disabled={busy} onClick={()=>navigate('briefings')}>{staffT("View instructions")}</button></div></section>}
      {result.state==='failed' && <section className="panel send-result"><p>{staffT("No instruction was delivered.")} {((result.error?staffT.error(result.error):staffT("Review the source and try again.")))}</p><div className="actions"><button className="button primary" disabled={busy} onClick={reset}><Send size={19}/>{staffT("Start again")}</button><button className="button outline" onClick={()=>navigate('briefings')}>{tr("Instructions")}</button></div></section>}
    </>;
  }

  return <>
    <div className="page-header"><div><h1>{tr("Send an instruction")}</h1><p>{tr("Write or record your instruction, choose recipients, and send.")}</p></div><button className="button outline" onClick={()=>navigate('briefings')}><ArrowLeft size={19}/>{tr("Instructions")}</button></div>
    <dialog ref={leaveDialog} className="withdraw-dialog" aria-labelledby="composer-leave-title" onKeyDown={keepDialogFocus} onCancel={()=>setLeaveOpen(false)}><h2 id="composer-leave-title">{staffT.locale==='ar'?'تعذّر حفظ المسودة':'Draft could not be saved'}</h2><p>{staffT.locale==='ar'?'يمكنك البقاء وإعادة المحاولة، أو المغادرة دون حفظ التغييرات الأخيرة.':'Stay and retry saving, or leave without saving the latest changes. Previously saved drafts are retained.'}</p><div className="actions"><button className="button outline" autoFocus onClick={()=>setLeaveOpen(false)}>{staffT.locale==='ar'?'البقاء':'Keep working'}</button><button className="button primary" onClick={()=>{const target=leaveRequest.current;if(!target)return;try{sessionStorage.removeItem(localKey);}catch{}approvedNext.current=target.next;setLeaveOpen(false);if(target.resume)target.resume();else navigate(target.next);}}>{staffT.locale==='ar'?'المغادرة دون حفظ':'Discard and leave'}</button></div></dialog>
    <dialog ref={voiceDialog} className="worker-form-dialog" aria-label={tr("Record instruction")} onCancel={event=>{event.preventDefault();closeVoice();}}>{voiceOpen&&<VoiceTranscript authority={authority} title={title} onClose={closeVoice} replacing={!!source.trim()} onApproved={text=>{setSource(text);closeVoice();}}/>}</dialog>

    {recovery.error&&<div className="notice notice-amber" role="alert">{staffT.error(recovery.error)}</div>}
    {pending && !busy && !error && <div className="notice notice-amber" role="status"><strong>{staffT("An earlier send was not confirmed.")}</strong> {staffT("Check its receipt or try the same request again. A recorded request is not sent twice.")} <div className="actions"><button className="button primary" disabled={busy} onClick={()=>void retryPending()}><Send size={18}/>{staffT("Try sending again.")}</button><button className="button outline" disabled={busy} onClick={()=>void checkStatus(pending.requestId)}><RefreshCw size={18}/>{staffT("Check receipt")}</button><button className="button outline" disabled={busy} onClick={discardPending}>{staffT("Discard request")}</button></div></div>}
    {pending && !busy && error && <div className="notice notice-amber" role="status"><strong>{staffT("Send outcome not confirmed.")}</strong> {staffT("The original request is retained. Check its receipt or try the same request again. A recorded request is not sent twice.")} <div className="actions"><button className="button primary" disabled={busy} onClick={()=>void retryPending()}><Send size={18}/>{staffT("Try sending again.")}</button><button className="button outline" disabled={busy} onClick={()=>void checkStatus(pending.requestId)}><RefreshCw size={18}/>{staffT("Check receipt")}</button><button className="button outline" disabled={busy} onClick={discardPending}>{staffT("Discard request")}</button></div></div>}
    {error && !pending && <div className="notice notice-amber" role="alert">{staffT.error(error)}</div>}
    <section className="panel send-composer" data-mobile-step={mobileStep} aria-labelledby="send-source-title"><nav className="send-mobile-steps" aria-label={tr("Send an instruction")}>{['Content','Recipients','Review'].map((label,index)=><button key={label} aria-current={mobileStep===index?'step':undefined} disabled={busy} onClick={()=>setMobileStep(index)}>{index+1}. {staffT.locale==='ar'?['المحتوى','المستلمون','المراجعة'][index]:label}</button>)}</nav><div className="send-step-content">
      <label className="field" htmlFor="send-title"><span>{tr("Title")} <span aria-hidden="true">*</span></span>
        <input id="send-title" name="title" type="text" required minLength={3} maxLength={titleMax}
          value={title} disabled={busy || !!pending || !draftLoaded} onChange={event=>setTitle(event.target.value)} placeholder={staffT("Give this instruction a clear title")} />
      </label>
      <label className="field send-source-field" htmlFor="send-source"><span id="send-source-title">{tr("Instruction")}</span>
        <textarea id="send-source" aria-describedby="send-source-count" rows={7} maxLength={sourceMax} value={source} disabled={busy || !!pending || !draftLoaded} onChange={event=>setSource(event.target.value)} placeholder={staffT("Example: Move the red ladder to the north bay before the night shift. Keep the walkway clear.")} />
      </label>
      <div className="send-source-toolbar">
        <div className="send-record-actions"><button type="button" className="button outline" disabled={busy||!!pending||!draftLoaded} onClick={()=>setVoiceOpen(true)}><Mic size={18}/>{tr("Record")}</button>{draftNotice&&<span className="muted send-draft-status" role="status">{draftNotice}</span>}</div>
        <p id="send-source-count" className="muted send-counter">{trimmedSource.length < sourceMin ? tr('At least 10 characters.') : <><bdi>{trimmedSource.length} / {sourceMax}</bdi> {tr('characters')}</>}</p>
      </div>
      </div><div className="send-step-recipients"><label className="field">{tr("Who should receive it?")}
        <select value={audienceType} disabled={busy || !!pending || !draftLoaded} onChange={event=>setAudienceType(event.target.value as 'all'|'crew'|'members')}>
          <option value="all">{tr("All active workers")}</option><option value="crew">{tr("Crews")}</option><option value="members">{tr("Members")}</option>
        </select>
      </label>
      {audienceType==='crew'&&<label className="field">{tr("Choose crew")}<select aria-label={tr("Choose crew")} value={crewId} disabled={busy||!!pending} onChange={event=>setCrewId(event.target.value)}><option value="">{tr("Select crew")}</option>{audience?.crews.map(crew=><option key={crew.id} value={crew.id}>{crew.name} ({crew.members})</option>)}</select></label>}
      {audienceType==='members'&&<RecipientMembers members={audience?.members||[]} selected={workerIds} onChange={setWorkerIds} disabled={busy||!!pending}/>}

      <button type="button" className="text-link send-refresh-recipients" disabled={busy||audienceLoading} onClick={()=>setAudienceRevision(value=>value+1)}><RefreshCw size={16}/>{staffT.locale==='ar'?'تحديث المستلمين':'Refresh recipients'}</button>
      {selectedAudience && <div className="language-chips send-audience-languages" aria-label={staffT("Worker languages")}>{Object.entries(selectedAudience.byLanguage || {}).filter(([,count])=>count>0).map(([code,count])=><i key={code}>{code.toUpperCase()} {count}</i>)}</div>}
      {!!selectedAudience?.notSelected && <p className="notice notice-amber" role="status">{selectedAudience.notSelected} {staffT("active workers in this audience still need a language selected in Team before sending.")}</p>}
      {readiness?.mode==='synthetic'&&<p className="notice notice-amber" role="status">{staffT.locale==='ar'?'وضع تجريبي: تدعم التعليمات العامة النص الإنجليزي فقط. الترجمة متعددة اللغات والصوت المُولّد يتطلبان تفعيل خدمات الذكاء الاصطناعي.':'Test mode: general instructions support English text only. Multilingual translation and generated audio require a configured live workspace.'}</p>}
      {!!readiness&&unavailableLanguages.length>0&&<p className="notice notice-amber" role="alert">{staffT.locale==='ar'?'اللغات غير الجاهزة للصيغة المحددة:':'Not ready for the selected delivery format:'} {unavailableLanguages.map(code=>staffT.language(code)).join(', ')}. {staffT.locale==='ar'?'اختر النص فقط والمستلمين الجاهزين، أو اطلب تفعيل الخدمات.':'Choose text-only ready recipients, or ask the workspace administrator to configure the required services.'}</p>}
      {readinessError&&<p role="alert">{readinessError}</p>}
      {audienceError && <p className="notice notice-amber" role="alert">{audienceError}</p>}
      {selectedAudience && selectedAudience.total===0 && <p className="notice notice-amber" role="status">{staffT("There are no workers with a selected language in this audience.")}</p>}

      </div><div className="send-step-review"><MobileDisclosure title={staffT.locale==='ar'?'المرفقات (اختياري)':'Attachments (optional)'}><AttachmentComposer key={requestId.current} authority={authority} requestId={requestId.current} disabled={busy||!!pending||!draftLoaded} ready={draftReady} saveDraft={saveDraft} onBusy={setAttachmentBusy} languages={Object.keys(selectedAudience?.byLanguage||{}).sort()}/></MobileDisclosure>

      <div className="send-mobile-review"><strong>{effectiveTitle}</strong><p dir="auto">{source}</p><span>{selectedAudience?.total ?? 0} {staffT.locale==='ar'?'مستلم':'recipients'}</span></div>
      <div className="send-option-grid">
        <div className="send-mode-stack">
          <label className="send-toggle">
            <input type="checkbox" checked={responseMode==='question'} disabled={busy || !!pending || !draftLoaded} onChange={event=>{const mode=event.target.checked?'question':'acknowledge';setResponseMode(mode);if(mode==='question')setEvidenceMode('none');}}/>
            <span><strong>{tr("Include a question")}</strong><small>{responseMode==='question'?staffT("Workers select one instruction-specific answer. Correct answers and answers needing clarification appear in your response report."):staffT("Workers confirm receipt only. No answer or comprehension result is created.")}</small></span>
          </label>
          <label className={`send-toggle${responseMode==='acknowledge'?'':' send-toggle-muted'}`}>
            <input type="checkbox" checked={evidenceMode==='photo'} disabled={busy || !!pending || !draftLoaded || responseMode!=='acknowledge'} onChange={event=>setEvidenceMode(event.target.checked?'photo':'none')}/>
            <span><strong>{tr("Require a photo")}</strong><small>{responseMode==='acknowledge'?staffT("Workers attach a photo when they confirm receipt. Authorized staff can view it privately in the response detail. Photos are excluded from reports and exports."):staffT("Available for acknowledgment-only instructions.")}</small></span>
          </label>
        </div>
        <fieldset className="send-delivery" disabled={busy || !!pending || !draftLoaded}>
          <legend>{tr("Delivery format")}</legend>
          <div className="segmented send-delivery-options">
            {(['text','voice','both'] as Delivery[]).map(mode=><button type="button" key={mode} className={deliveryMode===mode?'selected':''} aria-pressed={deliveryMode===mode} onClick={()=>setDeliveryMode(mode)}>{mode==='text'?tr("Text only"):mode==='voice'?tr("Voice only"):tr("Both")}</button>)}
          </div>
        </fieldset>
      </div>



      <div className="send-submit">
        <span className="muted"><Users size={17}/> {audience?staffT("Recipients are resolved when you send; later joiners are not added automatically."):staffT("Loading recipients...")}</span>
        <button className="button primary" disabled={!canSubmit||!draftLoaded} onClick={()=>void submit()}>{busy?staffT("Sending..."):<><Send size={20}/>{tr("Send instruction")}</>}</button>
      </div>
      {showRequirements&&<div className="send-requirements" role="group" aria-label={staffT("Before you can send")}>
        <strong>{staffT("Before you can send")}</strong>
        <ul>
          <li className={titleValid?'met':undefined}>{titleValid?<CheckCircle2 size={16} aria-hidden="true"/>:<Circle size={16} aria-hidden="true"/>}<span>{staffT("Title (at least 3 characters)")}</span></li>
          <li className={sourceIssue?'met':undefined}>{sourceIssue?<Circle size={16} aria-hidden="true"/>:<CheckCircle2 size={16} aria-hidden="true"/>}<span>{staffT("Instruction length (10–{p0} characters)",{p0:sourceMax})}</span></li>
          <li className={audienceReady?'met':undefined}>{audienceReady?<CheckCircle2 size={16} aria-hidden="true"/>:<Circle size={16} aria-hidden="true"/>}<span>{staffT("Audience (workers with a selected language)")}{!audienceReady&&<small>{audienceHint}</small>}</span></li>
          {attachmentBusy&&<li><Circle size={16} aria-hidden="true"/><span>{staffT("Wait for the attachment to finish uploading.")}</span></li>}
        </ul>
      </div>}
      </div><div className="send-mobile-footer"><button className="button outline" disabled={mobileStep===0||busy} onClick={()=>setMobileStep(value=>value-1)}>{staffT.locale==='ar'?'السابق':'Back'}</button>{mobileStep<2&&<button className="button primary" disabled={mobileStep===0?(!titleValid||!!sourceIssue):!audienceReady} onClick={()=>{setMobileStep(value=>value+1);document.querySelector('.send-composer')?.scrollIntoView({block:'start'});}}>{staffT.locale==='ar'?'متابعة':'Continue'}</button>}</div></section>
  </>;
}
