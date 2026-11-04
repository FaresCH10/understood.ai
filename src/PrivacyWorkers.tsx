import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,RefreshCw,Search,UserRound} from 'lucide-react';
import {WorkerDeletion} from './WorkerDeletion';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {readPrivacyWorkerPage,type PrivacyWorker as Worker,type PrivacyWorkerPage as WorkerPage} from './deletion-state';

const statusLabel={none:'No request',queued:'Queued',complete:'Application cleanup complete'};

export function PrivacyWorkers({authority}:{authority:StaffRequestAuthority}){
  const staffT=useStaffStaticText();
  const {request,current}=useStaffRequest(authority);
  const [data,setData]=useState<WorkerPage|null>(null),[selected,setSelected]=useState<Worker|null>(null);
  const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setData(null);setError('');
    const query=new URLSearchParams({search,status,page:String(page),pageSize:'5'});
    void request(`/api/privacy/workers?${query}`,undefined,controller.signal).then(value=>{
      if(controller.signal.aborted || !current())return;
      const result=readPrivacyWorkerPage(value);
      setData(result);setSelected(current=>result.items.find((worker:Worker)=>worker.id===current?.id) || current || result.items[0] || null);
    }).catch(reason=>{if(!controller.signal.aborted && current())setError(reason.message);}).finally(()=>{if(!controller.signal.aborted && current())setLoading(false);});
    return()=>controller.abort();
  },[search,status,page,refresh,request,current]);
  const pages=Math.max(1,Math.ceil((data?.total || 0)/5));
  return <div className="people-layout privacy-workers-layout">
    <section className="panel" aria-label={staffT("Worker data requests")}>
      <div className="people-panel-heading"><h2>{staffT("Worker data requests")}</h2><button className="icon-button" title={staffT("Refresh worker data requests")} aria-label={staffT("Refresh worker data requests")} disabled={loading} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={18}/></button></div>
      <div className="filters"><label className="search-box"><Search size={18}/><span className="sr-only">{staffT("Find worker data")}</span><input type="search" value={search} maxLength={80} onChange={event=>{setSearch(event.target.value);setPage(1);setSelected(null);}}/></label>
        <label className="select-label">{staffT("Request status")}<select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);setSelected(null);}}><option value="all">{staffT("All workers")}</option><option value="none">{staffT("No request")}</option><option value="queued">{staffT("Queued")}</option><option value="complete">{staffT("Application cleanup complete")}</option></select></label></div>
      {error?<p className="record-error" role="alert">{staffT.error(error)}</p>:loading?<p data-page-loading role="status">{staffT("Loading worker data requests...")}</p>:data?.items.length?<div className="table-wrap"><table className="privacy-workers-table"><thead><tr><th>{staffT("Worker")}</th><th>{staffT("Request status")}</th></tr></thead>
        <tbody>{data.items.map(worker=><tr key={worker.id} className={selected?.id===worker.id?'people-selection':''}><td><button className="people-row-button" aria-pressed={selected?.id===worker.id} disabled={loading} onClick={()=>setSelected(worker)}><UserRound size={18}/><bdi>{worker.code}</bdi></button><small className="muted">{worker.active?staffT("Active"):staffT("Disabled")}</small></td><td>{statusLabel[worker.deletion_status]}</td></tr>)}</tbody></table></div>:<p role="status">{staffT("No workers match these filters.")}</p>}
      <div className="people-pagination"><span>{data?.total || 0} {staffT("workers · Page")} {staffT.number(page)} {staffT("of")} {staffT.number(pages)}</span><div><button className="icon-button" title={staffT("Previous worker data page")} aria-label={staffT("Previous worker data page")} disabled={loading || !!error || page<=1} onClick={()=>{setSelected(null);setPage(page-1);}}><ChevronLeft size={18}/></button><button className="icon-button" title={staffT("Next worker data page")} aria-label={staffT("Next worker data page")} disabled={loading || !!error || page>=pages} onClick={()=>{setSelected(null);setPage(page+1);}}><ChevronRight size={18}/></button>{page>pages&&!loading&&!error&&<button className="button subtle" onClick={()=>{setPage(1);setSelected(null);}}>{staffT("First page")}</button>}</div></div>
    </section>
    {selected&&!error&&<WorkerDeletion authority={authority} key={selected.id} workerId={selected.id} code={selected.code} refresh={refresh} onLocked={()=>{}} onQueued={()=>{if(current())setRefresh(value=>value+1);}}/>}
  </div>;
}
