import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Search,FileText,UserRound,Users,ChevronLeft,ChevronRight,ArrowLeft,ArrowRight,RefreshCw} from 'lucide-react';
import {checkedSearchPage,searchDestination,searchRoute,searchRouteQuery,type SearchPage,type SearchKind} from './staff-search';

export default function StaffSearch({route,context,canPeople,navigate}:{route:string;context:string;canPeople:boolean;navigate:(path:string)=>void}){
  const staffT=useStaffStaticText();
  let initial='',routeError='';try{initial=searchRouteQuery(route);}catch(reason){routeError=(reason as Error).message;}
  const [query,setQuery]=useState(initial),[kind,setKind]=useState<'all'|SearchKind>('all'),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
  const [data,setData]=useState<SearchPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(routeError);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{
    if(!initial || routeError)return;
    const controller=new AbortController();setData(null);setError('');setBusy(true);
    const params=new URLSearchParams({query:initial,kind,page:String(page)});
    fetch(`/api/search?${params}`,{credentials:'include',cache:'no-store',signal:controller.signal,headers:{'x-client-session-context':context}})
      .then(async response=>{const value=await response.json();if(!response.ok)throw Error(value?.error || 'Search unavailable.');
        const checked=checkedSearchPage(value,{query:initial,kind,page});if(!controller.signal.aborted)setData(checked);})
      .catch(reason=>{if(!controller.signal.aborted)setError((reason as Error).message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[initial,routeError,context,kind,page,refresh]);
  const pages=Math.max(1,Math.ceil((data?.total??0)/20)),labels={briefing:staffT("Instructions"),worker:staffT("Workers"),crew:staffT("Crews")};
  const categories:('all'|SearchKind)[]=['all','briefing',...(canPeople?['worker','crew'] as SearchKind[]:[])];
  function submit(event:FormEvent){event.preventDefault();if(query.trim())navigate(searchRoute(query));}
  return <section className="staff-search-view"><button className="back-link" onClick={()=>navigate('overview')}><ArrowLeft size={18}/>{staffT("Today")}</button><div className="page-header"><h1 ref={heading} tabIndex={-1}>{staffT("Search")}</h1></div>
    <form className="staff-search-form" role="search" onSubmit={submit}><label className="search-box"><Search size={20}/><input autoComplete="off" aria-label={staffT("Search this site")} type="search" value={query} onChange={event=>setQuery(event.target.value)} maxLength={80} required placeholder={canPeople?staffT("Search instructions, people..."):staffT("Search instructions...")}/></label><button className="icon-button" type="submit" title={staffT("Search")} aria-label={staffT("Submit search")}><ArrowRight size={21}/></button></form>
    {initial && <><nav className="briefing-detail-tabs" aria-label={staffT("Search categories")}>{categories.map(category=><button key={category} aria-pressed={kind===category} onClick={()=>{setData(null);setKind(category);setPage(1);}}>{category==='all'?staffT("All"):labels[category]}{data && ` (${category==='all'?Object.values(data.counts).reduce((n,value)=>n+value,0):data.counts[category]})`}</button>)}</nav>
    {busy?<p role="status">{staffT("Searching...")}</p>:error?<div role="alert"><p>{staffT.error(error)}</p><button className="button outline" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={18}/>{staffT("Retry search")}</button></div>:data && <>
      <p role="status" className="muted">{staffT.number(data.total)} {data.total===1?staffT("result"):staffT("results")} {staffT("for")} <bdi>{initial}</bdi></p>
      {data.items.length?<ul className="staff-search-results">{data.items.map(item=>{const Icon=item.kind==='briefing'?FileText:item.kind==='worker'?UserRound:Users;return <li key={`${item.kind}:${item.id}`}><button className="item-row" onClick={()=>navigate(searchDestination(item))}><span className="small-avatar"><Icon size={21}/></span><span className="item-main"><strong><bdi>{item.label}</bdi></strong><small>{labels[item.kind]} · {staffT.state(item.status)}</small></span><ArrowRight size={18}/></button></li>;})}</ul>:<p>{staffT("No results on this page.")}</p>}
      <div className="audit-pagination"><span>{staffT("Page")} {staffT.number(page)} {staffT("of")} {staffT.number(pages)}</span><div className="actions"><button className="icon-button" title={staffT("Previous search results")} aria-label={staffT("Previous search results")} disabled={page===1} onClick={()=>{setData(null);setPage(n=>n-1);}}><ChevronLeft size={19}/></button><button className="icon-button" title={staffT("Next search results")} aria-label={staffT("Next search results")} disabled={page>=pages} onClick={()=>{setData(null);setPage(n=>n+1);}}><ChevronRight size={19}/></button>{page>pages && <button className="button outline" onClick={()=>{setData(null);setPage(1);}}>{staffT("First page")}</button>}</div></div>
    </>}</>}{!initial && routeError && <p role="alert">{routeError}</p>}
  </section>;
}
