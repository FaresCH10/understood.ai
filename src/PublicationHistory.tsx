import {useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,Languages,MessageCircle,RefreshCw,Search} from 'lucide-react';
import {checkedPublicationHistory,checkedPublicationDetail,type PublicationSummary,type PublicationHistoryPage,type PublicationDetail} from './publication-history';
import {WithdrawControl} from './BriefingControls';
import type {StaffRequestAuthority} from './useStaffRequest';

function useHistoryRead<T>(path:string|null,context:string,refresh:number,check:(value:unknown)=>T) {
  const key=JSON.stringify([path,context,refresh]);
  const [result,setResult]=useState<{key:string;data:T|null;error:string;loading:boolean}>({key:'',data:null,error:'',loading:!!path});
  useEffect(()=>{
    if(!path)return;
    const controller=new AbortController();let current=true;
    setResult({key,data:null,error:'',loading:true});
    const timeout=setTimeout(()=>controller.abort(),15000);
    fetch('/api'+path,{credentials:'include',cache:'no-store',headers:{'x-client-session-context':context},signal:controller.signal})
      .then(async response=>{if(!response.ok)throw Error();return check(await response.json());})
      .then(data=>{if(current)setResult({key,data,error:'',loading:false});})
      .catch(()=>{if(current)setResult({key,data:null,error:'Version evidence is unavailable. Recheck access and try again.',loading:false});})
      .finally(()=>clearTimeout(timeout));
    return()=>{current=false;clearTimeout(timeout);controller.abort();};
  },[key]);
  return path && result.key===key?result:{data:null,error:'',loading:!!path};
}

export function usePublicationDetail(briefingId:string,publicationId:string|null,context:string,refresh:number) {
  return useHistoryRead<PublicationDetail>(publicationId?`/briefings/${encodeURIComponent(briefingId)}/publications/${encodeURIComponent(publicationId)}`:null,context,refresh,value=>checkedPublicationDetail(value,briefingId,publicationId!));
}

export function PublicationPicker({briefingId,selected,onSelect,context,refresh,disabled=false,allowDraft=false,draftLabel='Draft',catalog=false}:{briefingId:string;selected:PublicationSummary|null;onSelect:(value:PublicationSummary|null)=>void;context:string;refresh:number;disabled?:boolean;allowDraft?:boolean;draftLabel?:string;catalog?:boolean}) {
  const [page,setPage]=useState(1),[version,setVersion]=useState<number|null>(null),[input,setInput]=useState(''),[tick,setTick]=useState(0);
  const query=new URLSearchParams({page:String(page),pageSize:'20',...(version===null?{}:{version:String(version)})});
  const {data,error,loading}=useHistoryRead<PublicationHistoryPage>(`/briefings/${encodeURIComponent(briefingId)}/publications?${query}`,context,refresh+tick,value=>checkedPublicationHistory(value,briefingId,page,version));
  const pages=Math.max(1,Math.ceil((data?.total || 0)/20)),items=data?.items || [];
  const showSearch=(data?.total||0)>1||page>1||version!==null;
  const versionState=(state:string)=>({published:'Sent',superseded:'Earlier version',withdrawn:'Withdrawn',archived:'Archived'} as Record<string,string>)[state]||state;
  return <div className="publication-picker">
    <div className={catalog?"publication-catalog-heading":"filters"}>{catalog?<h2>Sent versions{data?` (${data.total})`:''}</h2>:<label className="select-label">{allowDraft?'Version':'Sent version'}<select value={selected?.id || (allowDraft?'draft':'')} disabled={disabled || loading || !!error} onChange={event=>{if(event.target.value==='draft')onSelect(null);else{const row=items.find(item=>item.id===event.target.value) || (selected?.id===event.target.value?selected:null);if(row)onSelect(row);}}}>
      {allowDraft?<option value="draft">{draftLabel}</option>:!selected && <option value="" disabled>Select version</option>}
      {selected && !items.some(item=>item.id===selected.id) && <option value={selected.id}>v{selected.version} · {versionState(selected.state)}</option>}
      {items.map(item=><option key={item.id} value={item.id}>v{item.version} · {versionState(item.state)}</option>)}
    </select></label>}<button className="icon-button" title="Refresh version history" aria-label="Refresh version history" disabled={disabled || loading} onClick={()=>setTick(n=>n+1)}><RefreshCw size={18}/></button></div>
    {showSearch&&<details className="publication-version-advanced"><summary>Find a specific version</summary><form className="publication-version-search" onSubmit={event=>{event.preventDefault();if(disabled || !/^[1-9][0-9]{0,9}$/.test(input) || Number(input)>2147483647)return;setVersion(Number(input));setPage(1);}}>
      <label className="field">Version number<input inputMode="numeric" type="number" min="1" max="2147483647" step="1" value={input} disabled={disabled} onChange={event=>setInput(event.target.value)} required/></label>
      <button className="icon-button" title="Find version" aria-label="Find version" disabled={disabled || loading || !input}><Search size={18}/></button>{version!==null && <button className="text-link" type="button" disabled={disabled || loading} onClick={()=>{setVersion(null);setPage(1);setInput('');}}>All versions</button>}
    </form></details>}
    {loading?<p role="status">Loading version history...</p>:error?<p role="alert">{error}</p>:data && <>
      {catalog && <div className="row-list publication-catalog">{items.map(item=><button type="button" className="item-row" key={item.id} aria-pressed={selected?.id===item.id} disabled={disabled} onClick={()=>onSelect(item)}><span className="item-main"><strong>v{item.version} · {versionState(item.state)}</strong><small>{new Date(item.published_at).toLocaleString()}</small></span><ChevronRight size={18}/></button>)}</div>}
      {!items.length && <p>{page>pages?'This history page is no longer available.':version===null?'No versions have been sent yet.':'No published versions match.'}</p>}
      {(pages>1||page>1)&&<div className="audit-pagination"><span>Page {page} of {pages} · {data.total} versions</span><div className="actions"><button className="icon-button" title="Previous version page" aria-label="Previous version page" disabled={disabled || page<=1} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={18}/></button><button className="icon-button" title="Next version page" aria-label="Next version page" disabled={disabled || page>=pages} onClick={()=>setPage(n=>n+1)}><ChevronRight size={18}/></button>{page>pages && <button className="text-link" disabled={disabled} onClick={()=>setPage(1)}>First page</button>}</div></div>}
    </>}
  </div>;
}

