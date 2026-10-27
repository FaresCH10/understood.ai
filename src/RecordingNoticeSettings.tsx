import {WORKER_LOCALES,workerLocale} from '../server/languages.mjs';
import {useState} from 'react';
import {RefreshCw,Save} from 'lucide-react';
import {recordingNoticeInput,noticeLanguages} from '../server/recording-notice-input.mjs';
import {readPendingNotice,storePendingNotice,clearPendingNotice,verifyNoticeReceipt,type NoticeChange} from './notice-recovery';
import type {StaffRequestAuthority} from './useStaffRequest';
import {policyRecoveryScope,verifyPolicyAcknowledgement} from './policy-state';
import {usePolicySettings,type PolicyDefinition} from './usePolicySettings';
type Notices=NoticeChange['notices'];
type Data={revision:number;configured:boolean;notices:Notices;canWrite:boolean;recoveryScope:string|null};
const emptyNotices=()=>Object.fromEntries(WORKER_LOCALES.map(({code})=>[code,''])) as Notices;
const endpoint='/api/privacy/recording-notice';
const policy:PolicyDefinition<Data,NoticeChange>={
  endpoint,read:readPendingNotice,store:storePendingNotice,clear:clearPendingNotice,receipt:verifyNoticeReceipt,
  acknowledgement:(value,change)=>verifyPolicyAcknowledgement(value,change,true),
  validate(value,scope){
    const row=value as Data;
    if(!row || typeof row.canWrite!=='boolean' || typeof row.configured!=='boolean')throw Error('Recording notice settings cannot be verified.');
    policyRecoveryScope(row.recoveryScope,scope,row.canWrite);
    recordingNoticeInput({requestId:crypto.randomUUID(),revision:row.revision,notices:row.notices,confirmed:true,scope:scope!});return row;
  }
};
export function RecordingNoticeSettings({authority}:{authority:StaffRequestAuthority}){
  const [notices,setNotices]=useState<Notices>(emptyNotices),[confirmed,setConfirmed]=useState(false);
  const {data,pending,error,saving,loading,saved,setSaved,refresh,save:savePolicy}=usePolicySettings(authority,policy,(value,restored)=>{setNotices({...emptyNotices(),...(restored?.notices || value.notices)});setConfirmed(false);});
  async function save(){
    if(!data?.recoveryScope || loading || saving || !confirmed)return;
    const change=pending || {requestId:crypto.randomUUID(),revision:data.revision,notices,confirmed:true as const,scope:data.recoveryScope};
    setConfirmed(false);await savePolicy(change);
  }
  return <section className="panel" aria-label="Recording notice settings">
    <div className="people-panel-heading"><h2>Recording notice</h2><button className="icon-button" title="Refresh recording notice" aria-label="Refresh recording notice" disabled={saving} onClick={refresh}><RefreshCw size={18}/></button></div>
    {error&&<p role="alert" className="record-error">{error}</p>}{saved&&<p role="status">Recording notice saved.</p>}
    <p className="muted">Site wording supplements the standard recording information. It is not legal-consent certification.</p>
    {data? <>{noticeLanguages.map(language=><label className="field" key={language}><span>{workerLocale(language)!.englishName}</span><textarea rows={4} lang={language} dir={workerLocale(language)!.direction} maxLength={2000} value={notices[language as keyof Notices]} disabled={!data.canWrite || saving || !!pending || loading} onChange={event=>{setNotices({...notices,[language]:event.target.value});setConfirmed(false);setSaved(false);}}/></label>)}
      {pending&&<p role="status">The original notice save is pending. Refresh checks its receipt without resending.</p>}
      {data.canWrite&&<><label className="retention-confirm"><input type="checkbox" checked={confirmed} disabled={saving || loading} onChange={event=>setConfirmed(event.target.checked)}/>I have reviewed the notices for this site. Add a notice in each language your workers use. Empty text removes that language’s custom notice; the standard recording information remains available.</label><button className="button primary" disabled={!confirmed || saving || loading} onClick={()=>void save()}><Save size={18}/>{saving?'Saving...':pending?'Retry notice save':'Save notice'}</button></>}
    </>:<p role="status">Loading recording notice...</p>}
  </section>;
}
