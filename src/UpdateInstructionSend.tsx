import {useEffect,useRef,useState,type RefObject} from 'react';
import {useStaffText as useStaffStaticText} from './staff-language';
import {useStaffText} from './staff-language';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {InstructionAudienceFields,type AudienceOverview,type AudienceReadiness,type AudienceType,type SelectedAudience} from './InstructionAudienceFields';
import PublishForm from './PublishForm';
import type {PendingPublication} from './publication-recovery';

type Worker={id:string;code:string;language:string;crew_name:string|null};

export type UpdateAudienceState={
  audience:AudienceOverview|null;
  audienceType:AudienceType;
  crewId:string;
  workerIds:string[];
  selectedAudience:SelectedAudience|null;
  selectedCrew:AudienceOverview['crews'][number]|null;
  audienceLoading:boolean;
  audienceError:string;
  audienceErrorRef:RefObject<HTMLParagraphElement|null>;
  readiness:AudienceReadiness|null;
  readinessError:string;
  unavailableLanguages:string[];
  deliveryBlocked:boolean;
  deliveryHint:string;
  canSwitchToText:boolean;
  audienceReady:boolean;
  readyWorkers:number;
  setAudienceType:(value:AudienceType)=>void;
  setCrewId:(value:string)=>void;
  setWorkerIds:(value:string[])=>void;
  refresh:()=>void;
  setDeliveryModeText:()=>void;
};

export function useUpdateAudience(authority:StaffRequestAuthority,source:string,enabled=true):UpdateAudienceState{
  const {request,current}=useStaffRequest(authority);
  const tr=useStaffText();
  const [audience,setAudience]=useState<AudienceOverview|null>(null);
  const [audienceType,setAudienceType]=useState<AudienceType>('all');
  const [crewId,setCrewId]=useState('');
  const [workerIds,setWorkerIds]=useState<string[]>([]);
  const [audienceLoading,setAudienceLoading]=useState(false);
  const [audienceError,setAudienceError]=useState('');
  const [audienceRevision,setAudienceRevision]=useState(0);
  const [readiness,setReadiness]=useState<AudienceReadiness|null>(null);
  const [readinessError,setReadinessError]=useState('');
  const audienceErrorRef=useRef<HTMLParagraphElement|null>(null);

  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController(),live=()=>current()&&!controller.signal.aborted;
    setAudienceLoading(true);setAudienceError('');
    request<AudienceOverview>('/api/instructions/audience',undefined,controller.signal)
      .then(value=>{if(live()){setAudience(value);setAudienceError('');}})
      .catch(reason=>{if(live())setAudienceError(reason instanceof Error?reason.message:'Recipients unavailable');})
      .finally(()=>{if(live())setAudienceLoading(false);});
    return()=>controller.abort();
  },[request,current,audienceRevision,enabled]);

  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();
    setReadiness(null);setReadinessError('');
    const timer=setTimeout(()=>{
      request<AudienceReadiness>('/api/instructions/readiness',{source},controller.signal)
        .then(value=>{if(!controller.signal.aborted&&current())setReadiness(value);})
        .catch(()=>{if(!controller.signal.aborted&&current())setReadinessError('Delivery availability could not be checked.');});
    },400);
    return()=>{clearTimeout(timer);controller.abort();};
  },[source,audienceRevision,request,current,enabled]);

  const selectedCrew=audienceType==='crew'?audience?.crews.find(crew=>crew.id===crewId)??null:null;
  const selectedMembers=audience?.members?.filter(member=>workerIds.includes(member.id))??[];
  const selectedAudience:SelectedAudience|null=audienceType==='members'
    ?{total:selectedMembers.filter(member=>!member.language_selection_required).length,
      notSelected:selectedMembers.filter(member=>member.language_selection_required).length,
      byLanguage:selectedMembers.reduce<Record<string,number>>((counts,member)=>{counts[member.language]=(counts[member.language]||0)+1;return counts;},{})}
    :audienceType==='all'?(audience?.workers?{...audience.workers,notSelected:audience.workers.notSelected??0}:null)
    :selectedCrew?{total:selectedCrew.members,byLanguage:selectedCrew.byLanguage,notSelected:selectedCrew.notSelected}:null;
  const audienceLanguages=Object.entries(selectedAudience?.byLanguage??{}).filter(([,count])=>count>0);
  const unavailableLanguages=audienceLanguages.filter(([code])=>!readiness?.textLanguages.includes(code)
    ||!readiness.speechLanguages.includes(code)).map(([code])=>code);
  const unavailableWorkers=unavailableLanguages.reduce((total,code)=>total+(selectedAudience?.byLanguage[code]??0),0);
  const readyWorkers=(selectedAudience?.total??0)-unavailableWorkers;
  const audienceReady=!!selectedAudience&&selectedAudience.total>0&&!selectedAudience.notSelected;
  const deliveryBlocked=audienceReady&&!!readiness&&readyWorkers===0;
  const deliveryHint=tr.locale==='ar'
    ?'الصوت غير متاح للمستلمين المحددين. اختر النص فقط للإرسال إلى المستلمين الجاهزين.'
    :'Voice is unavailable for the selected recipients. Choose Text only to send to recipients who can receive it.';

  return {audience,audienceType,crewId,workerIds,selectedAudience,selectedCrew,audienceLoading,audienceError,audienceErrorRef,
    readiness,readinessError,unavailableLanguages,deliveryBlocked,deliveryHint,canSwitchToText:false,audienceReady,readyWorkers,
    setAudienceType,setCrewId,setWorkerIds,refresh:()=>setAudienceRevision(value=>value+1),setDeliveryModeText:()=>{}};
}


