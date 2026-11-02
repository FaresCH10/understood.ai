import {useStaffText as useStaffStaticText} from './staff-language';
import {useState,type FormEvent} from 'react';
import {ChevronLeft,ChevronRight,MessageCircle,RefreshCw,Send} from 'lucide-react';
import {useArtifactRead} from './useArtifactRead';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';

type Feedback={id:string;publicationId:string;briefingId:string;briefingTitle:string;publicationState:string;publicationVersion:number;
  language:string;field:string;note:string;status:string;reporter:string;createdAt:string;resolvedBy:string;resolvedAt:string|null;
  resolutionNote:string;translation:string};
type FeedbackPage={items:Feedback[];total:number;page:number;pageSize:number};
type Status='open'|'resolved'|'dismissed'|'all';
type ReportProps={authority:StaffRequestAuthority;publicationId:string;language:string;field:string;disabled?:boolean};

export function TranslationFeedbackReport({authority,publicationId,language,field,disabled=false}:ReportProps) {
  const staffT=useStaffStaticText();
  const {request,current}=useStaffRequest(authority);
  const [open,setOpen]=useState(false),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false);
  async function submit(event:FormEvent) {
    event.preventDefault();
    if(busy || !current() || note.trim().length<3) return;
    setBusy(true);setError('');
    try {
      await request('/api/translation-feedback',{requestId:crypto.randomUUID(),publicationId,language,field,note:note.trim()});
      if(current()){setSent(true);setOpen(false);setNote('');}
    } catch(reason) {if(current())setError((reason as Error).message);}
    finally {if(current())setBusy(false);}
  }
  if(sent) return <p className="translation-feedback-sent" role="status">{staffT("Feedback sent for review.")}</p>;
  if(!open) return <div className="translation-feedback-report"><button type="button" className="button subtle" disabled={disabled} onClick={()=>setOpen(true)}><MessageCircle size={18}/>{staffT("Report translation issue")}</button>{error && <p role="alert" className="record-error">{staffT.error(error)}</p>}</div>;
  return <form className="translation-feedback-report" onSubmit={event=>void submit(event)}>
    <h3>{staffT("Report translation issue")}</h3>
    <p className="muted">{staffT("Describe what is wrong with this translation so a supervisor can review it.")}</p>
    <label className="field">{staffT("What is wrong?")}<textarea autoFocus required minLength={3} maxLength={1000} rows={3} value={note} disabled={busy} onChange={event=>setNote(event.target.value)}/></label>
    {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
    <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={()=>{setOpen(false);setError('');}}>{staffT("Cancel")}</button><button type="submit" className="button primary" disabled={busy || note.trim().length<3}><Send size={18}/>{busy?staffT("Sending..."):staffT("Send feedback")}</button></div>
  </form>;
}

