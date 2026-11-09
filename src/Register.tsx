import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {ArrowLeft,ArrowRight,Check,CheckCircle2,Clock3,LoaderCircle,LogIn,Mail,RefreshCw,ShieldCheck} from 'lucide-react';
import {isPaidPlan,PAID_PLANS,PLAN_NAMES,PILOT_DAYS} from '../server/pilot-policy.mjs';
import {countryOptions} from './country-options';
import {AuthLanguagePicker} from './AuthLanguagePicker';
import {staffSignInLanguages,staffSignInText} from './staff-signin-text';
import {acceptedRegistrationReceipt,clearRegistrationReceipt,checkedVerification,readRegistrationReceipt,requestAccount,resendAccount,RegistrationError,saveRegistrationReceipt,verifyAccount,verifyAccountCode,normalizeVerificationCode,registrationOptions,type RegistrationReceipt} from './registration';

export type RegistrationLanguage='en'|'ar';
type AccountBody=Parameters<typeof requestAccount>[0];
type RegistrationPlan=keyof typeof PLAN_NAMES;

const en={
  verifyIntro:'Enter the six-digit verification code for',verifyHint:'Use the code from the most recent email.',verifyDifferent:'Use a different email',verifyMissing:'Didn’t receive an email?',
  preparingEmail:'Preparing email verification',preparingEmailBody:'This may take a few seconds. Keep this tab open.',
  codeExpired:'This code has expired. Request a new code below.',codeLimited:'Too many attempts. Wait a few minutes before trying again.',codeService:'The verification service is temporarily unavailable. Please try again shortly.',
  codeLabel:'Verification code',codeHint:'Enter the six-digit code from your email. Codes expire; use the latest code or request another.',codeSent:'If this registration is eligible, a verification code has been requested for',codeResend:'Request another code',codeResent:'If this registration is still pending, a new code has been requested.',codeError:'The code could not be verified. Check the latest code and try again.',codeUnavailable:'Email verification is not configured or could not be checked. Please try again later.',codeNote:'Verify your email to finish setting up your account.',checkingVerification:'Checking email verification…',retryVerification:'Check again',
  kicker:'Company account',title:'Set up your company workspace',
  lead:'Enter your company details and verify your work email.',
  accountDetails:'Your account',companyDetails:'Company details',
  ownerName:'Full name',email:'Work email',password:'Password',passwordHint:'Use 12 to 256 characters. You can reset it from the sign-in page.',
  confirmPassword:'Confirm password',company:'Company name',country:'Operating country',selectCountry:'Select a country',
  phone:'Business phone (optional)',phoneHint:'For account follow-up only. Adding it never sends a message.',
  terms:'I agree to the Terms of Service and acknowledge the Privacy Notice.',
  submit:'Create company account',submitting:'Preparing account...',signIn:'Already have an account? Sign in',back:'Back to Understood',languageNote:'Choose the language for this signup screen.',
  deliveryNote:'We’ll send a verification email to finish setting up your account.',
  signedInTitle:'You are already signed in',signedInBody:'Registration creates a separate workspace. Sign out first if you need another account.',continue:'Continue to my workspace',
  unavailableEnvironment:'Online account creation is unavailable',unavailableEnvironmentBody:'This environment does not accept online registrations. Use an existing account, or open the public site for a pilot inquiry.',
  sentTitle:'Check your email',sentBody:'If these details can start a new workspace, we sent a verification link to',sentPrivacy:'For privacy, we show this message whether or not an account already exists.',
  sentNote:'The verification link expires in 24 hours.',resend:'Resend verification email',resending:'Sending...',
  resent:'If this registration is still waiting for verification, a new link has been sent. Earlier links may stop working.',
  unconfirmed:'The result could not be confirmed. Retry the same registration before starting over.',retry:'Retry the same registration',
  startOver:'Start a different registration',dismiss:'Dismiss',passwordMismatch:'The passwords do not match.',storage:'This browser could not keep a registration receipt. Keep this tab open until the result is confirmed.',
  verifyTitle:'Verify your work email',verifyLead:'Confirm your email to prepare your workspace. Pilot access remains read-only until approval.',verify:'Verify work email',verifying:'Verifying...',
  verifiedTitle:'Email verified',verifiedLead:'Sign in with your password to check your workspace access.',verifiedDuplicate:'This link was already used. Sign in to open your workspace.',
  verifiedTrial:'Workspace access opens once your pilot is approved or your paid plan is activated.',openSignIn:'Sign in to continue',
  unavailableTitle:'This link is unavailable',unavailableBody:'It may have expired, been replaced, or already been used. Sign in if your account is active, or request a new link from the registration page.',newLink:'Request a new link',
  uncertainTitle:'Verification not confirmed',uncertainBody:'The result could not be confirmed. Retry this same link before signing in.',retryVerify:'Retry verification',signInShort:'Sign in',
};
const ar={
  verifyIntro:'أدخل رمز التحقق المكوّن من ستة أرقام للبريد',verifyHint:'استخدم الرمز من أحدث رسالة وصلتك.',verifyDifferent:'استخدام بريد مختلف',verifyMissing:'لم تصلك رسالة؟',
  preparingEmail:'جارٍ تجهيز التحقق من البريد',preparingEmailBody:'قد يستغرق ذلك بضع ثوانٍ. أبقِ هذه النافذة مفتوحة.',
  codeExpired:'انتهت صلاحية هذا الرمز. اطلب رمزاً جديداً أدناه.',codeLimited:'محاولات كثيرة. انتظر بضع دقائق قبل المحاولة مجدداً.',codeService:'خدمة التحقق غير متاحة مؤقتاً. حاول مجدداً بعد قليل.',
  codeLabel:'رمز التحقق',codeHint:'أدخل الرمز المكوّن من ستة أرقام من بريدك. تنتهي صلاحية الرموز؛ استخدم أحدث رمز أو اطلب رمزاً آخر.',codeSent:'إذا كان التسجيل مؤهلاً، فقد طُلب إرسال رمز تحقق إلى',codeResend:'طلب رمز آخر',codeResent:'إذا كان التسجيل ما زال معلقاً، فقد طُلب رمز جديد.',codeError:'تعذّر التحقق من الرمز. راجع أحدث رمز وحاول مجدداً.',codeUnavailable:'التحقق من البريد غير مضبوط أو تعذّر فحصه. حاول لاحقاً.',codeNote:'تحقق من بريدك لإكمال إعداد حسابك.',checkingVerification:'جارٍ فحص التحقق من البريد…',retryVerification:'إعادة الفحص',
  kicker:'حساب الشركة',title:'جهّز مساحة عمل شركتك',
  lead:'أدخل بيانات شركتك وتحقق من بريد العمل.',
  accountDetails:'حسابك',companyDetails:'بيانات الشركة',
  ownerName:'الاسم الكامل',email:'بريد العمل',password:'كلمة المرور',passwordHint:'استخدم من 12 إلى 256 حرفاً. يمكنك إعادة تعيينها من صفحة تسجيل الدخول.',
  confirmPassword:'تأكيد كلمة المرور',company:'اسم الشركة',country:'بلد التشغيل',selectCountry:'اختر بلداً',
  phone:'هاتف العمل (اختياري)',phoneHint:'للمتابعة المتعلقة بالحساب فقط. إضافته لا ترسل أي رسالة.',
  terms:'أوافق على شروط الخدمة وأقرّ بإشعار الخصوصية.',
  submit:'إنشاء حساب الشركة',submitting:'جارٍ تجهيز الحساب...',signIn:'لديك حساب بالفعل؟ سجّل الدخول',back:'العودة إلى Understood',languageNote:'اختر لغة شاشة التسجيل.',
  deliveryNote:'سنرسل رسالة تحقق لإكمال إعداد حسابك.',
  signedInTitle:'أنت مسجّل الدخول بالفعل',signedInBody:'ينشئ التسجيل مساحة عمل منفصلة. سجّل الخروج أولاً إذا كنت تحتاج إلى حساب آخر.',continue:'المتابعة إلى مساحة عملي',
  unavailableEnvironment:'التسجيل عبر الإنترنت غير متاح',unavailableEnvironmentBody:'لا تقبل هذه البيئة التسجيلات عبر الإنترنت. استخدم حساباً موجوداً، أو افتح الموقع العام لتقديم طلب تجريبي.',
  sentTitle:'تحقق من بريدك',sentBody:'إذا كانت هذه البيانات صالحة لبدء مساحة عمل جديدة، فقد أرسلنا رابط تحقق إلى',sentPrivacy:'حفاظاً على الخصوصية، تظهر هذه الرسالة سواء كان الحساب موجوداً أم لا.',
  sentNote:'تنتهي صلاحية رابط التحقق خلال 24 ساعة.',resend:'إعادة إرسال رسالة التحقق',resending:'جارٍ الإرسال...',
  resent:'إذا كان هذا التسجيل ما زال بانتظار التحقق، فقد أُرسل رابط جديد. قد تتوقف الروابط السابقة عن العمل.',
  unconfirmed:'تعذّر تأكيد النتيجة. أعد محاولة التسجيل نفسه قبل البدء من جديد.',retry:'إعادة محاولة التسجيل نفسه',
  startOver:'بدء تسجيل مختلف',dismiss:'إغلاق',passwordMismatch:'كلمتا المرور غير متطابقتين.',storage:'تعذّر على هذا المتصفح حفظ إيصال التسجيل. أبقِ هذه النافذة مفتوحة حتى تأكيد النتيجة.',
  verifyTitle:'تحقق من بريد العمل',verifyLead:'تحقق من البريد لتجهيز مساحة العمل. تبقى صلاحيات البرنامج للقراءة فقط حتى الموافقة.',verify:'تحقق من بريد العمل',verifying:'جارٍ التحقق...',
  verifiedTitle:'تم التحقق من البريد',verifiedLead:'سجّل الدخول بكلمة المرور لمراجعة الوصول إلى مساحة العمل.',verifiedDuplicate:'استُخدم هذا الرابط سابقاً. سجّل الدخول لفتح مساحة عملك.',
  verifiedTrial:'يتاح الوصول عند الموافقة على البرنامج التجريبي أو تفعيل خطتك المدفوعة.',openSignIn:'سجّل الدخول للمتابعة',
  unavailableTitle:'هذا الرابط غير متاح',unavailableBody:'قد يكون منتهي الصلاحية أو مستبدلاً أو مستخدماً سابقاً. سجّل الدخول إذا كان حسابك نشطاً، أو اطلب رابطاً جديداً من صفحة التسجيل.',newLink:'طلب رابط جديد',
  uncertainTitle:'لم يتم تأكيد التحقق',uncertainBody:'تعذّر تأكيد النتيجة. أعد محاولة الرابط نفسه قبل تسجيل الدخول.',retryVerify:'إعادة محاولة التحقق',signInShort:'تسجيل الدخول',
} satisfies {[K in keyof typeof en]:typeof en[K]};
const copy:Record<RegistrationLanguage,typeof en>={en,ar};
const registrationLanguages=staffSignInLanguages.filter(option=>option.code!=='ur');

