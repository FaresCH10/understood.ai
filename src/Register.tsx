import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowLeft,ArrowRight,Check,CheckCircle2,Clock3,Globe2,KeyRound,LogIn,Mail,RefreshCw,ShieldCheck} from 'lucide-react';
import {countryOptions} from './country-options';
import {clearRegistrationReceipt,checkedVerification,readRegistrationReceipt,requestAccount,resendAccount,RegistrationError,saveRegistrationReceipt,verifyAccount,verifyAccountCode,normalizeVerificationCode,registrationOptions,type RegistrationReceipt} from './registration';

export type RegistrationLanguage='en'|'ar';
type AccountBody={requestId:string;ownerName:string;email:string;password:string;companyName:string;country:string;phone?:string;acceptTerms:boolean;acceptPrivacy:boolean};

const en={
  codeLabel:'Verification code',codeHint:'Enter the six-digit code from your email. Codes expire; use the latest code or request another.',codeSent:'If this registration is eligible, a verification code has been requested for',codeResend:'Request another code',codeResent:'If this registration is still pending, a new code has been requested.',codeError:'The code could not be verified. Check the latest code and try again.',codeUnavailable:'Email verification is not configured or could not be checked. Please try again later.',codeNote:'We email a verification code before your trial starts.',checkingVerification:'Checking email verification…',retryVerification:'Check again',
  kicker:'Free trial',title:'Start using Understood',
  lead:'Create your company workspace. Verify your work email to start a 14-day trial for up to 25 workers. No card required.',
  trial:['14 days from verified activation','Up to 25 active workers','No card or automatic charge'],
  ownerName:'Full name',email:'Work email',password:'Password',passwordHint:'Use 12 to 256 characters. You can reset it from the sign-in page.',
  confirmPassword:'Confirm password',company:'Company name',country:'Operating country',selectCountry:'Select a country',
  phone:'Business phone (optional)',phoneHint:'For account follow-up only. Adding it never sends a message.',
  terms:'I agree to the Terms of Service and acknowledge the Privacy Notice.',
  submit:'Create workspace',submitting:'Creating workspace...',signIn:'Already have an account? Sign in',back:'Back to Understood',
  deliveryNote:'We email a one-use verification link before your trial starts.',
  signedInTitle:'You are already signed in',signedInBody:'Registration creates a separate workspace. Sign out first if you need another account.',continue:'Continue to my workspace',
  unavailableEnvironment:'Online account creation is unavailable',unavailableEnvironmentBody:'This environment does not accept online registrations. Use an existing account, or open the public site for a pilot inquiry.',
  sentTitle:'Check your email',sentBody:'If these details can start a new workspace, we sent a verification link to',sentPrivacy:'For privacy, we show this message whether or not an account already exists.',
  sentNote:'The link expires in 24 hours. Your trial starts only after you verify your work email.',resend:'Resend verification email',resending:'Sending...',
  resent:'If this registration is still waiting for verification, a new link has been sent. Earlier links may stop working.',
  unconfirmed:'The result could not be confirmed. Retry the same registration before starting over.',retry:'Retry the same registration',
  startOver:'Start a different registration',dismiss:'Dismiss',passwordMismatch:'The passwords do not match.',storage:'This browser could not keep a registration receipt. Keep this tab open until the result is confirmed.',
  verifyTitle:'Verify your work email',verifyLead:'Confirming this email starts your 14-day trial. No card is charged.',verify:'Verify email and start trial',verifying:'Verifying...',
  verifiedTitle:'Email verified',verifiedLead:'Your workspace is ready. Sign in with your work email and password.',verifiedDuplicate:'This link was already used. Sign in to open your workspace.',
  verifiedTrial:'Your 14-day trial has started. Up to 25 active workers are included; no card is on file.',openSignIn:'Sign in to continue',
  unavailableTitle:'This link is unavailable',unavailableBody:'It may have expired, been replaced, or already been used. Sign in if your account is active, or request a new link from the registration page.',newLink:'Request a new link',
  uncertainTitle:'Verification not confirmed',uncertainBody:'The result could not be confirmed. Retry this same link before signing in.',retryVerify:'Retry verification',signInShort:'Sign in',
};
const ar={
  codeLabel:'رمز التحقق',codeHint:'أدخل الرمز المكوّن من ستة أرقام من بريدك. تنتهي صلاحية الرموز؛ استخدم أحدث رمز أو اطلب رمزاً آخر.',codeSent:'إذا كان التسجيل مؤهلاً، فقد طُلب إرسال رمز تحقق إلى',codeResend:'طلب رمز آخر',codeResent:'إذا كان التسجيل ما زال معلقاً، فقد طُلب رمز جديد.',codeError:'تعذّر التحقق من الرمز. راجع أحدث رمز وحاول مجدداً.',codeUnavailable:'التحقق من البريد غير مضبوط أو تعذّر فحصه. حاول لاحقاً.',codeNote:'نرسل رمز تحقق إلى بريدك قبل بدء تجربتك.',checkingVerification:'جارٍ فحص التحقق من البريد…',retryVerification:'إعادة الفحص',
  kicker:'تجربة مجانية',title:'ابدأ استخدام Understood',
  lead:'أنشئ مساحة عمل شركتك. تحقق من بريد العمل لبدء تجربة مجانية لمدة 14 يوماً لما يصل إلى 25 عاملاً. لا حاجة لبطاقة.',
  trial:['14 يوماً من التفعيل الموثّق','حتى 25 عاملاً نشطاً','بدون بطاقة أو خصم تلقائي'],
  ownerName:'الاسم الكامل',email:'بريد العمل',password:'كلمة المرور',passwordHint:'استخدم من 12 إلى 256 حرفاً. يمكنك إعادة تعيينها من صفحة تسجيل الدخول.',
  confirmPassword:'تأكيد كلمة المرور',company:'اسم الشركة',country:'بلد التشغيل',selectCountry:'اختر بلداً',
  phone:'هاتف العمل (اختياري)',phoneHint:'للمتابعة المتعلقة بالحساب فقط. إضافته لا ترسل أي رسالة.',
  terms:'أوافق على شروط الخدمة وأقرّ بإشعار الخصوصية.',
  submit:'إنشاء مساحة العمل',submitting:'جارٍ إنشاء مساحة العمل...',signIn:'لديك حساب بالفعل؟ سجّل الدخول',back:'العودة إلى Understood',
  deliveryNote:'نرسل رابط تحقق لمرة واحدة إلى بريدك قبل بدء التجربة.',
  signedInTitle:'أنت مسجّل الدخول بالفعل',signedInBody:'ينشئ التسجيل مساحة عمل منفصلة. سجّل الخروج أولاً إذا كنت تحتاج إلى حساب آخر.',continue:'المتابعة إلى مساحة عملي',
  unavailableEnvironment:'التسجيل عبر الإنترنت غير متاح',unavailableEnvironmentBody:'لا تقبل هذه البيئة التسجيلات عبر الإنترنت. استخدم حساباً موجوداً، أو افتح الموقع العام لتقديم طلب تجريبي.',
  sentTitle:'تحقق من بريدك',sentBody:'إذا كانت هذه البيانات صالحة لبدء مساحة عمل جديدة، فقد أرسلنا رابط تحقق إلى',sentPrivacy:'حفاظاً على الخصوصية، تظهر هذه الرسالة سواء كان الحساب موجوداً أم لا.',
  sentNote:'ينتهي الرابط خلال 24 ساعة. تبدأ تجربتك بعد التحقق من بريد العمل فقط.',resend:'إعادة إرسال رسالة التحقق',resending:'جارٍ الإرسال...',
  resent:'إذا كان هذا التسجيل ما زال بانتظار التحقق، فقد أُرسل رابط جديد. قد تتوقف الروابط السابقة عن العمل.',
  unconfirmed:'تعذّر تأكيد النتيجة. أعد محاولة التسجيل نفسه قبل البدء من جديد.',retry:'إعادة محاولة التسجيل نفسه',
  startOver:'بدء تسجيل مختلف',dismiss:'إغلاق',passwordMismatch:'كلمتا المرور غير متطابقتين.',storage:'تعذّر على هذا المتصفح حفظ إيصال التسجيل. أبقِ هذه النافذة مفتوحة حتى تأكيد النتيجة.',
  verifyTitle:'تحقق من بريد العمل',verifyLead:'تأكيد هذا البريد يبدأ تجربتك المجانية لمدة 14 يوماً. لن تُخصم أي بطاقة.',verify:'تحقق من البريد وابدأ التجربة',verifying:'جارٍ التحقق...',
  verifiedTitle:'تم التحقق من البريد',verifiedLead:'مساحة عملك جاهزة. سجّل الدخول ببريد العمل وكلمة المرور.',verifiedDuplicate:'استُخدم هذا الرابط سابقاً. سجّل الدخول لفتح مساحة عملك.',
  verifiedTrial:'بدأت تجربتك المجانية لمدة 14 يوماً. تشمل حتى 25 عاملاً نشطاً؛ ولا توجد بطاقة محفوظة.',openSignIn:'سجّل الدخول للمتابعة',
  unavailableTitle:'هذا الرابط غير متاح',unavailableBody:'قد يكون منتهي الصلاحية أو مستبدلاً أو مستخدماً سابقاً. سجّل الدخول إذا كان حسابك نشطاً، أو اطلب رابطاً جديداً من صفحة التسجيل.',newLink:'طلب رابط جديد',
  uncertainTitle:'لم يتم تأكيد التحقق',uncertainBody:'تعذّر تأكيد النتيجة. أعد محاولة الرابط نفسه قبل تسجيل الدخول.',retryVerify:'إعادة محاولة التحقق',signInShort:'تسجيل الدخول',
} satisfies {[K in keyof typeof en]:typeof en[K]};
const copy:Record<RegistrationLanguage,typeof en>={en,ar};

