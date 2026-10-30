import {lazy,Suspense,useState} from 'react';
import {RefreshCw,Save,TriangleAlert} from 'lucide-react';
import {readPendingRetention,storePendingRetention,clearPendingRetention,verifyRetentionReceipt,type RetentionChange} from './retention-recovery';
import type {StaffRequestAuthority} from './useStaffRequest';
import {audioRetentionDays} from '../server/retention-input.mjs';
import {policyRecoveryScope,verifyPolicyAcknowledgement} from './policy-state';
import {usePolicySettings,type PolicyDefinition} from './usePolicySettings';
const PrivacyWorkers=lazy(()=>import('./PrivacyWorkers').then(module=>({default:module.PrivacyWorkers})));
const RecordingNoticeSettings=lazy(()=>import('./RecordingNoticeSettings').then(module=>({default:module.RecordingNoticeSettings})));
const TextRetentionSettings=lazy(()=>import('./TextRetentionSettings').then(module=>({default:module.TextRetentionSettings})));

type Retention={revision:number;audioDays:number|null;canWrite:boolean;recoveryScope:string|null;audioOptions:number[];jobs:Record<string,number>;sourceJobs?:Record<string,number>;textRetentionAvailable?:boolean;caseRetentionAvailable?:boolean;generatedRetentionAvailable?:boolean;activityRetentionAvailable?:boolean;briefingRetentionAvailable?:boolean;limitations:string};
type Change=RetentionChange;
const policy:PolicyDefinition<Retention,Change>={
  endpoint:'/api/retention',read:readPendingRetention,store:storePendingRetention,clear:clearPendingRetention,
  acknowledgement:verifyPolicyAcknowledgement,receipt:verifyRetentionReceipt,
  validate(value,scope){
    const row=value as Retention;
    if(!row || !Number.isSafeInteger(row.revision) || row.revision<0 || typeof row.canWrite!=='boolean'
      || row.audioDays!==null && !audioRetentionDays.includes(row.audioDays)
      || JSON.stringify(row.audioOptions)!==JSON.stringify(audioRetentionDays) || !row.jobs || typeof row.limitations!=='string')throw Error('Retention settings cannot be verified.');
    policyRecoveryScope(row.recoveryScope,scope,row.canWrite);return row;
  }
};
export function RetentionSettings({authority}:{authority:StaffRequestAuthority}){
  const [days,setDays]=useState(30),[confirmed,setConfirmed]=useState(false);
  const {data,pending,saving,loading:recoveryBlocked,error,saved,setSaved,refresh,save:savePolicy}=usePolicySettings(authority,policy,(value,restored)=>{setDays(restored?.audioDays ?? value.audioDays ?? 30);setConfirmed(false);});
  async function save(){
    if(!data?.canWrite || saving || !confirmed || recoveryBlocked)return;
    const change=pending || {requestId:crypto.randomUUID(),revision:data.revision,audioDays:days,confirmed:true as const};
    setConfirmed(false);await savePolicy(change);
  }
  return <>
    <div className="page-header"><div><h1>Privacy &amp; retention</h1><p>Manage server data retention for this site.</p></div><button className="icon-button" title="Refresh retention status" aria-label="Refresh retention status" disabled={saving} onClick={refresh}><RefreshCw size={20}/></button></div>
    {error&&<p className="record-error" role="alert">{error}</p>}
    {saved&&<p role="status">Audio retention policy saved. Cleanup runs through scheduled jobs.</p>}
    {!data?<p role="status">Loading retention settings...</p>:<>
      <section className="panel"><h2>Audio retention</h2><p className="muted">Current policy: {data.audioDays===null?'Not configured':`${data.audioDays} days`}</p>
        <label className="field"><span>Keep server audio for</span><select value={days} disabled={!data.canWrite || saving || recoveryBlocked || !!pending} onChange={event=>{setDays(Number(event.target.value));setConfirmed(false);setSaved(false);}}>{data.audioOptions.map(value=><option key={value} value={value}>{value} days</option>)}</select></label>
        {pending&&<p role="status">The original policy save is unconfirmed. Refresh checks its receipt without resending.</p>}
        {data.canWrite&&<><label className="retention-confirm"><input type="checkbox" checked={confirmed} disabled={saving || recoveryBlocked} onChange={event=>setConfirmed(event.target.checked)}/>I understand that expired worker recordings and supervisor source audio will be removed from the current application storage view, including existing audio. Provider history, backups and device caches are not verified as erased.</label><button className="button primary" disabled={saving || !confirmed || recoveryBlocked} onClick={()=>void save()}><Save size={18}/>{saving?'Saving...':pending?'Retry policy save':'Save policy'}</button></>}
      </section>
      <section className="panel"><h2>Audio cleanup jobs</h2><dl className="retention-jobs"><div><dt>Queued</dt><dd>{data.jobs.queued || 0}</dd></div><div><dt>Processing</dt><dd>{data.jobs.processing || 0}</dd></div><div><dt>Completed</dt><dd>{data.jobs.complete || 0}</dd></div></dl></section>
      <section className="panel"><h2>Source audio cleanup jobs</h2><dl className="retention-jobs"><div><dt>Queued</dt><dd>{data.sourceJobs?.queued || 0}</dd></div><div><dt>Processing</dt><dd>{data.sourceJobs?.processing || 0}</dd></div><div><dt>Completed</dt><dd>{data.sourceJobs?.complete || 0}</dd></div></dl></section>
      {data.textRetentionAvailable&&<Suspense fallback={<p role="status">Loading text retention settings...</p>}><TextRetentionSettings authority={authority}/></Suspense>}
      {data.caseRetentionAvailable&&<Suspense fallback={<p role="status">Loading case retention settings...</p>}><TextRetentionSettings authority={authority} category="case"/></Suspense>}
      {data.generatedRetentionAvailable&&<Suspense fallback={<p role="status">Loading generated audio retention settings...</p>}><TextRetentionSettings authority={authority} category="generated"/></Suspense>}
      {data.activityRetentionAvailable&&<Suspense fallback={<p role="status">Loading activity retention settings...</p>}><TextRetentionSettings authority={authority} category="activity"/></Suspense>}
      {data.briefingRetentionAvailable&&<Suspense fallback={<p role="status">Loading instruction retention settings...</p>}><TextRetentionSettings authority={authority} category="briefing"/></Suspense>}
      <Suspense fallback={<p role="status">Loading recording notice...</p>}><RecordingNoticeSettings authority={authority}/></Suspense>
      {data.canWrite&&<Suspense fallback={<p role="status">Loading worker data requests...</p>}><PrivacyWorkers authority={authority}/></Suspense>}
      <div className="notice notice-amber"><TriangleAlert size={22}/><span>{data.limitations}</span></div>
    </>}
  </>;
}
