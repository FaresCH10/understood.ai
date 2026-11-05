import {useStaffText as useStaffStaticText} from './staff-language';
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
  if(entitlement.plan==='pilot_pending')return 'Pilot awaiting approval';
  if(entitlement.effectiveState==='read_only')return entitlement.state==='trial'?'Pilot ended · read-only':'Read-only';
  if(entitlement.state==='trial')return `Pilot · ${entitlement.daysRemaining ?? 0} ${entitlement.daysRemaining===1?'day':'days'} left`;
  return 'Active';
}
function entitlementClass(entitlement:UsageEntitlement) {
  if(entitlement.plan==='pilot_pending')return 'status-blue';
  if(!entitlement.configured)return 'status-blue';
  if(entitlement.effectiveState==='read_only')return 'status-red';
  return entitlement.state==='trial'?'status-blue':'status-green';
}

export function PlanUsage({refresh=0,authority}:{refresh?:number;authority:StaffRequestAuthority}){
  const staffT=useStaffStaticText();
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
    <div className="page-header"><div><h1>{staffT("Plan & usage")}</h1><p>{staffT("Review plan details and instruction activity.")}</p></div><button className="icon-button" aria-label={staffT("Refresh plan and usage")} title={staffT("Refresh plan and usage")} disabled={loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={20}/></button></div>
    {error&&<p role="alert" className="record-error">{staffT.error(error)}</p>}
    {loading&&!data&&<p data-page-loading role="status">{staffT("Loading plan and usage...")}</p>}
    {(data&&<>
      <section className="panel entitlement-overview">
        <div className="usage-plan"><Users size={24}/><div><h2>{staffT("Workspace plan")}</h2><strong className="usage-plan-name">{staffT(data.entitlement.plan==='pilot_pending'?'Pilot awaiting approval':data.entitlement.plan==='pilot'?'Company pilot':data.plan.name)}</strong><p>{data.plan.capabilities.map(value=>staffT(value)).join(' · ')}</p></div><span className={`status ${entitlementClass(data.entitlement)}`}><span className="status-dot"/>{(data.entitlement.state==='trial'&&data.entitlement.effectiveState!=='read_only'?staffT('Pilot · {days} left',{days:staffT.days(data.entitlement.daysRemaining??0)}):staffT(entitlementLabel(data.entitlement)))}</span></div>
        {data.entitlement.configured?<dl className="entitlement-facts">
          <div><dt>{staffT("Plan")}</dt><dd>{data.entitlement.plan==='pilot_pending'?staffT('Pilot awaiting approval'):data.entitlement.plan==='pilot'?staffT('Company pilot'):data.entitlement.plan}</dd></div>
          <div><dt>{staffT("Access state")}</dt><dd>{(data.entitlement.effectiveState==='read_only'?staffT("Read-only"):staffT.state(data.entitlement.effectiveState))}</dd></div>
          <div><dt>{(data.entitlement.daysRemaining===null?staffT("End date"):staffT("Days remaining"))}</dt><dd>{(data.entitlement.plan==='pilot_pending'?staffT('Not started'):data.entitlement.daysRemaining===null?staffT("No end date"):staffT.days(data.entitlement.daysRemaining))}</dd></div>
          <div><dt>{staffT("Ends")}</dt><dd>{(data.entitlement.plan==='pilot_pending'?staffT('Set at approval'):data.entitlement.endsAt?staffT.date(data.entitlement.endsAt):staffT("No end date"))}</dd></div>
          <div><dt>{staffT("Active workers")}</dt><dd>{staffT.number(data.entitlement.activeWorkers)} / {data.entitlement.workerLimit===null?staffT("Not recorded"):staffT.number(data.entitlement.workerLimit)} {staffT("limit")}</dd></div>
          <div><dt>{staffT("Terms reference")}</dt><dd>{(data.entitlement.termsReference??(staffT("Not recorded")))}</dd></div>
        </dl>:<p className="muted">{staffT("No pilot or subscription entitlement is recorded for this workspace. It remains writable under legacy handling until platform operations records plan terms.")}</p>}
        {data.entitlement.state==='trial'&&data.entitlement.effectiveState==='read_only'&&<p className="record-error" role="status">{staffT("The pilot ended on")} {(data.entitlement.endsAt?staffT.date(data.entitlement.endsAt):staffT("the recorded end date"))}{staffT(". New activity is blocked until activation.")}</p>}
        {data.entitlement.effectiveState==='read_only'&&data.entitlement.state!=='trial'&&<p className="muted">{staffT("New sends, answers, imports and scheduled releases are blocked. Reads, sign-in, recovery, security, privacy and reconciliation remain available.")}</p>}
        {data.entitlement.request&&<p className="muted">{staffT("Activation request pending since")} {staffT.date(data.entitlement.request.requestedAt)}.</p>}
      </section>
      {data.entitlement.effectiveState==='read_only'&&<div className="notice notice-amber" role="status"><TriangleAlert size={22}/><span><strong>{staffT("This workspace is read-only.")}</strong> {staffT("Existing work can still be read and reconciled, but new business activity requires activation by platform operations.")}</span></div>}
      <div className="usage-grid">
        <section className="panel"><h2>{staffT("Instruction activity")}</h2><p className="muted">{staffT(data.period.label)}</p><p className="muted">{staffT(data.denominator)}</p>{data.units.map(unit=><div className="usage-unit" key={unit.key}><div><strong>{staffT(unit.label)}</strong><span>{staffT.number(unit.used)} / {staffT.number(unit.limit)}</span></div><div className="usage-track" role="progressbar" aria-label={staffT(unit.label)} aria-valuenow={unit.used} aria-valuemin={0} aria-valuemax={Math.max(1,unit.used,unit.limit)}><span style={{width:`${unit.percent}%`}}/></div></div>)}</section>
        <section className="panel"><h2>{staffT("Spend & controls")}</h2><div className="usage-fact"><CircleDollarSign size={22}/><div><strong>{staffT("Estimated provider cost")}</strong><span>{staffT("Unknown")}</span><small>{staffT(data.spend.estimated.evidence)}</small></div></div><div className="usage-fact"><Clock3 size={22}/><div><strong>{staffT("Actual invoice cost")}</strong><span>{staffT("Unknown")}</span><small>{staffT(data.spend.actual.evidence)}</small></div></div>{data.providerAllowance?<div className="usage-fact"><TriangleAlert size={22}/><div><strong>{staffT("Organization request allowance")}</strong><span className={`status status-${data.providerAllowance.state==='available'?'green':'amber'}`}>{staffT.state(data.providerAllowance.state)}</span><span>{staffT.number(data.providerAllowance.reserved)} / {staffT.number(data.providerAllowance.limit)} {staffT("slots reserved")}</span><small>{staffT.number(data.providerAllowance.remaining)} {staffT("unreserved organization slots ·")} {data.providerAllowance.day} UTC</small><small>{staffT("Reset")} {staffT.date(data.providerAllowance.resetsAt,'UTC')} UTC</small><small>{Object.entries(data.providerAllowance.requests).map(([state,count])=>`${staffT.number(count)} ${staffT.state(state)}`).join(' · ')}</small><small>{staffT("All jobs:")} {(data.providerAllowance.jobsPaused?staffT("paused"):staffT("not paused"))} {staffT("· Provider jobs:")} {(data.providerAllowance.providerPaused?staffT("paused"):staffT("not paused"))}</small><small>{staffT("Reservations are not invoices. Provider readiness is not verified by quota availability.")}</small></div></div>:<div className="usage-fact"><TriangleAlert size={22}/><div><strong>{staffT("Quota and pause controls")}</strong><span>{staffT("Not configured")}</span><small>{staffT(data.controls.quota.evidence)} {staffT(data.controls.pause.evidence)}</small></div></div>}</section>
      </div>
      <ActivationRequestPanel authority={authority} entitlement={data.entitlement} onChanged={()=>setTick(value=>value+1)}/>
      <div className="notice notice-amber"><TriangleAlert size={22}/><span>{(data.mode==='live-credential'?staffT("Estimates are not invoices. Request allowance does not verify billed cost."):staffT("Estimates are not invoices. Real worker data is disabled in this synthetic environment."))}</span></div>
      {data.changeRequestsAvailable && <UsageRequests authority={authority}/>}
    </>)}
  </>;
}
