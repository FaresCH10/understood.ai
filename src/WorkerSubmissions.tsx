import { useEffect,useRef,useState } from 'react';
import { CheckCircle2,Clock3,TriangleAlert,ChevronLeft,ChevronRight,RefreshCw } from 'lucide-react';
import {readWorkerSubmissions,workerSubmissionState,WorkerSubmissionsError,type SubmissionScope,type WorkerSubmissionPage} from './worker-submissions';
import {validWorkerSession,type PageSession} from './session-state';
import {workerUiDirection,type WorkerUiLanguage} from './worker-ui-language';
import {WorkerPresentationView} from './WorkerPresentationView';
const copy={
  en:{title:'My submitted answers',refresh:'Refresh submitted answers',loading:'Loading answers...',failed:'Answers could not be loaded.',empty:'No submitted answers yet.',audio:'Recorded answer',typed:'Typed answer',latest:'Latest',pending:'Check pending',matched:'Matched key facts',clarification:'Needs clarification',unassessable:'Could not assess',audioFailed:'Audio check failed',previous:'Previous answers',next:'Next answers',count:'answers'},
  ar:{title:'إجاباتي المرسلة',refresh:'تحديث الإجابات المرسلة',loading:'جار تحميل الإجابات...',failed:'تعذر تحميل الإجابات.',empty:'لا توجد إجابات مرسلة بعد.',audio:'إجابة صوتية',typed:'إجابة مكتوبة',latest:'الأحدث',pending:'التحقق قيد الانتظار',matched:'طابقت المعلومات المطلوبة',clarification:'تحتاج إلى توضيح',unassessable:'تعذر التقييم',audioFailed:'تعذر التحقق من الصوت',previous:'الإجابات السابقة',next:'الإجابات التالية',count:'إجابات'},
  ur:{title:'میرے بھیجے گئے جواب',refresh:'بھیجے گئے جواب تازہ کریں',loading:'جواب لوڈ ہو رہے ہیں...',failed:'جواب لوڈ نہیں ہو سکے۔',empty:'ابھی کوئی جواب نہیں بھیجا گیا۔',audio:'ریکارڈ کیا گیا جواب',typed:'لکھا ہوا جواب',latest:'تازہ ترین',pending:'جانچ زیر التوا',matched:'اہم حقائق درست ہیں',clarification:'وضاحت درکار ہے',unassessable:'جانچ ممکن نہیں',audioFailed:'آواز کی جانچ ناکام ہوئی',previous:'پچھلے جواب',next:'اگلے جواب',count:'جواب'},
  hi:{title:'मेरे भेजे गए उत्तर',refresh:'भेजे गए उत्तर ताज़ा करें',loading:'उत्तर लोड हो रहे हैं...',failed:'उत्तर लोड नहीं हो सके।',empty:'अब तक कोई उत्तर नहीं भेजा गया।',audio:'रिकॉर्ड किया गया उत्तर',typed:'लिखा हुआ उत्तर',latest:'नवीनतम',pending:'जाँच लंबित',matched:'मुख्य तथ्य मिल गए',clarification:'स्पष्टीकरण चाहिए',unassessable:'जाँच नहीं हो सकी',audioFailed:'ऑडियो जाँच विफल',previous:'पिछले उत्तर',next:'अगले उत्तर',count:'उत्तर'},
  bn:{title:'আমার পাঠানো উত্তর',refresh:'পাঠানো উত্তর রিফ্রেশ করুন',loading:'উত্তর লোড হচ্ছে...',failed:'উত্তর লোড করা যায়নি।',empty:'এখনও কোনো উত্তর পাঠানো হয়নি।',audio:'রেকর্ড করা উত্তর',typed:'লেখা উত্তর',latest:'সর্বশেষ',pending:'যাচাই বাকি',matched:'মূল তথ্য মিলেছে',clarification:'স্পষ্টীকরণ প্রয়োজন',unassessable:'যাচাই করা যায়নি',audioFailed:'অডিও যাচাই ব্যর্থ',previous:'আগের উত্তর',next:'পরের উত্তর',count:'উত্তর'},
  ml:{title:'ഞാൻ അയച്ച ഉത്തരങ്ങൾ',refresh:'അയച്ച ഉത്തരങ്ങൾ പുതുക്കുക',loading:'ഉത്തരങ്ങൾ ലോഡ് ചെയ്യുന്നു...',failed:'ഉത്തരങ്ങൾ ലോഡ് ചെയ്യാനായില്ല.',empty:'ഇതുവരെ ഉത്തരങ്ങൾ അയച്ചിട്ടില്ല.',audio:'റെക്കോർഡ് ചെയ്ത ഉത്തരം',typed:'എഴുതിയ ഉത്തരം',latest:'ഏറ്റവും പുതിയത്',pending:'പരിശോധന കാത്തിരിക്കുന്നു',matched:'പ്രധാന വസ്തുതകൾ ഒത്തുപോയി',clarification:'വ്യക്തത ആവശ്യം',unassessable:'വിലയിരുത്താനായില്ല',audioFailed:'ഓഡിയോ പരിശോധന പരാജയപ്പെട്ടു',previous:'മുൻ ഉത്തരങ്ങൾ',next:'അടുത്ത ഉത്തരങ്ങൾ',count:'ഉത്തരങ്ങൾ'},
  ta:{title:'நான் அனுப்பிய பதில்கள்',refresh:'அனுப்பிய பதில்களைப் புதுப்பிக்கவும்',loading:'பதில்கள் ஏற்றப்படுகின்றன...',failed:'பதில்களை ஏற்ற முடியவில்லை.',empty:'இதுவரை பதில்கள் அனுப்பப்படவில்லை.',audio:'பதிவு செய்த பதில்',typed:'எழுத்துப் பதில்',latest:'சமீபத்தியது',pending:'சரிபார்ப்பு நிலுவையில்',matched:'முக்கிய தகவல்கள் பொருந்தின',clarification:'தெளிவு தேவை',unassessable:'மதிப்பிட முடியவில்லை',audioFailed:'ஒலி சரிபார்ப்பு தோல்வி',previous:'முந்தைய பதில்கள்',next:'அடுத்த பதில்கள்',count:'பதில்கள்'},
  te:{title:'నేను పంపిన సమాధానాలు',refresh:'పంపిన సమాధానాలను రిఫ్రెష్ చేయండి',loading:'సమాధానాలు లోడ్ అవుతున్నాయి...',failed:'సమాధానాలను లోడ్ చేయలేకపోయాం.',empty:'ఇంకా సమాధానాలు పంపలేదు.',audio:'రికార్డ్ చేసిన సమాధానం',typed:'టైప్ చేసిన సమాధానం',latest:'తాజా',pending:'తనిఖీ పెండింగ్‌లో',matched:'ముఖ్య విషయాలు సరిపోలాయి',clarification:'స్పష్టత అవసరం',unassessable:'మూల్యాంకనం చేయలేకపోయాం',audioFailed:'ఆడియో తనిఖీ విఫలమైంది',previous:'మునుపటి సమాధానాలు',next:'తదుపరి సమాధానాలు',count:'సమాధానాలు'},
  ne:{title:'मैले पठाएका उत्तरहरू',refresh:'पठाइएका उत्तर रिफ्रेस गर्नुहोस्',loading:'उत्तरहरू लोड हुँदैछन्...',failed:'उत्तरहरू लोड हुन सकेनन्।',empty:'अहिलेसम्म कुनै उत्तर पठाइएको छैन।',audio:'रेकर्ड गरिएको उत्तर',typed:'टाइप गरिएको उत्तर',latest:'नवीनतम',pending:'जाँच बाँकी',matched:'मुख्य तथ्य मिले',clarification:'स्पष्टता चाहिन्छ',unassessable:'मूल्यांकन गर्न सकिएन',audioFailed:'अडियो जाँच असफल',previous:'अघिल्ला उत्तर',next:'अर्का उत्तर',count:'उत्तर'},
  fil:{title:'Mga isinumite kong sagot',refresh:'I-refresh ang mga isinumiteng sagot',loading:'Naglo-load ang mga sagot...',failed:'Hindi ma-load ang mga sagot.',empty:'Wala pang isinumiteng sagot.',audio:'Na-record na sagot',typed:'Nakasulat na sagot',latest:'Pinakabago',pending:'Nakabinbin ang pagsusuri',matched:'Tugma ang mahahalagang detalye',clarification:'Kailangan ng paglilinaw',unassessable:'Hindi nasuri',audioFailed:'Nabigo ang pagsusuri ng audio',previous:'Mga nakaraang sagot',next:'Mga susunod na sagot',count:'sagot'},
  si:{title:'මා යැවූ පිළිතුරු',refresh:'යැවූ පිළිතුරු නැවුම් කරන්න',loading:'පිළිතුරු පූරණය වෙමින්...',failed:'පිළිතුරු පූරණය කළ නොහැක.',empty:'තවම පිළිතුරු යවා නැත.',audio:'පටිගත කළ පිළිතුර',typed:'ලිඛිත පිළිතුර',latest:'නවතම',pending:'පරීක්ෂාව බලාපොරොත්තුවෙන්',matched:'ප්‍රධාන කරුණු ගැළපුණි',clarification:'පැහැදිලි කිරීම අවශ්‍යයි',unassessable:'ඇගයීම කළ නොහැක',audioFailed:'ශ්‍රව්‍ය පරීක්ෂාව අසාර්ථකයි',previous:'පෙර පිළිතුරු',next:'ඊළඟ පිළිතුරු',count:'පිළිතුරු'},
  ru:{title:'Мои отправленные ответы',refresh:'Обновить отправленные ответы',loading:'Загрузка ответов...',failed:'Не удалось загрузить ответы.',empty:'Пока нет отправленных ответов.',audio:'Записанный ответ',typed:'Письменный ответ',latest:'Последний',pending:'Ожидает проверки',matched:'Ключевые факты совпали',clarification:'Нужно уточнение',unassessable:'Не удалось оценить',audioFailed:'Проверка аудио не удалась',previous:'Предыдущие ответы',next:'Следующие ответы',count:'ответов'},
  'pa-Guru':{title:'ਮੇਰੇ ਭੇਜੇ ਜਵਾਬ',refresh:'ਭੇਜੇ ਜਵਾਬ ਤਾਜ਼ਾ ਕਰੋ',loading:'ਜਵਾਬ ਲੋਡ ਹੋ ਰਹੇ ਹਨ...',failed:'ਜਵਾਬ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੇ।',empty:'ਹਾਲੇ ਕੋਈ ਜਵਾਬ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ।',audio:'ਰਿਕਾਰਡ ਕੀਤਾ ਜਵਾਬ',typed:'ਲਿਖਿਆ ਜਵਾਬ',latest:'ਨਵੀਨਤਮ',pending:'ਜਾਂਚ ਬਾਕੀ',matched:'ਮੁੱਖ ਤੱਥ ਮਿਲ ਗਏ',clarification:'ਸਪੱਸ਼ਟਤਾ ਲੋੜੀਂਦੀ ਹੈ',unassessable:'ਮੁਲਾਂਕਣ ਨਹੀਂ ਹੋ ਸਕਿਆ',audioFailed:'ਆਡੀਓ ਜਾਂਚ ਅਸਫਲ',previous:'ਪਿਛਲੇ ਜਵਾਬ',next:'ਅਗਲੇ ਜਵਾਬ',count:'ਜਵਾਬ'},
  'pa-Arab':{title:'میرے بھیجے جواب',refresh:'بھیجے جواب تازہ کرو',loading:'جواب لوڈ ہو رہے نیں...',failed:'جواب لوڈ نہیں ہو سکے۔',empty:'ہالے کوئی جواب نہیں بھیجیا گیا۔',audio:'ریکارڈ کیتا جواب',typed:'لکھیا جواب',latest:'تازہ ترین',pending:'جانچ باقی',matched:'اہم حقائق میل کھائے',clarification:'وضاحت لوڑیندیاں اے',unassessable:'جانچ نہیں ہو سکی',audioFailed:'آڈیو جانچ ناکام',previous:'پچھلے جواب',next:'اگلے جواب',count:'جواب'},
  id:{title:'Jawaban yang saya kirim',refresh:'Segarkan jawaban terkirim',loading:'Memuat jawaban...',failed:'Jawaban tidak dapat dimuat.',empty:'Belum ada jawaban terkirim.',audio:'Jawaban direkam',typed:'Jawaban tertulis',latest:'Terbaru',pending:'Menunggu pemeriksaan',matched:'Fakta utama cocok',clarification:'Perlu klarifikasi',unassessable:'Tidak dapat dinilai',audioFailed:'Pemeriksaan audio gagal',previous:'Jawaban sebelumnya',next:'Jawaban berikutnya',count:'jawaban'},
};

