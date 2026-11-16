import {useEffect,useRef,useState,type RefObject} from 'react';
import {ArrowLeft,RefreshCw} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {checkedClarificationFlow,clarificationFlowCopy,readClarificationCommand,type ClarificationFlow} from './clarification-flow';
import type {MessageSession} from './case-message-recovery';
import type {CaseLocale} from './clarification-locale';
import './clarifications-inbox.css';
import './simple-clarifications.css';

type Shared={refresh:number;navigate:(path:string)=>void;authority:StaffRequestAuthority;canWrite?:boolean;timezone?:string;language?:CaseLocale;onLanguageChange?:(language:CaseLocale)=>void};
export function ClarificationsPage({refresh,navigate,authority,language='en'}:Shared){
  const t=clarificationFlowCopy(language),api=useStaffRequest(authority),[data,setData]=useState<{rows:{id:string;worker:string;title:string}[];total:number}|null>(null),[tick,setTick]=useState(0),[error,setError]=useState(false),[page,setPage]=useState(1);
  useEffect(()=>{let live=true;const controller=new AbortController();setError(false);
    api.request<{rows:{id:string;worker:string;title:string}[];total:number;clientContext:string;page:number}>(`/api/clarification-flow?page=${page}`,undefined,controller.signal).then(value=>{if(value.clientContext!==authority.session.clientContext||value.page!==page||!Array.isArray(value.rows))throw Error('Unverified clarification list');if(live&&api.current())setData(value);}).catch(()=>{if(live)setError(true);});
    const timer=window.setTimeout(()=>{if(document.visibilityState==='visible')setTick(n=>n+1);},10000);
    return()=>{live=false;controller.abort();window.clearTimeout(timer);};
  },[api,page,tick,refresh]);
  return <div className="simple-clarifications" lang={language} dir={language==='ar'?'rtl':'ltr'}><header className="page-header"><h1>{t.title}</h1><button className="icon-button" title={t.retry} aria-label={t.retry} onClick={()=>setTick(n=>n+1)}><RefreshCw size={18}/></button></header>
    {error&&<p role="alert">{t.error}</p>}{!data&&!error&&<p role="status">{t.preparing}</p>}
    {data&&<section className="panel"><div className="row-list">{data.rows.map(item=><button type="button" className="simple-clarification-row" key={item.id} onClick={()=>navigate(`clarifications/${item.id}`)}><strong>{item.worker}</strong><span>{item.title}</span><span className="status status-amber">{t.pending}</span></button>)}</div>{!data.rows.length&&<p>{t.empty}</p>}</section>}
    <div className="actions"><button className="button outline" disabled={page===1} onClick={()=>{setData(null);setPage(n=>n-1);}}>{language==='ar'?'السابق':'Previous'}</button><button className="button outline" disabled={!data||page*20>=data.total} onClick={()=>{setData(null);setPage(n=>n+1);}}>{language==='ar'?'التالي':'Next'}</button></div>
  </div>;
}
type DetailProps=Shared&{id:string;session:MessageSession;navigationGuard:RefObject<((next:string,resume?:()=>void)=>boolean)|null>};
export function ClarificationPage({id,refresh,navigate,authority,canWrite=false,language='en',navigationGuard}:DetailProps){
  const t=clarificationFlowCopy(language),api=useStaffRequest(authority),[data,setData]=useState<ClarificationFlow|null>(null),[tick,setTick]=useState(0),[text,setText]=useState(''),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const pending=useRef<{requestId:string;text:string}|null>(null),active=useRef(true),sending=useRef(false),path=`/api/clarifications/${encodeURIComponent(id)}/clarification-flow`;
  const recoveryKey=`u:clarification-flow:${authority.session.clientContext}:${path}`;
  useEffect(()=>{try{const retained=readClarificationCommand(recoveryKey);if(retained){pending.current=retained;setText(retained.text);}}catch{setError(true);}},[recoveryKey]);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>{let live=true;const controller=new AbortController();
    api.request<unknown>(path,undefined,controller.signal).then(value=>{if(live&&api.current()){const checked=checkedClarificationFlow(value,authority.session.clientContext!);setData(checked);setError(false);if(pending.current&&checked.items.some(item=>item.id===pending.current?.requestId)){sessionStorage.removeItem(recoveryKey);pending.current=null;setText('');}}}).catch(()=>{if(live)setError(true);});
    const timer=window.setTimeout(()=>{if(document.visibilityState==='visible')setTick(n=>n+1);},5000);
    return()=>{live=false;controller.abort();window.clearTimeout(timer);};
  },[api,id,refresh,tick]);
  useEffect(()=>{const guard=(next:string)=>!text.trim()&&!busy||next===`clarifications/${id}`;navigationGuard.current=guard;
    const warn=(event:BeforeUnloadEvent)=>{if(text.trim()||busy){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);
    return()=>{if(navigationGuard.current===guard)navigationGuard.current=null;window.removeEventListener('beforeunload',warn);};
  },[text,busy,id,navigationGuard]);
  async function send(){
    if(sending.current||!canWrite||!authority.canMutate()||text.trim().length<3)return;
    const command=pending.current??{requestId:crypto.randomUUID(),text:text.trim()};pending.current=command;sending.current=true;setBusy(true);setError(false);
    try{sessionStorage.setItem(recoveryKey,JSON.stringify(command));const value=await api.request<{id:string;clientContext:string}>(path,command);if(value.id!==command.requestId||value.clientContext!==authority.session.clientContext)throw Error('Unverified clarification receipt');
      sessionStorage.removeItem(recoveryKey);pending.current=null;if(active.current){setText('');setTick(n=>n+1);}}
    catch{if(active.current)setError(true);}finally{sending.current=false;if(active.current)setBusy(false);}
  }
  const items=data?.items.filter(item=>item.attemptId===data.attemptId)??[],request=items.find(item=>item.kind==='request'),reply=items.find(item=>item.kind==='explanation');
  return <div className="simple-clarifications" lang={language} dir={language==='ar'?'rtl':'ltr'}><button className="back-link" disabled={busy||!!text.trim()} onClick={()=>navigate('clarifications')}><ArrowLeft size={18}/>{t.title}</button>
    {error&&<p role="alert">{t.error}</p>}{!data&&!error&&<p role="status">{t.preparing}</p>}
    {data&&<><header className="page-header"><div><h1>{data.worker}</h1><p>{data.title}</p></div><button className="icon-button" aria-label={t.retry} onClick={()=>setTick(n=>n+1)}><RefreshCw size={18}/></button></header>
      <section className="panel"><h2>{t.instruction}</h2><p className="briefing-text" dir="auto">{data.instruction}</p><h3>{t.question}</h3><p dir="auto">{data.question}</p><h3>{t.wrong}</h3><p dir="auto">{data.answer}</p></section>
      <section className="panel"><h2>{t.request}</h2>{request?.state==='delivered'?<p className="briefing-text" dir="auto" lang={request.language}>{request.text}</p>:<p role="status">{request?.state==='failed'?t.failed:request?t.preparing:t.waiting}</p>}</section>
      {reply?<section className="panel"><h2>{t.explanation}</h2><p dir="auto">{reply.originalText}</p><p role="status">{reply.state==='delivered'?t.delivered:reply.state==='failed'?t.failed:t.saved}</p>{reply.state==='failed'&&reply.originalText&&canWrite&&<button type="button" className="button outline" disabled={busy} onClick={async()=>{if(sending.current)return;sending.current=true;setBusy(true);try{await api.request(path,{requestId:reply.id,text:reply.originalText});setTick(n=>n+1);}catch{setError(true);}finally{sending.current=false;setBusy(false);}}}>{t.followup}</button>}</section>:canWrite&&request?.state==='delivered'&&data.outcome==='clarification'&&data.status==='open'&&<form className="panel" onSubmit={event=>{event.preventDefault();void send();}}><label className="field">{t.write}<textarea required minLength={3} maxLength={500} rows={4} value={text} readOnly={busy||!!pending.current} onChange={event=>setText(event.target.value)} dir="auto"/></label><p className="muted">{language==='ar'?'سيُترجم الشرح تلقائياً إلى لغة العامل، مع إعادة السؤال.':'The explanation is translated into the worker’s language and sent with another attempt at the question.'}</p><button className="button primary" disabled={busy||text.trim().length<3}>{t.followup}</button></form>}
    </>}
  </div>;
}
