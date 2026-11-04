import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowLeft,CheckCircle2,KeyRound,LogIn,LogOut,Mail,RefreshCw,ShieldCheck} from 'lucide-react';
import {acceptanceHash,readPendingAcceptance,savePendingAcceptance,clearPendingAcceptance,checkedInvitationPreview,checkedAcceptanceResult,type InvitationPreview,type PendingAcceptance} from './invitation-recovery';
type Identity={authenticated:boolean;role?:'staff'|'worker';name?:string;site?:string};
const roles:Record<string,string>={owner:'Owner',administrator:'Administrator',supervisor:'Supervisor',auditor:'Read-only auditor'};
class AcceptanceError extends Error {constructor(message:string,public status:number){super(message);}}
async function post(path:string,body:unknown) {
  let response:Response,value;
  try {response=await fetch(`/api${path}`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(body)});value=await response.json();}
  catch {throw new Error('The result could not be confirmed. Check your account or retry the unchanged acceptance.');}
  if(!response.ok) throw new AcceptanceError(value.error || 'Invitation unavailable.',response.status);return value;
}
export function AcceptInvitation({token,identity,onBack,onIdentityChanged,onOpenSite}:{token:string;identity:Identity;onBack:()=>void;onIdentityChanged:()=>Promise<void>;onOpenSite:(staffId:string)=>Promise<unknown>}) {
  const [preview,setPreview]=useState<InvitationPreview|null>(null),[hash,setHash]=useState(''),[pending,setPending]=useState<PendingAcceptance|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[kind,setKind]=useState<'signup'|'existing'>('signup'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[confirmed,setConfirmed]=useState(false),[completed,setCompleted]=useState<{staffId:string;signInRequired:boolean}|null>(null);
  const heading=useRef<HTMLHeadingElement>(null),sending=useRef(false);
  useEffect(()=>{heading.current?.focus();},[completed]);
  useEffect(()=>{let current=true;setLoading(true);setError('');
    (async()=>{
      if(!token) throw new Error('This invitation link is unavailable. Reopen the original email link, or ask the inviter for a new invitation.');
      const key=await acceptanceHash(token),saved=readPendingAcceptance(sessionStorage,key);
      const details=saved?.preview || checkedInvitationPreview(await post('/auth/invitations/preview',{token}));
      if(current) {setHash(key);setPending(saved);setKind(saved?.kind || (identity.authenticated ? 'existing' : 'signup'));setPreview(details);}
    })().catch(err=>{if(current) setError(err.message);}).finally(()=>{if(current) {setLoading(false);heading.current?.focus();}});return()=>{current=false;};
  },[token]);
  async function accept(event:FormEvent) {
    event.preventDefault();if(!preview || !hash || !confirmed || sending.current) return;setError('');
    if(kind==='signup' && (identity.authenticated || password!==confirmation)) {setError(identity.authenticated ? 'Sign out before creating an account.' : 'The passwords do not match.');return;}
    if(kind==='existing' && (!identity.authenticated || identity.role!=='staff')) {setError('Sign in with the invited staff email first.');return;}
    sending.current=true;setBusy(true);
    const value=pending || {requestId:crypto.randomUUID(),kind,preview};
    try {
      savePendingAcceptance(sessionStorage,hash,value);setPending(value);
      const result=checkedAcceptanceResult(await post(`/auth/invitations/${value.kind==='signup' ? 'signup' : 'accept'}`,{requestId:value.requestId,token,...(value.kind==='signup' ? {password,confirmation} : {})}),value.kind);
      clearPendingAcceptance(sessionStorage,hash,value.requestId);setPending(null);setPassword('');setConfirmation('');setCompleted(result);
      if(result.signInRequired) await onIdentityChanged();
    }catch(err) {
      if(value.kind==='signup' && err instanceof AcceptanceError && err.status===401 && err.message==='Sign in to accept this invitation') {
        try {clearPendingAcceptance(sessionStorage,hash,value.requestId);setPending(null);setKind('existing');setPassword('');setConfirmation('');setConfirmed(false);}catch {}
      }
      setError((err as Error).message);
    }finally {sending.current=false;setBusy(false);}
  }
  async function signIn(event:FormEvent) {
    event.preventDefault();if(sending.current) return;sending.current=true;setBusy(true);setError('');
    try {const result=await post('/auth/staff/login',{email,password});if(result.ok!==true) throw new Error('Sign-in could not be verified.');await onIdentityChanged();setPassword('');setConfirmation('');setConfirmed(false);}
    catch(err) {setError((err as Error).message);}finally {sending.current=false;setBusy(false);}
  }
  async function signOut() {
    if(sending.current) return;sending.current=true;setBusy(true);setError('');
    try {const result=await post('/logout',{});if(result.ok!==true) throw new Error('Sign-out could not be verified.');
      for(const key of Object.keys(sessionStorage)) if(key.startsWith('understood:') && key!==`understood:invitation-accept:${hash}`) sessionStorage.removeItem(key);
      await onIdentityChanged();setPassword('');setConfirmation('');setConfirmed(false);
    }catch(err) {setError((err as Error).message);}finally {sending.current=false;setBusy(false);}
  }
  async function openSite() {if(!completed || busy) return;setBusy(true);setError('');try {await onOpenSite(completed.staffId);}catch {setError('The selected site could not be verified. Recheck your account before continuing.');}finally {setBusy(false);}}
  return <section className="account-recovery invitation-accept"><button className="button subtle" disabled={busy} onClick={onBack}><ArrowLeft size={18}/>{identity.authenticated ? 'Back to my account' : 'Back to sign in'}</button><div className="account-recovery-icon">{completed ? <CheckCircle2 size={30}/> : <Mail size={30}/>}</div><h1 ref={heading} tabIndex={-1}>{completed ? 'Invitation accepted' : 'Accept invitation'}</h1>
    {loading ? <p data-page-loading role="status">Checking invitation...</p> : completed ? <><p role="status">{completed.signInRequired ? 'Your account was created. Sign in with the invited email and your password.' : `Your ${roles[preview!.role]} access at ${preview!.site} has been added. Your current site has not changed.`}</p>{!completed.signInRequired && <button className="button primary full" disabled={busy} onClick={()=>void openSite()}><ShieldCheck size={18}/>Open {preview?.site}</button>}<button className="button outline full" disabled={busy} onClick={onBack}><ArrowLeft size={18}/>{completed.signInRequired ? 'Sign in' : 'Back to my account'}</button></> : preview && <>
      <dl className="invitation-summary"><dt>Organization</dt><dd dir="auto">{preview.organization}</dd><dt>Site</dt><dd dir="auto">{preview.site}</dd><dt>Name</dt><dd dir="auto">{preview.name}</dd><dt>Role</dt><dd>{roles[preview.role]}</dd><dt>Invited email</dt><dd dir="ltr">{preview.emailHint}</dd></dl>
      {pending ? (!busy && <p role="status">A previous acceptance could not be confirmed. Retry the same request to check its result.</p>) : <><p>Expires {new Date(preview.expiresAt).toLocaleString()}</p>{!identity.authenticated && <div className="segmented-control invitation-modes" role="group" aria-label="Account choice"><button aria-pressed={kind==='signup'} disabled={busy} onClick={()=>{setKind('signup');setPassword('');setConfirmation('');setConfirmed(false);setError('');}}>New account</button><button aria-pressed={kind==='existing'} disabled={busy} onClick={()=>{setKind('existing');setPassword('');setConfirmation('');setConfirmed(false);setError('');}}>Existing account</button></div>}</>}
      {identity.authenticated && <div className="notice notice-blue"><ShieldCheck size={20}/><span>Signed in as {identity.name || 'a staff member'} at {identity.site || 'the current site'}.<button className="button subtle" disabled={busy} onClick={()=>void signOut()}><LogOut size={16}/>Use another account</button></span></div>}
      {kind==='existing' && !identity.authenticated ? <form className="entry-form" onSubmit={event=>void signIn(event)}><label className="field">Invited email<input type="email" autoComplete="username" required maxLength={254} disabled={busy} value={email} onChange={event=>setEmail(event.target.value)}/></label><label className="field">Password<input type="password" autoComplete="current-password" required maxLength={256} disabled={busy} value={password} onChange={event=>setPassword(event.target.value)}/></label><button className="button primary full" disabled={busy}><LogIn size={18}/>{busy ? 'Signing in...' : 'Sign in'}</button></form> : kind==='signup' && identity.authenticated ? <p role="alert">Sign out before creating a new account.</p> : identity.role==='worker' ? <p role="alert">A worker session cannot accept staff access. Use the invited staff account.</p> : <form className="entry-form" onSubmit={event=>void accept(event)}>
        {kind==='signup' && <><label className="field">{pending ? 'Original account password' : 'New password'}<input type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={busy} value={password} onChange={event=>{setPassword(event.target.value);setConfirmed(false);}}/></label><label className="field">Confirm password<input type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={busy} value={confirmation} onChange={event=>{setConfirmation(event.target.value);setConfirmed(false);}}/></label></>}
        <label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>I accept {roles[preview.role]} access at {preview.site}.</span></label><button className="button primary full" disabled={busy || !confirmed}>{pending ? <RefreshCw size={18}/> : kind==='signup' ? <KeyRound size={18}/> : <ShieldCheck size={18}/>} {busy ? 'Checking acceptance...' : pending ? 'Retry unchanged acceptance' : kind==='signup' ? 'Create account and accept' : 'Accept site access'}</button>
      </form>}
    </>}
    {error && <p role="alert" className="record-error">{error}</p>}
  </section>;
}
