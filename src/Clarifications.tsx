import {CaseTime} from './CaseTime';
import {useEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {ArrowLeft,Check,ChevronDown,ChevronLeft,ChevronRight,ClipboardCheck,Clock3,HelpCircle,History,Info,MessageCircle,MessageSquare,Plus,RefreshCw,Repeat2,Search,SlidersHorizontal,TriangleAlert,UserRound,X} from 'lucide-react';
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
import './clarifications-inbox.css';
import './clarification-detail.css';

function Status({value,language='en'}:{value:string;language?:CaseLocale}){return <span className={`status status-${value==='resolved'?'green':'amber'}`}><span className="status-dot"/>{caseState(language,value)}</span>;}
function readError(reason:unknown){return reason instanceof ClarificationContractError?'The case response could not be verified. Refresh to try again.':'Case details are unavailable. Refresh to try again.';}
type CaseKind='answer'|'help'|'staff';
const caseKindFromReason=(reason:string):CaseKind=>/^staff follow-up:/i.test(reason)?'staff':/help requested/i.test(reason)?'help':'answer';
function KindChip({kind,language}:{kind:CaseKind;language:CaseLocale}){
  const Icon=kind==='help'?HelpCircle:kind==='staff'?MessageSquare:Repeat2;
  return <span className={`cd-kind cd-kind--${kind}`}><Icon size={13} aria-hidden="true"/>{caseText(language,kind==='help'?'Help request':kind==='staff'?'Supervisor follow-up':'Answer check')}</span>;
}

export function ClarificationsPage({refresh,navigate,authority,canWrite=false,timezone='UTC',language='en',onLanguageChange}:{refresh:number;navigate:(path:string)=>void;authority:StaffRequestAuthority;canWrite?:boolean;timezone?:string;language?:CaseLocale;onLanguageChange?:(language:CaseLocale)=>void}){
  const locale=caseLocale(language),t=(key:CaseTextKey)=>caseText(locale,key);
  const api=useStaffRequest(authority);
  const [search,setSearch]=useState(''),[status,setStatus]=useState('open'),[owner,setOwner]=useState('all'),[overdue,setOverdue]=useState('all');
  const [filtersOpen,setFiltersOpen]=useState(false);
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
  const hasFilters=!!search||owner!=='all'||overdue!=='all',filterCount=Number(owner!=='all')+Number(overdue!=='all');
  const clearFilters=()=>{setSearch('');setOwner('all');setOverdue('all');setPage(1);};
  return <div className="clarification-queue clarifications-inbox" dir={locale==='en'?'ltr':'rtl'}>
    <header className="page-header ci-header">
      <div><h1>{t('Clarifications')}</h1><p>{t('A clear next step for every conversation.')}</p></div>
      <div className="actions">{onLanguageChange&&<CaseLocalePicker locale={locale} onChange={onLanguageChange}/>}{canWrite&&<button className="button primary" onClick={()=>navigate('clarifications/new')}><Plus size={18}/>{t('New clarification')}</button>}<button className="icon-button ci-refresh" disabled={loading} title={t('Refresh clarifications')} aria-label={t('Refresh clarifications')} onClick={()=>setReload(n=>n+1)}><RefreshCw size={18}/></button></div>
    </header>

    <div className="ci-status-switch" role="group" aria-label={t('Status')}>
      {(['open','resolved','all'] as const).map(value=><button key={value} className={status===value?'is-active':''} aria-pressed={status===value} onClick={()=>change(setStatus,value)}>{value==='open'?<MessageCircle size={16}/>:value==='resolved'?<Check size={16}/>:null}{t(value==='open'?'Open':value==='resolved'?'Resolved':'All cases')}</button>)}
    </div>

    <section className="ci-inbox" aria-labelledby="ci-results-heading">
      <div className="ci-toolbar">
        <div className="ci-search-row"><label className="search-box ci-search"><Search size={18} aria-hidden="true"/><span className="sr-only">{t('Search clarifications')}</span><input dir="auto" value={search} maxLength={80} placeholder={t('Search worker, topic, reason')} onChange={event=>change(setSearch,event.target.value)}/>{search&&<button className="icon-button" aria-label={t('Clear search')} onClick={()=>change(setSearch,'')}><X size={16}/></button>}</label><button className="button outline ci-filter-toggle" aria-expanded={filtersOpen} aria-controls="ci-filters" onClick={()=>setFiltersOpen(value=>!value)}><SlidersHorizontal size={17}/>{t('Filters')}{filterCount>0&&<span className="ci-filter-count">{filterCount}</span>}</button></div>
        <div className={`ci-filters ${filtersOpen?'is-expanded':''}`} id="ci-filters">
          <label className="ci-filter"><span>{t('Owner')}</span><select aria-label={t('Owner')} value={owner} onChange={event=>change(setOwner,event.target.value)}><option value="all">{t('All owners')}</option><option value="mine">{t('Assigned to me')}</option><option value="unassigned">{t('Unassigned')}</option>{options.current.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="ci-filter"><span>{t('Deadline')}</span><select aria-label={t('Deadline')} value={overdue} onChange={event=>change(setOverdue,event.target.value)}><option value="all">{t('All deadlines')}</option><option value="true">{t('Overdue')}</option><option value="false">{t('Not overdue')}</option></select></label>
        </div>
      </div>
      <div className="ci-quick-filters"><button className="button outline" aria-pressed={overdue==='true'} onClick={()=>change(setOverdue,overdue==='true'?'all':'true')}>{t('Overdue')}</button><button className="button outline" aria-pressed={owner==='unassigned'} onClick={()=>change(setOwner,owner==='unassigned'?'all':'unassigned')}>{t('Unassigned')}</button></div>
      <div className="ci-results-bar"><h2 id="ci-results-heading">{t(status==='open'?'Open conversations':status==='resolved'?'Resolved cases':'All cases')}{data&&<span className="ci-result-count">{data.total.toLocaleString(locale)}</span>}</h2><div>{hasFilters?<button className="ci-reset" onClick={clearFilters}><X size={14}/>{t('Clear filters')}</button>:<span className="ci-sort"><Clock3 size={14}/>{t('Newest first')}</span>}</div></div>

      {loading?<div className="ci-loading" data-page-loading role="status"><span className="sr-only">{t('Loading clarifications...')}</span>{[0,1,2].map(index=><div className="ci-skeleton-row" key={index} aria-hidden="true"><span/><div><i/><i/></div><div><i/><i/></div><div><i/><i/></div></div>)}</div>:error?<div className="ci-empty" role="alert"><TriangleAlert size={24}/><h3>{t('Clarifications could not be loaded.')}</h3><p>{caseMessage(locale,error)}</p><button className="button outline" onClick={()=>setReload(n=>n+1)}><RefreshCw size={16}/>{t('Try again')}</button></div>:data?.rows.length?<div className="ci-table-wrap"><table className="ci-table"><caption className="sr-only">{t('Clarifications')}</caption><thead><tr><th>{t('Worker')}</th><th>{t('Instruction and reason')}</th><th>{t('Received')}</th><th>{t('Deadline')}</th><th>{t('Status')}</th></tr></thead><tbody>{data.rows.map(row=>{
        const isOverdue=row.status==='open'&&!!row.case_due_at&&Date.parse(row.case_due_at)<Date.now();
        const reason=caseReason(locale,row.reason),openCase=()=>navigate(`clarifications/${row.id}`);
        return <tr key={row.id} className="ci-case" onClick={event=>{if((event.target as HTMLElement).closest('button,a,input,select,textarea')||window.getSelection()?.toString())return;openCase();}}>
          <td className="ci-person"><div className="ci-identity"><span className="ci-avatar" aria-hidden="true"><UserRound size={20}/></span><div><button className="ci-case-link" aria-label={caseText(locale,'View case for {worker}',{worker:row.worker})} title={row.worker} onClick={openCase}><bdi>{row.worker}</bdi></button><span className="ci-owner"><span>{t('Owner')}: </span><bdi>{row.owner_name||t('Unassigned')}</bdi></span><span className="ci-language">{caseLanguage(locale,row.language)}</span></div></div></td>
          <td className="ci-context"><span className="ci-kind-line"><KindChip kind={caseKindFromReason(row.reason)} language={locale}/></span><strong className="ci-topic" title={row.title||t('Retained case')}><bdi>{row.title||t('Retained case')}</bdi></strong><span className="ci-version">{caseText(locale,'instruction v{version}',{version:row.version})}{row.current_version!==null&&row.current_version>row.version&&<> · <span className="version-badge">{caseText(locale,'superseded by v{version}',{version:row.current_version})}</span></>}</span><span className="ci-reason"><MessageCircle size={14} aria-hidden="true"/><span dir="auto" title={reason}>{reason}</span></span></td>
          <td className="ci-received"><span className="ci-mobile-label">{t('Received')}</span><CaseTime value={row.created_at} language={locale} timezone={timezone}/></td>
          <td className={`ci-deadline ${!row.case_due_at?"mobile-empty-deadline":""} ${isOverdue?'is-overdue':''}`}><span className="ci-mobile-label">{t('Deadline')}</span>{row.case_due_at?<><CaseTime value={row.case_due_at} language={locale} timezone={timezone}/>{isOverdue&&<span className="ci-overdue"><TriangleAlert size={13} aria-hidden="true"/>{t('Overdue')}</span>}</>:<span className="ci-no-deadline">{t('No deadline')}</span>}</td>
          <td className="ci-state"><div><Status value={row.status} language={locale}/><span className="ci-open-arrow" aria-hidden="true">{locale==='en'?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</span></div></td>
        </tr>;
      })}</tbody></table></div>:<div className="ci-empty"><MessageCircle size={26}/><h3>{t(data&&page>pages?'This page is no longer in the current results.':hasFilters?'No cases in this filter.':status==='resolved'?'No resolved cases yet.':status==='open'?'No open conversations.':'No clarifications yet.')}</h3><p>{t(hasFilters?'Try another search or clear your filters.':'Worker questions and instruction follow-ups will appear here.')}</p>{data&&page>pages?<button className="button outline" onClick={()=>setPage(1)}>{t('Return to first page')}</button>:hasFilters?<button className="button outline" onClick={clearFilters}>{t('Clear filters')}</button>:canWrite&&<button className="button outline" onClick={()=>navigate('clarifications/new')}><Plus size={16}/>{t('New clarification')}</button>}</div>}

      {data&&!loading&&pages>1&&page<=pages&&<div className="audit-pagination ci-pagination"><span>{caseText(locale,'Page {page} of {pages}',{page,pages})}</span><div className="actions"><button className="icon-button" title={t('Previous page')} aria-label={t('Previous page')} disabled={page<=1} onClick={()=>setPage(n=>n-1)}>{locale==='en'?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}</button><button className="icon-button" title={t('Next page')} aria-label={t('Next page')} disabled={page>=pages} onClick={()=>setPage(n=>n+1)}>{locale==='en'?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></div></div>}
    </section>

    <details className="ci-guide"><summary><Info size={17}/><span>{t('How to follow up')}</span><ChevronDown size={16}/></summary><div className="ci-guide-content"><div><h3>{t('Listen first. Clarify in person when needed.')}</h3><p>{t('Review the conversation and add a clarification. If the issue is complex or sensitive, follow up in person.')}</p></div><div><h3>{t('Reason legend')}</h3><dl>{([['Missing fact','Important information is missing or incomplete.'],['Unclear audio','Audio is unclear and needs confirmation.'],['Incorrect choice','The worker selected a choice that does not match the instruction.'],['Help requested','Help requested by the worker.'],['Staff follow-up','A supervisor opened a case. The private reason is visible to staff only.']] as const).map(([label,detail])=><div key={label}><dt>{t(label)}</dt><dd>{t(detail)}</dd></div>)}</dl></div></div></details>
  </div>;
}

function Evidence({reasons,evidence,facts,language='en'}:{reasons:string[];evidence:ClarificationEvidence[];facts:string[];language?:CaseLocale}){
  const locale=caseLocale(language),t=(key:CaseTextKey)=>caseText(locale,key);
  return <>{reasons.length>0&&<><h3>{t('Assessment reasons')}</h3><ul>{reasons.map((reason,index)=><li key={index} dir="auto">{caseReason(locale,reason)}</li>)}</ul></>}{evidence.length>0&&<><h3>{t('Retained answer evidence')}</h3>{evidence.map((row,index)=><blockquote key={index}><p dir="auto">{row.quote}</p><footer dir="auto">{facts[row.factIndex]||caseText(locale,'Asked fact {number}',{number:row.factIndex+1})}</footer></blockquote>)}</>}</>;
}

function CaseDisclosure({title,description,icon,attention,children,className=''}:{title:string;description?:string;icon?:ReactNode;attention?:string;children:ReactNode;className?:string}){
  const element=useRef<HTMLDetailsElement>(null);
  // Native disclosures keep their children mounted, including drafts and receipt recovery.
  useEffect(()=>{if(attention&&element.current)element.current.open=true;},[attention]);
  return <details className={`cd-disclosure ${className}`} ref={element}><summary>{icon&&<span className="cd-disclosure-icon" aria-hidden="true">{icon}</span>}<span className="cd-disclosure-label"><strong>{title}</strong>{description&&<span>{description}</span>}</span>{attention&&<span className="cd-attention">{attention}</span>}<ChevronDown size={17} aria-hidden="true"/></summary><div className="cd-disclosure-content">{children}</div></details>;
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
  if(!data)return <div className="clarification-detail cd-workspace" dir={locale==='en'?'ltr':'rtl'}><button className="back-link direction-arrow cd-back" onClick={()=>navigate('clarifications')}><ArrowLeft size={17}/>{t('Back to clarifications')}</button>{onLanguageChange&&<CaseLocalePicker locale={locale} onChange={onLanguageChange}/>}{loading?<div className="cd-loading" data-page-loading role="status"><span className="sr-only">{t('Loading case...')}</span><div className="cd-loading-heading" aria-hidden="true"/><div className="cd-loading-grid" aria-hidden="true"><span/><span/></div></div>:<div className="cd-unavailable"><MessageCircle size={28}/><h1>{t('Case unavailable.')}</h1><p role="alert">{read.error?caseMessage(locale,read.error):t('Case unavailable.')}</p><button className="button outline" onClick={()=>setReload(n=>n+1)}><RefreshCw size={18}/>{t('Refresh case')}</button></div>}</div>;
  const writable=canWrite&&available&&authority.canMutate();
  const superseded=data.current_version!==null&&data.current_version>data.version;
  const kind:CaseKind=data.staffCreation?'staff':data.helpRequest?'help':caseKindFromReason(data.reason);
  const reasonText=caseReason(locale,data.reason).trim().toLowerCase(),detailReasons=data.assessmentReasons.filter(reason=>caseReason(locale,reason).trim().toLowerCase()!==reasonText),expectedFacts=data.snapshot.askedFacts.length?data.snapshot.askedFacts:data.snapshot.facts;
  const openCaseSection=(id:string)=>{const section=document.getElementById(id) as HTMLDetailsElement|null;if(!section)return;section.open=true;section.scrollIntoView({block:'center'});section.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});};
  return <div className="clarification-detail case-workflow cd-workspace" lang={locale} dir={locale==='en'?'ltr':'rtl'}>
    <button className="back-link direction-arrow cd-back" onClick={()=>navigate('clarifications')}><ArrowLeft size={17}/>{t('Back to clarifications')}</button>
    <header className="page-header cd-header"><div className="cd-worker-heading"><span className="cd-worker-avatar" aria-hidden="true"><UserRound size={24}/></span><div><h1><bdi>{data.worker}</bdi></h1><p><bdi>{data.title||t('Retained case')}</bdi><span className="cd-header-version">{caseText(locale,'instruction v{version}',{version:data.version})}</span></p><span className="cd-header-type"><KindChip kind={kind} language={locale}/><Status value={data.status} language={locale}/></span></div></div><div className="actions">{onLanguageChange&&<CaseLocalePicker locale={locale} onChange={onLanguageChange}/>}<button className="icon-button cd-refresh" title={t('Refresh case')} aria-label={t('Refresh case')} disabled={loading} onClick={()=>setReload(n=>n+1)}><RefreshCw size={18}/></button></div></header>
    <dl className="cd-meta"><div><dt>{t('Language')}</dt><dd>{caseLanguage(locale,data.language)}</dd></div><div><dt>{t('Received')}</dt><dd><CaseTime value={data.created_at} language={locale} timezone={timezone}/></dd></div><div className={data.status==='open'&&data.case_due_at&&Date.parse(data.case_due_at)<Date.now()?'cd-overdue':''}><dt>{t('Case deadline')}</dt><dd>{data.case_due_at?<><CaseTime value={data.case_due_at} language={locale} timezone={timezone}/>{data.status==='open'&&Date.parse(data.case_due_at)<Date.now()&&<span className="cd-overdue-label"><TriangleAlert size={13}/>{t('Overdue')}</span>}</>:t('No deadline')}</dd></div></dl>
    {superseded&&<p className="cd-notice"><Info size={17}/>{caseText(locale,'This case relates to v{case}. The live instruction is v{current}.',{case:data.version,current:data.current_version!})}</p>}
    {data.escalated_at&&<p className="cd-notice"><TriangleAlert size={17}/><span>{t('Escalated')} · <CaseTime value={data.escalated_at} language={locale} timezone={timezone}/></span></p>}
    {loading&&<p className="cd-notice" data-page-loading role="status">{t('Refreshing case details. Last loaded details are shown below.')}</p>}{read.key===key&&read.error&&<p role="alert" className="cd-notice">{caseMessage(locale,read.error)} {t('Last loaded details are shown below.')}</p>}{error&&<p role="alert" className="cd-notice cd-guard-notice"><Info size={17}/>{caseMessage(locale,error)}</p>}

    {(capabilities.current.repeat||data.status==='resolved')&&<CaseRepeats language={locale} caseId={id} worker={data.worker} workerLanguage={data.language} onResolve={canWrite?()=>openCaseSection('cd-resolve-section'):undefined} onDeadline={canWrite&&data.canReview?()=>openCaseSection('cd-deadline-section'):undefined} authority={authority} available={available} timezone={timezone} caseDueAt={data.case_due_at} checkBack={data.outcome==='clarification'} canWrite={writable&&data.canRequestRepeat&&!conversationDirty&&!reviewDirty&&!actionDirty&&!recordingDirty} closed={data.status==='resolved'} onDirtyChange={setRepeatDirty}/>}

    <div className="cd-layout"><div className="cd-primary">
      <section className="panel cd-original"><div className="cd-section-heading"><h2><MessageCircle size={18}/>{t('Instruction and answer')}</h2></div>
        {data.snapshot.source&&<div className="cd-question cd-instruction"><span className="cd-field-label">{t('Instruction')}</span><p className="cd-instruction-source" lang="" dir="auto">{data.snapshot.source}</p></div>}
        {data.snapshot.question&&<div className="cd-question"><span className="cd-field-label">{t('Question asked')}</span><p lang="en" dir="auto">{data.snapshot.question}</p></div>}
        <span className="cd-field-label">{t('Answer')} · {caseLanguage(locale,data.language)}</span>
        {data.recording_id&&<audio controls preload="none" aria-label={t('Original response audio')} src={`/api/recordings/${encodeURIComponent(data.recording_id)}/audio`}/>}
        <blockquote className="cd-answer" lang={data.language} dir="auto">{data.answer_text||t('No submitted answer retained for this case.')}</blockquote>
        {data.answer_text&&data.language!==locale&&<p className="cd-evidence-note">{t(data.status==='resolved'?'Answer translation is not available.':'Answer translation is not available. Ask someone who speaks this language to review it.')}</p>}
        {data.outcome==='clarification'&&!data.assessmentEvidence.length&&<p className="cd-evidence-note cd-evidence-note--warning">{t(data.status==='resolved'?'No fact-level explanation was saved.':'No fact-level explanation was saved. Confirm the answer with the worker before deciding.')}</p>}
        {expectedFacts.length>0&&<div className="cd-expected"><span className="cd-field-label">{t('Expected')}</span><ul>{expectedFacts.map((fact,index)=>{const quotes=data.snapshot.askedFacts.length?data.assessmentEvidence.filter(row=>row.factIndex===index):[];return <li key={index}><p lang="en" dir="auto">{fact}</p>{quotes.length>0&&<div className="cd-fact-quotes"><span>{t('Recorded answer quote')}</span>{quotes.map((row,i)=><blockquote key={i} lang={data.language} dir="auto">{row.quote}</blockquote>)}</div>}</li>;})}</ul></div>}
        <dl className="cd-assessment"><div><dt>{t('Assessment')}</dt><dd>{data.outcome?<span className="cd-outcome">{caseState(locale,data.outcome)}</span>:data.staffCreation?t('Independent staff follow-up'):t('Help request')}</dd></div><div><dt>{t('Reason')}</dt><dd dir="auto">{caseReason(locale,data.reason)}</dd></div></dl>
        {data.staffCreation&&<p className="cd-byline">{caseText(locale,'Opened by {name}',{name:data.staffCreation.actorName})} · <CaseTime value={data.staffCreation.createdAt} language={locale} timezone={timezone}/></p>}
        {data.helpRequest&&<div className="cd-help-request"><h3>{t('Worker help request')}</h3><p dir="auto">{data.helpRequest.text}</p><CaseTime value={data.helpRequest.createdAt} language={locale} timezone={timezone}/></div>}
        {(detailReasons.length>0||data.assessmentEvidence.length>0)&&<CaseDisclosure title={t('Assessment details')} icon={<ClipboardCheck size={18}/>} className="cd-evidence"><Evidence language={locale} reasons={detailReasons} evidence={data.assessmentEvidence} facts={data.snapshot.askedFacts}/></CaseDisclosure>}
        {data.attempts.length>0&&<CaseDisclosure title={caseText(locale,'Recent responses ({count})',{count:data.attempts.length})} description={t('Earlier answers and their original assessments.')} icon={<History size={18}/>} className="cd-responses"><div className="row-list">{data.attempts.map(attempt=><article className="case-attempt" key={attempt.id}><div className="cd-attempt-heading"><CaseTime value={attempt.received_at} language={locale} timezone={timezone}/><span>{caseState(locale,attempt.outcome)}</span></div><p lang={data.language} dir="auto">{attempt.answer_text}</p><Evidence language={locale} reasons={attempt.assessmentReasons} evidence={attempt.assessmentEvidence} facts={data.snapshot.askedFacts}/>{attempt.recording_id&&<audio controls preload="none" aria-label={t('Original response audio')} src={`/api/recordings/${encodeURIComponent(attempt.recording_id)}/audio`}/>}</article>)}</div></CaseDisclosure>}
      </section>
      <div className="cd-conversation" tabIndex={-1} role="region" aria-label={t('View follow-up conversation')}><CaseConversation caseId={id} session={session} language={language} timezone={timezone} synthetic={authority.session.mode!=='live-credential'} current={authority.isCurrent} canMutate={()=>available&&data.status==='open'&&authority.canMutate()} onSessionLost={authority.onSessionLost} canWrite={writable&&data.status==='open'&&!repeatDirty&&!reviewDirty&&!actionDirty&&!recordingDirty} onDirtyChange={setConversationDirty}
      afterComposer={['owner','supervisor'].includes(authority.session.staffRole??'')&&(data.language==='en'||data.language==='ar'||data.language==='ur')?<StaffCaseRecordings scope={{caseId:id,assignmentId:data.assignment_id}} authority={authority} available={available} canWrite={writable&&data.status==='open'&&!data.contentExpired&&!conversationDirty&&!repeatDirty&&!reviewDirty&&!actionDirty} language={locale} onLanguageChange={onLanguageChange} recordingLanguage={data.language} timezone={timezone} refresh={refresh+reload} onDirtyChange={setRecordingDirty} onChanged={()=>setReload(n=>n+1)}/>:undefined}/>
      </div>
    </div><aside className="cd-sidebar" aria-label={t('Case management')}>
      <ClarificationActions language={locale} data={data} authority={authority} available={available} canWrite={canWrite&&!conversationDirty&&!repeatDirty&&!reviewDirty&&!recordingDirty} onDirtyChange={setActionDirty} onChanged={()=>setReload(n=>n+1)}/>
      {capabilities.current.review&&<CaseReviews language={locale} caseId={id} authority={authority} available={available} timezone={timezone} canWrite={writable&&data.canReview&&!data.contentExpired&&!conversationDirty&&!repeatDirty&&!actionDirty&&!recordingDirty} closed={data.status==='resolved'} onDirtyChange={setReviewDirty} onDeadlineChange={()=>setReload(n=>n+1)}/>}
      <CaseDisclosure title={t('Timeline')} icon={<Clock3 size={18}/>} className="cd-timeline"><CaseTimeline caseId={id} authority={authority} available={available} refresh={refresh+reload} language={locale} timezone={timezone} resolutionNote={data.status==='resolved'?data.notes:''}/></CaseDisclosure>
    </aside></div>
  </div>;
}
