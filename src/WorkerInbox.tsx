import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,ChevronLeft,ChevronRight,Clock3,FileText,HelpCircle,MessageCircle,RefreshCw,Search} from 'lucide-react';
import {workerJourneyText} from './worker-journey-text';
import {workItemOverdue,workListPath,type WorkFilter,type WorkerWorkPage} from './worker-journey';
import {workerUiDirection,type WorkerUiLanguage} from './worker-ui-language';
import {languageDirection} from '../server/languages.mjs';

export function WorkerInbox({language,clientContext,refresh,filter,onFilter,onOpen,onHelp,onSessionLost,current,disabled,timezone,title,refreshLabel,previousLabel,nextLabel}:{language:WorkerUiLanguage;clientContext:string;refresh:number;filter:WorkFilter;onFilter:(value:WorkFilter)=>void;onOpen:(id:string)=>void;onHelp:()=>void;onSessionLost:()=>void;current:()=>boolean;disabled:boolean;timezone?:string;title:string;refreshLabel:string;previousLabel:string;nextLabel:string}){
 const t=workerJourneyText(language),rtl=workerUiDirection(language)==='rtl',Forward=rtl?ArrowLeft:ArrowRight;
 const [page,setPage]=useState(1),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[tick,setTick]=useState(0);
 const [data,setData]=useState<WorkerWorkPage|null>(null),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false);
 const callbacks=useRef({current,onSessionLost});callbacks.current={current,onSessionLost};
 useEffect(()=>{const controller=new AbortController();setLoading(true);setFailed(false);
  fetch(workListPath(filter,page,search),{credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'x-client-session-context':clientContext}})
   .then(async response=>{if([401,403,409].includes(response.status)){callbacks.current.onSessionLost();throw Error();}if(!response.ok)throw Error();return response.json();})
   .then(value=>{if(!controller.signal.aborted&&callbacks.current.current()){if(!Array.isArray(value.items)||!Number.isInteger(value.total)||!value.counts)throw Error();setData(value);}})
   .catch(()=>{if(!controller.signal.aborted&&callbacks.current.current())setFailed(true);})
   .finally(()=>{if(!controller.signal.aborted&&callbacks.current.current())setLoading(false);});
  return()=>controller.abort();
 },[clientContext,filter,page,search,refresh,tick]);
 const choose=(value:WorkFilter)=>{setPage(1);onFilter(value);};
 const done=filter==='done',pages=Math.max(1,Math.ceil((data?.total||0)/10));
 const counts=data?.counts;
 return <section className="worker-task-inbox" aria-labelledby="worker-task-heading" aria-busy={loading}>
  <header className="worker-page-heading"><div><h1 id="worker-task-heading">{title}</h1><p>{done?t.done:t.active}{counts?` · ${new Intl.NumberFormat(language).format(done?counts.done:counts.active)}`:''}</p></div><button type="button" className="icon-button worker-heading-action" aria-label={refreshLabel} disabled={disabled||loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={20} aria-hidden="true"/></button></header>
  <div className="worker-inbox-main-tabs" role="group" aria-label={title}>
   <button type="button" aria-pressed={!done} disabled={disabled} onClick={()=>choose('active')}>{t.active}{counts&&<span>{counts.active}</span>}</button>
   <button type="button" aria-pressed={done} disabled={disabled} onClick={()=>choose('done')}><Check size={17} aria-hidden="true"/>{t.done}{counts&&<span>{counts.done}</span>}</button>
  </div>
  {!done&&<div className="worker-state-filters" role="group" aria-label={t.active}>{(['active','sent','in-progress','follow-up'] as WorkFilter[]).map(value=><button key={value} type="button" aria-pressed={filter===value} disabled={disabled} onClick={()=>choose(value)}>{value==='active'?t.all:value==='sent'?t.sent:value==='in-progress'?t.progress:t.follow}{value==='follow-up'&&!!counts?.followUp&&<span>{counts.followUp}</span>}</button>)}</div>}
  <form className="worker-inbox-search" role="search" onSubmit={event=>{event.preventDefault();setPage(1);setSearch(query.trim());}}><Search size={18} aria-hidden="true"/><input type="search" name="worker-instruction-search" aria-label={t.search} placeholder={t.search} maxLength={80} value={query} onChange={event=>{setQuery(event.target.value);if(!event.target.value){setSearch('');setPage(1);}}}/><button type="submit" className="icon-button" aria-label={t.search} disabled={disabled||loading}><Forward size={18} aria-hidden="true"/></button></form>
  {loading?<div className="worker-inbox-loading" role="status" aria-label={t.loading}><span/><span/><span/></div>:failed?<div className="empty-state" role="alert"><p>{t.failed}</p><button type="button" className="button outline" onClick={()=>setTick(value=>value+1)}><RefreshCw size={18} aria-hidden="true"/>{refreshLabel}</button></div>:!data?.items.length?<p className="empty-state">{t.empty}</p>:<div className="worker-task-list">{data.items.map(item=>{
   const late=workItemOverdue(item),label=item.status==='done'?t.done:item.status==='in-progress'?t.progress:item.status==='follow-up'?t.follow:t.sent;
   const action=item.status==='done'?t.viewDone:item.hasSupervisorReply?t.reply:item.status==='in-progress'?t.continue:t.open;
   return <a className={`worker-task-card is-${item.status}`} key={item.id} href={`#worker/${item.id}`} onClick={event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();if(!disabled)onOpen(item.id);}}>
    <div className="worker-task-card-top"><span className={`worker-task-state is-${item.status}`}>{item.status==='follow-up'?<MessageCircle size={15} aria-hidden="true"/>:item.status==='done'?<Check size={15} aria-hidden="true"/>:<FileText size={15} aria-hidden="true"/>}{label}</span>{late&&<span className="worker-overdue">{t.overdue}</span>}</div>
    <h2 lang={item.language} dir={languageDirection(item.language)??'ltr'}>{item.title}</h2>
    {item.supervisorName&&<p className="worker-task-sender">{t.from} <bdi>{item.supervisorName}</bdi></p>}
    {item.dueAt&&<p className="worker-task-deadline"><Clock3 size={15} aria-hidden="true"/><time dateTime={item.dueAt}>{new Intl.DateTimeFormat(language,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(item.dueAt))}</time></p>}
    <div className="worker-task-card-action"><span>{action}</span><Forward size={19} aria-hidden="true"/></div>
   </a>;
  })}</div>}
  {!loading&&!failed&&data&&(pages>1||page>1)&&<div className="worker-inbox-pagination"><button type="button" className="icon-button" aria-label={previousLabel} disabled={page<=1||disabled} onClick={()=>setPage(value=>value-1)}>{rtl?<ChevronRight/>:<ChevronLeft/>}</button><span aria-live="polite">{new Intl.NumberFormat(language).format(page)} / {new Intl.NumberFormat(language).format(pages)}</span><button type="button" className="icon-button" aria-label={nextLabel} disabled={page>=pages||disabled} onClick={()=>setPage(value=>value+1)}>{rtl?<ChevronLeft/>:<ChevronRight/>}</button></div>}
  <button type="button" className="worker-inbox-help" disabled={disabled} onClick={onHelp}><HelpCircle size={25} aria-hidden="true"/><span><strong>{t.help}</strong><small>{t.contact}</small></span><Forward size={20} aria-hidden="true"/></button>
 </section>;
}
