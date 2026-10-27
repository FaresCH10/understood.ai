import {useEffect,useState} from 'react';
import {Check,ChevronLeft,ChevronRight,Clock3,RefreshCw} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {ClarificationContractError} from './clarification-contract';
import {checkedCaseTimeline,type TimelinePage,type TimelineKind} from './case-timeline';
import {caseText,caseState,type CaseLocale,type CaseTextKey} from './clarification-locale';
import {CaseTime} from './CaseTime';

const labels:Record<TimelineKind,CaseTextKey>={case_opened:'Case opened',response_received:'Response received',assessment_recorded:'Assessment recorded',owner_changed:'Owner changed',owner_routed:'Owner routed',escalated:'Escalated',resolution_recorded:'Resolution recorded',message_received:'Message received',followup_queued:'Follow-up queued',followup_delivered:'Follow-up delivered',repeat_requested:'Another answer requested',deadline_changed:'Deadline changed',assessment_disputed:'Assessment disagreement',in_person_recorded:'In-person clarification recorded'};
export function CaseTimeline({caseId,authority,available,refresh,language='en',timezone='UTC',resolutionNote=''}:{caseId:string;authority:StaffRequestAuthority;available:boolean;refresh:number;language?:CaseLocale;timezone?:string;resolutionNote?:string}){
  const api=useStaffRequest(authority),[page,setPage]=useState(1),[tick,setTick]=useState(0);
  const [read,setRead]=useState<{key:string;data:TimelinePage|null;loading:boolean;failed:boolean}>({key:'',data:null,loading:true,failed:false});
  const key=JSON.stringify([caseId,page,tick,available,refresh]);
  useEffect(()=>{
    let alive=true;const controller=new AbortController();setRead({key,data:null,loading:available,failed:false});
    if(!available)return()=>controller.abort();
    api.request<unknown>(`/api/clarifications/${encodeURIComponent(caseId)}/timeline?page=${page}&pageSize=10`,undefined,controller.signal).then(value=>{
      if(!alive||!api.current())return;setRead({key,data:checkedCaseTimeline(value,caseId,page,authority.session.clientContext!),loading:false,failed:false});
    }).catch(error=>{if(!alive||!api.current())return;if(error instanceof ClarificationContractError&&error.code==='session'){authority.onSessionLost();return;}setRead({key,data:null,loading:false,failed:true});});
    return()=>{alive=false;controller.abort();};
  },[key,api]);
  const data=read.key===key&&available&&api.current()?read.data:null,loading=available&&(read.key!==key||read.loading),pages=Math.max(1,Math.ceil((data?.total??0)/10)),t=(label:CaseTextKey)=>caseText(language,label);
  return <section className="panel case-timeline" aria-labelledby={`timeline-${caseId}`}><div className="worker-card-head"><h2 id={`timeline-${caseId}`}>{t('Timeline')}</h2><button className="icon-button" title={t('Refresh timeline')} aria-label={t('Refresh timeline')} onClick={()=>setTick(n=>n+1)} disabled={loading||!available}><RefreshCw size={18}/></button></div>
    {!available?<p role="status">{t('Verify the case to load its timeline.')}</p>:loading?<p role="status">{t('Loading timeline...')}</p>:read.failed?<p role="alert" className="record-error">{t('Timeline could not be verified. Refresh to try again.')}</p>:data&&<>
      {data.items.length?<ol className="case-event-list" tabIndex={0} aria-label={t('Case events')}>{data.items.map(row=><li key={row.id}><span className={`case-event-mark ${['response_received','followup_delivered','resolution_recorded'].includes(row.kind)?'complete':''}`}>{['response_received','followup_delivered','resolution_recorded'].includes(row.kind)?<Check size={15}/>:<Clock3 size={15}/>}</span><div><div className="case-event-heading"><strong>{t(labels[row.kind])}</strong><CaseTime value={row.occurredAt} language={language} timezone={timezone}/></div>{row.actorName&&<p dir="auto">{caseText(language,row.kind==='owner_routed'?'Routed to {name}':'Recorded by {name}',{name:row.actorName})}</p>}{row.kind==='resolution_recorded'&&resolutionNote.trim()&&<p dir="auto">{resolutionNote.trim()}</p>}{row.outcome&&<p>{caseState(language,row.outcome)}</p>}{row.dueAt&&<p>{t('Due')} <CaseTime value={row.dueAt} language={language} timezone={timezone}/></p>}</div></li>)}</ol>:page>pages?<p>{t('This history page is no longer available.')} <button className="back-link" onClick={()=>setPage(1)}>{t('Return to first page')}</button></p>:<p>{t('No retained timeline events.')}</p>}
      {page<=pages&&<div className="audit-pagination"><span>{caseText(language,'Page {page} of {pages}',{page,pages})}</span><div className="actions"><button className="icon-button" title={t('Older timeline events')} aria-label={t('Older timeline events')} disabled={page<=1} onClick={()=>setPage(n=>n-1)}>{language==='en'?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}</button><button className="icon-button" title={t('Newer timeline events')} aria-label={t('Newer timeline events')} disabled={page>=pages} onClick={()=>setPage(n=>n+1)}>{language==='en'?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></div></div>}
    </>}
  </section>;
}