export function UpdateInstructionRecipients({state,onContinue,canContinue=true,continueHint}:{state:UpdateAudienceState;onContinue:()=>void;canContinue?:boolean;continueHint?:string}){
  const staffT=useStaffStaticText();
  return <section className="panel update-instruction-recipients">
    <h2>{staffT('Recipients')}</h2>
    <p className="muted">{staffT('Choose who should receive this update. Workers keep seeing the sent version until you send.')}</p>
    <InstructionAudienceFields
      audience={state.audience}
      audienceType={state.audienceType}
      crewId={state.crewId}
      workerIds={state.workerIds}
      selectedAudience={state.selectedAudience}
      selectedCrew={state.selectedCrew}
      audienceLoading={state.audienceLoading}
      audienceError={state.audienceError}
      audienceErrorRef={state.audienceErrorRef}
      disabled={state.audienceLoading}
      readiness={state.readiness}
      readinessError={state.readinessError}
      unavailableLanguages={state.unavailableLanguages}
      deliveryBlocked={state.deliveryBlocked}
      deliveryHint={state.deliveryHint}
      canSwitchToText={state.canSwitchToText}
      onAudienceType={state.setAudienceType}
      onCrewId={state.setCrewId}
      onWorkerIds={state.setWorkerIds}
      onRefresh={state.refresh}
      onSwitchToText={state.setDeliveryModeText}
    />
    {!canContinue&&continueHint&&<p className="notice notice-amber" role="status">{continueHint}</p>}
    <div className="actions">
      <button type="button" className="button primary" disabled={!state.audienceReady||!canContinue} onClick={onContinue}>
        {staffT('Continue to review')}
      </button>
    </div>
  </section>;
}

export function UpdateInstructionReview({state,briefingId,revision,version,title,source,timezone,scope,onPending,onChanged,authority}:{
  state:UpdateAudienceState;briefingId:string;revision:number;version:number;title:string;source:string;timezone:string;
  scope?:string|null;onPending:(value:PendingPublication)=>void;onChanged:(outcome?:'publish'|'schedule')=>void;authority:StaffRequestAuthority;
}){
  const staffT=useStaffStaticText();
  const tr=useStaffText();
  const {request,current}=useStaffRequest(authority);
  const [workers,setWorkers]=useState<Worker[]|null>(null);
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0);

  useEffect(()=>{
    const controller=new AbortController(),live=()=>current()&&!controller.signal.aborted;
    setWorkers(null);setError('');
    const members=state.audience?.members??[];
    if(state.audienceType==='members'){
      setWorkers(members.filter(member=>state.workerIds.includes(member.id)).map(member=>({id:member.id,code:member.code,language:member.language,crew_name:null})));
      return()=>controller.abort();
    }
    if(state.audienceType==='all'){
      setWorkers(members.map(member=>({id:member.id,code:member.code,language:member.language,crew_name:null})));
      return()=>controller.abort();
    }
    if(!state.crewId){setWorkers([]);return()=>controller.abort();}
    request<{crew:{name:string};items:{id:string;code:string;language:string;crew_name?:string|null}[]}>(`/api/people/crews/${encodeURIComponent(state.crewId)}/recipients`,undefined,controller.signal)
      .then(value=>{if(live())setWorkers(value.items.map(worker=>({id:worker.id,code:worker.code,language:worker.language,crew_name:worker.crew_name??value.crew.name})));})
      .catch(reason=>{if(live())setError(reason instanceof Error?reason.message:'Recipients unavailable');})
      .finally(()=>{if(live()&&workers===null)setWorkers([]);});
    return()=>controller.abort();
  },[state.audienceType,state.crewId,state.workerIds,state.audience,request,current,reload]);

  if(error)return <section className="panel"><p role="alert" className="record-error">{staffT.error(error)}</p><button type="button" className="button outline" onClick={()=>setReload(value=>value+1)}>{staffT('Try again')}</button></section>;
  if(workers===null)return <section className="panel"><p data-page-loading role="status">{staffT('Loading recipients...')}</p></section>;
  if(!workers.length)return <section className="panel"><p>{staffT('Choose at least one worker to continue.')}</p></section>;

  return <section className="panel update-instruction-review">
    <h2>{staffT('Review and send')}</h2>
    <div className="send-mobile-review">
      <strong dir="auto">{title}</strong>
      {source.length>300?<details><summary>{staffT('Read instruction preview')}</summary><p dir="auto">{source}</p></details>:<p dir="auto">{source}</p>}
    </div>
    <div className="send-review-audience">
      <div><strong>{staffT('Recipients')}</strong><p>{workers.length} {workers.length===1?staffT('worker'):staffT('workers')}</p></div>
      <p className="send-review-readiness" role="status">{staffT('Workers ready for this format')} <bdi>{staffT.number(state.readyWorkers)} / {staffT.number(state.selectedAudience?.total??workers.length)}</bdi></p>
    </div>
    <p className="muted send-review-preview-note">{staffT('Workers keep seeing the sent version until you send this update. The check question is generated when you send.')}</p>
    <PublishForm
      key={JSON.stringify(workers.map(worker=>worker.id))}
      id={briefingId}
      revision={revision}
      version={version}
      timezone={timezone}
      scope={scope}
      onPending={onPending}
      onChanged={onChanged}
      authority={authority}
      initialWorkers={workers}
      hideRecipients
    />
  </section>;
}