function LanguageSwitch({language,onLanguage,disabled}:{language:RegistrationLanguage;onLanguage:(value:RegistrationLanguage)=>void;disabled?:boolean}) {
  return <div className="segmented-control registration-languages" role="group" aria-label="Language"><button type="button" aria-pressed={language==='en'} disabled={disabled} onClick={()=>onLanguage('en')}>English</button><button type="button" aria-pressed={language==='ar'} disabled={disabled} onClick={()=>onLanguage('ar')}>العربية</button></div>;
}
function AccessChoice({language,onChoose,onClose}:{language:RegistrationLanguage;onChoose:(plan:RegistrationPlan)=>void;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),[paid,setPaid]=useState(false);
  const t=(en:string,ar:string)=>language==='ar'?ar:en;
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  return <dialog ref={dialog} className="sign-out-confirmation registration-access-choice" aria-labelledby="registration-access-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <h2 id="registration-access-title">{t('How would you like to get started?','كيف ترغب في البدء؟')}</h2>
    {paid?<><p>{t('Choose a plan. We’ll arrange billing and activate it with you.','اختر خطة وسنتواصل معك لترتيب الفوترة وتفعيلها.')}</p>
      <div className="registration-access-options">{PAID_PLANS.map(plan=><button className="button outline" type="button" key={plan} onClick={()=>onChoose(plan)}>{PLAN_NAMES[plan]}<ArrowRight size={16}/></button>)}</div>
      <button className="button subtle" type="button" onClick={()=>setPaid(false)}>{t('Back','رجوع')}</button>
    </>:<><div className="registration-access-options">
      <button type="button" className="button outline" onClick={()=>onChoose('pilot')}><span><strong>{t(`Request a ${PILOT_DAYS}-day pilot`,`اطلب تجربة لمدة ${PILOT_DAYS} يوماً`)}</strong><small>{t('Try Understood with one site and up to 25 workers.','جرّب Understood في موقع واحد مع ما يصل إلى 25 عاملاً.')}</small></span><ArrowRight size={16}/></button>
      <button type="button" className="button outline" onClick={()=>setPaid(true)}><span><strong>{t('Choose a paid plan','اختر خطة مدفوعة')}</strong><small>{t('Go straight to Pro, Business or Enterprise.','ابدأ مباشرة مع Pro أو Business أو Enterprise.')}</small></span><ArrowRight size={16}/></button>
    </div><button className="button subtle" type="button" onClick={onClose}>{t('Close','إغلاق')}</button></>}
  </dialog>;
}