export function PublicationHistory({briefingId,selected,onSelect,context,refresh,onView,canWrite,onChanged,authority,disabled=false}:{briefingId:string;selected:PublicationSummary|null;onSelect:(value:PublicationSummary|null)=>void;context:string;refresh:number;onView:(view:'languages'|'responses')=>void;canWrite:boolean;onChanged:()=>void;authority:StaffRequestAuthority;disabled?:boolean}) {
  const [tick,setTick]=useState(0),{data,error,loading}=usePublicationDetail(briefingId,selected?.id || null,context,refresh+tick);
  const facts=Array.isArray(data?.snapshot.facts)?data.snapshot.facts:[];
  const mode=data?.snapshot.responseMode,delivery=data?.snapshot.deliveryMode;
  const modeLabel=mode==='acknowledge'?'Acknowledge only':mode==='question'?'Question · answer required':'Mode not recorded (legacy)';
  const deliveryLabel=delivery==='text'?'Text':delivery==='voice'?'Voice':delivery==='both'?'Text and voice':'Mode not recorded (legacy)';
  return <section className="publication-history" aria-label="Published version history"><PublicationPicker briefingId={briefingId} selected={selected} onSelect={onSelect} context={context} refresh={refresh+tick} disabled={disabled} catalog/>
    {selected && <div className="publication-history-detail" key={selected.id}><h3>v{data?.version || selected.version} · {data?.state || selected.state}</h3>{loading?<p role="status">Loading selected version...</p>:error?<><p role="alert">{error}</p><button className="icon-button" title="Reload selected version" aria-label="Reload selected version" disabled={disabled} onClick={()=>setTick(n=>n+1)}><RefreshCw size={18}/></button></>:data && <><p>{mode==='acknowledge'?'Acknowledgment only — no question was included in this version.':typeof data.snapshot.question==='string'?data.snapshot.question:'Question not available'}</p><p className="muted">Response mode: {modeLabel} · Delivery: {deliveryLabel}</p><h4>Key facts</h4><ul>{facts.map((fact,index)=><li key={index}>{typeof fact==='string'?fact:'Invalid stored fact'}</li>)}</ul><p>{data.metrics.assigned} assigned · {data.metrics.responses} responses · {data.metrics.matches} matches{data.metrics.acknowledged?` · ${data.metrics.acknowledged} acknowledged`:''}</p>{data.withdrawal && <p>Withdrawn {new Date(data.withdrawal.occurred_at).toLocaleString()} · {data.withdrawal.reason}</p>}<div className="actions"><button className="button outline" disabled={disabled} onClick={()=>onView('languages')}><Languages size={18}/>Language artifacts</button><button className="button outline" disabled={disabled} onClick={()=>onView('responses')}><MessageCircle size={18}/>Responses</button></div>{canWrite && !disabled && data.state==='published' && <WithdrawControl authority={authority} briefingId={briefingId} publicationId={data.id} version={data.version} onChanged={onChanged}/>}</>}</div>}
  </section>;
}
