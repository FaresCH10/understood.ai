import {useEffect,useRef,useState} from 'react';
import {Check,CheckCircle2,RefreshCw} from 'lucide-react';
import {useStaffText} from './staff-language';
import {workerWorkText} from './worker-work-text';
import {workerJourneyText} from './worker-journey-text';
import {workJourneyStep,type WorkerWorkItem,type WorkerWorkPage} from './worker-journey';
import type {WorkerUiLanguage} from './worker-ui-language';
import {keepDialogFocus} from './dialog-focus';
import {workerLeaveText} from './worker-unsent';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {workerWorkResponse} from './worker-work-request';

const labels:Record<string,string>={'sent':'Sent','in-progress':'In progress','follow-up':'Follow-up','done':'Done'};
export function WorkerWorkHistory({workerId,authority,refresh,navigate}:{workerId:string;authority:StaffRequestAuthority;refresh:number;navigate:(path:string)=>void}){
 const tr=useStaffText(),{request,current}=useStaffRequest(authority),[data,setData]=useState<WorkerWorkPage|null>(null),[error,setError]=useState(''),[page,setPage]=useState(1);
 useEffect(()=>{setPage(1);},[workerId]);
 useEffect(()=>{const controller=new AbortController();setError('');setData(null);
  request<WorkerWorkPage>(`/api/workspace/work?workerId=${encodeURIComponent(workerId)}&page=${page}&pageSize=10`,undefined,controller.signal).then(value=>{if(current()&&!controller.signal.aborted)setData(value);}).catch(reason=>{if(current()&&!controller.signal.aborted)setError(reason.message);});return()=>controller.abort();
 },[workerId,request,current,refresh,page]);
 const pages=Math.max(1,Math.ceil((data?.total||0)/10));
 return <section className="panel"><h2>{tr('Instruction history')}</h2><p className="muted">{tr('All assigned work, including completed instructions.')}</p>{error?<p role="alert">{tr.error(error)}</p>:data===null?<p role="status">{tr('Loading history…')}</p>:!data.items.length?<p>{tr('No instructions assigned yet.')}</p>:<div className="table-wrap"><table><thead><tr><th>{tr('Instruction')}</th><th>{tr('Status')}</th><th>{tr('Sent')}</th><th>{tr('Finished')}</th></tr></thead><tbody>{data.items.map(row=><tr key={row.id}><td><button className="text-link" onClick={()=>navigate(`briefings/${row.briefingId}`)}>{row.title} · v{tr.number(row.version)}</button></td><td>{tr(labels[row.status])}</td><td>{tr.date(row.sentAt)}</td><td>{row.completedAt?tr.date(row.completedAt):'—'}</td></tr>)}</tbody></table></div>}{data&&(pages>1||page>1)&&<div className="actions"><button className="button outline" disabled={page<=1} onClick={()=>setPage(value=>value-1)}>{tr('Previous')}</button><span>{tr('Page')} {tr.number(page)} {tr('of')} {tr.number(pages)}</span><button className="button outline" disabled={page>=pages} onClick={()=>setPage(value=>value+1)}>{tr('Next')}</button></div>}</section>;
}

