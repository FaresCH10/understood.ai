import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,CheckCircle2,ChevronRight,FileText,RefreshCw,Send,Users} from 'lucide-react';
import type {StaffRequestAuthority} from './useStaffRequest';
import {useStaffRequest} from './useStaffRequest';
import {StaffRequestError} from './staff-request';

type Mode='question'|'acknowledge';
type Delivery='text'|'voice'|'both';
type AudienceChoice={type:'all'}|{type:'crew';crewId:string};
type AudienceOverview={workers:{total:number;byLanguage:Record<string,number>};crews:{id:string;name:string;members:number}[]};
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
  return raw.type==='all' ? Object.keys(raw).every(key=>key==='type') : raw.type==='crew' && typeof raw.crewId==='string' && raw.crewId.length>0;
};
function readPending(scope:string|null):PendingSend|null {
  if(!scope)return null;
  try {
    const raw=sessionStorage.getItem(pendingKey(scope));
    if(!raw || raw.length>12000)return null;
    const value=JSON.parse(raw);
    if(typeof value?.requestId!=='string' || !/^[0-9a-f-]{36}$/i.test(value.requestId)
      || typeof value.source!=='string' || value.source.length>sourceMax || typeof value.title!=='string'
      || !['question','acknowledge'].includes(value.responseMode) || !['text','voice','both'].includes(value.deliveryMode)
      || !validAudience(value.audience))return null;
    return {requestId:value.requestId,title:value.title.slice(0,titleMax),source:value.source,audience:value.audience,
      responseMode:value.responseMode,deliveryMode:value.deliveryMode,savedAt:Number(value.savedAt)||0};
  }catch{return null;}
}
function savePending(scope:string|null,value:PendingSend){
  if(!scope)return;
  try{sessionStorage.setItem(pendingKey(scope),JSON.stringify(value));}catch{/* Storage may be unavailable. */}
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

export default function SendInstruction({authority,scope,navigate,onSent}:{authority:StaffRequestAuthority;scope:string|null;navigate:(path:string)=>void;onSent:()=>void}){
  const {request,current}=useStaffRequest(authority);
  const [restoredPending]=useState(()=>readPending(scope));
  const [pending,setPending]=useState<PendingSend|null>(restoredPending);
  const [source,setSource]=useState(restoredPending?.source || '');
  const [title,setTitle]=useState(restoredPending?.title || '');
  const [audienceType,setAudienceType]=useState<'all'|'crew'>(restoredPending?.audience.type || 'all');
  const [crewId,setCrewId]=useState(restoredPending?.audience.type==='crew'?restoredPending.audience.crewId:'');
  const [responseMode,setResponseMode]=useState<Mode>(restoredPending?.responseMode || 'question');
  const [deliveryMode,setDeliveryMode]=useState<Delivery>(restoredPending?.deliveryMode || 'both');
  const [audience,setAudience]=useState<AudienceOverview|null>(null);
  const [audienceError,setAudienceError]=useState('');
  const [result,setResult]=useState<SendResult|null>(null);
  const [retryReceipt,setRetryReceipt]=useState<{requestId:string;retried:number;released:number}|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const requestId=useRef(restoredPending?.requestId || crypto.randomUUID());
  const sending=useRef(false);
  const sentNotice=useRef(false);
  const trimmedSource=source.trim(),derivedTitle=derivedInstructionTitle(trimmedSource);
  const effectiveTitle=(title.trim() || derivedTitle).slice(0,titleMax);
  const audienceChoice:AudienceChoice=audienceType==='crew'?{type:'crew',crewId}:{type:'all'};
  const titleValid=effectiveTitle.length>=3;
  const canSubmit=trimmedSource.length>=sourceMin && trimmedSource.length<=sourceMax && titleValid
    && (audienceType==='all' || crewId.length>0) && audience!==null && audience.workers.total>0 && !busy && !pending;

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
    const timer=window.setTimeout(()=>{void checkStatus(result.requestId);},3000);
    return()=>window.clearTimeout(timer);
  },[result?.requestId,result?.state,result?.deliveryStates?.preparing]);

  useEffect(()=>{
    if(result?.state==='published' && !sentNotice.current){sentNotice.current=true;onSent();}
  },[result?.state,onSent]);

  function reset(){
    clearPending(scope);setPending(null);setResult(null);setRetryReceipt(null);setError('');
    setSource('');setTitle('');setAudienceType('all');setCrewId('');setResponseMode('question');setDeliveryMode('both');
    sentNotice.current=false;requestId.current=crypto.randomUUID();
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
        clearPending(scope);setPending(null);setError('');
        setError('No send was recorded. Review the instruction and send again.');
      }else setError(reason instanceof Error?reason.message:'Send status unavailable.');
    }finally{sending.current=false;setBusy(false);}
  }

  async function submit(){
    if(!canSubmit || sending.current || !current())return;
    const value:PendingSend={requestId:requestId.current,title:effectiveTitle,source:trimmedSource,audience:audienceChoice,responseMode,deliveryMode,savedAt:Date.now()};
    sending.current=true;setBusy(true);setError('');savePending(scope,value);setPending(value);
    try {
      const sent=await request<SendResult>('/api/instructions/send',{
        requestId:value.requestId,title:value.title,source:value.source,audience:value.audience,responseMode:value.responseMode,deliveryMode:value.deliveryMode,
      });
      if(!current())return;
      setResult(sent);
      if(sent.state==='published' || sent.state==='failed'){clearPending(scope);setPending(null);}
      if(sent.state==='failed')setError(sent.error || 'The instruction could not be sent.');
    }catch(reason){
      if(!current())return;
      const uncertain=reason instanceof StaffRequestError && reason.uncertain;
      if(!uncertain){clearPending(scope);setPending(null);requestId.current=crypto.randomUUID();}
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
    return <><div className="page-header"><div><h1>{result.state==='failed'?'Instruction not sent':'Instruction sent'}</h1><p>{result.state==='preparing'?'Preparation is still running. This page checks again automatically.':partial?'The ready language versions were delivered. Not every selected worker could receive this instruction.':'The send is recorded. Recipient status is available in the instruction.'}</p></div><button className="button outline" onClick={()=>navigate('briefings')}><ArrowLeft size={19}/>Instructions</button></div>
      {error && <div className="notice notice-amber" role="alert">{error}</div>}
      {result.state==='published' && <section className="panel send-result" aria-labelledby="send-result-title">
        <div className="receipt-mark" aria-hidden="true"><CheckCircle2 size={42}/></div>
        <h2 id="send-result-title">{result.duplicate?'Send already recorded':'Send recorded'}</h2>
        <dl className="worker-receipt-meta">
          <div><dt>Delivery</dt><dd>{result.responseMode==='acknowledge'?'Acknowledge receipt':'Question and answer'}</dd></div>
          <div><dt>Format</dt><dd>{result.deliveryMode==='both'?'Text and voice':result.deliveryMode==='voice'?'Voice':'Text'}</dd></div>
          <div><dt>Delivered</dt><dd>{result.delivered} of {result.audience.count}</dd></div>
          {result.undelivered>0 && <div><dt>Not delivered</dt><dd>{result.undelivered}</dd></div>}
          {!!result.deliveryStates?.preparing && <div><dt>Still preparing</dt><dd>{result.deliveryStates.preparing}</dd></div>}
        </dl>
        {retryReceipt && <div className="notice" role="status"><strong>Retry recorded.</strong> {retryReceipt.retried} unfinished {retryReceipt.retried===1?'delivery was':'deliveries were'} rechecked{retryReceipt.released>0?` and ${retryReceipt.released} ${retryReceipt.released===1?'recipient now has':'recipients now have'} this instruction`:''}.</div>}
        {result.undelivered>0 && <div className="notice notice-amber" role="status"><strong>Partly sent.</strong> {result.undelivered} of {result.audience.count} selected workers did not receive this instruction.<ul className="send-reasons">{result.undeliveredReasons.map((reason,index)=><li key={`${reason.reason}:${reason.language}:${index}`}>{reasonText(reason)} · {reason.count}</li>)}</ul>
          {result.retryable && <div className="actions"><button className="button primary" disabled={busy} onClick={()=>void retryUndelivered()}><RefreshCw size={19}/>{busy?'Retrying...':'Retry undelivered'}</button></div>}
        </div>}
        <div className="actions"><button className="button primary" onClick={()=>navigate(`briefings/${result.briefingId}`)}>Open instruction<ChevronRight size={19}/></button><button className="button outline" disabled={busy} onClick={reset}><Send size={19}/>Send another</button></div>
      </section>}
      {result.state==='preparing' && <section className="panel send-result" aria-live="polite"><h2>Preparing instruction</h2><p>Content and language versions are being prepared. This does not block the screen; the status will refresh automatically.</p><div className="actions"><button className="button primary" disabled={busy} onClick={()=>void checkStatus(result.requestId)}><RefreshCw size={19}/>{busy?'Checking...':'Check status'}</button><button className="button outline" disabled={busy} onClick={()=>navigate('briefings')}>View instructions</button></div></section>}
      {result.state==='failed' && <section className="panel send-result"><p>No instruction was delivered. {result.error || 'Review the source and try again.'}</p><div className="actions"><button className="button primary" disabled={busy} onClick={reset}><Send size={19}/>Start again</button><button className="button outline" onClick={()=>navigate('briefings')}>Instructions</button></div></section>}
    </>;
  }

  return <>
    <div className="page-header"><div><h1>Send an instruction</h1><p>Write the instruction, choose who needs it, and send. Preparation and translation run in the background.</p></div><button className="button outline" onClick={()=>navigate('briefings')}><ArrowLeft size={19}/>Instructions</button></div>
    {pending && !error && <div className="notice notice-amber" role="status"><strong>An earlier send was not confirmed.</strong> Check its receipt before sending again. <button className="button outline" disabled={busy} onClick={()=>void checkStatus(pending.requestId)}><RefreshCw size={18}/>Check receipt</button></div>}
    {pending && error && <div className="notice notice-amber" role="status"><strong>Send outcome not confirmed.</strong> The original request is retained. Check its receipt rather than repeating it. <div className="actions"><button className="button outline" disabled={busy} onClick={()=>void checkStatus(pending.requestId)}><RefreshCw size={18}/>Check receipt</button><button className="button outline" disabled={busy} onClick={reset}>Discard request</button></div></div>}
    {error && !pending && <div className="notice notice-amber" role="alert">{error}</div>}
    <section className="panel send-composer" aria-labelledby="send-source-title">
      <label className="field" htmlFor="send-source"><span id="send-source-title">Instruction</span>
        <textarea id="send-source" rows={7} maxLength={sourceMax} value={source} disabled={busy || !!pending} onChange={event=>setSource(event.target.value)} placeholder="Example: Move the red ladder to the north bay before the night shift. Keep the walkway clear." />
      </label>
      <p className="muted send-counter">{trimmedSource.length < sourceMin ? `At least ${sourceMin} characters.` : `${trimmedSource.length} / ${sourceMax}`}{effectiveTitle ? <> · Title: <strong>{effectiveTitle}</strong></> : null}</p>
      <label className="field">Who should receive it?
        <select value={audienceType==='crew'?`crew:${crewId}`:'all'} disabled={busy || !!pending} onChange={event=>{
          const value=event.target.value;
          if(value==='all'){setAudienceType('all');setCrewId('');}
          else {setAudienceType('crew');setCrewId(value.slice(5));}
        }}>
          <option value="all">All active workers{audience?` (${audience.workers.total})`:''}</option>
          {(audience?.crews || []).map(crew=><option key={crew.id} value={`crew:${crew.id}`}>{crew.name} ({crew.members})</option>)}
        </select>
      </label>
      {audience && <div className="language-chips send-audience-languages" aria-label="Worker languages">{Object.entries(audience.workers.byLanguage).filter(([,count])=>count>0).map(([code,count])=><i key={code}>{code.toUpperCase()} {count}</i>)}</div>}
      {audienceError && <p className="notice notice-amber" role="alert">{audienceError}</p>}
      {audience && audience.workers.total===0 && <p className="notice notice-amber" role="status">There are no active workers at this site yet.</p>}

      <div className="send-option-grid">
        <label className="send-toggle">
          <input type="checkbox" checked={responseMode==='question'} disabled={busy || !!pending} onChange={event=>setResponseMode(event.target.checked?'question':'acknowledge')}/>
          <span><strong>Include a question</strong><small>{responseMode==='question'?'Workers answer in their own words. Answers receive a synthetic keyword check.':'Workers confirm receipt only. No answer or comprehension result is created.'}</small></span>
        </label>
        <fieldset className="send-delivery" disabled={busy || !!pending}>
          <legend>Delivery format</legend>
          <div className="segmented send-delivery-options">
            {(['text','voice','both'] as Delivery[]).map(mode=><button type="button" key={mode} className={deliveryMode===mode?'selected':''} aria-pressed={deliveryMode===mode} onClick={()=>setDeliveryMode(mode)}>{mode==='text'?'Text only':mode==='voice'?'Voice only':'Both'}</button>)}
          </div>
        </fieldset>
      </div>

      <details className="send-more">
        <summary>More options</summary>
        <label className="field">Title (optional)<input type="text" maxLength={titleMax} value={title} disabled={busy || !!pending} onChange={event=>setTitle(event.target.value)} placeholder={derivedTitle || 'A short title from the instruction'} /></label>
        <p className="muted">Recording, upload, templates, scheduling, and the full version history remain available in advanced tools. The durable send is recorded before preparation starts.</p>
        <div className="actions"><button type="button" className="button outline" disabled={busy || !!pending} onClick={()=>navigate('briefings/new')}><FileText size={19}/>Record or upload source</button><button type="button" className="button outline" disabled={busy || !!pending} onClick={()=>navigate('templates')}><FileText size={19}/>Templates</button></div>
      </details>

      <div className="send-submit">
        <span className="muted"><Users size={17}/> {audience?"Recipients are resolved when you send; later joiners are not added automatically.":'Loading recipients...'}</span>
        <button className="button primary" disabled={!canSubmit} onClick={()=>void submit()}>{busy?'Sending...':<><Send size={20}/>Send instruction</>}</button>
      </div>
      {!titleValid && trimmedSource.length>=sourceMin && <p className="notice notice-amber" role="status">Add a title of at least 3 characters.</p>}
      {trimmedSource.length>sourceMax && <p className="notice notice-amber" role="status">The instruction must be {sourceMax} characters or fewer.</p>}
    </section>
  </>;
}
