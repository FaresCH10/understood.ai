import {useEffect,useRef,useState,type RefObject} from 'react';
import {ArrowLeft,ChevronRight,FileText,MessageSquareText,RefreshCw,Send} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {checkedClarificationFlow,clarificationFlowCopy,clarificationMessageCopy,readClarificationCommand,type ClarificationFlow,type ClarificationExchange} from './clarification-flow';
import {ClarificationMessages} from './ClarificationMessages';
import type {MessageSession} from './case-message-recovery';
import type {CaseLocale} from './clarification-locale';
import './clarifications-inbox.css';
import './simple-clarifications.css';

type Shared={refresh:number;navigate:(path:string)=>void;authority:StaffRequestAuthority;canWrite?:boolean;timezone?:string;language?:CaseLocale;onLanguageChange?:(language:CaseLocale)=>void};
export function ClarificationsPage({refresh,navigate,authority,language='en'}:Shared){
  const t=clarificationFlowCopy(language),copy=clarificationMessageCopy(language),api=useStaffRequest(authority),[data,setData]=useState<{rows:{id:string;worker:string;title:string}[];total:number}|null>(null),[tick,setTick]=useState(0),[error,setError]=useState(false),[page,setPage]=useState(1);
  useEffect(()=>{let live=true;const controller=new AbortController();setError(false);
    api.request<{rows:{id:string;worker:string;title:string}[];total:number;clientContext:string;page:number}>(`/api/clarification-flow?page=${page}`,undefined,controller.signal).then(value=>{if(value.clientContext!==authority.session.clientContext||value.page!==page||!Array.isArray(value.rows))throw Error('Unverified clarification list');if(live&&api.current())setData(value);}).catch(()=>{if(live)setError(true);});
    const timer=window.setTimeout(()=>{if(document.visibilityState==='visible')setTick(n=>n+1);},10000);
    return()=>{live=false;controller.abort();window.clearTimeout(timer);};
  },[api,page,tick,refresh]);
  return <div className="simple-clarifications clarification-inbox" lang={language} dir={language==='ar'?'rtl':'ltr'}>
    <header className="clarification-page-heading"><div><h1>{t.title}</h1><p>{copy.intro}</p></div><button className="icon-button" title={t.retry} aria-label={t.retry} onClick={()=>setTick(n=>n+1)}><RefreshCw size={18}/></button></header>
    {error&&<p className="clarification-feedback" role="alert">{t.error}</p>}{!data&&!error&&<p role="status">{t.preparing}</p>}
    {data&&<section className="clarification-instruction-list" aria-label={t.title}>
      {data.rows.map(item=><button type="button" className="clarification-instruction-row" key={item.id} onClick={()=>navigate(`clarifications/${item.id}`)}>
        <span className="clarification-instruction-icon" aria-hidden="true"><FileText size={21}/></span><span className="clarification-instruction-label"><strong>{item.title}</strong><span>{item.worker}</span></span><ChevronRight className="directional-icon" size={19} aria-hidden="true"/>
      </button>)}
      {!data.rows.length&&<div className="clarification-empty"><MessageSquareText size={28} aria-hidden="true"/><p>{copy.empty}</p></div>}
    </section>}
    {data&&(page>1||data.total>20)&&<div className="clarification-pagination"><button className="button outline" disabled={page===1} onClick={()=>{setData(null);setPage(n=>n-1);}}>{copy.previous}</button><span>{page}</span><button className="button outline" disabled={page*20>=data.total} onClick={()=>{setData(null);setPage(n=>n+1);}}>{copy.next}</button></div>}
  </div>;
}

type DetailProps=Shared&{id:string;session:MessageSession;navigationGuard:RefObject<((next:string,resume?:()=>void)=>boolean)|null>};
export function ClarificationPage({id,refresh,navigate,authority,canWrite=false,language='en',navigationGuard}:DetailProps){
  const t=clarificationFlowCopy(language),copy=clarificationMessageCopy(language),api=useStaffRequest(authority),[data,setData]=useState<ClarificationFlow|null>(null),[tick,setTick]=useState(0),[text,setText]=useState(''),[error,setError]=useState(false),[busy,setBusy]=useState(false);
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
  async function retryMessage(item:ClarificationExchange){
    if(sending.current||!item.originalText||!authority.canMutate())return;
    sending.current=true;setBusy(true);
    try{await api.request(path,{requestId:item.id,text:item.originalText});if(active.current)setTick(n=>n+1);}catch{if(active.current)setError(true);}finally{sending.current=false;if(active.current)setBusy(false);}
  }
  const items=data?.items??[];
  return <div className="simple-clarifications clarification-detail-simple" lang={language} dir={language==='ar'?'rtl':'ltr'}>
    <button className="back-link" disabled={busy||!!text.trim()} onClick={()=>navigate('clarifications')}><ArrowLeft className="directional-icon" size={17}/>{t.title}</button>
    {error&&<p className="clarification-feedback" role="alert">{t.error}</p>}{!data&&!error&&<p role="status">{t.preparing}</p>}
    {data&&<><header className="clarification-page-heading"><div><h1>{data.title}</h1><p>{data.worker}</p></div><button className="icon-button" aria-label={t.retry} title={t.retry} onClick={()=>setTick(n=>n+1)}><RefreshCw size={18}/></button></header>
      <div className="clarification-detail-card">
        <section className="clarification-instruction-content"><span className="clarification-eyebrow">{t.instruction}</span><p dir="auto">{data.instruction}</p></section>
        {data.outcome==='clarification'&&data.answer&&<section className="clarification-answer"><span className="clarification-eyebrow">{copy.wrong}</span><p dir="auto">{data.answer}</p></section>}
        {items.length>0&&<section className="clarification-correspondence" aria-label={copy.messages}>
          <ClarificationMessages items={items} language={language} timezone={authority.session.timezone} disabled={busy} onRetry={canWrite?item=>void retryMessage(item):undefined}/>
        </section>}
        {canWrite&&data.canMessage&&<form className="clarification-reply-form" onSubmit={event=>{event.preventDefault();void send();}}>
          <label className="field">{copy.reply}<textarea required minLength={3} maxLength={500} rows={4} value={text} readOnly={busy||!!pending.current} placeholder={copy.placeholder} onChange={event=>setText(event.target.value)} dir="auto"/></label>
          <div className="clarification-reply-footer"><p>{copy.note}</p><button className="button primary" disabled={busy||text.trim().length<3}><Send size={16} aria-hidden="true"/>{copy.send}</button></div>
        </form>}
      </div>
    </>}
  </div>;
}
