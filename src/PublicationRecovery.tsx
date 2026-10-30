import {useEffect,useRef,useState} from 'react';
import {RefreshCw,Send,CalendarClock} from 'lucide-react';
import {useBriefingRequest,BriefingRequestError} from './BriefingControls';
import type {StaffRequestAuthority} from './useStaffRequest';
import {clearPendingPublication,checkedPublicationReceipt,checkedPublicationResult,type PendingPublication} from './publication-recovery';

export default function PublicationRecovery({pending,scope,onResolved,authority}:{pending:PendingPublication;scope:string;onResolved:(id:string,accepted:boolean)=>void;authority:StaffRequestAuthority}) {
  const {request,current,complete,ensureCompletion}=useBriefingRequest(authority);
  const [busy,setBusy]=useState(false),[absent,setAbsent]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const sending=useRef(false),callback=useRef(onResolved);callback.current=onResolved;
  const [rejected,setRejected]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[]);
  const finish=(accepted=true)=>{ensureCompletion();clearPendingPublication(sessionStorage,scope,pending);callback.current(pending.briefingId,accepted);};
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setAbsent(false);setRejected(false);setError('');
    request(`/briefings/${encodeURIComponent(pending.briefingId)}/publication-receipts/${pending.kind}/${pending.body.requestId}`,'GET',undefined,controller.signal)
      .then(value=>complete(value,received=>checkedPublicationReceipt(received,pending),accepted=>{if(controller.signal.aborted)return;if(accepted)finish();else setAbsent(true);} ))
      .catch(reason=>{if(!controller.signal.aborted && current())setError((reason as Error).message);})
      .finally(()=>{if(!controller.signal.aborted && current())setBusy(false);});
    return()=>controller.abort();
  },[pending,scope,refresh,request,current,complete]);
  async function retry() {
    if(sending.current || !absent || !current())return;sending.current=true;setBusy(true);setAbsent(false);setError('');
    try {
      const result=await request(`/briefings/${encodeURIComponent(pending.briefingId)}/${pending.kind==='schedule'?'schedules':'publish'}`,'POST',pending.body);
      await complete(result,value=>checkedPublicationResult(value,pending),()=>finish());
    }catch(reason){if(current()){setError((reason as Error).message);if(reason instanceof BriefingRequestError && !reason.fenced && [400,409,413,422].includes(reason.status || 0))setRejected(true);}}
    finally {sending.current=false;if(current())setBusy(false);}
  }
  return <section className="panel publication-recovery"><h1 ref={heading} tabIndex={-1}>Publication receipt</h1>
    <p>{pending.kind==='schedule'?'Schedule':'Publish'} v{pending.body.nextVersion} · {pending.body.workerIds.length} selected {pending.body.workerIds.length===1?'worker':'workers'}</p>
    <p className="staff-recovery-request">Request {pending.body.requestId}</p>
    {busy && <p role="status">Checking saved outcome...</p>}{error && <p role="alert" className="record-error">{error}</p>}
    {absent && <p>No accepted receipt was found. The outcome is not confirmed.</p>}
    <div className="actions"><button className="button outline" disabled={busy} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={18}/>Check receipt</button>
      {absent && <button className="button primary" disabled={busy} onClick={()=>void retry()}>{pending.kind==='schedule'?<CalendarClock size={18}/>:<Send size={18}/>}Retry unchanged request</button>}
      {rejected && <button className="button outline" disabled={busy} onClick={()=>{try{finish(false);}catch(reason){if(current())setError((reason as Error).message);}}}><RefreshCw size={18}/>Return to draft</button>}
    </div>
  </section>;
}
