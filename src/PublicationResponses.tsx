import {WORKER_LOCALES,languageDirection} from '../server/languages.mjs';
import { useEffect,useRef,useState } from 'react';
import { ChevronLeft,ChevronRight,RefreshCw,Search,X } from 'lucide-react';
import {PublicationPicker} from './PublicationHistory';
import type {PublicationSummary} from './publication-history';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';

type Publication={id:string;version:number;state:string};
type Row={assignmentId:string;worker:string;language:string;status:string;receivedAt:string|null};
type Page={publication:Publication;items:Row[];total:number;page:number;pageSize:number};
type Receipt={sequence:string;kind:string;receivedAt:string;isLatest:boolean;answerText:string|null;outcome:string|null;reasons:string[];recordingId:string|null;audioStatus:string|null;evidence:{factIndex:number;quote:string}[]};
type Detail={questionType?:string;choices?:{id:string;text:string}[];publication:Publication;assignment:{id:string;worker:string;language:string;dueAt:string|null};question:string|null;workerQuestion:string|null;facts:string[];receipts:Receipt[];total:number;page:number;pageSize:number;cases:{id:string;status:string;reason:string}[];responseMode?:string;deliveryMode?:string;acknowledgedAt?:string|null};
type WorkerAssignment=Row & {publicationId:string;title:string;version:number;state:string;dueAt:string|null};
type WorkerAssignmentPage={worker:{id:string;code:string;active:boolean};items:WorkerAssignment[];total:number;page:number;pageSize:number};
const labels:Record<string,string>={correct_answer:'Correct answer',incorrect_answer:'Incorrect answer — needs clarification',awaiting_response:'Awaiting response',acknowledged:'Acknowledged',assessment_pending:'Assessment pending',matched:'Matches key facts',clarification:'Needs clarification',unassessable:'Could not assess',failed_audio:'Audio check failed'};
const languageNames:Record<string,string>=Object.fromEntries(WORKER_LOCALES.map(locale=>[locale.code,locale.englishName]));
const date=(value:string|null) => value ? new Date(value).toLocaleString() : 'Not received';

function useResponse<T>(path:string|null,refresh:number,authority:StaffRequestAuthority) {
  const {request,current}=useStaffRequest(authority);
  const key=JSON.stringify([path,refresh,authority.session.clientContext]);
  const [result,setResult]=useState<{key:string;data:T|null;error:string;loading:boolean}>({key:'',data:null,error:'',loading:!!path});
  useEffect(() => {
    setResult({key,data:null,error:'',loading:Boolean(path)});
    if(!path) return;
    const controller=new AbortController();
    request<T>(`/api${path}`,undefined,controller.signal).then(data=>{if(!controller.signal.aborted && current())setResult({key,data,error:'',loading:false});})
      .catch(()=>{if(!controller.signal.aborted && current())setResult({key,data:null,error:'Response unavailable',loading:false});});
    return ()=>controller.abort();
  },[key,request,current]);
  return path && result.key===key && current()?result:{data:null,error:'',loading:!!path};
}

function Assessment({value}:{value:string}) {
  const tone=value==='matched' ? 'green' : value==='failed_audio' ? 'red' : /clarification|pending|unassessable/.test(value) ? 'amber' : 'blue';
  return <span className={`status status-${tone}`}>{labels[value] || value.replaceAll('_',' ')}</span>;
}

function Paging({page,total,size,onChange,label}:{page:number;total:number;size:number;onChange:(page:number)=>void;label:string}) {
  const pages=Math.max(1,Math.ceil(total/size));
  return <div className="audit-pagination"><span>Page {page} of {pages} · {total} {label}</span><div className="actions">
    <button className="icon-button" aria-label={`Previous ${label} page`} title={`Previous ${label} page`} disabled={page<=1} onClick={() => onChange(page-1)}><ChevronLeft size={18} /></button>
    <button className="icon-button" aria-label={`Next ${label} page`} title={`Next ${label} page`} disabled={page>=pages} onClick={() => onChange(page+1)}><ChevronRight size={18} /></button>
    {page>pages && <button className="button outline" onClick={() => onChange(1)}>First page</button>}
  </div></div>;
}

