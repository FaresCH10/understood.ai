import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ChevronLeft,ChevronRight,RefreshCw,FileText} from 'lucide-react';
import SourceTranscriptionRetry from './SourceTranscriptionRetry';
import type {SourceUploadSession} from './source-audio-upload';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';

type Upload={requestId:string;requestHash:string;title:string;status:'received'|'processing'|'transcribed'|'failed'|'blocked';receivedAt:string;briefingId:string|null;audioStatus?:'cleanup_pending'|'removed'};
type Page={items:Upload[];total:number;page:number;pageSize:number};
function checkedPage(value:unknown,page:number):Page {
  const data=value as Page;
  if(!data || data.page!==page || data.pageSize!==20 || !Number.isSafeInteger(data.total) || data.total<0 || !Array.isArray(data.items) || data.items.length>20
    || new Set(data.items.map(item=>item.requestId)).size!==data.items.length
    || data.items.some(item=>!item || typeof item.requestId!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(item.requestId)
      || !/^[a-f0-9]{64}$/.test(item.requestHash) || typeof item.title!=='string' || item.title.length<3 || item.title.length>120
      || !['received','processing','transcribed','failed','blocked'].includes(item.status) || typeof item.receivedAt!=='string' || !Number.isFinite(Date.parse(item.receivedAt))
      || (item.audioStatus!==undefined && !['cleanup_pending','removed'].includes(item.audioStatus))
      || (item.status==='transcribed'?item.briefingId!==item.requestId:item.briefingId!==null)))throw Error('Source upload history could not be verified.');
  return data;
}
export default function SourceAudioUploads({navigate:onNavigate,session,authority}:{navigate:(path:string)=>void;session:SourceUploadSession;authority:StaffRequestAuthority}) {
  const {request,current}=useStaffRequest(authority),navigate=(path:string)=>{if(current())onNavigate(path);};
  const [page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[data,setData]=useState<Page|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setData(null);setError('');
    request<unknown>(`/api/source-audio?page=${page}`,undefined,controller.signal).then(value=>{const next=checkedPage(value,page);if(!controller.signal.aborted && current())setData(next);})
      .catch(reason=>{if(!controller.signal.aborted && current())setError((reason as Error).message);}).finally(()=>{if(!controller.signal.aborted && current())setBusy(false);});
    return()=>controller.abort();
  },[page,refresh,request,current]);
  const pages=Math.max(1,Math.ceil((data?.total || 0)/20));
  return <><button className="back-link" onClick={()=>navigate('briefings')}><ArrowLeft size={18}/>Instructions</button><div className="page-header"><h1 ref={heading} tabIndex={-1}>My source audio uploads</h1><button className="button outline" disabled={busy} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={18}/>Refresh uploads</button></div>
    <section className="panel">{busy?<p role="status">Loading accepted uploads...</p>:error?<p role="alert" className="record-error">{error}</p>:<>
      {!data?.items.length && <p>No accepted uploads on this page.</p>}
      <div className="row-list">{data?.items.map(item=><article className="item-row source-upload-row" key={item.requestId}><div className="item-main"><strong>{item.title}</strong><small className="staff-recovery-request">Request {item.requestId}</small><small>{new Date(item.receivedAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</small><small>{item.status==='transcribed'?'Draft created':item.audioStatus?'Transcription stopped; no draft created':item.status==='blocked'?'Transcription blocked; no draft created':item.status==='failed'?'Transcription failed; no draft created':'Transcription pending; no draft created'}</small>{item.audioStatus && <small>{item.audioStatus==='removed'?'Source audio removed':'Source audio cleanup pending'}</small>}<SourceTranscriptionRetry session={session} sourceId={item.requestId} sourceHash={item.requestHash} retryable={!item.audioStatus && ['blocked','failed'].includes(item.status)} canAct={()=>current() && authority.canMutate()} onChanged={()=>{if(current())setRefresh(n=>n+1);}}/></div>{item.briefingId && <button className="button outline" onClick={()=>navigate(`briefings/${item.briefingId}`)}><FileText size={18}/>Open draft</button>}</article>)}</div>
      <div className="audit-pagination"><span>Page {page} of {pages} · {data?.total || 0} uploads</span><div className="actions"><button className="icon-button" aria-label="Previous upload page" title="Previous upload page" disabled={page<=1} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="Next upload page" title="Next upload page" disabled={page>=pages} onClick={()=>setPage(n=>n+1)}><ChevronRight size={18}/></button>{page>pages && <button className="button outline" onClick={()=>setPage(1)}>First page</button>}</div></div>
    </>}</section></>;
}
