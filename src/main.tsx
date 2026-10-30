import {InterfaceLanguagePicker} from './InterfaceLanguagePicker';
import {StaffLanguageContext} from './staff-language';
import InstructionLibrary from './InstructionLibrary';
import {InstructionFiles,StaffInstructionFiles} from './InstructionFiles';
import {WorkerWorkProgress} from './WorkProgress';
import {InstructionOverview} from './InstructionOverview';
import {DashboardSidebar} from './DashboardSidebar';
import {SessionConnectionNotice} from './SessionConnectionNotice';
import {workerChoicePrompt} from './worker-choice-text';
import {NotificationBell} from './NotificationBell';
import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Bell, Check, CheckCircle2, ChevronDown, ChevronLeft,ChevronRight, Clock3,
  Eye, EyeOff,PanelLeft,Pencil,
  FileText, HelpCircle, Home, Languages, LogOut, MessageCircle, Plus,
  Search, Send, Settings, Sparkles, TriangleAlert, Users, Volume2, X,
  BarChart3, Download, Play, RefreshCw, ShieldCheck,KeyRound,Smartphone,
} from 'lucide-react';
import './styles.css';
import {isPublicLandingView} from './public-navigation';
import { WorkerRecorderView } from './WorkerRecorderView';
import { WorkerPresentationView } from './WorkerPresentationView';
import {WorkerDeviceView} from './WorkerDeviceView';
const WorkerAccessEntry=lazy(()=>import('./WorkerAccessEntry').then(module=>({default:module.WorkerAccessEntry})));
const AuthLayout=lazy(()=>import('./AuthLayout').then(module=>({default:module.AuthLayout})));
import {WorkerHelpHub} from './WorkerHelpHub';
import {WorkerNotifications} from './WorkerNotifications';
import {workerNotificationText} from './worker-notifications';
import {WorkerAudioPlayer} from './WorkerAudioPlayer';
import {workerInboxPath,workerNavigationText,type WorkerInboxTab} from './worker-navigation';
import {readWorkerUiLanguage,readWorkerLockLanguage,saveWorkerUiLanguage,workerBrowserLanguage,workerUiDirection,workerUiFallbackLanguage,workerUiLanguageText,workerUiLanguages,workerUiNativeName,type WorkerUiLanguage} from './worker-ui-language';
import {workerLeaveRequired,workerLeaveText,workerNavigationDecision,retainWorkerDetail,workerRefreshText,workerInputAvailability,type WorkerLeaveAction} from './worker-unsent';
import {keepDialogFocus} from './dialog-focus';
import {useWorkerSessionGuard} from './useWorkerSessionGuard';
import {workerSessionText,sessionLoadText,validWorkerSession,validStaffSession,sameStaffSession,validPageSession,type PageSession} from './session-state';
import {StaffSessionLock} from './StaffSessionLock';
import {workerRequestId,WorkerRequestError,workerRequestText,checkedWorkerReceipt,readWorkerRequestReceipt,workerReceiptCheckText} from './worker-request';
import {WorkerTextDraftView} from './WorkerTextDraftView';
import {WorkerAudioDraftView} from './WorkerAudioDraftView';
import {BootstrapSessionError,fetchBootstrapSession,reconcileOfflineSession} from './worker-offline';
import {WorkerOfflineEntryView,WorkerOfflineSaveView} from './WorkerOfflineView';
import {clearWorkerLocalData,localCleanupText} from './worker-local-data';
import {usePrivateDevice} from './usePrivateDevice';
import {sendWorkerRecording,WorkerAudioRetryError,workerAudioRetryText} from './worker-audio-retry';
import { PeoplePage,CreateCrewPage,LanguageRequestsPage } from './People';
import SiteCrews from './SiteCrews';
import {peopleRouteLocale,peopleShellText,type PeopleLocale} from './people-locale';
import {clarificationRoute,caseReason,caseText,type CaseLocale} from './clarification-locale';
import {reportsRoute,reportText,type ReportLocale} from './report-locale';
import {staffIdentityLabel} from './session-state';
import {StaffSearchBox} from './StaffSearchBox';
import DraftSteps from './DraftSteps';
import {draftSteps,type DraftStep} from './draft-flow';
const StaffSearch=lazy(()=>import('./StaffSearch'));
const BillingPage=lazy(()=>import('./Billing').then(module=>({default:module.BillingPage})));
import {WorkspaceSettings} from './WorkspaceSettings';
import { WorkerImportPage } from './WorkerImport';
const ClarificationsPage=lazy(()=>import('./Clarifications').then(module=>({default:module.ClarificationsPage})));
const ClarificationPage=lazy(()=>import('./Clarifications').then(module=>({default:module.ClarificationPage})));
const ClarificationCreate=lazy(()=>import('./ClarificationCreate'));
import {DraftEditor,CopyDraftControl,ArchiveBriefingControl,useBriefingRequest} from './BriefingControls';
import {PreparationRequest} from './PreparationRequest';
import type {StaffRequestAuthority} from './useStaffRequest';
import {staffRequestBinding} from './staff-request';
import {useArtifactRead} from './useArtifactRead';
import {appStaffAction,checkedPreparationAcknowledgement} from './app-staff-action';
const PublishForm=lazy(()=>import('./PublishForm'));
const SendInstruction=lazy(()=>import('./SendInstruction'));
const NewBriefing=lazy(()=>import('./NewBriefing'));
const PublicProduct=lazy(()=>import('./PublicProduct'));
const Onboarding=lazy(()=>import('./Onboarding'));
const Operations=lazy(()=>import('./Operations'));
const SourceAudioUploads=lazy(()=>import('./SourceAudioUploads'));
const PublicationRecovery=lazy(()=>import('./PublicationRecovery'));
const PublicationSchedules=lazy(()=>import('./PublicationSchedules'));
import { PublicationResponses,ResponseDetail } from './PublicationResponses';
import {checkedProcessingJob,checkedProcessingPage,processingKinds,processingKindLabels,type ProcessingJob,type ProcessingPage,type ProcessingProgress} from './processing-state';
import {ProcessingRetry} from './ProcessingRetry';
import {ProcessingProvenance} from './ProcessingProvenance';
import {ProcessingSourceRetry} from './ProcessingSourceRetry';
import {PublicationHistory} from './PublicationHistory';
import type {PublicationSummary} from './publication-history';
import { WorkerSubmissions } from './WorkerSubmissions';
import {WorkerSubmissionReceipt} from './WorkerSubmissionReceipt';
import { canManageStaff,staffDate,staffGreeting } from './staff-policy';
import { WorkerHelpHistory, workerStatusText, workerVersionText } from './WorkerHelpHistory';
import {CaseVoiceRecorder} from './CaseVoiceRecorder';
import type {RecordingLanguage} from './recording-notice';
import {readWorkerRecordingNotice,WorkerRecordingNoticeError} from './worker-recording-notice';
import { workerResponseState, type WorkerResponse } from './worker-state.ts';
import { workerAccessToken } from './worker-access';
import {prepareWorkerEntry,readPendingWorkerEntry,savePendingWorkerEntry,clearPendingWorkerEntry,recoverWorkerEntry,type PendingWorkerEntry} from './worker-entry-recovery';
import WorkerEntryRecovery from './WorkerEntryRecovery';
const LanguageArtifacts=lazy(()=>import('./LanguageArtifacts').then(module=>({default:module.LanguageArtifacts})));
const LanguageReadiness=lazy(()=>import('./LanguageReadiness').then(module=>({default:module.LanguageReadiness})));
const PlanUsage=lazy(()=>import('./PlanUsage').then(module=>({default:module.PlanUsage})));
const Notifications=lazy(()=>import('./Notifications').then(module=>({default:module.Notifications})));
const ReportsPage=lazy(()=>import('./Reports').then(module=>({default:module.ReportsPage})));
const RetentionSettings=lazy(()=>import('./RetentionSettings').then(module=>({default:module.RetentionSettings})));
import {DraftReview,DraftReviewRecovery,useReviewRecovery} from './DraftReview';
import DraftLanguages from './DraftLanguages';
import type {LanguageSession} from './draft-languages-recovery';
import {readPendingRegeneration} from './regeneration-recovery';
import {readPendingPublication,type PendingPublication} from './publication-recovery';
const RegenerationRecovery=lazy(()=>import('./Regeneration').then(module=>({default:module.RegenerationRecovery})));
class BriefingView extends React.Component<{children:React.ReactNode;label?:string;language?:CaseLocale;fallbackCopy?:{loading:string;unavailable:string;reload:string}},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError() {return {failed:true};}
  render() {
    const copy=this.props.fallbackCopy;
    if(copy)return this.state.failed?<section role="alert"><h2>{copy.unavailable}</h2><button className="button outline" onClick={()=>location.reload()}><RefreshCw size={18}/>{copy.reload}</button></section>:<Suspense fallback={<p role="status">{copy.loading}</p>}>{this.props.children}</Suspense>;
    if(this.props.language){const language=this.props.language;return this.state.failed?<section role="alert"><h2>{caseText(language,'Clarification page unavailable. Your saved requests are unchanged.')}</h2><button className="button outline" onClick={()=>location.reload()}><RefreshCw size={18}/>{caseText(language,'Reload')}</button></section>:<Suspense fallback={<p role="status">{caseText(language,'Loading clarification page...')}</p>}>{this.props.children}</Suspense>;}
    return this.state.failed ? <section role="alert"><h2>{this.props.label || 'Instruction view'} unavailable</h2><p>Reload to retry loading the view. Pending requests remain saved in this tab.</p><button className="button outline" onClick={()=>location.reload()}><RefreshCw size={18}/>Reload</button></section> : <Suspense fallback={<p role="status">Loading {this.props.label || 'instruction view'}...</p>}>{this.props.children}</Suspense>;
  }
}
import {Glossary} from './Glossary';
import {StaffAccess} from './StaffAccess';
import {AccountRecovery} from './AccountRecovery';
import {accountRecoveryToken} from './account-recovery-link';
import {AccountSiteSwitcher} from './AccountSiteSwitcher';
import {checkedSiteSession,selectAccountSite,type SiteSession} from './account-site';
import {invitationLinkToken} from './invitation-link';
import {RegistrationPage,VerifyRegistration,type RegistrationLanguage} from './Register';
import {verificationToken} from './registration';
import {FirstRunOnboarding} from './FirstRunOnboarding';
import type {FirstRunLanguage} from './first-run';
const StaffInvitations=lazy(()=>import('./StaffInvitations').then(module=>({default:module.StaffInvitations})));
const AcceptInvitation=lazy(()=>import('./AcceptInvitation').then(module=>({default:module.AcceptInvitation})));
class InvitationView extends React.Component<{children:React.ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError() {return {failed:true};}
  render() {return this.state.failed ? <section role="alert"><h1>Invitation view unavailable</h1><p>Reload this page to try again. For acceptance, reopen the original email link.</p><button className="button outline" onClick={()=>location.reload()}><RefreshCw size={18}/>Reload</button></section> : <Suspense fallback={<p role="status">Loading invitation...</p>}>{this.props.children}</Suspense>;}
}

type Session = PageSession & { authenticated: boolean; mode: string; role?: 'staff' | 'worker'; staffRole?: 'owner' | 'administrator' | 'supervisor' | 'auditor' | null; name?: string; organization?: string; site?: string;siteState?:'active'|'archived';timezone?:string; language?: string;languageSelectionRequired?:boolean;staffScope?:string|null;billingRecoveryScope?:string|null;templateRecoveryScope?:string|null;staffRecoveryScope?:string|null;staffInterfaceLanguage?:'en'|'ar'|null;firstRunRequired?:boolean };
type Counts = { assigned: number; responses: number; matches: number; clarifications: number; unassessed: number; pending: number; completion: number; acknowledged?: number };
type Case = { id: string; worker: string; language: string; title: string; reason: string; status: string; created_at: string };
type Briefing = { id: string; title: string; state: string; next_version: number; published_version: number | null;publication_state:string|null;archived_at:string|null; schedule_state:string|null;scheduled_for:string|null; updated_at: string };
type WorkerBriefing = WorkerResponse & { id: string; title: string; language: string; version: number; reminderAt?:string };
type WorkerBriefingPage={items:WorkerBriefing[];total:number;page:number;pageSize:number;counts:{todo:number;sent:number;history:number;followup:number};asOf:string};
type WorkerPagingText={previous:string;next:string;refresh:string;first:string;emptyHistory:string};
const workerPagingText:Record<WorkerUiLanguage,WorkerPagingText>={
  en:{previous:'Previous instructions',next:'Next instructions',refresh:'Refresh instructions',first:'First page',emptyHistory:'No assigned instruction history yet.'},
  ar:{previous:'التعليمات السابقة',next:'التعليمات التالية',refresh:'تحديث التعليمات',first:'الصفحة الأولى',emptyHistory:'لا يوجد سجل تعليمات مسندة بعد.'},
  ur:{previous:'پچھلی ہدایات',next:'اگلی ہدایات',refresh:'ہدایات تازہ کریں',first:'پہلا صفحہ',emptyHistory:'ابھی کوئی تفویض کردہ ہدایات نہیں ہیں۔'},
  hi:{previous:'पिछले निर्देश',next:'अगले निर्देश',refresh:'निर्देश ताज़ा करें',first:'पहला पृष्ठ',emptyHistory:'अभी तक कोई सौंपा गया निर्देश इतिहास नहीं।'},
  bn:{previous:'আগের নির্দেশনা',next:'পরের নির্দেশনা',refresh:'নির্দেশনা রিফ্রেশ করুন',first:'প্রথম পৃষ্ঠা',emptyHistory:'এখনও কোনো বরাদ্দকৃত নির্দেশনার ইতিহাস নেই।'},
  ml:{previous:'മുമ്പത്തെ നിർദ്ദേശങ്ങൾ',next:'അടുത്ത നിർദ്ദേശങ്ങൾ',refresh:'നിർദ്ദേശങ്ങൾ പുതുക്കുക',first:'ആദ്യ പേജ്',emptyHistory:'ഇതുവരെ നൽകിയ നിർദ്ദേശ ചരിത്രമില്ല.'},
  ta:{previous:'முந்தைய அறிவுறுத்தல்கள்',next:'அடுத்த அறிவுறுத்தல்கள்',refresh:'அறிவுறுத்தல்களைப் புதுப்பி',first:'முதல் பக்கம்',emptyHistory:'இதுவரை ஒதுக்கப்பட்ட அறிவுறுத்தல் வரலாறு இல்லை.'},
  te:{previous:'మునుపటి సూచనలు',next:'తదుపరి సూచనలు',refresh:'సూచనలను రిఫ్రెష్ చేయండి',first:'మొదటి పేజీ',emptyHistory:'ఇంకా కేటాయించిన సూచనల చరిత్ర లేదు.'},
  ne:{previous:'अघिल्ला निर्देशनहरू',next:'अर्का निर्देशनहरू',refresh:'निर्देशनहरू ताजा गर्नुहोस्',first:'पहिलो पृष्ठ',emptyHistory:'अहिलेसम्म तोकिएको निर्देशन इतिहास छैन।'},
  fil:{previous:'Mga nakaraang tagubilin',next:'Mga susunod na tagubilin',refresh:'I-refresh ang mga tagubilin',first:'Unang pahina',emptyHistory:'Wala pang history ng nakatalagang tagubilin.'},
  si:{previous:'පෙර උපදෙස්',next:'ඊළඟ උපදෙස්',refresh:'උපදෙස් නැවුම් කරන්න',first:'පළමු පිටුව',emptyHistory:'තවම පවරන ලද උපදෙස් ඉතිහාසයක් නැත.'},
  ru:{previous:'Предыдущие инструкции',next:'Следующие инструкции',refresh:'Обновить инструкции',first:'Первая страница',emptyHistory:'Истории назначенных инструкций пока нет.'},
  'pa-Guru':{previous:'ਪਿਛਲੀਆਂ ਹਦਾਇਤਾਂ',next:'ਅਗਲੀਆਂ ਹਦਾਇਤਾਂ',refresh:'ਹਦਾਇਤਾਂ ਤਾਜ਼ਾ ਕਰੋ',first:'ਪਹਿਲਾ ਪੰਨਾ',emptyHistory:'ਹਾਲੇ ਕੋਈ ਸੌਂਪੀ ਹਦਾਇਤ ਦਾ ਇਤਿਹਾਸ ਨਹੀਂ।'},
  'pa-Arab':{previous:'پچھلیاں ہدایتاں',next:'اگلیاں ہدایتاں',refresh:'ہدایتاں تازہ کرو',first:'پہلا صفحہ',emptyHistory:'ہالے کوئی سونپی ہدایت دی تریخ نئیں۔'},
  id:{previous:'Instruksi sebelumnya',next:'Instruksi berikutnya',refresh:'Muat ulang instruksi',first:'Halaman pertama',emptyHistory:'Belum ada riwayat instruksi yang ditugaskan.'},
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  let data;
  try {data=await response.json();}
  catch {throw Object.assign(new Error('Response could not be read'),{status:response.status});}
  if (!response.ok) throw Object.assign(new Error(data?.error || 'Request failed'),{status:response.status});
  return data as T;
}

function useApi<T>(path: string | null, refresh: number,clientContext?:string): { data: T | null; error: string; errorStatus:number|null; loading: boolean } {
  const key=JSON.stringify([path,clientContext || null]);
  const empty={key,data:null as T|null,error:'',errorStatus:null as number|null,loading:!!path};
  const [read,setRead]=useState(empty);
  useEffect(() => {
    if (!path){setRead(empty);return;}
    let current=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    setRead(previous=>({...empty,data:previous.key===key?previous.data:null,loading:previous.key!==key || previous.data===null}));
    api<T>(path,{signal:controller.signal,...(clientContext?{headers:{'content-type':'application/json','x-client-session-context':clientContext}}:{})})
      .then(data=>{if(current)setRead({key,data,error:'',errorStatus:null,loading:false});})
      .catch(error=>{if(current)setRead(previous=>({key,data:previous.key===key?previous.data:null,error:error.message,errorStatus:Number.isInteger(error.status)?error.status:0,loading:false}));})
      .finally(()=>clearTimeout(timeout));
    return()=>{current=false;clearTimeout(timeout);controller.abort();};
  }, [path, refresh,clientContext]);
  return read.key===key?read:empty;
}

function SiteClock({timezone,language}:{timezone?:string;language:Parameters<typeof staffDate>[2]}){
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(timer);},[]);
  return <span className="top-date">{staffDate(timezone,now,language)}</span>;
}

function Brand() {
  return <span className="brand">Understood <span className="brand-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span></span>;
}

function Status({ value }: { value: string }) {
  const tone = /match|ready|published|resolved/i.test(value) ? 'green' : /failed|error/i.test(value) ? 'red' : /clarification|processing|pending/i.test(value) ? 'amber' : 'blue';
  return <span className={`status status-${tone}`}><span className="status-dot" />{value.replaceAll('_', ' ')}</span>;
}

