import {useStaffText as useStaffStaticText} from './staff-language';
import {useEffect,useMemo,useRef,useState} from 'react';
import {RefreshCw,Sparkles} from 'lucide-react';
import {checkedArtifactScope} from './artifact-request';
import {useArtifactRead} from './useArtifactRead';
import {useArtifactMutation} from './useArtifactMutation';
import type {ArtifactDefinition} from './useArtifactRequest';
import type {StaffRequestAuthority} from './useStaffRequest';
import {readPendingPreparation,savePendingPreparation,clearPendingPreparation,checkedPreparationContext,checkedPreparationRequestResult,checkedPreparationRequestReceipt,type PendingPreparation,type PreparationContext} from './preparation-request-recovery';
export function PreparationRequest({authority,briefingId,revision,jobId,refresh=0,disabled=false,canStart=true,autoStart=false,onChanged,onActiveChange}:{
  authority:StaffRequestAuthority;briefingId:string;revision:number;jobId?:string;refresh?:number;disabled?:boolean;canStart?:boolean;autoStart?:boolean;onChanged:()=>void;onActiveChange?:(active:boolean)=>void}) {
  const staffT=useStaffStaticText();
  const scope=authority.session.staffScope;
  const [recovery]=useState(()=>{try{return {pending:readPendingPreparation(sessionStorage,checkedArtifactScope(scope,authority.session),briefingId),error:''};}catch(reason){return {pending:null,error:(reason as Error).message};}});
  const definition=useMemo<ArtifactDefinition<PendingPreparation,ReturnType<typeof checkedPreparationRequestResult>>>(()=>({
    endpoint:`/api/briefings/${encodeURIComponent(briefingId)}/preparation-requests`,path:()=>'',receiptPath:value=>`/${encodeURIComponent(value.requestId)}`,
    result:checkedPreparationRequestResult,receipt:checkedPreparationRequestReceipt,clear:clearPendingPreparation,
  }),[briefingId]);
  const [tick,setTick]=useState(0),[message,setMessage]=useState('');
  const operation=useArtifactMutation(authority,scope,definition,savePendingPreparation,!disabled,()=>{setTick(value=>value+1);setMessage('Preparation request accepted.');onChanged();},recovery.pending);
  const {data,loading,error:readError}=useArtifactRead<unknown>(authority,definition.endpoint,refresh+tick,!!recovery.error || operation.uncertain || !canStart);
  useEffect(()=>{onActiveChange?.(operation.busy || operation.uncertain || !!recovery.error);return()=>onActiveChange?.(false);},[operation.busy,operation.uncertain,recovery.error,onActiveChange]);
  useEffect(()=>{
    if(!recovery.pending)return;const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted)void operation.check(controller.signal);});return()=>controller.abort();
  },[operation.api]);
  const autoStarted=useRef(false);
  let context:PreparationContext|null=null,error=readError;
  if(data && !operation.uncertain)try{context=checkedPreparationContext(data,briefingId,revision);}catch(reason){error=(reason as Error).message;}
  const available=context && ['draft','failed'].includes(context.state) && (!context.job || context.job.status==='failed') && (!jobId || context.job?.id===jobId);
  const pending=operation.pending.current;
  useEffect(()=>{
    if(!autoStart || autoStarted.current || disabled || loading || !available || !context || !operation.api.current())return;
    autoStarted.current=true;
    void submit();
  },[autoStart,disabled,loading,available,context,operation.api]);
  if(recovery.error)return <p role="alert" className="record-error">{staffT.error(recovery.error)}</p>;
  if(!canStart && !pending)return null;
  async function submit() {
    if(disabled || loading || !available || !context || !operation.api.current())return;
    setMessage('');await operation.write({requestId:crypto.randomUUID(),briefingId,body:{revision,jobId:context.job?.id ?? null,generation:context.job?.generation ?? 0}});
  }
  return <div className="preparation-request">
    {message && <p role="status">{staffT.message(message)}</p>}{operation.error && <p role="alert" className="record-error">{staffT.error(operation.error)}</p>}
    {operation.uncertain ? <><p role="status">{operation.busy?staffT("Checking preparation request..."):operation.checked?staffT("No acceptance receipt was found."):staffT("Preparation request status is not yet confirmed.")}</p><div className="actions">
      <button className="button outline" disabled={operation.busy || disabled} onClick={()=>void operation.check()}><RefreshCw size={18}/>{staffT("Check saved request")}</button>
      {operation.checked && pending && <button className="button primary" disabled={operation.busy || disabled} onClick={()=>void operation.write(pending)}><RefreshCw size={18}/>{staffT("Retry original request")}</button>}
    </div></> : <>{error && <p role="alert" className="record-error">{staffT.error(error)}</p>}<div className="actions">
      {available && <button className="button primary" disabled={operation.busy || disabled || loading} onClick={()=>void submit()}>{jobId?<RefreshCw size={18}/>:<Sparkles size={18}/>} {operation.busy?staffT("Requesting preparation..."):jobId?staffT("Retry preparation"):authority.session.mode==='live-credential'?staffT("Prepare instruction"):staffT("Process synthetically")}</button>}
      {error && <button className="icon-button" disabled={operation.busy || disabled || loading} aria-label={staffT("Refresh preparation state")} title={staffT("Refresh preparation state")} onClick={()=>setTick(value=>value+1)}><RefreshCw size={18}/></button>}
    </div></>}
  </div>;
}
