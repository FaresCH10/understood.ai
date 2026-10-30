import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, FileText, History, MessageCircleCheck, RefreshCw, Search, TriangleAlert, Users } from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {useArtifactMutation} from './useArtifactMutation';
import {checkedArtifactScope} from './artifact-request';
import type {ArtifactDefinition} from './useArtifactRequest';
import {readPendingExport,savePendingExport,clearPendingExport,checkedExportReceipt,checkedExportResult,checkedExportRow,type PendingExport,type ExportAccepted} from './export-recovery';
import {CaseLocalePicker} from './CaseLocalePicker';
import {reportLocale,reportText,reportErrorText,reportState,reportLanguage,reportTimestamp,type ReportLocale,type ReportTextKey} from './report-locale';

type Counts = { assigned: number; responses: number; matches: number; clarifications: number; unassessed: number; pending: number; completion: number; acknowledged?: number; resolved?: number };
type Delivery = { requestId: string; state: string; captured: number; delivered: number; undelivered: number;
  undeliveredReasons: unknown[]; states: { preparing: number; available: number; blocked: number; failed: number; withdrawn: number } };
type Publication = { id: string; title: string; version: number; state: string };
type PublicationPage = {items:(Publication & {publishedAt:string})[];total:number;page:number;pageSize:number;timezone:string};
type ReportFilters={crewId:string;responseFrom:string;responseThrough:string};
type Report = { title: string; publicationId: string; version: number; metrics: Counts | null; timezone: string; asOf: string;
  filters?:ReportFilters;crewSnapshotAvailable?:boolean;availableCrews?:{id:string;name:string}[];
  responseMode?:string;deliveryMode?:string;delivery?:Delivery|null;
  availablePublications: Publication[]; languages: { language: string; assigned: number; received: number; completion: number }[] };
type Export = { id: string; status: string; createdAt: string; expiresAt: string; filename: string; attempts: number; error: string | null;filters?:ReportFilters & {timezone?:string} };

const definition:ArtifactDefinition<PendingExport,ExportAccepted>={endpoint:'/api/reports/exports',roles:['owner','supervisor','auditor'],
  path:value=>value.kind==='create'?'':`/${encodeURIComponent(value.exportId!)}/retry`,receiptPath:value=>`/receipts/${value.kind}/${encodeURIComponent(value.requestId)}`,
  result:checkedExportResult,receipt:checkedExportReceipt,clear:clearPendingExport};

