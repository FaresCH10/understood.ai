import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Search,Send,X,Users,RefreshCw,CalendarClock} from 'lucide-react';
import {useBriefingRequest,BriefingRequestError} from './BriefingControls';
import type {StaffRequestAuthority} from './useStaffRequest';
import {savePendingPublication,clearPendingPublication,checkedPublicationResult,type PendingPublication} from './publication-recovery';
import CivilTimeField from './CivilTimeField';
import {publicationTimes} from './civil-time';
import {WORKER_LOCALES} from '../server/languages.mjs';

type Worker={id:string;code:string;language:string;crew_name:string|null};
type WorkerPage={items:Worker[];total:number;page:number;pageSize:number};

type Crew={id:string;name:string;member_count:number};
function CrewRecipients({disabled,onSelected,onLoading,authority}:{disabled:boolean;onSelected:(workers:Worker[])=>boolean;onLoading:(loading:boolean)=>void;authority:StaffRequestAuthority}) {
  const {request,current}=useBriefingRequest(authority);
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[choice,setChoice]=useState<Crew|null>(null);
  const [data,setData]=useState<{items:Crew[];total:number}|null>(null),[loading,setLoading]=useState(true),[adding,setAdding]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
  const addingRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>addingRequest.current?.abort(),[]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setData(null);setError('');
    const query=new URLSearchParams({search,status:'active',page:String(page),pageSize:'20'});
    request<{items:Crew[];total:number}>(`/people/crews?${query}`,'GET',undefined,controller.signal)
      .then(value=>{if(!controller.signal.aborted && current())setData(value);}).catch(reason=>{if(!controller.signal.aborted && current())setError((reason as Error).message);})
      .finally(()=>{if(!controller.signal.aborted && current())setLoading(false);});
    return ()=>controller.abort();
  },[search,page,refresh,request,current]);
  const pages=Math.max(1,Math.ceil((data?.total || 0)/20));
  async function add() {
    if(!choice || addingRequest.current || disabled || !current())return;
    const controller=new AbortController();addingRequest.current=controller;setAdding(true);onLoading(true);setError('');setResult('');
    try {
      const value=await request<{crew:{name:string};items:Worker[]}>(`/people/crews/${encodeURIComponent(choice.id)}/recipients`,'GET',undefined,controller.signal);
      if(!controller.signal.aborted && current()) {
        if(!onSelected(value.items))throw Error('Selected recipients cannot exceed 5,000. Remove recipients before adding this crew.');
        setResult(`${value.items.length} active ${value.items.length===1?'member':'members'} from ${value.crew.name} included in the selection.`);
      }
    } catch(reason) {if(!controller.signal.aborted && current())setError((reason as Error).message);}
    finally {if(!controller.signal.aborted && current()){addingRequest.current=null;setAdding(false);onLoading(false);}}
  }
  return <div className="publish-crews">
    <h3>Crew recipients</h3>
    <label className="field">Find recipient crew<input type="search" value={search} maxLength={80} disabled={disabled || adding} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label>
    <label className="field">Recipient crew<select value={choice?.id || ''} disabled={disabled || adding || loading || !!error} onChange={event=>{setChoice(data?.items.find(crew=>crew.id===event.target.value) || null);setResult('');}}>
      <option value="">Choose a crew</option>{choice && !data?.items.some(crew=>crew.id===choice.id) && <option value={choice.id}>{choice.name} (selected)</option>}
      {data?.items.map(crew=><option key={crew.id} value={crew.id}>{crew.name} ({crew.member_count})</option>)}
    </select></label>
    <div className="audit-pagination"><span role="status">{loading?'Loading recipient crews...':`Page ${page} of ${pages} · ${data?.total || 0} active crews`}</span><div className="actions">
      <button type="button" className="icon-button" title="Previous recipient crews" aria-label="Previous recipient crews" disabled={disabled || adding || loading || !!error || page<=1} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button>
      <button type="button" className="icon-button" title="Next recipient crews" aria-label="Next recipient crews" disabled={disabled || adding || loading || !!error || page>=pages} onClick={()=>setPage(page+1)}><ChevronRight size={18}/></button>
      <button type="button" className="icon-button" title="Refresh recipient crews" aria-label="Refresh recipient crews" disabled={disabled || adding || loading} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={18}/></button>
    </div></div>
    <button type="button" className="button outline" disabled={disabled || adding || loading || !!error || !choice} onClick={()=>void add()}><Users size={18}/>{adding?'Reading crew...':'Add active crew members'}</button>
    {error && <p role="alert" className="record-error">{error}</p>}{result && <p role="status">{result}</p>}
  </div>;
}

