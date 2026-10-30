import {useEffect,useState} from 'react';
import {CircleDollarSign,Clock3,RefreshCw,TriangleAlert,Users} from 'lucide-react';
import UsageRequests from './UsageRequests';
import ActivationRequestPanel from './ActivationRequestPanel';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {completeStaffRequest} from './staff-request';
import {checkedUsageModel,type UsageEntitlement} from './usage-state';
import type {UsageModel} from '../server/usage.mjs';

function entitlementLabel(entitlement:UsageEntitlement) {
  if(!entitlement.configured)return 'Legacy · unmanaged';
  if(entitlement.effectiveState==='read_only')return entitlement.state==='trial'?'Trial ended · read-only':'Read-only';
  if(entitlement.state==='trial')return `Trial · ${entitlement.daysRemaining ?? 0} ${entitlement.daysRemaining===1?'day':'days'} left`;
  return 'Active';
}
function entitlementClass(entitlement:UsageEntitlement) {
  if(!entitlement.configured)return 'status-blue';
  if(entitlement.effectiveState==='read_only')return 'status-red';
  return entitlement.state==='trial'?'status-blue':'status-green';
}

export function PlanUsage({refresh=0,authority}:{refresh?:number;authority:StaffRequestAuthority}){
  const {request,current}=useStaffRequest(authority);
  const [data,setData]=useState<UsageModel|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [tick,setTick]=useState(0);
  useEffect(()=>{
    const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;
    setLoading(true);
    setError('');
    request('/api/usage',undefined,controller.signal).then(value=>completeStaffRequest(value,row=>checkedUsageModel(row,authority.session.mode,authority.session.staffRole),setData,live)).catch(error=>{
      if(live()){setData(null);setError((error as Error).message);}
    }).finally(()=>{if(live())setLoading(false);});
    return ()=>controller.abort();
  },[refresh,tick,request,current,authority.session.mode,authority.session.staffRole]);
  return <>
    <div className="page-header"><div><h1>Plan &amp; usage</h1><p>Review plan details and instruction activity.</p></div><button className="icon-button" aria-label="Refresh plan and usage" title="Refresh plan and usage" disabled={loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={20}/></button></div>
    {error&&<p role="alert" className="record-error">{error}</p>}
    {loading&&!data&&<p role="status">Loading plan and usage...</p>}
    {data&&<>
      <section className="panel entitlement-overview">
        <div className="usage-plan"><Users size={24}/><div><h2>Workspace plan</h2><p>{data.plan.name} · {data.plan.capabilities.join(' · ')}</p></div><span className={`status ${entitlementClass(data.entitlement)}`}><span className="status-dot"/>{entitlementLabel(data.entitlement)}</span></div>
        {data.entitlement.configured?<dl className="entitlement-facts">
          <div><dt>Plan</dt><dd>{data.entitlement.plan}</dd></div>
          <div><dt>Access state</dt><dd>{data.entitlement.effectiveState==='read_only'?'Read-only':data.entitlement.effectiveState}</dd></div>
          <div><dt>{data.entitlement.daysRemaining===null?'End date':'Days remaining'}</dt><dd>{data.entitlement.daysRemaining===null?'No end date':`${data.entitlement.daysRemaining} ${data.entitlement.daysRemaining===1?'day':'days'}`}</dd></div>
          <div><dt>Ends</dt><dd>{data.entitlement.endsAt?new Date(data.entitlement.endsAt).toLocaleString():'No end date'}</dd></div>
          <div><dt>Active workers</dt><dd>{data.entitlement.activeWorkers} / {data.entitlement.workerLimit} limit</dd></div>
          <div><dt>Terms reference</dt><dd>{data.entitlement.termsReference ?? 'Not recorded'}</dd></div>
        </dl>:<p className="muted">No trial or subscription entitlement is recorded for this workspace. It remains writable under legacy handling until platform operations records plan terms.</p>}
        {data.entitlement.state==='trial'&&data.entitlement.effectiveState==='read_only'&&<p className="record-error" role="status">The trial ended on {data.entitlement.endsAt?new Date(data.entitlement.endsAt).toLocaleString():'the recorded end date'}. New activity is blocked until activation.</p>}
        {data.entitlement.effectiveState==='read_only'&&data.entitlement.state!=='trial'&&<p className="muted">New sends, answers, imports and scheduled releases are blocked. Reads, sign-in, recovery, security, privacy and reconciliation remain available.</p>}
        {data.entitlement.request&&<p className="muted">Activation request pending since {new Date(data.entitlement.request.requestedAt).toLocaleString()}.</p>}
      </section>
      {data.entitlement.effectiveState==='read_only'&&<div className="notice notice-amber" role="status"><TriangleAlert size={22}/><span><strong>This workspace is read-only.</strong> Existing work can still be read and reconciled, but new business activity requires activation by platform operations.</span></div>}
      <ActivationRequestPanel authority={authority} entitlement={data.entitlement} onChanged={()=>setTick(value=>value+1)}/>
      <div className="usage-grid">
        <section className="panel"><h2>Instruction activity</h2><p className="muted">{data.period.label}</p><p className="muted">{data.denominator}</p>{data.units.map(unit=><div className="usage-unit" key={unit.key}><div><strong>{unit.label}</strong><span>{unit.used} / {unit.limit}</span></div><div className="usage-track"><span style={{width:`${unit.percent}%`}}/></div></div>)}</section>
        <section className="panel"><h2>Spend &amp; controls</h2><div className="usage-fact"><CircleDollarSign size={22}/><div><strong>Estimated provider cost</strong><span>Unknown</span><small>{data.spend.estimated.evidence}</small></div></div><div className="usage-fact"><Clock3 size={22}/><div><strong>Actual invoice cost</strong><span>Unknown</span><small>{data.spend.actual.evidence}</small></div></div>{data.providerAllowance?<div className="usage-fact"><TriangleAlert size={22}/><div><strong>Organization request allowance</strong><span className={`status status-${data.providerAllowance.state==='available'?'green':'amber'}`}>{data.providerAllowance.state}</span><span>{data.providerAllowance.reserved} / {data.providerAllowance.limit} slots reserved</span><small>{data.providerAllowance.remaining} unreserved organization slots · {data.providerAllowance.day} UTC</small><small>Reset {new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'}).format(new Date(data.providerAllowance.resetsAt))} UTC</small><small>{Object.entries(data.providerAllowance.requests).map(([state,count])=>`${count} ${state}`).join(' · ')}</small><small>All jobs: {data.providerAllowance.jobsPaused?'paused':'not paused'} · Provider jobs: {data.providerAllowance.providerPaused?'paused':'not paused'}</small><small>Reservations are not invoices. Provider readiness is not verified by quota availability.</small></div></div>:<div className="usage-fact"><TriangleAlert size={22}/><div><strong>Quota and pause controls</strong><span>Not configured</span><small>{data.controls.quota.evidence} {data.controls.pause.evidence}</small></div></div>}</section>
      </div>
      <div className="notice notice-amber"><TriangleAlert size={22}/><span>Estimates are not invoices. Real worker data is disabled in this synthetic environment.</span></div>
      {data.changeRequestsAvailable && <UsageRequests authority={authority}/>}
    </>}
  </>;
}
