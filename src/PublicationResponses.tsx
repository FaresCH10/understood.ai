import {WORKER_LOCALES,languageDirection} from '../server/languages.mjs';
import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,MessageCircle,RefreshCw,Search,X} from 'lucide-react';
import {PublicationPicker} from './PublicationHistory';
import {StaffInstructionChat} from './StaffInstructionChat';
import type {PublicationSummary} from './publication-history';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {SelfHealingLoop} from './SelfHealingLoop';
import {useStaffUi} from './staff-language';
import type {StaffUiKey} from './staff-ui-locale';
import {caseReason} from './clarification-locale';

type Publication={id:string;version:number;state:string};
type Row={assignmentId:string|null;worker:string;language:string;status:string;receivedAt:string|null;deliveryState?:string;reason?:string|null;openCases?:number};
type DeliveryReason={reason:string;language:string|null;count:number};
type Page={publication:Publication;items:Row[];total:number;page:number;pageSize:number;delivery?:{undelivered:number;reasons:DeliveryReason[]}};
type Receipt={sequence:string;kind:string;receivedAt:string;isLatest:boolean;answerText:string|null;outcome:string|null;reasons:string[];recordingId:string|null;audioStatus:string|null;evidence:{factIndex:number;quote:string}[]};
type Detail={questionType?:string;choices?:{id:string;text:string}[];publication:Publication;assignment:{id:string;worker:string;language:string;dueAt:string|null};question:string|null;workerQuestion:string|null;facts:string[];receipts:Receipt[];total:number;page:number;pageSize:number;cases:{id:string;status:string;reason:string}[];responseMode?:string;deliveryMode?:string;acknowledgedAt?:string|null;completedAt?:string|null;evidenceMode?:string;evidence?:{requestId:string;mime:string;bytes:number;sha256:string;receivedAt:string}|null};
type WorkerAssignment={assignmentId:string;worker:string;language:string;status:string;receivedAt:string|null;publicationId:string;title:string;version:number;state:string;dueAt:string|null};
type WorkerAssignmentPage={worker:{id:string;code:string;active:boolean};items:WorkerAssignment[];total:number;page:number;pageSize:number};
const labels:Record<string,StaffUiKey>={correct_answer:'Correct answer',incorrect_answer:'Incorrect answer — needs clarification',awaiting_response:'Awaiting response',acknowledged:'Acknowledged',assessment_pending:'Assessment pending',matched:'Matches key facts',clarification:'Needs clarification',unassessable:'Could not assess',failed_audio:'Audio check failed',not_delivered:'Not delivered'};
const filterStatuses=['awaiting_response','assessment_pending','matched','clarification','unassessable','acknowledged','failed_audio','not_delivered'] as const;
function deliveryReasonText(ui:ReturnType<typeof useStaffUi>,reason:string|null|undefined){
  if(reason==='language_unavailable')return ui.t('Version not ready');
  if(reason==='content_unavailable')return ui.t('Text not ready');
  if(reason==='question_unavailable')return ui.t('Question not ready');
  if(reason==='speech_unavailable')return ui.t('Voice not ready');
  if(reason==='worker_inactive')return ui.t('Worker no longer active');
  if(reason==='workspace_read_only')return ui.t('Workspace is read-only');
  if(reason==='deadline_passed')return ui.t('Delivery deadline passed');
  if(reason==='preparing')return ui.t('Delivery pending');
  if(reason==='withdrawn')return ui.t('Delivery withdrawn');
  return ui.t('Delivery did not complete.');
}

