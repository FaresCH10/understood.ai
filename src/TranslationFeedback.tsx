import {useStaffText as useStaffStaticText} from './staff-language';
import {useState,type FormEvent} from 'react';
import {MessageCircle,Send} from 'lucide-react';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';

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