function Panel({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{title && <h2>{title}</h2>}{children}</section>;
}

function Metric({ icon: Icon, value, label, warn = false }: { icon: React.ComponentType<{ size?: number }>; value: number | string; label: string; warn?: boolean }) {
  return <div className={`metric ${warn ? 'metric-warn' : ''}`}><div className="metric-icon"><Icon size={28} /></div><div><strong>{value}</strong><span>{label}</span></div></div>;
}

function Notice({ children, tone = 'amber' }: { children: React.ReactNode; tone?: 'amber' | 'blue' | 'green' }) {
  return <div className={`notice notice-${tone}`}><TriangleAlert size={22} /><span>{children}</span></div>;
}

const staffPrimaryNavigation = [
  { key: 'overview', label: 'today', icon: Home },
  { key: 'briefings', label: 'instructions', icon: FileText },
  { key: 'people', label: 'team', icon: Users },
  { key: 'people/crews', label: 'crews', icon: Users },
  { key: 'clarifications', label: 'clarifications', icon: FileText },
  { key: 'language-requests', label: 'languageRequests', icon: Languages },
];
const staffSecondaryNavigation = [
  { key: 'reports', label: 'reports', icon: BarChart3 },

];
function staffNavigationActive(key:string,view:string) {
  if(key==='overview')return view==='overview';
  if(key==='briefings')return ['briefings','processing','language-readiness','source-audio'].some(route=>view===route||view.startsWith(`${route}/`))||view.startsWith('templates')||view.startsWith('glossary');
  if(key==='people/crews')return ['people/crews','people/new-crew'].includes(view)||view.startsWith('people/crew/');
  if(key==='people')return ['people','people/new'].includes(view)||view.startsWith('people/worker/');
  if(key==='reports')return view==='reports'||view.startsWith('reports/');
  if(key==='settings')return view==='settings'||view.startsWith('settings/');
  return view===key||view.startsWith(`${key}/`);
}

// The one-time mount lives in entry.tsx, outside the Fast Refresh boundary.
export default function App() {
  const navigationGuard=useRef<((next:string,resume?:()=>void)=>boolean)|null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoadError,setSessionLoadError]=useState(false),[sessionRetry,setSessionRetry]=useState(0);
  const [offlineAllowed,setOfflineAllowed]=useState(false),[offlineOpen,setOfflineOpen]=useState(false);
  const [sidebarOpen,setSidebarOpen]=useState(()=>window.innerWidth>760);
  const [view, setView] = useState(location.hash === '#reports/activity' ? 'reports' : location.hash.slice(1) || 'overview');
  const [siteInterfaceLanguage,setSiteInterfaceLanguage]=useState<CaseLocale>(()=>{try{const value=localStorage.getItem('understood:interface-language');return value==='ar'||value==='ur'?value:'en';}catch{return 'en';}});
  const directoryLanguage:PeopleLocale=siteInterfaceLanguage==='ar'?'ar':'en';
  const caseUiLanguage=siteInterfaceLanguage,reportUiLanguage=siteInterfaceLanguage;
  const staffUiLanguage=siteInterfaceLanguage,staffUi=peopleShellText[staffUiLanguage];
  function changeSiteLanguage(language:CaseLocale){setSiteInterfaceLanguage(language);try{localStorage.setItem('understood:interface-language',language);}catch{}}
  const sidebarText={en:{hide:'Hide sidebar',show:'Show sidebar',close:'Close sidebar',account:'Account options'},ar:{hide:'إخفاء الشريط الجانبي',show:'إظهار الشريط الجانبي',close:'إغلاق الشريط الجانبي',account:'خيارات الحساب'},ur:{hide:'سائیڈ بار چھپائیں',show:'سائیڈ بار دکھائیں',close:'سائیڈ بار بند کریں',account:'اکاؤنٹ کے اختیارات'}}[staffUiLanguage];
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState(()=>{try{const value=localStorage.getItem('understood:sign-in-email');return value && value.length<=254?value:'';}catch{return '';}});
  const [password, setPassword] = useState('');
  const [rememberDevice,setRememberDevice]=useState(()=>{try{return Boolean(localStorage.getItem('understood:sign-in-email'));}catch{return false;}});
  const [showPassword,setShowPassword]=useState(false);
  const [inviteOpen,setInviteOpen]=useState(false),[inviteLink,setInviteLink]=useState(''),[inviteError,setInviteError]=useState('');
  const [workerToken, setWorkerToken] = useState(() => workerAccessToken(location.hash));
  const [workerLinkSignal,setWorkerLinkSignal]=useState(0);
  const [workerEntryLanguage,setWorkerEntryLanguage]=useState<WorkerUiLanguage>(()=>navigator.language.startsWith('ar')?'ar':navigator.language.startsWith('ur')?'ur':'en');
  const [recoveryToken,setRecoveryToken]=useState(()=>accountRecoveryToken(location.hash));
  const [invitationToken,setInvitationToken]=useState(()=>invitationLinkToken(location.hash));
  const [registrationToken,setRegistrationToken]=useState(()=>verificationToken(location.hash));
  const [registrationLanguage,setRegistrationLanguage]=useState<RegistrationLanguage>(()=>navigator.language.startsWith('ar')?'ar':'en');
  const appliedStaffLanguage=useRef('');
  const authInFlight=useRef(false);
  const [authBusy,setAuthBusy]=useState(false);
  const [localCleanupFailed,setLocalCleanupFailed]=useState(false);
  const [workerEntryRecovery,setWorkerEntryRecovery]=useState<{pending:PendingWorkerEntry|null;error:string}>(()=>{try{return {pending:readPendingWorkerEntry(sessionStorage),error:''};}catch(reason){return {pending:null,error:(reason as Error).message};}});
  const [siteTransition,setSiteTransition]=useState(false),[siteTransitionError,setSiteTransitionError]=useState('');
  const selectingSite=useRef(false);
  const sessionGuard=useWorkerSessionGuard(session,authBusy || siteTransition || Boolean(workerEntryRecovery.pending || workerEntryRecovery.error));
  const activeSession=useRef(session);activeSession.current=session;
  const [clock]=useState(() => new Date());
  useEffect(() => { if (!message) return; const timeout = window.setTimeout(() => setMessage(''), 3500); return () => clearTimeout(timeout); }, [message]);
  useEffect(() => {
    const onHash = () => {
      if(navigationGuard.current && !navigationGuard.current(location.hash.slice(1) || 'overview'))return;
      if(location.hash === '#reports/activity') {
        history.replaceState(null,'',`${location.pathname}${location.search}#reports`);setView('reports');
      } else if(location.hash.startsWith('#accept-invitation/')) {
        setInvitationToken(invitationLinkToken(location.hash));
        history.replaceState(null,'',`${location.pathname}${location.search}#accept-invitation`);setView('accept-invitation');
      } else if(location.hash.startsWith('#verify-registration/')) {
        setRegistrationToken(verificationToken(location.hash));
        history.replaceState(null,'',`${location.pathname}${location.search}#verify-registration`);setView('verify-registration');
      } else if(location.hash.startsWith('#reset-password/')) {
        setRecoveryToken(accountRecoveryToken(location.hash));
        history.replaceState(null,'',`${location.pathname}${location.search}#reset-password`);setView('reset-password');
      } else if(location.hash.startsWith('#worker-access/')) {
        setWorkerToken(workerAccessToken(location.hash));setWorkerLinkSignal(n=>n+1);
        history.replaceState(null,'',`${location.pathname}${location.search}#worker-access`);setView('worker-access');
      } else {
        if(location.hash!=='#worker-access') setWorkerToken('');
        if(location.hash!=='#reset-password') setRecoveryToken('');
        if(location.hash!=='#accept-invitation') setInvitationToken('');
        if(location.hash!=='#verify-registration' && location.hash!=='#register') setRegistrationToken('');
        setView(location.hash.slice(1) || 'overview');
      }
    };
    onHash();
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  useEffect(()=>{
    const controller=new AbortController();setSessionLoadError(false);setOfflineAllowed(false);setOfflineOpen(false);
    fetchBootstrapSession(fetch,controller.signal).then(async value=>{
      const checked=checkedSiteSession(value) as Session;
      if(controller.signal.aborted)return;
      try{await reconcileOfflineSession(checked);}catch{setLocalCleanupFailed(true);}
      if(!controller.signal.aborted)setSession(checked);
    }).catch(error=>{if(!controller.signal.aborted){setSessionLoadError(true);setOfflineAllowed(error instanceof BootstrapSessionError && error.offline);}});
    return()=>controller.abort();
  },[sessionRetry]);
  const navigate = (next: string) => {if(navigationGuard.current && !navigationGuard.current(next))return;location.hash = next; setView(next); window.scrollTo(0, 0); };
  useEffect(()=>{if(session?.authenticated&&session.role==='staff'&&view.startsWith('templates'))navigate('briefings');},[session?.authenticated,session?.role,view]);
  useEffect(()=>{if(session?.authenticated && session.staffRole==='administrator' && !view.startsWith('settings') && !isPublicLandingView(view) && !['operations','home','walkthrough','pilot','sign-in','account-recovery','reset-password','accept-invitation','register','verify-registration'].includes(view)) navigate('settings/staff');},[session?.authenticated,session?.staffRole,view]);
  useEffect(()=>{if(session?.authenticated && session.role==='staff' && session.firstRunRequired && view!=='onboarding/first-run' && !isPublicLandingView(view) && !['operations','home','walkthrough','pilot','sign-in','account-recovery','reset-password','accept-invitation','register','verify-registration','worker-access'].includes(view)) navigate('onboarding/first-run');},[session?.authenticated,session?.role,session?.firstRunRequired,view]);
  useEffect(()=>{
    const value=session?.role==='staff'?session.staffInterfaceLanguage:null;
    if(value!=='en' && value!=='ar') return;
    const key=`${session?.clientContext}:${value}`;
    if(appliedStaffLanguage.current===key) return;
    appliedStaffLanguage.current=key;
    let preferred:CaseLocale=value;try{const saved=localStorage.getItem('understood:interface-language');if(saved==='en'||saved==='ar'||saved==='ur')preferred=saved;}catch{}
    setSiteInterfaceLanguage(preferred);
  },[session?.clientContext,session?.role,session?.staffInterfaceLanguage]);
  const reload = () => setRefresh((n) => n + 1);
  const applySiteSession=(next:SiteSession)=>{
    setSession(next);navigate(!next.authenticated ? 'overview' : next.role==='worker' ? 'inbox' : 'overview');
    reload();setSiteTransition(false);setSiteTransitionError('');
  };
  const changeSite=async (staffId:string)=>{
    if(session?.role!=='worker' && navigationGuard.current && !navigationGuard.current('change-site',()=>void changeSite(staffId)))return false;
    if(selectingSite.current) return false;
    selectingSite.current=true;setSiteTransition(true);setSiteTransitionError('');
    try {
      const result=await selectAccountSite((path,body)=>api(path,body ? {method:'POST',body:JSON.stringify(body)} : {}),staffId);
      applySiteSession(result.session);return result.confirmed;
    } catch {
      setSiteTransitionError('The current site could not be verified. Recheck your session before continuing.');
      throw new Error('Site session unavailable');
    } finally {selectingSite.current=false;}
  };
  const recheckSite=async ()=>{
    if(selectingSite.current) return;
    selectingSite.current=true;setSiteTransitionError('');
    try {applySiteSession(checkedSiteSession(await api('/session')));}
    catch {setSiteTransitionError('The current site could not be verified. Recheck your session before continuing.');}
    finally {selectingSite.current=false;}
  };
  const refreshSession=async()=>{
    try {setSession(checkedSiteSession(await api('/session',{cache:'no-store'})) as Session);return true;}
    catch {return false;}
  };
  const act = async (path: string, body?: unknown) => {
    if(session?.role==='staff'){
      const current=()=>sameStaffSession(session,activeSession.current) && !sessionGuard.isInvalidated() && !selectingSite.current && (path==='/logout' || !authInFlight.current);
      try{return await appStaffAction(session,path,body || {},fetch,current,()=>!sessionGuard.isLocked(),sessionGuard.invalidate,()=>{setMessage(path==='/logout'?'Saved.':'Preparation requested.');reload();});}
      catch(reason){if(current())setMessage((reason as Error).message);return null;}
    }
    try {
      if(session?.authenticated && (sessionGuard.isLocked() || !validPageSession(session))){sessionGuard.invalidate();return null;}
      const result = await api<any>(path, { method: 'POST',headers:{'content-type':'application/json',...(session?.clientContext ? {'x-client-session-context':session.clientContext} : {})}, body: JSON.stringify(body || {}) });
      if(session?.authenticated && (session.clientContext!==activeSession.current?.clientContext || sessionGuard.isLocked()))throw new Error('Session context changed');
      if(session?.role==='worker' && /^\/worker\/briefings\/[^/]+\/(answers|help)$/.test(path)){
        const input=body as {submissionId?:string;requestId?:string};
        if(sessionGuard.isLocked() || !validWorkerSession(session))throw new WorkerRequestError('receipt');
        checkedWorkerReceipt(result,path.endsWith('/answers')?'answer':'help',{requestId:input.submissionId || input.requestId || '',assignmentId:path.split('/')[3],clientContext:session.clientContext || ''});
      }
      setMessage('Saved.'); reload(); return result;
    } catch (error) {if(error instanceof WorkerRequestError)throw error;if(['Session context changed','Sign in required'].includes((error as Error).message))sessionGuard.invalidate();setMessage((error as Error).message); return null; }
  };
  const signInCredential = async (kind: 'staff' | 'worker',workerInput?:{company:string;workerId:string;password:string}) => {
    if(authInFlight.current || localCleanupFailed || workerEntryRecovery.pending || workerEntryRecovery.error || (kind==='worker' && !workerInput)) return;
    authInFlight.current=true;setAuthBusy(true);setMessage('');
    let entry:PendingWorkerEntry|null=null;
    try {
      if(!await clearWorkerLocalData()){setLocalCleanupFailed(true);return;}
      if(kind==='worker'){
        entry=await prepareWorkerEntry(workerToken.trim(),workerEntryLanguage);savePendingWorkerEntry(sessionStorage,entry);
        setWorkerEntryRecovery({pending:entry,error:''});
      }
      if(kind==='worker' && session?.authenticated) {
        await api('/logout',{method:'POST',headers:{'content-type':'application/json',...(session.clientContext ? {'x-client-session-context':session.clientContext} : {})},body:'{}'});
        setSession({authenticated:false,mode:session.mode,language:session.language});
      }
      await api(kind === 'staff' ? '/auth/staff/login' : '/auth/worker/redeem', {
        method: 'POST', body: JSON.stringify(kind === 'staff' ? { email, password } : { token: workerToken.trim(),...workerInput }),
      });
      if(kind==='worker') {
        const recovered=await recoverWorkerEntry(entry!,api);if(!recovered)throw Error('Worker access could not be confirmed.');
        finishWorkerEntry(recovered,entry!);return;
      }
      const signedIn = checkedSiteSession(await api<Session>('/session')) as Session;
      try {if(rememberDevice && email.trim())localStorage.setItem('understood:sign-in-email',email.trim());else localStorage.removeItem('understood:sign-in-email');}catch {}
      setSession(signedIn);
      setPassword(''); setWorkerToken('');
      navigate(signedIn.role === 'worker' ? 'inbox' : 'overview');
    } catch (error) {
      if(kind==='worker' && entry && [400,401,403,404].includes(Number((error as {status?:number}).status))){
        try{clearPendingWorkerEntry(sessionStorage,entry);setWorkerEntryRecovery({pending:null,error:''});}catch{/* Keep a receipt if local cleanup cannot be verified. */}
      }
      setMessage((error as Error).message);
    }
    finally {authInFlight.current=false;setAuthBusy(false);}
  };
  function finishWorkerEntry(signedIn:PageSession,pending:PendingWorkerEntry){
    saveWorkerUiLanguage(sessionStorage,signedIn,workerUiFallbackLanguage(signedIn));clearPendingWorkerEntry(sessionStorage,pending);
    setWorkerToken('');setWorkerEntryRecovery({pending:null,error:''});
    location.hash='inbox';location.reload();
  }
  const signInWorkerPassword = async (input:{company:string;workerId:string;password:string}) => {
    if(authInFlight.current || localCleanupFailed || workerEntryRecovery.pending || workerEntryRecovery.error)return;
    authInFlight.current=true;setAuthBusy(true);setMessage('');
    try {
      if(!await clearWorkerLocalData()){setLocalCleanupFailed(true);return;}
      if(session?.authenticated) {
        await api('/logout',{method:'POST',headers:{'content-type':'application/json',...(session.clientContext ? {'x-client-session-context':session.clientContext} : {})},body:'{}'});
        setSession({authenticated:false,mode:session.mode,language:session.language});
      }
      await api('/auth/worker/login',{method:'POST',body:JSON.stringify(input)});
      const signedIn=await api<Session>('/session',{cache:'no-store'});
      if(!validWorkerSession(signedIn))throw Error('Worker access could not be confirmed.');
      try{saveWorkerUiLanguage(sessionStorage,signedIn,workerEntryLanguage);}catch{}
      location.hash='inbox';location.reload();
    } catch(error){setMessage((error as Error).message);}
    finally {authInFlight.current=false;setAuthBusy(false);}
  };
  async function anotherWorkerLink(){
    const current=checkedSiteSession(await api('/session',{cache:'no-store'}));
    if(!await clearWorkerLocalData()){
      if(workerEntryRecovery.pending)savePendingWorkerEntry(sessionStorage,workerEntryRecovery.pending);
      throw Error('Local saved data could not be cleared. No new link was opened.');
    }
    setSession(current);setWorkerToken('');setWorkerEntryRecovery({pending:null,error:''});
    location.hash='worker-access';location.reload();
  }
  const openInvitation=()=>{
    const raw=inviteLink.trim();
    const token=/^[A-Za-z0-9_-]{43}$/.test(raw)?raw:invitationLinkToken(`#${raw.split('#').pop() || ''}`);
    if(!token){setInviteError('That invitation link is not valid. Paste the full link from your invitation email, or ask the inviter for a new one.');return;}
    setInviteError('');setInvitationToken(token);location.hash=`accept-invitation/${token}`;
  };
  const logout = async () => {
    if(session?.role!=='worker' && navigationGuard.current && !navigationGuard.current('sign-out',()=>void logout()))return false;
    if(authInFlight.current)return false;
    authInFlight.current=true;setAuthBusy(true);
    try {
      if (!await act('/logout')) return false;
      const cleared=await clearWorkerLocalData(session?.clientContext);
      setSession({ authenticated: false, mode: session?.mode || 'synthetic-credential',language:session?.language }); navigate('home');
      setLocalCleanupFailed(!cleared);setMessage('');
      return true;
    } finally {authInFlight.current=false;setAuthBusy(false);}
  };

  if(workerEntryRecovery.pending || workerEntryRecovery.error)return <main className="entry-page"><Brand/><WorkerEntryRecovery pending={workerEntryRecovery.pending} storageError={workerEntryRecovery.error} paused={authBusy} request={api} onResolved={signedIn=>finishWorkerEntry(signedIn,workerEntryRecovery.pending!)} onAnother={anotherWorkerLink}/></main>;
  if(view==='operations')return <BriefingView label="Platform operations"><Operations/></BriefingView>;
  if(view==='register')return <AuthLayout variant="register"><RegistrationPage language={registrationLanguage} onLanguage={setRegistrationLanguage} authenticated={!!session?.authenticated} available={session?.mode==='synthetic-credential'} onBack={()=>navigate('home')} onSignIn={()=>navigate('sign-in')} onOpenWorkspace={()=>navigate('overview')}/></AuthLayout>;
  if(view==='verify-registration')return <main className="entry-page"><Brand/><VerifyRegistration key={registrationToken} token={registrationToken} language={registrationLanguage} onLanguage={setRegistrationLanguage} onRegister={()=>navigate('register')} onSignIn={()=>navigate('sign-in')}/></main>;
  if(isPublicLandingView(view) || ['walkthrough','pilot'].includes(view) || (session?.authenticated===false && view==='overview'))return <BriefingView label="public site"><PublicProduct view={view} registrationAvailable={session?.mode==='synthetic-credential'}/></BriefingView>;
  if (!session) {
    const language=workerBrowserLanguage();
    const text=sessionLoadText[language];
    if(offlineAllowed && offlineOpen)return <WorkerOfflineEntryView onBack={()=>{setOfflineOpen(false);setSessionRetry(value=>value+1);}}/>;
    return sessionLoadError ? <main className="entry-page" lang={language} dir={workerUiDirection(language)}><Brand/><section role="alert"><h1>{text.title}</h1><p>{text.body}</p><button className="button primary" onClick={()=>{setSessionLoadError(false);setSessionRetry(value=>value+1);}}><RefreshCw size={18}/>{text.retry}</button>{offlineAllowed && <button className="button outline" onClick={()=>setOfflineOpen(true)}><Download size={18}/>{text.saved}</button>}</section></main> : <div className="loading-page">{text.loading}</div>;
  }
  if(session.authenticated && session.role==='staff' && (sessionGuard.locked || !validStaffSession(session)))return <StaffSessionLock key={session.clientContext} session={session} uiLanguage={staffUiLanguage} onVerified={verified=>{
    if(activeSession.current?.clientContext!==session.clientContext || verified.authenticated && !validStaffSession(verified))return;
    sessionGuard.resume();setSession(verified as Session);setPassword('');setWorkerToken('');setMessage('');navigationGuard.current=null;
    location.hash=verified.authenticated?'overview':'sign-in';setView(verified.authenticated?'overview':'sign-in');reload();window.scrollTo(0,0);
  }}/>;
  if(sessionGuard.locked || (session.authenticated && session.role==='worker' && !validWorkerSession(session))) {
    let language:WorkerUiLanguage=workerUiFallbackLanguage(session);
    try{language=readWorkerLockLanguage(sessionStorage,session);}catch{}
    const text=workerSessionText[language];
    return <main className="entry-page" lang={language} dir={workerUiDirection(language)}><Brand/><section role="alert"><h1>{text.title}</h1><p>{text.body}</p><p>{text.next}</p><button className="button primary" onClick={()=>location.reload()}><RefreshCw size={18}/>{text.reload}</button></section></main>;
  }
  if(view==='accept-invitation') return <main className="entry-page"><Brand/><InvitationView key={invitationToken}><AcceptInvitation token={invitationToken} identity={session} onBack={()=>{setInvitationToken('');navigate('overview');}} onIdentityChanged={async()=>{setSession(checkedSiteSession(await api('/session')));}} onOpenSite={changeSite}/></InvitationView></main>;
  if(['account-recovery','reset-password'].includes(view)) return <main className="entry-page"><Brand/><AccountRecovery key={view} reset={view==='reset-password'} token={recoveryToken} onBack={()=>{setRecoveryToken('');navigate('overview');}} onReset={()=>{setPassword('');setSession({authenticated:false,mode:session.mode});}}/></main>;
  if(view==='worker-access')return <WorkerAccessEntry language={workerEntryLanguage} onLanguage={setWorkerEntryLanguage} token={workerToken} linkSignal={workerLinkSignal} onToken={setWorkerToken} busy={authBusy} blocked={localCleanupFailed} authenticated={session.authenticated} session={session} supported failed={!!message} onSubmit={input=>void signInCredential('worker',input)} onPasswordLogin={(input)=>void signInWorkerPassword(input)} onClearFailure={()=>setMessage('')} onCancel={()=>{setWorkerToken('');setMessage('');navigate('overview');}}><Brand/>{localCleanupFailed && <section role="alert"><p>{localCleanupText[workerEntryLanguage].failed}</p><button className="button outline" disabled={authBusy} onClick={async()=>{if(authInFlight.current)return;authInFlight.current=true;setAuthBusy(true);try{setLocalCleanupFailed(!await clearWorkerLocalData());}finally{authInFlight.current=false;setAuthBusy(false);}}}>{localCleanupText[workerEntryLanguage].remove}</button></section>}</WorkerAccessEntry>;
  if (!session.authenticated || view==='worker-access') return (
    <AuthLayout note="Local preview · Review generated content before sending.">
      <div className="auth-form-heading"><h1>Welcome back<span className="auth-heading-ar" lang="ar" dir="rtl">مرحباً بعودتك</span></h1><p>Sign in to access your team's work for today.</p><p className="auth-lead-ar" lang="ar" dir="rtl">سجّل الدخول للوصول إلى أعمال فريقك اليوم.</p></div>
      <nav className="auth-role-tabs" aria-label="Sign in as"><a href="#sign-in" aria-current="page" onClick={event=>{if(authBusy)event.preventDefault();}}>Supervisor</a><a href="#worker-access" onClick={event=>{if(authBusy)event.preventDefault();}}>Worker</a></nav>
      <div className="auth-staff-form">
        {localCleanupFailed && <section role="alert" lang={session.language==='ar' || session.language==='ur'?session.language:'en'} dir={session.language==='ar' || session.language==='ur'?'rtl':'ltr'}><p>{localCleanupText[session.language==='ar' || session.language==='ur'?session.language:'en'].failed}</p><button className="button outline" disabled={authBusy} onClick={async()=>{if(authInFlight.current)return;authInFlight.current=true;setAuthBusy(true);try {setLocalCleanupFailed(!await clearWorkerLocalData());}finally {authInFlight.current=false;setAuthBusy(false);}}}>{localCleanupText[session.language==='ar' || session.language==='ur'?session.language:'en'].remove}</button></section>}
            <form className="entry-form" onSubmit={(event) => { event.preventDefault(); void signInCredential('staff'); }}>
              <label className="field"><span className="auth-label"><span>Work email</span><span lang="ar" dir="rtl">بريد العمل</span></span><span className="auth-input-icon"><Users size={17} aria-hidden="true"/><input aria-label="Work email" type="email" autoComplete="username" placeholder="you@company.com" value={email} disabled={authBusy || localCleanupFailed} onChange={(event) => setEmail(event.target.value)} required /></span></label>
              <div className="field"><label className="auth-label" htmlFor="staff-password"><span>Password</span><span lang="ar" dir="rtl">كلمة المرور</span></label><span className="password-control auth-input-icon"><KeyRound size={17} aria-hidden="true"/><input aria-label="Password" id="staff-password" type={showPassword?'text':'password'} autoComplete="current-password" placeholder="Enter your password" value={password} disabled={authBusy || localCleanupFailed} onChange={(event) => setPassword(event.target.value)} required /><button type="button" className="password-toggle" aria-label={showPassword?'Hide password':'Show password'} title={showPassword?'Hide password':'Show password'} disabled={authBusy || localCleanupFailed} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></div>
              <div className="signin-options">
                <label className="signin-remember" title="Saves your work email in this browser. It does not extend your session."><input type="checkbox" checked={rememberDevice} disabled={authBusy || localCleanupFailed} onChange={event=>setRememberDevice(event.target.checked)}/><span>Remember this device</span></label>
                <button className="button subtle" type="button" disabled={authBusy} onClick={()=>navigate('account-recovery')}><KeyRound size={18}/>Forgot password?</button>
              </div>
              <button className="button primary full" type="submit" disabled={authBusy || localCleanupFailed}>{authBusy ? 'Signing in...' : <>Sign in <ArrowRight size={18}/></>}</button>
            </form>
            <div className="signin-invite">
              <p>Joining a team?</p>
              {inviteOpen?<form className="invite-link-form" onSubmit={event=>{event.preventDefault();openInvitation();}}><label className="field">Invitation link<input value={inviteLink} disabled={authBusy} onChange={event=>{setInviteLink(event.target.value);setInviteError('');}} placeholder="Paste the link from your invitation email" /></label>{inviteError && <p role="alert" className="record-error">{inviteError}</p>}<div className="actions"><button className="button outline" type="submit" disabled={!inviteLink.trim()}><ArrowRight size={18}/>Open invitation</button><button className="button subtle" type="button" onClick={()=>{setInviteOpen(false);setInviteError('');}}>Cancel</button></div></form>
                :<button className="text-link" type="button" onClick={()=>setInviteOpen(true)}>Use your invitation link <ChevronRight size={16}/></button>}
            </div>
            <div className="signin-worker">
              <p>Worker signing in?</p>
              <a className="button outline full" href="#worker-access">Company ID and password <ArrowRight size={18}/></a>
            </div>
            {session.mode==='synthetic-credential' && <div className="signin-invite">
              <p>New to Understood?</p>
              <a className="button outline full auth-first-setup" href="#register"><span>First-time setup <ArrowRight size={13}/></span><span lang="ar" dir="rtl">الإعداد للمرة الأولى</span></a>
              <p className="muted">Up to 25 workers. No card required.</p>
            </div>}
            <div className="auth-help-links"><a href="#home">About Understood</a><details><summary>Get help · المساعدة</summary><p>Workers: ask your supervisor for your company ID and password. Supervisors: use “Forgot password?” to recover access, or open your invitation link to join a team.</p></details><a href="#walkthrough">Sign-in guide</a></div>
      </div>
      {message && <div className="auth-error" role="alert">{message}</div>}
    </AuthLayout>
  );

  if (session.role === 'worker') return <>{sessionGuard.suspended&&<SessionConnectionNotice language={workerUiFallbackLanguage(session)} onRetry={sessionGuard.retry}/>}<div hidden={sessionGuard.suspended} style={sessionGuard.suspended?{display:'none'}:undefined}><WorkerApp key={session.clientContext} session={session} view={view} navigate={navigate} refresh={refresh} act={act} logout={logout} message={message} onSessionLost={sessionGuard.invalidate} sessionInvalid={sessionGuard.isLocked} navigationGuard={navigationGuard} onSessionRefresh={refreshSession} /></div></>;
  const canWrite=canManageStaff(session.staffRole) && session.siteState!=='archived';
  const canSearch=['owner','supervisor','auditor'].includes(session.staffRole || '');
  if(session.staffRole==='administrator' && !view.startsWith('settings')) return <div className="loading-page">Loading site settings...</div>;
  const blockStaffInput=(event:React.SyntheticEvent)=>{if(sessionGuard.isLocked()){event.preventDefault();event.stopPropagation();}};
  const staffAuthority:StaffRequestAuthority={session,isCurrent:()=>sameStaffSession(session,activeSession.current) && !sessionGuard.isInvalidated() && !selectingSite.current && !authInFlight.current,canMutate:()=>!sessionGuard.isLocked(),onSessionLost:sessionGuard.invalidate};
  const navGroups=[{label:null,items:staffPrimaryNavigation},{label:staffUi.more,items:staffSecondaryNavigation}]
    .map(group=>({...group,items:group.items.filter(({key})=>(session.staffRole!=='administrator'||key==='settings')&&(!['people','people/crews','language-requests'].includes(key)||canWrite))}))
    .filter(group=>group.items.length);
return <StaffLanguageContext.Provider value={staffUiLanguage}><>{sessionGuard.suspended&&<SessionConnectionNotice language={staffUiLanguage} onRetry={sessionGuard.retry}/>}<div hidden={sessionGuard.suspended} style={sessionGuard.suspended?{display:'none'}:undefined} className={`staff-shell ${sidebarOpen?'':'sidebar-hidden'}`} lang={staffUiLanguage} dir={staffUiLanguage==='en'?'ltr':'rtl'} inert={sessionGuard.checking} aria-busy={sessionGuard.checking} onClickCapture={blockStaffInput} onSubmitCapture={blockStaffInput} onKeyDownCapture={blockStaffInput}>
  <a className="skip-link" href="#staff-main" onClick={event=>{event.preventDefault();document.getElementById('staff-main')?.focus();}}>{staffUiLanguage==='ar'?'انتقل إلى المحتوى الرئيسي':'Skip to main content'}</a>
  <DashboardSidebar brand={<Brand/>} items={(navGroups.find(group=>!group.label)?.items||[]).map(item=>({...item,label:staffUi[item.label as keyof typeof staffUi],active:staffNavigationActive(item.key,view)}))} moreItems={(navGroups.find(group=>group.label)?.items||[]).map(item=>({...item,label:staffUi[item.label as keyof typeof staffUi],active:staffNavigationActive(item.key,view)}))} name={session.name} email={session.email} identity={staffIdentityLabel(session.staffRole,staffUiLanguage,true)} moreLabel={staffUi.more} settingsLabel={staffUi.settings} signOutLabel={staffUi.signOut} closeLabel={sidebarText.hide} accountLabel={sidebarText.account} onClose={()=>{setSidebarOpen(false);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.sidebar-open-button')?.focus());}} navigate={path=>{navigate(path);if(window.innerWidth<=760)setSidebarOpen(false);}} logout={logout} disabled={siteTransition}/>
  {sidebarOpen&&<button className="sidebar-backdrop" aria-label={sidebarText.close} onClick={()=>setSidebarOpen(false)}/>}
  <div className="staff-main"><header className="topbar">{!sidebarOpen&&<button className="icon-button sidebar-open-button" aria-label={sidebarOpen?sidebarText.hide:sidebarText.show} aria-expanded={sidebarOpen} aria-controls="dashboard-sidebar" onClick={()=>setSidebarOpen(open=>!open)}><PanelLeft size={21}/></button>}
    <AccountSiteSwitcher language={staffUiLanguage} organization={session.organization} site={session.site} disabled={siteTransition} onSelect={changeSite}/>
    <SiteClock timezone={session.timezone} language={staffUiLanguage}/>
    {canSearch && <StaffSearchBox language={staffUiLanguage} key={`${session.clientContext}:${session.siteState}`} navigate={navigate} disabled={siteTransition} canPeople={canWrite}/>}
    <InterfaceLanguagePicker value={staffUiLanguage} onChange={changeSiteLanguage} disabled={siteTransition}/>
    {['owner','supervisor','auditor'].includes(session.staffRole || '') && <NotificationBell session={session} label={staffUi.notifications} onSessionLost={sessionGuard.invalidate} disabled={siteTransition} onOpen={()=>navigate('notifications')}/>}
  </header>{siteTransition ? <main className="staff-content" id="staff-main" tabIndex={-1}><h1>{staffUi.siteSession}</h1>{siteTransitionError ? <><p role="alert">{staffUi.siteError}</p><button className="button outline" onClick={()=>void recheckSite()}><RefreshCw size={18}/>{staffUi.recheck}</button></> : <p role="status">{staffUi.checkingSite}</p>}</main> : <main className="staff-content" id="staff-main" tabIndex={-1} key={`${session.staffScope}:${session.staffRole}`}>
    {(view==='settings' || view.startsWith('settings/')) && <nav className="briefing-detail-tabs" aria-label="Settings views"><button aria-pressed={view==='settings'} onClick={()=>navigate('settings')}>Organization & site</button>{['owner','administrator','auditor'].includes(session.staffRole || '') && <button aria-pressed={view==='settings/staff'} onClick={()=>navigate('settings/staff')}>Staff & access</button>}{session.mode==='synthetic-credential' && session.staffScope && ['owner','administrator','auditor'].includes(session.staffRole || '') && <button aria-pressed={view==='settings/invitations'} onClick={()=>navigate('settings/invitations')}>Invitations</button>}{['owner','auditor'].includes(session.staffRole || '') && <button aria-pressed={view.startsWith('settings/invoices')} onClick={()=>navigate('settings/invoices')}>Invoices</button>}{session.staffRole==='owner' && <button aria-pressed={view==='settings/onboarding'} onClick={()=>navigate('settings/onboarding')}>Pilot setup</button>}<button aria-pressed={view==='settings/usage'} onClick={()=>navigate('settings/usage')}>Plan &amp; usage</button><button aria-pressed={view==='settings/retention'} onClick={()=>navigate('settings/retention')}>Privacy &amp; retention</button></nav>}
{session.siteState==='archived' && <Notice tone="blue">{staffUi.archived}</Notice>}
{view === 'overview' && <Overview key={staffRequestBinding(session)} authority={staffAuthority} refresh={refresh} navigate={navigate} canWrite={canWrite} name={session.name} greeting={staffGreeting(session.timezone,clock)} />}{(view==='send'||view.startsWith('send/')) && (canWrite ? <Suspense fallback={<p role="status">Loading the send form...</p>}><SendInstruction draftId={view.split('/')[1]} navigationGuard={navigationGuard} key={`${view}:${session.clientContext}:${session.templateRecoveryScope}`} authority={staffAuthority} scope={session.templateRecoveryScope || session.clientContext || null} navigate={navigate} onSent={reload}/></Suspense> : <Notice tone="blue">Your role cannot send instructions.</Notice>)}{view === 'briefings' && <Briefings key={staffRequestBinding(session)} authority={staffAuthority} refresh={refresh} navigate={navigate} canWrite={canWrite} />}{view === 'briefings/new' && (canWrite ? <Suspense fallback={<p role="status">Loading the send form...</p>}><SendInstruction key={`new:${session.clientContext}`} authority={staffAuthority} scope={session.templateRecoveryScope||session.clientContext||null} navigate={navigate} onSent={reload} navigationGuard={navigationGuard}/></Suspense> : <Notice tone="blue">Your role cannot create instructions.</Notice>)}{view.startsWith('briefings/') && view !== 'briefings/new' && <BriefingDetail key={`${view.split('/')[1]}:${session.clientContext}:${session.templateRecoveryScope}`} authority={staffAuthority} id={view.split('/')[1]} scope={session.templateRecoveryScope} languageSession={{clientContext:session.clientContext!,expiresAt:session.expiresAt!}} refresh={refresh} act={act} navigate={navigate} onChanged={reload} canWrite={canWrite} timezone={session.timezone} />}
    {view==='source-audio' && (canWrite ? <BriefingView label="Source audio uploads"><SourceAudioUploads key={session.clientContext} authority={staffAuthority} session={{clientContext:session.clientContext!,expiresAt:session.expiresAt!}} navigate={navigate}/></BriefingView> : <Notice>Your role cannot access source audio uploads.</Notice>)}
    {view==='settings/onboarding' && (session.staffRole==='owner'?<BriefingView key={staffRequestBinding(session)} label="Pilot setup"><Onboarding authority={staffAuthority} navigate={navigate}/></BriefingView>:<Notice>Only the workspace owner can save pilot setup progress.</Notice>)}
    {view==='onboarding/first-run' && (session.staffRole==='owner'?<FirstRunOnboarding key={staffRequestBinding(session)} authority={staffAuthority} refresh={refresh} onCompleted={(language:FirstRunLanguage)=>{setSession(old=>old?{...old,firstRunRequired:false,staffInterfaceLanguage:language}:old);reload();}} onNavigate={navigate} onRefresh={reload}/>:<Notice tone="blue">Only the workspace owner can finish workspace setup.</Notice>)}
    {view==='notifications' && (['owner','supervisor','auditor'].includes(session.staffRole || '') ? <BriefingView key={staffRequestBinding(session)} label="Notifications"><Notifications authority={staffAuthority} refresh={refresh} navigate={navigate} timezone={session.timezone}/></BriefingView> : <Notice>Your role cannot access site notifications.</Notice>)}
    {(view==='glossary' || view.startsWith('glossary/')) && <Glossary authority={staffAuthority} key={`${view}:${staffRequestBinding(session)}`} id={view.split('/')[1]==='new' ? undefined : view.split('/')[1]} newTerm={view==='glossary/new'} canWrite={canWrite} scope={session.templateRecoveryScope} navigate={navigate}/>}
    {view === 'clarifications' && <BriefingView label="Clarifications" language={caseUiLanguage}><ClarificationsPage key={staffRequestBinding(session)} authority={staffAuthority} refresh={refresh} navigate={navigate} timezone={session.timezone} language={caseUiLanguage}  canWrite={canWrite && ['owner','supervisor'].includes(session.staffRole || '')} /></BriefingView>}
    {view === 'clarifications/new' && <BriefingView label="New clarification" language={caseUiLanguage}>{['owner','supervisor'].includes(session.staffRole || '')?<ClarificationCreate key={staffRequestBinding(session)} authority={staffAuthority} canWrite={canWrite} navigate={navigate} navigationGuard={navigationGuard} timezone={session.timezone} language={caseUiLanguage} />:<p role="alert">{caseText(caseUiLanguage,'Your role cannot create clarifications.')}</p>}</BriefingView>}
    {view.startsWith('clarifications/') && view !== 'clarifications/new' && <BriefingView key={`${view.split('/')[1]}:${staffRequestBinding(session)}`} label="Clarification" language={caseUiLanguage}><ClarificationPage id={view.split('/')[1]} refresh={refresh} navigate={navigate} session={{clientContext:session.clientContext!,expiresAt:session.expiresAt!}} authority={staffAuthority} language={caseUiLanguage}  timezone={session.timezone} navigationGuard={navigationGuard} canWrite={canWrite && ['owner','supervisor'].includes(session.staffRole || '')} /></BriefingView>}
    {canSearch && (view==='search' || view.startsWith('search/')) && <BriefingView label="Search"><StaffSearch key={`${view}:${session.clientContext}:${session.siteState}`} route={view} context={session.clientContext!} canPeople={canWrite} navigate={navigate}/></BriefingView>}
{view==='language-requests' && <LanguageRequestsPage authority={staffAuthority} refresh={refresh} canManage={canWrite} locale={directoryLanguage}/>}
{view==='people/new-crew' && <CreateCrewPage authority={staffAuthority} canManage={canWrite} locale={directoryLanguage} navigate={navigate}/>}
{view==='people/crews'  && (canWrite?<SiteCrews key={staffRequestBinding(session)} authority={staffAuthority} refresh={refresh} locale={directoryLanguage} onLocaleChange={changeSiteLanguage} navigate={navigate} name={session.name} greeting={staffGreeting(session.timezone,clock)} canManageContacts={session.staffRole==='owner'}/>:<p lang="en" dir="ltr" role="status">Your role cannot manage site crews.</p>)}
{(['people','people/new'].includes(view) || view.startsWith('people/worker/') || view.startsWith('people/crew/')) && <PeoplePage locale={directoryLanguage} onLocaleChange={changeSiteLanguage} authority={staffAuthority} key={`${session.clientContext}:${view}`} initialAdd={view==='people/new'} initialWorkerId={view.startsWith('people/worker/')?view.split('/')[2]:undefined} initialCrewId={view.startsWith('people/crew/')?view.split('/')[2]:undefined} refresh={refresh} onImport={() => navigate('people/import')} canManage={canWrite} canDelete={['owner','administrator'].includes(session.staffRole || '')} credentialAccess={session.mode==='synthetic-credential'} navigate={navigate} />}{view.startsWith('people/import') && (canWrite ? <WorkerImportPage authority={staffAuthority} key={`${session.clientContext}:${view}`} id={view.split('/')[2]} navigate={navigate} /> : <Notice tone="blue">Your role cannot import workers.</Notice>)}
    {view === 'processing' && <Processing key={staffRequestBinding(session)} authority={staffAuthority} refresh={refresh} navigate={navigate} canWrite={canWrite} />}{view.startsWith('processing/') && <ProcessingDetail key={`${view}:${staffRequestBinding(session)}`} authority={staffAuthority} id={view.split('/')[1]} refresh={refresh} navigate={navigate} canWrite={canWrite} onChanged={reload} />}{view === 'language-readiness' && <Suspense fallback={<p role="status">Loading language readiness...</p>}><LanguageReadiness key={staffRequestBinding(session)} authority={staffAuthority} refresh={refresh} /></Suspense>}{view === 'reports' && <Reports key={staffRequestBinding(session)} authority={staffAuthority} refresh={refresh} language={reportUiLanguage}  />}
    {view==='settings' && <WorkspaceSettings authority={staffAuthority} key={session.clientContext} session={{clientContext:session.clientContext!,expiresAt:session.expiresAt!,siteState:session.siteState}} onLifecycleChanged={()=>{
      if(!staffAuthority.isCurrent() || !staffAuthority.canMutate())return;
      void fetchBootstrapSession(fetch,AbortSignal.timeout(15000)).then(value=>{
        if(!staffAuthority.isCurrent() || !staffAuthority.canMutate())return;
        if(!validStaffSession(value) || !sameStaffSession(session,{...value,siteState:session.siteState})){sessionGuard.invalidate();return;}
        setSession(old=>sameStaffSession(session,old)?value as Session:old);
      }).catch(()=>{if(staffAuthority.isCurrent())sessionGuard.invalidate();});
    }} onContextChanged={value=>{if(staffAuthority.isCurrent())setSession(old=>sameStaffSession(session,old)?{...old!,organization:value.organization.name,site:value.site.name,timezone:value.site.timezone}:old);}}/>}
    {view==='settings/usage' && <Suspense fallback={<p role="status">Loading plan and usage...</p>}><PlanUsage key={staffRequestBinding(session)} authority={staffAuthority} refresh={refresh}/></Suspense>}
    {view==='settings/retention' && <Suspense fallback={<p role="status">Loading retention settings...</p>}><RetentionSettings key={session.clientContext} authority={staffAuthority}/></Suspense>}
    {view==='settings/staff' && (['owner','administrator','auditor'].includes(session.staffRole || '') ? <StaffAccess key={`${session.clientContext}:${session.staffRecoveryScope}`} actorRole={session.staffRole || ''} scope={session.staffRecoveryScope} authority={{session,isCurrent:()=>sameStaffSession(session,activeSession.current) && !sessionGuard.isInvalidated() && !selectingSite.current && !authInFlight.current,canMutate:()=>!sessionGuard.isLocked(),onSessionLost:sessionGuard.invalidate}} onSessionChanged={()=>{void fetchBootstrapSession(fetch,AbortSignal.timeout(15000)).then(value=>{if(!sameStaffSession(session,activeSession.current) || sessionGuard.isInvalidated())return;if(!sameStaffSession(session,value)){sessionGuard.invalidate();return;}setSession(value as Session);}).catch(()=>{if(sameStaffSession(session,activeSession.current))sessionGuard.invalidate();});}}/> : <Notice>Your role cannot manage staff access.</Notice>)}
    {view==='settings/invitations' && (session.mode==='synthetic-credential' && session.staffScope && ['owner','administrator','auditor'].includes(session.staffRole || '') ? <InvitationView key={`${session.clientContext}:${session.staffScope}`}><StaffInvitations authority={staffAuthority} actorRole={session.staffRole || ''} scope={session.staffScope} onBack={()=>navigate('settings/staff')}/></InvitationView> : <Notice>Staff invitations require an authorized credential account.</Notice>)}
    {(view==='settings/invoices' || view.startsWith('settings/invoices/')) && (['owner','auditor'].includes(session.staffRole || '') ? <BriefingView key={`${session.clientContext}:${view}`} label="Invoices"><BillingPage authority={staffAuthority} id={view.split('/')[2]==='new' ? undefined : view.split('/')[2]} newInvoice={view==='settings/invoices/new'} owner={session.staffRole==='owner'} scope={session.billingRecoveryScope} navigate={navigate}/></BriefingView> : <Notice>Your role cannot access invoices.</Notice>)}<div className="page-foot">{staffUi.foot}</div></main>}</div>{message && <div className="toast" role="status" lang="en" dir="ltr" onClick={() => setMessage('')}>{message}</div>}</div></></StaffLanguageContext.Provider>;
}

function Overview({ refresh, navigate:onNavigate,canWrite,name,greeting,authority }: { refresh: number; navigate: (path: string) => void;canWrite:boolean;name?:string;greeting:string;authority:StaffRequestAuthority }) {
  const {current}=useBriefingRequest(authority),navigate=(path:string)=>{if(current())onNavigate(path);};
  const { data, error, loading } = useArtifactRead<any>(authority,'/api/overview',refresh);
  const briefings=useArtifactRead<{items:BriefingRow[]}>(authority,'/api/briefings?archiveStatus=active&sort=updated&page=1&pageSize=5',refresh);
  if (loading) return <p className="loading">Loading overview...</p>;
  if (error || !data) return <Notice>{error || 'Overview unavailable'}</Notice>;
  const m: Counts = data.metrics;
  const partial=(item:BriefingRow)=>item.sendState==='published' && (item.undelivered || 0)>0;
  return <><div className="page-header"><div><h1>{greeting}{name ? `, ${name.split(' ')[0]}` : '' }.</h1><p>What needs attention today, and what your team is working on.</p></div>{canWrite && <button className="button primary" onClick={() => navigate('send')}><Send size={20} /> Send instruction</button>}</div><div className="metrics overview-metrics" role="group" aria-label="Latest instruction summary"><Metric icon={Users} value={m.assigned} label="Workers assigned" /><Metric icon={FileText} value={m.responses} label="Responses received" /><Metric icon={MessageCircle} value={m.clarifications} label="Need clarification" warn /><Metric icon={Clock3} value={m.pending} label="Waiting to answer" /></div>
  <div className="overview-dashboard">
    <Panel className="overview-attention" title={`Needs your attention (${data.cases.length})`}>{data.cases.length?<div className="row-list">{data.cases.map((item: Case) => <button className="item-row overview-case" key={item.id} onClick={() => navigate(`clarifications/${item.id}`)}><span className="small-avatar"><MessageCircle size={20} /></span><span className="item-main"><strong>{item.worker} · {item.language.toUpperCase()}</strong><small>{item.title} · {caseReason('en', item.reason)}</small></span><ChevronRight size={18} /></button>)}</div>:<p>No open clarifications. Responses that need a person appear here.</p>}<button className="text-link" onClick={() => navigate('clarifications')}>Open clarifications <ChevronRight size={16} /></button></Panel>
    <Panel className="overview-completion" title="Response completion"><div className="progress-row"><strong>{m.completion}%</strong><span>answered · {m.responses} of {m.assigned} recipients</span></div><div className="progress"><span style={{ width: `${m.completion}%` }} /></div><div className="legend"><span><i className="dot green" />{m.matches} match the key facts</span><span><i className="dot amber" />{m.clarifications} need clarification</span>{m.unassessed > 0 && <span><i className="dot blue" />{m.unassessed} awaiting assessment</span>}{!!m.acknowledged && <span><i className="dot violet" />{m.acknowledged} acknowledged</span>}<span><i className="dot grey" />{m.pending} waiting to answer</span></div>{data.publication && <button className="text-link" onClick={() => navigate(`briefings/${data.publication.briefingId}`)}>{data.publication.title} · Published v{data.publication.version}<ChevronRight size={18} /></button>}</Panel>
    <Panel className="overview-recent" title="Recent instructions">
        {briefings.loading?<p role="status">Loading instructions...</p>:briefings.error?<p className="muted">{briefings.error}</p>:briefings.data?.items.length?<div className="table-wrap"><table className="overview-briefing-table"><thead><tr><th>Title</th><th>Languages</th><th>Responses</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>
          {briefings.data.items.map(item=><tr key={item.id}><td><button className="briefing-title-button" onClick={()=>navigate(`briefings/${item.id}`)}><strong>{item.title}</strong></button></td><td><span className="language-chips">{(item.languages || []).map(code=><i key={code}>{code.toUpperCase()}</i>)}{!item.languages?.length && <span className="muted">—</span>}</span></td><td>{item.metrics?item.metrics.assigned?`${item.metrics.responses} / ${item.metrics.assigned}`:item.state==='processing'?'Draft':'—':item.state==='processing'?'Draft':'Scheduled'}</td><td>{partial(item)?<span className="status status-amber"><span className="status-dot" />partly sent · {item.undelivered} not delivered</span>:<Status value={item.publication_state || item.state}/>}</td><td><button className="icon-button" aria-label={`Open ${item.title}`} title={`Open ${item.title}`} onClick={()=>navigate(`briefings/${item.id}`)}><ChevronRight size={17}/></button></td></tr>)}
        </tbody></table></div>:<p>No instructions yet.</p>}
        <button className="text-link" onClick={()=>navigate('briefings')}>View all instructions <ChevronRight size={16}/></button>
      </Panel>
    <Panel className="overview-team" title="Team"><div className="progress-row"><strong>{m.pending}</strong><span>still to answer</span></div><button className="text-link" onClick={() => navigate('people')}>Open team <ChevronRight size={16}/></button><p className="muted">Manage worker access, crews and languages in Team.</p></Panel>
    <Panel className="overview-tools" title="More for supervisors"><div className="row-list"><button className="item-row" onClick={()=>navigate('source-audio')}><span className="small-avatar"><Volume2 size={19}/></span><span className="item-main"><strong>Audio uploads</strong><small>Upload and review recorded sources</small></span><ChevronRight size={17}/></button><button className="item-row" onClick={()=>navigate('processing')}><span className="small-avatar"><Sparkles size={19}/></span><span className="item-main"><strong>AI processing</strong><small>Preparation status and retries</small></span><ChevronRight size={17}/></button></div></Panel>
  </div><Notice tone="blue">Matching answers record the key facts asked. This does not certify understanding or safe work.</Notice></>;
}

type BriefingRow=Briefing & {languages?:string[];metrics?:Counts|null;responseMode?:string;deliveryMode?:string;sendState?:string;delivered?:number;undelivered?:number};
function Briefings({ refresh, navigate:onNavigate,canWrite,authority }: { refresh: number; navigate: (path: string) => void;canWrite:boolean;authority:StaffRequestAuthority }) {
  return <InstructionLibrary authority={authority} refresh={refresh} navigate={onNavigate} canWrite={canWrite}/>;
}

function BriefingDetail({ id, refresh, act, navigate,onChanged,canWrite,scope,languageSession,authority,timezone='UTC' }: { id: string; refresh: number; act: (path: string, body?: unknown) => Promise<any>; navigate: (path: string) => void;onChanged:()=>void;canWrite:boolean;scope?:string|null;languageSession:LanguageSession;authority:StaffRequestAuthority;timezone?:string }) {
  const {current:detailCurrent}=useBriefingRequest(authority);
  const [publicationRecovery,setPublicationRecovery]=useState<{pending:PendingPublication|null;error:string}>(()=>{try {return {pending:scope?readPendingPublication(sessionStorage,scope):null,error:''};}catch(reason){return {pending:null,error:(reason as Error).message};}});
  const [recovery,setRecovery]=useReviewRecovery(scope);
  const [regenerationRecovery,setRegenerationRecovery]=useState(()=>{try {return {pending:scope ? readPendingRegeneration(sessionStorage,scope) : null,error:''};}catch(reason) {return {pending:null,error:(reason as Error).message};}});
  const { data, error, loading } = useArtifactRead<any>(authority,`/api/briefings/${encodeURIComponent(id)}`,refresh);
  const [editingSource,setEditingSource]=useState(false),[editingReview,setEditingReview]=useState(false),[editingLanguages,setEditingLanguages]=useState(false),[processingPending,setProcessingPending]=useState(false);
  const editing=editingSource || editingReview || editingLanguages || processingPending || !!recovery.pending || !!recovery.error || !!regenerationRecovery.pending || !!regenerationRecovery.error || !!publicationRecovery.pending || !!publicationRecovery.error;
  const [detailView,setDetailView]=useState('overview');
  const [deliveryNotice,setDeliveryNotice]=useState<'sent'|'scheduled'|null>(null);
  const [selectedPublication,setSelectedPublication]=useState<PublicationSummary|null>(null);
  const [draftStep,setDraftStep]=useState<DraftStep>('source'),[stepFocus,setStepFocus]=useState(0);
  const sourceStep=useRef<HTMLElement>(null),processingStep=useRef<HTMLElement>(null),languageStep=useRef<HTMLElement>(null),publishStep=useRef<HTMLElement>(null);
  function selectStep(step:DraftStep){setDeliveryNotice(null);if(step==='languages')setSelectedPublication(null);setDraftStep(step);setDetailView('draft');setStepFocus(value=>value+1);}
  useEffect(()=>{if(!stepFocus)return;const targets={source:sourceStep,processing:processingStep,languages:languageStep,publish:publishStep};targets[draftStep].current?.focus();},[stepFocus,draftStep,detailView]);
  const titleRef=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(data?.id===id) titleRef.current?.focus();},[data?.id,id,recovery.pending]);
  useEffect(() => {if(data?.state!=='processing' || editing) return;const timer=window.setInterval(()=>{if(detailCurrent())onChanged();},2000);return () => clearInterval(timer);},[data?.state,onChanged,editing,detailCurrent]);
  if(publicationRecovery.error)return <><h1>Publication recovery</h1><p role="alert" className="record-error">{publicationRecovery.error}</p></>;
  if(publicationRecovery.pending && scope)return <BriefingView label="Publication recovery"><PublicationRecovery authority={authority} pending={publicationRecovery.pending} scope={scope} onResolved={(briefingId,accepted)=>{if(!detailCurrent())return;const scheduled=publicationRecovery.pending?.kind==='schedule';setPublicationRecovery({pending:null,error:''});setDetailView(accepted?scheduled?'history':'overview':'draft');setDeliveryNotice(accepted?scheduled?'scheduled':'sent':null);setDraftStep('source');onChanged();if(briefingId!==id)navigate(`briefings/${briefingId}`);}}/></BriefingView>;
  if(recovery.error) return <><h1>Draft review recovery</h1><p role="alert" className="record-error">{recovery.error}</p></>;
  if(recovery.pending && scope) return <DraftReviewRecovery authority={authority} pending={recovery.pending} scope={scope} onResolved={briefingId=>{if(!detailCurrent())return;setRecovery({pending:null,error:''});onChanged();if(briefingId!==id) navigate(`briefings/${briefingId}`);}}/>;
  if(regenerationRecovery.error) return <><h1>Regeneration recovery</h1><p role="alert" className="record-error">{regenerationRecovery.error}</p></>;
  if(regenerationRecovery.pending && scope) return <BriefingView><RegenerationRecovery authority={authority} pending={regenerationRecovery.pending} scope={scope} onResolved={briefingId=>{if(!detailCurrent())return;setRegenerationRecovery({pending:null,error:''});onChanged();if(briefingId!==id) navigate(`briefings/${briefingId}`);}}/></BriefingView>;
  if (loading && !data) return <p>Loading instruction...</p>;
  if (error || !data) return <Notice>{error || 'Instruction unavailable'}</Notice>;
  const current = data.publications?.[0];
  const readyToPublish=draftSteps(data)[3].available;
  const canPrepare=canWrite && !data.archive && !data.contentExpired;
  return <div className="briefing-draft-detail instruction-detail">
    <button className="back-link" onClick={()=>navigate('briefings')}><ArrowLeft size={18}/>Instructions</button>
    <div className="page-header"><div><h1 ref={titleRef} tabIndex={-1}>{data.title}</h1><div className="instruction-heading-meta"><Status value={data.archive?'archived':current?.state||data.state}/><span>{current?`Sent version ${current.version}`:`Not sent · draft v${data.next_version}`}</span></div></div>{canPrepare&&detailView!=='draft'&&<div className="actions"><button className="button primary" disabled={editing||loading} onClick={()=>selectStep('source')}><Pencil size={18}/>{current?'Prepare update':'Prepare draft'}</button></div>}</div>
    {data.archive&&<Notice tone="blue">Archived {new Date(data.archive.occurred_at).toLocaleString()} · {data.archive.reason}</Notice>}
    {data.contentExpired&&<Notice tone="blue">Instruction content expired. Version identities, audience and response outcomes remain in history.</Notice>}
    {((deliveryNotice==='sent'&&detailView==='overview')||(deliveryNotice==='scheduled'&&detailView==='history'))&&<p className="notice notice-green" role="status">{deliveryNotice==='scheduled'?'Delivery scheduled. Review its timing and status in Delivery schedules below.':'Instruction sent. Track replies in Responses.'}</p>}
    <nav className="briefing-detail-tabs" aria-label="Instruction views">
      <button disabled={editing} aria-pressed={detailView==='overview'} onClick={()=>{setSelectedPublication(null);setDetailView('overview');}}>Overview</button>
      <button disabled={editing} aria-pressed={detailView==='responses'} onClick={()=>setDetailView('responses')}>Responses</button>
      <button disabled={editing} aria-pressed={detailView==='languages'} onClick={()=>{setSelectedPublication(selectedPublication||current||null);setDetailView('languages');}}>Languages</button>
      <button disabled={editing} aria-pressed={detailView==='history'} onClick={()=>setDetailView('history')}>History</button>
      {canPrepare&&<button disabled={editing} aria-pressed={detailView==='draft'} onClick={()=>selectStep(draftStep)}>Draft v{data.next_version}</button>}
    </nav>
    {detailView==='overview'&&<InstructionOverview key={`${id}:${languageSession.clientContext}`} draft={data} publication={current||null} context={languageSession.clientContext} refresh={refresh} onResponses={()=>{setSelectedPublication(current||null);setDetailView('responses');}} onLanguages={()=>{setSelectedPublication(current||null);setDetailView('languages');}}/>}
    {detailView==='overview'&&!data.contentExpired&&<StaffInstructionFiles authority={authority} briefingId={id} refresh={refresh}/>}
    {detailView==='responses'&&<PublicationResponses authority={authority} key={(selectedPublication||current)?.id||'empty'} briefingId={id} publication={selectedPublication||current||null} onSelect={setSelectedPublication} context={languageSession.clientContext} refresh={refresh} navigate={navigate} canPlayAudio={canWrite}/>}
    {detailView==='languages'&&(current?<section aria-label="Published languages"><p className="instruction-stage-intro">Review the translated text and audio workers received. Draft changes are prepared separately.</p><BriefingView><LanguageArtifacts authority={authority} draft={data} selected={selectedPublication||current} onSelect={setSelectedPublication} pickerMode="published" refresh={refresh} canViewRubric={canWrite} scope={scope} clientContext={languageSession.clientContext} onChanged={onChanged} onEditingChange={setEditingReview}/></BriefingView></section>:<Panel title="Languages"><p>There is no sent version yet. Prepare and review languages in the draft workspace.</p>{canPrepare&&<button className="button outline" onClick={()=>selectStep('languages')}>Open draft languages<ArrowRight size={17}/></button>}</Panel>)}
    {detailView==='history'&&<><div className="instruction-history-grid"><Panel><PublicationHistory authority={authority} briefingId={id} selected={selectedPublication||current||null} onSelect={setSelectedPublication} context={languageSession.clientContext} refresh={refresh} disabled={editing||loading} onView={view=>{if(!selectedPublication&&current)setSelectedPublication(current);setDetailView(view);}} canWrite={canWrite} onChanged={()=>{setDeliveryNotice(null);onChanged();}}/></Panel><Panel className="instruction-manage-actions" title="Manage instruction"><p>Copy this instruction into a separate draft, or archive it to stop new activity. Saved history is retained.</p><div className="actions">{canWrite&&!data.contentExpired&&<CopyDraftControl authority={authority} id={id} revision={data.revision} title={data.title} disabled={editing||loading} onCopied={copyId=>navigate(`briefings/${copyId}`)}/>} {canWrite&&!data.archive&&<ArchiveBriefingControl authority={authority} id={id} revision={data.revision} nextVersion={data.next_version} disabled={editing||loading} onChanged={()=>{setDeliveryNotice(null);onChanged();}}/>}</div>{!canWrite&&<p>Your role can review history but cannot copy or archive instructions.</p>}</Panel></div>{canWrite&&<section className="instruction-schedules"><BriefingView label="Delivery schedules"><PublicationSchedules authority={authority} id={id} refresh={refresh} onChanged={()=>{setDeliveryNotice(null);onChanged();}} timezone={timezone}/></BriefingView></section>}</>}
    {detailView==='draft'&&!canPrepare&&<Panel title="Draft preparation unavailable"><p>This instruction cannot currently be changed. You can still review its saved versions and responses.</p><button className="button outline" onClick={()=>setDetailView('overview')}>View instruction</button></Panel>}
    {detailView==='draft'&&canPrepare&&<div className="instruction-draft-workspace"><div className="instruction-draft-context"><div><h2>Draft v{data.next_version}</h2><p>{current?.state==='published'?'Prepare the next version here. Workers continue to see the sent version until you publish an update.':current?'Prepare a new version here. Previous versions and their responses remain in History.':'Complete these steps to prepare and send this instruction.'}</p></div><Status value={data.state}/></div><DraftSteps draft={data} active={draftStep} disabled={editing||loading} onSelect={selectStep}/>
      {draftStep==='source'&&<>      <section ref={sourceStep} tabIndex={-1} aria-label="Draft source"><Panel title="Instruction text">
        {canWrite && !data.archive ? <DraftEditor authority={authority} key={`${data.revision}:${data.next_version}`} id={id} revision={data.revision} title={data.title} source={data.source} disabled={editingReview || editingLanguages || processingPending} onChanged={onChanged} onEditingChange={setEditingSource} /> : <p className="source-text">{data.source}</p>}
        {canWrite && !data.archive && !data.contentExpired && <div className="actions"><button className="button outline" disabled={editing || loading} onClick={()=>selectStep('processing')}><Sparkles size={18}/>Continue to AI processing</button></div>}
      </Panel></section>
</>}
      {draftStep==='processing'&&<>      <section ref={processingStep} tabIndex={-1} aria-label="Draft AI processing"><Panel title="AI processing"><p role="status">Draft preparation: {data.state.replaceAll('_',' ')}</p>{canWrite && <PreparationRequest authority={authority} briefingId={id} revision={data.revision} refresh={refresh} canStart={!data.archive && !data.contentExpired} disabled={editingSource || editingReview || editingLanguages || loading} onChanged={onChanged} onActiveChange={setProcessingPending}/>}<h3>Question and key facts</h3><DraftReview authority={authority} key={`${data.revision}:${data.next_version}`} id={id} scope={scope} revision={data.revision} review={data.review || null} prepared={data.prepared || null} canWrite={canWrite && !data.archive} disabled={editingSource || editingLanguages || processingPending || loading || data.state==='processing'} failed={data.state==='failed'} onChanged={()=>{onChanged();titleRef.current?.focus();}} onEditingChange={setEditingReview}/>{canWrite && !data.archive && !data.contentExpired && <div className="actions"><button className="button outline" disabled={editing || loading} onClick={()=>selectStep('languages')}><Languages size={18}/>Continue to languages</button></div>}</Panel></section>
</>}
      {draftStep==='languages'&&<section ref={languageStep} tabIndex={-1} aria-label="Draft languages"><Panel title="Languages for this draft"><DraftLanguages key={`${id}:${languageSession.clientContext}`} id={id} revision={data.revision} selection={data.generationLanguages||null} session={languageSession} canWrite={canWrite} disabled={editingSource||editingReview||processingPending||loading||data.state==='processing'} onChanged={onChanged} onEditingChange={setEditingLanguages}/></Panel><BriefingView><div inert={editingLanguages}><LanguageArtifacts authority={authority} draft={data} selected={null} onSelect={()=>{}} pickerMode="draft" refresh={refresh} canViewRubric={canWrite} scope={scope} clientContext={languageSession.clientContext} onChanged={onChanged} onEditingChange={setEditingReview}/></div></BriefingView>{readyToPublish&&<div className="actions"><button className="button primary" disabled={editing||loading} onClick={()=>selectStep('publish')}><Send size={18}/>Continue to publish</button></div>}</section>}
      {draftStep==='publish'&&<>      {readyToPublish && !editing && <section ref={publishStep} tabIndex={-1} aria-label="Draft publication"><BriefingView label="Publication"><PublishForm authority={authority} key={`${data.revision}:${data.next_version}:${timezone}`} id={id} revision={data.revision} version={data.next_version} timezone={timezone} scope={scope} onPending={pending=>{if(detailCurrent())setPublicationRecovery({pending,error:''});}} onChanged={outcome=>{setDraftStep('source');if(outcome){setDetailView(outcome==='schedule'?'history':'overview');setDeliveryNotice(outcome==='schedule'?'scheduled':'sent');}onChanged();titleRef.current?.focus();}} /></BriefingView></section>}
{!readyToPublish&&<Notice>Prepare and review this draft before publishing.</Notice>}</>}
    </div>}
  </div>;
}

function Processing({ refresh, navigate:onNavigate,canWrite,authority }: { refresh: number; navigate: (path: string) => void;canWrite:boolean;authority:StaffRequestAuthority }) {
  const {current}=useBriefingRequest(authority),navigate=(path:string)=>{if(current())onNavigate(path);};
  const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[kind,setKind]=useState('all'),[sort,setSort]=useState('newest'),[page,setPage]=useState(1),[tick,setTick]=useState(0);
  const query=new URLSearchParams({search,status,kind,sort,page:String(page),pageSize:'20'});
  const read=useArtifactRead<unknown>(authority,`/api/processing?${query}`,refresh+tick);
  let data:ProcessingPage|null=null,error=read.error;const loading=read.loading;
  if(read.data)try{data=checkedProcessingPage(read.data,page);}catch(reason){error=(reason as Error).message;}
  const pages=Math.max(1,Math.ceil((data?.total || 0)/20));
  return <><div className="page-header"><div><h1>AI processing</h1><p>Processing activity at this site.</p></div><div className="actions"><button className="button outline" onClick={()=>navigate('glossary')}><Languages size={18}/>Company glossary</button><button className="icon-button" aria-label="Refresh processing queue" title="Refresh processing queue" disabled={loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={18}/></button>{canWrite && <button className="button outline" onClick={() => navigate('briefings/new')}><Plus size={18} /> New instruction</button>}</div></div>
    <div className="filters"><label className="search-box"><Search size={18}/><span className="sr-only">Search processing jobs</span><input value={search} maxLength={80} placeholder="Search jobs" onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label><label className="select-label">Job type<select value={kind} onChange={event=>{setKind(event.target.value);setPage(1);}}><option value="all">All types</option>{processingKinds.map(value=><option key={value} value={value}>{processingKindLabels[value]}</option>)}</select></label><label className="select-label">Job status<select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="all">All states</option><option value="queued">Queued</option><option value="processing">Processing</option><option value="ready">Ready</option><option value="complete">Complete</option><option value="failed">Failed</option><option value="blocked">Blocked</option></select></label><label className="select-label">Sort jobs<select value={sort} onChange={event=>{setSort(event.target.value);setPage(1);}}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
    <Panel className="processing-queue" title={loading ? 'Processing queue' : `Processing queue (${data?.total || 0})`}>{loading ? <p role="status">Loading jobs...</p> : error ? <Notice>{error}</Notice> : data?.items.length ? <div className="row-list">{data.items.map(job=><button key={job.id} className="item-row" onClick={()=>navigate(`processing/${job.id}`)}><span className="small-avatar">{job.kind==='prepare'?<Sparkles size={20}/>:job.kind==='answer_check'?<FileText size={20}/>:<Volume2 size={20}/>}</span><span className="item-main"><strong>{job.title}</strong><small>{processingKindLabels[job.kind]}{job.kind==='prepare'?` · Revision ${job.revision}`:job.publication_version!==null?` · Published v${job.publication_version}`:''} · Attempts: {job.attempts}{job.mode==='inline-synthetic'?' · Inline synthetic':''}{job.archived_at?' · Archived':job.kind==='prepare' && job.revision!==job.draft_revision?' · Older revision':''}</small></span><Status value={job.status}/><ChevronRight size={18}/></button>)}</div> : <p>{page>pages ? 'This page is no longer available.' : 'No jobs match these filters.'}</p>}
      {!loading && !error && data && <div className="audit-pagination"><span>Page {page} of {pages} · {data.total} jobs</span><div className="actions"><button className="icon-button" aria-label="Previous processing page" title="Previous processing page" disabled={page<=1} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="Next processing page" title="Next processing page" disabled={page>=pages} onClick={()=>setPage(value=>value+1)}><ChevronRight size={18}/></button>{page>pages && <button className="button outline" onClick={()=>setPage(1)}>First page</button>}</div></div>}
    </Panel><Notice tone="blue">Job completion is not proof of understanding or safe work.</Notice></>;
}

function ProcessingDetail({id,refresh,navigate:onNavigate,canWrite,onChanged,authority}:{id:string;refresh:number;navigate:(path:string)=>void;canWrite:boolean;onChanged:()=>void;authority:StaffRequestAuthority}) {
  const {current}=useBriefingRequest(authority),navigate=(path:string)=>{if(current())onNavigate(path);};
  const [tick,setTick]=useState(0),[busy,setBusy]=useState(false),[responseOpen,setResponseOpen]=useState(false);
  const read=useArtifactRead<unknown>(authority,`/api/processing/${encodeURIComponent(id)}`,refresh+tick);
  const verified=useRef<ProcessingJob|null>(null);
  let data:ProcessingJob|null=null,error=read.error;const loading=read.loading;
  if(read.data)try{data=checkedProcessingJob(read.data,id);verified.current=data;}catch(reason){error=(reason as Error).message;}
  // Keep recovery controls mounted during this exact session/job's refresh.
  else if(loading && current())data=verified.current;
  if(error || !current()){verified.current=null;data=null;}
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(data?.id===id) heading.current?.focus();},[data?.id,id]);
  useEffect(()=>{if(busy || responseOpen || !data || !['queued','processing'].includes(data.status)) return;const timer=window.setInterval(()=>{if(current())setTick(value=>value+1);},2000);return ()=>clearInterval(timer);},[data?.status,busy,responseOpen,current]);
  return <><button className="back-link" onClick={()=>navigate('processing')}><ArrowLeft size={18}/> AI processing</button>{loading && !data ? <p role="status">Loading job...</p> : error || !data ? <Notice>{error || 'Processing job unavailable'}</Notice> : <>
    <div className="page-header"><div><h1 ref={heading} tabIndex={-1}>{data.title}</h1><p>{processingKindLabels[data.kind]}{data.revision!==null?` · source revision ${data.revision}`:data.publication_version!==null?` · published v${data.publication_version}`:''}</p></div><Status value={data.status}/></div><Panel title="Job details"><dl className="processing-details"><dt>Job ID</dt><dd>{data.id}</dd><dt>Created</dt><dd>{new Date(data.created_at).toLocaleString()}</dd><dt>Attempts</dt><dd>{data.attempts}</dd><dt>Execution</dt><dd>{data.mode==='inline-synthetic'?'Inline synthetic check':'Durable processor'}</dd>{data.draft_revision!==null && <><dt>Current draft</dt><dd>Revision {data.draft_revision} · {data.archived_at?'archived':data.draft_state}</dd></>}{data.publication_version!==null && <><dt>Published version</dt><dd>v{data.publication_version}</dd></>}{data.source_request_id && <><dt>Source request</dt><dd>{data.source_request_id}</dd></>}</dl>
      {data.error && <Notice>{data.error}</Notice>}<div className="actions">{data.briefing_id && <button className="button outline" onClick={()=>navigate(`briefings/${data!.briefing_id}`)}><FileText size={18}/>View instruction</button>}{data.publication_id && data.assignment_id && <button className="button outline" aria-expanded={responseOpen} onClick={()=>{if(current())setResponseOpen(value=>!value);}}><FileText size={18}/>View response and AI check</button>}{canWrite && data.kind==='source_transcription' && data.own_source && <button className="button outline" onClick={()=>navigate('source-audio')}><Volume2 size={18}/>My source audio uploads</button>}<button className="icon-button" aria-label="Refresh job" title="Refresh job" disabled={busy || loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={18}/></button></div>{canWrite && data.kind==='prepare' && data.briefing_id && data.revision!==null && <PreparationRequest authority={authority} briefingId={data.briefing_id} revision={data.revision} jobId={data.id} refresh={refresh+tick} canStart={data.retryAvailable} disabled={loading} onActiveChange={setBusy} onChanged={()=>{if(current()){onChanged();setTick(value=>value+1);heading.current?.focus();}}}/>}{canWrite && data.kind==='source_transcription' && data.own_source && data.source_request_id && <ProcessingSourceRetry authority={authority} sourceId={data.source_request_id} refresh={refresh+tick} retryable={data.sourceRetryAvailable} onChanged={()=>{if(current()){onChanged();setTick(value=>value+1);}}}/>}
    </Panel>{canWrite && data.mode==='durable' && ['response_transcription','answer_check'].includes(data.kind) && data.publication_id && data.assignment_id && <ProcessingRetry authority={authority} jobId={data.id} publicationId={data.publication_id} assignmentId={data.assignment_id} refresh={refresh+tick} disabled={loading} onActiveChange={setBusy} onChanged={()=>{if(current()){onChanged();setTick(value=>value+1);}}}/>}{data.kind==='prepare' && <PreparationProgress progress={data.progress}/>}<ProcessingProvenance authority={authority} job={data} refresh={refresh+tick}/><Notice tone="blue">Published versions and earlier answers remain unchanged.</Notice>{responseOpen && data.publication_id && data.assignment_id && <ResponseDetail authority={authority} key={`${data.publication_id}:${data.assignment_id}`} publicationId={data.publication_id} assignmentId={data.assignment_id} refresh={refresh+tick} onClose={()=>{if(current())setResponseOpen(false);}} navigate={navigate} canPlayAudio={canWrite}/>}</>}</>;
}

function PreparationProgress({progress}:{progress?:ProcessingProgress}) {
  const label=(value:string)=>value.replaceAll('_',' ');
  if(!progress?.available) return <Panel title="Stage progress"><p className="muted">No stage history is available for this job.</p></Panel>;
  return <Panel title="Stage progress"><p className="muted">Validated preparation stages are recorded per attempt. Earlier attempts remain visible after a retry.</p><div className="processing-attempts">
    {progress.attempts.map((attempt,index)=><section className="processing-attempt" key={`${attempt.startedAt}-${index}`} aria-label={`${attempt.current ? 'Current' : 'Previous'} preparation attempt`}><div className="processing-attempt-header"><strong>{attempt.current ? 'Current attempt' : 'Previous attempt'}</strong><time dateTime={attempt.startedAt}>{new Date(attempt.startedAt).toLocaleString()}</time></div><div className="processing-stage-list">
      {attempt.events.map((event,index)=><div className={`processing-stage processing-stage-${event.state}`} key={`${event.step}-${event.state}-${index}`}><span className="processing-stage-icon">{event.state==='completed' || event.state==='reused' ? <CheckCircle2 size={16}/> : event.state==='failed' ? <TriangleAlert size={16}/> : <Clock3 size={16}/>}</span><span className="processing-stage-copy"><strong>{label(event.stage)}{event.language ? ` · ${event.language.toUpperCase()}` : ''}{event.track ? ` · ${event.track}` : ''}</strong><small>{label(event.state)}{event.origin!=='system' ? ` · ${label(event.origin)}` : ''}{event.errorCode ? ` · ${label(event.errorCode)}` : ''}</small></span><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString()}</time></div>)}
    </div></section>)}
  </div></Panel>;
}

function Reports({refresh,authority,language,onLanguageChange}:{refresh:number;authority:StaffRequestAuthority;language:ReportLocale;onLanguageChange?:(language:ReportLocale)=>void}) {
  return <BriefingView label="Reports" fallbackCopy={{loading:reportText(language,'Loading reports...'),unavailable:reportText(language,'Reports page unavailable. Your saved export requests are unchanged.'),reload:reportText(language,'Reload')}}><ReportsPage authority={authority} refresh={refresh} language={language} onLanguageChange={onLanguageChange}/></BriefingView>;
}

type WorkerText={mine:string;todo:string;completed:string;listen:string;ack:string;open:string;help:string;back:string;question:string;answer:string;send:string;received:string;review:string;text:string;play:string;playQuestion:string;reply:string;helpTitle:string;helpPrompt:string;saved:string;version:string;skip:string;more:string;due:string;repeat:string;repeatSaved:string;reminder:string;thisDevice:string;receipt:string;ackTitle:string;ackBody:string;saving:string;ackAction:string;reviewTitle:string;reviewBody:string;edit:string;reviewAnswer:string;readInstruction:string;expired:string;emptyFollowup:string;followupShort:string;deadlinePassed:string};
const workerText:Record<WorkerUiLanguage,WorkerText> = {
  en: { mine: 'My instructions', todo: 'To do', completed: 'Completed', listen: 'Listen and respond', ack: 'Read and confirm', open: 'Open instruction', help: 'I need help', back: 'Back', question: 'Your turn', answer: 'Answer in your own words', send: 'Send answer', received: 'Your answer was received', review: 'Your supervisor may follow up if anything is unclear.', text: 'Read text', play: 'Play instruction', playQuestion: 'Play question', reply: 'Type your answer', helpTitle: 'Ask your supervisor for help', helpPrompt: 'What do you need help with?', saved: 'Your request was saved.', version: 'Instruction', skip: 'Skip to main content', more: 'More', due: 'Due', repeat: 'Your supervisor requested another answer', repeatSaved: 'Your supervisor requested another answer. Your earlier answer is preserved.', reminder: 'Reminder: your answer has not been received yet.', thisDevice: 'This device', receipt: 'Receipt', ackTitle: 'Acknowledge this instruction', ackBody: 'You are not being asked to answer. Confirm only that you have read or listened to the instruction.', saving: 'Saving...', ackAction: 'Acknowledge receipt', reviewTitle: 'Review your answer', reviewBody: 'This text will be sent to your supervisor.', edit: 'Edit', reviewAnswer: 'Review answer', readInstruction: 'Read the instruction', expired: 'Instruction content expired. Your response history remains below.', emptyFollowup: 'No open follow-up conversations.', followupShort: 'Follow-up', deadlinePassed: 'The answer deadline has passed. You can still ask for help.' },
  ar: { mine: 'تعليماتي', todo: 'للمتابعة', completed: 'مكتملة', listen: 'استمع وأجب', ack: 'اقرأ وأكّد', open: 'افتح التعليمات', help: 'أحتاج مساعدة', back: 'رجوع', question: 'دورك', answer: 'أجب بكلماتك الخاصة', send: 'أرسل الإجابة', received: 'تم استلام إجابتك', review: 'قد يتابع معك المشرف إذا كان هناك شيء غير واضح.', text: 'اقرأ النص', play: 'شغّل التعليمات', playQuestion: 'شغّل السؤال', reply: 'اكتب إجابتك', helpTitle: 'اطلب المساعدة من المشرف', helpPrompt: 'بماذا تحتاج المساعدة؟', saved: 'تم حفظ طلبك.', version: 'التعليمات', skip: 'انتقل إلى المحتوى الرئيسي', more: 'المزيد', due: 'الموعد النهائي', repeat: 'طلب المشرف إجابة جديدة', repeatSaved: 'طلب المشرف إجابة جديدة. إجابتك السابقة محفوظة.', reminder: 'تذكير: لم يُستلم ردك بعد.', thisDevice: 'هذا الجهاز', receipt: 'إيصال', ackTitle: 'أكّد استلام التعليمات', ackBody: 'لا يُطلب منك جواب. أكّد فقط أنك قرأت التعليمات أو استمعت إليها.', saving: 'جارٍ الحفظ...', ackAction: 'أؤكد الاستلام', reviewTitle: 'راجع إجابتك', reviewBody: 'سيتم إرسال هذا النص إلى مشرفك.', edit: 'تعديل', reviewAnswer: 'راجع إجابتك', readInstruction: 'اقرأ التعليمات', expired: 'انتهت مدة الاحتفاظ بمحتوى التعليمات. يظل سجل إجاباتك أدناه.', emptyFollowup: 'لا توجد محادثات متابعة مفتوحة.', followupShort: 'المتابعة', deadlinePassed: 'انتهى موعد الإجابة. لا يزال بإمكانك طلب المساعدة.' },
  ur: { mine: 'میری ہدایات', todo: 'کرنا ہے', completed: 'مکمل', listen: 'سنیں اور جواب دیں', ack: 'پڑھیں اور تصدیق کریں', open: 'ہدایات کھولیں', help: 'مجھے مدد چاہیے', back: 'واپس', question: 'آپ کی باری', answer: 'اپنے الفاظ میں جواب دیں', send: 'جواب بھیجیں', received: 'آپ کا جواب موصول ہو گیا', review: 'اگر کوئی بات واضح نہ ہوئی تو آپ کا سپروائزر رابطہ کر سکتا ہے۔', text: 'متن پڑھیں', play: 'ہدایات سنیں', playQuestion: 'سوال سنیں', reply: 'اپنا جواب لکھیں', helpTitle: 'سپروائزر سے مدد مانگیں', helpPrompt: 'آپ کو کس چیز میں مدد چاہیے؟', saved: 'آپ کی درخواست محفوظ ہو گئی۔', version: 'ہدایت', skip: 'مرکزی مواد پر جائیں', more: 'مزید', due: 'آخری وقت', repeat: 'سپروائزر نے نیا جواب مانگا ہے', repeatSaved: 'سپروائزر نے نیا جواب مانگا ہے۔ آپ کا پچھلا جواب محفوظ ہے۔', reminder: 'یاد دہانی: آپ کا جواب ابھی موصول نہیں ہوا۔', thisDevice: 'یہ آلہ', receipt: 'وصولی', ackTitle: 'ہدایات موصول ہونے کی تصدیق کریں', ackBody: 'آپ سے جواب نہیں مانگا جا رہا۔ صرف تصدیق کریں کہ آپ نے ہدایات پڑھ یا سن لی ہیں۔', saving: 'محفوظ ہو رہا ہے...', ackAction: 'موصول ہونے کی تصدیق کریں', reviewTitle: 'اپنا جواب دیکھیں', reviewBody: 'یہ متن آپ کے سپروائزر کو بھیجا جائے گا۔', edit: 'ترمیم', reviewAnswer: 'اپنا جواب دیکھیں', readInstruction: 'ہدایات پڑھیں', expired: 'بریفنگ کے مواد کی مدت ختم ہو گئی ہے۔ آپ کے جوابات کی تاریخ نیچے موجود ہے۔', emptyFollowup: 'ابھی کوئی کھلی گفتگو نہیں۔', followupShort: 'رابطہ', deadlinePassed: 'جواب کی آخری تاریخ گزر گئی ہے۔ آپ اب بھی مدد مانگ سکتے ہیں۔' },
  hi: { mine: 'मेरे निर्देश', todo: 'करना है', completed: 'पूर्ण', listen: 'सुनें और उत्तर दें', ack: 'पढ़ें और पुष्टि करें', open: 'निर्देश खोलें', help: 'मुझे सहायता चाहिए', back: 'वापस', question: 'आपकी बारी', answer: 'अपने शब्दों में उत्तर दें', send: 'उत्तर भेजें', received: 'आपका उत्तर प्राप्त हुआ', review: 'अगर कुछ स्पष्ट न हो तो आपका सुपरवाइज़र संपर्क कर सकता है।', text: 'पाठ पढ़ें', play: 'निर्देश सुनें', playQuestion: 'प्रश्न सुनें', reply: 'अपना उत्तर लिखें', helpTitle: 'सुपरवाइज़र से सहायता माँगें', helpPrompt: 'आपको किस चीज़ में सहायता चाहिए?', saved: 'आपका अनुरोध सहेजा गया।', version: 'निर्देश', skip: 'मुख्य सामग्री पर जाएँ', more: 'और', due: 'अंतिम समय', repeat: 'सुपरवाइज़र ने नया उत्तर माँगा है', repeatSaved: 'सुपरवाइज़र ने नया उत्तर माँगा है। आपका पिछला उत्तर सुरक्षित है।', reminder: 'याद दिलाना: आपका उत्तर अभी प्राप्त नहीं हुआ।', thisDevice: 'यह डिवाइस', receipt: 'प्राप्ति', ackTitle: 'इस निर्देश की प्राप्ति की पुष्टि करें', ackBody: 'आपसे उत्तर नहीं माँगा जा रहा। केवल पुष्टि करें कि आपने निर्देश पढ़ या सुन लिया है।', saving: 'सहेजा जा रहा है...', ackAction: 'प्राप्ति की पुष्टि करें', reviewTitle: 'अपना उत्तर देखें', reviewBody: 'यह पाठ आपके सुपरवाइज़र को भेजा जाएगा।', edit: 'संपादित करें', reviewAnswer: 'उत्तर देखें', readInstruction: 'निर्देश पढ़ें', expired: 'निर्देश की सामग्री की अवधि समाप्त हो गई है। आपके उत्तरों का इतिहास नीचे है।', emptyFollowup: 'अभी कोई खुली फ़ॉलो-अप बातचीत नहीं।', followupShort: 'फ़ॉलो-अप', deadlinePassed: 'उत्तर की अंतिम तिथि बीत गई है। आप अभी भी सहायता माँग सकते हैं।' },
  bn: { mine: 'আমার নির্দেশনা', todo: 'করতে হবে', completed: 'সম্পন্ন', listen: 'শুনুন ও উত্তর দিন', ack: 'পড়ুন ও নিশ্চিত করুন', open: 'নির্দেশনা খুলুন', help: 'আমার সাহায্য দরকার', back: 'ফিরে যান', question: 'আপনার পালা', answer: 'নিজের ভাষায় উত্তর দিন', send: 'উত্তর পাঠান', received: 'আপনার উত্তর পাওয়া গেছে', review: 'কিছু স্পষ্ট না হলে আপনার সুপারভাইজার যোগাযোগ করতে পারেন।', text: 'পাঠ পড়ুন', play: 'নির্দেশনা শুনুন', playQuestion: 'প্রশ্ন শুনুন', reply: 'আপনার উত্তর লিখুন', helpTitle: 'সুপারভাইজারের সাহায্য নিন', helpPrompt: 'কী বিষয়ে সাহায্য দরকার?', saved: 'আপনার অনুরোধ সংরক্ষণ করা হয়েছে।', version: 'নির্দেশনা', skip: 'মূল বিষয়বস্তুতে যান', more: 'আরও', due: 'শেষ সময়', repeat: 'সুপারভাইজার নতুন উত্তর চেয়েছেন', repeatSaved: 'সুপারভাইজার নতুন উত্তর চেয়েছেন। আপনার আগের উত্তর সংরক্ষিত আছে।', reminder: 'মনে করানো হচ্ছে: আপনার উত্তর এখনও পাওয়া যায়নি।', thisDevice: 'এই ডিভাইস', receipt: 'প্রাপ্তি', ackTitle: 'এই নির্দেশনার প্রাপ্তি নিশ্চিত করুন', ackBody: 'আপনার কাছে উত্তর চাওয়া হচ্ছে না। শুধু নিশ্চিত করুন যে আপনি নির্দেশনাটি পড়েছেন বা শুনেছেন।', saving: 'সংরক্ষণ হচ্ছে...', ackAction: 'প্রাপ্তি নিশ্চিত করুন', reviewTitle: 'আপনার উত্তর দেখুন', reviewBody: 'এই পাঠটি আপনার সুপারভাইজারের কাছে পাঠানো হবে।', edit: 'সম্পাদনা', reviewAnswer: 'উত্তর দেখুন', readInstruction: 'নির্দেশনা পড়ুন', expired: 'নির্দেশনার বিষয়বস্তুর সময় শেষ হয়েছে। আপনার উত্তরের ইতিহাস নিচে আছে।', emptyFollowup: 'এখনও কোনো খোলা ফলো-আপ আলাপ নেই।', followupShort: 'ফলো-আপ', deadlinePassed: 'উত্তরের শেষ সময় পেরিয়ে গেছে। আপনি এখনও সাহায্য চাইতে পারেন।' },
  ml: { mine: 'എന്റെ നിർദ്ദേശങ്ങൾ', todo: 'ചെയ്യാനുള്ളത്', completed: 'പൂർത്തിയായി', listen: 'കേട്ട് ഉത്തരം നൽകുക', ack: 'വായിച്ച് സ്ഥിരീകരിക്കുക', open: 'നിർദ്ദേശം തുറക്കുക', help: 'എനിക്ക് സഹായം വേണം', back: 'പിന്നോട്ട്', question: 'നിങ്ങളുടെ ഊഴം', answer: 'നിങ്ങളുടെ വാക്കുകളിൽ ഉത്തരം നൽകുക', send: 'ഉത്തരം അയക്കുക', received: 'നിങ്ങളുടെ ഉത്തരം ലഭിച്ചു', review: 'എന്തെങ്കിലും വ്യക്തമല്ലെങ്കിൽ നിങ്ങളുടെ സൂപ്പർവൈസർ ബന്ധപ്പെടാം.', text: 'പാഠം വായിക്കുക', play: 'നിർദ്ദേശം കേൾക്കുക', playQuestion: 'ചോദ്യം കേൾക്കുക', reply: 'നിങ്ങളുടെ ഉത്തരം എഴുതുക', helpTitle: 'സൂപ്പർവൈസറിനോട് സഹായം ചോദിക്കുക', helpPrompt: 'എന്തിലാണ് സഹായം വേണ്ടത്?', saved: 'നിങ്ങളുടെ അഭ്യർത്ഥന സംരക്ഷിച്ചു.', version: 'നിർദ്ദേശം', skip: 'പ്രധാന ഉള്ളടക്കത്തിലേക്ക് പോകുക', more: 'കൂടുതൽ', due: 'അവസാന സമയം', repeat: 'സൂപ്പർവൈസർ പുതിയ ഉത്തരം ആവശ്യപ്പെട്ടു', repeatSaved: 'സൂപ്പർവൈസർ പുതിയ ഉത്തരം ആവശ്യപ്പെട്ടു. നിങ്ങളുടെ മുൻ ഉത്തരം സംരക്ഷിച്ചിരിക്കുന്നു.', reminder: 'ഓർമ്മപ്പെടുത്തൽ: നിങ്ങളുടെ ഉത്തരം ഇതുവരെ ലഭിച്ചിട്ടില്ല.', thisDevice: 'ഈ ഉപകരണം', receipt: 'സ്വീകരണം', ackTitle: 'ഈ നിർദ്ദേശത്തിന്റെ സ്വീകരണം സ്ഥിരീകരിക്കുക', ackBody: 'നിങ്ങളോട് ഉത്തരം ആവശ്യപ്പെടുന്നില്ല. നിർദ്ദേശം വായിച്ചു അല്ലെങ്കിൽ കേട്ടു എന്ന് മാത്രം സ്ഥിരീകരിക്കുക.', saving: 'സംരക്ഷിക്കുന്നു...', ackAction: 'സ്വീകരണം സ്ഥിരീകരിക്കുക', reviewTitle: 'നിങ്ങളുടെ ഉത്തരം പരിശോധിക്കുക', reviewBody: 'ഈ പാഠം നിങ്ങളുടെ സൂപ്പർവൈസറിന് അയക്കും.', edit: 'തിരുത്തുക', reviewAnswer: 'ഉത്തരം പരിശോധിക്കുക', readInstruction: 'നിർദ്ദേശം വായിക്കുക', expired: 'നിർദ്ദേശ ഉള്ളടക്കത്തിന്റെ കാലാവധി കഴിഞ്ഞു. നിങ്ങളുടെ ഉത്തര ചരിത്രം താഴെയുണ്ട്.', emptyFollowup: 'ഇപ്പോൾ തുറന്ന ഫോളോ-അപ്പ് സംഭാഷണമില്ല.', followupShort: 'ഫോളോ-അപ്പ്', deadlinePassed: 'ഉത്തരത്തിന്റെ അവസാന സമയം കഴിഞ്ഞു. നിങ്ങൾക്ക് ഇപ്പോഴും സഹായം ചോദിക്കാം.' },
  ta: { mine: 'எனது அறிவுறுத்தல்கள்', todo: 'செய்ய வேண்டியவை', completed: 'முடிந்தது', listen: 'கேட்டு பதிலளிக்கவும்', ack: 'படித்து உறுதிப்படுத்தவும்', open: 'அறிவுறுத்தலைத் திற', help: 'எனக்கு உதவி வேண்டும்', back: 'பின்செல்', question: 'உங்கள் முறை', answer: 'உங்கள் சொந்த வார்த்தைகளில் பதிலளிக்கவும்', send: 'பதிலை அனுப்பு', received: 'உங்கள் பதில் பெறப்பட்டது', review: 'ஏதேனும் தெளிவில்லை என்றால் உங்கள் மேற்பார்வையாளர் தொடர்பு கொள்ளலாம்.', text: 'உரையைப் படி', play: 'அறிவுறுத்தலைக் கேள்', playQuestion: 'கேள்வியைக் கேள்', reply: 'உங்கள் பதிலை எழுதுங்கள்', helpTitle: 'மேற்பார்வையாளரிடம் உதவி கேளுங்கள்', helpPrompt: 'எதற்கு உதவி தேவை?', saved: 'உங்கள் கோரிக்கை சேமிக்கப்பட்டது.', version: 'அறிவுறுத்தல்', skip: 'முக்கிய உள்ளடக்கத்திற்குச் செல்', more: 'மேலும்', due: 'கடைசி நேரம்', repeat: 'மேற்பார்வையாளர் புதிய பதிலைக் கோரியுள்ளார்', repeatSaved: 'மேற்பார்வையாளர் புதிய பதிலைக் கோரியுள்ளார். உங்கள் முந்தைய பதில் பாதுகாக்கப்பட்டுள்ளது.', reminder: 'நினைவூட்டல்: உங்கள் பதில் இன்னும் பெறப்படவில்லை.', thisDevice: 'இந்தச் சாதனம்', receipt: 'பெறுதல்', ackTitle: 'இந்த அறிவுறுத்தலின் பெறுதலை உறுதிப்படுத்தவும்', ackBody: 'உங்களிடம் பதில் கேட்கப்படவில்லை. அறிவுறுத்தலைப் படித்தீர்கள் அல்லது கேட்டீர்கள் என்பதை மட்டும் உறுதிப்படுத்தவும்.', saving: 'சேமிக்கப்படுகிறது...', ackAction: 'பெறுதலை உறுதிப்படுத்து', reviewTitle: 'உங்கள் பதிலை மதிப்பாய்வு செய்யவும்', reviewBody: 'இந்த உரை உங்கள் மேற்பார்வையாளருக்கு அனுப்பப்படும்.', edit: 'திருத்து', reviewAnswer: 'பதிலை மதிப்பாய்வு செய்', readInstruction: 'அறிவுறுத்தலைப் படி', expired: 'அறிவுறுத்தல் உள்ளடக்கத்தின் காலம் முடிந்தது. உங்கள் பதில் வரலாறு கீழே உள்ளது.', emptyFollowup: 'இப்போது திறந்த பின்தொடர்வு உரையாடல்கள் இல்லை.', followupShort: 'பின்தொடர்வு', deadlinePassed: 'பதிலுக்கான கடைசி நேரம் கடந்துவிட்டது. நீங்கள் இன்னும் உதவி கேட்கலாம்.' },
  te: { mine: 'నా సూచనలు', todo: 'చేయాల్సినవి', completed: 'పూర్తయింది', listen: 'వినండి మరియు సమాధానం ఇవ్వండి', ack: 'చదివి నిర్ధారించండి', open: 'సూచనను తెరవండి', help: 'నాకు సహాయం కావాలి', back: 'వెనుకకు', question: 'మీ వంతు', answer: 'మీ మాటల్లో సమాధానం ఇవ్వండి', send: 'సమాధానం పంపండి', received: 'మీ సమాధానం అందింది', review: 'ఏదైనా స్పష్టంగా లేకపోతే మీ సూపర్‌వైజర్ సంప్రదించవచ్చు.', text: 'పాఠ్యం చదవండి', play: 'సూచనను వినండి', playQuestion: 'ప్రశ్నను వినండి', reply: 'మీ సమాధానం రాయండి', helpTitle: 'సూపర్‌వైజర్‌ను సహాయం అడగండి', helpPrompt: 'ఏ విషయంలో సహాయం కావాలి?', saved: 'మీ అభ్యర్థన సేవ్ చేయబడింది.', version: 'సూచన', skip: 'ప్రధాన కంటెంట్‌కు వెళ్లండి', more: 'మరిన్ని', due: 'చివరి సమయం', repeat: 'సూపర్‌వైజర్ కొత్త సమాధానం అడిగారు', repeatSaved: 'సూపర్‌వైజర్ కొత్త సమాధానం అడిగారు. మీ మునుపటి సమాధానం భద్రంగా ఉంది.', reminder: 'గుర్తుచేస్తున్నాం: మీ సమాధానం ఇంకా అందలేదు.', thisDevice: 'ఈ పరికరం', receipt: 'అందుబాటు', ackTitle: 'ఈ సూచన అందుబాటును నిర్ధారించండి', ackBody: 'మీ నుండి సమాధానం అడగడం లేదు. మీరు సూచనను చదివారు లేదా విన్నారు అని మాత్రమే నిర్ధారించండి.', saving: 'సేవ్ అవుతోంది...', ackAction: 'అందుబాటును నిర్ధారించండి', reviewTitle: 'మీ సమాధానాన్ని సమీక్షించండి', reviewBody: 'ఈ పాఠ్యం మీ సూపర్‌వైజర్‌కు పంపబడుతుంది.', edit: 'మార్చండి', reviewAnswer: 'సమాధానాన్ని సమీక్షించండి', readInstruction: 'సూచనను చదవండి', expired: 'సూచన కంటెంట్ గడువు ముగిసింది. మీ సమాధానాల చరిత్ర క్రింద ఉంది.', emptyFollowup: 'ఇప్పుడు తెరిచిన ఫాలో-అప్ సంభాషణలు లేవు.', followupShort: 'ఫాలో-అప్', deadlinePassed: 'సమాధానం గడువు ముగిసింది. మీరు ఇంకా సహాయం అడగవచ్చు.' },
  ne: { mine: 'मेरा निर्देशनहरू', todo: 'गर्न बाँकी', completed: 'सम्पन्न', listen: 'सुन्नुहोस् र जवाफ दिनुहोस्', ack: 'पढ्नुहोस् र पुष्टि गर्नुहोस्', open: 'निर्देशन खोल्नुहोस्', help: 'मलाई सहयोग चाहिन्छ', back: 'फर्कनुहोस्', question: 'तपाईंको पालो', answer: 'आफ्नै शब्दमा जवाफ दिनुहोस्', send: 'जवाफ पठाउनुहोस्', received: 'तपाईंको जवाफ प्राप्त भयो', review: 'केही स्पष्ट नभएमा तपाईंको सुपरभाइजरले सम्पर्क गर्न सक्छ।', text: 'पाठ पढ्नुहोस्', play: 'निर्देशन सुन्नुहोस्', playQuestion: 'प्रश्न सुन्नुहोस्', reply: 'आफ्नो जवाफ लेख्नुहोस्', helpTitle: 'सुपरभाइजरसँग मद्दत माग्नुहोस्', helpPrompt: 'कुन कुरामा मद्दत चाहिन्छ?', saved: 'तपाईंको अनुरोध सुरक्षित भयो।', version: 'निर्देशन', skip: 'मुख्य सामग्रीमा जानुहोस्', more: 'थप', due: 'अन्तिम समय', repeat: 'सुपरभाइजरले नयाँ जवाफ माग्नुभयो', repeatSaved: 'सुपरभाइजरले नयाँ जवाफ माग्नुभयो। तपाईंको अघिल्लो जवाफ सुरक्षित छ।', reminder: 'सम्झना: तपाईंको जवाफ अझै प्राप्त भएको छैन।', thisDevice: 'यो उपकरण', receipt: 'प्राप्ति', ackTitle: 'यो निर्देशनको प्राप्ति पुष्टि गर्नुहोस्', ackBody: 'तपाईंसँग जवाफ मागिएको छैन। तपाईंले निर्देशन पढ्नुभयो वा सुन्नुभयो भन्ने मात्र पुष्टि गर्नुहोस्।', saving: 'सुरक्षित हुँदै...', ackAction: 'प्राप्ति पुष्टि गर्नुहोस्', reviewTitle: 'आफ्नो जवाफ समीक्षा गर्नुहोस्', reviewBody: 'यो पाठ तपाईंको सुपरभाइजरलाई पठाइनेछ।', edit: 'सम्पादन', reviewAnswer: 'जवाफ समीक्षा गर्नुहोस्', readInstruction: 'निर्देशन पढ्नुहोस्', expired: 'निर्देशन सामग्रीको अवधि सकियो। तपाईंको जवाफ इतिहास तल छ।', emptyFollowup: 'अहिले कुनै खुला फलो-अप कुराकानी छैन।', followupShort: 'फलो-अप', deadlinePassed: 'जवाफको अन्तिम समय बितिसक्यो। तपाईं अझै मद्दत माग्न सक्नुहुन्छ।' },
  fil: { mine: 'Mga tagubilin ko', todo: 'Gawin', completed: 'Tapos na', listen: 'Makinig at sumagot', ack: 'Basahin at kumpirmahin', open: 'Buksan ang tagubilin', help: 'Kailangan ko ng tulong', back: 'Bumalik', question: 'Iyong pagkakataon', answer: 'Sumagot sa sariling salita', send: 'Ipadala ang sagot', received: 'Natanggap ang sagot mo', review: 'Maaaring makipag-ugnayan ang supervisor mo kung may hindi malinaw.', text: 'Basahin ang teksto', play: 'Pakinggan ang tagubilin', playQuestion: 'Pakinggan ang tanong', reply: 'I-type ang sagot mo', helpTitle: 'Humingi ng tulong sa supervisor', helpPrompt: 'Ano ang kailangan mong tulong?', saved: 'Na-save ang request mo.', version: 'Tagubilin', skip: 'Lumaktaw sa pangunahing nilalaman', more: 'Higit pa', due: 'Takdang oras', repeat: 'Humiling ang supervisor ng bagong sagot', repeatSaved: 'Humiling ang supervisor ng bagong sagot. Naka-save ang dating sagot mo.', reminder: 'Paalala: hindi pa natatanggap ang sagot mo.', thisDevice: 'Device na ito', receipt: 'Resibo', ackTitle: 'Kumpirmahin ang pagtanggap ng tagubiling ito', ackBody: 'Hindi ka hinihilingang sumagot. Kumpirmahin lang na nabasa o napakinggan mo ang tagubilin.', saving: 'Nagse-save...', ackAction: 'Kumpirmahin ang pagtanggap', reviewTitle: 'Suriin ang sagot mo', reviewBody: 'Ipadadala ang tekstong ito sa supervisor mo.', edit: 'I-edit', reviewAnswer: 'Suriin ang sagot', readInstruction: 'Basahin ang tagubilin', expired: 'Nag-expire na ang nilalaman ng tagubilin. Nasa ibaba ang history ng sagot mo.', emptyFollowup: 'Walang bukas na follow-up na usapan.', followupShort: 'Follow-up', deadlinePassed: 'Lampas na ang deadline ng sagot. Maaari ka pa ring humingi ng tulong.' },
  si: { mine: 'මගේ උපදෙස්', todo: 'කළ යුතුයි', completed: 'සම්පූර්ණයි', listen: 'අසා පිළිතුරු දෙන්න', ack: 'කියවා තහවුරු කරන්න', open: 'උපදෙස් විවෘත කරන්න', help: 'මට උදව් අවශ්‍යයි', back: 'ආපසු', question: 'ඔබේ වාරය', answer: 'ඔබේම වචනවලින් පිළිතුරු දෙන්න', send: 'පිළිතුර යවන්න', received: 'ඔබේ පිළිතුර ලැබුණි', review: 'යමක් පැහැදිලි නැත්නම් ඔබේ අධීක්ෂකට සම්බන්ධ විය හැක.', text: 'පෙළ කියවන්න', play: 'උපදෙස් අසන්න', playQuestion: 'ප්‍රශ්නය අසන්න', reply: 'ඔබේ පිළිතුර ලියන්න', helpTitle: 'අධීක්ෂකගෙන් උදව් ඉල්ලන්න', helpPrompt: 'කුමකට උදව් අවශ්‍යද?', saved: 'ඔබේ ඉල්ලීම සුරැකිණි.', version: 'උපදෙස', skip: 'ප්‍රධාන අන්තර්ගතයට යන්න', more: 'තව', due: 'අවසන් වේලාව', repeat: 'අධීක්ෂක නව පිළිතුරක් ඉල්ලා ඇත', repeatSaved: 'අධීක්ෂක නව පිළිතුරක් ඉල්ලා ඇත. ඔබේ පෙර පිළිතුර සුරකිනු ලැබේ.', reminder: 'සිහිකැඳවීම: ඔබේ පිළිතුර තවම ලැබී නැත.', thisDevice: 'මෙම උපාංගය', receipt: 'ලැබීම', ackTitle: 'මෙම උපදෙස ලැබීම තහවුරු කරන්න', ackBody: 'ඔබෙන් පිළිතුරක් ඉල්ලා නොමැත. ඔබ උපදෙස කියවා හෝ අසා ඇති බව පමණක් තහවුරු කරන්න.', saving: 'සුරකිමින්...', ackAction: 'ලැබීම තහවුරු කරන්න', reviewTitle: 'ඔබේ පිළිතුර සමාලෝචනය කරන්න', reviewBody: 'මෙම පෙළ ඔබේ අධීක්ෂකට යැවෙනු ඇත.', edit: 'සංස්කරණය', reviewAnswer: 'පිළිතුර සමාලෝචනය', readInstruction: 'උපදෙස කියවන්න', expired: 'උපදෙස් අන්තර්ගතයේ කාලය අවසන්. ඔබේ පිළිතුරු ඉතිහාසය පහතින් ඇත.', emptyFollowup: 'දැනට විවෘත පසුවිපරම් සංවාද නැත.', followupShort: 'පසුවිපරම', deadlinePassed: 'පිළිතුරේ අවසන් වේලාව ඉක්මවා ඇත. ඔබට තවමත් උදව් ඉල්ලිය හැක.' },
  ru: { mine: 'Мои инструкции', todo: 'К выполнению', completed: 'Выполнено', listen: 'Слушайте и отвечайте', ack: 'Прочитайте и подтвердите', open: 'Открыть инструкцию', help: 'Мне нужна помощь', back: 'Назад', question: 'Ваша очередь', answer: 'Ответьте своими словами', send: 'Отправить ответ', received: 'Ваш ответ получен', review: 'Руководитель может связаться с вами, если что-то неясно.', text: 'Прочитать текст', play: 'Прослушать инструкцию', playQuestion: 'Прослушать вопрос', reply: 'Введите ваш ответ', helpTitle: 'Попросите помощи у руководителя', helpPrompt: 'В чём вам нужна помощь?', saved: 'Ваш запрос сохранён.', version: 'Инструкция', skip: 'Перейти к основному содержанию', more: 'Ещё', due: 'Срок', repeat: 'Руководитель запросил новый ответ', repeatSaved: 'Руководитель запросил новый ответ. Ваш предыдущий ответ сохранён.', reminder: 'Напоминание: ваш ответ пока не получен.', thisDevice: 'Это устройство', receipt: 'Получение', ackTitle: 'Подтвердите получение инструкции', ackBody: 'Отвечать не требуется. Подтвердите только, что вы прочитали или прослушали инструкцию.', saving: 'Сохранение...', ackAction: 'Подтвердить получение', reviewTitle: 'Проверьте ваш ответ', reviewBody: 'Этот текст будет отправлен вашему руководителю.', edit: 'Изменить', reviewAnswer: 'Проверить ответ', readInstruction: 'Прочитать инструкцию', expired: 'Срок хранения содержания инструкции истёк. История ваших ответов ниже.', emptyFollowup: 'Открытых бесед для уточнений пока нет.', followupShort: 'Уточнение', deadlinePassed: 'Срок ответа истёк. Вы всё ещё можете попросить помощи.' },
  'pa-Guru': { mine: 'ਮੇਰੀਆਂ ਹਦਾਇਤਾਂ', todo: 'ਕਰਨਾ ਹੈ', completed: 'ਪੂਰਾ ਹੋਇਆ', listen: 'ਸੁਣੋ ਅਤੇ ਜਵਾਬ ਦਿਓ', ack: 'ਪੜ੍ਹੋ ਅਤੇ ਪੁਸ਼ਟੀ ਕਰੋ', open: 'ਹਦਾਇਤ ਖੋਲ੍ਹੋ', help: 'ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ', back: 'ਵਾਪਸ', question: 'ਤੁਹਾਡੀ ਵਾਰੀ', answer: 'ਆਪਣੇ ਸ਼ਬਦਾਂ ਵਿੱਚ ਜਵਾਬ ਦਿਓ', send: 'ਜਵਾਬ ਭੇਜੋ', received: 'ਤੁਹਾਡਾ ਜਵਾਬ ਪ੍ਰਾਪਤ ਹੋਇਆ', review: 'ਜੇ ਕੁਝ ਸਪੱਸ਼ਟ ਨਾ ਹੋਵੇ ਤਾਂ ਤੁਹਾਡਾ ਸੁਪਰਵਾਈਜ਼ਰ ਸੰਪਰਕ ਕਰ ਸਕਦਾ ਹੈ।', text: 'ਪਾਠ ਪੜ੍ਹੋ', play: 'ਹਦਾਇਤ ਸੁਣੋ', playQuestion: 'ਸਵਾਲ ਸੁਣੋ', reply: 'ਆਪਣਾ ਜਵਾਬ ਲਿਖੋ', helpTitle: 'ਸੁਪਰਵਾਈਜ਼ਰ ਤੋਂ ਮਦਦ ਮੰਗੋ', helpPrompt: 'ਤੁਹਾਨੂੰ ਕਿਸ ਚੀਜ਼ ਵਿੱਚ ਮਦਦ ਚਾਹੀਦੀ ਹੈ?', saved: 'ਤੁਹਾਡੀ ਬੇਨਤੀ ਸੰਭਾਲੀ ਗਈ।', version: 'ਹਦਾਇਤ', skip: 'ਮੁੱਖ ਸਮੱਗਰੀ ਤੇ ਜਾਓ', more: 'ਹੋਰ', due: 'ਆਖਰੀ ਸਮਾਂ', repeat: 'ਸੁਪਰਵਾਈਜ਼ਰ ਨੇ ਨਵਾਂ ਜਵਾਬ ਮੰਗਿਆ ਹੈ', repeatSaved: 'ਸੁਪਰਵਾਈਜ਼ਰ ਨੇ ਨਵਾਂ ਜਵਾਬ ਮੰਗਿਆ ਹੈ। ਤੁਹਾਡਾ ਪਿਛਲਾ ਜਵਾਬ ਸੰਭਾਲਿਆ ਹੈ।', reminder: 'ਯਾਦ ਦਿਹਾਣੀ: ਤੁਹਾਡਾ ਜਵਾਬ ਅਜੇ ਪ੍ਰਾਪਤ ਨਹੀਂ ਹੋਇਆ।', thisDevice: 'ਇਹ ਡਿਵਾਈਸ', receipt: 'ਪ੍ਰਾਪਤੀ', ackTitle: 'ਇਸ ਹਦਾਇਤ ਦੀ ਪ੍ਰਾਪਤੀ ਦੀ ਪੁਸ਼ਟੀ ਕਰੋ', ackBody: 'ਤੁਹਾਡੇ ਤੋਂ ਜਵਾਬ ਨਹੀਂ ਮੰਗਿਆ ਜਾ ਰਿਹਾ। ਸਿਰਫ਼ ਪੁਸ਼ਟੀ ਕਰੋ ਕਿ ਤੁਸੀਂ ਹਦਾਇਤ ਪੜ੍ਹੀ ਜਾਂ ਸੁਣੀ ਹੈ।', saving: 'ਸੰਭਾਲਿਆ ਜਾ ਰਿਹਾ ਹੈ...', ackAction: 'ਪ੍ਰਾਪਤੀ ਦੀ ਪੁਸ਼ਟੀ ਕਰੋ', reviewTitle: 'ਆਪਣਾ ਜਵਾਬ ਵੇਖੋ', reviewBody: 'ਇਹ ਪਾਠ ਤੁਹਾਡੇ ਸੁਪਰਵਾਈਜ਼ਰ ਨੂੰ ਭੇਜਿਆ ਜਾਵੇਗਾ।', edit: 'ਸੋਧੋ', reviewAnswer: 'ਜਵਾਬ ਵੇਖੋ', readInstruction: 'ਹਦਾਇਤ ਪੜ੍ਹੋ', expired: 'ਹਦਾਇਤ ਦੀ ਸਮੱਗਰੀ ਦੀ ਮਿਆਦ ਖ਼ਤਮ ਹੋ ਗਈ ਹੈ। ਤੁਹਾਡੇ ਜਵਾਬਾਂ ਦਾ ਇਤਿਹਾਸ ਹੇਠਾਂ ਹੈ।', emptyFollowup: 'ਹਾਲੇ ਕੋਈ ਖੁੱਲ੍ਹੀ ਫ਼ਾਲੋ-ਅੱਪ ਗੱਲਬਾਤ ਨਹੀਂ।', followupShort: 'ਫ਼ਾਲੋ-ਅੱਪ', deadlinePassed: 'ਜਵਾਬ ਦੀ ਆਖਰੀ ਮਿਆਦ ਲੰਘ ਗਈ ਹੈ। ਤੁਸੀਂ ਅਜੇ ਵੀ ਮਦਦ ਮੰਗ ਸਕਦੇ ਹੋ।' },
  'pa-Arab': { mine: 'میریاں ہدایتاں', todo: 'کرنا اے', completed: 'مکمل', listen: 'سنو تے جواب دیو', ack: 'پڑھو تے تصدیق کرو', open: 'ہدایت کھولو', help: 'مینوں مدد چاہیدی اے', back: 'واپس', question: 'تہاڈی واری', answer: 'اپنے لفظاں وچ جواب دیو', send: 'جواب بھیجو', received: 'تہاڈا جواب موصول ہو گیا', review: 'جے کوئی گل واضح نہ ہووے تے تہاڈا سپروائزر رابطہ کر سکدا اے۔', text: 'متن پڑھو', play: 'ہدایت سنو', playQuestion: 'سوال سنو', reply: 'اپنا جواب لکھو', helpTitle: 'سپروائزر توں مدد منگو', helpPrompt: 'تہانوں کیہڑی گل وچ مدد چاہیدی اے؟', saved: 'تہاڈی درخواست محفوظ ہو گئی۔', version: 'ہدایت', skip: 'مرکزی مواد تے جاؤ', more: 'ہور', due: 'آخری ویلہ', repeat: 'سپروائزر نے نواں جواب منگیا اے', repeatSaved: 'سپروائزر نے نواں جواب منگیا اے۔ تہاڈا پچھلا جواب محفوظ اے۔', reminder: 'یاد دہانی: تہاڈا جواب ہالے موصول نئیں ہویا۔', thisDevice: 'ایہ آلہ', receipt: 'وصولی', ackTitle: 'ایس ہدایت دی وصولی دی تصدیق کرو', ackBody: 'تہاڈے توں جواب نئیں منگیا جا ریا۔ صرف تصدیق کرو کہ تسیں ہدایت پڑھی یا سنی اے۔', saving: 'محفوظ ہو ریا اے...', ackAction: 'وصولی دی تصدیق کرو', reviewTitle: 'اپنا جواب ویکھو', reviewBody: 'ایہ متن تہاڈے سپروائزر نوں بھیجیا جائے گا۔', edit: 'ترمیم', reviewAnswer: 'جواب ویکھو', readInstruction: 'ہدایت پڑھو', expired: 'ہدایت دے مواد دی مدت ختم ہو گئی اے۔ تہاڈے جواباں دی تریخ تھلے اے۔', emptyFollowup: 'ہالے کوئی کھلی گل بات نئیں۔', followupShort: 'رابطہ', deadlinePassed: 'جواب دی آخری مدت لنگھ گئی اے۔ تسیں ہالے وی مدد منگ سکدے او۔' },
  id: { mine: 'Instruksi saya', todo: 'Perlu dikerjakan', completed: 'Selesai', listen: 'Dengarkan dan jawab', ack: 'Baca dan konfirmasi', open: 'Buka instruksi', help: 'Saya butuh bantuan', back: 'Kembali', question: 'Giliran Anda', answer: 'Jawab dengan kata-kata Anda sendiri', send: 'Kirim jawaban', received: 'Jawaban Anda diterima', review: 'Supervisor Anda dapat menghubungi jika ada yang kurang jelas.', text: 'Baca teks', play: 'Putar instruksi', playQuestion: 'Putar pertanyaan', reply: 'Ketik jawaban Anda', helpTitle: 'Minta bantuan supervisor', helpPrompt: 'Bantuan apa yang Anda butuhkan?', saved: 'Permintaan Anda tersimpan.', version: 'Instruksi', skip: 'Lompat ke konten utama', more: 'Lainnya', due: 'Tenggat', repeat: 'Supervisor meminta jawaban baru', repeatSaved: 'Supervisor meminta jawaban baru. Jawaban Anda sebelumnya tetap tersimpan.', reminder: 'Pengingat: jawaban Anda belum diterima.', thisDevice: 'Perangkat ini', receipt: 'Tanda terima', ackTitle: 'Konfirmasi penerimaan instruksi ini', ackBody: 'Anda tidak diminta menjawab. Konfirmasikan hanya bahwa Anda telah membaca atau mendengarkan instruksi.', saving: 'Menyimpan...', ackAction: 'Konfirmasi penerimaan', reviewTitle: 'Tinjau jawaban Anda', reviewBody: 'Teks ini akan dikirim ke supervisor Anda.', edit: 'Ubah', reviewAnswer: 'Tinjau jawaban', readInstruction: 'Baca instruksi', expired: 'Konten instruksi telah kedaluwarsa. Riwayat jawaban Anda tetap ada di bawah.', emptyFollowup: 'Belum ada percakapan tindak lanjut yang terbuka.', followupShort: 'Tindak lanjut', deadlinePassed: 'Tenggat jawaban telah lewat. Anda masih dapat meminta bantuan.' },
};

type WorkerAux={emptyTodo:string;emptyDone:string;loading:string;unavailable:string;outcome:string;assessment:string;audioPending:string;audioFailed:string;typeInstead:string;recordInstead:string;matched:string;clarification:string;unassessable:string;saved:string};
const workerAux:Record<WorkerUiLanguage,WorkerAux> = {
  en: { emptyTodo: 'No instructions to do.', emptyDone: 'No completed instructions yet.', loading: 'Loading...', unavailable: 'Instruction unavailable', outcome: 'Recorded outcome', assessment: 'Synthetic local assessment. Your supervisor can review the original response.', audioPending: 'Recording received. The AI check is pending.', audioFailed: 'The recording could not be checked. Please ask your supervisor or record again.', typeInstead: 'Type', recordInstead: 'Record', matched: 'Matched key facts', clarification: 'Needs clarification', unassessable: 'Could not assess', saved: 'Saved.' },
  ar: { emptyTodo: 'لا توجد تعليمات للمتابعة.', emptyDone: 'لا توجد تعليمات مكتملة بعد.', loading: 'جار التحميل...', unavailable: 'التعليمات غير متاحة', outcome: 'نتيجة مسجلة', assessment: 'تقييم تجريبي محلي. يمكن للمشرف مراجعة إجابتك الأصلية.', audioPending: 'تم استلام التسجيل. التحقق الآلي قيد الانتظار.', audioFailed: 'تعذّر التحقق من التسجيل. اطلب المساعدة من المشرف أو سجّل مرة أخرى.', typeInstead: 'كتابة', recordInstead: 'تسجيل', matched: 'طابقت المعلومات المطلوبة', clarification: 'تحتاج إلى توضيح', unassessable: 'تعذر التقييم', saved: 'تم الحفظ.' },
  ur: { emptyTodo: 'ابھی کوئی ہدایت باقی نہیں۔', emptyDone: 'ابھی کوئی مکمل ہدایت نہیں۔', loading: 'لوڈ ہو رہا ہے...', unavailable: 'ہدایت دستیاب نہیں', outcome: 'درج شدہ نتیجہ', assessment: 'یہ مقامی آزمائشی جانچ ہے۔ سپروائزر اصل جواب دیکھ سکتا ہے۔', audioPending: 'ریکارڈنگ موصول ہو گئی۔ خودکار جانچ زیر التوا ہے۔', audioFailed: 'ریکارڈنگ کی جانچ نہ ہو سکی۔ سپروائزر سے مدد لیں یا دوبارہ ریکارڈ کریں۔', typeInstead: 'لکھیں', recordInstead: 'ریکارڈ کریں', matched: 'اہم حقائق درست ہیں', clarification: 'وضاحت درکار ہے', unassessable: 'جانچ ممکن نہیں', saved: 'محفوظ ہو گیا۔' },
  hi: { emptyTodo: 'करने के लिए कोई निर्देश नहीं।', emptyDone: 'अभी कोई पूर्ण निर्देश नहीं।', loading: 'लोड हो रहा है...', unavailable: 'निर्देश उपलब्ध नहीं', outcome: 'दर्ज परिणाम', assessment: 'यह स्थानीय कृत्रिम जाँच है। आपका सुपरवाइज़र मूल उत्तर देख सकता है।', audioPending: 'रिकॉर्डिंग प्राप्त हुई। AI जाँच लंबित है।', audioFailed: 'रिकॉर्डिंग की जाँच नहीं हो सकी। सुपरवाइज़र से मदद माँगें या फिर से रिकॉर्ड करें।', typeInstead: 'लिखें', recordInstead: 'रिकॉर्ड करें', matched: 'मुख्य तथ्य मेल खाते हैं', clarification: 'स्पष्टीकरण चाहिए', unassessable: 'जाँच संभव नहीं', saved: 'सहेजा गया।' },
  bn: { emptyTodo: 'করার মতো কোনো নির্দেশনা নেই।', emptyDone: 'এখনও কোনো সম্পন্ন নির্দেশনা নেই।', loading: 'লোড হচ্ছে...', unavailable: 'নির্দেশনা পাওয়া যাচ্ছে না', outcome: 'রেকর্ড করা ফলাফল', assessment: 'এটি স্থানীয় কৃত্রিম যাচাই। আপনার সুপারভাইজার মূল উত্তর দেখতে পারেন।', audioPending: 'রেকর্ডিং পাওয়া গেছে। AI যাচাই অপেক্ষমাণ।', audioFailed: 'রেকর্ডিং যাচাই করা যায়নি। সুপারভাইজারের সাহায্য নিন বা আবার রেকর্ড করুন।', typeInstead: 'লিখুন', recordInstead: 'রেকর্ড করুন', matched: 'মূল তথ্য মিলেছে', clarification: 'স্পষ্টীকরণ দরকার', unassessable: 'যাচাই করা যায়নি', saved: 'সংরক্ষিত।' },
  ml: { emptyTodo: 'ചെയ്യാനുള്ള നിർദ്ദേശങ്ങളില്ല.', emptyDone: 'ഇതുവരെ പൂർത്തിയായ നിർദ്ദേശങ്ങളില്ല.', loading: 'ലോഡ് ചെയ്യുന്നു...', unavailable: 'നിർദ്ദേശം ലഭ്യമല്ല', outcome: 'രേഖപ്പെടുത്തിയ ഫലം', assessment: 'ഇത് പ്രാദേശിക കൃത്രിമ പരിശോധനയാണ്. നിങ്ങളുടെ സൂപ്പർവൈസർ യഥാർത്ഥ ഉത്തരം കാണാം.', audioPending: 'റെക്കോർഡിംഗ് ലഭിച്ചു. AI പരിശോധന കാത്തിരിക്കുന്നു.', audioFailed: 'റെക്കോർഡിംഗ് പരിശോധിക്കാനായില്ല. സൂപ്പർവൈസറിനോട് സഹായം ചോദിക്കുക അല്ലെങ്കിൽ വീണ്ടും റെക്കോർഡ് ചെയ്യുക.', typeInstead: 'ടൈപ്പ് ചെയ്യുക', recordInstead: 'റെക്കോർഡ് ചെയ്യുക', matched: 'പ്രധാന വസ്തുതകൾ പൊരുത്തപ്പെട്ടു', clarification: 'വ്യക്തത ആവശ്യമാണ്', unassessable: 'പരിശോധിക്കാനായില്ല', saved: 'സംരക്ഷിച്ചു.' },
  ta: { emptyTodo: 'செய்ய வேண்டிய அறிவுறுத்தல்கள் இல்லை.', emptyDone: 'இதுவரை முடிந்த அறிவுறுத்தல்கள் இல்லை.', loading: 'ஏற்றப்படுகிறது...', unavailable: 'அறிவுறுத்தல் கிடைக்கவில்லை', outcome: 'பதிவு செய்யப்பட்ட முடிவு', assessment: 'இது உள்ளூர் செயற்கை சரிபார்ப்பு. உங்கள் மேற்பார்வையாளர் அசல் பதிலைப் பார்க்கலாம்.', audioPending: 'பதிவு பெறப்பட்டது. AI சரிபார்ப்பு நிலுவையில் உள்ளது.', audioFailed: 'பதிவைச் சரிபார்க்க முடியவில்லை. மேற்பார்வையாளரிடம் உதவி கேளுங்கள் அல்லது மீண்டும் பதிவு செய்யுங்கள்.', typeInstead: 'தட்டச்சு', recordInstead: 'பதிவு', matched: 'முக்கிய தகவல்கள் பொருந்தின', clarification: 'விளக்கம் தேவை', unassessable: 'சரிபார்க்க முடியவில்லை', saved: 'சேமிக்கப்பட்டது.' },
  te: { emptyTodo: 'చేయాల్సిన సూచనలు లేవు.', emptyDone: 'ఇంకా పూర్తయిన సూచనలు లేవు.', loading: 'లోడ్ అవుతోంది...', unavailable: 'సూచన అందుబాటులో లేదు', outcome: 'నమోదైన ఫలితం', assessment: 'ఇది స్థానిక కృత్రిమ పరిశీలన. మీ సూపర్‌వైజర్ అసలు సమాధానాన్ని చూడగలరు.', audioPending: 'రికార్డింగ్ అందింది. AI పరిశీలన పెండింగ్‌లో ఉంది.', audioFailed: 'రికార్డింగ్‌ను పరిశీలించలేకపోయాం. సూపర్‌వైజర్‌ను సహాయం అడగండి లేదా మళ్లీ రికార్డ్ చేయండి.', typeInstead: 'టైప్ చేయండి', recordInstead: 'రికార్డ్ చేయండి', matched: 'ముఖ్య అంశాలు సరిపోలాయి', clarification: 'వివరణ అవసరం', unassessable: 'పరిశీలించలేకపోయాం', saved: 'సేవ్ చేయబడింది.' },
  ne: { emptyTodo: 'गर्नुपर्ने निर्देशनहरू छैनन्।', emptyDone: 'अहिलेसम्म कुनै सम्पन्न निर्देशन छैन।', loading: 'लोड हुँदै...', unavailable: 'निर्देशन उपलब्ध छैन', outcome: 'रेकर्ड गरिएको नतिजा', assessment: 'यो स्थानीय कृत्रिम जाँच हो। तपाईंको सुपरभाइजरले मूल जवाफ हेर्न सक्नुहुन्छ।', audioPending: 'रेकर्डिङ प्राप्त भयो। AI जाँच पर्खाइमा छ।', audioFailed: 'रेकर्डिङ जाँच्न सकिएन। सुपरभाइजरसँग मद्दत माग्नुहोस् वा फेरि रेकर्ड गर्नुहोस्।', typeInstead: 'लेख्नुहोस्', recordInstead: 'रेकर्ड गर्नुहोस्', matched: 'मुख्य तथ्यहरू मिले', clarification: 'स्पष्टीकरण चाहिन्छ', unassessable: 'जाँच्न सकिएन', saved: 'सुरक्षित भयो।' },
  fil: { emptyTodo: 'Walang tagubiling gagawin.', emptyDone: 'Wala pang natapos na tagubilin.', loading: 'Naglo-load...', unavailable: 'Hindi available ang tagubilin', outcome: 'Naitalang resulta', assessment: 'Synthetic na lokal na pagsusuri. Maaaring suriin ng supervisor mo ang orihinal na sagot.', audioPending: 'Natanggap ang recording. Nakabinbin ang AI check.', audioFailed: 'Hindi masuri ang recording. Humingi ng tulong sa supervisor o mag-record muli.', typeInstead: 'I-type', recordInstead: 'I-record', matched: 'Tumugma ang mahalagang detalye', clarification: 'Kailangan ng paglilinaw', unassessable: 'Hindi masuri', saved: 'Na-save.' },
  si: { emptyTodo: 'කළ යුතු උපදෙස් නැත.', emptyDone: 'තවම සම්පූර්ණ කළ උපදෙස් නැත.', loading: 'පූරණය වෙමින්...', unavailable: 'උපදෙස නොමැත', outcome: 'සටහන් කළ ප්‍රතිඵලය', assessment: 'මෙය ස්ථානීය කෘත්‍රිම පරීක්ෂාවකි. ඔබේ අධීක්ෂකට මුල් පිළිතුර බැලිය හැක.', audioPending: 'පටිගත කිරීම ලැබුණි. AI පරීක්ෂාව රඳා පවතී.', audioFailed: 'පටිගත කිරීම පරීක්ෂා කළ නොහැක. අධීක්ෂකගෙන් උදව් ඉල්ලන්න හෝ නැවත පටිගත කරන්න.', typeInstead: 'ටයිප් කරන්න', recordInstead: 'පටිගත කරන්න', matched: 'ප්‍රධාන කරුණු ගැළපුණි', clarification: 'පැහැදිලි කිරීම අවශ්‍යයි', unassessable: 'පරීක්ෂා කළ නොහැක', saved: 'සුරැකිණි.' },
  ru: { emptyTodo: 'Нет инструкций к выполнению.', emptyDone: 'Выполненных инструкций пока нет.', loading: 'Загрузка...', unavailable: 'Инструкция недоступна', outcome: 'Записанный результат', assessment: 'Это локальная синтетическая проверка. Руководитель может просмотреть исходный ответ.', audioPending: 'Запись получена. ИИ-проверка ожидается.', audioFailed: 'Не удалось проверить запись. Попросите помощи у руководителя или запишите снова.', typeInstead: 'Ввести', recordInstead: 'Записать', matched: 'Ключевые факты совпали', clarification: 'Нужно уточнение', unassessable: 'Не удалось оценить', saved: 'Сохранено.' },
  'pa-Guru': { emptyTodo: 'ਕਰਨ ਲਈ ਕੋਈ ਹਦਾਇਤ ਨਹੀਂ।', emptyDone: 'ਹਾਲੇ ਕੋਈ ਪੂਰੀ ਹਦਾਇਤ ਨਹੀਂ।', loading: 'ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ...', unavailable: 'ਹਦਾਇਤ ਉਪਲਬਧ ਨਹੀਂ', outcome: 'ਦਰਜ ਨਤੀਜਾ', assessment: 'ਇਹ ਸਥਾਨਕ ਨਕਲੀ ਜਾਂਚ ਹੈ। ਤੁਹਾਡਾ ਸੁਪਰਵਾਈਜ਼ਰ ਅਸਲ ਜਵਾਬ ਵੇਖ ਸਕਦਾ ਹੈ।', audioPending: 'ਰਿਕਾਰਡਿੰਗ ਪ੍ਰਾਪਤ ਹੋਈ। AI ਜਾਂਚ ਬਕਾਇਆ ਹੈ।', audioFailed: 'ਰਿਕਾਰਡਿੰਗ ਦੀ ਜਾਂਚ ਨਹੀਂ ਹੋ ਸਕੀ। ਸੁਪਰਵਾਈਜ਼ਰ ਤੋਂ ਮਦਦ ਮੰਗੋ ਜਾਂ ਦੁਬਾਰਾ ਰਿਕਾਰਡ ਕਰੋ।', typeInstead: 'ਲਿਖੋ', recordInstead: 'ਰਿਕਾਰਡ ਕਰੋ', matched: 'ਮੁੱਖ ਤੱਥ ਮਿਲਦੇ ਹਨ', clarification: 'ਸਪਸ਼ਟੀਕਰਨ ਚਾਹੀਦਾ ਹੈ', unassessable: 'ਜਾਂਚ ਸੰਭਵ ਨਹੀਂ', saved: 'ਸੰਭਾਲਿਆ।' },
  'pa-Arab': { emptyTodo: 'کرن لئی کوئی ہدایت نئیں۔', emptyDone: 'ہالے کوئی پوری ہدایت نئیں۔', loading: 'لوڈ ہو ریا اے...', unavailable: 'ہدایت دستیاب نئیں', outcome: 'درج نتیجہ', assessment: 'ایہ مقامی نقلی جانچ اے۔ تہاڈا سپروائزر اصل جواب ویکھ سکدا اے۔', audioPending: 'ریکارڈنگ موصول ہو گئی۔ AI جانچ زیر التوا اے۔', audioFailed: 'ریکارڈنگ دی جانچ نئیں ہو سکی۔ سپروائزر توں مدد منگو یا دوبارہ ریکارڈ کرو۔', typeInstead: 'لکھو', recordInstead: 'ریکارڈ کرو', matched: 'اہم حقائق میل کھاندے نیں', clarification: 'وضاحت لوڑیندیاے', unassessable: 'جانچ ممکن نئیں', saved: 'محفوظ ہو گیا۔' },
  id: { emptyTodo: 'Tidak ada instruksi untuk dikerjakan.', emptyDone: 'Belum ada instruksi yang selesai.', loading: 'Memuat...', unavailable: 'Instruksi tidak tersedia', outcome: 'Hasil tercatat', assessment: 'Ini penilaian sintetis lokal. Supervisor Anda dapat meninjau jawaban asli.', audioPending: 'Rekaman diterima. Pemeriksaan AI tertunda.', audioFailed: 'Rekaman tidak dapat diperiksa. Minta bantuan supervisor atau rekam lagi.', typeInstead: 'Ketik', recordInstead: 'Rekam', matched: 'Fakta kunci cocok', clarification: 'Perlu klarifikasi', unassessable: 'Tidak dapat dinilai', saved: 'Tersimpan.' },
};

const workerLanguageOptionList=workerUiLanguages.map(locale=>({code:locale.code,label:locale.name,dir:locale.direction}));
type WorkerLanguageText={menu:string;title:string;current:string;pending:string;requested:string;choose:string;reason:string;send:string;sending:string;sent:string;alreadyPending:string;chooseDifferent:string;error:string;session:string;close:string;open:string;loading:string;setupTitle:string;setupBody:string;continue:string;saving:string;selectError:string;reload:string;alreadySelected:string;setupDone:string;cancel:string};
const workerLanguageText:Record<WorkerUiLanguage,WorkerLanguageText>={
  en:{menu:'Language',title:'Your language',current:'Current language',pending:'Waiting for supervisor review',requested:'Requested language',choose:'Choose a new language',reason:'Reason (optional)',send:'Send change request',sending:'Sending...',sent:'Your change request was sent to your supervisor.',alreadyPending:'A language change is already waiting for review.',chooseDifferent:'Choose a different language from your current one.',error:'The language change could not be requested. Try again.',session:'Your session changed. Reload before trying again.',close:'Close language settings',open:'Language settings',loading:'Loading your language...',setupTitle:'Choose your language',setupBody:'Your supervisor will send instructions in this language. You can request a change later.',continue:'Continue',saving:'Saving...',selectError:'Your language could not be saved. Reload to continue.',reload:'Reload',alreadySelected:'Your language is already saved. Reload to continue.',setupDone:'Language saved.',cancel:'Cancel'},
  ar:{menu:'اللغة',title:'لغتك',current:'اللغة الحالية',pending:'بانتظار مراجعة المشرف',requested:'اللغة المطلوبة',choose:'اختر لغة جديدة',reason:'السبب (اختياري)',send:'إرسال طلب التغيير',sending:'جارٍ الإرسال...',sent:'أُرسل طلب التغيير إلى مشرفك.',alreadyPending:'يوجد طلب تغيير لغة بانتظار المراجعة بالفعل.',chooseDifferent:'اختر لغة مختلفة عن لغتك الحالية.',error:'تعذّر طلب تغيير اللغة. حاول مجدداً.',session:'تغيّرت جلستك. أعد التحميل قبل المحاولة مجدداً.',close:'إغلاق إعدادات اللغة',open:'إعدادات اللغة',loading:'جارٍ تحميل لغتك...',setupTitle:'اختر لغتك',setupBody:'سيرسل مشرفك التعليمات بهذه اللغة. يمكنك طلب تغييرها لاحقاً.',continue:'متابعة',saving:'جارٍ الحفظ...',selectError:'تعذّر حفظ اللغة. أعد تحميل الصفحة للمتابعة.',reload:'إعادة التحميل',alreadySelected:'تم حفظ لغتك بالفعل. أعد التحميل للمتابعة.',setupDone:'تم حفظ اللغة.',cancel:'إلغاء'},
  ur:{menu:'زبان',title:'آپ کی زبان',current:'موجودہ زبان',pending:'سپروائزر کے جائزے کا انتظار',requested:'درخواست کردہ زبان',choose:'نئی زبان منتخب کریں',reason:'وجہ (اختیاری)',send:'تبدیلی کی درخواست بھیجیں',sending:'بھیجا جا رہا ہے...',sent:'تبدیلی کی درخواست آپ کے سپروائزر کو بھیج دی گئی۔',alreadyPending:'زبان کی تبدیلی پہلے ہی جائزے کے انتظار میں ہے۔',chooseDifferent:'اپنی موجودہ زبان سے مختلف زبان منتخب کریں۔',error:'زبان کی تبدیلی کی درخواست نہیں بھیجی جا سکی۔ دوبارہ کوشش کریں۔',session:'آپ کا سیشن بدل گیا۔ دوبارہ کوشش سے پہلے صفحہ لوڈ کریں۔',close:'زبان کی ترتیبات بند کریں',open:'زبان کی ترتیبات',loading:'آپ کی زبان لوڈ ہو رہی ہے...',setupTitle:'اپنی زبان منتخب کریں',setupBody:'آپ کا سپروائزر اسی زبان میں ہدایات بھیجے گا۔ آپ بعد میں تبدیلی کی درخواست کر سکتے ہیں۔',continue:'جاری رکھیں',saving:'محفوظ ہو رہا ہے...',selectError:'زبان محفوظ نہیں ہو سکی۔ جاری رکھنے کے لیے صفحہ دوبارہ لوڈ کریں۔',reload:'دوبارہ لوڈ کریں',alreadySelected:'آپ کی زبان پہلے ہی محفوظ ہے۔ جاری رکھنے کے لیے دوبارہ لوڈ کریں۔',setupDone:'زبان محفوظ ہو گئی۔',cancel:'منسوخ کریں'},
  hi:{menu:'भाषा',title:'आपकी भाषा',current:'वर्तमान भाषा',pending:'सुपरवाइज़र की समीक्षा की प्रतीक्षा',requested:'अनुरोधित भाषा',choose:'नई भाषा चुनें',reason:'कारण (वैकल्पिक)',send:'बदलाव का अनुरोध भेजें',sending:'भेजा जा रहा है...',sent:'आपका बदलाव अनुरोध सुपरवाइज़र को भेज दिया गया।',alreadyPending:'भाषा बदलने का अनुरोध पहले से समीक्षा की प्रतीक्षा में है।',chooseDifferent:'अपनी वर्तमान भाषा से अलग भाषा चुनें।',error:'भाषा बदलने का अनुरोध नहीं भेजा जा सका। फिर प्रयास करें।',session:'आपका सत्र बदल गया। फिर प्रयास करने से पहले पेज रीलोड करें।',close:'भाषा सेटिंग बंद करें',open:'भाषा सेटिंग',loading:'आपकी भाषा लोड हो रही है...',setupTitle:'अपनी भाषा चुनें',setupBody:'आपका सुपरवाइज़र इस भाषा में निर्देश भेजेगा। आप बाद में बदलाव का अनुरोध कर सकते हैं।',continue:'जारी रखें',saving:'सहेजा जा रहा है...',selectError:'भाषा सहेजी नहीं जा सकी। जारी रखने के लिए पेज रीलोड करें।',reload:'रीलोड करें',alreadySelected:'आपकी भाषा पहले से सहेजी है। जारी रखने के लिए रीलोड करें।',setupDone:'भाषा सहेजी गई।',cancel:'रद्द करें'},
  bn:{menu:'ভাষা',title:'আপনার ভাষা',current:'বর্তমান ভাষা',pending:'সুপারভাইজারের পর্যালোচনার অপেক্ষায়',requested:'অনুরোধ করা ভাষা',choose:'নতুন ভাষা বেছে নিন',reason:'কারণ (ঐচ্ছিক)',send:'পরিবর্তনের অনুরোধ পাঠান',sending:'পাঠানো হচ্ছে...',sent:'আপনার পরিবর্তনের অনুরোধ সুপারভাইজারের কাছে পাঠানো হয়েছে।',alreadyPending:'ভাষা পরিবর্তনের অনুরোধ ইতিমধ্যে পর্যালোচনার অপেক্ষায় আছে।',chooseDifferent:'আপনার বর্তমান ভাষা থেকে ভিন্ন ভাষা বেছে নিন।',error:'ভাষা পরিবর্তনের অনুরোধ পাঠানো যায়নি। আবার চেষ্টা করুন।',session:'আপনার সেশন বদলেছে। আবার চেষ্টার আগে পেজ রিলোড করুন।',close:'ভাষা সেটিংস বন্ধ করুন',open:'ভাষা সেটিংস',loading:'আপনার ভাষা লোড হচ্ছে...',setupTitle:'আপনার ভাষা বেছে নিন',setupBody:'আপনার সুপারভাইজার এই ভাষায় নির্দেশনা পাঠাবেন। আপনি পরে পরিবর্তনের অনুরোধ করতে পারেন।',continue:'চালিয়ে যান',saving:'সংরক্ষণ হচ্ছে...',selectError:'ভাষা সংরক্ষণ করা যায়নি। চালিয়ে যেতে পেজ রিলোড করুন।',reload:'রিলোড করুন',alreadySelected:'আপনার ভাষা ইতিমধ্যে সংরক্ষিত। চালিয়ে যেতে রিলোড করুন।',setupDone:'ভাষা সংরক্ষিত হয়েছে।',cancel:'বাতিল করুন'},
  ml:{menu:'ഭാഷ',title:'നിങ്ങളുടെ ഭാഷ',current:'നിലവിലെ ഭാഷ',pending:'സൂപ്പർവൈസറുടെ അവലോകനത്തിനായി കാത്തിരിക്കുന്നു',requested:'അഭ്യർത്ഥിച്ച ഭാഷ',choose:'പുതിയ ഭാഷ തിരഞ്ഞെടുക്കുക',reason:'കാരണം (ഐച്ഛികം)',send:'മാറ്റ അഭ്യർത്ഥന അയക്കുക',sending:'അയക്കുന്നു...',sent:'നിങ്ങളുടെ മാറ്റ അഭ്യർത്ഥന സൂപ്പർവൈസറിന് അയച്ചു.',alreadyPending:'ഭാഷാ മാറ്റ അഭ്യർത്ഥന ഇതിനകം അവലോകനത്തിനായി കാത്തിരിക്കുന്നു.',chooseDifferent:'നിങ്ങളുടെ നിലവിലെ ഭാഷയിൽ നിന്ന് വ്യത്യസ്തമായ ഭാഷ തിരഞ്ഞെടുക്കുക.',error:'ഭാഷാ മാറ്റ അഭ്യർത്ഥന അയക്കാനായില്ല. വീണ്ടും ശ്രമിക്കുക.',session:'നിങ്ങളുടെ സെഷൻ മാറി. വീണ്ടും ശ്രമിക്കുന്നതിന് മുമ്പ് പേജ് റീലോഡ് ചെയ്യുക.',close:'ഭാഷാ ക്രമീകരണങ്ങൾ അടയ്ക്കുക',open:'ഭാഷാ ക്രമീകരണങ്ങൾ',loading:'നിങ്ങളുടെ ഭാഷ ലോഡ് ചെയ്യുന്നു...',setupTitle:'നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക',setupBody:'നിങ്ങളുടെ സൂപ്പർവൈസർ ഈ ഭാഷയിൽ നിർദ്ദേശങ്ങൾ അയക്കും. പിന്നീട് മാറ്റം അഭ്യർത്ഥിക്കാം.',continue:'തുടരുക',saving:'സംരക്ഷിക്കുന്നു...',selectError:'ഭാഷ സംരക്ഷിക്കാനായില്ല. തുടരാൻ പേജ് റീലോഡ് ചെയ്യുക.',reload:'റീലോഡ് ചെയ്യുക',alreadySelected:'നിങ്ങളുടെ ഭാഷ ഇതിനകം സംരക്ഷിച്ചു. തുടരാൻ റീലോഡ് ചെയ്യുക.',setupDone:'ഭാഷ സംരക്ഷിച്ചു.',cancel:'റദ്ദാക്കുക'},
  ta:{menu:'மொழி',title:'உங்கள் மொழி',current:'தற்போதைய மொழி',pending:'மேற்பார்வையாளர் மதிப்பாய்வுக்காக காத்திருக்கிறது',requested:'கோரப்பட்ட மொழி',choose:'புதிய மொழியைத் தேர்ந்தெடுக்கவும்',reason:'காரணம் (விருப்பமானது)',send:'மாற்றக் கோரிக்கையை அனுப்பு',sending:'அனுப்பப்படுகிறது...',sent:'உங்கள் மாற்றக் கோரிக்கை மேற்பார்வையாளருக்கு அனுப்பப்பட்டது.',alreadyPending:'மொழி மாற்றக் கோரிக்கை ஏற்கனவே மதிப்பாய்வுக்காக காத்திருக்கிறது.',chooseDifferent:'உங்கள் தற்போதைய மொழியிலிருந்து வேறு மொழியைத் தேர்ந்தெடுக்கவும்.',error:'மொழி மாற்றக் கோரிக்கையை அனுப்ப முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',session:'உங்கள் அமர்வு மாறியது. மீண்டும் முயலும் முன் பக்கத்தை மீளேற்றவும்.',close:'மொழி அமைப்புகளை மூடு',open:'மொழி அமைப்புகள்',loading:'உங்கள் மொழி ஏற்றப்படுகிறது...',setupTitle:'உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்',setupBody:'உங்கள் மேற்பார்வையாளர் இந்த மொழியில் அறிவுறுத்தல்களை அனுப்புவார். பின்னர் மாற்றம் கோரலாம்.',continue:'தொடரவும்',saving:'சேமிக்கப்படுகிறது...',selectError:'மொழியைச் சேமிக்க முடியவில்லை. தொடர பக்கத்தை மீளேற்றவும்.',reload:'மீளேற்று',alreadySelected:'உங்கள் மொழி ஏற்கனவே சேமிக்கப்பட்டது. தொடர மீளேற்றவும்.',setupDone:'மொழி சேமிக்கப்பட்டது.',cancel:'ரத்து செய்'},
  te:{menu:'భాష',title:'మీ భాష',current:'ప్రస్తుత భాష',pending:'సూపర్‌వైజర్ సమీక్ష కోసం వేచి ఉంది',requested:'అభ్యర్థించిన భాష',choose:'కొత్త భాషను ఎంచుకోండి',reason:'కారణం (ఐచ్ఛికం)',send:'మార్పు అభ్యర్థన పంపండి',sending:'పంపుతోంది...',sent:'మీ మార్పు అభ్యర్థన సూపర్‌వైజర్‌కు పంపబడింది.',alreadyPending:'భాష మార్పు అభ్యర్థన ఇప్పటికే సమీక్ష కోసం వేచి ఉంది.',chooseDifferent:'మీ ప్రస్తుత భాషకు భిన్నమైన భాషను ఎంచుకోండి.',error:'భాష మార్పు అభ్యర్థన పంపలేకపోయాం. మళ్లీ ప్రయత్నించండి.',session:'మీ సెషన్ మారింది. మళ్లీ ప్రయత్నించే ముందు పేజీని రీలోడ్ చేయండి.',close:'భాష సెట్టింగ్‌లను మూసివేయండి',open:'భాష సెట్టింగ్‌లు',loading:'మీ భాష లోడ్ అవుతోంది...',setupTitle:'మీ భాషను ఎంచుకోండి',setupBody:'మీ సూపర్‌వైజర్ ఈ భాషలో సూచనలు పంపుతారు. తర్వాత మార్పు అభ్యర్థించవచ్చు.',continue:'కొనసాగించండి',saving:'సేవ్ అవుతోంది...',selectError:'భాషను సేవ్ చేయలేకపోయాం. కొనసాగించడానికి పేజీని రీలోడ్ చేయండి.',reload:'రీలోడ్',alreadySelected:'మీ భాష ఇప్పటికే సేవ్ చేయబడింది. కొనసాగించడానికి రీలోడ్ చేయండి.',setupDone:'భాష సేవ్ చేయబడింది.',cancel:'రద్దు చేయండి'},
  ne:{menu:'भाषा',title:'तपाईंको भाषा',current:'हालको भाषा',pending:'सुपरभाइजरको समीक्षाको प्रतीक्षामा',requested:'अनुरोध गरिएको भाषा',choose:'नयाँ भाषा छान्नुहोस्',reason:'कारण (वैकल्पिक)',send:'परिवर्तन अनुरोध पठाउनुहोस्',sending:'पठाउँदै...',sent:'तपाईंको परिवर्तन अनुरोध सुपरभाइजरलाई पठाइयो।',alreadyPending:'भाषा परिवर्तन अनुरोध पहिले नै समीक्षाको प्रतीक्षामा छ।',chooseDifferent:'आफ्नो हालको भाषाभन्दा फरक भाषा छान्नुहोस्।',error:'भाषा परिवर्तन अनुरोध पठाउन सकिएन। फेरि प्रयास गर्नुहोस्।',session:'तपाईंको सत्र बदलियो। फेरि प्रयास गर्नुअघि पृष्ठ रिलोड गर्नुहोस्।',close:'भाषा सेटिङ बन्द गर्नुहोस्',open:'भाषा सेटिङ',loading:'तपाईंको भाषा लोड हुँदै...',setupTitle:'आफ्नो भाषा छान्नुहोस्',setupBody:'तपाईंको सुपरभाइजरले यो भाषामा निर्देशन पठाउनुहुनेछ। पछि परिवर्तन अनुरोध गर्न सक्नुहुन्छ।',continue:'जारी राख्नुहोस्',saving:'सुरक्षित हुँदै...',selectError:'भाषा सुरक्षित गर्न सकिएन। जारी राख्न पृष्ठ रिलोड गर्नुहोस्।',reload:'रिलोड गर्नुहोस्',alreadySelected:'तपाईंको भाषा पहिले नै सुरक्षित छ। जारी राख्न रिलोड गर्नुहोस्।',setupDone:'भाषा सुरक्षित भयो।',cancel:'रद्द गर्नुहोस्'},
  fil:{menu:'Wika',title:'Iyong wika',current:'Kasalukuyang wika',pending:'Naghihintay ng pagsusuri ng supervisor',requested:'Hiniling na wika',choose:'Pumili ng bagong wika',reason:'Dahilan (opsyonal)',send:'Ipadala ang hiling na pagbabago',sending:'Ipinapadala...',sent:'Naipadala sa supervisor mo ang hiling na pagbabago.',alreadyPending:'May hiling nang pagbabago ng wika na naghihintay ng pagsusuri.',chooseDifferent:'Pumili ng wikang iba sa kasalukuyang wika mo.',error:'Hindi naipadala ang hiling na pagbabago ng wika. Subukan muli.',session:'Nagbago ang session mo. I-reload bago subukan muli.',close:'Isara ang mga setting ng wika',open:'Mga setting ng wika',loading:'Naglo-load ng wika mo...',setupTitle:'Pumili ng wika',setupBody:'Ipadadala ng supervisor mo ang mga tagubilin sa wikang ito. Maaari kang humiling ng pagbabago mamaya.',continue:'Magpatuloy',saving:'Nagse-save...',selectError:'Hindi na-save ang wika. I-reload upang magpatuloy.',reload:'I-reload',alreadySelected:'Naka-save na ang wika mo. I-reload upang magpatuloy.',setupDone:'Na-save ang wika.',cancel:'Kanselahin'},
  si:{menu:'භාෂාව',title:'ඔබේ භාෂාව',current:'වත්මන් භාෂාව',pending:'අධීක්ෂක සමාලෝචනය බලාපොරොත්තුවෙන්',requested:'ඉල්ලා ඇති භාෂාව',choose:'නව භාෂාවක් තෝරන්න',reason:'හේතුව (විකල්ප)',send:'වෙනස්කම් ඉල්ලීම යවන්න',sending:'යවමින්...',sent:'ඔබේ වෙනස්කම් ඉල්ලීම අධීක්ෂකට යවා ඇත.',alreadyPending:'භාෂා වෙනස්කම් ඉල්ලීමක් දැනටමත් සමාලෝචනය බලාපොරොත්තුවෙන් ඇත.',chooseDifferent:'ඔබේ වත්මන් භාෂාවට වෙනස් භාෂාවක් තෝරන්න.',error:'භාෂා වෙනස්කම් ඉල්ලීම යැවිය නොහැක. නැවත උත්සාහ කරන්න.',session:'ඔබේ සැසිය වෙනස් විය. නැවත උත්සාහ කිරීමට පෙර පිටුව නැවුම් කරන්න.',close:'භාෂා සැකසුම් වසන්න',open:'භාෂා සැකසුම්',loading:'ඔබේ භාෂාව පූරණය වෙමින්...',setupTitle:'ඔබේ භාෂාව තෝරන්න',setupBody:'ඔබේ අධීක්ෂක මෙම භාෂාවෙන් උපදෙස් යවනු ඇත. පසුව වෙනසක් ඉල්ලිය හැක.',continue:'ඉදිරියට යන්න',saving:'සුරකිමින්...',selectError:'භාෂාව සුරැකිය නොහැකි විය. ඉදිරියට යාමට පිටුව නැවුම් කරන්න.',reload:'නැවුම් කරන්න',alreadySelected:'ඔබේ භාෂාව දැනටමත් සුරැකී ඇත. ඉදිරියට යාමට නැවුම් කරන්න.',setupDone:'භාෂාව සුරැකිණි.',cancel:'අවලංගු කරන්න'},
  ru:{menu:'Язык',title:'Ваш язык',current:'Текущий язык',pending:'Ожидает проверки руководителя',requested:'Запрошенный язык',choose:'Выберите новый язык',reason:'Причина (необязательно)',send:'Отправить запрос на изменение',sending:'Отправка...',sent:'Ваш запрос на изменение отправлен руководителю.',alreadyPending:'Запрос на изменение языка уже ожидает проверки.',chooseDifferent:'Выберите язык, отличный от текущего.',error:'Не удалось отправить запрос на изменение языка. Попробуйте снова.',session:'Ваш сеанс изменился. Перезагрузите страницу перед повторной попыткой.',close:'Закрыть настройки языка',open:'Настройки языка',loading:'Загрузка вашего языка...',setupTitle:'Выберите ваш язык',setupBody:'Руководитель будет отправлять инструкции на этом языке. Позже вы сможете запросить изменение.',continue:'Продолжить',saving:'Сохранение...',selectError:'Не удалось сохранить язык. Перезагрузите страницу, чтобы продолжить.',reload:'Перезагрузить',alreadySelected:'Ваш язык уже сохранён. Перезагрузите страницу, чтобы продолжить.',setupDone:'Язык сохранён.',cancel:'Отмена'},
  'pa-Guru':{menu:'ਭਾਸ਼ਾ',title:'ਤੁਹਾਡੀ ਭਾਸ਼ਾ',current:'ਮੌਜੂਦਾ ਭਾਸ਼ਾ',pending:'ਸੁਪਰਵਾਈਜ਼ਰ ਦੀ ਸਮੀਖਿਆ ਦੀ ਉਡੀਕ',requested:'ਬੇਨਤੀ ਕੀਤੀ ਭਾਸ਼ਾ',choose:'ਨਵੀਂ ਭਾਸ਼ਾ ਚੁਣੋ',reason:'ਕਾਰਨ (ਵਿਕਲਪਿਕ)',send:'ਤਬਦੀਲੀ ਦੀ ਬੇਨਤੀ ਭੇਜੋ',sending:'ਭੇਜਿਆ ਜਾ ਰਿਹਾ ਹੈ...',sent:'ਤੁਹਾਡੀ ਤਬਦੀਲੀ ਦੀ ਬੇਨਤੀ ਸੁਪਰਵਾਈਜ਼ਰ ਨੂੰ ਭੇਜ ਦਿੱਤੀ ਗਈ।',alreadyPending:'ਭਾਸ਼ਾ ਤਬਦੀਲੀ ਦੀ ਬੇਨਤੀ ਪਹਿਲਾਂ ਹੀ ਸਮੀਖਿਆ ਦੀ ਉਡੀਕ ਵਿੱਚ ਹੈ।',chooseDifferent:'ਆਪਣੀ ਮੌਜੂਦਾ ਭਾਸ਼ਾ ਤੋਂ ਵੱਖਰੀ ਭਾਸ਼ਾ ਚੁਣੋ।',error:'ਭਾਸ਼ਾ ਤਬਦੀਲੀ ਦੀ ਬੇਨਤੀ ਨਹੀਂ ਭੇਜੀ ਜਾ ਸਕੀ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',session:'ਤੁਹਾਡਾ ਸੈਸ਼ਨ ਬਦਲ ਗਿਆ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਤੋਂ ਪਹਿਲਾਂ ਪੇਜ ਰੀਲੋਡ ਕਰੋ।',close:'ਭਾਸ਼ਾ ਸੈਟਿੰਗਾਂ ਬੰਦ ਕਰੋ',open:'ਭਾਸ਼ਾ ਸੈਟਿੰਗਾਂ',loading:'ਤੁਹਾਡੀ ਭਾਸ਼ਾ ਲੋਡ ਹੋ ਰਹੀ ਹੈ...',setupTitle:'ਆਪਣੀ ਭਾਸ਼ਾ ਚੁਣੋ',setupBody:'ਤੁਹਾਡਾ ਸੁਪਰਵਾਈਜ਼ਰ ਇਸ ਭਾਸ਼ਾ ਵਿੱਚ ਹਦਾਇਤਾਂ ਭੇਜੇਗਾ। ਤੁਸੀਂ ਬਾਅਦ ਵਿੱਚ ਤਬਦੀਲੀ ਦੀ ਬੇਨਤੀ ਕਰ ਸਕਦੇ ਹੋ।',continue:'ਜਾਰੀ ਰੱਖੋ',saving:'ਸੰਭਾਲਿਆ ਜਾ ਰਿਹਾ ਹੈ...',selectError:'ਭਾਸ਼ਾ ਸੰਭਾਲੀ ਨਹੀਂ ਜਾ ਸਕੀ। ਜਾਰੀ ਰੱਖਣ ਲਈ ਪੇਜ ਰੀਲੋਡ ਕਰੋ।',reload:'ਰੀਲੋਡ ਕਰੋ',alreadySelected:'ਤੁਹਾਡੀ ਭਾਸ਼ਾ ਪਹਿਲਾਂ ਹੀ ਸੰਭਾਲੀ ਹੋਈ ਹੈ। ਜਾਰੀ ਰੱਖਣ ਲਈ ਰੀਲੋਡ ਕਰੋ।',setupDone:'ਭਾਸ਼ਾ ਸੰਭਾਲੀ ਗਈ।',cancel:'ਰੱਦ ਕਰੋ'},
  'pa-Arab':{menu:'بولی',title:'تہاڈی بولی',current:'موجودہ بولی',pending:'سپروائزر دے جائزے دا انتظار',requested:'درخواست کردہ بولی',choose:'نویں بولی چنو',reason:'وجہ (اختیاری)',send:'تبدیلی دی درخواست بھیجو',sending:'بھیجی جا رہی اے...',sent:'تہاڈی تبدیلی دی درخواست سپروائزر نوں بھیج دتی گئی۔',alreadyPending:'بولی تبدیلی دی درخواست پہلے ای جائزے دے انتظار وچ اے۔',chooseDifferent:'اپنی موجودہ بولی توں وکھری بولی چنو۔',error:'بولی تبدیلی دی درخواست نئیں بھیجی جا سکی۔ دوبارہ کوشش کرو۔',session:'تہاڈا سیشن بدل گیا۔ دوبارہ کوشش توں پہلے صفحہ ری لوڈ کرو۔',close:'بولی دیاں ترتیباں بند کرو',open:'بولی دیاں ترتیباں',loading:'تہاڈی بولی لوڈ ہو رہی اے...',setupTitle:'اپنی بولی چنو',setupBody:'تہاڈا سپروائزر ایس بولی وچ ہدایتاں بھیجے گا۔ تسیں بعد وچ تبدیلی دی درخواست کر سکدے او۔',continue:'جاری رکھو',saving:'محفوظ ہو ریا اے...',selectError:'بولی محفوظ نئیں ہو سکی۔ جاری رکھن لئی صفحہ ری لوڈ کرو۔',reload:'ری لوڈ کرو',alreadySelected:'تہاڈی بولی پہلے ای محفوظ اے۔ جاری رکھن لئی ری لوڈ کرو۔',setupDone:'بولی محفوظ ہو گئی۔',cancel:'منسوخ کرو'},
  id:{menu:'Bahasa',title:'Bahasa Anda',current:'Bahasa saat ini',pending:'Menunggu tinjauan supervisor',requested:'Bahasa yang diminta',choose:'Pilih bahasa baru',reason:'Alasan (opsional)',send:'Kirim permintaan perubahan',sending:'Mengirim...',sent:'Permintaan perubahan Anda telah dikirim ke supervisor.',alreadyPending:'Permintaan perubahan bahasa sudah menunggu tinjauan.',chooseDifferent:'Pilih bahasa yang berbeda dari bahasa Anda saat ini.',error:'Permintaan perubahan bahasa tidak dapat dikirim. Coba lagi.',session:'Sesi Anda berubah. Muat ulang sebelum mencoba lagi.',close:'Tutup pengaturan bahasa',open:'Pengaturan bahasa',loading:'Memuat bahasa Anda...',setupTitle:'Pilih bahasa Anda',setupBody:'Supervisor Anda akan mengirim instruksi dalam bahasa ini. Anda dapat meminta perubahan nanti.',continue:'Lanjutkan',saving:'Menyimpan...',selectError:'Bahasa tidak dapat disimpan. Muat ulang untuk melanjutkan.',reload:'Muat ulang',alreadySelected:'Bahasa Anda sudah tersimpan. Muat ulang untuk melanjutkan.',setupDone:'Bahasa tersimpan.',cancel:'Batal'},
};
type WorkerLanguageState={language:WorkerUiLanguage;selected:boolean;selectedAt:string|null;selectedBy:string|null;pendingRequest:{id:string;currentLanguage:WorkerUiLanguage;requestedLanguage:WorkerUiLanguage;reason:string;requestedAt:string}|null;items:unknown[]};

function WorkerLanguageDialog({session,language,disabled}:{session:Session;language:WorkerUiLanguage;disabled:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null),requestId=useRef('');
  const [state,setState]=useState<WorkerLanguageState|null>(null),[choice,setChoice]=useState<WorkerUiLanguage>('en'),[reason,setReason]=useState('');
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false);
  const text=workerLanguageText[language];
  async function open() {
    if(disabled)return;
    requestId.current=crypto.randomUUID();setState(null);setError('');setSent(false);setReason('');setLoading(true);dialog.current?.showModal();
    try {
      const data=await api<WorkerLanguageState>('/worker/language',{cache:'no-store',headers:{'x-client-session-context':session.clientContext!}});
      setState(data);setChoice(workerLanguageOptionList.find(option=>option.code!==data.language)?.code || data.language);
    } catch(reason) {setError(messageOfLanguageError(language,reason));}
    finally {setLoading(false);}
  }
  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if(busy || !state || state.pendingRequest || choice===state.language)return;
    setBusy(true);setError('');
    try {
      const pending=await api<WorkerLanguageState['pendingRequest']>('/worker/language/requests',{method:'POST',cache:'no-store',
        headers:{'content-type':'application/json','x-client-session-context':session.clientContext!},
        body:JSON.stringify({requestId:requestId.current,language:choice,reason})});
      setState({...state,pendingRequest:pending});setSent(true);
    } catch(cause) {setError(messageOfLanguageError(language,cause));}
    finally {setBusy(false);}
  }
  return <><button type="button" className="icon-button" title={text.open} aria-label={text.open} disabled={disabled} onClick={()=>void open()}><Languages size={20}/></button>
    <dialog ref={dialog} className="withdraw-dialog worker-language-dialog" aria-labelledby="worker-language-title" onKeyDown={keepDialogFocus} onCancel={(event)=>{if(busy)event.preventDefault();}}>
      <div className="withdraw-heading"><h2 id="worker-language-title">{text.title}</h2><button autoFocus type="button" className="icon-button" title={text.close} aria-label={text.close} disabled={busy} onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
      {loading ? <p role="status">{text.loading}</p> : !state ? <>{error && <p role="alert" className="record-error">{error}</p>}</> : <>
        <p className="muted">{text.current}: <strong lang={state.language} dir={workerUiDirection(state.language)}>{workerUiNativeName(state.language)}</strong></p>
        {state.pendingRequest ? <div className="notice notice-amber"><p>{text.pending}: <bdi lang={state.pendingRequest.requestedLanguage} dir={workerUiDirection(state.pendingRequest.requestedLanguage)}>{workerUiNativeName(state.pendingRequest.requestedLanguage)}</bdi></p>{state.pendingRequest.reason && <p>{text.reason}: <bdi>{state.pendingRequest.reason}</bdi></p>}</div> : sent ? <p className="notice notice-green" role="status">{text.sent}</p> : <form onSubmit={(event)=>void submit(event)}>
          <fieldset className="worker-language-options"><legend>{text.choose}</legend>{workerLanguageOptionList.filter(option=>option.code!==state.language).map(option=><label key={option.code} className={choice===option.code?'selected':''}><input type="radio" name="new-language" value={option.code} checked={choice===option.code} disabled={busy} onChange={()=>setChoice(option.code)}/><span lang={option.code} dir={option.dir}>{option.label}</span></label>)}</fieldset>
          <label className="field">{text.reason}<textarea rows={2} maxLength={500} value={reason} disabled={busy} onChange={(event)=>setReason(event.target.value)}/></label>
          {error && <p role="alert" className="record-error">{error}</p>}
          <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={()=>dialog.current?.close()}>{text.cancel}</button><button type="submit" className="button primary" disabled={busy || choice===state.language}><Send size={18}/>{busy?text.sending:text.send}</button></div>
        </form>}
      </>}
    </dialog>
  </>;
}
function messageOfLanguageError(language:WorkerUiLanguage,reason:unknown):string {
  const message=reason instanceof Error?reason.message:'',text=workerLanguageText[language];
  if(/already selected/i.test(message))return text.alreadySelected;
  if(/already pending/i.test(message))return text.alreadyPending;
  if(/Session|session|Sign in/.test(message))return text.session;
  return text.error;
}