function countryLabel(code:string,fallback:string,language:RegistrationLanguage) {
  try {return new Intl.DisplayNames([language],{type:'region'}).of(code) || fallback;} catch {return fallback;}
}
function LanguageSwitch({language,onLanguage,disabled}:{language:RegistrationLanguage;onLanguage:(value:RegistrationLanguage)=>void;disabled?:boolean}) {
  return <div className="segmented-control registration-languages" role="group" aria-label="Language"><button type="button" aria-pressed={language==='en'} disabled={disabled} onClick={()=>onLanguage('en')}>English</button><button type="button" aria-pressed={language==='ar'} disabled={disabled} onClick={()=>onLanguage('ar')}>العربية</button></div>;
}
function TrialPoints({text}:{text:readonly string[]}) {
  return <ul className="registration-trial">{text.map(value=><li key={value}><Check size={17}/>{value}</li>)}</ul>;
}

export function RegistrationPage({language,onLanguage,onBack,onSignIn,onOpenWorkspace,authenticated,available}:{language:RegistrationLanguage;onLanguage:(value:RegistrationLanguage)=>void;onBack:()=>void;onSignIn:()=>void;onOpenWorkspace:()=>void;authenticated:boolean;available:boolean}) {
  const t=copy[language],heading=useRef<HTMLHeadingElement>(null),sending=useRef(false);
  const [receipt,setReceipt]=useState<RegistrationReceipt|null>(null),[pending,setPending]=useState<{receipt:RegistrationReceipt;body:AccountBody}|null>(null);
  const [ownerName,setOwnerName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState('');
  const [company,setCompany]=useState(''),[country,setCountry]=useState(''),[phone,setPhone]=useState(''),[terms,setTerms]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[storageError,setStorageError]=useState(false);
  const [verificationCheck,setVerificationCheck]=useState(0);
  const [method,setMethod]=useState<'link'|'neon-code'>('link'),[verificationReady,setVerificationReady]=useState<boolean|null>(null),[code,setCode]=useState(''),[codeComplete,setCodeComplete]=useState(false);
  useEffect(()=>{setVerificationReady(null);const controller=new AbortController();void registrationOptions(controller.signal).then(value=>{setMethod(value.verification);setVerificationReady(value.available);}).catch(()=>{if(!controller.signal.aborted)setVerificationReady(false);});return()=>controller.abort();},[verificationCheck]);
  useEffect(()=>{try{const saved=readRegistrationReceipt(sessionStorage);if(saved)setReceipt(saved);}catch{setStorageError(true);}},[]);
  useEffect(()=>{if(receipt||codeComplete)heading.current?.focus();},[receipt,codeComplete]);
  async function send(body:AccountBody,value:RegistrationReceipt) {
    sending.current=true;setBusy(true);setError('');setNotice('');
    try {
      try {saveRegistrationReceipt(sessionStorage,{...value,state:'pending'});} catch {setStorageError(true);}
      const result=await requestAccount(body);
      if(result.accepted!==true) throw new RegistrationError('Account creation could not be confirmed. Retry the same registration.',null,true);
      const accepted:RegistrationReceipt={...value,state:'accepted',verification:result.verification==='neon-code'?'neon-code':'link'};
      try {saveRegistrationReceipt(sessionStorage,accepted);} catch {setStorageError(true);}
      setReceipt(accepted);setPending(null);setPassword('');setConfirmPassword('');
      heading.current?.focus();
    } catch(caught) {
      const failure=caught as Error;
      const status=caught instanceof RegistrationError?caught.status:null;
      if(status===400 || status===403 || status===404) {
        try {clearRegistrationReceipt(sessionStorage);} catch {setStorageError(true);}
        setReceipt(null);setPending(null);
      }
      setError(failure.message);
    } finally {
      sending.current=false;setBusy(false);
    }
  }
  function submit(event:FormEvent) {
    event.preventDefault();
    if(sending.current || busy) return;
    if(password!==confirmPassword) {setError(t.passwordMismatch);return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {setError(language==='ar'?'أدخل بريد عمل صالحاً.':'Enter a valid work email.');return;}
    const requestId=crypto.randomUUID(),normalized=email.trim().toLowerCase();
    const body:AccountBody={requestId,ownerName:ownerName.trim(),email:normalized,password,companyName:company.trim(),country,
      ...(phone.trim()?{phone:phone.trim()}:{}),acceptTerms:true,acceptPrivacy:true};
    const value:RegistrationReceipt={requestId,email:normalized,createdAt:new Date().toISOString(),state:'pending'};
    setReceipt(value);setPending({receipt:value,body});
    void send(body,value);
  }
  async function resend() {
    if(!receipt || sending.current) return;
    sending.current=true;setBusy(true);setError('');setNotice('');
    try {const result=await resendAccount({requestId:receipt.requestId,email:receipt.email});const updated:RegistrationReceipt={...receipt,verification:result.verification==='neon-code'?'neon-code':'link'};setReceipt(updated);try{saveRegistrationReceipt(sessionStorage,updated);}catch{setStorageError(true);}setCode('');setNotice(updated.verification==='neon-code'?t.codeResent:t.resent);}
    catch(caught) {setError((caught as Error).message);}
    finally {sending.current=false;setBusy(false);}
  }
  async function verifyCode(event:FormEvent){
    event.preventDefault();if(!receipt||sending.current||code.length!==6)return;
    sending.current=true;setBusy(true);setError('');setNotice('');
    try{checkedVerification(await verifyAccountCode(receipt,code));try{clearRegistrationReceipt(sessionStorage);}catch{setStorageError(true);}setCode('');setCodeComplete(true);}
    catch{setError(t.codeError);}
    finally{sending.current=false;setBusy(false);}
  }
  function startOver() {
    try {clearRegistrationReceipt(sessionStorage);} catch {setStorageError(true);}
    setReceipt(null);setPending(null);setCode('');setCodeComplete(false);setError('');setNotice('');setPassword('');setConfirmPassword('');setTerms(false);
  }
  if(authenticated) return <section className="registration-page" lang={language} dir={language==='ar'?'rtl':'ltr'}>
    <div className="registration-top"><button type="button" className="button subtle" onClick={onBack}><ArrowLeft size={18}/>{t.back}</button><LanguageSwitch language={language} onLanguage={onLanguage}/></div>
    <div className="registration-intro"><span className="public-kicker">{t.kicker}</span><h1>{t.signedInTitle}</h1><p>{t.signedInBody}</p></div>
    <div className="actions"><button type="button" className="button primary" onClick={onOpenWorkspace}><ArrowRight size={18}/>{t.continue}</button></div>
  </section>;
  if(!available && !authenticated) return <section className="registration-page" lang={language} dir={language==='ar'?'rtl':'ltr'}>
    <div className="registration-top"><button type="button" className="button subtle" onClick={onBack}><ArrowLeft size={18}/>{t.back}</button><LanguageSwitch language={language} onLanguage={onLanguage}/></div>
    <div className="registration-sent"><div className="registration-icon"><ShieldCheck size={30}/></div><h1>{t.unavailableEnvironment}</h1><p>{t.unavailableEnvironmentBody}</p><div className="actions"><button type="button" className="button outline" onClick={onSignIn}><LogIn size={18}/>{t.signInShort}</button><a className="button subtle" href="#pilot">{t.back}</a></div></div>
  </section>;
  return <section className="registration-page" lang={language} dir={language==='ar'?'rtl':'ltr'}>
    <div className="registration-top"><button type="button" className="button subtle" onClick={onBack}><ArrowLeft size={18}/>{t.back}</button><LanguageSwitch language={language} onLanguage={onLanguage} disabled={busy}/></div>
    {codeComplete?<div className="registration-sent"><div className="registration-icon"><CheckCircle2 size={30}/></div><h1 ref={heading} tabIndex={-1}>{t.verifiedTitle}</h1><p role="status">{t.verifiedLead}</p><p>{t.verifiedTrial}</p><button type="button" className="button primary" onClick={onSignIn}>{t.openSignIn}</button></div>:receipt ? <div className="registration-sent">
      <div className="registration-icon">{receipt.state==='accepted'?<Mail size={30}/>:<RefreshCw size={30}/>}</div>
      <h1 ref={heading} tabIndex={-1}>{receipt.state==='accepted'?t.sentTitle:language==='ar'?'لم يتم تأكيد التسجيل':'Registration not confirmed'}</h1>
      {receipt.state==='accepted'?
        <><p>{receipt.verification==='neon-code'?t.codeSent:t.sentBody} <bdi dir="ltr">{receipt.email}</bdi>.</p><p className="muted">{t.sentPrivacy}</p><p className="registration-note"><Clock3 size={18}/>{receipt.verification==='neon-code'?t.codeHint:t.sentNote}</p></>:
        <><p>{pending?t.unconfirmed:language==='ar'?'تعذّر تأكيد نتيجة التسجيل. إذا لم تصلك رسالة، ابدأ تسجيلاً جديداً بالبيانات نفسها.':'The registration result could not be confirmed. If no email arrives, start a new registration with the same details.'}</p></>}
      {receipt.state==='accepted'&&receipt.verification==='neon-code'&&<form className="registration-code-form" onSubmit={verifyCode}><label className="field">{t.codeLabel}<input required inputMode="numeric" autoComplete="one-time-code" dir="ltr" minLength={6} maxLength={6} pattern="[0-9]{6}" value={code} disabled={busy} onChange={event=>setCode(normalizeVerificationCode(event.target.value))}/></label><button type="submit" className="button primary full" disabled={busy||code.length!==6}>{busy?t.verifying:t.verify}</button></form>}
      <TrialPoints text={t.trial}/>
      {notice && <p role="status" className="registration-notice">{notice}</p>}
      {error && <p role="alert" className="public-error">{error}</p>}
      {storageError && <p className="muted">{t.storage}</p>}
      <div className="actions registration-actions">
        {pending && <button type="button" className="button primary" disabled={busy} onClick={()=>void send(pending.body,pending.receipt)}><RefreshCw size={18}/>{t.retry}</button>}
        <button type="button" className="button outline" disabled={busy} onClick={()=>void resend()}><Mail size={18}/>{busy?t.resending:receipt.verification==='neon-code'?t.codeResend:t.resend}</button>
        <button type="button" className="button subtle" disabled={busy} onClick={startOver}>{t.startOver}</button>
      </div>
      <button type="button" className="text-link" disabled={busy} onClick={onSignIn}>{t.signIn}<ArrowRight size={16}/></button>
    </div> : <div className="registration-layout">
      <div className="registration-intro"><span className="public-kicker">{t.kicker}</span><h1>{t.title}</h1><p>{t.lead}</p><TrialPoints text={t.trial}/><div className="registration-assurance"><ShieldCheck size={22}/><span>{language==='ar'?'تحقق البريد يمنع إنشاء حسابات ببريد لا تملكه.':'Email verification prevents accounts being created for an address you do not control.'}</span></div></div>
      <form className="registration-form" onSubmit={submit}>
        <label className="field">{t.ownerName}<input required minLength={2} maxLength={100} autoComplete="name" value={ownerName} disabled={busy} onChange={event=>setOwnerName(event.target.value)}/></label>
        <label className="field">{t.email}<input required type="email" maxLength={254} autoComplete="email" value={email} disabled={busy} onChange={event=>setEmail(event.target.value)}/></label>
        <label className="field">{t.password}<input required type="password" minLength={12} maxLength={256} autoComplete="new-password" value={password} disabled={busy} onChange={event=>setPassword(event.target.value)}/></label>
        <p className="field-hint">{t.passwordHint}</p>
        <label className="field">{t.confirmPassword}<input required type="password" minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} disabled={busy} onChange={event=>setConfirmPassword(event.target.value)}/></label>
        <label className="field">{t.company}<input required minLength={2} maxLength={120} autoComplete="organization" value={company} disabled={busy} onChange={event=>setCompany(event.target.value)}/></label>
        <label className="field">{t.country}<select required value={country} disabled={busy} onChange={event=>setCountry(event.target.value)}><option value="">{t.selectCountry}</option>{[...countryOptions].sort((a,b)=>countryLabel(a[0],a[1],language).localeCompare(countryLabel(b[0],b[1],language),language)).map(([code,name])=><option key={code} value={code}>{countryLabel(code,name,language)}</option>)}</select></label>
        <label className="field">{t.phone}<input type="tel" maxLength={30} autoComplete="tel" value={phone} disabled={busy} onChange={event=>setPhone(event.target.value)}/></label>
        <p className="field-hint">{t.phoneHint}</p>
        <label className="billing-confirm registration-terms"><input type="checkbox" required checked={terms} disabled={busy} onChange={event=>setTerms(event.target.checked)}/><span>{t.terms}</span></label>
        {error && <p role="alert" className="public-error">{error}</p>}
        <button className="button primary full" type="submit" disabled={busy || !terms || verificationReady!==true}><KeyRound size={18}/>{busy?t.submitting:t.submit}</button>
        <button type="button" className="text-link" disabled={busy} onClick={onSignIn}><LogIn size={16}/>{t.signIn}</button>
        {verificationReady===true&&<p className="registration-environment"><Mail size={16}/>{method==='neon-code'?t.codeNote:t.deliveryNote}</p>}
        {verificationReady===null&&<p role="status" className="registration-environment">{t.checkingVerification}</p>}
        {verificationReady===false&&<div><p role="status" className="public-error">{t.codeUnavailable}</p><button type="button" className="text-link" onClick={()=>setVerificationCheck(value=>value+1)}><RefreshCw size={16}/>{t.retryVerification}</button></div>}
      </form>
    </div>}
  </section>;
}

export function VerifyRegistration({token,language,onLanguage,onRegister,onSignIn}:{token:string;language:RegistrationLanguage;onLanguage:(value:RegistrationLanguage)=>void;onRegister:()=>void;onSignIn:()=>void}) {
  const t=copy[language],heading=useRef<HTMLHeadingElement>(null);
  const [phase,setPhase]=useState<'idle'|'uncertain'|'verified'|'unavailable'>(token?'idle':'unavailable'),[duplicate,setDuplicate]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{heading.current?.focus();},[phase]);
  async function verify() {
    if(busy || !token) return;
    setBusy(true);setError('');
    try {
      const result=checkedVerification(await verifyAccount(token));
      try {clearRegistrationReceipt(sessionStorage);} catch {}
      setDuplicate(result.duplicate);setPhase('verified');
    } catch(caught) {
      const failure=caught as Error;
      setError(failure.message);
      setPhase(caught instanceof RegistrationError && (caught.uncertain || (caught.status??0)>=500) ? 'uncertain' : 'unavailable');
    } finally {setBusy(false);}
  }
  return <section className="registration-page registration-verify" lang={language} dir={language==='ar'?'rtl':'ltr'}>
    <div className="registration-top"><button type="button" className="button subtle" onClick={onRegister}><ArrowLeft size={18}/>{t.back}</button><LanguageSwitch language={language} onLanguage={onLanguage}/></div>
    <div className="registration-sent">
      <div className="registration-icon">{phase==='verified'?<CheckCircle2 size={31}/>:phase==='unavailable'?<Mail size={30}/>:<ShieldCheck size={30}/>}</div>
      <h1 ref={heading} tabIndex={-1}>{phase==='verified'?t.verifiedTitle:phase==='unavailable'?t.unavailableTitle:phase==='uncertain'?t.uncertainTitle:t.verifyTitle}</h1>
      {phase==='idle' && <><p>{t.verifyLead}</p><p className="registration-note"><Clock3 size={18}/>{t.sentNote}</p><button type="button" className="button primary" disabled={busy} onClick={()=>void verify()}>{busy?t.verifying:t.verify}</button></>}
      {phase==='uncertain' && <><p>{t.uncertainBody}</p><p role="alert" className="public-error">{error}</p><button type="button" className="button primary" disabled={busy} onClick={()=>void verify()}><RefreshCw size={18}/>{t.retryVerify}</button><button type="button" className="button outline" onClick={onSignIn}><LogIn size={18}/>{t.signInShort}</button></>}
      {phase==='unavailable' && <><p>{t.unavailableBody}</p><div className="actions"><a className="button primary" href="#register">{t.newLink}<ArrowRight size={18}/></a><button type="button" className="button outline" onClick={onSignIn}><LogIn size={18}/>{t.signInShort}</button></div></>}
      {phase==='verified' && <><p role="status">{duplicate?t.verifiedDuplicate:t.verifiedLead}</p><p className="registration-note"><CheckCircle2 size={18}/>{t.verifiedTrial}</p><div className="registration-assurance"><ShieldCheck size={22}/><span>{language==='ar'?'لن تُنشأ جلسة تلقائياً من رابط البريد. سجّل الدخول بكلمة المرور.':'An email link never signs you in automatically. Continue with your password.'}</span></div><button type="button" className="button primary full" onClick={onSignIn}><LogIn size={18}/>{t.openSignIn}</button></>}
      {phase==='unavailable' && error && <p className="muted">{error}</p>}
    </div>
  </section>;
}
