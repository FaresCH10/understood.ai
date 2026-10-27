import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Mic,RefreshCw,Trash2,X} from 'lucide-react';
import {WorkerRecorderView} from './WorkerRecorderView';
import {useStaffRequest,type StaffRequestAuthority} from './useStaffRequest';
import {staffIdentityLabel} from './session-state';
import {staffRequestBinding} from './staff-request';
import {CaseTime} from './CaseTime';
import {CaseLocalePicker} from './CaseLocalePicker';
import {caseLanguage,type CaseLocale} from './clarification-locale';
import {keepDialogFocus} from './dialog-focus';
import {StaffRecordingError,readStaffRecordingPending,retainStaffRecording,clearStaffRecordingPending,checkedStaffRecordingPage,checkedStaffRecordingNotice,requestStaffRecording,type StaffRecordingPending,type StaffRecordingPage,type StaffRecordingReceipt,type StaffRecordingScope,type RecordingLanguage} from './staff-case-recordings';

export const staffRecordingText={
  en:{action:'Record in-person clarification',history:'In-person recordings',language:'Recording language',refresh:'Refresh recordings',loading:'Loading private recordings...',empty:'No private staff recordings.',failedRead:'Private recordings could not be verified. Refresh to try again.',unavailable:'Verify the case and session before recording.',unknown:'Saving is unconfirmed. Check the original receipt before retrying the same preview.',check:'Check recording receipt',error:'The recording receipt could not be verified. The pending request is unchanged.',saved:'Private recording saved. The original answer and case status are unchanged.',failed:'This recording was not accepted. You may record a new clarification.',storing:'Storage in progress',received:'Received',notAccepted:'Not accepted',retired:'Audio is no longer available.',play:'Private in-person recording',playError:'Private audio playback is unavailable. Refresh to recheck access.',close:'Close recordings',finish:'Finish or clear the current preview before closing.',clear:'Clear local recording preview',clearTitle:'Clear this local preview?',clearImpact:'Only the preview on this page will be removed. A pending upload is not cancelled, saved audio is not deleted, and its receipt remains recoverable.',cancel:'Cancel',confirm:'Clear preview',older:'Older recordings',newer:'Newer recordings',page:'Page',of:'of'},
  ar:{action:'تسجيل توضيح حضوري',history:'التسجيلات الحضورية',language:'لغة التسجيل',refresh:'تحديث التسجيلات',loading:'جارٍ تحميل التسجيلات الخاصة...',empty:'لا توجد تسجيلات خاصة للموظفين.',failedRead:'تعذر التحقق من التسجيلات الخاصة. حدّث للمحاولة مجددًا.',unavailable:'تحقق من الحالة والجلسة قبل التسجيل.',unknown:'الحفظ غير مؤكد. تحقق من الاستلام الأصلي قبل إعادة محاولة المعاينة نفسها.',check:'التحقق من استلام التسجيل',error:'تعذر التحقق من استلام التسجيل. لم يتغير الطلب المعلق.',saved:'تم حفظ التسجيل الخاص. الإجابة الأصلية وحالة الحالة لم تتغيرا.',failed:'لم يُقبل هذا التسجيل. يمكنك تسجيل توضيح جديد.',storing:'جارٍ التخزين',received:'تم الاستلام',notAccepted:'لم يُقبل',retired:'لم يعد الصوت متاحًا.',play:'تسجيل حضوري خاص',playError:'تشغيل الصوت الخاص غير متاح. حدّث للتحقق من الوصول.',close:'إغلاق التسجيلات',finish:'أكمل المعاينة الحالية أو امسحها قبل الإغلاق.',clear:'مسح معاينة التسجيل المحلية',clearTitle:'مسح هذه المعاينة المحلية؟',clearImpact:'ستُمسح المعاينة من هذه الصفحة فقط. لن يُلغى رفع معلق ولن يُحذف صوت محفوظ، وسيبقى الاستلام قابلًا للاستعادة.',cancel:'إلغاء',confirm:'مسح المعاينة',older:'التسجيلات الأقدم',newer:'التسجيلات الأحدث',page:'صفحة',of:'من'},
  ur:{action:'بالمشافہ وضاحت ریکارڈ کریں',history:'بالمشافہ ریکارڈنگ',language:'ریکارڈنگ کی زبان',refresh:'ریکارڈنگ تازہ کریں',loading:'نجی ریکارڈنگ لوڈ ہو رہی ہیں...',empty:'عملے کی کوئی نجی ریکارڈنگ نہیں۔',failedRead:'نجی ریکارڈنگ کی تصدیق نہیں ہو سکی۔ دوبارہ تازہ کریں۔',unavailable:'ریکارڈنگ سے پہلے معاملے اور سیشن کی تصدیق کریں۔',unknown:'محفوظ ہونا غیر مصدقہ ہے۔ وہی پیش نظارہ دوبارہ بھیجنے سے پہلے اصل وصولی چیک کریں۔',check:'ریکارڈنگ کی وصولی چیک کریں',error:'ریکارڈنگ کی وصولی کی تصدیق نہیں ہو سکی۔ زیر التوا درخواست برقرار ہے۔',saved:'نجی ریکارڈنگ محفوظ ہو گئی۔ اصل جواب اور معاملے کی حالت نہیں بدلی۔',failed:'یہ ریکارڈنگ قبول نہیں ہوئی۔ آپ نئی وضاحت ریکارڈ کر سکتے ہیں۔',storing:'محفوظ ہو رہی ہے',received:'موصول',notAccepted:'قبول نہیں ہوئی',retired:'آڈیو اب دستیاب نہیں۔',play:'نجی بالمشافہ ریکارڈنگ',playError:'نجی آڈیو چلانا دستیاب نہیں۔ رسائی دوبارہ چیک کرنے کے لیے تازہ کریں۔',close:'ریکارڈنگ بند کریں',finish:'بند کرنے سے پہلے موجودہ پیش نظارہ مکمل یا صاف کریں۔',clear:'مقامی ریکارڈنگ کا پیش نظارہ صاف کریں',clearTitle:'یہ مقامی پیش نظارہ صاف کریں؟',clearImpact:'صرف اس صفحے کا پیش نظارہ صاف ہوگا۔ زیر التوا اپ لوڈ منسوخ یا محفوظ آڈیو حذف نہیں ہوگی، اور وصولی بازیاب کی جا سکے گی۔',cancel:'منسوخ کریں',confirm:'پیش نظارہ صاف کریں',older:'پرانی ریکارڈنگ',newer:'نئی ریکارڈنگ',page:'صفحہ',of:'از'},
};
type Props={scope:StaffRecordingScope;authority:StaffRequestAuthority;available:boolean;canWrite:boolean;language:CaseLocale;onLanguageChange?:(language:CaseLocale)=>void;recordingLanguage:RecordingLanguage;timezone?:string;refresh:number;onDirtyChange:(dirty:boolean)=>void;onChanged:()=>void};
const availabilityText={en:{draft:'Finish or clear the current case draft before recording.',closed:'New recordings are unavailable for this case.'},ar:{draft:'أكمل مسودة الحالة الحالية أو امسحها قبل التسجيل.',closed:'التسجيلات الجديدة غير متاحة لهذه الحالة.'},ur:{draft:'ریکارڈنگ سے پہلے معاملے کا موجودہ مسودہ مکمل یا صاف کریں۔',closed:'اس معاملے کے لیے نئی ریکارڈنگ دستیاب نہیں۔'}};
export function StaffCaseRecordings(props:Props){return <RecordingTools key={JSON.stringify([staffRequestBinding(props.authority.session),props.scope])} {...props}/>;}
function RecordingTools({scope,authority,available,canWrite,language,onLanguageChange,recordingLanguage,timezone='UTC',refresh,onDirtyChange,onChanged}:Props){
  const api=useStaffRequest(authority),t=staffRecordingText[language],title=useId(),impact=useId();
  const [open,setOpen]=useState(false),[declared,setDeclared]=useState(recordingLanguage),[page,setPage]=useState(1),[tick,setTick]=useState(0),[generation,setGeneration]=useState(0);
  const [pending,setPending]=useState<StaffRecordingPending|null>(null),[initialized,setInitialized]=useState(false),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false),[unsaved,setUnsaved]=useState(false),[error,setError]=useState(false),[closeError,setCloseError]=useState(false),[notice,setNotice]=useState<'saved'|'failed'|null>(null);
  const key=JSON.stringify([open,available,page,tick,refresh]),[read,setRead]=useState<{key:string;data:StaffRecordingPage|null;failed:boolean;loading:boolean}>({key:'',data:null,failed:false,loading:false});
  const dialog=useRef<HTMLDialogElement>(null),clearDialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null),clearTrigger=useRef<HTMLButtonElement>(null),checkButton=useRef<HTMLButtonElement>(null),clearIntent=useRef<{generation:number;requestId:string|null}|null>(null),hadPending=useRef(false);
  const mounted=useRef(false),flight=useRef(false),controller=useRef<AbortController|null>(null),callbacks=useRef({available,canWrite,onDirtyChange,onChanged,authority});callbacks.current={available,canWrite,onDirtyChange,onChanged,authority};
  const historyHeading=useRef<HTMLHeadingElement>(null);
  const data=read.key===key&&available&&api.current()?read.data:null,latestData=useRef(data);latestData.current=data;
  const current=()=>mounted.current&&api.current();
  const maySend=()=>current()&&callbacks.current.available&&callbacks.current.canWrite&&callbacks.current.authority.canMutate()&&latestData.current?.canRecord===true;
  useEffect(()=>{mounted.current=true;try{const retained=readStaffRecordingPending(sessionStorage,authority.session,scope);setPending(retained);if(retained)setDeclared(retained.language);setInitialized(true);}catch{setBlocked(true);setError(true);}return()=>{mounted.current=false;controller.current?.abort();callbacks.current.onDirtyChange(false);};},[]);
  useEffect(()=>{callbacks.current.onDirtyChange(unsaved||busy);if(!unsaved&&!busy)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[unsaved,busy]);
  useEffect(()=>{if(!pending&&hadPending.current&&open&&dialog.current?.open)closeButton.current?.focus();hadPending.current=!!pending;},[pending,open]);
  useEffect(()=>{
    let alive=true;const command=new AbortController();setRead({key,data:null,failed:false,loading:open&&available});if(!open||!available)return()=>command.abort();
    api.request<unknown>(`/api/clarifications/${encodeURIComponent(scope.caseId)}/in-person-recordings?page=${page}&pageSize=10`,undefined,command.signal).then(value=>{
      if(alive&&current())setRead({key,data:checkedStaffRecordingPage(value,scope.caseId,page,authority.session.clientContext!),loading:false,failed:false});
    }).catch(reason=>{if(!alive||!current())return;if(reason instanceof StaffRecordingError&&reason.code==='session'){callbacks.current.authority.onSessionLost();return;}setRead({key,data:null,loading:false,failed:true});});
    return()=>{alive=false;command.abort();};
  },[key,api]);
  const loadNotice=useCallback(async(selected:import('./recording-notice').RecordingLanguage,signal:AbortSignal)=>{if(selected!=='en'&&selected!=='ar'&&selected!=='ur')throw new StaffRecordingError('blocked');return checkedStaffRecordingNotice(await api.request<unknown>('/api/privacy/recording-notice',undefined,signal),authority.session,selected);},[api,authority.session]);
  function report(reason:unknown){if(!current())return;setError(true);if(reason instanceof StaffRecordingError&&reason.code==='session')callbacks.current.authority.onSessionLost();}
  function accept(value:StaffRecordingReceipt,retained:StaffRecordingPending){
    if(!current())throw new StaffRecordingError('session');if(value.status==='storing')throw new StaffRecordingError('conflict');
    clearStaffRecordingPending(sessionStorage,authority.session,scope,retained,current);setPending(null);setError(false);setNotice(value.status==='received'?'saved':'failed');
    setPage(1);setTick(n=>n+1);if(value.status==='failed'){setGeneration(n=>n+1);return false;}callbacks.current.onChanged();return true;
  }
  async function request(retained:StaffRecordingPending,operation:{kind:'receipt'}|{kind:'send';bytes:Uint8Array}){
    const command=new AbortController();controller.current=command;return requestStaffRecording(fetch,authority.session,scope,retained,operation,command.signal,current,maySend);
  }
  async function send(bytes:Uint8Array,id:string){
    if(!maySend()||blocked||!initialized||flight.current)throw new StaffRecordingError('blocked');flight.current=true;setBusy(true);setError(false);setNotice(null);let rejected=false;
    try{const snapshot=new Uint8Array(bytes),retained=await retainStaffRecording(sessionStorage,authority.session,scope,id,snapshot,declared,maySend);if(!current())throw new StaffRecordingError('session');setPending(retained);
      if(!accept(await request(retained,{kind:'send',bytes:snapshot}),retained)){rejected=true;throw new StaffRecordingError('unavailable');}
    }catch(reason){if(!rejected)report(reason);throw reason;}finally{flight.current=false;if(mounted.current)setBusy(false);}
  }
  async function check(){
    if(!pending||blocked||flight.current||!current())return;flight.current=true;setBusy(true);setError(false);
    try{if(accept(await request(pending,{kind:'receipt'}),pending))setGeneration(n=>n+1);}catch(reason){report(reason);}finally{flight.current=false;if(mounted.current)setBusy(false);}
  }
  function close(){if(unsaved||busy||flight.current){setCloseError(true);return;}dialog.current?.close();}
  function clear(){
    const intent=clearIntent.current;if(intent&&!busy&&!flight.current&&current()&&unsaved&&intent.generation===generation&&intent.requestId===(pending?.id??null)){setGeneration(n=>n+1);setUnsaved(false);setError(false);setCloseError(false);}
    clearDialog.current?.close();
  }
  const pages=Math.max(1,Math.ceil((data?.total??0)/10));
  const historyLoading=read.key!==key||read.loading;
  function changePage(next:number){
    if(!current()||!available||busy||unsaved||historyLoading||!data||next<1||next>pages||next===page)return;
    historyHeading.current?.focus();setPage(next);
  }
  function refreshHistory(){
    if(!current()||!available||busy||unsaved||historyLoading)return;
    historyHeading.current?.focus();setTick(n=>n+1);
  }
  return <div className="staff-recording-tools">
    <button ref={trigger} type="button" className="button outline" disabled={!available||!api.current()} onClick={()=>{setOpen(true);dialog.current?.showModal();}}><Mic size={18}/>{canWrite?t.action:t.history}</button>
    <dialog ref={dialog} className="withdraw-dialog staff-recording-dialog" lang={language} dir={language==='en'?'ltr':'rtl'} aria-labelledby={title} onKeyDown={keepDialogFocus} onCancel={event=>{if(unsaved||busy||flight.current){event.preventDefault();setCloseError(true);}}} onClose={()=>{setOpen(false);setCloseError(false);trigger.current?.focus();}}>
      <div className="worker-card-head"><h2 id={title}>{t.history}</h2><div className="actions">{onLanguageChange&&<CaseLocalePicker locale={language} onChange={onLanguageChange}/>}<button ref={closeButton} autoFocus type="button" className="icon-button" title={t.close} aria-label={t.close} onClick={close}><X size={20}/></button></div></div>
      {open&&<>
        {closeError&&<p role="alert" className="record-error">{t.finish}</p>}{error&&<p role="alert" className="record-error">{t.error}</p>}{notice&&<p role="status">{t[notice]}</p>}
        {pending&&<aside className="notice notice-amber"><p role="status">{t.unknown}</p><button ref={checkButton} className="button outline" disabled={busy||blocked} onClick={()=>void check()}><RefreshCw size={18}/>{t.check}</button></aside>}
        <label className="field">{t.language}<select value={declared} disabled={unsaved||busy||!!pending||blocked||!initialized||!maySend()} onChange={event=>setDeclared(event.target.value as RecordingLanguage)}>{(['en','ar','ur'] as const).map(value=><option key={value} value={value}>{caseLanguage(language,value)}</option>)}</select></label>
        {!maySend()&&<p role="status">{data?.canRecord===true&&!canWrite?availabilityText[language].draft:data?.canRecord===false?availabilityText[language].closed:t.unavailable}</p>}
        <WorkerRecorderView key={generation} purpose="in_person" language={language} noticeLanguage={declared} loadSiteNotice={loadNotice} synthetic={false} retryOnly={!!pending} disabled={!maySend()||busy||blocked||!initialized||!!pending&&!unsaved} saveAllowed={false} onSave={async()=>{throw new StaffRecordingError('blocked');}} onSend={send} onUnsavedChange={setUnsaved}/>
        {unsaved&&<button ref={clearTrigger} className="button subtle" disabled={busy} onClick={()=>{if(!current()||busy||flight.current)return;clearIntent.current={generation,requestId:pending?.id??null};clearDialog.current?.showModal();}}><Trash2 size={18}/>{t.clear}</button>}
        <section className="staff-recording-history" aria-label={t.history} aria-busy={historyLoading}><div className="worker-card-head"><h3 ref={historyHeading} tabIndex={-1}>{t.history}</h3><button className="icon-button" title={t.refresh} aria-label={t.refresh} disabled={!available||busy||unsaved||historyLoading} onClick={refreshHistory}><RefreshCw size={18}/></button></div>
          <p role="status" className="muted">{historyLoading?t.loading:data?`${t.page} ${page} ${t.of} ${pages}`:''}</p>
          {historyLoading?null:!available?<p>{t.unavailable}</p>:read.failed?<p role="alert" className="record-error">{t.failedRead}</p>:data&&!data.items.length?<p>{t.empty}</p>:data&&<ol className="staff-recording-list">{data.items.map(row=><li key={row.requestId}><div className="worker-card-head"><strong><bdi>{staffIdentityLabel(row.actorName,language)}</bdi></strong><CaseTime value={row.receivedAt??row.createdAt} language={language} timezone={timezone}/></div><p>{staffIdentityLabel(row.actorRole,language,true)} · {caseLanguage(language,row.language)} · {row.status==='received'?t.received:row.status==='storing'?t.storing:t.notAccepted}</p>{row.available?<PrivateStaffAudio caseId={scope.caseId} requestId={row.requestId} language={language}/>:row.status==='received'&&<p>{t.retired}</p>}</li>)}</ol>}
          {data&&pages>1&&<div className="audit-pagination"><div className="actions"><button className="icon-button" title={t.newer} aria-label={t.newer} disabled={busy||unsaved||page<=1} onClick={()=>changePage(page-1)}>{language==='en'?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}</button><button className="icon-button" title={t.older} aria-label={t.older} disabled={busy||unsaved||page>=pages} onClick={()=>changePage(page+1)}>{language==='en'?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></div></div>}
        </section>
      </>}
    </dialog>
    <dialog ref={clearDialog} className="withdraw-dialog" aria-labelledby={`${title}-clear`} aria-describedby={impact} onKeyDown={keepDialogFocus} onClose={()=>{clearIntent.current=null;if(clearTrigger.current?.isConnected)clearTrigger.current.focus();else if(checkButton.current?.isConnected)checkButton.current.focus();else closeButton.current?.focus();}}><h2 id={`${title}-clear`}>{t.clearTitle}</h2><p id={impact}>{t.clearImpact}</p><div className="actions"><button autoFocus className="button outline" onClick={()=>clearDialog.current?.close()}>{t.cancel}</button><button className="button danger" onClick={clear}>{t.confirm}</button></div></dialog>
  </div>;
}
function PrivateStaffAudio({caseId,requestId,language}:{caseId:string;requestId:string;language:CaseLocale}){
  const [failed,setFailed]=useState(false),t=staffRecordingText[language];
  return <>{failed&&<p role="alert" className="record-error">{t.playError}</p>}<audio controls preload="none" aria-label={t.play} src={`/api/clarifications/${encodeURIComponent(caseId)}/in-person-recordings/${requestId}/audio`} onError={()=>setFailed(true)}/></>;
}
