import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {RefreshCw,Trash2} from 'lucide-react';
import {WorkerRecorderView} from './WorkerRecorderView';
import type {MessageSession} from './case-message-recovery';
import {readVoicePending,retainVoice,clearVoicePending,type VoicePending,type VoiceScope} from './case-voice-recovery';
import {requestCaseVoice,VoiceRequestError,type VoiceFailure,type VoiceHttpReceipt,type VoiceOperation} from './case-voice-request';
import {validConversationSession} from './conversation-request';
import {keepDialogFocus} from './dialog-focus';
import {readWorkerRecordingNotice,WorkerRecordingNoticeError} from './worker-recording-notice';
import type {RecordingLanguage} from './recording-notice';
import type {WorkerUiLanguage} from './worker-ui-language';

type VoiceCopy={unknown:string;check:string;received:string;failed:string;unavailable:string};
const copy:Record<WorkerUiLanguage,VoiceCopy>={
  en:{unknown:'Voice delivery is unconfirmed. Check the receipt before retrying the same recording.',check:'Check voice receipt',received:'Voice message received.',failed:'Voice recording was not received. Record a new message.',unavailable:'Voice receipt could not be verified.'},
  ar:{unknown:'لم يتأكد إرسال الصوت. تحقق من الاستلام قبل إعادة إرسال التسجيل نفسه.',check:'تحقق من استلام الصوت',received:'تم استلام الرسالة الصوتية.',failed:'لم يتم استلام التسجيل. سجّل رسالة جديدة.',unavailable:'تعذر التحقق من استلام الصوت.'},
  ur:{unknown:'صوتی پیغام کی ترسیل غیر مصدقہ ہے۔ وہی ریکارڈنگ دوبارہ بھیجنے سے پہلے وصولی چیک کریں۔',check:'صوتی پیغام کی وصولی چیک کریں',received:'صوتی پیغام موصول ہو گیا۔',failed:'ریکارڈنگ موصول نہیں ہوئی۔ نیا پیغام ریکارڈ کریں۔',unavailable:'صوتی پیغام کی وصولی کی تصدیق نہیں ہو سکی۔'},
  hi:{unknown:'आवाज़ की डिलीवरी असत्यापित है। उसी रिकॉर्डिंग को फिर भेजने से पहले प्राप्ति जाँचें।',check:'आवाज़ प्राप्ति जाँचें',received:'आवाज़ संदेश प्राप्त हुआ।',failed:'आवाज़ रिकॉर्डिंग प्राप्त नहीं हुई। नया संदेश रिकॉर्ड करें।',unavailable:'आवाज़ प्राप्ति सत्यापित नहीं हो सकी।'},
  bn:{unknown:'ভয়েস ডেলিভারি যাচাই হয়নি। একই রেকর্ডিং আবার পাঠানোর আগে প্রাপ্তি দেখুন।',check:'ভয়েস প্রাপ্তি দেখুন',received:'ভয়েস বার্তা পাওয়া গেছে।',failed:'ভয়েস রেকর্ডিং পাওয়া যায়নি। নতুন বার্তা রেকর্ড করুন।',unavailable:'ভয়েস প্রাপ্তি যাচাই করা যায়নি।'},
  ml:{unknown:'ശബ്ദ ഡെലിവറി സ്ഥിരീകരിച്ചിട്ടില്ല. അതേ റെക്കോർഡിംഗ് വീണ്ടും അയക്കുന്നതിന് മുമ്പ് സ്വീകരണം പരിശോധിക്കുക.',check:'ശബ്ദ സ്വീകരണം പരിശോധിക്കുക',received:'ശബ്ദ സന്ദേശം ലഭിച്ചു.',failed:'ശബ്ദ റെക്കോർഡിംഗ് ലഭിച്ചിട്ടില്ല. പുതിയ സന്ദേശം റെക്കോർഡ് ചെയ്യുക.',unavailable:'ശബ്ദ സ്വീകരണം സ്ഥിരീകരിക്കാനായില്ല.'},
  ta:{unknown:'குரல் அனுப்புதல் உறுதிப்படுத்தப்படவில்லை. அதே பதிவை மீண்டும் அனுப்பும் முன் பெறுதலைச் சரிபார்க்கவும்.',check:'குரல் பெறுதலைச் சரிபார்',received:'குரல் செய்தி பெறப்பட்டது.',failed:'குரல் பதிவு பெறப்படவில்லை. புதிய செய்தியைப் பதிவு செய்யவும்.',unavailable:'குரல் பெறுதலைச் சரிபார்க்க முடியவில்லை.'},
  te:{unknown:'వాయిస్ డెలివరీ ధృవీకరించబడలేదు. అదే రికార్డింగ్ను మళ్లీ పంపే ముందు అందుబాటును తనిఖీ చేయండి.',check:'వాయిస్ అందుబాటును తనిఖీ చేయండి',received:'వాయిస్ సందేశం అందింది.',failed:'వాయిస్ రికార్డింగ్ అందలేదు. కొత్త సందేశాన్ని రికార్డ్ చేయండి.',unavailable:'వాయిస్ అందుబాటును ధృవీకరించలేకపోయాం.'},
  ne:{unknown:'आवाज डेलिभरी प्रमाणित भएको छैन। उही रेकर्डिङ फेरि पठाउनु अघि प्राप्ति जाँच्नुहोस्।',check:'आवाज प्राप्ति जाँच्नुहोस्',received:'आवाज सन्देश प्राप्त भयो।',failed:'आवाज रेकर्डिङ प्राप्त भएन। नयाँ सन्देश रेकर्ड गर्नुहोस्।',unavailable:'आवाज प्राप्ति प्रमाणित गर्न सकिएन।'},
  fil:{unknown:'Hindi nakumpirma ang paghahatid ng boses. Suriin ang resibo bago ipadala muli ang parehong recording.',check:'Suriin ang resibo ng boses',received:'Natanggap ang voice message.',failed:'Hindi natanggap ang voice recording. Mag-record ng bagong mensahe.',unavailable:'Hindi ma-verify ang resibo ng boses.'},
  si:{unknown:'හඬ බෙදාහැරීම තහවුරු කර නැත. එම පටිගත කිරීම නැවත යැවීමට පෙර ලැබීම පරීක්ෂා කරන්න.',check:'හඬ ලැබීම පරීක්ෂා කරන්න',received:'හඬ පණිවිඩය ලැබුණි.',failed:'හඬ පටිගත කිරීම ලැබුණේ නැත. නව පණිවිඩයක් පටිගත කරන්න.',unavailable:'හඬ ලැබීම තහවුරු කළ නොහැක.'},
  ru:{unknown:'Доставка голоса не подтверждена. Проверьте получение перед повторной отправкой той же записи.',check:'Проверить получение голоса',received:'Голосовое сообщение получено.',failed:'Голосовая запись не получена. Запишите новое сообщение.',unavailable:'Не удалось проверить получение голоса.'},
  'pa-Guru':{unknown:'ਆਵਾਜ਼ ਦੀ ਡਿਲਿਵਰੀ ਦੀ ਪੁਸ਼ਟੀ ਨਹੀਂ ਹੋਈ। ਉਹੀ ਰਿਕਾਰਡਿੰਗ ਦੁਬਾਰਾ ਭੇਜਣ ਤੋਂ ਪਹਿਲਾਂ ਪ੍ਰਾਪਤੀ ਜਾਂਚੋ।',check:'ਆਵਾਜ਼ ਪ੍ਰਾਪਤੀ ਜਾਂਚੋ',received:'ਆਵਾਜ਼ ਸੁਨੇਹਾ ਪ੍ਰਾਪਤ ਹੋਇਆ।',failed:'ਆਵਾਜ਼ ਰਿਕਾਰਡਿੰਗ ਪ੍ਰਾਪਤ ਨਹੀਂ ਹੋਈ। ਨਵਾਂ ਸੁਨੇਹਾ ਰਿਕਾਰਡ ਕਰੋ।',unavailable:'ਆਵਾਜ਼ ਪ੍ਰਾਪਤੀ ਦੀ ਪੁਸ਼ਟੀ ਨਹੀਂ ਹੋ ਸਕੀ।'},
  'pa-Arab':{unknown:'آواز ترسیل دی تصدیق نہیں ہوئی۔ اوہی ریکارڈنگ دوبارہ بھیجن توں پہلاں وصولی چیک کرو۔',check:'آواز وصولی چیک کرو',received:'آواز پیغام مل گیا۔',failed:'آواز ریکارڈنگ نہیں ملی۔ نواں پیغام ریکارڈ کرو۔',unavailable:'آواز وصولی دی تصدیق نہیں ہو سکی۔'},
  id:{unknown:'Pengiriman suara belum terkonfirmasi. Periksa tanda terima sebelum mengirim ulang rekaman yang sama.',check:'Periksa tanda terima suara',received:'Pesan suara diterima.',failed:'Rekaman suara tidak diterima. Rekam pesan baru.',unavailable:'Tanda terima suara tidak dapat diverifikasi.'},
};
type ClearCopy={action:string;title:string;impact:string;cancel:string;confirm:string};
const clearCopy:Record<WorkerUiLanguage,ClearCopy>={
  en:{action:'Clear local recording preview',title:'Clear this local recording?',impact:'This removes only the recording preview on this page. A pending upload is not cancelled, sent audio is not deleted, and you can still check its receipt.',cancel:'Cancel',confirm:'Clear local preview'},
  ar:{action:'مسح معاينة التسجيل المحلية',title:'مسح هذا التسجيل المحلي؟',impact:'ستُمسح معاينة التسجيل من هذه الصفحة فقط. لن يُلغى رفع معلق ولن يُحذف صوت مرسل، ويمكنك الاستمرار في التحقق من الاستلام.',cancel:'إلغاء',confirm:'مسح المعاينة المحلية'},
  ur:{action:'مقامی ریکارڈنگ کا پیش نظارہ صاف کریں',title:'یہ مقامی ریکارڈنگ صاف کریں؟',impact:'صرف اس صفحے کا ریکارڈنگ پیش نظارہ صاف ہوگا۔ زیر التوا اپ لوڈ منسوخ یا بھیجی گئی آڈیو حذف نہیں ہوگی۔ آپ وصولی اب بھی چیک کر سکتے ہیں۔',cancel:'منسوخ کریں',confirm:'مقامی پیش نظارہ صاف کریں'},
  hi:{action:'स्थानीय रिकॉर्डिंग पूर्वावलोकन साफ़ करें',title:'यह स्थानीय रिकॉर्डिंग साफ़ करें?',impact:'यह केवल इस पृष्ठ का रिकॉर्डिंग पूर्वावलोकन हटाता है। लंबित अपलोड रद्द नहीं होता, भेजी गई ऑडियो नहीं मिटती, और आप उसकी प्राप्ति फिर भी जाँच सकते हैं।',cancel:'रद्द करें',confirm:'स्थानीय पूर्वावलोकन साफ़ करें'},
  bn:{action:'স্থানীয় রেকর্ডিং প্রিভিউ মুছুন',title:'এই স্থানীয় রেকর্ডিং মুছবেন?',impact:'এটি শুধু এই পৃষ্ঠার রেকর্ডিং প্রিভিউ মুছবে। অপেক্ষমাণ আপলোড বাতিল বা পাঠানো অডিও মুছবে না, এবং আপনি এর প্রাপ্তি এখনও দেখতে পারেন।',cancel:'বাতিল করুন',confirm:'স্থানীয় প্রিভিউ মুছুন'},
  ml:{action:'പ്രാദേശിക റെക്കോർഡിംഗ് പ്രിവ്യൂ മായ്ക്കുക',title:'ഈ പ്രാദേശിക റെക്കോർഡിംഗ് മായ്ക്കണോ?',impact:'ഇത് ഈ പേജിലെ റെക്കോർഡിംഗ് പ്രിവ്യൂ മാത്രം നീക്കും. കാത്തിരിക്കുന്ന അപ്‌ലോഡ് റദ്ദാകില്ല, അയച്ച ഓഡിയോ ഇല്ലാതാകില്ല, സ്വീകരണം ഇപ്പോഴും പരിശോധിക്കാം.',cancel:'റദ്ദാക്കുക',confirm:'പ്രാദേശിക പ്രിവ്യൂ മായ്ക്കുക'},
  ta:{action:'உள்ளூர் பதிவு முன்னோட்டத்தை அழி',title:'இந்த உள்ளூர் பதிவை அழிக்கவா?',impact:'இது இந்தப் பக்கத்தின் பதிவு முன்னோட்டத்தை மட்டும் நீக்கும். நிலுவை பதிவேற்றம் ரத்தாகாது, அனுப்பிய ஒலி நீக்கப்படாது, அதன் பெறுதலை இன்னும் சரிபார்க்கலாம்.',cancel:'ரத்து செய்',confirm:'உள்ளூர் முன்னோட்டத்தை அழி'},
  te:{action:'స్థానిక రికార్డింగ్ ప్రివ్యూను క్లియర్ చేయండి',title:'ఈ స్థానిక రికార్డింగ్ను క్లియర్ చేయాలా?',impact:'ఇది ఈ పేజీలోని రికార్డింగ్ ప్రివ్యూను మాత్రమే తొలగిస్తుంది. పెండింగ్ అప్లోడ్ రద్దు కాదు, పంపిన ఆడియో తొలగించబడదు, దాని అందుబాటును ఇప్పటికీ తనిఖీ చేయవచ్చు.',cancel:'రద్దు చేయండి',confirm:'స్థానిక ప్రివ్యూను క్లియర్ చేయండి'},
  ne:{action:'स्थानीय रेकर्डिङ पूर्वावलोकन खाली गर्नुहोस्',title:'यो स्थानीय रेकर्डिङ खाली गर्ने हो?',impact:'यसले यो पृष्ठको रेकर्डिङ पूर्वावलोकन मात्र हटाउँछ। पर्खिरहेको अपलोड रद्द वा पठाइएको अडियो मेटिँदैन, र तपाईं यसको प्राप्ति अझै जाँच्न सक्नुहुन्छ।',cancel:'रद्द गर्नुहोस्',confirm:'स्थानीय पूर्वावलोकन खाली गर्नुहोस्'},
  fil:{action:'I-clear ang lokal na preview ng recording',title:'I-clear ang lokal na recording na ito?',impact:'Inaalis lang nito ang preview ng recording sa page na ito. Hindi kinakansela ang nakabinbing upload, hindi binubura ang naipadalang audio, at maaari mo pa ring suriin ang resibo nito.',cancel:'Kanselahin',confirm:'I-clear ang lokal na preview'},
  si:{action:'දේශීය පටිගත කිරීමේ පෙරදසුන හිස් කරන්න',title:'මෙම දේශීය පටිගත කිරීම හිස් කරන්නද?',impact:'මෙය මෙම පිටුවේ පටිගත කිරීමේ පෙරදසුන පමණක් ඉවත් කරයි. රැඳී ඇති උඩුගත කිරීම අවලංගු නොවේ, යැවූ ශ්‍රව්‍ය මැකෙන්නේ නැත, තවමත් එහි ලැබීම පරීක්ෂා කළ හැක.',cancel:'අවලංගු කරන්න',confirm:'දේශීය පෙරදසුන හිස් කරන්න'},
  ru:{action:'Очистить локальное превью записи',title:'Очистить эту локальную запись?',impact:'Это удалит только превью записи на этой странице. Ожидающая загрузка не отменяется, отправленное аудио не удаляется, и вы всё ещё можете проверить его получение.',cancel:'Отмена',confirm:'Очистить локальное превью'},
  'pa-Guru':{action:'ਸਥਾਨਕ ਰਿਕਾਰਡਿੰਗ ਝਲਕ ਸਾਫ਼ ਕਰੋ',title:'ਇਹ ਸਥਾਨਕ ਰਿਕਾਰਡਿੰਗ ਸਾਫ਼ ਕਰਨੀ ਹੈ?',impact:'ਇਹ ਸਿਰਫ਼ ਇਸ ਪੰਨੇ ਦੀ ਰਿਕਾਰਡਿੰਗ ਝਲਕ ਹਟਾਉਂਦਾ ਹੈ। ਬਕਾਇਆ ਅੱਪਲੋਡ ਰੱਦ ਜਾਂ ਭੇਜੀ ਆਡੀਓ ਮਿਟਦੀ ਨਹੀਂ, ਅਤੇ ਤੁਸੀਂ ਇਸ ਦੀ ਪ੍ਰਾਪਤੀ ਅਜੇ ਵੀ ਜਾਂਚ ਸਕਦੇ ਹੋ।',cancel:'ਰੱਦ ਕਰੋ',confirm:'ਸਥਾਨਕ ਝਲਕ ਸਾਫ਼ ਕਰੋ'},
  'pa-Arab':{action:'مقامی ریکارڈنگ دا پیش نظارہ صاف کرو',title:'ایہ مقامی ریکارڈنگ صاف کرنی اے؟',impact:'ایہ صرف ایس صفحے دا ریکارڈنگ پیش نظارہ ہٹاندا اے۔ زیر التوا اپ لوڈ منسوخ یا بھیجی آڈیو حذف نہیں ہوندی، تے تسیں ایسدی وصولی اجے وی چیک کر سکدے او۔',cancel:'منسوخ کرو',confirm:'مقامی پیش نظارہ صاف کرو'},
  id:{action:'Hapus pratinjau rekaman lokal',title:'Hapus rekaman lokal ini?',impact:'Ini hanya menghapus pratinjau rekaman di halaman ini. Unggahan yang tertunda tidak dibatalkan, audio terkirim tidak dihapus, dan Anda masih dapat memeriksa tanda terimanya.',cancel:'Batal',confirm:'Hapus pratinjau lokal'},
};
type Props={scope:VoiceScope;session:MessageSession;language:WorkerUiLanguage;noticeLanguage?:RecordingLanguage;available?:boolean;disabled?:boolean;current?:()=>boolean;canMutate?:()=>boolean;onDirtyChange:(value:boolean)=>void;onReceived:()=>void;onSessionLost?:()=>void};
export function CaseVoiceRecorder(props:Props){
  return <VoiceContent key={JSON.stringify([props.session.clientContext,props.session.expiresAt,props.scope])} {...props}/>;
}
function VoiceContent({scope,session,language,noticeLanguage:selectedNoticeLanguage,available=true,disabled=false,current=()=>true,canMutate=()=>true,onDirtyChange,onReceived,onSessionLost}:Props){
  const t=copy[language],clearText=clearCopy[language],dialogId=useId(),noticeLanguage:RecordingLanguage=selectedNoticeLanguage??(language==='ar'||language==='ur'?language:'en');
  const [pending,setPending]=useState<VoicePending|null>(null),[busy,setBusy]=useState(false),[unsaved,setUnsaved]=useState(false),[failure,setFailure]=useState<VoiceFailure|null>(null),[notice,setNotice]=useState<'received'|'failed'|null>(null),[blocked,setBlocked]=useState(false),[generation,setGeneration]=useState(0);
  const mounted=useRef(false),flight=useRef(false),controller=useRef<AbortController|null>(null),callbacks=useRef({current,canMutate,disabled,available,onDirtyChange,onReceived,onSessionLost});callbacks.current={current,canMutate,disabled,available,onDirtyChange,onReceived,onSessionLost};
  const dialog=useRef<HTMLDialogElement>(null),clearTrigger=useRef<HTMLElement|null>(null),checkButton=useRef<HTMLButtonElement>(null),clearIntent=useRef<{id:string;generation:number}|null>(null);
  const isCurrent=()=>mounted.current&&callbacks.current.current()&&validConversationSession(session);
  const maySend=()=>isCurrent()&&callbacks.current.available&&!callbacks.current.disabled&&callbacks.current.canMutate();
  const loadSiteNotice=useMemo(()=>async(selected:RecordingLanguage,signal:AbortSignal)=>{
    try{return await readWorkerRecordingNotice(fetch,session,selected,signal,()=>!signal.aborted&&callbacks.current.current());}
    catch(reason){if(!signal.aborted&&callbacks.current.current()&&reason instanceof WorkerRecordingNoticeError&&reason.code==='session')callbacks.current.onSessionLost?.();throw reason;}
  },[session.clientContext,session.expiresAt]);
  useEffect(()=>{mounted.current=true;try{setPending(readVoicePending(sessionStorage,session,scope));}catch{setBlocked(true);setFailure('recovery');}return()=>{mounted.current=false;controller.current?.abort();callbacks.current.onDirtyChange(false);};},[]);
  useEffect(()=>{callbacks.current.onDirtyChange(unsaved||busy);},[unsaved,busy]);
  function report(error:unknown){
    if(!mounted.current||!callbacks.current.current())return;
    const code=error instanceof VoiceRequestError?error.code:'recovery';setFailure(code);
    if(code==='session')callbacks.current.onSessionLost?.();
  }
  async function request(retained:VoicePending,operation:VoiceOperation){
    const command=new AbortController();controller.current=command;
    return requestCaseVoice(fetch,session,scope,retained,operation,command.signal,isCurrent,maySend);
  }
  function accept(value:VoiceHttpReceipt,retained:VoicePending){
    if(!isCurrent())throw new VoiceRequestError('session');
    if(value.status==='storing')throw new VoiceRequestError('conflict');
    try{clearVoicePending(sessionStorage,session,scope,retained.id);}catch{throw new VoiceRequestError('recovery');}
    setPending(null);setFailure(null);setNotice(value.status);
    if(value.status==='failed'){setGeneration(value=>value+1);return false;}
    callbacks.current.onReceived();return true;
  }
  async function send(bytes:Uint8Array,id:string){
    if(!maySend()||blocked||flight.current)throw Error(t.unavailable);
    flight.current=true;setBusy(true);setFailure(null);setNotice(null);
    const recording=new Uint8Array(bytes);let rejected=false;
    try{
      const retained=await retainVoice(sessionStorage,session,scope,id,recording,maySend);
      if(!isCurrent())throw new VoiceRequestError('session');setPending(retained);
      if(!accept(await request(retained,{kind:'send',bytes:recording}),retained)){rejected=true;throw Error(t.failed);}
    }catch(error){if(!rejected)report(error);throw Error(rejected?t.failed:t.unavailable);}finally{flight.current=false;if(mounted.current)setBusy(false);}
  }
  async function check(){
    if(!pending||flight.current||!isCurrent())return;flight.current=true;setBusy(true);setFailure(null);
    try{if(accept(await request(pending,{kind:'receipt'}),pending))setGeneration(value=>value+1);}catch(error){report(error);}finally{flight.current=false;if(mounted.current)setBusy(false);}
  }
  function askClear(){if(busy||flight.current||!unsaved||!pending||!isCurrent())return;clearIntent.current={id:pending.id,generation};clearTrigger.current=document.activeElement as HTMLElement;dialog.current?.showModal();}
  function confirmClear(){
    if(!busy&&!flight.current&&isCurrent()&&unsaved&&pending?.id===clearIntent.current?.id&&generation===clearIntent.current?.generation){setGeneration(value=>value+1);setUnsaved(false);setFailure(null);setNotice(null);}
    dialog.current?.close();
  }
  if(!current()||!validConversationSession(session))return <p role="alert">{t.unavailable}</p>;
  if(!available&&!pending&&!unsaved&&!busy&&!notice)return null;
  return <div className="case-voice-recorder">
    {pending&&<div className="notice notice-amber"><p role="status">{t.unknown}</p><div className="actions"><button ref={checkButton} className="button outline" disabled={busy||blocked} onClick={()=>void check()}><RefreshCw size={18}/>{t.check}</button>{unsaved&&<button type="button" className="icon-button" title={clearText.action} aria-label={clearText.action} disabled={busy} onClick={askClear}><Trash2 size={18}/></button>}</div></div>}
    {failure&&<p role="alert" className="record-error">{failure==='conflict'?t.unknown:t.unavailable}</p>}{notice&&<p role="status">{t[notice]}</p>}
    <WorkerRecorderView key={generation} language={language} noticeLanguage={noticeLanguage} loadSiteNotice={loadSiteNotice} purpose={scope.kind} retryOnly={!!pending} synthetic={false} disabled={!available||disabled||busy||blocked||!canMutate()||(!!pending&&!unsaved)} saveAllowed={false} onSave={async()=>{throw Error(t.unavailable);}} onSend={send} onUnsavedChange={setUnsaved}/>
    <dialog ref={dialog} className="withdraw-dialog" aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-impact`} onKeyDown={keepDialogFocus} onClose={()=>{clearIntent.current=null;if(clearTrigger.current?.isConnected)clearTrigger.current.focus();else checkButton.current?.focus();}}><h2 id={`${dialogId}-title`}>{clearText.title}</h2><p id={`${dialogId}-impact`}>{clearText.impact}</p><div className="actions"><button className="button outline" autoFocus onClick={()=>dialog.current?.close()}>{clearText.cancel}</button><button className="button danger" onClick={confirmClear}>{clearText.confirm}</button></div></dialog>
  </div>;
}
