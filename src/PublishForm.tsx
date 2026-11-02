import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Search,Send,X,Users,UserCheck,RefreshCw,CalendarClock} from 'lucide-react';
import {useBriefingRequest,BriefingRequestError} from './BriefingControls';
import type {StaffRequestAuthority} from './useStaffRequest';
import {savePendingPublication,clearPendingPublication,checkedPublicationResult,type PendingPublication} from './publication-recovery';
import CivilTimeField from './CivilTimeField';
import {publicationTimes} from './civil-time';
import {WORKER_LOCALES} from '../server/languages.mjs';

type Worker={id:string;code:string;language:string;crew_name:string|null};
type WorkerPage={items:Worker[];total:number;page:number;pageSize:number};

type Crew={id:string;name:string;member_count:number};
type ReverifyCandidate={id:string;code:string;language:string;outcome:string;lastRespondedAt:string;version:number};
type ReverifyResult={items:ReverifyCandidate[];total:number;truncated:boolean};
const countLabel=(value:number)=>new Intl.NumberFormat('en-US').format(value);
const ageLabel=(value:string)=>{
  const elapsed=Date.now()-Date.parse(value);
  if(!Number.isFinite(elapsed))return 'date unavailable';
  const days=Math.max(0,Math.floor(elapsed/86400000));
  return days===0?'today':days===1?'1 day ago':`${countLabel(days)} days ago`;
};
const outcomeLabel=(outcome:string)=>outcome==='matched'?'matched':outcome==='clarification'?'needed clarification':'unassessable';
function CrewRecipients({disabled,onSelected,onLoading,authority}:{disabled:boolean;onSelected:(workers:Worker[])=>boolean;onLoading:(loading:boolean)=>void;authority:StaffRequestAuthority}) {
  const staffT=useStaffStaticText();
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
    <h3>{staffT("Crew recipients")}</h3>
    <label className="field">{staffT("Find recipient crew")}<input type="search" value={search} maxLength={80} disabled={disabled || adding} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label>
    <label className="field">{staffT("Recipient crew")}<select value={choice?.id || ''} disabled={disabled || adding || loading || !!error} onChange={event=>{setChoice(data?.items.find(crew=>crew.id===event.target.value) || null);setResult('');}}>
      <option value="">{staffT("Choose a crew")}</option>{choice && !data?.items.some(crew=>crew.id===choice.id) && <option value={choice.id}>{choice.name} {staffT("(selected)")}</option>}
      {data?.items.map(crew=><option key={crew.id} value={crew.id}>{crew.name} ({crew.member_count})</option>)}
    </select></label>
    <div className="audit-pagination"><span role="status">{loading?staffT("Loading recipient crews..."):staffT("Page {p0} of {p1} · {p2} active crews",{p0:page,p1:pages,p2:data?.total || 0})}</span><div className="actions">
      <button type="button" className="icon-button" title={staffT("Previous recipient crews")} aria-label={staffT("Previous recipient crews")} disabled={disabled || adding || loading || !!error || page<=1} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button>
      <button type="button" className="icon-button" title={staffT("Next recipient crews")} aria-label={staffT("Next recipient crews")} disabled={disabled || adding || loading || !!error || page>=pages} onClick={()=>setPage(page+1)}><ChevronRight size={18}/></button>
      <button type="button" className="icon-button" title={staffT("Refresh recipient crews")} aria-label={staffT("Refresh recipient crews")} disabled={disabled || adding || loading} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={18}/></button>
    </div></div>
    <button type="button" className="button outline" disabled={disabled || adding || loading || !!error || !choice} onClick={()=>void add()}><Users size={18}/>{adding?staffT("Reading crew..."):staffT("Add active crew members")}</button>
    {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}{result && <p role="status">{result}</p>}
  </div>;
}

