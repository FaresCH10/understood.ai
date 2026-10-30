import {useEffect,useRef,useState} from 'react';
import {HardDrive,RefreshCw,Send,Trash2} from 'lucide-react';
import {audioDraftCopy,browserAudioOutbox,clearAudioDraft,readAudioDraft,readAudioOutbox,subscribeAudioDraftChanges,type AudioOutboxItem} from './worker-audio-draft';
import {sendWorkerRecording,WorkerAudioRetryError,workerAudioRetryText} from './worker-audio-retry';
import {readWorkerRequestReceipt,workerReceiptCheckText} from './worker-request';
import type {PageSession} from './session-state';
import type {WorkerUiLanguage} from './worker-ui-language';

export type AudioOutboxProps={session:PageSession;language:WorkerUiLanguage;disabled:boolean;current:()=>boolean;onOperation:(work:()=>Promise<void>)=>Promise<void>;onSessionLost:()=>void};
const copy={
  en:{title:'Saved recordings',scope:'Instruction',version:'Version',expires:'Expires',limits:'Up to 10 recordings and 25 MiB on this device. Saved copies remain until removed or expired.',removeAll:'Remove all saved recordings'},
  ar:{title:'التسجيلات المحفوظة',scope:'التعليمات',version:'الإصدار',expires:'تنتهي الصلاحية',limits:'حتى 10 تسجيلات و25 ميبيبايت على هذا الجهاز. تبقى النسخ المحفوظة حتى حذفها أو انتهاء صلاحيتها.',removeAll:'حذف جميع التسجيلات المحفوظة'},
  ur:{title:'محفوظ ریکارڈنگز',scope:'ہدایات',version:'ورژن',expires:'میعاد',limits:'اس آلے پر زیادہ سے زیادہ 10 ریکارڈنگز اور 25 میبی بائٹس۔ محفوظ نقول ہٹانے یا میعاد ختم ہونے تک باقی رہتی ہیں۔',removeAll:'تمام محفوظ ریکارڈنگز ہٹائیں'},
  hi:{title:'सहेजी गई रिकॉर्डिंग',scope:'निर्देश',version:'संस्करण',expires:'समाप्ति',limits:'इस डिवाइस पर अधिकतम 10 रिकॉर्डिंग और 25 MiB। सहेजी प्रतियाँ हटाने या समाप्त होने तक रहती हैं।',removeAll:'सभी सहेजी रिकॉर्डिंग हटाएँ'},
  bn:{title:'সংরক্ষিত রেকর্ডিং',scope:'নির্দেশনা',version:'সংস্করণ',expires:'মেয়াদ শেষ',limits:'এই ডিভাইসে সর্বোচ্চ ১০টি রেকর্ডিং ও ২৫ MiB। সংরক্ষিত কপি সরানো বা মেয়াদ শেষ হওয়া পর্যন্ত থাকে।',removeAll:'সব সংরক্ষিত রেকর্ডিং সরান'},
  ml:{title:'സംരക്ഷിത റെക്കോർഡിംഗുകൾ',scope:'നിർദ്ദേശം',version:'പതിപ്പ്',expires:'കാലാവധി',limits:'ഈ ഉപകരണത്തിൽ പരമാവധി 10 റെക്കോർഡിംഗുകളും 25 MiB-യും. സംരക്ഷിത പകർപ്പുകൾ നീക്കുന്നതുവരെയോ കാലാവധി തീരുന്നതുവരെയോ നിലനിൽക്കും.',removeAll:'എല്ലാ സംരക്ഷിത റെക്കോർഡിംഗുകളും നീക്കുക'},
  ta:{title:'சேமித்த பதிவுகள்',scope:'அறிவுறுத்தல்',version:'பதிப்பு',expires:'காலாவதி',limits:'இந்தச் சாதனத்தில் அதிகபட்சம் 10 பதிவுகளும் 25 MiB-யும். சேமித்த நகல்கள் நீக்கும் வரை அல்லது காலாவதியாகும் வரை இருக்கும்.',removeAll:'சேமித்த அனைத்துப் பதிவுகளையும் நீக்கு'},
  te:{title:'సేవ్ చేసిన రికార్డింగ్‌లు',scope:'సూచన',version:'వెర్షన్',expires:'గడువు',limits:'ఈ పరికరంలో గరిష్ఠంగా 10 రికార్డింగ్‌లు మరియు 25 MiB. సేవ్ చేసిన కాపీలు తొలగించే వరకు లేదా గడువు ముగిసే వరకు ఉంటాయి.',removeAll:'సేవ్ చేసిన అన్ని రికార్డింగ్‌లను తొలగించండి'},
  ne:{title:'सुरक्षित रेकर्डिङहरू',scope:'निर्देशन',version:'संस्करण',expires:'म्याद',limits:'यो यन्त्रमा अधिकतम १० रेकर्डिङ र २५ MiB। सुरक्षित प्रतिलिपिहरू हटाउने वा म्याद सकिनेसम्म रहन्छन्।',removeAll:'सबै सुरक्षित रेकर्डिङ हटाउनुहोस्'},
  fil:{title:'Mga naka-save na recording',scope:'Instruction',version:'Bersyon',expires:'Mag-e-expire',limits:'Hanggang 10 recording at 25 MiB sa device na ito. Mananatili ang mga naka-save na kopya hanggang maalis o mag-expire.',removeAll:'Alisin ang lahat ng naka-save na recording'},
  si:{title:'සුරකින ලද පටිගත කිරීම්',scope:'උපදෙස්',version:'අනුවාදය',expires:'කල් ඉකුත් වේ',limits:'මෙම උපාංගයේ උපරිම පටිගත කිරීම් 10ක් සහ 25 MiB. සුරකින ලද පිටපත් ඉවත් කරන තෙක් හෝ කල් ඉකුත් වන තෙක් රැඳේ.',removeAll:'සුරකින ලද සියලුම පටිගත කිරීම් ඉවත් කරන්න'},
  ru:{title:'Сохранённые записи',scope:'Инструкция',version:'Версия',expires:'Истекает',limits:'До 10 записей и 25 MiB на этом устройстве. Сохранённые копии остаются до удаления или истечения срока.',removeAll:'Удалить все сохранённые записи'},
  'pa-Guru':{title:'ਸੰਭਾਲੀਆਂ ਰਿਕਾਰਡਿੰਗਾਂ',scope:'ਹਦਾਇਤ',version:'ਵਰਜ਼ਨ',expires:'ਮਿਆਦ',limits:'ਇਸ ਡਿਵਾਈਸ ’ਤੇ ਵੱਧ ਤੋਂ ਵੱਧ 10 ਰਿਕਾਰਡਿੰਗਾਂ ਅਤੇ 25 MiB। ਸੰਭਾਲੀਆਂ ਕਾਪੀਆਂ ਹਟਾਉਣ ਜਾਂ ਮਿਆਦ ਖਤਮ ਹੋਣ ਤੱਕ ਰਹਿੰਦੀਆਂ ਹਨ।',removeAll:'ਸਾਰੀਆਂ ਸੰਭਾਲੀਆਂ ਰਿਕਾਰਡਿੰਗਾਂ ਹਟਾਓ'},
  'pa-Arab':{title:'محفوظ ریکارڈنگاں',scope:'ہدایت',version:'ورژن',expires:'میعاد',limits:'ایس آلے تے زیادہ توں زیادہ 10 ریکارڈنگاں تے 25 MiB۔ محفوظ نقلاں ہٹان یا میعاد ختم ہون تک رہندیاں نیں۔',removeAll:'ساریاں محفوظ ریکارڈنگاں ہٹاؤ'},
  id:{title:'Rekaman tersimpan',scope:'Instruction',version:'Versi',expires:'Berakhir',limits:'Maksimal 10 rekaman dan 25 MiB di perangkat ini. Salinan tersimpan tetap ada sampai dihapus atau kedaluwarsa.',removeAll:'Hapus semua rekaman tersimpan'},
};
function Preview({item,label}:{item:AudioOutboxItem;label:string}){
  const [url,setUrl]=useState('');
  useEffect(()=>{const next=URL.createObjectURL(new Blob([new Uint8Array(item.draft.bytes)],{type:'audio/wav'}));setUrl(next);return()=>URL.revokeObjectURL(next);},[item]);
  return <audio controls preload="none" src={url || undefined} aria-label={label}/>;
}
export function WorkerAudioOutbox({session,language,disabled,current,onOperation,onSessionLost}:AudioOutboxProps){
  const t=copy[language],a=audioDraftCopy[language],r=workerReceiptCheckText[language];
  const [items,setItems]=useState<AudioOutboxItem[]>([]),[loading,setLoading]=useState(true),[tick,setTick]=useState(0),[working,setWorking]=useState(false),[notice,setNotice]=useState(''),[statuses,setStatuses]=useState<Record<string,string>>({});
  const live=useRef(false),revision=useRef(0),inFlight=useRef(false),allowed=useRef(current);allowed.current=current;
  useEffect(()=>{live.current=true;return()=>{live.current=false;revision.current++;};},[]);
  useEffect(()=>subscribeAudioDraftChanges(()=>{revision.current++;setItems([]);setLoading(true);setTick(value=>value+1);}),[]);
  useEffect(()=>{
    let active=true;const read=++revision.current;setItems([]);setLoading(true);
    void readAudioOutbox(session,()=>active && live.current && read===revision.current && allowed.current()).then(value=>{if(active && read===revision.current && allowed.current())setItems(value);}).catch(()=>{if(active && read===revision.current)setNotice(a.failed);}).finally(()=>{if(active && read===revision.current)setLoading(false);});
    return()=>{active=false;};
  },[session.clientContext,session.expiresAt,tick]);
  useEffect(()=>{
    if(!items.length)return;
    const expiry=Math.min(...items.map(item=>Date.parse(item.draft.expiresAt)));
    const timer=window.setTimeout(()=>{revision.current++;setItems([]);setTick(value=>value+1);},Math.max(0,expiry-Date.now()));return()=>clearTimeout(timer);
  },[items]);
  async function request(path:RequestInfo|URL,options?:RequestInit){
    const response=await fetch(path,{...options,signal:options?.signal || AbortSignal.timeout(15000)});
    if(response.status===401 || (response.status===409 && response.headers.get('content-type')?.includes('application/json') && (await response.clone().json()).error==='Session context changed'))onSessionLost();
    return response;
  }
  async function run(action:'send'|'check'|'remove'|'all',item?:AudioOutboxItem){
    if(disabled || inFlight.current || !allowed.current())return;
    inFlight.current=true;setWorking(true);setNotice('');
    const guard=()=>live.current && allowed.current();
    try {await onOperation(async()=>{
      if(!guard())throw Error();
      if(action==='all'){await clearAudioDraft(undefined,session.clientContext);if(guard()){setItems([]);setTick(value=>value+1);setNotice(a.removed);}return;}
      if(!item)throw Error();
      const store=browserAudioOutbox.slot(item.key),loaded=await readAudioDraft(store,session,item.draft.scope,guard);
      if(loaded.status!=='saved' || loaded.draft.submissionId!==item.draft.submissionId)throw Error();
      let status=a.removed;
      if(action==='remove'){await clearAudioDraft(store,session.clientContext);if(guard())setTick(value=>value+1);}
      else if(action==='send'){await sendWorkerRecording(request,session,loaded.draft.scope,loaded.draft.bytes,loaded.draft.submissionId,guard,loaded.draft.presentationId);status=a.received;}
      else {const receipt=await readWorkerRequestReceipt(request,session,loaded.draft.scope.assignmentId,'audio',loaded.draft.submissionId,guard);status=receipt?r.received:r.unknown;}
      if(guard())setStatuses(values=>({...values,[item.draft.submissionId]:status}));
    });}catch(error){if(live.current)setNotice(error instanceof WorkerAudioRetryError?workerAudioRetryText[language][error.code]:a.failed);}
    finally {inFlight.current=false;if(live.current)setWorking(false);}
  }
  const locked=disabled || working;
  return <section className="worker-audio-outbox"><div className="worker-card-head"><h2><HardDrive size={20}/> {t.title}</h2><button className="icon-button" title={a.reload} aria-label={a.reload} disabled={locked} onClick={()=>{setNotice('');setTick(value=>value+1);}}><RefreshCw size={20}/></button></div>
    <p>{a.privacy}</p><p className="muted">{t.limits}</p>{notice && <p role="status">{notice}</p>}
    {loading?<p role="status">{a.loading}</p>:!items.length?<p>{a.empty}</p>:items.map(item=><article className="worker-card" key={item.key}>
      <h3>{t.scope} <bdi>{item.draft.scope.assignmentId}</bdi></h3><p>{t.version} {item.draft.scope.version} · {item.draft.scope.language.toUpperCase()}</p>
      <p><time dateTime={item.draft.capturedAt}>{new Date(item.draft.capturedAt).toLocaleString(language)}</time></p><p>{t.expires}: <time dateTime={item.draft.expiresAt}>{new Date(item.draft.expiresAt).toLocaleString(language)}</time></p>
      {!locked && <Preview item={item} label={a.title}/>}
      <p role="status">{statuses[item.draft.submissionId] || a.saved}</p><div className="actions"><button className="button primary" disabled={locked || [a.received,r.received].includes(statuses[item.draft.submissionId])} onClick={()=>void run('send',item)}><Send size={18}/>{a.send}</button><button className="button outline" disabled={locked} onClick={()=>void run('check',item)}><RefreshCw size={18}/>{a.check}</button><button className="button subtle" disabled={locked} onClick={()=>void run('remove',item)}><Trash2 size={18}/>{a.remove}</button></div>
    </article>)}
    <button className="button outline full" disabled={locked} onClick={()=>void run('all')}><Trash2 size={20}/>{t.removeAll}</button>
  </section>;
}
