import {keepDialogFocus} from './dialog-focus';
import {MobileDisclosure} from './MobileDisclosure';
import {useStaffText as useStaffStaticText} from './staff-language';
import {useStaffText} from './staff-language';
import {InstructionAudienceFields} from './InstructionAudienceFields';
import VoiceTranscript from './VoiceTranscript';
import {AttachmentComposer} from './InstructionFiles';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {AlertTriangle,ArrowLeft,CheckCircle2,ChevronRight,Circle,Mic,RefreshCw,Send,Upload,Users} from 'lucide-react';
import type {StaffRequestAuthority} from './useStaffRequest';
import {useStaffRequest} from './useStaffRequest';
import {StaffRequestError} from './staff-request';
import Gemma4TestPanel from './Gemma4TestPanel';

type Mode='question'|'acknowledge';
type Delivery='text'|'voice'|'both';
type EvidenceMode='none'|'photo';
type AudienceChoice={type:'all'}|{type:'crew';crewId:string}|{type:'members';workerIds:string[]};
type AudienceOverview={members:{id:string;code:string;name:string|null;language:string;language_selection_required:boolean|number}[];workers:{total:number;byLanguage:Record<string,number>;notSelected?:number};crews:{id:string;name:string;members:number;byLanguage:Record<string,number>;notSelected:number}[];gemma4TestSource?:string};
type UndeliveredReason={reason:string;language?:string;count:number};
type CoverageLanguage={language:string;workers:number;ready:boolean;reason:string|null};
type InstructionCoverage={requestId:string;total:number;ready:number;preparation:'synthetic-fixture'|'synthetic-provider'|'provider';languages:CoverageLanguage[];missing:CoverageLanguage[]};
type DeliveryStates={preparing:number;available:number;blocked:number;failed:number;withdrawn:number};
type SendResult={requestId:string;briefingId:string;state:'preparing'|'published'|'failed';responseMode:Mode;deliveryMode:Delivery;evidenceMode?:EvidenceMode;
  audience:{type:string;count:number;crewId?:string};delivered:number;undelivered:number;undeliveredReasons:UndeliveredReason[];
  deliveryStates?:DeliveryStates|null;retryable?:boolean;retryRequestId?:string;retried?:number;released?:number;
  publicationId:string|null;error:string|null;duplicate:boolean};
type PendingSend={requestId:string;title:string;source:string;audience:AudienceChoice;responseMode:Mode;deliveryMode:Delivery;evidenceMode:EvidenceMode;savedAt:number};
const evidenceFor=(mode:Mode,evidence:unknown):EvidenceMode=>mode==='acknowledge'&&evidence==='photo'?'photo':'none';

const sourceMin=10,sourceMax=4000,titleMax=120;
const mobileSteps=['Content','Recipients','Review'];
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
export function sourceAsksForReply(source:string){return /[?\u061F\u00BF]/.test(source);}
function reasonText(reason:{reason:string|null;language?:string},languageName:(code:string)=>string,t:(text:string,values?:Record<string,string|number|boolean|null|undefined>)=>string){
  const language=reason.language?languageName(reason.language):'';
  if(!reason.reason)return language;
  if(['language_unavailable','content_unavailable','question_unavailable','speech_unavailable'].includes(reason.reason))
    return language?t("{p0} version not ready",{p0:language}):t("Language version not ready");
  if(reason.reason==='worker_inactive')return t("Worker no longer active");
  return `${reason.reason.replaceAll('_',' ')}${language?` · ${language}`:''}`;
}