export default function PublishForm({id,revision,version,timezone:siteTimezone,scope,onPending,onChanged,authority}:{id:string;revision:number;version:number;timezone:string;scope?:string|null;onPending:(value:PendingPublication)=>void;onChanged:(outcome?:'publish'|'schedule')=>void;authority:StaffRequestAuthority}) {
  const staffT=useStaffStaticText();
  const {request,current:sessionCurrent,complete}=useBriefingRequest(authority),sending=useRef(false);
  const [search,setSearch]=useState(''),[language,setLanguage]=useState('all'),[page,setPage]=useState(1);
  const [data,setData]=useState<WorkerPage|null>(null),[selected,setSelected]=useState<Map<string,Worker>>(new Map());
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [stale,setStale]=useState(false);
  const [readingCrew,setReadingCrew]=useState(false);
  const [mode,setMode]=useState('now');
  const [timezone,setTimezone]=useState(siteTimezone),[timingReset,setTimingReset]=useState(0);
  const [verifyOutcome,setVerifyOutcome]=useState<'matched'|'response'>('matched');
  const [verifyWindow,setVerifyWindow]=useState<'any'|'30'|'90'|'180'>('any');
  const [verifyCandidates,setVerifyCandidates]=useState<ReverifyResult|null>(null);
  const [verifyLoading,setVerifyLoading]=useState(true),[verifyError,setVerifyError]=useState('');
  const [reverified,setReverified]=useState<Set<string>>(new Set()),[reverifyAdded,setReverifyAdded]=useState(0);
  const retry=useRef<{key:string;requestId:string}|null>(null);
  const timingChanged=()=>{setConfirmed(false);setError('');};
  const query=new URLSearchParams({search,language,status:'active',page:String(page),pageSize:'50'}).toString();
  useEffect(() => {
    let current=true;setLoading(true);setData(null);setError('');
    request<WorkerPage>(`/people/workers?${query}`).then((value) => {if(current && sessionCurrent()) setData(value);})
      .catch((err:Error) => {if(current && sessionCurrent()) setError(err.message);}).finally(() => {if(current && sessionCurrent()) setLoading(false);});
    return () => {current=false;};
  },[query,request,sessionCurrent]);
  useEffect(() => {
    const controller=new AbortController();setVerifyLoading(true);setVerifyCandidates(null);setVerifyError('');
    const query=new URLSearchParams({window:verifyWindow,outcome:verifyOutcome});
    request<ReverifyResult>(`/briefings/${encodeURIComponent(id)}/reverification?${query}`,'GET',undefined,controller.signal)
      .then(value=>{if(!controller.signal.aborted && sessionCurrent())setVerifyCandidates(value);})
      .catch(reason=>{if(!controller.signal.aborted && sessionCurrent())setVerifyError((reason as Error).message);})
      .finally(()=>{if(!controller.signal.aborted && sessionCurrent())setVerifyLoading(false);});
    return ()=>controller.abort();
  },[id,verifyOutcome,verifyWindow,request,sessionCurrent]);
  const pages=Math.max(1,Math.ceil((data?.total || 0)/50));
  const allPage=!!data?.items.length && data.items.every((worker) => selected.has(worker.id));
  const verifyItems=verifyCandidates?.items ?? [];
  const addableReverifiers=verifyItems.filter((candidate) => !selected.has(candidate.id));
  const reverifiedSelected=[...reverified].filter((workerId) => selected.has(workerId)).length;
  const overReverifyCapacity=selected.size+addableReverifiers.length>5000;
  const toggle=(workers:Worker[],checked:boolean) => {
    setSelected((old) => {const next=new Map(old);for(const worker of workers) checked ? next.set(worker.id,worker) : next.delete(worker.id);return next;});
    if(!checked)setReverified((old) => {const next=new Set(old);for(const worker of workers)next.delete(worker.id);return next;});
    setReverifyAdded(0);setConfirmed(false);
  };
  function addReverifiers() {
    if(!verifyCandidates || busy || stale || readingCrew || !sessionCurrent())return;
    const addable=verifyCandidates.items.filter((candidate) => !selected.has(candidate.id));
    if(!addable.length || selected.size+addable.length>5000)return;
    setSelected((old) => {const next=new Map(old);for(const candidate of addable)next.set(candidate.id,{id:candidate.id,code:candidate.code,language:candidate.language,crew_name:null});return next;});
    setReverified((old) => {const next=new Set(old);for(const candidate of addable)next.add(candidate.id);return next;});
    setReverifyAdded(addable.length);setConfirmed(false);
  }
  function removeReverifiers() {
    if(!reverifiedSelected || !sessionCurrent())return;
    setSelected((old) => {const next=new Map(old);for(const workerId of reverified)next.delete(workerId);return next;});
    setReverified(new Set());setReverifyAdded(0);setConfirmed(false);
  }
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
        setTimingReset(value=>value+1);setTimezone(siteTimezone);onChanged(mode==='schedule'?'schedule':'publish');
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
  return <section className="panel"><h2>{staffT("Publish v")}{version}</h2><form onSubmit={(event) => void publish(event)}>
    <CrewRecipients authority={authority} disabled={busy || stale} onLoading={value=>{if(!sessionCurrent())return;setReadingCrew(value);if(value)setConfirmed(false);}} onSelected={workers=>{
      if(!sessionCurrent())return false;
      const next=new Map(selected);for(const worker of workers)next.set(worker.id,worker);
      if(next.size>5000)return false;
      setSelected(next);setConfirmed(false);return true;
    }}/>
    <section className="publish-reverify" aria-labelledby={`reverify-title-${id}`}>
      <div className="publish-reverify-head">
        <div>
          <h3 id={`reverify-title-${id}`}>{staffT("Re-verify previous responders")}</h3>
          <p>{staffT("Add workers who answered an earlier version. Each one gets a new assignment and must show understanding of v")}{version}{staffT("; an earlier match is not reused.")}</p>
        </div>
        <span className="publish-reverify-count" role="status">{verifyLoading?staffT("Checking history..."):verifyCandidates?staffT("{p0} eligible {p1}",{p0:verifyCandidates.truncated?'5,000+':countLabel(verifyCandidates.total),p1:verifyCandidates.total===1?'worker':'workers'}):staffT("History unavailable")}</span>
      </div>
      <div className="publish-reverify-controls">
        <label className="field">{staffT("Last recorded outcome")}<select value={verifyOutcome} disabled={busy || stale || verifyLoading} onChange={event=>{setVerifyOutcome(event.target.value as 'matched'|'response');setReverifyAdded(0);}}><option value="matched">{staffT("Matched only")}</option><option value="response">{staffT("Any assessed response")}</option></select></label>
        <label className="field">{staffT("Last response age")}<select value={verifyWindow} disabled={busy || stale || verifyLoading} onChange={event=>{setVerifyWindow(event.target.value as 'any'|'30'|'90'|'180');setReverifyAdded(0);}}><option value="any">{staffT("Any time")}</option><option value="30">{staffT("Over 30 days ago")}</option><option value="90">{staffT("Over 90 days ago")}</option><option value="180">{staffT("Over 180 days ago")}</option></select></label>
        <button type="button" className="button outline" disabled={busy || stale || readingCrew || verifyLoading || !addableReverifiers.length || overReverifyCapacity} onClick={addReverifiers}><UserCheck size={18}/>{verifyLoading?staffT("Checking..."):addableReverifiers.length?staffT("Add {p0} {p1}",{p0:countLabel(addableReverifiers.length),p1:addableReverifiers.length===1?'re-verifier':'re-verifiers'}):staffT("No workers to add")}</button>
      </div>
      {verifyError && <p role="alert" className="record-error">{verifyError}</p>}
      {!verifyError && !verifyLoading && verifyCandidates && !verifyItems.length && <p className="publish-reverify-note">{staffT("No previous responders match these filters.")}</p>}
      {!verifyError && verifyItems.length>0 && !addableReverifiers.length && <p className="publish-reverify-note" role="status">{staffT("All eligible workers are already selected.")}</p>}
      {overReverifyCapacity && <p className="publish-reverify-note">{staffT("Adding these workers would exceed the 5,000 recipient limit. Remove at least")} {countLabel(selected.size+addableReverifiers.length-5000)} {staffT("selected recipients first.")}</p>}
      {!verifyError && verifyItems.length>0 && <details className="publish-reverify-preview"><summary>{staffT("Review eligible workers, oldest first")}</summary><ul>{verifyItems.slice(0,20).map((candidate)=><li key={candidate.id}><strong>{candidate.code}</strong><span>v{staffT.number(candidate.version)} · {outcomeLabel(candidate.outcome)} {staffT("· last response")} {ageLabel(candidate.lastRespondedAt)}</span>{reverified.has(candidate.id)&&<small>{staffT("Re-verification")}</small>}</li>)}</ul>{verifyItems.length>20&&<p>{staffT("Showing the 20 oldest of")} {countLabel(verifyCandidates?.total || 0)} {staffT("eligible workers. Add them all, then remove any individuals from the selection.")}</p>}</details>}
      {reverifyAdded>0 && <p role="status" className="publish-reverify-note">{countLabel(reverifyAdded)} {reverifyAdded===1?staffT("worker"):staffT("workers")} {staffT("added for re-verification. Publish v")}{version} {staffT("to request fresh proof.")}</p>}
      {reverifiedSelected>0 && <div className="publish-reverify-actions"><span>{countLabel(reverifiedSelected)} {staffT("selected for re-verification")}</span><button type="button" className="button subtle" disabled={busy || stale} onClick={removeReverifiers}>{staffT("Remove")} {countLabel(reverifiedSelected)} re-verifiers</button></div>}
    </section>
    <fieldset className="recipient-controls" disabled={busy || readingCrew || stale}><legend className="sr-only">{staffT("Review selected recipients and deadline")}</legend>
    <div className="filters audit-filters"><label className="search-box"><Search size={18} /><span className="sr-only">{staffT("Search recipients")}</span><input value={search} disabled={busy} maxLength={80} placeholder={staffT("Search recipients")} onChange={(event) => {setSearch(event.target.value);setPage(1);}} /></label><label className="select-label">{staffT("Language")}<select value={language} disabled={busy} onChange={(event) => {setLanguage(event.target.value);setPage(1);}}><option value="all">{staffT("All languages")}</option>{WORKER_LOCALES.map(item=><option key={item.code} value={item.code}>{staffT.language(item.code)}</option>)}</select></label></div>
    {loading ? <p role="status">{staffT("Loading recipients...")}</p> : data?.items.length ? <div className="recipient-list"><label className="recipient-row"><input type="checkbox" checked={allPage} disabled={busy} onChange={(event) => toggle(data.items,event.target.checked)} /><strong>{staffT("Select this page (")}{data.items.length})</strong></label>{data.items.map((worker) => <label key={worker.id} className="recipient-row"><input type="checkbox" checked={selected.has(worker.id)} disabled={busy} onChange={(event) => toggle([worker],event.target.checked)} /><span>{worker.code}<small>{worker.language.toUpperCase()} · {(worker.crew_name||staffT("No crew"))}</small></span></label>)}</div> : !error && <p>{staffT("No active workers in this filter.")}</p>}
    {data && !loading && <div className="audit-pagination"><span>{staffT("Page")} {staffT.number(page)} {staffT("of")} {staffT.number(pages)} · {staffT.number(data.total)} {staffT("available")}</span><div className="actions"><button type="button" className="icon-button" aria-label={staffT("Previous recipient page")} title={staffT("Previous recipient page")} disabled={page<=1 || busy} onClick={() => setPage((n) => n-1)}><ChevronLeft size={18} /></button><button type="button" className="icon-button" aria-label={staffT("Next recipient page")} title={staffT("Next recipient page")} disabled={page>=pages || busy} onClick={() => setPage((n) => n+1)}><ChevronRight size={18} /></button></div></div>}
    <details className="selected-recipients"><summary>{selected.size} {staffT("selected recipients")}{reverifiedSelected?staffT(" · {p0} re-verifying",{p0:reverifiedSelected}):''}</summary>{[...selected.values()].map((worker) => <div className="recipient-row" key={worker.id}><span>{worker.code}{reverified.has(worker.id)&&<small>{staffT("Re-verification")}</small>}</span><button className="icon-button" type="button" aria-label={staffT("Remove recipient {p0}",{p0:worker.code})} title={staffT("Remove recipient")} disabled={busy} onClick={() => toggle([worker],false)}><X size={18} /></button></div>)}</details>
    <label className="field">{staffT("Time zone")}<select name="timezone" value={timezone} onChange={event=>{setTimezone(event.target.value);setTimingReset(value=>value+1);timingChanged();}}><option value={siteTimezone}>{staffT("Site time")}</option>{siteTimezone!=='UTC' && <option value="UTC">UTC</option>}</select></label>
    <CivilTimeField key={`deadline:${timezone}:${timingReset}`} name="deadline" label={staffT("Response deadline")} timezone={timezone} onChanged={timingChanged}/>
    <label className="field">{staffT("In-app deadline reminder")}<select name="reminderMinutes" defaultValue="0" onChange={()=>setConfirmed(false)}><option value="0">{staffT("Off")}</option><option value="60">{staffT("Up to 1 hour before")}</option><option value="1440">{staffT("Up to 24 hours before")}</option></select></label>
    <div className="publication-mode" role="group" aria-label={staffT("Publication timing")}><label><input type="radio" name="publication-mode" value="now" checked={mode==='now'} onChange={()=>{setMode('now');setConfirmed(false);}}/>{staffT("Publish now")}</label><label><input type="radio" name="publication-mode" value="schedule" checked={mode==='schedule'} onChange={()=>{setMode('schedule');setConfirmed(false);}}/>{staffT("Schedule")}</label></div>
    {mode==='schedule' && <CivilTimeField key={`publishAt:${timezone}:${timingReset}`} name="publishAt" label={staffT("Publication time")} timezone={timezone} required onChanged={timingChanged}/>}
    <label className="recipient-row publish-confirm"><input type="checkbox" checked={confirmed} disabled={busy || readingCrew || selected.size===0} onChange={(event) => setConfirmed(event.target.checked)} /><span>{mode==='schedule'?staffT("Schedule"):staffT("Publish")} v{version} {staffT("to")} {selected.size} {staffT("selected workers")}</span></label>
    {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
    </fieldset>
    <button type="submit" className="button primary" disabled={busy || readingCrew || stale || !confirmed || selected.size===0 || selected.size>5000}>{mode==='schedule'?<CalendarClock size={18}/>:<Send size={18}/>}{busy?staffT("Saving..."):mode==='schedule'?staffT("Schedule version"):staffT("Publish version")}</button>
    {stale && <button type="button" className="button outline" onClick={()=>onChanged()}><RefreshCw size={18}/>{staffT("Refresh draft")}</button>}
  </form></section>;
}
