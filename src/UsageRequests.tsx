import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {ChevronLeft,ChevronRight,RefreshCw,Send} from 'lucide-react';
import {readUsageRequest,storeUsageRequest,clearUsageRequest,checkedUsageResult,checkedUsageReceipt,checkedUsageInbox,type PendingUsageRequest,type UsageInbox,type UsageRecord} from './usage-request-recovery';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {completeStaffRequest} from './staff-request';
import {useArtifactMutation} from './useArtifactMutation';
import type {ArtifactDefinition} from './useArtifactRequest';

export default function UsageRequests({authority}:{authority:StaffRequestAuthority}) {
  const staffT=useStaffStaticText();
  const session=useMemo(()=>({clientContext:authority.session.clientContext!,expiresAt:authority.session.expiresAt!}),[authority.session.clientContext,authority.session.expiresAt]);
  const [recovery]=useState(()=>{try{return {pending:readUsageRequest(sessionStorage,session),error:''};}catch(reason){return {pending:null,error:(reason as Error).message};}});
  const [kind,setKind]=useState('quota'),[message,setMessage]=useState(''),[confirmed,setConfirmed]=useState(false),[notice,setNotice]=useState(''),[tick,setTick]=useState(0),[page,setPage]=useState(1),[inbox,setInbox]=useState<UsageInbox|null>(null),[listError,setListError]=useState(''),[loading,setLoading]=useState(true);
  const {request,current}=useStaffRequest(authority),scope=authority.session.staffScope;
  const definition=useMemo<ArtifactDefinition<PendingUsageRequest,UsageRecord>>(()=>({endpoint:'/api/usage/requests',path:()=>'',roles:['owner','administrator','supervisor'],
    receiptPath:value=>`/${encodeURIComponent(value.requestId)}`,result:checkedUsageResult,receipt:checkedUsageReceipt,
    clear:(storage,_scope,_id,value)=>clearUsageRequest(storage,value)
  }),[]);
  const mutation=useArtifactMutation(authority,scope,definition,(storage,_scope,value)=>{
    if(value.clientContext!==session.clientContext || value.expiresAt!==session.expiresAt)throw Error('The original usage request session changed.');storeUsageRequest(storage,value);
  },!recovery.error && ['owner','administrator','supervisor'].includes(authority.session.staffRole || ''),()=>{
    setMessage('');setConfirmed(false);setNotice('Request recorded in the site owner inbox. No plan, quota or payment changed.');setTick(n=>n+1);
  },recovery.pending);
  const pending=mutation.pending.current,busy=mutation.busy,error=mutation.error,locked=busy || !!pending || !!recovery.error;
  useEffect(()=>{
    const abort=new AbortController(),live=()=>current() && !abort.signal.aborted;setListError('');setLoading(true);
    request(`/api/usage/requests?page=${page}`,undefined,abort.signal)
      .then(value=>completeStaffRequest(value,row=>checkedUsageInbox(row,page,authority.session.staffRole!),setInbox,live))
      .catch(reason=>{if(live()){setInbox(null);setListError((reason as Error).message);}}).finally(()=>{if(live())setLoading(false);});
    return()=>abort.abort();
  },[page,tick,request,current,authority.session.staffRole]);
  useEffect(()=>{if(!recovery.pending)return;const abort=new AbortController();queueMicrotask(()=>{if(!abort.signal.aborted)void mutation.check(abort.signal);});return()=>abort.abort();},[mutation.api,recovery.pending]);
  function submit(event:FormEvent){event.preventDefault();if(!confirmed || !message.trim() || locked || !current())return;setNotice('');setConfirmed(false);void mutation.write({...session,requestId:crypto.randomUUID(),body:{kind,message:message.trim(),confirmed:true}});}
  return <section className="panel usage-requests"><h2>{staffT("Plan & allowance requests")}</h2><p className="muted">{staffT("Requests are recorded for the site owner. They do not change limits, purchase a subscription or send email.")}</p>
    {recovery.error?<p role="alert" className="record-error">{staffT.error(recovery.error)}</p>:pending?<div role="region" aria-label={staffT("Saved usage request")}><h3>{staffT("Request receipt")}</h3><p className="usage-saved-intent" dir="auto">{pending.body.kind}: {pending.body.message}</p><p role="status">{busy?staffT("Checking request..."):mutation.checked?staffT("No accepted receipt was found."):staffT("Acceptance has not been verified.")}</p>
      {mutation.checked && <label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>{staffT("Retry the original request")}</label>}
      <div className="actions"><button className="button outline" disabled={busy} onClick={()=>{setConfirmed(false);void mutation.check();}}><RefreshCw size={18}/>{staffT("Check receipt")}</button>{mutation.checked && <button className="button primary" disabled={busy || !confirmed} onClick={()=>{setConfirmed(false);void mutation.write(pending);}}><Send size={18}/>{staffT("Retry unchanged request")}</button>}</div>
    </div>:<form onSubmit={submit}><label>{staffT("Request type")}<select value={kind} disabled={locked} onChange={event=>{setKind(event.target.value);setConfirmed(false);}}><option value="quota">{staffT("Request allowance change")}</option><option value="plan">{staffT("Request plan discussion")}</option><option value="contact">{staffT("Contact site owner")}</option></select></label><label>{staffT("Message")}<textarea maxLength={1000} rows={3} value={message} disabled={locked} onChange={event=>{setMessage(event.target.value);setConfirmed(false);}}/></label><label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={locked || !message.trim()} onChange={event=>setConfirmed(event.target.checked)}/>{staffT("Record this request for the site owner")}</label><button className="button primary" disabled={locked || !confirmed || !message.trim()}><Send size={18}/>{staffT("Record request")}</button></form>}
    {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}{notice && <p role="status">{staffT.message(notice)}</p>}
    <h3>{inbox?.scope==='site_owner_inbox'?staffT("Site owner inbox"):staffT("Your requests")}</h3>{listError && <p role="alert" className="record-error">{listError}</p>}{loading && <p data-page-loading role="status">{staffT("Loading recorded requests...")}</p>}
    {inbox?.items.map(row=><article className="usage-request-row" key={row.requestId}><div><strong>{row.request.kind}</strong><span className="muted">{staffT.date(row.createdAt)}</span></div><p dir="auto">{row.request.message}</p><small className="muted">{staffT("Recorded · no changes applied")}</small></article>)}
    {inbox?.total===0 && <p className="muted">{staffT("No recorded requests.")}</p>}<div className="actions"><button className="icon-button" aria-label={staffT("Previous request page")} title={staffT("Previous request page")} disabled={page===1 || busy || loading} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={18}/></button><span>{staffT("Page")} {staffT.number(page)} {staffT("of")} {Math.max(1,Math.ceil((inbox?.total || 0)/10))}</span><button className="icon-button" aria-label={staffT("Next request page")} title={staffT("Next request page")} disabled={!inbox || page*inbox.pageSize>=inbox.total || busy || loading || page>=9999} onClick={()=>setPage(n=>n+1)}><ChevronRight size={18}/></button></div>
  </section>;
}