export function PublicationResponses({briefingId,publication,onSelect,context,refresh,navigate,canPlayAudio,authority}:{briefingId:string;publication:PublicationSummary|null;onSelect:(value:PublicationSummary|null)=>void;context:string;refresh:number;navigate:(path:string)=>void;canPlayAudio:boolean;authority:StaffRequestAuthority}) {
  const publicationId=publication?.id || '';
  const [search,setSearch]=useState(''),[language,setLanguage]=useState('all'),[status,setStatus]=useState('all'),[page,setPage]=useState(1),[assignmentId,setAssignmentId]=useState<string|null>(null),[tick,setTick]=useState(0);
  const recipientButtons=useRef<Record<string,HTMLButtonElement|null>>({});
  const query=new URLSearchParams({search,language,status,page:String(page),pageSize:'20'}).toString();
  const {data,error,loading}=useResponse<Page>(publication ? `/publications/${encodeURIComponent(publicationId)}/responses?${query}` : null,refresh+tick,authority);
  return <>
    <PublicationPicker briefingId={briefingId} selected={publication} onSelect={value=>{setPage(1);setAssignmentId(null);onSelect(value);}} context={context} refresh={refresh+tick}/>
    {!publication && <p>No published version yet.</p>}
    <div className="filters response-filters">
      <label className="search-box"><Search size={18} /><span className="sr-only">Search recipients</span><input value={search} maxLength={80} onChange={(event) => {setSearch(event.target.value);setPage(1);}} placeholder="Worker ID" /></label>
      <label className="select-label">Assigned language<select value={language} onChange={(event) => {setLanguage(event.target.value);setPage(1);}}><option value="all">All languages</option>{Object.entries(languageNames).map(([key,name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="select-label">Latest response<select value={status} onChange={(event) => {setStatus(event.target.value);setPage(1);}}><option value="all">All states</option>{Object.entries(labels).map(([key,name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <button className="icon-button" aria-label="Refresh responses" title="Refresh responses" disabled={loading} onClick={() => setTick((value) => value+1)}><RefreshCw size={18} /></button>
    </div>
    <div className={`responses-layout ${assignmentId ? 'has-selection' : ''}`}><section className="panel" aria-label="Publication recipients">
      <h2>Responses {publication && `· v${publication.version}`}</h2>
      {loading ? <p role="status">Loading responses...</p> : error ? <p role="alert">{error}</p> : data && <>
        {data.items.length ? <div className="table-wrap" tabIndex={0} aria-label="Recipient response table"><table><thead><tr><th>Worker</th><th>Assigned language</th><th>Latest response</th><th>Received</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.assignmentId} className={assignmentId===row.assignmentId ? 'selected-response' : ''}><td><button ref={(node) => {recipientButtons.current[row.assignmentId]=node;}} className="text-link" aria-pressed={assignmentId===row.assignmentId} onClick={() => setAssignmentId(row.assignmentId)}>{row.worker}<ChevronRight size={16} /></button></td><td>{languageNames[row.language]}</td><td><Assessment value={row.status} /></td><td>{date(row.receivedAt)}</td></tr>)}</tbody></table></div> : <p>No recipients match these filters.</p>}
        <Paging page={page} total={data.total} size={20} onChange={setPage} label="recipients" />
      </>}
    </section>{assignmentId && <ResponseDetail authority={authority} key={`${publicationId}:${assignmentId}`} publicationId={publicationId} assignmentId={assignmentId} refresh={refresh+tick} onClose={() => {recipientButtons.current[assignmentId]?.focus();setAssignmentId(null);}} navigate={navigate} canPlayAudio={canPlayAudio} />}</div>
    <div className="notice notice-blue">A matching answer records the requested key facts; an acknowledgment records only that the instruction was opened. Neither certifies understanding or safe work.</div>
  </>;
}

export function WorkerAssignments({workerId,refresh,navigate,authority}:{workerId:string;refresh:number;navigate:(path:string)=>void;authority:StaffRequestAuthority}) {
  const [page,setPage]=useState(1),[tick,setTick]=useState(0),[selected,setSelected]=useState<WorkerAssignment|null>(null);
  const buttons=useRef<Record<string,HTMLButtonElement|null>>({});
  const {data,error,loading}=useResponse<WorkerAssignmentPage>(`/people/workers/${encodeURIComponent(workerId)}/assignments?page=${page}&pageSize=5`,refresh+tick,authority);
  return <div className={`responses-layout worker-assignment-layout ${selected ? 'has-selection' : ''}`}>
    <section className="panel worker-assignment-list" aria-label="Worker assigned briefings"><div className="people-panel-heading"><h2>{data?.worker.code || 'Worker'} · Assigned briefings</h2><button className="icon-button" aria-label="Refresh assigned briefings" title="Refresh assigned briefings" disabled={loading} onClick={() => setTick((value) => value+1)}><RefreshCw size={18} /></button></div>
      {loading ? <p role="status">Loading assigned briefings...</p> : error ? <p role="alert">{error}</p> : data && <>
        {data.items.length ? <div className="row-list">{data.items.map((row) => <button ref={(node) => {buttons.current[row.assignmentId]=node;}} className="item-row" key={row.assignmentId} aria-pressed={selected?.assignmentId===row.assignmentId} onClick={() => setSelected(row)}><span className="item-main"><strong>{row.title}</strong><small>v{row.version} · {row.state} · {languageNames[row.language]}</small><Assessment value={row.status} /><small>{row.receivedAt ? `Received ${date(row.receivedAt)}` : 'No accepted response yet'}</small></span><ChevronRight size={18} /></button>)}</div> : <p>No briefings assigned.</p>}
        <Paging page={page} total={data.total} size={5} onChange={setPage} label="assigned briefings" />
      </>}
    </section>
    {selected && <ResponseDetail authority={authority} key={`${selected.publicationId}:${selected.assignmentId}`} publicationId={selected.publicationId} assignmentId={selected.assignmentId} refresh={refresh+tick} navigate={navigate} canPlayAudio onClose={() => {buttons.current[selected.assignmentId]?.focus();setSelected(null);}} />}
  </div>;
}

export function ResponseDetail({publicationId,assignmentId,refresh,onClose,navigate,canPlayAudio,authority}:{publicationId:string;assignmentId:string;refresh:number;onClose:()=>void;navigate:(path:string)=>void;canPlayAudio:boolean;authority:StaffRequestAuthority}) {
  const [page,setPage]=useState(1);
  const heading=useRef<HTMLHeadingElement>(null);
  const {data,error,loading}=useResponse<Detail>(`/publications/${encodeURIComponent(publicationId)}/responses/${encodeURIComponent(assignmentId)}?page=${page}&pageSize=10`,refresh,authority);
  useEffect(() => {heading.current?.focus();},[assignmentId]);
  return <section className="panel response-detail" aria-label="Accepted submission history"><div className="response-detail-heading"><h2 ref={heading} tabIndex={-1}>{data ? data.assignment.worker : 'Submission history'}</h2><button className="icon-button" aria-label="Close response history" title="Close response history" onClick={onClose}><X size={18} /></button></div>
    {loading ? <p role="status">Loading submission history...</p> : error ? <p role="alert">{error}</p> : data && <>
      <p>v{data.publication.version} · {data.publication.state} · {languageNames[data.assignment.language]}</p>
      {data.assignment.dueAt && <p>Due {date(data.assignment.dueAt)}</p>}
      {data.responseMode==='acknowledge' ? <><h3>Receipt</h3>{data.acknowledgedAt ? <><Assessment value="acknowledged" /><p>{date(data.acknowledgedAt)}</p></> : <p>Awaiting acknowledgment.</p>}</> : <><h3>Question</h3><p>{data.question}</p>{data.workerQuestion && data.workerQuestion!==data.question && <p lang={data.assignment.language} dir={languageDirection(data.assignment.language) || 'ltr'}>{data.workerQuestion}</p>}</>}
      <h3>Published key facts</h3><ul>{data.facts.map((fact,index) => <li key={index}>{fact}</li>)}</ul>
      {data.responseMode!=='acknowledge' && <><h3>Accepted submissions</h3>{!data.receipts.length && <p>No accepted response yet.</p>}
      {data.receipts.map((receipt) => <article className="case-attempt" key={receipt.sequence}>
        <div className="response-receipt-heading"><strong>{data.questionType==='multiple-choice'?'Multiple-choice answer':receipt.kind==='audio' ? 'Audio answer' : 'Typed answer'}{receipt.isLatest ? ' · Latest' : ''}</strong><small>{date(receipt.receivedAt)}</small></div>
        <Assessment value={(data.questionType==='multiple-choice' && receipt.outcome==='matched'?'correct_answer':data.questionType==='multiple-choice' && receipt.outcome==='clarification'?'incorrect_answer':receipt.outcome) || (receipt.audioStatus==='failed' ? 'failed_audio' : 'assessment_pending')} />
        {receipt.answerText!==null && <p className="response-answer" dir="auto">{data.choices?.find(choice=>choice.id===receipt.answerText)?.text || receipt.answerText || 'Empty answer'}</p>}
        {receipt.recordingId && canPlayAudio && <audio controls preload="none" aria-label={`Accepted audio answer ${receipt.sequence}`} src={`/api/recordings/${encodeURIComponent(receipt.recordingId)}/audio`} />}
        {receipt.reasons.length>0 && <ul>{receipt.reasons.map((reason,index) => <li key={index}>{reason.replaceAll('_',' ')}</li>)}</ul>}
        {receipt.evidence.map((item,index) => <blockquote key={index}>{data.questionType==='multiple-choice'?'Selected answer':`Fact ${item.factIndex+1}`}: {data.choices?.find(choice=>choice.id===item.quote)?.text || item.quote}</blockquote>)}
      </article>)}
      <Paging page={page} total={data.total} size={10} onChange={setPage} label="submissions" /></>}
      {data.cases.length>0 && <><h3>Clarification records</h3><div className="row-list">{data.cases.map((item) => <button className="item-row" key={item.id} onClick={() => navigate(`clarifications/${item.id}`)}><span className="item-main"><strong>{item.reason}</strong><small>{item.status}</small></span><ChevronRight size={18} /></button>)}</div></>}
    </>}
  </section>;
}
