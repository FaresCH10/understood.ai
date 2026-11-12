import {useStaffText as useStaffStaticText} from './staff-language';
import {useStaffText} from './staff-language';
import RecipientMembers from './RecipientMembers';
import {RefreshCw} from 'lucide-react';
import type {RefObject} from 'react';

export type AudienceType='all'|'crew'|'members';
export type AudienceMember={id:string;code:string;name:string|null;language:string;language_selection_required:boolean|number};
export type AudienceCrew={id:string;name:string;members:number;byLanguage:Record<string,number>;notSelected:number};
export type AudienceOverview={members:AudienceMember[];workers:{total:number;byLanguage:Record<string,number>;notSelected?:number};crews:AudienceCrew[]};
export type SelectedAudience={total:number;notSelected:number;byLanguage:Record<string,number>};
export type AudienceReadiness={mode:string;textLanguages:string[];speechLanguages:string[];providerLabel?:string|null;translationProviderLabel?:string|null};

type Props={
  audience:AudienceOverview|null;
  audienceType:AudienceType;
  crewId:string;
  workerIds:string[];
  selectedAudience:SelectedAudience|null;
  selectedCrew:AudienceCrew|null;
  audienceLoading:boolean;
  audienceError:string;
  audienceErrorRef?:RefObject<HTMLParagraphElement|null>;
  disabled:boolean;
  readiness:AudienceReadiness|null;
  readinessError:string;
  unavailableLanguages:string[];
  deliveryBlocked:boolean;
  deliveryHint:string;
  canSwitchToText:boolean;
  onAudienceType:(value:AudienceType)=>void;
  onCrewId:(value:string)=>void;
  onWorkerIds:(value:string[])=>void;
  onRefresh:()=>void;
  onSwitchToText:()=>void;
};

export function InstructionAudienceFields({
  audience,audienceType,crewId,workerIds,selectedAudience,selectedCrew,audienceLoading,audienceError,audienceErrorRef,
  disabled,readiness,readinessError,unavailableLanguages,deliveryBlocked,deliveryHint,canSwitchToText,
  onAudienceType,onCrewId,onWorkerIds,onRefresh,onSwitchToText,
}:Props){
  const staffT=useStaffStaticText();
  const tr=useStaffText();
  const audienceHint=audienceType==='crew'&&!selectedCrew?staffT("Select a crew to continue.")
    :audienceType==='crew'&&selectedCrew?.members===0?staffT("This crew has no workers yet.")
    :selectedAudience?.notSelected?staffT("Select a language for every worker in this audience.")
    :selectedAudience?staffT("Choose at least one worker with a selected language.")
    :staffT("Loading recipients...");
  return <>
    <label className="field">{tr("Who should receive it?")}
      <select value={audienceType} disabled={disabled} onChange={event=>onAudienceType(event.target.value as AudienceType)}>
        <option value="all">{tr("All active workers")}</option>
        <option value="crew">{tr("Crews")}</option>
        <option value="members">{tr("Members")}</option>
      </select>
    </label>
    {audienceType==='crew'&&<label className="field">{tr("Choose crew")}
      <select aria-label={tr("Choose crew")} value={crewId} disabled={disabled} onChange={event=>onCrewId(event.target.value)}>
        <option value="">{tr("Select crew")}</option>
        {audience?.crews.map(crew=><option key={crew.id} value={crew.id}>{crew.name} ({crew.members})</option>)}
      </select>
    </label>}
    {audienceType==='members'&&<RecipientMembers members={audience?.members||[]} selected={workerIds} onChange={onWorkerIds} disabled={disabled}/>}

    <button type="button" className="text-link send-refresh-recipients" disabled={disabled||audienceLoading} onClick={onRefresh}>
      <RefreshCw size={16}/>{staffT.locale==='ar'?'تحديث المستلمين':'Refresh recipients'}
    </button>
    {selectedAudience&&<div className="language-chips send-audience-languages" aria-label={staffT("Worker languages")}>
      {Object.entries(selectedAudience.byLanguage||{}).filter(([,count])=>count>0).map(([code,count])=><i key={code}>{code.toUpperCase()} {count}</i>)}
    </div>}
    {!!selectedAudience?.notSelected&&<p className="notice notice-amber" role="status">{selectedAudience.notSelected} {staffT("active workers in this audience still need a language selected in Team before sending.")}</p>}
    {audienceError&&<p className="notice notice-amber" role="alert" ref={audienceErrorRef} tabIndex={-1}>{staffT.error(audienceError)} <button type="button" className="text-link" onClick={onRefresh}>{staffT("Try again")}</button></p>}
    {selectedAudience&&selectedAudience.total===0&&!selectedAudience.notSelected&&(audienceType==='members'
      ?<p className="muted">{staffT("Choose at least one worker to continue.")}</p>
      :<p className="notice notice-amber" role="status">{audienceType==='crew'?staffT("This crew has no workers yet. Add workers to the crew or choose another audience."):staffT("There are no active workers yet. Add workers in Team first.")}</p>)}
    {!!readiness&&unavailableLanguages.length>0&&<p className="notice notice-amber" role="status">
      {staffT.locale==='ar'?'اللغات غير الجاهزة للصيغة المحددة:':'Not ready for the selected delivery format:'} {unavailableLanguages.map(code=>staffT.language(code)).join(staffT.locale==='ar'?'، ':', ')}. {deliveryBlocked?deliveryHint:staffT("You can send to the ready workers and review exclusions before sending, or adjust recipients first.")}
      {canSwitchToText&&<> <button type="button" className="text-link" onClick={onSwitchToText}>{tr("Text only")}</button></>}
    </p>}
    {readinessError&&<p className="notice notice-amber" role="status">{staffT(readinessError)} <button type="button" className="text-link" onClick={onRefresh}>{staffT("Try again")}</button></p>}
    {!selectedAudience&&!audienceError&&<p className="muted">{audienceHint}</p>}
  </>;
}
