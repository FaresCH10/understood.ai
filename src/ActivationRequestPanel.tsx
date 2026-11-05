import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {RefreshCw,Send} from 'lucide-react';
import {readActivationRequest,storeActivationRequest,clearActivationRequest,checkedActivationResult,checkedActivationReceipt,type PendingActivationRequest,type ActivationRecord} from './activation-request-recovery';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {useArtifactMutation} from './useArtifactMutation';
import type {UsageEntitlement} from './usage-state';
import type {ArtifactDefinition} from './useArtifactRequest';

const roles=['owner','administrator'];

export default function ActivationRequestPanel({authority,entitlement,onChanged}:{authority:StaffRequestAuthority;entitlement:UsageEntitlement;onChanged:()=>void}) {
  const staffT=useStaffStaticText();
  const session=useMemo(()=>({clientContext:authority.session.clientContext!,expiresAt:authority.session.expiresAt!}),[authority.session.clientContext,authority.session.expiresAt]);
  const [recovery]=useState(()=>{try{return {pending:readActivationRequest(sessionStorage,session),error:''};}catch(reason){return {pending:null,error:(reason as Error).message};}});
  const [note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false),[notice,setNotice]=useState('');
  const {current}=useStaffRequest(authority),scope=authority.session.staffScope;
  const definition=useMemo<ArtifactDefinition<PendingActivationRequest,ActivationRecord>>(()=>({endpoint:'/api/entitlement/requests',path:()=>'',roles,
    receiptPath:value=>`/${encodeURIComponent(value.requestId)}`,result:checkedActivationResult,receipt:checkedActivationReceipt,
    clear:(storage,_scope,_id,value)=>clearActivationRequest(storage,value)
  }),[]);
  const mutation=useArtifactMutation(authority,scope,definition,(storage,_scope,value)=>{
    if(value.clientContext!==session.clientContext || value.expiresAt!==session.expiresAt)throw Error('The original activation request session changed.');storeActivationRequest(storage,value);
  },!recovery.error && roles.includes(authority.session.staffRole || ''),result=>{
    setNote('');setConfirmed(false);
    setNotice(result.state==='pending'
      ? 'Activation request recorded for platform operations. No plan, access or payment changed.'
      : result.state==='accepted'?'Platform operations accepted this activation request. The new access state is shown above.'
      : 'Platform operations declined this activation request. You can submit a new request.');
    onChanged();
  },recovery.pending);
  const pending=mutation.pending.current,busy=mutation.busy,error=mutation.error,locked=busy || !!pending || !!recovery.error;
  useEffect(()=>{if(!recovery.pending)return;const abort=new AbortController();queueMicrotask(()=>{if(!abort.signal.aborted)void mutation.check(abort.signal);});return()=>abort.abort();},[mutation.api,recovery.pending]);
  function submit(event:FormEvent){event.preventDefault();if(!confirmed || locked || !current())return;setNotice('');setConfirmed(false);
    const trimmed=note.trim();void mutation.write({...session,requestId:crypto.randomUUID(),body:{note:trimmed || null,confirmed:true}});}
  if(!roles.includes(authority.session.staffRole || ''))return null;
  const serverPending=entitlement.request;
  const title=entitlement.plan==='pilot_pending'?'Request pilot approval':entitlement.effectiveState==='read_only'?'Discuss rollout or extension':entitlement.state==='active'?'Request plan change':'Request pilot extension';
  return <section className="panel activation-requests"><h2>{staffT("Activation & plan")}</h2>
    <p className="muted">{staffT("Requests are recorded for platform operations and reviewed by an authorized operator. They do not change access, purchase a plan or take payment by themselves.")}</p>
    {recovery.error?<p role="alert" className="record-error">{staffT.error(recovery.error)}</p>:null}
    {pending?<div role="region" aria-label={staffT("Saved activation request")}><h3>{staffT("Saved request")}</h3><p className="usage-saved-intent" dir="auto">{(pending.body.note||staffT("No note added."))}</p><p role="status">{busy?staffT("Checking request..."):mutation.checked?staffT("No accepted receipt was found."):staffT("Acceptance has not been verified.")}</p>
      {mutation.checked && <label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>{staffT("Retry the original request")}</label>}
      <div className="actions"><button className="button outline" disabled={busy} onClick={()=>{setConfirmed(false);void mutation.check();}}><RefreshCw size={18}/>{staffT("Check receipt")}</button>{mutation.checked && <button className="button primary" disabled={busy || !confirmed} onClick={()=>{setConfirmed(false);void mutation.write(pending);}}><Send size={18}/>{staffT("Retry unchanged request")}</button>}</div>
    </div>:null}
    {serverPending?<div className="usage-request-row activation-pending" role="status"><div><strong>{staffT("Activation request pending")}</strong><span className="muted">{staffT.date(serverPending.requestedAt)}</span></div>{serverPending.note && <p dir="auto">{serverPending.note}</p>}<small className="muted">{staffT("Waiting for platform operations. No changes applied.")}</small></div>:!pending && !recovery.error && <form onSubmit={submit}><label>{staffT("Note for platform operations (optional)")}<textarea maxLength={500} rows={3} value={note} disabled={locked} onChange={event=>{setNote(event.target.value);setConfirmed(false);}}/></label><label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={locked} onChange={event=>setConfirmed(event.target.checked)}/>{staffT("Record this activation request")}</label><button className="button primary" disabled={locked || !confirmed}><Send size={18}/>{staffT(title)}</button></form>}
    {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}{notice && <p role="status">{staffT.message(notice)}</p>}
  </section>;
}