export default function SendInstruction({authority,scope,navigate,onSent,draftId,initialCrewId,navigationGuard}:{initialCrewId?:string;draftId?:string;navigationGuard:RefObject<((next:string,resume?:()=>void)=>boolean)|null>;authority:StaffRequestAuthority;scope:string|null;navigate:(path:string)=>void;onSent:()=>void}){
  const staffT=useStaffStaticText();
 const tr=useStaffText();
  const {request,current}=useStaffRequest(authority);
  const [mobileStep,setMobileStep]=useState(0);
  const mobileHeading=useRef<HTMLHeadingElement>(null);
  function goToMobileStep(step:number){
    setMobileStep(step);
    requestAnimationFrame(()=>mobileHeading.current?.focus());
  }
  function stepHeading(index:number){
    return <h2 className="send-mobile-heading" tabIndex={-1} ref={mobileStep===index?mobileHeading:undefined}>{staffT(mobileSteps[index])}</h2>;
  }
  const [recovery]=useState(()=>{try{return {pending:readPending(scope),error:''};}catch(error){return {pending:null,error:(error as Error).message};}});
  const restoredPending=recovery.pending;
  const [pending,setPending]=useState<PendingSend|null>(restoredPending);
  const [pendingCheck,setPendingCheck]=useState(!!restoredPending);
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
  const [readiness,setReadiness]=useState<{mode:string;textLanguages:string[];speechLanguages:string[];providerLabel?:string|null;translationProviderLabel?:string|null}|null>(null);
  const [readinessError,setReadinessError]=useState('');

  const [audienceLoading,setAudienceLoading]=useState(false),[audienceRevision,setAudienceRevision]=useState(0);
  const audienceErrorRef=useRef<HTMLParagraphElement|null>(null);
  useEffect(()=>{if(!audienceError)return;setMobileStep(1);const frame=requestAnimationFrame(()=>audienceErrorRef.current?.focus());return()=>cancelAnimationFrame(frame);},[audienceError]);
  const leaveDialog=useRef<HTMLDialogElement>(null),leaveRequest=useRef<{next:string;resume?:()=>void}|null>(null);
  const [leaveOpen,setLeaveOpen]=useState(false);
  useEffect(()=>{if(leaveOpen)leaveDialog.current?.showModal();else leaveDialog.current?.close();},[leaveOpen]);
  const [result,setResult]=useState<SendResult|null>(null);
  const [retryReceipt,setRetryReceipt]=useState<{requestId:string;retried:number;released:number}|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false),[attachmentBusy,setAttachmentBusy]=useState(false);
  const [coverageWarning,setCoverageWarning]=useState<InstructionCoverage|null>(null);
  const coverageDialog=useRef<HTMLDialogElement>(null),coverageValue=useRef<PendingSend|null>(null);
  const [acknowledgeWarning,setAcknowledgeWarning]=useState(false);
  const acknowledgeDialog=useRef<HTMLDialogElement>(null);
  const requestId=useRef(restoredPending?.requestId || draftId || crypto.randomUUID());
  const errorRef=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{if(!error)return;errorRef.current?.focus();},[error]);
  const discarded=useRef<PendingSend|null>(null);
  const sending=useRef(false);
  const sentNotice=useRef(false);
  useEffect(()=>{const controller=new AbortController();setReadiness(null);setReadinessError('');const timer=setTimeout(()=>{request<NonNullable<typeof readiness>>('/api/instructions/readiness',{source},controller.signal).then(value=>{if(!controller.signal.aborted&&current())setReadiness(value);}).catch(()=>{if(!controller.signal.aborted&&current())setReadinessError('Delivery availability could not be checked.');});},400);return()=>{clearTimeout(timer);controller.abort();};},[source,audienceRevision,request,current]);
  const trimmedSource=source.trim();
  const effectiveTitle=title.trim().slice(0,titleMax);
  const audienceChoice:AudienceChoice=audienceType==='crew'?{type:'crew',crewId}:audienceType==='members'?{type:'members',workerIds:[...workerIds].sort()}:{type:'all'};
  const selectedCrew=audienceType==='crew'?(audience?.crews.find(crew=>crew.id===crewId)??null):null;
  const selectedMembers=audience?.members?.filter(member=>workerIds.includes(member.id))||[];
  const singleMember=audienceType==='members'&&selectedMembers.length===1?selectedMembers[0]:null;
  const selectedAudience=audienceType==='members'?{total:selectedMembers.filter(member=>!member.language_selection_required).length,notSelected:selectedMembers.filter(member=>member.language_selection_required).length,byLanguage:selectedMembers.reduce<Record<string,number>>((counts,member)=>{counts[member.language]=(counts[member.language]||0)+1;return counts;},{})}:audienceType==='all'?(audience?.workers?{...audience.workers,notSelected:audience.workers.notSelected??0}:null):selectedCrew?{total:selectedCrew.members,byLanguage:selectedCrew.byLanguage,notSelected:selectedCrew.notSelected}:null;
  const audienceLanguages=Object.entries(selectedAudience?.byLanguage??{}).filter(([,count])=>count>0);
  const unavailableLanguages=audienceLanguages.filter(([code])=>!readiness?.textLanguages.includes(code)
    || (deliveryMode!=='text'&&!readiness.speechLanguages.includes(code))).map(([code])=>code);
  const unavailableWorkers=unavailableLanguages.reduce((total,code)=>total+(selectedAudience?.byLanguage[code]??0),0);
  const readyWorkers=(selectedAudience?.total??0)-unavailableWorkers;
  const titleValid=effectiveTitle.length>=3;
  const canSubmit=trimmedSource.length>=sourceMin && trimmedSource.length<=sourceMax && titleValid
    && !!selectedAudience && selectedAudience.total>0 && !selectedAudience.notSelected && !!readiness && !readinessError && readyWorkers>0 && !audienceLoading && !audienceError && !busy && !attachmentBusy && !pending && !recovery.error;
  const sourceIssue=trimmedSource.length<sourceMin?'short':trimmedSource.length>sourceMax?'long':'';
  const audienceReady=!!selectedAudience && selectedAudience.total>0 && !selectedAudience.notSelected;
  const deliveryBlocked=audienceReady && !!readiness && readyWorkers===0;
  const canSwitchToText=deliveryBlocked && deliveryMode!=='text' && audienceLanguages.some(([code])=>readiness.textLanguages.includes(code));
  const deliveryHint=canSwitchToText
    ? staffT.locale==='ar'?'الصوت غير متاح للمستلمين المحددين. اختر النص فقط للإرسال إلى المستلمين الجاهزين.':'Voice is unavailable for the selected recipients. Choose Text only to send to recipients who can receive it.'
    : staffT.locale==='ar'?'لا تتوفر ترجمة لهذه التعليمات بلغات المستلمين المحددين.':'Translation is unavailable for this instruction in the selected recipients’ languages.';
  const audienceHint=audienceType==='crew'&&!selectedCrew?staffT("Select a crew to continue."):audienceType==='crew'&&selectedCrew?.members===0?staffT("This crew has no workers yet."):selectedAudience?.notSelected?staffT("Select a language for every worker in this audience."):selectedAudience?staffT("Choose at least one worker with a selected language."):staffT("Loading recipients...");

  const voiceDialog=useRef<HTMLDialogElement>(null),[voiceOpen,setVoiceOpen]=useState(false),[voiceMode,setVoiceMode]=useState<'record'|'upload'>('record');
  const processingNote=readiness?.mode==='synthetic'
    ?staffT("This test workspace uses a local transcription stub. No AI provider is contacted.")
    :staffT("Your audio is processed by the workspace transcription service.");
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
  useEffect(()=>{if(coverageWarning)coverageDialog.current?.showModal();},[coverageWarning]);
  function closeCoverage(){coverageDialog.current?.close();setCoverageWarning(null);coverageValue.current=null;}
  useEffect(()=>{if(acknowledgeWarning)acknowledgeDialog.current?.showModal();},[acknowledgeWarning]);
  function closeAcknowledge(){acknowledgeDialog.current?.close();setAcknowledgeWarning(false);}
  function useQuestionMode(){closeAcknowledge();setResponseMode('question');setEvidenceMode('none');requestAnimationFrame(()=>document.getElementById('send-question-mode')?.focus());}
  function confirmAcknowledgeOnly(){closeAcknowledge();void submit(true);}

  useEffect(()=>{
    const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;
    setAudienceLoading(true);
    setAudienceError('');
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
    if(!restoredPending || !current())return;
    let active=true;
    request<SendResult>(`/api/instructions/sends/${encodeURIComponent(restoredPending.requestId)}`)
      .then(value=>{if(!active||!current())return;setResult(value);clearPending(scope);setPending(null);if(value.state==='failed')setError(value.error||'The instruction could not be sent.');})
      .catch(reason=>{if(active&&current()&&reason instanceof StaffRequestError && reason.status===404){clearPending(scope);setPending(null);}})
      .finally(()=>{if(active)setPendingCheck(false);});
    return()=>{active=false;};
  },[]);

  useEffect(()=>{
    if(result?.state==='published' && !sentNotice.current){sentNotice.current=true;onSent();}
  },[result?.state,onSent]);

  function reset(){
    requestId.current=crypto.randomUUID();discarded.current=null;hasSavedDraft.current=false;setDraftReady(false);setWorkerIds([]);setDraftNotice('');setDraftLoaded(true);history.replaceState(null,'',`${location.pathname}${location.search}#send/${requestId.current}`);
    clearPending(scope);setPending(null);setResult(null);setRetryReceipt(null);setError('');setCoverageWarning(null);coverageValue.current=null;
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

  function sendPayload(value:PendingSend){
    return {requestId:value.requestId,title:value.title,source:value.source,audience:value.audience,
      responseMode:value.responseMode,deliveryMode:value.deliveryMode,evidenceMode:value.evidenceMode};
  }

  async function sendValue(value:PendingSend){
    sending.current=true;setBusy(true);setError('');setPending(value);
    try {
      const sent=await request<SendResult>('/api/instructions/send',sendPayload(value));
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

  async function submit(acknowledgeOnly=false){
    if(!canSubmit || sending.current || !current())return;
    if(!acknowledgeOnly && responseMode==='acknowledge' && sourceAsksForReply(trimmedSource)){setAcknowledgeWarning(true);return;}
    let value=currentValue();
    if(discarded.current && !sameSend(discarded.current,value)){
      requestId.current=crypto.randomUUID();
      history.replaceState(null,'',`${location.pathname}${location.search}#send/${requestId.current}`);
      value=currentValue();
    }
    sending.current=true;setBusy(true);setError('');
    try {
      const coverage=await request<InstructionCoverage>('/api/instructions/preflight',sendPayload(value));
      if(!current())return;
      if(coverage.missing.length){
        // Nothing is recorded yet; the supervisor can fix recipients or send to the ready ones.
        coverageValue.current=value;setCoverageWarning(coverage);
        return;
      }
    }catch(reason){
      if(current())setError(reason instanceof Error?reason.message:'Language coverage could not be checked. Nothing was sent.');
      return;
    }finally{sending.current=false;setBusy(false);}
    discarded.current=null;
    try{savePending(scope,value);}catch(reason){setError((reason as Error).message);return;}
    await sendValue(value);
  }

  async function sendAnyway(){
    const value=coverageValue.current;
    closeCoverage();
    if(!value || sending.current || !current())return;
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
    const heading=result.state==='preparing'?'Preparing instruction':result.state==='failed'?'Instruction not sent':partial?'Instruction partly sent':'Instruction sent';
    return <><div className="page-header"><div aria-live="polite"><h1>{staffT(heading)}</h1><p>{result.state==='preparing'?staffT("Delivery is still in progress. This page checks again automatically."):result.state==='failed'?staffT("No instruction was delivered."):partial?staffT("The ready language versions were delivered. Not every selected worker could receive this instruction."):staffT("The instruction was sent. Open it to see who received it and any answers or follow-ups.")}</p></div><button className="button outline" onClick={()=>navigate('briefings')}><ArrowLeft size={19}/>{tr("Instructions")}</button></div>
      {error && <div className="notice notice-amber" role="alert" ref={errorRef} tabIndex={-1}>{staffT.error(error)}</div>}
      {result.state==='published' && <section className="panel send-result" aria-labelledby="send-result-title">
        <div className={`receipt-mark${partial?' receipt-mark-partial':''}`} aria-hidden="true">{partial?<AlertTriangle size={42}/>:<CheckCircle2 size={42}/>}</div>
        <h2 id="send-result-title">{partial?staffT("Partly sent"):staffT("Sent")}</h2>
        {result.duplicate && <p role="status">{staffT("This request was already sent. Nothing was sent twice.")}</p>}
        <dl className="worker-receipt-meta">
          <div><dt>{staffT("Delivery")}</dt><dd>{result.responseMode==='acknowledge'?staffT("Acknowledge receipt"):staffT("Question and answer")}</dd></div>
          <div><dt>{staffT("Format")}</dt><dd>{result.deliveryMode==='both'?staffT("Text and voice"):result.deliveryMode==='voice'?staffT("Voice"):staffT("Text")}</dd></div>
          {result.evidenceMode==='photo' && <div><dt>{staffT("Evidence")}</dt><dd>{staffT("Photo required")}</dd></div>}
          <div><dt>{staffT("Delivered")}</dt><dd>{result.delivered} {tr("of")} {result.audience.count}</dd></div>
          {result.undelivered>0 && <div><dt>{staffT("Not delivered")}</dt><dd>{result.undelivered}</dd></div>}
          {!!result.deliveryStates?.preparing && <div><dt>{staffT("Still preparing")}</dt><dd>{result.deliveryStates.preparing}</dd></div>}
        </dl>
        {retryReceipt && <div className="notice" role="status"><strong>{staffT("Retry recorded.")}</strong> {retryReceipt.retried} {staffT("unfinished")} {retryReceipt.retried===1?staffT("delivery was"):staffT("deliveries were")} {staffT("rechecked")}{retryReceipt.released>0?staffT(" and {p0} {p1} this instruction",{p0:retryReceipt.released,p1:retryReceipt.released===1?'recipient now has':'recipients now have'}):''}.</div>}
        {result.undelivered>0 && <div className="notice notice-amber" role="status"><strong>{staffT("Partly sent.")}</strong> {result.undelivered} {tr("of")} {result.audience.count} {staffT("selected workers did not receive this instruction.")}<ul className="send-reasons">{result.undeliveredReasons.map((reason,index)=><li key={`${reason.reason}:${reason.language}:${index}`}>{reasonText(reason,staffT.language,staffT)} · {reason.count}</li>)}</ul>
          <div className="actions">
            {result.retryable && <button className="button primary" disabled={busy} onClick={()=>void retryUndelivered()}><RefreshCw size={19}/>{busy?staffT("Retrying..."):staffT("Retry undelivered")}</button>}
            {result.undeliveredReasons.some(reason=>['language_unavailable','content_unavailable','question_unavailable','speech_unavailable'].includes(reason.reason)) && <button className="button outline" onClick={()=>navigate('people')}>{staffT("Review worker languages")}</button>}
          </div>
        </div>}
        <div className="actions"><button className="button primary" onClick={()=>navigate(`briefings/${result.briefingId}`)}>{staffT("Open instruction")}<ChevronRight size={19}/></button><button className="button outline" disabled={busy} onClick={reset}><Send size={19}/>{staffT("Send another")}</button></div>
      </section>}
      {result.state==='preparing' && <section className="panel send-result"><div className="actions"><button className="button primary" disabled={busy} onClick={()=>void checkStatus(result.requestId)}><RefreshCw size={19}/>{busy?staffT("Checking..."):staffT("Check status")}</button><button className="button outline" disabled={busy} onClick={()=>navigate('briefings')}>{staffT("View instructions")}</button></div></section>}
      {result.state==='failed' && <section className="panel send-result"><p>{result.error?staffT.error(result.error):staffT("Review the source and try again.")}</p><div className="actions"><button className="button primary" disabled={busy} onClick={reset}><Send size={19}/>{staffT("Start again")}</button><button className="button outline" onClick={()=>navigate('briefings')}>{tr("Instructions")}</button></div></section>}
    </>;
  }

  return <>
    <div className="page-header"><div><h1 id="send-composer-title">{tr("Send an instruction")}</h1><p>{tr("Write or record your instruction, choose recipients, and send.")}</p></div><button className="button outline" onClick={()=>navigate('briefings')}><ArrowLeft size={19}/>{tr("Instructions")}</button></div>
    <dialog ref={leaveDialog} className="withdraw-dialog" aria-labelledby="composer-leave-title" onKeyDown={keepDialogFocus} onCancel={()=>setLeaveOpen(false)}><h2 id="composer-leave-title">{staffT.locale==='ar'?'تعذّر حفظ المسودة':'Draft could not be saved'}</h2><p>{staffT.locale==='ar'?'يمكنك البقاء وإعادة المحاولة، أو المغادرة دون حفظ التغييرات الأخيرة.':'Stay and retry saving, or leave without saving the latest changes. Previously saved drafts are retained.'}</p><div className="actions"><button className="button outline" autoFocus onClick={()=>setLeaveOpen(false)}>{staffT.locale==='ar'?'البقاء':'Keep working'}</button><button className="button primary" onClick={()=>{const target=leaveRequest.current;if(!target)return;try{sessionStorage.removeItem(localKey);}catch{}approvedNext.current=target.next;setLeaveOpen(false);if(target.resume)target.resume();else navigate(target.next);}}>{staffT.locale==='ar'?'المغادرة دون حفظ':'Discard and leave'}</button></div></dialog>
    <dialog ref={voiceDialog} className="worker-form-dialog" aria-label={voiceMode==='upload'?tr("Upload audio"):tr("Record instruction")} onCancel={event=>{event.preventDefault();closeVoice();}}>{voiceOpen&&<VoiceTranscript authority={authority} title={title} mode={voiceMode} processingNote={processingNote} onClose={closeVoice} replacing={!!source.trim()} onApproved={text=>{setSource(text);closeVoice();}}/>}</dialog>
    <dialog ref={coverageDialog} className="worker-form-dialog" aria-labelledby="coverage-warning-title" onCancel={event=>{event.preventDefault();closeCoverage();}}>
      {coverageWarning&&(()=>{const blocked=coverageWarning.preparation==='provider'||coverageWarning.ready===0;return <div>
        <h2 id="coverage-warning-title">{staffT("Some recipients cannot receive this instruction")}</h2>
        <p>{coverageWarning.preparation==='provider'?staffT("The translation provider must prepare every selected worker language together, so this send would fail. Nothing has been sent."):coverageWarning.ready===0?staffT("No selected worker language can be prepared with the current translation setup. Nothing has been sent."):staffT("{p0} of {p1} recipients are ready. These worker languages are not available:",{p0:coverageWarning.ready,p1:coverageWarning.total})}</p>
        <ul className="send-reasons">{coverageWarning.missing.map((item,index)=><li key={`${item.language}:${index}`}>{reasonText(item,staffT.language,staffT)} · {staffT.number(item.workers)}</li>)}</ul>
        <p>{staffT("Change worker languages in Team, or review the translation setup in Language readiness. Nothing is sent until you choose.")}</p>
        <div className="actions">
          <button type="button" className="button outline" onClick={()=>{closeCoverage();navigate('people');}}>{staffT("Open Team")}</button>
          <button type="button" className="button outline" onClick={()=>{closeCoverage();navigate('language-readiness');}}>{staffT("Language readiness")}</button>
          {!blocked&&<button type="button" className="button primary" disabled={busy} onClick={()=>void sendAnyway()}>{staffT("Send to ready recipients")}</button>}
          <button type="button" className="button outline" onClick={closeCoverage}>{staffT("Cancel")}</button>
        </div>
      </div>;})()}
    </dialog>
    <dialog ref={acknowledgeDialog} className="worker-form-dialog" aria-labelledby="acknowledge-warning-title" onCancel={event=>{event.preventDefault();closeAcknowledge();}}>
      <div>
        <h2 id="acknowledge-warning-title">{staffT("This instruction asks a question")}</h2>
        <p>{staffT("Workers will only confirm receipt, so their answer will not be collected.")}</p>
        <div className="actions">
          <button type="button" className="button primary" onClick={useQuestionMode}>{staffT("Ask for an answer")}</button>
          <button type="button" className="button outline" disabled={busy} onClick={confirmAcknowledgeOnly}>{staffT("Send acknowledgment only")}</button>
          <button type="button" className="button outline" onClick={closeAcknowledge}>{staffT("Cancel")}</button>
        </div>
      </div>
    </dialog>

    {recovery.error&&<div className="notice notice-amber" role="alert">{staffT.error(recovery.error)}</div>}
    {pending && !error && !busy && !pendingCheck && <div className="notice notice-amber" role="status"><strong>{staffT("An earlier send was not confirmed.")}</strong> {staffT("Check its receipt or try the same request again. A recorded request is not sent twice.")} <div className="actions"><button className="button primary" disabled={busy} onClick={()=>void retryPending()}><Send size={18}/>{staffT("Try sending again.")}</button><button className="button outline" disabled={busy} onClick={()=>void checkStatus(pending.requestId)}><RefreshCw size={18}/>{staffT("Check receipt")}</button><button className="button outline" disabled={busy} onClick={discardPending}>{staffT("Discard request")}</button></div></div>}
    {pending && error && !busy && !pendingCheck && <div className="notice notice-amber" role="status"><strong>{staffT("Send outcome not confirmed.")}</strong> {staffT("The original request is retained. Check its receipt or try the same request again. A recorded request is not sent twice.")} <div className="actions"><button className="button primary" disabled={busy} onClick={()=>void retryPending()}><Send size={18}/>{staffT("Try sending again.")}</button><button className="button outline" disabled={busy} onClick={()=>void checkStatus(pending.requestId)}><RefreshCw size={18}/>{staffT("Check receipt")}</button><button className="button outline" disabled={busy} onClick={discardPending}>{staffT("Discard request")}</button></div></div>}
    {pendingCheck && <p className="muted" role="status">{staffT("Checking an earlier send...")}</p>}
    {error && !pending && <div className="notice notice-amber" role="alert" ref={errorRef} tabIndex={-1}>{staffT.error(error)}</div>}
    <section className="panel send-composer" data-mobile-step={mobileStep} aria-labelledby="send-composer-title"><nav className="send-mobile-steps" aria-label={tr("Send an instruction")}>{mobileSteps.map((label,index)=><button key={label} aria-current={mobileStep===index?'step':undefined} disabled={busy} onClick={()=>goToMobileStep(index)}>{staffT.number(index+1)}. {staffT(label)}</button>)}</nav><div className="send-step-content">
      {stepHeading(0)}
      <label className="field" htmlFor="send-title"><span>{tr("Title")} <span aria-hidden="true">*</span></span>
        <input id="send-title" name="title" type="text" required minLength={3} maxLength={titleMax}
          value={title} disabled={busy || !!pending || !draftLoaded} onChange={event=>setTitle(event.target.value)} placeholder={staffT("Give this instruction a clear title")} />
      </label>
      <label className="field send-source-field" htmlFor="send-source"><span id="send-source-title">{tr("Instruction")}</span>
        <textarea id="send-source" aria-describedby="send-source-count" rows={7} maxLength={sourceMax} value={source} disabled={busy || !!pending || !draftLoaded} onChange={event=>setSource(event.target.value)} placeholder={staffT("Example: Move the red ladder to the north bay before the night shift. Keep the walkway clear.")} />
      </label>
      <div className="send-source-toolbar">
        <div className="send-record-actions"><button type="button" className="button outline" disabled={busy||!!pending||!draftLoaded} onClick={()=>{setVoiceMode('record');setVoiceOpen(true);}}><Mic size={18}/>{tr("Record")}</button><button type="button" className="button outline" disabled={busy||!!pending||!draftLoaded} onClick={()=>{setVoiceMode('upload');setVoiceOpen(true);}}><Upload size={18}/>{tr("Upload audio")}</button>{draftNotice&&<span className="muted send-draft-status" role="status">{draftNotice}</span>}</div>
        <p id="send-source-count" className="muted send-counter">{trimmedSource.length < sourceMin ? tr('At least 10 characters.') : <><bdi>{trimmedSource.length} / {sourceMax}</bdi> {tr('characters')}</>}</p>
      </div>
      {audience?.gemma4TestSource&&<Gemma4TestPanel authority={authority} source={audience.gemma4TestSource}/>}
      </div><div className="send-step-recipients">
      {stepHeading(1)}
      <InstructionAudienceFields
        audience={audience}
        audienceType={audienceType}
        crewId={crewId}
        workerIds={workerIds}
        selectedAudience={selectedAudience}
        selectedCrew={selectedCrew}
        audienceLoading={audienceLoading}
        audienceError={audienceError}
        audienceErrorRef={audienceErrorRef}
        disabled={busy||!!pending||!draftLoaded}
        readiness={readiness}
        readinessError={readinessError}
        unavailableLanguages={unavailableLanguages}
        deliveryBlocked={deliveryBlocked}
        deliveryHint={deliveryHint}
        canSwitchToText={canSwitchToText}
        onAudienceType={setAudienceType}
        onCrewId={setCrewId}
        onWorkerIds={setWorkerIds}
        onRefresh={()=>setAudienceRevision(value=>value+1)}
        onSwitchToText={()=>setDeliveryMode('text')}
      />
      {readiness?.mode==='synthetic'&&<p className="notice notice-amber" role="status">{(readiness.textLanguages.length>1?staffT.locale==='ar'?'وضع تجريبي: المثال المحفوظ مترجم إلى كل لغة عامل ويستخدم صوت الجهاز. التعليمات الأخرى تدعم النص الإنجليزي فقط حتى يتم تفعيل مساحة عمل حية.':'Demo mode: the seeded shelf example is translated into every worker language and uses device speech. Other instructions support English text only until a live workspace is configured.':staffT.locale==='ar'?'وضع تجريبي: تدعم التعليمات العامة النص الإنجليزي فقط. الترجمة متعددة اللغات والصوت المُولّد يتطلبان تفعيل خدمات الذكاء الاصطناعي.':'Test mode: general instructions support English text only. Multilingual translation and generated audio require a configured live workspace.')}</p>}
      {readiness?.providerLabel&&readiness.mode.endsWith('-text')&&<p className="muted" role="status">{staffT.locale==='ar'
        ?readiness.translationProviderLabel?`${readiness.providerLabel} يكتب سؤال التحقق. ${readiness.translationProviderLabel} يترجم نص التعليمات. يعتمد توفر الصوت على لغة العامل.`:`${readiness.providerLabel} يمكنه ترجمة التعليمات الإنجليزية للتسليم النصي. يعتمد توفر الصوت على لغة العامل.`
        :readiness.translationProviderLabel?`${readiness.providerLabel} writes the check question. ${readiness.translationProviderLabel} translates the instruction text. Voice availability depends on the worker’s language.`:`${readiness.providerLabel} can translate English instructions for text delivery. Voice availability depends on the worker’s language.`}</p>}
      </div><div className="send-step-review">
      {stepHeading(2)}
      {effectiveTitle&&<div className="send-mobile-review"><strong dir="auto">{effectiveTitle}</strong>
        {source.length>300?<details><summary>{staffT("Read instruction preview")}</summary><p dir="auto">{source}</p></details>:<p dir="auto">{source}</p>}
      </div>}
      {selectedAudience&&<div className="send-review-audience">
        <div><strong>{staffT("Recipients")}</strong><p>
          {singleMember?<>{singleMember.name&&<><bdi>{singleMember.name}</bdi>{' '}</>}<bdi dir="ltr">{singleMember.name?`(${singleMember.code})`:singleMember.code}</bdi></>:selectedCrew?<bdi>{selectedCrew.name}</bdi>:audienceType==='all'?tr("All active workers"):staffT("Selected members")}
        </p></div>
        <button type="button" className="text-link send-edit-recipients" disabled={busy} onClick={()=>goToMobileStep(1)}>{staffT("Edit recipients")}</button>
        {audienceReady&&<p className="send-review-readiness" role="status">
          {readiness?<>{staffT("Workers ready for this format")} <bdi>{staffT.number(readyWorkers)} / {staffT.number(selectedAudience.total)}</bdi></>:readinessError?staffT(readinessError):staffT("Checking delivery availability…")}
        </p>}
        {readinessError&&<button type="button" className="text-link" disabled={busy||audienceLoading} onClick={()=>setAudienceRevision(value=>value+1)}>{staffT("Try again")}</button>}
      </div>}
      <p className="muted send-review-preview-note">{responseMode==='question'?staffT("This review shows the instruction text and recipients. The check question is generated when you send and then appears in the instruction."):staffT("This review shows the instruction text and recipients. Workers will only confirm receipt.")}</p>
      <MobileDisclosure title={staffT.locale==='ar'?'المرفقات (اختياري)':'Attachments (optional)'}><AttachmentComposer key={requestId.current} authority={authority} requestId={requestId.current} disabled={busy||!!pending||!draftLoaded} ready={draftReady} saveDraft={saveDraft} onBusy={setAttachmentBusy} languages={Object.keys(selectedAudience?.byLanguage||{}).sort()}/></MobileDisclosure>
      <div className="send-option-grid">
        <div className="send-mode-stack">
          <label className="send-toggle">
            <input id="send-question-mode" type="checkbox" checked={responseMode==='question'} disabled={busy || !!pending || !draftLoaded} onChange={event=>{const mode=event.target.checked?'question':'acknowledge';setResponseMode(mode);if(mode==='question')setEvidenceMode('none');}}/>
            <span><strong>{tr("Include a question")}</strong><small>{responseMode==='question'?staffT("Workers select one instruction-specific answer. Correct answers and answers needing clarification appear in your response report."):staffT("Workers confirm receipt only. No answer or comprehension result is created.")}</small></span>
          </label>
          {responseMode==='acknowledge'&&sourceAsksForReply(trimmedSource)&&<p className="notice notice-amber" role="status">{staffT("This instruction asks a question, but workers will only confirm receipt.")} <button type="button" className="text-link" disabled={busy||!!pending||!draftLoaded} onClick={()=>{setResponseMode('question');setEvidenceMode('none');document.getElementById('send-question-mode')?.focus();}}>{staffT("Ask for an answer instead")}</button></p>}
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



      {!!readiness&&unavailableLanguages.length>0&&<p className="notice notice-amber" role="status">
        {staffT.locale==='ar'?'اللغات غير الجاهزة للصيغة المحددة:':'Not ready for the selected delivery format:'} {unavailableLanguages.map(code=>staffT.language(code)).join(staffT.locale==='ar'?'، ':', ')}. {deliveryBlocked?deliveryHint:readyWorkers>0&&(staffT.locale==='ar'?'يمكنك الإرسال إلى العاملين الجاهزين ومراجعة المستبعدين قبل الإرسال، أو تعديل المستلمين أولاً.':'You can send to the ready workers and review exclusions before sending, or adjust recipients first.')}
      </p>}
      {showRequirements&&<div className="send-requirements" role="group" aria-label={staffT("Before you can send")}>
        <strong>{staffT("Before you can send")}</strong>
        <ul>
          <li className={titleValid?'met':undefined}>{titleValid?<CheckCircle2 size={16} aria-hidden="true"/>:<Circle size={16} aria-hidden="true"/>}<span>{staffT("Title (at least 3 characters)")}</span><span className="sr-only">{titleValid?staffT("Requirement met"):staffT("Requirement not met")}</span></li>
          <li className={!sourceIssue?'met':undefined}>{sourceIssue?<Circle size={16} aria-hidden="true"/>:<CheckCircle2 size={16} aria-hidden="true"/>}<span>{staffT("Instruction length (10–{p0} characters)",{p0:sourceMax})}</span><span className="sr-only">{sourceIssue?staffT("Requirement not met"):staffT("Requirement met")}</span></li>
          <li className={audienceReady?'met':undefined}>{audienceReady?<CheckCircle2 size={16} aria-hidden="true"/>:<Circle size={16} aria-hidden="true"/>}<span>{staffT("Audience (workers with a selected language)")}{!audienceReady&&<small>{audienceHint}</small>}</span><span className="sr-only">{audienceReady?staffT("Requirement met"):staffT("Requirement not met")}</span></li>
          {audienceReady&&<li className={readiness&&readyWorkers>0?'met':undefined}>
            {readiness&&readyWorkers>0?<CheckCircle2 size={16} aria-hidden="true"/>:<Circle size={16} aria-hidden="true"/>}
            <span>{staffT.locale==='ar'?'صيغة الإرسال':'Delivery format'}
              {deliveryBlocked&&<small>{deliveryHint} {canSwitchToText&&<button type="button" className="text-link" onClick={()=>setDeliveryMode('text')}>{tr("Text only")}</button>}</small>}
            </span>
            <span className="sr-only">{readiness&&readyWorkers>0?staffT("Requirement met"):staffT("Requirement not met")}</span>
          </li>}
          {attachmentBusy&&<li><Circle size={16} aria-hidden="true"/><span>{staffT("Wait for the attachment to finish uploading.")}</span><span className="sr-only">{staffT("Requirement not met")}</span></li>}
        </ul>
      </div>}
      <div className="send-submit">
        <span className="muted"><Users size={17}/> {audience?staffT("Recipients are resolved when you send; later joiners are not added automatically."):staffT("Loading recipients...")}</span>
        <button className="button primary" disabled={!canSubmit||!draftLoaded} onClick={()=>void submit()}>{busy?staffT("Sending..."):<><Send size={20}/>{tr("Send instruction")}</>}</button>
      </div>
      </div><div className="send-mobile-footer"><button className="button outline" disabled={mobileStep===0||busy} onClick={()=>goToMobileStep(mobileStep-1)}>{staffT("Back")}</button>{mobileStep<2&&<button className="button primary" disabled={busy||(mobileStep===0?(!titleValid||!!sourceIssue):!audienceReady)} onClick={()=>goToMobileStep(mobileStep+1)}>{staffT("Continue")}</button>}</div></section>
  </>;
}
