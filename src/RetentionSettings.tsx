import {useStaffText as useStaffStaticText} from './staff-language';
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
  const staffT=useStaffStaticText();
  const [days,setDays]=useState(30),[confirmed,setConfirmed]=useState(false);
  const {data,pending,saving,loading:recoveryBlocked,error,saved,setSaved,refresh,save:savePolicy}=usePolicySettings(authority,policy,(value,restored)=>{setDays(restored?.audioDays ?? value.audioDays ?? 30);setConfirmed(false);});
  async function save(){
    if(!data?.canWrite || saving || !confirmed || recoveryBlocked)return;
    const change=pending || {requestId:crypto.randomUUID(),revision:data.revision,audioDays:days,confirmed:true as const};
    setConfirmed(false);await savePolicy(change);
  }
  return <div className="privacy-settings">
    <div className="page-header"><div><h1>{staffT("Privacy & retention")}</h1><p>{staffT("Manage server data retention for this site.")}</p></div><button className="icon-button" title={staffT("Refresh retention status")} aria-label={staffT("Refresh retention status")} disabled={saving} onClick={refresh}><RefreshCw size={20}/></button></div>
    {error&&<p className="record-error" role="alert">{staffT.error(error)}</p>}
    {saved&&<p role="status">{staffT("Audio retention policy saved. Cleanup runs through scheduled jobs.")}</p>}
    {!data?<p role="status">{staffT("Loading retention settings...")}</p>:<>
      <section className="panel"><h2>{staffT("Audio retention")}</h2><p className="muted">{staffT("Current policy:")} {data.audioDays===null?staffT("Not configured"):staffT("{p0} days",{p0:data.audioDays})}</p>
        <label className="field"><span>{staffT("Keep server audio for")}</span><select value={days} disabled={!data.canWrite || saving || recoveryBlocked || !!pending} onChange={event=>{setDays(Number(event.target.value));setConfirmed(false);setSaved(false);}}>{data.audioOptions.map(value=><option key={value} value={value}>{value} {staffT("days")}</option>)}</select></label>
        {pending&&<p role="status">{staffT("The original policy save is unconfirmed. Refresh checks its receipt without resending.")}</p>}
        {data.canWrite&&<><label className="retention-confirm"><input type="checkbox" checked={confirmed} disabled={saving || recoveryBlocked} onChange={event=>setConfirmed(event.target.checked)}/>{staffT("I understand that expired worker recordings and supervisor source audio will be removed from the current application storage view, including existing audio. Provider history, backups and device caches are not verified as erased.")}</label><button className="button primary" disabled={saving || !confirmed || recoveryBlocked} onClick={()=>void save()}><Save size={18}/>{saving?staffT("Saving..."):pending?staffT("Retry policy save"):staffT("Save policy")}</button></>}
      </section>
      <div className="retention-job-grid"><section className="panel"><h2>{staffT("Audio cleanup jobs")}</h2><dl className="retention-jobs"><div><dt>{staffT("Queued")}</dt><dd>{data.jobs.queued || 0}</dd></div><div><dt>{staffT("Processing")}</dt><dd>{data.jobs.processing || 0}</dd></div><div><dt>{staffT("Completed")}</dt><dd>{data.jobs.complete || 0}</dd></div></dl></section>
      <section className="panel"><h2>{staffT("Source audio cleanup jobs")}</h2><dl className="retention-jobs"><div><dt>{staffT("Queued")}</dt><dd>{data.sourceJobs?.queued || 0}</dd></div><div><dt>{staffT("Processing")}</dt><dd>{data.sourceJobs?.processing || 0}</dd></div><div><dt>{staffT("Completed")}</dt><dd>{data.sourceJobs?.complete || 0}</dd></div></dl></section>
      </div>{data.textRetentionAvailable&&<Suspense fallback={<p data-page-loading role="status">{staffT("Loading text retention settings...")}</p>}><TextRetentionSettings authority={authority}/></Suspense>}
      {data.caseRetentionAvailable&&<Suspense fallback={<p data-page-loading role="status">{staffT("Loading case retention settings...")}</p>}><TextRetentionSettings authority={authority} category="case"/></Suspense>}
      {data.generatedRetentionAvailable&&<Suspense fallback={<p data-page-loading role="status">{staffT("Loading generated audio retention settings...")}</p>}><TextRetentionSettings authority={authority} category="generated"/></Suspense>}
      {data.activityRetentionAvailable&&<Suspense fallback={<p data-page-loading role="status">{staffT("Loading activity retention settings...")}</p>}><TextRetentionSettings authority={authority} category="activity"/></Suspense>}
      {data.briefingRetentionAvailable&&<Suspense fallback={<p data-page-loading role="status">{staffT("Loading instruction retention settings...")}</p>}><TextRetentionSettings authority={authority} category="briefing"/></Suspense>}
      <Suspense fallback={<p data-page-loading role="status">{staffT("Loading recording notice...")}</p>}><RecordingNoticeSettings authority={authority}/></Suspense>
      {data.canWrite&&<Suspense fallback={<p data-page-loading role="status">{staffT("Loading worker data requests...")}</p>}><PrivacyWorkers authority={authority}/></Suspense>}
      <div className="notice notice-amber"><TriangleAlert size={22}/><span>{staffT(data.limitations)}</span></div>
    </>}
  </div>;
}
