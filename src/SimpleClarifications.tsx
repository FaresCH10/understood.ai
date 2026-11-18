import {clarificationDay,clarificationDateAt,shiftClarificationDay} from '../server/clarification-day.mjs';
import {useStaffText} from './staff-language';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {ArrowLeft,ChevronLeft,ChevronRight,FileText,MessageSquareText,RefreshCw,Send} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {checkedClarificationFlow,clarificationFlowCopy,clarificationMessageCopy,readClarificationCommand,type ClarificationFlow,type ClarificationExchange} from './clarification-flow';
import {ClarificationMessages} from './ClarificationMessages';
import type {MessageSession} from './case-message-recovery';
import type {CaseLocale} from './clarification-locale';
import './clarifications-inbox.css';
import './simple-clarifications.css';
import './clarification-workspace.css';

type Shared={allDates?:boolean;briefingId?:string;refresh:number;navigate:(path:string)=>void;authority:StaffRequestAuthority;canWrite?:boolean;timezone?:string;language?:CaseLocale;onLanguageChange?:(language:CaseLocale)=>void};
type ClarificationList={rows:{id:string;worker:string;title:string;createdAt:string;status:string}[];total:number;unread:number;done:number};
export function ClarificationsPage({refresh,navigate,authority,language='en',briefingId,allDates=false}:Shared){
  const staffT=useStaffText(),t=clarificationFlowCopy(language),copy=clarificationMessageCopy(language),api=useStaffRequest(authority),[data,setData]=useState<ClarificationList|null>(null),[tick,setTick]=useState(0),[error,setError]=useState(false),[page,setPage]=useState(1);
  const timezone=authority.session.timezone||'UTC',storageKey=`u:clarification-day:${authority.session.clientContext}`;
  const sectionKey=`${storageKey}:section:${briefingId||(allDates?'inbox':'all')}`;
  const [section,setSection]=useState<'unread'|'done'>(()=>{if(allDates)return 'unread';try{return sessionStorage.getItem(sectionKey)==='done'?'done':'unread';}catch{return 'unread';}});
  useEffect(()=>{try{sessionStorage.setItem(sectionKey,section);}catch{/* Keep browsing when storage is unavailable. */}},[sectionKey,section]);
  const [today,setToday]=useState(()=>clarificationDateAt(Date.now(),timezone));
  const [day,setDay]=useState<string>(()=>{try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');return saved?.today===today&&clarificationDay(saved.day)&&saved.day<=today?saved.day:today;}catch{return today;}});
  const lastToday=useRef(today);
  function selectDay(value:string){try{if(!clarificationDay(value)||value>today)return;setDay(value);setPage(1);setData(null);}catch{/* Keep the last valid date while a native date input is incomplete. */}}
  useEffect(()=>{if(lastToday.current!==today){lastToday.current=today;setDay(today);setPage(1);setData(null);}},[today]);
  useEffect(()=>{if(!briefingId)try{sessionStorage.setItem(storageKey,JSON.stringify({day,today}));}catch{/* Date browsing remains usable when storage is unavailable. */}},[day,today,storageKey,briefingId]);
  useEffect(()=>{const update=()=>setToday(clarificationDateAt(Date.now(),timezone));const timer=window.setInterval(update,30000);const visible=()=>{if(document.visibilityState==='visible'){update();setTick(n=>n+1);}};document.addEventListener('visibilitychange',visible);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[timezone]);
  useEffect(()=>{let live=true;const controller=new AbortController();setError(false);
    api.request<ClarificationList&{clientContext:string;page:number}>(`/api/clarification-flow?page=${page}&section=${section}${briefingId?`&briefingId=${encodeURIComponent(briefingId)}`:allDates?'':`&day=${day}`}`,undefined,controller.signal).then(value=>{if(value.clientContext!==authority.session.clientContext||value.page!==page||!Array.isArray(value.rows)||![value.total,value.unread,value.done].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Unverified clarification list');if(live&&api.current()){const lastPage=Math.max(1,Math.ceil(value.total/20));if(page>lastPage){setPage(lastPage);setData(null);}else setData(value);}}).catch(()=>{if(live)setError(true);});
    const timer=window.setTimeout(()=>{if(document.visibilityState==='visible')setTick(n=>n+1);},10000);
    return()=>{live=false;controller.abort();window.clearTimeout(timer);};
  },[api,page,tick,refresh,briefingId,day,section,allDates]);
  return <div className="simple-clarifications clarification-inbox" lang={language} dir={language==='ar'?'rtl':'ltr'}>
    <header className={`clarification-page-heading${briefingId?'':' page-header'}`}><div>{briefingId?<h2>{t.title}</h2>:<h1>{t.title}</h1>}<p>{briefingId?staffT('Messages about this instruction.'):copy.intro}</p></div><button className="button outline" onClick={()=>setTick(n=>n+1)}><RefreshCw size={17} aria-hidden="true"/>{staffT('Refresh')}</button></header>
    <div className="clarification-inbox-card">
    {!briefingId&&<div className="clarification-inbox-filters">
      <div className="clarification-scope" role="group" aria-label={staffT('Browse clarification dates')}>
        <button type="button" aria-pressed={!allDates} onClick={()=>{if(allDates)navigate('clarifications');}}>{staffT('By date')}</button>
        <button type="button" aria-pressed={allDates} onClick={()=>{if(!allDates)navigate('clarifications/inbox');}}>{staffT('All dates')}</button>
      </div>
    {allDates&&<button className="text-link" onClick={()=>navigate('overview')}>{staffT('Back to Today')}</button>}
    {!allDates&&<nav className="clarification-day-controls" aria-label={staffT('Clarification date')}>
      <div className="clarification-date-navigation">
      <button className="icon-button" title={staffT('Previous day')} aria-label={staffT('Previous day')} onClick={()=>selectDay(shiftClarificationDay(day,-1))}><ChevronLeft className="directional-icon" size={19}/></button>
      <label className="clarification-day-field"><span>{staffT('Date')}</span><input type="date" aria-label={staffT('Clarification date')} max={today} value={day} onChange={event=>selectDay(event.target.value)}/></label>
      <button className="icon-button" title={staffT('Next day')} aria-label={staffT('Next day')} disabled={day>=today} onClick={()=>selectDay(shiftClarificationDay(day,1))}><ChevronRight className="directional-icon" size={19}/></button>
      </div>
      <button className="button outline" disabled={day===today} onClick={()=>selectDay(today)}>{staffT('Today')}</button>
      <span className="clarification-day-timezone">{staffT('Site time')} · <bdi>{timezone}</bdi></span>
    </nav>}
    </div>}
    <div className="clarification-section-toolbar"><div className="briefing-status-tabs clarification-status-tabs" role="group" aria-label={staffT('Clarification status')}>
      {(['unread','done'] as const).map(value=><button type="button" key={value} aria-pressed={section===value} onClick={()=>{if(section!==value){setSection(value);setPage(1);setData(null);}}}>{staffT(value==='unread'?'Unread':'Done')}{data&&<span>{staffT.number(data[value])}</span>}</button>)}
    </div>{!!data&&data.total>1&&<span className="clarification-sort-label">{staffT('Oldest first')}</span>}</div>
    {error&&<p className="clarification-feedback" role="alert">{t.error}</p>}{!data&&!error&&<p className="clarification-list-loading" role="status">{staffT('Loading clarifications...')}</p>}
    {data&&<section className="clarification-instruction-list" aria-label={t.title}>
      {data.rows.map(item=><button type="button" className="clarification-instruction-row" key={item.id} onClick={()=>navigate(`clarifications/${item.id}`)}>
        <span className="clarification-instruction-icon" aria-hidden="true"><FileText size={21}/></span><span className="clarification-instruction-label"><strong>{briefingId?item.worker:item.title}</strong><span className="clarification-instruction-meta">{!briefingId&&<bdi>{item.worker}</bdi>}<time dateTime={item.createdAt} dir="auto">{new Intl.DateTimeFormat(language,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(item.createdAt))}</time></span></span><ChevronRight className="directional-icon" size={19} aria-hidden="true"/>
      </button>)}
      {!data.rows.length&&<div className="clarification-empty"><span className="clarification-empty-icon" aria-hidden="true"><MessageSquareText size={21}/></span><div><h2>{staffT(section==='unread'?'No unread clarification requests.':'No completed clarifications.')}</h2><p>{staffT(section==='done'?'Clarifications move here after your explanation is delivered.':allDates||briefingId?'Worker clarification requests will appear here.':'Use the date controls to review another day.')}</p></div></div>}
    </section>}
    {data&&(page>1||data.total>20)&&<div className="clarification-pagination"><button className="button outline" disabled={page===1} onClick={()=>{setData(null);setPage(n=>n-1);}}>{copy.previous}</button><span>{page}</span><button className="button outline" disabled={page*20>=data.total} onClick={()=>{setData(null);setPage(n=>n+1);}}>{copy.next}</button></div>}
    </div>
  </div>;
}

type DetailProps=Shared&{id:string;session:MessageSession;navigationGuard:RefObject<((next:string,resume?:()=>void)=>boolean)|null>};
export function ClarificationPage({id,refresh,navigate,authority,canWrite=false,language='en',navigationGuard}:DetailProps){
  const t=clarificationFlowCopy(language),copy=clarificationMessageCopy(language),api=useStaffRequest(authority),[data,setData]=useState<ClarificationFlow|null>(null),[tick,setTick]=useState(0),[text,setText]=useState(''),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const pending=useRef<{requestId:string;text:string}|null>(null),active=useRef(true),sending=useRef(false),path=`/api/clarifications/${encodeURIComponent(id)}/clarification-flow`;
  const recoveryKey=`u:clarification-flow:${authority.session.clientContext}:${path}`;
  const previousStatus=useRef<string|undefined>(undefined);
  useEffect(()=>{if(data?.status!==previousStatus.current){previousStatus.current=data?.status;window.dispatchEvent(new Event('understood:clarification-change'));}},[data?.status]);
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
      sessionStorage.removeItem(recoveryKey);pending.current=null;window.dispatchEvent(new Event('understood:clarification-change'));if(active.current){setText('');setTick(n=>n+1);}}
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
