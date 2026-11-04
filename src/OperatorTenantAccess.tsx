import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,RefreshCw,Search} from 'lucide-react';
import {checkedOperatorAccessReport,operatorCredentialLabels as credentialLabels,type OperatorAccessReport as Report} from './operator-tenant-access';

export default function OperatorTenantAccess({orgId,request}:{orgId:string;request:(path:string)=>Promise<unknown>}) {
  const [search,setSearch]=useState(''),[state,setState]=useState('all'),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
  const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const requestRef=useRef(request);requestRef.current=request;
  useEffect(()=>{let current=true;setReport(null);setError('');setLoading(true);
    const timer=setTimeout(()=>{requestRef.current(`tenant-access?${new URLSearchParams({orgId,search,state,page:String(page)})}`)
      .then(value=>{if(current)setReport(checkedOperatorAccessReport(value,orgId,page));})
      .catch(()=>{if(current)setError('Tenant access is unavailable. Recheck before relying on these states.');})
      .finally(()=>{if(current)setLoading(false);});},200);
    return()=>{current=false;clearTimeout(timer);};
  },[orgId,search,state,page,refresh]);
  return <div className="operator-tenant-access"><div className="page-header"><h2>Worker access · {report?.tenantName??orgId}</h2><button className="icon-button" title="Refresh tenant access" aria-label="Refresh tenant access" disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={20}/></button></div>
    <div className="operations-filters"><label className="field"><span><Search size={16}/>Search worker references or sites</span><input maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><label className="field">Worker state<select value={state} onChange={e=>{setState(e.target.value);setPage(1);}}><option value="all">All workers</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label></div>
    {loading && <p data-page-loading role="status">Loading worker access...</p>}{error && <p role="alert" className="record-error">{error}</p>}
    {report && <><p className="muted">Tenant {report.tenantState} · Observed {new Date(report.asOf).toLocaleString()}</p><div className="operations-table"><table><thead><tr><th>Worker reference</th><th>Site</th><th>Server access</th><th>Last recorded sign-in</th></tr></thead><tbody>{report.items.map(w=><tr key={w.id}><td>{w.reference}<small>{w.enabled?'Enabled':'Disabled'}</small></td><td>{w.siteName}</td><td>{report.tenantState==='suspended'?'Tenant suspended':!w.enabled?'Worker disabled':w.siteState==='archived'?'Site archived':w.admissionState==='paused'?'Site access paused':credentialLabels[w.credentialState]}</td><td>{w.lastSignInAt?new Date(w.lastSignInAt).toLocaleString():'None recorded'}</td></tr>)}</tbody></table>{!report.items.length && <p>No workers match.</p>}</div><div className="operations-pagination"><span>{report.total} workers · Page {page}</span><button className="icon-button" title="Previous worker page" aria-label="Previous worker page" disabled={page===1} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={20}/></button><button className="icon-button" title="Next worker page" aria-label="Next worker page" disabled={page*20>=report.total} onClick={()=>setPage(n=>n+1)}><ChevronRight size={20}/></button></div></>}
  </div>;
}