export function WorkerWorkProgress({assignmentId,clientContext,current,onSessionLost,refresh,language,timezone,onCompleted,disabled=false,confirmationLabel}:{assignmentId:string;clientContext:string;current:()=>boolean;onSessionLost:()=>void;refresh:number;language:string;timezone?:string;onCompleted?:()=>void;disabled?:boolean;confirmationLabel?:string}){
 const locale=language as WorkerUiLanguage,t=workerWorkText(language),j=workerJourneyText(locale),leave=workerLeaveText[locale];
 const [row,setRow]=useState<WorkerWorkItem|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[tick,setTick]=useState(0),[loading,setLoading]=useState(true);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null),running=useRef(false),mounted=useRef(true);
 const callbacks=useRef({current,onSessionLost,onCompleted});callbacks.current={current,onSessionLost,onCompleted};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const read=async(signal?:AbortSignal)=>{const response=await fetch(`/api/workspace/work/${encodeURIComponent(assignmentId)}`,{credentials:'include',cache:'no-store',redirect:'error',signal,headers:{'x-client-session-context':clientContext}});return (await workerWorkResponse(response,()=>{if(mounted.current&&!signal?.aborted&&callbacks.current.current())callbacks.current.onSessionLost();})).item as WorkerWorkItem;};
 useEffect(()=>{const controller=new AbortController();setError('');setLoading(true);
  read(controller.signal).then(value=>{if(!controller.signal.aborted&&callbacks.current.current())setRow(value);}).catch(()=>{if(!controller.signal.aborted&&callbacks.current.current())setError(t.unavailable);}).finally(()=>{if(!controller.signal.aborted&&callbacks.current.current())setLoading(false);});return()=>controller.abort();
 },[assignmentId,clientContext,refresh,tick]);
 const accepted=(item:WorkerWorkItem)=>{if(!mounted.current||!callbacks.current.current())return;setRow(item);setError('');callbacks.current.onCompleted?.();};
 async function complete(){
  if(disabled||loading||running.current||!callbacks.current.current()||!row?.canComplete)return;
  running.current=true;setBusy(true);setError('');
  try{const response=await fetch(`/api/workspace/work/${encodeURIComponent(assignmentId)}`,{method:'POST',credentials:'include',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','x-client-session-context':clientContext},body:'{}'});const value=await workerWorkResponse(response,()=>{if(mounted.current&&callbacks.current.current())callbacks.current.onSessionLost();});if(value?.status!=='done')throw Error();accepted({...row,status:'done',completedAt:value.completedAt,canComplete:false});}
  catch{try{const item=await read();if(item.status==='done')accepted(item);else if(mounted.current&&callbacks.current.current()){setRow(item);setError(t.unavailable);}}catch{if(mounted.current&&callbacks.current.current()){setRow(null);setError(t.unavailable);}}}
  finally{running.current=false;if(mounted.current){setBusy(false);dialog.current?.close();}}
 }
 const step=row?workJourneyStep(row):0,status=row?.status==='done'?t.done:row?.status==='in-progress'?t.progress:row?.status==='follow-up'?t.follow:t.sent;
 const stages=[j.assigned,confirmationLabel||j.check,j.working,j.done];
 return <section className="worker-journey" aria-label={j.steps} aria-busy={busy||loading}>
  <div className="worker-journey-heading"><h2>{j.steps}</h2>{row&&<span className={`worker-task-state is-${row.status}`} role="status">{status}</span>}</div>
  <ol className="worker-journey-trail">{stages.map((label,index)=><li key={label} className={index<step?'is-complete':index===step?'is-current':''} aria-current={index===step?'step':undefined}><span aria-hidden="true">{index<step||index===3&&row?.status==='done'?<Check size={15}/>:index+1}</span><strong>{label}</strong></li>)}</ol>
  {row?.canComplete&&<div className="worker-finish-action"><p>{j.finishNote}</p><button type="button" className="button primary full" disabled={busy||loading||disabled||!!error} onClick={()=>{trigger.current=document.activeElement as HTMLElement;dialog.current?.showModal();}}><CheckCircle2 size={20} aria-hidden="true"/>{t.action}</button></div>}
  {row?.completedAt&&<p className="worker-finish-time"><time dateTime={row.completedAt}>{new Intl.DateTimeFormat(language,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(row.completedAt))}</time></p>}
  {error&&<div role="alert"><p>{error}</p><button type="button" className="button outline" disabled={busy} onClick={()=>setTick(value=>value+1)}><RefreshCw size={18} aria-hidden="true"/>{j.open}</button></div>}
  <dialog className="withdraw-dialog" ref={dialog} aria-labelledby="finish-work-heading" aria-describedby="finish-work-note" onKeyDown={keepDialogFocus} onCancel={event=>{if(busy)event.preventDefault();}} onClose={()=>trigger.current?.isConnected&&trigger.current.focus()}><h2 id="finish-work-heading">{t.action}</h2><p id="finish-work-note">{j.finishNote}</p><div className="actions"><button type="button" className="button outline" disabled={busy} autoFocus onClick={()=>dialog.current?.close()}>{leave.stay}</button><button type="button" className="button primary" disabled={busy||loading||disabled||!!error} onClick={()=>void complete()}>{busy?t.saving:t.action}</button></div></dialog>
 </section>;
}