const noDeviceVoice:Record<WorkerUiLanguage,string>={
  en:'A device voice for this language is unavailable. Read the text instead.',
  ar:'لا يتوفر صوت على هذا الجهاز لهذه اللغة. اقرأ النص بدلاً من ذلك.',
  ur:'اس زبان کے لیے اس آلے پر آواز دستیاب نہیں۔ اس کے بجائے متن پڑھیں۔',
  hi:'इस भाषा के लिए इस डिवाइस पर आवाज़ उपलब्ध नहीं है। इसके बजाय पाठ पढ़ें।',
  bn:'এই ভাষার জন্য এই ডিভাইসে কোনো কণ্ঠ নেই। তার বদলে লেখাটি পড়ুন।',
  ml:'ഈ ഭാഷയ്ക്ക് ഈ ഉപകരണത്തിൽ ശബ്ദം ലഭ്യമല്ല. പകരം വാചകം വായിക്കുക.',
  ta:'இந்த மொழிக்கு இந்தச் சாதனத்தில் குரல் இல்லை. அதற்குப் பதிலாக உரையைப் படியுங்கள்.',
  te:'ఈ భాషకు ఈ పరికరంలో వాయిస్ లేదు. బదులుగా పాఠాన్ని చదవండి.',
  ne:'यो भाषाका लागि यो उपकरणमा आवाज उपलब्ध छैन। सट्टामा पाठ पढ्नुहोस्।',
  fil:'Walang boses sa device na ito para sa wikang ito. Basahin ang teksto.',
  si:'මෙම භාෂාව සඳහා මෙම උපාංගයේ හඬක් නැත. ඒ වෙනුවට පෙළ කියවන්න.',
  ru:'На этом устройстве нет голоса для этого языка. Прочитайте текст.',
  'pa-Guru':'ਇਸ ਭਾਸ਼ਾ ਲਈ ਇਸ ਡਿਵਾਈਸ ਉੱਤੇ ਆਵਾਜ਼ ਨਹੀਂ ਹੈ। ਇਸ ਦੀ ਥਾਂ ਲਿਖਤ ਪੜ੍ਹੋ।',
  'pa-Arab':'اس بولی لئی اس آلے تے آواز دستیاب نہیں۔ اس دی تھاں متن پڑھو۔',
  id:'Tidak ada suara di perangkat ini untuk bahasa ini. Baca teksnya.',
};
function WorkerApp({ session, view, navigate, refresh, act, logout, message,onSessionLost,sessionInvalid,navigationGuard,onSessionRefresh }: { session: Session; view: string; navigate: (path: string) => void; refresh: number; act: (path: string, body?: unknown) => Promise<any>; logout: () => Promise<boolean>; message: string;onSessionLost:()=>void;sessionInvalid:()=>boolean;navigationGuard:React.RefObject<((next:string)=>boolean)|null>;onSessionRefresh:()=>Promise<boolean> }) {
  const [language,setUiLanguage]=useState<WorkerUiLanguage>(()=>{try{return readWorkerUiLanguage(sessionStorage,session);}catch{return workerUiFallbackLanguage(session);}});
  const [languageError,setLanguageError]=useState('');
  const [setupChoice,setSetupChoice]=useState<WorkerUiLanguage>(()=>language);
  const [setupBusy,setSetupBusy]=useState(false),[setupError,setSetupError]=useState(''),[setupSaved,setSetupSaved]=useState(false);
  const setupRequest=useRef(crypto.randomUUID());
  const t = workerText[language];
  const a = workerAux[language];
  const statusText = workerStatusText[language];
  const pagingText=workerPagingText[language];
  const audioMessage = a.audioPending;
  const [tab, setTab] = useState<WorkerInboxTab>('todo');
  const navText=workerNavigationText[language];
  const notices=workerNotificationText[language];
  const pendingHelpAssignment=useRef<string|null>(null);
  const [page,setPage]=useState(1);
  const [answer, setAnswer] = useState('');
  const [translatedChoices,setTranslatedChoices]=useState<{id:string;text:string}[]|null>(null);
  const [answerPresentationId,setAnswerPresentationId]=useState<string|null>(null);
  const [answerMode, setAnswerMode] = useState<'record' | 'type'>('type');
  const [reviewingAnswer,setReviewingAnswer]=useState(false);
  const [acknowledging,setAcknowledging]=useState(false);
  const [audioRefresh, setAudioRefresh] = useState(0);
  const [speakError,setSpeakError]=useState('');
  const speechPlayers=useRef<{body:HTMLAudioElement|null;question:HTMLAudioElement|null}>({body:null,question:null});
  useEffect(()=>()=>{window.speechSynthesis?.cancel();speechPlayers.current.body?.pause();speechPlayers.current.question?.pause();},[]);
  const [helpText, setHelpText] = useState('');
  const [conversationUnsent,setConversationUnsent]=useState(false);
  const [helpVoiceUnsent,setHelpVoiceUnsent]=useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const checkedReceipts=useRef<Set<string>>(new Set());
  const [requestFailure,setRequestFailure]=useState('');
  type PendingReceipt={kind:'answer'|'help'|'audio';requestId:string;assignmentId:string;status:'unknown'|'received'|'failed'};
  const [pendingReceipts,setPendingReceipts]=useState<PendingReceipt[]>([]);
  const checkText=workerReceiptCheckText[language];
  const requestFailureRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(requestFailure)requestFailureRef.current?.focus();},[requestFailure]);
  const [busy, setBusy] = useState(false);
  const [audioUnsent,setAudioUnsent]=useState(false),[leaveKind,setLeaveKind]=useState<WorkerLeaveAction>('back');
  const [audioConsent,setAudioConsent]=useState(false),[audioDraftRefresh,setAudioDraftRefresh]=useState(0);
  const privateDevice=usePrivateDevice(session.clientContext!);
  const audioConsentRef=useRef(false);
  const changeAudioConsent=(value:boolean)=>{audioConsentRef.current=value;setAudioConsent(value);};
  const leaveDialog=useRef<HTMLDialogElement>(null),leaveAction=useRef<(()=>void)|null>(null),leaveTrigger=useRef<HTMLElement|null>(null);
  const approvedRoute=useRef<string|null>(null);
  const leaveText=workerLeaveText[language] || workerLeaveText.en;
  const unsent={answer,help:helpText || (conversationUnsent || helpVoiceUnsent?'unsent':''),audio:audioUnsent};
  const inputAvailability=workerInputAvailability({answer,help:helpText,audio:audioUnsent,helpVoice:helpVoiceUnsent,conversation:conversationUnsent});
  const hasUnsent=workerLeaveRequired('back',unsent);
  useEffect(()=>{
    if(!hasUnsent && !busy)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[hasUnsent,busy]);
  const askLeave=(kind:WorkerLeaveAction,action:()=>void)=>{
    if(busy)return;
    if(!workerLeaveRequired(kind,unsent)){action();return;}
    leaveAction.current=action;leaveTrigger.current=document.activeElement as HTMLElement;setLeaveKind(kind);leaveDialog.current?.showModal();
  };
  useEffect(()=>{
    if(approvedRoute.current===view)approvedRoute.current=null;
    const guard=(next:string)=>{
      if(approvedRoute.current===next)return true;
      const decision=workerNavigationDecision(view,next,hasUnsent,busy);
      if(decision==='allow')return true;
      if(location.hash!==`#${view}`)history.pushState(null,'',`${location.pathname}${location.search}#${view}`);
      if(decision==='confirm')askLeave('back',()=>{approvedRoute.current=next;navigate(next);});
      return false;
    };
    navigationGuard.current=guard;
    return()=>{if(navigationGuard.current===guard)navigationGuard.current=null;};
  },[view,hasUnsent,busy]);
  const now = Date.now();
  const requestInFlight = useRef(false);
  const id = view.startsWith('worker/') ? view.split('/')[1] : null;
  const currentAssignment = useRef(id);
  currentAssignment.current = id;
  const currentView=useRef(view);currentView.current=view;
  const noticeAuthority=useRef({sessionInvalid,onSessionLost});noticeAuthority.current={sessionInvalid,onSessionLost};
  const loadRecordingNotice=useMemo(()=>{
    const identity={clientContext:session.clientContext!,expiresAt:session.expiresAt!};
    return async(selected:RecordingLanguage,signal:AbortSignal)=>{
      try{return await readWorkerRecordingNotice(fetch,identity,selected,signal,()=>!signal.aborted&&!noticeAuthority.current.sessionInvalid());}
      catch(reason){if(!signal.aborted&&!noticeAuthority.current.sessionInvalid()&&reason instanceof WorkerRecordingNoticeError&&reason.code==='session')noticeAuthority.current.onSessionLost();throw reason;}
    };
  },[session.clientContext,session.expiresAt]);
  const outboxOperation=async(work:()=>Promise<void>)=>{
    if(requestInFlight.current || sessionInvalid() || currentView.current!=='device' && currentView.current!==`worker/${currentAssignment.current}`)throw Error('Local storage unavailable');
    requestInFlight.current=true;setBusy(true);
    try {await work();if(currentView.current==='device')setAudioRefresh(value=>value+1);}
    finally {requestInFlight.current=false;setBusy(false);}
  };
  useEffect(() => { setReceipt(null); checkedReceipts.current.clear(); setAnswer(''); setHelpText('');setRequestFailure('');setPendingReceipts([]);setReviewingAnswer(false);setAcknowledging(false);setAnswerPresentationId(null);setSpeakError(''); window.speechSynthesis?.cancel(); }, [id]);
  const inbox=useApi<WorkerBriefingPage>(workerInboxPath(view,tab,page),refresh+audioRefresh,session.clientContext);
  useEffect(() => {
    if(id || view==='device' || view==='notifications') return;
    const timer=window.setInterval(() => setAudioRefresh((value) => value+1),60000);
    return () => window.clearInterval(timer);
  },[id,view]);
  const detail = useApi<any>(id ? `/worker/briefings/${id}` : null, refresh + audioRefresh,session.clientContext);
  useEffect(()=>{setAnswerPresentationId(null);setTranslatedChoices(null);},[id,detail.data?.publicationId,detail.data?.version]);
  useEffect(()=>{
    if(!pendingHelpAssignment.current)return;
    if(id!==pendingHelpAssignment.current){pendingHelpAssignment.current=null;return;}
    if(detail.loading || detail.error || detail.data?.id!==id)return;
    const section=document.getElementById('worker-help');
    if(section){section.scrollIntoView({behavior:'smooth'});section.querySelector('h2')?.focus();}
    pendingHelpAssignment.current=null;
  },[id,detail.loading,detail.error,detail.data,receipt]);
  const detailUnavailable=detail.loading || !!detail.error || detail.data?.contentExpired===true;
  const retainedDetail=retainWorkerDetail(id,detail.data?.id,hasUnsent,detail.errorStatus);
  const refreshText=workerRefreshText[language] || workerRefreshText.en;
  useEffect(()=>{if([inbox.error,detail.error].some(error=>['Session context changed','Sign in required'].includes(error)) || [inbox.errorStatus,detail.errorStatus].some(status=>status!==null && [401,403,409].includes(status)))onSessionLost();},[inbox.error,detail.error,inbox.errorStatus,detail.errorStatus]);
  const contentLanguage:RecordingLanguage=detail.data?.language ?? language;
  const speak = (text: string) => {
    const unavailable=noDeviceVoice[language] || noDeviceVoice.en;
    setSpeakError('');
    if(!('speechSynthesis' in window)){setSpeakError(unavailable);return;}
    const voices=speechSynthesis.getVoices();
    const prefix=contentLanguage.toLowerCase().split('-')[0];
    if(voices.length && !voices.some(voice=>voice.lang.toLowerCase().split(/[-_]/)[0]===prefix)){setSpeakError(unavailable);return;}
    speechPlayers.current.body?.pause();speechPlayers.current.question?.pause();speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(text);utterance.lang=contentLanguage;
    utterance.onerror=()=>setSpeakError(unavailable);
    speechSynthesis.speak(utterance);
  };
  const goBack = () => askLeave('back',()=>{window.speechSynthesis?.cancel();setReceipt(null);approvedRoute.current='inbox';navigate('inbox');});
  const requestIdFor=(kind:'answer'|'help',assignmentId:string,text:string)=>workerRequestId(sessionStorage,session,assignmentId,kind,text,Date.now,kind==='answer'?detail.data?.repeatRequest?.id:undefined);
  const requestError=(error:unknown)=>setRequestFailure(workerRequestText[language][error instanceof WorkerRequestError?error.code:'storage']);
  const trackReceipt=(kind:PendingReceipt['kind'],assignmentId:string,requestId:string)=>setPendingReceipts(values=>[...values.filter(value=>value.kind!==kind),{kind,assignmentId,requestId,status:'unknown'}]);
  const clearTrackedReceipt=(kind:PendingReceipt['kind'])=>setPendingReceipts(values=>values.filter(value=>value.kind!==kind));
  const checkReceipt=async(pending:PendingReceipt)=>{
    if(requestInFlight.current || sessionInvalid() || currentAssignment.current!==pending.assignmentId)return;
    requestInFlight.current=true;setBusy(true);
    try {
      const result=await readWorkerRequestReceipt(async(path,options)=>{
        const response=await fetch(path,options);
        if([401,403,409].includes(response.status))onSessionLost();
        return response;
      },session,pending.assignmentId,pending.kind,pending.requestId,()=>!sessionInvalid() && currentAssignment.current===pending.assignmentId);
      if(result)setRequestFailure('');
      setPendingReceipts(values=>values.map(value=>value.requestId===pending.requestId && value.kind===pending.kind ? {...value,status:result?'received':'unknown'} : value));
    }catch {
      setPendingReceipts(values=>values.map(value=>value.requestId===pending.requestId && value.kind===pending.kind ? {...value,status:'failed'} : value));
    }finally{requestInFlight.current=false;setBusy(false);}
  };
  const submit = async () => {
    if (!id || !answer.trim() || inputAvailability.answerBlocked || requestInFlight.current || detailUnavailable) return;
    const receiptScope={version:detail.data.version,language:detail.data.language};
    requestInFlight.current = true;
    setBusy(true);setRequestFailure('');
    try {
      const submissionId = await requestIdFor('answer', id, answer);
      const presentationId=answerPresentationId;
      trackReceipt('answer',id,submissionId);
      const result = await act(`/worker/briefings/${id}/answers`, { text: answer, submissionId, ...(presentationId?{presentationId}:{}) });
      if (result && currentAssignment.current === id) { clearTrackedReceipt('answer');setReceipt({ ...result, assignmentId: id,requestKind:'typed',publicationVersion:receiptScope.version,contentLanguage:receiptScope.language }); setAnswer('');setReviewingAnswer(false); }
    } catch(error){requestError(error);} finally { requestInFlight.current = false; setBusy(false); }
  };
  const submitAudio = async (bytes: Uint8Array, submissionId: string, presentationId: string | null) => {
    if(sessionInvalid())throw new Error('Session context changed');
    if(detailUnavailable||inputAvailability.answerBlocked)throw new Error(refreshText.failed);
    if (!id || requestInFlight.current) throw new Error('A request is already in progress');
    const receiptScope={assignmentId:id,publicationId:detail.data.publicationId,version:detail.data.version,language:detail.data.language};
    requestInFlight.current = true;
    setBusy(true);setRequestFailure('');
    try {
      trackReceipt('audio',id,submissionId);
      const result=await sendWorkerRecording(async(path,options)=>{
        const response=await fetch(path,options);
        if(response.status===401 || (response.status===409 && response.headers.get('content-type')?.includes('application/json') && (await response.clone().json()).error==='Session context changed'))onSessionLost();
        return response;
      },session,receiptScope,bytes,submissionId,
        ()=>!sessionInvalid() && currentAssignment.current===id,presentationId);
      clearTrackedReceipt('audio');
      if (currentAssignment.current === id) setReceipt({ ...result, audio: true, assignmentId: id,requestKind:'audio',publicationVersion:receiptScope.version,contentLanguage:receiptScope.language });
      setAudioRefresh((value) => value + 1);
    } catch(error) {
      if(error instanceof WorkerAudioRetryError)setRequestFailure(workerAudioRetryText[language][error.code]);
      throw error;
    } finally { requestInFlight.current = false; setBusy(false); }
  };
  const saveAudioPreview=async(bytes:Uint8Array,submissionId:string,capturedAt:string,presentationId:string|null)=>{
    if(!id || requestInFlight.current || detailUnavailable || inputAvailability.answerBlocked || sessionInvalid() || !audioConsentRef.current)throw Error('Saving unavailable');
    requestInFlight.current=true;setBusy(true);
    try {
      const {saveAudioDraft,browserAudioDraftFor}=await import('./worker-audio-draft');
      const scope={assignmentId:id,publicationId:detail.data.publicationId,version:detail.data.version,language:detail.data.language};
      await saveAudioDraft(await browserAudioDraftFor(scope),session,scope,
        {bytes,submissionId,capturedAt,presentationId},audioConsentRef.current,()=>!sessionInvalid() && currentAssignment.current===id && audioConsentRef.current);
      setAudioDraftRefresh(value=>value+1);
    }finally {requestInFlight.current=false;setBusy(false);}
  };
  const help = async () => {
    if (!id || helpVoiceUnsent || inputAvailability.helpBlocked || helpText.trim().length < 3 || requestInFlight.current || detailUnavailable) return;
    requestInFlight.current = true;
    setBusy(true);setRequestFailure('');
    try {
      const requestId = await requestIdFor('help', id, helpText);
      trackReceipt('help',id,requestId);
      const result = await act(`/worker/briefings/${id}/help`, { text: helpText, requestId });
      if (result && currentAssignment.current === id) { clearTrackedReceipt('help');setHelpText(''); setAudioRefresh((value) => value + 1); }
    } catch(error){requestError(error);} finally { requestInFlight.current = false; setBusy(false); }
  };
  const acknowledge = async () => {
    if(!id || requestInFlight.current || detailUnavailable || !responseState?.canRespond || sessionInvalid())return;
    requestInFlight.current=true;setAcknowledging(true);setRequestFailure('');
    try {
      const result=await act(`/worker/briefings/${id}/acknowledge`,{requestId:crypto.randomUUID()});
      if(result && currentAssignment.current===id)setAudioRefresh(value=>value+1);
    } catch(error){requestError(error);} finally {requestInFlight.current=false;setAcknowledging(false);}
  };
  const endSession=async()=>{
    if(requestInFlight.current)return;
    requestInFlight.current=true;setBusy(true);approvedRoute.current='overview';
    try {if(!await logout())approvedRoute.current=null;}
    finally {requestInFlight.current=false;setBusy(false);}
  };
  const saveFirstLanguage=async()=>{
    if(setupBusy)return;setSetupBusy(true);setSetupError('');
    try {
      await api('/worker/language/selection',{method:'POST',cache:'no-store',
        headers:{'content-type':'application/json','x-client-session-context':session.clientContext!},
        body:JSON.stringify({requestId:setupRequest.current,language:setupChoice})});
      try{saveWorkerUiLanguage(sessionStorage,session,setupChoice);}catch{}
      setUiLanguage(setupChoice);setSetupSaved(true);
      if(!await onSessionRefresh())setSetupError(workerLanguageText[setupChoice].selectError);
    } catch(reason) {setSetupError(messageOfLanguageError(language,reason));setupRequest.current=crypto.randomUUID();}
    finally {setSetupBusy(false);}
  };
  if(session.languageSelectionRequired) {
    const setupText=workerLanguageText[language];
    return <div className="worker-shell worker-navigation-shell" lang={language} dir={workerUiDirection(language)}>
      <a className="skip-link" href="#worker-main" onClick={event=>{event.preventDefault();document.getElementById('worker-main')?.focus();}}>{t.skip}</a>
      <header className="worker-header">
        <div className="worker-brand"><Brand/><small className="worker-site-label"><bdi>{session.organization}</bdi> · <bdi>{session.site}</bdi></small></div>
        <div className="worker-identity">
          <span className="avatar">{session.name?.replace(/\D/g, '') || 'W'}</span>
          <span><strong><bdi>{session.name}</bdi></strong><small>{language.toUpperCase()}</small></span>
          <button className="icon-button" title={leaveText.end} aria-label={leaveText.end} disabled={setupBusy} onClick={()=>askLeave('logout',()=>void endSession())}><LogOut size={20}/></button>
        </div>
      </header>
      <main className="worker-content" id="worker-main" tabIndex={-1}>
        <section className="worker-card worker-language-gate">
          <h1>{setupText.setupTitle}</h1>
          <p>{setupText.setupBody}</p>
          {setupSaved ? <><p className="notice notice-green" role="status">{setupError || setupText.setupDone}</p><button className="button primary full" onClick={()=>location.reload()}>{setupText.reload}</button></> : <>
            <div className="worker-language-options" role="radiogroup" aria-label={setupText.setupTitle}>{workerLanguageOptionList.map(option=><label key={option.code} className={setupChoice===option.code?'selected':''}><input type="radio" name="worker-language" value={option.code} checked={setupChoice===option.code} disabled={setupBusy} onChange={()=>{setSetupChoice(option.code);setUiLanguage(option.code);}}/><span lang={option.code} dir={option.dir}>{option.label}</span></label>)}</div>
            {setupError && <p role="alert" className="notice notice-amber">{setupError}</p>}
            <button className="button primary full" disabled={setupBusy} onClick={()=>void saveFirstLanguage()}>{setupBusy?setupText.saving:setupText.continue}</button>
          </>}
        </section>
      </main>
    </div>;
  }
  const visible=inbox.data?.items || [];
  const pages=Math.max(1,Math.ceil((inbox.data?.total || 0)/5));
  // Do not unmount an unsent recording as the wall clock crosses a deadline. The server rechecks acceptance on upload.
  const responseState = useMemo(() => detail.data ? workerResponseState(detail.data) : null, [detail.data]);
  const responseMode=detail.data?.responseMode==='acknowledge'?'acknowledge':'question';
  const deliveryMode=detail.data?.deliveryMode==='text'||detail.data?.deliveryMode==='voice'?detail.data.deliveryMode as 'text'|'voice':'both';
  return (
    <div className="worker-shell worker-navigation-shell" lang={language} dir={workerUiDirection(language)}>
      <a className="skip-link" href="#worker-main" onClick={event=>{event.preventDefault();document.getElementById('worker-main')?.focus();}}>{t.skip}</a>
      <header className="worker-header">
        <div className="worker-brand"><Brand/><small className="worker-site-label"><bdi>{session.organization}</bdi> · <bdi>{session.site}</bdi></small></div>
        <div className="worker-identity">
          <span className="avatar">{session.name?.replace(/\D/g, '') || 'W'}</span>
          <span><strong><bdi>{session.name}</bdi></strong><small>{language.toUpperCase()}</small></span>
          <NotificationBell session={session} label={notices.title} locale={language} disabled={busy} onOpen={()=>navigate('notifications')} onSessionLost={onSessionLost}/>
          <button className="icon-button" title={t.thisDevice} aria-label={t.thisDevice} disabled={busy} onClick={()=>navigate('device')}><Smartphone size={20}/></button>
          <WorkerLanguageDialog session={session} language={language} disabled={busy}/>
          <button className="icon-button" title={leaveText.end} aria-label={leaveText.end} disabled={busy} onClick={()=>askLeave('logout',()=>void endSession())}><LogOut size={20} /></button>
        </div>
      </header>
      <main className="worker-content" id="worker-main" tabIndex={-1}>
        {requestFailure && <p ref={requestFailureRef} tabIndex={-1} className="notice notice-amber" role="alert">{requestFailure}</p>}
        {pendingReceipts.filter(value=>value.assignmentId===id).map(value=><div className="notice notice-amber worker-receipt-check" key={value.kind}>
          <strong>{checkText[value.kind]}</strong><p role="status">{checkText[value.status]}</p>
          <button className="button outline" disabled={busy} onClick={()=>void checkReceipt(value)}><RefreshCw size={18}/>{checkText.check}</button>
        </div>)}
        {view==='device' ? <WorkerDeviceView language={language} session={session} disabled={busy} current={()=>!sessionInvalid() && validWorkerSession(session) && currentView.current==='device'} onOperation={outboxOperation} onSessionLost={onSessionLost} onBack={()=>navigate('inbox')} languageError={languageError} onEndSession={()=>askLeave('logout',()=>void endSession())} onEndSessionAndClear={()=>void endSession()} languageControl={<WorkerLanguageDialog session={session} language={language} disabled={busy}/>}/> : view==='notifications' ? <WorkerNotifications session={session} language={language} navigate={navigate} refresh={refresh+audioRefresh} current={()=>!sessionInvalid() && validWorkerSession(session)} onSessionLost={onSessionLost} timezone={session.timezone}/> : !id ? (
          <>
            {view==='help'?<WorkerHelpHub language={language} items={visible} loading={inbox.loading} failed={!!inbox.error} disabled={busy} onOpen={assignmentId=>{pendingHelpAssignment.current=assignmentId;navigate('worker/'+assignmentId);}} onFollowup={()=>{setTab('followup');setPage(1);navigate('inbox');}}/>:<>
            <h1>{t.mine}</h1>
            <div className="segmented worker-inbox-tabs">
              <button className={tab === 'todo' ? 'selected' : ''} aria-pressed={tab==='todo'} onClick={() => {setTab('todo');setPage(1);}}>{t.todo} {inbox.data && `(${inbox.data.counts.todo})`}</button>
              <button className={tab === 'completed' ? 'selected' : ''} aria-pressed={tab==='completed'} onClick={() => {setTab('completed');setPage(1);}}>{statusText.sent}</button>
            </div>
            <details className="worker-inbox-more" open={tab==='followup'||tab==='history'}>
              <summary>{t.more}</summary>
              <div className="segmented">
                <button className={tab === 'followup' ? 'selected' : ''} aria-pressed={tab==='followup'} onClick={() => {setTab('followup');setPage(1);}}>{t.followupShort} {inbox.data && `(${inbox.data.counts.followup})`}</button>
                <button className={tab === 'history' ? 'selected' : ''} aria-pressed={tab==='history'} onClick={() => {setTab('history');setPage(1);}}>{workerVersionText[language] || workerVersionText.en}</button>
              </div>
            </details>
            {inbox.loading ? <p role="status">{a.loading}</p> : inbox.error ? <p className="notice notice-amber" role="alert">{navText.listFailed}</p> : visible.length ? visible.map((item) => (
              <section className="worker-card" key={item.id}>
                <div className="worker-card-head">
                  <div className="metric-icon"><FileText size={28} /></div>
                  <div><h2 lang={item.language} dir={item.language==='en'?'ltr':'rtl'}>{item.title}</h2><p>{t.version} v{item.version} · {item.language.toUpperCase()}</p></div>
                  {workerUiDirection(language)==='rtl'?<ChevronLeft size={23} aria-hidden="true"/>:<ChevronRight size={23} aria-hidden="true"/>}
                </div>
                {item.dueAt && <p className="worker-deadline"><Clock3 size={18}/><span>{t.due}: <time dateTime={item.dueAt}>{new Date(item.dueAt).toLocaleString(language,{timeZone:session.timezone,dateStyle:'medium',timeStyle:'short'})}</time> · {session.timezone}</span></p>}
                {item.repeatRequest && <Notice tone="amber">{t.repeat} · <time dateTime={item.repeatRequest.dueAt}>{new Date(item.repeatRequest.dueAt).toLocaleString(language,{timeZone:session.timezone})}</time></Notice>}
                {item.outcome && <Status value={a[item.outcome as 'matched' | 'clarification' | 'unassessable'] || item.outcome} />}
                {item.acknowledgedAt && !item.outcome && <Status value={statusText.acknowledged} />}
                {item.reminderAt && <Notice tone="amber">{t.reminder}</Notice>}
                {!item.outcome && item.audioStatus && <Notice tone="blue">{item.audioStatus === 'failed' ? a.audioFailed : audioMessage}</Notice>}
                {!item.outcome && !item.audioStatus && workerResponseState(item, now).pending && <Notice tone="blue">{statusText.pending}</Notice>}
                {workerResponseState(item, now).closed && <Notice>{workerResponseState(item,now).canHelp?t.deadlinePassed:statusText.closed}</Notice>}
                <button className="button primary full" onClick={() => navigate('worker/' + item.id)}>{item.responseMode==='acknowledge'&&!workerResponseState(item, now).received&&!workerResponseState(item, now).closed ? <CheckCircle2 size={19}/> : <Play size={19}/>} {workerResponseState(item, now).received || workerResponseState(item, now).closed ? t.open : item.responseMode==='acknowledge' ? t.ack : t.listen}</button>
              </section>
            )) : <p className="empty-state">{tab === 'todo' ? a.emptyTodo : tab==='history' ? pagingText.emptyHistory : tab==='followup'?t.emptyFollowup:statusText.emptySent}</p>}
            <button type="button" className="worker-inbox-help" onClick={()=>{setPage(1);navigate('help');}}><HelpCircle size={28} aria-hidden="true"/><span><strong>{navText.needHelp}</strong><small>{navText.contact}</small></span>{workerUiDirection(language)==='rtl'?<ChevronLeft size={22} aria-hidden="true"/>:<ChevronRight size={22} aria-hidden="true"/>}</button>
            </>}
            <div className="worker-inbox-pagination"><span role="status">{!inbox.loading && !inbox.error && inbox.data && `${page} / ${pages} · ${inbox.data.total}`}</span><div className="actions">
              <button className="icon-button" aria-label={pagingText.previous} title={pagingText.previous} disabled={inbox.loading || !!inbox.error || page<=1} onClick={() => setPage((value) => value-1)}>{workerUiDirection(language)==='rtl' ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}</button>
              <button className="icon-button" aria-label={pagingText.next} title={pagingText.next} disabled={inbox.loading || !!inbox.error || page>=pages || page>=5000} onClick={() => setPage((value) => Math.min(value+1,5000))}>{workerUiDirection(language)==='rtl' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}</button>
              <button className="icon-button" aria-label={pagingText.refresh} title={pagingText.refresh} disabled={inbox.loading} onClick={() => setAudioRefresh((value) => value+1)}><RefreshCw size={20} /></button>
              {!inbox.error && page>pages && <button className="button outline" onClick={() => setPage(1)}>{pagingText.first}</button>}
            </div></div>
          </>
        ) : detail.loading && !(detail.data?.id===id && (hasUnsent || receipt?.assignmentId===id)) ? <p role="status">{a.loading}</p> : (detail.error && !retainedDetail) || !detail.data || detail.data.id!==id ? <><p className="notice notice-amber" role="alert">{navText.detailFailed}</p><button className="icon-button" aria-label={refreshText.refresh} title={refreshText.refresh} disabled={busy || detail.loading} onClick={()=>setAudioRefresh(value=>value+1)}><RefreshCw size={20}/></button></> : (
          <>
            <button className="back-link" disabled={busy} onClick={goBack}>{workerUiDirection(language)==='rtl'?<ArrowRight size={19} aria-hidden="true"/>:<ArrowLeft size={19} aria-hidden="true"/>}{t.back}</button>
            <button className="icon-button" aria-label={refreshText.refresh} title={refreshText.refresh} disabled={busy || detail.loading} onClick={()=>setAudioRefresh(value=>value+1)}><RefreshCw size={20}/></button>
            {detail.loading && <p role="status">{a.loading}</p>}
            {detail.error && <p role="alert">{refreshText.failed}</p>}
            {receipt?.assignmentId!==id&&<><h1 lang={detail.data.language} dir={workerUiDirection(detail.data.language)}>{detail.data.contentExpired?detail.data.title:detail.data.content.title}</h1>
            <p className="worker-subtitle">{t.version} v{detail.data.version}</p></>}
            {receipt?.assignmentId === id ? (
              <WorkerSubmissionReceipt choices={detail.data.content?.choices} key={receipt.requestId} session={session} selection={{assignmentId:id,version:receipt.publicationVersion,language:receipt.contentLanguage,requestId:receipt.requestId,kind:receipt.requestKind}} acknowledgedContext={receipt.clientContext} language={language} timezone={session.timezone} disabled={busy||detailUnavailable} canHelp={!!responseState?.canHelp} current={()=>!sessionInvalid()&&currentAssignment.current===id} onSessionLost={onSessionLost} onBack={goBack} onHelp={()=>{pendingHelpAssignment.current=id;setReceipt(null);}} onChecked={()=>{const requestId=receipt.requestId;if(!requestId||checkedReceipts.current.has(requestId))return;checkedReceipts.current.add(requestId);setAudioRefresh(value=>value+1);}}/>
            ) : detail.data.contentExpired ? (
              <Notice tone="blue">{t.expired}</Notice>
            ) : (
              <>
                {responseState?.closed && <Notice>{responseState.canHelp?t.deadlinePassed:statusText.closed}</Notice>}
                <section className="worker-card">
                  <h2>{deliveryMode==='text'?t.readInstruction:t.listen}</h2>
                  {deliveryMode==='text' ? <p className="briefing-text" lang={detail.data.language} dir={workerUiDirection(detail.data.language)}>{detail.data.content.text}</p> : <>
                  {speakError && <p role="alert">{speakError}</p>}
                  {detail.data.speechUrls?.body ? <WorkerAudioPlayer key={`${id}:body:${detail.data.publicationId}:${detail.data.version}`} src={detail.data.speechUrls.body} label={t.play} language={language} onPlayer={element=>{speechPlayers.current.body=element;}} onPlay={()=>{window.speechSynthesis?.cancel();speechPlayers.current.question?.pause();}}/> : <button className="audio-button" disabled={detail.data.content.speech!=='device-synthesis-demo'} onClick={() => speak(detail.data.content.text)}>
                    <span className="play-round"><Volume2 size={25} /></span><span>{t.play}</span>
                    <span className="waveform" aria-hidden="true">▁▃▅▂▇▄▆▂▅▃▁</span>
                  </button>}
                  <details className="worker-text-disclosure" key={`${id}:text:${detail.data.publicationId}:${detail.data.version}`}><summary><FileText size={18} aria-hidden="true"/> {t.text}<ChevronDown size={18} aria-hidden="true"/></summary>
                    <p className="briefing-text" lang={detail.data.language} dir={workerUiDirection(detail.data.language)}>{detail.data.content.text}</p>
                  </details>
                  </>}
                  <WorkerPresentationView key={`presentation:${id}:${detail.data.publicationId}:${detail.data.version}`} assignmentId={id} version={detail.data.version} sourceKind="instruction" originalLanguage={detail.data.language} approvedLanguage={session.language || ''} uiLanguage={language} session={session} disabled={busy||detailUnavailable} current={()=>!sessionInvalid()&&validWorkerSession(session)&&currentAssignment.current===id} onSessionLost={onSessionLost} onActive={setAnswerPresentationId} onChoices={setTranslatedChoices} requiresChoices={detail.data.content.questionType==='multiple-choice'}/>
                </section>
                <section className="worker-card question-card">
                  {responseMode==='acknowledge' ? <>
                    <div className="question-label"><CheckCircle2 size={24} />{t.receipt}</div>
                    <h2>{t.ackTitle}</h2>
                    <p className="muted">{t.ackBody}</p>
                    {responseState?.closed && <Notice>{responseState.canHelp?t.deadlinePassed:statusText.closed}</Notice>}
                    {detail.data.acknowledgedAt ? <><Status value={statusText.acknowledged}/><p className="muted"><time dateTime={detail.data.acknowledgedAt}>{new Date(detail.data.acknowledgedAt).toLocaleString(language,{timeZone:session.timezone,dateStyle:'medium',timeStyle:'short'})}</time></p></> : !responseState?.closed && responseState?.canRespond ? <button className="button primary full" disabled={busy || acknowledging || detailUnavailable} onClick={()=>void acknowledge()}>{acknowledging?t.saving:<><CheckCircle2 size={20}/>{t.ackAction}</>}</button> : null}
                    <button className="button outline full" onClick={() => document.getElementById('worker-help')?.scrollIntoView({ behavior: 'smooth' })}><MessageCircle size={20} /> {t.help}</button>
                  </> : <>
                  <div className="question-label"><HelpCircle size={24} />{t.question}</div>
                  <h2 lang={detail.data.language} dir={workerUiDirection(detail.data.language)}>{detail.data.content.question}</h2>
                  {detail.data.repeatRequest && <Notice tone="amber">{t.repeatSaved} <time dateTime={detail.data.repeatRequest.dueAt}>{new Date(detail.data.repeatRequest.dueAt).toLocaleString(language,{timeZone:session.timezone})}</time></Notice>}
                  {deliveryMode!=='text' && (detail.data.speechUrls?.question ? <WorkerAudioPlayer key={`${id}:question:${detail.data.publicationId}:${detail.data.version}`} src={detail.data.speechUrls.question} label={t.playQuestion} language={language} onPlayer={element=>{speechPlayers.current.question=element;}} onPlay={()=>{window.speechSynthesis?.cancel();speechPlayers.current.body?.pause();}}/> : <button className="audio-button compact" disabled={detail.data.content.speech!=='device-synthesis-demo'} onClick={() => speak(detail.data.content.question)}><Play size={20} />{t.playQuestion}</button>)}
                  {!detail.data.repeatRequest && detail.data.audioStatus && !['failed','blocked'].includes(detail.data.audioStatus) ? (
                    <><Notice tone="blue">{audioMessage}</Notice><audio controls preload="none" src={'/api/recordings/' + detail.data.recordingId + '/audio'} /></>
                  ) : !detail.data.repeatRequest && detail.data.outcome ? (
                    <Status value={a[detail.data.outcome as 'matched' | 'clarification' | 'unassessable'] || detail.data.outcome} />
                  ) : responseState?.pending ? (
                    <Notice tone="blue">{statusText.pending}</Notice>
                  ) : responseState?.closed ? null : detail.data.content.questionType==='multiple-choice' ? (
                    <>
                      <fieldset className="worker-choice-list" disabled={busy || detailUnavailable || inputAvailability.answerBlocked}>
                        <legend>{workerChoicePrompt[language]}</legend>
                        {(translatedChoices || detail.data.content.choices || []).map((choice:{id:string;text:string})=><label key={choice.id} className={`worker-choice ${answer===choice.id?'selected':''}`}>
                          <input type="radio" name={`instruction-choice-${id}`} value={choice.id} checked={answer===choice.id} onChange={()=>setAnswer(choice.id)}/>
                          <span lang={translatedChoices?session.language:detail.data.language} dir="auto">{choice.text}</span>
                        </label>)}
                      </fieldset>
                      <button className="button primary full" onClick={()=>void submit()} disabled={!answer || busy || detailUnavailable || inputAvailability.answerBlocked}><Send size={20}/>{t.send}</button>
                    </>
                  ) : (
                    <>
                      {['failed','blocked'].includes(detail.data.audioStatus) && <Notice>{a.audioFailed}</Notice>}
                      <div className="segmented answer-mode">
                        <button disabled={busy} className={answerMode === 'type' ? 'selected' : ''} onClick={() => askLeave('type',()=>setAnswerMode('type'))}>{a.typeInstead}</button>
                        <button disabled={busy} className={answerMode === 'record' ? 'selected' : ''} onClick={() => setAnswerMode('record')}>{a.recordInstead}</button>
                      </div>
                      {answerMode === 'record' ? <WorkerRecorderView key={id} language={language} noticeLanguage={contentLanguage} loadSiteNotice={loadRecordingNotice} synthetic={session.mode.startsWith('synthetic-')} disabled={busy || detailUnavailable || inputAvailability.answerBlocked} saveAllowed={privateDevice && audioConsent} onSave={(bytes,submissionId,capturedAt)=>saveAudioPreview(bytes,submissionId,capturedAt,answerPresentationId)} onSend={(bytes,submissionId)=>submitAudio(bytes,submissionId,answerPresentationId)} onUnsavedChange={setAudioUnsent} /> : reviewingAnswer ? (
                        <div className="worker-answer-review">
                          <h3>{t.reviewTitle}</h3>
                          <p className="briefing-text" dir="auto">{answer}</p>
                          <p className="muted">{t.reviewBody}</p>
                          <div className="actions"><button type="button" className="button outline" disabled={busy} onClick={()=>setReviewingAnswer(false)}>{t.edit}</button><button type="button" className="button primary" onClick={submit} disabled={!answer.trim() || busy || detailUnavailable || inputAvailability.answerBlocked}><Send size={20}/>{t.send}</button></div>
                        </div>
                      ) : (
                        <>
                          <label className="field">{t.answer}<textarea rows={4} value={answer} disabled={busy || inputAvailability.answerBlocked} onChange={(event) => setAnswer(event.target.value)} placeholder={t.reply} maxLength={2000} /></label>
                          <button className="button primary full" onClick={()=>setReviewingAnswer(true)} disabled={!answer.trim() || busy || detailUnavailable || inputAvailability.answerBlocked}>{workerUiDirection(language)==='rtl'?<ChevronLeft size={20} />:<ChevronRight size={20} />}{t.reviewAnswer}</button>
                        </>
                      )}
                    </>
                  )}
                  {responseState?.pending && <button className="icon-button" aria-label={statusText.check} title={statusText.check} disabled={busy} onClick={() => setAudioRefresh((value) => value + 1)}><RefreshCw size={20} /></button>}
                  <button className="button outline full" onClick={() => document.getElementById('worker-help')?.scrollIntoView({ behavior: 'smooth' })}><MessageCircle size={20} /> {t.help}</button>
                  </>}
                </section>
                <section className="worker-card" id="worker-help">
                  <h2 tabIndex={-1}>{t.helpTitle}</h2>
                  {responseState?.canHelp && <><label className="field">{t.helpPrompt}<textarea rows={3} value={helpText} disabled={busy || helpVoiceUnsent || inputAvailability.helpBlocked} onChange={(event) => setHelpText(event.target.value)} maxLength={500} /></label>
                  <button className="button outline full" disabled={helpText.trim().length < 3 || helpVoiceUnsent || inputAvailability.helpBlocked || busy || detailUnavailable} onClick={help}><MessageCircle size={18} />{t.help}</button>
                  {detail.data.canVoiceHelp && <CaseVoiceRecorder key={`help-voice:${id}`} scope={{kind:'help',id}} session={{clientContext:session.clientContext!,expiresAt:session.expiresAt!}} current={()=>!sessionInvalid()&&currentAssignment.current===id} language={language} noticeLanguage={contentLanguage} disabled={busy || detailUnavailable || inputAvailability.helpBlocked || !!helpText.trim()} onDirtyChange={setHelpVoiceUnsent} onSessionLost={onSessionLost} onReceived={()=>setAudioRefresh(value=>value+1)}/>}</>}
                </section>
              </>
            )}
            {!detail.data.contentExpired&&<>
                  <InstructionFiles language={language} assignmentId={id} clientContext={session.clientContext!} current={()=>!sessionInvalid()&&validWorkerSession(session)&&currentAssignment.current===id} onSessionLost={onSessionLost}/>
                  <WorkerWorkProgress key={`${id}:${receipt?.requestId||'view'}`} assignmentId={id} clientContext={session.clientContext!} current={()=>!sessionInvalid()&&validWorkerSession(session)&&currentAssignment.current===id} onSessionLost={onSessionLost} refresh={refresh+audioRefresh} language={language}/>
            </>}
            <WorkerOfflineSaveView key={`offline:${id}:${detail.data.publicationId}:${detail.data.version}`} session={session} language={language} scope={{assignmentId:id,publicationId:detail.data.publicationId,version:detail.data.version,language:detail.data.language}} disabled={busy || detailUnavailable} current={()=>!sessionInvalid() && validWorkerSession(session) && currentAssignment.current===id && !detailUnavailable} onOperation={outboxOperation}/>
            {detail.data.content?.questionType!=='multiple-choice' && <WorkerAudioDraftView key={`audio:${id}:${detail.data.publicationId}:${detail.data.version}`} session={session} interfaceLanguage={language} scope={{assignmentId:id,publicationId:detail.data.publicationId,version:detail.data.version,language:detail.data.language}}
              refresh={audioDraftRefresh} consent={audioConsent} onConsent={changeAudioConsent} disabled={busy || detailUnavailable} blocked={audioUnsent || !!answer.trim() || !!helpText.trim()}
              current={()=>!sessionInvalid() && validWorkerSession(session) && currentAssignment.current===id && !detailUnavailable}
              onSend={(bytes,submissionId,presentationId)=>submitAudio(bytes,submissionId,presentationId??null)} onCheck={async requestId=>{trackReceipt('audio',id,requestId);await checkReceipt({kind:'audio',assignmentId:id,requestId,status:'unknown'});}}/>}
            <WorkerTextDraftView key={`${id}:${detail.data.publicationId}:${detail.data.version}`} session={session} interfaceLanguage={language} scope={{assignmentId:id,publicationId:detail.data.publicationId,version:detail.data.version}}
              draft={{answer,help:helpText,receipts:pendingReceipts.filter(value=>value.assignmentId===id)}} disabled={busy || detailUnavailable} restoreBlocked={audioUnsent}
              current={()=>!sessionInvalid() && validWorkerSession(session) && currentAssignment.current===id && !detailUnavailable}
              onRestore={value=>{setAnswer(value.answer);setHelpText(value.help);setPendingReceipts(value.receipts);if(value.answer)setAnswerMode('type');}}/>
            <WorkerSubmissions choices={detail.data.content?.choices} key={`submissions:${id}`} assignmentId={id} version={detail.data.version} contentLanguage={detail.data.language} session={session} language={language} timezone={session.timezone} refresh={refresh + audioRefresh} current={()=>!sessionInvalid()&&currentAssignment.current===id} onSessionLost={onSessionLost}/>
            <WorkerHelpHistory key={`help-history:${id}`} assignmentId={id} version={detail.data.version} contentLanguage={detail.data.language} language={language} timezone={session.timezone} refresh={refresh + audioRefresh} session={session} current={()=>!sessionInvalid()&&currentAssignment.current===id} canWrite={!busy&&!detailUnavailable&&!inputAvailability.conversationBlocked} onDirtyChange={setConversationUnsent} onSessionLost={onSessionLost}/>
          </>
        )}
        {message && <div className="toast" role="status">{message === 'Saved.' ? a.saved : message}</div>}
      </main>
      <nav className="worker-bottom-nav" aria-label={navText.navigation}><div>
        <button type="button" aria-current={view!=='device' && view!=='help' && view!=='notifications'?'page':undefined} disabled={busy} onClick={()=>navigate('inbox')}><FileText size={23} aria-hidden="true"/><span>{navText.briefings}</span></button>
        <button type="button" aria-current={view==='help'?'page':undefined} disabled={busy} onClick={()=>{setPage(1);navigate('help');}}><HelpCircle size={23} aria-hidden="true"/><span>{navText.help}</span></button>
        <button type="button" aria-current={view==='device'?'page':undefined} disabled={busy} onClick={()=>navigate('device')}><Smartphone size={23} aria-hidden="true"/><span>{navText.device}</span></button>
      </div></nav>
      <dialog ref={leaveDialog} className="withdraw-dialog" aria-labelledby="worker-leave-title" aria-describedby="worker-leave-impact" onKeyDown={keepDialogFocus} onClose={()=>{leaveAction.current=null;if(leaveTrigger.current?.isConnected)leaveTrigger.current.focus();}}>
        <h2 id="worker-leave-title">{leaveText.title}</h2><p id="worker-leave-impact">{leaveKind==='type'?leaveText.mode:leaveText.body}</p>
        <div className="actions"><button autoFocus className="button outline" onClick={()=>leaveDialog.current?.close()}>{leaveText.stay}</button><button className="button danger" disabled={busy} onClick={()=>{const action=leaveAction.current;leaveDialog.current?.close();action?.();}}>{leaveKind==='type'?leaveText.type:leaveKind==='logout'?leaveText.end:leaveText.leave}</button></div>
      </dialog>
    </div>
  );
}