export default function PublishForm({id,revision,version,timezone:siteTimezone,scope,onPending,onChanged,authority}:{id:string;revision:number;version:number;timezone:string;scope?:string|null;onPending:(value:PendingPublication)=>void;onChanged:()=>void;authority:StaffRequestAuthority}) {
  const {request,current:sessionCurrent,complete}=useBriefingRequest(authority),sending=useRef(false);
  const [search,setSearch]=useState(''),[language,setLanguage]=useState('all'),[page,setPage]=useState(1);
  const [data,setData]=useState<WorkerPage|null>(null),[selected,setSelected]=useState<Map<string,Worker>>(new Map());
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [stale,setStale]=useState(false);
  const [readingCrew,setReadingCrew]=useState(false);
  const [mode,setMode]=useState('now');
  const [timezone,setTimezone]=useState(siteTimezone),[timingReset,setTimingReset]=useState(0);
  const retry=useRef<{key:string;requestId:string}|null>(null);
  const timingChanged=()=>{setConfirmed(false);setError('');};
  const query=new URLSearchParams({search,language,status:'active',page:String(page),pageSize:'50'}).toString();
  useEffect(() => {
    let current=true;setLoading(true);setData(null);setError('');
    request<WorkerPage>(`/people/workers?${query}`).then((value) => {if(current && sessionCurrent()) setData(value);})
      .catch((err:Error) => {if(current && sessionCurrent()) setError(err.message);}).finally(() => {if(current && sessionCurrent()) setLoading(false);});
    return () => {current=false;};
  },[query,request,sessionCurrent]);
  const pages=Math.max(1,Math.ceil((data?.total || 0)/50));
  const allPage=!!data?.items.length && data.items.every((worker) => selected.has(worker.id));
  const toggle=(workers:Worker[],checked:boolean) => {setSelected((old) => {const next=new Map(old);for(const worker of workers) checked ? next.set(worker.id,worker) : next.delete(worker.id);return next;});setConfirmed(false);};
  async function publish(event:React.FormEvent) {
    event.preventDefault();if(!confirmed || !selected.size || sending.current || readingCrew || stale || !sessionCurrent()) return;sending.current=true;setBusy(true);setError('');
    let submitted=false,pending:PendingPublication|null=null,stored=false;
    try {
      const form=event.currentTarget as HTMLFormElement,fields=new FormData(form);
      const {dueAt,scheduledAt}=publicationTimes(fields,siteTimezone,mode==='schedule'),workerIds=[...selected.keys()].sort(),reminderMinutes=Number(fields.get('reminderMinutes') || 0);
      const key=JSON.stringify({id,revision,version,workerIds,dueAt,scheduledAt,reminderMinutes});
      if (retry.current?.key!==key) retry.current={key,requestId:crypto.randomUUID()};
      if(!scope)throw Error('Publication recovery scope is unavailable. No request was sent.');
      pending={briefingId:id,kind:mode==='schedule'?'schedule':'publish',body:{requestId:retry.current.requestId,revision,nextVersion:version,workerIds,dueAt,...(reminderMinutes?{reminderMinutes}:{}),...(scheduledAt ? {publishAt:scheduledAt} : {})}};
      savePendingPublication(sessionStorage,scope,pending);stored=true;submitted=true;
      const result=await request(`/briefings/${encodeURIComponent(id)}/${mode==='schedule'?'schedules':'publish'}`,'POST',pending.body);
      const accepted=pending;
      await complete(result,value=>checkedPublicationResult(value,accepted),()=>{
        clearPendingPublication(sessionStorage,scope!,accepted);stored=false;
        setConfirmed(false);setSelected(new Map());form.reset();retry.current=null;
        setTimingReset(value=>value+1);setTimezone(siteTimezone);onChanged();
      });
    } catch(err) {
      if(!sessionCurrent())return;
      if(stored && pending && scope) {
        if(!(err instanceof BriefingRequestError) || err.uncertain || err.fenced){onPending(pending);return;}
        try {clearPendingPublication(sessionStorage,scope,pending);}catch {onPending(pending);return;}
      }
      const message=(err as Error).message;
      if(['Draft version changed','Draft revision changed'].includes(message)){setStale(true);setConfirmed(false);}
      setError(`${message}${submitted && mode==='schedule'?' Refresh publication schedules to check the saved outcome.':''}`);
    } finally {sending.current=false;if(sessionCurrent())setBusy(false);}
  }
  return <section className="panel"><h2>Publish v{version}</h2><form onSubmit={(event) => void publish(event)}>
    <CrewRecipients authority={authority} disabled={busy || stale} onLoading={value=>{if(!sessionCurrent())return;setReadingCrew(value);if(value)setConfirmed(false);}} onSelected={workers=>{
      if(!sessionCurrent())return false;
      const next=new Map(selected);for(const worker of workers)next.set(worker.id,worker);
      if(next.size>5000)return false;
      setSelected(next);setConfirmed(false);return true;
    }}/>
    <fieldset className="recipient-controls" disabled={busy || readingCrew || stale}><legend className="sr-only">Review selected recipients and deadline</legend>
    <div className="filters audit-filters"><label className="search-box"><Search size={18} /><span className="sr-only">Search recipients</span><input value={search} disabled={busy} maxLength={80} placeholder="Search recipients" onChange={(event) => {setSearch(event.target.value);setPage(1);}} /></label><label className="select-label">Language<select value={language} disabled={busy} onChange={(event) => {setLanguage(event.target.value);setPage(1);}}><option value="all">All languages</option>{WORKER_LOCALES.map(item=><option key={item.code} value={item.code}>{item.englishName}</option>)}</select></label></div>
    {loading ? <p role="status">Loading recipients...</p> : data?.items.length ? <div className="recipient-list"><label className="recipient-row"><input type="checkbox" checked={allPage} disabled={busy} onChange={(event) => toggle(data.items,event.target.checked)} /><strong>Select this page ({data.items.length})</strong></label>{data.items.map((worker) => <label key={worker.id} className="recipient-row"><input type="checkbox" checked={selected.has(worker.id)} disabled={busy} onChange={(event) => toggle([worker],event.target.checked)} /><span>{worker.code}<small>{worker.language.toUpperCase()} · {worker.crew_name || 'No crew'}</small></span></label>)}</div> : !error && <p>No active workers in this filter.</p>}
    {data && !loading && <div className="audit-pagination"><span>Page {page} of {pages} · {data.total} available</span><div className="actions"><button type="button" className="icon-button" aria-label="Previous recipient page" title="Previous recipient page" disabled={page<=1 || busy} onClick={() => setPage((n) => n-1)}><ChevronLeft size={18} /></button><button type="button" className="icon-button" aria-label="Next recipient page" title="Next recipient page" disabled={page>=pages || busy} onClick={() => setPage((n) => n+1)}><ChevronRight size={18} /></button></div></div>}
    <details className="selected-recipients"><summary>{selected.size} selected recipients</summary>{[...selected.values()].map((worker) => <div className="recipient-row" key={worker.id}><span>{worker.code}</span><button className="icon-button" type="button" aria-label={`Remove recipient ${worker.code}`} title="Remove recipient" disabled={busy} onClick={() => toggle([worker],false)}><X size={18} /></button></div>)}</details>
    <label className="field">Time zone<select name="timezone" value={timezone} onChange={event=>{setTimezone(event.target.value);setTimingReset(value=>value+1);timingChanged();}}><option value={siteTimezone}>Site time</option>{siteTimezone!=='UTC' && <option value="UTC">UTC</option>}</select></label>
    <CivilTimeField key={`deadline:${timezone}:${timingReset}`} name="deadline" label="Response deadline" timezone={timezone} onChanged={timingChanged}/>
    <label className="field">In-app deadline reminder<select name="reminderMinutes" defaultValue="0" onChange={()=>setConfirmed(false)}><option value="0">Off</option><option value="60">Up to 1 hour before</option><option value="1440">Up to 24 hours before</option></select></label>
    <div className="publication-mode" role="group" aria-label="Publication timing"><label><input type="radio" name="publication-mode" value="now" checked={mode==='now'} onChange={()=>{setMode('now');setConfirmed(false);}}/>Publish now</label><label><input type="radio" name="publication-mode" value="schedule" checked={mode==='schedule'} onChange={()=>{setMode('schedule');setConfirmed(false);}}/>Schedule</label></div>
    {mode==='schedule' && <CivilTimeField key={`publishAt:${timezone}:${timingReset}`} name="publishAt" label="Publication time" timezone={timezone} required onChanged={timingChanged}/>}
    <label className="recipient-row publish-confirm"><input type="checkbox" checked={confirmed} disabled={busy || readingCrew || selected.size===0} onChange={(event) => setConfirmed(event.target.checked)} /><span>{mode==='schedule'?'Schedule':'Publish'} v{version} to {selected.size} selected workers</span></label>
    {error && <p role="alert" className="record-error">{error}</p>}
    </fieldset>
    <button type="submit" className="button primary" disabled={busy || readingCrew || stale || !confirmed || selected.size===0 || selected.size>5000}>{mode==='schedule'?<CalendarClock size={18}/>:<Send size={18}/>}{busy ? 'Saving...' : mode==='schedule'?'Schedule version':'Publish version'}</button>
    {stale && <button type="button" className="button outline" onClick={onChanged}><RefreshCw size={18}/>Refresh draft</button>}
  </form></section>;
}