const statusCopy={
  en:{received:'Received',paused:'Check paused',unavailable:'Recording no longer available',version:'Briefing',limits:'A match is not proof of understanding or permission to begin work.'},
  ar:{received:'تم الاستلام',paused:'التحقق متوقف مؤقتاً',unavailable:'التسجيل لم يعد متاحاً',version:'التعليمات',limits:'تطابق الإجابة ليس دليلاً على الفهم أو إذناً ببدء العمل.'},
  ur:{received:'موصول ہو گیا',paused:'جانچ رکی ہوئی ہے',unavailable:'ریکارڈنگ اب دستیاب نہیں',version:'ہدایت',limits:'جواب کا درست ہونا سمجھ کا ثبوت یا کام شروع کرنے کی اجازت نہیں۔'},
  hi:{received:'प्राप्त हुआ',paused:'जाँच रुकी हुई',unavailable:'रिकॉर्डिंग अब उपलब्ध नहीं',version:'निर्देश',limits:'मिलता हुआ उत्तर समझ का प्रमाण या काम शुरू करने की अनुमति नहीं है।'},
  bn:{received:'গৃহীত',paused:'যাচাই থেমে আছে',unavailable:'রেকর্ডিং আর পাওয়া যাচ্ছে না',version:'নির্দেশনা',limits:'মিলে যাওয়া উত্তর বোঝার প্রমাণ বা কাজ শুরু করার অনুমতি নয়।'},
  ml:{received:'ലഭിച്ചു',paused:'പരിശോധന നിർത്തിയിരിക്കുന്നു',unavailable:'റെക്കോർഡിംഗ് ഇനി ലഭ്യമല്ല',version:'നിർദ്ദേശം',limits:'ഒത്തുപോകുന്ന ഉത്തരം മനസ്സിലാക്കലിന്റെ തെളിവോ ജോലി തുടങ്ങാനുള്ള അനുമതിയോ അല്ല.'},
  ta:{received:'பெறப்பட்டது',paused:'சரிபார்ப்பு நிறுத்தப்பட்டுள்ளது',unavailable:'பதிவு இனி கிடைக்காது',version:'அறிவுறுத்தல்',limits:'பொருந்தும் பதில் புரிதலுக்கான ஆதாரம் அல்லது வேலை தொடங்க அனுமதி அல்ல.'},
  te:{received:'స్వీకరించబడింది',paused:'తనిఖీ నిలిపివేయబడింది',unavailable:'రికార్డింగ్ ఇప్పుడు అందుబాటులో లేదు',version:'సూచన',limits:'సరిపోలిన సమాధానం అర్థం చేసుకున్నట్లు రుజువు లేదా పని ప్రారంభించే అనుమతి కాదు.'},
  ne:{received:'प्राप्त भयो',paused:'जाँच रोकिएको छ',unavailable:'रेकर्डिङ अब उपलब्ध छैन',version:'निर्देशन',limits:'मिल्ने उत्तर बुझाइको प्रमाण वा काम सुरु गर्ने अनुमति होइन।'},
  fil:{received:'Natanggap',paused:'Nakapause ang pagsusuri',unavailable:'Hindi na available ang recording',version:'Tagubilin',limits:'Ang tugmang sagot ay hindi patunay ng pag-unawa o pahintulot na magsimula ng trabaho.'},
  si:{received:'ලැබී ඇත',paused:'පරීක්ෂාව නතර කර ඇත',unavailable:'පටිගත කිරීම දැන් නොමැත',version:'උපදෙස',limits:'ගැළපෙන පිළිතුර තේරුම් ගැනීමේ සාක්ෂියක් හෝ වැඩ ආරම්භ කිරීමේ අවසරයක් නොවේ.'},
  ru:{received:'Получено',paused:'Проверка приостановлена',unavailable:'Запись больше недоступна',version:'Инструктаж',limits:'Совпадение ответа не доказывает понимание и не даёт разрешения начинать работу.'},
  'pa-Guru':{received:'ਪ੍ਰਾਪਤ ਹੋਇਆ',paused:'ਜਾਂਚ ਰੁਕੀ ਹੋਈ ਹੈ',unavailable:'ਰਿਕਾਰਡਿੰਗ ਹੁਣ ਉਪਲਬਧ ਨਹੀਂ',version:'ਹਦਾਇਤ',limits:'ਮਿਲਦਾ ਜਵਾਬ ਸਮਝ ਦਾ ਸਬੂਤ ਜਾਂ ਕੰਮ ਸ਼ੁਰੂ ਕਰਨ ਦੀ ਇਜਾਜ਼ਤ ਨਹੀਂ।'},
  'pa-Arab':{received:'موصول ہو گیا',paused:'جانچ رُکی ہوئی اے',unavailable:'ریکارڈنگ ہن دستیاب نہیں',version:'ہدایت',limits:'میل کھاندا جواب سمجھ دا ثبوت یا کم شروع کرن دی اجازت نہیں۔'},
  id:{received:'Diterima',paused:'Pemeriksaan dijeda',unavailable:'Rekaman tidak lagi tersedia',version:'Instruksi',limits:'Jawaban yang cocok bukan bukti pemahaman atau izin untuk mulai bekerja.'},
};
export function WorkerSubmissions({assignmentId,version,contentLanguage,session,language,refresh,current,onSessionLost,timezone}:{assignmentId:string;version:number;contentLanguage:SubmissionScope['language'];session:PageSession;language:WorkerUiLanguage;refresh:number;current:()=>boolean;onSessionLost:()=>void;timezone?:string}) {
  const t=copy[language] || copy.en,direction=workerUiDirection(language);
  const states=statusCopy[language];
  const [page,setPage]=useState(1),[retry,setRetry]=useState(0);
  const key=JSON.stringify([session.clientContext,session.expiresAt,assignmentId,version,contentLanguage,page]);
  const selected=useRef(key);selected.current=key;
  const [read,setRead]=useState<{key:string;data:WorkerSubmissionPage|null;failed:boolean}>({key:'',data:null,failed:false});
  const data=read.key===key?read.data:null,failed=read.key===key&&read.failed;
  useEffect(() => {
    const controller=new AbortController();let alive=true,timedOut=false;
    const isCurrent=()=>alive&&selected.current===key&&current()&&validWorkerSession(session);
    setRead({key,data:null,failed:false});
    const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},15000);
    readWorkerSubmissions(fetch,session,{assignmentId,version,language:contentLanguage},page,controller.signal,isCurrent)
      .then(value=>{if(isCurrent())setRead({key,data:value,failed:false});}).catch(error=>{
        if(!alive||selected.current!==key||controller.signal.aborted&&!timedOut)return;
        setRead({key,data:null,failed:true});
        if(error instanceof WorkerSubmissionsError&&error.code==='session')onSessionLost();
      }).finally(()=>window.clearTimeout(timeout));
    return()=>{alive=false;controller.abort();window.clearTimeout(timeout);};
  },[key,refresh,retry]);
  return <section className="worker-card worker-submissions"><div className="worker-card-head"><h2>{t.title}</h2><button className="icon-button" aria-label={t.refresh} title={t.refresh} onClick={() => setRetry((value) => value+1)}><RefreshCw size={20} /></button></div>
    <div role={failed ? 'alert' : 'status'}>{failed ? t.failed : data===null ? t.loading : !data.total ? t.empty : null}</div>
    {data?.receipts.map((receipt) => <article className="worker-help-entry" key={receipt.id}>
      <div className="worker-card-head"><strong>{receipt.kind==='audio' ? t.audio : t.typed}{receipt.isLatest ? ` · ${t.latest}` : ''}</strong><time dateTime={receipt.receivedAt}>{new Date(receipt.receivedAt).toLocaleString(language,{timeZone:timezone})}</time></div>
      <p className="muted">{states.version} v{data.assignment.version} · <bdi>{data.assignment.language.toUpperCase()}</bdi></p>
      <ol className="worker-submission-steps"><li><CheckCircle2 size={20} aria-hidden="true"/><span>{states.received}</span></li><li data-state={workerSubmissionState(receipt)}>{receipt.outcome==='matched'?<CheckCircle2 size={20} aria-hidden="true"/>:workerSubmissionState(receipt)==='pending'||workerSubmissionState(receipt)==='paused'?<Clock3 size={20} aria-hidden="true"/>:<TriangleAlert size={20} aria-hidden="true"/>}<span>{workerSubmissionState(receipt)==='paused'?states.paused:workerSubmissionState(receipt)==='unavailable'?states.unavailable:t[workerSubmissionState(receipt) as 'pending'|'audioFailed'|'matched'|'clarification'|'unassessable']}</span></li></ol>
      {receipt.answerText!==null && <p dir="auto">{receipt.answerText}</p>}
      {receipt.recordingId && <audio controls preload="none" aria-label={t.audio} src={`/api/recordings/${encodeURIComponent(receipt.recordingId)}/audio`} />}
      {typeof session.language==='string'&&session.language!==contentLanguage&&(receipt.answerText!==null||receipt.kind==='typed')
        &&<WorkerPresentationView compact assignmentId={assignmentId} version={version} sourceKind="answer" sourceId={receipt.id}
          originalLanguage={contentLanguage} approvedLanguage={session.language} uiLanguage={language} session={session}
          hasAudio={receipt.recordingId!==null} current={current} onSessionLost={onSessionLost}/>}
    </article>)}
    {data && data.total>0 && <><p className="muted">{states.limits}</p><div className="audit-pagination"><span>{page} / {Math.max(1,Math.ceil(data.total/5))} · {data.total} {t.count}</span><div className="actions"><button className="icon-button" aria-label={t.previous} title={t.previous} disabled={page<=1} onClick={() => setPage((value) => value-1)}>{direction==='rtl' ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}</button><button className="icon-button" aria-label={t.next} title={t.next} disabled={page>=Math.ceil(data.total/5)||page>=5000} onClick={() => setPage((value) => value+1)}>{direction==='rtl' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}</button></div></div></>}
  </section>;
}
