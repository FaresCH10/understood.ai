import {CaseTime} from './CaseTime';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {ArrowLeft,ChevronLeft,ChevronRight,MessageCircle,Plus,RefreshCw,Search,TriangleAlert,UserRound} from 'lucide-react';
import {CaseConversation} from './CaseConversation';
import type {MessageSession} from './case-message-recovery';
import {CaseRepeats} from './CaseRepeats';
import {CaseReviews} from './CaseReviews';
import {ClarificationActions} from './ClarificationActions';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {ClarificationContractError,checkedClarificationPage,checkedClarificationDetail,type ClarificationPage as Cases,type ClarificationDetail as Detail,type ClarificationEvidence} from './clarification-contract';
import {caseLocale,caseText,caseMessage,caseState,caseLanguage,caseReason,type CaseLocale,type CaseTextKey} from './clarification-locale';
import {CaseLocalePicker} from './CaseLocalePicker';
import {CaseTimeline} from './CaseTimeline';
import {StaffCaseRecordings} from './StaffCaseRecordings';

function Status({value,language='en'}:{value:string;language?:CaseLocale}){return <span className={`status status-${value==='resolved'?'green':'amber'}`}><span className="status-dot"/>{caseState(language,value)}</span>;}
function readError(reason:unknown){return reason instanceof ClarificationContractError?'The case response could not be verified. Refresh to try again.':'Case details are unavailable. Refresh to try again.';}

