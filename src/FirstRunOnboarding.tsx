import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowRight,CheckCircle2,Clock3,Globe2,Languages,RefreshCw,Users} from 'lucide-react';
import {useArtifactRead} from './useArtifactRead';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {checkedFirstRunResult,checkedFirstRunState,firstRunBody,suggestedTimezone,type FirstRunBody,type FirstRunLanguage,type FirstRunState} from './first-run';

const en={
  kicker:'Workspace setup',title:'Make this workspace yours',
  lead:'Two quick details, then you can add your team or create the first instruction.',
  siteName:'Site name',siteNameHint:'The location or team this workspace covers. One-site accounts do not need a site hierarchy.',
  timezone:'Site timezone',timezoneHint:'Used for deadlines and reports. Suggested from this browser; confirm it is correct.',
  language:'Staff interface language',languageHint:'Owners and supervisors can change this later. Workers choose their own language when they first sign in.',
  confirm:'I confirm the site name and timezone.',save:'Finish setup',saving:'Saving setup...',pending:'A previous setup save could not be confirmed. Retry the same details.',
  retry:'Retry unchanged setup',errorReload:'Reload setup',readyTitle:'Your workspace is ready',readyLead:'Add your team or create your first instruction.',
  addTeam:'Add your team',firstInstruction:'Create your first instruction',today:'Go to Today',
  completedNote:'Setup is already complete. Changes to the site name, timezone and staff language are available in Settings.',
  conflict:'Setup was already completed in another tab. Reload to see the saved details.',
  browserSuggestion:'Suggested from this browser. Check it before continuing.',noZones:'A valid timezone is required.',
};
const ar={
  kicker:'إعداد مساحة العمل',title:'اجعل مساحة العمل خاصة بفريقك',
  lead:'تفصيلان سريعان، ثم يمكنك إضافة فريقك أو إنشاء أول تعليمات.',
  siteName:'اسم الموقع',siteNameHint:'الموقع أو الفريق الذي تغطيه مساحة العمل. الحسابات ذات الموقع الواحد لا تحتاج إلى تنقل بين المواقع.',
  timezone:'المنطقة الزمنية للموقع',timezoneHint:'تُستخدم للمواعيد النهائية والتقارير. مقترحة من هذا المتصفح؛ أكّد صحتها.',
  language:'لغة واجهة الموظفين',languageHint:'يمكن للمالك والمشرفين تغييرها لاحقاً. يختار العمال لغتهم عند أول تسجيل دخول.',
  confirm:'أؤكد اسم الموقع والمنطقة الزمنية.',save:'إنهاء الإعداد',saving:'جارٍ حفظ الإعداد...',pending:'تعذّر تأكيد حفظ الإعداد السابق. أعد محاولة البيانات نفسها.',
  retry:'إعادة محاولة الإعداد نفسه',errorReload:'إعادة تحميل الإعداد',readyTitle:'مساحة عملك جاهزة',readyLead:'أضف فريقك أو أنشئ أول تعليمات.',
  addTeam:'إضافة فريقك',firstInstruction:'إنشاء أول تعليمات',today:'الانتقال إلى اليوم',
  completedNote:'اكتمل الإعداد بالفعل. يمكن تغيير اسم الموقع والمنطقة الزمنية ولغة الموظفين من الإعدادات.',
  conflict:'اكتمل الإعداد في نافذة أخرى. أعد التحميل لعرض البيانات المحفوظة.',
  browserSuggestion:'مقترحة من هذا المتصفح. تحقق منها قبل المتابعة.',noZones:'مطلوب منطقة زمنية صالحة.',
} satisfies Record<keyof typeof en,string>;
const copy:Record<FirstRunLanguage,typeof en>={en,ar};

function timezoneOptions(current:string) {
  let zones:string[]=[];
  try {zones=Intl.supportedValuesOf('timeZone');} catch {}
  return [...new Set(['UTC',current,...zones].filter(Boolean))];
}

