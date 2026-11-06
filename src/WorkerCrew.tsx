import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,CalendarDays,Check,ChevronLeft,ChevronRight,Clock3,FileText,HelpCircle,MessageCircle,RefreshCw,UsersRound} from 'lucide-react';
import {workerCrewText,workerCrewPager} from './worker-crew-text';
import {workerJourneyText} from './worker-journey-text';
import {workerUiDirection,workerUiNativeName,type WorkerUiLanguage} from './worker-ui-language';
import {languageDirection,isWorkerLanguage} from '../server/languages.mjs';
import type {WorkerWorkPage} from './worker-journey';
import {useWorkerSwipeTabs} from './useWorkerSwipeTabs';

const crewTabs = ['instructions', 'members'] as const;
const crewFilters = ['active', 'done'] as const;
type CrewPage={crew:{id:string;name:string;joinedAt:string;activeMembers:number}|null;members:{items:{name:string|null;language:string;isYou:boolean}[];total:number;page:number;pageSize:number};work:WorkerWorkPage|null};
export function WorkerCrew({active=true,language,clientContext,refresh,current,onSessionLost,onOpen,onHelp,disabled,refreshLabel,previousLabel,nextLabel,timezone}:{active?:boolean;language:WorkerUiLanguage;clientContext:string;refresh:number;current:()=>boolean;onSessionLost:()=>void;onOpen:(id:string)=>void;onHelp:()=>void;disabled:boolean;refreshLabel:string;previousLabel:string;nextLabel:string;timezone?:string}){
 const t=workerCrewText(language),pager=workerCrewPager(language),j=workerJourneyText(language),rtl=workerUiDirection(language)==='rtl',Forward=rtl?ArrowLeft:ArrowRight;
 const numbers=new Intl.NumberFormat(language);
 const [tab,setTab]=useState<'instructions'|'members'>('instructions'),[page,setPage]=useState(1),[membersPage,setMembersPage]=useState(1),[status,setStatus]=useState<'active'|'done'>('active'),[tick,setTick]=useState(0);
 const [data,setData]=useState<CrewPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false);
 const callbacks=useRef({current,onSessionLost});callbacks.current={current,onSessionLost};
 useEffect(()=>{if(!active)return;const controller=new AbortController();setLoading(true);setError(false);
  fetch(`/api/workspace/my-crew?${new URLSearchParams({page:String(page),membersPage:String(membersPage),status})}`,{credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'x-client-session-context':clientContext}}).then(async response=>{if([401,403,409].includes(response.status)){if(!controller.signal.aborted&&callbacks.current.current())callbacks.current.onSessionLost();throw Error();}if(!response.ok)throw Error();return response.json();}).then(value=>{if(!controller.signal.aborted&&callbacks.current.current())setData(value);}).catch(()=>{if(!controller.signal.aborted&&callbacks.current.current())setError(true);}).finally(()=>{if(!controller.signal.aborted&&callbacks.current.current())setLoading(false);});return()=>controller.abort();
 },[active,clientContext,page,membersPage,status,refresh,tick]);
 const items=tab==='members'?data?.members:data?.work,total=items?.total||0,currentPage=tab==='members'?membersPage:page,pages=Math.max(1,Math.ceil(total/10));
 const crewIdentity=useRef<string|null>(null);
 useEffect(()=>{if(!data)return;if(crewIdentity.current!==(data.crew?.id??null)){crewIdentity.current=data.crew?.id??null;setPage(1);setMembersPage(1);}else if(currentPage>pages){if(tab==='members')setMembersPage(pages);else setPage(pages);}},[data,pages,currentPage,tab]);
 const chooseStatus = (next: typeof status) => {setStatus(next);setPage(1);};
 const swipeEnabled = active && !disabled && !error && !!data?.crew;
 const tabSwipe = useWorkerSwipeTabs(crewTabs, tab, setTab, {enabled:swipeEnabled,rtl});
 const filterSwipe = useWorkerSwipeTabs(crewFilters, status, chooseStatus, {enabled:swipeEnabled,rtl});
 return <section className="worker-crew" aria-labelledby="worker-crew-title" aria-busy={loading}>
  <header className="worker-page-heading"><UsersRound size={26} aria-hidden="true"/><h1 id="worker-crew-title">{t.title}</h1><button className="icon-button worker-heading-action" type="button" disabled={disabled||loading} aria-label={refreshLabel} onClick={()=>setTick(value=>value+1)}><RefreshCw size={20} aria-hidden="true"/></button></header>
  {error?<div role="alert" className="empty-state"><p>{j.failed}</p><button className="button outline" onClick={()=>setTick(value=>value+1)}>{refreshLabel}</button></div>:loading&&!data?<p data-page-loading role="status">{j.loading}</p>:!data?.crew?<div className="worker-card worker-crew-empty"><UsersRound size={36} aria-hidden="true"/><h2>{t.empty}</h2><p>{t.emptyBody}</p><button className="button outline full" onClick={onHelp}>{t.help}<Forward size={18} aria-hidden="true"/></button></div>:<>
   <div className="worker-crew-identity">
    <h2><bdi>{data.crew.name}</bdi></h2>
    <div className="worker-crew-meta">
     <span><UsersRound size={16} aria-hidden="true"/><span>{t.members} <strong>{numbers.format(data.crew.activeMembers)}</strong></span></span>
     <span><CalendarDays size={16} aria-hidden="true"/><span>{t.joined} <time dateTime={data.crew.joinedAt}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeZone:timezone}).format(new Date(data.crew.joinedAt))}</time></span></span>
    </div>
    <p>{t.managed}</p>
   </div>
   <div className="worker-inbox-main-tabs" role="group" aria-label={t.title}>
    {crewTabs.map(value=><button key={value} type="button" disabled={disabled} aria-pressed={tab===value} onClick={()=>setTab(value)}><span className="worker-tab-title">{t[value]}</span></button>)}
   </div>
   {tab==='instructions'&&<div className="worker-state-filters" role="group" aria-label={t.instructions}>
    {crewFilters.map(value=><button key={value} type="button" disabled={disabled} aria-pressed={status===value} onClick={()=>chooseStatus(value)}>{j[value]} <span>{numbers.format(data.work?.counts[value]??0)}</span></button>)}
   </div>}
   <div {...tabSwipe.handlers}><div className="worker-inbox-results" ref={tabSwipe.panelRef}>
   {tab==='members'?<ul className="worker-crew-members" aria-label={t.members}>{data.members.items.map((member,index)=>{
    const name=member.name||t.member;
    return <li key={`${membersPage}:${index}`} className={member.isYou?'is-current-worker':undefined}>
     <span className="worker-crew-initial" aria-hidden="true">{Array.from(name.trim())[0]}</span>
     <div><strong><bdi>{name}</bdi></strong>{isWorkerLanguage(member.language)&&<small><bdi>{workerUiNativeName(member.language)}</bdi></small>}</div>
     {member.isYou&&<span className="worker-crew-you">{t.you}</span>}
    </li>;
   })}</ul>:<>
    <div {...filterSwipe.handlers}><div ref={filterSwipe.panelRef}>
    {!data.work?.items.length?<p className="empty-state">{t.noInstructions}</p>:<div className="worker-task-list">{data.work.items.map(item=>{
     const label=item.status==='done'?j.done:item.status==='in-progress'?j.progress:item.status==='follow-up'?j.follow:j.sent;
     const StatusIcon=item.status==='done'?Check:item.status==='follow-up'?MessageCircle:FileText;
     return <a className="worker-task-card" href={`#worker/${item.id}`} key={item.id} onClick={event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();if(!disabled)onOpen(item.id);}}>
      <div className="worker-task-card-body">
       <div className="worker-task-card-top"><span className={`worker-task-state is-${item.status}`}><StatusIcon size={15} aria-hidden="true"/>{label}</span></div>
       <h2><bdi lang={item.language} dir={languageDirection(item.language)??'ltr'}>{item.title}</bdi></h2>
       {(item.supervisorName||item.dueAt)&&<div className="worker-task-card-meta">
        {item.supervisorName&&<p className="worker-task-sender">{j.from} <bdi>{item.supervisorName}</bdi></p>}
        {item.dueAt&&<p className="worker-task-deadline"><Clock3 size={15} aria-hidden="true"/><time dateTime={item.dueAt}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(new Date(item.dueAt))}</time></p>}
       </div>}
      </div>
      <div className="worker-task-card-action"><span>{item.status==='done'?j.viewDone:j.open}</span><Forward size={18} aria-hidden="true"/></div>
     </a>;
    })}</div>}
    </div></div>
   </>}
   {pages>1&&<div className="worker-inbox-pagination"><button type="button" className="icon-button" aria-label={pager.previous} disabled={disabled||currentPage<=1} onClick={()=>tab==='members'?setMembersPage(value=>value-1):setPage(value=>value-1)}>{rtl?<ChevronRight/>:<ChevronLeft/>}</button><span aria-live="polite">{numbers.format(currentPage)} / {numbers.format(pages)}</span><button type="button" className="icon-button" aria-label={pager.next} disabled={disabled||currentPage>=pages} onClick={()=>tab==='members'?setMembersPage(value=>value+1):setPage(value=>value+1)}>{rtl?<ChevronLeft/>:<ChevronRight/>}</button></div>}
   {tab==='instructions'&&<p className="worker-crew-scope">{t.scope}</p>}
   </div>
   <button type="button" className="worker-inbox-help" disabled={disabled} onClick={onHelp}><HelpCircle size={22} aria-hidden="true"/><span><strong>{t.help}</strong><small>{j.contact}</small></span><Forward size={18} aria-hidden="true"/></button>
   </div>
  </>}
 </section>;
}
