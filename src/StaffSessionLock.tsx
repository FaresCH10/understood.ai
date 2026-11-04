import {BrandLogo} from './BrandLogo';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,LogIn,RefreshCw,ShieldAlert} from 'lucide-react';
import {staffIdentityLabel,staffSessionText,type PageSession} from './session-state';
import {fetchBootstrapSession} from './worker-offline';
import {recheckStaffSession,confirmStaffSession,type StaffSessionObservation} from './staff-session-recovery';

export function StaffSessionLock({session,onVerified,uiLanguage}:{session:PageSession;onVerified:(value:PageSession)=>void;uiLanguage?:'en'|'ar'|'ur'}) {
  const language=uiLanguage || (session.language==='ar' || session.language==='ur'?session.language:'en'),t=staffSessionText[language];
  const [observed,setObserved]=useState<StaffSessionObservation|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null),controller=useRef<AbortController|null>(null),inFlight=useRef(false);
  useEffect(()=>{heading.current?.focus();return()=>controller.current?.abort();},[]);
  async function check(open=false) {
    if(inFlight.current || open && (!observed || observed.kind==='worker' || observed.kind==='different' && !confirmed))return;
    inFlight.current=true;setBusy(true);setError('');const abort=new AbortController();controller.current=abort;
    const current=()=>!abort.signal.aborted && !!heading.current?.isConnected;
    const read=()=>fetchBootstrapSession(fetch,abort.signal);
    try {
      if(open && observed && observed.kind!=='worker') {
        const verified=await confirmStaffSession(observed.session,read,current);if(current())onVerified(verified);
      }else {
        setObserved(null);setConfirmed(false);const result=await recheckStaffSession(session,read,current);if(current())setObserved(result);
      }
    }catch {if(current()){setObserved(null);setConfirmed(false);setError(t.unavailable);}}
    finally {inFlight.current=false;if(current())setBusy(false);}
  }
  const label=(value:unknown,role=false)=>staffIdentityLabel(value,language,role);
  const active=observed && (observed.kind==='same' || observed.kind==='different')?observed.session:null;
  return <main className="entry-page staff-session-lock" lang={language} dir={language==='en'?'ltr':'rtl'}><span className="brand"><BrandLogo/></span><section className="staff-session-lock-content" role="alert"><ShieldAlert className="session-lock-icon" size={40}/><h1 ref={heading} tabIndex={-1}>{t.title}</h1><p>{t.body}</p><p className="muted">{t.next}</p>
    <button className="button primary full" disabled={busy} onClick={()=>void check()}><RefreshCw size={18}/>{busy?t.checking:t.check}</button>
    {error && <p role="alert">{error}</p>}
    {observed && <div className="staff-session-observation"><p role="status">{t[observed.kind]}</p>{active && <dl><dt>{t.account}</dt><dd dir="auto">{label(active.name)}</dd><dt>{t.organization}</dt><dd dir="auto">{label(active.organization)}</dd><dt>{t.site}</dt><dd dir="auto">{label(active.site)}</dd><dt>{t.role}</dt><dd>{label(active.staffRole,true)}</dd></dl>}
      {observed.kind==='different' && <label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>{t.confirm}</span></label>}
      {observed.kind==='worker'?<button className="button outline full" disabled={busy} onClick={()=>location.reload()}><RefreshCw size={18}/>{t.reload}</button>:<button className="button outline full" disabled={busy || observed.kind==='different' && !confirmed} onClick={()=>void check(true)}>{observed.kind==='guest'?<LogIn size={18}/>:<ArrowRight size={18}/>} {observed.kind==='guest'?t.signIn:observed.kind==='same'?t.resume:t.open}</button>}
    </div>}
  </section></main>;
}