export function FirstRunOnboarding({authority,refresh,onCompleted,onNavigate,onRefresh}:{authority:StaffRequestAuthority;refresh:number;onCompleted:(language:FirstRunLanguage)=>void;onNavigate:(path:string)=>void;onRefresh:()=>void}) {
  const [version,setVersion]=useState(0),heading=useRef<HTMLHeadingElement>(null),draft=useRef<FirstRunBody|null>(null),initialized=useRef('');
  const read=useArtifactRead<unknown>(authority,'/api/onboarding/first-run',refresh+version);
  const {request,current}=useStaffRequest(authority);
  let state:FirstRunState|null=null,readError=read.error;
  if(read.data){try{state=checkedFirstRunState(read.data);}catch(caught){readError=(caught as Error).message;}}
  const [language,setLanguage]=useState<FirstRunLanguage>('en'),[siteName,setSiteName]=useState(''),[timezone,setTimezone]=useState('UTC'),[confirmed,setConfirmed]=useState(false);
  const t=copy[language];
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[saved,setSaved]=useState<FirstRunLanguage|null>(null);
  useEffect(()=>{
    if(!state) return;
    const key=state.site.id;
    if(initialized.current===key) return;
    initialized.current=key;
    setLanguage(state.staffInterfaceLanguage);
    if(state.completed) return;
    setSiteName(state.site.name);setTimezone(suggestedTimezone(state.site.timezone));
  },[state]);
  useEffect(()=>{heading.current?.focus();},[read.loading]);
  const touch=()=>{draft.current=null;setConfirmed(false);setError('');setConflict(false);};
  async function save(event:FormEvent) {
    event.preventDefault();
    if(busy || !confirmed) return;
    let body=draft.current;
    if(!body) {
      try {body=firstRunBody({requestId:crypto.randomUUID(),siteName,timezone,staffInterfaceLanguage:language});}
      catch(caught) {setError((caught as Error).message);return;}
      draft.current=body;
    }
    setBusy(true);setError('');setConflict(false);
    try {
      const result=checkedFirstRunResult(await request('/api/onboarding/first-run',body));
      if(!current()) return;
      draft.current=null;setSaved(result.staffInterfaceLanguage);onCompleted(result.staffInterfaceLanguage);
    } catch(caught) {
      if(!current()) return;
      const failure=caught as Error,status=(failure as {status?:number}).status ?? null;
      setError(failure.message);
      if(status===409) {setConflict(true);draft.current=null;}
    } finally {if(current())setBusy(false);}
  }
  if(read.loading && !state) return <section className="first-run"><p role="status">{language==='ar'?'جارٍ تحميل إعداد مساحة العمل...':'Loading workspace setup...'}</p></section>;
  if(!state) return <section className="first-run" role="alert"><h1>{language==='ar'?'إعداد مساحة العمل غير متاح':'Workspace setup is unavailable'}</h1><p>{readError}</p><div className="actions"><button type="button" className="button outline" onClick={()=>{setVersion(value=>value+1);onRefresh();}}><RefreshCw size={18}/>{t.errorReload}</button></div></section>;
  const done=state.completed || saved!==null;
  return <section className="first-run" lang={language} dir={language==='ar'?'rtl':'ltr'}>
    <header className="first-run-heading"><span className="public-kicker">{t.kicker}</span><h1 ref={heading} tabIndex={-1}>{done?t.readyTitle:t.title}</h1><p>{done?t.readyLead:t.lead}</p></header>
    {done ? <div className="panel first-run-ready">
      <CheckCircle2 size={34}/>{state.completed && <p>{t.completedNote}</p>}
      <div className="actions"><button type="button" className="button primary" onClick={()=>onNavigate('people/new')}><Users size={18}/>{t.addTeam}</button><button type="button" className="button outline" onClick={()=>onNavigate('send')}><ArrowRight size={18}/>{t.firstInstruction}</button><button type="button" className="button subtle" onClick={()=>onNavigate('overview')}>{t.today}</button></div>
    </div> : <form className="panel first-run-form" onSubmit={save}>
      <div className="first-run-step"><Globe2 size={20}/><label className="field">{t.siteName}<input required minLength={2} maxLength={120} disabled={busy} value={siteName} onChange={event=>{setSiteName(event.target.value);touch();}}/></label><p className="field-hint">{t.siteNameHint}</p></div>
      <div className="first-run-step"><Clock3 size={20}/><label className="field">{t.timezone}<select disabled={busy} value={timezone} onChange={event=>{setTimezone(event.target.value);touch();}}>{timezoneOptions(timezone).map(zone=><option key={zone} value={zone}>{zone}</option>)}</select></label><p className="field-hint">{t.timezoneHint}</p></div>
      <div className="first-run-step"><Languages size={20}/><fieldset className="first-run-language"><legend>{t.language}</legend><label className="billing-confirm"><input type="radio" name="staff-language" checked={language==='en'} disabled={busy} onChange={()=>{setLanguage('en');touch();}}/><span>English</span></label><label className="billing-confirm"><input type="radio" name="staff-language" checked={language==='ar'} disabled={busy} onChange={()=>{setLanguage('ar');touch();}}/><span lang="ar">العربية</span></label></fieldset><p className="field-hint">{t.languageHint}</p></div>
      {error && <p role="alert" className="record-error">{error}{conflict && <> <button type="button" className="text-link" onClick={()=>{setVersion(value=>value+1);onRefresh();}}>{t.errorReload}</button></>}</p>}
      {draft.current && <p role="status" className="muted">{t.pending}</p>}
      <label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>{t.confirm}</span></label>
      <div className="actions"><button className="button primary" disabled={busy || !confirmed}>{busy?t.saving:draft.current?t.retry:t.save}<ArrowRight size={18}/></button></div>
    </form>}
  </section>;
}
