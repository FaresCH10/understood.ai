import {useStaffText as useStaffStaticText} from './staff-language';
import {useArtifactRead} from './useArtifactRead';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import SourceTranscriptionRetry from './SourceTranscriptionRetry';
export function ProcessingSourceRetry({authority,sourceId,refresh,retryable,onChanged}:{authority:StaffRequestAuthority;sourceId:string;refresh:number;retryable:boolean;onChanged:()=>void}) {
  const staffT=useStaffStaticText();
  const {current}=useStaffRequest(authority);
  const {data,error,loading}=useArtifactRead<unknown>(authority,`/api/source-audio/${encodeURIComponent(sourceId)}`,refresh);
  if(loading)return <p data-page-loading role="status">{staffT("Loading source request...")}</p>;
  if(error)return <p role="alert">{staffT.error(error)}</p>;
  const value=data as {found:boolean;requestId:string;requestHash:string;status:string;receivedAt:string;briefingId:string|null;audioStatus?:string}|null;
  if(!value || !value.found || value.requestId!==sourceId || !/^[a-f0-9]{64}$/.test(value.requestHash) || !['received','processing','transcribed','failed','blocked'].includes(value.status)
    || !Number.isFinite(Date.parse(value.receivedAt)) || Object.keys(value).some(key=>!['found','requestId','requestHash','status','receivedAt','briefingId','audioStatus'].includes(key)))return <p role="alert">{staffT("Source request cannot be verified.")}</p>;
  return <SourceTranscriptionRetry session={{clientContext:authority.session.clientContext!,expiresAt:authority.session.expiresAt!}} sourceId={sourceId} sourceHash={value.requestHash}
    retryable={retryable && !value.audioStatus && ['failed','blocked'].includes(value.status)} canAct={()=>current() && authority.canMutate()} onChanged={()=>{if(current() && authority.canMutate())onChanged();}}/>;
}