export function RegistrationPage({language,onLanguage,onBack,onSignIn,onOpenWorkspace,authenticated,available,initialPlan}:{initialPlan?:string;language:RegistrationLanguage;onLanguage:(value:RegistrationLanguage)=>void;onBack:()=>void;onSignIn:()=>void;onOpenWorkspace:()=>void;authenticated:boolean;available:boolean|null}) {
  const t=copy[language],heading=useRef<HTMLHeadingElement>(null),sending=useRef(false);
  const Back=language==='ar'?ArrowRight:ArrowLeft,Forward=language==='ar'?ArrowLeft:ArrowRight;
  const countries=useMemo(()=>{
    let names:Intl.DisplayNames|undefined;
    try {names=new Intl.DisplayNames([language],{type:'region'});} catch {}
    return countryOptions.map(([code,name])=>({code,label:names?.of(code)||name})).sort((a,b)=>a.label.localeCompare(b.label,language));
  },[language]);
  const [plan,setPlan]=useState<RegistrationPlan|null>(isPaidPlan(initialPlan)?initialPlan:null),[choosingPlan,setChoosingPlan]=useState(false);
  const [receipt,setReceipt]=useState<RegistrationReceipt|null>(null),[pending,setPending]=useState<{receipt:RegistrationReceipt;body:AccountBody}|null>(null);
  const [ownerName,setOwnerName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState('');
  const [company,setCompany]=useState(''),[country,setCountry]=useState(''),[phone,setPhone]=useState(''),[terms,setTerms]=useState(false);
  const [operation,setOperation]=useState<'register'|'resend'|'verify'|null>(null);
  const busy=operation!==null;
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[storageError,setStorageError]=useState(false);
  const [verificationCheck,setVerificationCheck]=useState(0);
  const [method,setMethod]=useState<'link'|'neon-code'>('link'),[verificationReady,setVerificationReady]=useState<boolean|null>(null),[code,setCode]=useState(''),[codeComplete,setCodeComplete]=useState(false);
  useEffect(()=>{setVerificationReady(null);const controller=new AbortController();void registrationOptions(controller.signal).then(value=>{setMethod(value.verification);setVerificationReady(value.available);}).catch(()=>{if(!controller.signal.aborted)setVerificationReady(false);});return()=>controller.abort();},[verificationCheck]);
  useEffect(()=>{try{const saved=readRegistrationReceipt(sessionStorage);if(saved)setReceipt(saved);else if(!isPaidPlan(initialPlan))setChoosingPlan(true);}catch{setStorageError(true);}},[initialPlan]);
  const preparing=available===null || operation==='register';
  useEffect(()=>{if(preparing||receipt||codeComplete)heading.current?.focus();},[receipt,codeComplete,preparing]);
  async function send(body:AccountBody,value:RegistrationReceipt) {
    sending.current=true;setOperation('register');setError('');setNotice('');
    try {
      try {saveRegistrationReceipt(sessionStorage,{...value,state:'pending'});} catch {setStorageError(true);}
      const result=await requestAccount(body);
      if(result.accepted!==true) throw new RegistrationError('Account creation could not be confirmed. Retry the same registration.',null,true);
      const accepted=acceptedRegistrationReceipt(value,result);
      try {saveRegistrationReceipt(sessionStorage,accepted);} catch {setStorageError(true);}
      setReceipt(accepted);setPending(null);setPassword('');setConfirmPassword('');
    } catch(caught) {
      const failure=caught as Error;
      const status=caught instanceof RegistrationError?caught.status:null;
      if(status===400 || status===403 || status===404) {
        try {clearRegistrationReceipt(sessionStorage);} catch {setStorageError(true);}
        setReceipt(null);setPending(null);
      }
      setError(failure.message);
    } finally {
      sending.current=false;setOperation(null);
    }
  }
  function submit(event:FormEvent) {
    event.preventDefault();
    if(sending.current || busy) return;
    if(!plan){setChoosingPlan(true);return;}
    if(password!==confirmPassword) {setError(t.passwordMismatch);return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {setError(language==='ar'?'أدخل بريد عمل صالحاً.':'Enter a valid work email.');return;}
    const requestId=crypto.randomUUID(),normalized=email.trim().toLowerCase();
    const body:AccountBody={requestId,ownerName:ownerName.trim(),email:normalized,password,companyName:company.trim(),country,plan,
      ...(phone.trim()?{phone:phone.trim()}:{}),acceptTerms:true,acceptPrivacy:true};
    const value:RegistrationReceipt={requestId,email:normalized,createdAt:new Date().toISOString(),state:'pending'};
    setReceipt(value);setPending({receipt:value,body});
    void send(body,value);
  }
  async function resend() {
    if(!receipt || sending.current) return;
    sending.current=true;setOperation('resend');setError('');setNotice('');
    try {const result=await resendAccount({requestId:receipt.requestId,email:receipt.email});const updated:RegistrationReceipt={...receipt,verification:result.verification==='neon-code'?'neon-code':'link'};setReceipt(updated);try{saveRegistrationReceipt(sessionStorage,updated);}catch{setStorageError(true);}setCode('');setNotice(updated.verification==='neon-code'?t.codeResent:t.resent);}
    catch(caught) {setError((caught as Error).message);}
    finally {sending.current=false;setOperation(null);}
  }
  async function verifyCode(event:FormEvent){
    event.preventDefault();if(!receipt||sending.current||code.length!==6)return;
    sending.current=true;setOperation('verify');setError('');setNotice('');
    try{checkedVerification(await verifyAccountCode(receipt,code));try{clearRegistrationReceipt(sessionStorage);}catch{setStorageError(true);}setCode('');setCodeComplete(true);}
    catch(caught){const code=caught instanceof RegistrationError?caught.code:null;setError(code==='REGISTRATION_CODE_EXPIRED'?t.codeExpired:code==='REGISTRATION_CODE_RATE_LIMITED'?t.codeLimited:code==='REGISTRATION_PROVIDER_UNAVAILABLE'?t.codeService:t.codeError);}
    finally{sending.current=false;setOperation(null);}
  }
  function startOver() {
    try {clearRegistrationReceipt(sessionStorage);} catch {setStorageError(true);}
    setReceipt(null);setPending(null);setCode('');setCodeComplete(false);setError('');setNotice('');setPassword('');setConfirmPassword('');setTerms(false);
  }
  const header=<>
    <div className="registration-top">
      <button type="button" className="button subtle" disabled={busy} onClick={onBack}><Back size={17} aria-hidden="true"/>{t.back}</button>
    </div>
    <AuthLanguagePicker label={staffSignInText[language].language} note={t.languageNote} name="registration-language" value={language} options={registrationLanguages} disabled={busy} onChange={onLanguage}/>
  </>;
  if(authenticated) return <section className="registration-page" lang={language} dir={language==='ar'?'rtl':'ltr'}>
    {header}
    <div className="registration-intro"><span className="public-kicker">{t.kicker}</span><h1>{t.signedInTitle}</h1><p>{t.signedInBody}</p></div>
    <div className="actions"><button type="button" className="button primary" onClick={onOpenWorkspace}><ArrowRight size={18}/>{t.continue}</button></div>
  </section>;
  if(available===false) return <section className="registration-page" lang={language} dir={language==='ar'?'rtl':'ltr'}>
    {header}
    <div className="registration-sent"><div className="registration-icon"><ShieldCheck size={30}/></div><h1>{t.unavailableEnvironment}</h1><p>{t.unavailableEnvironmentBody}</p><div className="actions"><button type="button" className="button outline" onClick={onSignIn}><LogIn size={18}/>{t.signInShort}</button><a className="button subtle" href="#pilot">{t.back}</a></div></div>
  </section>;
  return <section className={`registration-page ${preparing||receipt||codeComplete?'registration-email-step':'registration-start'}`} lang={language} dir={language==='ar'?'rtl':'ltr'}>
    {header}
    {preparing?<div className="registration-sent registration-verification registration-email-loading">
      <LoaderCircle className="verification-spinner" size={28} aria-hidden="true"/>
      <div role="status"><h1 ref={heading} tabIndex={-1}>{t.preparingEmail}</h1><p>{t.preparingEmailBody}</p></div>
    </div>:codeComplete?<div className="registration-sent registration-verification registration-email-success">
      <CheckCircle2 className="verification-status-icon" size={28} aria-hidden="true"/>
      <h1 ref={heading} tabIndex={-1}>{t.verifiedTitle}</h1><p>{t.verifiedLead}</p>
      <button type="button" className="button primary full" onClick={onSignIn}>{t.openSignIn}<Forward size={16} aria-hidden="true"/></button>
    </div>:receipt?.state==='accepted'&&receipt.verification==='neon-code'?<div className="registration-sent registration-verification">
      <Mail className="verification-status-icon" size={26} aria-hidden="true"/>
      <h1 ref={heading} tabIndex={-1}>{t.sentTitle}</h1>
      <p className="verification-recipient">{t.verifyIntro}<bdi dir="ltr">{receipt.email}</bdi></p>
      <form className="registration-code-form" onSubmit={verifyCode}>
        <label className="field" htmlFor="registration-code">{t.codeLabel}</label>
        <input id="registration-code" className="verification-code-input" aria-describedby={`verification-code-hint${error?' verification-code-error':''}`} aria-invalid={!!error} required inputMode="numeric" autoComplete="one-time-code" dir="ltr" minLength={6} maxLength={6} pattern="[0-9]{6}" placeholder="······" value={code} disabled={busy} onChange={event=>{setCode(normalizeVerificationCode(event.target.value));setError('');}}/>
        <p id="verification-code-hint" className="verification-hint">{t.verifyHint}</p>
        {error&&<p id="verification-code-error" role="alert" className="verification-error">{error}</p>}
        <button type="submit" className="button primary full" disabled={busy||code.length!==6}>{operation==='verify'?t.verifying:t.verify}<Forward size={16} aria-hidden="true"/></button>
      </form>
      <div className="verification-resend"><span>{t.verifyMissing}</span><button type="button" className="text-link" disabled={busy} onClick={()=>void resend()}>{operation==='resend'?t.resending:t.codeResend}</button></div>
      {notice&&<p role="status" className="verification-status"><Check size={15}/>{t.codeResent}</p>}
      <div className="verification-footer"><button type="button" className="text-link" disabled={busy} onClick={startOver}>{t.verifyDifferent}</button><button type="button" className="text-link" disabled={busy} onClick={onSignIn}>{t.signIn}<Forward size={16} aria-hidden="true"/></button></div>
      {storageError&&<p className="verification-hint">{t.storage}</p>}
    </div>:receipt ? <div className="registration-sent">
      <div className="registration-icon">{receipt.state==='accepted'?<Mail size={30}/>:<RefreshCw size={30}/>}</div>
      <h1 ref={heading} tabIndex={-1}>{receipt.state==='accepted'?t.sentTitle:language==='ar'?'لم يتم تأكيد التسجيل':'Registration not confirmed'}</h1>
      {receipt.state==='accepted'?
        <><p>{receipt.verification==='neon-code'?t.codeSent:t.sentBody} <bdi dir="ltr">{receipt.email}</bdi>.</p><p className="muted">{t.sentPrivacy}</p><p className="registration-note"><Clock3 size={18}/>{receipt.verification==='neon-code'?t.codeHint:t.sentNote}</p></>:
        <><p>{pending?t.unconfirmed:language==='ar'?'تعذّر تأكيد نتيجة التسجيل. إذا لم تصلك رسالة، ابدأ تسجيلاً جديداً بالبيانات نفسها.':'The registration result could not be confirmed. If no email arrives, start a new registration with the same details.'}</p></>}
      {receipt.state==='accepted'&&receipt.verification==='neon-code'&&<form className="registration-code-form" onSubmit={verifyCode}><label className="field">{t.codeLabel}<input required inputMode="numeric" autoComplete="one-time-code" dir="ltr" minLength={6} maxLength={6} pattern="[0-9]{6}" value={code} disabled={busy} onChange={event=>setCode(normalizeVerificationCode(event.target.value))}/></label><button type="submit" className="button primary full" disabled={busy||code.length!==6}>{busy?t.verifying:t.verify}</button></form>}
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
      <header className="registration-intro"><span className="public-kicker">{t.kicker}</span><h1>{t.title}</h1><p>{t.lead}</p></header>
      {choosingPlan&&<AccessChoice language={language} onClose={()=>setChoosingPlan(false)} onChoose={choice=>{setPlan(choice);setChoosingPlan(false);}}/>}
      <form className="registration-form" onSubmit={submit}>
        <div className="registration-selected-plan"><div><small>{language==='ar'?'الوصول إلى مساحة العمل':'Workspace access'}</small><strong>{plan==='pilot'?(language==='ar'?'برنامج تجريبي لمدة 14 يوماً':'14-day pilot'):plan?PLAN_NAMES[plan]:(language==='ar'?'اختر خياراً':'Choose how to start')}</strong></div><button type="button" className="button outline" disabled={busy} onClick={()=>setChoosingPlan(true)}>{plan?(language==='ar'?'تغيير':'Change'):(language==='ar'?'اختيار':'Choose')}</button></div>
        <fieldset className="registration-group">
          <legend>{t.accountDetails}</legend>
          <div className="registration-fields">
            <label className="field">{t.ownerName}<input name="name" required minLength={2} maxLength={100} autoComplete="name" dir="auto" value={ownerName} disabled={busy} onChange={event=>setOwnerName(event.target.value)}/></label>
            <label className="field">{t.email}<input name="email" required type="email" maxLength={254} autoComplete="email" dir="ltr" value={email} disabled={busy} onChange={event=>setEmail(event.target.value)}/></label>
            <div className="registration-field-with-hint">
              <label className="field">{t.password}<input name="password" required type="password" minLength={12} maxLength={256} autoComplete="new-password" aria-describedby="registration-password-hint" dir="ltr" value={password} disabled={busy} onChange={event=>setPassword(event.target.value)}/></label>
              <p id="registration-password-hint" className="field-hint">{t.passwordHint}</p>
            </div>
            <label className="field">{t.confirmPassword}<input name="confirmPassword" required type="password" minLength={12} maxLength={256} autoComplete="new-password" dir="ltr" value={confirmPassword} disabled={busy} onChange={event=>setConfirmPassword(event.target.value)}/></label>
          </div>
        </fieldset>
        <fieldset className="registration-group">
          <legend>{t.companyDetails}</legend>
          <div className="registration-fields">
            <label className="field registration-field-wide">{t.company}<input name="organization" required minLength={2} maxLength={120} autoComplete="organization" dir="auto" value={company} disabled={busy} onChange={event=>setCompany(event.target.value)}/></label>
            <label className="field">{t.country}<select name="country" autoComplete="country" required value={country} disabled={busy} onChange={event=>setCountry(event.target.value)}><option value="">{t.selectCountry}</option>{countries.map(({code,label})=><option key={code} value={code}>{label}</option>)}</select></label>
            <div className="registration-field-with-hint">
              <label className="field">{t.phone}<input name="phone" type="tel" maxLength={30} autoComplete="tel" aria-describedby="registration-phone-hint" dir="ltr" value={phone} disabled={busy} onChange={event=>setPhone(event.target.value)}/></label>
              <p id="registration-phone-hint" className="field-hint">{t.phoneHint}</p>
            </div>
          </div>
        </fieldset>
        <div className="registration-submit">
          <label className="billing-confirm registration-terms"><input type="checkbox" required checked={terms} disabled={busy} onChange={event=>setTerms(event.target.checked)}/><span>{t.terms}</span></label>
          {error&&<p role="alert" className="public-error">{error}</p>}
          {verificationReady===null&&<p role="status" className="registration-environment">{t.checkingVerification}</p>}
          {verificationReady===false&&<div className="registration-unavailable"><p role="status" className="public-error">{t.codeUnavailable}</p><button type="button" className="text-link" onClick={()=>setVerificationCheck(value=>value+1)}><RefreshCw size={16} aria-hidden="true"/>{t.retryVerification}</button></div>}
          <button className="button primary full" type="submit" disabled={busy || !terms || verificationReady!==true}>{busy?t.submitting:t.submit}<Forward size={18} aria-hidden="true"/></button>
          {verificationReady===true&&<p className="registration-environment"><Mail size={16} aria-hidden="true"/>{method==='neon-code'?t.codeNote:t.deliveryNote}</p>}
        </div>
        <button type="button" className="text-link registration-signin" disabled={busy} onClick={onSignIn}>{t.signIn}</button>
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
