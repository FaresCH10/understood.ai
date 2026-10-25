import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ChevronLeft,ChevronRight,Globe,KeyRound,MessageCircle,UserRound,Zap} from 'lucide-react';
import {type WorkerUiLanguage,workerUiDirection} from './worker-ui-language';
import {type PageSession} from './session-state';
import {workerEntryIdentity,workerEntryLanguages,workerEntryText} from './worker-entry-presentation';
import {workerCredentialEntryText} from './worker-credential-entry-text';

export {workerEntryText} from './worker-entry-presentation';
type WorkerCredentialInput={company:string;workerId:string;password:string};
type WorkerSetupInput=WorkerCredentialInput&{code:string};
export function WorkerAccessEntry({language,onLanguage,token,linkSignal,onToken,busy,blocked,authenticated,session,supported,failed,onSubmit,onPasswordLogin,onSetupClaim,onClearFailure,onCancel,children}:{language:WorkerUiLanguage;onLanguage:(value:WorkerUiLanguage)=>void;token:string;linkSignal:number;onToken:(value:string)=>void;busy:boolean;blocked:boolean;authenticated:boolean;session?:PageSession;supported:boolean;failed:boolean;onSubmit:()=>void;onPasswordLogin:(input:WorkerCredentialInput)=>void;onSetupClaim:(input:WorkerSetupInput)=>void;onClearFailure:()=>void;onCancel:()=>void;children:React.ReactNode}) {
  const t=workerEntryText[language],c=workerCredentialEntryText[language],rtl=workerUiDirection(language)==='rtl',Forward=rtl?ArrowLeft:ArrowRight,Back=rtl?ArrowRight:ArrowLeft,Chevron=rtl?ChevronLeft:ChevronRight;
  const identity=workerEntryIdentity(session,language),tokenInput=useRef<HTMLInputElement>(null);
  const [mode,setMode]=useState<'login'|'setup'|'link'>(token?'link':'login');
  const [company,setCompany]=useState(''),[workerId,setWorkerId]=useState(''),[password,setPassword]=useState('');
  const [setupCode,setSetupCode]=useState(''),[newPassword,setNewPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState('');
  const [formError,setFormError]=useState('');
  const [linkOpen,setLinkOpen]=useState(!token),[helpOpen,setHelpOpen]=useState(false),[anotherOpen,setAnotherOpen]=useState(false);
  const disabled=busy || blocked || !supported;
  // Only hash-arrived links reopen the link form; typing into it must not collapse the input.
  useEffect(()=>{if(token){setMode('link');setLinkOpen(false);}},[linkSignal]);
  function chooseMode(next:'login'|'setup'|'link'){
    if(disabled)return;onClearFailure();setFormError('');
    if(next!=='login')setPassword('');
    if(next!=='setup'){setSetupCode('');setNewPassword('');setConfirmPassword('');}
    setMode(next);
  }
  function login(event:React.FormEvent){
    event.preventDefault();setFormError('');
    if(disabled || !company.trim() || !workerId.trim() || !password)return;
    onPasswordLogin({company:company.trim(),workerId:workerId.trim(),password});
  }
  function setup(event:React.FormEvent){
    event.preventDefault();setFormError('');
    if(disabled || !company.trim() || !workerId.trim() || !setupCode.trim())return;
    if(newPassword.length<8){setFormError(c.passwordShort);return;}
    if(newPassword!==confirmPassword){setFormError(c.passwordMismatch);return;}
    onSetupClaim({company:company.trim(),workerId:workerId.trim(),code:setupCode.trim(),password:newPassword});
  }
  return <main className="entry-page worker-access-entry" lang={language} dir={rtl?'rtl':'ltr'}>{children}<section aria-labelledby="worker-entry-title">
    <header className="worker-entry-heading"><h1 id="worker-entry-title">{t.title}</h1><p>{t.choose}</p></header>
    {identity && <div className="worker-entry-identity"><UserRound size={24} aria-hidden="true"/><div><span>{t.current}</span><strong><bdi>{identity.name}</bdi></strong><p><bdi>{identity.organization}</bdi> · <bdi>{identity.site}</bdi></p></div></div>}
    <fieldset className="worker-entry-languages" disabled={busy}><legend>{t.language}</legend>{workerEntryLanguages.map(item=><label key={item.value} className={language===item.value?'selected':''}><span lang={item.value} dir={item.dir}>{item.label}</span><input type="radio" name="worker-entry-language" value={item.value} checked={language===item.value} onChange={()=>onLanguage(item.value)}/></label>)}</fieldset>
    {supported?<>
      <div className="actions worker-entry-modes" role="group" aria-label={c.modes}>
        <button type="button" className={`button ${mode==='login'?'primary':'outline'}`} aria-pressed={mode==='login'} disabled={busy} onClick={()=>chooseMode('login')}>{c.loginMode}</button>
        <button type="button" className={`button ${mode==='setup'?'primary':'outline'}`} aria-pressed={mode==='setup'} disabled={busy} onClick={()=>chooseMode('setup')}>{c.setupMode}</button>
        <button type="button" className={`button ${mode==='link'?'primary':'outline'}`} aria-pressed={mode==='link'} disabled={busy} onClick={()=>chooseMode('link')}>{c.linkMode}</button>
      </div>
      {mode==='login' && <form className="entry-form" onSubmit={login}>
        <label className="field">{c.company}<input dir="ltr" autoComplete="organization" autoCapitalize="none" spellCheck={false} value={company} disabled={disabled} onChange={event=>setCompany(event.target.value)} required maxLength={64}/></label>
        <label className="field">{c.workerId}<input dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} value={workerId} disabled={disabled} onChange={event=>setWorkerId(event.target.value)} required maxLength={80}/></label>
        <label className="field">{c.password}<input type="password" dir="ltr" autoComplete="current-password" value={password} disabled={disabled} onChange={event=>setPassword(event.target.value)} required maxLength={128}/></label>
        <p className="muted">{c.companyHint}</p>
        {formError && <p role="alert">{formError}</p>}
        {failed && <p role="alert">{c.failedLogin}</p>}
        {authenticated && <p className="notice notice-amber">{t.handoff}</p>}
        <button className="button primary full worker-entry-continue" type="submit" disabled={disabled || !company.trim() || !workerId.trim() || !password}>{busy?t.busy:c.login}<Forward size={24} aria-hidden="true"/></button>
      </form>}
      {mode==='setup' && <form className="entry-form" onSubmit={setup}>
        <label className="field">{c.company}<input dir="ltr" autoComplete="organization" autoCapitalize="none" spellCheck={false} value={company} disabled={disabled} onChange={event=>setCompany(event.target.value)} required maxLength={64}/></label>
        <label className="field">{c.workerId}<input dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} value={workerId} disabled={disabled} onChange={event=>setWorkerId(event.target.value)} required maxLength={80}/></label>
        <label className="field">{c.setupCode}<input dir="ltr" autoComplete="off" autoCapitalize="none" spellCheck={false} value={setupCode} disabled={disabled} onChange={event=>setSetupCode(event.target.value)} required maxLength={43}/></label>
        <label className="field">{c.newPassword}<input type="password" dir="ltr" autoComplete="new-password" value={newPassword} disabled={disabled} onChange={event=>setNewPassword(event.target.value)} required minLength={8} maxLength={128}/></label>
        <label className="field">{c.confirmPassword}<input type="password" dir="ltr" autoComplete="new-password" value={confirmPassword} disabled={disabled} onChange={event=>setConfirmPassword(event.target.value)} required minLength={8} maxLength={128}/></label>
        <p className="muted">{c.setupHint}</p>
        {formError && <p role="alert">{formError}</p>}
        {failed && <p role="alert">{c.failedSetup}</p>}
        {authenticated && <p className="notice notice-amber">{t.handoff}</p>}
        <button className="button primary full worker-entry-continue" type="submit" disabled={disabled || !company.trim() || !workerId.trim() || !setupCode.trim() || newPassword.length<8 || newPassword!==confirmPassword}>{busy?t.busy:c.setup}<Forward size={24} aria-hidden="true"/></button>
      </form>}
      {mode==='link' && <form onSubmit={event=>{event.preventDefault();if(!busy && !blocked && supported && token.trim())onSubmit();}}>
        <details className="worker-entry-link" open={linkOpen} onToggle={event=>setLinkOpen(event.currentTarget.open)}><summary>{t.link}</summary>{token && <p>{t.provided}</p>}<label className="field">{t.token}<input ref={tokenInput} type="password" dir="ltr" autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} disabled={busy || blocked} onChange={event=>onToken(event.target.value)} required maxLength={256}/></label></details>
        {authenticated && <p className="notice notice-amber">{t.handoff}</p>}
        {failed && <p role="alert">{t.failed}</p>}
        <button className="button primary full worker-entry-continue" type="submit" disabled={busy || blocked || !token.trim()}>{busy?t.busy:t.open}<Forward size={24} aria-hidden="true"/></button>
      </form>}
    </>:<p role="status">{t.unsupported}</p>}
    <div className="worker-entry-notes"><p><Zap size={22} aria-hidden="true"/><span>{t.synthetic}</span></p><p><Globe size={22} aria-hidden="true"/><span>{t.languages}</span></p></div>
    <div className="worker-entry-support">
      {supported && <><button className="worker-entry-action" disabled={busy} aria-expanded={anotherOpen} aria-controls="worker-entry-another" onClick={()=>{setAnotherOpen(true);chooseMode('link');onToken('');setLinkOpen(true);requestAnimationFrame(()=>tokenInput.current?.focus());}}><KeyRound size={22} aria-hidden="true"/><span>{t.another}</span><Chevron size={22} aria-hidden="true"/></button><p id="worker-entry-another" hidden={!anotherOpen}>{t.anotherBody}</p></>}
      <button className="worker-entry-action" disabled={busy} aria-expanded={helpOpen} aria-controls="worker-entry-help" onClick={()=>setHelpOpen(value=>!value)}><MessageCircle size={22} aria-hidden="true"/><span>{t.help}</span><Chevron size={22} aria-hidden="true"/></button><p id="worker-entry-help" hidden={!helpOpen}>{t.helpBody}</p>
      <button className="worker-entry-back" disabled={busy} onClick={onCancel}><Back size={20} aria-hidden="true"/>{t.cancel}</button>
    </div>
  </section></main>;
}