export function ClarificationsPage({refresh,navigate,authority,canWrite=false,timezone='UTC',language='en',onLanguageChange}:{refresh:number;navigate:(path:string)=>void;authority:StaffRequestAuthority;canWrite?:boolean;timezone?:string;language?:CaseLocale;onLanguageChange?:(language:CaseLocale)=>void}){
  const locale=caseLocale(language),t=(key:CaseTextKey)=>caseText(locale,key);
  const api=useStaffRequest(authority);
  const [search,setSearch]=useState(''),[status,setStatus]=useState('open'),[owner,setOwner]=useState('all'),[overdue,setOverdue]=useState('all');
  const [page,setPage]=useState(1),[reload,setReload]=useState(0),[read,setRead]=useState<{key:string;data:Cases|null;loading:boolean;error:string}>({key:'',data:null,loading:true,error:''});
  const query=new URLSearchParams({search,status,owner,overdue,page:String(page),pageSize:'20'}).toString(),key=JSON.stringify([query,refresh,reload]);
  const options=useRef<Cases['ownerOptions']>([]);
  useEffect(()=>{
    let alive=true;const controller=new AbortController();setRead({key,data:null,loading:true,error:''});
    api.request<unknown>(`/api/clarifications?${query}`,undefined,controller.signal).then(value=>{
      if(!alive||!api.current())return;const checked=checkedClarificationPage(value,page,20,authority.session.clientContext!);options.current=checked.ownerOptions;setRead({key,data:checked,loading:false,error:''});
    }).catch(reason=>{if(!alive||!api.current())return;if(reason instanceof ClarificationContractError&&reason.code==='session'){authority.onSessionLost();return;}setRead({key,data:null,loading:false,error:readError(reason)});});
    return()=>{alive=false;controller.abort();};
  },[key,api]);
  const data=read.key===key&&api.current()?read.data:null,loading=read.key!==key||read.loading,error=read.key===key?read.error:'';
  const change=(set:(value:string)=>void,value:string)=>{set(value);setPage(1);},pages=Math.max(1,Math.ceil((data?.total||0)/20));
  return <div className="clarification-queue">
    <div className="page-header case-header"><div><h1>{t('Clarifications')}</h1><p>{data?caseText(locale,'{count} cases',{count:data.total}):t('Cases')}</p></div><div className="actions">{onLanguageChange&&<CaseLocalePicker locale={locale} onChange={onLanguageChange}/>}{canWrite&&<button className="button primary" onClick={()=>navigate('clarifications/new')}><Plus size={18}/>{t('New clarification')}</button>}<button className="icon-button" title={t('Refresh clarifications')} aria-label={t('Refresh clarifications')} onClick={()=>setReload(n=>n+1)}><RefreshCw size={18}/></button></div></div>
    <div className="clarification-queue-grid"><div>
      <div className="case-summary-toolbar">
        <div className="case-count"><MessageCircle size={28}/><div><strong>{data?.total??'-'}</strong><span>{t(status==='open'?'Open conversations':status==='resolved'?'Resolved cases':'All cases')}</span></div></div>
        <label className="select-label">{t('Owner')}<select value={owner} onChange={event=>change(setOwner,event.target.value)}><option value="all">{t('All owners')}</option><option value="mine">{t('Assigned to me')}</option><option value="unassigned">{t('Unassigned')}</option>{options.current.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className="select-label">{t('Status')}<select value={status} onChange={event=>change(setStatus,event.target.value)}><option value="open">{t('Open')}</option><option value="resolved">{t('Resolved')}</option><option value="all">{t('All statuses')}</option></select></label>
      </div>
      <div className="filters case-search-filters"><label className="search-box"><Search size={18}/><span className="sr-only">{t('Search clarifications')}</span><input dir="auto" value={search} maxLength={80} placeholder={t('Search worker, topic, reason')} onChange={event=>change(setSearch,event.target.value)}/></label><label className="select-label">{t('Deadline')}<select value={overdue} onChange={event=>change(setOverdue,event.target.value)}><option value="all">{t('All deadlines')}</option><option value="true">{t('Overdue')}</option><option value="false">{t('Not overdue')}</option></select></label></div>
      {error&&<p role="alert" className="record-error">{caseMessage(locale,error)}</p>}
      <section className="panel case-queue-table"><h2>{t('Clarifications to follow up')} {data?`(${data.total})`:''}</h2>
        {loading?<p role="status">{t('Loading clarifications...')}</p>:data?.rows.length?<div className="table-wrap"><table><thead><tr><th>{t('Worker')}</th><th>{t('Language')}</th><th>{t('Topic')}</th><th>{t('Reason')}</th><th>{t('Received')}</th><th>{t('Due')}</th><th>{t('Status')}</th><th><span className="sr-only">{t('Details')}</span></th></tr></thead><tbody>{data.rows.map(row=><tr key={row.id}><td><div className="case-worker"><span className="small-avatar"><UserRound size={22}/></span><span><strong><bdi>{row.worker}</bdi></strong><small><bdi>{row.owner_name||t('Unassigned')}</bdi></small></span></div></td><td>{caseLanguage(locale,row.language)}</td><td><bdi>{row.title||t('Retained case')}</bdi><small>{caseText(locale,'briefing v{version}',{version:row.version})}</small></td><td><span className="case-reason" dir="auto">{caseReason(locale,row.reason)}</span></td><td><CaseTime value={row.created_at} language={locale} timezone={timezone}/></td><td>{row.case_due_at?<><CaseTime value={row.case_due_at} language={locale} timezone={timezone}/>{row.status==='open'&&Date.parse(row.case_due_at)<Date.now()&&<small className="record-error">{t('Overdue')}</small>}</>:t('Not set')}</td><td><Status value={row.status} language={locale}/></td><td><button className="icon-button" title={t('View case')} aria-label={caseText(locale,'View case for {worker}',{worker:row.worker})} onClick={()=>navigate(`clarifications/${row.id}`)}>{locale==='en'?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></td></tr>)}</tbody></table></div>:data&&page>pages?<p>{t('This page is no longer in the current results.')} <button className="back-link" onClick={()=>setPage(1)}>{t('Return to first page')}</button></p>:!error&&<p>{t('No cases in this filter.')}</p>}
        {data&&!loading&&page<=pages&&<div className="audit-pagination"><span>{caseText(locale,'Page {page} of {pages}',{page,pages})}</span><div className="actions"><button className="icon-button" title={t('Previous page')} aria-label={t('Previous page')} disabled={page<=1} onClick={()=>setPage(n=>n-1)}>{locale==='en'?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}</button><button className="icon-button" title={t('Next page')} aria-label={t('Next page')} disabled={page>=pages} onClick={()=>setPage(n=>n+1)}>{locale==='en'?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></div></div>}
      </section>
    </div><aside className="case-queue-aside">
      <section className="case-guidance"><MessageCircle size={60}/><h2>{t('Listen first. Clarify in person when needed.')}</h2><p>{t('Review the conversation and add a clarification. If the issue is complex or sensitive, follow up in person.')}</p></section>
      <section className="case-reason-legend"><h2>{t('Reason legend')}</h2><dl>{([['Missing fact','Important information is missing or incomplete.'],['Unclear audio','Audio is unclear and needs confirmation.'],['Incorrect choice','The worker selected a choice that does not match the instruction.'],['Help requested','Help requested by the worker.'],['Staff follow-up','A supervisor opened a case. The private reason is visible to staff only.']] as const).map(([label,detail],index)=><div key={label}><span className={`small-avatar ${index===0?'attention':''}`}>{index===0?<TriangleAlert size={23}/>:<MessageCircle size={23}/>}</span><div><dt>{t(label)}</dt><dd>{t(detail)}</dd></div></div>)}</dl></section>
    </aside></div>
  </div>;
}

function Evidence({reasons,evidence,facts,language='en'}:{reasons:string[];evidence:ClarificationEvidence[];facts:string[];language?:CaseLocale}){
  const locale=caseLocale(language),t=(key:CaseTextKey)=>caseText(locale,key);
  return <>{reasons.length>0&&<><h3>{t('Assessment reasons')}</h3><ul>{reasons.map((reason,index)=><li key={index} dir="auto">{caseReason(locale,reason)}</li>)}</ul></>}{evidence.length>0&&<><h3>{t('Retained answer evidence')}</h3>{evidence.map((row,index)=><blockquote key={index}><p dir="auto">{row.quote}</p><footer dir="auto">{facts[row.factIndex]||caseText(locale,'Asked fact {number}',{number:row.factIndex+1})}</footer></blockquote>)}</>}</>;
}

export function ClarificationPage({id,refresh,navigate,canWrite,session,navigationGuard,authority,language='en',onLanguageChange,timezone}:{id:string;refresh:number;navigate:(path:string)=>void;canWrite:boolean;session:MessageSession;navigationGuard:RefObject<((next:string,resume?:()=>void)=>boolean)|null>;authority:StaffRequestAuthority;language?:CaseLocale;onLanguageChange?:(language:CaseLocale)=>void;timezone?:string}){
  const locale=caseLocale(language),t=(key:CaseTextKey)=>caseText(locale,key);
  const api=useStaffRequest(authority),[read,setRead]=useState<{key:string;data:Detail|null;loading:boolean;error:string}>({key:'',data:null,loading:true,error:''});
  const [reload,setReload]=useState(0),[error,setError]=useState(''),[conversationDirty,setConversationDirty]=useState(false),[repeatDirty,setRepeatDirty]=useState(false),[reviewDirty,setReviewDirty]=useState(false),[actionDirty,setActionDirty]=useState(false),[recordingDirty,setRecordingDirty]=useState(false);
  const retained=useRef<Detail|null>(null),capabilities=useRef({repeat:false,review:false});
  const key=JSON.stringify([id,refresh,reload]);
  useEffect(()=>{
    const route=`clarifications/${id}`,guard=(next:string)=>{
      if(!conversationDirty&&!repeatDirty&&!reviewDirty&&!actionDirty&&!recordingDirty||next===route)return true;
      history.replaceState(null,'',`${location.pathname}${location.search}#${route}`);setError('Finish or clear the current case draft before leaving. Pending receipts remain available on this case.');return false;
    };
    navigationGuard.current=guard;return()=>{if(navigationGuard.current===guard)navigationGuard.current=null;};
  },[id,conversationDirty,repeatDirty,reviewDirty,actionDirty,recordingDirty,navigationGuard]);
  useEffect(()=>{if(!conversationDirty&&!repeatDirty&&!reviewDirty&&!actionDirty&&!recordingDirty)setError('');},[conversationDirty,repeatDirty,reviewDirty,actionDirty,recordingDirty]);
  useEffect(()=>{
    let alive=true;const controller=new AbortController();setRead({key,data:null,loading:true,error:''});
    api.request<unknown>(`/api/clarifications/${encodeURIComponent(id)}`,undefined,controller.signal).then(value=>{
      if(!alive||!api.current())return;const checked=checkedClarificationDetail(value,id,authority.session.clientContext!);retained.current=checked;
      capabilities.current={repeat:capabilities.current.repeat||checked.canRequestRepeat,review:capabilities.current.review||checked.canReview};setRead({key,data:checked,loading:false,error:''});
    }).catch(reason=>{if(!alive||!api.current())return;if(reason instanceof ClarificationContractError&&reason.code==='session'){authority.onSessionLost();return;}setRead({key,data:null,loading:false,error:readError(reason)});});
    return()=>{alive=false;controller.abort();};
  },[key,api]);
  const available=read.key===key&&!!read.data&&api.current(),data=api.current()?retained.current:null,loading=read.key!==key||read.loading;
  if(!data)return <><button className="back-link direction-arrow" onClick={()=>navigate('clarifications')}><ArrowLeft size={18}/>{t('Back to clarifications')}</button>{onLanguageChange&&<CaseLocalePicker locale={locale} onChange={onLanguageChange}/>}{loading?<p role="status">{t('Loading case...')}</p>:<p role="alert" className="record-error">{read.error?caseMessage(locale,read.error):t('Case unavailable.')}</p>}<button className="button outline" disabled={loading} onClick={()=>setReload(n=>n+1)}><RefreshCw size={18}/>{t('Refresh case')}</button></>;
  const writable=canWrite&&available&&authority.canMutate();
  return <div className="clarification-detail case-workflow">
    <button className="back-link direction-arrow" onClick={()=>navigate('clarifications')}><ArrowLeft size={18}/>{t('Back to clarifications')}</button>
    <div className="page-header"><div><h1><bdi>{data.worker}</bdi> · {data.status==='resolved'?t('Resolved'):t('Follow-up needed')}</h1><p>{caseLanguage(locale,data.language)} · {caseText(locale,'briefing v{version}',{version:data.version})}</p></div><div className="actions">{onLanguageChange&&<CaseLocalePicker locale={locale} onChange={onLanguageChange}/>}<Status value={data.status} language={locale}/><button className="icon-button" title={t('Refresh case')} aria-label={t('Refresh case')} disabled={actionDirty&&loading} onClick={()=>setReload(n=>n+1)}><RefreshCw size={18}/></button></div></div>
    {loading&&<p role="status">{t('Refreshing case details. Last loaded details are shown below.')}</p>}{read.key===key&&read.error&&<p role="alert" className="record-error">{caseMessage(locale,read.error)} {t('Last loaded details are shown below.')}</p>}{error&&<p role="alert" className="record-error">{caseMessage(locale,error)}</p>}
    <div className="detail-grid"><section className="panel"><h2>{t("Original response")}</h2>
      {data.recording_id&&<audio controls preload="none" aria-label={t('Original response audio')} src={`/api/recordings/${encodeURIComponent(data.recording_id)}/audio`}/>}
      <p className="source-text" dir="auto">{data.answer_text||t('No submitted answer retained for this case.')}</p><dl className="audit-fields"><div><dt>{t('Assessment')}</dt><dd>{data.outcome?caseState(locale,data.outcome):data.staffCreation?t('Independent staff follow-up'):t('Help request')}</dd></div><div><dt>{t('Reason')}</dt><dd dir="auto">{caseReason(locale,data.reason)}</dd></div></dl>
      {data.staffCreation&&<p>{caseText(locale,'Opened by {name}',{name:data.staffCreation.actorName})} · <CaseTime value={data.staffCreation.createdAt} language={locale} timezone={timezone}/></p>}
      <Evidence language={locale} reasons={data.assessmentReasons} evidence={data.assessmentEvidence} facts={data.snapshot.askedFacts}/>
      {data.helpRequest&&<><h3>{t('Worker help request')}</h3><p className="source-text" dir="auto">{data.helpRequest.text}</p><CaseTime value={data.helpRequest.createdAt} language={locale} timezone={timezone} className="muted"/></>}
      <details className="case-key-facts"><summary>{t('Question and key facts')}</summary><p className="question" dir="auto">{data.snapshot.question||t('Question content is no longer retained.')}</p><ul>{data.snapshot.facts.map((fact,index)=><li key={index} dir="auto">{fact}</li>)}</ul></details>
      {data.case_due_at&&<p>{t('Follow-up due')} <CaseTime value={data.case_due_at} language={locale} timezone={timezone}/>{data.status==='open'&&Date.parse(data.case_due_at)<Date.now()?` · ${t('Overdue')}`:''}</p>}
      {data.escalated_at&&<p>{t('Escalated')} <CaseTime value={data.escalated_at} language={locale} timezone={timezone}/></p>}
    </section><CaseTimeline caseId={id} authority={authority} available={available} refresh={refresh+reload} language={locale} timezone={timezone} resolutionNote={data.status==='resolved'?data.notes:''}/></div>
    <CaseConversation caseId={id} session={session} language={language} timezone={timezone} current={authority.isCurrent} canMutate={()=>available&&data.status==='open'&&authority.canMutate()} onSessionLost={authority.onSessionLost} canWrite={writable&&data.status==='open'&&!repeatDirty&&!reviewDirty&&!actionDirty&&!recordingDirty} onDirtyChange={setConversationDirty}
      afterComposer={['owner','supervisor'].includes(authority.session.staffRole??'')&&(data.language==='en'||data.language==='ar'||data.language==='ur')?<StaffCaseRecordings scope={{caseId:id,assignmentId:data.assignment_id}} authority={authority} available={available} canWrite={writable&&data.status==='open'&&!data.contentExpired&&!conversationDirty&&!repeatDirty&&!reviewDirty&&!actionDirty} language={locale} onLanguageChange={onLanguageChange} recordingLanguage={data.language} timezone={timezone} refresh={refresh+reload} onDirtyChange={setRecordingDirty} onChanged={()=>setReload(n=>n+1)}/>:undefined}/>
    {capabilities.current.repeat&&<CaseRepeats language={locale} caseId={id} authority={authority} available={available} timezone={timezone} canWrite={writable&&data.canRequestRepeat&&!conversationDirty&&!reviewDirty&&!actionDirty&&!recordingDirty} closed={data.status==='resolved'} onDirtyChange={setRepeatDirty}/>}
    {capabilities.current.review&&<CaseReviews language={locale} caseId={id} authority={authority} available={available} timezone={timezone} canWrite={writable&&data.canReview&&!data.contentExpired&&!conversationDirty&&!repeatDirty&&!actionDirty&&!recordingDirty} closed={data.status==='resolved'} onDirtyChange={setReviewDirty} onDeadlineChange={()=>setReload(n=>n+1)}/>}
    <ClarificationActions language={locale} data={data} authority={authority} available={available} canWrite={canWrite&&!conversationDirty&&!repeatDirty&&!reviewDirty&&!recordingDirty} onDirtyChange={setActionDirty} onChanged={()=>setReload(n=>n+1)}/>
    {data.attempts.length>0&&<section className="panel"><h2>{caseText(locale,'Recent responses ({count})',{count:data.attempts.length})}</h2><div className="row-list">{data.attempts.map(attempt=><article className="case-attempt" key={attempt.id}><CaseTime value={attempt.received_at} language={locale} timezone={timezone}/><p dir="auto">{attempt.answer_text}</p><span className="muted">{caseState(locale,attempt.outcome)}</span><Evidence language={locale} reasons={attempt.assessmentReasons} evidence={attempt.assessmentEvidence} facts={data.snapshot.askedFacts}/>{attempt.recording_id&&<audio controls preload="none" aria-label={t('Original response audio')} src={`/api/recordings/${encodeURIComponent(attempt.recording_id)}/audio`}/>}</article>)}</div></section>}
  </div>;
}