function Decision({authority,item,onDecided}:{authority:StaffRequestAuthority;item:Feedback;onDecided:(message:string)=>void}) {
  const staffT=useStaffStaticText();
  const {request,current}=useStaffRequest(authority);
  const [note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function decide(action:'resolved'|'dismissed') {
    if(busy || !current()) return;
    setBusy(true);setError('');
    try {await request(`/api/translation-feedback/${encodeURIComponent(item.id)}/decision`,{action,note});if(current())onDecided(action==='resolved'?staffT("Feedback marked resolved."):staffT("Feedback dismissed."));}
    catch(reason){if(current())setError((reason as Error).message);}
    finally{if(current())setBusy(false);}
  }
  return <div className="translation-feedback-decision">
    <label className="field">{staffT("Review note (optional)")}<textarea rows={2} maxLength={1000} value={note} disabled={busy} onChange={event=>setNote(event.target.value)}/></label>
    {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
    <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={()=>void decide('dismissed')}>{staffT("Dismiss")}</button><button type="button" className="button primary" disabled={busy} onClick={()=>void decide('resolved')}><MessageCircle size={18}/>{staffT("Mark resolved")}</button></div>
  </div>;
}

export function TranslationFeedbackPage({authority,refresh,canManage}:{authority:StaffRequestAuthority;refresh:number;canManage:boolean}) {
  const staffT=useStaffStaticText();
  const [status,setStatus]=useState<Status>('open'),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[message,setMessage]=useState('');
  const {data,loading,error}=useArtifactRead<FeedbackPage>(authority,`/api/translation-feedback?${new URLSearchParams({status,page:String(page),pageSize:'20'})}`,refresh+revision);
  const pages=Math.max(1,Math.ceil((data?.total || 0)/20));
  const tabs:Status[]=['open','resolved','dismissed','all'];
  return <section className="translation-feedback-page"><div className="page-header"><div><h1>{staffT("Translation feedback")}</h1><p>{staffT("Reported translation issues from published instructions.")}</p></div><button type="button" className="icon-button" title={staffT("Refresh translation feedback")} aria-label={staffT("Refresh translation feedback")} disabled={loading} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={18}/></button></div>
    {message && <p className="notice notice-green" role="status">{staffT.message(message)}</p>}
    <nav className="briefing-status-tabs" aria-label={staffT("Translation feedback views")}>{tabs.map(value=><button key={value} type="button" aria-pressed={status===value} onClick={()=>{setStatus(value);setPage(1);}}>{staffT(value==='all'?'All':value[0].toUpperCase()+value.slice(1))}</button>)}</nav>
    {error && <p role="alert" className="record-error">{staffT.error(error)}</p>}
    {loading ? <p role="status">{staffT("Loading translation feedback...")}</p> : data?.items.length ? <div className="translation-feedback-list">{data.items.map(item=><article className="panel translation-feedback-card" key={item.id}>
      <div className="translation-feedback-head"><div><h2>{item.briefingTitle}</h2><span className="template-chips"><i>{staffT.language(item.language)}</i><i>{staffT(item.field==='text'?'Instruction':item.field[0].toUpperCase()+item.field.slice(1))}</i><i>{staffT(item.status[0].toUpperCase()+item.status.slice(1))}</i></span></div><small>{staffT.date(item.createdAt)}</small></div>
      {item.translation && <blockquote className="translation-feedback-text" lang={item.language} dir={['ar','ur','fa','he'].includes(item.language)?'rtl':'ltr'}>{item.translation}</blockquote>}
      <p><strong>{staffT("Reported issue")}:</strong> {item.note}</p>
      <p className="muted">{staffT("Reported by {name}",{name:item.reporter || staffT("Unknown staff member")})}{item.publicationState!=='published'?` · ${staffT("Version state")}: ${staffT(item.publicationState)}`:''}</p>
      {item.status!=='open' && <p className="muted">{staffT("Resolved by {name}",{name:item.resolvedBy || staffT("Unknown staff member")})} · {item.resolvedAt?staffT.date(item.resolvedAt):''}{item.resolutionNote?` · ${item.resolutionNote}`:''}</p>}
      {item.status==='open' && (canManage ? <Decision authority={authority} item={item} onDecided={value=>{setMessage(value);setRevision(n=>n+1);}}/> : <p className="muted">{staffT("Only an owner or supervisor can resolve feedback.")}</p>)}
    </article>)}</div> : <p className="empty-state">{staffT(status==='open'?"No open translation feedback.":"No translation feedback matches this view.")}</p>}
    {data && data.total>0 && <div className="audit-pagination"><span>{staffT("Page")} {staffT.number(page)} {staffT("of")} {staffT.number(pages)} · {staffT.number(data.total)}</span><button type="button" className="icon-button" aria-label={staffT("Previous translation feedback")} title={staffT("Previous translation feedback")} disabled={loading || page<=1} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={18}/></button><button type="button" className="icon-button" aria-label={staffT("Next translation feedback")} title={staffT("Next translation feedback")} disabled={loading || page>=pages} onClick={()=>setPage(value=>value+1)}><ChevronRight size={18}/></button></div>}
  </section>;
}
