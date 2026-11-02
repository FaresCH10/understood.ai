import {useStaffText as useStaffStaticText} from './staff-language';
import {useState} from 'react';
import {Award,ChevronLeft,ChevronRight,RefreshCw,Search} from 'lucide-react';
import {useArtifactRead} from './useArtifactRead';
import type {StaffRequestAuthority} from './useStaffRequest';

type Competency={id:string;workerId:string;workerName:string;workerCode:string;briefingId:string;briefingTitle:string;publicationVersion:number;
  title:string;language:string;source:string;awardedAt:string;expiresAt:string;status:'active'|'expiring'|'expired'};
type CompetencyPage={items:Competency[];total:number;page:number;pageSize:number;counts:{active:number;expiring:number;expired:number};asOf:string};
type Status='active'|'expiring'|'expired'|'all';

export function CompetenciesPage({authority,refresh}:{authority:StaffRequestAuthority;refresh:number}) {
  const staffT=useStaffStaticText();
  const [status,setStatus]=useState<Status>('active'),[search,setSearch]=useState(''),[page,setPage]=useState(1),[tick,setTick]=useState(0);
  const query=new URLSearchParams({status,search,page:String(page),pageSize:'20'});
  const {data,loading,error}=useArtifactRead<CompetencyPage>(authority,`/api/competencies?${query}`,refresh+tick);
  const pages=Math.max(1,Math.ceil((data?.total || 0)/20));
  const tabs:Status[]=['active','expiring','expired','all'];
  const label=(value:Status)=>value==='all'?staffT("All"):value==='expiring'?staffT("Expiring soon"):value==='expired'?staffT("Expired"):staffT("Active");
  const count=(value:Status)=>value==='all'?(data?data.counts.active+data.counts.expiring+data.counts.expired:0):data?.counts[value]||0;
  const tone=(value:string)=>value==='expired'?'red':value==='expiring'?'amber':'green';
  const empty=(value:Status)=>value==='active'?staffT("No active certificates."):value==='expiring'?staffT("No certificates are expiring in the next 30 days."):value==='expired'?staffT("No expired certificates."):staffT("No certificates match this view.");
  return <section className="competency-page">
    <div className="page-header"><div><h1>{staffT("Competencies")}</h1><p>{staffT("Certificates recorded when a worker's answer matched the key facts.")}</p></div><button type="button" className="icon-button" title={staffT("Refresh competencies")} aria-label={staffT("Refresh competencies")} disabled={loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={18}/></button></div>
    <nav className="briefing-status-tabs" aria-label={staffT("Competency views")}>{tabs.map(value=><button key={value} type="button" aria-pressed={status===value} onClick={()=>{setStatus(value);setPage(1);}}>{label(value)} <span className="competency-tab-count">{staffT.number(count(value))}</span></button>)}</nav>
    <div className="filters"><label className="search-box"><Search size={18}/><span className="sr-only">{staffT("Search worker, certificate, or instruction")}</span><input value={search} maxLength={80} placeholder={staffT("Search worker, certificate, or instruction")} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label></div>
    {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
    {loading ? <p role="status">{staffT("Loading competencies...")}</p> : data?.items.length ? <div className="competency-list" aria-busy={loading}>{data.items.map(item=><article className="competency-row" key={item.id}>
      <div className="competency-row-main"><strong>{item.title}</strong><span>{item.workerName || staffT("Worker")}{item.workerCode?` · ${item.workerCode}`:''}</span><small>{item.briefingTitle} · {staffT("Version {p0}",{p0:staffT.number(item.publicationVersion)})}</small></div>
      <dl className="competency-row-dates"><div><dt>{staffT("Awarded")}</dt><dd>{staffT.date(item.awardedAt)}</dd></div><div><dt>{staffT("Expires")}</dt><dd>{staffT.date(item.expiresAt)}</dd></div></dl>
      <span className={`status status-${tone(item.status)}`}><span className="status-dot"/>{label(item.status)}</span>
    </article>)}</div> : <p className="empty-state">{empty(status)}</p>}
    {data && data.total>0 && <div className="audit-pagination"><span>{staffT("Page")} {staffT.number(page)} {staffT("of")} {staffT.number(pages)} · {staffT.number(data.total)}</span><div className="actions"><button type="button" className="icon-button" aria-label={staffT("Previous competencies")} title={staffT("Previous competencies")} disabled={loading || page<=1} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={18}/></button><button type="button" className="icon-button" aria-label={staffT("Next competencies")} title={staffT("Next competencies")} disabled={loading || page>=pages} onClick={()=>setPage(value=>value+1)}><ChevronRight size={18}/></button></div></div>}
    <div className="competency-foot"><Award size={18} aria-hidden="true"/><div><p>{staffT("A certificate records a matched answer, not proof of safe work.")}</p><p className="muted">{staffT("Expiring soon means the certificate expires within 30 days.")}</p></div></div>
  </section>;
}