function PublicationHistory({onSelect,disabled,authority,language}:{onSelect:(id:string)=>void;disabled:boolean;authority:StaffRequestAuthority;language:ReportLocale}) {
  const {request,current}=useStaffRequest(authority);
  const t=(key:ReportTextKey)=>reportText(language,key);
  const historyHeading=useRef<HTMLHeadingElement>(null);
  const [filters,setFilters]=useState({search:'',from:'',through:''}),[page,setPage]=useState(1),[tick,setTick]=useState(0);
  const [data,setData]=useState<PublicationPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setData(null);setError('');
    void request<PublicationPage>(`/api/reports/publications?${new URLSearchParams({...filters,page:String(page),pageSize:'20'})}`,undefined,controller.signal)
      .then(value=>{if(current() && !controller.signal.aborted)setData(value);})
      .catch((err:Error)=>{if(current() && !controller.signal.aborted)setError(err.message);})
      .finally(()=>{if(current() && !controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[filters,page,tick,request,current]);
  const pages=Math.max(1,Math.ceil((data?.total || 0)/20));
  const changePage=(next:number)=>{historyHeading.current?.focus();setPage(next);};
  const date=(value:string)=>{const stamp=reportTimestamp(language,value,data?.timezone||'UTC');return <time dateTime={value}><bdi>{stamp.text}</bdi> <bdi dir="ltr">{stamp.offset}</bdi></time>;};
  return <section className="report-publication-history" aria-label={t('Publication history')} aria-busy={loading}>
    <div className="people-panel-heading"><h2 ref={historyHeading} tabIndex={-1}>{t('Publication history')}</h2><button className="icon-button" title={t('Refresh publication history')} aria-label={t('Refresh publication history')} disabled={loading || disabled} onClick={()=>{historyHeading.current?.focus();setTick(value=>value+1);}}><RefreshCw size={18}/></button></div>
    <form className="filters" onSubmit={event=>{event.preventDefault();const values=new FormData(event.currentTarget);changePage(1);setFilters({search:String(values.get('search') || ''),from:String(values.get('from') || ''),through:String(values.get('through') || '')});}}>
      <label className="select-label">{t('Title')}<input name="search" type="search" maxLength={120} disabled={disabled} dir="auto"/></label>
      <label className="select-label">{t('Published from')}<input name="from" type="date" disabled={disabled}/></label>
      <label className="select-label">{t('Published through')}<input name="through" type="date" disabled={disabled}/></label>
      <button className="icon-button" type="submit" aria-label={t('Apply publication filters')} title={t('Apply publication filters')} disabled={disabled}><Search size={20}/></button>
    </form>
    {data && <p className="muted"><bdi>{data.timezone}</bdi> · {reportText(language,'{count} published versions',{count:data.total})}</p>}
    {loading ? <p role="status">{t('Loading publication history...')}</p> : error ? <p role="alert" className="record-error">{reportErrorText(language,error,'Publication history could not be loaded. Refresh to try again.')}</p> : <>
      <ul className="report-publication-list">{data?.items.map(item=><li key={item.id}><button className="publication-choice" disabled={disabled} onClick={()=>onSelect(item.id)}><FileText size={20}/><span><strong><bdi>{item.title}</bdi> · {reportText(language,'Published v{version}',{version:item.version})}</strong><small>{reportState(language,item.state)} · {date(item.publishedAt)}</small></span>{language==='en'?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></li>)}</ul>
      {!data?.items.length && <p>{t(page>pages?'This page is no longer available.':'No published versions match these filters.')}</p>}
      {data && <div className="audit-pagination"><span>{reportText(language,'Page {page} of {pages}',{page,pages})}</span><div className="actions"><button className="icon-button" aria-label={t('Previous publication page')} title={t('Previous publication page')} disabled={disabled || page<=1} onClick={()=>changePage(page-1)}>{language==='en'?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}</button><button className="icon-button" aria-label={t('Next publication page')} title={t('Next publication page')} disabled={disabled || page>=pages} onClick={()=>changePage(page+1)}>{language==='en'?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button>{page>pages && <button className="button outline" disabled={disabled} onClick={()=>changePage(1)}>{t('First page')}</button>}</div></div>}
    </>}
  </section>;
}

export function ReportsPage({refresh,authority,language='en',onLanguageChange}:{refresh:number;authority:StaffRequestAuthority;language?:ReportLocale;onLanguageChange?:(language:ReportLocale)=>void}) {
  const {request,current}=useStaffRequest(authority);
  const locale=reportLocale(language),t=(key:ReportTextKey)=>reportText(locale,key);
  const allowed=definition.roles!.includes(authority.session.staffRole || ''),scope=allowed?authority.session.staffScope:null;
  const canExport=allowed && authority.session.siteState!=='archived';
  const [recovery]=useState(()=>{try{return {pending:scope?readPendingExport(sessionStorage,checkedArtifactScope(scope,authority.session,definition.roles)):null,error:''};}catch(reason){return {pending:null,error:(reason as Error).message};}});
  const [publicationId, setPublicationId] = useState('');
  const [filters,setFilters]=useState<ReportFilters>({crewId:'',responseFrom:'',responseThrough:''});
  const [chosenFilters,setChosenFilters]=useState<ReportFilters>({crewId:'',responseFrom:'',responseThrough:''});
  const [report, setReport] = useState<Report | null>(null);
  const [exports, setExports] = useState<Export[]>([]);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportLoading,setExportLoading]=useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<ReportTextKey|null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [reportRefresh,setReportRefresh]=useState(0);
  const historyTrigger=useRef<HTMLButtonElement>(null);
  const operation=useArtifactMutation(authority,scope,definition,savePendingExport,canExport,(_result,pending)=>{
    setMessage(pending.kind==='create'?'Export request accepted. Check export history for its current status.':'Export retry accepted. Check export history for its current status.');
    setHistoryRefresh(value=>value+1);
  },recovery.pending);
  const {busy}=operation;
  useEffect(()=>{
    if(!recovery.pending)return;
    const controller=new AbortController();queueMicrotask(()=>{if(!controller.signal.aborted)void operation.check(controller.signal);});
    return()=>controller.abort();
  },[operation.api,recovery.pending]);
  useEffect(() => {
    const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;
    setReport(null);setLoading(true); setError('');
    request<Report>(`/api/reports?${new URLSearchParams({...filters,...(publicationId?{publicationId}:{})})}`,undefined,controller.signal)
      .then((data) => { if (live()) setReport(data); })
      .catch((err: Error) => { if (live()) setError(err.message); })
      .finally(() => { if (live()) setLoading(false); });
    return () => controller.abort();
  }, [publicationId, refresh,filters,reportRefresh,request,current]);
  useEffect(() => {
    const controller=new AbortController(),live=()=>current() && !controller.signal.aborted;
    let timer: number;
    setExportLoading(true);setExports([]);setExportError('');
    const load = async () => {
      try {
        const value=await request<unknown>('/api/reports/exports',undefined,controller.signal);
        if(!Array.isArray(value) || value.length>50)throw Error('Export history cannot be verified.');
        const rows=value.map(checkedExportRow);
        if (!live()) return;
        setExports(rows); setExportError('');
        timer = window.setTimeout(load, rows.some((row) => ['queued', 'processing'].includes(row.status)) ? 1500 : 60_000);
      } catch (err) { if (live()) { setExports([]);setExportError((err as Error).message); timer = window.setTimeout(load, 60_000); } }
      finally{if(live())setExportLoading(false);}
    };
    void load();
    return () => { controller.abort();window.clearTimeout(timer); };
  }, [refresh, historyRefresh,request,current]);
  const exportReport = async () => {
    if(!report?.publicationId || operation.pending.current || recovery.error || !canExport || !current())return;
    setMessage(null);await operation.write({kind:'create',requestId:crypto.randomUUID(),exportId:null,body:{publicationId:report.publicationId,filters:structuredClone(filters)}});
  };
  const retry = async (row: Export) => {
    if(operation.pending.current || recovery.error || !canExport || !current())return;
    setMessage(null);await operation.write({kind:'retry',requestId:crypto.randomUUID(),exportId:row.id,body:{attempts:row.attempts}});
  };
  const date=(value:string,timezone=report?.timezone||'UTC')=>{const stamp=reportTimestamp(locale,value,timezone);return <time dateTime={value}><bdi>{stamp.text}</bdi> <bdi dir="ltr">{stamp.offset}</bdi></time>;};
  const m = report?.metrics;
  const windowed=Boolean(filters.responseFrom || filters.responseThrough);
  const width = (count: number) => `${m?.assigned ? count / m.assigned * 100 : 0}%`;
  return <>
    <div className="page-header report-header"><div><h1>{t('Instruction activity')}</h1><p>{report?.title ? <><bdi>{report.title}</bdi> · {reportText(locale,'Published v{version}',{version:report.version})}</> : t('Response activity at this site')}</p></div>
      <div className="actions">{onLanguageChange&&<CaseLocalePicker locale={locale} onChange={onLanguageChange}/>}<button className="button primary" onClick={() => void exportReport()} disabled={loading || busy || !m || !canExport || !!operation.pending.current || !!recovery.error}><Download size={18} />{t(busy?'Working...':'Export CSV')}</button></div>
    </div>
    {report?.publicationId && <p className="report-mode"><span><strong>{t('Response mode')}:</strong> {report.responseMode==='acknowledge'?t('Acknowledge only'):report.responseMode==='question'?t('Question'):t('Mode not recorded (legacy)')}</span><span><strong>{t('Delivery mode')}:</strong> {report.deliveryMode==='text'?t('Text'):report.deliveryMode==='voice'?t('Voice'):report.deliveryMode==='both'?t('Text and voice'):t('Mode not recorded (legacy)')}</span></p>}
    <div className="filters"><button ref={historyTrigger} className="button outline" disabled={busy} aria-expanded={historyOpen} aria-controls="report-publication-history" onClick={()=>setHistoryOpen(value=>!value)}><History size={18}/>{t('Instruction version')}<ChevronDown size={18}/></button>
      {report?.asOf && <span className="report-date">{date(report.asOf)} · <bdi>{report.timezone}</bdi></span>}</div>
    {historyOpen && <div id="report-publication-history"><PublicationHistory language={locale} authority={authority} disabled={busy} onSelect={id=>{if(!current())return;setPublicationId(id);setFilters(value=>({...value,crewId:''}));setChosenFilters(value=>({...value,crewId:''}));setHistoryOpen(false);historyTrigger.current?.focus();}}/></div>}
    <form className="filters report-scope-filters" onSubmit={event=>{event.preventDefault();if(!busy && !loading)setFilters({...chosenFilters});}}>
      <label className="select-label">{t('Crew at publication')}<select value={chosenFilters.crewId} disabled={busy || loading || !report?.crewSnapshotAvailable} onChange={event=>setChosenFilters(value=>({...value,crewId:event.target.value}))}><option value="">{t('All assigned workers')}</option>{report?.availableCrews?.map(crew=><option key={crew.id} value={crew.id}>{crew.name}</option>)}{report?.crewSnapshotAvailable && <option value="@unassigned">{t('No crew')}</option>}</select></label>
      <label className="select-label">{t('Latest response from')}<input type="date" value={chosenFilters.responseFrom} disabled={busy || loading || !report?.filters} onChange={event=>setChosenFilters(value=>({...value,responseFrom:event.target.value}))}/></label>
      <label className="select-label">{t('Latest response through')}<input type="date" min={chosenFilters.responseFrom || undefined} value={chosenFilters.responseThrough} disabled={busy || loading || !report?.filters} onChange={event=>setChosenFilters(value=>({...value,responseThrough:event.target.value}))}/></label>
      <button className="icon-button" type="submit" aria-label={t('Apply report filters')} title={t('Apply report filters')} disabled={busy || loading || !report?.filters}><Search size={20}/></button>
      <button className="icon-button" type="button" aria-label={t('Clear report filters')} title={t('Clear report filters')} disabled={busy || loading} onClick={()=>{const empty={crewId:'',responseFrom:'',responseThrough:''};setChosenFilters(empty);setFilters(empty);}}><RefreshCw size={18}/></button>
    </form>
    {report?.filters && !report.crewSnapshotAvailable && <p className="muted">{t('Historical crew snapshot unavailable for this version.')}</p>}
    {windowed && <p className="report-date">{t('Latest-response window')}: <bdi dir="ltr">{filters.responseFrom||t('Start')}</bdi> {t('to')} <bdi dir="ltr">{filters.responseThrough||t('Present')}</bdi> · <bdi>{report?.timezone}</bdi></p>}
    {loading ? <p role="status">{t('Loading report...')}</p> : error ? <div className="actions"><p role="alert" className="record-error">{reportErrorText(locale,error,'The report could not be loaded. Try again.')}</p><button className="icon-button" title={t('Retry report')} aria-label={t('Retry report')} disabled={busy} onClick={()=>setReportRefresh(value=>value+1)}><RefreshCw size={18}/></button></div> : !m ? <p>{t('No published instruction is available.')}</p> : <>
      {report?.delivery && <section className="panel report-delivery" aria-label={t('Delivery')}>
        <div className="people-panel-heading"><h2>{t('Delivery')}</h2><span className={`status status-${report.delivery.state==='published'?'green':report.delivery.state==='failed'?'red':'blue'}`}>{reportState(locale,report.delivery.state)}</span></div>
        <div className="delivery-counts"><div><strong>{report.delivery.captured}</strong><span>{t('Captured audience')}</span></div><div><strong>{report.delivery.delivered}</strong><span>{t('Delivered')}</span></div><div><strong>{report.delivery.undelivered}</strong><span>{t('Not delivered')}</span></div></div>
        {report.delivery.undelivered>0 && <p className="muted">{[report.delivery.states.preparing>0?`${report.delivery.states.preparing} ${t('Preparing')}`:'',report.delivery.states.blocked>0?`${report.delivery.states.blocked} ${t('Blocked')}`:'',report.delivery.states.failed>0?`${report.delivery.states.failed} ${t('Failed')}`:''].filter(Boolean).join(' · ')}</p>}
        <p className="muted">{t('Unreleased recipients are not counted as failing to respond.')}</p>
      </section>}
      <div className="metrics">{[
        { icon: FileText, value: m.assigned, label: t('assigned') }, { icon: Users, value: m.responses, label: t('responses') },
        { icon: CheckCircle2, value: m.matches, label: t('match key facts') }, { icon: TriangleAlert, value: m.clarifications, label: t('need clarification') },
        ...(m.acknowledged ? [{ icon: CheckCircle2, value: m.acknowledged, label: t('acknowledged') }] : []),
        ...(m.resolved ? [{ icon: MessageCircleCheck, value: m.resolved, label: t('resolved after follow-up') }] : []),
        { icon: Clock3, value: m.pending, label: t(windowed?'no response in window':'awaiting response') },
      ].map(({ icon: Icon, value, label }, index) => <div className={`metric ${index === 3 ? 'metric-warn' : ''}`} key={label}><div className="metric-icon"><Icon size={28} /></div><div><strong>{value}</strong><span>{label}</span></div></div>)}</div>
      <section className="panel"><h2>{t('Response status')}</h2><div className="report-bar"><span style={{ width: width(m.matches) }} /><span style={{ width: width(m.clarifications) }} /><span style={{ width: width(m.unassessed) }} /><span style={{ width: width(m.pending) }} />{!!m.acknowledged && <span style={{ width: width(m.acknowledged),background:'#7c5cff' }} />}</div>
        <div className="report-bottom"><div className="legend"><span><i className="dot green" />{m.matches} {t('match the rubric')}</span><span><i className="dot amber" />{m.clarifications} {t('need clarification')}</span><span><i className="dot blue" />{m.unassessed} {t('awaiting assessment')}</span>{!!m.acknowledged && <span><i className="dot violet" />{m.acknowledged} {t('acknowledged, not assessed')}</span>}<span><i className="dot grey" />{m.pending} {t(windowed?'no response in window':'awaiting response')}</span></div><strong>{m.completion}% <small>{t('response completion')}</small></strong></div>
      </section>
    </>}
    {message && <p role="status">{t(message)}</p>}
    {recovery.error && <p role="alert" className="record-error">{reportErrorText(locale,recovery.error,'Saved export request cannot be verified. It has not been repeated or removed.')}</p>}
    {operation.error && <p role="alert" className="record-error">{reportErrorText(locale,operation.error,operation.pending.current?'The export outcome is not confirmed. Check the saved request before retrying.':'The export request could not be completed.')}</p>}
    {operation.pending.current && <section className="report-export-recovery" aria-label={t('Saved export request')}>
      <h2>{t(operation.pending.current.kind==='create'?'Recover export request':'Recover export retry')}</h2>
      <p>{t('Original request')}: <bdi dir="ltr">{operation.pending.current.requestId}</bdi></p>
      {operation.pending.current.kind==='create' ? <>
        <p>{t('Published version')}: <bdi dir="ltr">{String(operation.pending.current.body.publicationId)}</bdi></p>
        <p>{t('Crew')}: <bdi>{(operation.pending.current.body.filters as ReportFilters).crewId==='@unassigned'?t('No crew'):String((operation.pending.current.body.filters as ReportFilters).crewId||t('All assigned workers'))}</bdi> · {t('Latest responses')}: <bdi dir="ltr">{String((operation.pending.current.body.filters as ReportFilters).responseFrom||t('Start'))}</bdi> {t('to')} <bdi dir="ltr">{String((operation.pending.current.body.filters as ReportFilters).responseThrough||t('Present'))}</bdi></p>
      </> : <><p>{t('Export')}: <bdi dir="ltr">{operation.pending.current.exportId}</bdi></p><p>{t('Original failed attempt')}: {String(operation.pending.current.body.attempts)}</p></>}
      <div className="actions"><button className="button outline" disabled={busy} onClick={()=>void operation.check()}><RefreshCw size={18}/>{t('Check saved request')}</button>{operation.checked && <button className="button primary" disabled={busy || !canExport} onClick={()=>void operation.write(operation.pending.current!)}><RefreshCw size={18}/>{t('Retry original request')}</button>}</div>
    </section>}
    <div className="report-grid">
      {m && <section className="panel"><h2>{t('Language breakdown')}</h2><div className="table-wrap"><table className="language-table"><thead><tr><th>{t('Assignment language')}</th><th>{t('Assigned')}</th><th>{t('Received')}</th><th>{t('Completion')}</th></tr></thead><tbody>{report.languages.map((row) => <tr key={row.language}><td><bdi>{reportLanguage(locale,row.language)}</bdi></td><td>{row.assigned}</td><td>{row.received}</td><td><div className="language-completion"><span>{row.completion}%</span><meter min="0" max="100" value={row.completion} aria-label={reportText(locale,'{language} response completion',{language:reportLanguage(locale,row.language)})} /></div></td></tr>)}</tbody></table></div></section>}
      <section className="panel export-history"><div className="people-panel-heading"><h2>{t('Export history')}</h2><button className="icon-button" title={t('Refresh exports')} aria-label={t('Refresh exports')} disabled={exportLoading} onClick={() => setHistoryRefresh((value) => value + 1)}><RefreshCw size={18} /></button></div>
        {exportLoading?<p role="status">{t('Loading export history...')}</p>:exportError?<p role="alert" className="record-error">{reportErrorText(locale,exportError,'Export history cannot be verified.')}</p>:!exports.length ? <p>{t('No exports requested.')}</p> : <ul className="export-list">{exports.map((item) => <li key={item.id}><FileText size={24} /><div className="export-info"><strong><bdi dir="ltr">{item.filename}</bdi></strong><span className={`status status-${item.status === 'ready' ? 'green' : item.status === 'failed' ? 'red' : 'blue'}`}>{reportState(locale,item.status)}</span><small>{date(item.createdAt,item.filters?.timezone||report?.timezone)}</small>{(item.filters?.responseFrom || item.filters?.responseThrough) && <small>{t('Latest responses')}: <bdi dir="ltr">{item.filters.responseFrom||t('Start')}</bdi> {t('to')} <bdi dir="ltr">{item.filters.responseThrough||t('Present')}</bdi> · <bdi>{item.filters.timezone||report?.timezone}</bdi></small>}{item.filters?.crewId && <small>{t('Crew-filtered audience')}</small>}{item.status === 'ready' && <small>{t('Expires')} {date(item.expiresAt,item.filters?.timezone||report?.timezone)}</small>}{item.error && <small>{reportErrorText(locale,item.error,'Export generation failed')}</small>}</div>
          {item.status === 'ready' && <a className="button outline" href={`/api/reports/exports/${item.id}/download`} download={item.filename}><Download size={16} />{t('Download')}</a>}
          {item.status === 'failed' && item.attempts < 3 && <button className="button outline" disabled={busy || !canExport || !!operation.pending.current || !!recovery.error} onClick={() => void retry(item)}><RefreshCw size={16} />{t('Retry')}</button>}
        </li>)}</ul>}
      </section>
    </div>
    <div className="notice"><TriangleAlert size={22} /><span>{t('Response status is not proof of safe work or internal understanding.')}</span></div>
  </>;
}
