import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ChevronLeft,ChevronRight,Globe,KeyRound,MessageCircle,UserRound,Zap} from 'lucide-react';
import {type WorkerUiLanguage,workerUiDirection} from './worker-ui-language';
import {type PageSession} from './session-state';
import {workerEntryIdentity,workerEntryLanguages,workerEntryText} from './worker-entry-presentation';
import {workerCredentialEntryText,workerCompanyMemoryText} from './worker-credential-entry-text';
import {AuthLayout} from './AuthLayout';

export {workerEntryText} from './worker-entry-presentation';
type WorkerCredentialInput={company:string;workerId:string;password:string};
const COMPANY_KEY='understood:worker-company';
const entryRoles:Record<WorkerUiLanguage,readonly [string,string]>={en:['Supervisor','Worker'],ar:['المشرف','العامل'],ur:['نگران','کارکن'],hi:['पर्यवेक्षक','कर्मचारी'],bn:['তত্ত্বাবধায়ক','কর্মী'],ml:['സൂപ്പർവൈസർ','തൊഴിലാളി'],ta:['மேற்பார்வையாளர்','பணியாளர்'],te:['పర్యవేక్షకుడు','కార్మికుడు'],ne:['सुपरिवेक्षक','कामदार'],fil:['Tagapangasiwa','Manggagawa'],si:['අධීක්ෂකයා','සේවකයා'],ru:['Руководитель','Работник'],'pa-Guru':['ਨਿਗਰਾਨ','ਕਰਮਚਾਰੀ'],'pa-Arab':['نگران','کارکن'],id:['Pengawas','Pekerja']};
// Opt-in only: the company ID is a second factor, so it is never remembered by default.
function rememberedCompany(){try{const value=localStorage.getItem(COMPANY_KEY);return value && value.length<=64?value:'';}catch{return '';}}
function keepCompany(remember:boolean,company:string){try{if(remember)localStorage.setItem(COMPANY_KEY,company);else localStorage.removeItem(COMPANY_KEY);}catch{}}
export function WorkerAccessEntry({language,onLanguage,token,linkSignal,onToken,busy,blocked,authenticated,session,supported,failed,onSubmit,onPasswordLogin,onClearFailure,onCancel,children}:{language:WorkerUiLanguage;onLanguage:(value:WorkerUiLanguage)=>void;token:string;linkSignal:number;onToken:(value:string)=>void;busy:boolean;blocked:boolean;authenticated:boolean;session?:PageSession;supported:boolean;failed:boolean;onSubmit:()=>void;onPasswordLogin:(input:WorkerCredentialInput)=>void;onClearFailure:()=>void;onCancel:()=>void;children:React.ReactNode}) {
  const t=workerEntryText[language],c=workerCredentialEntryText[language],m=workerCompanyMemoryText[language],rtl=workerUiDirection(language)==='rtl',Forward=rtl?ArrowLeft:ArrowRight,Back=rtl?ArrowRight:ArrowLeft,Chevron=rtl?ChevronLeft:ChevronRight;
  const identity=workerEntryIdentity(session,language),tokenInput=useRef<HTMLInputElement>(null);
  const [mode,setMode]=useState<'login'|'link'>(token?'link':'login');
  const [company,setCompany]=useState(rememberedCompany),[workerId,setWorkerId]=useState(''),[password,setPassword]=useState('');
  const [remember,setRemember]=useState(()=>Boolean(rememberedCompany()));
  const [formError,setFormError]=useState('');
  const [linkOpen,setLinkOpen]=useState(!token),[helpOpen,setHelpOpen]=useState(false),[anotherOpen,setAnotherOpen]=useState(false);
  const disabled=busy || blocked || !supported;
  const attempted=useRef('');
  useEffect(()=>{if(/^[A-Za-z0-9_-]{43}$/.test(token) && !busy && !blocked && supported && attempted.current!==token){attempted.current=token;onSubmit();}},[token,busy,blocked,supported,onSubmit]);
  const memory=<label className="signin-remember"><input type="checkbox" checked={remember} disabled={disabled} onChange={event=>{setRemember(event.target.checked);if(!event.target.checked)keepCompany(false,'');}}/><span>{m.remember}</span></label>;
  const memoryHint=<p className="muted">{m.hint}</p>;
  // Only hash-arrived links reopen the link form; typing into it must not collapse the input.
  useEffect(()=>{if(token){setMode('link');setLinkOpen(false);}},[linkSignal]);
  function chooseMode(next:'login'|'link'){
    if(disabled)return;onClearFailure();setFormError('');
    if(next!=='login')setPassword('');
    setMode(next);
  }
  function login(event:React.FormEvent){
    event.preventDefault();setFormError('');
    if(disabled || !company.trim() || !workerId.trim() || !password)return;
    keepCompany(remember,company.trim());
    onPasswordLogin({company:company.trim(),workerId:workerId.trim(),password});
  }
  return <AuthLayout variant="worker"><div className="worker-access-entry" lang={language} dir={rtl?'rtl':'ltr'}>{children}<section aria-labelledby="worker-entry-title">
    <header className="worker-entry-heading"><h1 id="worker-entry-title">{t.title}</h1><p>{t.choose}</p></header>
    {identity && <div className="worker-entry-identity"><UserRound size={24} aria-hidden="true"/><div><span>{t.current}</span><strong><bdi>{identity.name}</bdi></strong><p><bdi>{identity.organization}</bdi> · <bdi>{identity.site}</bdi></p></div></div>}
    <nav className="auth-role-tabs" aria-label={c.modes}><a href="#sign-in" onClick={event=>{if(busy)event.preventDefault();}}>{entryRoles[language][0]}</a><a href="#worker-access" aria-current="page" onClick={event=>{if(busy)event.preventDefault();}}>{entryRoles[language][1]}</a></nav>
    <details className="auth-language-picker"><summary><Globe size={15} aria-hidden="true"/>{t.language}<strong>{workerEntryLanguages.find(item=>item.value===language)?.label}</strong></summary><fieldset className="worker-entry-languages" disabled={busy}><legend>{t.language}</legend>{workerEntryLanguages.map(item=><label key={item.value} className={language===item.value?'selected':''}><span lang={item.value} dir={item.dir}>{item.label}</span><input type="radio" name="worker-entry-language" value={item.value} checked={language===item.value} onChange={()=>onLanguage(item.value)}/></label>)}</fieldset><p className="auth-languages-note">{t.languages}</p></details>
    {supported?<>
      <div className="actions worker-entry-modes" role="group" aria-label={c.modes}>
        <button type="button" className={`button ${mode==='login'?'primary':'outline'}`} aria-pressed={mode==='login'} disabled={busy} onClick={()=>chooseMode('login')}>{c.loginMode}</button>
        <button type="button" className={`button ${mode==='link'?'primary':'outline'}`} aria-pressed={mode==='link'} disabled={busy} onClick={()=>chooseMode('link')}>{c.linkMode}</button>
      </div>
      {mode==='login' && <form className="entry-form" onSubmit={login}>
        <label className="field">{c.company}<input dir="ltr" autoComplete="organization" value={company} disabled={disabled} onChange={event=>setCompany(event.target.value)} required maxLength={64}/></label>
        {memory}{memoryHint}
        <label className="field">{c.workerId}<input dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} value={workerId} disabled={disabled} onChange={event=>setWorkerId(event.target.value)} required maxLength={80}/></label>
        <label className="field">{c.password}<input type="password" dir="ltr" autoComplete="current-password" value={password} disabled={disabled} onChange={event=>setPassword(event.target.value)} required minLength={8} maxLength={128}/></label>
        <p className="muted">{c.passwordShort} {c.companyHint}</p>
        {formError && <p role="alert">{formError}</p>}
        {failed && <p role="alert">{c.failedLogin}</p>}
        {authenticated && <p className="notice notice-amber">{t.handoff}</p>}
        <button className="button primary full worker-entry-continue" type="submit" disabled={disabled || !company.trim() || !workerId.trim() || !password}>{busy?t.busy:c.login}<Forward size={24} aria-hidden="true"/></button>
      </form>}
      {mode==='link' && <form onSubmit={event=>{event.preventDefault();if(!disabled && token.trim())onSubmit();}}>
        <details className="worker-entry-link" open={linkOpen} onToggle={event=>setLinkOpen(event.currentTarget.open)}><summary>{t.link}</summary>{token && <p>{t.provided}</p>}<label className="field">{t.token}<input ref={tokenInput} type="password" dir="ltr" autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} disabled={busy || blocked} onChange={event=>onToken(event.target.value)} required maxLength={256}/></label></details>
        {authenticated && <p className="notice notice-amber">{t.handoff}</p>}
        {failed && <p role="alert">{t.failed}</p>}
        <button className="button primary full worker-entry-continue" type="submit" disabled={disabled || !token.trim()}>{busy?t.busy:t.open}<Forward size={24} aria-hidden="true"/></button>
      </form>}
    </>:<p role="status">{t.unsupported}</p>}
    {!supported && <div className="worker-entry-notes"><p><Zap size={22} aria-hidden="true"/><span>{t.synthetic}</span></p></div>}
    <div className="worker-entry-support">
      {supported && <><button className="worker-entry-action" disabled={busy} aria-expanded={anotherOpen} aria-controls="worker-entry-another" onClick={()=>{setAnotherOpen(true);chooseMode('link');onToken('');setLinkOpen(true);requestAnimationFrame(()=>tokenInput.current?.focus());}}><KeyRound size={22} aria-hidden="true"/><span>{t.another}</span><Chevron size={22} aria-hidden="true"/></button><p id="worker-entry-another" hidden={!anotherOpen}>{t.anotherBody}</p></>}
      <button className="worker-entry-action" disabled={busy} aria-expanded={helpOpen} aria-controls="worker-entry-help" onClick={()=>setHelpOpen(value=>!value)}><MessageCircle size={22} aria-hidden="true"/><span>{t.help}</span><Chevron size={22} aria-hidden="true"/></button><p id="worker-entry-help" hidden={!helpOpen}>{t.helpBody}</p>
      <button className="worker-entry-back" disabled={busy} onClick={onCancel}><Back size={20} aria-hidden="true"/>{t.cancel}</button>
    </div>
  </section></div></AuthLayout>;
}