function useResponse<T>(path:string|null,refresh:number,authority:StaffRequestAuthority) {
  const {request,current}=useStaffRequest(authority),key=JSON.stringify([path,refresh,authority.session.clientContext]);
  const [result,setResult]=useState<{key:string;data:T|null;error:string;loading:boolean}>({key:'',data:null,error:'',loading:!!path});
  useEffect(()=>{
    setResult({key,data:null,error:'',loading:Boolean(path)});if(!path)return;
    const controller=new AbortController();
    request<T>(`/api${path}`,undefined,controller.signal).then(data=>{if(!controller.signal.aborted&&current())setResult({key,data,error:'',loading:false});})
      .catch(()=>{if(!controller.signal.aborted&&current())setResult({key,data:null,error:'Response unavailable',loading:false});});
    return()=>controller.abort();
  },[key,request,current]);
  return path&&result.key===key&&current()?result:{data:null,error:'',loading:!!path};
}
function Assessment({value}:{value:string}) {
  const ui=useStaffUi(),tone=value==='matched'?'green':value==='failed_audio'||value==='not_delivered'?'red':/clarification|pending|unassessable/.test(value)?'amber':'blue';
  return <span className={`status status-${tone}`}>{ui.t(Object.hasOwn(labels,value)?labels[value]:'Status unavailable')}</span>;
}
function Paging({page,total,size,onChange,label}:{page:number;total:number;size:number;onChange:(page:number)=>void;label:'recipients'|'assigned instructions'|'submissions'}) {
  const ui=useStaffUi(),pages=Math.max(1,Math.ceil(total/size));
  return <div className="audit-pagination"><span>{ui.t('Page {page} of {pages} · {total} {label}',{page:ui.number(page),pages:ui.number(pages),total:ui.number(total),label:ui.t(label)})}</span><div className="actions">
    <button className="icon-button" aria-label={ui.t('Previous {label} page',{label:ui.t(label)})} title={ui.t('Previous {label} page',{label:ui.t(label)})} disabled={page<=1} onClick={()=>onChange(page-1)}><ChevronLeft className="directional-icon" size={18}/></button>
    <button className="icon-button" aria-label={ui.t('Next {label} page',{label:ui.t(label)})} title={ui.t('Next {label} page',{label:ui.t(label)})} disabled={page>=pages} onClick={()=>onChange(page+1)}><ChevronRight className="directional-icon" size={18}/></button>
    {page>pages&&<button className="button outline" onClick={()=>onChange(1)}>{ui.t('First page')}</button>}
  </div></div>;
}
export function PublicationResponses({briefingId,publication,onSelect,context,refresh,navigate,canPlayAudio,authority}:{briefingId:string;publication:PublicationSummary|null;onSelect:(value:PublicationSummary|null)=>void;context:string;refresh:number;navigate:(path:string)=>void;canPlayAudio:boolean;authority:StaffRequestAuthority}) {
  const ui=useStaffUi(authority.session.timezone),publicationId=publication?.id || '';
  const [pageSize]=useState(()=>window.matchMedia('(max-width:600px)').matches?10:20);
  const [search,setSearch]=useState(''),[language,setLanguage]=useState('all'),[status,setStatus]=useState('all'),[page,setPage]=useState(1),[assignmentId,setAssignmentId]=useState<string|null>(null),[tick,setTick]=useState(0);
  const recipientButtons=useRef<Record<string,HTMLButtonElement|null>>({}),query=new URLSearchParams({search,language,status,page:String(page),pageSize:String(pageSize)}).toString();
  const {data,error,loading}=useResponse<Page>(publication?`/publications/${encodeURIComponent(publicationId)}/responses?${query}`:null,refresh+tick,authority);
  return <div lang={ui.locale} dir={ui.dir}>
    <PublicationPicker briefingId={briefingId} selected={publication} onSelect={value=>{setPage(1);setAssignmentId(null);onSelect(value);}} context={context} refresh={refresh+tick}/>
    {!publication&&<p>{ui.t('No published version yet.')}</p>}
    {publication&&<SelfHealingLoop key={`improvement:${publication.id}`} publicationId={publication.id} authority={authority} navigate={navigate}/>}
    <div className="filters response-filters"><label className="search-box"><Search size={18}/><span className="sr-only">{ui.t('Search recipients')}</span><input dir="auto" value={search} maxLength={80} onChange={event=>{setSearch(event.target.value);setPage(1);}} placeholder={ui.t('Worker ID')}/></label>
      <label className="select-label">{ui.t('Assigned language')}<select value={language} onChange={event=>{setLanguage(event.target.value);setPage(1);}}><option value="all">{ui.t('All languages')}</option>{WORKER_LOCALES.map(locale=><option key={locale.code} value={locale.code}>{ui.language(locale.code)}</option>)}</select></label>
      <label className="select-label">{ui.t('Latest response')}<select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="all">{ui.t('All states')}</option>{filterStatuses.map(key=><option key={key} value={key}>{ui.t(labels[key])}</option>)}</select></label>
      <button className="icon-button" aria-label={ui.t('Refresh responses')} title={ui.t('Refresh responses')} disabled={loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={18}/></button>
    </div>
    <div className={`responses-layout ${assignmentId?'has-selection':''}`}><section className="panel" aria-label={ui.t('Publication recipients')}><h2>{ui.t('Responses')} {publication&&`· ${ui.t('Version {version}',{version:ui.number(publication.version)})}`}</h2>
      {loading?<p data-page-loading role="status">{ui.t('Loading responses...')}</p>:error?<p role="alert">{ui.error(error,'Response unavailable')}</p>:data&&<>
        {data.delivery&&data.delivery.undelivered>0&&<p className="notice notice-amber" role="status"><strong>{ui.t('{count} recipients did not receive this instruction.',{count:ui.number(data.delivery.undelivered)})}</strong>{' '}{data.delivery.reasons.map(reason=>`${reason.language?`${ui.language(reason.language)}: `:''}${deliveryReasonText(ui,reason.reason)} (${ui.number(reason.count)})`).join(' · ')}</p>}
        {data.items.length?<div className="table-wrap" tabIndex={0} aria-label={ui.t('Recipient response table')}><table><thead><tr>{(['Worker','Assigned language','Latest response','Received'] as const).map(key=><th key={key}>{ui.t(key)}</th>)}</tr></thead><tbody>{data.items.map(row=>{const id=row.assignmentId;return <tr key={id||`missing:${row.worker}:${row.language}:${row.deliveryState||''}:${row.reason||''}`} className={id&&assignmentId===id?'selected-response':''}><td>{id?<button ref={node=>{recipientButtons.current[id]=node;}} className="text-link" aria-pressed={assignmentId===id} onClick={()=>setAssignmentId(id)}><bdi>{row.worker}</bdi><ChevronRight className="directional-icon" size={16}/></button>:<strong><bdi>{row.worker}</bdi></strong>}</td><td data-label={ui.t("Assigned language")}>{ui.language(row.language)}</td><td data-label={ui.t("Latest response")}><Assessment value={row.status}/>{row.status==='not_delivered'&&<div><small>{deliveryReasonText(ui,row.reason||row.deliveryState)}</small></div>}{!!row.openCases&&id&&<div><button type="button" className="open-case-chip" onClick={()=>setAssignmentId(id)}><MessageCircle size={13} aria-hidden="true"/>{ui.t('{count} open chats',{count:ui.number(row.openCases)})}</button></div>}</td><td data-label={ui.t("Received")}>{ui.date(row.receivedAt)}</td></tr>;})}</tbody></table></div>:<p>{ui.t('No recipients match these filters.')}</p>}
        <Paging page={page} total={data.total} size={pageSize} onChange={setPage} label="recipients"/>
      </>}
    </section>{assignmentId&&<ResponseDetail authority={authority} key={`${publicationId}:${assignmentId}`} publicationId={publicationId} assignmentId={assignmentId} refresh={refresh+tick} onClose={()=>{recipientButtons.current[assignmentId]?.focus();setAssignmentId(null);}} navigate={navigate} canPlayAudio={canPlayAudio}/>}</div>
    <div className="notice notice-blue">{ui.t('A matching answer records the requested key facts; an acknowledgment records only that the instruction was opened. Neither certifies understanding or safe work.')}</div>
  </div>;
}
export function WorkerAssignments({workerId,refresh,navigate,authority}:{workerId:string;refresh:number;navigate:(path:string)=>void;authority:StaffRequestAuthority}) {
  const ui=useStaffUi(authority.session.timezone),[page,setPage]=useState(1),[tick,setTick]=useState(0),[selected,setSelected]=useState<WorkerAssignment|null>(null),buttons=useRef<Record<string,HTMLButtonElement|null>>({});
  const {data,error,loading}=useResponse<WorkerAssignmentPage>(`/people/workers/${encodeURIComponent(workerId)}/assignments?page=${page}&pageSize=5`,refresh+tick,authority);
  return <div lang={ui.locale} dir={ui.dir} className={`responses-layout worker-assignment-layout ${selected?'has-selection':''}`}><section className="panel worker-assignment-list" aria-label={ui.t('Worker assigned instructions')}><div className="people-panel-heading"><h2><bdi>{data?.worker.code || ui.t('Worker')}</bdi> · {ui.t('Instruction history')}</h2><button className="icon-button" aria-label={ui.t('Refresh assigned instructions')} title={ui.t('Refresh assigned instructions')} disabled={loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={18}/></button></div>
      {loading?<p data-page-loading role="status">{ui.t('Loading assigned instructions...')}</p>:error?<p role="alert">{ui.error(error,'Response unavailable')}</p>:data&&<>
        {data.items.length?<div className="row-list">{data.items.map(row=><button ref={node=>{buttons.current[row.assignmentId]=node;}} className="item-row" key={row.assignmentId} aria-pressed={selected?.assignmentId===row.assignmentId} onClick={()=>setSelected(row)}><span className="item-main"><strong dir="auto">{row.title}</strong><small>{ui.t('Version {version}',{version:ui.number(row.version)})} · {ui.state(row.state)} · {ui.language(row.language)}</small><Assessment value={row.status}/><small>{row.receivedAt?ui.t('Received {date}',{date:ui.date(row.receivedAt)}):ui.t('No accepted response yet')}</small></span><ChevronRight className="directional-icon" size={18}/></button>)}</div>:<p>{ui.t('No instructions assigned.')}</p>}
        <Paging page={page} total={data.total} size={5} onChange={setPage} label="assigned instructions"/>
      </>}
    </section>{selected&&<ResponseDetail authority={authority} key={`${selected.publicationId}:${selected.assignmentId}`} publicationId={selected.publicationId} assignmentId={selected.assignmentId} refresh={refresh+tick} navigate={navigate} canPlayAudio onClose={()=>{buttons.current[selected.assignmentId]?.focus();setSelected(null);}}/>}</div>;
}
export function ResponseDetail({publicationId,assignmentId,refresh,onClose,navigate,canPlayAudio,authority}:{publicationId:string;assignmentId:string;refresh:number;onClose:()=>void;navigate:(path:string)=>void;canPlayAudio:boolean;authority:StaffRequestAuthority}) {
  const ui=useStaffUi(authority.session.timezone),[page,setPage]=useState(1),heading=useRef<HTMLHeadingElement>(null);
  const {data,error,loading}=useResponse<Detail>(`/publications/${encodeURIComponent(publicationId)}/responses/${encodeURIComponent(assignmentId)}?page=${page}&pageSize=10`,refresh,authority);
  useEffect(()=>{heading.current?.focus();},[assignmentId]);
  return <><section lang={ui.locale} dir={ui.dir} className="panel response-detail" aria-label={ui.t('Accepted submission history')}><div className="response-detail-heading"><h2 ref={heading} tabIndex={-1}><bdi>{data?data.assignment.worker:ui.t('Submission history')}</bdi></h2><button className="icon-button" aria-label={ui.t('Close response history')} title={ui.t('Close response history')} onClick={onClose}><X size={18}/></button></div>
    {loading?<p data-page-loading role="status">{ui.t('Loading submission history...')}</p>:error?<p role="alert">{ui.error(error,'Response unavailable')}</p>:data&&<>
      <p>{ui.t('Version {version}',{version:ui.number(data.publication.version)})} · {ui.state(data.publication.state)} · {ui.language(data.assignment.language)}</p>
      {data.assignment.dueAt&&<p>{ui.t('Due {date}',{date:ui.date(data.assignment.dueAt)})}</p>}
      {data.completedAt&&<p className="notice notice-green" role="status"><strong>{ui.t('Work completed')}</strong> · {ui.date(data.completedAt)}</p>}
      {data.responseMode==='acknowledge'?<><h3>{ui.t('Receipt')}</h3>{data.acknowledgedAt?<><Assessment value="acknowledged"/><p>{ui.date(data.acknowledgedAt)}</p></>:<p>{ui.t('Awaiting acknowledgment.')}</p>}
        {data.evidenceMode==='photo'&&(data.evidence?<figure className="response-evidence"><img src={`/api/publications/${encodeURIComponent(publicationId)}/responses/${encodeURIComponent(assignmentId)}/evidence`} alt={ui.t('Photo evidence submitted by {worker}',{worker:data.assignment.worker})}/><figcaption>{ui.t('Photo evidence')} · <bdi dir="ltr">{data.evidence.mime.replace('image/','').toUpperCase()}</bdi> · {ui.number(Math.max(1,Math.ceil(data.evidence.bytes/1024)))} {ui.t('KB')} · {ui.date(data.evidence.receivedAt)}</figcaption></figure>:<p className="notice notice-amber">{ui.t('Photo evidence was requested but has not been received.')}</p>)}</>:<><h3>{ui.t('Question')}</h3><p dir="auto">{data.question}</p>{data.workerQuestion&&data.workerQuestion!==data.question&&<p lang={data.assignment.language} dir={languageDirection(data.assignment.language) || 'ltr'}>{data.workerQuestion}</p>}</>}
      <h3>{ui.t('Published key facts')}</h3><ul>{data.facts.map((fact,index)=><li dir="auto" key={index}>{fact}</li>)}</ul>
      {data.responseMode!=='acknowledge'&&<><h3>{ui.t('Accepted submissions')}</h3>{!data.receipts.length&&<p>{ui.t('No accepted response yet.')}</p>}
        {data.receipts.map(receipt=><article className="case-attempt" key={receipt.sequence}>
          <div className="response-receipt-heading"><strong>{ui.t(data.questionType==='multiple-choice'?'Multiple-choice answer':receipt.kind==='audio'?'Audio answer':'Typed answer')}{receipt.isLatest?` · ${ui.t('Latest')}`:''}</strong><small>{ui.date(receipt.receivedAt)}</small></div>
          <Assessment value={(data.questionType==='multiple-choice'&&receipt.outcome==='matched'?'correct_answer':data.questionType==='multiple-choice'&&receipt.outcome==='clarification'?'incorrect_answer':receipt.outcome) || (receipt.audioStatus==='failed'?'failed_audio':'assessment_pending')}/>
          {receipt.answerText!==null&&<p className="response-answer" dir="auto">{data.choices?.find(choice=>choice.id===receipt.answerText)?.text || receipt.answerText || ui.t('Empty answer')}</p>}
          {receipt.recordingId&&canPlayAudio&&<audio controls preload="none" aria-label={ui.t('Accepted audio answer {sequence}',{sequence:receipt.sequence})} src={`/api/recordings/${encodeURIComponent(receipt.recordingId)}/audio`}/>}
          {receipt.reasons.length>0&&<ul>{receipt.reasons.map((reason,index)=><li key={index}>{ui.reason(caseReason(ui.locale,reason))}</li>)}</ul>}
          {receipt.evidence.map((item,index)=><blockquote key={index}>{data.questionType==='multiple-choice'?ui.t('Selected answer'):ui.t('Fact {number}',{number:ui.number(item.factIndex+1)})}: <bdi>{data.choices?.find(choice=>choice.id===item.quote)?.text || item.quote}</bdi></blockquote>)}
        </article>)}<Paging page={page} total={data.total} size={10} onChange={setPage} label="submissions"/></>}
      {data.cases.length>0&&<><h3>{ui.t('Clarification records')}</h3><div className="row-list">{data.cases.map(item=><button className="item-row" key={item.id} onClick={()=>navigate(`clarifications/${item.id}`)}><span className="item-main"><strong>{ui.reason(caseReason(ui.locale,item.reason))}</strong><small>{ui.state(item.status)}</small></span><ChevronRight className="directional-icon" size={18}/></button>)}</div></>}
    </>}
  </section><StaffInstructionChat assignmentId={assignmentId} cases={data?.cases??[]} navigate={navigate} authority={authority}/></>;
}
