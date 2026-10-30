import {useMemo,useState} from 'react';
import {RefreshCw,Save} from 'lucide-react';
import {textRetentionDays,textRetentionInput} from '../server/text-retention-input.mjs';
import {readPendingTextRetention,storePendingTextRetention,clearPendingTextRetention,verifyTextRetentionReceipt,type TextRetentionChange} from './text-retention-recovery';
import type {StaffRequestAuthority} from './useStaffRequest';
import {policyRecoveryScope,verifyPolicyAcknowledgement,type RetentionCategory} from './policy-state';
import {usePolicySettings,type PolicyDefinition} from './usePolicySettings';

type Data={revision:number;days:number|null;canWrite:boolean;recoveryScope:string|null;options:number[];completed:Record<string,number>;limitations:string};
export function TextRetentionSettings({authority,category='response'}:{authority:StaffRequestAuthority;category?:RetentionCategory}) {
  const isCase=category==='case',isGenerated=category==='generated',isActivity=category==='activity',isBriefing=category==='briefing',endpoint=isBriefing?'/api/retention/briefings':isActivity?'/api/retention/activity':isGenerated?'/api/retention/generated':isCase?'/api/retention/cases':'/api/retention/text';
  const title=isBriefing?'Archived instruction content retention':isActivity?'Activity identity retention':isGenerated?'Generated instruction audio retention':isCase?'Resolved case retention':'Response text retention';
  const policyName=isBriefing?'briefing':isActivity?'activity':isGenerated?'generated audio':isCase?'case':'text';
  const confirmation=isActivity?'I understand that actor and item identifiers in expired activity will be cleared from the current application view. Minimal event IDs, actions, actor types and timestamps remain. Other operational ledgers, policy acceptance, backups and downloaded copies have separate lifecycles. Disabling cleanup cannot restore removed identifiers.':isGenerated?'I understand that generated instruction and question audio will expire from its verified storage date, including current published and draft versions. Playback and publishing expired bundles stop, and queued cleanup removes private objects from the current storage view. Provider history, backups and device caches are not verified as erased. Text, published snapshots and history remain. Disabling this policy cannot restore audio or cancel already queued cleanup.':isCase?'I understand that expired resolved case reasons, notes, help text, messages, follow-up translations and disagreement reasons will be redacted from the current application view. Voice playback stops and saved voice objects are queued for cleanup. Open cases and outcomes remain unchanged. Disabling cleanup cannot restore removed content.':'I understand that expired saved answers, assessment quotes and transcripts will be redacted from the current application view. Recording processing and playback stop; stored report exports expire. Outcomes remain unchanged. Disabling cleanup cannot restore removed content.';
  const [days,setDays]=useState<number|null>(null),[confirmed,setConfirmed]=useState(false);
  const policy=useMemo<PolicyDefinition<Data,TextRetentionChange>>(()=>({
    endpoint,read:readPendingTextRetention,store:storePendingTextRetention,clear:clearPendingTextRetention,
    acknowledgement:verifyPolicyAcknowledgement,receipt:verifyTextRetentionReceipt,
    validate(value,scope){
      const row=value as Data;
      if(!row || typeof row.canWrite!=='boolean' || JSON.stringify(row.options)!==JSON.stringify(textRetentionDays)
        || typeof row.limitations!=='string' || !row.completed)throw Error('Text retention settings cannot be verified.');
      textRetentionInput({requestId:crypto.randomUUID(),revision:row.revision,days:row.days,confirmed:true});
      policyRecoveryScope(row.recoveryScope,scope,row.canWrite,category);return row;
    }
  }),[endpoint,category]);
  const {data,pending,loading,saving,saved,error,setSaved,refresh,save:savePolicy}=usePolicySettings(authority,policy,(value,restored)=>{setDays(restored?restored.days:value.days);setConfirmed(false);});
  async function save() {
    if(!data?.canWrite || !data.recoveryScope || loading || saving || !confirmed)return;
    const change=pending || {requestId:crypto.randomUUID(),revision:data.revision,days,confirmed:true as const};
    setConfirmed(false);await savePolicy(change);
  }
  const displayedConfirmation=isBriefing?'I understand that archived instruction source, prepared content and publication copies will be redacted from the current application view after the archive and related answers/case resolutions have aged past this policy. Pending checks and open cases prevent cleanup. Generated audio must finish its separate cleanup first. Version identities, audiences, outcomes and hashes remain; disabling cleanup cannot restore content.':confirmation;
  return <section className="panel content-retention" aria-label={title}>
    <div className="people-panel-heading"><h2>{title}</h2><button className="icon-button" title={`Refresh ${policyName} retention`} aria-label={`Refresh ${policyName} retention`} disabled={saving} onClick={refresh}><RefreshCw size={18}/></button></div>
    {error&&<p role="alert" className="record-error">{error}</p>}{saved&&<p role="status">{isBriefing?'Instruction':isActivity?'Activity':isGenerated?'Generated audio':isCase?'Case':'Text'} retention policy save confirmed.</p>}
    {data?<>
      <p className="muted">Current policy: {data.days===null?'Disabled':`${data.days} days`}</p>
      <label className="field"><span>{isBriefing?'Keep archived instruction content for':isActivity?'Keep activity actor and item identifiers for':isGenerated?'Keep generated instruction audio for':isCase?'Keep resolved case content for':'Keep worker answer text and transcripts for'}</span><select value={days===null?'disabled':days} disabled={!data.canWrite || loading || saving || !!pending} onChange={event=>{setDays(event.target.value==='disabled'?null:Number(event.target.value));setConfirmed(false);setSaved(false);}}><option value="disabled">Disabled</option>{data.options.map(value=><option key={value} value={value}>{value} days</option>)}</select></label>
      {pending&&<p role="status">The original policy save is unconfirmed. Refresh checks its receipt without resending.</p>}
      {data.canWrite&&<><label className="retention-confirm"><input type="checkbox" checked={confirmed} disabled={loading || saving} onChange={event=>setConfirmed(event.target.checked)}/>{displayedConfirmation}</label><button className="button primary" disabled={loading || saving || !confirmed} onClick={()=>void save()}><Save size={18}/>{saving?'Saving...':pending?`Retry ${policyName} policy save`:`Save ${policyName} policy`}</button></>}
      <dl className="retention-jobs">{isBriefing?<div><dt>Instructions Redacted</dt><dd>{data.completed.briefing || 0}</dd></div>:isActivity?<div><dt>Activity Identities Cleared</dt><dd>{data.completed.activity || 0}</dd></div>:isGenerated?<><div><dt>Bundles Retired</dt><dd>{data.completed.retired || 0}</dd></div><div><dt>Bundles Removed</dt><dd>{data.completed.removed || 0}</dd></div></>:isCase?<div><dt>Cases Redacted</dt><dd>{data.completed.case || 0}</dd></div>:<><div><dt>Answers Redacted</dt><dd>{data.completed.attempt || 0}</dd></div><div><dt>Transcripts Cleared</dt><dd>{data.completed.recording || 0}</dd></div></>}</dl>
      <p className="muted">{data.limitations}</p>
    </>:<p role="status">Loading {policyName} retention settings...</p>}
  </section>;
}
