import {useEffect,useRef,useState} from 'react';
import {CalendarClock,ChevronLeft,ChevronRight,RefreshCw,X} from 'lucide-react';
import {useBriefingRequest} from './BriefingControls';
import type {StaffRequestAuthority} from './useStaffRequest';

type Schedule={id:string;revision:number;version:number;recipientCount:number;publishAt:string;dueAt:string|null;reminderMinutes:number;state:'queued'|'published'|'cancelled'|'failed';publicationId:string|null;error:string|null;createdAt:string;finishedAt:string|null;attempts:number;retryAt:string|null};
type Page={items:Schedule[];total:number;page:number;pageSize:number;asOf:string};
export default function PublicationSchedules({id,refresh,onChanged,authority,timezone='UTC'}:{id:string;refresh:number;onChanged:()=>void;timezone?:string;authority:StaffRequestAuthority}) {
  const {request,current,complete}=useBriefingRequest(authority);
  const [page,setPage]=useState(1),[tick,setTick]=useState(0),[data,setData]=useState<Page|null>(null),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState(''),[confirmed,setConfirmed]=useState(false);
  const title=useRef<HTMLHeadingElement>(null),inflight=useRef(false);
  const base=`/briefings/${encodeURIComponent(id)}/schedules`;
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setData(null);setError('');setSelected('');setConfirmed(false);
    request<Page>(`${base}?page=${page}`,'GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted && current())setData(value);})
      .catch(err=>{if(!controller.signal.aborted && current())setError(err.message);}).finally(()=>{if(!controller.signal.aborted && current())setLoading(false);});
    return ()=>controller.abort();
  },[base,page,tick,refresh,request,current]);
  async function cancel() {
    if(!confirmed || !selected || inflight.current || !current())return;inflight.current=true;setBusy(true);setError('');
    try {
      const result=await request(`${base}/${encodeURIComponent(selected)}/cancel`,'POST',{confirmed:true});
      await complete(result,value=>value,()=>{setSelected('');setConfirmed(false);setTick(value=>value+1);onChanged();title.current?.focus();});
    }catch(err){if(current()){setError(`${(err as Error).message} Refresh schedules to check the saved outcome.`);setConfirmed(false);}}
    finally {inflight.current=false;if(current())setBusy(false);}
  }
  const pages=Math.max(1,Math.ceil((data?.total || 0)/20));
  const date=(value:string)=>`${new Date(value).toLocaleString('en-GB',{timeZone:timezone,timeZoneName:'shortOffset'})} ${timezone}`;
  return <section className="panel publication-schedules"><div className="panel-heading"><h2 ref={title} tabIndex={-1}>Delivery schedules</h2><button className="icon-button" title="Refresh delivery schedules" aria-label="Refresh delivery schedules" disabled={loading || busy} onClick={()=>setTick(value=>value+1)}><RefreshCw size={18}/></button></div>
    {loading?<p role="status">Loading delivery schedules...</p>:data?.items.length ? <ul className="schedule-list">{data.items.map(row=><li key={row.id}>
      <CalendarClock size={20}/><div><strong>v{row.version} · {row.state==='queued'?'Scheduled':row.state}</strong><p><time dateTime={row.publishAt}>{date(row.publishAt)}</time> · {row.recipientCount} selected workers</p>
      <small>Revision {row.revision}{row.dueAt?` · Response deadline ${date(row.dueAt)}`:''}</small>{row.error && <p role="status" className="record-error">{row.error}</p>}
      {!!row.reminderMinutes && <p>In-app reminder · up to {row.reminderMinutes/60} {row.reminderMinutes===60?'hour':'hours'} before deadline</p>}
      {row.retryAt && <p role="status">Publication retry {row.attempts+1} at {date(row.retryAt)}</p>}
      {row.state==='queued' && <button className="button outline" disabled={busy} onClick={()=>{setSelected(row.id);setConfirmed(false);}}>Cancel schedule</button>}
      {selected===row.id && <div className="schedule-cancel"><label className="recipient-row"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>Cancel this saved schedule for v{row.version}</label><div className="actions"><button className="button outline" disabled={!confirmed || busy} onClick={()=>void cancel()}><X size={18}/>{busy?'Cancelling...':'Confirm cancellation'}</button><button className="icon-button" aria-label="Keep schedule" title="Keep schedule" disabled={busy} onClick={()=>{setSelected('');setConfirmed(false);}}><X size={18}/></button></div></div>}
      </div></li>)}</ul>:!error && <p>No saved delivery schedules.</p>}
    {error && <p role="alert" className="record-error">{error}</p>}
    {data && (pages>1||page>1) && <div className="audit-pagination"><span>Page {page} of {pages} · {data.total} schedules</span><div className="actions"><button className="icon-button" aria-label="Previous schedules" title="Previous schedules" disabled={loading || busy || page<=1} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="Next schedules" title="Next schedules" disabled={loading || busy || page>=pages} onClick={()=>setPage(value=>value+1)}><ChevronRight size={18}/></button></div></div>}
  </section>;
}
