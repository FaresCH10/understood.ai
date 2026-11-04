import {useEffect,useRef,useState} from 'react';
import {Check,ChevronLeft,ChevronRight,X} from 'lucide-react';
import './operator-translation-feedback.css';

type Feedback={id:string;orgId:string;workspace:string;site:string;publicationId:string;language:string;field:string;note:string;status:string;createdAt:string;resolutionNote:string|null;resolvedAt:string|null;reviewerId:string|null};
type Report={items:Feedback[];total:number;page:number;pageSize:number};
type Request=(path:string,body?:unknown)=>Promise<any>;
export default function OperatorTranslationFeedback({request,locked,refresh}:{request:Request;locked:boolean;refresh:number}){
  const requestRef=useRef(request);requestRef.current=request;
  const [status,setStatus]=useState('open'),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [data,setData]=useState<Report|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let live=true;setLoading(true);setError('');setData(null);
    void requestRef.current(`translation-feedback?${new URLSearchParams({status,page:String(page),pageSize:'20'})}`)
      .then(value=>{if(live)setData(value);}).catch(reason=>{if(live)setError(reason.message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[status,page,revision,refresh]);
  const pages=Math.max(1,Math.ceil((data?.total||0)/20));
  return <div className="operator-feedback">
    <nav className="briefing-status-tabs" aria-label="Translation feedback status">{['open','resolved','dismissed','all'].map(value=><button key={value} aria-pressed={status===value} disabled={locked} onClick={()=>{setStatus(value);setPage(1);}}>{value==='all'?'All feedback':value[0].toUpperCase()+value.slice(1)}</button>)}</nav>
    {error && <p className="notice notice-amber" role="alert">{error}</p>}
    {loading?<p data-page-loading role="status">Loading translation feedback…</p>:data?.items.length?<div className="operator-feedback-list">{data.items.map(item=><article className="operator-feedback-card" key={item.id}>
      <header><div><h2>{item.workspace}</h2><p>{item.site} · {item.language.toUpperCase()} · {item.field}</p></div><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></header>
      <div className="operator-feedback-issue"><strong>Reported issue</strong><p dir="auto">{item.note}</p></div>
      <details><summary>Instruction reference</summary><p>Published version <code>{item.publicationId}</code></p></details>
      {item.status==='open'?<FeedbackDecision item={item} request={requestRef.current} locked={locked} onSaved={()=>setRevision(n=>n+1)}/>:<div className="operator-feedback-resolution"><strong>{item.status==='resolved'?'Resolved':'Dismissed'}</strong>{item.resolutionNote&&<p dir="auto">{item.resolutionNote}</p>}{item.resolvedAt&&<small>{new Date(item.resolvedAt).toLocaleString()}</small>}</div>}
    </article>)}</div>:!error&&<div className="empty-state">{status==='open'?'No open translation feedback.':'No feedback matches this view.'}</div>}
    {data&&pages>1&&<div className="audit-pagination"><span>Page {page} of {pages} · {data.total} reports</span><div className="actions"><button className="icon-button" aria-label="Previous feedback page" disabled={loading||locked||page<=1} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="Next feedback page" disabled={loading||locked||page>=pages} onClick={()=>setPage(n=>n+1)}><ChevronRight size={18}/></button></div></div>}
    <p className="muted operator-feedback-footnote">This queue contains reported issues only. Resolving a report records the review outcome; it does not rewrite or republish the instruction.</p>
  </div>;
}
function FeedbackDecision({item,request,locked,onSaved}:{item:Feedback;request:Request;locked:boolean;onSaved:()=>void}){
  const [note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const live=useRef(true),sending=useRef(false),pending=useRef<{requestId:string;action:string;note:string}|null>(null);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  async function decide(action:string){
    if(locked||sending.current)return;
    if(pending.current&&(pending.current.action!==action||pending.current.note!==note.trim()))return;
    const body=pending.current??{requestId:crypto.randomUUID(),action,note:note.trim()};pending.current=body;
    sending.current=true;setBusy(true);setError('');
    try{
      const result=await request(`translation-feedback/${encodeURIComponent(item.id)}/decision`,body);
      if(result.id!==item.id||result.status!==action)throw Error('Review result could not be verified. Refresh to check the saved status.');
      if(live.current){pending.current=null;onSaved();}
    }catch(reason){if(live.current)setError((reason as Error).message);}
    finally{sending.current=false;if(live.current)setBusy(false);}
  }
  return <div className="operator-feedback-decision"><label className="field">Review note (optional)<textarea rows={2} maxLength={1000} value={note} disabled={locked||busy||!!pending.current} onChange={event=>setNote(event.target.value)}/></label>{error&&<p className="notice notice-amber" role="alert">{error} Refresh to check the current status, or retry the same decision.</p>}<div className="actions"><button className="button outline" disabled={locked||busy||!!pending.current&&pending.current.action!=='dismissed'} onClick={()=>void decide('dismissed')}><X size={16}/>Dismiss</button><button className="button primary" disabled={locked||busy||!!pending.current&&pending.current.action!=='resolved'} onClick={()=>void decide('resolved')}><Check size={16}/>{busy?'Saving…':'Mark resolved'}</button></div></div>;
}
